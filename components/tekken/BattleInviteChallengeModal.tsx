'use client';

/**
 * 배틀 신청 도전장 — 빈티지 신문(ExpToast) 스타일 상단 카드 (수신자 측)
 *
 * 설계:
 *  - 화면 전체를 가리지 않음 (학습 방해 방지)
 *  - 상단 중앙에 작게 떠 있음
 *  - 배경 오버레이 없음 (카드 바깥 클릭은 통과)
 *  - 효과음·진동 없음
 *  - 빈티지 신문 스타일: 크림 배경 + 검정 테두리 + 모서리 장식 + Playfair/Cormorant 세리프
 *  - 가로모드: 2쪽(메인 페이지) 영역 기준
 */

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useBattleInvite, type PendingInvite } from '@/lib/contexts/BattleInviteContext';
import { useDetailPanel } from '@/lib/contexts/DetailPanelContext';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { useTheme } from '@/styles/themes/useTheme';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import { callFunction } from '@/lib/api';
import { COURSE_INDEXES } from '@/lib/courseIndex';
import { useBattleSessionStore } from '@/lib/stores/battleSessionStore';
import { computeBattlePlacement } from '@/lib/hooks/useBattlePlacement';

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
  const { theme } = useTheme();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  // 수락 클릭 시점의 placement 를 캡처하기 위한 훅들
  const isWide = useWideMode();
  const pathname = usePathname() || '';
  const { isLocked } = useDetailPanel();

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
    // ⚠️ 수락 클릭 바로 이 시점의 isLocked/pathname/isWide 를 박제해 placement 계산.
    // 이후 showBattle=true 로 CharacterBox 가 lockDetail 을 호출해 isLocked 이 바뀌어도
    // placement 는 영향 받지 않음 (store 에 이미 고정됨).
    const placement = computeBattlePlacement(isWide, isLocked, pathname);
    setBusy('accept');
    try {
      const res = await callFunction('respondBattleInvite', { inviteId: invite.id, action: 'accept' });
      if (res.status === 'accepted' && res.battleId) {
        useBattleSessionStore.getState().request(res.battleId, false, placement);
      }
    } catch (err) {
      console.error('[BattleInvite] 수락 실패:', err);
      setBusy(null);
    }
  };

  return (
    <motion.div
      className="fixed top-0 z-[120] flex justify-center pointer-events-none"
      style={{
        left: 'var(--modal-left, 0px)',
        right: 'var(--modal-right, 0px)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
      }}
      initial={{ opacity: 0, y: -20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      transition={{ type: 'spring', damping: 24, stiffness: 320 }}
    >
      {/* 빈티지 신문 카드 — ExpToast 스타일 */}
      <div
        className="pointer-events-auto relative w-[min(92%,340px)] shadow-lg overflow-hidden"
        style={{
          backgroundColor: theme.colors.background,
          border: '2px solid #1A1A1A',
          borderRadius: '8px',
        }}
      >
        {/* 3초 진행 바 — 상단 */}
        <div
          className="h-0.5 transition-[width] ease-linear"
          style={{ width: `${progress * 100}%`, backgroundColor: theme.colors.accent }}
        />

        {/* 모서리 장식 (ExpToast와 동일) */}
        <div className="absolute top-1.5 left-1.5 w-2 h-2 border-t border-l border-[#1A1A1A]" />
        <div className="absolute top-1.5 right-1.5 w-2 h-2 border-t border-r border-[#1A1A1A]" />
        <div className="absolute bottom-1.5 left-1.5 w-2 h-2 border-b border-l border-[#1A1A1A]" />
        <div className="absolute bottom-1.5 right-1.5 w-2 h-2 border-b border-r border-[#1A1A1A]" />

        <div className="px-5 py-3.5">
          {/* 제목 — 크게, 세리프 */}
          <p
            className="text-center font-serif-display font-black mb-3"
            style={{ color: theme.colors.accent, fontSize: '1.5rem', letterSpacing: '0.05em' }}
          >
            도전장
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
              <p className="text-sm font-bold truncate" style={{ color: '#1A1A1A' }}>
                {invite.senderNickname}
                {invite.senderClass && (
                  <span style={{ color: theme.colors.textSecondary, fontWeight: 500 }}> · {invite.senderClass}반</span>
                )}
              </p>
              <p
                className="text-xs truncate italic"
                style={{ color: theme.colors.textSecondary }}
                title={chapterLabels.join(', ')}
              >
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
              className="flex-1 py-2 text-xs font-bold disabled:opacity-50 active:scale-95 transition-transform"
              style={{
                color: '#1A1A1A',
                border: '1.5px solid #1A1A1A',
                borderRadius: '999px',
                backgroundColor: 'transparent',
              }}
            >
              {busy === 'decline' ? '거절 중…' : '거절'}
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={!!busy}
              className="flex-1 py-2 text-xs font-black disabled:opacity-50 active:scale-95 transition-transform"
              style={{
                color: '#FDFBF7',
                backgroundColor: theme.colors.accent,
                border: `1.5px solid ${theme.colors.accent}`,
                borderRadius: '999px',
              }}
            >
              {busy === 'accept' ? '수락 중…' : '수락'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
