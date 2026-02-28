'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';

const UPDATE_INTERVAL = 120_000; // 120초 (30초 → 120초로 줄여 Firestore 쓰기 빈도 75% 감소)

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

// 학생 접속 상태 추적 훅 — 120초마다 lastActiveAt + currentActivity 업데이트
// activity가 변경된 경우에만 즉시 쓰기, 동일하면 인터벌만 유지
export function useActivityTracker() {
  const { user } = useAuth();
  const pathname = usePathname();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef<string>('');
  const lastWriteRef = useRef<number>(0);

  useEffect(() => {
    if (!user?.uid) return;

    const userRef = doc(db, 'users', user.uid);
    const activity = getCurrentActivity(pathname);

    const update = () => {
      lastActivityRef.current = activity;
      lastWriteRef.current = Date.now();
      updateDoc(userRef, {
        lastActiveAt: serverTimestamp(),
        currentActivity: activity,
      }).catch(() => {});
    };

    // activity가 변경되었거나 마지막 쓰기로부터 충분한 시간이 지났을 때만 즉시 쓰기
    const timeSinceLastWrite = Date.now() - lastWriteRef.current;
    if (activity !== lastActivityRef.current || timeSinceLastWrite > UPDATE_INTERVAL) {
      update();
    }

    // 이전 인터벌 정리 후 새 인터벌 설정
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(update, UPDATE_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user?.uid, pathname]);
}
