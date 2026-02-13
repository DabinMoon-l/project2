/**
 * 퀴즈 업데이트 모달
 *
 * 수정된 문제만 다시 풀 수 있는 모달입니다.
 * 완료 시 기존 점수와 병합하여 저장합니다.
 */

'use client';

import { useState, useCallback } from 'react';
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
    }[];
  } | null>(null);

  const questions = updateInfo.updatedQuestions;
  const currentQuestion = questions[currentIndex];

  /**
   * 답변 선택
   */
  const handleSelectAnswer = useCallback((answer: string) => {
    setUserAnswers((prev) => ({
      ...prev,
      [currentQuestion.questionId]: answer,
    }));
  }, [currentQuestion]);

  /**
   * 다음 문제로
   */
  const handleNext = useCallback(() => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, questions.length]);

  /**
   * 이전 문제로
   */
  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

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
        });
      }

      // 2. 기존 점수와 병합
      const mergedScores: Record<string, { isCorrect: boolean; userAnswer: string; answeredAt: any }> = { ...originalScores };

      // 새로 푼 문제로 교체
      for (const result of questionResults) {
        mergedScores[result.questionId] = {
          isCorrect: result.isCorrect,
          userAnswer: result.userAnswer,
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
  }, [user, userAnswers, questions, updateInfo, totalQuestionCount, userCourseId]);

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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-[#F5F0E8] border-2 border-[#1A1A1A] max-h-[90vh] overflow-auto"
        >
          {/* 헤더 */}
          <div className="p-4 border-b border-[#1A1A1A]">
            <h2 className="text-lg font-bold text-[#1A1A1A]">업데이트 완료</h2>
          </div>

          {/* 결과 */}
          <div className="p-6 text-center">
            <p className="text-sm text-[#5C5C5C] mb-2">업데이트 결과</p>
            <div className="flex items-center justify-center gap-2 mb-4">
              <span className="text-4xl font-bold text-[#1A1A1A]">{correctCount}</span>
              <span className="text-xl text-[#5C5C5C]">/</span>
              <span className="text-xl text-[#5C5C5C]">{questions.length}</span>
            </div>

            <div className="p-4 border border-[#1A1A1A] bg-[#EDEAE4] mb-4">
              <p className="text-sm text-[#5C5C5C] mb-1">새 점수</p>
              <p className="text-2xl font-bold text-[#1A1A1A]">{resultData.newScore}점</p>
              <p className="text-xs text-[#5C5C5C]">
                ({resultData.newCorrectCount}/{totalQuestionCount} 정답)
              </p>
            </div>

            {/* 문제별 결과 */}
            <div className="space-y-3 text-left">
              {resultData.questionResults.map((r, idx) => {
                // 답 표시 포맷
                const formatAnswer = (answer: string, type: string, choices?: string[]) => {
                  if (!answer) return '-';
                  if (type === 'ox') return answer.toUpperCase();
                  if (type === 'multiple' && choices) {
                    const indices = answer.split(',').map(s => parseInt(s.trim(), 10) - 1);
                    return indices.map(i => choices[i] || `${i + 1}번`).join(', ');
                  }
                  return answer;
                };

                const formattedUserAnswer = formatAnswer(r.userAnswer, r.questionType, r.choices);
                const formattedPreviousAnswer = formatAnswer(r.previousAnswer, r.questionType, r.choices);
                const formattedCorrectAnswer = formatAnswer(r.correctAnswer, r.questionType, r.choices);
                const sameAnswer = r.userAnswer === r.previousAnswer;

                return (
                  <div
                    key={r.questionId}
                    className={`p-3 border ${r.isCorrect ? 'border-[#1A6B1A] bg-[#E8F5E9]' : 'border-[#8B1A1A] bg-[#FDEAEA]'}`}
                  >
                    {/* 문제 헤더 */}
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-sm font-bold ${r.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                        문제 {idx + 1}
                      </span>
                      <span className={`text-xs px-2 py-0.5 ${r.isCorrect ? 'bg-[#1A6B1A] text-white' : 'bg-[#8B1A1A] text-white'}`}>
                        {r.isCorrect ? '정답' : '오답'}
                      </span>
                    </div>

                    {/* 문제 내용 */}
                    <p className="text-sm text-[#1A1A1A] mb-2">{r.questionText}</p>

                    {/* 객관식 선지 */}
                    {r.questionType === 'multiple' && r.choices && (
                      <div className="text-xs text-[#5C5C5C] mb-2 space-y-0.5">
                        {r.choices.map((choice, i) => (
                          <p key={i}>{i + 1}. {choice}</p>
                        ))}
                      </div>
                    )}

                    {/* 정답 */}
                    <div className="text-xs space-y-1">
                      <p className="text-[#1A6B1A]">
                        <span className="font-bold">정답:</span> {formattedCorrectAnswer}
                      </p>

                      {/* 내가 쓴 답 & 수정 전 내가 쓴 답 */}
                      <div className="flex flex-wrap gap-2">
                        <p className={r.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}>
                          <span className="font-bold">{sameAnswer ? '(내 답)' : ''}</span> {formattedUserAnswer}
                        </p>
                        {r.previousAnswer && (
                          <p className="text-[#5C5C5C]">
                            <span className="font-bold">{sameAnswer ? '(수정 전 내 답)' : ''}</span> {formattedPreviousAnswer}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 완료 버튼 */}
          <div className="p-4 border-t border-[#1A1A1A]">
            <button
              onClick={handleComplete}
              className="w-full py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-[#F5F0E8] border-2 border-[#1A1A1A] max-h-[90vh] overflow-auto"
      >
        {/* 헤더 */}
        <div className="p-4 border-b border-[#1A1A1A] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#1A1A1A]">수정된 문제 풀기</h2>
            <p className="text-xs text-[#5C5C5C]">{updateInfo.quizTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center border border-[#1A1A1A] hover:bg-[#EDEAE4]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 진행 표시 */}
        <div className="px-4 py-2 border-b border-[#EDEAE4]">
          <div className="flex items-center justify-between text-xs text-[#5C5C5C]">
            <span>문제 {currentIndex + 1} / {questions.length}</span>
            <span>{Object.keys(userAnswers).length}개 답변</span>
          </div>
          <div className="mt-1 h-1 bg-[#EDEAE4]">
            <div
              className="h-full bg-[#1A1A1A] transition-all"
              style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>

        {/* 문제 */}
        <div className="p-4">
          <div className="mb-4">
            <span className="text-xs text-[#5C5C5C]">
              {currentQuestion.questionType === 'ox' ? 'OX' :
               currentQuestion.questionType === 'multiple' ? '객관식' :
               currentQuestion.questionType === 'short_answer' ? '단답형' : '주관식'}
            </span>
            <p className="text-[#1A1A1A] font-medium mt-1">{currentQuestion.questionText}</p>
          </div>

          {/* 선지 / 입력 */}
          {currentQuestion.questionType === 'ox' ? (
            <div className="space-y-2">
              {['O', 'X'].map((opt) => (
                <button
                  key={opt}
                  onClick={() => handleSelectAnswer(opt)}
                  className={`w-full p-3 border-2 text-left font-bold transition-colors ${
                    userAnswers[currentQuestion.questionId] === opt
                      ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                      : 'border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] hover:bg-[#EDEAE4]'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : currentQuestion.questionType === 'multiple' && currentQuestion.choices ? (
            <div className="space-y-2">
              {currentQuestion.choices.map((choice, idx) => {
                const optionValue = (idx + 1).toString();
                const isSelected = userAnswers[currentQuestion.questionId]?.split(',').includes(optionValue);
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      const currentAnswers = userAnswers[currentQuestion.questionId]?.split(',').filter(Boolean) || [];
                      // 복수정답 체크
                      const correctAnswer = currentQuestion.correctAnswer;
                      const isMultipleAnswer = correctAnswer.includes(',');

                      if (isMultipleAnswer) {
                        // 복수정답: 토글
                        if (currentAnswers.includes(optionValue)) {
                          handleSelectAnswer(currentAnswers.filter((a) => a !== optionValue).join(','));
                        } else {
                          handleSelectAnswer([...currentAnswers, optionValue].join(','));
                        }
                      } else {
                        // 단일정답
                        handleSelectAnswer(optionValue);
                      }
                    }}
                    className={`w-full p-3 border-2 text-left transition-colors ${
                      isSelected
                        ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                        : 'border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] hover:bg-[#EDEAE4]'
                    }`}
                  >
                    <span className="font-bold">{idx + 1}.</span> {choice}
                  </button>
                );
              })}
            </div>
          ) : (
            <input
              type="text"
              value={userAnswers[currentQuestion.questionId] || ''}
              onChange={(e) => handleSelectAnswer(e.target.value)}
              placeholder="답을 입력하세요"
              className="w-full p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] outline-none focus:border-[#5C5C5C]"
            />
          )}
        </div>

        {/* 네비게이션 버튼 */}
        <div className="p-4 border-t border-[#1A1A1A] flex gap-2">
          {currentIndex > 0 && (
            <button
              onClick={handlePrev}
              className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              이전
            </button>
          )}
          {currentIndex < questions.length - 1 ? (
            <button
              onClick={handleNext}
              disabled={!userAnswers[currentQuestion.questionId]}
              className="flex-1 py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors disabled:opacity-50"
            >
              다음
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || Object.keys(userAnswers).length !== questions.length}
              className="flex-1 py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
