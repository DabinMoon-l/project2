'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { type RabbitHolding, getRabbitStats } from '@/lib/hooks/useRabbit';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';

const OPEN_MS = 380;
const CLOSE_MS = 320;
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

type Phase = 'hidden' | 'entering' | 'open' | 'exiting';

interface LevelUpResult {
  newLevel: number;
  oldStats: { hp: number; atk: number; def: number };
  newStats: { hp: number; atk: number; def: number };
  statIncreases: { hp: number; atk: number; def: number };
  totalPoints: number;
}

interface LevelUpBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  holdings: RabbitHolding[];
}

const RABBITS_PER_ROW = 20;

/**
 * 레벨업 바텀시트 — 요술지니 애니메이션
 */
export default function LevelUpBottomSheet({
  isOpen,
  onClose,
  courseId,
  holdings,
}: LevelUpBottomSheetProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<LevelUpResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 요술지니 phase
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<Phase>('hidden');
  const phaseRef = useRef<Phase>('hidden');

  const courseHoldings = holdings.filter((h) => h.courseId === courseId);
  const rows: RabbitHolding[][] = [];
  for (let i = 0; i < courseHoldings.length; i += RABBITS_PER_ROW) {
    rows.push(courseHoldings.slice(i, i + RABBITS_PER_ROW));
  }

  // 보유 토끼 없이 열리면 즉시 닫기 (빈 화면 + 네비 숨김 방지)
  useEffect(() => {
    if (isOpen && courseHoldings.length === 0) {
      onClose();
    }
  }, [isOpen, courseHoldings.length, onClose]);

  // 열릴 때 상태 초기화
  useEffect(() => {
    if (isOpen) {
      setSelectedIdx(0);
      setResult(null);
      setError(null);
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

  const handleLevelUp = useCallback(async () => {
    const holding = courseHoldings[selectedIdx];
    if (!holding) return;

    setIsLoading(true);
    setError(null);
    try {
      const levelUpRabbit = httpsCallable<
        { courseId: string; rabbitId: number },
        LevelUpResult
      >(functions, 'levelUpRabbit');
      const res = await levelUpRabbit({ courseId, rabbitId: holding.rabbitId });
      setResult(res.data);
    } catch (err: any) {
      const msg = err?.message || '레벨업에 실패했습니다.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [courseId, courseHoldings, selectedIdx]);

  const scrollRow = (rowIdx: number, direction: 'left' | 'right') => {
    const el = rowRefs.current[rowIdx];
    if (el) el.scrollBy({ left: direction === 'left' ? -200 : 200, behavior: 'smooth' });
  };

  const selected = courseHoldings[selectedIdx];
  const selectedInfo = selected ? getRabbitStats(selected) : null;

  if (courseHoldings.length === 0) return null;

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
        onClick={runClose}
      />
      {/* 모달 — 요술지니 (중앙) */}
      <div
        className="fixed inset-0 z-[111] flex items-end justify-center pointer-events-none"
        style={{
          left: 'var(--modal-left, 0px)',
          transform: isTransition ? 'scale(0)' : 'scale(1)',
          opacity: isTransition ? 0 : 1,
          transformOrigin: 'center center',
          transition: `transform ${dur}ms ${EASE}, opacity ${dur}ms ${EASE}`,
          willChange: phase !== 'open' ? 'transform, opacity' : undefined,
        }}
      >
        <div
          className="pointer-events-auto w-full relative overflow-hidden rounded-t-2xl"
          style={{ maxHeight: '80vh' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 배경 */}
          <div className="absolute inset-0">
            <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
          </div>
          <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />

          {/* 컨텐츠 */}
          <div className="relative z-10 px-4 pt-3 pb-8 overflow-y-auto" style={{ maxHeight: '80vh' }}>
            {/* 핸들 바 */}
            <div className="flex justify-center mb-3">
              <div className="w-10 h-1 bg-white/30 rounded-full" />
            </div>

            <h2 className="text-lg font-bold text-center text-white mb-4">토끼 레벨업</h2>

            {/* 토끼 선택 그리드 */}
            <div className="flex flex-col gap-2 mb-4">
              {rows.map((row, rowIdx) => (
                <div key={rowIdx} className="flex items-center gap-1.5">
                  <button
                    onClick={() => scrollRow(rowIdx, 'left')}
                    disabled={isLoading}
                    className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-white/15 border border-white/20 text-white/70 hover:bg-white/25 transition-colors disabled:opacity-20"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <div
                    ref={(el) => { rowRefs.current[rowIdx] = el; }}
                    className="flex-1 flex gap-2 overflow-x-auto py-1 scrollbar-hide"
                    style={{ scrollSnapType: 'x mandatory' }}
                  >
                    {row.map((h, colIdx) => {
                      const globalIdx = rowIdx * RABBITS_PER_ROW + colIdx;
                      return (
                        <button
                          key={h.id}
                          onClick={() => { setSelectedIdx(globalIdx); setResult(null); setError(null); }}
                          className={`flex-shrink-0 w-11 h-11 rounded-full overflow-hidden border-2 transition-all ${
                            globalIdx === selectedIdx
                              ? 'border-[#D4AF37] scale-110 shadow-[0_0_12px_rgba(212,175,55,0.5)]'
                              : 'border-white/30 opacity-50 hover:opacity-75'
                          }`}
                          style={{ scrollSnapAlign: 'center' }}
                          disabled={isLoading}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={getRabbitProfileUrl(h.rabbitId)}
                            alt={`토끼 #${h.rabbitId + 1}`}
                            width={44}
                            height={44}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => scrollRow(rowIdx, 'right')}
                    disabled={isLoading}
                    className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-white/15 border border-white/20 text-white/70 hover:bg-white/25 transition-colors disabled:opacity-20"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            {/* 선택된 토끼 정보 */}
            {selectedInfo && selected && (
              <div className="text-center">
                {result ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4 }}
                  >
                    <div className="text-2xl font-bold text-white mb-3">
                      Lv.{result.newLevel}
                    </div>
                    <div className="flex justify-center gap-5 mb-5">
                      <LevelUpStat icon="heart" label="HP" value={result.newStats.hp} increase={result.statIncreases.hp} color="#f87171" />
                      <LevelUpStat icon="attack" label="ATK" value={result.newStats.atk} increase={result.statIncreases.atk} color="#fb923c" />
                      <LevelUpStat icon="shield" label="DEF" value={result.newStats.def} increase={result.statIncreases.def} color="#60a5fa" />
                    </div>
                  </motion.div>
                ) : (
                  <div className="flex items-center justify-center gap-3 mb-5">
                    <div className="flex-1 max-w-[120px]">
                      <div className="text-2xl font-bold text-white mb-2">
                        Lv.{selectedInfo.level}
                      </div>
                      <div className="flex flex-col items-center gap-1.5">
                        <StatRow icon="heart" label="HP" value={selectedInfo.stats.hp} color="#f87171" />
                        <StatRow icon="attack" label="ATK" value={selectedInfo.stats.atk} color="#fb923c" />
                        <StatRow icon="shield" label="DEF" value={selectedInfo.stats.def} color="#60a5fa" />
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-white/60 text-2xl font-bold px-1">→</div>
                    <div className="flex-1 max-w-[120px]">
                      <div className="text-2xl font-bold text-white/50 mb-2">
                        Lv.{selectedInfo.level + 1}
                      </div>
                      <div className="flex flex-col items-center gap-1.5">
                        <StatRow icon="heart" label="HP" value="?" color="#f87171" muted />
                        <StatRow icon="attack" label="ATK" value="?" color="#fb923c" muted />
                        <StatRow icon="shield" label="DEF" value="?" color="#60a5fa" muted />
                      </div>
                    </div>
                  </div>
                )}

                {error && <p className="text-xs text-red-300 mb-3">{error}</p>}

                {result ? (
                  <button
                    onClick={runClose}
                    className="w-full py-2.5 rounded-xl font-bold text-sm text-white bg-white/20 border border-white/30 hover:bg-white/30 active:scale-[0.98] transition-all"
                  >
                    확인
                  </button>
                ) : (
                  <button
                    onClick={handleLevelUp}
                    disabled={isLoading}
                    className="w-full py-2.5 rounded-xl font-bold text-sm text-white bg-white/20 border border-white/30 hover:bg-white/30 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {isLoading ? '레벨업 중...' : '레벨업!'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

function StatRow({
  icon, label, value, color, muted = false,
}: {
  icon: string; label: string; value: number | string; color: string; muted?: boolean;
}) {
  return (
    <div className={`flex items-center gap-1.5 w-full justify-center ${muted ? 'opacity-50' : ''}`}>
      <StatIcon icon={icon} color={color} size={16} />
      <span className="text-xs font-bold text-white/70 w-7">{label}</span>
      <span className="text-sm font-bold text-white min-w-[24px] text-right">{value}</span>
    </div>
  );
}

function LevelUpStat({
  icon, label, value, increase, color,
}: {
  icon: string; label: string; value: number; increase: number; color: string;
}) {
  return (
    <motion.div
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.15, 1] }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="flex flex-col items-center gap-1"
    >
      <StatIcon icon={icon} color={color} size={20} />
      <span className="text-xs font-bold text-white/60">{label}</span>
      <span className="text-lg font-bold text-white">{value}</span>
      <span className="text-xs font-bold text-[#4ADE80]">+{increase}</span>
    </motion.div>
  );
}

function StatIcon({ icon, color, size }: { icon: string; color: string; size: number }) {
  return (
    <>
      {icon === 'heart' && (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      )}
      {icon === 'attack' && (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
          <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
        </svg>
      )}
      {icon === 'shield' && (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
          <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
        </svg>
      )}
    </>
  );
}
