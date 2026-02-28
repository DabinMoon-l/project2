'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

interface AIQuizProgressProps {
  isOpen: boolean;
  progress: 'uploading' | 'analyzing' | 'generating';
  folderName: string;
}

const PROGRESS_MESSAGES = {
  uploading: {
    title: '이미지 업로드 중...',
    subtitle: '학습 자료를 분석하기 위해 준비하고 있어요',
    icon: (
      <svg className="w-8 h-8 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
    ),
  },
  analyzing: {
    title: '자료 분석 중...',
    subtitle: '교재 내용을 꼼꼼히 읽고 있어요',
    icon: (
      <svg className="w-8 h-8 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  generating: {
    title: '문제 생성 중...',
    subtitle: '열심히 문제를 만들고 있어요',
    icon: (
      <svg className="w-8 h-8 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
};

/**
 * AI 퀴즈 생성 진행 상태 표시 모달
 */
export default function AIQuizProgress({ isOpen, progress, folderName }: AIQuizProgressProps) {
  if (typeof window === 'undefined') return null;

  const { title, subtitle, icon } = PROGRESS_MESSAGES[progress];

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 백드롭 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />

          {/* 모달 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="relative w-full max-w-xs bg-[#F5F0E8] border-2 border-[#1A1A1A] shadow-[4px_4px_0px_#1A1A1A] p-4"
          >
            <div className="flex flex-col items-center text-center">
              {/* 아이콘 + 스피너 */}
              <div className="relative mb-3">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                  className="absolute -inset-3 border-2 border-[#1A1A1A] border-t-transparent rounded-full"
                />
                <div className="p-3 bg-white border-2 border-[#1A1A1A] rounded-full">
                  {icon}
                </div>
              </div>

              {/* 폴더명 */}
              <div className="text-xs text-[#5C5C5C] mb-1.5">{folderName}</div>

              {/* 진행 상태 */}
              <h3 className="text-sm font-bold text-[#1A1A1A] mb-1.5">{title}</h3>
              <p className="text-xs text-[#5C5C5C]">{subtitle}</p>

              {/* 진행 인디케이터 */}
              <div className="flex gap-1.5 mt-4">
                {(['uploading', 'analyzing', 'generating'] as const).map((step, idx) => {
                  const steps = ['uploading', 'analyzing', 'generating'];
                  const currentIdx = steps.indexOf(progress);
                  const isCompleted = idx < currentIdx;
                  const isCurrent = idx === currentIdx;

                  return (
                    <div
                      key={step}
                      className={`w-2.5 h-2.5 rounded-full transition-all ${
                        isCompleted
                          ? 'bg-[#1A6B1A]'
                          : isCurrent
                          ? 'bg-[#1A1A1A] animate-pulse'
                          : 'bg-[#E5E5E5]'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
