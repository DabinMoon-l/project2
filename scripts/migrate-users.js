/**
 * Phase 2 마이그레이션: Firestore users → Supabase user_profiles
 *
 * Firestore 구조: users/{uid}
 *   주요 필드: nickname, name, role, courseId, classType, totalExp, level, rank,
 *             badges[], equippedRabbits, profileRabbitId, totalCorrect,
 *             totalAttemptedQuestions, professorQuizzesCompleted, tekkenTotal,
 *             feedbackCount, lastGachaExp, spinLock, recoveryEmail, assignedCourses[]
 *
 * Supabase 대상: public.user_profiles (org_id, user_id, ...)
 *
 * 실행 명령:
 *   1) Dry-run (실제 쓰기 안 함, 건수/샘플만 출력):
 *      DRY_RUN=1 GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-users.js
 *
 *   2) 실제 실행:
 *      GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-users.js
 *
 * 멱등(idempotent): UNIQUE(org_id, user_id) + upsert로 재실행 안전.
 * Firestore는 primary 유지 — 이 스크립트는 단방향 복사.
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

// ── 환경변수 검증 ──
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_ORG_ID = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[ERROR] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 .env.local에 없습니다.');
  process.exit(1);
}
if (!DEFAULT_ORG_ID) {
  console.error('[ERROR] NEXT_PUBLIC_DEFAULT_ORG_ID가 .env.local에 없습니다.');
  process.exit(1);
}

// ── 초기화 ──
initializeApp();
const fsdb = getFirestore();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Firestore user doc → Supabase row 매핑 */
function mapUserDoc(uid, d) {
  // role 검증 — user_profiles check 제약 ('professor' | 'student')
  const rawRole = (d.role || 'student').toLowerCase();
  const role = rawRole === 'professor' ? 'professor' : 'student';

  // nickname 필수, 없으면 기본값
  const nickname = d.nickname || d.name || (role === 'professor' ? '교수' : '학생');

  return {
    org_id: DEFAULT_ORG_ID,
    user_id: uid,
    nickname,
    name: d.name || null,
    role,
    course_id: d.courseId || null,
    // Firestore 실제 필드명은 classId (ProfileDrawer/useProfile 참고).
    // 레거시 호환으로 classType 도 fallback.
    class_type: d.classId || d.classType || null,
    total_exp: Number(d.totalExp) || 0,
    level: Number(d.level) || 1,
    rank: d.rank != null ? Number(d.rank) : null,
    badges: Array.isArray(d.badges) ? d.badges : [],
    equipped_rabbits: Array.isArray(d.equippedRabbits) ? d.equippedRabbits : [],
    profile_rabbit_id: d.profileRabbitId != null ? Number(d.profileRabbitId) : null,
    total_correct: Number(d.totalCorrect) || 0,
    total_attempted_questions: Number(d.totalAttemptedQuestions) || 0,
    professor_quizzes_completed: Number(d.professorQuizzesCompleted) || 0,
    tekken_total: Number(d.tekkenTotal) || 0,
    feedback_count: Number(d.feedbackCount) || 0,
    last_gacha_exp: Number(d.lastGachaExp) || 0,
    spin_lock: !!d.spinLock,
    recovery_email: d.recoveryEmail || null,
    assigned_courses: Array.isArray(d.assignedCourses) ? d.assignedCourses : [],
  };
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN (실제 쓰기 안 함)\n' : '✍️  실제 이관 시작\n');
  console.log(`기본 org: ${DEFAULT_ORG_ID}\n`);

  // 1. Firestore users 컬렉션 전체 스캔
  console.log('Firestore users 스캔 중…');
  const snap = await fsdb.collection('users').get();
  console.log(`총 ${snap.size}명 발견\n`);

  // role 별 카운트 + 이관 행 구성
  const rowsStudent = [];
  const rowsProfessor = [];
  const rowsSkipped = [];

  for (const doc of snap.docs) {
    const uid = doc.id;
    const d = doc.data() || {};

    // 필수: nickname 또는 name 최소 한 개 있어야 의미 있음
    if (!d.nickname && !d.name && !d.role) {
      rowsSkipped.push({ uid, reason: '빈 문서' });
      continue;
    }

    const row = mapUserDoc(uid, d);
    if (row.role === 'professor') rowsProfessor.push(row);
    else rowsStudent.push(row);
  }

  console.log(`교수: ${rowsProfessor.length}명`);
  console.log(`학생: ${rowsStudent.length}명`);
  console.log(`스킵(빈 문서): ${rowsSkipped.length}명\n`);

  if (DRY_RUN) {
    console.log('샘플 교수 3명:');
    rowsProfessor.slice(0, 3).forEach((r) => {
      console.log(`  - ${r.nickname} (${r.user_id}) courses=${JSON.stringify(r.assigned_courses)}`);
    });
    console.log('\n샘플 학생 3명:');
    rowsStudent.slice(0, 3).forEach((r) => {
      console.log(`  - ${r.nickname} (${r.user_id}) ${r.course_id}/${r.class_type} Lv${r.level} ${r.total_exp}XP`);
    });
    console.log('\n💡 실제 실행하려면 DRY_RUN 제거:');
    console.log('   GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-users.js');
    return;
  }

  // 2. Supabase upsert (배치 100개씩)
  const BATCH_SIZE = 100;
  const allRows = [...rowsProfessor, ...rowsStudent];
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from('user_profiles')
      .upsert(batch, { onConflict: 'org_id,user_id' })
      .select('id');

    if (error) {
      failed += batch.length;
      console.error(`  ❌ 배치 ${i / BATCH_SIZE + 1} 실패:`, error.message);
      continue;
    }
    inserted += data?.length || 0;
    console.log(`  ✅ 배치 ${i / BATCH_SIZE + 1}: ${data?.length || 0}명 upsert`);
  }

  console.log('');
  console.log('────────────────────────────────');
  console.log(`총 이관: ${inserted}명 (교수 ${rowsProfessor.length} + 학생 ${rowsStudent.length})`);
  if (failed > 0) console.log(`실패: ${failed}명`);
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
