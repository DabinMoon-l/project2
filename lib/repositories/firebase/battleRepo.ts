/**
 * Battle Repository — Firebase RTDB 구현체
 *
 * tekken/* RTDB 경로 접근을 추상화
 */

import { ref, onValue, off, set, remove, onDisconnect } from 'firebase/database';
import { getRtdb } from '@/lib/firebase';
import type { Unsubscribe } from '../types';

// ============================================================
// 배틀 구독
// ============================================================

/** 배틀 상태 구독 */
export function subscribeBattle(
  battleId: string,
  callback: (data: Record<string, unknown> | null) => void,
): Unsubscribe {
  const battleRef = ref(getRtdb(), `tekken/battles/${battleId}`);
  const handler = onValue(battleRef, (snap) => {
    callback(snap.val() as Record<string, unknown> | null);
  });
  return () => off(battleRef, 'value', handler);
}

/** 매칭 결과 구독 */
export function subscribeMatchResult(
  courseId: string,
  userId: string,
  callback: (data: Record<string, unknown> | null) => void,
): Unsubscribe {
  const matchRef = ref(getRtdb(), `tekken/matchmaking/${courseId}/result_${userId}`);
  const handler = onValue(matchRef, (snap) => {
    callback(snap.val() as Record<string, unknown> | null);
  });
  return () => off(matchRef, 'value', handler);
}

// ============================================================
// 연타 (Mash)
// ============================================================

/** 연타 탭 쓰기 */
export function writeMashTap(battleId: string, userId: string, count: number): void {
  const tapRef = ref(getRtdb(), `tekken/battles/${battleId}/mash/taps/${userId}`);
  set(tapRef, count);
}

/** 상대 연타 탭 구독 */
export function subscribeMashTaps(
  battleId: string,
  opponentId: string,
  callback: (taps: number) => void,
): Unsubscribe {
  const tapRef = ref(getRtdb(), `tekken/battles/${battleId}/mash/taps/${opponentId}`);
  const handler = onValue(tapRef, (snap) => {
    callback((snap.val() as number) || 0);
  });
  return () => off(tapRef, 'value', handler);
}

// ============================================================
// 매칭 큐 관리
// ============================================================

/** 매칭 큐에서 제거 */
export async function removeFromMatchQueue(courseId: string, queueKey: string): Promise<void> {
  const queueRef = ref(getRtdb(), `tekken/matchmaking/${courseId}/${queueKey}`);
  await remove(queueRef);
}

/** onDisconnect 설정 (연결 끊김 시 자동 정리) */
export function setOnDisconnect(path: string): void {
  const r = ref(getRtdb(), path);
  onDisconnect(r).remove();
}

/** 매칭 결과 제거 */
export async function removeMatchResult(courseId: string, userId: string): Promise<void> {
  const resultRef = ref(getRtdb(), `tekken/matchmaking/${courseId}/result_${userId}`);
  await remove(resultRef);
}
