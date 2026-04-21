-- ============================================================
-- Phase 2-D: 게시판 도메인 스키마 (2 테이블)
-- ============================================================
--
-- 테이블:
--   1) posts    — 게시글 (학술/기타/학사/비공개 + 공지)
--   2) comments — 댓글 + 대댓글 (parent_id self-ref) + 콩콩이 AI 답변
--
-- 설계 원칙:
--   - author_id 는 text (Firebase uid), FK 미설정
--   - 좋아요는 denormalized: liked_by text[] + like_count int (Firestore 와 동일 구조)
--   - tag 는 한국어 값 그대로 (학술/기타/학사/비공개) — 이관 단순화
--   - chapter_tags 는 ['4_세균', '3_감염과 발병'] 같은 챕터 ID 배열 (콩콩이 자동답변용)
--   - comments.parent_id self-ref — 루트댓글 null, 대댓글은 parent 의 id
--   - posts.accepted_comment_id 는 uuid (FK 미설정, 순환 참조 회피)
--
-- 실행: Supabase SQL Editor 에 전체 복사 → Run

-- ============================================================
-- 1) posts
-- ============================================================
create table if not exists public.posts (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  course_id             uuid not null references public.courses(id) on delete cascade,

  -- 작성자
  author_id             text not null,                          -- Firebase uid
  author_nickname       text,
  author_class_type     text,                                   -- A/B/C/D/null

  -- 본문
  title                 text not null,
  content               text not null default '',

  -- 분류
  category              text,                                   -- 'community' 등 레거시 호환 (tag 와 구분)
  tag                   text check (tag is null or tag in ('학술', '기타', '학사', '비공개')),
  chapter_tags          text[] default '{}',                    -- 콩콩이 챕터 매칭용
  is_anonymous          boolean not null default false,
  is_notice             boolean not null default false,
  is_private            boolean not null default false,         -- 비공개 (나만의 콩콩이)
  to_professor          boolean not null default false,         -- 교수에게 전달

  -- 미디어
  image_url             text,                                   -- 레거시 단일 이미지
  image_urls            text[] default '{}',
  file_urls             text[] default '{}',

  -- 콩콩이 AI
  ai_detailed_answer    text,                                   -- 콩콩이의 상세 답변 (있으면)

  -- 좋아요 (denormalized)
  likes                 int not null default 0,                 -- 레거시 필드 (likeCount 과 동일 의미)
  like_count            int not null default 0,
  liked_by              text[] default '{}',                    -- 좋아요한 uid 배열

  -- 집계
  comment_count         int not null default 0,
  view_count            int not null default 0,

  -- 채택 (학술 질문 해결 표시)
  accepted_comment_id   uuid,                                   -- comments.id (FK 미설정)

  -- EXP 보상 상태
  rewarded              boolean not null default false,
  rewarded_at           timestamptz,
  exp_rewarded          int,

  -- 확장
  metadata              jsonb default '{}'::jsonb,

  -- 이관 추적
  source_firestore_id   text unique,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_posts_org_course       on public.posts(org_id, course_id, created_at desc);
create index if not exists idx_posts_author           on public.posts(org_id, author_id, created_at desc);
create index if not exists idx_posts_tag              on public.posts(org_id, course_id, tag, created_at desc);
create index if not exists idx_posts_notice           on public.posts(org_id, course_id, is_notice) where is_notice = true;

comment on table public.posts is
  'Firestore posts 컬렉션의 Supabase 버전. 공지 게시판 아닌 일반 자유게시판 글.';
comment on column public.posts.tag is
  '한국어 분류 (학술/기타/학사/비공개). Firestore 호환 유지.';

-- ============================================================
-- 2) comments
-- ============================================================
create table if not exists public.comments (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  post_id               uuid not null references public.posts(id) on delete cascade,
  parent_id             uuid references public.comments(id) on delete cascade,

  -- 작성자
  author_id             text not null,                          -- Firebase uid 또는 'gemini-ai' (콩콩이)
  author_nickname       text,
  author_class_type     text,

  -- 본문
  content               text not null,
  image_urls            text[] default '{}',

  -- 상태
  is_anonymous          boolean not null default false,
  is_ai_reply           boolean not null default false,         -- 콩콩이 답변 (authorId='gemini-ai')
  is_accepted           boolean not null default false,
  accepted_at           timestamptz,

  -- 좋아요
  likes                 int not null default 0,
  like_count            int not null default 0,
  liked_by              text[] default '{}',

  -- EXP 보상
  rewarded              boolean not null default false,
  rewarded_at           timestamptz,
  exp_rewarded          int,

  -- 확장
  metadata              jsonb default '{}'::jsonb,

  -- 이관 추적
  source_firestore_id   text unique,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_comments_post          on public.comments(post_id, created_at);
create index if not exists idx_comments_author        on public.comments(org_id, author_id, created_at desc);
create index if not exists idx_comments_parent        on public.comments(parent_id) where parent_id is not null;
create index if not exists idx_comments_ai            on public.comments(org_id, is_ai_reply) where is_ai_reply = true;

comment on table public.comments is
  '댓글 + 대댓글 + 콩콩이 AI 답변. parent_id 는 대댓글 계층 구현용 self-ref.';
comment on column public.comments.author_id is
  '일반 유저는 Firebase uid, 콩콩이 AI 는 ''gemini-ai'' 고정값.';

-- ============================================================
-- updated_at 자동 갱신 트리거
-- ============================================================
drop trigger if exists trg_posts_updated_at on public.posts;
create trigger trg_posts_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_comments_updated_at on public.comments;
create trigger trg_comments_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- ============================================================
-- Row Level Security (Phase 2 임시)
-- ============================================================
alter table public.posts    enable row level security;
alter table public.comments enable row level security;

drop policy if exists "posts_read" on public.posts;
create policy "posts_read" on public.posts
  for select to anon, authenticated using (true);

drop policy if exists "comments_read" on public.comments;
create policy "comments_read" on public.comments
  for select to anon, authenticated using (true);

-- 쓰기는 service_role 전용 (정책 없음 → 기본 deny)

-- ============================================================
-- 확인 쿼리 (실행 후 수동으로)
-- ============================================================
-- select table_name from information_schema.tables
-- where table_schema = 'public' and table_name in ('posts', 'comments');
--
-- select indexname from pg_indexes
-- where schemaname = 'public' and tablename in ('posts', 'comments')
-- order by tablename, indexname;
