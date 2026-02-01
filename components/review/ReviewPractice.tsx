'use client';

import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import type { ReviewItem } from '@/lib/hooks/useReview';
import { useReview } from '@/lib/hooks/useReview';
import OXChoice, { OXAnswer } from '@/components/quiz/OXChoice';
import MultipleChoice from '@/components/quiz/MultipleChoice';
import ShortAnswer from '@/components/quiz/ShortAnswer';
import { BottomSheet } from '@/components/common';

/** 피드백 타입 */
type FeedbackType = 'unclear' | 'wrong' | 'typo' | 'other';

/** 피드백 유형 옵션 */
const FEEDBACK_TYPES: { type: FeedbackType; label: string }[] = [
  { type: 'unclear', label: '문제가 이해가 안 돼요' },
  { type: 'wrong', label: '정답이 틀린 것 같아요' },
  { type: 'typo', label: '오타가 있어요' },
  { type: 'other', label: '기타 의견' },
];

interface ReviewPracticeProps {
  /** 복습할 문제 목록 */
  items: ReviewItem[];
  /** 퀴즈 제목 (선택) */
  quizTitle?: string;
  /** 완료 핸들러 */
  onComplete: (results: PracticeResult[]) => void;
  /** 닫기 핸들러 */
  onClose: () => void;
}

/**
 * 연습 결과 타입
 */
export interface PracticeResult {
  /** 복습 문제 ID */
  reviewId: string;
  /** 사용자 답변 */
  userAnswer: string;
  /** 정답 여부 */
  isCorrect: boolean;
}

/** 답안 타입 */
type AnswerType = string | number | number[] | null;

/** 화면 단계 */
type Phase = 'practice' | 'result' | 'feedback';

/**
 * 복습 연습 모드 컴포넌트
 */
