/**
 * 퀴즈 이미지 업로드 유틸리티
 *
 * base64 이미지를 Firebase Storage에 업로드하고,
 * 퀴즈 데이터 내의 base64 이미지를 Storage URL로 변환합니다.
 */

import { upload as storageUpload } from '@/lib/repositories/firebase/storageRepo';
import { compressImage, formatFileSize } from '@/lib/imageUtils';

/**
 * base64 이미지를 Firebase Storage에 업로드
 */
export async function uploadBase64ToStorage(
  base64: string,
  userId: string,
  debugPath: string
): Promise<string | null> {
  try {
    console.log(`[이미지 업로드 시작] ${debugPath}`);

    const matches = base64.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      console.error(`[실패] ${debugPath}: 잘못된 base64 형식`);
      return null;
    }

    const extension = matches[1];
    const data = matches[2];

    const byteCharacters = atob(data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const originalBlob = new Blob([byteArray], { type: `image/${extension}` });

    console.log(`[원본 크기] ${debugPath}: ${formatFileSize(originalBlob.size)}`);

    let finalBlob: Blob = originalBlob;
    let finalExtension = extension;

    try {
      const compressionResult = await compressImage(originalBlob, {
        maxWidth: 1920,
        maxHeight: 1080,
        quality: 0.85,
        maxSizeBytes: 800 * 1024,
        outputType: 'image/jpeg',
      });

      finalBlob = compressionResult.blob;
      finalExtension = 'jpg';

      console.log(`[압축 완료] ${debugPath}: ${formatFileSize(compressionResult.originalSize)} → ${formatFileSize(compressionResult.compressedSize)} (${compressionResult.compressionRatio}% 절감)`);
    } catch (compressErr) {
      console.warn(`[압축 실패] ${debugPath}: 원본 사용`, compressErr);
    }

    if (finalBlob.size > 5 * 1024 * 1024) {
      console.error(`[실패] ${debugPath}: 파일 크기 초과 (${formatFileSize(finalBlob.size)} > 5MB)`);
      throw new Error(`이미지 크기가 너무 큽니다: ${formatFileSize(finalBlob.size)}. 5MB 이하로 줄여주세요.`);
    }

    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const storagePath = `quiz-images/${userId}/${timestamp}_${randomStr}.${finalExtension}`;

    console.log(`[업로드 중] ${debugPath}: ${formatFileSize(finalBlob.size)}`);

    const downloadUrl = await storageUpload(storagePath, finalBlob);

    console.log(`[성공] ${debugPath}: 이미지 업로드 완료 - ${downloadUrl.substring(0, 80)}...`);
    return downloadUrl;
  } catch (err: unknown) {
    console.error(`[실패] ${debugPath}: 이미지 업로드 실패`);
    console.error(`  - 에러: ${(err as Error)?.message || String(err)}`);
    return null;
  }
}

/**
 * 퀴즈 데이터 내 base64 이미지를 Storage URL로 변환
 */
export async function processQuizImages(
  quizData: Record<string, any>,
  userId: string
): Promise<Record<string, any>> {
  if (quizData.questions && Array.isArray(quizData.questions)) {
    for (let i = 0; i < quizData.questions.length; i++) {
      const q = quizData.questions[i];

      if (q.imageUrl && typeof q.imageUrl === 'string' && q.imageUrl.startsWith('data:image/')) {
        const url = await uploadBase64ToStorage(q.imageUrl, userId, `questions[${i}].imageUrl`);
        quizData.questions[i].imageUrl = url;
      }

      if (q.passageImage && typeof q.passageImage === 'string' && q.passageImage.startsWith('data:image/')) {
        const url = await uploadBase64ToStorage(q.passageImage, userId, `questions[${i}].passageImage`);
        quizData.questions[i].passageImage = url;
      }
    }
  }

  return quizData;
}

/**
 * Firestore 호환성을 위한 데이터 정리 (중첩 배열, base64 잔여물 제거)
 */
export function sanitizeForFirestore(data: unknown, path: string = ''): unknown {
  if (data === null || data === undefined) return null;

  if (typeof data === 'string') {
    if (data.startsWith('data:image/')) {
      console.warn(`[경고] ${path}: 업로드되지 않은 base64 이미지 발견 - null로 대체`);
      return null;
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined && item !== null)
      .map((item, idx) => {
        if (Array.isArray(item)) {
          return item.filter(i => i != null).join(', ');
        }
        return sanitizeForFirestore(item, `${path}[${idx}]`);
      });
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(data as Record<string, unknown>)) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== undefined) {
        sanitized[key] = sanitizeForFirestore(value, path ? `${path}.${key}` : key);
      }
    }
    return sanitized;
  }

  return data;
}
