/**
 * initCreatorStats
 *
 * 서재 퀴즈를 공개로 전환할 때 호출.
 * 출제자 본인의 풀이 기록을 분산 카운터 + quiz_completions에 반영하여
 * 참여자 수 / 평균 점수에 출제자 점수가 포함되도록 함.
 *
 * Write:
 * - quiz_agg/{quizId}/shards/{N}: 1 write (분산 카운터 초기화)
 * - quiz_completions/{quizId}_{userId}: 1 write
 * - quizzes/{quizId}: 1 write (participantCount, averageScore)
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { incrementShard } from "./utils/shardedCounter";

export const initCreatorStats = onCall(
  { region: "asia-northeast3", memory: "256MiB" },
  async (request) => {
    const userId = request.auth?.uid;
    if (!userId) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { quizId } = request.data as { quizId: string };
    if (!quizId) {
      throw new HttpsError("invalid-argument", "quizId가 필요합니다.");
    }

    const db = getFirestore();

    // 퀴즈 문서 확인
    const quizDoc = await db.doc(`quizzes/${quizId}`).get();
    if (!quizDoc.exists) {
      throw new HttpsError("not-found", "퀴즈를 찾을 수 없습니다.");
    }

    const quizData = quizDoc.data()!;

    // 출제자 확인
    if (quizData.creatorId !== userId) {
      throw new HttpsError("permission-denied", "본인이 만든 퀴즈만 가능합니다.");
    }

    // 출제자 점수 가져오기
    const score = quizData.userScores?.[userId] ?? quizData.score ?? 0;
    const correctCount = quizData.correctCount ?? 0;
    const totalCount = quizData.totalQuestions ?? quizData.questions?.length ?? 0;

    // 이미 quiz_completions이 있으면 중복 방지
    const completionDocId = `${quizId}_${userId}`;
    const existingCompletion = await db.doc(`quiz_completions/${completionDocId}`).get();
    if (existingCompletion.exists) {
      return;
    }

    // 분산 카운터 초기화 (출제자 1명 + 점수)
    await incrementShard(`quiz_agg/${quizId}`, { count: 1, scoreSum: score });

    // quiz_completions 생성 (재풀이 시 중복 카운트 방지)
    await db.doc(`quiz_completions/${completionDocId}`).set({
      quizId,
      userId,
      courseId: quizData.courseId || null,
      score,
      correctCount,
      totalCount,
      attemptNo: 1,
      completedAt: FieldValue.serverTimestamp(),
    });

    // quizzes 문서 통계 업데이트
    await db.doc(`quizzes/${quizId}`).update({
      participantCount: 1,
      averageScore: score,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
);
