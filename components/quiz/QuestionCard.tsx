'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';

/**
 * 문제 타입
 * - ox: OX 문제
 * - multiple: 객관식
 * - short: 주관식 (단답형)
 * - short_answer: 단답형 (별칭)
 * - essay: 서술형
 * - combined: 결합형
 */
export type QuestionType = 'ox' | 'multiple' | 'short' | 'short_answer' | 'essay' | 'combined';

/**
 * 보기 타입 ('text': 텍스트 박스 형식, 'labeled': ㄱ.ㄴ.ㄷ. 형식)
 */
export type ExamplesType = 'text' | 'labeled';

/**
 * 보기 데이터
 */
export interface ExamplesData {
  /** 보기 유형 */
  type: ExamplesType;
  /** 보기 항목들 */
  items: string[];
}

/**
 * 하위 문제 타입 (결합형용)
 */
export interface SubQuestion {
  /** 하위 문제 ID */
  id: string;
  /** 하위 문제 텍스트 */
  text: string;
  /** 문제 유형 */
  type: 'ox' | 'multiple' | 'short_answer';
  /** 객관식 선지 */
  choices?: string[];
  /** 정답 인덱스 (OX/객관식) */
  answerIndex?: number;
  /** 복수정답 인덱스 배열 */
  answerIndices?: number[];
  /** 단답형 정답 */
  answerText?: string;
  /** 보기 데이터 */
  examples?: ExamplesData;
  /** 이미지 URL */
  imageUrl?: string;
}

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
  /** 보기 데이터 (선택) */
  examples?: ExamplesData;
  /** 복수정답 여부 */
  hasMultipleAnswers?: boolean;
  /** 결합형: 공통 지문 타입 */
  passageType?: 'text' | 'korean_abc';
  /** 결합형: 공통 지문 */
  passage?: string;
  /** 결합형: 공통 이미지 */
  passageImage?: string;
  /** 결합형: ㄱㄴㄷ 보기 항목 */
  koreanAbcItems?: string[];
  /** 결합형: 하위 문제 목록 (레거시 지원) */
  subQuestions?: SubQuestion[];
  /** 결합형 그룹 ID (같은 그룹의 문제들을 묶음) */
  combinedGroupId?: string;
  /** 결합형 그룹 내 순서 (0부터 시작) */
  combinedIndex?: number;
  /** 결합형 그룹 내 총 문제 수 */
  combinedTotal?: number;
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
    short_answer: '단답형',
    essay: '서술형',
    combined: '결합형',
  };

  // 보기에 유효한 항목이 있는지 확인
  const hasValidExamples = question.examples &&
    question.examples.items &&
    question.examples.items.some(item => item.trim());

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-5"
    >
      {/* 문제 번호 및 유형 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg font-bold text-[#1A1A1A]">
          Q{question.number}.
        </span>
        <span className="px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold">
          {typeLabels[question.type]}
        </span>
        {/* 복수정답 표시 */}
        {question.hasMultipleAnswers && (
          <span className="px-2 py-0.5 bg-[#1A6B1A] text-[#F5F0E8] text-xs font-bold">
            복수정답
          </span>
        )}
      </div>

      {/* 문제 텍스트 */}
      <p className="text-[#1A1A1A] text-base leading-relaxed whitespace-pre-wrap">
        {question.text}
      </p>

      {/* 문제 이미지 (첨부 시) */}
      {question.imageUrl && (
        <div className="mt-4 relative w-full aspect-video overflow-hidden bg-[#EDEAE4] border border-[#1A1A1A]">
          {question.imageUrl.startsWith('data:') ? (
            // Base64 이미지인 경우 일반 img 태그 사용
            <img
              src={question.imageUrl}
              alt={`문제 ${question.number} 이미지`}
              className="w-full h-full object-contain"
            />
          ) : (
            // URL인 경우 Next.js Image 사용
            <Image
              src={question.imageUrl}
              alt={`문제 ${question.number} 이미지`}
              fill
              className="object-contain"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          )}
        </div>
      )}

      {/* 보기 (Examples) - 일반 문제용 */}
      {hasValidExamples && (
        <div className="mt-4">
          {question.examples!.type === 'text' ? (
            // 텍스트 박스 형식
            <div className="p-4 bg-[#EDEAE4] border border-[#1A1A1A]">
              <p className="text-[#1A1A1A] text-sm leading-relaxed">
                {question.examples!.items.filter(i => i.trim()).join(', ')}
              </p>
            </div>
          ) : (
            // ㄱ.ㄴ.ㄷ. 형식
            <div className="p-4 bg-[#EDEAE4] border border-[#1A1A1A] space-y-2">
              {question.examples!.items.filter(i => i.trim()).map((item, idx) => (
                <p key={idx} className="text-[#1A1A1A] text-sm">
                  <span className="font-bold text-[#1A1A1A] mr-1">
                    {['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ'][idx]}.
                  </span>
                  {item}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 결합형 문제인데 하위 문제/선지가 없는 경우 안내 */}
      {question.type === 'combined' && !question.choices && (
        <div className="mt-4 p-4 bg-[#FFF8E1] border border-[#8B6914] text-sm text-[#8B6914]">
          ⚠️ 이 결합형 문제는 하위 문제가 설정되지 않았습니다.
        </div>
      )}

      {/* 결합형: 공통 지문 (passage, koreanAbcItems, passageImage 중 하나라도 있으면 표시) */}
      {(question.passage || question.passageImage || (question.koreanAbcItems && question.koreanAbcItems.length > 0)) && (
        <div className="mt-4 space-y-3">
          {/* 공통 지문 - 텍스트 형식 (passageType이 없거나 'text'일 때) */}
          {question.passage && (!question.passageType || question.passageType === 'text') && (
            <div className="p-4 bg-[#EDEAE4] border border-[#1A1A1A]">
              <p className="text-xs text-[#5C5C5C] mb-2 font-bold">공통 지문</p>
              <p className="text-[#1A1A1A] text-sm leading-relaxed whitespace-pre-wrap">
                {question.passage}
              </p>
            </div>
          )}

          {/* 공통 지문 - ㄱㄴㄷ 형식 */}
          {question.passageType === 'korean_abc' && question.koreanAbcItems && question.koreanAbcItems.length > 0 && (
            <div className="p-4 bg-[#EDEAE4] border border-[#1A1A1A] space-y-2">
              <p className="text-xs text-[#5C5C5C] mb-2 font-bold">보기</p>
              {question.koreanAbcItems.filter(i => i.trim()).map((item, idx) => (
                <p key={idx} className="text-[#1A1A1A] text-sm">
                  <span className="font-bold text-[#1A1A1A] mr-1">
                    {['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'][idx]}.
                  </span>
                  {item}
                </p>
              ))}
            </div>
          )}

          {/* 공통 이미지 */}
          {question.passageImage && (
            <div className="relative w-full aspect-video overflow-hidden bg-[#EDEAE4] border border-[#1A1A1A]">
              <p className="absolute top-2 left-2 text-xs text-[#5C5C5C] font-bold bg-[#EDEAE4]/80 px-2 py-0.5 z-10">공통 이미지</p>
              {question.passageImage.startsWith('data:') ? (
                <img
                  src={question.passageImage}
                  alt="공통 이미지"
                  className="w-full h-full object-contain"
                />
              ) : (
                <Image
                  src={question.passageImage}
                  alt="공통 이미지"
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
              )}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
