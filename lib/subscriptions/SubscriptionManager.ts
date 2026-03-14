/**
 * SubscriptionManager — 구독 참조 카운팅 + 중복 방지
 *
 * 같은 key로 여러 컴포넌트가 구독하면 실제 onSnapshot 1개만 유지.
 * 참조 카운트 0 → 자동 해제.
 * lastData 캐시 → 새 구독자 즉시 데이터 수신.
 *
 * Supabase 마이그레이션 시 이 매니저는 그대로 유지,
 * subscribe 함수만 Supabase realtime으로 교체하면 됩니다.
 */

import type { Unsubscribe } from '@/lib/repositories/types';

/** 구독 팩토리: key를 받아 실제 구독을 시작하고 unsubscribe를 반환 */
type SubscribeFactory<T> = (
  key: string,
  onData: (data: T) => void,
  onError?: (error: Error) => void,
) => Unsubscribe;

interface Subscription<T> {
  /** 실제 구독 해제 함수 */
  unsubscribe: Unsubscribe;
  /** 구독 중인 컴포넌트 수 */
  refCount: number;
  /** 마지막 데이터 (새 구독자에게 즉시 전달) */
  lastData: T | undefined;
  /** 데이터 리스너 목록 */
  listeners: Set<(data: T) => void>;
  /** 에러 리스너 목록 */
  errorListeners: Set<(error: Error) => void>;
}

export class SubscriptionManager<T = unknown> {
  private subs = new Map<string, Subscription<T>>();
  private factory: SubscribeFactory<T>;

  constructor(factory: SubscribeFactory<T>) {
    this.factory = factory;
  }

  /**
   * 구독 시작 (참조 카운팅)
   *
   * @returns unsubscribe 함수 (이 컴포넌트의 구독만 해제)
   */
  subscribe(
    key: string,
    onData: (data: T) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    const existing = this.subs.get(key);

    if (existing) {
      // 이미 구독 중 → 리스너만 추가
      existing.refCount++;
      existing.listeners.add(onData);
      if (onError) existing.errorListeners.add(onError);

      // 캐시된 데이터 즉시 전달
      if (existing.lastData !== undefined) {
        onData(existing.lastData);
      }

      return () => this.unsubscribeOne(key, onData, onError);
    }

    // 새 구독 시작
    const listeners = new Set<(data: T) => void>([onData]);
    const errorListeners = new Set<(error: Error) => void>();
    if (onError) errorListeners.add(onError);

    const sub: Subscription<T> = {
      unsubscribe: () => {},
      refCount: 1,
      lastData: undefined,
      listeners,
      errorListeners,
    };

    // 실제 구독 시작
    sub.unsubscribe = this.factory(
      key,
      (data) => {
        sub.lastData = data;
        for (const listener of sub.listeners) {
          listener(data);
        }
      },
      (error) => {
        for (const listener of sub.errorListeners) {
          listener(error);
        }
      },
    );

    this.subs.set(key, sub);

    return () => this.unsubscribeOne(key, onData, onError);
  }

  /** 단일 리스너 해제 */
  private unsubscribeOne(
    key: string,
    onData: (data: T) => void,
    onError?: (error: Error) => void,
  ): void {
    const sub = this.subs.get(key);
    if (!sub) return;

    sub.listeners.delete(onData);
    if (onError) sub.errorListeners.delete(onError);
    sub.refCount--;

    if (sub.refCount <= 0) {
      sub.unsubscribe();
      this.subs.delete(key);
    }
  }

  /** 특정 key의 캐시 데이터 조회 */
  getCachedData(key: string): T | undefined {
    return this.subs.get(key)?.lastData;
  }

  /** 모든 구독 해제 (cleanup) */
  clear(): void {
    for (const sub of this.subs.values()) {
      sub.unsubscribe();
    }
    this.subs.clear();
  }

  /** 활성 구독 수 */
  get size(): number {
    return this.subs.size;
  }
}
