/**
 * Enrollment Repository — Supabase 구현체 (Phase 2 Step 3)
 *
 * Firebase enrollmentRepo 와 **동일한 API 시그니처** 유지.
 * 반환 shape 도 Firestore 문서와 호환되도록 카멜케이스로 매핑.
 *
 * 테이블:
 *   public.enrolled_students {
 *     id, org_id, course_id (uuid → course code 매핑 필요),
 *     student_id, name, class_id, is_registered, registered_uid,
 *     enrolled_at
 *   }
 *
 * courseId(string code, e.g. "biology") → courses.id(uuid) 변환은
 * 모듈 레벨 캐시로 1회 lookup 후 재사용.
 */

import { getSupabaseClient } from '@/lib/clients/supabase';

const DEFAULT_ORG_ID = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID || '';

// courseCode → courses.id(uuid) 캐시. 페이지 수명 동안 유지.
const _courseUuidCache = new Map<string, string>();

async function resolveCourseUuid(courseCode: string): Promise<string | null> {
  const cached = _courseUuidCache.get(courseCode);
  if (cached) return cached;

  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return null;

  const { data, error } = await supabase
    .from('courses')
    .select('id')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('code', courseCode)
    .maybeSingle();

  if (error || !data?.id) return null;
  _courseUuidCache.set(courseCode, data.id as string);
  return data.id as string;
}

interface EnrolledStudentRow {
  student_id: string;
  name: string;
  class_id: string | null;
  is_registered: boolean;
  registered_uid: string | null;
  enrolled_at: string;
}

/**
 * 등록된 학생 목록 조회.
 *
 * 반환 shape 는 Firestore 의 { id, ...data } 와 호환되도록 카멜케이스로 매핑.
 * useEnrolledStudents 훅이 기대하는 필드명: studentId(=id), name, classId, isRegistered, registeredUid, enrolledAt.
 */
export async function getEnrolledStudents(
  courseId: string,
): Promise<Record<string, unknown>[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('[Supabase] 클라이언트가 초기화되지 않았습니다.');
  }

  const courseUuid = await resolveCourseUuid(courseId);
  if (!courseUuid) {
    // 매핑 실패 시 빈 배열 반환 (호출부 호환)
    return [];
  }

  const { data, error } = await supabase
    .from('enrolled_students')
    .select('student_id, name, class_id, is_registered, registered_uid, enrolled_at')
    .eq('course_id', courseUuid);

  if (error) throw error;
  if (!data) return [];

  // Firestore 문서 shape 와 동일하게 매핑 (id = doc id = studentId)
  return (data as EnrolledStudentRow[]).map((row) => ({
    id: row.student_id,
    studentId: row.student_id,
    name: row.name,
    classId: row.class_id ?? undefined,
    isRegistered: !!row.is_registered,
    registeredUid: row.registered_uid ?? undefined,
    // useEnrolledStudents 훅이 enrolledAt?.toDate?.() 패턴을 사용 → Date 호환 객체 제공
    enrolledAt: { toDate: () => new Date(row.enrolled_at) },
  }));
}
