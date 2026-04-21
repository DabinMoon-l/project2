-- ============================================================
-- Phase 2-E: 복습 도메인 스키마 (2 테이블)
-- ============================================================
--
-- 테이블:
--   1) reviews         — 오답/북마크/AI 생성 문제 저장 (학생 개인용)
--   2) custom_folders  — 학생 자작 폴더 (questions jsonb 배열)
--
-- 설계 원칙:
--   - user_id 는 text (Firebase uid), FK 미설정
--   - reviews.quiz_id 는 nullable (tekken_* 배틀 리뷰 등 Supabase 에 퀴즈 없는 경우)
--   - question_data jsonb 에 문제/선지/답/해설 모두 통합 저장
--   - custom_folders.questions 는 jsonb 배열 — 서브테이블 대신 (작고 변경 드물어서)
--
-- 실행: Supabase SQL Editor 에 전체 복사 → Run

-- ============================================================
-- 1) reviews
-- ============================================================
create table if not exists public.reviews (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  course_id             uuid references public.courses(id) on delete set null,
  user_id               text not null,                        -- Firebase uid
  quiz_id               uuid references public.quizzes(id) on delete set null,  -- nullable (tekken 등)

  -- 문제 식별
  question_id           text not null,
  chapter_id            text,
  chapter_detail_id     text,

  -- 문제 본문 + 채점 정보 (통합 jsonb)
  question_data         jsonb not null default '{}'::jsonb,
    -- { question, type, options, correctAnswer, userAnswer, explanation,
    --   choiceExplanations, imageUrl, image, mixedExamples, ... }

  -- 상태
  is_correct            boolean,
  is_bookmarked         boolean not null default false,
  review_count          int not null default 0,
  review_type           text,                                 -- 'wrong' | 'solved' | 'ai' | 'tekken' 등
  folder_id             uuid,                                 -- custom_folders.id (FK 미설정)

  -- 시점
  last_reviewed_at      timestamptz,

  -- 확장
  metadata              jsonb default '{}'::jsonb,            -- quizCreatorId, quizTitle, 원본 quizId(tekken 등) 등

  -- 이관 추적
  source_firestore_id   text unique,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_reviews_user_course on public.reviews(org_id, user_id, course_id, created_at desc);
create index if not exists idx_reviews_user_quiz   on public.reviews(user_id, quiz_id);
create index if not exists idx_reviews_bookmark    on public.reviews(org_id, user_id, is_bookmarked) where is_bookmarked = true;
create index if not exists idx_reviews_type        on public.reviews(org_id, user_id, review_type);
create index if not exists idx_reviews_chapter     on public.reviews(org_id, course_id, chapter_id);

comment on table public.reviews is
  '학생 개인 오답/북마크/AI 복습 문제 저장소. Firestore reviews 컬렉션의 Supabase 버전.';
comment on column public.reviews.quiz_id is
  'quizzes(id) FK. tekken_* 배틀 리뷰 등은 null, 원본 Firestore quizId 는 metadata 에 보존.';

-- ============================================================
-- 2) custom_folders
-- ============================================================
create table if not exists public.custom_folders (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  course_id             uuid references public.courses(id) on delete set null,
  user_id               text not null,

  name                  text not null,
  sort_order            int not null default 0,

  -- Firestore 형식 그대로 jsonb 배열: [{questionId, quizId, quizTitle, combinedGroupId}, ...]
  questions             jsonb not null default '[]'::jsonb,

  source_firestore_id   text unique,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_custom_folders_user on public.custom_folders(org_id, user_id, created_at desc);

comment on table public.custom_folders is
  '학생 자작 복습 폴더. questions 는 jsonb 배열 (Firestore 호환).';

-- ============================================================
-- updated_at 트리거
-- ============================================================
drop trigger if exists trg_reviews_updated_at on public.reviews;
create trigger trg_reviews_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

drop trigger if exists trg_custom_folders_updated_at on public.custom_folders;
create trigger trg_custom_folders_updated_at
  before update on public.custom_folders
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS (Phase 2 임시)
-- ============================================================
alter table public.reviews        enable row level security;
alter table public.custom_folders enable row level security;

drop policy if exists "reviews_read" on public.reviews;
create policy "reviews_read" on public.reviews
  for select to anon, authenticated using (true);

drop policy if exists "custom_folders_read" on public.custom_folders;
create policy "custom_folders_read" on public.custom_folders
  for select to anon, authenticated using (true);

-- 쓰기는 service_role 전용
