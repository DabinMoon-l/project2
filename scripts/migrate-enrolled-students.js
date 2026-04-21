/**
 * Phase 2 마이그레이션: Firestore enrolledStudents → Supabase enrolled_students
 *
 * Firestore 구조: enrolledStudents/{courseId}/students/{studentId}
 *                 각 문서: { studentId, name, isRegistered, ... }
 *
 * Supabase 대상:  public.enrolled_students (org_id, course_id, student_id, name)
 *
 * 실행 명령:
 *   1) Dry-run (실제 쓰기 안 함, 건수만 확인):
 *      DRY_RUN=1 GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-enrolled-students.js
 *
 *   2) 실제 실행:
 *      GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-enrolled-students.js
 *
 * 멱등(idempotent): ON CONFLICT DO NOTHING 으로 재실행 안전.
 */

const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createClient } = require('@supabase/supabase-js');

// ── .env.local 자동 로드 (Supabase 변수) ───────────────────────
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

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN (실제 쓰기 안 함)\n' : '✍️  실제 이관 시작\n');
  console.log(`기본 org: ${DEFAULT_ORG_ID}\n`);

  // 1. Supabase courses 매핑 (code → uuid)
  const { data: courses, error: coursesErr } = await supabase
    .from('courses')
    .select('id, code')
    .eq('org_id', DEFAULT_ORG_ID);
  if (coursesErr) throw coursesErr;

  const codeToUuid = {};
  for (const c of courses) codeToUuid[c.code] = c.id;
  console.log('Supabase courses:', codeToUuid);
  console.log('');

  // 2. Firestore enrolledStudents/{courseId}/students/ 순회
  let totalFound = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const code of Object.keys(codeToUuid)) {
    const courseUuid = codeToUuid[code];
    const snap = await fsdb
      .collection('enrolledStudents')
      .doc(code)
      .collection('students')
      .get();

    const rows = [];
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      const studentId = d.studentId || doc.id;
      const name = d.name || '이름없음';
      if (!studentId) continue;

      rows.push({
        org_id: DEFAULT_ORG_ID,
        course_id: courseUuid,
        student_id: studentId,
        name,
        class_id: d.classId || null,
        is_registered: !!d.isRegistered,
        registered_uid: d.registeredUid || null,
      });
    }
    totalFound += rows.length;

    console.log(`[${code}] Firestore에서 ${rows.length}명 발견`);

    if (rows.length === 0) continue;

    if (DRY_RUN) {
      console.log(`  샘플 3명:`, rows.slice(0, 3).map(r => `${r.student_id}(${r.name})`).join(', '));
      totalInserted += rows.length;
      continue;
    }

    // 3. Supabase upsert (UNIQUE course_id, student_id 기준)
    //    ignoreDuplicates=false (기본값) — 기존 row도 새 컬럼(class_id/is_registered/registered_uid)으로 갱신
    const { data: upserted, error: insertErr } = await supabase
      .from('enrolled_students')
      .upsert(rows, { onConflict: 'course_id,student_id' })
      .select('id');

    if (insertErr) {
      console.error(`  ❌ [${code}] 업서트 실패:`, insertErr.message);
      continue;
    }

    const upsertedCount = upserted?.length || 0;
    totalInserted += upsertedCount;
    console.log(`  ✅ 업서트 완료: ${upsertedCount}명 (신규 + 갱신)`);
  }

  console.log('');
  console.log('────────────────────────────────');
  console.log(`총 Firestore 학생: ${totalFound}명`);
  console.log(`업서트 완료(신규+갱신): ${totalInserted}명`);
  if (totalSkipped > 0) console.log(`스킵: ${totalSkipped}명`);
  console.log('────────────────────────────────');

  if (DRY_RUN) {
    console.log('\n💡 실제 실행하려면 DRY_RUN 제거:');
    console.log('   GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-enrolled-students.js');
  }
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
