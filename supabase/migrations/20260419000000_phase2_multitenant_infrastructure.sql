-- ============================================================
-- Phase 2-B: 멀티테넌시 인프라 테이블
-- ============================================================
--
-- 목적: SaaS 전환을 위한 organization / user_profiles / courses 뼈대
-- Phase 1의 rankings, radar_norms는 그대로 유지 (호환성)
-- 이후 세션에서 quizzes, posts 등 데이터 테이블을 도메인별로 추가
--
-- 실행: Supabase SQL Editor에서 전체 복사 → Run

-- ============================================================
-- 1) organizations — 조직(대학/기관)
-- ============================================================
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  plan        text not null default 'free' check (plan in ('free', 'pro', 'enterprise')),
  logo_url    text,
  theme       jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.organizations is
  '대학/기관 단위 테넌트. slug는 URL/서브도메인 용.';

-- ============================================================
-- 2) org_members — 조직 멤버십 (교수/학생 가입 정보)
-- ============================================================
create table if not exists public.org_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     text not null,                        -- Firebase Auth uid (Phase 2)
                                                    -- Better Auth 전환 시 uuid로 변경
  role        text not null check (role in ('admin', 'professor', 'student')),
  student_id  text,                                 -- 학번 (학생만)
  class_id    text,                                 -- 반 (A/B/C/D)
  joined_at   timestamptz not null default now(),
  unique (org_id, user_id),
  unique (org_id, student_id)                       -- 같은 대학 내 학번 유일
);

create index if not exists idx_org_members_user on public.org_members(user_id);
create index if not exists idx_org_members_org_role on public.org_members(org_id, role);

comment on table public.org_members is
  '조직 가입 정보. user_id는 Firebase Auth uid (Phase 3에서 Better Auth uuid로 전환).';

-- ============================================================
-- 3) semester_settings — 학기 설정
-- ============================================================
create table if not exists public.semester_settings (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  year        int not null,
  semester    int not null check (semester in (1, 2)),
  start_date  date not null,
  end_date    date not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (org_id, year, semester)
);

create index if not exists idx_semester_active on public.semester_settings(org_id, is_active);

-- ============================================================
-- 4) allowed_professors — 교수 가입 허용 목록 (이메일 기반)
-- ============================================================
create table if not exists public.allowed_professors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  email       text not null,
  assigned_courses text[] default '{}',             -- courses.code 배열 (Phase 2 단계; Phase 3에서 UUID로 전환)
  created_at  timestamptz not null default now(),
  unique (org_id, email)
);

comment on table public.allowed_professors is
  '교수 가입 허용 리스트. 이메일이 이 목록에 있어야 회원가입 시 professor role 부여.';

-- ============================================================
-- 5) courses — 과목
-- ============================================================
create table if not exists public.courses (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  code           text not null,                    -- 'biology', 'microbiology', 'pathophysiology'
  name           text not null,                    -- '생물학'
  owner_user_id  text,                              -- 과목 소유 교수 Firebase uid (Phase 3에서 uuid 전환)
  grade          int,
  semester       int,
  chapter_prefix text,                              -- 'bio_'
  chapters       jsonb default '[]'::jsonb,         -- 챕터 인덱스 (shared/courseChapters.json 이관)
  theme_color    text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, code)
);

create index if not exists idx_courses_org_active on public.courses(org_id, is_active);
create index if not exists idx_courses_owner on public.courses(owner_user_id);

comment on table public.courses is
  '과목. code는 구 Firestore courseId(biology/microbiology/...)와 매핑. 기존 호환성 유지.';

-- ============================================================
-- 6) enrolled_students — 학번 사전등록
-- ============================================================
create table if not exists public.enrolled_students (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  course_id   uuid not null references public.courses(id) on delete cascade,
  student_id  text not null,
  name        text not null,
  enrolled_at timestamptz not null default now(),
  unique (course_id, student_id)
);

create index if not exists idx_enrolled_org_course on public.enrolled_students(org_id, course_id);

