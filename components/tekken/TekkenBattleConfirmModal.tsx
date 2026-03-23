'use client';

/**
 * 배틀 출전 확인 모달
 *
 * 꾹 누르기 → 이 모달 → 챕터 선택 → "배틀!" 클릭 → 매칭 시작
 * 철권 캐릭터 선택창 느낌의 다크 오버레이
 *
 * 챕터 선택: < 챕터명 > 캐러셀 + 선택 태그 표시
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getRabbitStats, useRabbitDoc, type RabbitHolding } from '@/lib/hooks/useRabbit';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import { computeRabbitDisplayName } from '@/lib/utils/rabbitDisplayName';
import { useHideNav } from '@/lib/hooks/useHideNav';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import { COURSE_INDEXES } from '@/lib/courseIndex';

interface TekkenBattleConfirmModalProps {
  isOpen: boolean;
  onConfirm: (chapters: string[]) => void;
  onCancel: () => void;
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>;
  holdings: RabbitHolding[];
  courseId: string;
}

/** 개별 토끼 슬롯 카드 */
function RabbitSlotCard({
  slot,
  holdings,
}: {
  slot: { rabbitId: number; courseId: string } | null;
  holdings: RabbitHolding[];
}) {
  const { rabbit: rabbitDoc } = useRabbitDoc(slot?.courseId, slot?.rabbitId);

  if (!slot) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className="w-[72px] h-[72px] rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
          <span className="text-2xl font-black text-white/30">?</span>
        </div>
        <span className="text-xs text-white/40 font-bold">빈 슬롯</span>
      </div>
    );
  }

  const holding = holdings.find(
    (h) => h.rabbitId === slot.rabbitId && h.courseId === slot.courseId
  );
  const info = holding ? getRabbitStats(holding) : null;
  const displayName = holding && rabbitDoc
    ? computeRabbitDisplayName(rabbitDoc.name, holding.discoveryOrder, slot.rabbitId)
    : slot.rabbitId === 0
      ? '토끼'
      : '...';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="w-[84px] h-[84px] rounded-xl bg-white/10 border border-white/20 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getRabbitProfileUrl(slot.rabbitId)}
          alt=""
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>
      <div className="text-center">
        <p className="text-white font-bold text-base leading-tight">
          {displayName}
        </p>
        {info && (
          <p className="text-white/60 text-sm font-bold">
            Lv.{info.level}
          </p>
        )}
      </div>
      {info && (
        <div className="flex items-center gap-2.5 text-sm font-bold">
          <span className="text-red-400">
            <svg className="w-3.5 h-3.5 inline mr-0.5 -mt-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            {info.stats.hp}
          </span>
          <span className="text-orange-400">
            <svg className="w-3.5 h-3.5 inline mr-0.5 -mt-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
            </svg>
            {info.stats.atk}
          </span>
          <span className="text-blue-400">
            <svg className="w-3.5 h-3.5 inline mr-0.5 -mt-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
            </svg>
            {info.stats.def}
          </span>
        </div>
      )}
    </div>
  );
}

