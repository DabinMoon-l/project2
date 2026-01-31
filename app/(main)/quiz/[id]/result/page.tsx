'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import {
  doc,
  getDoc,
  collection,
  addDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';

/**
 * 문제 결과 타입
 */
interface QuestionResult {
  id: string;
  number: number;
  question: string;
  type: string;
  options?: string[];
  correctAnswer: string;
  userAnswer: string;
  isCorrect: boolean;
  explanation: string;
  isBookmarked: boolean;
}

/**
 * 퀴즈 결과 데이터 타입
 */
interface QuizResultData {
  quizId: string;
  quizTitle: string;
  correctCount: number;
  totalCount: number;
  earnedExp: number;
  questionResults: QuestionResult[];
}

/**
 * 퀴즈 결과 페이지
 */
export default function QuizResultPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const quizId = params.id as string;

  const [resultData, setResultData] = useState<QuizResultData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);

  const calculateAndSaveResults = useCallback(async () => {
    if (!user || !quizId) return;

    try {
      setIsLoading(true);

      const answersParam = searchParams.get('answers');
      let userAnswers: string[] = [];

      if (answersParam) {
        userAnswers = JSON.parse(decodeURIComponent(answersParam));
      } else {
        const storedAnswers = localStorage.getItem(`quiz_answers_${quizId}`);
        if (storedAnswers) {
          userAnswers = JSON.parse(storedAnswers);
        } else {
          setError('퀴즈 답변 데이터를 찾을 수 없습니다.');
          return;
        }
      }

      const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
      if (!quizDoc.exists()) {
        setError('퀴즈를 찾을 수 없습니다.');
        return;
      }

      const quizData = quizDoc.data();
      const questions = quizData.questions || [];

      let correctCount = 0;
      const questionResults: QuestionResult[] = questions.map(
        (q: any, index: number) => {
          const userAnswer = userAnswers[index] || '';
          const correctAnswer = q.correctAnswer || q.answer || '';

          let isCorrect = false;
          if (q.type === 'multiple') {
            isCorrect = userAnswer.toString() === correctAnswer.toString();
          } else if (q.type === 'ox') {
            isCorrect = userAnswer.toString().toUpperCase() === correctAnswer.toString().toUpperCase();
          } else {
            isCorrect = userAnswer.toString().trim().toLowerCase() ===
                       correctAnswer.toString().trim().toLowerCase();
          }

          if (isCorrect) correctCount++;

          return {
            id: q.id || `q${index}`,
            number: index + 1,
            question: q.text || q.question || '',
            type: q.type,
            options: q.choices || q.options || [],
            correctAnswer: correctAnswer,
            userAnswer,
            isCorrect,
            explanation: q.explanation || '해설이 없습니다.',
            isBookmarked: false,
          };
        }
      );

      const earnedExp = correctCount * 10;

      const result: QuizResultData = {
        quizId,
        quizTitle: quizData.title || '퀴즈',
        correctCount,
        totalCount: questions.length,
        earnedExp,
        questionResults,
      };

      setResultData(result);

      // 결과 저장
      try {
        // 이미 푼 퀴즈인지 확인
        const existingResultQuery = query(
          collection(db, 'quizResults'),
          where('userId', '==', user.uid),
          where('quizId', '==', quizId)
        );
        const existingResults = await getDocs(existingResultQuery);

        // 이미 결과가 있으면 새로 저장하지 않음 (중복 방지)
        if (existingResults.empty) {
          // 퀴즈 결과 저장
          await addDoc(collection(db, 'quizResults'), {
            userId: user.uid,
            quizId,
            quizTitle: quizData.title || '퀴즈',
            correctCount,
            totalCount: questions.length,
            earnedExp,
            answers: userAnswers,
            createdAt: serverTimestamp(),
          });

          // 퀴즈 문서에 completedUsers 추가
          try {
            await updateDoc(doc(db, 'quizzes', quizId), {
              completedUsers: arrayUnion(user.uid),
            });
          } catch (updateErr) {
            console.error('퀴즈 완료 표시 실패:', updateErr);
          }

          // 모든 문제를 'solved' 타입으로 저장 (푼 문제)
          for (const questionResult of questionResults) {
            await addDoc(collection(db, 'reviews'), {
              userId: user.uid,
              quizId,
              quizTitle: quizData.title || '퀴즈',
              questionId: questionResult.id,
              question: questionResult.question,
              type: questionResult.type,
              options: questionResult.options || [],
              correctAnswer: questionResult.correctAnswer,
              userAnswer: questionResult.userAnswer,
              explanation: questionResult.explanation || '',
              isCorrect: questionResult.isCorrect,
              reviewType: 'solved',
              isBookmarked: false,
              reviewCount: 0,
              lastReviewedAt: null,
              createdAt: serverTimestamp(),
            });
          }

          // 오답 자동 저장 (틀린 문제)
          const wrongAnswers = questionResults.filter((r) => !r.isCorrect);
          for (const wrongAnswer of wrongAnswers) {
            await addDoc(collection(db, 'reviews'), {
              userId: user.uid,
              quizId,
              quizTitle: quizData.title || '퀴즈',
              questionId: wrongAnswer.id,
              question: wrongAnswer.question,
              type: wrongAnswer.type,
              options: wrongAnswer.options || [],
              correctAnswer: wrongAnswer.correctAnswer,
              userAnswer: wrongAnswer.userAnswer,
              explanation: wrongAnswer.explanation || '',
              reviewType: 'wrong',
              isBookmarked: false,
              reviewCount: 0,
              lastReviewedAt: null,
              createdAt: serverTimestamp(),
            });
          }
        }
      } catch (saveError) {
        console.error('결과 저장 오류:', saveError);
      }

      // 결과 데이터를 localStorage에 저장 (피드백 페이지에서 사용)
      localStorage.setItem(`quiz_result_${quizId}`, JSON.stringify(result));
      localStorage.removeItem(`quiz_answers_${quizId}`);
      localStorage.removeItem(`quiz_time_${quizId}`);

    } catch (err) {
      console.error('결과 계산 오류:', err);
      setError('결과를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [user, quizId, searchParams]);

  useEffect(() => {
    calculateAndSaveResults();
  }, [calculateAndSaveResults]);

  const handleToggleBookmark = async (questionId: string) => {
    if (!user || !resultData) return;

    setResultData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questionResults: prev.questionResults.map((r) =>
          r.id === questionId ? { ...r, isBookmarked: !r.isBookmarked } : r
        ),
      };
    });

    try {
      const question = resultData.questionResults.find((r) => r.id === questionId);
      if (!question || question.isBookmarked) return;

      await addDoc(collection(db, 'reviews'), {
        userId: user.uid,
        quizId: resultData.quizId,
        quizTitle: resultData.quizTitle,
        questionId: question.id,
        question: question.question,
        type: question.type,
        options: question.options || [],
        correctAnswer: question.correctAnswer,
        userAnswer: question.userAnswer,
        explanation: question.explanation || '',
        reviewType: 'bookmark',
        isBookmarked: true,
        reviewCount: 0,
        lastReviewedAt: null,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('찜하기 오류:', err);
    }
  };

  const handleNext = () => {
    router.push(`/quiz/${quizId}/feedback`);
  };

  const handleGoHome = () => {
    router.push('/quiz');
  };

  const toggleExpand = (questionId: string) => {
    setExpandedQuestionId(expandedQuestionId === questionId ? null : questionId);
  };

  // 로딩 UI
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F0E8' }}>
        <motion.div className="flex flex-col items-center gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <motion.div
            className="w-12 h-12 border-4 border-[#1A1A1A] border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="text-[#5C5C5C] font-bold">결과 계산 중...</p>
        </motion.div>
      </div>
    );
  }

  // 에러 UI
  if (error || !resultData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F5F0E8' }}>
        <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">오류 발생</h2>
        <p className="text-[#5C5C5C] text-center mb-6">{error || '알 수 없는 오류가 발생했습니다.'}</p>
        <button
          onClick={handleGoHome}
          className="px-6 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
        >
          퀴즈 목록으로
        </button>
      </div>
    );
  }

  const isPerfectScore = resultData.correctCount === resultData.totalCount;

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="sticky top-0 z-50 w-full border-b-2 border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex items-center justify-center h-14 px-4">
          <h1 className="text-base font-bold text-[#1A1A1A]">퀴즈 결과</h1>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="px-4 pt-6 space-y-6"
      >
        {/* 점수 표시 */}
        <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6 text-center">
          <p className="text-sm text-[#5C5C5C] mb-2">{resultData.quizTitle}</p>
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-5xl font-bold text-[#1A1A1A]">{resultData.correctCount}</span>
            <span className="text-2xl text-[#5C5C5C]">/</span>
            <span className="text-2xl text-[#5C5C5C]">{resultData.totalCount}</span>
          </div>
          {isPerfectScore ? (
            <div className="inline-block px-4 py-2 bg-[#1A6B1A] text-[#F5F0E8] font-bold border-2 border-[#1A6B1A]">
              만점!
            </div>
          ) : (
            <p className="text-sm text-[#5C5C5C]">
              정답률 {Math.round((resultData.correctCount / resultData.totalCount) * 100)}%
            </p>
          )}
        </div>

        {/* 획득 경험치 */}
        <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 text-center">
          <p className="text-xs text-[#5C5C5C] mb-1">획득 경험치</p>
          <p className="text-xl font-bold text-[#1A6B1A]">+{resultData.earnedExp}XP</p>
        </div>

        {/* 문제별 결과 */}
        <div className="space-y-3">
          <h3 className="font-bold text-[#1A1A1A]">문제별 결과 (클릭하여 상세 보기)</h3>
          {resultData.questionResults.map((result) => (
            <div key={result.id}>
              <button
                onClick={() => toggleExpand(result.id)}
                className={`w-full border-2 p-4 text-left ${
                  result.isCorrect
                    ? 'border-[#1A6B1A] bg-[#E8F5E9]'
                    : 'border-[#8B1A1A] bg-[#FDEAEA]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-bold ${result.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                    Q{result.number}. {result.isCorrect ? '정답' : '오답'}
                  </span>
                  <svg
                    className={`w-5 h-5 text-[#5C5C5C] transition-transform ${
                      expandedQuestionId === result.id ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <p className="text-sm text-[#1A1A1A] mt-2 line-clamp-2">{result.question}</p>
              </button>

              {/* 상세 정보 (펼침) */}
              <AnimatePresence>
                {expandedQuestionId === result.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="border-2 border-t-0 border-[#1A1A1A] bg-[#F5F0E8] p-4 space-y-3">
                      {/* 선지 (객관식) */}
                      {result.options && result.options.length > 0 && (
                        <div>
                          <p className="text-xs font-bold text-[#5C5C5C] mb-2">선지</p>
                          <div className="space-y-1">
                            {result.options.map((opt, idx) => (
                              <p
                                key={idx}
                                className={`text-sm p-2 border ${
                                  result.correctAnswer === idx.toString()
                                    ? 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]'
                                    : result.userAnswer === idx.toString() && !result.isCorrect
                                    ? 'border-[#8B1A1A] bg-[#FDEAEA] text-[#8B1A1A]'
                                    : 'border-[#EDEAE4] text-[#1A1A1A]'
                                }`}
                              >
                                {idx + 1}. {opt}
                                {result.correctAnswer === idx.toString() && ' ✓'}
                                {result.userAnswer === idx.toString() && !result.isCorrect && ' (내 답)'}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* OX/주관식 답 */}
                      {(!result.options || result.options.length === 0) && (
                        <div className="space-y-2">
                          <p className="text-sm">
                            <span className="text-[#5C5C5C]">내 답: </span>
                            <span className="font-bold text-[#1A1A1A]">{result.userAnswer || '(미응답)'}</span>
                          </p>
                          <p className="text-sm">
                            <span className="text-[#5C5C5C]">정답: </span>
                            <span className="font-bold text-[#1A6B1A]">{result.correctAnswer}</span>
                          </p>
                        </div>
                      )}

                      {/* 해설 */}
                      <div>
                        <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                        <p className="text-sm text-[#1A1A1A] bg-[#EDEAE4] p-3 border border-[#1A1A1A]">
                          {result.explanation}
                        </p>
                      </div>

                      {/* 찜하기 버튼 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleBookmark(result.id);
                        }}
                        className={`w-full py-2 font-bold border-2 text-sm ${
                          result.isBookmarked
                            ? 'border-[#8B6914] bg-[#FFF8E1] text-[#8B6914]'
                            : 'border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]'
                        }`}
                      >
                        {result.isBookmarked ? '찜 완료' : '찜하기'}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </motion.main>

      {/* 하단 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#F5F0E8] border-t-2 border-[#1A1A1A]">
        <button
          onClick={handleNext}
          className="w-full py-4 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
        >
          다음
        </button>
      </div>
    </div>
  );
}
