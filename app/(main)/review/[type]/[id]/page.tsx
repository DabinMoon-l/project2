'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useReview, calculateCustomFolderQuestionCount, type ReviewItem, type FolderCategory, type CustomFolderQuestion } from '@/lib/hooks/useReview';
import { useCourse } from '@/lib/contexts/CourseContext';
import { Skeleton, BottomSheet, useExpToast } from '@/components/common';
import ReviewPractice, { type PracticeResult } from '@/components/review/ReviewPractice';
import { formatChapterLabel, getChapterById } from '@/lib/courseIndex';
import { useHideNav } from '@/lib/hooks/useHideNav';

// 선지 번호 라벨 (최대 8개 지원)
const choiceLabels = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

/**
 * questionId에서 주문제 번호와 하위문제 번호를 추출
 * 예: "q0" → [0, 0], "q1" → [1, 0], "q1-1" → [1, 1], "q1-2" → [1, 2]
 */
function parseQuestionId(questionId: string): [number, number] {
  if (!questionId) return [0, 0];
  // 형식: "q{main}" 또는 "q{main}-{sub}" 또는 "q{main}_{sub}"
  const match = questionId.match(/q?(\d+)(?:[-_](\d+))?/i);
  if (match) {
    const main = parseInt(match[1], 10);
    const sub = match[2] ? parseInt(match[2], 10) : 0;
    return [main, sub];
  }
  // 숫자만 있는 경우
  const numMatch = questionId.match(/(\d+)/);
  return numMatch ? [parseInt(numMatch[1], 10), 0] : [0, 0];
}

/**
 * ReviewItem을 questionId 기준으로 정렬 (결합형 문제 순서 유지)
 */
function sortByQuestionId<T extends { questionId: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const [aMain, aSub] = parseQuestionId(a.questionId);
    const [bMain, bSub] = parseQuestionId(b.questionId);
    if (aMain !== bMain) return aMain - bMain;
    return aSub - bSub;
  });
}

// ㄱㄴㄷ 라벨
const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'];

/**
 * 화면 표시용 아이템 (단일 문제 또는 결합형 그룹)
 */
interface DisplayItem {
  type: 'single' | 'combined_group';
  /** 단일 문제 */
  item?: ReviewItem;
  /** 결합형 그룹 문제들 */
  items?: ReviewItem[];
  /** 결합형 그룹 ID */
  combinedGroupId?: string;
  /** 화면 표시 번호 */
  displayNumber: number;
}

/**
 * 문제 목록을 displayItems로 변환 (결합형 그룹 처리)
 */
function createDisplayItems(questions: ReviewItem[]): DisplayItem[] {
  const sortedQuestions = sortByQuestionId(questions);
  const displayItems: DisplayItem[] = [];
  const processedGroupIds = new Set<string>();
  let displayNumber = 0;

  for (const question of sortedQuestions) {
    // 결합형 문제 - combinedGroupId가 있거나 questionId가 "q1-1" 형식인 경우
    const [mainNum, subNum] = parseQuestionId(question.questionId);
    const hasCombinedId = !!question.combinedGroupId;
    const hasDashFormat = subNum > 0;

    if (hasCombinedId || hasDashFormat) {
      // 그룹 ID 결정 (combinedGroupId가 있으면 사용, 없으면 주문제 번호로 생성)
      const groupId = question.combinedGroupId || `combined-${question.quizId}-q${mainNum}`;

      // 이미 처리된 그룹이면 스킵
      if (processedGroupIds.has(groupId)) continue;
      processedGroupIds.add(groupId);

      // 같은 그룹의 모든 문제 찾기
      const groupItems = sortedQuestions.filter((q) => {
        if (q.combinedGroupId) {
          return q.combinedGroupId === groupId;
        }
        // combinedGroupId가 없으면 questionId 패턴으로 그룹핑
        const [qMainNum, qSubNum] = parseQuestionId(q.questionId);
        return qMainNum === mainNum && qSubNum > 0 && q.quizId === question.quizId;
      });

      // combinedIndex 순서로 정렬 (공통 지문이 첫 번째 항목에 저장되어 있음)
      groupItems.sort((a, b) => {
        const aIndex = a.combinedIndex ?? 999;
        const bIndex = b.combinedIndex ?? 999;
        return aIndex - bIndex;
      });

      // combinedGroupId가 있거나 그룹이 2개 이상이면 결합형 그룹으로 표시
      if (hasCombinedId || groupItems.length > 1) {
        displayNumber++;
        displayItems.push({
          type: 'combined_group',
          items: groupItems,
          combinedGroupId: groupId,
          displayNumber,
        });
      } else {
        // 단일 문제로 처리
        displayNumber++;
        displayItems.push({
          type: 'single',
          item: question,
          displayNumber,
        });
      }
    } else {
      // 일반 문제
      displayNumber++;
      displayItems.push({
        type: 'single',
        item: question,
        displayNumber,
      });
    }
  }

  return displayItems;
}

/** 피드백 타입 */
type FeedbackType = 'unclear' | 'wrong' | 'typo' | 'other' | 'praise' | 'wantmore';

/** 피드백 유형 옵션 */
const FEEDBACK_TYPES: { type: FeedbackType; label: string; positive?: boolean }[] = [
  { type: 'praise', label: '문제가 좋아요!', positive: true },
  { type: 'wantmore', label: '더 풀고 싶어요', positive: true },
  { type: 'unclear', label: '문제가 이해가 안 돼요' },
  { type: 'wrong', label: '정답이 틀린 것 같아요' },
  { type: 'typo', label: '오타가 있어요' },
  { type: 'other', label: '기타 의견' },
];

/** 필터 타입 */
type ReviewFilter = 'library' | 'solved' | 'wrong' | 'bookmark' | 'custom';

/** 필터 옵션 */
const FILTER_OPTIONS: { value: ReviewFilter; line1: string; line2?: string }[] = [
  { value: 'library', line1: '서재' },
  { value: 'wrong', line1: '오답' },
  { value: 'bookmark', line1: '찜' },
  { value: 'custom', line1: '커스텀' },
];

/**
 * 슬라이드 필터 컴포넌트
 */
