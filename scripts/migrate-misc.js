/**
 * Phase 2 마이그레이션: 기타 도메인 → Supabase (마지막 그룹)
 *
 * 대상:
 *   1) notifications (top-level, 480) → notifications
 *   2) fcmTokens (top-level, 88) → fcm_tokens
 *   3) likes (top-level, 51) → likes
 *   4) weeklyStats/{courseCode}/weeks/{label} (collectionGroup, 27) → weekly_stats
 *   5) monthlyReports/{courseCode}/months/{label} (collectionGroup, 4) → monthly_reports
 *   6) jobs — Firestore 0개, 스킵
 *
 * 실행:
 *   DRY_RUN=1 GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-misc.js
 *   GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-misc.js
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
  console.error('[ERROR] 필수 환경변수 누락'); process.exit(1);
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
function toInt(v, fb = null) { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : fb; }

async function loadCourseMap() {
  const { data, error } = await supabase.from('courses').select('id, code').eq('org_id', DEFAULT_ORG_ID);
  if (error) throw error;
  const map = {};
  for (const c of data) map[c.code] = c.id;
  return map;
}
async function loadExistingIds(table) {
  const PAGE = 1000;
  const set = new Set();
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select('source_firestore_id').eq('org_id', DEFAULT_ORG_ID)
      .not('source_firestore_id', 'is', null).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) set.add(r.source_firestore_id);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return set;
}
async function insertBatched(table, rows, batchSize = 500) {
  let inserted = 0, failed = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { data, error } = await supabase.from(table).insert(batch).select('id');
    if (error) { failed += batch.length; console.error(`  ❌ ${table} 배치:`, error.message); continue; }
    inserted += data?.length || 0;
  }
  return { inserted, failed };
}

// ============================================================
// notifications
// ============================================================
async function migrateNotifications() {
  console.log('\n━━━ notifications → notifications ━━━');
  const existing = await loadExistingIds('notifications');
  const snap = await fsdb.collection('notifications').get();
  console.log(`Firestore: ${snap.size} / 기존 skip: ${existing.size}`);

  const rows = [];
  let skipExisting = 0, noUser = 0;
  for (const doc of snap.docs) {
    if (existing.has(doc.id)) { skipExisting++; continue; }
    const d = doc.data() || {};
    if (!d.userId) { noUser++; continue; }
    rows.push({
      org_id: DEFAULT_ORG_ID,
      user_id: d.userId,
      type: d.type || null,
      title: d.title || null,
      message: d.message || null,
      data: d.data && typeof d.data === 'object' ? d.data : {},
      read: !!d.read,
      source_firestore_id: doc.id,
      created_at: toIso(d.createdAt) || new Date().toISOString(),
    });
  }
  console.log(`이관 대상: ${rows.length} / skip 기존: ${skipExisting} / uid 없음: ${noUser}`);
  if (DRY_RUN) { rows.slice(0, 2).forEach((r) => console.log(`  - ${r.type} "${r.title || r.message || ''}" user=${r.user_id.slice(0,8)}`)); return; }
  const { inserted, failed } = await insertBatched('notifications', rows);
  console.log(`  ✅ ${inserted} insert / ${failed} fail`);
}

// ============================================================
// fcm_tokens
// ============================================================
async function migrateFcmTokens() {
  console.log('\n━━━ fcmTokens → fcm_tokens ━━━');
  const existing = await loadExistingIds('fcm_tokens');
  const snap = await fsdb.collection('fcmTokens').get();
  console.log(`Firestore: ${snap.size} / 기존 skip: ${existing.size}`);

  const rows = [];
  let skipExisting = 0;
  for (const doc of snap.docs) {
    if (existing.has(doc.id)) { skipExisting++; continue; }
    const d = doc.data() || {};
    rows.push({
      org_id: DEFAULT_ORG_ID,
      user_id: d.uid || null,
      token: d.token || doc.id,
      device_info: d.deviceInfo && typeof d.deviceInfo === 'object' ? d.deviceInfo : {},
      topics: Array.isArray(d.topics) ? d.topics : [],
      source_firestore_id: doc.id,
      created_at: toIso(d.createdAt) || new Date().toISOString(),
      updated_at: toIso(d.updatedAt) || toIso(d.createdAt) || new Date().toISOString(),
    });
  }
  console.log(`이관 대상: ${rows.length} / skip: ${skipExisting}`);
  if (DRY_RUN) { rows.slice(0, 2).forEach((r) => console.log(`  - user=${(r.user_id || 'null').slice(0,8)} topics=${r.topics.length}`)); return; }
  const { inserted, failed } = await insertBatched('fcm_tokens', rows);
  console.log(`  ✅ ${inserted} insert / ${failed} fail`);
}

// ============================================================
// likes
// ============================================================
async function migrateLikes() {
  console.log('\n━━━ likes → likes ━━━');
  const existing = await loadExistingIds('likes');
  const snap = await fsdb.collection('likes').get();
  console.log(`Firestore: ${snap.size} / 기존 skip: ${existing.size}`);

  const VALID_TARGET_TYPES = new Set(['post', 'comment']);
  const rows = [];
  let skipExisting = 0, invalidType = 0, noFields = 0;
  for (const doc of snap.docs) {
    if (existing.has(doc.id)) { skipExisting++; continue; }
    const d = doc.data() || {};
    if (!d.userId || !d.targetId) { noFields++; continue; }
    const tt = (d.targetType || '').toLowerCase();
    if (!VALID_TARGET_TYPES.has(tt)) { invalidType++; continue; }
    rows.push({
      org_id: DEFAULT_ORG_ID,
      user_id: d.userId,
      target_type: tt,
      target_id: d.targetId,
      target_user_id: d.targetUserId || null,
      source_firestore_id: doc.id,
      created_at: toIso(d.createdAt) || new Date().toISOString(),
    });
  }
  console.log(`이관 대상: ${rows.length} / skip: ${skipExisting} / 필드 없음: ${noFields} / 잘못된 target_type: ${invalidType}`);
  if (DRY_RUN) { rows.slice(0, 2).forEach((r) => console.log(`  - user=${r.user_id.slice(0,8)} ${r.target_type}:${r.target_id.slice(0,8)}`)); return; }
  const { inserted, failed } = await insertBatched('likes', rows);
  console.log(`  ✅ ${inserted} insert / ${failed} fail`);
}

// ============================================================
// weekly_stats (collectionGroup)
// ============================================================
async function migrateWeeklyStats(courseMap) {
  console.log('\n━━━ weekly_stats (collectionGroup weeks) → weekly_stats ━━━');
  const existing = await loadExistingIds('weekly_stats');
  const snap = await fsdb.collectionGroup('weeks').get();
  console.log(`Firestore: ${snap.size} / 기존 skip: ${existing.size}`);

  const rows = [];
  let skipExisting = 0, noCourse = 0;
  for (const doc of snap.docs) {
    // path: weeklyStats/{courseCode}/weeks/{weekLabel}
    const parts = doc.ref.path.split('/');
    if (parts[0] !== 'weeklyStats') continue;
    const courseCode = parts[1];
    const weekLabel = parts[3];
    const sourceFsId = `${courseCode}__${weekLabel}`;
    if (existing.has(sourceFsId)) { skipExisting++; continue; }
    const courseUuid = courseMap[courseCode];
    if (!courseUuid) { noCourse++; continue; }
    const d = doc.data() || {};
    rows.push({
      org_id: DEFAULT_ORG_ID,
      course_id: courseUuid,
      week_label: weekLabel,
      week_start: d.weekStart || null,
      week_end: d.weekEnd || null,
      week_range_ko: d.weekRangeKo || null,
      engagement: d.engagement || {},
      feature_usage: d.featureUsage || {},
      learning: d.learning || {},
      gamification: d.gamification || {},
      social: d.social || {},
      source_firestore_id: sourceFsId,
      created_at: toIso(d.createdAt) || new Date().toISOString(),
    });
  }
  console.log(`이관 대상: ${rows.length} / skip: ${skipExisting} / course 매핑 없음: ${noCourse}`);
  if (DRY_RUN) { rows.slice(0, 3).forEach((r) => console.log(`  - ${r.week_label} course=${r.course_id.slice(0,8)}`)); return; }
  if (rows.length === 0) return;
  const { data, error } = await supabase.from('weekly_stats').insert(rows).select('id');
  if (error) { console.error('  ❌', error.message); return; }
  console.log(`  ✅ ${data?.length || 0} insert`);
}

// ============================================================
// monthly_reports (collectionGroup)
// ============================================================
async function migrateMonthlyReports(courseMap) {
  console.log('\n━━━ monthly_reports (collectionGroup months) → monthly_reports ━━━');
  const existing = await loadExistingIds('monthly_reports');
  const snap = await fsdb.collectionGroup('months').get();
  console.log(`Firestore: ${snap.size} / 기존 skip: ${existing.size}`);

  const rows = [];
  let skipExisting = 0, noCourse = 0;
  for (const doc of snap.docs) {
    const parts = doc.ref.path.split('/');
    if (parts[0] !== 'monthlyReports') continue;
    const courseCode = parts[1];
    const monthLabel = parts[3];
    const sourceFsId = `${courseCode}__${monthLabel}`;
    if (existing.has(sourceFsId)) { skipExisting++; continue; }
    const courseUuid = courseMap[courseCode];
    if (!courseUuid) { noCourse++; continue; }
    const d = doc.data() || {};
    rows.push({
      org_id: DEFAULT_ORG_ID,
      course_id: courseUuid,
      year: toInt(d.year) ?? new Date().getFullYear(),
      month: toInt(d.month) ?? 1,
      month_label: monthLabel,
      weekly_stats_used: Array.isArray(d.weeklyStatsUsed) ? d.weeklyStatsUsed : [],
      insight: d.insight || null,
      source_firestore_id: sourceFsId,
      created_at: toIso(d.createdAt) || new Date().toISOString(),
    });
  }
  console.log(`이관 대상: ${rows.length} / skip: ${skipExisting} / course 매핑 없음: ${noCourse}`);
  if (DRY_RUN) { rows.slice(0, 2).forEach((r) => console.log(`  - ${r.month_label} course=${r.course_id.slice(0,8)} insight=${r.insight ? r.insight.slice(0,30) : 'null'}`)); return; }
  if (rows.length === 0) return;
  const { data, error } = await supabase.from('monthly_reports').insert(rows).select('id');
  if (error) { console.error('  ❌', error.message); return; }
  console.log(`  ✅ ${data?.length || 0} insert`);
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN' : '✍️  실제 이관 시작');
  console.log(`기본 org: ${DEFAULT_ORG_ID}`);
  const courseMap = await loadCourseMap();

  await migrateNotifications();
  await migrateFcmTokens();
  await migrateLikes();
  await migrateWeeklyStats(courseMap);
  await migrateMonthlyReports(courseMap);

  console.log('\nℹ️  jobs 는 Firestore 0개라 스킵 (테이블은 생성되어 있음)');
  if (DRY_RUN) console.log('\n💡 실제 실행하려면 DRY_RUN 제거');
}

main()
  .then(() => { console.log('\n✅ 완료'); process.exit(0); })
  .catch((err) => { console.error('\n❌', err); process.exit(1); });
