'use client';

/**
 * 배틀 신청 도전장 — 상단 컴팩트 카드 (수신자 측)
 *
 * 설계 원칙:
 *  - 화면 전체를 가리지 않음 (학습 방해 방지)
 *  - 상단에 작게 떠서 현재 작업을 계속할 수 있음
 *  - 배경 오버레이 없음 (모달 카드 바깥 클릭은 그대로 통과)
 *  - 효과음·진동 없음
 *  - 가로모드: 2쪽(메인 페이지) 영역 기준으로 중앙
 *
 * 레이아웃:
 *  - 상단: "⚔️ 도전장" 제목 + 3초 진행 바
 *  - 중단: 토끼 이미지 · 옆에 닉네임 · 반 · 챕터
 *  - 하단: [거절] [수락]
 *
 * 수락 시: respondBattleInvite('accept') → battleId → `/?battleId=` 로 라우팅.
 *   CharacterBox의 effect가 battleId를 잡아 attachBattleId + 배틀 오버레이 표시.
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

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 80);
    return () => clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, invite.expiresAt - now);
  const progress = Math.max(0, Math.min(1, remainingMs / TTL_MS));

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
      // 이미 만료/처리된 경우 무시
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
    // 전체 레이어 — pointer-events-none 으로 카드 바깥은 클릭 통과시켜 학습 방해 없음
    <motion.div
      className="fixed top-0 z-[120] flex justify-center pointer-events-none"
      style={{
        left: 'var(--modal-left, 0px)',
        right: 'var(--modal-right, 0px)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
      }}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ type: 'spring', damping: 24, stiffness: 320 }}
    >
      <div className="pointer-events-auto w-[min(92%,340px)] bg-[#1A1A1A] rounded-2xl shadow-2xl overflow-hidden border border-white/10">
        {/* 3초 진행 바 */}
        <div
          className="h-0.5 bg-red-500 transition-[width] ease-linear"
          style={{ width: `${progress * 100}%` }}
        />

        <div className="px-4 py-3">
          {/* 제목 */}
          <p className="text-center text-white/90 text-[11px] font-black tracking-[0.3em] mb-2">
            ⚔️ 도전장
          </p>

          {/* 토끼 + 신청자 정보 */}
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getRabbitProfileUrl(invite.senderRabbit.rabbitId)}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-bold truncate">
                {invite.senderNickname}
                {invite.senderClass && (
                  <span className="text-white/50 font-medium"> · {invite.senderClass}반</span>
                )}
              </p>
              <p className="text-white/50 text-xs truncate" title={chapterLabels.join(', ')}>
                {chapterLabels.join(', ')}
              </p>
            </div>
          </div>

          {/* 버튼 */}
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={handleDecline}
              disabled={!!busy}
              className="flex-1 py-2 rounded-full bg-white/10 border border-white/20 text-white text-xs font-bold disabled:opacity-50 active:scale-95 transition-transform"
            >
              {busy === 'decline' ? '거절 중…' : '거절'}
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={!!busy}
              className="flex-1 py-2 rounded-full bg-red-500 text-white text-xs font-black disabled:opacity-50 active:scale-95 transition-transform"
            >
              {busy === 'accept' ? '수락 중…' : '수락'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
