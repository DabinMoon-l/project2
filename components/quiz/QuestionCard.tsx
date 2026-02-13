'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import { formatChapterLabel } from '@/lib/courseIndex';

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
 * 라벨이 붙은 항목 (ㄱ.ㄴ.ㄷ. 형식)
 */
export interface LabeledItem {
  label: string;
  content: string;
}

/**
 * 혼합 보기 항목 (텍스트 + ㄱㄴㄷ + (가)(나)(다) + 이미지 + 그룹 혼합 가능)
 * @deprecated 지문(PassageBlock)과 보기(BogiData)로 분리됨
 */
export interface MixedExampleItem {
  id: string;
  type: 'text' | 'labeled' | 'gana' | 'bullet' | 'image' | 'grouped';
  label?: string; // labeled/gana 타입일 때 (ㄱ, ㄴ, ㄷ 또는 가, 나, 다 등)
  content?: string; // text, labeled, gana, bullet 타입
  items?: LabeledItem[]; // labeled/gana/bullet 타입 (다중 항목)
  imageUrl?: string; // image 타입
  children?: MixedExampleItem[]; // grouped 타입
}

/**
 * 보기 데이터 (<보기> 박스 - 객관식/주관식에서만 사용)
 */
export interface BogiData {
  /** 보기 문제 텍스트 */
  questionText: string;
  /** ㄱ.ㄴ.ㄷ. 형식의 보기 항목들 */
  items: LabeledItem[];
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
  /** @deprecated 제시문(mixedExamples)으로 대체됨 */
  examples?: ExamplesData;
  /** 제시문 (혼합 형식) */
  mixedExamples?: MixedExampleItem[];
  /** 제시문 발문 */
  passagePrompt?: string;
  /** 보기 (<보기> 박스 - 객관식/주관식에서만) */
  bogi?: BogiData | null;
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
  /** @deprecated 제시문(mixedExamples)으로 대체됨 */
  examples?: ExamplesData;
  /** 제시문 (혼합 형식 - 텍스트, (가)(나)(다), 이미지, 그룹) */
  mixedExamples?: MixedExampleItem[];
  /** 제시문 발문 */
  passagePrompt?: string;
  /** 보기 (<보기> 박스 - 객관식/주관식에서만) */
  bogi?: BogiData | null;
  /** 복수정답 여부 */
  hasMultipleAnswers?: boolean;
  /** 결합형: 공통 제시문 타입 */
  passageType?: 'text' | 'korean_abc' | 'mixed';
  /** 결합형: 공통 제시문 */
  passage?: string;
  /** 결합형: 공통 이미지 */
  passageImage?: string;
  /** 결합형: ㄱㄴㄷ 보기 항목 */
  koreanAbcItems?: string[];
  /** 결합형: 혼합 보기 항목 (공통 제시문용) */
  passageMixedExamples?: MixedExampleItem[];
  /** 결합형: 하위 문제 목록 (레거시 지원) */
  subQuestions?: SubQuestion[];
  /** 결합형 그룹 ID (같은 그룹의 문제들을 묶음) */
  combinedGroupId?: string;
  /** 결합형 그룹 내 순서 (0부터 시작) */
  combinedIndex?: number;
  /** 결합형 그룹 내 총 문제 수 */
  combinedTotal?: number;
  /** 결합형 공통 문제 텍스트 */
  commonQuestion?: string;
  /** 챕터 ID */
  chapterId?: string;
  /** 챕터 세부항목 ID */
  chapterDetailId?: string;
}

/**
 * QuestionCard Props 타입
 */
