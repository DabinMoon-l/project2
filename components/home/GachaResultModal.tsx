'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import RabbitImage from '@/components/common/RabbitImage';

/** Roll 결과 (spinRabbitGacha 반환값) */
export interface RollResultData {
  type: 'undiscovered' | 'discovered' | 'already_discovered';
  rabbitId: number;
  rabbitName: string | null;
  nextDiscoveryOrder: number | null;
  myDiscoveryOrder: number | null;
  equippedCount: number;
}

interface GachaResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: RollResultData | null;
  isAnimating: boolean;
  onSpin: () => void;
  canGacha: boolean;
  /** 발견하기 (미발견: 이름 포함, 기발견: 이름 없음) */
  onDiscover: (result: RollResultData, name?: string, equipSlot?: number) => void;
}

/**
 * 뽑기 결과 모달 (2단계: Roll → 사용자 선택)
 *
 * - 준비 → 뽑기 애니메이션 → 결과:
 *   - undiscovered: "새로운 토끼 발견!" + 이름 입력 + [발견하기] / [놓아주기]
 *   - discovered: "이름 N세" + [발견하기] / [놓아주기]
 *   - already_discovered: "이미 발견한 토끼예요!" + [확인]
 * - 슬롯 2개 찼을 때: 발견하기 버튼 아래에 인라인 슬롯 선택 UI
 */
