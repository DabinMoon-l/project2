/**
 * Google Cloud Vision OCR 훅
 *
 * AI 퀴즈 생성용 OCR - Google Cloud Vision API 사용
 * 월 1,000건 무료 (Tesseract.js보다 품질 좋음)
 */

import { useState, useCallback, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

export interface VisionOcrUsage {
  used: number;
  limit: number;
  remaining: number;
}

export interface VisionOcrResult {
  success: boolean;
  text: string;
  processedCount: number;
  usage: VisionOcrUsage;
}

export interface UseVisionOcrReturn {
  /** 여러 이미지 OCR 실행 */
  runOcr: (images: string[]) => Promise<VisionOcrResult>;
  /** 사용량 조회 */
  getUsage: () => Promise<VisionOcrUsage>;
  /** 로딩 상태 */
  isLoading: boolean;
  /** 에러 메시지 */
  error: string | null;
  /** 진행률 메시지 */
  progressMessage: string;
  /** 취소 함수 */
  cancel: () => void;
  /** 취소 여부 */
  isCancelled: boolean;
}

/**
 * Google Cloud Vision OCR 훅
 */
export function useVisionOcr(): UseVisionOcrReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState('');
  const [isCancelled, setIsCancelled] = useState(false);
  const cancelledRef = useRef(false);

  /**
   * 취소
   */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setIsCancelled(true);
    setIsLoading(false);
    setProgressMessage('');
  }, []);

  /**
   * 사용량 조회
   */
  const getUsage = useCallback(async (): Promise<VisionOcrUsage> => {
    const getVisionOcrUsage = httpsCallable<void, VisionOcrUsage>(
      functions,
      'getVisionOcrUsage'
    );
    const result = await getVisionOcrUsage();
    return result.data;
  }, []);

  /**
   * 여러 이미지 OCR 실행
   */
  const runOcr = useCallback(async (images: string[]): Promise<VisionOcrResult> => {
    setIsLoading(true);
    setError(null);
    setIsCancelled(false);
    cancelledRef.current = false;
    setProgressMessage('OCR 준비 중...');

    try {
      if (images.length === 0) {
        throw new Error('처리할 이미지가 없습니다.');
      }

      // 취소 체크
      if (cancelledRef.current) {
        throw new Error('OCR이 취소되었습니다.');
      }

      setProgressMessage(`${images.length}장의 이미지 전송 중...`);

      const runVisionOcr = httpsCallable<{ images: string[] }, VisionOcrResult>(
        functions,
        'runVisionOcr'
      );

      setProgressMessage(`텍스트 인식 중... (${images.length}장)`);

      const result = await runVisionOcr({ images });

      // 취소 체크
      if (cancelledRef.current) {
        throw new Error('OCR이 취소되었습니다.');
      }

      setProgressMessage('완료!');
      return result.data;
    } catch (err: any) {
      console.error('Vision OCR 오류:', err);

      // 취소된 경우
      if (cancelledRef.current) {
        const cancelError = new Error('OCR이 취소되었습니다.');
        setError(cancelError.message);
        throw cancelError;
      }

      // Firebase Functions 에러 처리
      let errorMessage = 'OCR 처리 중 오류가 발생했습니다.';

      if (err.code === 'functions/resource-exhausted') {
        errorMessage = err.message || '이번 달 Vision OCR 사용량을 초과했습니다.';
      } else if (err.code === 'functions/failed-precondition') {
        errorMessage = 'Vision API가 설정되지 않았습니다.';
      } else if (err.code === 'functions/unauthenticated') {
        errorMessage = '로그인이 필요합니다.';
      } else if (err.code === 'functions/invalid-argument') {
        errorMessage = err.message || '잘못된 이미지 데이터입니다.';
      } else if (err.message) {
        errorMessage = err.message;
      }

      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    runOcr,
    getUsage,
    isLoading,
    error,
    progressMessage,
    cancel,
    isCancelled,
  };
}
