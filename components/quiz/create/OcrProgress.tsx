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
  return (
    <div className={`bg-[#F5F0E8] p-6 border-2 border-[#1A1A1A] ${className}`}>
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
          className={`flex-1 h-0.5 ${step === 'parsing' ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'}`}
        />
        <div
          className={`
            w-8 h-8 flex items-center justify-center text-sm font-bold border-2
            ${step === 'parsing'
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
    </div>
  );
}
