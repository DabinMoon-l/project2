-- ============================================================
-- Phase 2 Step 3 — enrolled_students RLS 읽기 정책
-- ============================================================
-- 초기 마이그레이션 SQL 에서 `enable row level security` 만 걸고
-- SELECT 정책을 두지 않아 anon/authenticated 에서 전부 차단됨.
--
-- Phase 1 rankings/radar_norms 와 동일 패턴으로 임시 공개 읽기 허용.
-- Phase 3 Better Auth 통합 시 org/role 기반으로 재정비 예정.
--
-- Why: 교수 UI 의 학생 관리 패널이 anon 키로 읽어야 학번 리스트를 표시.
-- ============================================================

drop policy if exists "enrolled_students_read" on public.enrolled_students;

create policy "enrolled_students_read"
  on public.enrolled_students
  for select
  to anon, authenticated
  using (true);

comment on policy "enrolled_students_read" on public.enrolled_students is
  'Phase 2 임시 공개 읽기. Phase 3 에서 org 기반으로 조이기.';
