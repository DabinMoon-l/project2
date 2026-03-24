'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

interface DeleteQuizInfo {
  title: string;
  questionCount: number;
  participantCount: number;
  targetClass?: string;
}

interface QuizDeleteModalProps {
  quiz: DeleteQuizInfo | null;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isPanelMode?: boolean;
}

export default function QuizDeleteModal({
  quiz,
  loading = false,
  onConfirm,
  onCancel,
  isPanelMode,
}: QuizDeleteModalProps) {
  useEffect(() => {
    if (!quiz || isPanelMode) return;
    lockScroll();
    return () => { unlockScroll(); };
  }, [quiz, isPanelMode]);

  const content = (
    <div className="text-center p-5">
      <div className="flex justify-center mb-5">
        <svg className="w-12 h-12 text-[#8B1A1A]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h3 className="text-xl font-bold text-[#1A1A1A] mb-2">
        <span className="text-[#8B1A1A]">&ldquo;{quiz?.title}&rdquo;</span>
        <br />퀴즈를 정말 삭제하시겠습니까?
      </h3>
      {quiz && quiz.participantCount > 0 && (
        <p className="text-sm text-[#5C5C5C] mb-4">현재 {quiz.participantCount}명의 학생이 참여했습니다.</p>
      )}
      <div className="text-xs text-[#1A1A1A] mb-6 space-y-0.5 text-left">
        <p>• 삭제된 퀴즈는 복구할 수 없습니다.</p>
        <p>• 이미 푼 학생은 리뷰창에서 계속 복습할 수 있습니다.</p>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={onCancel} disabled={loading}
          className="flex-1 py-3 font-bold text-sm border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors disabled:opacity-50">
          취소
        </button>
        <button type="button" onClick={onConfirm} disabled={loading}
          className="flex-1 py-3 font-bold text-sm border-2 border-[#8B1A1A] bg-[#8B1A1A] text-white hover:bg-[#6B1414] transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? '삭제 중...' : '삭제'}
        </button>
      </div>
    </div>
  );

  // 패널 모드: absolute 바텀시트 (투명 오버레이)
  if (isPanelMode) {
    return (
      <AnimatePresence>
        {quiz && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[110]" style={{ left: 'var(--detail-panel-left, 0)' }}
              onClick={onCancel} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              className="fixed bottom-0 right-0 z-[110] bg-[#F5F0E8] border-t-2 border-[#1A1A1A] rounded-t-2xl overflow-hidden"
              style={{ left: 'var(--detail-panel-left, 0)' }}>
              <div className="flex justify-center pt-2 pb-1"><div className="w-10 h-1 rounded-full bg-[#C4C0B8]" /></div>
              {content}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  }

  // 세로모드: fixed 중앙 모달
  return (
    <AnimatePresence>
      {quiz && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onCancel} className="absolute inset-0 bg-black/50" />
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] max-w-[300px] w-full shadow-xl rounded-2xl">
            {content}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
