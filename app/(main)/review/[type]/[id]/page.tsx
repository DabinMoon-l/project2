'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useParams } from 'next/navigation';
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
import { useReview, type ReviewItem } from '@/lib/hooks/useReview';
import { useCourse } from '@/lib/contexts/CourseContext';
import { Skeleton, BottomSheet } from '@/components/common';
import ReviewPractice from '@/components/review/ReviewPractice';

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
  { value: 'solved', line1: '푼 문제' },
  { value: 'wrong', line1: '틀린', line2: '문제' },
  { value: 'bookmark', line1: '찜한', line2: '문제' },
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
          className={`relative z-10 w-1/4 px-3 py-2 text-xs font-bold transition-colors text-center flex flex-col items-center justify-center ${
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
  isSelectMode,
  isSelected,
  onSelect,
  onFeedbackSubmit,
}: {
  item: ReviewItem;
  questionNumber: number;
  isSelectMode: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onFeedbackSubmit?: (questionId: string, type: FeedbackType, content: string) => void;
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
            {/* 문항 번호 + 정답/오답 표시 */}
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block px-2 py-0.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8]">
                Q{questionNumber}
              </span>
              {item.isCorrect !== undefined && (
                <span className={`inline-block px-2 py-0.5 text-xs font-bold ${
                  item.isCorrect
                    ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
                    : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
                }`}>
                  {item.isCorrect ? '정답' : '오답'}
                </span>
              )}
            </div>
            <p className="text-sm text-[#1A1A1A] line-clamp-2">{item.question}</p>
          </div>

          {/* 선택 체크박스 */}
          {isSelectMode && (
            <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${
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
              className={`w-5 h-5 text-[#5C5C5C] transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
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
              {/* 선지 (객관식) */}
              {item.options && item.options.length > 0 && (
                <div>
                  {/* 복수 정답 표시 */}
                  {(() => {
                    const correctAnswerStr = item.correctAnswer?.toString() || '';
                    const correctAnswers = correctAnswerStr.includes(',')
                      ? correctAnswerStr.split(',').map(a => a.trim())
                      : [correctAnswerStr];
                    const isMultipleAnswer = correctAnswers.length > 1;
                    return isMultipleAnswer && (
                      <p className="text-xs text-[#8B6914] font-bold mb-2 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        복수 정답 ({correctAnswers.length}개)
                      </p>
                    );
                  })()}
                  <p className="text-xs font-bold text-[#5C5C5C] mb-2">선지</p>
                  <div className="space-y-1">
                    {item.options.map((opt, idx) => {
                      const optionNum = (idx + 1).toString();
                      const optionIdx = idx.toString();
                      // 복수 정답 지원
                      const correctAnswerStr = item.correctAnswer?.toString() || '';
                      const correctAnswers = correctAnswerStr.includes(',')
                        ? correctAnswerStr.split(',').map(a => a.trim())
                        : [correctAnswerStr];
                      const isCorrectOption = correctAnswers.some(ca =>
                        ca === optionNum || ca === optionIdx || ca === opt
                      );
                      // 사용자 답 비교
                      const userAnswerStr = item.userAnswer?.toString() || '';
                      const userAnswers = userAnswerStr.includes(',')
                        ? userAnswerStr.split(',').map(a => a.trim())
                        : [userAnswerStr];
                      const isUserAnswer = userAnswers.some(ua =>
                        ua === optionNum || ua === optionIdx || ua === opt
                      );

                      // 스타일 결정: 정답 > 내 오답 > 기본
                      let className = 'border-[#EDEAE4] text-[#5C5C5C] bg-[#F5F0E8]';
                      if (isCorrectOption) {
                        className = 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]';
                      } else if (isUserAnswer) {
                        className = 'border-[#8B1A1A] bg-[#FDEAEA] text-[#8B1A1A]';
                      }

                      return (
                        <p
                          key={idx}
                          className={`text-xs p-2 border ${className}`}
                        >
                          {idx + 1}. {opt}
                          {isCorrectOption && ' (정답)'}
                          {isUserAnswer && !isCorrectOption && ' (내 선택)'}
                        </p>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* OX/주관식 답 */}
              {(!item.options || item.options.length === 0) && (
                <div className="space-y-2">
                  <p className="text-xs">
                    <span className="text-[#5C5C5C]">내 답: </span>
                    <span className="font-bold text-[#1A1A1A]">{item.userAnswer || '(미응답)'}</span>
                  </p>
                  <p className="text-xs">
                    <span className="text-[#5C5C5C]">정답: </span>
                    <span className="font-bold text-[#1A6B1A]">{item.correctAnswer}</span>
                  </p>
                </div>
              )}

              {/* 해설 */}
              {item.explanation && (
                <div>
                  <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                  <p className="text-xs text-[#5C5C5C] bg-[#F5F0E8] p-2 border border-[#1A1A1A]">
                    {item.explanation}
                  </p>
                </div>
              )}

              {/* 피드백 버튼 */}
              {onFeedbackSubmit && (
                <div className="pt-2 border-t border-[#EDEAE4]">
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
  const { user } = useAuth();
  const { userCourse } = useCourse();

  const folderType = params.type as string; // solved, wrong, bookmark, custom
  const folderId = params.id as string;

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
  } = useReview();

  const [customQuestions, setCustomQuestions] = useState<ReviewItem[]>([]);
  const [customLoading, setCustomLoading] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [practiceItems, setPracticeItems] = useState<ReviewItem[] | null>(null);
  const [isAddMode, setIsAddMode] = useState(false);
  const [showEmptyMessage, setShowEmptyMessage] = useState(false);
  const [addSourceTab, setAddSourceTab] = useState<'solved' | 'wrong' | 'bookmark'>('solved');
  const [addSelectedIds, setAddSelectedIds] = useState<Set<string>>(new Set());

  const loadedFolderRef = useRef<string | null>(null);

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
      return group ? { title: group.quizTitle, items: group.items } : null;
    } else if (folderType === 'bookmark') {
      const group = groupedBookmarkedItems.find(g => g.quizId === folderId);
      return group ? { title: group.quizTitle, items: group.items } : null;
    } else if (folderType === 'custom' && customFolder) {
      return { title: customFolder.name, items: null as ReviewItem[] | null };
    }
    return null;
  }, [folderType, folderId, groupedSolvedItems, groupedWrongItems, groupedBookmarkedItems, customFolder]);

  // 커스텀 폴더일 때만 비동기로 문제 로드
  useEffect(() => {
    if (!user || folderType !== 'custom' || !customFolder) return;
    if (loadedFolderRef.current === folderId) return;

    const loadCustomQuestions = async () => {
      setCustomLoading(true);
      const items: ReviewItem[] = [];

      for (const q of customFolder.questions) {
        const reviewQuery = query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('questionId', '==', q.questionId)
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
          });
        }
      }

      setCustomQuestions(items);
      loadedFolderRef.current = folderId;
      setCustomLoading(false);
    };

    loadCustomQuestions();
  }, [user, folderType, folderId, customFolder]);

  // 최종 데이터
  const folderTitle = folderData?.title || '';
  const questions = folderType === 'custom' ? customQuestions : (folderData?.items || []);
  const loading = folderType === 'custom' ? customLoading : !folderData;

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

  // 문제 추가 모드 소스 데이터
  const getAddSourceItems = () => {
    switch (addSourceTab) {
      case 'solved':
        return solvedItems;
      case 'wrong':
        return wrongItems;
      case 'bookmark':
        return bookmarkedItems;
      default:
        return [];
    }
  };

  // 문제 추가 선택/해제
  const handleAddSelect = (questionId: string) => {
    const newSelected = new Set(addSelectedIds);
    if (newSelected.has(questionId)) {
      newSelected.delete(questionId);
    } else {
      newSelected.add(questionId);
    }
    setAddSelectedIds(newSelected);
  };

  // 선택된 문제들 삭제
  const handleDeleteSelectedQuestions = async () => {
    if (selectedIds.size === 0) return;

    const confirmed = window.confirm(`선택한 ${selectedIds.size}개의 문제를 삭제하시겠습니까?`);
    if (!confirmed) return;

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
      setSelectedIds(new Set());
      setIsSelectMode(false);
      setIsDeleteMode(false);
    } catch (err) {
      console.error('문제 삭제 실패:', err);
      alert('삭제에 실패했습니다.');
    }
  };

  // 문제 추가 확정
  const handleAddQuestions = async () => {
    if (addSelectedIds.size === 0) return;

    try {
      const sourceItems = getAddSourceItems();
      const selectedItems = sourceItems.filter(item => addSelectedIds.has(item.id));

      const questionsToAdd = selectedItems.map(item => ({
        questionId: item.questionId,
        quizId: item.quizId,
        quizTitle: item.quizTitle || '',
      }));

      await addToCustomFolder(folderId, questionsToAdd);

      // 추가된 문제 UI 업데이트
      setCustomQuestions(prev => [...prev, ...selectedItems]);

      setIsAddMode(false);
      setAddSelectedIds(new Set());
    } catch (err) {
      console.error('문제 추가 실패:', err);
      alert('추가에 실패했습니다.');
    }
  };

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
      />
    );
  }

  // 문제 추가 모드
  if (isAddMode && folderType === 'custom') {
    const sourceItems = getAddSourceItems();

    return (
      <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
        {/* 헤더 */}
        <header className="sticky top-0 z-50 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]">
          <div className="flex items-center justify-between h-14 px-4">
            <button
              onClick={() => {
                setIsAddMode(false);
                setAddSelectedIds(new Set());
              }}
              className="text-[#1A1A1A] font-bold"
            >
              취소
            </button>
            <h1 className="text-base font-bold text-[#1A1A1A]">문제 추가</h1>
            <button
              onClick={handleAddQuestions}
              disabled={addSelectedIds.size === 0}
              className="text-[#1A1A1A] font-bold disabled:opacity-30"
            >
              추가 ({addSelectedIds.size})
            </button>
          </div>
        </header>

        {/* 소스 탭 */}
        <div className="px-4 py-3 border-b border-[#EDEAE4]">
          <div className="flex gap-2">
            {(['solved', 'wrong', 'bookmark'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setAddSourceTab(tab)}
                className={`px-3 py-1.5 text-xs font-bold border transition-colors ${
                  addSourceTab === tab
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A]'
                }`}
              >
                {tab === 'solved' ? '푼 문제' : tab === 'wrong' ? '틀린 문제' : '찜한 문제'}
              </button>
            ))}
          </div>
        </div>

        {/* 문제 목록 */}
        <main className="px-4 py-4 space-y-2">
          {sourceItems.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-[#5C5C5C]">추가할 문제가 없습니다.</p>
            </div>
          ) : (
            sourceItems.map(item => (
              <div
                key={item.id}
                onClick={() => handleAddSelect(item.id)}
                className={`p-3 border cursor-pointer transition-all ${
                  addSelectedIds.has(item.id)
                    ? 'border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]'
                    : 'border border-[#1A1A1A] bg-[#F5F0E8]'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${
                    addSelectedIds.has(item.id) ? 'bg-[#1A1A1A]' : 'border border-[#5C5C5C]'
                  }`}>
                    {addSelectedIds.has(item.id) && (
                      <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#5C5C5C] mb-1">{item.quizTitle}</p>
                    <p className="text-sm text-[#1A1A1A] line-clamp-2">{item.question}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </main>
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
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
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
            onClick={() => router.push('/review')}
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
          {/* 선택 모드일 때 버튼들 */}
          {isSelectMode && (
            <>
              {/* 전체 선택 버튼 */}
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
              {/* 삭제 버튼 (선택된 항목이 있을 때) */}
              {selectedIds.size > 0 && isDeleteMode && (
                <button
                  onClick={handleDeleteSelectedQuestions}
                  className="px-3 py-1.5 text-xs font-bold border transition-colors bg-[#8B1A1A] text-[#F5F0E8] border-[#8B1A1A] hover:bg-[#6B1414]"
                >
                  삭제
                </button>
              )}
            </>
          )}
          <button
            onClick={() => {
              if (isSelectMode) {
                setIsSelectMode(false);
                setIsDeleteMode(false);
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
          ) : (
            questions.map((item, index) => (
              <QuestionCard
                key={item.id}
                item={item}
                questionNumber={index + 1}
                isSelectMode={isSelectMode}
                isSelected={selectedIds.has(item.id)}
                onSelect={() => handleSelectQuestion(item.id)}
                onFeedbackSubmit={handleFeedbackSubmit}
              />
            ))
          )}
        </main>
      )}

      {/* 하단 버튼 영역 */}
      {!loading && questions.length > 0 && !isDeleteMode && (
        <div className="fixed bottom-20 left-0 right-0 p-4 bg-[#F5F0E8] border-t-2 border-[#1A1A1A]">
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

      {/* 삭제 모드일 때 하단 버튼 - 삭제 + 복습 */}
      {!loading && isDeleteMode && selectedIds.size > 0 && (
        <div className="fixed bottom-20 left-0 right-0 p-4 bg-[#F5F0E8] border-t-2 border-[#1A1A1A]">
          <div className="flex gap-2">
            <button
              onClick={handleDeleteSelectedQuestions}
              className="flex-1 py-3 text-sm font-bold bg-[#8B1A1A] text-[#F5F0E8] border-2 border-[#8B1A1A] hover:bg-[#6B1414] transition-colors"
            >
              {selectedIds.size}개 삭제
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
              {selectedIds.size}개 복습
            </button>
          </div>
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
    </div>
  );
}
