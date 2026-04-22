/**
 * Cloud Functions 타입 안전 래퍼
 *
 * httpsCallable을 직접 호출하지 않고 이 래퍼를 사용하면:
 * 1. 함수명 오타 → 컴파일 에러
 * 2. 입출력 타입 자동 추론
 * 3. 에러 핸들링 통일
 * 4. Supabase 마이그레이션 시 이 파일만 교체
 */

import { httpsCallable, type HttpsCallableOptions } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { CloudFunctionMap } from './types';
import { shouldUseEdge, callEdgeFunction } from './edgeRouter';

/**
 * 타입 안전한 Cloud Function 호출
 *
 * @example
 * ```ts
 * const result = await callFunction('spinRabbitGacha', { courseId: 'biology' });
 * // result 타입: RollResultData (자동 추론)
 * ```
 *
 * Phase 3 Wave 1 이후: `NEXT_PUBLIC_USE_EDGE_{함수명}=true` 이면 Supabase Edge Function 으로 라우팅.
 */
export async function callFunction<K extends keyof CloudFunctionMap>(
  name: K,
  ...args: CloudFunctionMap[K]['input'] extends void
    ? [data?: undefined, options?: HttpsCallableOptions]
    : [data: CloudFunctionMap[K]['input'], options?: HttpsCallableOptions]
): Promise<CloudFunctionMap[K]['output']> {
  const [data, options] = args;

  if (shouldUseEdge(name)) {
    return callEdgeFunction(name, data as CloudFunctionMap[K]['input']);
  }

  const fn = httpsCallable<CloudFunctionMap[K]['input'], CloudFunctionMap[K]['output']>(
    functions,
    name,
    options,
  );
  const result = await fn(data as CloudFunctionMap[K]['input']);
  return result.data;
}
