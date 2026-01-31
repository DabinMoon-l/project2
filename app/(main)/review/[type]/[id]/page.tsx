'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useParams } from 'next/navigation';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useReview, type ReviewItem } from '@/lib/hooks/useReview';
import { Skeleton } from '@/components/common';
import ReviewPractice from '@/components/review/ReviewPractice';

/**
 * 문제 카드 컴포넌트
 */
function QuestionCard({
  item,
  isSelectMode,
  isSelected,
  onSelect,
  onDelete,
  showDelete,
}: {
  item: ReviewItem;
  isSelectMode: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  showDelete?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
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
            {/* 정답/오답 표시 */}
            {item.isCorrect !== undefined && (
              <span className={`inline-block px-2 py-0.5 text-xs font-bold mb-1 ${
                item.isCorrect
                  ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
                  : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
              }`}>
                {item.isCorrect ? '정답' : '오답'}
              </span>
            )}
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

          {/* 삭제 버튼 */}
          {showDelete && onDelete && !isSelectMode && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="w-6 h-6 border border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] flex items-center justify-center flex-shrink-0 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
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
                  <p className="text-xs font-bold text-[#5C5C5C] mb-2">선지</p>
                  <div className="space-y-1">
                    {item.options.map((opt, idx) => {
                      const optionNum = (idx + 1).toString();
                      const isCorrectOption = item.correctAnswer === optionNum;
                      const isUserAnswer = item.userAnswer === optionNum;

                      return (
                        <p
                          key={idx}
                          className={`text-xs p-2 border ${
                            isCorrectOption
                              ? 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]'
                              : isUserAnswer
                              ? 'border-[#8B1A1A] bg-[#FDEAEA] text-[#8B1A1A]'
                              : 'border-[#EDEAE4] text-[#5C5C5C] bg-[#F5F0E8]'
                          }`}
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * 폴더 상세 페이지
 */
export default function FolderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();

  const folderType = params.type as string; // solved, wrong, bookmark, custom
  const folderId = params.id as string;

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
  const [practiceItems, setPracticeItems] = useState<ReviewItem[] | null>(null);
  const [isAddMode, setIsAddMode] = useState(false);
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

  // 문제 삭제 (커스텀 폴더에서)
  const handleDeleteFromFolder = async (questionId: string) => {
    if (folderType !== 'custom') return;

    const confirmed = window.confirm('이 문제를 폴더에서 제거하시겠습니까?');
    if (!confirmed) return;

    try {
      await removeFromCustomFolder(folderId, questionId);
      setCustomQuestions(prev => prev.filter(q => q.questionId !== questionId));
    } catch (err) {
      console.error('문제 제거 실패:', err);
      alert('제거에 실패했습니다.');
    }
  };

  // 선택된 문제로 연습 시작
  const handleStartPractice = () => {
    if (selectedIds.size === 0) {
      // 전체 문제로 연습
      setPracticeItems(questions);
    } else {
      // 선택된 문제로 연습
      const selected = questions.filter(q => selectedIds.has(q.id));
      setPracticeItems(selected);
    }
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

  // 연습 모드
  if (practiceItems) {
    return (
      <ReviewPractice
        items={practiceItems}
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

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="sticky top-0 z-50 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]">
        <div className="flex items-center justify-between h-14 px-4">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 flex items-center justify-center"
          >
            <svg className="w-6 h-6 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-base font-bold text-[#1A1A1A] truncate max-w-[200px]">
            {folderTitle}
          </h1>
          <div className="w-8" />
        </div>
      </header>

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
        </p>
        <button
          onClick={() => {
            if (isSelectMode) {
              setIsSelectMode(false);
              setSelectedIds(new Set());
            } else {
              setIsSelectMode(true);
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
            questions.map(item => (
              <QuestionCard
                key={item.id}
                item={item}
                isSelectMode={isSelectMode}
                isSelected={selectedIds.has(item.id)}
                onSelect={() => handleSelectQuestion(item.id)}
                onDelete={folderType === 'custom' ? () => handleDeleteFromFolder(item.questionId) : undefined}
                showDelete={folderType === 'custom'}
              />
            ))
          )}
        </main>
      )}

      {/* 하단 버튼 영역 */}
      {!loading && questions.length > 0 && (
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
    </div>
  );
}
