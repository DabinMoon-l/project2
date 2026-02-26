'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';

const UPDATE_INTERVAL = 30_000; // 30초

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

// 학생 접속 상태 추적 훅 — 30초마다 lastActiveAt + currentActivity 업데이트
export function useActivityTracker() {
  const { user } = useAuth();
  const pathname = usePathname();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user?.uid) return;

    const userRef = doc(db, 'users', user.uid);
    const activity = getCurrentActivity(pathname);

    const update = () => {
      updateDoc(userRef, {
        lastActiveAt: serverTimestamp(),
        currentActivity: activity,
      }).catch(() => {
        // 권한 에러 등 무시 (교수 role이 이 필드 쓰기 불가일 수 있음)
      });
    };

    // 즉시 1회 업데이트
    update();

    // 30초 간격 반복
    intervalRef.current = setInterval(update, UPDATE_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user?.uid, pathname]);
}
