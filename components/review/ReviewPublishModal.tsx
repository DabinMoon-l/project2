'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWideMode } from '@/lib/hooks/useViewportScale';

interface Props {
  quizId: string | null;
  onClose: () => void;
  onConfirm: (quizId: string) => Promise<void> | void;
}

export default function ReviewPublishModal({ quizId, onClose, onConfirm }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const isWide = useWideMode();

  const handleConfirm = async () => {
    if (!quizId) return;
    setIsLoading(true);
    try {
      await onConfirm(quizId);
      onClose();
    } catch {
      setIsLoading(false);
    }
  };

  const modalContent = (
    <>
      <div className="flex justify-center mb-3">
        <div className="w-10 h-10 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4] rounded-lg">
          <svg className="w-5 h-5 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
          </svg>
        </div>
      </div>
      <h3 className="text-center font-bold text-base text-[#1A1A1A] mb-1.5">퀴즈를 공개할까요?</h3>
      <p className="text-center text-xs text-[#5C5C5C] mb-0.5">공개하면 다른 학생들도 풀 수 있어요.</p>
      <p className="text-center text-xs text-[#5C5C5C] mb-4">참여 통계도 확인할 수 있어요.</p>
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 py-2.5 text-sm font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg">취소</button>
        <button disabled={isLoading} onClick={handleConfirm} className="flex-1 py-2.5 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg disabled:opacity-50">{isLoading ? '공개 중...' : '공개'}</button>
      </div>
    </>
  );

  return (
    <AnimatePresence>
      {quizId && (
        isWide ? (
          <>
            <motion.div key="pub-overlay" className="fixed inset-0 z-50" style={{ left: 'var(--modal-left, 240px)', right: 'var(--modal-right, 0px)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
            <motion.div key="pub-sheet" className="fixed bottom-0 z-[51] bg-[#F5F0E8] rounded-t-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.15)] border-t-2 border-x-2 border-[#1A1A1A] p-4" style={{ left: 'var(--modal-left, 240px)', right: 'var(--modal-right, 0px)' }} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 400, damping: 35 }} onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-center -mt-2 mb-2"><div className="w-8 h-1 rounded-full bg-[#D4CFC4]" /></div>
              {modalContent}
            </motion.div>
          </>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="w-[85%] max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-2xl">
              {modalContent}
            </motion.div>
          </motion.div>
        )
      )}
    </AnimatePresence>
  );
}
