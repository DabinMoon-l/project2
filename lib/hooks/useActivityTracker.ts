'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { ref as rtdbRef, set, serverTimestamp as rtdbServerTimestamp } from 'firebase/database';
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
 * 경로: `presence/{courseId}/{uid}` = `{ lastActiveAt, currentActivity }`
 * - 120초마다 heartbeat로 갱신, 150초 지나면 교수 화면에서 offline 판정
 * - **onDisconnect로 지우지 않음** (2026-04-19 수정):
 *   탭 닫힘 시 presence를 지우면 `useProfessorStudents`가 스테일 Firestore
 *   `users.lastActiveAt`(이 훅이 더 이상 안 씀)으로 회귀해 "들어오기 전 시점"으로
 *   표시되는 버그. 대신 마지막 heartbeat 시간을 남겨두고 150초 TTL로 offline 판정.
 * - 교수 측은 `useProfessorStudents`에서 RTDB onValue로 병합해 렌더
 *
 * 일일 접속 기록(`dailyAttendance`)은 영구 통계용이라 Firestore 유지 (하루 1회 쓰기).
 */
export function useActivityTracker(courseId?: string, isProfessor?: boolean) {
  const { user } = useAuth();
  const pathname = usePathname();
  const { isOpen: isHomeOverlayOpen } = useHomeOverlay();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // presence 쓰기 — RTDB `presence/{courseId}/{uid}` 120초마다 갱신
  useEffect(() => {
    if (!user?.uid || !courseId || isProfessor) return;

    const presenceRef = rtdbRef(getRtdb(), `presence/${courseId}/${user.uid}`);
    const activity = isHomeOverlayOpen ? '홈' : getCurrentActivity(pathname);

    const write = () => {
      set(presenceRef, {
        lastActiveAt: rtdbServerTimestamp(),
        currentActivity: activity,
      }).catch(() => {});
    };

    // 즉시 1회 쓰기 + 인터벌
    write();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(write, UPDATE_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
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
