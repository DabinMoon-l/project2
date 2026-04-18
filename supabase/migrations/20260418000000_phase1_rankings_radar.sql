-- ============================================================
-- Phase 1 마이그레이션: rankings / radar_norms 이관
-- ============================================================
--
-- 목적: Firestore rankings/{courseId}, radarNorm/{courseId} 이관
-- 전략: Firestore 문서를 `data jsonb`에 그대로 저장 → 프론트 interop 유지
-- 실행: Supabase 대시보드 → SQL Editor → 새 쿼리 → 전체 붙여넣고 Run
--
-- 보안 메모:
-- - Phase 1은 anon 읽기 허용 (Firebase Auth와 Supabase Auth 미연동 상태)
-- - Firestore도 authenticated 학생 누구나 읽기였고 실질 차이는 "URL 공개 여부"
-- - rankedUsers.name(실명)이 포함될 수 있음 — Phase 4 Better Auth 통합 시 강화
-- - 쓰기는 service_role만 (Cloud Functions) — 클라이언트 쓰기 불가

-- ────────────────────────────────────────────────────────────
-- rankings 테이블 (과목당 1 row)
-- ────────────────────────────────────────────────────────────

create table if not exists public.rankings (
  course_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.rankings is
  'Firestore rankings/{courseId} 이관. data 필드에 { rankedUsers, teamRanks, prevDayRanks, totalStudents, weeklyParticipationRate } 그대로 저장.';

comment on column public.rankings.data is
  'RankingResult 문서 전체 (JSONB). Firestore 원본 구조 보존.';

-- ────────────────────────────────────────────────────────────
-- radar_norms 테이블 (과목당 1 row)
-- ────────────────────────────────────────────────────────────

create table if not exists public.radar_norms (
  course_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.radar_norms is
  'Firestore radarNorm/{courseId} 이관. data 필드에 percentile 배열 + byUid 맵 보존.';

comment on column public.radar_norms.data is
  'RadarNormResult 문서 전체 (JSONB).';

-- ────────────────────────────────────────────────────────────
-- updated_at 자동 갱신 트리거 (CF에서 명시적으로 설정하지 않은 경우 대비)
-- ────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_rankings_updated_at on public.rankings;
create trigger trg_rankings_updated_at
  before update on public.rankings
  for each row execute function public.set_updated_at();

drop trigger if exists trg_radar_norms_updated_at on public.radar_norms;
create trigger trg_radar_norms_updated_at
  before update on public.radar_norms
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- Row Level Security
-- ────────────────────────────────────────────────────────────

alter table public.rankings enable row level security;
alter table public.radar_norms enable row level security;

-- Phase 1: anon 읽기 허용 (authenticated 포함)
-- 쓰기 정책 없음 → 기본 deny → service_role만 bypass로 가능

drop policy if exists "rankings_read" on public.rankings;
create policy "rankings_read"
  on public.rankings
  for select
  to anon, authenticated
  using (true);

drop policy if exists "radar_norms_read" on public.radar_norms;
create policy "radar_norms_read"
  on public.radar_norms
  for select
  to anon, authenticated
  using (true);

-- ────────────────────────────────────────────────────────────
-- 확인용 쿼리 (실행 후 결과 비어있어야 정상 — 데이터는 CF 듀얼 라이트로 들어옴)
-- ────────────────────────────────────────────────────────────

-- select * from public.rankings;
-- select * from public.radar_norms;

-- 정책 확인:
-- select schemaname, tablename, policyname, roles, cmd
-- from pg_policies
-- where schemaname = 'public' and tablename in ('rankings', 'radar_norms');
