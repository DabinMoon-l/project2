'use client';

/**
 * localStorage 기반 영구 상태 훅 (useState 대체)
 *
 * 용도: iOS PWA eviction으로 cold reload 시에도 UI 임시 상태(아코디언 펼침,
 * 탭 선택, 토글 등)를 유지. React useState와 동일한 인터페이스.
 *
 * 기본 저장소: **localStorage** — iOS standalone PWA가 WebView를 죽였다가
 *              재실행하면 sessionStorage는 "새 세션"으로 간주돼 날아감.
 *              localStorage는 앱 데이터 초기화하지 않는 한 영속.
 * sessionStorage 옵션: 탭 닫으면 지우고 싶은 경우 `{ storage: 'session' }`.
 *
 * 키 규칙: 앱 전역 unique — 예) `review-practice-currentIdx:{quizId}`
 * 값 타입: JSON 직렬화 가능한 것만 (Date·Map·Set 등은 직접 인코딩)
 *
 * 초기값 해석:
 * 1. 저장된 값이 있으면 파싱해서 사용
 * 2. 없으면 initial 사용
 * 3. initial이 함수면 lazy 호출 (useState 규약 동일)
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * SSR 안전한 layout effect — 서버에서는 useEffect, 클라이언트에서는 useLayoutEffect.
 * 왜 필요하냐: 상태 복원을 paint 전에 끝내 "빈 상태 → 복원 상태" 깜빡임을 제거.
 */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

type Initial<T> = T | (() => T);
type Updater<T> = T | ((prev: T) => T);

interface UseSessionStateOptions {
  /** 기본 'local' — iOS PWA가 WebView를 죽여도 유지됨. 'session'은 탭 종료/PWA 재기동 시 날아감 */
  storage?: 'session' | 'local';
  /** 직렬화 실패 시 값 폐기 여부 (기본 true) */
  clearOnParseError?: boolean;
}

function getStorage(kind: 'session' | 'local'): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readStored<T>(key: string, kind: 'session' | 'local', clearOnError: boolean): { ok: boolean; value?: T } {
  const storage = getStorage(kind);
  if (!storage) return { ok: false };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { ok: false };
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    if (clearOnError) {
      try {
        storage.removeItem(key);
      } catch {
        /* noop */
      }
    }
    return { ok: false };
  }
}

function writeStored<T>(key: string, value: T, kind: 'session' | 'local'): void {
  const storage = getStorage(kind);
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled */
  }
}

function removeStored(key: string, kind: 'session' | 'local'): void {
  const storage = getStorage(kind);
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* noop */
  }
}

/**
 * 상태 훅 — 값을 { storage, key }에 매번 반영.
 *
 * SSR 안전: 서버 렌더링에서는 저장소에 접근 안 하고 initial 사용,
 *            클라이언트 mount 후 1회 restore → rehydration 불일치 최소화.
 */
export function useSessionState<T>(
  key: string,
  initial: Initial<T>,
  options: UseSessionStateOptions = {},
): [T, (updater: Updater<T>) => void, () => void] {
  const { storage = 'local', clearOnParseError = true } = options;

  // SSR에서는 무조건 initial. 복원은 클라이언트 mount 시 별도 effect에서 처리.
  const [state, setState] = useState<T>(() => {
    if (typeof initial === 'function') {
      return (initial as () => T)();
    }
    return initial;
  });

  // 최초 1회 복원 — paint 전에 실행되어 빈 상태 플래시 방지
  const restoredRef = useRef(false);
  useIsomorphicLayoutEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const { ok, value } = readStored<T>(key, storage, clearOnParseError);
    if (ok) setState(value as T);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 값 변경 시 저장
  useEffect(() => {
    if (!restoredRef.current) return; // 초기 복원 전에는 저장 스킵 (초기값 덮어쓰기 방지)
    writeStored(key, state, storage);
  }, [key, state, storage]);

  const setWrapped = useCallback((updater: Updater<T>) => {
    setState((prev) => {
      if (typeof updater === 'function') {
        return (updater as (p: T) => T)(prev);
      }
      return updater;
    });
  }, []);

  const clear = useCallback(() => {
    removeStored(key, storage);
  }, [key, storage]);

  return [state, setWrapped, clear];
}

/**
 * `Set<T>` 전용 세션 상태 훅.
 * 내부적으로는 배열로 직렬화(Set은 JSON 직렬화 불가) + 매번 Set으로 재생성.
 *
 * 기존 `useState<Set<T>>` 코드를 바꿀 때 유용. 반환 시그니처는 `[Set, setter]`로
 * useState와 동일 인터페이스를 제공 (setter에 prev Set을 넘겨 새 Set을 반환).
 */
export function useSessionStateSet<T>(
  key: string,
  initial: Initial<Set<T>>,
  options: UseSessionStateOptions = {},
): [Set<T>, (updater: Set<T> | ((prev: Set<T>) => Set<T>)) => void, () => void] {
  const { storage = 'local', clearOnParseError = true } = options;

  const [arr, setArr] = useState<T[]>(() => {
    const init = typeof initial === 'function' ? (initial as () => Set<T>)() : initial;
    return Array.from(init);
  });

  const restoredRef = useRef(false);
  useIsomorphicLayoutEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const { ok, value } = readStored<T[]>(key, storage, clearOnParseError);
    if (ok && Array.isArray(value)) setArr(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restoredRef.current) return;
    writeStored(key, arr, storage);
  }, [key, arr, storage]);

  const setWrapped = useCallback(
    (updater: Set<T> | ((prev: Set<T>) => Set<T>)) => {
      setArr((prevArr) => {
        const prevSet = new Set(prevArr);
        const nextSet = typeof updater === 'function' ? (updater as (p: Set<T>) => Set<T>)(prevSet) : updater;
        return Array.from(nextSet);
      });
    },
    [],
  );

  const clear = useCallback(() => {
    removeStored(key, storage);
  }, [key, storage]);

  // Set 자체는 매 렌더 생성되어도 참조가 바뀜 → useMemo로 arr 변화 시에만 새 Set
  const setValue = useSetMemo(arr);

  return [setValue, setWrapped, clear];
}

/** 배열이 바뀔 때만 Set 인스턴스를 새로 만드는 useMemo 분리 유틸 */
function useSetMemo<T>(arr: T[]): Set<T> {
  // useMemo를 외부에서 쓰면 훅 순서 제약 위반 가능 — 별도 함수로 감싸 안전하게
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemoSet(arr);
}

function useMemoSet<T>(arr: T[]): Set<T> {
  const ref = useRef<{ arr: T[]; set: Set<T> } | null>(null);
  if (!ref.current || ref.current.arr !== arr) {
    ref.current = { arr, set: new Set(arr) };
  }
  return ref.current.set;
}

/**
 * 주어진 prefix로 시작하는 모든 세션 저장 키 제거.
 * 예: 복습 세션 종료 시 `clearSessionPrefix('rp:abc123')`로 해당 세션 상태 일괄 정리.
 */
export function clearSessionPrefix(prefix: string, kind: 'session' | 'local' = 'local'): void {
  const storage = getStorage(kind);
  if (!storage) return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => storage.removeItem(k));
  } catch {
    /* noop */
  }
}
