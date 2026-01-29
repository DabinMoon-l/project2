'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Header, Button } from '@/components/common';
import { QuizList, QuizDeleteModal } from '@/components/professor';
import { useAuth } from '@/lib/hooks/useAuth';
import { useProfessorQuiz, type ProfessorQuiz, type QuizFilterOptions } from '@/lib/hooks/useProfessorQuiz';

/**
 * 교수님 퀴즈 관리 페이지
 *
 * 교수님이 출제한 퀴즈 목록을 관리합니다.
 * 퀴즈 생성, 수정, 삭제, 공개/비공개 토글 기능을 제공합니다.
 */
export default function ProfessorQuizListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const {
    quizzes,
    loading,
    loadingMore,
    hasMore,
    error,
    fetchQuizzes,
    fetchMore,
    deleteQuiz,
    togglePublish,
    clearError,
  } = useProfessorQuiz();

  // 필터 상태
  const [filter, setFilter] = useState<QuizFilterOptions>({
    isPublished: 'all',
    targetClass: 'all',
  });

  // 삭제 모달 상태
  const [deleteTarget, setDeleteTarget] = useState<ProfessorQuiz | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // 데이터 로드
  useEffect(() => {
    if (user?.uid) {
      fetchQuizzes(user.uid, filter);
    }
  }, [user?.uid, filter, fetchQuizzes]);

  // 필터 변경 핸들러
  const handleFilterChange = useCallback((newFilter: QuizFilterOptions) => {
    setFilter(newFilter);
  }, []);

  // 퀴즈 클릭 (상세 보기)
  const handleQuizClick = useCallback(
    (quiz: ProfessorQuiz) => {
      router.push(`/professor/quiz/${quiz.id}`);
    },
    [router]
  );

  // 퀴즈 수정
  const handleQuizEdit = useCallback(
    (quiz: ProfessorQuiz) => {
      router.push(`/professor/quiz/${quiz.id}/edit`);
    },
    [router]
  );

  // 퀴즈 삭제 요청
  const handleQuizDelete = useCallback((quiz: ProfessorQuiz) => {
    setDeleteTarget(quiz);
  }, []);

  // 퀴즈 삭제 확인
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;

    try {
      setDeleteLoading(true);
      await deleteQuiz(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      console.error('퀴즈 삭제 실패:', err);
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, deleteQuiz]);

  // 퀴즈 공개 상태 토글
  const handleQuizTogglePublish = useCallback(
    async (quiz: ProfessorQuiz) => {
      try {
        await togglePublish(quiz.id, !quiz.isPublished);
      } catch (err) {
        console.error('공개 상태 변경 실패:', err);
      }
    },
    [togglePublish]
  );

  // 퀴즈 출제 페이지로 이동
  const handleCreateQuiz = useCallback(() => {
    router.push('/professor/quiz/create');
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* 헤더 */}
      <Header
        title="퀴즈 관리"
        showBack
        rightAction={
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleCreateQuiz}
            className="px-3 py-1.5 bg-indigo-500 text-white text-sm font-medium rounded-lg"
          >
            + 출제
          </motion.button>
        }
      />

      {/* 에러 메시지 */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-xl"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={clearError}
              className="text-red-400 hover:text-red-600"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </motion.div>
      )}

      {/* 메인 컨텐츠 */}
      <main className="p-4">
        <QuizList
          quizzes={quizzes}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          filter={filter}
          onFilterChange={handleFilterChange}
          onLoadMore={fetchMore}
          onQuizClick={handleQuizClick}
          onQuizEdit={handleQuizEdit}
          onQuizDelete={handleQuizDelete}
          onQuizTogglePublish={handleQuizTogglePublish}
        />
      </main>

      {/* 삭제 확인 모달 */}
      <QuizDeleteModal
        quiz={deleteTarget}
        loading={deleteLoading}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
