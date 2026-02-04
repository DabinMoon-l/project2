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
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useReview, type ReviewItem, type FolderCategory, type CustomFolderQuestion } from '@/lib/hooks/useReview';
import { useCourse } from '@/lib/contexts/CourseContext';
import { Skeleton, BottomSheet } from '@/components/common';
import ReviewPractice from '@/components/review/ReviewPractice';
import { formatChapterLabel, getChapterById } from '@/lib/courseIndex';

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
type FeedbackType = 'unclear' | 'wrong' | 'typo' | 'other';

/** 피드백 유형 옵션 */
const FEEDBACK_TYPES: { type: FeedbackType; label: string }[] = [
  { type: 'unclear', label: '문제가 이해가 안 돼요' },
  { type: 'wrong', label: '정답이 틀린 것 같아요' },
  { type: 'typo', label: '오타가 있어요' },
  { type: 'other', label: '기타 의견' },
];

/** 필터 타입 */
type ReviewFilter = 'solved' | 'wrong' | 'bookmark' | 'custom';

/** 필터 옵션 */
const FILTER_OPTIONS: { value: ReviewFilter; line1: string; line2?: string }[] = [
  { value: 'solved', line1: '문제' },
  { value: 'wrong', line1: '오답' },
  { value: 'bookmark', line1: '찜' },
  { value: 'custom', line1: '내맘대로' },
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
    <div className="relative flex items-stretch bg-[#EDEAE4] border border-[#1A1A1A] overflow-hidden min-w-[320px]">
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
          className={`relative z-10 w-1/4 px-3 py-3 text-xs font-bold transition-colors text-center flex flex-col items-center justify-center ${
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
  onBookmark,
  currentUserId,
  quizCreatorId,
  courseId,
  folderType,
}: {
  item: ReviewItem;
  questionNumber: number;
  /** 결합형 하위문제 번호 (있으면 Q{main}-{sub} 형식으로 표시) */
  subQuestionNumber?: number;
  isSelectMode: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onFeedbackSubmit?: (questionId: string, type: FeedbackType, content: string) => void;
  onBookmark?: (item: ReviewItem) => void;
  /** 현재 로그인한 사용자 ID (자기 문제 피드백 방지용) */
  currentUserId?: string;
  /** 해당 퀴즈의 생성자 ID (자기 문제 피드백 방지용) */
  quizCreatorId?: string;
  /** 과목 ID (챕터 라벨 표시용) */
  courseId?: string;
  /** 폴더 타입 (공통 문제 표시 여부 결정용) */
  folderType?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [selectedFeedbackType, setSelectedFeedbackType] = useState<FeedbackType | null>(null);
  const [feedbackContent, setFeedbackContent] = useState('');
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState(false);
  const [isFeedbackSubmitted, setIsFeedbackSubmitted] = useState(false);

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
        className="p-3 cursor-pointer"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* 문항 번호 + 정답/오답 표시 + 챕터 */}
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="inline-block px-2 py-0.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8]">
                Q{questionNumber}{subQuestionNumber ? `-${subQuestionNumber}` : (item.combinedGroupId && item.combinedIndex !== undefined ? `-${item.combinedIndex + 1}` : '')}
              </span>
              {/* 결합형 표시 */}
              {item.combinedGroupId && !subQuestionNumber && (
                <span className="inline-block px-2 py-0.5 text-xs font-bold border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]">
                  결합형 문제
                </span>
              )}
              {item.isCorrect !== undefined && (
                <span className={`inline-block px-2 py-0.5 text-xs font-bold ${
                  item.isCorrect
                    ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
                    : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
                }`}>
                  {item.isCorrect ? '정답' : '오답'}
                </span>
              )}
              {/* 챕터 표시 */}
              {courseId && item.chapterId && (
                <span className="inline-block px-1.5 py-0.5 text-xs font-medium bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7]">
                  {formatChapterLabel(courseId, item.chapterId, item.chapterDetailId)}
                </span>
              )}
            </div>
            <p className="text-sm text-[#1A1A1A] line-clamp-2">{item.question}</p>
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

            {/* 확장 아이콘 */}
            {!isSelectMode && (
              <svg
                className={`w-5 h-5 text-[#5C5C5C] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}

            {/* 찜 상태 뱃지 - 아이콘 아래 */}
            {item.isBookmarked && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold bg-[#FDEAEA] text-[#8B1A1A] border border-[#8B1A1A]">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                찜
              </span>
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
            <div className="border-t border-[#1A1A1A] p-4 space-y-4 bg-[#EDEAE4]">
              {/* 결합형 공통 정보 (단일 문제로 표시될 때) */}
              {item.combinedGroupId && !subQuestionNumber && (
                <div className="space-y-3 mb-4">
                  {/* 공통 문제 (문제 탭에서만 표시) */}
                  {item.commonQuestion && folderType === 'solved' && (
                    <div className="p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8]">
                      <p className="text-xs font-bold text-[#5C5C5C] mb-2">공통 문제</p>
                      <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{item.commonQuestion}</p>
                    </div>
                  )}
                  {/* 공통 지문 */}
                  {(item.passage || item.passageImage || (item.koreanAbcItems && item.koreanAbcItems.length > 0)) && (
                    <div className="p-3 border-2 border-[#8B6914] bg-[#FFF8E1]">
                      {/* 텍스트 */}
                      {item.passage && item.passageType !== 'korean_abc' && (
                        <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{item.passage}</p>
                      )}
                      {/* ㄱㄴㄷ 형식 */}
                      {item.passageType === 'korean_abc' && item.koreanAbcItems && item.koreanAbcItems.length > 0 && (
                        <div className="space-y-1">
                          {item.koreanAbcItems.map((itm, idx) => (
                            <p key={idx} className="text-sm text-[#1A1A1A]">
                              <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {itm}
                            </p>
                          ))}
                        </div>
                      )}
                      {/* 이미지 */}
                      {item.passageImage && (
                        <img src={item.passageImage} alt="공통 이미지" className="mt-2 max-w-full max-h-[300px] object-contain border border-[#1A1A1A]" />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 문제 이미지 */}
              {item.image && (
                <div className="mb-3">
                  <img
                    src={item.image}
                    alt="문제 이미지"
                    className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A]"
                  />
                </div>
              )}

              {/* 보기 (텍스트 또는 ㄱㄴㄷ 형식) */}
              {item.subQuestionOptions && item.subQuestionOptions.length > 0 && (
                <div className="p-3 border border-[#8B6914] bg-[#FFF8E1] mb-3">
                  <p className="text-xs font-bold text-[#8B6914] mb-2">보기</p>
                  {item.subQuestionOptionsType === 'text' ? (
                    // 텍스트 형식: 쉼표로 구분하여 한 줄로 표시
                    <p className="text-sm text-[#1A1A1A]">
                      {item.subQuestionOptions.join(', ')}
                    </p>
                  ) : (
                    // ㄱㄴㄷ 형식 (labeled) 또는 기본
                    <div className="space-y-1">
                      {item.subQuestionOptions.map((opt, idx) => (
                        <p key={idx} className="text-sm text-[#1A1A1A]">
                          <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {opt}
                        </p>
                      ))}
                    </div>
                  )}
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
                  <div className="space-y-3">
                    <div className="flex gap-4 justify-center py-2">
                      {/* O 버튼 */}
                      <div
                        className={`w-20 h-20 text-4xl font-bold border-2 flex items-center justify-center transition-colors ${
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
                        className={`w-20 h-20 text-4xl font-bold border-2 flex items-center justify-center transition-colors ${
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
                <div className="space-y-3">
                  {/* 복수 정답 표시 */}
                  {(() => {
                    const correctAnswerStr = item.correctAnswer?.toString() || '';
                    const correctAnswers = correctAnswerStr.includes(',')
                      ? correctAnswerStr.split(',').map(a => a.trim())
                      : [correctAnswerStr];
                    const isMultipleAnswer = correctAnswers.length > 1;
                    return isMultipleAnswer && (
                      <p className="text-xs text-[#8B6914] font-bold flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        복수 정답 ({correctAnswers.length}개)
                      </p>
                    );
                  })()}
                  <div className="space-y-2">
                    {item.options.map((opt, idx) => {
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

                      if (isCorrectOption) {
                        bgColor = '#1A6B1A';
                        borderColor = '#1A6B1A';
                        textColor = '#F5F0E8';
                      } else if (isWrongAnswer) {
                        bgColor = '#8B1A1A';
                        borderColor = '#8B1A1A';
                        textColor = '#F5F0E8';
                      }

                      // 복수정답 여부 확인
                      const isMultipleAnswerQuestion = correctAnswers.length > 1;

                      return (
                        <div
                          key={idx}
                          style={{ backgroundColor: bgColor, borderColor, color: textColor }}
                          className="w-full p-3 border-2 flex items-start gap-3 text-left"
                        >
                          {/* 선지 번호 */}
                          <span
                            className={`flex-shrink-0 w-6 h-6 flex items-center justify-center text-sm font-bold ${
                              isCorrectOption || isWrongAnswer
                                ? 'bg-[#F5F0E8]/20 text-[#F5F0E8]'
                                : 'bg-[#EDEAE4] text-[#1A1A1A]'
                            }`}
                          >
                            {choiceLabels[idx] || `${idx + 1}`}
                          </span>
                          {/* 선지 텍스트 + 복수정답일 때만 정답/내답 표시 */}
                          <span className="flex-1 text-sm leading-relaxed break-words">
                            {opt}
                            {isMultipleAnswerQuestion && isCorrectOption && <span className="ml-1 font-bold">(정답)</span>}
                            {isMultipleAnswerQuestion && isUserAnswer && <span className="ml-1 font-bold">(내 답)</span>}
                          </span>
                          {/* 체크 아이콘 */}
                          {(isCorrectOption || isUserAnswer) && (
                            <svg
                              className="w-5 h-5 flex-shrink-0"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d={isCorrectOption ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"}
                              />
                            </svg>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 단답형/서술형 답 */}
              {(item.type === 'short' || item.type === 'short_answer' || item.type === 'subjective' || item.type === 'essay') && (
                <div className="space-y-3">
                  {/* 내 답 */}
                  <div className="p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8]">
                    <p className="text-xs text-[#5C5C5C] mb-1">내 답</p>
                    <p className={`text-sm font-medium whitespace-pre-wrap ${item.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                      {item.userAnswer || '(미응답)'}
                    </p>
                  </div>
                  {/* 정답 */}
                  {item.correctAnswer && (
                    <div className="p-3 border-2 border-[#1A6B1A] bg-[#E8F5E9]">
                      <p className="text-xs text-[#1A6B1A] mb-1">정답</p>
                      <p className="text-sm font-medium text-[#1A6B1A] whitespace-pre-wrap">
                        {/* 복수 정답 표시 (||| 구분자) */}
                        {item.correctAnswer?.includes('|||') ? (
                          item.correctAnswer.split('|||').map((ans, i) => (
                            <span key={i}>
                              {i > 0 && <span className="mx-1 text-[#5C5C5C]">또는</span>}
                              {ans.trim()}
                            </span>
                          ))
                        ) : (
                          item.correctAnswer
                        )}
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
                <div className="space-y-3">
                  {item.userAnswer && (
                    <div className="p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8]">
                      <p className="text-xs text-[#5C5C5C] mb-1">내 답</p>
                      <p className={`text-sm font-medium whitespace-pre-wrap ${item.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                        {item.userAnswer}
                      </p>
                    </div>
                  )}
                  {item.correctAnswer && (
                    <div className="p-3 border-2 border-[#1A6B1A] bg-[#E8F5E9]">
                      <p className="text-xs text-[#1A6B1A] mb-1">정답</p>
                      <p className="text-sm font-medium text-[#1A6B1A] whitespace-pre-wrap">
                        {item.correctAnswer}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 해설 */}
              {item.explanation && (
                <div className="p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
                  <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                  <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">
                    {item.explanation}
                  </p>
                </div>
              )}

              {/* 피드백 + 찜 버튼 */}
              {(onFeedbackSubmit || onBookmark) && (
                <div className="pt-3 border-t border-[#EDEAE4] flex items-center gap-2">
                  {/* 피드백 버튼 (좌측) - 자기 문제가 아닌 경우에만 표시 */}
                  {onFeedbackSubmit && !(currentUserId && (quizCreatorId === currentUserId || item.quizCreatorId === currentUserId)) && (
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
                  )}

                  {/* 찜 버튼 (항상 우측) */}
                  {onBookmark && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        console.log('찜 버튼 클릭:', item.questionId, item.isBookmarked);
                        onBookmark(item);
                      }}
                      className={`ml-auto flex items-center gap-2 px-3 py-2 text-xs font-bold border-2 transition-colors ${
                        item.isBookmarked
                          ? 'bg-[#FDEAEA] border-[#8B1A1A] text-[#8B1A1A]'
                          : 'bg-[#F5F0E8] border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4]'
                      }`}
                    >
                      <svg className="w-4 h-4" fill={item.isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                      {item.isBookmarked ? '찜 해제' : '찜'}
                    </button>
                  )}
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
            <p className="text-sm text-[#5C5C5C] mb-3">문제에 어떤 문제가 있나요?</p>
            <div className="grid grid-cols-2 gap-2">
              {FEEDBACK_TYPES.map(({ type, label }) => (
                <button
                  key={type}
                  onClick={() => setSelectedFeedbackType(type)}
                  className={`p-3 border-2 text-sm font-bold transition-all ${
                    selectedFeedbackType === type
                      ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
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
            className={`w-full py-3 font-bold border-2 transition-colors ${
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
  const { userCourse } = useCourse();

  const folderType = params.type as string; // solved, wrong, bookmark, custom
  const folderId = params.id as string;
  const chapterFilter = searchParams.get('chapter'); // 챕터 필터 (오답 탭에서 챕터별 클릭 시)

  // 과목별 리본 이미지
  const ribbonImage = userCourse?.reviewRibbonImage || '/images/biology-review-ribbon.png';
  const ribbonScale = userCourse?.reviewRibbonScale || 1;

  const {
    groupedSolvedItems,
    groupedWrongItems,
    groupedBookmarkedItems,
    customFolders,
    solvedItems,
    wrongItems,
    bookmarkedItems,
    addToCustomFolder,
    removeFromCustomFolder,
    deleteReviewItem,
    toggleQuestionBookmark,
    addCategoryToFolder,
    removeCategoryFromFolder,
    assignQuestionToCategory,
  } = useReview();

  const [customQuestions, setCustomQuestions] = useState<ReviewItem[]>([]);
  const [customLoading, setCustomLoading] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [practiceItems, setPracticeItems] = useState<ReviewItem[] | null>(null);
  const [isAddMode, setIsAddMode] = useState(false);
  const [showEmptyMessage, setShowEmptyMessage] = useState(false);
  const [addSelectedIds, setAddSelectedIds] = useState<Set<string>>(new Set());
  // 바텀시트용 상태
  const [selectedQuizForAdd, setSelectedQuizForAdd] = useState<{ quizId: string; quizTitle: string } | null>(null);

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

  // 카테고리 관련 상태
  const [isCategoryMode, setIsCategoryMode] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAssignMode, setIsAssignMode] = useState(false);
  const [selectedCategoryForAssign, setSelectedCategoryForAssign] = useState<string | null>(null);

  const loadedFolderRef = useRef<string | null>(null);

  // 네비게이션 숨김
  useEffect(() => {
    // body에 data-hide-nav 속성 설정하여 네비게이션 숨김
    document.body.setAttribute('data-hide-nav', 'true');

    return () => {
      // 페이지 떠날 때 속성 제거
      document.body.removeAttribute('data-hide-nav');
    };
  }, []);

  // 커스텀 폴더 찾기
  const customFolder = useMemo(() => {
    if (folderType === 'custom') {
      return customFolders.find(f => f.id === folderId) || null;
    }
    return null;
  }, [folderType, folderId, customFolders]);

  // 폴더 데이터 계산 (useMemo로 무한 루프 방지)
  const folderData = useMemo(() => {
    if (folderType === 'solved') {
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
      const group = groupedBookmarkedItems.find(g => g.quizId === folderId);
      return group ? { title: group.quizTitle, items: group.items } : null;
    } else if (folderType === 'custom' && customFolder) {
      return { title: customFolder.name, items: null as ReviewItem[] | null };
    }
    return null;
  }, [folderType, folderId, groupedSolvedItems, groupedWrongItems, groupedBookmarkedItems, customFolder, chapterFilter]);

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
            commonQuestion: data.commonQuestion,
            // 문제 이미지/보기 필드
            image: data.image,
            subQuestionOptions: data.subQuestionOptions,
            subQuestionOptionsType: data.subQuestionOptionsType,
            subQuestionImage: data.subQuestionImage,
            quizCreatorId: data.quizCreatorId,
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

  // 최종 데이터
  const baseFolderTitle = folderData?.title || '';
  // 챕터 필터가 있으면 제목에 챕터 정보 추가
  const chapterName = chapterFilter && userCourse?.id
    ? getChapterById(userCourse.id, chapterFilter)?.name
    : null;
  const folderTitle = chapterName ? `${baseFolderTitle} (${chapterName})` : baseFolderTitle;
  const questions = folderType === 'custom' ? customQuestions : (folderData?.items || []);

  // 퀴즈별 creatorId 로드 (자기 문제 피드백 방지용)
  useEffect(() => {
    if (questions.length === 0) return;

    const loadQuizCreators = async () => {
      // 고유한 quizId 목록
      const quizIds = [...new Set(questions.map(q => q.quizId))];
      const newMap = new Map<string, string>();

      for (const quizId of quizIds) {
        // 이미 로드된 것은 스킵
        if (quizCreatorsMap.has(quizId)) {
          newMap.set(quizId, quizCreatorsMap.get(quizId)!);
          continue;
        }

        try {
          const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
          if (quizDoc.exists()) {
            const creatorId = quizDoc.data()?.creatorId;
            if (creatorId) {
              newMap.set(quizId, creatorId);
            }
          }
        } catch (err) {
          console.error(`퀴즈 ${quizId} creatorId 로드 실패:`, err);
        }
      }

      if (newMap.size > 0) {
        setQuizCreatorsMap(prev => {
          const merged = new Map(prev);
          newMap.forEach((v, k) => merged.set(k, v));
          return merged;
        });
      }
    };

    loadQuizCreators();
  }, [questions]);
  const loading = folderType === 'custom' ? customLoading : !folderData;

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

  // 찜 토글 핸들러 (로컬 상태도 함께 업데이트)
  const handleBookmarkToggle = useCallback(async (item: ReviewItem) => {
    try {
      const wasBookmarked = item.isBookmarked;
      await toggleQuestionBookmark(item);

      // 커스텀 폴더의 경우 로컬 상태도 업데이트
      if (folderType === 'custom') {
        setCustomQuestions(prev => prev.map(q =>
          q.questionId === item.questionId
            ? { ...q, isBookmarked: !wasBookmarked }
            : q
        ));
      }

      // 토스트 메시지
      showToast(wasBookmarked ? '찜 해제됨' : '찜 완료');
    } catch (err) {
      console.error('찜 토글 실패:', err);
      showToast('찜 처리에 실패했습니다.');
    }
  }, [toggleQuestionBookmark, folderType, showToast]);

  // 선택된 문제로 연습 시작
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

    setPracticeItems(targetItems);
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

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
  const handleAddSelect = (item: ReviewItem) => {
    const key = `${item.quizId}:${item.questionId}`;
    // 이미 폴더에 있는 문제는 선택 불가
    if (alreadyAddedQuestionKeys.has(key)) return;

    const newSelected = new Set(addSelectedIds);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setAddSelectedIds(newSelected);
  };

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
    if (addSelectedIds.size === 0) return;

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
      }));

      await addToCustomFolder(folderId, questionsToAdd);

      // 추가된 문제 UI 업데이트
      setCustomQuestions(prev => [...prev, ...uniqueItems]);

      // 바텀시트 닫고 선택 초기화
      setSelectedQuizForAdd(null);
      setAddSelectedIds(new Set());
      showToast(`${uniqueItems.length}개 문제 추가 완료`);
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

    const feedbackRef = collection(db, 'questionFeedbacks');
    await addDoc(feedbackRef, {
      questionId,
      quizId: item?.quizId || folderId,
      userId: user.uid,
      type,
      content,
      createdAt: serverTimestamp(),
    });
  };

  // 연습 모드
  if (practiceItems) {
    return (
      <ReviewPractice
        items={practiceItems}
        quizTitle={folderTitle}
        onComplete={() => setPracticeItems(null)}
        onClose={() => setPracticeItems(null)}
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
          <div className="flex items-center justify-between h-14 px-4">
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
                // 해당 퀴즈에서 이미 추가된 문제 수 계산
                const totalCount = group.items.length;
                const addedCount = group.items.filter(item =>
                  alreadyAddedQuestionKeys.has(`${item.quizId}:${item.questionId}`)
                ).length;
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
                    disabled={addSelectedIds.size === 0}
                    className="text-sm font-bold text-[#1A1A1A] disabled:opacity-30"
                  >
                    추가 ({addSelectedIds.size})
                  </button>
                </div>

                {/* 문제 목록 */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                  {quizItems.length === 0 ? (
                    <p className="py-8 text-center text-[#5C5C5C]">문제가 없습니다.</p>
                  ) : (
                    quizItems.map(item => {
                      const itemKey = `${item.quizId}:${item.questionId}`;
                      const isAlreadyAdded = alreadyAddedQuestionKeys.has(itemKey);
                      const isSelected = addSelectedIds.has(itemKey);

                      return (
                        <div
                          key={`${item.id}-${item.questionId}`}
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
                            {/* 체크박스 */}
                            <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                              isAlreadyAdded
                                ? 'bg-[#5C5C5C]'
                                : isSelected
                                  ? 'bg-[#1A1A1A]'
                                  : 'border border-[#5C5C5C]'
                            }`}>
                              {(isSelected || isAlreadyAdded) && (
                                <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                            {/* 문제 내용 */}
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
                    })
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
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 - 리본 이미지 */}
      <header className="pt-6 pb-4 flex flex-col items-center">
        {/* 리본 이미지 */}
        <div className="relative w-full px-4 h-32 sm:h-44 md:h-56 mb-4">
          <Image
            src={ribbonImage}
            alt="Review"
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 80vw, 60vw"
            className="object-contain"
            style={{ transform: `scale(${ribbonScale})` }}
            priority
          />
        </div>

        {/* 필터 + 뒤로가기 영역 */}
        <div className="w-full px-4 flex items-center justify-between gap-4">
          {/* 슬라이드 필터 - 좌측 */}
          <SlideFilter
            activeFilter={folderType as ReviewFilter}
            onFilterChange={handleFilterChange}
          />

          {/* 뒤로가기 버튼 - 우측 */}
          <button
            onClick={() => router.push(`/review?filter=${folderType}`)}
            className="px-4 py-3 text-sm font-bold bg-[#EDEAE4] text-[#1A1A1A] border border-[#1A1A1A] whitespace-nowrap hover:bg-[#F5F0E8] transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            목록
          </button>
        </div>
      </header>

      {/* 폴더 제목 */}
      <div className="px-4 py-3 border-b border-[#EDEAE4]">
        <h2 className="text-lg font-bold text-[#1A1A1A] truncate">
          {folderTitle}
        </h2>
      </div>

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
        <p className="text-sm text-[#5C5C5C]">
          총 {questions.length}문제
          {isSelectMode && selectedIds.size > 0 && (
            <span className="ml-2 text-[#1A1A1A] font-bold">
              ({selectedIds.size}개 선택)
            </span>
          )}
        </p>
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
              className="px-3 py-1.5 text-xs font-bold border transition-colors bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#EDEAE4]"
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
                setIsDeleteMode(true);
              }
            }}
            className={`px-3 py-1.5 text-xs font-bold border transition-colors ${
              isSelectMode
                ? 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A]'
                : 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
            }`}
          >
            {isSelectMode ? '취소' : '선택'}
          </button>
        </div>
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
                            onBookmark={handleBookmarkToggle}
                            currentUserId={user?.uid}
                            quizCreatorId={quizCreatorsMap.get(item.quizId)}
                            folderType={folderType}
                            courseId={userCourse?.id}
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
                    onBookmark={handleBookmarkToggle}
                    currentUserId={user?.uid}
                    quizCreatorId={quizCreatorsMap.get(item.quizId)}
                    courseId={userCourse?.id}
                    folderType={folderType}
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
                          <p className="text-sm text-[#1A1A1A] line-clamp-2">
                            {firstItem.commonQuestion || firstItem.passage || '결합형 문제'}
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
                            {/* 공통 문제 (문제 탭에서만 표시) */}
                            {firstItem.commonQuestion && folderType === 'solved' && (
                              <div className="p-3 border border-[#1A1A1A] bg-[#EDEAE4]">
                                <p className="text-xs font-bold text-[#5C5C5C] mb-2">공통 문제</p>
                                <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{firstItem.commonQuestion}</p>
                              </div>
                            )}

                            {/* 공통 지문 */}
                            {(firstItem.passage || firstItem.passageImage || firstItem.koreanAbcItems) && (
                              <div className="p-3 border border-[#8B6914] bg-[#FFF8E1]">
                                {/* 텍스트 */}
                                {firstItem.passage && firstItem.passageType !== 'korean_abc' && (
                                  <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{firstItem.passage}</p>
                                )}
                                {/* ㄱㄴㄷ 형식 */}
                                {firstItem.passageType === 'korean_abc' && firstItem.koreanAbcItems && firstItem.koreanAbcItems.length > 0 && (
                                  <div className="space-y-1">
                                    {firstItem.koreanAbcItems.map((itm, idx) => (
                                      <p key={idx} className="text-sm text-[#1A1A1A]">
                                        <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {itm}
                                      </p>
                                    ))}
                                  </div>
                                )}
                                {/* 이미지 */}
                                {firstItem.passageImage && (
                                  <img src={firstItem.passageImage} alt="공통 이미지" className="mt-2 max-w-full max-h-[300px] object-contain border border-[#1A1A1A]" />
                                )}
                              </div>
                            )}

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
                                  onBookmark={handleBookmarkToggle}
                                  currentUserId={user?.uid}
                                  quizCreatorId={quizCreatorsMap.get(subItem.quizId)}
                                  courseId={userCourse?.id}
                                  folderType={folderType}
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
      {!loading && questions.length > 0 && !isDeleteMode && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#F5F0E8] border-t-2 border-[#1A1A1A]">
          <button
            onClick={handleStartPractice}
            className="w-full py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors"
          >
            {isSelectMode && selectedIds.size > 0
              ? `${selectedIds.size}개 문제 복습하기`
              : '전체 복습하기'}
          </button>
        </div>
      )}

      {/* 삭제 모드일 때 하단 버튼 - 삭제 + 찜 + 복습 */}
      {!loading && isDeleteMode && !isAssignMode && selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#F5F0E8] border-t-2 border-[#1A1A1A]">
          <div className="flex gap-2">
            <button
              onClick={handleDeleteSelectedQuestions}
              className="flex-1 py-3 text-sm font-bold bg-[#8B1A1A] text-[#F5F0E8] border-2 border-[#8B1A1A] hover:bg-[#6B1414] transition-colors"
            >
              삭제
            </button>
            <button
              onClick={async () => {
                const allTargetItems = questions.filter(q => selectedIds.has(q.id));
                const notBookmarkedItems = allTargetItems.filter(q => !q.isBookmarked);
                const alreadyBookmarkedCount = allTargetItems.length - notBookmarkedItems.length;

                if (notBookmarkedItems.length === 0) {
                  showToast('선택한 문제가 모두 이미 찜되어 있습니다.');
                  return;
                }

                for (const item of notBookmarkedItems) {
                  await toggleQuestionBookmark(item);
                }

                // 커스텀 폴더의 경우 로컬 상태도 업데이트
                if (folderType === 'custom') {
                  const bookmarkedIds = new Set(notBookmarkedItems.map(q => q.questionId));
                  setCustomQuestions(prev => prev.map(q =>
                    bookmarkedIds.has(q.questionId)
                      ? { ...q, isBookmarked: true }
                      : q
                  ));
                }

                // 선택 유지, 모드 유지
                if (alreadyBookmarkedCount > 0) {
                  showToast(`${notBookmarkedItems.length}개 문제 찜 완료 (${alreadyBookmarkedCount}개는 이미 찜됨)`);
                } else {
                  showToast(`${notBookmarkedItems.length}개 문제 찜 완료`);
                }
              }}
              className="flex-1 py-3 text-sm font-bold bg-[#F5F0E8] text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              찜
            </button>
            <button
              onClick={() => {
                const targetItems = questions.filter(q => selectedIds.has(q.id));
                if (targetItems.length > 0) {
                  setPracticeItems(targetItems);
                  setIsSelectMode(false);
                  setIsDeleteMode(false);
                  setSelectedIds(new Set());
                }
              }}
              className="flex-1 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors"
            >
              복습
            </button>
          </div>
        </div>
      )}

      {/* 배정 모드일 때 하단 안내 */}
      {!loading && isAssignMode && isSelectMode && selectedIds.size === 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#EDEAE4] border-t-2 border-[#1A1A1A]">
          <p className="text-sm text-center text-[#5C5C5C]">
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
    </div>
  );
}
