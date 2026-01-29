'use client';

import { motion } from 'framer-motion';

interface QuickAction {
  id: string;
  label: string;
  icon: string;
  color: string;
  onClick: () => void;
}

interface QuickActionsProps {
  /** 퀴즈 출제 클릭 */
  onCreateQuiz: () => void;
  /** 학생 현황 클릭 */
  onViewStudents: () => void;
  /** 문제 분석 클릭 */
  onAnalyze: () => void;
  /** 피드백 확인 클릭 */
  onViewFeedback: () => void;
}

/**
 * 빠른 액션 버튼 컴포넌트
 */
export default function QuickActions({
  onCreateQuiz,
  onViewStudents,
  onAnalyze,
  onViewFeedback,
}: QuickActionsProps) {
  const actions: QuickAction[] = [
    {
      id: 'create-quiz',
      label: '퀴즈 출제',
      icon: '📝',
      color: 'bg-indigo-100 text-indigo-600',
      onClick: onCreateQuiz,
    },
    {
      id: 'view-students',
      label: '학생 현황',
      icon: '👥',
      color: 'bg-green-100 text-green-600',
      onClick: onViewStudents,
    },
    {
      id: 'analyze',
      label: '문제 분석',
      icon: '📊',
      color: 'bg-orange-100 text-orange-600',
      onClick: onAnalyze,
    },
    {
      id: 'view-feedback',
      label: '피드백',
      icon: '💬',
      color: 'bg-purple-100 text-purple-600',
      onClick: onViewFeedback,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-sm p-4"
    >
      {/* 헤더 */}
      <h3 className="font-bold text-gray-800 mb-4">빠른 액션</h3>

      {/* 액션 버튼 그리드 */}
      <div className="grid grid-cols-4 gap-3">
        {actions.map((action) => (
          <motion.button
            key={action.id}
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={action.onClick}
            className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-gray-50 transition-colors"
          >
            {/* 아이콘 */}
            <div className={`w-12 h-12 flex items-center justify-center rounded-xl text-2xl ${action.color}`}>
              {action.icon}
            </div>
            {/* 라벨 */}
            <span className="text-xs font-medium text-gray-600">
              {action.label}
            </span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
