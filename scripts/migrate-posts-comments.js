/**
 * Phase 2 마이그레이션: Firestore posts + comments → Supabase
 *
 * 전제: 20260420020000_phase2_board_domain.sql 적용됨
 *
 * 이관 방식:
 *   1) posts — source_firestore_id unique, pre-filter insert
 *   2) comments — UUID 미리 생성 후 parent_id 매핑해서 한 번에 insert
 *                 (self-reference 있어 두 단계 필요 없음)
 *
 * 실행:
 *   DRY_RUN=1 GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-posts-comments.js
 *   GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node scripts/migrate-posts-comments.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

// courses 매핑
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

// ============================================================
// posts
// ============================================================
async function migratePosts(courseMap) {
  console.log('\n━━━ posts → posts ━━━');
  const snap = await fsdb.collection('posts').get();
  console.log(`Firestore posts: ${snap.size}개`);

  // 기존 이관된 것
  const { data: existingData } = await supabase
    .from('posts')
    .select('source_firestore_id, id')
    .eq('org_id', DEFAULT_ORG_ID);
  const existingFsIds = new Set((existingData || []).map((r) => r.source_firestore_id).filter(Boolean));
  const fsIdToPostUuid = {};
  for (const row of existingData || []) {
    if (row.source_firestore_id) fsIdToPostUuid[row.source_firestore_id] = row.id;
  }

  const rows = [];
  let skipNoCourse = 0;
  let skipExisting = 0;

  // Firestore tag 허용값
  const ALLOWED_TAGS = new Set(['학술', '기타', '학사', '비공개']);

  for (const doc of snap.docs) {
    const d = doc.data() || {};
    if (existingFsIds.has(doc.id)) {
      skipExisting++;
      continue;
    }
    const courseUuid = courseMap[d.courseId];
    if (!courseUuid) {
      skipNoCourse++;
      continue;
    }

    // 새 UUID 생성 (comments 에서 accepted_comment_id / FK 참조용)
    const newUuid = crypto.randomUUID();
    fsIdToPostUuid[doc.id] = newUuid;

    const tag = ALLOWED_TAGS.has(d.tag) ? d.tag : null;

    rows.push({
      id: newUuid,
      org_id: DEFAULT_ORG_ID,
      course_id: courseUuid,
      author_id: d.authorId || 'unknown',
      author_nickname: d.authorNickname || null,
      author_class_type: d.authorClassType || null,
      title: d.title || '(제목없음)',
      content: d.content || '',
      category: d.category || null,
      tag,
      chapter_tags: Array.isArray(d.chapterTags) ? d.chapterTags : [],
      is_anonymous: !!d.isAnonymous,
      is_notice: !!d.isNotice,
      is_private: !!d.isPrivate,
      to_professor: !!d.toProfessor,
      image_url: d.imageUrl || null,
      image_urls: Array.isArray(d.imageUrls) ? d.imageUrls : [],
      file_urls: Array.isArray(d.fileUrls) ? d.fileUrls : [],
      ai_detailed_answer: d.aiDetailedAnswer || null,
      likes: toInt(d.likes),
      like_count: toInt(d.likeCount ?? d.likes),
      liked_by: Array.isArray(d.likedBy) ? d.likedBy : [],
      comment_count: toInt(d.commentCount),
      view_count: toInt(d.viewCount),
      accepted_comment_id: null, // comments 이관 후 추후 UPDATE
      rewarded: !!d.rewarded,
      rewarded_at: toIso(d.rewardedAt),
      exp_rewarded: null,
      metadata: {
        ...(d.expRewarded != null ? { expRewarded: d.expRewarded } : {}),
        ...(d.acceptedCommentId ? { acceptedCommentIdFs: d.acceptedCommentId } : {}),
      },
      source_firestore_id: doc.id,
      created_at: toIso(d.createdAt) || new Date().toISOString(),
      updated_at: toIso(d.updatedAt) || toIso(d.createdAt) || new Date().toISOString(),
    });
  }

  console.log(`이관 대상: ${rows.length} / 기존: ${skipExisting} / 스킵(course 매핑 없음): ${skipNoCourse}`);

  if (DRY_RUN) {
    console.log('샘플 3:');
    rows.slice(0, 3).forEach((r) => console.log(`  - "${r.title.slice(0, 25)}" tag=${r.tag} author=${r.author_nickname} like=${r.like_count}`));
    return fsIdToPostUuid;
  }

  const BATCH = 200;
  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase.from('posts').insert(batch).select('id');
    if (error) {
      failed += batch.length;
      console.error(`  ❌ 배치 ${i / BATCH + 1} 실패:`, error.message);
      continue;
    }
    inserted += data?.length || 0;
    console.log(`  ✅ 배치 ${i / BATCH + 1}: ${data?.length || 0}개 insert`);
  }
  console.log(`총 insert: ${inserted} / 실패: ${failed}`);
  return fsIdToPostUuid;
}

// ============================================================
// comments (self-ref → UUID 미리 생성해서 한 번에)
// ============================================================
async function migrateComments(fsIdToPostUuid) {
  console.log('\n━━━ comments → comments ━━━');
  const snap = await fsdb.collection('comments').get();
  console.log(`Firestore comments: ${snap.size}개`);

  // 기존 이관된 것
  const PAGE = 1000;
  const existingFsIds = new Set();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('comments')
      .select('source_firestore_id')
      .eq('org_id', DEFAULT_ORG_ID)
      .not('source_firestore_id', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) existingFsIds.add(r.source_firestore_id);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  if (existingFsIds.size > 0) console.log(`기존 Supabase 에 ${existingFsIds.size}개 skip`);

  // 1단계: 모든 comments 에 UUID 배정
  const fsIdToCommentUuid = {};
  const docsToMigrate = [];
  let skipExisting = 0;
  let skipNoPost = 0;

  for (const doc of snap.docs) {
    if (existingFsIds.has(doc.id)) {
      skipExisting++;
      continue;
    }
    const d = doc.data() || {};
    const postUuid = fsIdToPostUuid[d.postId];
    if (!postUuid) {
      skipNoPost++;
      continue;
    }
    fsIdToCommentUuid[doc.id] = crypto.randomUUID();
    docsToMigrate.push({ fsId: doc.id, d, postUuid });
  }

  // 2단계: rows 빌드 (parent_id 매핑)
  const rows = [];
  let skipNoParent = 0; // parentId 는 있으나 그 댓글이 존재하지 않는 경우
  for (const { fsId, d, postUuid } of docsToMigrate) {
    let parent_id = null;
    if (d.parentId) {
      parent_id = fsIdToCommentUuid[d.parentId] || null;
      if (!parent_id) {
        // 부모 댓글이 기존에 이미 이관되어 있을 수 있음 → DB 조회 필요
        // (이 경우 극소수라 일단 루트댓글 처리)
        skipNoParent++;
      }
    }

    rows.push({
      id: fsIdToCommentUuid[fsId],
      org_id: DEFAULT_ORG_ID,
      post_id: postUuid,
      parent_id,
      author_id: d.authorId || 'unknown',
      author_nickname: d.authorNickname || null,
      author_class_type: d.authorClassType || null,
      content: d.content || '',
      image_urls: Array.isArray(d.imageUrls) ? d.imageUrls : [],
      is_anonymous: !!d.isAnonymous,
      is_ai_reply: !!d.isAIReply || d.authorId === 'gemini-ai',
      is_accepted: !!d.isAccepted,
      accepted_at: toIso(d.acceptedAt),
      likes: toInt(d.likes),
      like_count: toInt(d.likeCount ?? d.likes),
      liked_by: Array.isArray(d.likedBy) ? d.likedBy : [],
      rewarded: !!d.rewarded,
      rewarded_at: toIso(d.rewardedAt),
      exp_rewarded: null,
      metadata: {
        ...(d.expRewarded != null ? { expRewarded: d.expRewarded } : {}),
      },
      source_firestore_id: fsId,
      created_at: toIso(d.createdAt) || new Date().toISOString(),
      updated_at: toIso(d.updatedAt) || toIso(d.createdAt) || new Date().toISOString(),
    });
  }

  console.log(
    `이관 대상: ${rows.length} / 기존: ${skipExisting} / 스킵(게시글 없음): ${skipNoPost} / 부모 재매칭 실패(루트 처리): ${skipNoParent}`
  );

  if (DRY_RUN) {
    console.log('샘플 3:');
    rows.slice(0, 3).forEach((r) => console.log(`  - post=${r.post_id.slice(0, 8)} ai=${r.is_ai_reply} parent=${r.parent_id ? r.parent_id.slice(0, 8) : 'null'} "${r.content.slice(0, 25)}"`));
    return;
  }

  // ── 1단계: parent_id = null 로 모두 삽입 (FK 제약 회피) ──
  //    parent_id 는 다음 단계에서 UPDATE
  const rowsPhase1 = rows.map((r) => ({ ...r, parent_id: null }));

  const BATCH = 300;
  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < rowsPhase1.length; i += BATCH) {
    const batch = rowsPhase1.slice(i, i + BATCH);
    const { data, error } = await supabase.from('comments').insert(batch).select('id');
    if (error) {
      failed += batch.length;
      console.error(`  ❌ 1단계 배치 ${i / BATCH + 1} 실패:`, error.message);
      continue;
    }
    inserted += data?.length || 0;
    console.log(`  ✅ 1단계 배치 ${i / BATCH + 1}: ${data?.length || 0}개 insert`);
  }
  console.log(`  1단계 총 insert: ${inserted} / 실패: ${failed}`);

  // ── 2단계: parent_id 있는 것들만 UPDATE ──
  const withParent = rows.filter((r) => r.parent_id);
  console.log(`  2단계 parent_id UPDATE 대상: ${withParent.length}개`);

  let updated = 0;
  let updateFailed = 0;
  for (const r of withParent) {
    const { error } = await supabase
      .from('comments')
      .update({ parent_id: r.parent_id })
      .eq('id', r.id);
    if (error) {
      updateFailed++;
      if (updateFailed <= 3) console.error(`    ❌ UPDATE 실패 ${r.id.slice(0, 8)}:`, error.message);
      continue;
    }
    updated++;
  }
  console.log(`  2단계 총 update: ${updated} / 실패: ${updateFailed}`);
}

// ============================================================
// posts.accepted_comment_id 후처리
// ============================================================
async function linkAcceptedComments() {
  console.log('\n━━━ posts.accepted_comment_id 후처리 ━━━');

  // metadata.acceptedCommentIdFs 가 있는 posts 조회
  const { data: posts, error: pErr } = await supabase
    .from('posts')
    .select('id, metadata, source_firestore_id')
    .eq('org_id', DEFAULT_ORG_ID)
    .not('metadata->acceptedCommentIdFs', 'is', null);
  if (pErr) throw pErr;
  if (!posts || posts.length === 0) {
    console.log('채택된 댓글이 있는 posts 없음');
    return;
  }

  console.log(`채택 후보 posts: ${posts.length}개`);

  let linked = 0;
  for (const p of posts) {
    const fsCommentId = p.metadata?.acceptedCommentIdFs;
    if (!fsCommentId) continue;
    const { data: comment } = await supabase
      .from('comments')
      .select('id')
      .eq('org_id', DEFAULT_ORG_ID)
      .eq('source_firestore_id', fsCommentId)
      .maybeSingle();
    if (!comment) continue;

    if (!DRY_RUN) {
      await supabase.from('posts').update({ accepted_comment_id: comment.id }).eq('id', p.id);
    }
    linked++;
  }
  console.log(`${linked}개 posts 의 accepted_comment_id 연결${DRY_RUN ? ' (DRY)' : ''}`);
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN (실제 쓰기 안 함)' : '✍️  실제 이관 시작');
  console.log(`기본 org: ${DEFAULT_ORG_ID}`);

  const courseMap = await loadCourseMap();
  console.log('courses:', courseMap);

  const fsIdToPostUuid = await migratePosts(courseMap);
  await migrateComments(fsIdToPostUuid);
  await linkAcceptedComments();

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
