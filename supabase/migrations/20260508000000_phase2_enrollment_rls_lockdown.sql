-- ============================================================
-- Phase 2 Step 3 — enrolled_students RLS lockdown (anon 차단)
-- ============================================================
-- 이전 정책(20260420070000_phase2_enrollment_rls.sql)은
-- `to anon, authenticated using (true)` 로 비로그인 사용자에게도
-- 전체 학번/실명/반 PII 가 노출되는 상태였음.
--
-- Phase 3 Supabase Auth + Firebase JWT 통합 전까지 anon 차단으로 임시 잠금.
-- Phase 3 에서 `using (org_id = auth.jwt() ->> 'org_id')` 식으로 좁힘 예정.
--
-- 클라이언트 영향:
--   NEXT_PUBLIC_USE_SUPABASE_ENROLLMENT=false 로 회귀 필요.
--   (현재 enrollmentRepo 가 anon 키로 호출하므로 잠그면 401)
--   대신 Firestore enrolledStudents 컬렉션에서 읽음 (원래 진실 원천).
--
-- 듀얼 라이트(supabaseDualWriteEnrollment)는 service_role 키로 동작하므로
-- RLS 와 무관, 그대로 유지.
-- ============================================================

drop policy if exists "enrolled_students_read" on public.enrolled_students;

create policy "enrolled_students_read"
  on public.enrolled_students
  for select
  to authenticated
  using (true);

comment on policy "enrolled_students_read" on public.enrolled_students is
  'Phase 2 lockdown: anon 차단. Phase 3 Supabase Auth 통합 후 org 기반으로 재정비.';
