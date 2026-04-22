/**
 * User Repository — Supabase 구현체 (Phase 2 Step 3 — userRepo)
 *
 * Firebase userRepo 와 **동일한 API 시그니처** 유지.
 * 반환 shape 는 Firestore 문서와 호환되도록 카멜케이스 매핑.
 *
 * 테이블:
 *   public.user_profiles — (org_id, user_id, nickname, name, role, course_id,
 *     class_type, total_exp, level, rank, badges, equipped_rabbits,
 *     profile_rabbit_id, total_correct, total_attempted_questions,
 *     professor_quizzes_completed, tekken_total, feedback_count,
 *     last_gacha_exp, spin_lock, recovery_email, assigned_courses, ...)
 *
 * 쓰기 경로는 **전부 Firebase 위임** — CF dual-write(`supabaseDualUpsertUser` /
 * `supabaseDualUpdateUserPartial` 등)가 Firestore 트리거/onCall 에서 Supabase 동기.
 * 클라가 Firestore 에 쓰면 CF 가 Supabase 를 맞춤.
 *
 * user_profiles 에 매핑되지 않은 필드(email/studentId/department/characterOptions/
 * equipment/appSettings/fcmTokens/createdAt/updatedAt 등)가 필요한 읽기는
 * **Firebase 위임** — `getProfile` / `subscribeProfile` / `getAppSettings` /
 * `getStudentId` / `profileExists` 등.
 */

import { getSupabaseClient } from '@/lib/clients/supabase';
import type { Unsubscribe, ErrorCallback } from '../types';
import * as firebaseUserRepo from '../firebase/userRepo';
import type { UserDoc, CreatorInfo } from '../firebase/userRepo';

const DEFAULT_ORG_ID = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID || '';
const POLL_INTERVAL_MS = 30_000;

// ============================================================
// 공통 타입 재export (Firebase 와 동일 시그니처)
// ============================================================

export type { UserDoc, CreatorInfo } from '../firebase/userRepo';

// ============================================================
// course UUID ↔ code 양방향 캐시
// ============================================================

const _courseUuidCache = new Map<string, string>(); // code → uuid
const _courseCodeCache = new Map<string, string>(); // uuid → code

async function buildCourseCaches(): Promise<void> {
  if (_courseUuidCache.size > 0) return;
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return;
  const { data } = await supabase
    .from('courses')
    .select('id, code')
    .eq('org_id', DEFAULT_ORG_ID);
  for (const row of (data as Array<{ id: string; code: string }> | null) || []) {
    _courseUuidCache.set(row.code, row.id);
    _courseCodeCache.set(row.id, row.code);
  }
}

async function resolveCourseUuid(courseCode: string): Promise<string | null> {
  await buildCourseCaches();
  return _courseUuidCache.get(courseCode) || null;
}

function uuidToCourseCode(uuid: string | null): string | null {
  if (!uuid) return null;
  return _courseCodeCache.get(uuid) || null;
}

// ============================================================
// Row → Firestore 호환 doc 변환
// ============================================================

interface UserProfileRow {
  user_id: string;
  org_id: string;
  nickname: string | null;
  name: string | null;
  role: string | null;
  course_id: string | null;
  class_type: string | null;
  total_exp: number | null;
  level: number | null;
  rank: number | null;
  badges: string[] | null;
  equipped_rabbits: Array<{ rabbitId: number; courseId: string }> | null;
  profile_rabbit_id: number | null;
  total_correct: number | null;
  total_attempted_questions: number | null;
  professor_quizzes_completed: number | null;
  tekken_total: number | null;
  feedback_count: number | null;
  last_gacha_exp: number | null;
  spin_lock: boolean | null;
  recovery_email: string | null;
  assigned_courses: string[] | null;
  [key: string]: unknown;
}

/**
 * user_profiles row → Firestore-compat UserDoc.
 * - class_type → classId (Firestore 필드명 호환)
 * - course_id(uuid) → courseCode (Firestore 필드명은 courseId = courseCode 문자열)
 * - snake_case → camelCase
 */
