/**
 * Phase 2 마이그레이션: Firestore quizzes → Supabase quizzes
 *
 * Firestore 구조: quizzes/{quizId}
 *   주요 필드: title, type, difficulty, tags, questions, courseId, creatorId,
 *             creatorNickname, isPublic, isPublished, participantCount, userScores 등
 *
 * Supabase 대상: public.quizzes (org_id, course_id(uuid), category, ...)
 *
 * 이관 방식:
 *   - Firestore type → Supabase category
 *   - courseId('biology') → courses.id(uuid) 룩업
 *   - source_firestore_id 에 Firestore doc id 저장 (추후 quiz_results FK 해소용)
 *   - 스키마 외 필드는 metadata jsonb 에 흡수
 *
 * 실행 명령:
 *   1) Dry-run:
 *      DRY_RUN=1 GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-quizzes.js
 *
 *   2) 실제 실행:
 *      GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-quizzes.js
 *
 * 멱등: UNIQUE(source_firestore_id) + upsert(onConflict) 로 재실행 안전.
 * Firestore 는 primary 유지 — 단방향 복사.
 */

const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createClient } = require('@supabase/supabase-js');

// ── .env.local 자동 로드 ───────────────────────
function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_ORG_ID = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[ERROR] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 .env.local 에 없습니다.');
  process.exit(1);
}
if (!DEFAULT_ORG_ID) {
  console.error('[ERROR] NEXT_PUBLIC_DEFAULT_ORG_ID 가 .env.local 에 없습니다.');
  process.exit(1);
}

initializeApp();
const fsdb = getFirestore();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 허용 category (스키마 CHECK 와 일치)
const VALID_CATEGORIES = new Set([
  'midterm', 'final', 'past',
  'independent', 'custom', 'ai-generated',
  'professor', 'professor-ai',
]);

// Supabase 컬럼으로 매핑되는 Firestore 필드 (metadata 흡수 대상 제외)
const MAPPED_FIRESTORE_FIELDS = new Set([
  'title', 'description', 'type', 'difficulty', 'tags',
  'courseId', 'creatorId', 'creatorNickname', 'creatorClassType',
  'classType', 'targetClass', 'originalType', 'wasPublished',
  'questions', 'questionCount',
  'oxCount', 'multipleChoiceCount', 'subjectiveCount', 'shortAnswerCount',
  'isPublic', 'isPublished', 'isAiGenerated',
  'participantCount', 'averageScore', 'bookmarkCount', 'feedbackCount',
  'rewarded', 'rewardedAt', 'publicRewarded', 'publicRewardedAt',
  'userScores', 'userFirstReviewScores',
  'semester', 'pastYear', 'pastExamType', 'uploadedAt',
  'createdAt', 'updatedAt',
]);

/** Firestore Timestamp → ISO string (또는 null) */
function toIso(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v.toDate) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  return null;
}

/** Firestore 값에서 숫자 안전 변환 */
function toInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toRealOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBool(v) {
  return !!v;
}