interface QuestionCardProps {
  /** 문제 데이터 */
  question: Question;
  /** 과목 ID (챕터 라벨 표시용) */
  courseId?: string;
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
export default function QuestionCard({ question, courseId }: QuestionCardProps) {
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

  // 혼합 보기 항목이 유효한지 확인하는 함수
  const isValidMixedItem = (item: MixedExampleItem): boolean => {
    switch (item.type) {
      case 'text':
        return Boolean(item.content?.trim());
      case 'labeled':
      case 'gana':
      case 'bullet':
        // 단일 content가 있거나 items 배열에 유효한 항목이 있는 경우
        return Boolean(item.content?.trim()) ||
               Boolean(item.items?.some(i => i.content.trim()));
      case 'image':
        return Boolean(item.imageUrl);
      case 'grouped':
        return Boolean(item.children?.length && item.children.some(child => isValidMixedItem(child)));
      default:
        return false;
    }
  };

  // 혼합 보기에 유효한 항목이 있는지 확인
  const hasValidMixedExamples = question.mixedExamples &&
    question.mixedExamples.length > 0 &&
    question.mixedExamples.some(item => isValidMixedItem(item));

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
        {/* 챕터 표시 */}
        {courseId && question.chapterId && (
          <span className="px-2 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-xs font-medium">
            {formatChapterLabel(courseId, question.chapterId, question.chapterDetailId)}
          </span>
        )}
      </div>

      {/* 문제 텍스트 */}
      <p className="text-[#1A1A1A] text-base leading-relaxed whitespace-pre-wrap">
        {question.text}
      </p>

      {/*
        보기 표시 순서: 묶은 보기 → 텍스트박스 단독 → 이미지 → ㄱ.ㄴ.ㄷ.형식 단독
        각 항목은 개별 컨테이너로 표시 (묶인 것만 하나의 박스)
      */}

      {/* 1. 묶은 보기 (grouped) - 먼저 표시 */}
      {hasValidMixedExamples && question.mixedExamples!
        .filter(item => item.type === 'grouped' && isValidMixedItem(item))
        .map((item) => (
          <div key={item.id} className="mt-4 p-4 bg-[#EDEAE4] border-2 border-[#1A1A1A] space-y-2">
            {item.children?.filter(child => isValidMixedItem(child)).map((child) => (
              <div key={child.id}>
                {child.type === 'text' && child.content && (
                  <p className="text-[#5C5C5C] text-sm whitespace-pre-wrap">{child.content}</p>
                )}
                {child.type === 'labeled' && (
                  <>
                    {child.content && (
                      <p className="text-[#1A1A1A] text-sm">
                        <span className="font-bold text-[#1A1A1A] mr-1">{child.label}.</span>
                        {child.content}
                      </p>
                    )}
                    {child.items && child.items.map((labeledItem, idx) => (
                      <p key={idx} className="text-[#1A1A1A] text-sm">
                        <span className="font-bold text-[#1A1A1A] mr-1">{labeledItem.label}.</span>
                        {labeledItem.content}
                      </p>
                    ))}
                  </>
                )}
                {child.type === 'gana' && (
                  <>
                    {child.content && (
                      <p className="text-[#1A1A1A] text-sm">
                        <span className="font-bold text-[#1A1A1A] mr-1">({child.label})</span>
                        {child.content}
                      </p>
                    )}
                    {child.items && child.items.map((labeledItem, idx) => (
                      <p key={idx} className="text-[#1A1A1A] text-sm">
                        <span className="font-bold text-[#1A1A1A] mr-1">({labeledItem.label})</span>
                        {labeledItem.content}
                      </p>
                    ))}
                  </>
                )}
                {child.type === 'bullet' && (
                  <>
                    {child.content && (
                      <p className="text-[#1A1A1A] text-sm">
                        <span className="font-bold text-[#1A1A1A] mr-1">◦</span>
                        {child.content}
                      </p>
                    )}
                    {child.items && child.items.map((labeledItem, idx) => (
                      <p key={idx} className="text-[#1A1A1A] text-sm">
                        <span className="font-bold text-[#1A1A1A] mr-1">◦</span>
                        {labeledItem.content}
                      </p>
                    ))}
                  </>
                )}
                {child.type === 'image' && child.imageUrl && (
                  <div className="relative w-full max-w-xs overflow-hidden bg-white border border-[#1A1A1A]">
                    <img
                      src={child.imageUrl}
                      alt="제시문 이미지"
                      className="w-full h-auto object-contain"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

      {/* 2. 나머지 제시문 (grouped 제외) - 생성 순서대로 표시 */}
      {hasValidMixedExamples && question.mixedExamples!
        .filter(item => item.type !== 'grouped' && isValidMixedItem(item))
        .map((item) => {
          if (item.type === 'text') {
            return (
              <div key={item.id} className="mt-4 p-4 bg-[#EDEAE4] border border-[#1A1A1A]">
                <p className="text-[#1A1A1A] text-sm whitespace-pre-wrap">{item.content}</p>
              </div>
            );
          }
          if (item.type === 'labeled') {
            return (
              <div key={item.id} className="mt-4 p-4 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1">
                {item.content && (
                  <p className="text-[#1A1A1A] text-sm">
                    <span className="font-bold text-[#1A1A1A] mr-1">{item.label}.</span>
                    {item.content}
                  </p>
                )}
                {item.items && item.items.map((labeledItem, idx) => (
                  <p key={idx} className="text-[#1A1A1A] text-sm">
                    <span className="font-bold text-[#1A1A1A] mr-1">{labeledItem.label}.</span>
                    {labeledItem.content}
                  </p>
                ))}
              </div>
            );
          }
          if (item.type === 'gana') {
            return (
              <div key={item.id} className="mt-4 p-4 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1">
                {item.content && (
                  <p className="text-[#1A1A1A] text-sm">
                    <span className="font-bold text-[#1A1A1A] mr-1">({item.label})</span>
                    {item.content}
                  </p>
                )}
                {item.items && item.items.map((labeledItem, idx) => (
                  <p key={idx} className="text-[#1A1A1A] text-sm">
                    <span className="font-bold text-[#1A1A1A] mr-1">({labeledItem.label})</span>
                    {labeledItem.content}
                  </p>
                ))}
              </div>
            );
          }
          if (item.type === 'bullet') {
            return (
              <div key={item.id} className="mt-4 p-4 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1">
                {item.content && (
                  <p className="text-[#1A1A1A] text-sm">
                    <span className="font-bold text-[#1A1A1A] mr-1">◦</span>
                    {item.content}
                  </p>
                )}
                {item.items && item.items.map((labeledItem, idx) => (
                  <p key={idx} className="text-[#1A1A1A] text-sm">
                    <span className="font-bold text-[#1A1A1A] mr-1">◦</span>
                    {labeledItem.content}
                  </p>
                ))}
              </div>
            );
          }
          return null;
        })}

      {/* 레거시 보기 (Examples) - 텍스트 형식 */}
      {hasValidExamples && !hasValidMixedExamples && question.examples!.type === 'text' && (
        <div className="mt-4 p-4 bg-[#EDEAE4] border border-[#1A1A1A]">
          <p className="text-[#1A1A1A] text-sm leading-relaxed">
            {question.examples!.items.filter(i => i.trim()).join(', ')}
          </p>
        </div>
      )}

      {/* 레거시 보기 (Examples) - ㄱ.ㄴ.ㄷ. 형식 */}
      {hasValidExamples && !hasValidMixedExamples && question.examples!.type === 'labeled' && (
        <div className="mt-4 p-4 bg-[#EDEAE4] border border-[#1A1A1A] space-y-2">
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

      {/* 4. 문제 이미지 (첨부 시) - 제시문 다음에 표시 */}
      {question.imageUrl && (
        <div className="mt-4 relative w-full aspect-video overflow-hidden bg-[#EDEAE4] border border-[#1A1A1A]">
          {question.imageUrl.startsWith('data:') ? (
            <img
              src={question.imageUrl}
              alt={`문제 ${question.number} 이미지`}
              className="w-full h-full object-contain"
            />
          ) : (
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

      {/* 5. 보기 (<보기> 박스) - 이미지 다음, 발문 전에 표시 */}
      {question.bogi && question.bogi.items && question.bogi.items.some(i => i.content?.trim()) && (
        <div className="mt-4">
          {/* <보기> 박스 (발문은 아래에서 별도 표시) */}
          <div className="p-4 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
            <p className="text-xs text-center text-[#5C5C5C] mb-2 font-bold">&lt;보 기&gt;</p>
            <div className="space-y-1">
              {question.bogi.items.filter(i => i.content?.trim()).map((item) => (
                <p key={item.label} className="text-[#1A1A1A] text-sm">
                  <span className="font-bold mr-1">{item.label}.</span>
                  {item.content}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 6. 발문 (제시문 발문 + 보기 발문 합침, 선지 전에 표시) */}
      {(question.passagePrompt || question.bogi?.questionText) && (
        <p className="mt-4 text-[#1A1A1A] text-sm leading-relaxed">
          {question.passagePrompt && question.bogi?.questionText
            ? `${question.passagePrompt} ${question.bogi.questionText}`
            : question.passagePrompt || question.bogi?.questionText}
        </p>
      )}

      {/* 결합형 문제인데 하위 문제/선지가 없는 경우 안내 */}
      {question.type === 'combined' && !question.choices && (
        <div className="mt-4 p-4 bg-[#FFF8E1] border border-[#8B6914] text-sm text-[#8B6914]">
          ⚠️ 이 결합형 문제는 하위 문제가 설정되지 않았습니다.
        </div>
      )}

      {/* 결합형: 공통 제시문 (passage, koreanAbcItems, passageImage 중 하나라도 있으면 표시) */}
      {(question.passage || question.passageImage || (question.koreanAbcItems && question.koreanAbcItems.length > 0)) && (
        <div className="mt-4 space-y-3">
          {/* 공통 제시문 - 텍스트 형식 (passageType이 없거나 'text'일 때) */}
          {question.passage && (!question.passageType || question.passageType === 'text') && (
            <div className="p-4 bg-[#EDEAE4] border border-[#1A1A1A]">
              <p className="text-xs text-[#5C5C5C] mb-2 font-bold">공통 제시문</p>
              <p className="text-[#1A1A1A] text-sm leading-relaxed whitespace-pre-wrap">
                {question.passage}
              </p>
            </div>
          )}

          {/* 공통 제시문 - ㄱㄴㄷ 형식 */}
          {question.passageType === 'korean_abc' && question.koreanAbcItems && question.koreanAbcItems.length > 0 && (
            <div className="p-4 bg-[#EDEAE4] border border-[#1A1A1A] space-y-2">
              <p className="text-xs text-[#5C5C5C] mb-2 font-bold">제시문</p>
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
