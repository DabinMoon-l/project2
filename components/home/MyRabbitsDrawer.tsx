'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useRabbitHoldings, useRabbitsForCourse, type RabbitHolding } from '@/lib/hooks/useRabbit';
import { computeRabbitDisplayName } from '@/lib/utils/rabbitDisplayName';

interface MyRabbitsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  courseId: string;
  equippedRabbitId: number | null | undefined;
}

/**
 * 내 토끼 목록 드로어
 *
 * - 보유 토끼 목록 표시
 * - 장착/놓아주기 버튼
 */
export default function MyRabbitsDrawer({
  isOpen,
  onClose,
  userId,
  courseId,
  equippedRabbitId,
}: MyRabbitsDrawerProps) {
  const { holdings, loading: holdingsLoading } = useRabbitHoldings(userId);
  const { rabbits } = useRabbitsForCourse(courseId);
  const [processingId, setProcessingId] = useState<number | null>(null);

  // 토끼 이름 맵
  const nameMap = new Map<string, string | null>();
  rabbits.forEach((r) => nameMap.set(`${r.courseId}_${r.rabbitId}`, r.currentName));

  // 현재 과목 토끼만 필터
  const courseHoldings = holdings.filter((h) => h.courseId === courseId);

  const handleEquip = async (h: RabbitHolding) => {
    setProcessingId(h.rabbitId);
    try {
      const equipRabbit = httpsCallable(functions, 'equipRabbit');
      await equipRabbit({ courseId: h.courseId, rabbitId: h.rabbitId });
    } catch (error) {
      console.error('장착 실패:', error);
    } finally {
      setProcessingId(null);
    }
  };

  const handleRelease = async (h: RabbitHolding) => {
    if (!confirm('정말 이 토끼를 놓아주시겠어요?')) return;
    setProcessingId(h.rabbitId);
    try {
      const releaseRabbit = httpsCallable(functions, 'releaseRabbit');
      await releaseRabbit({ courseId: h.courseId, rabbitId: h.rabbitId });
    } catch (error) {
      console.error('놓아주기 실패:', error);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-0 left-0 right-0 max-h-[70vh] bg-[#F5F0E8] border-t-2 border-[#1A1A1A] flex flex-col"
          >
            {/* 핸들바 */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-[#D4CFC4] rounded-full" />
            </div>

            {/* 헤더 */}
            <div className="flex items-center justify-between px-4 pb-3 border-b border-[#D4CFC4]">
              <span className="font-bold text-lg">내 토끼</span>
              <span className="text-sm text-[#5C5C5C]">{courseHoldings.length}/3마리</span>
            </div>

            {/* 목록 */}
            <div className="flex-1 overflow-y-auto p-4">
              {holdingsLoading ? (
                <div className="text-center py-8 text-[#5C5C5C]">로딩 중...</div>
              ) : courseHoldings.length === 0 ? (
                <div className="text-center py-8 text-[#5C5C5C]">
                  아직 토끼가 없어요.
                  <br />
                  50 XP를 모아 첫 뽑기를 해보세요!
                </div>
              ) : (
                <div className="space-y-3">
                  {courseHoldings.map((h) => {
                    const rabbitName = nameMap.get(h.id);
                    const displayName = computeRabbitDisplayName(
                      rabbitName,
                      h.generationIndex,
                      h.rabbitId
                    );
                    const isEquipped = equippedRabbitId === h.rabbitId;
                    const isProcessing = processingId === h.rabbitId;

                    return (
                      <div
                        key={h.id}
                        className={`p-4 border-2 flex items-center gap-4 ${
                          isEquipped
                            ? 'border-[#D4AF37] bg-[#D4AF37]/5'
                            : 'border-[#D4CFC4]'
                        }`}
                      >
                        {/* 토끼 아이콘 */}
                        <div className="text-4xl flex-shrink-0">🐰</div>

                        {/* 정보 */}
                        <div className="flex-1 min-w-0">
                          <p className="font-bold truncate">{displayName}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-[#5C5C5C]">#{h.rabbitId}</span>
                            {h.isButler && (
                              <span className="text-xs px-1.5 py-0.5 bg-[#D4AF37] text-white">
                                집사
                              </span>
                            )}
                            {isEquipped && (
                              <span className="text-xs px-1.5 py-0.5 bg-[#1A1A1A] text-white">
                                장착중
                              </span>
                            )}
                          </div>
                        </div>

                        {/* 액션 */}
                        <div className="flex-shrink-0 flex gap-2">
                          {!isEquipped && (
                            <button
                              onClick={() => handleEquip(h)}
                              disabled={isProcessing}
                              className="px-3 py-1.5 text-xs border-2 border-[#1A1A1A] font-bold disabled:opacity-50"
                            >
                              장착
                            </button>
                          )}
                          <button
                            onClick={() => handleRelease(h)}
                            disabled={isProcessing}
                            className="px-3 py-1.5 text-xs border-2 border-[#8B1A1A] text-[#8B1A1A] font-bold disabled:opacity-50"
                          >
                            놓아주기
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 닫기 */}
            <div className="p-4 border-t border-[#D4CFC4]">
              <button
                onClick={onClose}
                className="w-full py-2 border-2 border-[#1A1A1A] font-bold"
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
