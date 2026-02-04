/**
 * CLOVA OCR 훅
 *
 * Naver CLOVA OCR Cloud Function을 호출하여 이미지에서 텍스트를 추출합니다.
 */

import { useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

export interface OcrUsage {
  used: number;
  limit: number;
  remaining: number;
}

export interface OcrResult {
  success: boolean;
  text: string;
  usage: OcrUsage;
}

export interface UseClovaOcrReturn {
  /** OCR 실행 */
  runOcr: (imageBase64: string) => Promise<OcrResult>;
  /** 사용량 조회 */
  getUsage: () => Promise<OcrUsage>;
  /** 로딩 상태 */
  isLoading: boolean;
  /** 에러 메시지 */
  error: string | null;
  /** 진행률 (0-100) */
  progress: number;
  /** 상태 메시지 */
  statusMessage: string;
}

/**
 * CLOVA OCR 훅
 */
export function useClovaOcr(): UseClovaOcrReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');

  /**
   * 사용량 조회
   */
  const getUsage = useCallback(async (): Promise<OcrUsage> => {
    const getOcrUsage = httpsCallable<void, OcrUsage>(functions, 'getOcrUsage');
    const result = await getOcrUsage();
    return result.data;
  }, []);

  /**
   * OCR 실행
   */
  const runOcr = useCallback(async (imageBase64: string): Promise<OcrResult> => {
    setIsLoading(true);
    setError(null);
    setProgress(0);
    setStatusMessage('OCR 준비 중...');

    try {
      // 진행 상태 시뮬레이션
      setProgress(10);
      setStatusMessage('이미지 전송 중...');

      const runClovaOcr = httpsCallable<{ image: string }, OcrResult>(
        functions,
        'runClovaOcr'
      );

      setProgress(30);
      setStatusMessage('텍스트 인식 중...');

      const result = await runClovaOcr({ image: imageBase64 });

      setProgress(100);
      setStatusMessage('완료!');

      return result.data;
    } catch (err: any) {
      console.error('CLOVA OCR 오류:', err);

      // Firebase Functions 에러 처리
      let errorMessage = 'OCR 처리 중 오류가 발생했습니다.';

      if (err.code === 'functions/resource-exhausted') {
        errorMessage = err.message || '이번 달 OCR 사용량을 초과했습니다.';
      } else if (err.code === 'functions/failed-precondition') {
        errorMessage = 'OCR 서비스가 설정되지 않았습니다.';
      } else if (err.code === 'functions/unauthenticated') {
        errorMessage = '로그인이 필요합니다.';
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
    progress,
    statusMessage,
  };
}