export default function GachaResultModal({
  isOpen,
  onClose,
  result,
  isAnimating,
  onSpin,
  canGacha,
  onDiscover,
}: GachaResultModalProps) {
  const [newName, setNewName] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);

  // 모달 열림 시 네비게이션 숨김
  useEffect(() => {
    if (isOpen) {
      document.body.setAttribute('data-hide-nav', '');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => document.body.removeAttribute('data-hide-nav');
  }, [isOpen]);

  const slotsAreFull = result ? result.equippedCount >= 2 : false;

  const handleDiscover = () => {
    if (!result) return;

    if (result.type === 'undiscovered' && !newName.trim()) return;

    const name = result.type === 'undiscovered' ? newName.trim() : undefined;
    const slot = slotsAreFull ? (selectedSlot ?? undefined) : undefined;

    onDiscover(result, name, slot);
    setNewName('');
    setSelectedSlot(null);
  };

  const handlePass = () => {
    setNewName('');
    setSelectedSlot(null);
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
            {isAnimating ? (
              /* 뽑기 애니메이션 */
              <div className="text-center py-12">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="text-8xl inline-block"
                >
                  🎰
                </motion.div>
                <p className="mt-4 font-bold">뽑는 중...</p>
              </div>
            ) : result ? (
              /* 결과 표시 */
              <div className="text-center">
                <div className="flex justify-center mb-4">
                  <RabbitImage rabbitId={result.rabbitId} size={120} className="drop-shadow-lg" />
                </div>

                {result.type === 'undiscovered' ? (
                  /* 미발견 — 최초 발견 + 이름 짓기 */
                  <>
                    <div className="mb-4">
                      <span className="px-3 py-1 bg-[#D4AF37] text-white text-sm font-bold">
                        새로운 토끼 발견!
                      </span>
                    </div>
                    <p className="text-lg font-bold mb-2">
                      토끼 #{result.rabbitId + 1}을 처음 발견했어요!
                    </p>
                    <p className="text-sm text-[#5C5C5C] mb-4">
                      이름을 지어주세요
                    </p>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="토끼 이름 (1-10자)"
                      maxLength={10}
                      className="w-full p-3 border-2 border-[#1A1A1A] text-center text-lg font-bold mb-4"
                    />

                    {/* 슬롯 선택 (가득 찼을 때) */}
                    {slotsAreFull && (
                      <SlotSelector
                        selectedSlot={selectedSlot}
                        onSelect={setSelectedSlot}
                      />
                    )}

                    <button
                      onClick={handleDiscover}
                      disabled={!newName.trim() || (slotsAreFull && selectedSlot === null)}
                      className="w-full py-3 bg-[#1A1A1A] text-white font-bold disabled:opacity-50 mb-2"
                    >
                      발견하기
                    </button>
                    <button
                      onClick={handlePass}
                      className="w-full py-2 text-[#5C5C5C]"
                    >
                      놓아주기
                    </button>
                  </>
                ) : result.type === 'discovered' ? (
                  /* 기발견 — 후속 발견 */
                  <>
                    <p className="text-lg font-bold mb-2">
                      {result.rabbitName || `토끼 #${result.rabbitId + 1}`}
                    </p>
                    <p className="text-sm text-[#5C5C5C] mb-1">
                      {result.nextDiscoveryOrder}번째 발견자가 될 수 있어요!
                    </p>
                    <p className="text-sm text-[#5C5C5C] mb-4">
                      발견하면 도감에 추가됩니다
                    </p>

                    {/* 슬롯 선택 (가득 찼을 때) */}
                    {slotsAreFull && (
                      <SlotSelector
                        selectedSlot={selectedSlot}
                        onSelect={setSelectedSlot}
                      />
                    )}

                    <button
                      onClick={handleDiscover}
                      disabled={slotsAreFull && selectedSlot === null}
                      className="w-full py-3 bg-[#1A1A1A] text-white font-bold disabled:opacity-50 mb-2"
                    >
                      발견하기
                    </button>
                    <button
                      onClick={handlePass}
                      className="w-full py-2 text-[#5C5C5C]"
                    >
                      놓아주기
                    </button>
                  </>
                ) : (
                  /* 이미 발견 */
                  <>
                    <p className="text-lg font-bold mb-2">
                      {result.rabbitName || `토끼 #${result.rabbitId + 1}`}
                      {result.myDiscoveryOrder && result.myDiscoveryOrder >= 2
                        ? ` ${result.myDiscoveryOrder}세`
                        : ''}
                    </p>
                    <p className="text-sm text-[#5C5C5C] mb-4">이미 발견한 토끼예요!</p>
                    <button
                      onClick={() => {
                        setNewName('');
                        setSelectedSlot(null);
                        onClose();
                      }}
                      className="w-full py-3 bg-[#1A1A1A] text-white font-bold"
                    >
                      확인
                    </button>
                  </>
                )}
              </div>
            ) : (
              /* 뽑기 준비 */
              <div className="text-center">
                <div className="text-8xl mb-4">🎁</div>
                <p className="text-lg font-bold mb-2">뽑기 준비 완료!</p>
                <p className="text-sm text-[#5C5C5C] mb-6">
                  50 XP를 달성했어요!
                  <br />
                  새로운 토끼를 만나보세요
                </p>
                <button
                  onClick={onSpin}
                  disabled={!canGacha}
                  className="w-full py-3 bg-[#1A1A1A] text-white font-bold disabled:opacity-50"
                >
                  뽑기!
                </button>
                <button
                  onClick={onClose}
                  className="w-full py-2 mt-2 text-[#5C5C5C]"
                >
                  나중에 하기
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * 슬롯 선택 UI (인라인)
 */
function SlotSelector({
  selectedSlot,
  onSelect,
}: {
  selectedSlot: number | null;
  onSelect: (slot: number) => void;
}) {
  return (
    <div className="mb-4 p-3 bg-[#EDEAE4] border border-[#D4CFC4]">
      <p className="text-xs text-[#5C5C5C] mb-2">
        장착 슬롯이 가득 찼어요. 교체할 슬롯을 선택하세요:
      </p>
      <div className="flex gap-2">
        {[0, 1].map((slot) => (
          <button
            key={slot}
            onClick={() => onSelect(slot)}
            className={`flex-1 py-2 border-2 text-sm font-bold ${
              selectedSlot === slot
                ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                : 'border-[#D4CFC4]'
            }`}
          >
            슬롯 {slot + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
