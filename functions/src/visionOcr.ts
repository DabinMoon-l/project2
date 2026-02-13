/**
 * Google Cloud Vision OCR Cloud Function
 *
 * AI 퀴즈 생성용 OCR - Google Cloud Vision API 사용
 * 월 1,000건 무료 (Tesseract.js보다 품질 좋음)
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ImageAnnotatorClient } from "@google-cloud/vision";

// Vision API 클라이언트 (Firebase 서비스 계정 자동 사용)
const visionClient = new ImageAnnotatorClient();

// 월별 사용량 한도
const MONTHLY_LIMIT = 1000;

/**
 * 현재 월의 사용량 조회
 */
async function getMonthlyUsage(): Promise<number> {
  const db = getFirestore();
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const usageDoc = await db.collection("visionOcrUsage").doc(yearMonth).get();

  if (!usageDoc.exists) {
    return 0;
  }

  return usageDoc.data()?.count || 0;
}

// incrementUsage 함수 제거 - 병렬 처리로 일괄 증가 방식으로 변경

/**
 * Vision OCR 사용량 조회 (Callable Function)
 */
export const getVisionOcrUsage = onCall(
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
 * Google Vision OCR 실행 (Callable Function)
 *
 * @param data.images - base64 인코딩된 이미지 배열
 * @returns 추출된 텍스트
 */
// 최대 페이지 수 제한
const MAX_PAGES = 20;

export const runVisionOcr = onCall(
  {
    region: "asia-northeast3",
    memory: "1GiB",
    timeoutSeconds: 180,
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { images } = request.data as { images: string[] };

    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new HttpsError("invalid-argument", "이미지 데이터가 필요합니다.");
    }

    // 최대 페이지 제한
    if (images.length > MAX_PAGES) {
      throw new HttpsError("invalid-argument", `최대 ${MAX_PAGES}페이지까지만 처리할 수 있습니다. 선택: ${images.length}페이지`);
    }

    // 사용량 확인
    const currentUsage = await getMonthlyUsage();
    const requiredCount = images.length;

    if (currentUsage + requiredCount > MONTHLY_LIMIT) {
      throw new HttpsError(
        "resource-exhausted",
        `이번 달 Vision OCR 사용량(${MONTHLY_LIMIT}건)을 초과합니다. 남은 횟수: ${MONTHLY_LIMIT - currentUsage}건`
      );
    }

    try {
      // 병렬로 모든 이미지 OCR 처리 (성능 개선)
      const ocrPromises = images.map(async (imageBase64, index) => {
        // base64 데이터 URL에서 실제 데이터만 추출
        const base64Data = imageBase64.includes(",")
          ? imageBase64.split(",")[1]
          : imageBase64;

        // Vision API 호출
        const [result] = await visionClient.textDetection({
          image: { content: base64Data },
        });

        const detections = result.textAnnotations;

        if (detections && detections.length > 0) {
          // 첫 번째 항목이 전체 텍스트
          const fullText = detections[0].description || "";
          return { index, text: `[이미지 ${index + 1}]\n${fullText}` };
        }
        return { index, text: "" };
      });

      // 모든 OCR 동시 실행
      const results = await Promise.all(ocrPromises);

      // 원래 순서대로 정렬
      results.sort((a, b) => a.index - b.index);
      const allTexts = results.map(r => r.text).filter(t => t);

      // 사용량 일괄 증가 (이미지 수만큼)
      const db = getFirestore();
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const usageRef = db.collection("visionOcrUsage").doc(yearMonth);

      await usageRef.set(
        {
          count: FieldValue.increment(images.length),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const combinedText = allTexts.join("\n\n");
      const newUsage = currentUsage + images.length;

      console.log(`Vision OCR 완료: ${images.length}장 처리 (사용량: ${newUsage}/${MONTHLY_LIMIT})`);

      return {
        success: true,
        text: combinedText,
        processedCount: images.length,
        usage: {
          used: newUsage,
          limit: MONTHLY_LIMIT,
          remaining: MONTHLY_LIMIT - newUsage,
        },
      };
    } catch (error) {
      console.error("Vision OCR 처리 오류:", error);
      throw new HttpsError(
        "internal",
        error instanceof Error ? error.message : "OCR 처리 중 오류가 발생했습니다."
      );
    }
  }
);
