'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { RabbitHolding } from '@/lib/hooks/useRabbit';
import type { RollResultData } from './GachaResultModal';
import { computeRabbitDisplayName } from '@/lib/utils/rabbitDisplayName';

interface RabbitReplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Roll에서 받은 결과 */
  rollResult: RollResultData;
  /** 새 집사일 때 지은 이름 */
  newName?: string;
  courseId: string;
  /** 현재 보유 토끼 목록 */
  courseHoldings: RabbitHolding[];
  /** 토끼 이름 맵 (docId → 이름) */
  rabbitNames: Map<string, string | null>;
}

/**
 * 토끼 교체 모달
 *
 * 3마리 보유 상태에서 새 토끼를 뽑았을 때,
 * 기존 토끼 중 1마리를 선택해 내보내고 새 토끼로 교체
 */
export default function RabbitReplaceModal({
  isOpen,
  onClose,
  rollResult,
  newName,
  courseId,
  courseHoldings,
  rabbitNames,
}: RabbitReplaceModalProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleReplace = async () => {
    if (!selectedKey) return;
    setIsProcessing(true);

    try {
      const claimGachaRabbit = httpsCallable(functions, 'claimGachaRabbit');
      await claimGachaRabbit({
        courseId,
        rabbitId: rollResult.rabbitId,
        action: 'adopt',
        name: newName,
        replaceKey: selectedKey,
      });
      setSelectedKey(null);
      onClose();
    } catch (error) {
      console.error('교체 실패:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGiveUp = () => {
    // 포기 → 모달 닫기 (adopt 하지 않음)
    setSelectedKey(null);
    onClose();
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
              <p className="text-lg font-bold mb-1">토끼를 3마리까지만 키울 수 있어요!</p>
              <p className="text-sm text-[#5C5C5C]">
                {rollResult.type === 'undiscovered'
                  ? `토끼 #${rollResult.rabbitId}의 집사가 되려면`
                  : `${rollResult.currentRabbitName || `토끼 #${rollResult.rabbitId}`}을 데려오려면`
                }
                <br />
                기존 토끼 하나를 내보내야 해요.
              </p>
            </div>

            {/* 교체 대상 선택 */}
            <div className="mb-4">
              <p className="text-sm font-bold mb-2">내보낼 토끼를 선택하세요</p>
              <div className="space-y-2">
                {courseHoldings.map((h) => {
                  const key = h.id;
                  const name = rabbitNames.get(key);
                  const displayName = computeRabbitDisplayName(
                    name,
                    h.generationIndex,
                    h.rabbitId
                  );

                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedKey(key)}
                      disabled={isProcessing}
                      className={`w-full p-3 border-2 text-left flex items-center gap-3 ${
                        selectedKey === key
                          ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                          : 'border-[#D4CFC4]'
                      }`}
                    >
                      <span className="text-2xl">🐰</span>
                      <div>
                        <p className="font-bold text-sm">{displayName}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[#5C5C5C]">#{h.rabbitId}</span>
                          {h.isButler && (
                            <span className="text-xs px-1 py-0.5 bg-[#D4AF37] text-white">
                              집사
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 액션 버튼 */}
            <button
              onClick={handleReplace}
              disabled={selectedKey === null || isProcessing}
              className="w-full py-3 bg-[#D4AF37] text-white font-bold disabled:opacity-50 mb-2"
            >
              {isProcessing ? '처리 중...' : '교체하기'}
            </button>
            <button
              onClick={handleGiveUp}
              disabled={isProcessing}
              className="w-full py-2 text-[#5C5C5C] text-sm"
            >
              포기하기
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
