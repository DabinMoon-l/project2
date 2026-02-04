/**
 * CLOVA OCR Cloud Function
 *
 * Naver CLOVA OCR API를 사용하여 이미지에서 텍스트를 추출합니다.
 * 월 500건 무료 한도를 추적하고 초과 시 차단합니다.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";

// CLOVA OCR API 키 (Firebase Secrets)
const CLOVA_OCR_API_KEY = defineSecret("CLOVA_OCR_API_KEY");

// 월별 사용량 한도
const MONTHLY_LIMIT = 500;

/**
 * 현재 월의 사용량 조회
 */
async function getMonthlyUsage(): Promise<number> {
  const db = getFirestore();
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const usageDoc = await db.collection("ocrUsage").doc(yearMonth).get();

  if (!usageDoc.exists) {
    return 0;
  }

  return usageDoc.data()?.count || 0;
}

/**
 * 사용량 증가
 */
async function incrementUsage(): Promise<number> {
  const db = getFirestore();
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const usageRef = db.collection("ocrUsage").doc(yearMonth);

  await usageRef.set(
    {
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const updatedDoc = await usageRef.get();
  return updatedDoc.data()?.count || 1;
}

/**
 * CLOVA OCR API 호출
 */
async function callClovaOcr(
  imageBase64: string,
  apiKey: string
): Promise<string> {
  // 이미지 포맷 감지
  let format = "jpg";
  if (imageBase64.startsWith("data:image/png")) {
    format = "png";
  } else if (imageBase64.startsWith("data:image/gif")) {
    format = "gif";
  }

  // base64 데이터 URL에서 실제 데이터만 추출
  const base64Data = imageBase64.includes(",")
    ? imageBase64.split(",")[1]
    : imageBase64;

  const requestBody = {
    version: "V2",
    requestId: `ocr-${Date.now()}`,
    timestamp: Date.now(),
    lang: "ko",
    images: [
      {
        format,
        name: "image",
        data: base64Data,
      },
    ],
  };

  const response = await fetch(
    "https://chkb1hd9a5.apigw.ntruss.com/custom/v1/50044/cc4a285778afaa7b3f6fa05f79b7c480b0f54c8545cd3519200e6c5afd1b2c11/general",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OCR-SECRET": apiKey,
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("CLOVA OCR API 오류:", response.status, errorText);
    throw new Error(`CLOVA OCR API 오류: ${response.status}`);
  }

  const result = await response.json();

  // 텍스트 추출
  if (!result.images || result.images.length === 0) {
    return "";
  }

  const image = result.images[0];
  if (image.inferResult !== "SUCCESS") {
    console.error("OCR 처리 실패:", image.inferResult, image.message);
    throw new Error(`OCR 처리 실패: ${image.message || image.inferResult}`);
  }

  // 필드에서 텍스트 추출하여 합치기
  const fields = image.fields || [];
  const lines: string[] = [];
  let currentLine = "";

  for (const field of fields) {
    const text = field.inferText || "";
    const lineBreak = field.lineBreak || false;

    currentLine += text;

    if (lineBreak) {
      lines.push(currentLine.trim());
      currentLine = "";
    } else {
      currentLine += " ";
    }
  }

  // 마지막 줄 처리
  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines.join("\n");
}

/**
 * OCR 사용량 조회 (Callable Function)
 */
export const getOcrUsage = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const currentUsage = await getMonthlyUsage();
    const remaining = Math.max(0, MONTHLY_LIMIT - currentUsage);

    return {
      used: currentUsage,
      limit: MONTHLY_LIMIT,
      remaining,
    };
  }
);

/**
 * CLOVA OCR 실행 (Callable Function)
 *
 * @param data.image - base64 인코딩된 이미지 데이터
 * @returns 추출된 텍스트
 */
export const runClovaOcr = onCall(
  {
    region: "asia-northeast3",
    secrets: [CLOVA_OCR_API_KEY],
    memory: "512MiB",
    timeoutSeconds: 60,
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { image } = request.data as { image: string };

    if (!image) {
      throw new HttpsError("invalid-argument", "이미지 데이터가 필요합니다.");
    }

    // API 키 확인
    const apiKey = CLOVA_OCR_API_KEY.value();

    if (!apiKey) {
      console.error("CLOVA OCR API 키가 설정되지 않았습니다.");
      throw new HttpsError(
        "failed-precondition",
        "OCR 서비스가 설정되지 않았습니다. 관리자에게 문의하세요."
      );
    }

    // 사용량 확인
    const currentUsage = await getMonthlyUsage();
    if (currentUsage >= MONTHLY_LIMIT) {
      throw new HttpsError(
        "resource-exhausted",
        `이번 달 OCR 사용량(${MONTHLY_LIMIT}건)을 초과했습니다. 다음 달에 다시 시도해주세요.`
      );
    }

    try {
      // CLOVA OCR 호출
      const extractedText = await callClovaOcr(image, apiKey);

      // 사용량 증가
      const newUsage = await incrementUsage();

      console.log(`OCR 완료 (사용량: ${newUsage}/${MONTHLY_LIMIT})`);

      return {
        success: true,
        text: extractedText,
        usage: {
          used: newUsage,
          limit: MONTHLY_LIMIT,
          remaining: MONTHLY_LIMIT - newUsage,
        },
      };
    } catch (error) {
      console.error("OCR 처리 오류:", error);
      throw new HttpsError(
        "internal",
        error instanceof Error ? error.message : "OCR 처리 중 오류가 발생했습니다."
      );
    }
  }
);
