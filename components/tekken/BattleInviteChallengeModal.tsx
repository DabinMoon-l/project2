'use client';

/**
 * 배틀 신청 도전장 모달 (수신자 측)
 *
 * BattleInviteContext의 pendingInvite를 읽어 자동 렌더.
 * - 효과음·진동 없음 (학습 방해 방지)
 * - 3초 원형 게이지 — 시간 다 되면 자동 닫힘
 * - 수락: respondBattleInvite(action='accept') → battleId 받아 홈으로 라우팅 (`?battleId=...`)
 *   CharacterBox의 effect가 battleId를 잡아 attachBattleId + 배틀 오버레이 표시
 * - 거절: respondBattleInvite(action='decline')
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useBattleInvite, type PendingInvite } from '@/lib/contexts/BattleInviteContext';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import { callFunction } from '@/lib/api';
import { COURSE_INDEXES } from '@/lib/courseIndex';

const TTL_MS = 3_000;

export default function BattleInviteChallengeModal() {
  const { pendingInvite } = useBattleInvite();

  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {pendingInvite && <ChallengeCard invite={pendingInvite} key={pendingInvite.id} />}
    </AnimatePresence>,
    document.body,
  );
}

function ChallengeCard({ invite }: { invite: PendingInvite }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);

  // 남은 시간 퍼센트 (원형 게이지용)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 80);
    return () => clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, invite.expiresAt - now);
  const progress = Math.max(0, Math.min(1, remainingMs / TTL_MS));

  // 챕터 번호 → 이름 매핑
  const chapterLabels = useMemo(() => {
    const index = COURSE_INDEXES[invite.courseId];
    if (!index) return invite.chapters.map((n) => `${n}장`);
    return invite.chapters.map((num) => {
      const found = index.chapters.find((c) => {
        const m = c.id.match(/_(\d+)$/);
        return m?.[1] === num;
      });
      return found ? `${num}. ${found.shortName}` : `${num}장`;
    });
  }, [invite.chapters, invite.courseId]);

  const handleDecline = async () => {
    if (busy) return;
    setBusy('decline');
    try {
      await callFunction('respondBattleInvite', { inviteId: invite.id, action: 'decline' });
    } catch {
      // 이미 만료/처리된 경우는 무시
    }
  };

  const handleAccept = async () => {
    if (busy) return;
    setBusy('accept');
    try {
      const res = await callFunction('respondBattleInvite', { inviteId: invite.id, action: 'accept' });
      if (res.status === 'accepted' && res.battleId) {
        router.push(`/?battleId=${encodeURIComponent(res.battleId)}`);
      }
    } catch (err) {
      console.error('[BattleInvite] 수락 실패:', err);
      setBusy(null);
    }
  };

  return (
    <motion.div
      className="fixed top-0 bottom-0 z-[120] flex items-center justify-center"
      style={{ left: 'var(--modal-left, 0px)', right: 'var(--modal-right, 0px)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* 반투명 배경 */}
      <div className="absolute inset-0 bg-black/60" />

      {/* 도전장 카드 */}
      <motion.div
        className="relative w-[min(90vw,340px)] bg-[#1A1A1A] rounded-2xl overflow-hidden"
        initial={{ scale: 0.85, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        transition={{ type: 'spring', damping: 22, stiffness: 280 }}
      >
        {/* 3초 타이머 바 — 상단 */}
        <div className="absolute top-0 left-0 h-0.5 bg-red-500 transition-[width]" style={{ width: `${progress * 100}%` }} />

        <div className="px-6 pt-5 pb-5 flex flex-col items-center gap-3">
          <p className="text-[9px] tracking-[0.25em] text-white/40">━━━━━━━━</p>
          <h2 className="text-white font-serif text-xl font-black">⚔️ 도전장 도착!</h2>

          {/* 신청자 정보 */}
          <div className="text-center">
            <p className="text-white text-base font-bold leading-tight">
              {invite.senderNickname}
              {invite.senderClass && <span className="text-white/50"> · {invite.senderClass}반</span>}
            </p>
            <p className="text-white/50 text-xs mt-0.5">님이 배틀을 신청했어요</p>
          </div>

          {/* 신청자의 첫 장착 토끼 (1마리만 표시 — 배틀 시 자동 복제) */}
          <div className="flex flex-col items-center gap-1 py-1">
            <div className="w-24 h-24">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getRabbitProfileUrl(invite.senderRabbit.rabbitId)}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
              />
            </div>
            <p className="text-white/80 text-xs font-bold">
              Lv.{invite.senderRabbit.level} {invite.senderRabbit.name}
            </p>
          </div>

          {/* 챕터 */}
          <div className="w-full flex flex-wrap justify-center gap-1.5">
            {chapterLabels.map((label) => (
              <span key={label} className="px-2.5 py-1 rounded-full bg-white/10 text-white/80 text-[11px] font-bold">
                {label}
              </span>
            ))}
          </div>

          {/* 버튼 */}
          <div className="flex items-center gap-2 w-full mt-2">
            <button
              type="button"
              onClick={handleDecline}
              disabled={!!busy}
              className="flex-1 py-2.5 rounded-full bg-white/10 border border-white/20 text-white text-xs font-bold disabled:opacity-50 active:scale-95 transition-transform"
            >
              {busy === 'decline' ? '거절 중…' : '거절'}
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={!!busy}
              className="flex-1 py-2.5 rounded-full bg-red-500 text-white text-xs font-black disabled:opacity-50 active:scale-95 transition-transform"
            >
              {busy === 'accept' ? '수락 중…' : '수락'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
