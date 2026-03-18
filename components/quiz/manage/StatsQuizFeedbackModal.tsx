/**
 * 퀴즈 통계 — 피드백 모달
 *
 * QuizStatsModal에서 분리된 서브 모달.
 * 문제별/전체 피드백 목록을 표시합니다.
 * 요술지니 애니메이션 (sourceRect → 화면 중앙) 포함.
 */

'use client';

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// 피드백 타입 라벨
const FEEDBACK_TYPE_LABELS: Record<string, string> = {
  praise: '문제가 좋아요!',
  wantmore: '더 풀고 싶어요',
  unclear: '문제가 이해가 안 돼요',
  wrong: '정답이 틀린 것 같아요',
  typo: '오타가 있어요',
  other: '기타 의견',
};

/** 피드백 아이템 타입 (Firestore 문서 기반) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FeedbackItem = Record<string, any>;

export interface StatsQuizFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  feedbackList: FeedbackItem[];
  loading: boolean;
  /** 필터링할 문제 번호 (1-indexed, 0이면 전체) */
  questionNum: number;
  /** 현재 반 필터 ('all' | 'A' | 'B' | 'C' | 'D') */
  classFilter: string;
  /** 퀴즈 제목 (전체 보기 시 헤더용) */
  quizTitle: string;
  /** 요술지니 애니메이션 시작 좌표 */
  sourceRect?: { x: number; y: number; width: number; height: number } | null;
  /** 피드백에서 문제 번호를 추출하는 헬퍼 */
  getFeedbackQuestionNum: (fb: FeedbackItem) => number;
}

export default function StatsQuizFeedbackModal({
  isOpen,
  onClose,
  feedbackList,
  loading,
  questionNum,
  classFilter,
  quizTitle,
  sourceRect,
  getFeedbackQuestionNum,
}: StatsQuizFeedbackModalProps) {
  // questionNum > 0이면 해당 문제 피드백만 필터링
  const filtered = useMemo(() => {
    if (questionNum === 0) return feedbackList;
    return feedbackList.filter((fb) => getFeedbackQuestionNum(fb) === questionNum);
  }, [feedbackList, questionNum, getFeedbackQuestionNum]);

  // 요술지니 오프셋 계산
  const genieOffset = useMemo(() => {
    if (!sourceRect || typeof window === 'undefined') return { dx: 0, dy: 0 };
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    return {
      dx: sourceRect.x + sourceRect.width / 2 - cx,
      dy: sourceRect.y + sourceRect.height / 2 - cy,
    };
  }, [sourceRect]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/50"
          style={{ left: 'var(--modal-left, 0px)' }}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.05, x: genieOffset.dx, y: genieOffset.dy }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.05, x: genieOffset.dx, y: genieOffset.dy }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs bg-[#F5F0E8] border-2 border-[#1A1A1A] max-h-[60vh] overflow-visible flex flex-col rounded-xl"
          >
            {/* 헤더 */}
            <div className="px-3 py-2 border-b border-[#1A1A1A]">
              <h2 className="text-sm font-bold text-[#1A1A1A] text-center truncate">
                {questionNum > 0 ? `${questionNum}번 문제 피드백` : quizTitle}
                {classFilter !== 'all' && <span className="text-[#5C5C5C] font-normal"> ({classFilter}반)</span>}
              </h2>
            </div>

            {/* 피드백 목록 */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-2">
              {loading && (
                <div className="py-6 text-center">
                  <p className="text-xs text-[#5C5C5C]">로딩 중...</p>
                </div>
              )}

              {!loading && filtered.length === 0 && (
                <div className="py-6 text-center">
                  <p className="text-xs text-[#5C5C5C]">아직 피드백이 없습니다.</p>
                </div>
              )}

              {!loading && feedbackList.length > 0 && (
                <div className="space-y-1.5">
                  {filtered.map((feedback) => {
                    const typeLabel = FEEDBACK_TYPE_LABELS[feedback.feedbackType] || feedback.feedbackType || '피드백';
                    const fbQuestionNum = getFeedbackQuestionNum(feedback);

                    return (
                      <div
                        key={feedback.id}
                        className="p-1.5 border border-[#1A1A1A] bg-[#EDEAE4] rounded-lg"
                      >
                        <div className="flex items-center gap-1 mb-0.5">
                          {/* 전체 보기일 때만 문제 번호 표시 */}
                          {questionNum === 0 && fbQuestionNum > 0 && (
                            <span className="text-[10px] text-[#5C5C5C]">
                              Q{fbQuestionNum}.
                            </span>
                          )}
                          <span className="text-[11px] font-bold text-[#8B6914]">
                            {typeLabel}
                          </span>
                        </div>
                        {feedback.feedback && (
                          <p className="text-[11px] text-[#1A1A1A]">
                            {feedback.feedback}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 닫기 버튼 */}
            <div className="p-1.5 border-t border-[#1A1A1A]">
              <button
                onClick={onClose}
                className="w-full py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] rounded-lg"
              >
                닫기
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
