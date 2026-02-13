'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface PptxProgressModalProps {
  isOpen: boolean;
  jobId: string | null;
  onClose: () => void;
  onComplete: (quizId: string) => void;
}

interface JobStatus {
  status: 'uploading' | 'starting' | 'processing' | 'completed' | 'failed';
  progress: number;
  message: string;
  error?: string;
  quizId?: string;
  questionCount?: number;
}

/**
 * PPTX 처리 진행 상황 모달
 * Cloud Run에서 처리 중인 작업 상태를 실시간으로 표시
 */
export default function PptxProgressModal({
  isOpen,
  jobId,
  onClose,
  onComplete,
}: PptxProgressModalProps) {
  const [jobStatus, setJobStatus] = useState<JobStatus>({
    status: 'uploading',
    progress: 0,
    message: '파일 업로드 중...',
  });

  // Firestore 실시간 구독
  useEffect(() => {
    if (!isOpen || !jobId) return;

    const unsubscribe = onSnapshot(
      doc(db, 'quizJobs', jobId),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setJobStatus({
            status: data.status || 'processing',
            progress: data.progress || 0,
            message: data.message || '처리 중...',
            error: data.error,
            quizId: data.quizId,
            questionCount: data.questionCount,
          });

          // 완료 시 콜백 호출
          if (data.status === 'completed' && data.quizId) {
            setTimeout(() => {
              onComplete(data.quizId);
            }, 1000);
          }
        }
      },
      (error) => {
        console.error('Job status 구독 오류:', error);
        setJobStatus((prev) => ({
          ...prev,
          status: 'failed',
          error: '상태 확인 중 오류가 발생했습니다.',
        }));
      }
    );

    return () => unsubscribe();
  }, [isOpen, jobId, onComplete]);

  // 상태별 아이콘 및 색상
  const getStatusDisplay = () => {
    switch (jobStatus.status) {
      case 'uploading':
        return {
          icon: (
            <svg className="w-8 h-8 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          ),
          color: '#1A1A1A',
        };
      case 'starting':
      case 'processing':
        return {
          icon: (
            <div className="w-8 h-8 border-3 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
          ),
          color: '#1A1A1A',
        };
      case 'completed':
        return {
          icon: (
            <svg className="w-8 h-8 text-[#1A6B1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ),
          color: '#1A6B1A',
        };
      case 'failed':
        return {
          icon: (
            <svg className="w-8 h-8 text-[#8B1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ),
          color: '#8B1A1A',
        };
      default:
        return {
          icon: <div className="w-8 h-8" />,
          color: '#1A1A1A',
        };
    }
  };

  const statusDisplay = getStatusDisplay();

  // ESC 키로 닫기 (완료 또는 실패 시에만)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (jobStatus.status === 'completed' || jobStatus.status === 'failed')) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, jobStatus.status, onClose]);

  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          {/* 백드롭 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* 모달 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] shadow-[4px_4px_0px_#1A1A1A] p-6"
          >
            {/* 상태 아이콘 */}
            <div className="flex justify-center mb-4">{statusDisplay.icon}</div>

            {/* 메시지 */}
            <h3 className="text-center text-lg font-bold text-[#1A1A1A] mb-2">
              {jobStatus.status === 'completed'
                ? 'PPT 퀴즈 생성 완료!'
                : jobStatus.status === 'failed'
                ? '처리 실패'
                : 'PPT 퀴즈 생성 중...'}
            </h3>
            <p className="text-center text-sm text-[#5C5C5C] mb-4">{jobStatus.message}</p>

            {/* 진행률 바 */}
            {jobStatus.status !== 'failed' && (
              <div className="mb-4">
                <div className="h-3 bg-[#E5E5E5] border border-[#1A1A1A] overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${jobStatus.progress}%` }}
                    transition={{ duration: 0.3 }}
                    className="h-full"
                    style={{ backgroundColor: statusDisplay.color }}
                  />
                </div>
                <p className="text-right text-xs text-[#5C5C5C] mt-1">{jobStatus.progress}%</p>
              </div>
            )}

            {/* 에러 메시지 */}
            {jobStatus.error && (
              <div className="p-3 bg-[#FEE2E2] border border-[#8B1A1A] mb-4">
                <p className="text-sm text-[#8B1A1A]">{jobStatus.error}</p>
              </div>
            )}

            {/* 완료 정보 */}
            {jobStatus.status === 'completed' && jobStatus.questionCount && (
              <div className="p-3 bg-[#DCFCE7] border border-[#1A6B1A] mb-4">
                <p className="text-sm text-[#1A6B1A] font-semibold text-center">
                  {jobStatus.questionCount}개의 문제가 생성되었습니다!
                </p>
              </div>
            )}

            {/* 버튼 */}
            {(jobStatus.status === 'completed' || jobStatus.status === 'failed') && (
              <button
                onClick={onClose}
                className="w-full py-3 font-bold text-lg border-2 border-[#1A1A1A] bg-[#1A1A1A] text-white hover:bg-[#3A3A3A] transition-colors"
              >
                {jobStatus.status === 'completed' ? '확인' : '닫기'}
              </button>
            )}

            {/* 처리 중 안내 */}
            {jobStatus.status !== 'completed' && jobStatus.status !== 'failed' && (
              <p className="text-center text-xs text-[#9A9A9A]">
                창을 닫아도 백그라운드에서 계속 처리됩니다
              </p>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
