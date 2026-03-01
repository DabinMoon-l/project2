/**
 * 온라인/오프라인 상태 감지 훅
 *
 * navigator.onLine + online/offline 이벤트로 실시간 감지
 * SSR 안전: 서버에서는 항상 true 반환
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 현재 온라인 상태를 반환하는 훅
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 초기값 동기화
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

/**
 * 오프라인 대기 큐 — 온라인 복귀 시 자동 실행
 *
 * IndexedDB에 작업을 저장하고 온라인 복귀 시 순차 실행
 */

const OFFLINE_QUEUE_KEY = 'rabbitory_offline_queue';

export interface OfflineAction {
  id: string;
  type: string;
  payload: any;
  createdAt: number;
}

/**
 * 오프라인 큐에 작업 추가
 */
export function enqueueOfflineAction(action: Omit<OfflineAction, 'id' | 'createdAt'>): void {
  try {
    const queue = getOfflineQueue();
    queue.push({
      ...action,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage 용량 초과 등 무시
  }
}

/**
 * 오프라인 큐 조회
 */
export function getOfflineQueue(): OfflineAction[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * 오프라인 큐 비우기
 */
export function clearOfflineQueue(): void {
  localStorage.removeItem(OFFLINE_QUEUE_KEY);
}

/**
 * 온라인 복귀 시 큐 실행 훅
 */
export function useOfflineQueueProcessor(
  processor: (action: OfflineAction) => Promise<void>
): void {
  const isOnline = useOnlineStatus();
  const isProcessingRef = useRef(false);

  const processQueue = useCallback(async () => {
    // 중복 실행 방지
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      const queue = getOfflineQueue();
      if (queue.length === 0) return;

      const failed: OfflineAction[] = [];
      for (const action of queue) {
        try {
          await processor(action);
        } catch {
          failed.push(action);
        }
      }

      if (failed.length > 0) {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(failed));
      } else {
        clearOfflineQueue();
      }
    } finally {
      isProcessingRef.current = false;
    }
  }, [processor]);

  useEffect(() => {
    if (isOnline) {
      processQueue();
    }
  }, [isOnline, processQueue]);
}
