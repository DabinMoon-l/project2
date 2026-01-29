'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Header, Button } from '@/components/common';
import { QuizEditorForm, PublishToggle } from '@/components/professor';
import QuestionEditor, { type QuestionData } from '@/components/quiz/create/QuestionEditor';
import QuestionList from '@/components/quiz/create/QuestionList';
import { useAuth } from '@/lib/hooks/useAuth';
import { useProfessorQuiz, type QuizInput, type TargetClass, type Difficulty } from '@/lib/hooks/useProfessorQuiz';
import type { QuizMetaData } from '@/components/professor/QuizEditorForm';

// ============================================================
// 타입 정의
// ============================================================

type Step = 'meta' | 'questions';

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 퀴즈 출제 페이지
 *
 * 2단계로 구성:
 * 1. 퀴즈 정보 입력 (제목, 설명, 대상 반, 난이도)
 * 2. 문제 편집 (추가, 수정, 삭제, 순서 변경)
 */
export default function CreateQuizPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { createQuiz, error, clearError } = useProfessorQuiz();

  // 단계 상태
  const [step, setStep] = useState<Step>('meta');

  // 퀴즈 메타 정보
  const [quizMeta, setQuizMeta] = useState<QuizMetaData>({
    title: '',
    description: '',
    targetClass: 'all',
    difficulty: 'normal',
  });

  // 문제 목록
  const [questions, setQuestions] = useState<QuestionData[]>([]);

  // 편집 중인 문제 인덱스 (-1: 새 문제 추가 모드)
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // 저장 상태
  const [saving, setSaving] = useState(false);

  // 유효성 검사 에러
  const [errors, setErrors] = useState<{ title?: string }>({});

  /**
   * 메타 정보 유효성 검사
   */
  const validateMeta = (): boolean => {
    const newErrors: { title?: string } = {};

    if (!quizMeta.title.trim()) {
      newErrors.title = '퀴즈 제목을 입력해주세요.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /**
   * 다음 단계로 이동
   */
  const handleNextStep = useCallback(() => {
    if (validateMeta()) {
      setStep('questions');
    }
  }, [quizMeta]);

  /**
   * 이전 단계로 이동
   */
  const handlePrevStep = useCallback(() => {
    setStep('meta');
  }, []);

  /**
   * 문제 추가 시작
   */
  const handleAddQuestion = useCallback(() => {
    setEditingIndex(-1);
  }, []);

  /**
   * 문제 편집 시작
   */
  const handleEditQuestion = useCallback((index: number) => {
    setEditingIndex(index);
  }, []);

  /**
   * 문제 저장
   */
  const handleSaveQuestion = useCallback(
    (question: QuestionData) => {
      if (editingIndex === -1) {
        // 새 문제 추가
        setQuestions((prev) => [...prev, question]);
      } else if (editingIndex !== null) {
        // 기존 문제 수정
        setQuestions((prev) =>
          prev.map((q, i) => (i === editingIndex ? question : q))
        );
      }
      setEditingIndex(null);
    },
    [editingIndex]
  );

  /**
   * 문제 편집 취소
   */
  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
  }, []);

  /**
   * QuestionData를 QuizQuestion 형식으로 변환
   */
  const convertToQuizQuestion = (q: QuestionData) => ({
    id: q.id,
    text: q.text,
    type: q.type,
    choices: q.type === 'multiple' ? q.choices : undefined,
    answer: q.type === 'subjective' ? q.answerText : q.answerIndex,
    explanation: q.explanation || undefined,
  });

  /**
   * 퀴즈 저장
   */
  const handleSave = useCallback(
    async (isPublished: boolean) => {
      if (!user?.uid) {
        alert('로그인이 필요합니다.');
        return;
      }

      if (questions.length < 1) {
        alert('최소 1개 이상의 문제를 추가해주세요.');
        return;
      }

      try {
        setSaving(true);
        clearError();

        const quizInput: QuizInput = {
          title: quizMeta.title,
          description: quizMeta.description || undefined,
          targetClass: quizMeta.targetClass,
          difficulty: quizMeta.difficulty,
          isPublished,
          questions: questions.map(convertToQuizQuestion),
        };

        const quizId = await createQuiz(
          user.uid,
          user.displayName || '교수님',
          quizInput
        );

        // 성공 시 목록으로 이동
        router.push('/professor/quiz');
      } catch (err) {
        console.error('퀴즈 저장 실패:', err);
      } finally {
        setSaving(false);
      }
    },
    [user, quizMeta, questions, createQuiz, clearError, router]
  );

  /**
   * 뒤로가기 확인
   */
  const handleBack = useCallback(() => {
    if (questions.length > 0 || quizMeta.title.trim()) {
      if (confirm('작성 중인 내용이 있습니다. 정말 나가시겠습니까?')) {
        router.back();
      }
    } else {
      router.back();
    }
  }, [questions, quizMeta, router]);

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* 헤더 */}
      <Header
        title={step === 'meta' ? '퀴즈 출제' : '문제 편집'}
        showBack
        onBack={step === 'questions' ? handlePrevStep : handleBack}
      />

      {/* 진행 표시 */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          {/* Step 1 */}
          <div className="flex items-center gap-2 flex-1">
            <div
              className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                ${step === 'meta' ? 'bg-indigo-500 text-white' : 'bg-indigo-100 text-indigo-600'}
              `}
            >
              1
            </div>
            <span
              className={`text-sm ${step === 'meta' ? 'text-gray-800 font-medium' : 'text-gray-500'}`}
            >
              퀴즈 정보
            </span>
          </div>

          {/* 연결선 */}
          <div className="w-8 h-0.5 bg-gray-200" />

          {/* Step 2 */}
          <div className="flex items-center gap-2 flex-1">
            <div
              className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                ${step === 'questions' ? 'bg-indigo-500 text-white' : 'bg-gray-200 text-gray-500'}
              `}
            >
              2
            </div>
            <span
              className={`text-sm ${step === 'questions' ? 'text-gray-800 font-medium' : 'text-gray-500'}`}
            >
              문제 편집
            </span>
          </div>
        </div>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-4 mb-4 p-3 bg-red-50 border border-red-200 rounded-xl"
        >
          <p className="text-sm text-red-600">{error}</p>
        </motion.div>
      )}

      {/* 메인 컨텐츠 */}
      <main className="px-4">
        <AnimatePresence mode="wait">
          {step === 'meta' ? (
            // Step 1: 퀴즈 정보 입력
            <motion.div
              key="meta"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="bg-white rounded-2xl p-5 shadow-sm"
            >
              <QuizEditorForm
                data={quizMeta}
                onChange={setQuizMeta}
                errors={errors}
              />

              <div className="mt-6">
                <Button fullWidth onClick={handleNextStep}>
                  다음: 문제 편집
                </Button>
              </div>
            </motion.div>
          ) : (
            // Step 2: 문제 편집
            <motion.div
              key="questions"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              {/* 퀴즈 정보 요약 */}
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-gray-800">{quizMeta.title}</h3>
                    <p className="text-sm text-gray-500">
                      {quizMeta.targetClass === 'all' ? '전체' : `${quizMeta.targetClass}반`}
                      {' • '}
                      {quizMeta.difficulty === 'easy'
                        ? '쉬움'
                        : quizMeta.difficulty === 'normal'
                          ? '보통'
                          : '어려움'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePrevStep}
                    className="text-sm text-indigo-600 hover:text-indigo-700"
                  >
                    수정
                  </button>
                </div>
              </div>

              {/* 문제 추가 버튼 */}
              {editingIndex === null && (
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={handleAddQuestion}
                  className="
                    w-full p-4 rounded-2xl border-2 border-dashed border-gray-300
                    text-gray-500 hover:border-indigo-400 hover:text-indigo-500
                    transition-colors flex items-center justify-center gap-2
                  "
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                  새 문제 추가
                </motion.button>
              )}

              {/* 문제 편집기 */}
              <AnimatePresence>
                {editingIndex !== null && (
                  <QuestionEditor
                    initialQuestion={
                      editingIndex >= 0 ? questions[editingIndex] : undefined
                    }
                    questionNumber={
                      editingIndex >= 0 ? editingIndex + 1 : questions.length + 1
                    }
                    onSave={handleSaveQuestion}
                    onCancel={handleCancelEdit}
                  />
                )}
              </AnimatePresence>

              {/* 문제 목록 */}
              {editingIndex === null && (
                <QuestionList
                  questions={questions}
                  onQuestionsChange={setQuestions}
                  onEditQuestion={handleEditQuestion}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 하단 저장 버튼 (문제 편집 단계에서만) */}
      {step === 'questions' && editingIndex === null && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100 safe-area-bottom">
          <div className="flex gap-3">
            <Button
              variant="secondary"
              fullWidth
              onClick={() => handleSave(false)}
              loading={saving}
              disabled={questions.length === 0}
            >
              비공개 저장
            </Button>
            <Button
              fullWidth
              onClick={() => handleSave(true)}
              loading={saving}
              disabled={questions.length === 0}
            >
              공개 저장
            </Button>
          </div>
          {questions.length === 0 && (
            <p className="text-xs text-center text-gray-500 mt-2">
              최소 1개 이상의 문제를 추가해주세요
            </p>
          )}
        </div>
      )}
    </div>
  );
}
