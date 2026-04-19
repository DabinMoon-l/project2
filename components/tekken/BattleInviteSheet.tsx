'use client';

/**
 * 배틀 신청 — 접속자 바텀시트 (신청자 측).
 *
 * TekkenBattleConfirmModal에서 "배틀 신청" 클릭 시 열림.
 * 데이터 로직은 `useOnlineClassmates` 훅으로 분리,
 * 리스트 행은 `OnlineUserRow`로 분리.
 *
 * 흐름:
 *  - 유저 탭 → `sendBattleInvite` CF → 해당 행에 3초 스피너
 *  - battleInviteOutbox 구독 → `accepted` 시 onAccepted(battleId)
 *  - 3초 타임아웃 시 "응답 없어요" 토스트
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ref as rtdbRef, onValue, remove } from 'firebase/database';
import { getRtdb } from '@/lib/firebase';
import { callFunction } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { useOnlineClassmates } from '@/lib/hooks/useOnlineClassmates';
import OnlineUserRow from './invite/OnlineUserRow';

interface Props {
  isOpen: boolean;
  courseId: string;
  chapters: string[];
  onClose: () => void;
  /** 상대가 수락하면 호출 — 부모가 countdown 배틀 오버레이로 전환 */
  onAccepted: (battleId: string) => void;
}

export default function BattleInviteSheet({ isOpen, courseId, chapters, onClose, onAccepted }: Props) {
  const { user } = useAuth();
  const myUid = user?.uid;
  const { users, loading } = useOnlineClassmates(courseId, myUid, isOpen);

  const [sendingTo, setSendingTo] = useState<string | null>(null);
  // CF 응답 후 서버 expiresAt으로 세팅. null일 동안은 스피너만 표시, 타이머는 미작동.
  // CF cold start로 신청자 3초 타이머가 수신자 도전장 수신 전에 터지던 버그 fix.
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // outbox 구독 — 시트 열려 있는 동안 유지 (sendingTo 타이머와 독립).
  // ⚠️ 이전엔 sendingTo 에 묶여 있어 로컬 타이머가 sendingTo=null 로 초기화하면
  //   구독이 해제 → 그 직후 도착한 accepted 이벤트를 신청자가 놓쳤음
  //   (수락자는 배틀 시작되는데 신청자 화면엔 아무것도 안 뜸).
  useEffect(() => {
    if (!isOpen || !myUid) return;
    const outboxRef = rtdbRef(getRtdb(), `battleInviteOutbox/${myUid}/current`);
    const unsub = onValue(outboxRef, (snap) => {
      const data = snap.val() as {
        receiverUid: string;
        status: 'pending' | 'accepted' | 'declined' | 'expired';
        battleId?: string;
      } | null;
      if (!data) return;
      if (data.status === 'accepted' && data.battleId) {
        setSendingTo(null);
        setExpiresAt(null);
        onAccepted(data.battleId);
        remove(outboxRef).catch(() => {});
      } else if (data.status === 'declined') {
        setSendingTo(null);
        setExpiresAt(null);
        setToast('상대가 거절했어요');
        remove(outboxRef).catch(() => {});
      } else if (data.status === 'expired') {
        setSendingTo(null);
        setExpiresAt(null);
        setToast('응답이 없어요');
        remove(outboxRef).catch(() => {});
      }
    });
    return () => unsub();
  }, [isOpen, myUid, onAccepted]);

  // 클라이언트 UI 타이머 — 서버 expiresAt + 서버 유예(3s) 초과 시 스피너만 해제.
  // 토스트는 띄우지 않음: 늦게 도착한 'accepted' 이벤트(outbox)가 배틀을 시작할 수 있음.
  // 최종 '응답이 없어요' 는 서버가 outbox.status='expired' 로 설정할 때 outbox
  // 구독이 처리.
  useEffect(() => {
    if (!sendingTo || !expiresAt) return;
    const SERVER_GRACE_MS = 3_000;
    const remaining = expiresAt + SERVER_GRACE_MS - Date.now();
    if (remaining <= 0) {
      setSendingTo(null);
      return;
    }
    const t = setTimeout(() => setSendingTo(null), remaining);
    return () => clearTimeout(t);
  }, [sendingTo, expiresAt]);

  // 토스트 자동 닫힘
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleInvite = async (targetUid: string) => {
    if (sendingTo) return;
    setSendingTo(targetUid);
    setExpiresAt(null); // CF 응답 전까진 타이머 작동 X
    try {
      const res = await callFunction('sendBattleInvite', { receiverUid: targetUid, chapters });
      setExpiresAt(res.expiresAt); // 서버 기준 만료 시각으로 타이머 시작
    } catch (err: unknown) {
      setSendingTo(null);
      setExpiresAt(null);
      setToast((err as { message?: string })?.message || '신청에 실패했어요');
    }
  };

  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 투명 오버레이 — 배경 클릭 감지만 (어둡게 안 함) */}
          <motion.div
            className="fixed top-0 bottom-0 z-[115]"
            style={{ left: 'var(--home-sheet-left, 0px)', right: '0px' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={sendingTo ? undefined : onClose}
          />

          <motion.div
            className="fixed bottom-0 z-[116] bg-[#1A1A1A] rounded-t-2xl overflow-hidden flex flex-col"
            style={{
              left: 'var(--home-sheet-left, 0px)',
              right: '0px',
              maxHeight: '70dvh',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            <div className="px-5 pt-4 pb-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] tracking-[0.2em] text-white/40">━━━━━━━━</p>
                <h2 className="text-white font-serif text-xl font-black">접속 중인 친구들</h2>
              </div>
              <button
                onClick={sendingTo ? undefined : onClose}
                disabled={!!sendingTo}
                className="w-8 h-8 flex items-center justify-center text-white/60 disabled:opacity-30"
                aria-label="닫기"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-4">
              {loading && users.length === 0 && (
                <div className="py-12 text-center text-white/40 text-sm">목록을 불러오는 중…</div>
              )}
              {!loading && users.length === 0 && (
                <div className="py-12 text-center text-white/40 text-sm">현재 접속 중인 친구가 없어요</div>
              )}
              <div className="flex flex-col gap-1.5">
                {users.map((u) => (
                  <OnlineUserRow
                    key={u.uid}
                    user={u}
                    isPending={sendingTo === u.uid}
                    isDisabled={!!sendingTo && sendingTo !== u.uid}
                    onClick={() => handleInvite(u.uid)}
                  />
                ))}
              </div>
            </div>
          </motion.div>

          <AnimatePresence>
            {toast && (
              <motion.div
                className="fixed z-[117] bottom-[calc(70dvh+1rem)] text-center"
                style={{ left: 'var(--home-sheet-left, 0px)', right: '0px' }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="inline-block px-4 py-2 bg-[#1A1A1A] text-white text-sm rounded-full border border-white/20">
                  {toast}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
