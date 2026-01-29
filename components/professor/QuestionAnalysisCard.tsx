'use client';

import { motion } from 'framer-motion';
import { type QuestionAnalysis } from '@/lib/hooks/useProfessorAnalysis';

// ============================================================
// 타입 정의
// ============================================================

interface QuestionAnalysisCardProps {
  /** 문제 분석 데이터 */
  analysis: QuestionAnalysis;
  /** 클릭 핸들러 */
  onClick?: () => void;
}

// ============================================================
// 유틸리티
// ============================================================

/** 난이도 설정 */
const DIFFICULTY_CONFIG = {
  easy: { label: '쉬움', color: 'bg-green-100 text-green-700', barColor: 'bg-green-500' },
  normal: { label: '보통', color: 'bg-yellow-100 text-yellow-700', barColor: 'bg-yellow-500' },
  hard: { label: '어려움', color: 'bg-red-100 text-red-700', barColor: 'bg-red-500' },
};

/** 문제 유형 설정 */
const TYPE_CONFIG = {
  ox: { label: 'OX', color: 'bg-blue-100 text-blue-700' },
  multiple: { label: '객관식', color: 'bg-purple-100 text-purple-700' },
  subjective: { label: '주관식', color: 'bg-teal-100 text-teal-700' },
};

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 문제 분석 카드 컴포넌트
 *
 * 개별 문제의 정답률, 난이도, 오답 패턴 등을 표시합니다.
 */
export default function QuestionAnalysisCard({
  analysis,
  onClick,
}: QuestionAnalysisCardProps) {
  const difficultyConfig = DIFFICULTY_CONFIG[analysis.estimatedDifficulty];
  const typeConfig = TYPE_CONFIG[analysis.type];

  // 정답률에 따른 색상
  const getCorrectRateColor = (rate: number) => {
    if (rate >= 70) return 'text-green-600';
    if (rate >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className="bg-white rounded-2xl p-4 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
    >
      {/* 헤더: 퀴즈 제목 + 뱃지 */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-indigo-600 font-medium truncate mb-1">
            {analysis.quizTitle}
          </p>
          <p className="text-sm text-gray-800 line-clamp-2">
            {analysis.questionText}
          </p>
        </div>

        {/* 피드백 뱃지 */}
        {analysis.feedbackCount > 0 && (
          <span className="ml-2 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
            피드백 {analysis.feedbackCount}
          </span>
        )}
      </div>

      {/* 뱃지들 */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeConfig.color}`}>
          {typeConfig.label}
        </span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${difficultyConfig.color}`}>
          {difficultyConfig.label}
        </span>
        <span className="text-xs text-gray-400">
          {analysis.totalAttempts}명 시도
        </span>
      </div>

      {/* 정답률 바 */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-500">정답률</span>
          <span className={`text-sm font-bold ${getCorrectRateColor(analysis.correctRate)}`}>
            {analysis.correctRate}%
          </span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${analysis.correctRate}%` }}
            transition={{ duration: 0.5 }}
            className={`h-full rounded-full ${difficultyConfig.barColor}`}
          />
        </div>
      </div>

      {/* 오답 분포 (객관식) */}
      {analysis.type === 'multiple' && analysis.answerDistribution && (
        <div className="pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-2">선지별 응답 분포</p>
          <div className="space-y-1.5">
            {analysis.answerDistribution.map((dist) => {
              const percentage = analysis.totalAttempts > 0
                ? Math.round((dist.count / analysis.totalAttempts) * 100)
                : 0;

              return (
                <div key={dist.choice} className="flex items-center gap-2">
                  <span
                    className={`
                      w-5 h-5 rounded flex items-center justify-center text-xs font-medium
                      ${dist.isCorrect ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}
                    `}
                  >
                    {dist.choice + 1}
                  </span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${dist.isCorrect ? 'bg-green-500' : 'bg-gray-400'}`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right">
                    {percentage}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* OX 분포 */}
      {analysis.type === 'ox' && analysis.totalAttempts > 0 && (
        <div className="pt-3 border-t border-gray-100">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">정답</span>
                <span className="text-xs text-green-600 font-medium">
                  {analysis.correctCount}명
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full"
                  style={{ width: `${(analysis.correctCount / analysis.totalAttempts) * 100}%` }}
                />
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">오답</span>
                <span className="text-xs text-red-600 font-medium">
                  {analysis.incorrectCount}명
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full"
                  style={{ width: `${(analysis.incorrectCount / analysis.totalAttempts) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