export default function TekkenBattleConfirmModal({
  isOpen,
  onConfirm,
  onCancel,
  equippedRabbits,
  holdings,
  courseId,
}: TekkenBattleConfirmModalProps) {
  useHideNav(isOpen);

  useEffect(() => {
    if (isOpen) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isOpen]);

  // 챕터 데이터 (챕터 1 제외)
  const courseChapters = useMemo(() => {
    const index = COURSE_INDEXES[courseId];
    if (!index) return [];
    return index.chapters
      .filter((ch) => !ch.id.endsWith('_1'))
      .map((ch) => {
        const match = ch.id.match(/_(\d+)$/);
        const num = match ? match[1] : ch.id;
        return { num, shortName: ch.shortName };
      });
  }, [courseId]);

  // 캐러셀 인덱스
  const [carouselIdx, setCarouselIdx] = useState(0);

  // 챕터 선택 상태 (기본: 비어있음)
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set());

  // isOpen 변경 시 초기화
  useEffect(() => {
    if (isOpen) {
      setSelectedChapters(new Set());
      setCarouselIdx(0);
    }
  }, [isOpen]);

  const goPrev = useCallback(() => {
    setCarouselIdx(i => (i - 1 + courseChapters.length) % courseChapters.length);
  }, [courseChapters.length]);

  const goNext = useCallback(() => {
    setCarouselIdx(i => (i + 1) % courseChapters.length);
  }, [courseChapters.length]);

  const currentChapter = courseChapters[carouselIdx];
  const isCurrentSelected = currentChapter ? selectedChapters.has(currentChapter.num) : false;

  const toggleCurrent = useCallback(() => {
    if (!currentChapter) return;
    setSelectedChapters(prev => {
      const next = new Set(prev);
      if (next.has(currentChapter.num)) {
        next.delete(currentChapter.num);
      } else {
        next.add(currentChapter.num);
      }
      return next;
    });
  }, [currentChapter]);

  const removeChapter = useCallback((num: string) => {
    setSelectedChapters(prev => {
      const next = new Set(prev);
      next.delete(num);
      return next;
    });
  }, []);

  if (typeof window === 'undefined') return null;

  const slot0 = equippedRabbits[0] || null;
  const slot1 = equippedRabbits[1] || null;
  const canBattle = !!slot0 && selectedChapters.size > 0;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed top-0 right-0 bottom-0 z-[110] flex flex-col items-center justify-center bg-black/90 select-none"
          style={{ left: 'var(--home-sheet-left, 0px)', WebkitTouchCallout: 'none' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <motion.div
            className="flex flex-col items-center gap-2.5 w-full max-w-sm px-4"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          >
            {/* 타이틀 */}
            <div className="flex items-center gap-2.5 mb-1">
              <svg className="w-6 h-6 text-red-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
              </svg>
              <h2 className="text-2xl font-black text-white">배틀 준비</h2>
              <svg className="w-6 h-6 text-red-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
              </svg>
            </div>

            {/* 토끼 라인업 */}
            <div className="flex items-start gap-8">
              <RabbitSlotCard slot={slot0} holdings={holdings} />
              {slot1 && <RabbitSlotCard slot={slot1} holdings={holdings} />}
            </div>
            {slot0 && !slot1 && (
              <p className="text-[10px] text-white/50 text-center -mt-1">
                같은 토끼가 2회 출전합니다
              </p>
            )}

            {/* 챕터 선택 캐러셀 */}
            <div className="w-full mt-0.5">
              {/* < 챕터명 > 캐러셀 */}
              {currentChapter && (
                <div className="flex items-center justify-center gap-1">
                  <button
                    onClick={goPrev}
                    className="w-8 h-8 flex items-center justify-center text-white/60 active:text-white transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>

                  <button
                    onClick={toggleCurrent}
                    className={`flex-1 py-2 rounded-xl text-sm font-black transition-all ${
                      isCurrentSelected
                        ? 'bg-white text-black'
                        : 'bg-white/10 text-white/50 border border-white/20'
                    }`}
                  >
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={carouselIdx}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.15 }}
                        className="block"
                      >
                        {currentChapter.num}. {currentChapter.shortName}
                      </motion.span>
                    </AnimatePresence>
                  </button>

                  <button
                    onClick={goNext}
                    className="w-8 h-8 flex items-center justify-center text-white/60 active:text-white transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )}

              {/* 선택된 챕터 태그 */}
              <div className="flex flex-wrap gap-1.5 mt-2 min-h-[28px] justify-center">
                {courseChapters
                  .filter(c => selectedChapters.has(c.num))
                  .map(({ num, shortName }) => (
                    <button
                      key={num}
                      onClick={() => removeChapter(num)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/15 text-white/80 text-[11px] font-bold"
                    >
                      {num}. {shortName}
                      <svg className="w-3 h-3 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  ))}
                {selectedChapters.size === 0 && (
                  <p className="text-[10px] text-white/30">챕터를 선택하세요</p>
                )}
              </div>
            </div>

            {/* 버튼 */}
            <div className="flex items-center gap-3 mt-1 w-full px-4">
              <motion.button
                onClick={canBattle ? () => onConfirm([...selectedChapters]) : undefined}
                disabled={!canBattle}
                className={`flex-1 py-2 rounded-full font-black text-xs transition-transform ${
                  canBattle
                    ? 'bg-red-500 text-white active:scale-95'
                    : 'bg-white/20 text-white/30 cursor-not-allowed'
                }`}
                whileTap={canBattle ? { scale: 0.95 } : undefined}
              >
                배틀!
              </motion.button>
              <button
                onClick={onCancel}
                className="flex-1 py-2 bg-white/10 border border-white/20 rounded-full text-white text-xs font-bold active:scale-95 transition-transform"
              >
                취소
              </button>
            </div>

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
