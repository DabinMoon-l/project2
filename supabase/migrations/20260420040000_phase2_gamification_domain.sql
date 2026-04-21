-- ============================================================
-- Phase 2-F: 게이미피케이션 도메인 스키마 (3 테이블)
-- ============================================================
--
-- 테이블:
--   1) rabbits          — 토끼 도감 (과목별 80마리, 최초 발견자 기록)
--   2) rabbit_holdings  — 유저별 토끼 보유 + 레벨/스탯
--   3) exp_history      — EXP 지급 이력 (append-only)
--
-- 설계 원칙:
--   - user_id 는 text (Firebase uid), FK 미설정
--   - rabbits: course 당 rabbitId 0~79 유일 (org_id, course_id, rabbit_id UNIQUE)
--   - rabbit_holdings: 유저 × 과목 × rabbitId 유일
--   - exp_history: append-only, source_firestore_id 는 uid + docId 합성
--   - stats 는 jsonb 로 저장 (hp, atk, def)
--
-- 실행: Supabase SQL Editor 에 전체 복사 → Run

-- ============================================================
-- 1) rabbits (도감, 과목당 80마리)
-- ============================================================
create table if not exists public.rabbits (
  id                         uuid primary key default gen_random_uuid(),
  org_id                     uuid not null references public.organizations(id) on delete cascade,
  course_id                  uuid not null references public.courses(id) on delete cascade,
  rabbit_id                  int not null check (rabbit_id >= 0 and rabbit_id < 80),
  name                       text,                                 -- 최초 발견자가 지은 이름 (null 가능)

  first_discoverer_user_id   text,
  first_discoverer_name      text,
  first_discoverer_nickname  text,

  discoverers                jsonb not null default '[]'::jsonb,   -- [{userId, nickname, discoveryOrder}]
  discoverer_count           int not null default 0,

  source_firestore_id        text unique,                          -- "{courseId}_{rabbitId}"

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (org_id, course_id, rabbit_id)
);

create index if not exists idx_rabbits_org_course on public.rabbits(org_id, course_id);
create index if not exists idx_rabbits_discoverer on public.rabbits(first_discoverer_user_id);

comment on table public.rabbits is
  '과목별 토끼 도감. 최초 발견자/이름/발견자 리스트 기록. 과목당 0~79 총 80마리.';

-- ============================================================
-- 2) rabbit_holdings (유저 보유)
-- ============================================================
create table if not exists public.rabbit_holdings (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  course_id             uuid not null references public.courses(id) on delete cascade,
  user_id               text not null,                             -- Firebase uid
  rabbit_id             int not null check (rabbit_id >= 0 and rabbit_id < 80),

  level                 int not null default 1 check (level >= 1),
  stats                 jsonb not null default '{}'::jsonb,        -- {hp, atk, def}
  discovery_order       int,
  discovered_at         timestamptz,

  source_firestore_id   text unique,                               -- "{uid}__{courseId}_{rabbitId}"

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, user_id, course_id, rabbit_id)
);

create index if not exists idx_rabbit_holdings_user   on public.rabbit_holdings(org_id, user_id);
create index if not exists idx_rabbit_holdings_course on public.rabbit_holdings(org_id, course_id);

comment on table public.rabbit_holdings is
  '유저별 토끼 보유/레벨. (user, course, rabbit_id) 유일. 토끼 이름은 rabbits.name 공용.';

-- ============================================================
-- 3) exp_history (EXP 지급 이력)
-- ============================================================
create table if not exists public.exp_history (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  user_id               text not null,

  amount                int not null,
  reason                text not null,                             -- 사용자 표시용 메시지
  type                  text,                                      -- 'quiz_complete', 'post_create' 등
  source_id             text,                                      -- 관련 doc id (quizId 등)
  source_collection     text,                                      -- 관련 컬렉션
  previous_exp          int,
  new_exp               int,

  metadata              jsonb default '{}'::jsonb,

  source_firestore_id   text unique,                               -- "{uid}__{expDocId}"

  created_at            timestamptz not null default now()
);

create index if not exists idx_exp_history_user    on public.exp_history(org_id, user_id, created_at desc);
create index if not exists idx_exp_history_type    on public.exp_history(org_id, user_id, type);
create index if not exists idx_exp_history_source  on public.exp_history(source_id) where source_id is not null;

comment on table public.exp_history is
  'EXP 지급 이력. append-only. source_firestore_id 는 uid + 원본 docId 합성.';

-- ============================================================
-- updated_at 트리거
-- ============================================================
drop trigger if exists trg_rabbits_updated_at on public.rabbits;
create trigger trg_rabbits_updated_at
  before update on public.rabbits
  for each row execute function public.set_updated_at();

drop trigger if exists trg_rabbit_holdings_updated_at on public.rabbit_holdings;
create trigger trg_rabbit_holdings_updated_at
  before update on public.rabbit_holdings
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS (Phase 2 임시)
-- ============================================================
alter table public.rabbits          enable row level security;
alter table public.rabbit_holdings  enable row level security;
alter table public.exp_history      enable row level security;

drop policy if exists "rabbits_read" on public.rabbits;
create policy "rabbits_read" on public.rabbits
  for select to anon, authenticated using (true);

drop policy if exists "rabbit_holdings_read" on public.rabbit_holdings;
create policy "rabbit_holdings_read" on public.rabbit_holdings
  for select to anon, authenticated using (true);

drop policy if exists "exp_history_read" on public.exp_history;
create policy "exp_history_read" on public.exp_history
  for select to anon, authenticated using (true);

-- 쓰기는 service_role 전용
