-- ============================================================
-- Phase 2 시드: 현재 파일럿 과목 3개를 courses 테이블에 등록
-- ============================================================
--
-- 기본 org 'rabbitory-pilot' 아래에 biology/pathophysiology/microbiology 시드.
-- chapters는 Phase 4(PDF 자동 파싱) 시점에 채움 — 지금은 null 상태 OK.
-- 프론트는 당분간 shared/courseChapters.json 계속 사용.
--
-- 실행: Supabase SQL Editor → Run
--
-- 안전장치: ON CONFLICT DO NOTHING 으로 이미 있으면 skip.
--           기존 레코드는 건드리지 않음.

insert into public.courses (org_id, code, name, chapter_prefix, is_active)
select o.id, v.code, v.name, v.chapter_prefix, true
from public.organizations o
cross join (values
  ('biology',         '생물학',     'bio_'),
  ('pathophysiology', '병태생리학', 'patho_'),
  ('microbiology',    '미생물학',   'micro_')
) as v(code, name, chapter_prefix)
where o.slug = 'rabbitory-pilot'
on conflict (org_id, code) do nothing;

-- ============================================================
-- 확인 쿼리 (실행 후 수동)
-- ============================================================

-- select c.code, c.name, c.chapter_prefix, o.name as org_name
-- from public.courses c
-- join public.organizations o on o.id = c.org_id
-- order by c.code;
--
-- 결과 예:
--   biology         | 생물학       | bio_   | RabbiTory Pilot
--   microbiology    | 미생물학     | micro_ | RabbiTory Pilot
--   pathophysiology | 병태생리학   | patho_ | RabbiTory Pilot
