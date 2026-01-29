'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';

/**
 * 문제 타입
 */
export type QuestionType = 'ox' | 'multiple' | 'short';

/**
 * 문제 데이터 타입
 */
export interface Question {
  /** 문제 ID */
  id: string;
  /** 문제 번호 (1부터 시작) */
  number: number;
  /** 문제 유형 */
  type: QuestionType;
  /** 문제 텍스트 */
  text: string;
  /** 문제 이미지 URL (선택) */
  imageUrl?: string;
  /** 객관식 선지 (객관식일 때만) */
  choices?: string[];
}

/**
 * QuestionCard Props 타입
 */
interface QuestionCardProps {
  /** 문제 데이터 */
  question: Question;
}

/**
 * 문제 카드 컴포넌트
 *
 * 문제 번호, 문제 텍스트, 이미지(첨부 시)를 표시합니다.
 *
 * @example
 * ```tsx
 * <QuestionCard
 *   question={{
 *     id: '1',
 *     number: 3,
 *     type: 'multiple',
 *     text: '다음 중 올바른 것은?',
 *     choices: ['선지 1', '선지 2', '선지 3', '선지 4'],
 *   }}
 * />
 * ```
 */
export default function QuestionCard({ question }: QuestionCardProps) {
  // 문제 유형별 라벨
  const typeLabels: Record<QuestionType, string> = {
    ox: 'OX',
    multiple: '객관식',
    short: '주관식',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-white rounded-2xl p-5 shadow-sm"
    >
      {/* 문제 번호 및 유형 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg font-bold text-gray-900">
          Q{question.number}.
        </span>
        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
          {typeLabels[question.type]}
        </span>
      </div>

      {/* 문제 텍스트 */}
      <p className="text-gray-800 text-base leading-relaxed whitespace-pre-wrap">
        {question.text}
      </p>

      {/* 문제 이미지 (첨부 시) */}
      {question.imageUrl && (
        <div className="mt-4 relative w-full aspect-video rounded-xl overflow-hidden bg-gray-100">
          <Image
            src={question.imageUrl}
            alt={`문제 ${question.number} 이미지`}
            fill
            className="object-contain"
            sizes="(max-width: 768px) 100vw, 50vw"
          />
        </div>
      )}
    </motion.div>
  );
}
