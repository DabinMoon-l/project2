-- ============================================================
-- Phase 2-C: 퀴즈 도메인 스키마 (5 테이블)
-- ============================================================
--
-- 테이블:
--   1) quizzes             — 퀴즈 본체 (교수/학생 자작/AI 생성)
--   2) quiz_results        — 제출 결과 (append-only)
--   3) quiz_completions    — 완료 플래그 (중복 제출 방지)
--   4) quiz_submit_locks   — 60초 제출 락 (멱등)
--   5) feedbacks           — 퀴즈 피드백
--
-- 설계 원칙:
--   - user_id/creator_id 는 text (Firebase uid). Phase 3에서 uuid 전환.
--   - quizzes.source_firestore_id: 이관 추적용 unique 인덱스. ETL 시 FK 해소에 사용.
--   - 실제 Firestore 필드 분포 기반으로 컬럼 선정. 희귀 필드는 metadata jsonb 로 흡수.
--   - 기존 rankings/user_profiles 등 Phase 2-B 테이블과 동일한 RLS 임시 정책.
--
-- 실행: Supabase SQL Editor 에 전체 복사 → Run

-- ============================================================
-- 1) quizzes
-- ============================================================
create table if not exists public.quizzes (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.organizations(id) on delete cascade,
  course_id                 uuid not null references public.courses(id) on delete cascade,

  -- 생성자
  creator_id                text not null,                  -- Firebase uid
  creator_nickname          text,
  creator_class_type        text,                           -- 교수/학생 반 (A/B/C/D)

  -- 퀴즈 본문
  title                     text not null,
  description               text,                           -- 출제 지시 / AI 프롬프트
  category                  text not null check (category in (
    'midterm', 'final', 'past',
    'independent', 'custom', 'ai-generated',
    'professor', 'professor-ai'
  )),
  difficulty                text check (difficulty is null or difficulty in ('easy', 'medium', 'hard')),
  tags                      text[] default '{}',

  -- 학생 대상
  class_type                text,                           -- A/B/C/D/null
  target_class              text,                           -- 레거시 호환

  -- 학생 custom 수정 방지용
  original_type             text,
  was_published             boolean,

  -- 문제 본문 + 집계
  questions                 jsonb not null default '[]'::jsonb,
  question_count            int not null default 0,
  ox_count                  int not null default 0,
  multiple_choice_count     int not null default 0,
  subjective_count          int not null default 0,
  short_answer_count        int not null default 0,

  -- 공개/발행 상태
  is_public                 boolean not null default false,
  is_published              boolean not null default false,
  is_ai_generated           boolean not null default false,

  -- 집계치 (분산카운터 제거 — 직접 갱신)
  participant_count         int not null default 0,
  average_score             real,
  bookmark_count            int not null default 0,
  feedback_count            int not null default 0,

  -- EXP 보상 상태
  rewarded                  boolean not null default false,
  rewarded_at               timestamptz,
  exp_rewarded              int,                            -- 지급된 EXP
  public_rewarded           boolean not null default false,
  public_rewarded_at        timestamptz,

  -- 사용자별 최고점 (랭킹/통계용)
  user_scores               jsonb default '{}'::jsonb,       -- { uid: score, ... }
  user_first_review_scores  jsonb default '{}'::jsonb,       -- 첫 풀이 점수 (서재 복습용)

  -- 기타 메타
  semester                  text,                           -- '2026-1' 등
  past_year                 text,
  past_exam_type            text,                           -- 'midterm' | 'final'
  uploaded_at               timestamptz,
  metadata                  jsonb default '{}'::jsonb,       -- 미래 확장 / 희귀 필드 흡수

  -- 이관 추적
  source_firestore_id       text unique,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists idx_quizzes_org_course on public.quizzes(org_id, course_id);
create index if not exists idx_quizzes_creator    on public.quizzes(org_id, creator_id);
create index if not exists idx_quizzes_category   on public.quizzes(org_id, course_id, category, is_published);
create index if not exists idx_quizzes_public     on public.quizzes(org_id, course_id, is_public) where is_public = true;

comment on table public.quizzes is
  'Firestore quizzes 컬렉션의 Supabase 버전. 단계적 이관 동안 Firestore 와 공존.';
comment on column public.quizzes.category is
  'Firestore type 필드와 매핑. 학생 custom 수정 방지를 위해 original_type 참조.';
comment on column public.quizzes.source_firestore_id is
  '이관 추적. ETL 시 quiz_results 등 FK 해소에 사용.';

-- ============================================================
-- 2) quiz_results (append-only)
-- ============================================================
create table if not exists public.quiz_results (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  quiz_id             uuid not null references public.quizzes(id) on delete cascade,
  user_id             text not null,                        -- Firebase uid

  -- 결과
  score               real not null,
  correct_count       int not null,
  total_count         int not null,
  answers             jsonb not null default '[]'::jsonb,   -- 제출한 답안 배열

  -- 시도 정보
  attempt_no          int not null default 1,
  attempt_key         text,                                 -- idempotency key
  is_first_attempt    boolean not null default true,
  duration_seconds    int,

  -- 이관 추적
  source_firestore_id text,

  created_at          timestamptz not null default now()
);

