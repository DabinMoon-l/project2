'use client';

/**
 * OCR 훅
 *
 * Tesseract.js OCR 처리를 위한 상태 관리 훅입니다.
 * 이미지/PDF 파일에서 텍스트를 추출하고 진행률을 추적합니다.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  extractTextFromImage,
  extractTextFromPDF,
  parseQuestions,
  isImageFile,
  isPDFFile,
  isSupportedFile,
  checkFileSize,
  initializeOCRWorker,
  terminateOCRWorker,
  type OCRProgress,
  type OCRResult,
  type ParseResult,
} from '@/lib/ocr';

// ============================================================
// 타입 정의
// ============================================================

/**
 * OCR 처리 상태
 */
export type OCRStatus = 'idle' | 'initializing' | 'processing' | 'parsing' | 'done' | 'error';

/**
 * useOcr 훅 반환 타입
 */
export interface UseOcrReturn {
  /** 현재 OCR 상태 */
  status: OCRStatus;
  /** 진행률 정보 */
  progress: OCRProgress | null;
  /** OCR 결과 */
  result: OCRResult | null;
  /** 파싱 결과 */
  parseResult: ParseResult | null;
  /** 에러 메시지 */
  error: string | null;
  /** 처리 중 여부 */
  isProcessing: boolean;
  /** 파일 처리 시작 */
  processFile: (file: File) => Promise<void>;
  /** 텍스트 직접 파싱 */
  parseText: (text: string) => ParseResult;
  /** 상태 초기화 */
  reset: () => void;
}

/**
 * useOcr 훅 옵션
 */
export interface UseOcrOptions {
  /** 파일 크기 제한 (MB) */
  maxFileSizeMB?: number;
  /** 자동 워커 초기화 여부 */
  autoInitWorker?: boolean;
  /** 처리 완료 콜백 */
  onComplete?: (result: ParseResult) => void;
  /** 에러 발생 콜백 */
  onError?: (error: string) => void;
}

// ============================================================
// 훅 구현
// ============================================================

/**
 * OCR 처리 훅
 *
 * @param options - 옵션
 * @returns OCR 상태 및 함수들
 *
 * @example
 * ```tsx
 * const { status, progress, processFile, parseResult } = useOcr({
 *   onComplete: (result) => console.log(result),
 *   onError: (error) => console.error(error),
 * });
 *
 * // 파일 처리
 * const handleFileSelect = (file: File) => {
 *   processFile(file);
 * };
 *
 * // 진행률 표시
 * {status === 'processing' && progress && (
 *   <ProgressBar value={progress.progress} />
 * )}
 * ```
 */
export function useOcr(options: UseOcrOptions = {}): UseOcrReturn {
  const {
    maxFileSizeMB = 10,
    autoInitWorker = true,
    onComplete,
    onError,
  } = options;

  // 상태
  const [status, setStatus] = useState<OCRStatus>('idle');
  const [progress, setProgress] = useState<OCRProgress | null>(null);
  const [result, setResult] = useState<OCRResult | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 워커 초기화 여부
  const workerInitialized = useRef(false);

  /**
   * 워커 초기화 (컴포넌트 마운트 시)
   */
  useEffect(() => {
    if (autoInitWorker && !workerInitialized.current) {
      workerInitialized.current = true;
      initializeOCRWorker().catch((err) => {
        console.error('OCR Worker 초기화 실패:', err);
      });
    }

    // 컴포넌트 언마운트 시 워커 종료
    return () => {
      if (workerInitialized.current) {
        terminateOCRWorker().catch(console.error);
        workerInitialized.current = false;
      }
    };
  }, [autoInitWorker]);

  /**
   * 상태 초기화
   */
  const reset = useCallback(() => {
    setStatus('idle');
    setProgress(null);
    setResult(null);
    setParseResult(null);
    setError(null);
  }, []);

  /**
   * 텍스트 직접 파싱
   */
  const parseText = useCallback((text: string): ParseResult => {
    return parseQuestions(text);
  }, []);

  /**
   * 파일 처리
   */
  const processFile = useCallback(
    async (file: File): Promise<void> => {
      // 상태 초기화
      reset();
      setError(null);

      try {
        // 파일 유효성 검사
        if (!isSupportedFile(file)) {
          throw new Error('지원하지 않는 파일 형식입니다. 이미지 또는 PDF 파일만 업로드할 수 있습니다.');
        }

        if (!checkFileSize(file, maxFileSizeMB)) {
          throw new Error(`파일 크기는 ${maxFileSizeMB}MB 이하여야 합니다.`);
        }

        // 워커 초기화 확인
        setStatus('initializing');
        setProgress({ progress: 0, status: 'OCR 엔진 초기화 중...' });

        if (!workerInitialized.current) {
          await initializeOCRWorker();
          workerInitialized.current = true;
        }

        // OCR 처리 시작
        setStatus('processing');
        let ocrResult: OCRResult;

        // 진행 상태 콜백
        const handleProgress = (p: OCRProgress) => {
          setProgress(p);
        };

        if (isImageFile(file)) {
          // 이미지 파일 처리
          ocrResult = await extractTextFromImage(file, handleProgress);
        } else if (isPDFFile(file)) {
          // PDF 파일 처리
          ocrResult = await extractTextFromPDF(file, handleProgress);
        } else {
          throw new Error('지원하지 않는 파일 형식입니다.');
        }

        // OCR 에러 확인
        if (ocrResult.error) {
          throw new Error(ocrResult.error);
        }

        setResult(ocrResult);

        // 텍스트 파싱
        setStatus('parsing');
        setProgress({ progress: 95, status: '문제 분석 중...' });

        // 약간의 딜레이 (UI 업데이트용)
        await new Promise((resolve) => setTimeout(resolve, 200));

        const parsed = parseQuestions(ocrResult.text);
        setParseResult(parsed);

        // 완료
        setStatus('done');
        setProgress({ progress: 100, status: '완료!' });

        // 콜백 호출
        onComplete?.(parsed);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'OCR 처리 중 오류가 발생했습니다.';
        console.error('OCR 처리 오류:', err);

        setStatus('error');
        setError(errorMessage);

        // 에러 콜백 호출
        onError?.(errorMessage);
      }
    },
    [maxFileSizeMB, onComplete, onError, reset]
  );

  return {
    status,
    progress,
    result,
    parseResult,
    error,
    isProcessing: status === 'initializing' || status === 'processing' || status === 'parsing',
    processFile,
    parseText,
    reset,
  };
}

export default useOcr;
