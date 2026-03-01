/**
 * 철권퀴즈 문제 풀 사전 생성 시스템
 *
 * - 야간 스케줄(매일 새벽 3시)로 문제를 미리 Firestore에 저장
 * - 배틀 시 풀에서 즉시 뽑아 사용 (Gemini 대기 제거)
 * - 같은 유저가 연속 배틀에서 동일 문제를 보지 않도록 seenQuestions 관리
 *
 * Firestore 구조:
 *   tekkenQuestionPool/{courseId}                    — 메타 문서
 *   tekkenQuestionPool/{courseId}/questions/{qId}    — 개별 문제
 *   tekkenQuestionPool/{courseId}/seenQuestions/{id}  — 유저별 본 문제 기록
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import {
  generateBattleQuestions,
  getTekkenChapters,
  COURSE_NAMES,
  type GeneratedQuestion,
} from "./tekkenBattle";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// 과목 목록
const ALL_COURSES = Object.keys(COURSE_NAMES);

// 풀 목표 크기
const TARGET_POOL_SIZE = 60;
// 문제 유효 기간 (7일)
const QUESTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// 배치당 문제 수
const BATCH_SIZE = 10;
// 배치 간 대기 (3초)
const BATCH_DELAY_MS = 3000;

/**
 * 문제 풀 보충
 * - 7일 지난 문제 삭제
 * - 현재 풀 크기 확인 → 부족분만큼 Gemini 호출
 */