create index if not exists idx_quiz_results_user      on public.quiz_results(org_id, user_id, created_at desc);
create index if not exists idx_quiz_results_quiz      on public.quiz_results(quiz_id, created_at desc);
create index if not exists idx_quiz_results_user_quiz on public.quiz_results(user_id, quiz_id);
create unique index if not exists uq_quiz_results_attempt_key
  on public.quiz_results(user_id, quiz_id, attempt_key)
  where attempt_key is not null;

comment on table public.quiz_results is
  '퀴즈 제출 결과. append-only. user_id + quiz_id + attempt_key 로 중복 제출 방지.';

-- ============================================================
-- 3) quiz_completions (중복 제출 방지)
-- ============================================================
create table if not exists public.quiz_completions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  quiz_id      uuid not null references public.quizzes(id) on delete cascade,
  user_id      text not null,
  best_score   real,
  completed_at timestamptz not null default now(),
  unique (quiz_id, user_id)
);

create index if not exists idx_quiz_completions_user on public.quiz_completions(org_id, user_id);

comment on table public.quiz_completions is
  '퀴즈 완료 플래그. 같은 유저가 같은 퀴즈 재제출 방지.';

-- ============================================================
-- 4) quiz_submit_locks (60초 TTL)
-- ============================================================
create table if not exists public.quiz_submit_locks (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  quiz_id    uuid not null references public.quizzes(id) on delete cascade,
  user_id    text not null,
  locked_at  timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 seconds',
  unique (user_id, quiz_id)
);

create index if not exists idx_quiz_submit_locks_expires on public.quiz_submit_locks(expires_at);

comment on table public.quiz_submit_locks is
  '60초 제출 락. pg_cron 으로 만료 row 주기적 정리 (Phase 3 에서 설정).';

-- ============================================================
-- 5) feedbacks
-- ============================================================
create table if not exists public.feedbacks (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  quiz_id             uuid not null references public.quizzes(id) on delete cascade,
  user_id             text not null,
  content             text not null,
  rating              int check (rating is null or (rating >= 1 and rating <= 5)),
  source_firestore_id text unique,
  created_at          timestamptz not null default now()
);

create index if not exists idx_feedbacks_quiz on public.feedbacks(quiz_id, created_at desc);
create index if not exists idx_feedbacks_user on public.feedbacks(org_id, user_id);

comment on table public.feedbacks is
  '퀴즈 피드백. 학생이 퀴즈에 대해 남기는 평가 + 문자열.';

-- ============================================================
-- updated_at 자동 갱신 트리거 (set_updated_at 은 Phase 1 에서 생성됨)
-- ============================================================
drop trigger if exists trg_quizzes_updated_at on public.quizzes;
create trigger trg_quizzes_updated_at
  before update on public.quizzes
  for each row execute function public.set_updated_at();

-- ============================================================
-- Row Level Security (Phase 2 임시)
-- ============================================================
--
-- Phase 2 정책: anon/authenticated 읽기 허용, 쓰기는 service_role 전용.
-- Phase 3 에서 Better Auth JWT 의 org_id / role 클레임 기반으로 조임.

alter table public.quizzes           enable row level security;
alter table public.quiz_results      enable row level security;
alter table public.quiz_completions  enable row level security;
alter table public.quiz_submit_locks enable row level security;
alter table public.feedbacks         enable row level security;

drop policy if exists "quizzes_read" on public.quizzes;
create policy "quizzes_read" on public.quizzes
  for select to anon, authenticated using (true);

drop policy if exists "quiz_results_read" on public.quiz_results;
create policy "quiz_results_read" on public.quiz_results
  for select to anon, authenticated using (true);

drop policy if exists "quiz_completions_read" on public.quiz_completions;
create policy "quiz_completions_read" on public.quiz_completions
  for select to anon, authenticated using (true);

-- quiz_submit_locks: 민감 (레이스 컨디션 락), service_role 전용 → 읽기 정책 없음

drop policy if exists "feedbacks_read" on public.feedbacks;
create policy "feedbacks_read" on public.feedbacks
  for select to anon, authenticated using (true);

-- ============================================================
-- 확인 쿼리 (실행 후 수동으로 돌려 확인)
-- ============================================================
--
-- 1. 테이블 5개 생성 확인:
--    select table_name from information_schema.tables
--    where table_schema = 'public' and table_name in
--      ('quizzes','quiz_results','quiz_completions','quiz_submit_locks','feedbacks')
--    order by table_name;
--
-- 2. 인덱스 확인:
--    select indexname from pg_indexes
--    where schemaname = 'public' and tablename like 'quiz%' or tablename = 'feedbacks'
--    order by tablename, indexname;
--
-- 3. RLS 정책 확인:
--    select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename like 'quiz%' or tablename = 'feedbacks'
--    order by tablename;
