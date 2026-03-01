/**
 * 퀴즈 업데이트 모달
 *
 * 수정된 문제만 다시 풀 수 있는 모달입니다.
 * 완료 시 기존 점수와 병합하여 저장합니다.
 */

'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  doc,
  addDoc,
  updateDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts';
import type { QuizUpdateInfo, UpdatedQuestion } from '@/lib/hooks/useQuizUpdate';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import { useHideNav } from '@/lib/hooks/useHideNav';

// ============================================================
// 타입 정의
// ============================================================

interface UpdateQuizModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: QuizUpdateInfo;
  totalQuestionCount: number;
  onComplete: (newScore: number, newCorrectCount: number) => void;
}

// ㄱㄴㄷ 라벨
const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 퀴즈 업데이트 모달
 */
export default function UpdateQuizModal({
  isOpen,
  onClose,
  updateInfo,
  totalQuestionCount,
  onComplete,
}: UpdateQuizModalProps) {
  const { user } = useAuth();
  const { userCourseId, userClassId } = useCourse();

  // 현재 문제 인덱스
  const [currentIndex, setCurrentIndex] = useState(0);

  // 사용자 답변
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});

  // 제출 상태
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 결과 표시
  const [showResult, setShowResult] = useState(false);
  const [resultData, setResultData] = useState<{
    newCorrectCount: number;
    newScore: number;
    questionResults: {
      questionId: string;
      isCorrect: boolean;
      userAnswer: string;
      correctAnswer: string;
      previousAnswer: string;
      questionText: string;
      questionType: string;
      choices?: string[];
      explanation?: string;
      choiceExplanations?: string[];
      image?: string;
      imageUrl?: string;
      passage?: string;
      passageType?: string;
      passageImage?: string;
      koreanAbcItems?: string[];
      passageMixedExamples?: any[];
      mixedExamples?: any[];
      bogi?: { questionText?: string; items: Array<{ label: string; content: string }> } | null;
      subQuestionOptions?: string[];
      subQuestionOptionsType?: string;
      subQuestionImage?: string;
      passagePrompt?: string;
      bogiQuestionText?: string;
      combinedGroupId?: string;
      combinedIndex?: number;
    }[];
  } | null>(null);

  // 닫기 확인 (풀이 중 실수 닫기 방지)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const hasStartedRef = useRef(false);

  const handleRequestClose = useCallback(() => {
    // 풀이 시작 전이거나 결과 화면이면 바로 닫기
    if (!hasStartedRef.current || showResult) {
      onClose();
      return;
    }
    // 풀이 중이면 확인 다이얼로그
    setShowCloseConfirm(true);
  }, [showResult, onClose]);

  // 네비게이션 숨김
  useHideNav(isOpen);

  // 모달 열림 시 상태 초기화 + body 스크롤 방지
  useEffect(() => {
    if (!isOpen) return;
    setCurrentIndex(0);
    setUserAnswers({});
    setShowResult(false);
    setResultData(null);
    setShowCloseConfirm(false);
    hasStartedRef.current = false;
    lockScroll();
    return () => {
      unlockScroll();
    };
  }, [isOpen, updateInfo.quizId]);

  const questions = updateInfo.updatedQuestions;

  // 결합형 문제를 그룹핑한 displayItems 생성
  type DisplayItem =
    | { type: 'single'; question: UpdatedQuestion }
    | { type: 'combined_group'; questions: UpdatedQuestion[]; combinedGroupId: string };

  const displayItems = useMemo<DisplayItem[]>(() => {
    const items: DisplayItem[] = [];
    const processedGroupIds = new Set<string>();

    for (const q of questions) {
      if (q.combinedGroupId) {
        if (processedGroupIds.has(q.combinedGroupId)) continue;
        processedGroupIds.add(q.combinedGroupId);
        // 같은 그룹의 문제를 모아서 combinedIndex 순으로 정렬
        const groupQuestions = questions
          .filter((gq) => gq.combinedGroupId === q.combinedGroupId)
          .sort((a, b) => (a.combinedIndex ?? 0) - (b.combinedIndex ?? 0));
        items.push({ type: 'combined_group', questions: groupQuestions, combinedGroupId: q.combinedGroupId });
      } else {
        items.push({ type: 'single', question: q });
      }
    }
    return items;
  }, [questions]);

  const currentDisplayItem = displayItems[currentIndex];

  /**
   * 답변 선택 (questionId 지정)
   */
  const handleSelectAnswer = useCallback((questionId: string, answer: string) => {
    hasStartedRef.current = true;
    setUserAnswers((prev) => ({
      ...prev,
      [questionId]: answer,
    }));
  }, []);

  /**
   * 다음 문제로
   */
  const handleNext = useCallback(() => {
    if (currentIndex < displayItems.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, displayItems.length]);

  /**
   * 이전 문제로
   */
  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  /**
   * 현재 displayItem의 모든 문제에 답변했는지 확인
   */
  const isCurrentItemAnswered = useMemo(() => {
    if (!currentDisplayItem) return false;
    if (currentDisplayItem.type === 'single') {
      return !!userAnswers[currentDisplayItem.question.questionId];
    }
    return currentDisplayItem.questions.every((q) => !!userAnswers[q.questionId]);
  }, [currentDisplayItem, userAnswers]);

  /**
   * 제출
   */
  const handleSubmit = useCallback(async () => {
    if (!user) return;

    try {
      setIsSubmitting(true);

      // 1. 새로 푼 문제 채점
      const originalScores = updateInfo.originalQuestionScores;
      const questionResults: {
        questionId: string;
        isCorrect: boolean;
        userAnswer: string;
        correctAnswer: string;
        previousAnswer: string;
        questionText: string;
        questionType: string;
        choices?: string[];
        explanation?: string;
        choiceExplanations?: string[];
        image?: string;
        imageUrl?: string;
        passage?: string;
        passageType?: string;
        passageImage?: string;
        koreanAbcItems?: string[];
        passageMixedExamples?: any[];
        mixedExamples?: any[];
        bogi?: { questionText?: string; items: Array<{ label: string; content: string }> } | null;
        subQuestionOptions?: string[];
        subQuestionOptionsType?: string;
        subQuestionImage?: string;
        passagePrompt?: string;
        bogiQuestionText?: string;
        combinedGroupId?: string;
        combinedIndex?: number;
      }[] = [];

      for (const q of questions) {
        const userAnswer = userAnswers[q.questionId] || '';
        const correctAnswer = q.correctAnswer;
        const previousAnswer = originalScores[q.questionId]?.userAnswer || '';

        let isCorrect = false;

        if (q.questionType === 'multiple') {
          // 객관식
          const correctAnswerStr = correctAnswer.toString();
          const userAnswerStr = userAnswer.toString();

          if (correctAnswerStr.includes(',')) {
            // 복수정답
            const correctIndices = correctAnswerStr.split(',').map((s) => parseInt(s.trim(), 10));
            const userIndices = userAnswerStr ? userAnswerStr.split(',').map((s) => parseInt(s.trim(), 10)) : [];
            const sortedCorrect = [...correctIndices].sort((a, b) => a - b);
            const sortedUser = [...userIndices].sort((a, b) => a - b);
            isCorrect = sortedCorrect.length === sortedUser.length &&
              sortedCorrect.every((val, idx) => val === sortedUser[idx]);
          } else {
            isCorrect = userAnswerStr === correctAnswerStr;
          }
        } else if (q.questionType === 'ox') {
          // OX
          const userOX = userAnswer.toString().toUpperCase();
          let correctOX = correctAnswer.toString().toUpperCase();
          if (correctOX === '0') correctOX = 'O';
          else if (correctOX === '1') correctOX = 'X';
          isCorrect = userOX === correctOX;
        } else {
          // 주관식
          const userAnswerNormalized = userAnswer.toString().trim().toLowerCase();
          if (correctAnswer.toString().includes('|||')) {
            const correctAnswers = correctAnswer.toString().split('|||').map((a) => a.trim().toLowerCase());
            isCorrect = correctAnswers.some((ca) => userAnswerNormalized === ca);
          } else {
            isCorrect = userAnswerNormalized === correctAnswer.toString().trim().toLowerCase();
          }
        }

        questionResults.push({
          questionId: q.questionId,
          isCorrect,
          userAnswer,
          correctAnswer,
          previousAnswer,
          questionText: q.questionText,
          questionType: q.questionType,
          choices: q.choices,
          explanation: q.explanation,
          choiceExplanations: q.choiceExplanations,
          image: q.image,
          imageUrl: q.imageUrl,
          passage: q.passage,
          passageType: q.passageType,
          passageImage: q.passageImage,
          koreanAbcItems: q.koreanAbcItems,
          passageMixedExamples: q.passageMixedExamples,
          mixedExamples: q.mixedExamples,
          bogi: q.bogi,
          subQuestionOptions: q.subQuestionOptions,
          subQuestionOptionsType: q.subQuestionOptionsType,
          subQuestionImage: q.subQuestionImage,
          passagePrompt: q.passagePrompt,
          bogiQuestionText: q.bogiQuestionText,
          combinedGroupId: q.combinedGroupId,
          combinedIndex: q.combinedIndex,
        });
      }

      // 2. 기존 점수와 병합
      const mergedScores: Record<string, { isCorrect: boolean; userAnswer: string; correctAnswer?: string; answeredAt: any }> = { ...originalScores };

      // 새로 푼 문제로 교체
      for (const result of questionResults) {
        mergedScores[result.questionId] = {
          isCorrect: result.isCorrect,
          userAnswer: result.userAnswer,
          correctAnswer: result.correctAnswer,
          answeredAt: serverTimestamp(),
        };
      }

      // 3. 전체 정답 수 계산
      let totalCorrect = 0;
      Object.values(mergedScores).forEach((score) => {
        if (score.isCorrect) totalCorrect++;
      });

      const newScore = Math.round((totalCorrect / totalQuestionCount) * 100);

      // 4. 업데이트 결과 저장
      await addDoc(collection(db, 'quizResults'), {
        userId: user.uid,
        quizId: updateInfo.quizId,
        quizTitle: updateInfo.quizTitle,
        quizCreatorId: updateInfo.quizCreatorId || null, // 퀴즈 제작자 ID (통계 조회용)
        score: newScore,
        correctCount: totalCorrect,
        totalCount: totalQuestionCount,
        earnedExp: 0, // 업데이트는 추가 경험치 없음
        questionScores: mergedScores,
        isUpdate: true,
        originalResultId: updateInfo.originalResultId,
        updatedQuestionIds: questions.map((q) => q.questionId),
        courseId: userCourseId || null,
        classId: userClassId || null,
        createdAt: serverTimestamp(),
      });

      // 5. reviews 업데이트 (수정된 문제의 정답 여부, 답변, 복습횟수 반영)
      const reviewsQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', updateInfo.quizId)
      );
      const reviewsSnapshot = await getDocs(reviewsQuery);

      // 업데이트된 문제의 questionId 집합
      const updatedQuestionIds = new Set(questions.map((q) => q.questionId));

      // 각 리뷰 업데이트 (수정된 문제 + 전체 quizUpdatedAt 갱신)
      for (const reviewDoc of reviewsSnapshot.docs) {
        const reviewData = reviewDoc.data();
        const questionId = reviewData.questionId;

        if (updatedQuestionIds.has(questionId)) {
          // 수정된 문제: 답변 + quizUpdatedAt 업데이트
          const result = questionResults.find((r) => r.questionId === questionId);
          if (result) {
            const currentReviewType = reviewData.reviewType;
            let newReviewType = currentReviewType;

            if (result.isCorrect && currentReviewType === 'wrong') {
              newReviewType = 'solved';
            } else if (!result.isCorrect && currentReviewType === 'solved') {
              newReviewType = 'wrong';
            }

            await updateDoc(doc(db, 'reviews', reviewDoc.id), {
              userAnswer: result.userAnswer,
              isCorrect: result.isCorrect,
              reviewType: newReviewType,
              reviewCount: (reviewData.reviewCount || 0) + 1,
              lastReviewedAt: serverTimestamp(),
              answeredAt: serverTimestamp(),
              quizUpdatedAt: serverTimestamp(),
            });
          }
        } else {
          // 수정 안 된 문제: quizUpdatedAt만 갱신 (폴더/문제 뱃지 제거용)
          await updateDoc(doc(db, 'reviews', reviewDoc.id), {
            quizUpdatedAt: serverTimestamp(),
          });
        }
      }

      // 6. 원본 quizResult의 questionScores 업데이트 (뱃지 제거용)
      // 원본 결과의 answeredAt을 업데이트해야 useQuizUpdate 훅에서 업데이트 완료로 인식
      await updateDoc(doc(db, 'quizResults', updateInfo.originalResultId), {
        questionScores: mergedScores,
        score: newScore,
        correctCount: totalCorrect,
      });

      // 7. 퀴즈 문서의 userScores, averageScore 업데이트
      try {
        const currentQuizDoc = await getDoc(doc(db, 'quizzes', updateInfo.quizId));
        if (currentQuizDoc.exists()) {
          const currentQuizData = currentQuizDoc.data();
          const currentUserScores = currentQuizData?.userScores || {};

          // 현재 사용자의 점수를 새 점수로 교체
          currentUserScores[user.uid] = newScore;

          // 전체 평균 점수 재계산
          const allScores = Object.values(currentUserScores) as number[];
          const newAverageScore = allScores.length > 0
            ? allScores.reduce((sum, s) => sum + s, 0) / allScores.length
            : 0;

          await updateDoc(doc(db, 'quizzes', updateInfo.quizId), {
            [`userScores.${user.uid}`]: newScore,
            averageScore: Math.round(newAverageScore * 10) / 10,
          });
        }
      } catch (statsErr) {
        console.error('퀴즈 통계 업데이트 실패:', statsErr);
      }

      // 결과 표시
      setResultData({
        newCorrectCount: totalCorrect,
        newScore,
        questionResults,
      });
      setShowResult(true);

    } catch (err) {
      console.error('업데이트 제출 실패:', err);
      alert('제출에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  }, [user, userAnswers, questions, updateInfo, totalQuestionCount, userCourseId, userClassId]);

  /**
   * 완료
   */
  const handleComplete = useCallback(() => {
    if (resultData) {
      onComplete(resultData.newScore, resultData.newCorrectCount);
    }
    onClose();
  }, [resultData, onComplete, onClose]);

  if (!isOpen) return null;

  // 결과 화면
  if (showResult && resultData) {
    const correctCount = resultData.questionResults.filter((r) => r.isCorrect).length;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-[#F5F0E8] border-2 border-[#1A1A1A] rounded-2xl max-h-[90vh] overflow-auto overscroll-contain"
        >
          {/* 헤더 */}
          <div className="px-4 py-3 border-b border-[#1A1A1A]">
            <h2 className="text-sm font-bold text-[#1A1A1A]">업데이트 완료</h2>
          </div>

          {/* 결과 */}
          <div className="p-4 text-center">
            <p className="text-xs text-[#5C5C5C] mb-1">업데이트 결과</p>
            <div className="flex items-center justify-center gap-1.5 mb-3">
              <span className="text-2xl font-bold text-[#1A1A1A]">{correctCount}</span>
              <span className="text-base text-[#5C5C5C]">/</span>
              <span className="text-base text-[#5C5C5C]">{questions.length}</span>
            </div>

            <div className="p-3 border border-[#1A1A1A] bg-[#EDEAE4] rounded-xl mb-3">
              <p className="text-xs text-[#5C5C5C] mb-0.5">새 점수</p>
              <p className="text-xl font-bold text-[#1A1A1A]">{resultData.newScore}점</p>
              <p className="text-[10px] text-[#5C5C5C]">
                ({resultData.newCorrectCount}/{totalQuestionCount} 정답)
              </p>
            </div>

            {/* 문제별 결과 — 결합형 그룹핑 */}
            <div className="space-y-4 text-left">
              {(() => {
                // 결합형 그룹핑
                type ResultDisplayItem =
                  | { type: 'single'; result: typeof resultData.questionResults[0]; globalIdx: number }
                  | { type: 'combined_group'; results: typeof resultData.questionResults; globalStartIdx: number };

                const resultDisplayItems: ResultDisplayItem[] = [];
                const processedGroupIds = new Set<string>();
                resultData.questionResults.forEach((r, idx) => {
                  if (r.combinedGroupId) {
                    if (processedGroupIds.has(r.combinedGroupId)) return;
                    processedGroupIds.add(r.combinedGroupId);
                    const groupResults = resultData.questionResults
                      .filter((gr) => gr.combinedGroupId === r.combinedGroupId)
                      .sort((a, b) => (a.combinedIndex ?? 0) - (b.combinedIndex ?? 0));
                    resultDisplayItems.push({ type: 'combined_group', results: groupResults, globalStartIdx: idx });
                  } else {
                    resultDisplayItems.push({ type: 'single', result: r, globalIdx: idx });
                  }
                });

                return resultDisplayItems.map((item, displayIdx) => {
                  if (item.type === 'combined_group') {
                    const groupCorrect = item.results.filter((r) => r.isCorrect).length;
                    const first = item.results[0];
                    return (
                      <div key={`group-${first.combinedGroupId}`} className="border-2 border-[#1A1A1A] bg-[#EDEAE4] rounded-xl overflow-hidden">
                        {/* 결합형 헤더 */}
                        <div className="p-3 border-b border-[#1A1A1A] flex items-center justify-between">
                          <span className="text-sm font-bold text-[#1A1A1A]">결합형 문제</span>
                          <span className="text-xs px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] rounded-md">
                            {groupCorrect}/{item.results.length} 정답
                          </span>
                        </div>
                        {/* 공통 제시문 */}
                        {(first.passage || first.passageImage || (first.koreanAbcItems && first.koreanAbcItems.length > 0) || (first.passageMixedExamples && first.passageMixedExamples.length > 0)) && (
                          <div className="mx-3 mt-3 p-2 border border-[#8B6914] bg-[#FFF8E1] rounded-lg text-xs">
                            {first.passage && first.passageType !== 'korean_abc' && (
                              <p className="text-[#1A1A1A] whitespace-pre-wrap">{first.passage}</p>
                            )}
                            {first.passageType === 'korean_abc' && first.koreanAbcItems && first.koreanAbcItems.length > 0 && (
                              <div className="space-y-0.5">
                                {first.koreanAbcItems.map((itm, i) => (
                                  <p key={i} className="text-[#1A1A1A]"><span className="font-bold">{KOREAN_LABELS[i]}.</span> {itm}</p>
                                ))}
                              </div>
                            )}
                            {first.passageMixedExamples && first.passageMixedExamples.length > 0 && (
                              <div className="space-y-1">
                                {first.passageMixedExamples.map((block: any) => (
                                  <div key={block.id}>
                                    {block.type === 'text' && <p className="text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>}
                                    {block.type === 'labeled' && (block.items || []).map((i: any) => (
                                      <p key={i.id}><span className="font-bold">{i.label}.</span> {i.content}</p>
                                    ))}
                                    {block.type === 'gana' && (block.items || []).map((i: any) => (
                                      <p key={i.id}><span className="font-bold">({i.label})</span> {i.content}</p>
                                    ))}
                                    {block.type === 'grouped' && (block.children || []).map((child: any) => (
                                      <div key={child.id}>
                                        {child.type === 'text' && <p className="text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>}
                                        {child.type === 'labeled' && (child.items || []).map((ci: any) => (
                                          <p key={ci.id}><span className="font-bold">{ci.label}.</span> {ci.content}</p>
                                        ))}
                                        {child.type === 'gana' && (child.items || []).map((ci: any) => (
                                          <p key={ci.id}><span className="font-bold">({ci.label})</span> {ci.content}</p>
                                        ))}
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}
                            {first.passageImage && (
                              <img src={first.passageImage} alt="공통 이미지" className="max-w-full max-h-[200px] object-contain mt-2" />
                            )}
                          </div>
                        )}
                        {/* 하위 문제 결과들 */}
                        <div className="p-3 space-y-3">
                          {item.results.map((r, subIdx) => (
                            <QuestionResultCard key={r.questionId} result={r} label={`하위 ${subIdx + 1}`} />
                          ))}
                        </div>
                      </div>
                    );
                  }

                  // 단일 문제
                  return <QuestionResultCard key={item.result.questionId} result={item.result} label={`문제 ${displayIdx + 1}`} />;
                });
              })()}
            </div>
          </div>

          {/* 완료 버튼 */}
          <div className="px-4 py-3 border-t border-[#1A1A1A]">
            <button
              onClick={handleComplete}
              className="w-full py-2.5 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors rounded-xl"
            >
              완료
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // 문제 풀이 화면
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#F5F0E8] border-2 border-[#1A1A1A] rounded-2xl max-h-[90vh] overflow-auto overscroll-contain"
      >
        {/* 헤더 */}
        <div className="px-4 py-3 border-b border-[#1A1A1A] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#1A1A1A]">수정된 문제 풀기</h2>
            <p className="text-[10px] text-[#5C5C5C]">{updateInfo.quizTitle}</p>
          </div>
          <button
            onClick={handleRequestClose}
            className="w-7 h-7 flex items-center justify-center border border-[#1A1A1A] hover:bg-[#EDEAE4] rounded-lg"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 닫기 확인 다이얼로그 */}
        <AnimatePresence>
          {showCloseConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
            >
              <motion.div
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.9 }}
                className="bg-[#F5F0E8] border-2 border-[#1A1A1A] rounded-xl p-4 max-w-[260px] w-full"
              >
                <p className="text-sm font-bold text-[#1A1A1A] text-center mb-1">풀이를 중단할까요?</p>
                <p className="text-[10px] text-[#5C5C5C] text-center mb-3">지금까지 푼 답변이 저장되지 않습니다.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowCloseConfirm(false)}
                    className="flex-1 py-2 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] rounded-xl"
                  >
                    계속 풀기
                  </button>
                  <button
                    onClick={() => { setShowCloseConfirm(false); onClose(); }}
                    className="flex-1 py-2 text-xs font-bold bg-[#8B1A1A] text-white border-2 border-[#8B1A1A] rounded-xl"
                  >
                    중단
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 진행 표시 */}
        <div className="px-4 py-1.5 border-b border-[#EDEAE4]">
          <div className="flex items-center justify-between text-[10px] text-[#5C5C5C]">
            <span>문제 {currentIndex + 1} / {displayItems.length}</span>
            <span>{Object.keys(userAnswers).length}개 답변</span>
          </div>
          <div className="mt-0.5 h-1 bg-[#EDEAE4] rounded-full">
            <div
              className="h-full bg-[#1A1A1A] transition-all rounded-full"
              style={{ width: `${((currentIndex + 1) / displayItems.length) * 100}%` }}
            />
          </div>
        </div>

        {/* 문제 */}
        <div className="p-3">
          {currentDisplayItem && currentDisplayItem.type === 'combined_group' ? (
            /* ===== 결합형 그룹: 공통 지문 + 하위 문제들 ===== */
            <div>
              <span className="text-xs text-[#5C5C5C]">결합형 문제 ({currentDisplayItem.questions.length}개 하위 문제)</span>

              {/* 공통 제시문 (첫 번째 문제에서 가져옴) */}
              {(() => {
                const first = currentDisplayItem.questions[0];
                const hasPassage = first.passage || first.passageImage || (first.koreanAbcItems && first.koreanAbcItems.length > 0) || (first.passageMixedExamples && first.passageMixedExamples.length > 0);
                if (!hasPassage) return null;
                return (
                  <div className="p-3 border-2 border-[#8B6914] bg-[#FFF8E1] rounded-xl mt-2 mb-3">
                    {first.passage && first.passageType !== 'korean_abc' && (
                      <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{first.passage}</p>
                    )}
                    {first.passageType === 'korean_abc' && first.koreanAbcItems && first.koreanAbcItems.length > 0 && (
                      <div className="space-y-1">
                        {first.koreanAbcItems.map((itm, i) => (
                          <p key={i} className="text-sm text-[#1A1A1A]"><span className="font-bold">{KOREAN_LABELS[i]}.</span> {itm}</p>
                        ))}
                      </div>
                    )}
                    {first.passageMixedExamples && first.passageMixedExamples.length > 0 && (
                      <div className="space-y-1">
                        {first.passageMixedExamples.map((block: any) => (
                          <div key={block.id}>
                            {block.type === 'text' && <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>}
                            {block.type === 'labeled' && (block.items || []).map((i: any) => (
                              <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
                            ))}
                            {block.type === 'gana' && (block.items || []).map((i: any) => (
                              <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
                            ))}
                            {block.type === 'grouped' && (block.children || []).map((child: any) => (
                              <div key={child.id}>
                                {child.type === 'text' && <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>}
                                {child.type === 'labeled' && (child.items || []).map((ci: any) => (
                                  <p key={ci.id} className="text-sm"><span className="font-bold">{ci.label}.</span> {ci.content}</p>
                                ))}
                                {child.type === 'gana' && (child.items || []).map((ci: any) => (
                                  <p key={ci.id} className="text-sm"><span className="font-bold">({ci.label})</span> {ci.content}</p>
                                ))}
                                {child.type === 'image' && child.imageUrl && <img src={child.imageUrl} alt="" className="max-w-full h-auto rounded-lg" />}
                              </div>
                            ))}
                            {block.type === 'image' && block.imageUrl && <img src={block.imageUrl} alt="" className="max-w-full h-auto rounded-lg" />}
                          </div>
                        ))}
                      </div>
                    )}
                    {first.passageImage && (
                      <img src={first.passageImage} alt="공통 이미지" className={`max-w-full max-h-[300px] object-contain border border-[#1A1A1A] rounded-lg ${first.passage || (first.koreanAbcItems && first.koreanAbcItems.length > 0) ? 'mt-2' : ''}`} />
                    )}
                  </div>
                );
              })()}

              {/* 하위 문제들 */}
              <div className="space-y-4">
                {currentDisplayItem.questions.map((sq, sqIdx) => (
                  <SubQuestionSolve
                    key={sq.questionId}
                    question={sq}
                    subIndex={sqIdx + 1}
                    userAnswer={userAnswers[sq.questionId] || ''}
                    onSelectAnswer={(answer) => handleSelectAnswer(sq.questionId, answer)}
                  />
                ))}
              </div>
            </div>
          ) : currentDisplayItem && currentDisplayItem.type === 'single' ? (
            /* ===== 단일 문제 ===== */
            <SingleQuestionSolve
              question={currentDisplayItem.question}
              userAnswer={userAnswers[currentDisplayItem.question.questionId] || ''}
              onSelectAnswer={(answer) => handleSelectAnswer(currentDisplayItem.question.questionId, answer)}
            />
          ) : null}
        </div>

        {/* 네비게이션 버튼 */}
        <div className="px-4 py-3 border-t border-[#1A1A1A] flex gap-2">
          {currentIndex > 0 && (
            <button
              onClick={handlePrev}
              className="flex-1 py-2.5 text-sm font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-xl"
            >
              이전
            </button>
          )}
          {currentIndex < displayItems.length - 1 ? (
            <button
              onClick={handleNext}
              disabled={!isCurrentItemAnswered}
              className="flex-1 py-2.5 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors disabled:opacity-50 rounded-xl"
            >
              다음
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || Object.keys(userAnswers).length !== questions.length}
              className="flex-1 py-2.5 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors disabled:opacity-50 flex items-center justify-center gap-2 rounded-xl"
            >
              {isSubmitting && (
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              제출
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ============================================================
// 하위 컴포넌트: 단일 문제 풀이
// ============================================================

function SingleQuestionSolve({
  question: q,
  userAnswer,
  onSelectAnswer,
}: {
  question: UpdatedQuestion;
  userAnswer: string;
  onSelectAnswer: (answer: string) => void;
}) {
  return (
    <div>
      <div className="mb-4">
        <span className="text-xs text-[#5C5C5C]">
          {q.questionType === 'ox' ? 'OX' :
           q.questionType === 'multiple' ? (q.hasMultipleAnswers || q.correctAnswer.includes(',') ? '객관식 (복수정답)' : '객관식') :
           '주관식'}
        </span>

        {/* 공통 제시문 (결합형이 아닌 단일 문제에 포함된 경우) */}
        {(q.passage || q.passageImage || (q.koreanAbcItems && q.koreanAbcItems.length > 0) || (q.passageMixedExamples && q.passageMixedExamples.length > 0)) && (
          <PassageBlock question={q} />
        )}

        <p className="text-[#1A1A1A] text-sm leading-relaxed font-medium mt-1">{q.questionText}</p>
      </div>

      <QuestionExtras question={q} />
      <AnswerInput question={q} userAnswer={userAnswer} onSelectAnswer={onSelectAnswer} />
    </div>
  );
}

// ============================================================
// 하위 컴포넌트: 결합형 하위 문제 풀이
// ============================================================

function SubQuestionSolve({
  question: q,
  subIndex,
  userAnswer,
  onSelectAnswer,
}: {
  question: UpdatedQuestion;
  subIndex: number;
  userAnswer: string;
  onSelectAnswer: (answer: string) => void;
}) {
  return (
    <div className="p-3 border border-[#1A1A1A] bg-[#F5F0E8] rounded-xl">
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold text-[#5C5C5C]">하위 문제 {subIndex}</span>
          <span className="text-xs text-[#5C5C5C]">
            {q.questionType === 'ox' ? 'OX' :
             q.questionType === 'multiple' ? (q.hasMultipleAnswers || q.correctAnswer.includes(',') ? '객관식 (복수정답)' : '객관식') :
             '주관식'}
          </span>
        </div>
        <p className="text-[#1A1A1A] font-medium text-sm leading-relaxed">{q.questionText}</p>
      </div>

      <QuestionExtras question={q} />
      <AnswerInput question={q} userAnswer={userAnswer} onSelectAnswer={onSelectAnswer} />
    </div>
  );
}

// ============================================================
// 공통: 제시문 블록
// ============================================================

function PassageBlock({ question: q }: { question: UpdatedQuestion }) {
  return (
    <div className="p-3 border-2 border-[#8B6914] bg-[#FFF8E1] rounded-xl mt-2 mb-2">
      {q.passage && q.passageType !== 'korean_abc' && (
        <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{q.passage}</p>
      )}
      {q.passageType === 'korean_abc' && q.koreanAbcItems && q.koreanAbcItems.length > 0 && (
        <div className="space-y-1">
          {q.koreanAbcItems.map((itm, i) => (
            <p key={i} className="text-sm text-[#1A1A1A]"><span className="font-bold">{KOREAN_LABELS[i]}.</span> {itm}</p>
          ))}
        </div>
      )}
      {q.passageMixedExamples && q.passageMixedExamples.length > 0 && (
        <div className="space-y-1">
          {q.passageMixedExamples.map((block: any) => (
            <div key={block.id}>
              {block.type === 'text' && <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>}
              {block.type === 'labeled' && (block.items || []).map((i: any) => (
                <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
              ))}
              {block.type === 'gana' && (block.items || []).map((i: any) => (
                <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
              ))}
              {block.type === 'grouped' && (block.children || []).map((child: any) => (
                <div key={child.id}>
                  {child.type === 'text' && <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>}
                  {child.type === 'labeled' && (child.items || []).map((ci: any) => (
                    <p key={ci.id} className="text-sm"><span className="font-bold">{ci.label}.</span> {ci.content}</p>
                  ))}
                  {child.type === 'gana' && (child.items || []).map((ci: any) => (
                    <p key={ci.id} className="text-sm"><span className="font-bold">({ci.label})</span> {ci.content}</p>
                  ))}
                  {child.type === 'image' && child.imageUrl && <img src={child.imageUrl} alt="" className="max-w-full h-auto" />}
                </div>
              ))}
              {block.type === 'image' && block.imageUrl && <img src={block.imageUrl} alt="" className="max-w-full h-auto" />}
            </div>
          ))}
        </div>
      )}
      {q.passageImage && (
        <img src={q.passageImage} alt="공통 이미지" className={`max-w-full max-h-[300px] object-contain border border-[#1A1A1A] rounded-lg ${q.passage || (q.koreanAbcItems && q.koreanAbcItems.length > 0) ? 'mt-2' : ''}`} />
      )}
    </div>
  );
}

// ============================================================
// 공통: 보기/이미지/발문 등 부가 요소
// ============================================================

function QuestionExtras({ question: q }: { question: UpdatedQuestion }) {
  return (
    <>
      {/* 혼합 보기 */}
      {q.mixedExamples && q.mixedExamples.length > 0 && (
        <div className="mb-3">
          {q.mixedExamples.filter((b: any) => b.type === 'grouped').map((block: any) => (
            <div key={block.id} className="p-3 border-2 border-[#8B6914] bg-[#FFF8E1] rounded-xl mb-2">
              <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
              <div className="space-y-1">
                {block.children?.map((child: any) => (
                  <div key={child.id}>
                    {child.type === 'text' && child.content?.trim() && <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>}
                    {child.type === 'labeled' && (child.items || []).map((li: any) => (
                      <p key={li.id} className="text-sm text-[#1A1A1A]"><span className="font-bold">{li.label}.</span> {li.content}</p>
                    ))}
                    {child.type === 'gana' && (child.items || []).map((li: any) => (
                      <p key={li.id} className="text-sm text-[#1A1A1A]"><span className="font-bold">({li.label})</span> {li.content}</p>
                    ))}
                    {child.type === 'image' && child.imageUrl && <img src={child.imageUrl} alt="" className="max-w-full h-auto border border-[#1A1A1A]" />}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {q.mixedExamples.filter((b: any) => b.type !== 'grouped').map((block: any) => {
            if (block.type === 'text' && block.content?.trim()) return (
              <div key={block.id} className="p-3 border border-[#8B6914] bg-[#FFF8E1] rounded-xl mb-2">
                <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>
              </div>
            );
            if (block.type === 'labeled') return (
              <div key={block.id} className="p-3 border border-[#8B6914] bg-[#FFF8E1] rounded-xl mb-2">
                <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                <div className="space-y-1">
                  {(block.items || []).map((li: any) => (
                    <p key={li.id} className="text-sm text-[#1A1A1A]"><span className="font-bold">{li.label}.</span> {li.content}</p>
                  ))}
                </div>
              </div>
            );
            if (block.type === 'gana') return (
              <div key={block.id} className="p-3 border border-[#8B6914] bg-[#FFF8E1] rounded-xl mb-2">
                <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                <div className="space-y-1">
                  {(block.items || []).map((li: any) => (
                    <p key={li.id} className="text-sm text-[#1A1A1A]"><span className="font-bold">({li.label})</span> {li.content}</p>
                  ))}
                </div>
              </div>
            );
            return null;
          })}
        </div>
      )}

      {/* 레거시 하위 문제 보기 */}
      {!(q.mixedExamples && q.mixedExamples.length > 0) && q.subQuestionOptions && q.subQuestionOptions.length > 0 && (
        <div className="p-3 border border-[#8B6914] bg-[#FFF8E1] rounded-xl mb-3">
          <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
          {q.subQuestionOptionsType === 'text' ? (
            <p className="text-sm text-[#1A1A1A]">{q.subQuestionOptions.join(', ')}</p>
          ) : (
            <div className="space-y-1">
              {q.subQuestionOptions.map((opt, i) => (
                <p key={i} className="text-sm text-[#1A1A1A]"><span className="font-bold">{KOREAN_LABELS[i]}.</span> {opt}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 문제 이미지 */}
      {(q.image || q.imageUrl) && (
        <div className="mb-3">
          <img src={q.image || q.imageUrl} alt="문제 이미지" className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A] rounded-lg" />
        </div>
      )}

      {/* 하위 문제 이미지 */}
      {q.subQuestionImage && (
        <div className="mb-3">
          <img src={q.subQuestionImage} alt="보기 이미지" className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A] rounded-lg" />
        </div>
      )}

      {/* 보기 (<보기> 박스) */}
      {q.bogi && q.bogi.items && q.bogi.items.some(i => i.content?.trim()) && (
        <div className="mb-3 p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A] rounded-xl">
          <p className="text-xs text-center text-[#5C5C5C] mb-2 font-bold">&lt;보 기&gt;</p>
          <div className="space-y-1">
            {q.bogi.items.filter(i => i.content?.trim()).map((bi, i) => (
              <p key={i} className="text-sm text-[#1A1A1A]"><span className="font-bold mr-1">{bi.label}.</span>{bi.content}</p>
            ))}
          </div>
        </div>
      )}

      {/* 발문 */}
      {(q.passagePrompt || q.bogiQuestionText) && (
        <div className="mb-3 p-3 border border-[#1A1A1A] bg-[#F5F0E8] rounded-xl">
          <p className="text-sm text-[#1A1A1A]">
            {q.passagePrompt && q.bogiQuestionText
              ? `${q.passagePrompt} ${q.bogiQuestionText}`
              : q.passagePrompt || q.bogiQuestionText}
          </p>
        </div>
      )}
    </>
  );
}

// ============================================================
// 공통: 답변 입력 (OX / 객관식 / 단답형)
// ============================================================

function AnswerInput({
  question: q,
  userAnswer,
  onSelectAnswer,
}: {
  question: UpdatedQuestion;
  userAnswer: string;
  onSelectAnswer: (answer: string) => void;
}) {
  if (q.questionType === 'ox') {
    return (
      <div className="flex gap-3">
        {['O', 'X'].map((opt) => (
          <button
            key={opt}
            onClick={() => onSelectAnswer(opt)}
            className={`flex-1 py-3 border-2 text-center text-xl font-bold transition-colors rounded-xl ${
              userAnswer === opt
                ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                : 'border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] hover:bg-[#EDEAE4]'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }

  if (q.questionType === 'multiple' && q.choices) {
    const isMultipleAnswer = q.correctAnswer.includes(',') || q.hasMultipleAnswers;
    return (
      <div className="space-y-2">
        {q.choices.map((choice, idx) => {
          const optionValue = (idx + 1).toString();
          const isSelected = userAnswer?.split(',').includes(optionValue);
          return (
            <button
              key={idx}
              onClick={() => {
                const currentAnswers = userAnswer?.split(',').filter(Boolean) || [];
                if (isMultipleAnswer) {
                  if (currentAnswers.includes(optionValue)) {
                    onSelectAnswer(currentAnswers.filter((a) => a !== optionValue).join(','));
                  } else {
                    onSelectAnswer([...currentAnswers, optionValue].join(','));
                  }
                } else {
                  onSelectAnswer(optionValue);
                }
              }}
              className={`w-full p-3 border-2 text-left transition-colors rounded-xl flex items-start gap-2 ${
                isSelected
                  ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                  : 'border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] hover:bg-[#EDEAE4]'
              }`}
            >
              <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-xs font-bold border border-current rounded-full">{idx + 1}</span>
              <span className="flex-1 text-xs leading-relaxed">{choice}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // 단답형
  return (
    <input
      type="text"
      value={userAnswer || ''}
      onChange={(e) => onSelectAnswer(e.target.value)}
      placeholder="답을 입력하세요"
      className="w-full p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] text-sm leading-relaxed outline-none focus:border-[#5C5C5C] rounded-xl"
    />
  );
}

// ============================================================
// 결과 화면: 개별 문제 결과 카드
// ============================================================

function QuestionResultCard({
  result: r,
  label,
}: {
  result: {
    questionId: string; isCorrect: boolean; userAnswer: string; correctAnswer: string;
    previousAnswer: string; questionText: string; questionType: string; choices?: string[];
    explanation?: string; choiceExplanations?: string[]; image?: string; imageUrl?: string;
    mixedExamples?: any[]; bogi?: any; subQuestionOptions?: string[];
    subQuestionOptionsType?: string; subQuestionImage?: string;
    passagePrompt?: string; bogiQuestionText?: string;
  };
  label: string;
}) {
  const formatAnswer = (answer: string, type: string, choices?: string[]) => {
    if (!answer) return '-';
    if (type === 'ox') return answer.toUpperCase();
    if (type === 'multiple' && choices) {
      const indices = answer.split(',').map(s => parseInt(s.trim(), 10) - 1);
      return indices.map(i => choices[i] || `${i + 1}번`).join(', ');
    }
    return answer;
  };

  const correctAnswerIndex = r.questionType === 'multiple'
    ? r.correctAnswer.split(',').map(s => parseInt(s.trim(), 10))
    : [];
  const userAnswerIndex = r.questionType === 'multiple' && r.userAnswer
    ? r.userAnswer.split(',').map(s => parseInt(s.trim(), 10))
    : [];
  const displayImage = r.image || r.imageUrl;

  return (
    <div className={`p-3 border rounded-xl ${r.isCorrect ? 'border-[#1A6B1A] bg-[#E8F5E9]' : 'border-[#8B1A1A] bg-[#FDEAEA]'}`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-2">
        <span className={`text-sm font-bold ${r.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>{label}</span>
        <span className={`text-xs px-2 py-0.5 rounded-md ${r.isCorrect ? 'bg-[#1A6B1A] text-white' : 'bg-[#8B1A1A] text-white'}`}>
          {r.isCorrect ? '정답' : '오답'}
        </span>
      </div>

      {/* 문제 텍스트 */}
      <p className="text-sm text-[#1A1A1A] mb-2">{r.questionText}</p>

      {/* 혼합 보기 */}
      {r.mixedExamples && r.mixedExamples.length > 0 && (
        <div className="mb-2">
          {r.mixedExamples.filter((b: any) => b.type === 'grouped').map((block: any) => (
            <div key={block.id} className="p-2 border border-[#8B6914] bg-[#FFF8E1] rounded-lg mb-1 text-xs">
              {block.children?.map((child: any) => (
                <div key={child.id}>
                  {child.type === 'text' && child.content?.trim() && <p className="text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>}
                  {child.type === 'labeled' && (child.items || []).map((li: any) => (
                    <p key={li.id}><span className="font-bold">{li.label}.</span> {li.content}</p>
                  ))}
                  {child.type === 'gana' && (child.items || []).map((li: any) => (
                    <p key={li.id}><span className="font-bold">({li.label})</span> {li.content}</p>
                  ))}
                </div>
              ))}
            </div>
          ))}
          {r.mixedExamples.filter((b: any) => b.type !== 'grouped').map((block: any) => {
            if (block.type === 'text' && block.content?.trim()) return (
              <div key={block.id} className="p-2 border border-[#8B6914] bg-[#FFF8E1] rounded-lg mb-1 text-xs">
                <p className="text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>
              </div>
            );
            if (block.type === 'labeled') return (
              <div key={block.id} className="p-2 border border-[#8B6914] bg-[#FFF8E1] rounded-lg mb-1 text-xs">
                {(block.items || []).map((li: any) => (
                  <p key={li.id}><span className="font-bold">{li.label}.</span> {li.content}</p>
                ))}
              </div>
            );
            if (block.type === 'gana') return (
              <div key={block.id} className="p-2 border border-[#8B6914] bg-[#FFF8E1] rounded-lg mb-1 text-xs">
                {(block.items || []).map((li: any) => (
                  <p key={li.id}><span className="font-bold">({li.label})</span> {li.content}</p>
                ))}
              </div>
            );
            return null;
          })}
        </div>
      )}

      {/* 레거시 보기 */}
      {!r.mixedExamples?.length && r.subQuestionOptions && r.subQuestionOptions.length > 0 && (
        <div className="p-2 border border-[#8B6914] bg-[#FFF8E1] rounded-lg mb-2 text-xs">
          {r.subQuestionOptionsType === 'text' ? (
            <p className="text-[#1A1A1A]">{r.subQuestionOptions.join(', ')}</p>
          ) : (
            <div className="space-y-0.5">
              {r.subQuestionOptions.map((opt, i) => (
                <p key={i} className="text-[#1A1A1A]"><span className="font-bold">{KOREAN_LABELS[i]}.</span> {opt}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 문제 이미지 */}
      {displayImage && (
        <div className="mb-2">
          <img src={displayImage} alt="문제 이미지" className="max-w-full max-h-[200px] object-contain border border-[#1A1A1A] rounded-lg" />
        </div>
      )}

      {/* 하위 문제 이미지 */}
      {r.subQuestionImage && (
        <div className="mb-2">
          <img src={r.subQuestionImage} alt="보기 이미지" className="max-w-full max-h-[200px] object-contain border border-[#1A1A1A] rounded-lg" />
        </div>
      )}

      {/* 보기 박스 */}
      {r.bogi && r.bogi.items && r.bogi.items.some((i: any) => i.content?.trim()) && (
        <div className="mb-2 p-2 bg-[#EDEAE4] border border-[#1A1A1A] rounded-lg text-xs">
          <p className="text-center text-[#5C5C5C] mb-1 font-bold">&lt;보 기&gt;</p>
          <div className="space-y-0.5">
            {r.bogi.items.filter((i: any) => i.content?.trim()).map((bi: any, i: number) => (
              <p key={i} className="text-[#1A1A1A]"><span className="font-bold mr-1">{bi.label}.</span>{bi.content}</p>
            ))}
          </div>
        </div>
      )}

      {/* 발문 */}
      {(r.passagePrompt || r.bogiQuestionText) && (
        <div className="mb-2 p-2 border border-[#1A1A1A] bg-[#F5F0E8] rounded-lg text-xs">
          <p className="text-[#1A1A1A]">
            {r.passagePrompt && r.bogiQuestionText
              ? `${r.passagePrompt} ${r.bogiQuestionText}`
              : r.passagePrompt || r.bogiQuestionText}
          </p>
        </div>
      )}

      {/* OX */}
      {r.questionType === 'ox' && (
        <div className="flex gap-2 mb-2">
          {['O', 'X'].map((opt) => {
            const normalizedCorrect = r.correctAnswer === '0' ? 'O' : r.correctAnswer === '1' ? 'X' : r.correctAnswer.toUpperCase();
            const normalizedUser = r.userAnswer === '0' ? 'O' : r.userAnswer === '1' ? 'X' : r.userAnswer.toUpperCase();
            const isCorrectOpt = normalizedCorrect === opt;
            const isUserOpt = normalizedUser === opt;
            return (
              <div key={opt} className={`flex-1 py-2 text-center text-sm font-bold border-2 rounded-xl ${
                isCorrectOpt && isUserOpt ? 'border-[#1A6B1A] bg-[#C8E6C9] text-[#1A6B1A]'
                : isCorrectOpt ? 'border-[#1A6B1A] bg-white text-[#1A6B1A]'
                : isUserOpt ? 'border-[#8B1A1A] bg-[#FFCDD2] text-[#8B1A1A]'
                : 'border-[#ccc] bg-white text-[#999]'
              }`}>
                {opt}
              </div>
            );
          })}
        </div>
      )}

      {/* 객관식 선지 */}
      {r.questionType === 'multiple' && r.choices && (
        <div className="mb-2 space-y-1">
          {r.choices.map((choice, i) => {
            const choiceNum = i + 1;
            const isCorrectChoice = correctAnswerIndex.includes(choiceNum);
            const isUserChoice = userAnswerIndex.includes(choiceNum);
            return (
              <div key={i} className={`p-2 text-xs border rounded-lg ${
                isCorrectChoice && isUserChoice ? 'border-[#1A6B1A] bg-[#C8E6C9] text-[#1A6B1A]'
                : isCorrectChoice ? 'border-[#1A6B1A] bg-white text-[#1A6B1A]'
                : isUserChoice ? 'border-[#8B1A1A] bg-[#FFCDD2] text-[#8B1A1A]'
                : 'border-[#ddd] bg-white text-[#5C5C5C]'
              }`}>
                <span className="font-bold">{choiceNum}.</span> {choice}
                {correctAnswerIndex.length > 1 && isCorrectChoice && <span className="ml-1 font-bold">(정답)</span>}
                {correctAnswerIndex.length > 1 && isUserChoice && <span className="ml-1 font-bold">(내 답)</span>}
                {r.choiceExplanations && r.choiceExplanations[i] && (
                  <p className="mt-1 text-[10px] text-[#5C5C5C] italic">{r.choiceExplanations[i]}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 단답형 */}
      {r.questionType !== 'ox' && r.questionType !== 'multiple' && (
        <div className="text-xs space-y-1 mb-2">
          <p className="text-[#1A6B1A]"><span className="font-bold">정답:</span> {r.correctAnswer.includes('|||') ? r.correctAnswer.split('|||').join(' / ') : r.correctAnswer}</p>
          <p className={r.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}><span className="font-bold">내 답:</span> {r.userAnswer || '-'}</p>
          {r.previousAnswer && r.previousAnswer !== r.userAnswer && (
            <p className="text-[#5C5C5C]"><span className="font-bold">수정 전 답:</span> {r.previousAnswer}</p>
          )}
        </div>
      )}

      {/* 수정 전 답 (OX/객관식) */}
      {(r.questionType === 'ox' || r.questionType === 'multiple') && r.previousAnswer && r.previousAnswer !== r.userAnswer && (
        <p className="text-xs text-[#5C5C5C] mb-2">
          <span className="font-bold">수정 전 답:</span> {formatAnswer(r.previousAnswer, r.questionType, r.choices)}
        </p>
      )}

      {/* 해설 */}
      {r.explanation && (
        <div className="p-2 bg-[#EDEAE4] border border-[#ccc] rounded-lg text-xs">
          <p className="font-bold text-[#5C5C5C] mb-1">해설</p>
          <p className="text-[#1A1A1A] whitespace-pre-wrap">{r.explanation}</p>
        </div>
      )}
    </div>
  );
}
