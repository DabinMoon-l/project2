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
 * Firestore/localStorage 호환성을 위한 범용 데이터 정리 유틸리티
 *
 * 처리 항목:
 * - undefined, null → null 변환
 * - base64 이미지 문자열 → null (업로드 누락 감지)
 * - File, Blob, 함수 → null (직렬화 불가)
 * - Firestore Timestamp / Date → Timestamp 변환
 * - Timestamp-like 객체 ({seconds, nanoseconds}) → Timestamp 변환
 * - Map → Object, Set → Array 변환
 * - 중첩 배열 → 쉼표 구분 문자열로 평탄화 (Firestore 제한)
 * - 비순수 객체 (커스텀 클래스 등) → null
 * - 빈 객체 → null
 * - 무한 재귀 방지 (깊이 20 제한)
 */
export function sanitizeForFirestore(data: unknown, path: string = '', depth: number = 0): unknown {
  // 무한 재귀 방지
  if (depth > 20) return null;

  if (data === null || data === undefined) return null;

  // 원시 타입 (string은 base64 검사 필요)
  if (typeof data === 'string') {
    if (data.startsWith('data:image/')) {
      console.warn(`[경고] ${path}: 업로드되지 않은 base64 이미지 발견 - null로 대체`);
      return null;
    }
    return data;
  }
  if (typeof data === 'number' || typeof data === 'boolean') return data;

  // 직렬화 불가능한 타입 제거
  if (typeof data === 'function') return null;
  if (typeof File !== 'undefined' && data instanceof File) return null;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return null;

  // Firestore Timestamp 유지
  if (isTimestamp(data)) return data;

  // Date → Timestamp 변환
  if (data instanceof Date) {
    return dateToTimestamp(data);
  }

  // Timestamp-like 객체 ({seconds, nanoseconds}) 변환
  if (isTimestampLike(data)) {
    return timestampLikeToTimestamp(data);
  }

  // 배열 처리 (null/undefined 필터 + 중첩 배열 평탄화)
  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined && item !== null)
      .map((item, idx) => {
        // 중첩 배열 → 쉼표 구분 문자열 (Firestore는 중첩 배열 비허용)
        if (Array.isArray(item)) {
          return item.filter(i => i != null).join(', ');
        }
        return sanitizeForFirestore(item, `${path}[${idx}]`, depth + 1);
      })
      .filter(item => item !== undefined);
  }

  // 객체 처리
  if (typeof data === 'object') {
    const o = data as Record<string, unknown>;

    // Map/Set 변환
    if (data instanceof Map) return sanitizeForFirestore(Object.fromEntries(data), path, depth + 1);
    if (data instanceof Set) return sanitizeForFirestore(Array.from(data), path, depth + 1);

    // 비순수 객체 (커스텀 클래스 인스턴스 등) 제거
    if (o.constructor && o.constructor !== Object && o.constructor.name !== 'Object') {
      return null;
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(o)) {
      if (value !== undefined) {
        const sanitizedValue = sanitizeForFirestore(value, path ? `${path}.${key}` : key, depth + 1);
        if (sanitizedValue !== undefined) {
          result[key] = sanitizedValue;
        }
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  return data;
}

// --- Timestamp 헬퍼 (동적 import 없이 런타임 감지) ---

/** Firestore Timestamp 인스턴스인지 확인 */
function isTimestamp(obj: unknown): boolean {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'toDate' in (obj as Record<string, unknown>) &&
    'seconds' in (obj as Record<string, unknown>) &&
    'nanoseconds' in (obj as Record<string, unknown>)
  );
}

/** Timestamp-like 평문 객체인지 확인 ({seconds, nanoseconds} 2개 키만) */
function isTimestampLike(obj: unknown): obj is { seconds: number; nanoseconds: number } {
  if (obj === null || typeof obj !== 'object') return false;
  const keys = Object.keys(obj as Record<string, unknown>);
  return keys.length === 2 && 'seconds' in (obj as Record<string, unknown>) && 'nanoseconds' in (obj as Record<string, unknown>);
}

/** Date → Firestore Timestamp 변환 (런타임에 Timestamp 클래스 사용 가능할 때만) */
function dateToTimestamp(date: Date): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Timestamp } = require('firebase/firestore');
    return Timestamp.fromDate(date);
  } catch {
    return date;
  }
}

/** Timestamp-like 객체 → Firestore Timestamp 변환 */
function timestampLikeToTimestamp(obj: { seconds: number; nanoseconds: number }): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Timestamp } = require('firebase/firestore');
    return new Timestamp(obj.seconds, obj.nanoseconds);
  } catch {
    return null;
  }
}
