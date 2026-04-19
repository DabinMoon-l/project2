'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { ref as rtdbRef, set, onDisconnect, serverTimestamp as rtdbServerTimestamp } from 'firebase/database';
import { doc, setDoc, arrayUnion, db } from '@/lib/repositories';
import { getRtdb } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useHomeOverlay } from '@/lib/contexts/HomeOverlayContext';

const UPDATE_INTERVAL = 120_000; // 120초

// 경로 기반 현재 활동 판정
function getCurrentActivity(pathname: string): string {
  if (pathname.startsWith('/quiz/create')) return '퀴즈 출제';
  if (/^\/quiz\/[^/]+/.test(pathname)) return '퀴즈 풀이';
  if (pathname === '/quiz') return '퀴즈 탐색';
  if (pathname.startsWith('/review')) return '복습';
  if (pathname.startsWith('/board')) return '게시판';
  if (pathname === '/' || pathname === '/professor') return '홈';
  if (pathname.startsWith('/professor')) return '교수 대시보드';
  if (pathname.startsWith('/profile') || pathname.startsWith('/settings')) return '설정';
  return '탐색 중';
}

/**
 * 학생 접속 상태 추적 훅 — RTDB presence 기반.
 *
 * **이유**: 이전엔 120초마다 Firestore `users/{uid}.lastActiveAt`을 업데이트했는데,
 * 교수의 `users` 컬렉션 onSnapshot이 모든 학생 heartbeat마다 트리거돼 읽기 폭증 유발.
 * → RTDB `presence/{courseId}/{uid}`로 분리하면 Firestore users 문서는 건드리지 않음.
 *
 * 경로: `presence/{courseId}/{uid}` = `{ online, lastActiveAt, currentActivity }`
 * - 120초마다 heartbeat로 `online: true` + lastActiveAt 갱신
 * - 탭 닫힘/네트워크 끊김 시 `onDisconnect().update({ online: false })` —
 *   lastActiveAt은 건드리지 않아 마지막 활동 시각 보존 + 교수 화면 즉시 offline 반영
 *   (2026-04-19: 기존 `.remove()`가 presence를 통째 지워 스테일 Firestore 값으로
 *   회귀하던 버그를 해결)
 * - 교수 측은 `useProfessorStudents`에서 RTDB onValue로 병합해 렌더
 *
 * 일일 접속 기록(`dailyAttendance`)은 영구 통계용이라 Firestore 유지 (하루 1회 쓰기).
 */
export function useActivityTracker(courseId?: string, isProfessor?: boolean) {
  const { user } = useAuth();
  const pathname = usePathname();
  const { isOpen: isHomeOverlayOpen } = useHomeOverlay();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onDisconnectCancelRef = useRef<(() => Promise<void>) | null>(null);

  // presence 쓰기 — RTDB `presence/{courseId}/{uid}` 120초마다 갱신
  useEffect(() => {
    if (!user?.uid || !courseId || isProfessor) return;

    const presenceRef = rtdbRef(getRtdb(), `presence/${courseId}/${user.uid}`);
    const activity = isHomeOverlayOpen ? '홈' : getCurrentActivity(pathname);

    const write = () => {
      set(presenceRef, {
        online: true,
        lastActiveAt: rtdbServerTimestamp(),
        currentActivity: activity,
      }).catch(() => {});
    };

    // 탭 닫힘/연결 끊김 시 online=false만 세팅 (lastActiveAt 보존)
    // → 교수 화면에서 즉시 offline 반영 + 마지막 활동 시각 유지
    const disconnectHandle = onDisconnect(presenceRef);
    disconnectHandle.update({ online: false }).catch(() => {});
    onDisconnectCancelRef.current = () => disconnectHandle.cancel().catch(() => {});

    // 즉시 1회 쓰기 + 인터벌
    write();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(write, UPDATE_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      onDisconnectCancelRef.current?.();
      onDisconnectCancelRef.current = null;
    };
  }, [user?.uid, courseId, isProfessor, pathname, isHomeOverlayOpen]);

  // 일일 접속 기록 (학생만, 하루 1회)
  // dailyAttendance/{courseId}_{YYYY-MM-DD} 문서에 uid를 arrayUnion
  useEffect(() => {
    if (!user?.uid || !courseId || isProfessor) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const storageKey = `daily-att-${user.uid}-${today}`;
    if (localStorage.getItem(storageKey)) return;

    const attRef = doc(db, 'dailyAttendance', `${courseId}_${today}`);
    setDoc(attRef, { attendedUids: arrayUnion(user.uid) }, { merge: true })
      .then(() => localStorage.setItem(storageKey, '1'))
      .catch(() => {});
  }, [user?.uid, courseId, isProfessor]);
}
