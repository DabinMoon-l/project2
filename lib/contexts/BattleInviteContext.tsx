'use client';

/**
 * 배틀 신청 수신 전역 구독 Context
 *
 * 역할:
 *  - `battleInvites/{myUid}/current` RTDB 전역 구독
 *  - pending 상태 + expiresAt 미도래 invite만 노출 (자동 만료 정리)
 *  - 학습 방해 금지: `/quiz/[id]` 경로에선 pendingInvite를 숨김 (구독은 유지)
 *
 * 수락/거절 액션은 도전장 모달 컴포넌트가 직접 CF 호출 + 라우팅 처리.
 * 이 Provider는 **상태만** 제공해 유지보수가 간단하도록 분리.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ref, onValue, remove } from 'firebase/database';
import { getRtdb } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';

export interface PendingInvite {
  id: string;
  senderUid: string;
  senderNickname: string;
  senderClass: string | null;
  senderRabbit: { rabbitId: number; name: string; level: number };
  chapters: string[];
  courseId: string;
  createdAt: number;
  expiresAt: number;
}

interface BattleInviteContextType {
  pendingInvite: PendingInvite | null;
}

const BattleInviteContext = createContext<BattleInviteContextType>({ pendingInvite: null });

export function useBattleInvite(): BattleInviteContextType {
  return useContext(BattleInviteContext);
}

/** 학습 중(퀴즈 풀이 중) 경로에선 도전장 숨김 — 이미 bused 체크로 신청도 안 오지만 이중 안전장치 */
function isLearningPath(pathname: string): boolean {
  // `/quiz/[id]` (퀴즈 풀이) — `/quiz`나 `/quiz/create`는 허용
  if (/^\/quiz\/[^/]+/.test(pathname) && pathname !== '/quiz/create') return true;
  return false;
}

export function BattleInviteProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname() || '';
  const [raw, setRaw] = useState<(PendingInvite & { status: string }) | null>(null);

  // 전역 invite 구독
  useEffect(() => {
    if (!user?.uid) {
      setRaw(null);
      return;
    }
    const inviteRef = ref(getRtdb(), `battleInvites/${user.uid}/current`);
    const unsub = onValue(inviteRef, (snap) => {
      const data = snap.val() as (PendingInvite & { status: string }) | null;
      setRaw(data);
    });
    return () => unsub();
  }, [user?.uid]);

  // 자동 만료 — expiresAt 지난 invite는 숨김 + 청소
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!raw || raw.status !== 'pending') return;
    const remaining = raw.expiresAt - Date.now();
    if (remaining <= 0) {
      setTick((t) => t + 1);
      return;
    }
    const t = setTimeout(() => setTick((v) => v + 1), remaining + 50);
    return () => clearTimeout(t);
  }, [raw]);

  // 수신자 본인이 만료된 invite 삭제 (RTDB 룰: 본인 삭제만 허용)
  useEffect(() => {
    if (!user?.uid || !raw) return;
    if (raw.status === 'pending' && Date.now() <= raw.expiresAt) return;
    // pending이 아니거나 만료되었으면 정리
    remove(ref(getRtdb(), `battleInvites/${user.uid}/current`)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, raw, tick]);

  // 노출할 pendingInvite 판정
  let pendingInvite: PendingInvite | null = null;
  if (raw && raw.status === 'pending' && Date.now() < raw.expiresAt && !isLearningPath(pathname)) {
    pendingInvite = {
      id: raw.id,
      senderUid: raw.senderUid,
      senderNickname: raw.senderNickname,
      senderClass: raw.senderClass,
      senderRabbit: raw.senderRabbit,
      chapters: raw.chapters,
      courseId: raw.courseId,
      createdAt: raw.createdAt,
      expiresAt: raw.expiresAt,
    };
  }

  return (
    <BattleInviteContext.Provider value={{ pendingInvite }}>
      {children}
    </BattleInviteContext.Provider>
  );
}
