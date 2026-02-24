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
      <div className="flex flex-col items-center gap-2">
        <div className="w-24 h-24 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center">
          <span className="text-4xl font-black text-white/30">?</span>
        </div>
        <span className="text-sm text-white/40 font-bold">빈 슬롯</span>
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
      {/* 프로필 이미지 */}
      <div className="w-24 h-24 rounded-2xl bg-white/10 border border-white/20 overflow-hidden">
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
        <p className="text-white font-bold text-base leading-tight">
          {displayName}
        </p>
        {info && (
          <p className="text-white/60 text-sm font-bold">
            Lv.{info.level}
          </p>
        )}
      </div>

      {/* 스탯 */}
      {info && (
        <div className="flex items-center gap-3 text-sm font-bold">
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
}: TekkenBattleConfirmModalProps) {
  // data-hide-nav 설정
  useEffect(() => {
    if (isOpen) {
      document.body.setAttribute('data-hide-nav', '');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, [isOpen]);

  if (typeof window === 'undefined') return null;

  // 항상 2슬롯 (빈 슬롯은 null)
  const slot0 = equippedRabbits[0] || null;
  const slot1 = equippedRabbits[1] || null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="flex flex-col items-center gap-6"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          >
            {/* 타이틀 */}
            <div className="flex items-center gap-3 mb-2">
              <svg className="w-8 h-8 text-red-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
              </svg>
              <h2 className="text-3xl font-black text-white">배틀 준비</h2>
              <svg className="w-8 h-8 text-red-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
              </svg>
            </div>

            {/* 토끼 라인업 */}
            <div className="flex items-start gap-10">
              <RabbitSlotCard slot={slot0} holdings={holdings} />
              <RabbitSlotCard slot={slot1} holdings={holdings} />
            </div>

            {/* 버튼 */}
            <div className="flex items-center gap-4 mt-4">
              <motion.button
                onClick={onConfirm}
                className="px-10 py-3 bg-red-500 rounded-full text-white font-black text-lg active:scale-95 transition-transform"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                배틀!
              </motion.button>
              <button
                onClick={onCancel}
                className="px-8 py-3 bg-white/10 border border-white/20 rounded-full text-white font-bold active:scale-95 transition-transform"
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
