'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Header, Button, Skeleton } from '@/components/common';
import { PublishToggle, QuizDeleteModal } from '@/components/professor';
import { useProfessorQuiz, type ProfessorQuiz } from '@/lib/hooks/useProfessorQuiz';

// ============================================================
// 타입 정의
// ============================================================

/** 반별 색상 */
const CLASS_COLORS: Record<string, string> = {
  A: 'bg-red-100 text-red-700',
  B: 'bg-amber-100 text-amber-700',
  C: 'bg-emerald-100 text-emerald-700',
  D: 'bg-blue-100 text-blue-700',
  all: 'bg-purple-100 text-purple-700',
};

/** 난이도 설정 */
const DIFFICULTY_CONFIG: Record<string, { label: string; color: string }> = {
  easy: { label: '쉬움', color: 'bg-green-100 text-green-700' },
  normal: { label: '보통', color: 'bg-yellow-100 text-yellow-700' },
  hard: { label: '어려움', color: 'bg-red-100 text-red-700' },
};

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 퀴즈 상세/미리보기 페이지
 *
 * 퀴즈의 상세 정보와 문제 목록을 미리볼 수 있습니다.
 * 통계 정보, 공개 상태 토글, 수정/삭제 기능을 제공합니다.
 */
export default function QuizDetailPage() {
  const router = useRouter();
  const params = useParams();
  const quizId = params.id as string;

  const { fetchQuiz, togglePublish, deleteQuiz } = useProfessorQuiz();

  const [quiz, setQuiz] = useState<ProfessorQuiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 삭제 모달 상태
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // 데이터 로드
  useEffect(() => {
    const loadQuiz = async () => {
      try {
        setLoading(true);
        const data = await fetchQuiz(quizId);
        if (data) {
          setQuiz(data);
        } else {
          setError('퀴즈를 찾을 수 없습니다.');
        }
      } catch (err) {
        setError('퀴즈를 불러오는데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    };

    if (quizId) {
      loadQuiz();
    }
  }, [quizId, fetchQuiz]);

  // 공개 상태 토글
  const handleTogglePublish = useCallback(
    async (isPublished: boolean) => {
      if (!quiz) return;

      try {
        await togglePublish(quiz.id, isPublished);
        setQuiz((prev) => (prev ? { ...prev, isPublished } : null));
      } catch (err) {
        console.error('공개 상태 변경 실패:', err);
      }
    },
    [quiz, togglePublish]
  );

  // 수정 페이지로 이동
  const handleEdit = useCallback(() => {
    router.push(`/professor/quiz/${quizId}/edit`);
  }, [router, quizId]);

  // 삭제 확인
  const handleDeleteConfirm = useCallback(async () => {
    if (!quiz) return;

    try {
      setDeleteLoading(true);
      await deleteQuiz(quiz.id);
      router.replace('/professor/quiz');
    } catch (err) {
      console.error('퀴즈 삭제 실패:', err);
    } finally {
      setDeleteLoading(false);
    }
  }, [quiz, deleteQuiz, router]);

  // 로딩 상태
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="퀴즈 상세" showBack />
        <div className="p-4 space-y-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </div>
    );
  }

  // 에러 상태
  if (error || !quiz) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="퀴즈 상세" showBack />
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
          <h2 className="text-lg font-bold text-gray-800 mb-2">
            {error || '퀴즈를 찾을 수 없습니다'}
          </h2>
          <Button onClick={() => router.back()}>돌아가기</Button>
        </div>
      </div>
    );
  }

  const classColor = CLASS_COLORS[quiz.targetClass] || CLASS_COLORS.all;
  const difficultyConfig = DIFFICULTY_CONFIG[quiz.difficulty] || DIFFICULTY_CONFIG.normal;

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* 헤더 */}
      <Header
        title="퀴즈 상세"
        showBack
        rightAction={
          <button
            type="button"
            onClick={handleEdit}
            className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
        }
      />

      <main className="p-4 space-y-4">
        {/* 퀴즈 정보 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-5 shadow-sm"
        >
          <h1 className="text-xl font-bold text-gray-800 mb-2">{quiz.title}</h1>
          {quiz.description && (
            <p className="text-gray-600 text-sm mb-4">{quiz.description}</p>
          )}

          {/* 뱃지 */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${classColor}`}>
              {quiz.targetClass === 'all' ? '전체' : `${quiz.targetClass}반`}
            </span>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              {quiz.questionCount}문제
            </span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${difficultyConfig.color}`}>
              {difficultyConfig.label}
            </span>
          </div>

          {/* 공개 상태 토글 */}
          <PublishToggle
            isPublished={quiz.isPublished}
            onChange={handleTogglePublish}
            participantCount={quiz.participantCount}
          />
        </motion.div>

        {/* 통계 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-5 shadow-sm"
        >
          <h2 className="text-lg font-bold text-gray-800 mb-4">통계</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-indigo-600">{quiz.participantCount}</p>
              <p className="text-xs text-gray-500">참여자</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">
                {quiz.participantCount > 0 ? Math.round(quiz.averageScore) : '-'}
              </p>
              <p className="text-xs text-gray-500">평균 점수</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600">{quiz.feedbackCount}</p>
              <p className="text-xs text-gray-500">피드백</p>
            </div>
          </div>
        </motion.div>

        {/* 문제 미리보기 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl p-5 shadow-sm"
        >
          <h2 className="text-lg font-bold text-gray-800 mb-4">
            문제 미리보기
            <span className="ml-2 text-sm font-normal text-gray-500">
              ({quiz.questions.length}개)
            </span>
          </h2>

          <div className="space-y-3">
            {quiz.questions.map((question, index) => (
              <div
                key={question.id}
                className="p-4 bg-gray-50 rounded-xl"
              >
                {/* 문제 헤더 */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-bold">
                    {index + 1}
                  </span>
                  <span
                    className={`
                      px-2 py-0.5 rounded-full text-xs font-medium
                      ${
                        question.type === 'ox'
                          ? 'bg-blue-100 text-blue-700'
                          : question.type === 'multiple'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-green-100 text-green-700'
                      }
                    `}
                  >
                    {question.type === 'ox'
                      ? 'OX'
                      : question.type === 'multiple'
                        ? '객관식'
                        : '주관식'}
                  </span>
                </div>

                {/* 문제 텍스트 */}
                <p className="text-gray-800 text-sm">{question.text}</p>

                {/* 선지 (객관식) */}
                {question.type === 'multiple' && question.choices && (
                  <div className="mt-2 space-y-1">
                    {question.choices.map((choice, i) => (
                      <div
                        key={i}
                        className={`
                          text-xs px-2 py-1 rounded
                          ${
                            question.answer === i
                              ? 'bg-green-100 text-green-700 font-medium'
                              : 'text-gray-600'
                          }
                        `}
                      >
                        {i + 1}. {choice}
                        {question.answer === i && ' ✓'}
                      </div>
                    ))}
                  </div>
                )}

                {/* 정답 (OX) */}
                {question.type === 'ox' && (
                  <p className="mt-2 text-xs text-green-600 font-medium">
                    정답: {question.answer === 0 ? 'O' : 'X'}
                  </p>
                )}

                {/* 정답 (주관식) */}
                {question.type === 'subjective' && (
                  <p className="mt-2 text-xs text-green-600 font-medium">
                    정답: {String(question.answer)}
                  </p>
                )}

                {/* 해설 */}
                {question.explanation && (
                  <p className="mt-2 text-xs text-gray-500 bg-white p-2 rounded">
                    💡 {question.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </motion.div>

        {/* 삭제 버튼 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="w-full py-3 text-red-500 text-sm font-medium hover:bg-red-50 rounded-xl transition-colors"
          >
            퀴즈 삭제
          </button>
        </motion.div>
      </main>

      {/* 삭제 확인 모달 */}
      <QuizDeleteModal
        quiz={showDeleteModal ? quiz : null}
        loading={deleteLoading}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  );
}
