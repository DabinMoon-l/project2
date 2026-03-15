/**
 * CLOVA OCR Cloud Function
 *
 * Naver CLOVA OCR API를 사용하여 이미지에서 텍스트를 추출합니다.
 * 월 500건 무료 한도를 추적하고 초과 시 차단합니다.
 *
 * 주요 기능:
 * - OCR 텍스트 추출
 * - 문제지 파싱 (2단 처리, 선지 파싱, 보기 파싱 등)
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";
import {
  parseQuestions,
  OcrField,
  ParseResult,
} from "./questionParser";
import {
  parseQuestionsV2,
  ClovaField,
  ParseResultV2,
} from "./questionParserV2";
import {
  parseQuestionsV3,
  ClovaField as ClovaFieldV3,
  ParseResultV3,
} from "./questionParserV3";
import {
  parseQuestionsV4,
  ParseResultV4,
} from "./questionParserV4";

// CLOVA OCR API 키 (Firebase Secrets)
const CLOVA_OCR_API_KEY = defineSecret("CLOVA_OCR_API_KEY");
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

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
 * CLOVA OCR API 호출 결과
 */
interface ClovaOcrResult {
  text: string;
  fields: OcrField[];
}

/**
 * CLOVA OCR API 호출
 */
async function callClovaOcr(
  imageBase64: string,
  apiKey: string
): Promise<ClovaOcrResult> {
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
    return { text: "", fields: [] };
  }

  const image = result.images[0];
  if (image.inferResult !== "SUCCESS") {
    console.error("OCR 처리 실패:", image.inferResult, image.message);
    throw new Error(`OCR 처리 실패: ${image.message || image.inferResult}`);
  }

  const fields = image.fields || [];

  // 2단 감지: x좌표 분포 분석
  const xCoordinates = fields.map((f: any) => {
    const vertices = f.boundingPoly?.vertices;
    if (vertices && vertices.length > 0) {
      return vertices[0].x;
    }
    return 0;
  });

  const sortedX = [...xCoordinates].sort((a, b) => a - b);
  const minX = sortedX[0];
  const maxX = sortedX[sortedX.length - 1];

  // 2단 문서 판단: x좌표 범위가 충분히 넓고 중간 영역에 필드가 적으면 2단
  const pageWidth = maxX - minX;
  const leftThreshold = minX + pageWidth * 0.4;
  const rightThreshold = minX + pageWidth * 0.6;

  const leftCount = xCoordinates.filter((x: number) => x < leftThreshold).length;
  const rightCount = xCoordinates.filter((x: number) => x > rightThreshold).length;
  const middleCount = xCoordinates.filter(
    (x: number) => x >= leftThreshold && x <= rightThreshold
  ).length;

  // 2단 판정: 좌/우 모두 10개 이상, 중간이 전체의 20% 미만
  const isTwoColumn =
    leftCount >= 10 &&
    rightCount >= 10 &&
    middleCount < fields.length * 0.2;

  // 필드에 좌표 정보 추가 (너비 포함)
  const fieldsWithCoords = fields.map((f: any) => {
    const vertices = f.boundingPoly?.vertices || [];
    const x = vertices[0]?.x || 0;
    const y = vertices[0]?.y || 0;
    // 우측 상단 x좌표로 너비 계산 (vertices: 좌상, 우상, 우하, 좌하)
    const x2 = vertices[1]?.x || vertices[2]?.x || x;
    const width = x2 - x;
    return { ...f, _x: x, _y: y, _width: width };
  });

  let sortedFields;

  if (isTwoColumn) {
    // 2단: x좌표 중간점 기준으로 좌/우 분리
    const columnDivider = minX + pageWidth * 0.5;

    const leftFields = fieldsWithCoords
      .filter((f: any) => f._x < columnDivider)
      .sort((a: any, b: any) => a._y - b._y);

    const rightFields = fieldsWithCoords
      .filter((f: any) => f._x >= columnDivider)
      .sort((a: any, b: any) => a._y - b._y);

    // 좌측 먼저, 그 다음 우측
    sortedFields = [...leftFields, ...rightFields];
  } else {
    // 1단: y좌표 순서로 정렬
    sortedFields = fieldsWithCoords.sort((a: any, b: any) => {
      // y가 비슷하면 (20px 이내) x로 정렬
      if (Math.abs(a._y - b._y) < 20) {
        return a._x - b._x;
      }
      return a._y - b._y;
    });
  }

  // 텍스트 추출 (정렬된 필드 사용)
  // 영어 단어 판별 함수 (영어 단어 사이에는 공백 필요)
  const isEnglishWord = (text: string) => /^[a-zA-Z]+$/.test(text);

  const lines: string[] = [];
  let currentLine = "";
  let lastY = -1;
  let lastX = -1;
  let lastWidth = 0;
  let lastText = "";
  const LINE_THRESHOLD = 15; // y좌표 차이가 이 값 이상이면 새 줄

  for (const field of sortedFields) {
    const text = field.inferText || "";
    const lineBreak = field.lineBreak || false;
    const y = field._y;
    const x = field._x;
    const width = field._width || 0;

    // y좌표가 크게 변하면 새 줄 시작 (2단에서 단 전환 시에도 적용)
    if (lastY !== -1 && Math.abs(y - lastY) > LINE_THRESHOLD && currentLine.trim()) {
      lines.push(currentLine.trim());
      currentLine = "";
      lastX = -1;
    }

    // 공백 추가 여부 결정
    let needsSpace = false;
    if (currentLine.length > 0 && lastX !== -1) {
      const gap = x - (lastX + lastWidth); // 이전 필드와의 간격
      const avgCharWidth = lastWidth / Math.max(lastText.length, 1);

      // 간격이 평균 문자 너비의 0.5배 이상이면 공백 추가
      if (gap > avgCharWidth * 0.5) {
        needsSpace = true;
      }
      // 영어 단어 사이에는 항상 공백
      else if (isEnglishWord(lastText) && isEnglishWord(text)) {
        needsSpace = true;
      }
    }

    if (needsSpace) {
      currentLine += " ";
    }

    currentLine += text;
    lastY = y;
    lastX = x;
    lastWidth = width;
    lastText = text;

    if (lineBreak) {
      lines.push(currentLine.trim());
      currentLine = "";
      lastY = -1;
      lastX = -1;
    }
  }

  // 마지막 줄 처리
  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return {
    text: lines.join("\n"),
    fields: fields as OcrField[],
  };
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
    secrets: [CLOVA_OCR_API_KEY, GEMINI_API_KEY],
    memory: "512MiB",
    timeoutSeconds: 120,  // Gemini 전처리 시간 고려
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { image, debug = false } = request.data as {
      image: string;
      debug?: boolean; // 디버그 모드: 오버레이 정보 포함
    };

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
      const ocrResult = await callClovaOcr(image, apiKey);

      // 문제지 파싱 V4 (Gemini 전처리 + 단순 파서) - 메인!
      let parsedV4: ParseResultV4 | null = null;
      const geminiKey = GEMINI_API_KEY.value();

      if (ocrResult.text && geminiKey) {
        try {
          parsedV4 = await parseQuestionsV4(ocrResult.text, geminiKey);
        } catch (parseError: any) {
          console.error("[V4] 파싱 오류:", parseError?.message || parseError);
        }
      }

      // 문제지 파싱 V3 (폴백용 - 좌표 기반)
      let parsedV3: ParseResultV3 | null = null;
      if (ocrResult.fields.length > 0) {
        try {
          parsedV3 = parseQuestionsV3(ocrResult.fields as ClovaFieldV3[]);
        } catch (parseError) {
          console.error("문제 파싱 V3 오류:", parseError);
        }
      }

      // 문제지 파싱 V2 (기존 파서 - 하위 호환)
      let parsedV2: ParseResultV2 | null = null;
      if (ocrResult.fields.length > 0) {
        try {
          parsedV2 = parseQuestionsV2(ocrResult.fields as ClovaField[]);
        } catch (parseError) {
          console.error("문제 파싱 V2 오류:", parseError);
        }
      }

      // 기존 파서 (하위 호환)
      let parsedQuestions: ParseResult | null = null;
      if (ocrResult.fields.length > 0) {
        try {
          parsedQuestions = parseQuestions(ocrResult.fields, {
            includeAutoCrop: true,
            includeDebugOverlays: debug,
          });
        } catch (parseError) {
          console.error("문제 파싱 오류:", parseError);
        }
      }

      // 사용량 증가
      const newUsage = await incrementUsage();

      console.log(`OCR 완료 (사용량: ${newUsage}/${MONTHLY_LIMIT})`);

      return {
        success: true,
        text: ocrResult.text,
        fields: ocrResult.fields,
        parsed: parsedQuestions,
        parsedV2: parsedV2,  // 기존 파서
        parsedV3: parsedV3,  // 좌표 기반 파서 (폴백)
        parsedV4: parsedV4,  // Gemini 전처리 파서 (메인!)
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
