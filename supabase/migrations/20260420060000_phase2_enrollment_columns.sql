-- ============================================================
-- Phase 2 Step 3 — enrolled_students 컬럼 보강
-- ============================================================
-- Firestore enrolledStudents 문서가 가진 다음 필드를 Supabase 에도 반영:
--   - classId        → class_id
--   - isRegistered   → is_registered
--   - registeredUid  → registered_uid
--
-- Why: useEnrolledStudents 훅이 가입율/미가입 학생/반 표시에 사용.
--      이 3개 필드 없이는 Supabase 단독으로 훅을 만족시킬 수 없음.
--
-- 안전장치: ADD COLUMN IF NOT EXISTS — 멱등 실행 가능.
-- ============================================================

alter table public.enrolled_students
  add column if not exists class_id        text,
  add column if not exists is_registered   boolean not null default false,
  add column if not exists registered_uid  text;

-- 가입율 집계 / 미가입 필터에 자주 쓰는 부분 인덱스
create index if not exists idx_enrolled_unregistered
  on public.enrolled_students(org_id, course_id)
  where is_registered = false;

create index if not exists idx_enrolled_registered_uid
  on public.enrolled_students(registered_uid)
  where registered_uid is not null;

comment on column public.enrolled_students.class_id is
  '반 (A/B/C/D). 거의 사용되지 않지만 호환 유지.';
comment on column public.enrolled_students.is_registered is
  '학생이 회원가입을 마쳤는지. registerStudent CF 가 true 로 전환.';
comment on column public.enrolled_students.registered_uid is
  '가입 후 매핑된 Firebase Auth uid. Phase 3 Better Auth 도입 시 재매핑.';