function rowToUserDoc(row: UserProfileRow): UserDoc {
  return {
    id: row.user_id,
    nickname: row.nickname || '',
    name: row.name || undefined,
    role: row.role || 'student',
    courseId: uuidToCourseCode(row.course_id) || undefined,
    classId: row.class_type || undefined,
    classType: row.class_type || undefined,
    totalExp: row.total_exp || 0,
    level: row.level || 1,
    rank: row.rank || 0,
    badges: row.badges || [],
    equippedRabbits: row.equipped_rabbits || [],
    profileRabbitId: row.profile_rabbit_id ?? undefined,
    totalCorrect: row.total_correct || 0,
    profCorrectCount: row.total_correct || 0, // Firestore 별칭
    totalAttemptedQuestions: row.total_attempted_questions || 0,
    profAttemptCount: row.total_attempted_questions || 0, // Firestore 별칭
    professorQuizzesCompleted: row.professor_quizzes_completed || 0,
    tekkenTotal: row.tekken_total || 0,
    feedbackCount: row.feedback_count || 0,
    lastGachaExp: row.last_gacha_exp || 0,
    spinLock: row.spin_lock || false,
    recoveryEmail: row.recovery_email || undefined,
    assignedCourses: row.assigned_courses || undefined,
  };
}

// ============================================================
// 프로필 구독 — Firebase 위임
// ============================================================

/**
 * user_profiles 는 Firestore users 의 일부 필드만 저장하므로,
 * email/studentId/department/characterOptions/appSettings/fcmTokens/createdAt/updatedAt
 * 등이 필요한 UserContext/useProfile 구독은 Firebase 위임.
 */
export const subscribeProfile = firebaseUserRepo.subscribeProfile;

/**
 * 과목 + 역할 필터로 사용자 리스트 실시간 구독 — polling 30초.
 */
export function subscribeUsersByCourse(
  courseId: string,
  callback: (users: UserDoc[]) => void,
  options?: { role?: 'student' | 'professor' },
  onError?: ErrorCallback,
): Unsubscribe {
  let cancelled = false;

  const poll = async () => {
    try {
      const users = await fetchUsersByCourse(courseId, options);
      if (!cancelled) callback(users);
    } catch (err) {
      if (!cancelled && onError) onError(err as Error);
    }
  };

  poll();
  const intervalId = setInterval(poll, POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(intervalId);
  };
}

// ============================================================
// 프로필 읽기
// ============================================================

/**
 * 전체 프로필 raw 조회 — Firebase 위임.
 * user_profiles 에 없는 필드(email/studentId/department/characterOptions/
 * appSettings/fcmTokens/createdAt/updatedAt 등)가 필요하므로.
 */
export const getProfile = firebaseUserRepo.getProfile;

/** 닉네임 조회 */
export async function getNickname(uid: string): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return firebaseUserRepo.getNickname(uid);
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('nickname')
      .eq('org_id', DEFAULT_ORG_ID)
      .eq('user_id', uid)
      .maybeSingle();
    if (data?.nickname) return data.nickname as string;
    return '용사';
  } catch {
    return '용사';
  }
}

/** 게시글/댓글 작성 시 필요한 닉네임 + 반 정보 */
export async function getNicknameAndClassId(
  uid: string,
): Promise<{ nickname: string; classId: 'A' | 'B' | 'C' | 'D' | null }> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return firebaseUserRepo.getNicknameAndClassId(uid);
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('nickname, class_type')
      .eq('org_id', DEFAULT_ORG_ID)
      .eq('user_id', uid)
      .maybeSingle();
    if (!data) return { nickname: '용사', classId: null };
    return {
      nickname: (data.nickname as string) || '용사',
      classId: (data.class_type as 'A' | 'B' | 'C' | 'D') || null,
    };
  } catch {
    return { nickname: '용사', classId: null };
  }
}

/** 실명 조회 */
export async function getName(uid: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return firebaseUserRepo.getName(uid);
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('name')
      .eq('org_id', DEFAULT_ORG_ID)
      .eq('user_id', uid)
      .maybeSingle();
    return (data?.name as string) || null;
  } catch {
    return null;
  }
}

/**
 * 학번 조회 — Firebase 위임.
 * user_profiles 에 studentId 컬럼이 없음.
 */
export const getStudentId = firebaseUserRepo.getStudentId;

