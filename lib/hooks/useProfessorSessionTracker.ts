/**
 * 교수 로그인 세션 추적 훅
 *
 * 교수 계정 로그인 시 디바이스 정보를 Firestore에 기록하고
 * 120초 주기로 heartbeat를 업데이트하여 활성 세션을 추적합니다.
 *
 * 컬렉션: professorLoginLogs/{auto-id}
 * 필드: uid, email, browser, os, deviceType, screenWidth, screenHeight,
 *       userAgent, loginAt, lastActiveAt
 */

'use client';

import { useEffect, useRef } from 'react';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser } from '@/lib/contexts';

const SESSION_KEY = 'professor_session_doc_id';
const HEARTBEAT_INTERVAL = 120_000; // 120초

// 디바이스 정보 파싱
function getDeviceInfo() {
  const ua = navigator.userAgent;

  // 브라우저 감지
  let browser = '알 수 없음';
  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('OPR') || ua.includes('Opera')) browser = 'Opera';
  else if (ua.includes('Chrome') && !ua.includes('Edg/')) browser = 'Chrome';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';

  // OS 감지
  let os = '알 수 없음';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('iPhone')) os = 'iOS (iPhone)';
  else if (ua.includes('iPad')) os = 'iOS (iPad)';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Linux')) os = 'Linux';

  // 디바이스 타입
  let deviceType: 'mobile' | 'tablet' | 'desktop' = 'desktop';
  if (/iPhone|Android.*Mobile/i.test(ua)) deviceType = 'mobile';
  else if (/iPad|Android(?!.*Mobile)/i.test(ua)) deviceType = 'tablet';

  return {
    browser,
    os,
    deviceType,
    userAgent: ua,
    screenWidth: screen.width,
    screenHeight: screen.height,
  };
}

/**
 * 교수 계정 전용 세션 추적 훅
 * - 탭 열릴 때 세션 로그 생성 (sessionStorage로 중복 방지)
 * - 120초마다 lastActiveAt heartbeat 업데이트
 */
export function useProfessorSessionTracker() {
  const { profile, isProfessor } = useUser();
  const sessionDocIdRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isProfessor || !profile?.uid) return;

    // heartbeat 시작 함수
    const startHeartbeat = (docId: string) => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        updateDoc(doc(db, 'professorLoginLogs', docId), {
          lastActiveAt: serverTimestamp(),
        }).catch(() => {});
      }, HEARTBEAT_INTERVAL);
    };

    // 이 탭에서 이미 세션을 생성했으면 heartbeat만 시작
    const existingId = sessionStorage.getItem(SESSION_KEY);
    if (existingId) {
      sessionDocIdRef.current = existingId;
      startHeartbeat(existingId);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }

    // 새 세션 로그 생성
    const createSession = async () => {
      try {
        const deviceInfo = getDeviceInfo();
        const docRef = await addDoc(collection(db, 'professorLoginLogs'), {
          uid: profile.uid,
          email: profile.email,
          loginAt: serverTimestamp(),
          lastActiveAt: serverTimestamp(),
          ...deviceInfo,
        });
        sessionDocIdRef.current = docRef.id;
        sessionStorage.setItem(SESSION_KEY, docRef.id);
        startHeartbeat(docRef.id);
      } catch (err) {
        console.error('교수 세션 기록 실패:', err);
      }
    };

    createSession();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isProfessor, profile?.uid, profile?.email]);
}
