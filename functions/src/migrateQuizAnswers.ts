/**
 * 퀴즈 답안 인덱싱 마이그레이션 (1-indexed → 0-indexed)
 *
 * 모든 퀴즈의 객관식 answer를 스캔하여 1-indexed인 것만 0-indexed로 변환.
 * 판별 기준: answer >= choiceCount → 1-indexed (0-indexed 범위는 0 ~ choiceCount-1)
 *
 * 사용법: Firebase Console 또는 클라이언트에서 Callable 호출
 * 교수 계정만 실행 가능
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import {
  SUPABASE_URL_SECRET,
  SUPABASE_SERVICE_ROLE_SECRET,
  DEFAULT_ORG_ID_SECRET,
  supabaseDualUpdateQuizPartial,
} from "./utils/supabase";

/**
 * 객관식 answer가 1-indexed인지 판별하고 수정
 * choiceCount 이상이면 1-indexed → -1로 변환
 */
function fixAnswerIfNeeded(
  answer: unknown,
  choiceCount: number
): { value: unknown; changed: boolean } {
  if (typeof answer === "number") {
    if (answer >= choiceCount) {
      return { value: answer - 1, changed: true };
    }
    return { value: answer, changed: false };
  }
  if (Array.isArray(answer)) {
    const anyOver = (answer as unknown[]).some(
      (a) => typeof a === "number" && a >= choiceCount
    );
    if (anyOver) {
      return {
        value: (answer as unknown[]).map((a) => (typeof a === "number" && a >= choiceCount ? a - 1 : a)),
        changed: true,
      };
    }
    return { value: answer, changed: false };
  }
  return { value: answer, changed: false };
}

export const migrateQuizAnswersTo0Indexed = onCall(
  {
    region: "asia-northeast3",
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_SECRET,
      DEFAULT_ORG_ID_SECRET,
    ],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const db = getFirestore();

    // 교수 확인
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수 계정만 실행할 수 있습니다.");
    }

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let fixedQuestionCount = 0;

    // 전체 퀴즈 스캔
    const allQuizzes = await db.collection("quizzes").get();

    for (const quizDoc of allQuizzes.docs) {
      const data = quizDoc.data();
      const questions = data.questions;
      if (!Array.isArray(questions) || questions.length === 0) {
        skippedCount++;
        continue;
      }

      let changed = false;
      const updatedQuestions = questions.map((q: Record<string, unknown>) => {
        const updated = { ...q };
        const choiceCount = (Array.isArray(q.choices) ? q.choices.length : 0) || 4;

        // 객관식 answer 수정
        if (q.type === "multiple") {
          const result = fixAnswerIfNeeded(q.answer, choiceCount);
          if (result.changed) {
            updated.answer = result.value;
            changed = true;
            fixedQuestionCount++;
          }
        }

        return updated;
      });

      if (changed) {
        try {
          await quizDoc.ref.update({ questions: updatedQuestions });
          // Supabase dual-write: questions jsonb 만 교체 (onQuizSync 트리거로도 동기화되지만, 즉시 반영)
          supabaseDualUpdateQuizPartial(quizDoc.id, {
            questions: updatedQuestions,
            updated_at: new Date().toISOString(),
          }).catch(() => {});
          migratedCount++;
        } catch (err) {
          console.error(`마이그레이션 실패: ${quizDoc.id}`, err);
          errorCount++;
        }
      } else {
        skippedCount++;
      }
    }

    const result = {
      migrated: migratedCount,
      skipped: skippedCount,
      errors: errorCount,
      fixedQuestions: fixedQuestionCount,
    };

    console.log("퀴즈 답안 마이그레이션 완료:", result);
    return result;
  }
);
