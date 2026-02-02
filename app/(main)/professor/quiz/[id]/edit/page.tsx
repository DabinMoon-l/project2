'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Timestamp } from 'firebase/firestore';
import { Header, Button, Skeleton } from '@/components/common';
import { QuizEditorForm, PublishToggle } from '@/components/professor';
import QuestionEditor, { type QuestionData } from '@/components/quiz/create/QuestionEditor';
import QuestionList from '@/components/quiz/create/QuestionList';
import { useProfessorQuiz, type ProfessorQuiz, type QuizInput, type QuizQuestion } from '@/lib/hooks/useProfessorQuiz';
import type { QuizMetaData } from '@/components/professor/QuizEditorForm';

// ============================================================
// 타입 정의
// ============================================================

type Step = 'meta' | 'questions';

// ============================================================
// 유틸리티
// ============================================================

/**
 * ProfessorQuiz의 question을 QuestionData로 변환
 * DB는 1-indexed, 내부는 0-indexed
 */
const convertToQuestionData = (
  question: ProfessorQuiz['questions'][0]
): QuestionData => {
  // 객관식: DB의 1-indexed를 0-indexed로 변환
  let answerIndex = -1;
  if (question.type === 'multiple' && typeof question.answer === 'number' && question.answer > 0) {
    answerIndex = question.answer - 1; // 1-indexed -> 0-indexed
  } else if (question.type === 'ox' && typeof question.answer === 'number') {
    answerIndex = question.answer; // OX는 0=O, 1=X로 그대로
  }

  return {
    id: question.id,
    text: question.text,
    type: question.type,
    choices: question.choices || ['', '', '', ''],
    answerIndex,
    answerText: typeof question.answer === 'string' ? question.answer : '',
    explanation: question.explanation || '',
  };
};

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 퀴즈 수정 페이지
 *
 * 기존 퀴즈의 메타정보와 문제를 수정할 수 있습니다.
 * 생성 페이지와 동일한 2단계 UI를 사용합니다.
 */
