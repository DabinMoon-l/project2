/**
 * 이미지 크롭 및 업로드 유틸리티
 *
 * AI 문제 생성 시 학습 자료에서 그림/표/그래프 영역을 크롭하여
 * Firebase Storage에 업로드합니다.
 *
 * HARD 난이도 전용 기능
 */

import { getStorage } from "firebase-admin/storage";
import Jimp from "jimp";
import type { BoundingBox, QuestionImageRegion } from "./imageRegionAnalysis";

// ============================================================
// 타입 정의
// ============================================================

/**
 * 크롭된 이미지 정보
 */
export interface CroppedImage {
  questionNumber: number;
  imageUrl: string;
  description?: string;
}

/**
 * 크롭 결과
 */
export interface CropResult {
  success: boolean;
  images: CroppedImage[];
  error?: string;
}

// ============================================================
// 이미지 크롭 함수
// ============================================================

/**
 * Base64 이미지에서 특정 영역을 크롭
 *
 * @param imageBase64 - Base64 인코딩된 이미지 (data:image/... 또는 순수 base64)
 * @param boundingBox - 크롭할 영역 (0-1 정규화 좌표)
 * @returns 크롭된 이미지의 Buffer
 */
async function cropImage(
  imageBase64: string,
  boundingBox: BoundingBox
): Promise<Buffer> {
  // Base64 데이터에서 헤더 제거
  let base64Data = imageBase64;
  if (imageBase64.startsWith("data:")) {
    const match = imageBase64.match(/^data:[^;]+;base64,(.+)$/);
    if (match) {
      base64Data = match[1];
    }
  }

  // Buffer로 변환
  const imageBuffer = Buffer.from(base64Data, "base64");

  // Jimp으로 이미지 로드
  const image = await Jimp.read(imageBuffer);

  // 원본 이미지 크기
  const width = image.getWidth();
  const height = image.getHeight();

  // 정규화된 좌표를 픽셀 좌표로 변환
  const cropX = Math.round(boundingBox.x * width);
  const cropY = Math.round(boundingBox.y * height);
  const cropWidth = Math.round(boundingBox.width * width);
  const cropHeight = Math.round(boundingBox.height * height);

  // 크롭 영역이 이미지 범위를 벗어나지 않도록 조정
  const safeX = Math.max(0, Math.min(cropX, width - 1));
  const safeY = Math.max(0, Math.min(cropY, height - 1));
  const safeWidth = Math.min(cropWidth, width - safeX);
  const safeHeight = Math.min(cropHeight, height - safeY);

  // 최소 크기 확인
  if (safeWidth < 10 || safeHeight < 10) {
    throw new Error("크롭 영역이 너무 작습니다.");
  }

  // 이미지 크롭
  image.crop(safeX, safeY, safeWidth, safeHeight);

  // JPEG으로 변환하여 Buffer 반환 (품질 85%)
  const croppedBuffer = await image.quality(85).getBufferAsync(Jimp.MIME_JPEG);

  return croppedBuffer;
}

/**
 * 크롭된 이미지를 Firebase Storage에 업로드
 *
 * @param imageBuffer - 이미지 Buffer
 * @param userId - 사용자 ID (폴더 경로용)
 * @param questionNumber - 문제 번호
 * @returns 업로드된 이미지의 공개 URL
 */
async function uploadCroppedImage(
  imageBuffer: Buffer,
  userId: string,
  questionNumber: number
): Promise<string> {
  const bucket = getStorage().bucket();

  // 고유한 파일 이름 생성
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const fileName = `ai-quiz-images/${userId}/${timestamp}_q${questionNumber}_${randomSuffix}.jpg`;

  const file = bucket.file(fileName);

  // 이미지 업로드
  await file.save(imageBuffer, {
    metadata: {
      contentType: "image/jpeg",
      cacheControl: "public, max-age=31536000", // 1년 캐시
    },
  });

  // 공개 URL 생성 (서명 없는 공개 URL)
  await file.makePublic();
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

  return publicUrl;
}

// ============================================================
// 메인 함수
// ============================================================

/**
 * 이미지 영역들을 크롭하여 Firebase Storage에 업로드
 *
 * @param imageBase64 - Base64 인코딩된 원본 이미지
 * @param regions - 크롭할 영역 목록 (imageRegionAnalysis 결과)
 * @param userId - 사용자 ID
 * @returns 크롭된 이미지 URL 목록
 */
export async function cropAndUploadRegions(
  imageBase64: string,
  regions: QuestionImageRegion[],
  userId: string
): Promise<CropResult> {
  if (!regions || regions.length === 0) {
    return { success: true, images: [] };
  }

  const croppedImages: CroppedImage[] = [];
  const errors: string[] = [];

  for (const region of regions) {
    try {
      console.log(`[크롭] 문제 ${region.questionNumber} 영역 크롭 중...`);

      // 이미지 크롭
      const croppedBuffer = await cropImage(imageBase64, region.boundingBox);

      // Firebase Storage 업로드
      const imageUrl = await uploadCroppedImage(
        croppedBuffer,
        userId,
        region.questionNumber
      );

      croppedImages.push({
        questionNumber: region.questionNumber,
        imageUrl,
        description: region.description,
      });

      console.log(`[크롭] 문제 ${region.questionNumber} 완료: ${imageUrl}`);
    } catch (error) {
      const errorMsg = `문제 ${region.questionNumber} 크롭 실패: ${
        error instanceof Error ? error.message : "알 수 없는 오류"
      }`;
      console.error(`[크롭] ${errorMsg}`);
      errors.push(errorMsg);
    }
  }

  return {
    success: croppedImages.length > 0,
    images: croppedImages,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}

/**
 * 여러 이미지에서 영역을 분석하고 크롭하여 업로드
 *
 * @param images - Base64 인코딩된 이미지 배열
 * @param analyzeImageRegions - 이미지 영역 분석 함수
 * @param apiKey - Gemini API 키
 * @param userId - 사용자 ID
 * @returns 모든 크롭된 이미지 목록
 */
export async function processImagesForQuiz(
  images: string[],
  analyzeImageRegions: (
    imageBase64: string,
    apiKey: string
  ) => Promise<{ success: boolean; regions: QuestionImageRegion[]; error?: string }>,
  apiKey: string,
  userId: string
): Promise<CroppedImage[]> {
  const allCroppedImages: CroppedImage[] = [];

  for (let i = 0; i < images.length; i++) {
    const imageBase64 = images[i];

    console.log(`[이미지 처리] ${i + 1}/${images.length} 이미지 분석 중...`);

    // 이미지 영역 분석
    const analysisResult = await analyzeImageRegions(imageBase64, apiKey);

    if (!analysisResult.success || analysisResult.regions.length === 0) {
      console.log(`[이미지 처리] ${i + 1}번 이미지: 시각 자료 영역 없음`);
      continue;
    }

    console.log(
      `[이미지 처리] ${i + 1}번 이미지: ${analysisResult.regions.length}개 영역 발견`
    );

    // 크롭 및 업로드
    const cropResult = await cropAndUploadRegions(
      imageBase64,
      analysisResult.regions,
      userId
    );

    if (cropResult.success) {
      allCroppedImages.push(...cropResult.images);
    }
  }

  console.log(`[이미지 처리] 총 ${allCroppedImages.length}개 이미지 크롭 완료`);

  return allCroppedImages;
}