-- ============================================================
-- 7) user_profiles — 사용자 프로필 (Firestore users 이관 대상)
-- ============================================================
create table if not exists public.user_profiles (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references public.organizations(id) on delete cascade,
  user_id                     text not null,                -- Firebase uid
  nickname                    text not null,
  name                        text,
  role                        text not null check (role in ('professor', 'student')),
  course_id                   text,                          -- 현재 활성 과목 code (학생)
  class_type                  text,                          -- A/B/C/D
  total_exp                   int not null default 0,
  level                       int not null default 1,
  rank                        int,
  badges                      text[] default '{}',
  equipped_rabbits            jsonb default '[]'::jsonb,
  profile_rabbit_id           int,
  total_correct               int not null default 0,
  total_attempted_questions   int not null default 0,
  professor_quizzes_completed int not null default 0,
  tekken_total                int not null default 0,
  feedback_count              int not null default 0,
  last_gacha_exp              int not null default 0,
  spin_lock                   boolean not null default false,
  recovery_email              text,
  assigned_courses            text[] default '{}',           -- 교수용: courses.code 배열
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists idx_user_profiles_user on public.user_profiles(user_id);
create index if not exists idx_user_profiles_org_role on public.user_profiles(org_id, role);
create index if not exists idx_user_profiles_course on public.user_profiles(org_id, course_id);

comment on table public.user_profiles is
  'Firestore users 컬렉션의 Supabase 버전. 단계적 이관 동안 Firestore와 공존.';

-- ============================================================
-- updated_at 자동 갱신 트리거 (Phase 1에서 만든 함수 재사용)
-- ============================================================

-- set_updated_at 함수는 Phase 1에서 이미 생성됨 (중복 생성 방지)
-- create or replace function public.set_updated_at() ... 는 생략

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_courses_updated_at on public.courses;
create trigger trg_courses_updated_at
  before update on public.courses
  for each row execute function public.set_updated_at();

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- ============================================================
-- Row Level Security (Phase 2 임시 정책)
-- ============================================================
--
-- Phase 2 단계: anon/authenticated 읽기 허용, 쓰기는 service_role만.
-- Phase 3에서 Better Auth JWT의 org_id 클레임 기반 정책으로 강화.

alter table public.organizations      enable row level security;
alter table public.org_members        enable row level security;
alter table public.semester_settings  enable row level security;
alter table public.allowed_professors enable row level security;
alter table public.courses            enable row level security;
alter table public.enrolled_students  enable row level security;
alter table public.user_profiles      enable row level security;

-- 읽기 정책 (임시): 누구나 읽기 가능 (Phase 3에서 org 기반으로 조이기)
drop policy if exists "organizations_read" on public.organizations;
create policy "organizations_read" on public.organizations
  for select to anon, authenticated using (true);

drop policy if exists "org_members_read" on public.org_members;
create policy "org_members_read" on public.org_members
  for select to anon, authenticated using (true);

drop policy if exists "semester_settings_read" on public.semester_settings;
create policy "semester_settings_read" on public.semester_settings
  for select to anon, authenticated using (true);

-- allowed_professors: 민감 정보(이메일 목록)이라 service_role만 읽기
--   교수 가입 플로우는 Cloud Function에서 service_role로 조회

drop policy if exists "courses_read" on public.courses;
create policy "courses_read" on public.courses
  for select to anon, authenticated using (true);

-- enrolled_students: 학번 정보 민감 → 교수 UI 전용이라 service_role만 접근
--   (학생 회원가입 시 학번 검증도 CF에서 처리)

drop policy if exists "user_profiles_read" on public.user_profiles;
create policy "user_profiles_read" on public.user_profiles
  for select to anon, authenticated using (true);

-- 쓰기 정책: 정책 없음 → 기본 deny → service_role만 bypass 가능
-- (Cloud Functions에서 service_role 키로 쓰기)

-- ============================================================
-- 기본 org 시드 (파일럿 대학)
-- ============================================================
--
-- 이 org의 id를 기록해두면 Firestore 백필 스크립트에서 사용.
-- 실행 후 SELECT id FROM organizations WHERE slug='rabbitory-pilot'; 로 확인.

insert into public.organizations (name, slug, plan)
values ('RabbiTory Pilot', 'rabbitory-pilot', 'pro')
on conflict (slug) do nothing;

-- ============================================================
-- 확인 쿼리 (실행 후 수동으로 돌려 확인)
-- ============================================================

-- 1. 테이블 목록:
-- select table_name from information_schema.tables
-- where table_schema = 'public' order by table_name;

-- 2. 기본 org id (Phase 2 백필에서 사용):
-- select id, name, slug from public.organizations where slug = 'rabbitory-pilot';

-- 3. RLS 정책 확인:
-- select tablename, policyname, roles, cmd from pg_policies
-- where schemaname = 'public' order by tablename;
