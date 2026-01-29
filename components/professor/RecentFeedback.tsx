'use client';

import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

interface Feedback {
  id: string;
  quizTitle: string;
  questionNumber: number;
  content: string;
  studentNickname: string;
  createdAt: Date;
  isRead: boolean;
}

interface RecentFeedbackProps {
  /** 피드백 목록 */
  feedbacks: Feedback[];
  /** 더보기 클릭 핸들러 */
  onViewAll?: () => void;
  /** 피드백 클릭 핸들러 */
  onFeedbackClick?: (feedbackId: string) => void;
}

/**
 * 최근 피드백 컴포넌트
 */
export default function RecentFeedback({
  feedbacks,
  onViewAll,
  onFeedbackClick,
}: RecentFeedbackProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-sm overflow-hidden"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="font-bold text-gray-800">최근 피드백</h3>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-sm text-theme-accent font-medium"
          >
            전체보기
          </button>
        )}
      </div>

      {/* 피드백 목록 */}
      {feedbacks.length === 0 ? (
        <div className="py-8 text-center text-gray-400 text-sm">
          아직 피드백이 없습니다
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {feedbacks.slice(0, 5).map((feedback) => (
            <button
              key={feedback.id}
              type="button"
              onClick={() => onFeedbackClick?.(feedback.id)}
              className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start gap-3">
                {/* 읽음 표시 */}
                {!feedback.isRead && (
                  <div className="w-2 h-2 mt-2 bg-red-500 rounded-full flex-shrink-0" />
                )}

                <div className="flex-1 min-w-0">
                  {/* 퀴즈 정보 */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                      {feedback.quizTitle}
                    </span>
                    <span className="text-xs text-gray-400">
                      문제 {feedback.questionNumber}
                    </span>
                  </div>

                  {/* 피드백 내용 */}
                  <p className="text-sm text-gray-700 line-clamp-2 mb-1">
                    {feedback.content}
                  </p>

                  {/* 작성자 및 시간 */}
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{feedback.studentNickname}</span>
                    <span>•</span>
                    <span>
                      {formatDistanceToNow(feedback.createdAt, {
                        addSuffix: true,
                        locale: ko,
                      })}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
