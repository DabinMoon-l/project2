'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/common';
import type { ProfessorQuiz } from '@/lib/hooks/useProfessorQuiz';

// ============================================================
// 타입 정의
// ============================================================

interface QuizDeleteModalProps {
  /** 삭제할 퀴즈 (null이면 모달 닫힘) */
  quiz: ProfessorQuiz | null;
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
 *
 * 퀴즈 삭제 전 확인을 요청하는 모달입니다.
 * 참여자가 있는 경우 경고 메시지를 표시합니다.
 *
 * @example
 * ```tsx
 * <QuizDeleteModal
 *   quiz={deleteTarget}
 *   loading={deleteLoading}
 *   onConfirm={handleDelete}
 *   onCancel={() => setDeleteTarget(null)}
 * />
 * ```
 */
export default function QuizDeleteModal({
  quiz,
  loading = false,
  onConfirm,
  onCancel,
}: QuizDeleteModalProps) {
  const hasParticipants = quiz && quiz.participantCount > 0;

  return (
    <AnimatePresence>
      {quiz && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 백드롭 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />

          {/* 모달 */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="relative bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl"
          >
            <div className="text-center">
              {/* 아이콘 */}
              <div
                className={`
                  w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4
                  ${hasParticipants ? 'bg-amber-100' : 'bg-red-100'}
                `}
              >
                {hasParticipants ? (
                  <svg
                    className="w-7 h-7 text-amber-500"
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
                ) : (
                  <svg
                    className="w-7 h-7 text-red-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                )}
              </div>

              {/* 제목 */}
              <h3 className="text-lg font-bold text-gray-800 mb-2">
                {hasParticipants ? '참여자가 있는 퀴즈입니다' : '퀴즈를 삭제할까요?'}
              </h3>

              {/* 설명 */}
              <div className="text-sm text-gray-500 mb-6">
                {hasParticipants ? (
                  <div className="space-y-2">
                    <p>
                      <strong className="text-amber-600">{quiz.participantCount}명</strong>의
                      학생이 이 퀴즈에 참여했습니다.
                    </p>
                    <p>삭제하면 학생들의 기록도 함께 사라집니다.</p>
                    <p className="font-medium">정말 삭제하시겠습니까?</p>
                  </div>
                ) : (
                  <div>
                    <p className="mb-1">
                      <strong>"{quiz.title}"</strong> 퀴즈가 삭제됩니다.
                    </p>
                    <p>이 작업은 되돌릴 수 없습니다.</p>
                  </div>
                )}
              </div>

              {/* 퀴즈 정보 */}
              <div className="bg-gray-50 rounded-xl p-3 mb-6 text-left">
                <p className="text-sm font-medium text-gray-700 mb-1 truncate">
                  {quiz.title}
                </p>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{quiz.questionCount}문제</span>
                  <span>•</span>
                  <span>{quiz.targetClass === 'all' ? '전체' : `${quiz.targetClass}반`}</span>
                  {quiz.participantCount > 0 && (
                    <>
                      <span>•</span>
                      <span>참여 {quiz.participantCount}명</span>
                    </>
                  )}
                </div>
              </div>

              {/* 버튼 */}
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={onCancel}
                  disabled={loading}
                >
                  취소
                </Button>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onConfirm}
                  disabled={loading}
                  className={`
                    flex-1 py-2.5 px-4 rounded-xl font-medium
                    text-white transition-colors
                    disabled:opacity-50 disabled:cursor-not-allowed
                    flex items-center justify-center gap-2
                    ${hasParticipants ? 'bg-amber-500 hover:bg-amber-600' : 'bg-red-500 hover:bg-red-600'}
                  `}
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
                </motion.button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