/** 역할 조회 */
export async function getRole(uid: string): Promise<'student' | 'professor' | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return firebaseUserRepo.getRole(uid);
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('org_id', DEFAULT_ORG_ID)
      .eq('user_id', uid)
      .maybeSingle();
    if (!data) return null;
    return ((data.role as string) || 'student') as 'student' | 'professor';
  } catch {
    return null;
  }
}

/** 제작자 상세 정보 — studentId 필요 시 Firebase 위임 */
export async function getCreatorInfo(uid: string): Promise<CreatorInfo | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return firebaseUserRepo.getCreatorInfo(uid);
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('role, name, nickname, class_type')
      .eq('org_id', DEFAULT_ORG_ID)
      .eq('user_id', uid)
      .maybeSingle();
    if (!data) return null;
    return {
      role: (data.role as string) || 'student',
      name: (data.name as string) || undefined,
      nickname: (data.nickname as string) || undefined,
      classId: (data.class_type as string) || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 앱 설정 조회 — Firebase 위임.
 * user_profiles 에 appSettings 컬럼이 없음.
 */
export const getAppSettings = firebaseUserRepo.getAppSettings;

/**
 * 문서 존재 확인 — Firebase 위임.
 * user_profiles 에는 없어도 Firestore users 에는 있는 케이스 방지.
 */
export const profileExists = firebaseUserRepo.profileExists;

// ============================================================
// 복수 사용자 조회
// ============================================================

/** 과목별 사용자 전체 조회 (역할 필터 선택) */
export async function fetchUsersByCourse(
  courseId: string,
  options?: { role?: 'student' | 'professor' },
): Promise<UserDoc[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return firebaseUserRepo.fetchUsersByCourse(courseId, options);

  const courseUuid = await resolveCourseUuid(courseId);
  if (!courseUuid) return firebaseUserRepo.fetchUsersByCourse(courseId, options);

  try {
    let query = supabase
      .from('user_profiles')
      .select('*')
      .eq('org_id', DEFAULT_ORG_ID)
      .eq('course_id', courseUuid);
    if (options?.role) query = query.eq('role', options.role);

    const { data, error } = await query;
    if (error || !data) return firebaseUserRepo.fetchUsersByCourse(courseId, options);
    return (data as UserProfileRow[]).map(rowToUserDoc);
  } catch {
    return firebaseUserRepo.fetchUsersByCourse(courseId, options);
  }
}

/**
 * 여러 uid 를 한 번에 조회.
 * 반환 shape 는 Firestore 호환 (class_type → classId 매핑 포함).
 */
export async function getUsersByIds(
  uids: string[],
): Promise<Record<string, Record<string, unknown> | null>> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return firebaseUserRepo.getUsersByIds(uids);
  if (uids.length === 0) return {};

  const result: Record<string, Record<string, unknown> | null> = {};
  for (const uid of uids) result[uid] = null;

  try {
    // Supabase .in() 은 제한이 있어 100개씩 배치
    for (let i = 0; i < uids.length; i += 100) {
      const batch = uids.slice(i, i + 100);
      const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('org_id', DEFAULT_ORG_ID)
        .in('user_id', batch);
      for (const row of (data as UserProfileRow[] | null) || []) {
        const doc = rowToUserDoc(row);
        const { id: _id, ...rest } = doc;
        result[row.user_id] = rest;
      }
    }
    return result;
  } catch {
    return firebaseUserRepo.getUsersByIds(uids);
  }
}

// ============================================================
// 쓰기 — 전부 Firebase 위임 (CF dual-write 로 Supabase 동기)
// ============================================================

export const updateProfile = firebaseUserRepo.updateProfile;
export const updateNickname = firebaseUserRepo.updateNickname;
export const updateClassId = firebaseUserRepo.updateClassId;
export const updateActivity = firebaseUserRepo.updateActivity;
export const updateAppSettingsSection = firebaseUserRepo.updateAppSettingsSection;
export const resetAppSettings = firebaseUserRepo.resetAppSettings;
export const addFcmToken = firebaseUserRepo.addFcmToken;
export const removeFcmToken = firebaseUserRepo.removeFcmToken;

// ============================================================
// 하위 호환 (Firebase userRepo 에서 re-export 되는 심볼)
// ============================================================

export { subscribeDocument, Timestamp } from '../firebase/firestoreBase';
