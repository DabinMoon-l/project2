'use client';

import { motion } from 'framer-motion';
import {
  type OverallAnalysisSummary,
  type QuizAnalysisSummary,
} from '@/lib/hooks/useProfessorAnalysis';

// ============================================================
// 타입 정의
// ============================================================

interface AnalysisSummaryProps {
  /** 전체 분석 요약 */
  overallSummary: OverallAnalysisSummary | null;
  /** 퀴즈별 요약 */
  quizSummaries: QuizAnalysisSummary[];
  /** 퀴즈 클릭 핸들러 */
  onQuizClick?: (quizId: string) => void;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 분석 요약 컴포넌트
 *
 * 전체 통계 요약과 퀴즈별 요약을 표시합니다.
 */
export default function AnalysisSummary({
  overallSummary,
  quizSummaries,
  onQuizClick,
}: AnalysisSummaryProps) {
  if (!overallSummary) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">분석 데이터가 없습니다</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 전체 통계 카드 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-5 text-white"
      >
        <h3 className="font-medium text-white/80 mb-4">전체 분석 요약</h3>

        <div className="grid grid-cols-2 gap-4">
          {/* 총 퀴즈 */}
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold">{overallSummary.totalQuizzes}</p>
            <p className="text-sm text-white/70">총 퀴즈</p>
          </div>

          {/* 총 문제 */}
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold">{overallSummary.totalQuestions}</p>
            <p className="text-sm text-white/70">총 문제</p>
          </div>

          {/* 총 시도 */}
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold">{overallSummary.totalAttempts}</p>
            <p className="text-sm text-white/70">총 시도</p>
          </div>

          {/* 평균 정답률 */}
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold">{overallSummary.averageCorrectRate}%</p>
            <p className="text-sm text-white/70">평균 정답률</p>
          </div>
        </div>
      </motion.div>

      {/* 퀴즈별 요약 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-2xl p-4 shadow-sm"
      >
        <h3 className="font-bold text-gray-800 mb-4">퀴즈별 분석</h3>

        <div className="space-y-3">
          {quizSummaries.length > 0 ? (
            quizSummaries.map((quiz, index) => (
              <motion.div
                key={quiz.quizId}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => onQuizClick?.(quiz.quizId)}
                className="bg-gray-50 rounded-xl p-4 cursor-pointer hover:bg-gray-100 transition-colors"
              >
                {/* 퀴즈 제목 + 참여자 */}
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-gray-800 truncate">
                    {quiz.quizTitle}
                  </h4>
                  <span className="text-xs text-gray-500">
                    {quiz.participantCount}명 참여
                  </span>
                </div>

                {/* 문제 수 + 평균 정답률 */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium">
                    {quiz.totalQuestions}문제
                  </span>
                  <span
                    className={`
                      px-2 py-0.5 rounded-full text-xs font-medium
                      ${
                        quiz.averageCorrectRate >= 70
                          ? 'bg-green-100 text-green-700'
                          : quiz.averageCorrectRate >= 40
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                      }
                    `}
                  >
                    평균 {quiz.averageCorrectRate}%
                  </span>
                </div>

                {/* 가장 어려운/쉬운 문제 */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {quiz.hardestQuestion && (
                    <div className="bg-red-50 rounded-lg p-2">
                      <p className="text-red-600 font-medium mb-1">
                        가장 어려운 문제
                      </p>
                      <p className="text-gray-600 line-clamp-1">
                        {quiz.hardestQuestion.text}
                      </p>
                      <p className="text-red-500 font-medium mt-1">
                        {quiz.hardestQuestion.correctRate}%
                      </p>
                    </div>
                  )}
                  {quiz.easiestQuestion && (
                    <div className="bg-green-50 rounded-lg p-2">
                      <p className="text-green-600 font-medium mb-1">
                        가장 쉬운 문제
                      </p>
                      <p className="text-gray-600 line-clamp-1">
                        {quiz.easiestQuestion.text}
                      </p>
                      <p className="text-green-500 font-medium mt-1">
                        {quiz.easiestQuestion.correctRate}%
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            ))
          ) : (
            <p className="text-center text-gray-400 py-8">
              출제한 퀴즈가 없습니다
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