export default function EditQuizPage() {
  const router = useRouter();
  const params = useParams();
  const quizId = params.id as string;

  const { fetchQuiz, updateQuiz, error, clearError } = useProfessorQuiz();

  // 로딩 상태
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 단계 상태
  const [step, setStep] = useState<Step>('meta');

  // 퀴즈 메타 정보
  const [quizMeta, setQuizMeta] = useState<QuizMetaData>({
    title: '',
    description: '',
    targetClass: 'all',
    difficulty: 'normal',
  });

  // 공개 상태
  const [isPublished, setIsPublished] = useState(false);

  // 문제 목록
  const [questions, setQuestions] = useState<QuestionData[]>([]);

  // 원본 문제 목록 (수정 감지용)
  const [originalQuestions, setOriginalQuestions] = useState<QuizQuestion[]>([]);

  // 편집 중인 문제 인덱스 (-1: 새 문제 추가 모드)
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // 저장 상태
  const [saving, setSaving] = useState(false);

  // 유효성 검사 에러
  const [errors, setErrors] = useState<{ title?: string }>({});

  // 데이터 로드
  useEffect(() => {
    const loadQuiz = async () => {
      try {
        setLoading(true);
        const data = await fetchQuiz(quizId);
        if (data) {
          setQuizMeta({
            title: data.title,
            description: data.description || '',
            targetClass: data.targetClass,
            difficulty: data.difficulty,
          });
          setIsPublished(data.isPublished);
          setQuestions(data.questions.map(convertToQuestionData));
          // 원본 문제 저장 (수정 감지용)
          setOriginalQuestions(data.questions as QuizQuestion[]);
        } else {
          setLoadError('퀴즈를 찾을 수 없습니다.');
        }
      } catch (err) {
        setLoadError('퀴즈를 불러오는데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    };

    if (quizId) {
      loadQuiz();
    }
  }, [quizId, fetchQuiz]);

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
        setQuestions((prev) => [...prev, question]);
      } else if (editingIndex !== null) {
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
   * 문제 내용이 변경되었는지 확인
   */
  const isQuestionChanged = (original: QuizQuestion | undefined, current: QuestionData): boolean => {
    if (!original) return true; // 새 문제

    // 텍스트 비교
    if (original.text !== current.text) return true;

    // 타입 비교
    if (original.type !== current.type) return true;

    // 정답 비교
    if (current.type === 'subjective' || current.type === 'short_answer') {
      if (original.answer !== current.answerText) return true;
    } else if (current.type === 'multiple') {
      const origAnswer = typeof original.answer === 'number' ? original.answer - 1 : -1;
      if (origAnswer !== current.answerIndex) return true;
    } else {
      if (original.answer !== current.answerIndex) return true;
    }

    // 선지 비교 (객관식)
    if (current.type === 'multiple') {
      const origChoices = original.choices || [];
      const currChoices = current.choices?.filter((c) => c.trim()) || [];
      if (origChoices.length !== currChoices.length) return true;
      for (let i = 0; i < currChoices.length; i++) {
        if (origChoices[i] !== currChoices[i]) return true;
      }
    }

    // 해설 비교
    if ((original.explanation || '') !== (current.explanation || '')) return true;

    return false;
  };

  /**
   * QuestionData를 QuizQuestion 형식으로 변환
   * 내부 0-indexed를 DB 1-indexed로 변환
   */
  const convertToQuizQuestion = (q: QuestionData) => {
    // 정답 처리 (내부 0-indexed -> DB 1-indexed)
    let answer: string | number;
    if (q.type === 'subjective' || q.type === 'short_answer') {
      answer = q.answerText;
    } else if (q.type === 'multiple') {
      // 객관식: 0-indexed -> 1-indexed
      answer = q.answerIndex >= 0 ? q.answerIndex + 1 : -1;
    } else {
      // OX: 0=O, 1=X 그대로
      answer = q.answerIndex;
    }

    // 기존 문제 찾기
    const originalQ = originalQuestions.find((oq) => oq.id === q.id);
    const hasChanged = isQuestionChanged(originalQ, q);

    return {
      id: q.id,
      text: q.text,
      type: q.type,
      choices: q.type === 'multiple' ? q.choices : undefined,
      answer,
      explanation: q.explanation || undefined,
      // 문제별 수정 시간: 변경된 경우에만 업데이트, 그렇지 않으면 기존 값 유지
      questionUpdatedAt: hasChanged ? Timestamp.now() : ((originalQ as any)?.questionUpdatedAt || null),
    };
  };

  /**
   * 퀴즈 저장
   */
  const handleSave = useCallback(async () => {
    if (questions.length < 1) {
      alert('최소 1개 이상의 문제를 추가해주세요.');
      return;
    }

    try {
      setSaving(true);
      clearError();

      const quizInput: Partial<QuizInput> = {
        title: quizMeta.title,
        description: quizMeta.description || undefined,
        targetClass: quizMeta.targetClass,
        difficulty: quizMeta.difficulty,
        isPublished,
        questions: questions.map(convertToQuizQuestion),
      };

      await updateQuiz(quizId, quizInput);

      // 성공 시 상세 페이지로 이동
      router.push(`/professor/quiz/${quizId}`);
    } catch (err) {
      console.error('퀴즈 저장 실패:', err);
    } finally {
      setSaving(false);
    }
  }, [quizMeta, questions, isPublished, quizId, updateQuiz, clearError, router]);

  /**
   * 뒤로가기 확인
   */
  const handleBack = useCallback(() => {
    if (confirm('수정 중인 내용이 저장되지 않습니다. 정말 나가시겠습니까?')) {
      router.back();
    }
  }, [router]);

  // 로딩 상태
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="퀴즈 수정" showBack />
        <div className="p-4 space-y-4">
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      </div>
    );
  }

  // 에러 상태
  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="퀴즈 수정" showBack />
        <div className="flex flex-col items-center justify-center h-[60vh] px-4">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">{loadError}</h2>
          <Button onClick={() => router.back()}>돌아가기</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* 헤더 */}
      <Header
        title={step === 'meta' ? '퀴즈 수정' : '문제 편집'}
        showBack
        onBack={step === 'questions' ? handlePrevStep : handleBack}
      />

      {/* 진행 표시 */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
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
          <div className="w-8 h-0.5 bg-gray-200" />
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

              {/* 공개 상태 */}
              <div className="mt-6 pt-6 border-t border-gray-100">
                <PublishToggle
                  isPublished={isPublished}
                  onChange={setIsPublished}
                />
              </div>

              <div className="mt-6">
                <Button fullWidth onClick={handleNextStep}>
                  다음: 문제 편집
                </Button>
              </div>
            </motion.div>
          ) : (
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
                      {' • '}
                      {isPublished ? '공개' : '비공개'}
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
                  userRole="professor"
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 하단 저장 버튼 */}
      {step === 'questions' && editingIndex === null && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100 safe-area-bottom">
          <Button
            fullWidth
            onClick={handleSave}
            loading={saving}
            disabled={questions.length === 0}
          >
            변경사항 저장
          </Button>
          {questions.length === 0 && (
            <p className="text-xs text-center text-gray-500 mt-2">
              최소 1개 이상의 문제가 필요합니다
            </p>
          )}
        </div>
      )}
    </div>
  );
}
