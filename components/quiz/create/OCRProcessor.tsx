'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  extractTextFromImage,
  extractTextFromPDF,
  parseQuestions,
  isImageFile,
  isPDFFile,
  initializeOCRWorker,
  terminateOCRWorker,
  type OCRProgress,
  type OCRResult,
  type ParseResult,
} from '@/lib/ocr';

// ============================================================
// 타입 정의
// ============================================================

interface OCRProcessorProps {
  /** 처리할 파일 */
  file: File | null;
  /** OCR 처리 완료 시 콜백 */
  onComplete: (result: ParseResult) => void;
  /** 에러 발생 시 콜백 */
  onError?: (error: string) => void;
  /** 취소 시 콜백 */
  onCancel?: () => void;
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * OCR 처리 컴포넌트
 *
 * Tesseract.js를 사용하여 이미지/PDF에서 텍스트를 추출하고
 * 문제 형식으로 파싱합니다.
 */
export default function OCRProcessor({
  file,
  onComplete,
  onError,
  onCancel,
  className = '',
}: OCRProcessorProps) {
  // 상태
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<OCRProgress | null>(null);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [step, setStep] = useState<'idle' | 'ocr' | 'parsing' | 'review'>('idle');

  // 취소 플래그
  const isCancelledRef = useRef(false);
  // 현재 처리 중인 파일 추적
  const processedFileRef = useRef<File | null>(null);

  /**
   * OCR 워커 초기화 (컴포넌트 마운트 시)
   */
  useEffect(() => {
    // 워커 사전 초기화 (성능 개선)
    initializeOCRWorker().catch((err) => {
      console.error('OCR Worker 초기화 실패:', err);
    });

    // 컴포넌트 언마운트 시 워커 종료
    return () => {
      terminateOCRWorker().catch(console.error);
    };
  }, []);

  /**
   * 파일 변경 시 OCR 처리 시작
   */
  useEffect(() => {
    if (file && file !== processedFileRef.current) {
      processedFileRef.current = file;
      isCancelledRef.current = false;
      processFile(file);
    } else if (!file) {
      // 파일이 없으면 상태 초기화
      resetState();
    }
  }, [file]);

  /**
   * 상태 초기화
   */
  const resetState = useCallback(() => {
    setIsProcessing(false);
    setProgress(null);
    setOcrResult(null);
    setParseResult(null);
    setStep('idle');
    processedFileRef.current = null;
  }, []);

  /**
   * 취소 핸들러
   */
  const handleCancel = useCallback(() => {
    isCancelledRef.current = true;
    resetState();
    onCancel?.();
  }, [resetState, onCancel]);

  /**
   * 파일 OCR 처리
   */
  const processFile = useCallback(
    async (targetFile: File) => {
      setIsProcessing(true);
      setStep('ocr');
      setProgress({ progress: 0, status: '준비 중...' });

      try {
        let result: OCRResult;

        if (isImageFile(targetFile)) {
          // 이미지 파일 처리
          result = await extractTextFromImage(targetFile, (p) => {
            if (!isCancelledRef.current) {
              setProgress(p);
            }
          });
        } else if (isPDFFile(targetFile)) {
          // PDF 파일 처리
          result = await extractTextFromPDF(targetFile, (p) => {
            if (!isCancelledRef.current) {
              setProgress(p);
            }
          });
        } else {
          throw new Error('지원하지 않는 파일 형식입니다.');
        }

        // 취소된 경우 결과 무시
        if (isCancelledRef.current) {
          return;
        }

        // OCR 에러 확인
        if (result.error) {
          throw new Error(result.error);
        }

        setOcrResult(result);

        // 텍스트가 추출되면 문제 파싱 시도
        if (result.text.trim()) {
          setStep('parsing');
          setProgress({ progress: 0, status: '문제 분석 중...' });

          // 약간의 딜레이 후 파싱 (UI 업데이트를 위해)
          await new Promise((resolve) => setTimeout(resolve, 300));

          if (isCancelledRef.current) {
            return;
          }

          const parsed = parseQuestions(result.text);
          setParseResult(parsed);
          setStep('review');

          // 파싱 결과 전달
          onComplete(parsed);
        } else {
          // 텍스트가 없는 경우
          const emptyResult: ParseResult = {
            questions: [],
            rawText: '',
            success: false,
            message: '텍스트를 추출할 수 없습니다. 이미지 품질을 확인해주세요.',
          };
          setParseResult(emptyResult);
          setStep('review');
          onComplete(emptyResult);
        }
      } catch (error) {
        if (isCancelledRef.current) {
          return;
        }
        const errorMessage =
          error instanceof Error ? error.message : 'OCR 처리 중 오류가 발생했습니다.';
        console.error('OCR 처리 오류:', error);
        onError?.(errorMessage);
        setStep('idle');
      } finally {
        if (!isCancelledRef.current) {
          setIsProcessing(false);
        }
      }
    },
    [onComplete, onError]
  );

  // 파일이 없거나 idle 상태면 렌더링하지 않음
  if (!file && step === 'idle') {
    return null;
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 진행 상태 카드 */}
      <AnimatePresence mode="wait">
        {isProcessing && progress && (
          <motion.div
            key="progress"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-[#F5F0E8] p-6 border-2 border-[#1A1A1A]"
          >
            {/* 단계 표시 */}
            <div className="flex items-center gap-2 mb-4">
              <div
                className={`
                  w-8 h-8 flex items-center justify-center text-sm font-bold border-2
                  ${step === 'ocr'
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C]'
                  }
                `}
              >
                1
              </div>
              <div
                className={`flex-1 h-0.5 ${step === 'parsing' || step === 'review' ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'}`}
              />
              <div
                className={`
                  w-8 h-8 flex items-center justify-center text-sm font-bold border-2
                  ${step === 'parsing'
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : step === 'review'
                      ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                      : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C]'
                  }
                `}
              >
                2
              </div>
            </div>

            {/* 현재 상태 */}
            <div className="text-center mb-4">
              <p className="font-serif-display text-xl font-black text-[#1A1A1A]">
                {step === 'ocr' ? '텍스트 추출 중' : '문제 분석 중'}
              </p>
              <p className="text-sm text-[#5C5C5C] mt-1">{progress.status}</p>
            </div>

            {/* 진행률 바 */}
            <div className="relative h-2 bg-[#EDEAE4] border border-[#1A1A1A] overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress.progress}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="absolute left-0 top-0 h-full bg-[#1A1A1A]"
              />
            </div>

            {/* 진행률 퍼센트 */}
            <p className="text-center text-sm font-bold text-[#1A1A1A] mt-2">
              {Math.round(progress.progress)}%
            </p>

            {/* 취소 버튼 */}
            <button
              type="button"
              onClick={handleCancel}
              className="w-full mt-4 py-2 text-sm font-bold border border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-[#F5F0E8] transition-colors"
            >
              취소
            </button>
          </motion.div>
        )}

        {/* 결과 표시 */}
        {!isProcessing && step === 'review' && parseResult && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            {/* OCR 신뢰도 표시 */}
            {ocrResult && (
              <div className="bg-[#F5F0E8] p-4 border-2 border-[#1A1A1A]">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-[#1A1A1A]">OCR 인식 신뢰도</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-[#EDEAE4] border border-[#1A1A1A] overflow-hidden">
                      <div
                        className="h-full bg-[#1A1A1A]"
                        style={{ width: `${ocrResult.confidence}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-[#1A1A1A]">
                      {Math.round(ocrResult.confidence)}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* 결과 메시지 */}
            <div
              className={`
                p-4 border-2
                ${parseResult.success
                  ? 'bg-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#FFF9E6] border-[#C9A227]'
                }
              `}
            >
              <div className="flex items-start gap-3">
                {parseResult.success ? (
                  <svg
                    className="w-6 h-6 text-[#1A1A1A] flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-6 h-6 text-[#C9A227] flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                <div>
                  <p
                    className={`font-bold ${parseResult.success ? 'text-[#1A1A1A]' : 'text-[#8B6914]'}`}
                  >
                    {parseResult.message}
                  </p>
                  {parseResult.questions.length > 0 && (
                    <p className="text-sm text-[#5C5C5C] mt-1">
                      아래에서 문제를 확인하고 수정할 수 있습니다.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* 추출된 원본 텍스트 토글 */}
            <ExtractedTextView rawText={parseResult.rawText} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// 추출된 텍스트 보기 컴포넌트
// ============================================================

interface ExtractedTextViewProps {
  rawText: string;
}

function ExtractedTextView({ rawText }: ExtractedTextViewProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!rawText.trim()) {
    return null;
  }

  return (
    <div className="bg-[#F5F0E8] overflow-hidden border-2 border-[#1A1A1A]">
      {/* 헤더 */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="
          w-full flex items-center justify-between
          px-4 py-3
          text-left text-sm font-bold text-[#1A1A1A]
          hover:bg-[#EDEAE4]
          transition-colors
        "
      >
        <span>추출된 원본 텍스트</span>
        <motion.svg
          animate={{ rotate: isExpanded ? 180 : 0 }}
          className="w-5 h-5 text-[#1A1A1A]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </motion.svg>
      </button>

      {/* 텍스트 내용 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              <pre className="whitespace-pre-wrap text-sm text-[#1A1A1A] bg-[#EDEAE4] p-3 border border-[#1A1A1A] max-h-60 overflow-y-auto">
                {rawText}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
