/**
 * 부하 테스트 댓글 삭제 스크립트
 *
 * 실행 방법:
 * npx ts-node scripts/delete-load-test-comments.ts
 */

import { initializeApp, cert, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Admin 초기화
if (getApps().length === 0) {
  const serviceAccountPath = path.join(__dirname, '../serviceAccountKey.json');

  if (fs.existsSync(serviceAccountPath)) {
    initializeApp({
      credential: cert(serviceAccountPath),
    });
  } else {
    console.log('serviceAccountKey.json이 없어 기본 인증을 사용합니다.');
    initializeApp({
      credential: applicationDefault(),
      projectId: 'project2-7a317',
    });
  }
}

const db = getFirestore();

async function deleteLoadTestComments() {
  console.log('부하 테스트 댓글 검색 중...');

  // "부하 테스트 댓글" 내용을 가진 댓글 조회
  const snapshot = await db.collection('comments')
    .where('content', '>=', '부하 테스트 댓글')
    .where('content', '<=', '부하 테스트 댓글\uf8ff')
    .get();

  // authorNickname이 "로드테스트"로 시작하는 댓글도 조회
  const snapshot2 = await db.collection('comments')
    .where('authorNickname', '>=', '로드테스트')
    .where('authorNickname', '<=', '로드테스트\uf8ff')
    .get();

  // 중복 제거
  const commentMap = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  snapshot.docs.forEach(doc => commentMap.set(doc.id, doc));
  snapshot2.docs.forEach(doc => commentMap.set(doc.id, doc));

  const comments = Array.from(commentMap.values());
  console.log(`삭제 대상 댓글: ${comments.length}개`);

  if (comments.length === 0) {
    console.log('삭제할 댓글이 없습니다.');
    return;
  }

  // postId별 삭제 수 카운트
  const postCommentCounts: Record<string, number> = {};

  // 배치 삭제 (500개씩)
  const batchSize = 500;
  for (let i = 0; i < comments.length; i += batchSize) {
    const batch = db.batch();
    const chunk = comments.slice(i, i + batchSize);

    for (const doc of chunk) {
      const data = doc.data();
      if (data?.postId) {
        postCommentCounts[data.postId] = (postCommentCounts[data.postId] || 0) + 1;
      }
      batch.delete(doc.ref);
    }

    await batch.commit();
    console.log(`${Math.min(i + batchSize, comments.length)}/${comments.length} 삭제 완료`);
  }

  // 게시글의 commentCount 감소
  console.log('게시글 댓글 수 업데이트 중...');
  for (const [postId, count] of Object.entries(postCommentCounts)) {
    try {
      await db.collection('posts').doc(postId).update({
        commentCount: FieldValue.increment(-count),
      });
      console.log(`게시글 ${postId}: 댓글 수 -${count}`);
    } catch (err) {
      console.error(`게시글 ${postId} 업데이트 실패:`, err);
    }
  }

  console.log(`완료! 총 ${comments.length}개 부하 테스트 댓글 삭제됨.`);
}

deleteLoadTestComments().catch(console.error);
