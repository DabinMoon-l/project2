import { getFirestore, FieldValue } from "firebase-admin/firestore";

const NUM_SHARDS = 10;

/**
 * 분산 카운터 증가
 * 같은 문서에 동시 write가 몰리는 것을 방지하기 위해
 * N개 shard에 랜덤 분산하여 increment
 *
 * @param path - 카운터 상위 경로 (예: quiz_agg/{quizId})
 * @param fields - 증가시킬 필드들 (예: { count: 1, scoreSum: 85 })
 */
export async function incrementShard(
  path: string,
  fields: Record<string, number>
): Promise<void> {
  const db = getFirestore();
  const shardId = Math.floor(Math.random() * NUM_SHARDS);
  const shardRef = db.doc(`${path}/shards/${shardId}`);

  const updates: Record<string, FirebaseFirestore.FieldValue> = {};
  for (const [key, val] of Object.entries(fields)) {
    updates[key] = FieldValue.increment(val);
  }
  updates.updatedAt = FieldValue.serverTimestamp();

  await shardRef.set(updates, { merge: true });
}

/**
 * 분산 카운터 합산 조회
 * 모든 shard를 읽어 합산 반환
 *
 * @param path - 카운터 상위 경로
 * @returns 합산된 count, scoreSum
 */
export async function getShardedTotal(
  path: string
): Promise<{ count: number; scoreSum: number }> {
  const db = getFirestore();
  const shardsSnap = await db.collection(`${path}/shards`).get();

  let count = 0;
  let scoreSum = 0;
  shardsSnap.forEach((doc) => {
    const data = doc.data();
    count += data.count || 0;
    scoreSum += data.scoreSum || 0;
  });

  return { count, scoreSum };
}
