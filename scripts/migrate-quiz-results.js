/**
 * Phase 2 마이그레이션: Firestore quizResults + quiz_completions → Supabase
 *
 * 전제:
 *   - migrate-quizzes.js 가 먼저 실행되어 quizzes 테이블에 source_firestore_id 가 채워져 있어야 함
 *   - 20260420010000_phase2_quiz_results_unique.sql 적용 (quiz_results UNIQUE)
 *
 * 이관 대상:
 *   1) quizResults (top-level) → quiz_results
 *   2) quiz_completions (top-level, doc id = quizId_userId) → quiz_completions
 *   3) feedbacks — 전체 0개라 스킵
 *
 * 실행:
 *   DRY_RUN=1 GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-quiz-results.js
 *   GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-quiz-results.js
 *
 * 멱등: source_firestore_id UNIQUE (quiz_results) / (quiz_id, user_id) UNIQUE (quiz_completions)
 */

const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createClient } = require('@supabase/supabase-js');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_ORG_ID = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DEFAULT_ORG_ID) {
  console.error('[ERROR] 필수 환경변수 누락 (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_DEFAULT_ORG_ID)');
  process.exit(1);
}

initializeApp();
const fsdb = getFirestore();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function toIso(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v.toDate) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  return null;
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toRealOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Supabase quizzes 의 (source_firestore_id → id) 전체 맵 빌드 (페이지네이션) */
async function loadQuizIdMap() {
  const PAGE_SIZE = 1000;
  const map = {};
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('quizzes')
      .select('id, source_firestore_id')
      .eq('org_id', DEFAULT_ORG_ID)
      .not('source_firestore_id', 'is', null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) map[row.source_firestore_id] = row.id;
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return map;
}

/** 이미 Supabase 에 이관된 quiz_results source_firestore_id Set */
async function loadExistingQuizResultIds() {
  const PAGE_SIZE = 1000;
  const set = new Set();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('quiz_results')
      .select('source_firestore_id')
      .eq('org_id', DEFAULT_ORG_ID)
      .not('source_firestore_id', 'is', null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) set.add(row.source_firestore_id);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return set;
}

// ============================================================
// quizResults → quiz_results
// ============================================================
async function migrateQuizResults(quizIdMap) {
  console.log('\n━━━ quizResults → quiz_results ━━━');
  const snap = await fsdb.collection('quizResults').get();
  console.log(`Firestore quizResults: ${snap.size}개`);

  // 기존 이관된 것 pre-filter (partial unique index 라 ON CONFLICT 불가)
  const existing = await loadExistingQuizResultIds();
  if (existing.size > 0) console.log(`기존 Supabase 에 있는 것 ${existing.size}개는 skip`);

  const rows = [];
  let skipNoQuiz = 0;
  let skipNoUser = 0;
  let skipExisting = 0;

  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const quizUuid = quizIdMap[d.quizId];
    if (!quizUuid) {
      skipNoQuiz++;
      continue;
    }
    if (!d.userId) {
      skipNoUser++;
      continue;
    }
    if (existing.has(doc.id)) {
      skipExisting++;
      continue;
    }

    rows.push({
      org_id: DEFAULT_ORG_ID,
      quiz_id: quizUuid,
      user_id: d.userId,
      score: toRealOrNull(d.score) ?? 0,
      correct_count: toInt(d.correctCount),
      total_count: toInt(d.totalCount),
      answers: Array.isArray(d.answers) ? d.answers : [],
      attempt_no: toInt(d.attemptNo, 1),
      attempt_key: d.attemptKey || null,
      is_first_attempt: toInt(d.attemptNo, 1) === 1,
      duration_seconds: null,
      source_firestore_id: doc.id,
      created_at: toIso(d.createdAt) || new Date().toISOString(),
    });
  }

  console.log(
    `이관 대상: ${rows.length} / 스킵(퀴즈 없음): ${skipNoQuiz} / 스킵(userId 없음): ${skipNoUser} / 스킵(기존): ${skipExisting}`
  );

  if (DRY_RUN) {
    console.log('샘플 3:');
    rows.slice(0, 3).forEach((r) => console.log(`  - quiz=${r.quiz_id.slice(0, 8)} user=${r.user_id.slice(0, 8)} ${r.correct_count}/${r.total_count} (${r.score})`));
    return;
  }

  const BATCH = 500;
  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    // pre-filter 했으니 순수 insert. 중복 발생 시(동시 이관 등) 배치 전체 실패 → 경고만.
    const { data, error } = await supabase.from('quiz_results').insert(batch).select('id');
    if (error) {
      failed += batch.length;
      console.error(`  ❌ 배치 ${i / BATCH + 1} 실패:`, error.message);
      continue;
    }
    inserted += data?.length || 0;
    console.log(`  ✅ 배치 ${i / BATCH + 1}: ${data?.length || 0}개 insert`);
  }
  console.log(`총 insert: ${inserted} / 실패: ${failed}`);
}

// ============================================================
// quiz_completions → quiz_completions
// ============================================================
async function migrateQuizCompletions(quizIdMap) {
  console.log('\n━━━ quiz_completions → quiz_completions ━━━');
  const snap = await fsdb.collection('quiz_completions').get();
  console.log(`Firestore quiz_completions: ${snap.size}개`);

  const rows = [];
  let skipNoQuiz = 0;
  let skipNoUser = 0;

  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const quizUuid = quizIdMap[d.quizId];
    if (!quizUuid) {
      skipNoQuiz++;
      continue;
    }
    if (!d.userId) {
      skipNoUser++;
      continue;
    }

    rows.push({
      org_id: DEFAULT_ORG_ID,
      quiz_id: quizUuid,
      user_id: d.userId,
      best_score: toRealOrNull(d.score),
      completed_at: toIso(d.completedAt) || new Date().toISOString(),
    });
  }

  console.log(`이관 대상: ${rows.length} / 스킵(퀴즈 없음): ${skipNoQuiz} / 스킵(userId 없음): ${skipNoUser}`);

  if (DRY_RUN) {
    console.log('샘플 3:');
    rows.slice(0, 3).forEach((r) => console.log(`  - quiz=${r.quiz_id.slice(0, 8)} user=${r.user_id.slice(0, 8)} best=${r.best_score}`));
    return;
  }

  const BATCH = 500;
  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('quiz_completions')
      .upsert(batch, { onConflict: 'quiz_id,user_id' })
      .select('id');
    if (error) {
      failed += batch.length;
      console.error(`  ❌ 배치 ${i / BATCH + 1} 실패:`, error.message);
      continue;
    }
    inserted += data?.length || 0;
    console.log(`  ✅ 배치 ${i / BATCH + 1}: ${data?.length || 0}개 upsert`);
  }
  console.log(`총 upsert: ${inserted} / 실패: ${failed}`);
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN (실제 쓰기 안 함)' : '✍️  실제 이관 시작');
  console.log(`기본 org: ${DEFAULT_ORG_ID}`);

  // quizzes 매핑 사전 로드
  console.log('\nSupabase quizzes 매핑 로드 중…');
  const quizIdMap = await loadQuizIdMap();
  console.log(`매핑된 퀴즈: ${Object.keys(quizIdMap).length}개`);

  await migrateQuizResults(quizIdMap);
  await migrateQuizCompletions(quizIdMap);

  console.log('\nℹ️  feedbacks 는 Firestore 전체 0개라 스킵');
  if (DRY_RUN) console.log('\n💡 실제 실행하려면 DRY_RUN 제거');
}

main()
  .then(() => {
    console.log('\n✅ 완료');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ 실패:', err);
    process.exit(1);
  });