/** Firestore quiz doc → Supabase row */
function mapQuizDoc(fsId, d, courseCodeToUuid) {
  const courseCode = d.courseId;
  const courseUuid = courseCodeToUuid[courseCode];
  if (!courseUuid) return { skip: `courseId '${courseCode}' 매핑 없음` };

  // category 검증
  const rawType = (d.type || '').toLowerCase();
  if (!VALID_CATEGORIES.has(rawType)) return { skip: `type '${rawType}' 미허용` };

  // difficulty 검증
  let difficulty = null;
  if (d.difficulty) {
    const dl = String(d.difficulty).toLowerCase();
    if (['easy', 'medium', 'hard'].includes(dl)) difficulty = dl;
    // 기타 값은 null 로 둠 (스키마 CHECK 위반 방지)
  }

  // metadata — 스키마 외 필드 흡수
  const metadata = {};
  for (const [k, v] of Object.entries(d)) {
    if (MAPPED_FIRESTORE_FIELDS.has(k)) continue;
    // Firestore Timestamp 는 직렬화 가능한 형태로
    if (v && typeof v === 'object' && v.toDate) {
      metadata[k] = toIso(v);
    } else {
      metadata[k] = v;
    }
  }

  return {
    row: {
      org_id: DEFAULT_ORG_ID,
      course_id: courseUuid,
      creator_id: d.creatorId || d.creatorUid || 'unknown',
      creator_nickname: d.creatorNickname || null,
      creator_class_type: d.creatorClassType || null,

      title: d.title || '(제목없음)',
      description: d.description || null,
      category: rawType,
      difficulty,
      tags: Array.isArray(d.tags) ? d.tags : [],

      class_type: d.classType || null,
      target_class: d.targetClass || null,
      original_type: d.originalType || null,
      was_published: d.wasPublished == null ? null : !!d.wasPublished,

      questions: Array.isArray(d.questions) ? d.questions : [],
      question_count: toInt(d.questionCount),
      ox_count: toInt(d.oxCount),
      multiple_choice_count: toInt(d.multipleChoiceCount),
      subjective_count: toInt(d.subjectiveCount),
      short_answer_count: toInt(d.shortAnswerCount),

      is_public: toBool(d.isPublic),
      is_published: toBool(d.isPublished),
      is_ai_generated: d.isAiGenerated == null ? rawType.startsWith('ai') : !!d.isAiGenerated,

      participant_count: toInt(d.participantCount),
      average_score: toRealOrNull(d.averageScore),
      bookmark_count: toInt(d.bookmarkCount),
      feedback_count: toInt(d.feedbackCount),

      rewarded: toBool(d.rewarded),
      rewarded_at: toIso(d.rewardedAt),
      exp_rewarded: null, // Firestore expRewarded 는 boolean 이라 metadata 로 감 — 실 지급액은 exp_history 에서 집계
      public_rewarded: toBool(d.publicRewarded),
      public_rewarded_at: toIso(d.publicRewardedAt),

      user_scores: d.userScores && typeof d.userScores === 'object' ? d.userScores : {},
      user_first_review_scores:
        d.userFirstReviewScores && typeof d.userFirstReviewScores === 'object'
          ? d.userFirstReviewScores
          : {},

      semester: d.semester != null ? String(d.semester) : null,
      past_year: d.pastYear != null ? String(d.pastYear) : null,
      past_exam_type: d.pastExamType || null,
      uploaded_at: toIso(d.uploadedAt),

      metadata,
      source_firestore_id: fsId,

      created_at: toIso(d.createdAt) || new Date().toISOString(),
      updated_at: toIso(d.updatedAt) || toIso(d.createdAt) || new Date().toISOString(),
    },
  };
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN (실제 쓰기 안 함)\n' : '✍️  실제 이관 시작\n');
  console.log(`기본 org: ${DEFAULT_ORG_ID}\n`);

  // 1. courses code → uuid 매핑
  const { data: courses, error: coursesErr } = await supabase
    .from('courses')
    .select('id, code')
    .eq('org_id', DEFAULT_ORG_ID);
  if (coursesErr) throw coursesErr;

  const codeToUuid = {};
  for (const c of courses) codeToUuid[c.code] = c.id;
  console.log('courses 매핑:', codeToUuid);
  console.log('');

  // 2. Firestore quizzes 전체 스캔
  console.log('Firestore quizzes 스캔 중…');
  const snap = await fsdb.collection('quizzes').get();
  console.log(`총 ${snap.size}개 발견\n`);

  const rows = [];
  const skipCategoryStats = {};
  const skipCourseStats = {};
  let skipped = 0;

  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const result = mapQuizDoc(doc.id, d, codeToUuid);
    if (result.skip) {
      skipped++;
      if (result.skip.startsWith("type")) {
        const t = (d.type || 'NULL').toLowerCase();
        skipCategoryStats[t] = (skipCategoryStats[t] || 0) + 1;
      } else if (result.skip.startsWith('courseId')) {
        const c = d.courseId || 'NULL';
        skipCourseStats[c] = (skipCourseStats[c] || 0) + 1;
      }
      continue;
    }
    rows.push(result.row);
  }

  // category 분포
  const categoryDist = {};
  for (const r of rows) categoryDist[r.category] = (categoryDist[r.category] || 0) + 1;

  console.log(`이관 대상: ${rows.length}개`);
  console.log(`스킵: ${skipped}개`);
  console.log('\n[이관 category 분포]');
  Object.entries(categoryDist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  if (Object.keys(skipCategoryStats).length) {
    console.log('\n[스킵 type 분포]');
    Object.entries(skipCategoryStats).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  }
  if (Object.keys(skipCourseStats).length) {
    console.log('\n[스킵 courseId 분포]');
    Object.entries(skipCourseStats).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  }

  if (DRY_RUN) {
    console.log('\n[샘플 3개]');
    rows.slice(0, 3).forEach((r) => {
      console.log(`  - ${r.category}/${r.difficulty} "${r.title.slice(0, 30)}" Q${r.question_count} creator=${r.creator_id.slice(0, 8)}`);
    });
    console.log('\n💡 실제 실행하려면 DRY_RUN 제거');
    return;
  }

  // 3. Supabase upsert (배치 100개씩)
  const BATCH_SIZE = 100;
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from('quizzes')
      .upsert(batch, { onConflict: 'source_firestore_id' })
      .select('id');

    if (error) {
      failed += batch.length;
      console.error(`  ❌ 배치 ${i / BATCH_SIZE + 1} 실패:`, error.message);
      continue;
    }
    inserted += data?.length || 0;
    console.log(`  ✅ 배치 ${i / BATCH_SIZE + 1}: ${data?.length || 0}개 upsert`);
  }

  console.log('');
  console.log('────────────────────────────────');
  console.log(`총 이관: ${inserted}개`);
  if (failed > 0) console.log(`실패: ${failed}개`);
  console.log('────────────────────────────────');
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
