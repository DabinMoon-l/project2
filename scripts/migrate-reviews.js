/**
 * Phase 2 마이그레이션: Firestore reviews + customFolders → Supabase
 *
 * 전제: 20260420030000_phase2_review_domain.sql 적용됨
 *
 * 이관 방식:
 *   1) reviews — pre-filter + insert. quiz_id 는 Supabase quizzes 룩업,
 *                tekken_* 등 매핑 안 되면 null + metadata.originalQuizId 저장.
 *   2) custom_folders — pre-filter + insert. questions 는 jsonb 배열 그대로.
 *
 * 주의: reviews 42K 규모 → 배치 500, 약 84 배치.
 *
 * 실행:
 *   DRY_RUN=1 GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-reviews.js
 *   GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-reviews.js
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
  console.error('[ERROR] 필수 환경변수 누락');
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

function toInt(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fb;
}

// Supabase quizzes 매핑 (Firestore id → Supabase uuid)
async function loadQuizIdMap() {
  const PAGE = 1000;
  const map = {};
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('quizzes')
      .select('id, source_firestore_id')
      .eq('org_id', DEFAULT_ORG_ID)
      .not('source_firestore_id', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) map[row.source_firestore_id] = row.id;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

async function loadCourseMap() {
  const { data, error } = await supabase
    .from('courses')
    .select('id, code')
    .eq('org_id', DEFAULT_ORG_ID);
  if (error) throw error;
  const map = {};
  for (const c of data) map[c.code] = c.id;
  return map;
}

// 이미 이관된 source_firestore_id Set
async function loadExistingIds(table) {
  const PAGE = 1000;
  const set = new Set();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('source_firestore_id')
      .eq('org_id', DEFAULT_ORG_ID)
      .not('source_firestore_id', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) set.add(r.source_firestore_id);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return set;
}

// ============================================================
// reviews
// ============================================================
async function migrateReviews(quizIdMap, courseMap) {
  console.log('\n━━━ reviews → reviews ━━━');

  const existing = await loadExistingIds('reviews');
  if (existing.size > 0) console.log(`기존 Supabase ${existing.size}개 skip`);

  // Firestore 전체 스캔 (42K 건)
  console.log('Firestore reviews 스캔 중 (시간 소요 예상)…');
  const snap = await fsdb.collection('reviews').get();
  console.log(`Firestore reviews: ${snap.size}개`);

  const rows = [];
  let skipExisting = 0;
  let noQuizId = 0;
  let noCourse = 0;
  let noUser = 0;

  for (const doc of snap.docs) {
    if (existing.has(doc.id)) {
      skipExisting++;
      continue;
    }
    const d = doc.data() || {};
    if (!d.userId) {
      noUser++;
      continue;
    }

    const quizUuid = d.quizId ? quizIdMap[d.quizId] || null : null;
    if (d.quizId && !quizUuid) noQuizId++;

    const courseUuid = d.courseId ? courseMap[d.courseId] || null : null;
    if (d.courseId && !courseUuid) noCourse++;

    // question_data — 문제 본문 통합
    const questionData = {
      question: d.question,
      type: d.type,
      options: d.options,
      correctAnswer: d.correctAnswer,
      userAnswer: d.userAnswer,
      explanation: d.explanation,
      choiceExplanations: d.choiceExplanations,
      imageUrl: d.imageUrl,
      image: d.image,
      mixedExamples: d.mixedExamples,
    };

    // metadata — 보존할 부가 정보
    const metadata = {
      quizTitle: d.quizTitle,
      quizCreatorId: d.quizCreatorId,
      quizUpdatedAt: toIso(d.quizUpdatedAt),
      quizType: d.quizType,
    };
    if (d.quizId && !quizUuid) metadata.originalQuizId = d.quizId;

    rows.push({
      org_id: DEFAULT_ORG_ID,
      course_id: courseUuid,
      user_id: d.userId,
      quiz_id: quizUuid,
      question_id: d.questionId || 'unknown',
      chapter_id: d.chapterId || null,
      chapter_detail_id: d.chapterDetailId || null,
      question_data: questionData,
      is_correct: d.isCorrect == null ? null : !!d.isCorrect,
      is_bookmarked: !!d.isBookmarked,
      review_count: toInt(d.reviewCount),
      review_type: d.reviewType || null,
      folder_id: null,
      last_reviewed_at: toIso(d.lastReviewedAt),
      metadata,
      source_firestore_id: doc.id,
      created_at: toIso(d.createdAt) || new Date().toISOString(),
      updated_at: toIso(d.lastReviewedAt) || toIso(d.createdAt) || new Date().toISOString(),
    });
  }

  console.log(
    `이관 대상: ${rows.length} / skip(기존): ${skipExisting} / userId 없음: ${noUser} / quizId 매핑 없음(null 처리): ${noQuizId} / courseId 매핑 없음(null 처리): ${noCourse}`
  );

  if (DRY_RUN) {
    console.log('샘플 3:');
    rows.slice(0, 3).forEach((r) => console.log(`  - user=${r.user_id.slice(0, 8)} quiz=${r.quiz_id ? r.quiz_id.slice(0, 8) : 'null'} type=${r.review_type} correct=${r.is_correct}`));
    return;
  }

  const BATCH = 500;
  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase.from('reviews').insert(batch).select('id');
    if (error) {
      failed += batch.length;
      console.error(`  ❌ 배치 ${Math.floor(i / BATCH) + 1}/${Math.ceil(rows.length / BATCH)} 실패:`, error.message);
      continue;
    }
    inserted += data?.length || 0;
    if ((i / BATCH) % 5 === 0) {
      console.log(`  ✅ 배치 ${Math.floor(i / BATCH) + 1}/${Math.ceil(rows.length / BATCH)}: ${data?.length || 0}개 insert`);
    }
  }
  console.log(`총 insert: ${inserted} / 실패: ${failed}`);
}

// ============================================================
// custom_folders
// ============================================================
async function migrateCustomFolders(courseMap) {
  console.log('\n━━━ customFolders → custom_folders ━━━');

  const existing = await loadExistingIds('custom_folders');
  if (existing.size > 0) console.log(`기존 ${existing.size}개 skip`);

  const snap = await fsdb.collection('customFolders').get();
  console.log(`Firestore customFolders: ${snap.size}개`);

  const rows = [];
  let skipExisting = 0;
  let noUser = 0;

  for (const doc of snap.docs) {
    if (existing.has(doc.id)) {
      skipExisting++;
      continue;
    }
    const d = doc.data() || {};
    if (!d.userId) {
      noUser++;
      continue;
    }

    rows.push({
      org_id: DEFAULT_ORG_ID,
      course_id: d.courseId ? courseMap[d.courseId] || null : null,
      user_id: d.userId,
      name: d.name || '(이름없음)',
      sort_order: toInt(d.sortOrder),
      questions: Array.isArray(d.questions) ? d.questions : [],
      source_firestore_id: doc.id,
      created_at: toIso(d.createdAt) || new Date().toISOString(),
      updated_at: toIso(d.updatedAt) || toIso(d.createdAt) || new Date().toISOString(),
    });
  }

  console.log(`이관 대상: ${rows.length} / skip(기존): ${skipExisting} / userId 없음: ${noUser}`);

  if (DRY_RUN) {
    console.log('샘플 3:');
    rows.slice(0, 3).forEach((r) => console.log(`  - "${r.name}" user=${r.user_id.slice(0, 8)} Q${Array.isArray(r.questions) ? r.questions.length : 0}`));
    return;
  }

  const { data, error } = await supabase.from('custom_folders').insert(rows).select('id');
  if (error) {
    console.error('  ❌ 실패:', error.message);
    return;
  }
  console.log(`  ✅ ${data?.length || 0}개 insert`);
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN (실제 쓰기 안 함)' : '✍️  실제 이관 시작');
  console.log(`기본 org: ${DEFAULT_ORG_ID}`);

  console.log('\n매핑 로드 중…');
  const [quizIdMap, courseMap] = await Promise.all([loadQuizIdMap(), loadCourseMap()]);
  console.log(`quizzes ${Object.keys(quizIdMap).length}개 / courses ${Object.keys(courseMap).length}개`);

  await migrateReviews(quizIdMap, courseMap);
  await migrateCustomFolders(courseMap);

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
