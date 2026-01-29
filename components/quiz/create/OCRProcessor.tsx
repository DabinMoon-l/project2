'use client';

import { useState, useEffect, useCallback } from 'react';
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
  className = '',
}: OCRProcessorProps) {
  // 상태
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<OCRProgress | null>(null);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [step, setStep] = useState<'idle' | 'ocr' | 'parsing' | 'review'>('idle');

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
    if (file) {
      processFile(file);
    } else {
      // 파일이 없으면 상태 초기화
      setIsProcessing(false);
      setProgress(null);
      setOcrResult(null);
      setParseResult(null);
      setStep('idle');
    }
  }, [file]);

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
          result = await extractTextFromImage(targetFile, setProgress);
        } else if (isPDFFile(targetFile)) {
          // PDF 파일 처리
          result = await extractTextFromPDF(targetFile, setProgress);
        } else {
          throw new Error('지원하지 않는 파일 형식입니다.');
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
        const errorMessage =
          error instanceof Error ? error.message : 'OCR 처리 중 오류가 발생했습니다.';
        console.error('OCR 처리 오류:', error);
        onError?.(errorMessage);
        setStep('idle');
      } finally {
        setIsProcessing(false);
      }
    },
    [onComplete, onError]
  );

  /**
   * 진행률 바 색상
   */
  const getProgressColor = () => {
    if (!progress) return 'bg-gray-300';
    if (progress.progress < 30) return 'bg-yellow-500';
    if (progress.progress < 70) return 'bg-blue-500';
    return 'bg-green-500';
  };

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
            className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100"
          >
            {/* 단계 표시 */}
            <div className="flex items-center gap-2 mb-4">
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium
                  ${step === 'ocr' ? 'bg-indigo-500' : 'bg-gray-300'}
                `}
              >
                1
              </div>
              <div
                className={`flex-1 h-1 ${step === 'parsing' || step === 'review' ? 'bg-indigo-500' : 'bg-gray-200'}`}
              />
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium
                  ${step === 'parsing' ? 'bg-indigo-500' : step === 'review' ? 'bg-green-500' : 'bg-gray-300'}
                `}
              >
                2
              </div>
            </div>

            {/* 현재 상태 */}
            <div className="text-center mb-4">
              <p className="text-lg font-semibold text-gray-800">
                {step === 'ocr' ? '텍스트 추출 중' : '문제 분석 중'}
              </p>
              <p className="text-sm text-gray-500 mt-1">{progress.status}</p>
            </div>

            {/* 진행률 바 */}
            <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress.progress}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className={`absolute left-0 top-0 h-full rounded-full ${getProgressColor()}`}
              />
            </div>

            {/* 진행률 퍼센트 */}
            <p className="text-center text-sm text-gray-600 mt-2">
              {Math.round(progress.progress)}%
            </p>
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
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">OCR 인식 신뢰도</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          ocrResult.confidence >= 80
                            ? 'bg-green-500'
                            : ocrResult.confidence >= 60
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                        }`}
                        style={{ width: `${ocrResult.confidence}%` }}
                      />
                    </div>
                    <span
                      className={`text-sm font-medium ${
                        ocrResult.confidence >= 80
                          ? 'text-green-600'
                          : ocrResult.confidence >= 60
                            ? 'text-yellow-600'
                            : 'text-red-600'
                      }`}
                    >
                      {Math.round(ocrResult.confidence)}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* 결과 메시지 */}
            <div
              className={`
                p-4 rounded-2xl
                ${parseResult.success ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}
              `}
            >
              <div className="flex items-start gap-3">
                {parseResult.success ? (
                  <svg
                    className="w-6 h-6 text-green-500 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-6 h-6 text-amber-500 flex-shrink-0"
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
                    className={`font-medium ${parseResult.success ? 'text-green-700' : 'text-amber-700'}`}
                  >
                    {parseResult.message}
                  </p>
                  {parseResult.questions.length > 0 && (
                    <p className="text-sm text-gray-600 mt-1">
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
    <div className="bg-gray-50 rounded-2xl overflow-hidden border border-gray-100">
      {/* 헤더 */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="
          w-full flex items-center justify-between
          px-4 py-3
          text-left text-sm font-medium text-gray-700
          hover:bg-gray-100
          transition-colors
        "
      >
        <span>추출된 원본 텍스트</span>
        <motion.svg
          animate={{ rotate: isExpanded ? 180 : 0 }}
          className="w-5 h-5 text-gray-400"
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
              <pre className="whitespace-pre-wrap text-sm text-gray-600 bg-white p-3 rounded-xl border border-gray-200 max-h-60 overflow-y-auto">
                {rawText}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
