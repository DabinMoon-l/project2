'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { RabbitHolding } from '@/lib/hooks/useRabbit';

interface ButlerOverflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 새로 뽑힌 토끼 정보 */
  newRabbitId: number;
  courseId: string;
  /** 현재 집사인 토끼 목록 (holdings에서 isButler=true) */
  butlerHoldings: RabbitHolding[];
  /** 토끼 이름 맵 (rabbitId → 이름) */
  rabbitNames: Record<number, string | null>;
}

/**
 * 집사 3마리 초과 모달
 *
 * - 기존 토끼 하나를 졸업시키고 새 토끼 집사 확정
 * - 또는 새 토끼를 세대 보유자로 전환
 */
export default function ButlerOverflowModal({
  isOpen,
  onClose,
  newRabbitId,
  courseId,
  butlerHoldings,
  rabbitNames,
}: ButlerOverflowModalProps) {
  const [selectedGraduateId, setSelectedGraduateId] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleGraduateAndAccept = async () => {
    if (selectedGraduateId === null) return;
    setIsProcessing(true);

    try {
      // 1. 기존 토끼 졸업
      const graduateButlerRabbit = httpsCallable(functions, 'graduateButlerRabbit');
      await graduateButlerRabbit({
        courseId,
        rabbitId: selectedGraduateId,
      });

      // 2. 새 토끼 집사 확정
      const resolveButlerOverflow = httpsCallable(functions, 'resolveButlerOverflow');
      await resolveButlerOverflow({
        courseId,
        rabbitId: newRabbitId,
        action: 'graduate_existing',
        graduateRabbitId: selectedGraduateId,
        graduateCourseId: courseId,
      });

      onClose();
    } catch (error) {
      console.error('졸업/승계 실패:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDecline = async () => {
    setIsProcessing(true);
    try {
      const resolveButlerOverflow = httpsCallable(functions, 'resolveButlerOverflow');
      await resolveButlerOverflow({
        courseId,
        rabbitId: newRabbitId,
        action: 'decline_butler',
      });
      onClose();
    } catch (error) {
      console.error('거절 실패:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
        >
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.8 }}
            className="w-full max-w-sm mx-4 bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            <div className="text-center mb-4">
              <div className="text-5xl mb-3">🐰✨</div>
              <p className="text-lg font-bold mb-1">집사 자리가 가득 찼어요!</p>
              <p className="text-sm text-[#5C5C5C]">
                토끼 #{newRabbitId}의 집사가 될 수 있지만,
                <br />
                이미 3마리의 집사예요.
              </p>
            </div>

            {/* 졸업 대상 선택 */}
            <div className="mb-4">
              <p className="text-sm font-bold mb-2">기존 토끼 하나를 졸업시킬까요?</p>
              <div className="space-y-2">
                {butlerHoldings.map((h) => (
                  <button
                    key={h.rabbitId}
                    onClick={() => setSelectedGraduateId(h.rabbitId)}
                    disabled={isProcessing}
                    className={`w-full p-3 border-2 text-left flex items-center gap-3 ${
                      selectedGraduateId === h.rabbitId
                        ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                        : 'border-[#D4CFC4]'
                    }`}
                  >
                    <span className="text-2xl">🐰</span>
                    <div>
                      <p className="font-bold text-sm">
                        {rabbitNames[h.rabbitId] || `토끼 #${h.rabbitId}`}
                      </p>
                      <p className="text-xs text-[#5C5C5C]">#{h.rabbitId}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 액션 버튼 */}
            <button
              onClick={handleGraduateAndAccept}
              disabled={selectedGraduateId === null || isProcessing}
              className="w-full py-3 bg-[#D4AF37] text-white font-bold disabled:opacity-50 mb-2"
            >
              {isProcessing ? '처리 중...' : '졸업시키고 새 토끼 집사하기'}
            </button>
            <button
              onClick={handleDecline}
              disabled={isProcessing}
              className="w-full py-3 border-2 border-[#1A1A1A] font-bold disabled:opacity-50 mb-2"
            >
              집사 포기 (세대 보유자로)
            </button>
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="w-full py-2 text-[#5C5C5C] text-sm"
            >
              나중에 결정하기
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
