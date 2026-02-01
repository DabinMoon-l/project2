'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  doc,
  getDoc,
  collection,
  addDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useThemeColors } from '@/styles/themes/useTheme';
import { Skeleton } from '@/components/common';

// 퀴즈 풀이 관련 컴포넌트
import QuizHeader from '@/components/quiz/QuizHeader';
import QuestionCard, { Question, QuestionType } from '@/components/quiz/QuestionCard';
import OXChoice, { OXAnswer } from '@/components/quiz/OXChoice';
import MultipleChoice from '@/components/quiz/MultipleChoice';
import ShortAnswer from '@/components/quiz/ShortAnswer';
import QuizNavigation from '@/components/quiz/QuizNavigation';
import ExitConfirmModal from '@/components/quiz/ExitConfirmModal';

/**
 * 퀴즈 데이터 타입
 */
interface QuizData {
  id: string;
  title: string;
  questions: Question[];
}

/**
 * 답안 타입 (문제 유형별 다른 타입)
 * - OX: 'O' | 'X'
 * - 객관식 단일: number (선택된 인덱스)
 * - 객관식 복수: number[] (선택된 인덱스 배열)
 * - 주관식: string
 */
type Answer = OXAnswer | number | number[] | string | null;

/**
 * 퀴즈 풀이 페이지
 *
 * 퀴즈 문제를 순차적으로 풀고 제출하는 페이지입니다.
 * - 문제 유형에 따라 OX, 객관식, 주관식 선지를 표시
 * - 선택한 답을 로컬 상태로 유지
 * - 페이지 새로고침/이탈 방지
 * - 진행 상황 저장/불러오기 지원
 * - 제출 시 서버에서 채점 후 결과 페이지로 이동
 */
