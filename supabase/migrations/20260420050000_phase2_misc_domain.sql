-- ============================================================
-- Phase 2-G: 기타 도메인 스키마 (6 테이블)
-- ============================================================
--
-- 테이블:
--   1) generation_jobs  — AI 퀴즈 생성 잡 큐 (Firestore jobs)
--   2) notifications    — 앱 내 알림
--   3) fcm_tokens       — 푸시 디바이스 토큰
--   4) likes            — 좋아요 (post/comment 등)
--   5) weekly_stats     — 주간 통계 (교수 대시보드)
--   6) monthly_reports  — 월간 Claude 인사이트 리포트
--
-- 설계 원칙:
--   - user_id 는 text, FK 미설정
--   - weekly_stats / monthly_reports 는 jsonb 그룹 (engagement, learning, ... )로 통째 저장
--   - likes: target_type + target_id 조합 + 단일 UNIQUE (user_id, target_type, target_id)
--
-- 실행: Supabase SQL Editor 에 전체 복사 → Run

-- ============================================================
-- 1) generation_jobs (현재 데이터 0건 — 스키마만 생성)
-- ============================================================
create table if not exists public.generation_jobs (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  course_id             uuid references public.courses(id) on delete set null,
  user_id               text not null,

  status                text not null default 'queued'
                        check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  input                 jsonb default '{}'::jsonb,
  output                jsonb,
  error                 text,
  material_sha256       text,
  started_at            timestamptz,
  completed_at          timestamptz,

  source_firestore_id   text unique,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_generation_jobs_user    on public.generation_jobs(org_id, user_id, created_at desc);
create index if not exists idx_generation_jobs_status  on public.generation_jobs(status, created_at);
create index if not exists idx_generation_jobs_dedup   on public.generation_jobs(material_sha256) where material_sha256 is not null;

comment on table public.generation_jobs is
  'AI 퀴즈 생성 잡 큐. Firestore jobs 컬렉션의 Supabase 버전. TTL 로 자동 정리 대상.';

-- ============================================================
-- 2) notifications
-- ============================================================
create table if not exists public.notifications (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  user_id               text not null,

  type                  text,
  title                 text,
  message               text,
  data                  jsonb default '{}'::jsonb,
  read                  boolean not null default false,

  source_firestore_id   text unique,

  created_at            timestamptz not null default now()
);

create index if not exists idx_notifications_user       on public.notifications(org_id, user_id, created_at desc);
create index if not exists idx_notifications_user_unread on public.notifications(org_id, user_id) where read = false;

-- ============================================================
-- 3) fcm_tokens
-- ============================================================
create table if not exists public.fcm_tokens (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  user_id               text,                                   -- 로그인 안 된 토큰 일시 허용
  token                 text not null,
  device_info           jsonb default '{}'::jsonb,
  topics                text[] default '{}',

  source_firestore_id   text unique,                            -- Firestore doc id = token 자체

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, token)
);

create index if not exists idx_fcm_tokens_user on public.fcm_tokens(org_id, user_id);

-- ============================================================
-- 4) likes (post / comment 좋아요)
-- ============================================================
create table if not exists public.likes (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  user_id               text not null,
  target_type           text not null check (target_type in ('post', 'comment')),
  target_id             text not null,                          -- Firestore target doc id (호환) 또는 Supabase uuid
  target_user_id        text,                                   -- 피대상 작성자

  source_firestore_id   text unique,

  created_at            timestamptz not null default now(),
  unique (user_id, target_type, target_id)
);

create index if not exists idx_likes_target on public.likes(target_type, target_id);
create index if not exists idx_likes_user   on public.likes(org_id, user_id);

comment on table public.likes is
  '좋아요 기록. posts/comments 의 liked_by[] 와 중복 저장됨 (Phase 2 호환). 추후 liked_by[] 제거 검토.';

-- ============================================================
-- 5) weekly_stats (교수 주간 통계)
-- ============================================================
create table if not exists public.weekly_stats (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  course_id             uuid not null references public.courses(id) on delete cascade,

  week_label            text not null,                          -- '2026-W08'
  week_start            date,
  week_end              date,
  week_range_ko         text,                                   -- '3월 3일 ~ 3월 9일'

  engagement            jsonb default '{}'::jsonb,
  feature_usage         jsonb default '{}'::jsonb,
  learning              jsonb default '{}'::jsonb,
  gamification          jsonb default '{}'::jsonb,
  social                jsonb default '{}'::jsonb,

  source_firestore_id   text unique,                            -- "{courseCode}__{weekLabel}"

  created_at            timestamptz not null default now(),
  unique (org_id, course_id, week_label)
);

create index if not exists idx_weekly_stats_course on public.weekly_stats(org_id, course_id, week_label desc);

-- ============================================================
-- 6) monthly_reports (교수 월간 Claude 리포트)
-- ============================================================
create table if not exists public.monthly_reports (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  course_id             uuid not null references public.courses(id) on delete cascade,

  year                  int not null,
  month                 int not null check (month >= 1 and month <= 12),
  month_label           text not null,                          -- '2026-03'
  weekly_stats_used     jsonb default '[]'::jsonb,              -- 참조 주 label 배열
  insight               text,                                   -- Claude 생성 텍스트

  source_firestore_id   text unique,                            -- "{courseCode}__{monthLabel}"

  created_at            timestamptz not null default now(),
  unique (org_id, course_id, month_label)
);

create index if not exists idx_monthly_reports_course on public.monthly_reports(org_id, course_id, month_label desc);

-- ============================================================
-- updated_at 트리거
-- ============================================================
drop trigger if exists trg_generation_jobs_updated_at on public.generation_jobs;
create trigger trg_generation_jobs_updated_at
  before update on public.generation_jobs
  for each row execute function public.set_updated_at();

drop trigger if exists trg_fcm_tokens_updated_at on public.fcm_tokens;
create trigger trg_fcm_tokens_updated_at
  before update on public.fcm_tokens
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS (Phase 2 임시)
-- ============================================================
alter table public.generation_jobs enable row level security;
alter table public.notifications   enable row level security;
alter table public.fcm_tokens      enable row level security;
alter table public.likes           enable row level security;
alter table public.weekly_stats    enable row level security;
alter table public.monthly_reports enable row level security;

drop policy if exists "generation_jobs_read" on public.generation_jobs;
create policy "generation_jobs_read" on public.generation_jobs
  for select to anon, authenticated using (true);

drop policy if exists "notifications_read" on public.notifications;
create policy "notifications_read" on public.notifications
  for select to anon, authenticated using (true);

-- fcm_tokens: 민감 (디바이스 토큰 = 푸시 전송 수단) → service_role 전용, 읽기 정책 없음

drop policy if exists "likes_read" on public.likes;
create policy "likes_read" on public.likes
  for select to anon, authenticated using (true);

drop policy if exists "weekly_stats_read" on public.weekly_stats;
create policy "weekly_stats_read" on public.weekly_stats
  for select to anon, authenticated using (true);

drop policy if exists "monthly_reports_read" on public.monthly_reports;
create policy "monthly_reports_read" on public.monthly_reports
  for select to anon, authenticated using (true);
