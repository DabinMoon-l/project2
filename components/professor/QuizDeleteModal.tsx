'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ============================================================
// 타입 정의
// ============================================================

/** 삭제 모달에서 사용하는 퀴즈 정보 (최소 필수 필드) */
interface DeleteQuizInfo {
  title: string;
  questionCount: number;
  participantCount: number;
  targetClass?: string;
}

interface QuizDeleteModalProps {
  /** 삭제할 퀴즈 (null이면 모달 닫힘) */
  quiz: DeleteQuizInfo | null;
  /** 삭제 진행 중 여부 */
  loading?: boolean;
  /** 삭제 확인 시 콜백 */
  onConfirm: () => void;
  /** 취소 시 콜백 */
  onCancel: () => void;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 퀴즈 삭제 확인 모달 컴포넌트
 */
export default function QuizDeleteModal({
  quiz,
  loading = false,
  onConfirm,
  onCancel,
}: QuizDeleteModalProps) {
  // 모달 열림 시 body 스크롤 잠금 (PullToHome 스와이프 방지)
  useEffect(() => {
    if (!quiz) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [quiz]);

  return (
    <AnimatePresence>
      {quiz && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* 백드롭 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-black/50"
          />

          {/* 모달 */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6 max-w-sm w-full shadow-xl"
          >
            <div className="text-center">
              {/* 경고 아이콘 - 빨간색 테두리 삼각형 */}
              <div className="flex justify-center mb-5">
                <svg
                  className="w-12 h-12 text-[#8B1A1A]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>

              {/* 메인 메시지 */}
              <h3 className="text-xl font-bold text-[#1A1A1A] mb-2">
                <span className="text-[#8B1A1A]">&ldquo;{quiz.title}&rdquo;</span>
                <br />
                퀴즈를 정말 삭제하시겠습니까?
              </h3>

              {/* 참여자 정보 */}
              {quiz.participantCount > 0 && (
                <p className="text-sm text-[#5C5C5C] mb-4">
                  현재 {quiz.participantCount}명의 학생이 참여했습니다.
                </p>
              )}

              {/* 안내 사항 - 작게, 박스 없이, 왼쪽 정렬 */}
              <div className="text-xs text-[#1A1A1A] mb-6 space-y-0.5 text-left">
                <p>• 삭제된 퀴즈는 복구할 수 없습니다.</p>
                <p>• 이미 푼 학생은 리뷰창에서 계속 복습할 수 있습니다.</p>
              </div>

              {/* 버튼 */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={loading}
                  className="flex-1 py-3 font-bold text-sm border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={loading}
                  className="flex-1 py-3 font-bold text-sm border-2 border-[#8B1A1A] bg-[#8B1A1A] text-white hover:bg-[#6B1414] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <svg
                        className="animate-spin h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      삭제 중...
                    </>
                  ) : (
                    '삭제'
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