export default function QuizPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const colors = useThemeColors();
  const quizId = params.id as string;

  // 퀴즈 데이터 상태
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 퀴즈 풀이 상태
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 저장된 진행 상황 ID
  const [progressId, setProgressId] = useState<string | null>(null);

  // 모달 상태
  const [showExitModal, setShowExitModal] = useState(false);

  // 이전 진행상황 복원 모달
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [savedProgress, setSavedProgress] = useState<{
    id: string;
    answers: Record<string, Answer>;
    currentQuestionIndex: number;
    answeredCount: number;
  } | null>(null);

  // 현재 문제
  const currentQuestion = useMemo(
    () => quiz?.questions[currentQuestionIndex] || null,
    [quiz, currentQuestionIndex]
  );

  // 답변한 문제 수
  const answeredCount = useMemo(() => {
    return Object.values(answers).filter((answer) => {
      if (answer === null || answer === '') return false;
      if (Array.isArray(answer) && answer.length === 0) return false;
      return true;
    }).length;
  }, [answers]);

  /**
   * 저장된 진행 상황 불러오기
   */
  const loadSavedProgress = useCallback(async () => {
    if (!user || !quizId) return null;

    try {
      const progressQuery = query(
        collection(db, 'quizProgress'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId)
      );
      const snapshot = await getDocs(progressQuery);

      if (!snapshot.empty) {
        const progressDoc = snapshot.docs[0];
        const data = progressDoc.data();
        return {
          id: progressDoc.id,
          answers: data.answers || {},
          currentQuestionIndex: data.currentQuestionIndex || 0,
        };
      }
    } catch (err) {
      console.error('진행 상황 불러오기 실패:', err);
    }

    return null;
  }, [user, quizId]);

  /**
   * 퀴즈 데이터 로드
   */
  const fetchQuiz = useCallback(async () => {
    if (!quizId || !user) return;

    try {
      setIsLoading(true);
      setError(null);

      // 퀴즈 기본 정보 조회
      const quizRef = doc(db, 'quizzes', quizId);
      const quizDoc = await getDoc(quizRef);

      if (!quizDoc.exists()) {
        setError('퀴즈를 찾을 수 없습니다.');
        return;
      }

      const quizData = quizDoc.data();

      // 문제 목록 - 퀴즈 문서 내부의 questions 배열에서 가져옴
      const questionsData = quizData.questions || [];
      const questions: Question[] = [];
      let questionNumber = 0;

      console.log('[QuizPage] 원본 문제 데이터:', questionsData);

      questionsData.forEach((q: any, index: number) => {
        console.log(`[QuizPage] 문제 ${index + 1}:`, {
          type: q.type,
          combinedGroupId: q.combinedGroupId,
          combinedIndex: q.combinedIndex,
          combinedTotal: q.combinedTotal,
          hasSubQuestions: !!q.subQuestions,
          subQuestionsLength: q.subQuestions?.length,
          passageType: q.passageType,
          hasPassage: !!q.passage,
          hasPassageImage: !!q.passageImage,
        });

        // 새로운 구조: combinedGroupId가 있으면 이미 펼쳐진 결합형 문제
        if (q.combinedGroupId) {
          questionNumber++;

          // 복수정답 여부 확인
          const answerStr = q.answer?.toString() || '';
          const hasMultipleAnswers = q.type === 'multiple' && answerStr.includes(',');

          // 문제 유형 매핑
          let mappedType: QuestionType = q.type;
          if (q.type === 'subjective' || q.type === 'short_answer') {
            mappedType = 'short';
          }

          const questionData: Question = {
            id: q.id || `q_${index}`,
            number: questionNumber,
            type: mappedType,
            text: q.text || '',
            imageUrl: q.imageUrl || undefined,
            choices: q.choices || undefined,
            examples: q.examples || undefined,
            hasMultipleAnswers,
            // 결합형 그룹 정보 추가
            combinedGroupId: q.combinedGroupId,
            combinedIndex: q.combinedIndex,
            combinedTotal: q.combinedTotal,
          };

          // 첫 번째 하위 문제 (combinedIndex === 0)에만 공통 지문 정보 표시
          if (q.combinedIndex === 0) {
            questionData.passageType = q.passageType || 'text';
            questionData.passage = q.passage || undefined;
            questionData.passageImage = q.passageImage || undefined;
            questionData.koreanAbcItems = q.koreanAbcItems || undefined;

            console.log('[QuizPage] 결합형 공통 지문 정보:', {
              passageType: questionData.passageType,
              passage: questionData.passage?.substring(0, 50),
              hasPassageImage: !!questionData.passageImage,
              koreanAbcItems: questionData.koreanAbcItems,
              combinedGroupId: q.combinedGroupId,
            });
          }

          questions.push(questionData);
        }
        // 기존 구조: type === 'combined'이고 subQuestions가 있는 경우 (하위 호환)
        else if (q.type === 'combined') {
          const subQuestions = q.subQuestions || [];

          if (subQuestions.length > 0) {
            const legacyCombinedGroupId = `legacy_combined_${index}`;

            subQuestions.forEach((sq: any, sqIndex: number) => {
              questionNumber++;
              // 복수정답 여부 확인
              const hasMultipleAnswers = sq.type === 'multiple' &&
                (sq.answerIndices?.length > 1 || false);

              // 문제 유형 매핑
              let mappedType: QuestionType = sq.type;
              if (sq.type === 'subjective' || sq.type === 'short_answer') {
                mappedType = 'short';
              }

              const questionData: Question = {
                id: sq.id || `${q.id || `q_${index}`}_sq_${sqIndex}`,
                number: questionNumber,
                type: mappedType,
                text: sq.text || '',
                imageUrl: sq.imageUrl || undefined,
                choices: sq.choices || undefined,
                examples: sq.examples || undefined,
                hasMultipleAnswers,
                // 결합형 그룹 정보 추가 (하위 호환)
                combinedGroupId: legacyCombinedGroupId,
                combinedIndex: sqIndex,
                combinedTotal: subQuestions.length,
              };

              // 첫 번째 하위 문제에만 공통 지문 정보 표시
              if (sqIndex === 0) {
                questionData.passageType = q.passageType || 'text';
                questionData.passage = q.passage || undefined;
                questionData.passageImage = q.passageImage || undefined;
                questionData.koreanAbcItems = q.koreanAbcItems || undefined;

                console.log('[QuizPage] 결합형 공통 지문 정보 (레거시):', {
                  passageType: questionData.passageType,
                  passage: questionData.passage?.substring(0, 50),
                  hasPassageImage: !!questionData.passageImage,
                  koreanAbcItems: questionData.koreanAbcItems,
                });
              }

              questions.push(questionData);
            });
          } else {
            // 하위 문제가 없는 결합형 문제 (예외 처리)
            questionNumber++;
            questions.push({
              id: q.id || `q_${index}`,
              number: questionNumber,
              type: 'combined' as QuestionType,
              text: q.text || '(하위 문제가 없습니다)',
              passageType: q.passageType || 'text',
              passage: q.passage || undefined,
              passageImage: q.passageImage || undefined,
              koreanAbcItems: q.koreanAbcItems || undefined,
            });
          }
        } else {
          questionNumber++;
          // 복수정답 여부 확인 (answer가 쉼표를 포함하면 복수정답)
          const answerStr = q.answer?.toString() || '';
          const hasMultipleAnswers = q.type === 'multiple' && answerStr.includes(',');

          // 문제 유형 매핑 (subjective, short_answer -> short)
          let mappedType: QuestionType = q.type;
          if (q.type === 'subjective' || q.type === 'short_answer') {
            mappedType = 'short';
          }

          questions.push({
            id: q.id || `q_${index}`,
            number: questionNumber,
            type: mappedType,
            text: q.text || '',
            imageUrl: q.imageUrl || undefined,
            choices: q.choices || undefined,
            examples: q.examples || undefined,
            hasMultipleAnswers,
          });
        }
      });

      console.log('[QuizPage] 변환된 문제 목록:', questions.map(q => ({
        id: q.id,
        number: q.number,
        type: q.type,
        hasPassage: !!q.passage || !!q.passageImage,
      })));

      // 문제 번호순 정렬
      questions.sort((a, b) => a.number - b.number);

      // 문제가 없으면 에러
      if (questions.length === 0) {
        setError('퀴즈에 문제가 없습니다.');
        return;
      }

      setQuiz({
        id: quizId,
        title: quizData.title || '퀴즈',
        questions,
      });

      // 저장된 진행 상황 확인
      const loadedProgress = await loadSavedProgress();

      if (loadedProgress) {
        // 진행상황이 있으면 답변 개수 계산
        const answeredCount = Object.values(loadedProgress.answers).filter(
          (answer) => answer !== null && answer !== ''
        ).length;

        // 저장된 진행상황 정보 저장 및 모달 표시
        setSavedProgress({
          ...loadedProgress,
          answeredCount,
        });
        setShowResumeModal(true);

        // 초기 상태는 빈 상태로 설정 (모달에서 선택 후 적용)
        const initialAnswers: Record<string, Answer> = {};
        questions.forEach((q) => {
          initialAnswers[q.id] = null;
        });
        setAnswers(initialAnswers);
      } else {
        // 초기 답안 상태 설정
        const initialAnswers: Record<string, Answer> = {};
        questions.forEach((q) => {
          initialAnswers[q.id] = null;
        });
        setAnswers(initialAnswers);
      }
    } catch (err: any) {
      console.error('퀴즈 로드 실패:', err);
      console.error('에러 코드:', err.code);
      console.error('에러 메시지:', err.message);
      setError('퀴즈를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [quizId, user, loadSavedProgress]);

  // 퀴즈 데이터 로드
  useEffect(() => {
    fetchQuiz();
  }, [fetchQuiz]);

  // 페이지 이탈 방지
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (answeredCount > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [answeredCount]);

  /**
   * 답안 변경 핸들러
   */
  const handleAnswerChange = useCallback((questionId: string, answer: Answer) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: answer,
    }));
  }, []);

  /**
   * 이전 문제로 이동
   */
  const handlePrev = useCallback(() => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex((prev) => prev - 1);
    }
  }, [currentQuestionIndex]);

  /**
   * 다음 문제로 이동
   */
  const handleNext = useCallback(() => {
    if (quiz && currentQuestionIndex < quiz.questions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
    }
  }, [quiz, currentQuestionIndex]);

  /**
   * 진행 상황 저장
   */
  const saveProgress = useCallback(async () => {
    if (!user || !quizId) return;

    try {
      setIsSaving(true);

      const progressData = {
        userId: user.uid,
        quizId,
        answers,
        currentQuestionIndex,
        updatedAt: serverTimestamp(),
      };

      if (progressId) {
        // 기존 진행 상황 업데이트
        await setDoc(doc(db, 'quizProgress', progressId), progressData);
      } else {
        // 새 진행 상황 저장
        const docRef = await addDoc(collection(db, 'quizProgress'), {
          ...progressData,
          createdAt: serverTimestamp(),
        });
        setProgressId(docRef.id);
      }

      return true;
    } catch (err) {
      console.error('진행 상황 저장 실패:', err);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [user, quizId, answers, currentQuestionIndex, progressId]);

  /**
   * 진행 상황 삭제
   */
  const deleteProgress = useCallback(async () => {
    if (!progressId) return;

    try {
      await deleteDoc(doc(db, 'quizProgress', progressId));
      setProgressId(null);
    } catch (err) {
      console.error('진행 상황 삭제 실패:', err);
    }
  }, [progressId]);

  /**
   * 퀴즈 제출
   */
  const handleSubmit = useCallback(async () => {
    if (!quiz || !user || isSubmitting) return;

    try {
      setIsSubmitting(true);

      // 문제 순서대로 답안 배열 생성
      const orderedAnswers = quiz.questions.map((q) => {
        const answer = answers[q.id];
        // 답안 타입에 따라 적절한 형태로 변환
        if (answer === null || answer === undefined) return '';

        // 객관식 답안 처리: 0-indexed를 1-indexed로 변환 (correctAnswer 형식과 맞춤)
        if (q.type === 'multiple') {
          if (Array.isArray(answer)) {
            // 복수 선택: 0-indexed 배열을 1-indexed로 변환 후 쉼표로 연결
            return answer.map(i => i + 1).join(',');
          } else if (typeof answer === 'number') {
            // 단일 선택: 0-indexed를 1-indexed로 변환
            return (answer + 1).toString();
          }
        }

        return answer.toString();
      });

      // 답안을 localStorage에 저장 (결과 페이지에서 사용)
      localStorage.setItem(`quiz_answers_${quizId}`, JSON.stringify(orderedAnswers));
      localStorage.setItem(`quiz_time_${quizId}`, '0'); // 시간 측정은 나중에 구현

      // 저장된 진행 상황 삭제
      await deleteProgress();

      // 결과 페이지로 이동
      router.push(`/quiz/${quizId}/result`);
    } catch (err) {
      console.error('퀴즈 제출 실패:', err);
      alert('제출에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  }, [quiz, user, answers, isSubmitting, quizId, router, deleteProgress]);

  /**
   * 이전 진행상황 이어서 하기
   */
  const handleResume = useCallback(() => {
    if (savedProgress) {
      setProgressId(savedProgress.id);
      setAnswers(savedProgress.answers);
      setCurrentQuestionIndex(savedProgress.currentQuestionIndex);
    }
    setShowResumeModal(false);
    setSavedProgress(null);
  }, [savedProgress]);

  /**
   * 처음부터 다시 하기
   */
  const handleStartFresh = useCallback(async () => {
    // 기존 저장된 진행상황 삭제
    if (savedProgress) {
      try {
        await deleteDoc(doc(db, 'quizProgress', savedProgress.id));
      } catch (err) {
        console.error('진행상황 삭제 실패:', err);
      }
    }
    setShowResumeModal(false);
    setSavedProgress(null);
    setProgressId(null);
    setCurrentQuestionIndex(0);
  }, [savedProgress]);

  /**
   * 저장하고 나가기
   */
  const handleSaveAndExit = useCallback(async () => {
    const success = await saveProgress();
    if (success) {
      router.back();
    } else {
      alert('저장에 실패했습니다. 다시 시도해주세요.');
    }
  }, [saveProgress, router]);

  /**
   * 저장하지 않고 나가기 (기존 저장된 진행상황도 삭제)
   */
  const handleExitWithoutSave = useCallback(async () => {
    // 기존 저장된 진행상황 삭제
    await deleteProgress();
    router.back();
  }, [router, deleteProgress]);

  // 로딩 상태
  if (isLoading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#F5F0E8' }}>
        {/* 헤더 스켈레톤 */}
        <div className="sticky top-0 z-50 border-b-2 border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
          <div className="flex items-center justify-between h-14 px-4">
            <Skeleton className="w-10 h-10 rounded-none" />
            <Skeleton className="w-32 h-6 rounded-none" />
            <Skeleton className="w-12 h-6 rounded-none" />
          </div>
          <Skeleton className="h-1 w-full rounded-none" />
        </div>

        <div className="px-4 py-6 space-y-4">
          <Skeleton className="w-full h-40 rounded-none" />
          <Skeleton className="w-full h-16 rounded-none" />
          <Skeleton className="w-full h-16 rounded-none" />
          <Skeleton className="w-full h-16 rounded-none" />
          <Skeleton className="w-full h-16 rounded-none" />
        </div>
      </div>
    );
  }

  // 에러 상태
  if (error || !quiz) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 border-2 border-[#8B1A1A] bg-[#FDEAEA] flex items-center justify-center">
            <svg
              className="w-10 h-10 text-[#8B1A1A]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-[#1A1A1A] mb-2">
            {error || '퀴즈를 불러올 수 없습니다'}
          </h2>
          <p className="text-sm text-[#5C5C5C] mb-4">
            잠시 후 다시 시도해주세요.
          </p>
          <button
            onClick={() => router.back()}
            className="px-6 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
          >
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  // 현재 답안 가져오기
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : null;

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 퀴즈 헤더 */}
      <QuizHeader
        title={quiz.title}
        currentQuestion={currentQuestionIndex + 1}
        totalQuestions={quiz.questions.length}
        onBack={() => setShowExitModal(true)}
      />

      {/* 문제 영역 */}
      <main className="px-4 py-6">
        <AnimatePresence mode="wait">
          {currentQuestion && (
            <motion.div
              key={currentQuestion.id}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
            >
              {/* 문제 카드 */}
              <QuestionCard question={currentQuestion} />

              {/* 선지 영역 */}
              <div className="mt-4">
                {/* OX 선지 */}
                {currentQuestion.type === 'ox' && (
                  <OXChoice
                    selected={currentAnswer as OXAnswer}
                    onSelect={(answer) =>
                      handleAnswerChange(currentQuestion.id, answer)
                    }
                  />
                )}

                {/* 객관식 선지 */}
                {currentQuestion.type === 'multiple' &&
                  currentQuestion.choices && (
                    currentQuestion.hasMultipleAnswers ? (
                      // 복수정답: 다중 선택 모드
                      <MultipleChoice
                        choices={currentQuestion.choices}
                        multiSelect
                        selectedIndices={Array.isArray(currentAnswer) ? currentAnswer : []}
                        onMultiSelect={(indices) =>
                          handleAnswerChange(currentQuestion.id, indices)
                        }
                      />
                    ) : (
                      // 단일정답: 기존 단일 선택 모드
                      <MultipleChoice
                        choices={currentQuestion.choices}
                        selected={currentAnswer as number | null}
                        onSelect={(index) =>
                          handleAnswerChange(currentQuestion.id, index)
                        }
                      />
                    )
                  )}

                {/* 주관식/단답형 입력 */}
                {(currentQuestion.type === 'short' || currentQuestion.type === 'short_answer') && (
                  <ShortAnswer
                    value={(currentAnswer as string) || ''}
                    onChange={(value) =>
                      handleAnswerChange(currentQuestion.id, value)
                    }
                  />
                )}

                {/* 결합형 문제인데 선지가 없는 경우 (데이터 오류) - 주관식으로 대체 */}
                {currentQuestion.type === 'combined' && !currentQuestion.choices && (
                  <div className="space-y-4">
                    <div className="p-3 bg-[#FFF8E1] border border-[#8B6914] text-sm text-[#8B6914]">
                      ⚠️ 이 문제는 하위 문제가 설정되지 않았습니다. 텍스트로 답변해주세요.
                    </div>
                    <ShortAnswer
                      value={(currentAnswer as string) || ''}
                      onChange={(value) =>
                        handleAnswerChange(currentQuestion.id, value)
                      }
                    />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 네비게이션 */}
      <QuizNavigation
        currentQuestion={currentQuestionIndex + 1}
        totalQuestions={quiz.questions.length}
        onPrev={handlePrev}
        onNext={handleNext}
        onSubmit={handleSubmit}
        hasAnswered={
          currentAnswer !== null &&
          currentAnswer !== '' &&
          !(Array.isArray(currentAnswer) && currentAnswer.length === 0)
        }
        isSubmitting={isSubmitting}
      />

      {/* 나가기 확인 모달 */}
      <ExitConfirmModal
        isOpen={showExitModal}
        onClose={() => setShowExitModal(false)}
        onSaveAndExit={handleSaveAndExit}
        onExitWithoutSave={handleExitWithoutSave}
        answeredCount={answeredCount}
        totalQuestions={quiz.questions.length}
        isSaving={isSaving}
      />

      {/* 이전 진행상황 복원 모달 */}
      <AnimatePresence>
        {showResumeModal && savedProgress && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] p-5"
            >
              {/* 아이콘 */}
              <div className="flex justify-center mb-4">
                <div className="w-14 h-14 bg-[#FFF8E1] border-2 border-[#8B6914] flex items-center justify-center">
                  <svg className="w-7 h-7 text-[#8B6914]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>

              {/* 제목 */}
              <h2 className="text-lg font-bold text-[#1A1A1A] text-center mb-2">
                이전 진행상황이 있습니다
              </h2>

              {/* 설명 */}
              <p className="text-sm text-[#5C5C5C] text-center mb-4">
                이전에 풀던 문제가 저장되어 있습니다.
              </p>

              {/* 진행 상황 정보 */}
              <div className="bg-[#EDEAE4] border border-[#1A1A1A] p-3 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-[#5C5C5C]">답변한 문제</span>
                  <span className="font-bold text-[#1A1A1A]">
                    {savedProgress.answeredCount} / {quiz.questions.length}문제
                  </span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-[#5C5C5C]">마지막 위치</span>
                  <span className="font-bold text-[#1A1A1A]">
                    {savedProgress.currentQuestionIndex + 1}번 문제
                  </span>
                </div>
              </div>

              {/* 버튼들 */}
              <div className="space-y-2">
                <button
                  onClick={handleResume}
                  className="w-full py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
                >
                  이어서 풀기
                </button>
                <button
                  onClick={handleStartFresh}
                  className="w-full py-3 text-sm font-bold bg-[#F5F0E8] text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                >
                  처음부터 다시 풀기
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
