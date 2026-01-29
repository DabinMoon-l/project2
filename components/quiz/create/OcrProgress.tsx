'use client';

/**
 * OcrProgress 컴포넌트
 *
 * OCR 처리 진행률을 표시하는 컴포넌트입니다.
 * 별도의 진행률 표시 컴포넌트가 필요한 경우 사용합니다.
 */

import { motion } from 'framer-motion';
import type { OCRProgress } from '@/lib/ocr';

// ============================================================
// 타입 정의
// ============================================================

interface OcrProgressProps {
  /** 진행 상태 */
  progress: OCRProgress;
  /** 현재 단계 (ocr | parsing) */
  step?: 'ocr' | 'parsing';
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * OCR 진행률 표시 컴포넌트
 */
export default function OcrProgress({
  progress,
  step = 'ocr',
  className = '',
}: OcrProgressProps) {
  /**
   * 진행률 바 색상
   */
  const getProgressColor = () => {
    if (progress.progress < 30) return 'bg-yellow-500';
    if (progress.progress < 70) return 'bg-blue-500';
    return 'bg-green-500';
  };

  return (
    <div className={`bg-white rounded-2xl p-6 shadow-sm border border-gray-100 ${className}`}>
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
          className={`flex-1 h-1 ${step === 'parsing' ? 'bg-indigo-500' : 'bg-gray-200'}`}
        />
        <div
          className={`
            w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium
            ${step === 'parsing' ? 'bg-indigo-500' : 'bg-gray-300'}
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
    </div>
  );
}
