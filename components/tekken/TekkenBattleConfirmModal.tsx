'use client';

/**
 * 배틀 출전 확인 모달
 *
 * 꾹 누르기 → 이 모달 → "배틀!" 클릭 → 매칭 시작
 * 철권 캐릭터 선택창 느낌의 다크 오버레이
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getRabbitStats, useRabbitDoc, type RabbitHolding } from '@/lib/hooks/useRabbit';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import { computeRabbitDisplayName } from '@/lib/utils/rabbitDisplayName';
import { useHideNav } from '@/lib/hooks/useHideNav';

interface TekkenBattleConfirmModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>;
  holdings: RabbitHolding[];
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
    // 빈 슬롯
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
    <div className="flex flex-col items-center gap-1.5">
      {/* 프로필 이미지 */}
      <div className="w-[72px] h-[72px] rounded-xl bg-white/10 border border-white/20 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getRabbitProfileUrl(slot.rabbitId)}
          alt=""
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>

      {/* 이름 + 레벨 */}
      <div className="text-center">
        <p className="text-white font-bold text-sm leading-tight">
          {displayName}
        </p>
        {info && (
          <p className="text-white/60 text-xs font-bold">
            Lv.{info.level}
          </p>
        )}
      </div>

      {/* 스탯 */}
      {info && (
        <div className="flex items-center gap-2 text-xs font-bold">
          <span className="text-red-400">
            <svg className="w-3 h-3 inline mr-0.5 -mt-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            {info.stats.hp}
          </span>
          <span className="text-orange-400">
            <svg className="w-3 h-3 inline mr-0.5 -mt-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
            </svg>
            {info.stats.atk}
          </span>
          <span className="text-blue-400">
            <svg className="w-3 h-3 inline mr-0.5 -mt-0.5" viewBox="0 0 24 24" fill="currentColor">
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
}: TekkenBattleConfirmModalProps) {
  // 네비게이션 숨김
  useHideNav(isOpen);

  if (typeof window === 'undefined') return null;

  // 항상 2슬롯 (빈 슬롯은 null)
  const slot0 = equippedRabbits[0] || null;
  const slot1 = equippedRabbits[1] || null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="flex flex-col items-center gap-4"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          >
            {/* 타이틀 */}
            <div className="flex items-center gap-2 mb-1">
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
              <RabbitSlotCard slot={slot1} holdings={holdings} />
            </div>

            {/* 버튼 */}
            <div className="flex items-center gap-3 mt-2 w-full px-6">
              <motion.button
                onClick={onConfirm}
                className="flex-1 py-2.5 bg-red-500 rounded-full text-white font-black text-sm active:scale-95 transition-transform"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                배틀!
              </motion.button>
              <button
                onClick={onCancel}
                className="flex-1 py-2.5 bg-white/10 border border-white/20 rounded-full text-white text-sm font-bold active:scale-95 transition-transform"
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
