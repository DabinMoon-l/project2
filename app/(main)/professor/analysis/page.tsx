'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header, Skeleton } from '@/components/common';
import {
  QuestionAnalysisCard,
  DifficultyChart,
  AnalysisSummary,
} from '@/components/professor';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  useProfessorAnalysis,
  type AnalysisFilterOptions,
  type QuestionType,
} from '@/lib/hooks/useProfessorAnalysis';

// ============================================================
// 타입 정의
// ============================================================

type ViewMode = 'summary' | 'questions' | 'charts';
type SortOption = 'correctRate' | 'attempts' | 'feedbacks';
type DifficultyFilter = 'all' | 'easy' | 'normal' | 'hard';
type TypeFilter = 'all' | QuestionType;

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 로딩 스켈레톤
 */
function AnalysisSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-40 rounded-2xl" />
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-32 rounded-2xl" />
    </div>
  );
}

/**
 * 교수님 문제 분석 페이지
 *
 * 문제별 정답률, 난이도 분포, 오답 패턴 등을 분석합니다.
 */
export default function QuestionAnalysisPage() {
  const { user } = useAuth();
  const {
    questions,
    quizSummaries,
    overallSummary,
    loading,
    error,
    fetchAnalysis,
    clearError,
  } = useProfessorAnalysis();

  // 뷰 모드
  const [viewMode, setViewMode] = useState<ViewMode>('summary');

  // 필터 상태
  const [selectedQuiz, setSelectedQuiz] = useState<string | undefined>();
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('all');
  const [type, setType] = useState<TypeFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('correctRate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // 데이터 로드
  useEffect(() => {
    if (user?.uid) {
      const options: AnalysisFilterOptions = {
        quizId: selectedQuiz,
        type: type === 'all' ? undefined : type,
        difficulty: difficulty === 'all' ? undefined : difficulty,
        sortBy,
        sortOrder,
      };
      fetchAnalysis(user.uid, options);
    }
  }, [user?.uid, selectedQuiz, difficulty, type, sortBy, sortOrder, fetchAnalysis]);

  // 퀴즈 선택 핸들러
  const handleQuizClick = useCallback((quizId: string) => {
    setSelectedQuiz(quizId);
    setViewMode('questions');
  }, []);

  // 필터 리셋
  const handleResetFilter = useCallback(() => {
    setSelectedQuiz(undefined);
    setDifficulty('all');
    setType('all');
    setSortBy('correctRate');
    setSortOrder('asc');
  }, []);

  // 정렬 토글
  const toggleSortOrder = useCallback(() => {
    setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* 헤더 */}
      <Header title="문제 분석" showBack />

      {/* 뷰 모드 탭 */}
      <div className="sticky top-0 bg-gray-50 z-10 px-4 pt-3 pb-2">
        <div className="flex bg-white rounded-xl p-1 shadow-sm">
          {[
            { value: 'summary', label: '요약' },
            { value: 'questions', label: '문제별' },
            { value: 'charts', label: '차트' },
          ].map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setViewMode(tab.value as ViewMode)}
              className={`
                flex-1 py-2 rounded-lg text-sm font-medium transition-colors
                ${viewMode === tab.value ? 'bg-indigo-500 text-white' : 'text-gray-500'}
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 필터 (문제별 뷰에서만) */}
        {viewMode === 'questions' && (
          <div className="mt-3 space-y-2">
            {/* 선택된 퀴즈 표시 */}
            {selectedQuiz && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-indigo-600 font-medium">
                  {quizSummaries.find((q) => q.quizId === selectedQuiz)?.quizTitle}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedQuiz(undefined)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  전체 보기
                </button>
              </div>
            )}

            {/* 필터 버튼들 */}
            <div className="flex flex-wrap gap-2">
              {/* 난이도 필터 */}
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as DifficultyFilter)}
                className="px-3 py-1.5 bg-white rounded-lg text-sm border border-gray-200 focus:border-indigo-400 outline-none"
              >
                <option value="all">모든 난이도</option>
                <option value="easy">쉬움</option>
                <option value="normal">보통</option>
                <option value="hard">어려움</option>
              </select>

              {/* 유형 필터 */}
              <select
                value={type}
                onChange={(e) => setType(e.target.value as TypeFilter)}
                className="px-3 py-1.5 bg-white rounded-lg text-sm border border-gray-200 focus:border-indigo-400 outline-none"
              >
                <option value="all">모든 유형</option>
                <option value="ox">OX</option>
                <option value="multiple">객관식</option>
                <option value="subjective">주관식</option>
              </select>

              {/* 정렬 */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="px-3 py-1.5 bg-white rounded-lg text-sm border border-gray-200 focus:border-indigo-400 outline-none"
              >
                <option value="correctRate">정답률순</option>
                <option value="attempts">시도순</option>
                <option value="feedbacks">피드백순</option>
              </select>

              {/* 정렬 방향 */}
              <button
                type="button"
                onClick={toggleSortOrder}
                className="px-3 py-1.5 bg-white rounded-lg text-sm border border-gray-200 hover:bg-gray-50"
              >
                {sortOrder === 'asc' ? '↑ 오름차순' : '↓ 내림차순'}
              </button>

              {/* 필터 리셋 */}
              <button
                type="button"
                onClick={handleResetFilter}
                className="px-3 py-1.5 text-gray-500 text-sm hover:text-gray-700"
              >
                초기화
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 에러 메시지 */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-4 mb-4 p-3 bg-red-50 border border-red-200 rounded-xl"
        >
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={clearError}
            className="text-xs text-red-500 underline mt-1"
          >
            닫기
          </button>
        </motion.div>
      )}

      {/* 메인 컨텐츠 */}
      <main className="px-4 pt-2">
        {loading ? (
          <AnalysisSkeleton />
        ) : (
          <AnimatePresence mode="wait">
            {viewMode === 'summary' && (
              <motion.div
                key="summary"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                <AnalysisSummary
                  overallSummary={overallSummary}
                  quizSummaries={quizSummaries}
                  onQuizClick={handleQuizClick}
                />
              </motion.div>
            )}

            {viewMode === 'questions' && (
              <motion.div
                key="questions"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-3"
              >
                {questions.length > 0 ? (
                  questions.map((analysis, index) => (
                    <motion.div
                      key={analysis.questionId}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                    >
                      <QuestionAnalysisCard analysis={analysis} />
                    </motion.div>
                  ))
                ) : (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg
                        className="w-8 h-8 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                        />
                      </svg>
                    </div>
                    <p className="text-gray-500">분석할 문제가 없습니다</p>
                    <p className="text-sm text-gray-400 mt-1">
                      퀴즈를 출제하고 학생들이 풀면 분석이 시작됩니다
                    </p>
                  </div>
                )}
              </motion.div>
            )}

            {viewMode === 'charts' && overallSummary && (
              <motion.div
                key="charts"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <DifficultyChart summary={overallSummary} />
              </motion.div>
            )}

            {viewMode === 'charts' && !overallSummary && (
              <div className="text-center py-12">
                <p className="text-gray-400">차트를 표시할 데이터가 없습니다</p>
              </div>
            )}
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}
