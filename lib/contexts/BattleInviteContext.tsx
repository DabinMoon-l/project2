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

  // 수신자 본인이 invite 정리 — CF 가 status 를 non-pending 으로 바꾼 뒤에만.
  // ⚠️ pending 상태를 client 시계 기준으로 미리 지우면, 유저가 마지막 1초에
  //   수락 버튼 눌렀을 때 remove() 가 CF 의 respondBattleInvite 보다 먼저 도달해
  //   CF 가 '신청을 찾을 수 없습니다' 로 실패하는 race 가 발생. CF 가 만료까지
  //   서버 시간 기준으로 검증하므로 client 는 UI 숨김만 담당하고 삭제는 하지 않음.
  useEffect(() => {
    if (!user?.uid || !raw) return;
    if (raw.status === 'pending') return; // pending 이면 client 가 지우지 않음
    remove(ref(getRtdb(), `battleInvites/${user.uid}/current`)).catch(() => {});
  }, [user?.uid, raw]);

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
