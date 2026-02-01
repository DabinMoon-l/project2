'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Header, Button } from '@/components/common';
import { QuizEditorForm, PublishToggle, CourseSelector } from '@/components/professor';
import QuestionEditor, { type QuestionData } from '@/components/quiz/create/QuestionEditor';
import QuestionList from '@/components/quiz/create/QuestionList';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts';
import { useProfessorQuiz, type QuizInput, type TargetClass, type Difficulty } from '@/lib/hooks/useProfessorQuiz';
import type { QuizMetaData } from '@/components/professor/QuizEditorForm';
import type { CourseId } from '@/lib/types/course';

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
  const { semesterSettings } = useCourse();
  const { createQuiz, error, clearError } = useProfessorQuiz();

  // 단계 상태
  const [step, setStep] = useState<Step>('meta');

  // 선택된 과목
  const [selectedCourseId, setSelectedCourseId] = useState<CourseId | null>(null);

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
   * QuestionData 배열을 펼쳐서 QuizQuestion 형식으로 변환
   * 결합형 문제의 하위 문제들을 개별 문제로 펼침
   */
  const convertToQuizQuestions = (questionList: QuestionData[]) => {
    const flattenedQuestions: any[] = [];
    let orderIndex = 0;

    questionList.forEach((q) => {
      // 결합형 문제: 하위 문제를 개별 문제로 펼침
      if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
        const combinedGroupId = `combined_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const subQuestionsCount = q.subQuestions.length;

        q.subQuestions.forEach((sq, sqIndex) => {
          // 하위 문제 정답 처리
          let subAnswer: string | number;
          if (sq.type === 'short_answer') {
            const answerTexts = (sq.answerTexts || [sq.answerText || '']).filter(t => t.trim());
            subAnswer = answerTexts.length > 1 ? answerTexts.join('|||') : answerTexts[0] || '';
          } else if (sq.type === 'multiple') {
            // 객관식: 1-indexed로 변환
            if (sq.answerIndices && sq.answerIndices.length > 1) {
              // 복수정답
              subAnswer = sq.answerIndices.map(i => i + 1).join(',');
            } else if (sq.answerIndices && sq.answerIndices.length === 1) {
              // 단일정답 (answerIndices에서)
              subAnswer = sq.answerIndices[0] + 1;
            } else if (sq.answerIndex !== undefined && sq.answerIndex >= 0) {
              // 단일정답 (answerIndex에서)
              subAnswer = sq.answerIndex + 1;
            } else {
              subAnswer = -1;
            }
          } else {
            // OX: 0 = O, 1 = X (그대로 저장)
            subAnswer = sq.answerIndex ?? -1;
          }

          const subQuestionData: any = {
            order: orderIndex++,
            text: sq.text,
            type: sq.type,
            choices: sq.type === 'multiple' ? sq.choices?.filter((c) => c.trim()) : undefined,
            answer: subAnswer,
            explanation: sq.explanation || undefined,
            imageUrl: sq.image || undefined,
            examples: sq.examples ? {
              type: sq.examplesType || 'text',
              items: sq.examples.filter((item) => item.trim()),
            } : sq.koreanAbcExamples ? {
              type: 'labeled',
              items: sq.koreanAbcExamples.map(item => item.text).filter(t => t.trim()),
            } : undefined,
            // 결합형 그룹 정보
            combinedGroupId,
            combinedIndex: sqIndex,
            combinedTotal: subQuestionsCount,
          };

          // 첫 번째 하위 문제에만 공통 지문 정보 포함
          if (sqIndex === 0) {
            subQuestionData.passageType = q.passageType || 'text';
            subQuestionData.passage = q.passageType === 'text' ? (q.passage || q.text || '') : '';
            subQuestionData.passageImage = q.passageImage || undefined;
            subQuestionData.koreanAbcItems = q.passageType === 'korean_abc'
              ? (q.koreanAbcItems || []).filter((item) => item.text?.trim()).map(item => item.text)
              : undefined;
            subQuestionData.combinedMainText = q.text || '';
          }

          flattenedQuestions.push(subQuestionData);
        });
      } else {
        // 일반 문제 처리
        let answer: string | number;
        if (q.type === 'subjective' || q.type === 'short_answer') {
          const answerTexts = (q.answerTexts || [q.answerText]).filter(t => t.trim());
          answer = answerTexts.length > 1 ? answerTexts.join('|||') : answerTexts[0] || '';
        } else if (q.type === 'multiple') {
          // 객관식: 1-indexed로 변환
          if (q.answerIndices && q.answerIndices.length > 1) {
            // 복수정답
            answer = q.answerIndices.map(i => i + 1).join(',');
          } else if (q.answerIndices && q.answerIndices.length === 1) {
            // 단일정답 (answerIndices에서)
            answer = q.answerIndices[0] + 1;
          } else if (q.answerIndex !== undefined && q.answerIndex >= 0) {
            // 단일정답 (answerIndex에서)
            answer = q.answerIndex + 1;
          } else {
            answer = -1;
          }
        } else {
          // OX: 0 = O, 1 = X (그대로 저장)
          answer = q.answerIndex;
        }

        flattenedQuestions.push({
          order: orderIndex++,
          id: q.id,
          text: q.text,
          type: q.type === 'subjective' ? 'short_answer' : q.type,
          choices: q.type === 'multiple' ? q.choices.filter((c) => c.trim()) : undefined,
          answer,
          explanation: q.explanation || undefined,
          imageUrl: q.imageUrl || undefined,
          examples: q.examples ? {
            type: q.examples.type,
            items: q.examples.items.filter((item) => item.trim()),
          } : undefined,
        });
      }
    });

    return flattenedQuestions;
  };

  /**
   * 실제 문제 수 계산 (결합형 하위 문제 포함)
   */
  const calculateQuestionCount = (questionList: QuestionData[]) => {
    return questionList.reduce((total, q) => {
      if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
        return total + q.subQuestions.length;
      }
      return total + 1;
    }, 0);
  };

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

        const flattenedQuestions = convertToQuizQuestions(questions);
        const quizInput: QuizInput = {
          title: quizMeta.title,
          description: quizMeta.description || undefined,
          targetClass: quizMeta.targetClass,
          difficulty: quizMeta.difficulty,
          isPublished,
          questions: flattenedQuestions,
          questionCount: calculateQuestionCount(questions),
          courseId: selectedCourseId,
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
    [user, quizMeta, questions, selectedCourseId, createQuiz, clearError, router]
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
              className="space-y-4"
            >
              {/* 과목 선택 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  과목 선택
                </label>
                <CourseSelector
                  selectedCourseId={selectedCourseId}
                  onCourseChange={setSelectedCourseId}
                  showAllOption={false}
                />
                {!selectedCourseId && (
                  <p className="text-xs text-amber-600 mt-2">
                    * 과목을 선택해주세요
                  </p>
                )}
              </div>

              {/* 퀴즈 정보 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <QuizEditorForm
                  data={quizMeta}
                  onChange={setQuizMeta}
                  errors={errors}
                />
              </div>

              <div className="mt-6">
                <Button
                  fullWidth
                  onClick={handleNextStep}
                  disabled={!selectedCourseId}
                >
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
                    userRole="professor"
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
