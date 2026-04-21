/**
 * Phase 2 마이그레이션: Firestore 게이미피케이션 → Supabase
 *
 * 대상:
 *   1) rabbits (top-level, doc id = `{courseCode}_{rabbitId}`) → rabbits
 *   2) users/{uid}/rabbitHoldings (서브컬렉션, collectionGroup) → rabbit_holdings
 *   3) users/{uid}/expHistory (서브컬렉션, collectionGroup) → exp_history
 *
 * 실행:
 *   DRY_RUN=1 GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-gamification.js
 *   GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-gamification.js
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
function toInt(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fb;
}

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
    const { data, error } = await supabase
      .from(table).select('source_firestore_id').eq('org_id', DEFAULT_ORG_ID)
      .not('source_firestore_id', 'is', null).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) set.add(r.source_firestore_id);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return set;
}

// ============================================================
// rabbits (top-level)
// ============================================================
async function migrateRabbits(courseMap) {
  console.log('\n━━━ rabbits → rabbits ━━━');
  const existing = await loadExistingIds('rabbits');
  if (existing.size) console.log(`기존 ${existing.size}개 skip`);

  const snap = await fsdb.collection('rabbits').get();
  console.log(`Firestore rabbits: ${snap.size}개`);

  const rows = [];
  let skipExisting = 0;
  let noCourse = 0;

  for (const doc of snap.docs) {
    if (existing.has(doc.id)) {
      skipExisting++;
      continue;
    }
    const d = doc.data() || {};
    const courseUuid = courseMap[d.courseId];
    if (!courseUuid) {
      noCourse++;
      continue;
    }
    const rabbitId = toInt(d.rabbitId, 0);
    if (rabbitId < 0 || rabbitId >= 80) continue;

    rows.push({
      org_id: DEFAULT_ORG_ID,
      course_id: courseUuid,
      rabbit_id: rabbitId,
      name: d.name || null,
      first_discoverer_user_id: d.firstDiscovererUserId || null,
      first_discoverer_name: d.firstDiscovererName || null,
      first_discoverer_nickname: d.firstDiscovererNickname || null,
      discoverers: Array.isArray(d.discoverers) ? d.discoverers : [],
      discoverer_count: toInt(d.discovererCount, 0),
      source_firestore_id: doc.id,
      created_at: toIso(d.createdAt) || new Date().toISOString(),
      updated_at: toIso(d.updatedAt) || toIso(d.createdAt) || new Date().toISOString(),
    });
  }

  console.log(`이관 대상: ${rows.length} / 기존: ${skipExisting} / course 매핑 없음: ${noCourse}`);

  if (DRY_RUN) {
    console.log('샘플 3:');
    rows.slice(0, 3).forEach((r) => console.log(`  - rabbit${r.rabbit_id} "${r.name}" discoverers=${r.discoverer_count}`));
    return;
  }
  if (rows.length === 0) return;

  const { data, error } = await supabase.from('rabbits').insert(rows).select('id');
  if (error) { console.error('  ❌', error.message); return; }
  console.log(`  ✅ ${data?.length || 0}개 insert`);
}

// ============================================================
// rabbit_holdings (users/{uid}/rabbitHoldings, collectionGroup)
// ============================================================
async function migrateRabbitHoldings(courseMap) {
  console.log('\n━━━ rabbitHoldings (collectionGroup) → rabbit_holdings ━━━');
  const existing = await loadExistingIds('rabbit_holdings');
  if (existing.size) console.log(`기존 ${existing.size}개 skip`);

  const snap = await fsdb.collectionGroup('rabbitHoldings').get();
  console.log(`Firestore rabbitHoldings: ${snap.size}개`);

  const rows = [];
  let skipExisting = 0;
  let noCourse = 0;
  let noUser = 0;

  for (const doc of snap.docs) {
    // path: users/{uid}/rabbitHoldings/{holdingId}
    const pathParts = doc.ref.path.split('/');
    const uid = pathParts[1];
    const holdingId = pathParts[3];
    if (!uid) { noUser++; continue; }

    const sourceFsId = `${uid}__${holdingId}`;
    if (existing.has(sourceFsId)) { skipExisting++; continue; }

    const d = doc.data() || {};
    const courseUuid = courseMap[d.courseId];
    if (!courseUuid) { noCourse++; continue; }

    const rabbitId = toInt(d.rabbitId, 0);
    if (rabbitId < 0 || rabbitId >= 80) continue;

    rows.push({
      org_id: DEFAULT_ORG_ID,
      course_id: courseUuid,
      user_id: uid,
      rabbit_id: rabbitId,
      level: toInt(d.level, 1),
      stats: d.stats && typeof d.stats === 'object' ? d.stats : {},
      discovery_order: toInt(d.discoveryOrder),
      discovered_at: toIso(d.discoveredAt),
      source_firestore_id: sourceFsId,
      created_at: toIso(d.discoveredAt) || new Date().toISOString(),
      updated_at: toIso(d.updatedAt) || toIso(d.discoveredAt) || new Date().toISOString(),
    });
  }

  console.log(`이관 대상: ${rows.length} / 기존: ${skipExisting} / course 매핑 없음: ${noCourse} / uid 없음: ${noUser}`);

  if (DRY_RUN) {
    console.log('샘플 3:');
    rows.slice(0, 3).forEach((r) => console.log(`  - user=${r.user_id.slice(0, 8)} rabbit${r.rabbit_id} Lv${r.level} stats=${JSON.stringify(r.stats)}`));
    return;
  }

  const BATCH = 500;
  let inserted = 0, failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase.from('rabbit_holdings').insert(batch).select('id');
    if (error) { failed += batch.length; console.error(`  ❌ 배치 ${i / BATCH + 1}:`, error.message); continue; }
    inserted += data?.length || 0;
    console.log(`  ✅ 배치 ${i / BATCH + 1}: ${data?.length || 0}개`);
  }
  console.log(`총 insert: ${inserted} / 실패: ${failed}`);
}

// ============================================================
// exp_history (users/{uid}/expHistory, collectionGroup)
// ============================================================
async function migrateExpHistory() {
  console.log('\n━━━ expHistory (collectionGroup) → exp_history ━━━');
  const existing = await loadExistingIds('exp_history');
  if (existing.size) console.log(`기존 ${existing.size}개 skip`);

  const snap = await fsdb.collectionGroup('expHistory').get();
  console.log(`Firestore expHistory: ${snap.size}개`);

  const rows = [];
  let skipExisting = 0;
  let noUser = 0;

  for (const doc of snap.docs) {
    const pathParts = doc.ref.path.split('/');
    const uid = pathParts[1];
    const expDocId = pathParts[3];
    if (!uid) { noUser++; continue; }

    const sourceFsId = `${uid}__${expDocId}`;
    if (existing.has(sourceFsId)) { skipExisting++; continue; }

    const d = doc.data() || {};

    rows.push({
      org_id: DEFAULT_ORG_ID,
      user_id: uid,
      amount: toInt(d.amount, 0),
      reason: d.reason || '',
      type: d.type || null,
      source_id: d.sourceId || null,
      source_collection: d.sourceCollection || null,
      previous_exp: toInt(d.previousExp),
      new_exp: toInt(d.newExp),
      metadata: d.metadata && typeof d.metadata === 'object' ? d.metadata : {},
      source_firestore_id: sourceFsId,
      created_at: toIso(d.createdAt) || new Date().toISOString(),
    });
  }

  console.log(`이관 대상: ${rows.length} / 기존: ${skipExisting} / uid 없음: ${noUser}`);

  if (DRY_RUN) {
    console.log('샘플 3:');
    rows.slice(0, 3).forEach((r) => console.log(`  - user=${r.user_id.slice(0, 8)} +${r.amount} ${r.type} "${r.reason.slice(0, 25)}"`));
    return;
  }

  const BATCH = 500;
  let inserted = 0, failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase.from('exp_history').insert(batch).select('id');
    if (error) { failed += batch.length; console.error(`  ❌ 배치 ${i / BATCH + 1}:`, error.message); continue; }
    inserted += data?.length || 0;
    if ((i / BATCH) % 3 === 0) console.log(`  ✅ 배치 ${Math.floor(i / BATCH) + 1}/${Math.ceil(rows.length / BATCH)}: ${data?.length || 0}개`);
  }
  console.log(`총 insert: ${inserted} / 실패: ${failed}`);
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN' : '✍️  실제 이관 시작');
  console.log(`기본 org: ${DEFAULT_ORG_ID}`);

  const courseMap = await loadCourseMap();
  console.log('courses:', Object.keys(courseMap).length);

  await migrateRabbits(courseMap);
  await migrateRabbitHoldings(courseMap);
  await migrateExpHistory();

  if (DRY_RUN) console.log('\n💡 실제 실행하려면 DRY_RUN 제거');
}

main()
  .then(() => { console.log('\n✅ 완료'); process.exit(0); })
  .catch((err) => { console.error('\n❌', err); process.exit(1); });
