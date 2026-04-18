'use client';

/**
 * 퀴즈 답안 로컬 임시저장 훅
 *
 * localStorage에 debounce로 중간 답안을 저장해 iOS PWA eviction 후
 * cold reload에도 복원. Firestore quizProgress와 별개의 빠른 로컬 저장.
 *
 * - 변경 시 500ms debounce 저장
 * - pagehide/visibilitychange:hidden 시 즉시 flush
 * - 제출 완료 시 clear() 호출
 * - 24시간 초과된 draft는 복원 시 무시
 */

import { useCallback, useEffect, useRef } from 'react';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface QuizDraft<A, R> {
  answers: Record<string, A>;
  currentQuestionIndex: number;
  submittedQuestions: string[];
  gradeResults: Record<string, R>;
  savedAt: number;
}

function draftKey(userId: string | null | undefined, quizId: string | null | undefined) {
  if (!userId || !quizId) return null;
  return `rabbitory-quiz-draft:${userId}:${quizId}`;
}

export function useQuizDraft<A, R>(
  userId: string | null | undefined,
  quizId: string | null | undefined,
) {
  const keyRef = useRef<string | null>(null);
  keyRef.current = draftKey(userId, quizId);

  const load = useCallback((): QuizDraft<A, R> | null => {
    const k = keyRef.current;
    if (!k) return null;
    try {
      const raw = localStorage.getItem(k);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as QuizDraft<A, R>;
      if (!parsed || typeof parsed !== 'object') return null;
      if (Date.now() - (parsed.savedAt || 0) > MAX_AGE_MS) {
        localStorage.removeItem(k);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const save = useCallback((draft: Omit<QuizDraft<A, R>, 'savedAt'>) => {
    const k = keyRef.current;
    if (!k) return;
    try {
      const payload: QuizDraft<A, R> = { ...draft, savedAt: Date.now() };
      localStorage.setItem(k, JSON.stringify(payload));
    } catch {
      /* quota or disabled */
    }
  }, []);

  const clear = useCallback(() => {
    const k = keyRef.current;
    if (!k) return;
    try {
      localStorage.removeItem(k);
    } catch {
      /* noop */
    }
  }, []);

  return { load, save, clear };
}

/**
 * 퀴즈 상태를 debounced로 localStorage에 자동 저장.
 * pagehide/visibilitychange:hidden 시 즉시 flush.
 *
 * enabled가 false면 저장 비활성 (예: 로딩 중, 제출 완료 후).
 */
export function useAutoSaveQuizDraft<A, R>({
  enabled,
  userId,
  quizId,
  answers,
  currentQuestionIndex,
  submittedQuestions,
  gradeResults,
}: {
  enabled: boolean;
  userId: string | null | undefined;
  quizId: string | null | undefined;
  answers: Record<string, A>;
  currentQuestionIndex: number;
  submittedQuestions: Set<string>;
  gradeResults: Record<string, R>;
}) {
  const { save } = useQuizDraft<A, R>(userId, quizId);

  const latestRef = useRef({ answers, currentQuestionIndex, submittedQuestions, gradeResults });
  latestRef.current = { answers, currentQuestionIndex, submittedQuestions, gradeResults };

  const flush = useCallback(() => {
    if (!enabled) return;
    const { answers: a, currentQuestionIndex: idx, submittedQuestions: sub, gradeResults: gr } = latestRef.current;
    save({
      answers: a,
      currentQuestionIndex: idx,
      submittedQuestions: Array.from(sub),
      gradeResults: gr,
    });
  }, [enabled, save]);

  // debounced 저장
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(flush, 500);
    return () => clearTimeout(t);
  }, [enabled, flush, answers, currentQuestionIndex, submittedQuestions, gradeResults]);

  // 앱 숨김/이탈 시 즉시 flush
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [enabled, flush]);
}
