'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import RabbitImage from '@/components/common/RabbitImage';

const OPEN_MS = 380;
const CLOSE_MS = 320;
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

type Phase = 'hidden' | 'entering' | 'open' | 'exiting';

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
  onDiscover: (result: RollResultData, name?: string, equipSlot?: number) => Promise<void>;
  spinError?: string | null;
}

/**
 * 뽑기 애니메이션 — 빛나는 원 + ? 실루엣
 */
function GachaAnimation({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="relative text-center py-8">
      <button
        onClick={onSkip}
        className="absolute top-0 right-0 text-xs text-white/50 px-2 py-1"
      >
        건너뛰기
      </button>
      <motion.div
        className="inline-block relative"
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <motion.div
          className="w-24 h-24 rounded-full mx-auto flex items-center justify-center"
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
            className="text-4xl font-bold text-[#D4AF37]/60"
            animate={{ opacity: [0.4, 0.8, 0.4], scale: [0.9, 1.1, 0.9] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            ?
          </motion.span>
        </motion.div>
      </motion.div>
      <p className="mt-3 text-sm font-bold text-white/60">새로운 토끼를 찾고 있어요...</p>
    </div>
  );
}

/**
 * 뽑기 결과 모달 — 요술지니 애니메이션
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

  // 요술지니 phase
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<Phase>('hidden');
  const phaseRef = useRef<Phase>('hidden');

  // 모달 재오픈 시 모든 상태 초기화
  useEffect(() => {
    if (isOpen) {
      setSkipped(false);
      setNewName('');
      setSelectedSlot(null);
      setNameError(null);
      setIsDiscovering(false);
    }
  }, [isOpen]);

  // 열기
  useEffect(() => {
    if (isOpen && phaseRef.current === 'hidden') {
      setVisible(true);
      setPhase('entering');
      phaseRef.current = 'entering';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (phaseRef.current === 'entering') {
            setPhase('open');
            phaseRef.current = 'open';
          }
        });
      });
    }
  }, [isOpen]);

  // 외부 즉시 닫기
  useEffect(() => {
    if (!isOpen && phaseRef.current !== 'hidden' && phaseRef.current !== 'exiting') {
      setVisible(false);
      setPhase('hidden');
      phaseRef.current = 'hidden';
    }
  }, [isOpen]);

  // 닫기 애니메이션
  const runClose = useCallback(() => {
    if (phaseRef.current === 'exiting') return;
    setPhase('exiting');
    phaseRef.current = 'exiting';
    setTimeout(() => {
      onClose();
      setVisible(false);
      setPhase('hidden');
      phaseRef.current = 'hidden';
    }, CLOSE_MS);
  }, [onClose]);

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
  const isTransition = phase === 'entering' || phase === 'exiting';
  const dur = phase === 'exiting' ? CLOSE_MS : OPEN_MS;

  if (!visible) return null;

  return createPortal(
    <>
      {/* 백드롭 */}
      <div
        className="fixed inset-0 z-[110] bg-black/60"
        style={{
          left: 'var(--modal-left, 0px)',
          opacity: isTransition ? 0 : 1,
          transition: `opacity ${dur}ms ease`,
        }}
      />
      {/* 모달 — 요술지니 (중앙) */}
      <div
        className="fixed inset-0 z-[111] flex items-center justify-center pointer-events-none"
        style={{
          left: 'var(--modal-left, 0px)',
          transform: isTransition ? 'scale(0)' : 'scale(1)',
          opacity: isTransition ? 0 : 1,
          transformOrigin: 'center center',
          transition: `transform ${dur}ms ${EASE}, opacity ${dur}ms ${EASE}`,
          willChange: phase !== 'open' ? 'transform, opacity' : undefined,
        }}
      >
        <div className="pointer-events-auto w-full max-w-[280px] mx-4 relative overflow-hidden rounded-2xl">
          {/* 배경 */}
          <div className="absolute inset-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
          </div>
          <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />

          {/* 컨텐츠 */}
          <div className="relative z-10 p-4">
            {isAnimating && !skipped ? (
              <GachaAnimation onSkip={() => setSkipped(true)} />
            ) : isAnimating && skipped ? (
              <div className="text-center py-8">
                <motion.div
                  className="w-12 h-12 mx-auto rounded-full border-3 border-[#D4AF37] border-t-transparent"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                />
                <p className="mt-3 text-sm font-bold text-white/60">결과를 기다리는 중...</p>
              </div>
            ) : showResult ? (
              <div className="text-center">
                <motion.div
                  className="flex justify-center mb-3"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', damping: 12, stiffness: 150 }}
                >
                  <div
                    className="relative"
                    style={{ filter: 'drop-shadow(0 0 12px rgba(212,175,55,0.5))' }}
                  >
                    <RabbitImage rabbitId={result.rabbitId} size={88} className="drop-shadow-lg" />
                  </div>
                </motion.div>

                {result.type === 'undiscovered' ? (
                  <>
                    <div className="mb-3">
                      <span className="px-2.5 py-0.5 bg-[#D4AF37] text-white text-xs font-bold rounded-full">
                        새로운 토끼 발견!
                      </span>
                    </div>
                    <p className="text-sm font-bold text-white mb-1.5">
                      토끼 #{result.rabbitId + 1}의 부모가 되었어요!
                    </p>
                    <p className="text-xs text-white/60 mb-3">이름을 지어주세요</p>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => { setNewName(e.target.value); setNameError(null); }}
                      placeholder="토끼 이름 (1-10자)"
                      maxLength={10}
                      className={`w-full p-2 bg-white/15 border rounded-xl text-center text-sm font-bold text-white placeholder-white/40 mb-2 outline-none focus:ring-2 focus:ring-white/30 ${
                        nameError ? 'border-red-400' : 'border-white/20'
                      }`}
                    />
                    {nameError && <p className="text-sm text-red-400 mb-2">{nameError}</p>}
                    {slotsAreFull && (
                      <SlotSelector selectedSlot={selectedSlot} onSelect={setSelectedSlot} />
                    )}
                    <button
                      onClick={handleDiscover}
                      disabled={!newName.trim() || isDiscovering}
                      className="w-full py-2 text-sm bg-white/25 text-white font-bold border border-white/30 rounded-full disabled:opacity-40"
                    >
                      {isDiscovering ? '이름 짓는 중...' : '이름 짓고 데려가기'}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold text-white mb-1.5">
                      {result.rabbitName || `토끼 #${result.rabbitId + 1}`}
                    </p>
                    <p className="text-xs text-white/60 mb-1">
                      {result.nextDiscoveryOrder}대 집사가 될 수 있어요!
                    </p>
                    <p className="text-xs text-white/60 mb-3">데려가면 도감에 추가됩니다</p>
                    {nameError && <p className="text-sm text-red-400 mb-2">{nameError}</p>}
                    {slotsAreFull && (
                      <SlotSelector selectedSlot={selectedSlot} onSelect={setSelectedSlot} />
                    )}
                    <button
                      onClick={handleDiscover}
                      disabled={isDiscovering}
                      className="w-full py-2 text-sm bg-white/25 text-white font-bold border border-white/30 rounded-full disabled:opacity-40"
                    >
                      {isDiscovering ? '데려가는 중...' : '데려가기'}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center"
                  style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.2) 0%, transparent 70%)' }}
                >
                  <span className="text-3xl text-white/60">?</span>
                </div>
                <p className="text-sm font-bold text-white mb-1.5">새 토끼 뽑기</p>
                <p className="text-xs text-white/60 mb-4">어떤 토끼를 만나게 될까요?</p>
                {spinError && <p className="text-xs text-red-400 mb-3">{spinError}</p>}
                <button
                  onClick={onSpin}
                  disabled={!canGacha || !!spinError}
                  className="w-full py-2 text-sm bg-white/25 text-white font-bold border border-white/30 rounded-full disabled:opacity-40"
                >
                  뽑기!
                </button>
                <button
                  onClick={runClose}
                  className="w-full py-1.5 mt-1.5 text-white/50 text-xs"
                >
                  나중에 하기
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

function SlotSelector({
  selectedSlot,
  onSelect,
}: {
  selectedSlot: number | null;
  onSelect: (slot: number) => void;
}) {
  return (
    <div className="mb-3 p-2 bg-white/10 border border-white/15 rounded-xl">
      <p className="text-[10px] text-white/50 mb-1.5">
        장착도 하려면 교체할 슬롯을 선택하세요 (선택):
      </p>
      <div className="flex gap-1.5">
        {[0, 1].map((slot) => (
          <button
            key={slot}
            onClick={() => onSelect(slot)}
            className={`flex-1 py-1.5 border rounded-lg text-xs font-bold text-white ${
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
