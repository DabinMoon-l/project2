/**
 * useSubscription — SubscriptionManager React 어댑터
 *
 * SubscriptionManager를 React 훅으로 래핑합니다.
 * 컴포넌트 마운트/언마운트 시 자동 구독/해제.
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import type { SubscriptionManager } from './SubscriptionManager';

interface UseSubscriptionOptions<T> {
  /** SubscriptionManager 인스턴스 */
  manager: SubscriptionManager<T>;
  /** 구독 키 (null이면 구독하지 않음) */
  key: string | null;
  /** 에러 콜백 */
  onError?: (error: Error) => void;
}

/**
 * SubscriptionManager를 사용하는 React 훅
 *
 * @example
 * ```tsx
 * const ranking = useSubscription({
 *   manager: rankingManager,
 *   key: subKeys.ranking(courseId),
 * });
 * ```
 */
export function useSubscription<T>({
  manager,
  key,
  onError,
}: UseSubscriptionOptions<T>): T | undefined {
  const [data, setData] = useState<T | undefined>(
    key ? manager.getCachedData(key) : undefined,
  );
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!key) {
      setData(undefined);
      return;
    }

    // 캐시된 데이터가 있으면 즉시 설정
    const cached = manager.getCachedData(key);
    if (cached !== undefined) {
      setData(cached);
    }

    const unsubscribe = manager.subscribe(
      key,
      (newData) => setData(newData),
      (error) => onErrorRef.current?.(error),
    );

    return unsubscribe;
  }, [manager, key]);

  return data;
}
