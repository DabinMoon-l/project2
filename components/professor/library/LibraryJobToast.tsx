'use client';

/**
 * 교수 서재 — 백그라운드 Job 토스트
 *
 * 문제 생성 진행/완료/실패를 상단 중앙 토스트로 표시.
 * createPortal로 document.body에 렌더링하여 어떤 페이지에서든 보임.
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  onLibraryJobEvent,
  isLibraryJobActive,
  cancelLibraryJob,
  type JobEvent,
} from '@/lib/utils/libraryJobManager';

type ToastState =
  | { visible: false }
  | { visible: true; type: 'progress'; step: string }
  | { visible: true; type: 'completed'; questionCount: number }
  | { visible: true; type: 'failed'; error: string };

export default function LibraryJobToast() {
  const [toast, setToast] = useState<ToastState>({ visible: false });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // 마운트 시 이미 진행 중인 Job이 있으면 progress 표시
    if (isLibraryJobActive()) {
      setToast({ visible: true, type: 'progress', step: 'generating' });
    }

    const unsub = onLibraryJobEvent((event: JobEvent) => {
      switch (event.type) {
        case 'started':
          setToast({ visible: true, type: 'progress', step: 'uploading' });
          break;
        case 'progress':
          setToast({ visible: true, type: 'progress', step: event.step || 'generating' });
          break;
        case 'completed':
          setToast({ visible: true, type: 'completed', questionCount: event.questionCount || 0 });
          // 5초 후 자동 숨김
          setTimeout(() => setToast({ visible: false }), 5000);
          break;
        case 'failed':
          setToast({ visible: true, type: 'failed', error: event.error || '오류' });
          // 5초 후 자동 숨김
          setTimeout(() => setToast({ visible: false }), 5000);
          break;
        case 'cancelled':
          setToast({ visible: false });
          break;
      }
    });

    return unsub;
  }, []);

  const handleDismiss = useCallback(() => {
    setToast({ visible: false });
  }, []);

  const handleCancel = useCallback(() => {
    cancelLibraryJob();
    setToast({ visible: false });
  }, []);

  if (!mounted || !toast.visible) return null;

  const stepLabel =
    toast.type === 'progress'
      ? toast.step === 'uploading'
        ? '자료 업로드 중...'
        : toast.step === 'analyzing'
          ? '자료 분석 중...'
          : 'AI 문제 생성 중...'
      : '';

  return createPortal(
    <AnimatePresence>
      {toast.visible && (
        <motion.div
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-32px)] max-w-sm"
        >
          {/* 진행 중 토스트 */}
          {toast.type === 'progress' && (
            <div className="flex items-center gap-3 px-4 py-3 bg-[#1A1A1A] border-2 border-[#1A1A1A] shadow-lg">
              <div className="w-5 h-5 flex-shrink-0 border-2 border-[#F5F0E8] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-bold text-[#F5F0E8] flex-1">{stepLabel}</span>
              <button
                onClick={handleCancel}
                className="text-xs text-[#999] hover:text-[#F5F0E8] flex-shrink-0"
              >
                취소
              </button>
            </div>
          )}

          {/* 완료 토스트 */}
          {toast.type === 'completed' && (
            <div
              className="flex items-center gap-3 px-4 py-3 bg-[#1A1A1A] border-2 border-[#1A1A1A] shadow-lg cursor-pointer"
              onClick={handleDismiss}
            >
              <svg className="w-5 h-5 text-[#4CAF50] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm font-bold text-[#F5F0E8]">
                AI 문제 {toast.questionCount}개 생성 완료!
              </span>
            </div>
          )}

          {/* 실패 토스트 */}
          {toast.type === 'failed' && (
            <div
              className="flex items-center gap-3 px-4 py-3 bg-[#C44] border-2 border-[#C44] shadow-lg cursor-pointer"
              onClick={handleDismiss}
            >
              <svg className="w-5 h-5 text-white flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span className="text-sm font-bold text-white truncate">
                {toast.error}
              </span>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
