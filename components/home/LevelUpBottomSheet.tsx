'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { type RabbitHolding, getRabbitStats } from '@/lib/hooks/useRabbit';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';

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
 * 레벨업 바텀시트 — 설정 페이지 스타일 (home-bg + 글래스모피즘)
 * 그리드: 최대 4줄 × 20마리, 각 줄마다 좌우 화살표
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

  // 해당 과목의 홀딩만 필터
  const courseHoldings = holdings.filter((h) => h.courseId === courseId);

  // 그리드 행 분할 (최대 4줄 × 20마리)
  const rows: RabbitHolding[][] = [];
  for (let i = 0; i < courseHoldings.length; i += RABBITS_PER_ROW) {
    rows.push(courseHoldings.slice(i, i + RABBITS_PER_ROW));
  }

  // 네비게이션 숨김
  useEffect(() => {
    if (isOpen) {
      document.body.setAttribute('data-hide-nav', '');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => document.body.removeAttribute('data-hide-nav');
  }, [isOpen]);

  // 열릴 때 상태 초기화
  useEffect(() => {
    if (isOpen) {
      setSelectedIdx(0);
      setResult(null);
      setError(null);
    }
  }, [isOpen]);

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

  // 행별 스크롤
  const scrollRow = (rowIdx: number, direction: 'left' | 'right') => {
    const el = rowRefs.current[rowIdx];
    if (el) el.scrollBy({ left: direction === 'left' ? -200 : 200, behavior: 'smooth' });
  };

  const selected = courseHoldings[selectedIdx];
  const selectedInfo = selected ? getRabbitStats(selected) : null;

  if (courseHoldings.length === 0) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="w-full relative overflow-hidden rounded-t-2xl"
            style={{ maxHeight: '92vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 배경 이미지 + 글래스 오버레이 */}
            <div className="absolute inset-0">
              <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
            </div>
            <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />

            {/* 컨텐츠 — 스크롤 가능 */}
            <div className="relative z-10 px-5 pt-4 pb-10 overflow-y-auto" style={{ maxHeight: '92vh' }}>
              {/* 핸들 바 */}
              <div className="flex justify-center mb-4">
                <div className="w-10 h-1 bg-white/30 rounded-full" />
              </div>

              {/* 타이틀 */}
              <h2 className="text-2xl font-bold text-center text-white mb-5">토끼 레벨업</h2>

              {/* 토끼 선택 그리드 — 줄당 20마리, 각 줄 좌우 화살표 */}
              <div className="flex flex-col gap-2 mb-6">
                {rows.map((row, rowIdx) => (
                  <div key={rowIdx} className="flex items-center gap-1.5">
                    {/* 왼쪽 화살표 */}
                    <button
                      onClick={() => scrollRow(rowIdx, 'left')}
                      disabled={isLoading}
                      className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/15 border border-white/20 text-white/70 hover:bg-white/25 transition-colors disabled:opacity-20"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>

                    {/* 스크롤 영역 */}
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
                            className={`flex-shrink-0 w-14 h-14 rounded-full overflow-hidden border-2 transition-all ${
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
                              width={56}
                              height={56}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        );
                      })}
                    </div>

                    {/* 오른쪽 화살표 */}
                    <button
                      onClick={() => scrollRow(rowIdx, 'right')}
                      disabled={isLoading}
                      className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/15 border border-white/20 text-white/70 hover:bg-white/25 transition-colors disabled:opacity-20"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                    /* === 레벨업 후: 스탯 확정 (흰색 유지) === */
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.4 }}
                    >
                      <div className="text-3xl font-bold text-white mb-5">
                        Lv.{result.newLevel}
                      </div>
                      <div className="flex justify-center gap-6 mb-8">
                        <LevelUpStat icon="heart" label="HP" value={result.newStats.hp} increase={result.statIncreases.hp} color="#f87171" />
                        <LevelUpStat icon="attack" label="ATK" value={result.newStats.atk} increase={result.statIncreases.atk} color="#fb923c" />
                        <LevelUpStat icon="shield" label="DEF" value={result.newStats.def} increase={result.statIncreases.def} color="#60a5fa" />
                      </div>
                    </motion.div>
                  ) : (
                    /* === 레벨업 전: Lv.N 스탯 → Lv.N+1 스탯? === */
                    <div className="flex items-center justify-center gap-4 mb-8">
                      {/* 현재 레벨 */}
                      <div className="flex-1 max-w-[140px]">
                        <div className="text-3xl font-bold text-white mb-3">
                          Lv.{selectedInfo.level}
                        </div>
                        <div className="flex flex-col items-center gap-2">
                          <StatRow icon="heart" label="HP" value={selectedInfo.stats.hp} color="#f87171" />
                          <StatRow icon="attack" label="ATK" value={selectedInfo.stats.atk} color="#fb923c" />
                          <StatRow icon="shield" label="DEF" value={selectedInfo.stats.def} color="#60a5fa" />
                        </div>
                      </div>

                      {/* 화살표 */}
                      <div className="flex-shrink-0 text-white/60 text-3xl font-bold px-1">
                        →
                      </div>

                      {/* 다음 레벨 */}
                      <div className="flex-1 max-w-[140px]">
                        <div className="text-3xl font-bold text-white/50 mb-3">
                          Lv.{selectedInfo.level + 1}
                        </div>
                        <div className="flex flex-col items-center gap-2">
                          <StatRow icon="heart" label="HP" value="?" color="#f87171" muted />
                          <StatRow icon="attack" label="ATK" value="?" color="#fb923c" muted />
                          <StatRow icon="shield" label="DEF" value="?" color="#60a5fa" muted />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 에러 */}
                  {error && (
                    <p className="text-sm text-red-300 mb-4">{error}</p>
                  )}

                  {/* 버튼 — 레벨업 전/후 동일 스타일 (흰색) */}
                  {result ? (
                    <button
                      onClick={onClose}
                      className="w-full py-3.5 rounded-xl font-bold text-lg text-white bg-white/20 border border-white/30 hover:bg-white/30 active:scale-[0.98] transition-all"
                    >
                      확인
                    </button>
                  ) : (
                    <button
                      onClick={handleLevelUp}
                      disabled={isLoading}
                      className="w-full py-3.5 rounded-xl font-bold text-lg text-white bg-white/20 border border-white/30 hover:bg-white/30 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      {isLoading ? '레벨업 중...' : '레벨업!'}
                    </button>
                  )}
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

/** 레벨업 전 스탯 행 — 글씨 키움 */
function StatRow({
  icon,
  label,
  value,
  color,
  muted = false,
}: {
  icon: string;
  label: string;
  value: number | string;
  color: string;
  muted?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 w-full justify-center ${muted ? 'opacity-50' : ''}`}>
      <StatIcon icon={icon} color={color} size={20} />
      <span className="text-sm font-bold text-white/70 w-8">{label}</span>
      <span className="text-lg font-bold text-white min-w-[28px] text-right">{value}</span>
    </div>
  );
}

/** 레벨업 후 확정 스탯 — 글씨 키움 */
function LevelUpStat({
  icon,
  label,
  value,
  increase,
  color,
}: {
  icon: string;
  label: string;
  value: number;
  increase: number;
  color: string;
}) {
  return (
    <motion.div
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.15, 1] }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="flex flex-col items-center gap-1"
    >
      <StatIcon icon={icon} color={color} size={26} />
      <span className="text-sm font-bold text-white/60">{label}</span>
      <span className="text-2xl font-bold text-white">{value}</span>
      <span className="text-sm font-bold text-[#4ADE80]">+{increase}</span>
    </motion.div>
  );
}

/** 스탯 아이콘 */
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
