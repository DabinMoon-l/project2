'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { collection, addDoc, updateDoc, doc, serverTimestamp, db } from '@/lib/repositories';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts/CourseContext';

const MAX_DURATION_MS = 30 * 60 * 1000; // 30분 이상은 비활성 탭으로 간주

// 세션 ID 생성 (탭 단위 — 새 탭/새로고침마다 새 세션)
function getSessionId(): string {
  let sessionId = sessionStorage.getItem('pv_session_id');
  if (!sessionId) {
    sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('pv_session_id', sessionId);
  }
  return sessionId;
}

// 경로를 카테고리로 분류 (연구 분석용)
function categorize(path: string): string {
  if (path === '/' || path === '/professor') return 'home';
  if (path === '/quiz' || path === '/professor/quiz') return 'quiz_list';
  if (path.startsWith('/quiz/create') || path === '/professor/quiz/create') return 'quiz_create';
  if (/^\/quiz\/[^/]+\/result/.test(path)) return 'quiz_result';
  if (/^\/quiz\/[^/]+\/feedback/.test(path)) return 'quiz_feedback';
  if (/^\/quiz\/[^/]+/.test(path)) return 'quiz_solve';
  if (path === '/review') return 'review_list';
  if (path === '/review/random') return 'review_practice';
  if (/^\/review\/[^/]+\/[^/]+/.test(path)) return 'review_detail';
  if (/^\/board\/[^/]+/.test(path)) return 'board_detail';
  if (path === '/board') return 'board_list';
  if (path === '/ranking') return 'ranking';
  if (path === '/profile') return 'profile';
  if (path === '/settings') return 'settings';
  if (path.startsWith('/professor/stats')) return 'prof_stats';
  if (path.startsWith('/professor/students')) return 'prof_students';
  if (/^\/professor\/quiz\/[^/]+\/preview/.test(path)) return 'prof_quiz_preview';
  return 'other';
}

/**
 * 페이지뷰 로깅 훅
 * 경로 변경 시 Firestore pageViews 컬렉션에 기록
 * - 같은 경로 연속 중복 방지
 * - 세션 ID로 방문 흐름 추적
 * - 카테고리 분류로 연구 분석 용이
 */
export function usePageViewLogger() {
  const { user } = useAuth();
  const pathname = usePathname();
  const { userCourseId, userClassId } = useCourse();
  const lastPathRef = useRef<string>('');
  const lastTimeRef = useRef<number>(0);
  const prevDocIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.uid || !pathname) return;

    const now = Date.now();
    // 같은 경로 2초 내 중복 방지
    if (pathname === lastPathRef.current && now - lastTimeRef.current < 2000) return;

    // 이전 페이지뷰에 체류시간 기록 (30분 미만만)
    if (prevDocIdRef.current && lastTimeRef.current) {
      const durationMs = now - lastTimeRef.current;
      if (durationMs < MAX_DURATION_MS) {
        updateDoc(doc(db, 'pageViews', prevDocIdRef.current), { durationMs }).catch(() => {});
      }
    }

    lastPathRef.current = pathname;
    lastTimeRef.current = now;

    // 새 페이지뷰 기록
    addDoc(collection(db, 'pageViews'), {
      userId: user.uid,
      path: pathname,
      category: categorize(pathname),
      sessionId: getSessionId(),
      courseId: userCourseId || null,
      classId: userClassId || null,
      timestamp: serverTimestamp(),
    }).then(ref => {
      prevDocIdRef.current = ref.id;
    }).catch(() => {});
  }, [user?.uid, pathname, userCourseId, userClassId]);
}

/**
 * 오버레이/바텀시트 열기 이벤트 로깅 훅
 * URL이 바뀌지 않는 오버레이(공지, 의견, 랭킹 등) 열기를 pageViews에 기록
 */
export function useLogOverlayView() {
  const { user } = useAuth();
  const { userCourseId, userClassId } = useCourse();

  return useCallback((category: string) => {
    if (!user?.uid) return;
    addDoc(collection(db, 'pageViews'), {
      userId: user.uid,
      path: `/@overlay/${category}`,
      category,
      sessionId: getSessionId(),
      courseId: userCourseId || null,
      classId: userClassId || null,
      timestamp: serverTimestamp(),
    }).catch(() => {});
  }, [user?.uid, userCourseId, userClassId]);
}