export default function ReviewPractice({
  items,
  quizTitle,
  onComplete,
  onClose,
}: ReviewPracticeProps) {
  // 현재 화면 단계
  const [phase, setPhase] = useState<Phase>('practice');
  // 현재 문제 인덱스
  const [currentIndex, setCurrentIndex] = useState(0);
  // 모든 문제의 답안 저장 (인덱스별)
  const [answers, setAnswers] = useState<Record<number, AnswerType>>({});
  // 제출된 문제 인덱스 Set
  const [submittedIndices, setSubmittedIndices] = useState<Set<number>>(new Set());
  // 결과 저장 (인덱스별)
  const [resultsMap, setResultsMap] = useState<Record<number, PracticeResult>>({});
  // 결과 화면에서 펼쳐진 문제 ID Set
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // 피드백 화면 상태
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // useReview 훅에서 폴더 관련 함수 가져오기
  const { customFolders, createCustomFolder, addToCustomFolder } = useReview();
  const { user } = useAuth();

  // 피드백 바텀시트 상태
  const [feedbackTargetItem, setFeedbackTargetItem] = useState<ReviewItem | null>(null);
  const [selectedFeedbackType, setSelectedFeedbackType] = useState<FeedbackType | null>(null);
  const [feedbackContent, setFeedbackContent] = useState('');
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState(false);
  const [submittedFeedbackIds, setSubmittedFeedbackIds] = useState<Set<string>>(new Set());

  // 현재 문제의 답안
  const answer = answers[currentIndex] ?? null;
  // 현재 문제의 제출 여부
  const isSubmitted = submittedIndices.has(currentIndex);

  // 답안 설정 함수
  const setAnswer = (value: AnswerType) => {
    setAnswers(prev => ({ ...prev, [currentIndex]: value }));
  };

  // 현재 문제
  const currentItem = items[currentIndex];
  const totalCount = items.length;
  const isLastQuestion = currentIndex === totalCount - 1;

  // 결과 배열
  const resultsArray = useMemo(() => {
    return items.map((_, idx) => resultsMap[idx]).filter(Boolean);
  }, [items, resultsMap]);

  // 틀린 문제 목록
  const wrongItems = useMemo(() => {
    return items.filter((item, idx) => resultsMap[idx] && !resultsMap[idx].isCorrect);
  }, [items, resultsMap]);

  // 정답 개수
  const correctCount = useMemo(() => {
    return resultsArray.filter(r => r.isCorrect).length;
  }, [resultsArray]);

  // 문제 유형별 라벨
  const typeLabels: Record<string, string> = {
    ox: 'OX',
    multiple: '객관식',
    short: '주관식',
    subjective: '주관식',
  };

  // 복수 정답 여부 확인
  const isMultipleAnswerQuestion = useCallback(() => {
    if (!currentItem) return false;
    const correctAnswerStr = currentItem.correctAnswer?.toString() || '';
    return correctAnswerStr.includes(',');
  }, [currentItem]);

  // 정답 체크
  const checkAnswer = useCallback(() => {
    if (!currentItem || answer === null) return false;

    const correctAnswerStr = currentItem.correctAnswer.toString();
    const isMultipleAnswer = correctAnswerStr.includes(',');

    if (currentItem.type === 'multiple') {
      if (isMultipleAnswer) {
        const correctIndices = correctAnswerStr.split(',').map(s => parseInt(s.trim(), 10));
        if (Array.isArray(answer)) {
          const userIndices = answer.map(i => i + 1);
          const sortedCorrect = [...correctIndices].sort((a, b) => a - b);
          const sortedUser = [...userIndices].sort((a, b) => a - b);
          return (
            sortedCorrect.length === sortedUser.length &&
            sortedCorrect.every((val, idx) => val === sortedUser[idx])
          );
        }
        return false;
      } else {
        if (typeof answer === 'number') {
          const oneIndexed = (answer + 1).toString();
          return correctAnswerStr === oneIndexed;
        }
        return false;
      }
    }

    if (currentItem.type === 'ox') {
      const userAnswer = answer.toString().toUpperCase();
      let normalizedCorrect = correctAnswerStr.toUpperCase();
      if (normalizedCorrect === '0') normalizedCorrect = 'O';
      else if (normalizedCorrect === '1') normalizedCorrect = 'X';
      return userAnswer === normalizedCorrect;
    }

    const userAnswerNormalized = answer.toString().trim().toLowerCase();
    if (correctAnswerStr.includes('|||')) {
      const correctAnswers = correctAnswerStr.split('|||').map(a => a.trim().toLowerCase());
      return correctAnswers.some(ca => userAnswerNormalized === ca);
    }
    return userAnswerNormalized === correctAnswerStr.trim().toLowerCase();
  }, [currentItem, answer]);

  // 답변 제출
  const handleSubmit = () => {
    if (answer === null || (Array.isArray(answer) && answer.length === 0)) return;

    const isCorrectAnswer = checkAnswer();
    const newResult: PracticeResult = {
      reviewId: currentItem.id,
      userAnswer: Array.isArray(answer) ? answer.join(',') : answer.toString(),
      isCorrect: isCorrectAnswer,
    };
    setResultsMap(prev => ({ ...prev, [currentIndex]: newResult }));
    setSubmittedIndices(prev => new Set(prev).add(currentIndex));
  };

  // 다음 문제로 이동
  const handleNext = () => {
    if (isLastQuestion) {
      // 결과 화면으로 이동
      setPhase('result');
    } else {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  // 이전 문제로 이동
  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  // 결과 화면에서 피드백 화면으로
  const handleGoToFeedback = () => {
    setPhase('feedback');
  };

  // 피드백 화면에서 완료
  const handleFinish = () => {
    onComplete(resultsArray);
  };

  // 새 폴더 생성
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setIsCreatingFolder(true);
    try {
      const folderId = await createCustomFolder(newFolderName.trim());
      if (folderId) {
        setSelectedFolderId(folderId);
        setNewFolderName('');
      }
    } catch (err) {
      console.error('폴더 생성 실패:', err);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // 틀린 문제를 폴더에 저장
  const handleSaveToFolder = async () => {
    if (!selectedFolderId || wrongItems.length === 0) return;
    setIsSaving(true);
    try {
      const questionsToAdd = wrongItems.map(item => ({
        questionId: item.questionId,
        quizId: item.quizId,
        quizTitle: item.quizTitle || '',
      }));
      await addToCustomFolder(selectedFolderId, questionsToAdd);
      setSaveSuccess(true);
    } catch (err) {
      console.error('저장 실패:', err);
      alert('저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  // 문제 펼치기/접기 토글
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // 피드백 바텀시트 열기
  const openFeedbackSheet = (item: ReviewItem) => {
    if (submittedFeedbackIds.has(item.questionId)) return;
    setFeedbackTargetItem(item);
  };

  // 피드백 바텀시트 닫기
  const closeFeedbackSheet = () => {
    setFeedbackTargetItem(null);
    setSelectedFeedbackType(null);
    setFeedbackContent('');
  };

  // 피드백 제출
  const handleFeedbackSubmit = async () => {
    if (!feedbackTargetItem || !selectedFeedbackType || !user) return;
    setIsFeedbackSubmitting(true);
    try {
      const feedbackRef = collection(db, 'questionFeedbacks');
      await addDoc(feedbackRef, {
        questionId: feedbackTargetItem.questionId,
        quizId: feedbackTargetItem.quizId,
        userId: user.uid,
        type: selectedFeedbackType,
        content: feedbackContent,
        createdAt: serverTimestamp(),
      });
      setSubmittedFeedbackIds(prev => new Set(prev).add(feedbackTargetItem.questionId));
      closeFeedbackSheet();
    } catch (err) {
      console.error('피드백 제출 실패:', err);
      alert('피드백 제출에 실패했습니다.');
    } finally {
      setIsFeedbackSubmitting(false);
    }
  };

  // 정답 여부 (제출된 경우 저장된 결과 사용)
  const isCorrect = isSubmitted && resultsMap[currentIndex]?.isCorrect;

  // 진행률 계산
  const progress = ((currentIndex + 1) / totalCount) * 100;

  // ========== 결과 화면 ==========
  if (phase === 'result') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[60] overflow-y-auto"
        style={{ backgroundColor: '#F5F0E8' }}
      >
        {/* 헤더 */}
        <header className="sticky top-0 z-50 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]">
          <div className="flex items-center justify-between h-14 px-4">
            <div className="w-10" />
            <h1 className="text-base font-bold text-[#1A1A1A]">복습 결과</h1>
            <div className="w-10" />
          </div>
        </header>

        <main className="px-4 py-6 pb-28">
          {/* 점수 */}
          <div className="text-center mb-8">
            <p className="text-6xl font-bold text-[#1A1A1A]">
              {correctCount}/{totalCount}
            </p>
            <p className="text-sm text-[#5C5C5C] mt-2">
              정답률 {Math.round((correctCount / totalCount) * 100)}%
            </p>
          </div>

          {/* 문제 목록 */}
          <div className="space-y-2">
            {items.map((item, idx) => {
              const result = resultsMap[idx];
              const isItemCorrect = result?.isCorrect;
              const isExpanded = expandedIds.has(item.id);

              return (
                <div key={item.id} className="border-2 border-[#1A1A1A] bg-[#F5F0E8]">
                  {/* 문제 헤더 */}
                  <div
                    onClick={() => toggleExpand(item.id)}
                    className="p-3 cursor-pointer flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-6 h-6 flex items-center justify-center text-xs font-bold ${
                        isItemCorrect ? 'bg-[#1A6B1A] text-white' : 'bg-[#8B1A1A] text-white'
                      }`}>
                        {isItemCorrect ? 'O' : 'X'}
                      </span>
                      <span className="text-sm font-bold text-[#1A1A1A]">Q{idx + 1}</span>
                      <span className="text-sm text-[#5C5C5C] line-clamp-1 max-w-[200px]">
                        {item.question}
                      </span>
                    </div>
                    <svg
                      className={`w-5 h-5 text-[#5C5C5C] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* 문제 상세 */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t-2 border-[#1A1A1A] p-3 bg-[#EDEAE4] space-y-2">
                          <p className="text-sm text-[#1A1A1A]">{item.question}</p>

                          {/* 객관식 선지 */}
                          {item.options && item.options.length > 0 && (
                            <div className="space-y-1 mt-2">
                              {item.options.map((opt, optIdx) => {
                                const optionNum = (optIdx + 1).toString();
                                const correctAnswerStr = item.correctAnswer?.toString() || '';
                                const correctAnswers = correctAnswerStr.includes(',')
                                  ? correctAnswerStr.split(',').map(a => a.trim())
                                  : [correctAnswerStr];
                                const isCorrectOption = correctAnswers.includes(optionNum);

                                const userAnswerStr = result?.userAnswer || '';
                                const userAnswers = userAnswerStr.includes(',')
                                  ? userAnswerStr.split(',').map(a => (parseInt(a.trim(), 10) + 1).toString())
                                  : userAnswerStr ? [(parseInt(userAnswerStr, 10) + 1).toString()] : [];
                                const isUserAnswer = userAnswers.includes(optionNum);

                                let className = 'border-[#EDEAE4] text-[#5C5C5C] bg-[#F5F0E8]';
                                if (isCorrectOption) {
                                  className = 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]';
                                } else if (isUserAnswer) {
                                  className = 'border-[#8B1A1A] bg-[#FDEAEA] text-[#8B1A1A]';
                                }

                                return (
                                  <p key={optIdx} className={`text-xs p-2 border ${className}`}>
                                    {optIdx + 1}. {opt}
                                    {isCorrectOption && ' (정답)'}
                                    {isUserAnswer && !isCorrectOption && ' (내 선택)'}
                                  </p>
                                );
                              })}
                            </div>
                          )}

                          {/* OX/주관식 답 */}
                          {(!item.options || item.options.length === 0) && (
                            <div className="text-xs space-y-1 mt-2">
                              <p>
                                <span className="text-[#5C5C5C]">내 답: </span>
                                <span className={`font-bold ${isItemCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                                  {result?.userAnswer || '(미응답)'}
                                </span>
                              </p>
                              {!isItemCorrect && (
                                <p>
                                  <span className="text-[#5C5C5C]">정답: </span>
                                  <span className="font-bold text-[#1A6B1A]">
                                    {item.type === 'ox'
                                      ? (item.correctAnswer?.toString() === '0' || item.correctAnswer?.toString().toUpperCase() === 'O' ? 'O' : 'X')
                                      : item.correctAnswer?.toString()}
                                  </span>
                                </p>
                              )}
                            </div>
                          )}

                          {/* 해설 */}
                          {item.explanation && (
                            <div className="mt-2 p-2 bg-[#F5F0E8] border border-[#1A1A1A]">
                              <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                              <p className="text-xs text-[#1A1A1A]">{item.explanation}</p>
                            </div>
                          )}

                          {/* 피드백 버튼 */}
                          <div className="mt-3 pt-2 border-t border-[#EDEAE4]">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openFeedbackSheet(item);
                              }}
                              disabled={submittedFeedbackIds.has(item.questionId)}
                              className={`flex items-center gap-2 px-3 py-2 text-xs font-bold border-2 transition-colors ${
                                submittedFeedbackIds.has(item.questionId)
                                  ? 'bg-[#E8F5E9] border-[#1A6B1A] text-[#1A6B1A] cursor-default'
                                  : 'bg-[#FFF8E1] border-[#8B6914] text-[#8B6914] hover:bg-[#FFECB3]'
                              }`}
                            >
                              {submittedFeedbackIds.has(item.questionId) ? (
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
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </main>

        {/* 하단 버튼 */}
        <div className="fixed bottom-0 left-0 right-0 p-4 border-t-2 border-[#1A1A1A] bg-[#F5F0E8]">
          <button
            onClick={handleGoToFeedback}
            className="w-full py-4 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
          >
            다음
          </button>
        </div>

        {/* 피드백 바텀시트 */}
        <BottomSheet
          isOpen={!!feedbackTargetItem}
          onClose={closeFeedbackSheet}
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
      </motion.div>
    );
  }

  // ========== 피드백 화면 ==========
  if (phase === 'feedback') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[60] overflow-y-auto"
        style={{ backgroundColor: '#F5F0E8' }}
      >
        {/* 헤더 */}
        <header className="sticky top-0 z-50 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]">
          <div className="flex items-center justify-between h-14 px-4">
            <button
              onClick={() => setPhase('result')}
              className="p-2 -ml-2"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-base font-bold text-[#1A1A1A]">복습 완료</h1>
            <div className="w-10" />
          </div>
        </header>

        <main className="px-4 py-6 pb-28">
          {/* 결과 요약 */}
          <div className="text-center mb-8">
            <div className="w-20 h-20 mx-auto mb-4 bg-[#1A1A1A] rounded-full flex items-center justify-center">
              <svg className="w-10 h-10 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-[#1A1A1A]">복습을 완료했습니다!</h2>
            <p className="text-sm text-[#5C5C5C] mt-2">
              {totalCount}문제 중 {correctCount}문제 정답
            </p>
          </div>

          {/* 틀린 문제 폴더 저장 */}
          {wrongItems.length > 0 && !saveSuccess && (
            <div className="border-2 border-[#1A1A1A] bg-[#F5F0E8] p-4">
              <h3 className="font-bold text-[#1A1A1A] mb-3">
                틀린 문제 {wrongItems.length}개를 폴더에 저장하시겠습니까?
              </h3>

              {/* 기존 폴더 선택 */}
              {customFolders.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-[#5C5C5C] mb-2">기존 폴더 선택</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {customFolders.map(folder => (
                      <button
                        key={folder.id}
                        onClick={() => setSelectedFolderId(folder.id)}
                        className={`w-full text-left px-3 py-2 text-sm border transition-colors ${
                          selectedFolderId === folder.id
                            ? 'border-[#1A1A1A] bg-[#EDEAE4] font-bold'
                            : 'border-[#EDEAE4] hover:border-[#1A1A1A]'
                        }`}
                      >
                        {folder.name} ({folder.questions.length}문제)
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 새 폴더 생성 */}
              <div className="mb-4">
                <p className="text-xs text-[#5C5C5C] mb-2">새 폴더 만들기</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="폴더 이름 입력"
                    className="flex-1 px-3 py-2 text-sm border border-[#1A1A1A] bg-[#F5F0E8] outline-none focus:border-2"
                  />
                  <button
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim() || isCreatingFolder}
                    className="px-4 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] disabled:opacity-50"
                  >
                    {isCreatingFolder ? '...' : '생성'}
                  </button>
                </div>
              </div>

              {/* 저장 버튼 */}
              {selectedFolderId && (
                <button
                  onClick={handleSaveToFolder}
                  disabled={isSaving}
                  className="w-full py-3 text-sm font-bold bg-[#1A6B1A] text-[#F5F0E8] hover:bg-[#155415] transition-colors disabled:opacity-50"
                >
                  {isSaving ? '저장 중...' : `선택한 폴더에 ${wrongItems.length}문제 저장`}
                </button>
              )}
            </div>
          )}

          {/* 저장 완료 메시지 */}
          {saveSuccess && (
            <div className="border-2 border-[#1A6B1A] bg-[#E8F5E9] p-4 text-center">
              <svg className="w-12 h-12 mx-auto mb-2 text-[#1A6B1A]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <p className="font-bold text-[#1A6B1A]">저장되었습니다!</p>
              <p className="text-sm text-[#5C5C5C] mt-1">
                내맘대로 폴더에서 확인할 수 있습니다.
              </p>
            </div>
          )}

          {/* 틀린 문제가 없는 경우 */}
          {wrongItems.length === 0 && (
            <div className="border-2 border-[#1A6B1A] bg-[#E8F5E9] p-4 text-center">
              <svg className="w-12 h-12 mx-auto mb-2 text-[#1A6B1A]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <p className="font-bold text-[#1A6B1A]">모든 문제를 맞혔습니다!</p>
            </div>
          )}
        </main>

        {/* 하단 버튼 */}
        <div className="fixed bottom-0 left-0 right-0 p-4 border-t-2 border-[#1A1A1A] bg-[#F5F0E8]">
          <button
            onClick={handleFinish}
            className="w-full py-4 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
          >
            완료
          </button>
        </div>
      </motion.div>
    );
  }

  // ========== 문제 풀이 화면 ==========
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50"
      style={{ backgroundColor: '#F5F0E8' }}
    >
      {/* 헤더 */}
      <header
        className="sticky top-0 z-50 w-full border-b-2 border-[#1A1A1A]"
        style={{ backgroundColor: '#F5F0E8' }}
      >
        <div className="flex items-center justify-between h-14 px-4">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={onClose}
            className="p-2 -ml-2 transition-colors duration-200 text-[#1A1A1A] hover:bg-[#EDEAE4]"
            aria-label="나가기"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </motion.button>

          <div className="text-center">
            <h1 className="text-base font-bold text-[#1A1A1A]">복습 연습</h1>
            {(quizTitle || currentItem?.quizTitle) && (
              <p className="text-xs text-[#5C5C5C] mt-0.5 truncate max-w-[200px]">
                {quizTitle || currentItem?.quizTitle}
              </p>
            )}
          </div>

          <div className="text-sm font-bold min-w-[3rem] text-right text-[#1A1A1A]">
            {currentIndex + 1}/{totalCount}
          </div>
        </div>

        <div className="h-1.5 w-full bg-[#EDEAE4]">
          <motion.div
            className="h-full bg-[#1A1A1A]"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </div>
      </header>

      {/* 문제 영역 */}
      <main className="px-4 py-6 pb-40 overflow-y-auto flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentItem.id}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.3 }}
          >
            {/* 문제 카드 */}
            <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg font-bold text-[#1A1A1A]">Q{currentIndex + 1}.</span>
                <span className="px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold">
                  {typeLabels[currentItem.type] || '문제'}
                </span>
                {isMultipleAnswerQuestion() && (
                  <span className="px-2 py-0.5 bg-[#1A6B1A] text-[#F5F0E8] text-xs font-bold">
                    복수정답
                  </span>
                )}
              </div>
              <p className="text-[#1A1A1A] text-base leading-relaxed whitespace-pre-wrap">
                {currentItem.question}
              </p>
            </div>

            {/* 선지 영역 */}
            <div className="mt-4">
              {currentItem.type === 'ox' && (
                <OXChoice
                  selected={answer as OXAnswer}
                  onSelect={(value) => !isSubmitted && setAnswer(value)}
                  disabled={isSubmitted}
                />
              )}

              {currentItem.type === 'multiple' && currentItem.options && (
                isMultipleAnswerQuestion() ? (
                  <MultipleChoice
                    choices={currentItem.options}
                    multiSelect
                    selectedIndices={Array.isArray(answer) ? answer : []}
                    onMultiSelect={(indices) => !isSubmitted && setAnswer(indices)}
                    disabled={isSubmitted}
                    correctIndices={
                      isSubmitted
                        ? currentItem.correctAnswer.toString().split(',').map(s => parseInt(s.trim(), 10) - 1)
                        : undefined
                    }
                  />
                ) : (
                  <MultipleChoice
                    choices={currentItem.options}
                    selected={typeof answer === 'number' ? answer : null}
                    onSelect={(index) => !isSubmitted && setAnswer(index)}
                    disabled={isSubmitted}
                    correctIndex={
                      isSubmitted
                        ? parseInt(currentItem.correctAnswer.toString(), 10) - 1
                        : undefined
                    }
                  />
                )
              )}

              {(currentItem.type === 'short' || currentItem.type === 'subjective') && (
                <ShortAnswer
                  value={(answer as string) || ''}
                  onChange={(value) => !isSubmitted && setAnswer(value)}
                  disabled={isSubmitted}
                />
              )}
            </div>

            {/* 제출 후 결과 표시 */}
            <AnimatePresence>
              {isSubmitted && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="mt-6"
                >
                  <div
                    className={`p-4 text-center border-2 ${
                      isCorrect
                        ? 'bg-[#E8F5E9] border-[#1A6B1A]'
                        : 'bg-[#FDEAEA] border-[#8B1A1A]'
                    }`}
                  >
                    <p className={`text-xl font-bold ${isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                      {isCorrect ? '정답입니다!' : '오답입니다'}
                    </p>

                    {!isCorrect && (
                      <div className="mt-2 text-sm text-[#5C5C5C]">
                        {currentItem.type === 'multiple' && currentItem.options && currentItem.correctAnswer.toString().includes(',') ? (
                          <>
                            <div className="mb-1">
                              <span>내 답: </span>
                              <span className="font-bold text-[#8B1A1A]">
                                {(() => {
                                  const userAnswerStr = resultsMap[currentIndex]?.userAnswer || '';
                                  if (!userAnswerStr) return '(미응답)';
                                  const userIndices = userAnswerStr.split(',').map(s => parseInt(s.trim(), 10) + 1);
                                  return userIndices.map(n => `${n}번`).join(', ');
                                })()}
                              </span>
                            </div>
                            <div>
                              <span>정답: </span>
                              <span className="font-bold text-[#1A6B1A]">
                                {currentItem.correctAnswer
                                  ? currentItem.correctAnswer.toString().split(',').map((ans: string) => `${ans.trim()}번`).join(', ')
                                  : '(정답 정보 없음)'}
                              </span>
                            </div>
                          </>
                        ) : currentItem.type === 'multiple' && currentItem.options ? (
                          <>
                            <div className="mb-1">
                              <span>내 답: </span>
                              <span className="font-bold text-[#8B1A1A]">
                                {(() => {
                                  const userAnswerStr = resultsMap[currentIndex]?.userAnswer || '';
                                  if (!userAnswerStr) return '(미응답)';
                                  const userIdx = parseInt(userAnswerStr, 10) + 1;
                                  return `${userIdx}번`;
                                })()}
                              </span>
                            </div>
                            <div>
                              <span>정답: </span>
                              <span className="font-bold text-[#1A6B1A]">
                                {currentItem.correctAnswer && currentItem.correctAnswer.toString().trim() !== ''
                                  ? `${currentItem.correctAnswer.toString()}번`
                                  : '(정답 정보 없음)'}
                              </span>
                            </div>
                          </>
                        ) : currentItem.correctAnswer && currentItem.correctAnswer.toString().includes('|||') ? (
                          <>
                            <span>정답 (다음 중 하나): </span>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {currentItem.correctAnswer.toString().split('|||').map((ans: string, idx: number) => (
                                <span key={idx} className="px-2 py-0.5 bg-[#E8F5E9] border border-[#1A6B1A] text-[#1A6B1A] font-bold">
                                  {ans.trim()}
                                </span>
                              ))}
                            </div>
                          </>
                        ) : currentItem.type === 'ox' ? (
                          <>
                            <span>정답: </span>
                            <span className="font-bold text-[#1A6B1A]">
                              {currentItem.correctAnswer
                                ? (currentItem.correctAnswer.toString() === '0' || currentItem.correctAnswer.toString().toUpperCase() === 'O' ? 'O' : 'X')
                                : '(정답 정보 없음)'}
                            </span>
                          </>
                        ) : (
                          <>
                            <span>정답: </span>
                            <span className="font-bold text-[#1A6B1A]">
                              {currentItem.correctAnswer && currentItem.correctAnswer.toString().trim() !== ''
                                ? currentItem.correctAnswer.toString()
                                : '(정답 정보 없음)'}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {currentItem.explanation && (
                    <div className="mt-4 p-4 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
                      <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                      <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{currentItem.explanation}</p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* 하단 버튼 */}
      <div
        className="fixed bottom-20 left-0 right-0 p-4 border-t-2 border-[#1A1A1A]"
        style={{ backgroundColor: '#F5F0E8' }}
      >
        <div className="flex gap-3">
          {currentIndex > 0 && (
            <button
              onClick={handlePrev}
              className="flex-1 py-4 bg-[#F5F0E8] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              이전
            </button>
          )}

          {!isSubmitted ? (
            <button
              onClick={handleSubmit}
              disabled={answer === null || (Array.isArray(answer) && answer.length === 0)}
              className={`${currentIndex > 0 ? 'flex-[2]' : 'w-full'} py-4 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              제출하기
            </button>
          ) : (
            <button
              onClick={handleNext}
              className={`${currentIndex > 0 ? 'flex-[2]' : 'w-full'} py-4 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors`}
            >
              {isLastQuestion ? '결과 보기' : '다음 문제'}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
