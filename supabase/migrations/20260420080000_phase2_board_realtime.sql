-- ============================================================
-- Phase 2 Step 3: 게시판 Realtime publication 활성화
-- ============================================================
--
-- posts / comments 테이블 변경사항을 Supabase Realtime 으로 스트리밍.
-- 클라이언트는 supabase.channel().on('postgres_changes', ...) 로 구독 가능.
--
-- `supabase_realtime` 은 Supabase 프로젝트에 기본 생성되어 있는 publication.
-- 테이블을 add 해야 그 테이블의 INSERT/UPDATE/DELETE 가 Realtime 으로 방송됨.
--
-- 실행: Supabase SQL Editor 에 전체 복사 → Run
-- 멱등: 이미 추가되어 있으면 SKIP (pg_publication_tables 체크)

do $$
begin
  -- posts
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table public.posts;
  end if;

  -- comments
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;
end $$;

-- ============================================================
-- REPLICA IDENTITY — DELETE 이벤트에서 old row 전체 필드를 받기 위해
-- ============================================================
-- default(=PK only) 일 때 DELETE payload 의 old record 에 id 만 온다.
-- 클라이언트가 post_id / author_id 로 필터링하려면 FULL 이 필요.
--
-- 비용: WAL 에 old row 전체가 기록됨 — posts/comments 는 row 크기 작아 문제 없음.

alter table public.posts    replica identity full;
alter table public.comments replica identity full;

-- ============================================================
-- 확인 쿼리 (실행 후 수동으로)
-- ============================================================
-- select schemaname, tablename
-- from pg_publication_tables
-- where pubname = 'supabase_realtime'
-- order by tablename;
--
-- 기대값:
--   posts / comments 외에 rankings / radar_norms 등 기존 이관 테이블 포함 가능
