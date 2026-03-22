'use client';

import { motion } from 'framer-motion';
import type { CompletedQuizData } from './types';
import type { GroupedReviewItems } from '@/lib/hooks/useReview';

/**
 * 문제 상세보기 모달 (문제 목록 표시)
 */
export default function QuestionListModal({
  quiz,
  onClose,
  onReview,
  groupedSolvedItems,
}: {
  quiz: CompletedQuizData;
  onClose: () => void;
  onReview: () => void;
  groupedSolvedItems: GroupedReviewItems[];
}) {
  // 해당 퀴즈의 문제 목록 찾기
  const solvedGroup = groupedSolvedItems.find(g => g.quizId === quiz.id);
  const questions = solvedGroup?.items || [];

  // 문제 유형 라벨
  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'ox': return 'OX';
      case 'multiple': return '객관식';
      case 'short_answer': return '주관식';
      case 'essay': return '서술형';
      case 'combined': return '결합형';
      default: return type;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      style={{ left: 'var(--modal-left, 0px)', right: 'var(--modal-right, 0px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.88 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.88 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[340px] max-h-[80vh] bg-[#F5F0E8] border-2 border-[#1A1A1A] flex flex-col"
      >
        {/* 헤더 */}
        <div className="p-3 border-b border-[#1A1A1A]">
          {/* 문제지 이름 */}
          <h3 className="font-bold text-sm text-[#1A1A1A] mb-1.5">
            {quiz.title}
          </h3>
          {/* 점수 표시: 퀴즈 점수 / 첫번째 복습 점수 (숫자만 크게) */}
          <div className="flex items-center gap-2 text-[#5C5C5C]">
            <span className="text-xs">점수:</span>
            <span className="text-lg font-black text-[#1A1A1A]">
              {quiz.myScore !== undefined ? quiz.myScore : '-'}
            </span>
            <span className="text-sm text-[#5C5C5C]">/</span>
            <span className="text-lg font-black text-[#1A1A1A]">
              {quiz.myFirstReviewScore !== undefined ? quiz.myFirstReviewScore : '-'}
            </span>
          </div>
          <p className="text-[10px] text-[#5C5C5C] mt-0.5">퀴즈 점수 / 첫번째 복습 점수</p>
        </div>

        {/* 문제 목록 */}
        <div className="flex-1 overflow-y-auto p-4">
          {questions.length === 0 ? (
            <div className="text-center py-8 text-[#5C5C5C]">
              문제를 불러오는 중...
            </div>
          ) : (
            <div className="space-y-2">
              {questions.map((item, index) => (
                <div
                  key={item.id}
                  className={`p-3 border ${
                    item.isCorrect ? 'border-[#1A6B1A] bg-[#1A6B1A]/5' : 'border-[#8B1A1A] bg-[#8B1A1A]/5'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm font-bold text-[#5C5C5C] shrink-0">
                      Q{index + 1}.
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#1A1A1A] line-clamp-2">
                        {item.question}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-[#5C5C5C]">
                          {getTypeLabel(item.type)}
                        </span>
                        <span className={`text-xs font-bold ${
                          item.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                        }`}>
                          {item.isCorrect ? '정답' : '오답'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 버튼 영역 */}
        <div className="p-4 border-t border-[#1A1A1A] flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
          >
            닫기
          </button>
          <button
            onClick={onReview}
            className="flex-1 py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
          >
            복습하기
          </button>
        </div>
      </motion.div>
    </div>
  );
}
