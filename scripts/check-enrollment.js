/**
 * 특정 학번이 Firestore / Supabase 양쪽에 제대로 등록됐는지 확인
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json \
 *     node scripts/check-enrollment.js <courseId> <studentId>
 *
 * 예:
 *   GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json \
 *     node scripts/check-enrollment.js microbiology 24010343
 */

const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createClient } = require('@supabase/supabase-js');

// ── .env.local 자동 로드 ──
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

const [, , courseId, studentId] = process.argv;

if (!courseId || !studentId) {
  console.error('사용법: node scripts/check-enrollment.js <courseId> <studentId>');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DEFAULT_ORG_ID) {
  console.error('[ERROR] .env.local에 Supabase 변수 누락');
  process.exit(1);
}

initializeApp();
const fsdb = getFirestore();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

(async () => {
  console.log(`\n🔍 ${courseId} / ${studentId} 등록 상태 확인\n`);

  // 1) Firestore 확인
  console.log('── Firestore enrolledStudents ──');
  const ref = fsdb
    .collection('enrolledStudents')
    .doc(courseId)
    .collection('students')
    .doc(studentId);
  const snap = await ref.get();
  if (snap.exists) {
    const d = snap.data();
    console.log('  ✅ 존재함');
    console.log(`     이름: ${d.name || '(없음)'}`);
    console.log(`     반: ${d.classId || '(없음)'}`);
    console.log(`     isRegistered: ${d.isRegistered}`);
    console.log(`     등록자: ${d.enrolledBy || '(없음)'}`);
    console.log(`     등록일: ${d.enrolledAt?.toDate?.().toISOString?.() || '(없음)'}`);
  } else {
    console.log('  ❌ 문서 없음');
  }

  // 2) Supabase courses UUID 조회
  console.log('\n── Supabase courses ──');
  const { data: course, error: cErr } = await supabase
    .from('courses')
    .select('id, code, name')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('code', courseId)
    .maybeSingle();
  if (cErr || !course) {
    console.log(`  ❌ 과목 UUID 조회 실패: ${cErr?.message || '없음'}`);
    process.exit(1);
  }
  console.log(`  ✅ ${course.code} → ${course.id}`);

  // 3) Supabase enrolled_students 확인
  console.log('\n── Supabase enrolled_students ──');
  const { data: row, error: sErr } = await supabase
    .from('enrolled_students')
    .select('*')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('course_id', course.id)
    .eq('student_id', studentId)
    .maybeSingle();
  if (sErr) {
    console.log(`  ❌ 조회 에러: ${sErr.message}`);
  } else if (!row) {
    console.log('  ❌ row 없음');
  } else {
    console.log('  ✅ 존재함');
    console.log(`     이름: ${row.name || '(없음)'}`);
    console.log(`     반: ${row.class_id || '(없음)'}`);
    console.log(`     is_registered: ${row.is_registered}`);
    console.log(`     registered_uid: ${row.registered_uid || '(없음)'}`);
  }

  console.log('\n✨ 완료\n');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
