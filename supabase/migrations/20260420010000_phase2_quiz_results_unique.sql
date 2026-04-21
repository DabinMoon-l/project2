-- ============================================================
-- Phase 2-C-fix: quiz_results.source_firestore_id UNIQUE 보강
-- ============================================================
--
-- 목적: ETL 재실행 시 중복 삽입 방지 (멱등성 보장)
-- 전제: 20260420000000_phase2_quiz_domain.sql 적용됨
--
-- 실행: Supabase SQL Editor 에 전체 복사 → Run

create unique index if not exists uq_quiz_results_source_fs
  on public.quiz_results(source_firestore_id)
  where source_firestore_id is not null;

comment on index public.uq_quiz_results_source_fs is
  'Firestore → Supabase 이관 시 source_firestore_id 중복 삽입 방지 (null 허용).';
