'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { ref as rtdbRef, set, update, onDisconnect, serverTimestamp as rtdbServerTimestamp } from 'firebase/database';
import { doc, setDoc, arrayUnion, db } from '@/lib/repositories';
import { getRtdb } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';

const UPDATE_INTERVAL = 120_000; // 120초

// 경로 기반 현재 활동 — 학생 4탭(홈/퀴즈/복습/게시판) 중 하나로만 판정.
// 교수 학생탭 presence 표시는 항상 이 4개 중 하나여야 함.
// (가로모드 3쪽 잠금/홈오버레이 같은 패널 상태는 위치 표시에 섞지 않음 → busy로 분리)
function getCurrentActivity(pathname: string): string {
  if (pathname.startsWith('/quiz')) return '퀴즈';
  if (pathname.startsWith('/review')) return '복습';
  if (pathname.startsWith('/board')) return '게시판';
  return '홈'; // '/', '/professor', '/profile', '/settings' 등 나머지 전부 홈
}

// 배틀 신청 차단용 '바쁨' 판정 — 위치(currentActivity)와 분리해 presence.busy로 별도 기록.
// 가로모드 3쪽 잠금(isLocked: 퀴즈/복습/만들기 진행) 또는 실제 풀이/출제 화면이면 바쁨.
function isBusyState(pathname: string, isLocked: boolean): boolean {
  if (isLocked) return true;
  if (pathname.startsWith('/quiz/create')) return true; // 퀴즈 출제
  if (/^\/quiz\/[^/]+/.test(pathname)) return true;      // 퀴즈 풀이/결과
  return false;
}

/**
 * 학생 접속 상태 추적 훅 — RTDB presence 기반.
 *
 * 경로: `presence/{courseId}/{uid}` = `{ online, lastActiveAt, currentActivity }`
 *
 * **offline 감지 3중 레이어**:
 * 1. `pagehide` 이벤트 — 탭 닫기/새로고침/네비게이션 즉시 online=false 쓰기 (가장 빠름)
 * 2. `visibilitychange` hidden — 모바일 앱 백그라운드 전환 즉시 online=false
 * 3. `onDisconnect().update({ online: false })` — 강제종료/네트워크 끊김 최후 안전장치
 *    (RTDB 서버 TCP 감지는 최대 60~90초 걸려 1,2를 먼저 시도)
 *
 * lastActiveAt은 offline 전환 시에도 건드리지 않아 "마지막 활동 시각" 보존.
 * 예전 `.remove()`가 presence를 통째 지워 스테일 Firestore 값으로 회귀하던 버그
 * 해결(2026-04-19).
 *
 * 교수 측은 `useProfessorStudents`에서 RTDB onValue로 병합해 렌더.
 * 일일 접속 기록(`dailyAttendance`)은 영구 통계용이라 Firestore 유지 (하루 1회 쓰기).
 */
export function useActivityTracker(courseId?: string, isProfessor?: boolean, isLocked?: boolean) {
  const { user } = useAuth();
  const pathname = usePathname();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onDisconnectCancelRef = useRef<(() => Promise<void>) | null>(null);

  // presence 쓰기 — RTDB `presence/{courseId}/{uid}` 120초마다 갱신
  useEffect(() => {
    if (!user?.uid || !courseId || isProfessor) return;

    const presenceRef = rtdbRef(getRtdb(), `presence/${courseId}/${user.uid}`);
    const activity = getCurrentActivity(pathname);
    const busy = isBusyState(pathname, !!isLocked);

    const writeOnline = () => {
      set(presenceRef, {
        online: true,
        lastActiveAt: rtdbServerTimestamp(),
        currentActivity: activity,
        busy,
      }).catch(() => {});
    };

    const writeOffline = () => {
      // online 플래그만 내리고 lastActiveAt은 유지 (마지막 활동 시각 보존)
      update(presenceRef, { online: false }).catch(() => {});
    };

    // onDisconnect: RTDB 서버가 TCP 끊김 감지 시 fire (최후 안전장치)
    const disconnectHandle = onDisconnect(presenceRef);
    disconnectHandle.update({ online: false }).catch(() => {});
    onDisconnectCancelRef.current = () => disconnectHandle.cancel().catch(() => {});

    // pagehide: 탭 닫기/새로고침/외부 네비게이션 — 가장 신뢰할 수 있는 이탈 신호
    const handlePageHide = () => writeOffline();
    window.addEventListener('pagehide', handlePageHide);

    // visibilitychange: 모바일 PWA 백그라운드 전환/데스크톱 탭 전환
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        writeOffline();
      } else if (document.visibilityState === 'visible') {
        // 복귀 시 online 재설정
        writeOnline();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // 즉시 1회 쓰기 + 인터벌
    writeOnline();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(writeOnline, UPDATE_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibility);
      onDisconnectCancelRef.current?.();
      onDisconnectCancelRef.current = null;
    };
  }, [user?.uid, courseId, isProfessor, pathname, isLocked]);

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