function SlideFilter({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: ReviewFilter;
  onFilterChange: (filter: ReviewFilter) => void;
}) {
  const activeIndex = FILTER_OPTIONS.findIndex((opt) => opt.value === activeFilter);

  return (
    <div className="relative flex items-stretch bg-[#EDEAE4] border border-[#1A1A1A] overflow-hidden min-w-0 w-[220px]">
      {/* 슬라이드 배경 */}
      <motion.div
        className="absolute h-full bg-[#1A1A1A]"
        initial={false}
        animate={{
          left: `${activeIndex * 25}%`,
        }}
        style={{
          width: '25%',
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      />

      {/* 필터 옵션들 */}
      {FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onFilterChange(option.value)}
          className={`relative z-10 w-1/4 px-1.5 py-1.5 text-[11px] font-bold transition-colors text-center whitespace-nowrap flex flex-col items-center justify-center ${
            activeFilter === option.value ? 'text-[#F5F0E8]' : 'text-[#1A1A1A]'
          }`}
        >
          {option.line2 ? (
            <>
              <span className="leading-tight">{option.line1}</span>
              <span className="leading-tight">{option.line2}</span>
            </>
          ) : (
            <span className="whitespace-nowrap">{option.line1}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * 문제 카드 컴포넌트
 */
function QuestionCard({
  item,
  questionNumber,
  subQuestionNumber,
  isSelectMode,
  isSelected,
  onSelect,
  onFeedbackSubmit,
  currentUserId,
  quizCreatorId,
  isAiGenerated,
  courseId,
  folderType,
  hasUpdate,
  isEditMode,
  onEditChange,
  editData,
}: {
  item: ReviewItem;
  questionNumber: number;
  /** 결합형 하위문제 번호 (있으면 Q{main}-{sub} 형식으로 표시) */
  subQuestionNumber?: number;
  isSelectMode: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onFeedbackSubmit?: (questionId: string, type: FeedbackType, content: string) => void;
  /** 현재 로그인한 사용자 ID (자기 문제 피드백 방지용) */
  currentUserId?: string;
  /** 해당 퀴즈의 생성자 ID (자기 문제 피드백 방지용) */
  quizCreatorId?: string;
  /** AI 생성 퀴즈 여부 (피드백 방지용) */
  isAiGenerated?: boolean;
  /** 과목 ID (챕터 라벨 표시용) */
  courseId?: string;
  /** 폴더 타입 (공통 문제 표시 여부 결정용) */
  folderType?: string;
  /** 수정된 문제 여부 */
  hasUpdate?: boolean;
  /** 수정 모드 여부 */
  isEditMode?: boolean;
  /** 수정 내용 변경 콜백 */
  onEditChange?: (field: string, value: any) => void;
  /** 현재 수정 중인 데이터 */
  editData?: { question?: string; options?: string[]; explanation?: string; choiceExplanations?: string[] };
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [selectedFeedbackType, setSelectedFeedbackType] = useState<FeedbackType | null>(null);
  const [feedbackContent, setFeedbackContent] = useState('');
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState(false);
  const [isFeedbackSubmitted, setIsFeedbackSubmitted] = useState(false);
  const [expandedChoices, setExpandedChoices] = useState<Set<number>>(new Set());

  // 피드백 제출
  const handleFeedbackSubmit = async () => {
    if (!selectedFeedbackType || !onFeedbackSubmit) return;
    setIsFeedbackSubmitting(true);
    try {
      await onFeedbackSubmit(item.questionId, selectedFeedbackType, feedbackContent);
      setIsFeedbackSubmitted(true);
      setIsFeedbackOpen(false);
      setSelectedFeedbackType(null);
      setFeedbackContent('');
    } catch (err) {
      console.error('피드백 제출 실패:', err);
    } finally {
      setIsFeedbackSubmitting(false);
    }
  };

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border bg-[#F5F0E8] transition-all ${
        isSelectMode
          ? isSelected
            ? 'border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]'
            : 'border border-dashed border-[#5C5C5C]'
          : 'border-[#1A1A1A]'
      }`}
    >
      {/* 헤더 */}
      <div
        onClick={() => {
          if (isSelectMode) {
            onSelect();
          } else {
            setIsExpanded(!isExpanded);
          }
        }}
        className="p-2.5 cursor-pointer"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* 문항 번호 + 정답/오답 표시 + 챕터 */}
            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
              <span className="inline-block px-1.5 py-0.5 text-[11px] font-bold bg-[#1A1A1A] text-[#F5F0E8]">
                Q{questionNumber}{subQuestionNumber ? `-${subQuestionNumber}` : (item.combinedGroupId && item.combinedIndex !== undefined ? `-${item.combinedIndex + 1}` : '')}
              </span>
              {/* 결합형 표시 */}
              {item.combinedGroupId && !subQuestionNumber && (
                <span className="inline-block px-1.5 py-0.5 text-[11px] font-bold border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]">
                  결합형 문제
                </span>
              )}
              {item.isCorrect !== undefined && (
                <span className={`inline-block px-1.5 py-0.5 text-[11px] font-bold ${
                  item.isCorrect
                    ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
                    : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
                }`}>
                  {item.isCorrect ? '정답' : '오답'}
                </span>
              )}
              {/* 챕터 표시 */}
              {courseId && item.chapterId && (
                <span className="inline-block px-1.5 py-0.5 text-[11px] font-medium bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7]">
                  {formatChapterLabel(courseId, item.chapterId, item.chapterDetailId)}
                </span>
              )}
            </div>
            <p className="text-xs text-[#1A1A1A]">
              {item.question}
              {/* 제시문 발문 또는 보기 발문 표시 */}
              {(item.passagePrompt || item.bogiQuestionText) && (
                <span className="ml-1 text-[#5C5C5C]">
                  {item.passagePrompt || item.bogiQuestionText}
                </span>
              )}
            </p>
          </div>

          {/* 오른쪽 영역: 아이콘 + 찜 뱃지 */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {/* 선택 체크박스 */}
            {isSelectMode && (
              <div className={`w-5 h-5 flex items-center justify-center ${
                isSelected ? 'bg-[#1A1A1A]' : 'border border-[#5C5C5C]'
              }`}>
                {isSelected && (
                  <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            )}

            {/* 수정 뱃지 + 확장 아이콘 */}
            {!isSelectMode && (
              <div className="flex items-center gap-1">
                {hasUpdate && (
                  <div className="w-4 h-4 bg-[#F5C518] rounded-full border border-[#1A1A1A] flex items-center justify-center">
                    <span className="text-[#1A1A1A] font-bold text-[9px] leading-none">!</span>
                  </div>
                )}
                <svg
                  className={`w-5 h-5 text-[#5C5C5C] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 상세 정보 */}
      <AnimatePresence>
        {isExpanded && !isSelectMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-[#1A1A1A] p-3 space-y-3 bg-[#EDEAE4]">
              {/* 수정 모드: 문제 텍스트 수정 */}
              {isEditMode && onEditChange && (
                <div>
                  <label className="block text-xs font-bold text-[#5C5C5C] mb-1">문제</label>
                  <textarea
                    value={editData?.question ?? item.question}
                    onChange={(e) => onEditChange('question', e.target.value)}
                    className="w-full p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm text-[#1A1A1A] focus:outline-none resize-none"
                    rows={3}
                    style={{ minHeight: '60px' }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = target.scrollHeight + 'px';
                    }}
                  />
                </div>
              )}

              {/* 결합형 공통 정보 (단일 문제로 표시될 때) - 공통 문제는 아코디언 헤더에 표시되므로 생략 */}
              {item.combinedGroupId && !subQuestionNumber && (
                <div className="space-y-3 mb-4">
                  {/* 공통 지문 */}
                  {(item.passage || item.passageImage || (item.koreanAbcItems && item.koreanAbcItems.length > 0) || ((item as any).passageMixedExamples && (item as any).passageMixedExamples.length > 0)) && (() => {
                    // 지문과 이미지가 둘 다 있는지 확인
                    const hasText = item.passage || (item.koreanAbcItems && item.koreanAbcItems.length > 0) || ((item as any).passageMixedExamples && (item as any).passageMixedExamples.length > 0);
                    const hasImage = !!item.passageImage;
                    const needsInnerBox = hasText && hasImage;

                    return (
                      <div className="p-3 border-2 border-[#8B6914] bg-[#FFF8E1]">
                        {/* 텍스트 */}
                        {item.passage && item.passageType !== 'korean_abc' && (
                          needsInnerBox ? (
                            <div className="p-3 bg-[#FFFDF7] border border-[#E8D9A8]">
                              <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{item.passage}</p>
                            </div>
                          ) : (
                            <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{item.passage}</p>
                          )
                        )}
                        {/* ㄱㄴㄷ 형식 */}
                        {item.passageType === 'korean_abc' && item.koreanAbcItems && item.koreanAbcItems.length > 0 && (
                          needsInnerBox ? (
                            <div className="p-3 bg-[#FFFDF7] border border-[#E8D9A8]">
                              <div className="space-y-1">
                                {item.koreanAbcItems.map((itm, idx) => (
                                  <p key={idx} className="text-sm text-[#1A1A1A]">
                                    <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {itm}
                                  </p>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {item.koreanAbcItems.map((itm, idx) => (
                                <p key={idx} className="text-sm text-[#1A1A1A]">
                                  <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {itm}
                                </p>
                              ))}
                            </div>
                          )
                        )}
                        {/* 혼합 형식 */}
                        {(item as any).passageMixedExamples && (item as any).passageMixedExamples.length > 0 && (
                          <div className="space-y-2">
                            {(item as any).passageMixedExamples.map((block: any) => (
                              <div key={block.id}>
                                {block.type === 'grouped' && (
                                  <div className="space-y-1">
                                    {(block.children || []).map((child: any) => (
                                      <div key={child.id}>
                                        {child.type === 'text' && <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>}
                                        {child.type === 'labeled' && (child.items || []).map((i: any) => (
                                          <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
                                        ))}
                                        {child.type === 'gana' && (child.items || []).map((i: any) => (
                                          <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
                                        ))}
                                        {child.type === 'image' && child.imageUrl && <img src={child.imageUrl} alt="" className="max-w-full h-auto" />}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {block.type === 'text' && <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>}
                                {block.type === 'labeled' && (
                                  <div className="space-y-1">
                                    {(block.items || []).map((i: any) => (
                                      <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
                                    ))}
                                  </div>
                                )}
                                {block.type === 'gana' && (
                                  <div className="space-y-1">
                                    {(block.items || []).map((i: any) => (
                                      <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
                                    ))}
                                  </div>
                                )}
                                {block.type === 'image' && block.imageUrl && <img src={block.imageUrl} alt="" className="max-w-full h-auto" />}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* 이미지 */}
                        {item.passageImage && (
                          <img src={item.passageImage} alt="공통 이미지" className={`max-w-full max-h-[300px] object-contain border border-[#1A1A1A] ${hasText ? 'mt-3' : ''}`} />
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* 보기 (혼합 보기 또는 레거시 형식) - 이미지보다 먼저 표시 */}
              {item.mixedExamples && item.mixedExamples.length > 0 ? (
                // 혼합 보기가 있는 경우 (grouped 먼저, 나머지 생성 순서대로)
                <>
                  {/* 1. 묶은 보기 (grouped) 먼저 */}
                  {item.mixedExamples.filter(b => b.type === 'grouped').map((block) => (
                    <div key={block.id} className="p-3 border-2 border-[#8B6914] bg-[#FFF8E1] mb-3">
                      <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                      <div className="space-y-1">
                        {block.children?.map((child) => (
                          <div key={child.id}>
                            {child.type === 'text' && child.content?.trim() && (
                              <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>
                            )}
                            {child.type === 'labeled' && (child.items || []).filter(i => i.content.trim()).map((labeledItem) => (
                              <p key={labeledItem.id} className="text-sm text-[#1A1A1A]">
                                <span className="font-bold">{labeledItem.label}.</span> {labeledItem.content}
                              </p>
                            ))}
                            {child.type === 'gana' && (child.items || []).filter(i => i.content.trim()).map((labeledItem) => (
                              <p key={labeledItem.id} className="text-sm text-[#1A1A1A]">
                                <span className="font-bold">({labeledItem.label})</span> {labeledItem.content}
                              </p>
                            ))}
                            {child.type === 'image' && child.imageUrl && (
                              <img src={child.imageUrl} alt="보기 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {/* 2. 나머지 블록 (생성 순서대로) */}
                  {item.mixedExamples.filter(b => b.type !== 'grouped').map((block) => {
                    if (block.type === 'text' && block.content?.trim()) {
                      return (
                        <div key={block.id} className="p-3 border border-[#8B6914] bg-[#FFF8E1] mb-3">
                          <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                          <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>
                        </div>
                      );
                    }
                    if (block.type === 'labeled') {
                      return (
                        <div key={block.id} className="p-3 border border-[#8B6914] bg-[#FFF8E1] mb-3">
                          <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                          <div className="space-y-1">
                            {(block.items || []).filter(i => i.content.trim()).map((labeledItem) => (
                              <p key={labeledItem.id} className="text-sm text-[#1A1A1A]">
                                <span className="font-bold">{labeledItem.label}.</span> {labeledItem.content}
                              </p>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    if (block.type === 'gana') {
                      return (
                        <div key={block.id} className="p-3 border border-[#8B6914] bg-[#FFF8E1] mb-3">
                          <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                          <div className="space-y-1">
                            {(block.items || []).filter(i => i.content.trim()).map((labeledItem) => (
                              <p key={labeledItem.id} className="text-sm text-[#1A1A1A]">
                                <span className="font-bold">({labeledItem.label})</span> {labeledItem.content}
                              </p>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })}
                </>
              ) : (
                // 레거시 보기 (텍스트 또는 ㄱㄴㄷ 형식)
                item.subQuestionOptions && item.subQuestionOptions.length > 0 && (
                  <div className="p-3 border border-[#8B6914] bg-[#FFF8E1] mb-3">
                    <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                    {item.subQuestionOptionsType === 'text' ? (
                      <p className="text-sm text-[#1A1A1A]">
                        {item.subQuestionOptions.join(', ')}
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {item.subQuestionOptions.map((opt, idx) => (
                          <p key={idx} className="text-sm text-[#1A1A1A]">
                            <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {opt}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )
              )}

              {/* 문제 이미지 - 보기 다음에 표시 */}
              {item.image && (
                <div className="mb-3">
                  <img
                    src={item.image}
                    alt="문제 이미지"
                    className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A]"
                  />
                </div>
              )}

              {/* 하위 문제 이미지 */}
              {item.subQuestionImage && (
                <div className="mb-3">
                  <img
                    src={item.subQuestionImage}
                    alt="보기 이미지"
                    className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A]"
                  />
                </div>
              )}

              {/* 보기 (<보기> 박스) - 이미지 다음, 발문 전에 표시 */}
              {item.bogi && item.bogi.items && item.bogi.items.some(i => i.content?.trim()) && (
                <div className="mb-3 p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
                  <p className="text-xs text-center text-[#5C5C5C] mb-2 font-bold">&lt;보 기&gt;</p>
                  <div className="space-y-1">
                    {item.bogi.items.filter(i => i.content?.trim()).map((bogiItem, idx) => (
                      <p key={idx} className="text-sm text-[#1A1A1A]">
                        <span className="font-bold mr-1">{bogiItem.label}.</span>
                        {bogiItem.content}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* 발문 (제시문 발문 + 보기 발문 합침, 선지 전에 표시) */}
              {(item.passagePrompt || item.bogiQuestionText) && (
                <div className="mb-3 p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
                  <p className="text-sm text-[#1A1A1A]">
                    {item.passagePrompt && item.bogiQuestionText
                      ? `${item.passagePrompt} ${item.bogiQuestionText}`
                      : item.passagePrompt || item.bogiQuestionText}
                  </p>
                </div>
              )}

              {/* OX 문제 - 시각적 O/X 버튼 */}
              {item.type === 'ox' && (() => {
                // OX 값 정규화 함수 (다양한 형식 지원)
                const normalizeOX = (value: unknown): 'O' | 'X' | null => {
                  if (value === null || value === undefined || value === '') return null;
                  const str = String(value).toLowerCase().trim();
                  // O로 인식: 'o', 'O', '0', 0, true, 'true', 'yes', '참'
                  if (str === 'o' || str === '0' || str === 'true' || str === 'yes' || str === '참' || value === 0 || value === true) {
                    return 'O';
                  }
                  // X로 인식: 'x', 'X', '1', 1, false, 'false', 'no', '거짓'
                  if (str === 'x' || str === '1' || str === 'false' || str === 'no' || str === '거짓' || value === 1 || value === false) {
                    return 'X';
                  }
                  return null;
                };

                const normalizedCorrect = normalizeOX(item.correctAnswer);
                const normalizedUser = normalizeOX(item.userAnswer);
                const isOCorrect = normalizedCorrect === 'O';
                const isXCorrect = normalizedCorrect === 'X';
                const userSelectedO = normalizedUser === 'O';
                const userSelectedX = normalizedUser === 'X';

                return (
                  <div className="space-y-2">
                    <div className="flex gap-3 justify-center py-1">
                      {/* O 버튼 */}
                      <div
                        className={`w-12 h-12 text-2xl font-bold border-2 flex items-center justify-center transition-colors ${
                          isOCorrect
                            ? 'bg-[#1A6B1A] border-[#1A6B1A] text-[#F5F0E8]'
                            : userSelectedO
                              ? 'bg-[#8B1A1A] border-[#8B1A1A] text-[#F5F0E8]'
                              : 'bg-[#F5F0E8] border-[#1A1A1A] text-[#5C5C5C]'
                        }`}
                      >
                        O
                      </div>
                      {/* X 버튼 */}
                      <div
                        className={`w-12 h-12 text-2xl font-bold border-2 flex items-center justify-center transition-colors ${
                          isXCorrect
                            ? 'bg-[#1A6B1A] border-[#1A6B1A] text-[#F5F0E8]'
                            : userSelectedX
                              ? 'bg-[#8B1A1A] border-[#8B1A1A] text-[#F5F0E8]'
                              : 'bg-[#F5F0E8] border-[#1A1A1A] text-[#5C5C5C]'
                        }`}
                      >
                        X
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 객관식 문제 - 시각적 선지 버튼 */}
              {item.type === 'multiple' && item.options && item.options.length > 0 && (
                <div className="space-y-2">
                  {/* 복수 정답 표시 */}
                  {(() => {
                    const correctAnswerStr = item.correctAnswer?.toString() || '';
                    const correctAnswers = correctAnswerStr.includes(',')
                      ? correctAnswerStr.split(',').map(a => a.trim())
                      : [correctAnswerStr];
                    const isMultipleAnswer = correctAnswers.length > 1;
                    return isMultipleAnswer && (
                      <p className="text-[10px] text-[#8B6914] font-bold flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        복수 정답 ({correctAnswers.length}개)
                      </p>
                    );
                  })()}
                  <div className="space-y-1.5">
                    {(editData?.options ?? item.options).map((opt, idx) => {
                      const optionNum = (idx + 1).toString();
                      // 복수 정답 지원 - 1-indexed 번호만 사용 (optionIdx 제거)
                      const correctAnswerStr = item.correctAnswer?.toString() || '';
                      const correctAnswers = correctAnswerStr.includes(',')
                        ? correctAnswerStr.split(',').map(a => a.trim())
                        : [correctAnswerStr];
                      // 정답 비교: 1-indexed 번호만 사용
                      const isCorrectOption = correctAnswers.some(ca => ca === optionNum);
                      // 사용자 답 비교 - 1-indexed 번호만 사용
                      const userAnswerStr = item.userAnswer?.toString() || '';
                      const userAnswers = userAnswerStr.includes(',')
                        ? userAnswerStr.split(',').map(a => a.trim())
                        : [userAnswerStr];
                      const isUserAnswer = userAnswers.some(ua => ua === optionNum);
                      const isWrongAnswer = isUserAnswer && !isCorrectOption;

                      // 스타일 결정
                      let bgColor = '#F5F0E8';
                      let borderColor = '#1A1A1A';
                      let textColor = '#1A1A1A';

                      if (!isEditMode) {
                        if (isCorrectOption) {
                          bgColor = '#1A6B1A';
                          borderColor = '#1A6B1A';
                          textColor = '#F5F0E8';
                        } else if (isWrongAnswer) {
                          bgColor = '#8B1A1A';
                          borderColor = '#8B1A1A';
                          textColor = '#F5F0E8';
                        }
                      }

                      // 복수정답 여부 확인
                      const isMultipleAnswerQuestion = correctAnswers.length > 1;
                      // 선지별 해설
                      const currentChoiceExps = editData?.choiceExplanations ?? item.choiceExplanations;
                      const choiceExp = currentChoiceExps?.[idx];
                      const isChoiceExpanded = expandedChoices.has(idx);

                      return (
                        <div key={idx}>
                          <div
                            style={isEditMode ? {} : { backgroundColor: bgColor, borderColor, color: textColor }}
                            className={`w-full p-2 border-2 flex items-start gap-2 text-left ${
                              isEditMode
                                ? 'border-[#1A1A1A] bg-[#F5F0E8]'
                                : choiceExp ? 'cursor-pointer' : ''
                            }`}
                            onClick={!isEditMode && choiceExp ? () => {
                              setExpandedChoices(prev => {
                                const next = new Set(prev);
                                if (next.has(idx)) next.delete(idx);
                                else next.add(idx);
                                return next;
                              });
                            } : undefined}
                          >
                            {/* 선지 번호 */}
                            <span
                              className={`flex-shrink-0 w-5 h-5 flex items-center justify-center text-xs font-bold ${
                                isEditMode
                                  ? 'bg-[#EDEAE4] text-[#1A1A1A]'
                                  : isCorrectOption || isWrongAnswer
                                    ? 'bg-[#F5F0E8]/20 text-[#F5F0E8]'
                                    : 'bg-[#EDEAE4] text-[#1A1A1A]'
                              }`}
                            >
                              {choiceLabels[idx] || `${idx + 1}`}
                            </span>
                            {/* 선지 텍스트 - 수정 모드면 input */}
                            {isEditMode && onEditChange ? (
                              <input
                                type="text"
                                value={opt}
                                onChange={(e) => {
                                  const newOptions = [...(editData?.options ?? item.options ?? [])];
                                  newOptions[idx] = e.target.value;
                                  onEditChange('options', newOptions);
                                }}
                                className="flex-1 text-xs bg-transparent border-b border-[#5C5C5C] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
                              />
                            ) : (
                              <span className="flex-1 text-xs leading-relaxed break-words">
                                {opt}
                                {isMultipleAnswerQuestion && isCorrectOption && <span className="ml-1 font-bold">(정답)</span>}
                                {isMultipleAnswerQuestion && isUserAnswer && <span className="ml-1 font-bold">(내 답)</span>}
                              </span>
                            )}
                            {/* 체크 아이콘 또는 아코디언 화살표 (수정 모드에서는 숨김) */}
                            {!isEditMode && (
                              (isCorrectOption || isUserAnswer) ? (
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d={isCorrectOption ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"} />
                                  </svg>
                                  {choiceExp && (
                                    <svg className={`w-4 h-4 transition-transform ${isChoiceExpanded ? 'rotate-180' : ''}`}
                                      fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  )}
                                </div>
                              ) : choiceExp ? (
                                <svg className={`w-4 h-4 flex-shrink-0 transition-transform ${isChoiceExpanded ? 'rotate-180' : ''}`}
                                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              ) : null
                            )}
                          </div>
                          {/* 선지별 해설 - 수정 모드면 전부 펼침 + textarea */}
                          {isEditMode && onEditChange ? (
                            <div className="px-3 py-2 border-x-2 border-b-2 border-[#1A1A1A] bg-[#EDEAE4]">
                              <label className="block text-[10px] text-[#5C5C5C] mb-1">선지 {idx + 1} 해설</label>
                              <textarea
                                value={(editData?.choiceExplanations ?? item.choiceExplanations ?? [])[idx] || ''}
                                onChange={(e) => {
                                  const newExps = [...(editData?.choiceExplanations ?? item.choiceExplanations ?? [])];
                                  // 배열 길이가 부족하면 확장
                                  while (newExps.length <= idx) newExps.push('');
                                  newExps[idx] = e.target.value;
                                  onEditChange('choiceExplanations', newExps);
                                }}
                                className="w-full p-2 border border-[#5C5C5C] bg-[#F5F0E8] text-sm text-[#5C5C5C] focus:outline-none resize-none"
                                rows={2}
                              />
                            </div>
                          ) : choiceExp && isChoiceExpanded ? (
                            <div
                              style={{ borderColor }}
                              className="px-3 py-2 border-x-2 border-b-2 bg-[#EDEAE4]"
                            >
                              <p className={`text-xs whitespace-pre-wrap ${
                                isCorrectOption ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
                              }`}>
                                {choiceExp.replace(/^선지\d+\s*해설\s*[:：]\s*/i, '')}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 단답형/서술형 답 */}
              {(item.type === 'short' || item.type === 'short_answer' || item.type === 'subjective' || item.type === 'essay') && (
                <div className="space-y-2">
                  {/* 내 답 */}
                  <div className="p-2 border-2 border-[#1A1A1A] bg-[#F5F0E8]">
                    <p className="text-[10px] text-[#5C5C5C] mb-0.5">내 답</p>
                    <p className={`text-xs font-medium whitespace-pre-wrap ${item.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                      {item.userAnswer || '(미응답)'}
                    </p>
                  </div>
                  {/* 정답 */}
                  {item.correctAnswer && (
                    <div className="p-2 border-2 border-[#1A6B1A] bg-[#E8F5E9]">
                      <p className="text-[10px] text-[#1A6B1A] mb-0.5">정답</p>
                      <p className="text-xs font-medium text-[#1A6B1A] whitespace-pre-wrap">
                        {/* 복수 정답 표시 (||| -> , 로 변환) */}
                        {item.correctAnswer?.includes('|||')
                          ? item.correctAnswer.split('|||').map((a: string) => a.trim()).join(', ')
                          : item.correctAnswer
                        }
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 기타 타입 (위 조건에 해당하지 않는 경우) - 답 표시 */}
              {item.type !== 'ox' &&
               item.type !== 'multiple' &&
               item.type !== 'short' &&
               item.type !== 'short_answer' &&
               item.type !== 'subjective' &&
               item.type !== 'essay' &&
               (item.userAnswer || item.correctAnswer) && (
                <div className="space-y-2">
                  {item.userAnswer && (
                    <div className="p-2 border-2 border-[#1A1A1A] bg-[#F5F0E8]">
                      <p className="text-[10px] text-[#5C5C5C] mb-0.5">내 답</p>
                      <p className={`text-xs font-medium whitespace-pre-wrap ${item.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                        {item.userAnswer}
                      </p>
                    </div>
                  )}
                  {item.correctAnswer && (
                    <div className="p-2 border-2 border-[#1A6B1A] bg-[#E8F5E9]">
                      <p className="text-[10px] text-[#1A6B1A] mb-0.5">정답</p>
                      <p className="text-xs font-medium text-[#1A6B1A] whitespace-pre-wrap">
                        {item.correctAnswer}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 해설 */}
              {isEditMode && onEditChange ? (
                <div className="p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
                  <label className="block text-xs font-bold text-[#5C5C5C] mb-1">해설</label>
                  <textarea
                    value={editData?.explanation ?? item.explanation ?? ''}
                    onChange={(e) => onEditChange('explanation', e.target.value)}
                    className="w-full p-2 border border-[#5C5C5C] bg-[#EDEAE4] text-sm text-[#5C5C5C] focus:outline-none resize-none"
                    rows={3}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = target.scrollHeight + 'px';
                    }}
                  />
                </div>
              ) : item.explanation ? (
                <div className="p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
                  <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                  <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">
                    {item.explanation}
                  </p>
                </div>
              ) : null}


              {/* 피드백 버튼 - 자기 문제가 아닌 경우에만 표시 */}
              {onFeedbackSubmit && !(currentUserId && (quizCreatorId === currentUserId || item.quizCreatorId === currentUserId)) && (
                <div className="pt-3 border-t border-[#EDEAE4] flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isFeedbackSubmitted) {
                        setIsFeedbackOpen(true);
                      }
                    }}
                    disabled={isFeedbackSubmitted}
                    className={`flex items-center gap-2 px-3 py-2 text-xs font-bold border-2 transition-colors ${
                      isFeedbackSubmitted
                        ? 'bg-[#E8F5E9] border-[#1A6B1A] text-[#1A6B1A] cursor-default'
                        : 'bg-[#FFF8E1] border-[#8B6914] text-[#8B6914] hover:bg-[#FFECB3]'
                    }`}
                  >
                    {isFeedbackSubmitted ? (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        피드백 완료
                      </>
                    ) : (
                      <>
                        <span className="w-5 h-5 flex items-center justify-center bg-[#8B6914] text-[#FFF8E1] font-bold">!</span>
                        문제 피드백
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>

      {/* 피드백 바텀시트 */}
      <BottomSheet
        isOpen={isFeedbackOpen}
        onClose={() => {
          setIsFeedbackOpen(false);
          setSelectedFeedbackType(null);
          setFeedbackContent('');
        }}
        title="문제 피드백"
        height="auto"
      >
        <div className="space-y-4">
          {/* 피드백 유형 선택 */}
          <div>
            <p className="text-xs text-[#5C5C5C] mb-3">이 문제에 대한 의견을 선택해주세요</p>
            <div className="grid grid-cols-2 gap-2">
              {FEEDBACK_TYPES.map(({ type, label, positive }) => (
                <button
                  key={type}
                  onClick={() => setSelectedFeedbackType(type)}
                  className={`p-2.5 border-2 text-sm font-bold transition-all ${
                    selectedFeedbackType === type
                      ? positive
                        ? 'border-[#1A6B1A] bg-[#1A6B1A] text-[#F5F0E8]'
                        : 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                      : positive
                        ? 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]'
                        : 'border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 추가 내용 입력 */}
          <AnimatePresence>
            {selectedFeedbackType && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <label className="block text-sm text-[#5C5C5C] mb-2">추가 의견 (선택)</label>
                <textarea
                  value={feedbackContent}
                  onChange={(e) => setFeedbackContent(e.target.value)}
                  placeholder="자세한 내용을 적어주세요"
                  rows={3}
                  maxLength={200}
                  className="w-full p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] focus:outline-none resize-none text-sm"
                />
                <p className="text-xs text-[#5C5C5C] text-right mt-1">{feedbackContent.length}/200</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 제출 버튼 */}
          <button
            onClick={handleFeedbackSubmit}
            disabled={!selectedFeedbackType || isFeedbackSubmitting}
            className={`w-full py-2.5 font-bold border-2 transition-colors ${
              selectedFeedbackType
                ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C] cursor-not-allowed'
            }`}
          >
            {isFeedbackSubmitting ? '제출 중...' : '피드백 보내기'}
          </button>
          <p className="text-xs text-[#5C5C5C] text-center">피드백은 익명으로 전달됩니다.</p>
        </div>
      </BottomSheet>
    </>
  );
}

/**
 * 폴더 상세 페이지
 */
export default function FolderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { userCourse, userClassId } = useCourse();
  const { showExpToast } = useExpToast();

  const folderType = params.type as string; // solved, wrong, bookmark, custom
  const folderId = params.id as string;

  // 최초 진입 시에만 슬라이드 애니메이션 (뒤로가기 시 재발동 방지)
  const [slideIn] = useState(() => {
    if (typeof window === 'undefined') return false;
    const key = `visited_review_${params.id}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  });
  const chapterFilter = searchParams.get('chapter'); // 챕터 필터 (오답 탭에서 챕터별 클릭 시)
  const fromQuizPage = searchParams.get('from') === 'quiz'; // 퀴즈 페이지 복습탭에서 접근 시 수정 비활성화
  const autoStart = searchParams.get('autoStart'); // 'all' | 'wrongOnly' — 퀴즈 페이지에서 바로 복습 시작

  // 과목별 리본 이미지 (solved 타입 또는 퀴즈 페이지에서 온 경우 퀴즈 리본, 나머지는 리뷰 리본)
  const ribbonImage = (folderType === 'solved' || fromQuizPage)
    ? (userCourse?.quizRibbonImage || '/images/biology-quiz-ribbon.png')
    : (userCourse?.reviewRibbonImage || '/images/biology-review-ribbon.png');
  const ribbonScale = (folderType === 'solved' || fromQuizPage)
    ? (userCourse?.quizRibbonScale || 1)
    : (userCourse?.reviewRibbonScale || 1);

  const {
    groupedSolvedItems,
    groupedWrongItems,
    groupedBookmarkedItems,
    customFolders,
    solvedItems,
    wrongItems,
    addToCustomFolder,
    removeFromCustomFolder,
    deleteReviewItem,
    deleteCustomFolder,
    addCategoryToFolder,
    removeCategoryFromFolder,
    assignQuestionToCategory,
    loading: reviewLoading,
    markAsReviewed,
  } = useReview();

  const [customQuestions, setCustomQuestions] = useState<ReviewItem[]>([]);
  const [customLoading, setCustomLoading] = useState(false);
  // 서재(library) 퀴즈 상태
  const [libraryQuestions, setLibraryQuestions] = useState<ReviewItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  // 찜 퀴즈 폴백 상태 (reviews에 bookmark 타입 문제가 없을 때 퀴즈 문서에서 로드)
  const [bookmarkFallbackQuestions, setBookmarkFallbackQuestions] = useState<ReviewItem[]>([]);
  const [bookmarkFallbackLoading, setBookmarkFallbackLoading] = useState(false);
  const [bookmarkFallbackTitle, setBookmarkFallbackTitle] = useState('');
  const [libraryQuizTitle, setLibraryQuizTitle] = useState<string>('');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [practiceItems, setPracticeItems] = useState<ReviewItem[] | null>(null);
  const [practiceMode, setPracticeMode] = useState<'all' | 'wrongOnly' | null>(null); // 복습 모드 (첫복습점수 저장용)
  const [isAddMode, setIsAddMode] = useState(false);
  const [showEmptyMessage, setShowEmptyMessage] = useState(false);
  const [addSelectedIds, setAddSelectedIds] = useState<Set<string>>(new Set());
  // 결합형 문제 아코디언 펼침 상태
  const [expandedCombinedGroups, setExpandedCombinedGroups] = useState<Set<string>>(new Set());
  // 바텀시트용 상태
  const [selectedQuizForAdd, setSelectedQuizForAdd] = useState<{ quizId: string; quizTitle: string } | null>(null);

  // 폴더/서재 삭제 모달 상태
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // 토스트 메시지 상태
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 토스트 표시 함수
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2000);
  };

  // 결합형 그룹 펼침 상태
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  // 퀴즈별 생성자 ID 맵 (자기 문제 피드백 방지용)
  const [quizCreatorsMap, setQuizCreatorsMap] = useState<Map<string, string>>(new Map());
  // 퀴즈별 AI 생성 여부 맵 (AI 문제 피드백 방지용)
  const [quizAiMap, setQuizAiMap] = useState<Map<string, boolean>>(new Map());

  // 카테고리 관련 상태
  const [isCategoryMode, setIsCategoryMode] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAssignMode, setIsAssignMode] = useState(false);
  const [selectedCategoryForAssign, setSelectedCategoryForAssign] = useState<string | null>(null);

  // 퀴즈 점수 상태 (solved/bookmark 타입용)
  const [quizScores, setQuizScores] = useState<{ myScore?: number; myFirstReviewScore?: number; averageScore?: number; isPublic?: boolean } | null>(null);

  // 수정된 문제 ID 집합 (문제별 뱃지 표시용)
  const [updatedQuestionIds, setUpdatedQuestionIds] = useState<Set<string>>(new Set());

  // 수정 모드 상태 (제목 + 문제 인라인 수정)
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedQuestions, setEditedQuestions] = useState<Record<string, { question?: string; options?: string[]; explanation?: string; choiceExplanations?: string[] }>>({});
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const loadedFolderRef = useRef<string | null>(null);
  const supplementedExpsRef = useRef<string | null>(null);

  // 네비게이션 숨김
  useHideNav(true);

  // 커스텀 폴더 찾기
  const customFolder = useMemo(() => {
    if (folderType === 'custom') {
      return customFolders.find(f => f.id === folderId) || null;
    }
    return null;
  }, [folderType, folderId, customFolders]);

  // 폴더 데이터 계산 (useMemo로 무한 루프 방지)
  const folderData = useMemo(() => {
    if (folderType === 'library') {
      // 서재 타입: 비동기로 로드됨
      return libraryQuizTitle ? { title: libraryQuizTitle, items: libraryQuestions } : null;
    } else if (folderType === 'solved') {
      const group = groupedSolvedItems.find(g => g.quizId === folderId);
      return group ? { title: group.quizTitle, items: group.items } : null;
    } else if (folderType === 'wrong') {
      const group = groupedWrongItems.find(g => g.quizId === folderId);
      if (!group) return null;
      // 챕터 필터가 있으면 해당 챕터의 문제만 필터링
      const filteredItems = chapterFilter
        ? group.items.filter(item => item.chapterId === chapterFilter)
        : group.items;
      return { title: group.quizTitle, items: filteredItems };
    } else if (folderType === 'bookmark') {
      // 1) bookmark 리뷰에서 찾기 (개별 문제 찜)
      const bookmarkGroup = groupedBookmarkedItems.find(g => g.quizId === folderId);
      if (bookmarkGroup) return { title: bookmarkGroup.quizTitle, items: bookmarkGroup.items };
      // 2) solved 리뷰에서 폴백 (퀴즈 레벨만 찜한 경우, 풀이 기록이 있으면 사용)
      const solvedGroup = groupedSolvedItems.find(g => g.quizId === folderId);
      if (solvedGroup) return { title: solvedGroup.quizTitle, items: solvedGroup.items };
      // 3) 퀴즈 문서에서 직접 로드한 폴백 데이터
      if (bookmarkFallbackTitle) return { title: bookmarkFallbackTitle, items: bookmarkFallbackQuestions };
      return null;
    } else if (folderType === 'custom' && customFolder) {
      return { title: customFolder.name, items: null as ReviewItem[] | null };
    }
    return null;
  }, [folderType, folderId, groupedSolvedItems, groupedWrongItems, groupedBookmarkedItems, customFolder, chapterFilter, libraryQuizTitle, libraryQuestions, bookmarkFallbackTitle, bookmarkFallbackQuestions]);

  // 비서재 타입(wrong/solved/bookmark)에서 choiceExplanations가 빠진 경우 퀴즈 문서에서 보충
  useEffect(() => {
    if (!user || folderType === 'library') return;
    if (!folderData?.items || folderData.items.length === 0) return;
    if (supplementedExpsRef.current === folderId) return;

    const hasMissing = folderData.items.some(
      item => !item.choiceExplanations && item.type === 'multiple'
    );
    if (!hasMissing) return;

    const supplementExps = async () => {
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
        if (!quizDoc.exists()) return;
        const questions = quizDoc.data().questions || [];
        const expsMap: Record<string, string[]> = {};
        questions.forEach((q: any, idx: number) => {
          if (q.choiceExplanations?.length > 0) {
            expsMap[q.id || `q${idx}`] = q.choiceExplanations;
            expsMap[(idx + 1).toString()] = q.choiceExplanations;
          }
        });

        let changed = false;
        folderData.items?.forEach(item => {
          if (!item.choiceExplanations && item.type === 'multiple') {
            const exps = expsMap[item.questionId] || expsMap[item.questionId?.replace(/^q/, '')];
            if (exps) {
              item.choiceExplanations = exps;
              changed = true;
            }
          }
        });

        if (changed) {
          supplementedExpsRef.current = folderId;
          setUpdatedQuestionIds(prev => new Set(prev));
        }
      } catch (e) {
        console.error('choiceExplanations 보충 오류:', e);
      }
    };

    supplementExps();
  }, [user, folderType, folderId, folderData]);

  // 커스텀 폴더일 때만 비동기로 문제 로드
  useEffect(() => {
    if (!user || folderType !== 'custom' || !customFolder) return;
    if (loadedFolderRef.current === folderId) return;

    const loadCustomQuestions = async () => {
      setCustomLoading(true);
      const items: ReviewItem[] = [];

      for (const q of customFolder.questions) {
        // questionId와 quizId 모두로 검색해야 정확한 문제를 찾을 수 있음
        const reviewQuery = query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('questionId', '==', q.questionId),
          where('quizId', '==', q.quizId)
        );
        const reviewDocs = await getDocs(reviewQuery);
        if (!reviewDocs.empty) {
          const data = reviewDocs.docs[0].data();
          items.push({
            id: reviewDocs.docs[0].id,
            userId: data.userId,
            quizId: data.quizId,
            quizTitle: data.quizTitle,
            questionId: data.questionId,
            question: data.question,
            type: data.type,
            options: data.options,
            correctAnswer: data.correctAnswer,
            userAnswer: data.userAnswer,
            explanation: data.explanation,
            reviewType: data.reviewType,
            isBookmarked: data.isBookmarked,
            isCorrect: data.isCorrect,
            reviewCount: data.reviewCount || 0,
            lastReviewedAt: data.lastReviewedAt,
            createdAt: data.createdAt,
            // 결합형 문제 필드
            combinedGroupId: data.combinedGroupId,
            combinedIndex: data.combinedIndex,
            combinedTotal: data.combinedTotal,
            passage: data.passage,
            passageType: data.passageType,
            passageImage: data.passageImage,
            koreanAbcItems: data.koreanAbcItems,
            passageMixedExamples: data.passageMixedExamples,
            commonQuestion: data.commonQuestion,
            // 문제 이미지/보기 필드
            image: data.image,
            mixedExamples: data.mixedExamples,
            subQuestionOptions: data.subQuestionOptions,
            subQuestionOptionsType: data.subQuestionOptionsType,
            subQuestionImage: data.subQuestionImage,
            quizCreatorId: data.quizCreatorId,
            choiceExplanations: data.choiceExplanations,
          });
        }
      }

      // questionId 기준으로 정렬 (결합형 문제 순서 유지)
      setCustomQuestions(sortByQuestionId(items));
      loadedFolderRef.current = folderId;
      setCustomLoading(false);
    };

    loadCustomQuestions();
  }, [user, folderType, folderId, customFolder]);

  // 서재(library) 퀴즈 로드
  useEffect(() => {
    if (!user || folderType !== 'library') return;

    const loadLibraryQuiz = async () => {
      setLibraryLoading(true);
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
        if (!quizDoc.exists()) {
          setLibraryQuestions([]);
          setLibraryQuizTitle('');
          setLibraryLoading(false);
          return;
        }

        const quizData = quizDoc.data();
        setLibraryQuizTitle(quizData.title || '퀴즈');

        // quizResults에서 사용자 풀이 결과 가져오기
        const resultQuery = query(
          collection(db, 'quizResults'),
          where('userId', '==', user.uid),
          where('quizId', '==', folderId)
        );
        const resultDocs = await getDocs(resultQuery);

        // 가장 최근 결과의 questionScores 가져오기
        let questionScores: Record<string, any> = {};
        if (!resultDocs.empty) {
          const sorted = resultDocs.docs.sort((a, b) => {
            const aTime = a.data().createdAt?.toMillis?.() || 0;
            const bTime = b.data().createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          });
          questionScores = sorted[0].data().questionScores || {};
        }

        // reviews 컬렉션에서 choiceExplanations 가져오기 (퀴즈 문서에 없을 수 있음)
        const reviewQuery = query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('quizId', '==', folderId),
          where('reviewType', '==', 'solved')
        );
        const reviewDocs = await getDocs(reviewQuery);
        const reviewChoiceExplanationsMap: Record<string, string[]> = {};
        reviewDocs.docs.forEach(d => {
          const data = d.data();
          if (data.choiceExplanations && Array.isArray(data.choiceExplanations) && data.choiceExplanations.length > 0) {
            reviewChoiceExplanationsMap[data.questionId] = data.choiceExplanations;
          }
        });
        // questions 배열을 ReviewItem 형식으로 변환
        const questions = quizData.questions || [];

        // questionScores의 userAnswer가 0-indexed인지 1-indexed인지 자동 감지
        // 정답인 문제에서 scoreData.userAnswer == q.answer(0-indexed)이면 0-indexed 데이터
        let scoreAnswerIsZeroIndexed = false;
        if (Object.keys(questionScores).length > 0) {
          for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const qId = q.id || `q${i}`;
            const sd = questionScores[qId];
            if (sd && sd.isCorrect === true && q.type === 'multiple' && q.answer !== undefined) {
              const ua = Number(sd.userAnswer);
              const ca = typeof q.answer === 'number' ? q.answer : Number(q.answer);
              if (!isNaN(ua) && !isNaN(ca)) {
                // userAnswer와 correctAnswer(0-indexed)가 같으면 0-indexed 데이터
                scoreAnswerIsZeroIndexed = (ua === ca);
                break;
              }
            }
          }
        }

        const items: ReviewItem[] = questions.map((q: any, idx: number) => {
          // 정답 변환 (1-indexed 번호 또는 텍스트)
          let correctAnswer = '';
          if (q.type === 'multiple') {
            // 복수정답 지원: answer가 배열인 경우
            if (Array.isArray(q.answer)) {
              correctAnswer = q.answer.map((a: number) => String(a + 1)).join(',');
            } else {
              // 0-indexed를 1-indexed로 변환
              correctAnswer = String((q.answer ?? 0) + 1);
            }
          } else if (q.type === 'ox') {
            correctAnswer = q.answer === 0 ? 'O' : 'X';
          } else {
            correctAnswer = String(q.answer ?? '');
          }

          // 사용자 답변 변환 (0-indexed → 1-indexed)
          // 퀴즈 문서의 userAnswer는 0-indexed (AIQuizContainer가 저장)
          let userAnswer = '';
          if (q.userAnswer !== undefined && q.userAnswer !== null) {
            if (q.type === 'multiple') {
              if (Array.isArray(q.userAnswer)) {
                userAnswer = q.userAnswer.map((a: any) => String(Number(a) + 1)).join(',');
              } else if (typeof q.userAnswer === 'number') {
                userAnswer = String(q.userAnswer + 1);
              } else if (typeof q.userAnswer === 'string' && q.userAnswer !== '' && !isNaN(Number(q.userAnswer))) {
                // 0-indexed 문자열 (예: "2") → 1-indexed (예: "3")
                if (q.userAnswer.includes(',')) {
                  userAnswer = q.userAnswer.split(',').map((a: string) => String(Number(a.trim()) + 1)).join(',');
                } else {
                  userAnswer = String(Number(q.userAnswer) + 1);
                }
              } else {
                userAnswer = String(q.userAnswer);
              }
            } else if (q.type === 'ox') {
              const ua = typeof q.userAnswer === 'number' ? q.userAnswer : Number(q.userAnswer);
              if (ua === 0 || q.userAnswer === 'O') userAnswer = 'O';
              else if (ua === 1 || q.userAnswer === 'X') userAnswer = 'X';
              else userAnswer = String(q.userAnswer);
            } else {
              userAnswer = String(q.userAnswer);
            }
          }

          // quizResults에서 해당 문제 결과 가져오기
          // questionScores 키는 question ID (예: "q1", "q2" 또는 커스텀 ID)
          const questionId = q.id || `q${idx}`;
          const scoreData = questionScores[questionId];

          // scoreData.userAnswer 변환 (0-indexed 데이터면 1-indexed로 변환)
          let finalUserAnswer = userAnswer; // 기본값: 퀴즈 문서에서 변환한 값
          if (scoreData?.userAnswer !== undefined) {
            const rawUA = String(scoreData.userAnswer);
            if (scoreAnswerIsZeroIndexed && q.type === 'multiple') {
              // 0-indexed → 1-indexed 변환
              if (rawUA.includes(',')) {
                finalUserAnswer = rawUA.split(',').map((a: string) => String(Number(a.trim()) + 1)).join(',');
              } else if (rawUA !== '' && !isNaN(Number(rawUA))) {
                finalUserAnswer = String(Number(rawUA) + 1);
              } else {
                finalUserAnswer = rawUA;
              }
            } else {
              finalUserAnswer = rawUA;
            }
          }

          return {
            id: `library-${folderId}-${q.id || `q${idx}`}`,
            userId: user.uid,
            quizId: folderId,
            quizTitle: quizData.title || '퀴즈',
            questionId: q.id || `q${idx}`,
            question: q.text || '',
            type: q.type || 'multiple',
            options: q.choices || [],
            correctAnswer,
            userAnswer: finalUserAnswer,
            explanation: q.explanation || '',
            choiceExplanations: q.choiceExplanations || reviewChoiceExplanationsMap[q.id || `q${idx}`] || undefined,
            reviewType: scoreData?.isCorrect === false ? 'wrong' as const : 'solved' as const,
            isBookmarked: false,
            isCorrect: scoreData?.isCorrect ?? (q.isCorrect !== undefined ? q.isCorrect : undefined),
            reviewCount: 0,
            lastReviewedAt: null,
            createdAt: quizData.createdAt,
            // 이미지
            image: q.image || undefined,
            imageUrl: q.imageUrl || undefined,
            // 제시문
            passage: q.passage || undefined,
            passageType: q.passageType || undefined,
            passageImage: q.passageImage || undefined,
            koreanAbcItems: q.koreanAbcItems || undefined,
            passageMixedExamples: q.passageMixedExamples || undefined,
            commonQuestion: q.commonQuestion || undefined,
            // 보기
            mixedExamples: q.mixedExamples || undefined,
            bogi: q.bogi || undefined,
            subQuestionOptions: q.subQuestionOptions || undefined,
            subQuestionOptionsType: q.subQuestionOptionsType || undefined,
            subQuestionImage: q.subQuestionImage || undefined,
            // 발문
            passagePrompt: q.passagePrompt || undefined,
            bogiQuestionText: q.bogiQuestionText || undefined,
            // 결합형
            combinedGroupId: q.combinedGroupId || undefined,
            combinedIndex: q.combinedIndex,
            combinedTotal: q.combinedTotal,
            // 기타
            quizCreatorId: quizData.creatorId || undefined,
          };
        });

        setLibraryQuestions(sortByQuestionId(items));
      } catch (err) {
        console.error('서재 퀴즈 로드 오류:', err);
        setLibraryQuestions([]);
        setLibraryQuizTitle('');
      }
      setLibraryLoading(false);
    };

    loadLibraryQuiz();
  }, [user, folderType, folderId]);

  // 찜 퀴즈 폴백 로드 (bookmark 리뷰도 solved 리뷰도 없을 때 퀴즈 문서에서 직접 로드)
  useEffect(() => {
    if (!user || folderType !== 'bookmark') return;
    if (reviewLoading) return; // useReview 로딩 완료 대기

    // bookmark 또는 solved 리뷰가 있으면 폴백 불필요
    const hasBookmarkReviews = groupedBookmarkedItems.some(g => g.quizId === folderId);
    const hasSolvedReviews = groupedSolvedItems.some(g => g.quizId === folderId);
    if (hasBookmarkReviews || hasSolvedReviews) return;

    const loadBookmarkFallback = async () => {
      setBookmarkFallbackLoading(true);
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
        if (!quizDoc.exists()) {
          setBookmarkFallbackQuestions([]);
          setBookmarkFallbackTitle('');
          setBookmarkFallbackLoading(false);
          return;
        }

        const quizData = quizDoc.data();
        setBookmarkFallbackTitle(quizData.title || '퀴즈');

        const rawQuestions = quizData.questions || [];
        const items: ReviewItem[] = rawQuestions.map((q: any, idx: number) => {
          let correctAnswer = '';
          if (q.type === 'multiple') {
            if (Array.isArray(q.answer)) {
              correctAnswer = q.answer.map((a: number) => String(a + 1)).join(',');
            } else {
              correctAnswer = String((q.answer ?? 0) + 1);
            }
          } else if (q.type === 'ox') {
            correctAnswer = q.answer === 0 ? 'O' : 'X';
          } else {
            correctAnswer = String(q.answer ?? '');
          }

          const questionId = q.id || `q${idx}`;
          return {
            id: `fallback-${folderId}-${questionId}`,
            userId: user.uid,
            quizId: folderId,
            quizTitle: quizData.title || '퀴즈',
            questionId,
            question: q.question || q.text || '',
            type: q.type || 'multiple',
            options: q.choices || q.options || [],
            correctAnswer,
            userAnswer: '',
            explanation: q.explanation || '',
            reviewType: 'bookmark' as const,
            isBookmarked: true,
            isCorrect: undefined,
            reviewCount: 0,
            lastReviewedAt: null,
            createdAt: quizData.createdAt || Timestamp.now(),
            // 결합형 문제 필드
            combinedGroupId: q.combinedGroupId,
            combinedIndex: q.combinedIndex,
            combinedTotal: q.combinedTotal,
            passage: q.passage,
            passageType: q.passageType,
            passageImage: q.passageImage,
            koreanAbcItems: q.koreanAbcItems,
            passageMixedExamples: q.passageMixedExamples,
            commonQuestion: q.commonQuestion,
            image: q.image || q.imageUrl,
            mixedExamples: q.mixedExamples,
            subQuestionOptions: q.subQuestionOptions,
            subQuestionOptionsType: q.subQuestionOptionsType,
            subQuestionImage: q.subQuestionImage,
            choiceExplanations: q.choiceExplanations,
            passagePrompt: q.passagePrompt,
            bogiQuestionText: q.bogiQuestionText,
            bogi: q.bogi,
          } as ReviewItem;
        });

        setBookmarkFallbackQuestions(sortByQuestionId(items));
      } catch (err) {
        console.error('찜 퀴즈 폴백 로드 실패:', err);
        setBookmarkFallbackQuestions([]);
        setBookmarkFallbackTitle('');
      }
      setBookmarkFallbackLoading(false);
    };

    loadBookmarkFallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, folderType, folderId, reviewLoading, groupedBookmarkedItems, groupedSolvedItems]);

  // 최종 데이터
  const baseFolderTitle = folderData?.title || '';
  // 챕터 필터가 있으면 제목에 챕터 정보 추가
  const chapterName = chapterFilter && userCourse?.id
    ? getChapterById(userCourse.id, chapterFilter)?.name
    : null;
  const folderTitle = chapterName ? `${baseFolderTitle} (${chapterName})` : baseFolderTitle;
  const questions = folderType === 'library'
    ? libraryQuestions
    : folderType === 'custom'
      ? customQuestions
      : (folderData?.items || []);

  // 퀴즈별 creatorId 로드 (자기 문제 피드백 방지용)
  useEffect(() => {
    if (questions.length === 0) return;

    const loadQuizCreators = async () => {
      // 고유한 quizId 목록
      const quizIds = [...new Set(questions.map(q => q.quizId))];
      const newCreatorMap = new Map<string, string>();
      const newAiMap = new Map<string, boolean>();

      for (const quizId of quizIds) {
        // 이미 로드된 것은 스킵
        if (quizCreatorsMap.has(quizId)) {
          newCreatorMap.set(quizId, quizCreatorsMap.get(quizId)!);
          newAiMap.set(quizId, quizAiMap.get(quizId) || false);
          continue;
        }

        try {
          const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
          if (quizDoc.exists()) {
            const data = quizDoc.data();
            if (data?.creatorId) {
              newCreatorMap.set(quizId, data.creatorId);
            }
            newAiMap.set(quizId, data?.isAiGenerated || data?.type === 'ai-generated' || false);
          }
        } catch (err) {
          console.error(`퀴즈 ${quizId} creatorId 로드 실패:`, err);
        }
      }

      if (newCreatorMap.size > 0) {
        setQuizCreatorsMap(prev => {
          const merged = new Map(prev);
          newCreatorMap.forEach((v, k) => merged.set(k, v));
          return merged;
        });
      }
      if (newAiMap.size > 0) {
        setQuizAiMap(prev => {
          const merged = new Map(prev);
          newAiMap.forEach((v, k) => merged.set(k, v));
          return merged;
        });
      }
    };

    loadQuizCreators();
  }, [questions]);

  // 문제별 수정 여부 체크 (문제 아코디언 뱃지 표시용)
  useEffect(() => {
    if (questions.length === 0) return;
    // bookmark 타입은 문제지 단위만 표시하므로 문제별 뱃지 불필요
    if (folderType === 'bookmark') return;

    const checkQuestionUpdates = async () => {
      const newUpdatedIds = new Set<string>();
      // 고유 quizId별로 그룹화
      const quizIdToItems = new Map<string, ReviewItem[]>();
      for (const q of questions) {
        const list = quizIdToItems.get(q.quizId) || [];
        list.push(q);
        quizIdToItems.set(q.quizId, list);
      }

      for (const [quizId, items] of quizIdToItems) {
        try {
          const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
          if (!quizDoc.exists()) continue;

          const quizData = quizDoc.data();
          const quizQuestions = quizData?.questions || [];

          // quizQuestions를 questionId로 매핑
          const questionMap = new Map<string, any>();
          quizQuestions.forEach((q: any, idx: number) => {
            const qId = q.id || `q${idx}`;
            questionMap.set(qId, q);
          });

          for (const item of items) {
            const savedTime = item.quizUpdatedAt?.toMillis?.() || 0;
            if (!savedTime) continue;

            const quizQuestion = questionMap.get(item.questionId);
            if (!quizQuestion?.questionUpdatedAt) continue;

            const questionTime = quizQuestion.questionUpdatedAt.toMillis
              ? quizQuestion.questionUpdatedAt.toMillis()
              : 0;

            if (questionTime > savedTime) {
              newUpdatedIds.add(item.questionId);
            }
          }
        } catch (err) {
          console.error(`퀴즈 ${quizId} 문제 수정 여부 확인 실패:`, err);
        }
      }

      setUpdatedQuestionIds(newUpdatedIds);
    };

    checkQuestionUpdates();
  }, [questions, folderType]);

  // solved/bookmark/library 타입일 때 퀴즈 점수 가져오기
  useEffect(() => {
    if (!user || (folderType !== 'solved' && folderType !== 'bookmark' && folderType !== 'library')) {
      setQuizScores(null);
      return;
    }

    const loadQuizScores = async () => {
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
        if (quizDoc.exists()) {
          const data = quizDoc.data();
          setQuizScores({
            myScore: data.userScores?.[user.uid] ?? data.score,
            myFirstReviewScore: data.userFirstReviewScores?.[user.uid],
            averageScore: data.averageScore,
            isPublic: data.isPublic ?? false,
          });
        }
      } catch (err) {
        console.error('퀴즈 점수 로드 실패:', err);
      }
    };

    loadQuizScores();
  }, [user, folderType, folderId]);

  const loading = folderType === 'library'
    ? libraryLoading
    : folderType === 'custom'
      ? customLoading
      : folderType === 'bookmark'
        ? (!folderData && (reviewLoading || bookmarkFallbackLoading))
        : !folderData;

  // displayItems 계산 (결합형 문제 그룹핑)
  const displayItems = useMemo(() => {
    return createDisplayItems(questions);
  }, [questions]);

  // 결합형 그룹 펼침/접힘 토글
  const toggleGroupExpand = useCallback((groupId: string) => {
    setExpandedGroupIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  }, []);

  // 문제 선택/해제
  const handleSelectQuestion = (questionId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(questionId)) {
      newSelected.delete(questionId);
    } else {
      newSelected.add(questionId);
    }
    setSelectedIds(newSelected);
  };

  // 선택된 문제로 연습 시작 (전체 복습)
  const handleStartPractice = () => {
    const targetItems = selectedIds.size === 0
      ? questions
      : questions.filter(q => selectedIds.has(q.id));

    if (targetItems.length === 0) {
      // 복습할 문제가 없으면 임시 메시지 표시
      setShowEmptyMessage(true);
      setTimeout(() => setShowEmptyMessage(false), 500);
      return;
    }

    setPracticeMode('all'); // 전체 복습 모드
    setPracticeItems(targetItems);
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  // 오답만 복습하기
  const handleStartWrongOnlyPractice = () => {
    // 현재 questions 중에서 wrongItems에도 있는 것만 필터링
    const wrongQuestionKeys = new Set(
      wrongItems
        .filter(w => w.quizId === folderId)
        .map(w => `${w.quizId}:${w.questionId}`)
    );

    const wrongOnlyItems = questions.filter(q =>
      wrongQuestionKeys.has(`${q.quizId}:${q.questionId}`)
    );

    if (wrongOnlyItems.length === 0) {
      showToast('이 문제지에 오답이 없습니다');
      return;
    }

    setPracticeMode('wrongOnly'); // 오답만 복습 모드 (첫복습점수 저장 안함)
    setPracticeItems(wrongOnlyItems);
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  // 수정 모드 진입 핸들러
  const handleEnterEditMode = () => {
    setEditedTitle(libraryQuizTitle);
    setEditedQuestions({});
    setIsEditMode(true);
  };

  // 수정 모드 저장 핸들러 (제목 + 문제 일괄 저장)
  const handleSaveEdits = async () => {
    const editedKeys = Object.keys(editedQuestions);
    const titleChanged = editedTitle.trim() && editedTitle.trim() !== libraryQuizTitle;

    if (editedKeys.length === 0 && !titleChanged) {
      setIsEditMode(false);
      return;
    }

    setIsSavingEdit(true);
    try {
      const updateData: Record<string, any> = {};

      // 제목 변경
      if (titleChanged) {
        updateData.title = editedTitle.trim();
      }

      // 문제 변경
      if (editedKeys.length > 0) {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
        if (!quizDoc.exists()) {
          showToast('퀴즈를 찾을 수 없습니다');
          setIsSavingEdit(false);
          return;
        }

        const quizData = quizDoc.data();
        const updatedQs = [...(quizData.questions || [])];

        // 로컬 libraryQuestions의 choiceExplanations를 questionId로 매핑
        // (reviews 폴백으로 로드된 데이터가 퀴즈 문서에 없을 수 있음)
        const localChoiceExpsMap = new Map<string, string[]>();
        libraryQuestions.forEach(item => {
          if (item.choiceExplanations && item.choiceExplanations.length > 0) {
            localChoiceExpsMap.set(item.questionId, item.choiceExplanations);
          }
        });

        // 모든 문제의 choiceExplanations를 퀴즈 문서에 동기화
        updatedQs.forEach((q: any, idx: number) => {
          const qId = q.id || `q${idx}`;
          if (!q.choiceExplanations) {
            const localExps = localChoiceExpsMap.get(qId);
            if (localExps) {
              q.choiceExplanations = localExps;
            }
          }
        });

        for (const questionId of editedKeys) {
          const edits = editedQuestions[questionId];
          const qIdx = updatedQs.findIndex((q: any, idx: number) => (q.id || `q${idx}`) === questionId);
          if (qIdx === -1) continue;

          if (edits.question !== undefined) updatedQs[qIdx].text = edits.question;
          if (edits.options !== undefined) updatedQs[qIdx].choices = edits.options;
          if (edits.explanation !== undefined) updatedQs[qIdx].explanation = edits.explanation;
          if (edits.choiceExplanations !== undefined) updatedQs[qIdx].choiceExplanations = edits.choiceExplanations;
        }

        updateData.questions = updatedQs;
      }

      await updateDoc(doc(db, 'quizzes', folderId), updateData);

      // 로컬 state 갱신
      if (titleChanged) {
        setLibraryQuizTitle(editedTitle.trim());
      }
      if (editedKeys.length > 0) {
        setLibraryQuestions(prev =>
          prev.map(item => {
            const edits = editedQuestions[item.questionId];
            if (!edits) return item;
            return {
              ...item,
              question: edits.question ?? item.question,
              options: edits.options ?? item.options,
              explanation: edits.explanation ?? item.explanation,
              choiceExplanations: edits.choiceExplanations ?? item.choiceExplanations,
            };
          })
        );
      }

      setIsEditMode(false);
      setEditedQuestions({});
      showToast('수정 완료');
    } catch (err) {
      console.error('수정 실패:', err);
      showToast('수정에 실패했습니다');
    }
    setIsSavingEdit(false);
  };

  // 수정 모드 취소 핸들러
  const handleCancelEdit = () => {
    setIsEditMode(false);
    setEditedQuestions({});
    setEditedTitle('');
  };

  // 현재 문제지의 오답 개수 계산
  const wrongCount = useMemo(() => {
    if (folderType === 'wrong') return questions.length; // 이미 오답만 보여주는 경우
    const wrongQuestionKeys = new Set(
      wrongItems
        .filter(w => w.quizId === folderId)
        .map(w => `${w.quizId}:${w.questionId}`)
    );
    return questions.filter(q => wrongQuestionKeys.has(`${q.quizId}:${q.questionId}`)).length;
  }, [folderType, folderId, questions, wrongItems]);

  // 퀴즈 페이지에서 autoStart 파라미터로 바로 복습 시작
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartedRef.current || loading || questions.length === 0) return;
    autoStartedRef.current = true;

    if (autoStart === 'wrongOnly') {
      // wrong 타입: 이미 오답만 로드됨 → 전체 복습
      if (folderType === 'wrong') {
        setPracticeMode('wrongOnly');
        setPracticeItems(questions);
      } else {
        // library 타입에서 오답만 필터링
        const wrongQuestionKeys = new Set(
          wrongItems
            .filter(w => w.quizId === folderId)
            .map(w => `${w.quizId}:${w.questionId}`)
        );
        const wrongOnlyItems = questions.filter(q =>
          wrongQuestionKeys.has(`${q.quizId}:${q.questionId}`)
        );
        if (wrongOnlyItems.length > 0) {
          setPracticeMode('wrongOnly');
          setPracticeItems(wrongOnlyItems);
        }
      }
    } else {
      // autoStart === 'all'
      setPracticeMode('all');
      setPracticeItems(questions);
    }
  }, [autoStart, loading, questions, wrongItems, folderType, folderId]);

  // 선택된 퀴즈의 문제 목록 가져오기
  const getSelectedQuizItems = () => {
    if (!selectedQuizForAdd) return [];
    const items = solvedItems.filter(item => item.quizId === selectedQuizForAdd.quizId);
    return sortByQuestionId(items);
  };

  // 이미 폴더에 추가된 문제 키 목록 (quizId:questionId 조합)
  const alreadyAddedQuestionKeys = useMemo(() => {
    if (folderType !== 'custom' || !customFolder) return new Set<string>();
    return new Set(customFolder.questions.map((q: CustomFolderQuestion) => `${q.quizId}:${q.questionId}`));
  }, [folderType, customFolder]);

  // 문제 추가 선택/해제 (quizId:questionId 조합으로 중복 방지)
  // 결합형 문제는 모든 하위 문제를 함께 선택/해제
  const handleAddSelect = (item: ReviewItem) => {
    const key = `${item.quizId}:${item.questionId}`;
    // 이미 폴더에 있는 문제는 선택 불가
    if (alreadyAddedQuestionKeys.has(key)) return;

    const newSelected = new Set(addSelectedIds);

    // 결합형 문제인 경우: 같은 그룹의 모든 하위 문제를 함께 선택/해제
    if (item.combinedGroupId) {
      // 같은 combinedGroupId를 가진 모든 문제 찾기
      const groupItems = solvedItems.filter(
        i => i.combinedGroupId === item.combinedGroupId && i.quizId === item.quizId
      );
      const groupKeys = groupItems.map(i => `${i.quizId}:${i.questionId}`);

      // 하나라도 선택되어 있으면 전체 해제, 아니면 전체 선택
      const anySelected = groupKeys.some(k => newSelected.has(k));
      if (anySelected) {
        groupKeys.forEach(k => newSelected.delete(k));
      } else {
        // 이미 폴더에 있지 않은 것만 선택
        groupKeys.forEach(k => {
          if (!alreadyAddedQuestionKeys.has(k)) {
            newSelected.add(k);
          }
        });
      }
    } else {
      // 일반 문제: 개별 선택/해제
      if (newSelected.has(key)) {
        newSelected.delete(key);
      } else {
        newSelected.add(key);
      }
    }
    setAddSelectedIds(newSelected);
  };

  // 선택된 문제의 실제 수 계산 (결합형은 1문제로 계산)
  const actualSelectedCount = useMemo(() => {
    if (addSelectedIds.size === 0) return 0;
    const seenCombinedGroups = new Set<string>();
    let count = 0;
    for (const key of addSelectedIds) {
      const colonIndex = key.indexOf(':');
      if (colonIndex === -1) continue;
      const quizId = key.substring(0, colonIndex);
      const questionId = key.substring(colonIndex + 1);
      const item = solvedItems.find(i => i.questionId === questionId && i.quizId === quizId);
      if (item) {
        if (item.combinedGroupId) {
          if (!seenCombinedGroups.has(item.combinedGroupId)) {
            seenCombinedGroups.add(item.combinedGroupId);
            count++;
          }
        } else {
          count++;
        }
      }
    }
    return count;
  }, [addSelectedIds, solvedItems]);

  // 선택된 문제들 삭제
  const handleDeleteSelectedQuestions = async () => {
    if (selectedIds.size === 0) return;

    const confirmed = window.confirm(`선택한 ${selectedIds.size}개의 문제를 삭제하시겠습니까?`);
    if (!confirmed) return;

    const deletedCount = selectedIds.size;

    try {
      if (folderType === 'custom') {
        // 커스텀 폴더에서 문제 제거
        for (const itemId of selectedIds) {
          const item = questions.find(q => q.id === itemId);
          if (item) {
            await removeFromCustomFolder(folderId, item.questionId);
          }
        }
        setCustomQuestions(prev => prev.filter(q => !selectedIds.has(q.id)));
      } else {
        // reviews에서 직접 삭제
        for (const itemId of selectedIds) {
          await deleteReviewItem(itemId);
        }
      }
      // 삭제된 항목만 선택에서 제거 (선택 모드 유지)
      setSelectedIds(new Set());
      showToast(`${deletedCount}개 문제 삭제 완료`);
    } catch (err) {
      console.error('문제 삭제 실패:', err);
      alert('삭제에 실패했습니다.');
    }
  };

  // 문제 추가 확정
  const handleAddQuestions = async () => {
    if (actualSelectedCount === 0) return;

    try {
      // 선택된 키(quizId:questionId) 기준으로 문제 찾기
      const selectedKeys = Array.from(addSelectedIds);
      const uniqueItems: ReviewItem[] = [];
      const seenKeys = new Set<string>();

      for (const key of selectedKeys) {
        if (seenKeys.has(key)) continue;
        const colonIndex = key.indexOf(':');
        if (colonIndex === -1) continue;
        const quizId = key.substring(0, colonIndex);
        const questionId = key.substring(colonIndex + 1);
        const item = solvedItems.find(i =>
          i.questionId === questionId && i.quizId === quizId
        );
        if (item) {
          uniqueItems.push(item);
          seenKeys.add(key);
        }
      }

      const questionsToAdd = uniqueItems.map(item => ({
        questionId: item.questionId,
        quizId: item.quizId,
        quizTitle: item.quizTitle || '',
        combinedGroupId: item.combinedGroupId || null, // 결합형 그룹 ID 포함
      }));

      await addToCustomFolder(folderId, questionsToAdd);

      // 추가된 문제 UI 업데이트
      setCustomQuestions(prev => [...prev, ...uniqueItems]);

      // 바텀시트 닫고 선택 초기화
      setSelectedQuizForAdd(null);
      setAddSelectedIds(new Set());

      // 실제 문제 수 계산 (결합형은 1문제로 계산)
      const combinedGroups = new Set<string>();
      let actualQuestionCount = 0;
      for (const item of uniqueItems) {
        if (item.combinedGroupId) {
          if (!combinedGroups.has(item.combinedGroupId)) {
            combinedGroups.add(item.combinedGroupId);
            actualQuestionCount++;
          }
        } else {
          actualQuestionCount++;
        }
      }
      showToast(`${actualQuestionCount}개 문제 추가 완료`);
    } catch (err) {
      console.error('문제 추가 실패:', err);
      alert('추가에 실패했습니다.');
    }
  };

  // 카테고리 추가 핸들러
  const handleAddCategory = async () => {
    if (!newCategoryName.trim() || folderType !== 'custom') return;

    try {
      await addCategoryToFolder(folderId, newCategoryName.trim());
      setNewCategoryName('');
    } catch (err) {
      console.error('카테고리 추가 실패:', err);
      alert('카테고리 추가에 실패했습니다.');
    }
  };

  // 카테고리 삭제 핸들러
  const handleRemoveCategory = async (categoryId: string) => {
    if (folderType !== 'custom') return;

    const confirmed = window.confirm('이 카테고리를 삭제하시겠습니까? 해당 문제들은 미분류로 변경됩니다.');
    if (!confirmed) return;

    try {
      await removeCategoryFromFolder(folderId, categoryId);
    } catch (err) {
      console.error('카테고리 삭제 실패:', err);
      alert('카테고리 삭제에 실패했습니다.');
    }
  };

  // 문제 카테고리 배정 핸들러
  const handleAssignToCategory = async (questionId: string, categoryId: string | null) => {
    if (folderType !== 'custom') return;

    try {
      await assignQuestionToCategory(folderId, questionId, categoryId);
      // 로컬 상태 업데이트
      setCustomQuestions(prev => prev.map(q => {
        if (q.questionId === questionId) {
          return { ...q, categoryId: categoryId || undefined } as ReviewItem & { categoryId?: string };
        }
        return q;
      }));
    } catch (err) {
      console.error('카테고리 배정 실패:', err);
    }
  };

  // 선택된 문제들을 카테고리에 일괄 배정
  const handleBulkAssign = async () => {
    if (selectedIds.size === 0 || !selectedCategoryForAssign) return;

    try {
      for (const itemId of selectedIds) {
        const item = questions.find(q => q.id === itemId);
        if (item) {
          await assignQuestionToCategory(folderId, item.questionId, selectedCategoryForAssign);
        }
      }
      // 로컬 상태 업데이트
      setCustomQuestions(prev => prev.map(q => {
        if (selectedIds.has(q.id)) {
          return { ...q, categoryId: selectedCategoryForAssign || undefined } as ReviewItem & { categoryId?: string };
        }
        return q;
      }));
      setSelectedIds(new Set());
      setIsSelectMode(false);
      setIsAssignMode(false);
      setSelectedCategoryForAssign(null);
    } catch (err) {
      console.error('일괄 배정 실패:', err);
      alert('배정에 실패했습니다.');
    }
  };

  // 카테고리별로 문제 그룹핑
  const groupedByCategory = useMemo(() => {
    if (folderType !== 'custom' || !customFolder?.categories?.length) {
      return null;
    }

    const categories = customFolder.categories;
    const folderQuestions = customFolder.questions || [];

    // 각 카테고리별 문제 그룹
    const groups: { category: FolderCategory | null; items: ReviewItem[] }[] = [];

    // 미분류 그룹
    const uncategorized: ReviewItem[] = [];

    // 카테고리별로 문제 분류
    for (const category of categories) {
      const categoryQuestionIds = folderQuestions
        .filter((q: CustomFolderQuestion) => q.categoryId === category.id)
        .map((q: CustomFolderQuestion) => q.questionId);

      const categoryItems = customQuestions.filter(q =>
        categoryQuestionIds.includes(q.questionId)
      );

      groups.push({ category, items: categoryItems });
    }

    // 미분류 문제
    const categorizedQuestionIds = folderQuestions
      .filter((q: CustomFolderQuestion) => q.categoryId)
      .map((q: CustomFolderQuestion) => q.questionId);

    const uncategorizedItems = customQuestions.filter(q =>
      !categorizedQuestionIds.includes(q.questionId)
    );

    if (uncategorizedItems.length > 0) {
      groups.push({ category: null, items: uncategorizedItems });
    }

    return groups;
  }, [folderType, customFolder, customQuestions]);

  // 피드백 제출 핸들러
  const handleFeedbackSubmit = async (questionId: string, type: FeedbackType, content: string) => {
    if (!user) return;

    // 문제 정보 찾기
    const item = questions.find(q => q.questionId === questionId);
    const quizId = item?.quizId || folderId;

    // quizCreatorId 결정: 1) 리뷰 아이템에서, 2) quizCreatorsMap에서
    const creatorId = item?.quizCreatorId || quizCreatorsMap.get(quizId) || null;

    // questionId에서 문제 번호 추출 (예: "q0" → 1, "q2-1" → 3)
    const [mainIdx] = parseQuestionId(questionId);
    const questionNumber = mainIdx + 1;

    const feedbackRef = collection(db, 'questionFeedbacks');
    await addDoc(feedbackRef, {
      questionId,
      quizId,
      quizCreatorId: creatorId, // 퀴즈 생성자 ID (조회 최적화용)
      userId: user.uid,
      questionNumber, // 문제 번호 (표시용)
      type,
      content,
      createdAt: serverTimestamp(),
    });
  };

  // autoStart 모드: 데이터 로딩 중이면 로딩 스피너만 표시 (폴더 상세 안 보여줌)
  if (autoStart && !practiceItems && (loading || questions.length === 0)) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
          <p className="text-[#3A3A3A] text-sm">복습 준비 중...</p>
        </div>
      </div>
    );
  }

  // 연습 모드
  if (practiceItems) {
    return (
      <ReviewPractice
        items={practiceItems}
        quizTitle={folderTitle}
        onComplete={async (results: PracticeResult[]) => {
          // 복습 완료된 문제 reviewCount 증가 (복습력 측정용)
          for (const r of results) {
            try { await markAsReviewed(r.reviewId); } catch { /* 개별 실패 무시 */ }
          }

          // 수정된 문제 재풀이 완료 시:
          // 1. quizResults에 새 응답 저장 (통계 반영용)
          // 2. reviews.quizUpdatedAt 업데이트 (뱃지 제거용)
          if (folderId && user && folderType !== 'custom') {
            try {
              // 현재 퀴즈의 정보 가져오기
              const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
              if (quizDoc.exists()) {
                const quizData = quizDoc.data();
                const currentQuizUpdatedAt = quizData.updatedAt || quizData.createdAt || null;

                // 1. quizResults에 새 응답 저장 (통계에 반영)
                if (results.length > 0) {
                  // 기존 quizResults 문서 찾기
                  const existingResultQuery = query(
                    collection(db, 'quizResults'),
                    where('userId', '==', user.uid),
                    where('quizId', '==', folderId)
                  );
                  const existingResults = await getDocs(existingResultQuery);

                  // 새로운 questionScores 데이터 생성
                  const newQuestionScores: Record<string, {
                    isCorrect: boolean;
                    userAnswer: string;
                    answeredAt: any;
                  }> = {};

                  results.forEach((result) => {
                    newQuestionScores[result.questionId] = {
                      isCorrect: result.isCorrect,
                      userAnswer: result.userAnswer,
                      answeredAt: serverTimestamp(),
                    };
                  });

                  if (!existingResults.empty) {
                    // 기존 문서가 있으면 questionScores만 업데이트
                    const existingDoc = existingResults.docs[0];
                    const existingData = existingDoc.data();
                    const existingScores = existingData.questionScores || {};

                    // 기존 점수와 새 점수 병합 (새 점수가 우선)
                    const mergedScores = { ...existingScores, ...newQuestionScores };

                    // 정답 수 재계산
                    const newCorrectCount = Object.values(mergedScores).filter(
                      (s: any) => s.isCorrect
                    ).length;
                    const totalCount = quizData.questions?.length || Object.keys(mergedScores).length;
                    const newScore = Math.round((newCorrectCount / totalCount) * 100);

                    await updateDoc(existingDoc.ref, {
                      questionScores: mergedScores,
                      correctCount: newCorrectCount,
                      score: newScore,
                      isUpdate: true, // 재풀이 표시
                      updatedAt: serverTimestamp(),
                    });
                  } else {
                    // 기존 문서가 없으면 새로 생성 (드문 경우)
                    const correctCount = results.filter(r => r.isCorrect).length;
                    const totalCount = quizData.questions?.length || results.length;
                    const score = Math.round((correctCount / totalCount) * 100);

                    await addDoc(collection(db, 'quizResults'), {
                      userId: user.uid,
                      quizId: folderId,
                      quizTitle: quizData.title || '퀴즈',
                      quizCreatorId: quizData.creatorId || null,
                      score,
                      correctCount,
                      totalCount,
                      earnedExp: 0, // 복습 연습은 EXP 없음
                      questionScores: newQuestionScores,
                      isUpdate: true,
                      courseId: quizData.courseId || null,
                      classId: userClassId || null, // 사용자의 반 정보 사용
                      createdAt: serverTimestamp(),
                    });
                  }
                }

                // 2. 첫 복습 점수 저장 (전체 복습 모드에서만, 최초 1회)
                if (practiceMode === 'all' && results.length > 0) {
                  const existingReviewScore = quizData.userFirstReviewScores?.[user.uid];
                  if (existingReviewScore === undefined) {
                    const correctCount = results.filter(r => r.isCorrect).length;
                    const totalCount = quizData.questions?.length || results.length;
                    const reviewScore = Math.round((correctCount / totalCount) * 100);
                    await updateDoc(doc(db, 'quizzes', folderId), {
                      [`userFirstReviewScores.${user.uid}`]: reviewScore,
                    });
                  }
                }

                // 3. 복습 연습 EXP 지급용 quizResults 문서 생성 (CF 트리거)
                if (results.length > 0) {
                  const correctCount = results.filter(r => r.isCorrect).length;
                  const totalCount = quizData.questions?.length || results.length;
                  const reviewScore = Math.round((correctCount / totalCount) * 100);

                  await addDoc(collection(db, 'quizResults'), {
                    userId: user.uid,
                    quizId: folderId,
                    quizTitle: quizData.title || '퀴즈',
                    score: reviewScore,
                    correctCount,
                    totalCount,
                    isReviewPractice: true,
                    courseId: quizData.courseId || null,
                    classId: userClassId || null,
                    createdAt: serverTimestamp(),
                  });

                  // EXP 토스트는 ReviewPractice의 handleFinish에서 이미 표시됨
                  // CF에서 25 EXP 지급하지만 토스트 중복 방지
                }

                // 4. 해당 퀴즈의 모든 reviews 문서 업데이트 (뱃지 제거)
                const reviewsQuery = query(
                  collection(db, 'reviews'),
                  where('userId', '==', user.uid),
                  where('quizId', '==', folderId)
                );
                const reviewsSnapshot = await getDocs(reviewsQuery);

                for (const reviewDoc of reviewsSnapshot.docs) {
                  await updateDoc(reviewDoc.ref, { quizUpdatedAt: currentQuizUpdatedAt });
                }
              }
            } catch (err) {
              console.error('복습 결과 저장 실패:', err);
            }
          }

          if (autoStart) {
            router.back();
          } else {
            setPracticeItems(null);
            setPracticeMode(null);
          }
        }}
        onClose={() => {
          if (autoStart) {
            router.back();
          } else {
            setPracticeItems(null);
            setPracticeMode(null);
          }
        }}
        currentUserId={user?.uid}
      />
    );
  }

  // 문제 추가 모드 - 폴더 선택 화면
  if (isAddMode && folderType === 'custom') {
    const quizItems = getSelectedQuizItems();

    return (
      <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
        {/* 헤더 */}
        <header className="sticky top-0 z-50 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]">
          <div className="flex items-center justify-between h-14 px-4" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
            <button
              onClick={() => {
                setIsAddMode(false);
                setAddSelectedIds(new Set());
                setSelectedQuizForAdd(null);
              }}
              className="text-[#1A1A1A] font-bold"
            >
              닫기
            </button>
            <h1 className="text-base font-bold text-[#1A1A1A]">문제 추가</h1>
            <div className="w-10" /> {/* 균형 맞추기 */}
          </div>
        </header>

        {/* 안내 문구 */}
        <div className="px-4 py-3 border-b border-[#EDEAE4]">
          <p className="text-sm text-[#5C5C5C]">추가할 문제가 있는 문제지를 선택하세요</p>
        </div>

        {/* 퀴즈 폴더 목록 */}
        <main className="px-4 py-4">
          {groupedSolvedItems.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-[#5C5C5C]">풀었던 문제지가 없습니다.</p>
              <p className="text-xs text-[#5C5C5C] mt-2">퀴즈를 풀면 여기에 표시됩니다.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {groupedSolvedItems.map((group) => {
                // 해당 퀴즈에서 이미 추가된 문제 수 계산 (결합형은 1문제로 계산)
                const totalCount = group.questionCount;
                // 이미 추가된 문제 카운트 (결합형은 1개로)
                const addedItems = group.items.filter(item =>
                  alreadyAddedQuestionKeys.has(`${item.quizId}:${item.questionId}`)
                );
                const seenCombinedGroups = new Set<string>();
                let addedCount = 0;
                for (const item of addedItems) {
                  if (item.combinedGroupId) {
                    if (!seenCombinedGroups.has(item.combinedGroupId)) {
                      seenCombinedGroups.add(item.combinedGroupId);
                      addedCount++;
                    }
                  } else {
                    addedCount++;
                  }
                }
                const remainingCount = totalCount - addedCount;

                return (
                  <button
                    key={group.quizId}
                    onClick={() => setSelectedQuizForAdd({ quizId: group.quizId, quizTitle: group.quizTitle })}
                    className="p-3 border border-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors text-left"
                  >
                    {/* 폴더 아이콘 */}
                    <div className="flex justify-center mb-2">
                      <svg className="w-10 h-10 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </div>
                    {/* 제목 */}
                    <h3 className="font-bold text-xs text-center line-clamp-2 mb-1 text-[#1A1A1A]">
                      {group.quizTitle}
                    </h3>
                    {/* 문제 수 */}
                    <p className="text-[10px] text-center text-[#5C5C5C]">
                      {remainingCount > 0 ? (
                        <>{remainingCount}문제 추가 가능</>
                      ) : (
                        <span className="text-[#8B1A1A]">모두 추가됨</span>
                      )}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </main>

        {/* 바텀시트 - 퀴즈 선택 시 문제 목록 표시 */}
        <AnimatePresence>
          {selectedQuizForAdd && (
            <>
              {/* 오버레이 */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  setSelectedQuizForAdd(null);
                  setAddSelectedIds(new Set());
                }}
                className="fixed inset-0 bg-black/50 z-50"
              />
              {/* 바텀시트 */}
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="fixed bottom-0 left-0 right-0 z-50 bg-[#F5F0E8] border-t-2 border-[#1A1A1A] max-h-[70vh] flex flex-col"
              >
                {/* 바텀시트 헤더 */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#EDEAE4] flex-shrink-0">
                  <button
                    onClick={() => {
                      setSelectedQuizForAdd(null);
                      setAddSelectedIds(new Set());
                    }}
                    className="text-sm text-[#5C5C5C]"
                  >
                    취소
                  </button>
                  <h2 className="font-bold text-sm text-[#1A1A1A] line-clamp-1 max-w-[200px]">
                    {selectedQuizForAdd.quizTitle}
                  </h2>
                  <button
                    onClick={handleAddQuestions}
                    disabled={actualSelectedCount === 0}
                    className="text-sm font-bold text-[#1A1A1A] disabled:opacity-30"
                  >
                    추가 ({actualSelectedCount})
                  </button>
                </div>

                {/* 문제 목록 - 결합형은 그룹으로 표시 */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                  {quizItems.length === 0 ? (
                    <p className="py-8 text-center text-[#5C5C5C]">문제가 없습니다.</p>
                  ) : (
                    (() => {
                      // 결합형 그룹핑: combinedGroupId로 묶기
                      const displayItems: Array<{ type: 'single'; item: ReviewItem } | { type: 'combined'; groupId: string; items: ReviewItem[] }> = [];
                      const seenCombinedGroups = new Set<string>();

                      for (const item of quizItems) {
                        if (item.combinedGroupId) {
                          if (!seenCombinedGroups.has(item.combinedGroupId)) {
                            seenCombinedGroups.add(item.combinedGroupId);
                            const groupItems = quizItems.filter(i => i.combinedGroupId === item.combinedGroupId);
                            displayItems.push({ type: 'combined', groupId: item.combinedGroupId, items: groupItems });
                          }
                        } else {
                          displayItems.push({ type: 'single', item });
                        }
                      }

                      return displayItems.map((displayItem, idx) => {
                        if (displayItem.type === 'single') {
                          const item = displayItem.item;
                          const itemKey = `${item.quizId}:${item.questionId}`;
                          const isAlreadyAdded = alreadyAddedQuestionKeys.has(itemKey);
                          const isSelected = addSelectedIds.has(itemKey);

                          return (
                            <div
                              key={`single-${item.id}-${item.questionId}`}
                              onClick={() => !isAlreadyAdded && handleAddSelect(item)}
                              className={`p-3 border transition-all ${
                                isAlreadyAdded
                                  ? 'border-[#5C5C5C] bg-[#EDEAE4] cursor-not-allowed opacity-60'
                                  : isSelected
                                    ? 'border-2 border-[#1A1A1A] bg-[#EDEAE4] cursor-pointer'
                                    : 'border-[#1A1A1A] bg-white cursor-pointer'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                  isAlreadyAdded ? 'bg-[#5C5C5C]' : isSelected ? 'bg-[#1A1A1A]' : 'border border-[#5C5C5C]'
                                }`}>
                                  {(isSelected || isAlreadyAdded) && (
                                    <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  {isAlreadyAdded && (
                                    <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold bg-[#5C5C5C] text-[#F5F0E8] mb-1">
                                      이미 추가됨
                                    </span>
                                  )}
                                  <p className={`text-sm line-clamp-2 ${isAlreadyAdded ? 'text-[#5C5C5C]' : 'text-[#1A1A1A]'}`}>
                                    {item.question}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        } else {
                          // 결합형 문제 그룹
                          const { groupId, items: groupItems } = displayItem;
                          const firstItem = groupItems[0];
                          const isExpanded = expandedCombinedGroups.has(groupId);
                          // 그룹 내 모든 하위 문제가 이미 추가되었는지
                          const allAdded = groupItems.every(i => alreadyAddedQuestionKeys.has(`${i.quizId}:${i.questionId}`));
                          // 그룹 내 하나라도 선택되었는지
                          const isSelected = groupItems.some(i => addSelectedIds.has(`${i.quizId}:${i.questionId}`));
                          // 공통 지문/이미지 가져오기
                          const passage = firstItem.passage || firstItem.commonQuestion || '';
                          const passageImage = firstItem.passageImage;

                          return (
                            <div
                              key={`combined-${groupId}`}
                              className={`border transition-all ${
                                allAdded
                                  ? 'border-[#5C5C5C] bg-[#EDEAE4] opacity-60'
                                  : isSelected
                                    ? 'border-2 border-[#1A1A1A] bg-[#EDEAE4]'
                                    : 'border-[#1A1A1A] bg-white'
                              }`}
                            >
                              {/* 결합형 헤더 - 클릭 시 선택 */}
                              <div
                                onClick={() => !allAdded && handleAddSelect(firstItem)}
                                className={`p-3 ${allAdded ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                    allAdded ? 'bg-[#5C5C5C]' : isSelected ? 'bg-[#1A1A1A]' : 'border border-[#5C5C5C]'
                                  }`}>
                                    {(isSelected || allAdded) && (
                                      <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    {allAdded && (
                                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold bg-[#5C5C5C] text-[#F5F0E8] mb-1">
                                        이미 추가됨
                                      </span>
                                    )}
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold bg-[#1A1A1A] text-[#F5F0E8]">
                                        결합형
                                      </span>
                                      <span className="text-[10px] text-[#5C5C5C]">
                                        하위 {groupItems.length}문제
                                      </span>
                                    </div>
                                    <p className={`text-sm line-clamp-2 ${allAdded ? 'text-[#5C5C5C]' : 'text-[#1A1A1A]'}`}>
                                      {passage || '(공통 지문 없음)'}
                                    </p>
                                  </div>
                                </div>
                              </div>
                              {/* 아코디언 토글 버튼 */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedCombinedGroups(prev => {
                                    const newSet = new Set(prev);
                                    if (newSet.has(groupId)) {
                                      newSet.delete(groupId);
                                    } else {
                                      newSet.add(groupId);
                                    }
                                    return newSet;
                                  });
                                }}
                                className="w-full py-2 border-t border-[#E8D9A8] text-xs text-[#5C5C5C] hover:bg-[#EDEAE4] flex items-center justify-center gap-1"
                              >
                                {isExpanded ? '접기' : `하위 문제 보기 (${groupItems.length})`}
                                <svg
                                  className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              {/* 하위 문제 목록 */}
                              {isExpanded && (
                                <div className="border-t border-[#E8D9A8] bg-[#FFFDF7] px-3 py-2 space-y-1">
                                  {groupItems.map((subItem, subIdx) => (
                                    <div key={subItem.questionId} className="text-xs text-[#5C5C5C] py-1">
                                      <span className="font-bold mr-1">{subIdx + 1}.</span>
                                      <span className="line-clamp-1">{subItem.question}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        }
                      });
                    })()
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // 필터 변경 핸들러 (리뷰 페이지로 이동)
  const handleFilterChange = (filter: ReviewFilter) => {
    // 현재 폴더 타입과 다른 필터를 선택하면 리뷰 페이지로 이동
    if (filter !== folderType) {
      router.push(`/review?filter=${filter}`);
    }
  };

  return (
    <motion.div
      className="min-h-screen pb-24" style={{ backgroundColor: '#F5F0E8' }}
      initial={slideIn ? { opacity: 0, x: 60 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 35 }}
    >
      {/* 헤더 - 배너 이미지 */}
      <header className="pt-2 pb-1 flex flex-col items-center">
        {/* 리본 이미지 — 퀴즈 페이지와 동일 크기 */}
        <div className="w-full h-[160px] mt-2">
          <img
            src={ribbonImage}
            alt="Review"
            className="w-full h-full object-contain"
            style={{ transform: `scale(${ribbonScale}) scaleX(1.15)` }}
          />
        </div>

        {/* 필터 + 이전 버튼 영역 */}
        <div className="w-full px-4 py-1">
          {folderType === 'solved' ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => router.back()}
                  className="p-1 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors flex-shrink-0"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h2 className="text-2xl font-black text-[#1A1A1A] truncate flex-1">
                  {folderTitle}
                </h2>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center">
                    <span className="text-4xl font-serif font-bold text-[#1A1A1A]" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>
                      {quizScores?.myScore !== undefined ? quizScores.myScore : '-'}
                    </span>
                    <span className="text-sm text-[#5C5C5C] mt-2">퀴즈</span>
                  </div>
                  <span className="text-2xl text-[#5C5C5C] font-serif" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>/</span>
                  <div className="flex flex-col items-center">
                    <span className="text-4xl font-serif font-bold text-[#1A1A1A]" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>
                      {quizScores?.myFirstReviewScore !== undefined ? quizScores.myFirstReviewScore : '-'}
                    </span>
                    <span className="text-sm text-[#5C5C5C] mt-2">복습</span>
                  </div>
                </div>
                {quizScores?.isPublic && (
                  <div className="flex flex-col items-center">
                    <span className="text-4xl font-serif font-bold text-[#1A1A1A]" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>
                      {quizScores?.averageScore !== undefined ? Math.round(quizScores.averageScore) : '-'}
                    </span>
                    <span className="text-sm text-[#5C5C5C] mt-2">평균</span>
                  </div>
                )}
              </div>
            </>
          ) : fromQuizPage ? (
            /* 퀴즈 페이지 복습탭에서 온 경우: 빈 — 제목은 아래 섹션에서 표시 */
            <div />
          ) : (
            /* 서재/오답/찜/커스텀: 필터 숨김 (상세 페이지에서는 불필요) */
            <div />
          )}
        </div>
      </header>

      {/* 폴더 제목 + 점수 (solved 타입 제외) */}
      {folderType !== 'solved' && (
        <div className="px-4 py-3">
          {/* bookmark/library 타입일 때 제목 + 점수 표시 */}
          {(folderType === 'bookmark' || folderType === 'library') ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                {/* 뒤로가기 < 화살표 */}
                {!isEditMode && (
                  <button
                    onClick={() => router.back()}
                    className="p-1 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors flex-shrink-0"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                {folderType === 'library' && isEditMode ? (
                  <input
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    className="flex-1 min-w-0 max-w-[160px] text-2xl font-black text-[#1A1A1A] bg-[#EDEAE4] border-2 border-[#1A1A1A] px-2 py-1 focus:outline-none"
                    autoFocus
                  />
                ) : (
                  <>
                    <h2 className="text-2xl font-black text-[#1A1A1A] flex-1">
                      {folderTitle}
                    </h2>
                    {folderType === 'library' && !isSelectMode && !fromQuizPage && (
                      <>
                        <button
                          onClick={handleEnterEditMode}
                          className="p-1.5 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors flex-shrink-0"
                          title="수정 모드"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setShowDeleteModal(true)}
                          className="p-1.5 text-[#5C5C5C] hover:text-[#C44] transition-colors flex-shrink-0"
                          title="퀴즈 삭제"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-black text-[#1A1A1A]">
                      {quizScores?.myScore !== undefined ? quizScores.myScore : '-'}
                    </span>
                    <span className="text-base text-[#5C5C5C]">/</span>
                    <span className="text-2xl font-black text-[#1A1A1A]">
                      {quizScores?.myFirstReviewScore !== undefined ? quizScores.myFirstReviewScore : '-'}
                    </span>
                  </div>
                  <div className="flex items-center gap-5 mt-1">
                    <span className="text-xs text-[#5C5C5C]">퀴즈</span>
                    <span className="text-xs text-[#5C5C5C]">복습</span>
                  </div>
                </div>
                {/* 평균 점수 (공개 퀴즈만) */}
                {quizScores?.isPublic && (
                  <div className="flex flex-col items-center">
                    <span className="text-2xl font-black text-[#1A1A1A]">
                      {quizScores?.averageScore !== undefined ? Math.round(quizScores.averageScore) : '-'}
                    </span>
                    <span className="text-xs text-[#5C5C5C] mt-1">평균</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.back()}
                className="p-1 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors flex-shrink-0"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-2xl font-black text-[#1A1A1A] truncate flex-1">
                {folderTitle}
              </h2>
              {folderType === 'custom' && !isSelectMode && (
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className="p-1.5 text-[#5C5C5C] hover:text-[#C44] transition-colors flex-shrink-0"
                  title="폴더 삭제"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 커스텀 폴더일 때 문제 추가 버튼 */}
      {folderType === 'custom' && !isSelectMode && (
        <div className="px-4 pt-4">
          <button
            onClick={() => setIsAddMode(true)}
            className="w-full py-2 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
          >
            + 문제 추가하기
          </button>
        </div>
      )}

      {/* 상단 정보 */}
      <div className="px-4 py-3 flex items-center justify-between">
        <p className="text-lg font-bold text-[#5C5C5C]">
          {loading ? '불러오는 중...' : `총 ${questions.length}문제`}
          {isSelectMode && selectedIds.size > 0 && (
            <span className="ml-2 text-[#1A1A1A] font-bold">
              ({selectedIds.size}개 선택)
            </span>
          )}
        </p>
        {/* 수정 모드일 때 선택 버튼 숨김 */}
        {!isEditMode && (
          <div className="flex gap-2">
            {/* 선택 모드일 때 전체 선택 버튼 */}
            {isSelectMode && (
              <button
                onClick={() => {
                  if (selectedIds.size === questions.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(questions.map(q => q.id)));
                  }
                }}
                className="px-4 py-2 text-sm font-bold border transition-colors bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#EDEAE4] rounded-lg"
              >
                {selectedIds.size === questions.length ? '전체 해제' : '전체'}
              </button>
            )}
            <button
              onClick={() => {
                if (isSelectMode) {
                  setIsSelectMode(false);
                  setIsDeleteMode(false);
                  setIsAssignMode(false);
                  setSelectedIds(new Set());
                } else {
                  setIsSelectMode(true);
                  // 선택 모드에서는 삭제 모드 비활성화 (복습용으로만 사용)
                  setIsDeleteMode(false);
                }
              }}
              className={`px-4 py-2 text-sm font-bold border-2 transition-colors rounded-lg ${
                isSelectMode
                  ? 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A]'
                  : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#EDEAE4]'
              }`}
            >
              {isSelectMode ? '취소' : '선택'}
            </button>
          </div>
        )}
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="px-4 space-y-2">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-20 rounded-none" />
          ))}
        </div>
      )}

      {/* 문제 목록 */}
      {!loading && (
        <main className="px-4 space-y-2">
          {questions.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-[#5C5C5C]">문제가 없습니다.</p>
            </div>
          ) : groupedByCategory ? (
            // 카테고리별로 그룹화된 표시
            <div className="space-y-4">
              {groupedByCategory.map((group, groupIndex) => (
                <div key={group.category?.id || 'uncategorized'}>
                  {/* 카테고리 헤더 */}
                  <div className="flex items-center gap-2 mb-2 mt-4">
                    <span className="font-bold text-[#1A1A1A] text-sm">
                      {group.category?.name || '미분류'}
                    </span>
                    <div className="flex-1 border-t border-dashed border-[#5C5C5C]" />
                    <span className="text-xs text-[#5C5C5C]">
                      {group.items.length}문제
                    </span>
                  </div>
                  {/* 해당 카테고리의 문제들 */}
                  <div className="space-y-2">
                    {group.items.length === 0 ? (
                      <p className="text-xs text-[#5C5C5C] py-2 text-center">문제가 없습니다</p>
                    ) : (
                      group.items.map((item, index) => {
                        // 전체 문제 목록에서의 인덱스 계산
                        let globalIndex = 0;
                        for (let i = 0; i < groupIndex; i++) {
                          globalIndex += groupedByCategory[i].items.length;
                        }
                        globalIndex += index;

                        return (
                          <QuestionCard
                            key={item.id}
                            item={item}
                            questionNumber={globalIndex + 1}
                            isSelectMode={isSelectMode}
                            isSelected={selectedIds.has(item.id)}
                            onSelect={() => handleSelectQuestion(item.id)}
                            onFeedbackSubmit={handleFeedbackSubmit}
                            currentUserId={user?.uid}
                            quizCreatorId={quizCreatorsMap.get(item.quizId)}
                            isAiGenerated={quizAiMap.get(item.quizId)}
                            folderType={folderType}
                            courseId={userCourse?.id}
                            hasUpdate={updatedQuestionIds.has(item.questionId)}
                            isEditMode={isEditMode}
                            editData={editedQuestions[item.questionId]}
                            onEditChange={isEditMode ? (field, value) => {
                              setEditedQuestions(prev => ({
                                ...prev,
                                [item.questionId]: { ...prev[item.questionId], [field]: value }
                              }));
                            } : undefined}
                          />
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // 일반 목록 표시 (결합형 그룹 포함)
            displayItems.map((displayItem) => {
              // 단일 문제
              if (displayItem.type === 'single' && displayItem.item) {
                const item = displayItem.item;
                return (
                  <QuestionCard
                    key={item.id}
                    item={item}
                    questionNumber={displayItem.displayNumber}
                    isSelectMode={isSelectMode}
                    isSelected={selectedIds.has(item.id)}
                    onSelect={() => handleSelectQuestion(item.id)}
                    onFeedbackSubmit={handleFeedbackSubmit}
                    currentUserId={user?.uid}
                    quizCreatorId={quizCreatorsMap.get(item.quizId)}
                    isAiGenerated={quizAiMap.get(item.quizId)}
                    courseId={userCourse?.id}
                    folderType={folderType}
                    hasUpdate={updatedQuestionIds.has(item.questionId)}
                    isEditMode={isEditMode}
                    editData={editedQuestions[item.questionId]}
                    onEditChange={isEditMode ? (field, value) => {
                      setEditedQuestions(prev => ({
                        ...prev,
                        [item.questionId]: { ...prev[item.questionId], [field]: value }
                      }));
                    } : undefined}
                  />
                );
              }

              // 결합형 그룹
              if (displayItem.type === 'combined_group' && displayItem.items && displayItem.combinedGroupId) {
                const groupId = displayItem.combinedGroupId;
                const groupItems = displayItem.items;
                const correctInGroup = groupItems.filter(r => r.isCorrect).length;
                const totalInGroup = groupItems.length;
                const firstItem = groupItems[0];
                const isGroupExpanded = expandedGroupIds.has(groupId);

                // 그룹 내 선택된 문제 수
                const selectedInGroup = groupItems.filter(r => selectedIds.has(r.id)).length;
                const isGroupSelected = selectedInGroup > 0;

                return (
                  <div key={groupId}>
                    {/* 그룹 헤더 */}
                    <div
                      onClick={() => {
                        if (isSelectMode) {
                          // 선택 모드: 그룹 전체 선택/해제
                          const newSelected = new Set(selectedIds);
                          if (selectedInGroup === totalInGroup) {
                            groupItems.forEach(r => newSelected.delete(r.id));
                          } else {
                            groupItems.forEach(r => newSelected.add(r.id));
                          }
                          setSelectedIds(newSelected);
                        } else {
                          toggleGroupExpand(groupId);
                        }
                      }}
                      className={`border p-3 cursor-pointer transition-all ${
                        isSelectMode
                          ? isGroupSelected
                            ? 'border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]'
                            : 'border border-dashed border-[#5C5C5C] bg-[#F5F0E8]'
                          : 'border-[#1A1A1A] bg-[#F5F0E8]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {/* 문항 번호 + 결합형 표시 + 정답 수 */}
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="inline-block px-2 py-0.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8]">
                              Q{displayItem.displayNumber}
                            </span>
                            <span className="inline-block px-2 py-0.5 text-xs font-bold border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]">
                              결합형 문제
                            </span>
                            <span className={`inline-block px-2 py-0.5 text-xs font-bold ${
                              correctInGroup === totalInGroup
                                ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
                                : correctInGroup > 0
                                ? 'bg-[#FFF8E1] text-[#8B6914] border border-[#8B6914]'
                                : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
                            }`}>
                              {correctInGroup}/{totalInGroup} 정답
                            </span>
                          </div>
                          {/* 공통 지문/문제 미리보기 */}
                          <p className="text-sm text-[#1A1A1A]">
                            {firstItem.commonQuestion || firstItem.passage || '결합형 문제'}
                            {/* 제시문 발문 표시 */}
                            {firstItem.passagePrompt && (
                              <span className="ml-1 text-[#5C5C5C]">
                                {firstItem.passagePrompt}
                              </span>
                            )}
                          </p>
                        </div>

                        {/* 오른쪽 영역: 체크박스/화살표 */}
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          {isSelectMode ? (
                            <div className={`w-5 h-5 flex items-center justify-center ${
                              selectedInGroup === totalInGroup ? 'bg-[#1A1A1A]' : selectedInGroup > 0 ? 'bg-[#5C5C5C]' : 'border border-[#5C5C5C]'
                            }`}>
                              {selectedInGroup > 0 && (
                                <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          ) : (
                            <svg
                              className={`w-5 h-5 text-[#5C5C5C] transition-transform ${isGroupExpanded ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 그룹 펼침 (공통 지문 + 하위 문제들) */}
                    <AnimatePresence>
                      {isGroupExpanded && !isSelectMode && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="border border-t-0 border-[#1A1A1A] bg-[#F5F0E8] p-4 space-y-4">
                            {/* 공통 문제는 아코디언 헤더에 표시되므로 생략 */}

                            {/* 공통 지문 */}
                            {(firstItem.passage || firstItem.passageImage || firstItem.koreanAbcItems || (firstItem.passageMixedExamples && firstItem.passageMixedExamples.length > 0)) && (() => {
                              // 지문과 이미지가 둘 다 있는지 확인
                              const hasText = firstItem.passage || (firstItem.koreanAbcItems && firstItem.koreanAbcItems.length > 0) || (firstItem.passageMixedExamples && firstItem.passageMixedExamples.length > 0);
                              const hasImage = !!firstItem.passageImage;
                              const needsInnerBox = hasText && hasImage;

                              return (
                                <div className="p-3 border border-[#8B6914] bg-[#FFF8E1]">
                                  {/* 텍스트 */}
                                  {firstItem.passage && firstItem.passageType !== 'korean_abc' && (
                                    needsInnerBox ? (
                                      <div className="p-3 bg-[#FFFDF7] border border-[#E8D9A8]">
                                        <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{firstItem.passage}</p>
                                      </div>
                                    ) : (
                                      <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{firstItem.passage}</p>
                                    )
                                  )}
                                  {/* ㄱㄴㄷ 형식 */}
                                  {firstItem.passageType === 'korean_abc' && firstItem.koreanAbcItems && firstItem.koreanAbcItems.length > 0 && (
                                    needsInnerBox ? (
                                      <div className="p-3 bg-[#FFFDF7] border border-[#E8D9A8]">
                                        <div className="space-y-1">
                                          {firstItem.koreanAbcItems.map((itm, idx) => (
                                            <p key={idx} className="text-sm text-[#1A1A1A]">
                                              <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {itm}
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="space-y-1">
                                        {firstItem.koreanAbcItems.map((itm, idx) => (
                                          <p key={idx} className="text-sm text-[#1A1A1A]">
                                            <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {itm}
                                          </p>
                                        ))}
                                      </div>
                                    )
                                  )}
                                  {/* 혼합 형식 */}
                                  {(firstItem as any).passageMixedExamples && (firstItem as any).passageMixedExamples.length > 0 && (
                                    <div className="space-y-2">
                                      {(firstItem as any).passageMixedExamples.map((block: any) => (
                                        <div key={block.id}>
                                          {block.type === 'grouped' && (
                                            <div className="space-y-1">
                                              {(block.children || []).map((child: any) => (
                                                <div key={child.id}>
                                                  {child.type === 'text' && <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>}
                                                  {child.type === 'labeled' && (child.items || []).map((i: any) => (
                                                    <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
                                                  ))}
                                                  {child.type === 'gana' && (child.items || []).map((i: any) => (
                                                    <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
                                                  ))}
                                                  {child.type === 'image' && child.imageUrl && <img src={child.imageUrl} alt="" className="max-w-full h-auto" />}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          {block.type === 'text' && <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>}
                                          {block.type === 'labeled' && (
                                            <div className="space-y-1">
                                              {(block.items || []).map((i: any) => (
                                                <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
                                              ))}
                                            </div>
                                          )}
                                          {block.type === 'gana' && (
                                            <div className="space-y-1">
                                              {(block.items || []).map((i: any) => (
                                                <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
                                              ))}
                                            </div>
                                          )}
                                          {block.type === 'image' && block.imageUrl && <img src={block.imageUrl} alt="" className="max-w-full h-auto" />}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {/* 이미지 */}
                                  {firstItem.passageImage && (
                                    <img src={firstItem.passageImage} alt="공통 이미지" className={`max-w-full max-h-[300px] object-contain border border-[#1A1A1A] ${hasText ? 'mt-3' : ''}`} />
                                  )}
                                </div>
                              );
                            })()}

                            {/* 하위 문제들 */}
                            <div className="space-y-2 p-3 bg-[#EDEAE4] border border-[#D4CFC4]">
                              {groupItems.map((subItem, subIdx) => (
                                <QuestionCard
                                  key={subItem.id}
                                  item={subItem}
                                  questionNumber={displayItem.displayNumber}
                                  subQuestionNumber={subIdx + 1}
                                  isSelectMode={false}
                                  isSelected={false}
                                  onSelect={() => {}}
                                  onFeedbackSubmit={handleFeedbackSubmit}
                                  currentUserId={user?.uid}
                                  quizCreatorId={quizCreatorsMap.get(subItem.quizId)}
                                  isAiGenerated={quizAiMap.get(subItem.quizId)}
                                  courseId={userCourse?.id}
                                  folderType={folderType}
                                  hasUpdate={updatedQuestionIds.has(subItem.questionId)}
                                  isEditMode={isEditMode}
                                  editData={editedQuestions[subItem.questionId]}
                                  onEditChange={isEditMode ? (field, value) => {
                                    setEditedQuestions(prev => ({
                                      ...prev,
                                      [subItem.questionId]: { ...prev[subItem.questionId], [field]: value }
                                    }));
                                  } : undefined}
                                />
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              }

              return null;
            })
          )}
        </main>
      )}

      {/* 하단 버튼 영역 */}
      {!loading && questions.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-3 bg-[#F5F0E8] border-t-2 border-[#1A1A1A]">
          {isEditMode ? (
            /* 수정 모드일 때 - 취소/저장 */
            <div className="flex gap-2">
              <button
                onClick={handleCancelEdit}
                disabled={isSavingEdit}
                className="flex-1 py-3 text-sm font-bold bg-[#F5F0E8] text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                취소
              </button>
              <button
                onClick={handleSaveEdits}
                disabled={isSavingEdit || (Object.keys(editedQuestions).length === 0 && !(editedTitle.trim() && editedTitle.trim() !== libraryQuizTitle))}
                className={`flex-1 py-3 text-sm font-bold border-2 transition-colors rounded-lg ${
                  (Object.keys(editedQuestions).length > 0 || (editedTitle.trim() && editedTitle.trim() !== libraryQuizTitle))
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A] hover:bg-[#3A3A3A]'
                    : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C] cursor-not-allowed'
                }`}
              >
                {isSavingEdit ? '저장 중...' : '저장'}
              </button>
            </div>
          ) : isSelectMode && selectedIds.size > 0 ? (
            /* 선택 모드일 때 - 선택한 문제 복습 */
            <button
              onClick={handleStartPractice}
              className="w-full py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors rounded-lg"
            >
              선택 복습하기 ({selectedIds.size})
            </button>
          ) : !isSelectMode ? (
            /* 기본 모드 - 전체 복습 + 오답 복습 */
            <div className="flex gap-2">
              <button
                onClick={handleStartPractice}
                className="flex-1 py-2.5 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors rounded-lg"
              >
                전체 복습
              </button>
              <button
                onClick={handleStartWrongOnlyPractice}
                disabled={wrongCount === 0}
                className={`flex-1 py-2.5 text-sm font-bold border-2 transition-colors rounded-lg ${
                  wrongCount > 0
                    ? 'bg-[#8B1A1A] text-[#F5F0E8] border-[#8B1A1A] hover:bg-[#6B1414]'
                    : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C] cursor-not-allowed'
                }`}
              >
                오답 복습 {wrongCount > 0 && `(${wrongCount})`}
              </button>
            </div>
          ) : null}
        </div>
      )}


      {/* 배정 모드일 때 하단 안내 */}
      {!loading && isAssignMode && isSelectMode && selectedIds.size === 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-3 bg-[#EDEAE4] border-t-2 border-[#1A1A1A]">
          <p className="text-xs text-center text-[#5C5C5C]">
            분류할 문제를 선택하세요
          </p>
        </div>
      )}

      {/* 빈 폴더 임시 메시지 */}
      <AnimatePresence>
        {showEmptyMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-[#F5F0E8] border-2 border-[#1A1A1A] px-6 py-4 text-center"
            >
              <p className="text-sm font-bold text-[#1A1A1A]">
                선택된 폴더에 복습할 문제가 없습니다
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 토스트 메시지 */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-28 left-4 right-4 z-50"
          >
            <div className="bg-[#1A1A1A] text-[#F5F0E8] px-4 py-3 text-center border-2 border-[#1A1A1A]">
              <p className="text-sm font-bold">{toastMessage}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 카테고리 관리 바텀시트 */}
      <BottomSheet
        isOpen={isCategoryMode}
        onClose={() => {
          setIsCategoryMode(false);
          setNewCategoryName('');
        }}
        title="정렬 기준 관리"
        height="auto"
      >
        <div className="space-y-4">
          {/* 카테고리 추가 */}
          <div>
            <label className="block text-sm text-[#5C5C5C] mb-2">새 분류 추가</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="분류 이름 입력"
                className="flex-1 px-3 py-2 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none"
                maxLength={20}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newCategoryName.trim()) {
                    handleAddCategory();
                  }
                }}
              />
              <button
                onClick={handleAddCategory}
                disabled={!newCategoryName.trim()}
                className="px-4 py-2 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-sm disabled:opacity-30"
              >
                추가
              </button>
            </div>
          </div>

          {/* 현재 카테고리 목록 */}
          <div>
            <label className="block text-sm text-[#5C5C5C] mb-2">
              현재 분류 ({customFolder?.categories?.length || 0}개)
            </label>
            {!customFolder?.categories?.length ? (
              <p className="text-xs text-[#5C5C5C] py-4 text-center border border-dashed border-[#5C5C5C]">
                아직 분류가 없습니다. 위에서 추가해주세요.
              </p>
            ) : (
              <div className="space-y-2">
                {customFolder.categories.map((cat) => {
                  const questionCount = customFolder.questions.filter(
                    (q: CustomFolderQuestion) => q.categoryId === cat.id
                  ).length;

                  return (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between p-3 border border-[#1A1A1A] bg-[#EDEAE4]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#1A1A1A]">{cat.name}</span>
                        <span className="text-xs text-[#5C5C5C]">({questionCount}문제)</span>
                      </div>
                      <button
                        onClick={() => handleRemoveCategory(cat.id)}
                        className="px-2 py-1 text-xs text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
                      >
                        삭제
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 문제 배정 모드 진입 버튼 */}
          {customFolder?.categories?.length ? (
            <div className="pt-2 border-t border-[#EDEAE4]">
              <button
                onClick={() => {
                  setIsCategoryMode(false);
                  setIsSelectMode(true);
                  setIsDeleteMode(false);
                  setIsAssignMode(true);
                }}
                className="w-full py-3 font-bold text-sm bg-[#F5F0E8] text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
              >
                문제 분류하기
              </button>
              <p className="text-xs text-[#5C5C5C] text-center mt-2">
                문제를 선택한 후 원하는 분류에 배정할 수 있습니다.
              </p>
            </div>
          ) : null}
        </div>
      </BottomSheet>

      {/* 문제 배정 바텀시트 (문제 선택 후 카테고리 선택) */}
      <BottomSheet
        isOpen={isAssignMode && isSelectMode && selectedIds.size > 0}
        onClose={() => {
          setSelectedCategoryForAssign(null);
        }}
        title={`${selectedIds.size}개 문제 분류`}
        height="auto"
      >
        <div className="space-y-3">
          <p className="text-sm text-[#5C5C5C]">분류를 선택하세요</p>

          {/* 카테고리 선택 버튼들 */}
          <div className="space-y-2">
            {customFolder?.categories?.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategoryForAssign(cat.id)}
                className={`w-full p-3 text-left font-bold text-sm border-2 transition-colors ${
                  selectedCategoryForAssign === cat.id
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#EDEAE4]'
                }`}
              >
                {cat.name}
              </button>
            ))}
            {/* 미분류 옵션 */}
            <button
              onClick={() => setSelectedCategoryForAssign('uncategorized')}
              className={`w-full p-3 text-left font-bold text-sm border-2 transition-colors ${
                selectedCategoryForAssign === 'uncategorized'
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#F5F0E8] text-[#5C5C5C] border-[#5C5C5C] border-dashed hover:bg-[#EDEAE4]'
              }`}
            >
              미분류
            </button>
          </div>

          {/* 배정 버튼 */}
          <button
            onClick={async () => {
              if (!selectedCategoryForAssign) return;
              const categoryId = selectedCategoryForAssign === 'uncategorized' ? null : selectedCategoryForAssign;

              try {
                for (const itemId of selectedIds) {
                  const item = questions.find(q => q.id === itemId);
                  if (item) {
                    await assignQuestionToCategory(folderId, item.questionId, categoryId);
                  }
                }
                setSelectedIds(new Set());
                setIsSelectMode(false);
                setIsAssignMode(false);
                setSelectedCategoryForAssign(null);
              } catch (err) {
                console.error('배정 실패:', err);
                alert('배정에 실패했습니다.');
              }
            }}
            disabled={!selectedCategoryForAssign}
            className="w-full py-3 font-bold text-sm bg-[#1A1A1A] text-[#F5F0E8] disabled:opacity-30 transition-colors"
          >
            배정하기
          </button>
        </div>
      </BottomSheet>

      {/* 폴더/서재 삭제 확인 모달 */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setShowDeleteModal(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[85%] max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-2xl"
          >
            <div className="flex justify-center mb-3">
              <div className="w-10 h-10 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4] rounded-lg">
                <svg className="w-5 h-5 text-[#8B1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
            </div>
            <h3 className="text-center font-bold text-base text-[#1A1A1A] mb-2">
              {folderType === 'custom' ? '폴더를 삭제할까요?' : '퀴즈를 삭제할까요?'}
            </h3>
            <p className="text-xs text-[#5C5C5C] mb-1">
              {folderType === 'custom'
                ? '- 삭제된 폴더는 복구할 수 없습니다.'
                : '- 삭제된 퀴즈는 복구할 수 없습니다.'
              }
            </p>
            <p className="text-xs text-[#5C5C5C] mb-5">
              {folderType === 'custom'
                ? '- 폴더 안의 문제는 원본에 남아있습니다.'
                : '- 이미 푼 사람은 복습 가능합니다.'
              }
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-2.5 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  try {
                    if (folderType === 'custom') {
                      await deleteCustomFolder(folderId);
                    } else if (folderType === 'library') {
                      await deleteDoc(doc(db, 'quizzes', folderId));
                    }
                    setShowDeleteModal(false);
                    router.push(`/review?filter=${folderType}`);
                  } catch (err) {
                    console.error('삭제 실패:', err);
                  }
                }}
                className="flex-1 py-2.5 font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] transition-colors rounded-lg"
              >
                삭제
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
