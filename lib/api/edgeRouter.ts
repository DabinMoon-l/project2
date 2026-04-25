/**
 * Edge Function 라우팅 — Phase 3 Wave 1 이후 점진 확장
 *
 * Firebase `httpsCallable` 대신 Supabase Edge Function 을 호출해야 하는지 판정 +
 * 실제 호출 유틸. `NEXT_PUBLIC_USE_EDGE_{함수명}=true` 인 경우에만 Edge 로 라우팅.
 *
 * 2일 dual-deploy 흐름:
 *   Day 0: Edge Function 배포, flag off (기본값) → Firebase CF 사용
 *   Day 1: 비교 로그 확인
 *   Day 2: flag on → Edge 사용, 문제 생기면 flag off 로 즉시 롤백
 */
import { getAuth } from 'firebase/auth';
import { app } from '@/lib/firebase';
import type { CloudFunctionMap } from './types';

// CF 이름 → Edge Function URL path (kebab-case)
const EDGE_PATH_MAP: Partial<Record<keyof CloudFunctionMap, string>> = {
  // Wave 1-A
  acceptComment: 'accept-comment',
  deletePost: 'delete-post',
  deleteThread: 'delete-thread',
  getGeminiUsage: 'get-gemini-usage',
  // Wave 1-B (공지)
  markAnnouncementsRead: 'mark-announcements-read',
  reactToAnnouncement: 'react-to-announcement',
  submitPollSurvey: 'submit-poll-survey',
  getPollResponses: 'get-poll-responses',
  getPollResponsesBatch: 'get-poll-responses-batch',
};

// CF 이름 → env var key. 값이 'true' 이면 Edge 로.
const EDGE_FLAG_MAP: Partial<Record<keyof CloudFunctionMap, string>> = {
  // Wave 1-A
  acceptComment: 'NEXT_PUBLIC_USE_EDGE_ACCEPT_COMMENT',
  deletePost: 'NEXT_PUBLIC_USE_EDGE_DELETE_POST',
  deleteThread: 'NEXT_PUBLIC_USE_EDGE_DELETE_THREAD',
  getGeminiUsage: 'NEXT_PUBLIC_USE_EDGE_GET_GEMINI_USAGE',
  // Wave 1-B (공지)
  markAnnouncementsRead: 'NEXT_PUBLIC_USE_EDGE_MARK_ANNOUNCEMENTS_READ',
  reactToAnnouncement: 'NEXT_PUBLIC_USE_EDGE_REACT_TO_ANNOUNCEMENT',
  submitPollSurvey: 'NEXT_PUBLIC_USE_EDGE_SUBMIT_POLL_SURVEY',
  getPollResponses: 'NEXT_PUBLIC_USE_EDGE_GET_POLL_RESPONSES',
  getPollResponsesBatch: 'NEXT_PUBLIC_USE_EDGE_GET_POLL_RESPONSES_BATCH',
};

export function shouldUseEdge<K extends keyof CloudFunctionMap>(name: K): boolean {
  const envKey = EDGE_FLAG_MAP[name];
  if (!envKey) return false;
  const raw = process.env[envKey];
  return raw === 'true';
}

export function getEdgePath<K extends keyof CloudFunctionMap>(name: K): string | null {
  return EDGE_PATH_MAP[name] ?? null;
}

/**
 * Supabase Edge Function 호출.
 * - Firebase Auth ID 토큰을 Authorization 헤더로 전달 (Edge 에서 verifyFirebaseIdToken)
 * - body 는 기존 callFunction 입력 그대로
 * - 응답 `{ ok: false, error }` 는 Error 로 throw (기존 httpsCallable 과 호환)
 */
export async function callEdgeFunction<K extends keyof CloudFunctionMap>(
  name: K,
  data: CloudFunctionMap[K]['input'],
): Promise<CloudFunctionMap[K]['output']> {
  const path = getEdgePath(name);
  if (!path) throw new Error(`[edgeRouter] no path mapping for ${String(name)}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('[edgeRouter] NEXT_PUBLIC_SUPABASE_URL not configured');

  const token = await getAuth(app).currentUser?.getIdToken();
  if (!token) throw new Error('[edgeRouter] not authenticated');

  const res = await fetch(`${url}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data ?? {}),
  });

  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Record<string, unknown>;

  if (!res.ok || body.ok === false) {
    const msg = body.error ?? `Edge ${path} failed with ${res.status}`;
    throw new Error(msg);
  }

  return body as unknown as CloudFunctionMap[K]['output'];
}
