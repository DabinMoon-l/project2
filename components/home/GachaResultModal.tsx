'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import RabbitImage from '@/components/common/RabbitImage';

/** Roll 결과 (spinRabbitGacha 반환값) */
export interface RollResultData {
  type: 'undiscovered' | 'discovered';
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
  onDiscover: (result: RollResultData, name?: string, equipSlot?: number) => Promise<void>;
  /** 뽑기(스핀) 에러 메시지 */
  spinError?: string | null;
}

/**
 * 뽑기 애니메이션 — Framer Motion 기반
 * 빛나는 원 + ? 실루엣, 건너뛰기 버튼
 */
function GachaAnimation({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="relative text-center py-12">
      {/* 건너뛰기 버튼 */}
      <button
        onClick={onSkip}
        className="absolute top-0 right-0 text-sm text-white/50 px-3 py-1"
      >
        건너뛰기
      </button>

      {/* 빛나는 원 */}
      <motion.div
        className="inline-block relative"
        animate={{
          scale: [1, 1.1, 1],
        }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <motion.div
          className="w-32 h-32 rounded-full mx-auto flex items-center justify-center"
          style={{
            background: 'radial-gradient(circle, rgba(212,175,55,0.4) 0%, rgba(212,175,55,0.1) 50%, transparent 70%)',
            boxShadow: '0 0 40px 10px rgba(212,175,55,0.3)',
          }}
          animate={{
            boxShadow: [
              '0 0 40px 10px rgba(212,175,55,0.3)',
              '0 0 60px 20px rgba(212,175,55,0.5)',
              '0 0 40px 10px rgba(212,175,55,0.3)',
            ],
          }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          <motion.span
            className="text-6xl font-bold text-[#D4AF37]/60"
            animate={{ opacity: [0.4, 0.8, 0.4], scale: [0.9, 1.1, 0.9] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            ?
          </motion.span>
        </motion.div>
      </motion.div>

      <p className="mt-4 font-bold text-white/60">새로운 토끼를 찾고 있어요...</p>
    </div>
  );
}

/**
 * 뽑기 결과 모달 (2단계: Roll → 사용자 선택)
 * 홈 스타일 (home-bg + 글래스모피즘)
 */
export default function GachaResultModal({
  isOpen,
  onClose,
  result,
  isAnimating,
  onSpin,
  canGacha,
  onDiscover,
  spinError,
}: GachaResultModalProps) {
  const [newName, setNewName] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [skipped, setSkipped] = useState(false);

  // 모달 열림 시 네비게이션 숨김
  useEffect(() => {
    if (isOpen) {
      document.body.setAttribute('data-hide-nav', '');
      setSkipped(false);
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => document.body.removeAttribute('data-hide-nav');
  }, [isOpen]);

  // 결과 도착 시 skipped 해제 불필요 — result 존재하면 결과 표시
  const slotsAreFull = result ? result.equippedCount >= 2 : false;

  const handleDiscover = useCallback(async () => {
    if (!result) return;
    if (result.type === 'undiscovered' && !newName.trim()) return;

    setNameError(null);
    setIsDiscovering(true);

    const name = result.type === 'undiscovered' ? newName.trim() : undefined;
    const slot = slotsAreFull ? (selectedSlot ?? undefined) : undefined;

    try {
      await onDiscover(result, name, slot);
      setNewName('');
      setSelectedSlot(null);
    } catch (err: any) {
      // 이름 중복 에러 핸들링
      const code = err?.code || '';
      const msg = err?.message || '';
      if (code.includes('already-exists') || msg.includes('같은 이름')) {
        setNameError('이미 같은 이름의 토끼가 있어요!');
      } else {
        setNameError(msg || '발견하기에 실패했습니다.');
      }
    } finally {
      setIsDiscovering(false);
    }
  }, [result, newName, slotsAreFull, selectedSlot, onDiscover]);

  const showResult = result && (!isAnimating || skipped);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        >
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.8 }}
            className="w-full max-w-sm mx-4 relative overflow-hidden rounded-2xl"
          >
            {/* 배경 이미지 + 글래스 오버레이 */}
            <div className="absolute inset-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
            </div>
            <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />

            {/* 컨텐츠 */}
            <div className="relative z-10 p-6">
              {isAnimating && !skipped ? (
                /* 뽑기 애니메이션 */
                <GachaAnimation onSkip={() => setSkipped(true)} />
              ) : isAnimating && skipped ? (
                /* 건너뛰기 후 결과 대기 */
                <div className="text-center py-12">
                  <motion.div
                    className="w-16 h-16 mx-auto rounded-full border-4 border-[#D4AF37] border-t-transparent"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  />
                  <p className="mt-4 font-bold text-white/60">결과를 기다리는 중...</p>
                </div>
              ) : showResult ? (
                /* 결과 표시 */
                <div className="text-center">
                  {/* 토끼 이미지 — 골든 글로우 + scale-up */}
                  <motion.div
                    className="flex justify-center mb-4"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', damping: 12, stiffness: 150 }}
                  >
                    <div
                      className="relative"
                      style={{
                        filter: 'drop-shadow(0 0 12px rgba(212,175,55,0.5))',
                      }}
                    >
                      <RabbitImage rabbitId={result.rabbitId} size={120} className="drop-shadow-lg" />
                    </div>
                  </motion.div>

                  {result.type === 'undiscovered' ? (
                    /* 미발견 — 최초 발견 (부모) + 이름 짓기 */
                    <>
                      <div className="mb-4">
                        <span className="px-3 py-1 bg-[#D4AF37] text-white text-sm font-bold rounded-full">
                          새로운 토끼 발견!
                        </span>
                      </div>
                      <p className="text-lg font-bold text-white mb-2">
                        토끼 #{result.rabbitId + 1}의 부모가 되었어요!
                      </p>
                      <p className="text-sm text-white/60 mb-4">
                        이름을 지어주세요
                      </p>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => { setNewName(e.target.value); setNameError(null); }}
                        placeholder="토끼 이름 (1-10자)"
                        maxLength={10}
                        className={`w-full p-3 bg-white/15 border rounded-xl text-center text-lg font-bold text-white placeholder-white/40 mb-2 outline-none focus:ring-2 focus:ring-white/30 ${
                          nameError ? 'border-red-400' : 'border-white/20'
                        }`}
                      />
                      {nameError && (
                        <p className="text-sm text-red-400 mb-2">{nameError}</p>
                      )}

                      {/* 슬롯 선택 (가득 찼을 때) */}
                      {slotsAreFull && (
                        <SlotSelector
                          selectedSlot={selectedSlot}
                          onSelect={setSelectedSlot}
                        />
                      )}

                      <button
                        onClick={handleDiscover}
                        disabled={!newName.trim() || isDiscovering}
                        className="w-full py-3 bg-white/25 text-white font-bold border border-white/30 rounded-full disabled:opacity-40"
                      >
                        {isDiscovering ? '이름 짓는 중...' : '이름 짓고 데려가기'}
                      </button>
                    </>
                  ) : (
                    /* 기발견 — 후속 발견 (N대 집사) */
                    <>
                      <p className="text-lg font-bold text-white mb-2">
                        {result.rabbitName || `토끼 #${result.rabbitId + 1}`}
                      </p>
                      <p className="text-sm text-white/60 mb-1">
                        {result.nextDiscoveryOrder}대 집사가 될 수 있어요!
                      </p>
                      <p className="text-sm text-white/60 mb-4">
                        데려가면 도감에 추가됩니다
                      </p>

                      {nameError && (
                        <p className="text-sm text-red-400 mb-2">{nameError}</p>
                      )}

                      {/* 슬롯 선택 (가득 찼을 때) */}
                      {slotsAreFull && (
                        <SlotSelector
                          selectedSlot={selectedSlot}
                          onSelect={setSelectedSlot}
                        />
                      )}

                      <button
                        onClick={handleDiscover}
                        disabled={isDiscovering}
                        className="w-full py-3 bg-white/25 text-white font-bold border border-white/30 rounded-full disabled:opacity-40"
                      >
                        {isDiscovering ? '데려가는 중...' : '데려가기'}
                      </button>
                    </>
                  )}
                </div>
              ) : (
                /* 뽑기 준비 (스핀 전) */
                <div className="text-center">
                  <div className="w-24 h-24 mx-auto mb-4 rounded-full flex items-center justify-center"
                    style={{
                      background: 'radial-gradient(circle, rgba(212,175,55,0.2) 0%, transparent 70%)',
                    }}
                  >
                    <span className="text-5xl text-white/60">?</span>
                  </div>
                  <p className="text-lg font-bold text-white mb-2">새 토끼 뽑기</p>
                  <p className="text-sm text-white/60 mb-6">
                    어떤 토끼를 만나게 될까요?
                  </p>
                  {spinError && (
                    <p className="text-sm text-red-400 mb-4">{spinError}</p>
                  )}
                  <button
                    onClick={onSpin}
                    disabled={!canGacha || !!spinError}
                    className="w-full py-3 bg-white/25 text-white font-bold border border-white/30 rounded-full disabled:opacity-40"
                  >
                    뽑기!
                  </button>
                  <button
                    onClick={onClose}
                    className="w-full py-2 mt-2 text-white/50"
                  >
                    나중에 하기
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
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
    <div className="mb-4 p-3 bg-white/10 border border-white/15 rounded-xl">
      <p className="text-xs text-white/50 mb-2">
        장착도 하려면 교체할 슬롯을 선택하세요 (선택):
      </p>
      <div className="flex gap-2">
        {[0, 1].map((slot) => (
          <button
            key={slot}
            onClick={() => onSelect(slot)}
            className={`flex-1 py-2 border rounded-lg text-sm font-bold text-white ${
              selectedSlot === slot
                ? 'border-[#D4AF37] bg-[#D4AF37]/20'
                : 'border-white/20 bg-white/5'
            }`}
          >
            슬롯 {slot + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
