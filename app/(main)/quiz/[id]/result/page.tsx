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
  deleteDoc,
  arrayUnion,
  serverTimestamp,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts';

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
  /** 결합형 그룹 ID */
  combinedGroupId?: string;
  /** 결합형 그룹 내 순서 */
  combinedIndex?: number;
  /** 결합형 그룹 내 총 문제 수 */
  combinedTotal?: number;
  /** 결합형 공통 지문 (첫 번째 문제에만) */
  passage?: string;
  /** 결합형 공통 지문 타입 */
  passageType?: string;
  /** 결합형 공통 이미지 */
  passageImage?: string;
  /** 결합형 ㄱㄴㄷ 보기 항목 */
  koreanAbcItems?: string[];
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
  quizUpdatedAt?: any; // 퀴즈 수정 시간 (알림용)
}

/**
 * 퀴즈 결과 페이지
 */
export default function QuizResultPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { userCourseId } = useCourse();

  const quizId = params.id as string;

  const [resultData, setResultData] = useState<QuizResultData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedQuestionIds, setExpandedQuestionIds] = useState<Set<string>>(new Set());

  const calculateAndSaveResults = useCallback(async () => {
    if (!user || !quizId) return;

    try {
      setIsLoading(true);

      // 먼저 저장된 결과 데이터가 있는지 확인
      const storedResult = localStorage.getItem(`quiz_result_${quizId}`);
      if (storedResult) {
        try {
          const cachedResult = JSON.parse(storedResult);
          if (cachedResult.questionResults && cachedResult.questionResults.length > 0) {
            // 저장된 결과 사용
            setResultData(cachedResult);
            setIsLoading(false);
            return;
          }
        } catch (e) {
          console.error('캐시된 결과 파싱 오류:', e);
        }
      }

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
            const correctAnswerStr = correctAnswer.toString();
            const userAnswerStr = userAnswer.toString();

            // 복수정답 여부 확인
            if (correctAnswerStr.includes(',')) {
              // 복수정답: 모든 정답을 선택해야 정답
              // correctAnswer와 userAnswer 모두 1-indexed (예: "1,3")
              const correctIndices = correctAnswerStr.split(',').map((s: string) => parseInt(s.trim(), 10));
              const userIndices = userAnswerStr
                ? userAnswerStr.split(',').map((s: string) => parseInt(s.trim(), 10))
                : [];

              // 정렬 후 비교
              const sortedCorrect = [...correctIndices].sort((a, b) => a - b);
              const sortedUser = [...userIndices].sort((a, b) => a - b);

              isCorrect =
                sortedCorrect.length === sortedUser.length &&
                sortedCorrect.every((val, idx) => val === sortedUser[idx]);
            } else {
              // 단일정답: 둘 다 1-indexed로 직접 비교
              isCorrect = userAnswerStr === correctAnswerStr;
            }
          } else if (q.type === 'ox') {
            // OX: 정답이 "0"/"1" 또는 "O"/"X"일 수 있음
            const userOX = userAnswer.toString().toUpperCase();
            let correctOX = correctAnswer.toString().toUpperCase();
            if (correctOX === '0') correctOX = 'O';
            else if (correctOX === '1') correctOX = 'X';
            isCorrect = userOX === correctOX;
          } else {
            // 주관식: 복수 정답 지원 ("|||"로 구분)
            const userAnswerNormalized = userAnswer.toString().trim().toLowerCase();
            if (correctAnswer.toString().includes('|||')) {
              // 복수 정답: 하나라도 맞으면 정답
              const correctAnswers = correctAnswer.toString().split('|||').map((a: string) => a.trim().toLowerCase());
              isCorrect = correctAnswers.some((ca: string) => userAnswerNormalized === ca);
            } else {
              isCorrect = userAnswerNormalized === correctAnswer.toString().trim().toLowerCase();
            }
          }

          if (isCorrect) correctCount++;

          const result: QuestionResult = {
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

          // 결합형 그룹 정보 추가
          if (q.combinedGroupId) {
            result.combinedGroupId = q.combinedGroupId;
            result.combinedIndex = q.combinedIndex;
            result.combinedTotal = q.combinedTotal;

            // 첫 번째 하위 문제에만 공통 지문 정보 포함
            if (q.combinedIndex === 0) {
              result.passageType = q.passageType;
              result.passage = q.passage;
              result.passageImage = q.passageImage;
              result.koreanAbcItems = q.koreanAbcItems;
            }
          }

          return result;
        }
      );

      const earnedExp = correctCount * 10;
      const quizUpdatedAt = quizData.updatedAt || quizData.createdAt || null;

      const result: QuizResultData = {
        quizId,
        quizTitle: quizData.title || '퀴즈',
        correctCount,
        totalCount: questions.length,
        earnedExp,
        questionResults,
        quizUpdatedAt,
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

          // 점수 계산 (0-100)
          const score = Math.round((correctCount / questions.length) * 100);

          // 문제별 점수 객체 생성 (업데이트 시스템용)
          const questionScores: Record<string, {
            isCorrect: boolean;
            userAnswer: string;
            answeredAt: any;
          }> = {};
          questionResults.forEach((qr) => {
            questionScores[qr.id] = {
              isCorrect: qr.isCorrect,
              userAnswer: qr.userAnswer,
              answeredAt: serverTimestamp(),
            };
          });

          // 퀴즈 결과 저장 (score 필드 필수 - Cloud Function에서 사용)
          await addDoc(collection(db, 'quizResults'), {
            userId: user.uid,
            quizId,
            quizTitle: quizData.title || '퀴즈',
            quizCreatorId: quizData.creatorId || null, // 퀴즈 제작자 ID (통계 조회용)
            score, // Cloud Function onQuizComplete에서 필수
            correctCount,
            totalCount: questions.length,
            earnedExp,
            answers: userAnswers,
            questionScores, // 문제별 점수 (업데이트 시스템용)
            isUpdate: false, // 첫 풀이 표시
            courseId: userCourseId || null,
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

          // 퀴즈 업데이트 시간 저장 (문제 수정 알림용)
          const quizUpdatedAt = quizData.updatedAt || quizData.createdAt || null;

          // 모든 문제를 'solved' 타입으로 저장 (푼 문제)
          for (const questionResult of questionResults) {
            // 타입 정규화: subjective -> short
            const normalizedType = questionResult.type === 'subjective' ? 'short' : questionResult.type;
            await addDoc(collection(db, 'reviews'), {
              userId: user.uid,
              quizId,
              quizTitle: quizData.title || '퀴즈',
              questionId: questionResult.id,
              question: questionResult.question,
              type: normalizedType,
              options: questionResult.options || [],
              correctAnswer: questionResult.correctAnswer,
              userAnswer: questionResult.userAnswer,
              explanation: questionResult.explanation || '',
              isCorrect: questionResult.isCorrect,
              reviewType: 'solved',
              isBookmarked: false,
              reviewCount: 0,
              lastReviewedAt: null,
              courseId: userCourseId || null,
              quizUpdatedAt, // 퀴즈 수정 시간 저장
              createdAt: serverTimestamp(),
            });
          }

          // 오답 자동 저장 (틀린 문제)
          const wrongAnswers = questionResults.filter((r) => !r.isCorrect);
          for (const wrongAnswer of wrongAnswers) {
            // 타입 정규화: subjective -> short
            const normalizedWrongType = wrongAnswer.type === 'subjective' ? 'short' : wrongAnswer.type;
            await addDoc(collection(db, 'reviews'), {
              userId: user.uid,
              quizId,
              quizTitle: quizData.title || '퀴즈',
              questionId: wrongAnswer.id,
              question: wrongAnswer.question,
              type: normalizedWrongType,
              options: wrongAnswer.options || [],
              correctAnswer: wrongAnswer.correctAnswer,
              userAnswer: wrongAnswer.userAnswer,
              explanation: wrongAnswer.explanation || '',
              reviewType: 'wrong',
              isBookmarked: false,
              reviewCount: 0,
              lastReviewedAt: null,
              courseId: userCourseId || null,
              quizUpdatedAt, // 퀴즈 수정 시간 저장
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

    const question = resultData.questionResults.find((r) => r.id === questionId);
    if (!question) return;

    const wasBookmarked = question.isBookmarked;

    // UI 먼저 업데이트
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
      // 기존 북마크 문서 조회
      const bookmarkQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', resultData.quizId),
        where('questionId', '==', questionId),
        where('reviewType', '==', 'bookmark')
      );
      const existingBookmarks = await getDocs(bookmarkQuery);

      if (wasBookmarked) {
        // 찜 해제: 기존 문서들 삭제
        for (const docSnapshot of existingBookmarks.docs) {
          await deleteDoc(docSnapshot.ref);
        }
      } else {
        // 찜하기: 기존 문서가 없을 때만 추가
        if (existingBookmarks.empty) {
          // 타입 정규화: subjective -> short
          const normalizedBookmarkType = question.type === 'subjective' ? 'short' : question.type;
          await addDoc(collection(db, 'reviews'), {
            userId: user.uid,
            quizId: resultData.quizId,
            quizTitle: resultData.quizTitle,
            questionId: question.id,
            question: question.question,
            type: normalizedBookmarkType,
            options: question.options || [],
            correctAnswer: question.correctAnswer,
            userAnswer: question.userAnswer,
            explanation: question.explanation || '',
            reviewType: 'bookmark',
            isBookmarked: true,
            reviewCount: 0,
            lastReviewedAt: null,
            courseId: userCourseId || null,
            quizUpdatedAt: resultData.quizUpdatedAt || null, // 퀴즈 수정 시간 저장
            createdAt: serverTimestamp(),
          });
        }
      }
    } catch (err) {
      console.error('찜하기 오류:', err);
      // 에러 시 UI 롤백
      setResultData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          questionResults: prev.questionResults.map((r) =>
            r.id === questionId ? { ...r, isBookmarked: wasBookmarked } : r
          ),
        };
      });
    }
  };

  const handleNext = () => {
    router.push(`/quiz/${quizId}/feedback`);
  };

  const handleGoHome = () => {
    router.push('/quiz');
  };

  const toggleExpand = (questionId: string) => {
    setExpandedQuestionIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(questionId)) {
        newSet.delete(questionId);
      } else {
        newSet.add(questionId);
      }
      return newSet;
    });
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


        {/* 문제별 결과 */}
        <div className="space-y-3">
          <h3 className="font-bold text-[#1A1A1A]">문제별 결과</h3>
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
                      expandedQuestionIds.has(result.id) ? 'rotate-180' : ''
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
                {expandedQuestionIds.has(result.id) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="border-2 border-t-0 border-[#1A1A1A] bg-[#F5F0E8] p-4 space-y-3">
                      {/* 결합형 문제 그룹 표시 */}
                      {result.combinedGroupId && result.combinedIndex === 0 && (
                        <div className="mb-3 p-3 border-2 border-[#8B6914] bg-[#FFF8E1]">
                          <p className="text-xs font-bold text-[#8B6914] mb-2">
                            결합형 문제 ({result.combinedTotal}문제)
                          </p>
                          {/* 공통 지문 - 텍스트 */}
                          {result.passage && result.passageType !== 'korean_abc' && (
                            <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{result.passage}</p>
                          )}
                          {/* 공통 지문 - ㄱㄴㄷ 형식 */}
                          {result.passageType === 'korean_abc' && result.koreanAbcItems && result.koreanAbcItems.length > 0 && (
                            <div className="space-y-1">
                              {result.koreanAbcItems.map((item, idx) => (
                                <p key={idx} className="text-sm text-[#1A1A1A]">
                                  <span className="font-bold">{['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ'][idx]}.</span> {item}
                                </p>
                              ))}
                            </div>
                          )}
                          {/* 공통 이미지 */}
                          {result.passageImage && (
                            <img src={result.passageImage} alt="공통 이미지" className="mt-2 max-w-full h-auto border border-[#1A1A1A]" />
                          )}
                        </div>
                      )}
                      {/* 결합형 후속 문제 표시 */}
                      {result.combinedGroupId && result.combinedIndex !== undefined && result.combinedIndex > 0 && (
                        <p className="text-xs text-[#8B6914] font-bold mb-2">
                          결합형 문제 ({result.combinedIndex + 1}/{result.combinedTotal})
                        </p>
                      )}

                      {/* 선지 (객관식) */}
                      {result.options && result.options.length > 0 && (
                        <div>
                          {/* 복수 정답 표시 */}
                          {(() => {
                            const correctAnswerStr = result.correctAnswer?.toString() || '';
                            const correctAnswers = correctAnswerStr.includes(',')
                              ? correctAnswerStr.split(',').map(a => a.trim())
                              : [correctAnswerStr];
                            const isMultipleAnswer = correctAnswers.length > 1;
                            return isMultipleAnswer && (
                              <p className="text-xs text-[#8B6914] font-bold mb-2 flex items-center gap-1">
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                </svg>
                                복수 정답 문제 ({correctAnswers.length}개)
                              </p>
                            );
                          })()}
                          <p className="text-xs font-bold text-[#5C5C5C] mb-2">선지</p>
                          <div className="space-y-1">
                            {result.options.map((opt, idx) => {
                              const optionNum = (idx + 1).toString();
                              const optionIdx = idx.toString();
                              // 복수 정답 지원: 쉼표로 구분된 정답 처리
                              const correctAnswerStr = result.correctAnswer?.toString() || '';
                              const correctAnswers = correctAnswerStr.includes(',')
                                ? correctAnswerStr.split(',').map(a => a.trim())
                                : [correctAnswerStr];
                              const isCorrectOption = correctAnswers.some(ca =>
                                ca === optionNum || ca === optionIdx || ca === opt
                              );
                              // 사용자 답 비교: 복수 선택도 지원
                              const userAnswerStr = result.userAnswer?.toString() || '';
                              const userAnswers = userAnswerStr.includes(',')
                                ? userAnswerStr.split(',').map(a => a.trim())
                                : [userAnswerStr];
                              const isUserAnswer = userAnswers.some(ua =>
                                ua === optionNum || ua === optionIdx || ua === opt
                              );

                              // 스타일 결정: 정답 > 내 오답 > 기본
                              let className = 'border-[#EDEAE4] text-[#1A1A1A]';
                              if (isCorrectOption) {
                                className = 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]';
                              } else if (isUserAnswer) {
                                className = 'border-[#8B1A1A] bg-[#FDEAEA] text-[#8B1A1A]';
                              }

                              return (
                                <p
                                  key={idx}
                                  className={`text-sm p-2 border ${className}`}
                                >
                                  {idx + 1}. {opt}
                                  {isCorrectOption && ' (정답)'}
                                  {isUserAnswer && !isCorrectOption && ' (내 답)'}
                                </p>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* OX/주관식 답 */}
                      {(!result.options || result.options.length === 0) && (
                        <div className="space-y-2">
                          <p className="text-sm">
                            <span className="text-[#5C5C5C]">내 답: </span>
                            <span className="font-bold text-[#1A1A1A]">
                              {result.type === 'ox'
                                ? (result.userAnswer === '0' || result.userAnswer?.toString().toUpperCase() === 'O' ? 'O' : result.userAnswer === '1' || result.userAnswer?.toString().toUpperCase() === 'X' ? 'X' : result.userAnswer || '(미응답)')
                                : (result.userAnswer || '(미응답)')}
                            </span>
                          </p>
                          {/* 주관식 복수 정답 표시 */}
                          {result.correctAnswer?.toString().includes('|||') ? (
                            <div className="text-sm">
                              <span className="text-[#5C5C5C]">정답 (다음 중 하나): </span>
                              <div className="mt-1 space-y-1">
                                {result.correctAnswer.split('|||').map((ans: string, idx: number) => (
                                  <span
                                    key={idx}
                                    className="inline-block mr-2 px-2 py-0.5 bg-[#E8F5E9] border border-[#1A6B1A] text-[#1A6B1A] font-bold"
                                  >
                                    {ans.trim()}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : result.type === 'ox' ? (
                            // OX 문제: 인덱스를 O/X로 변환
                            <p className="text-sm">
                              <span className="text-[#5C5C5C]">정답: </span>
                              <span className="font-bold text-[#1A6B1A]">
                                {result.correctAnswer === '0' || result.correctAnswer?.toString().toUpperCase() === 'O' ? 'O' : 'X'}
                              </span>
                            </p>
                          ) : (
                            <p className="text-sm">
                              <span className="text-[#5C5C5C]">정답: </span>
                              <span className="font-bold text-[#1A6B1A]">{result.correctAnswer}</span>
                            </p>
                          )}
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