export async function replenishQuestionPool(
  courseId: string,
  apiKey: string,
  targetSize: number = TARGET_POOL_SIZE
): Promise<{ added: number; deleted: number }> {
  const db = getFirestore();
  const poolRef = db.collection("tekkenQuestionPool").doc(courseId);
  const questionsRef = poolRef.collection("questions");

  // 1. 7일 지난 문제 삭제
  const expiredThreshold = Timestamp.fromMillis(Date.now() - QUESTION_MAX_AGE_MS);
  const expiredSnap = await questionsRef
    .where("generatedAt", "<", expiredThreshold)
    .get();

  let deleted = 0;
  if (!expiredSnap.empty) {
    const batch = db.batch();
    for (const doc of expiredSnap.docs) {
      batch.delete(doc.ref);
      deleted++;
    }
    await batch.commit();
  }

  // 2. 현재 풀 크기 확인
  const currentSnap = await questionsRef.count().get();
  const currentCount = currentSnap.data().count;
  const needed = targetSize - currentCount;

  if (needed <= 0) {
    // 메타 문서 업데이트
    await poolRef.set({
      totalQuestions: currentCount,
      lastRefreshedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { added: 0, deleted };
  }

  // 3. 챕터 조회
  const chapters = await getTekkenChapters(courseId);

  // 4. 부족분만큼 배치 생성
  let added = 0;
  const batchCount = Math.ceil(needed / BATCH_SIZE);

  for (let i = 0; i < batchCount; i++) {
    const remaining = needed - added;
    const count = Math.min(remaining, BATCH_SIZE);

    try {
      const questions = await generateBattleQuestions(courseId, apiKey, count, chapters);

      if (questions.length > 0) {
        const writeBatch = db.batch();
        const batchId = `${Date.now()}_${i}`;

        for (const q of questions) {
          const docRef = questionsRef.doc();
          writeBatch.set(docRef, {
            text: q.text,
            type: q.type,
            choices: q.choices,
            correctAnswer: q.correctAnswer,
            chapters,
            generatedAt: FieldValue.serverTimestamp(),
            batchId,
          });
          added++;
        }
        await writeBatch.commit();
      }
    } catch (err) {
      console.error(`배치 ${i + 1}/${batchCount} 생성 실패 (${courseId}):`, err);
    }

    // 다음 배치 전 대기 (마지막 배치 제외)
    if (i < batchCount - 1) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  // 5. 메타 문서 업데이트
  await poolRef.set({
    totalQuestions: currentCount + added,
    lastRefreshedAt: FieldValue.serverTimestamp(),
    chapters,
  }, { merge: true });

  console.log(`문제 풀 보충 완료 (${courseId}): 추가 ${added}개, 삭제 ${deleted}개, 총 ${currentCount + added}개`);
  return { added, deleted };
}

/**
 * 풀에서 문제 추출 (중복 방지)
 *
 * - 풀 전체 조회 (60문서 이하이므로 전체 로드)
 * - 양쪽 플레이어의 최근 24시간 seenQuestions 제외
 * - 부족 시 null 반환 (호출자가 Gemini 폴백)
 */
export async function drawQuestionsFromPool(
  courseId: string,
  playerIds: string[],
  count: number = 10
): Promise<GeneratedQuestion[] | null> {
  const db = getFirestore();
  const poolRef = db.collection("tekkenQuestionPool").doc(courseId);
  const questionsRef = poolRef.collection("questions");
  const seenRef = poolRef.collection("seenQuestions");

  // 1. 풀 전체 조회
  const poolSnap = await questionsRef.get();
  if (poolSnap.empty) return null;

  // 2. 양쪽 플레이어의 최근 24시간 seenQuestions 조회
  const oneDayAgo = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
  const seenQuestionIds = new Set<string>();

  for (const pid of playerIds) {
    const seenSnap = await seenRef
      .where("userId", "==", pid)
      .where("seenAt", ">", oneDayAgo)
      .get();

    for (const doc of seenSnap.docs) {
      const ids = doc.data().questionIds as string[] | undefined;
      if (ids) {
        ids.forEach(id => seenQuestionIds.add(id));
      }
    }
  }

  // 3. 미시청 문제 필터링
  const available = poolSnap.docs.filter(doc => !seenQuestionIds.has(doc.id));

  if (available.length < count) {
    // 한쪽만 본 문제도 허용 (완전 미시청 부족 시)
    // 이미 양쪽 union으로 제외했으므로, 부족하면 null 반환
    if (available.length < 5) {
      return null;
    }
  }

  // 4. 셔플 후 count개 선택
  const shuffled = available.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  // 5. seenQuestions 기록
  const selectedIds = selected.map(doc => doc.id);
  const battleId = `battle_${Date.now()}`;

  const writeBatch = db.batch();
  for (const pid of playerIds) {
    const seenDocRef = seenRef.doc();
    writeBatch.set(seenDocRef, {
      userId: pid,
      questionIds: selectedIds,
      battleId,
      seenAt: FieldValue.serverTimestamp(),
    });
  }
  await writeBatch.commit();

  // 6. 문제 데이터 반환
  return selected.map(doc => {
    const data = doc.data();
    return {
      text: data.text,
      type: data.type,
      choices: data.choices,
      correctAnswer: data.correctAnswer,
    };
  });
}

/**
 * 스케줄 CF: 매일 새벽 3시 KST 문제 풀 보충
 */
export const tekkenPoolRefillScheduled = onSchedule(
  {
    schedule: "0 3 * * *", // 매일 03:00
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 540, // 9분 (3개 과목 순차 처리)
    memory: "512MiB",
  },
  async () => {
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      console.error("GEMINI_API_KEY가 설정되지 않았습니다.");
      return;
    }

    for (const courseId of ALL_COURSES) {
      try {
        const result = await replenishQuestionPool(courseId, apiKey);
        console.log(`[스케줄] ${courseId}: 추가 ${result.added}개, 삭제 ${result.deleted}개`);
      } catch (err) {
        console.error(`[스케줄] ${courseId} 풀 보충 실패:`, err);
      }

      // 과목 간 딜레이
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
);

/**
 * Callable CF: 교수 수동 풀 초기화/재생성
 * 챕터 변경 시 기존 풀 전체 삭제 + 새 챕터로 재생성
 */
export const tekkenPoolRefill = onCall(
  {
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 300, // 5분
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    // 교수 권한 확인
    const db = getFirestore();
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 실행 가능합니다.");
    }

    const { courseId } = request.data as { courseId: string };
    if (!courseId || !ALL_COURSES.includes(courseId)) {
      throw new HttpsError("invalid-argument", "유효한 courseId가 필요합니다.");
    }

    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError("internal", "GEMINI_API_KEY가 설정되지 않았습니다.");
    }

    // 기존 풀 전체 삭제
    const poolRef = db.collection("tekkenQuestionPool").doc(courseId);
    const questionsRef = poolRef.collection("questions");
    const existingSnap = await questionsRef.get();

    if (!existingSnap.empty) {
      // 500개씩 batch 삭제
      const chunks: FirebaseFirestore.DocumentReference[] = [];
      existingSnap.docs.forEach(doc => chunks.push(doc.ref));

      for (let i = 0; i < chunks.length; i += 500) {
        const batch = db.batch();
        chunks.slice(i, i + 500).forEach(ref => batch.delete(ref));
        await batch.commit();
      }
    }

    // seenQuestions도 전체 삭제 (챕터 변경으로 문제가 완전히 바뀌므로)
    const seenRef = poolRef.collection("seenQuestions");
    const seenSnap = await seenRef.get();
    if (!seenSnap.empty) {
      const batch = db.batch();
      seenSnap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    // 새로 채우기
    const result = await replenishQuestionPool(courseId, apiKey);

    console.log(`[수동] ${courseId} 풀 초기화: 기존 ${existingSnap.size}개 삭제, 새로 ${result.added}개 생성`);

    return {
      success: true,
      deleted: existingSnap.size,
      added: result.added,
    };
  }
);
