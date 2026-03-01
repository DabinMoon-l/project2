/**
 * 퀴즈 답안 인덱싱 마이그레이션 (1-indexed → 0-indexed)
 *
 * 수동 퀴즈(type: midterm/final/past/professor)의 answer 필드를
 * 1-indexed에서 0-indexed로 변환.
 * AI 퀴즈(originalType: 'professor-ai', type: 'professor-ai')는 이미 0-indexed이므로 스킵.
 *
 * 사용법: Firebase Console 또는 클라이언트에서 Callable 호출
 * 교수 계정만 실행 가능
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

// 수동 퀴즈 타입 (AI가 아닌 것)
const MANUAL_QUIZ_TYPES = ["midterm", "final", "past", "professor"];

export const migrateQuizAnswersTo0Indexed = onCall(
  {
    region: "asia-northeast3",
    timeoutSeconds: 300,
    memory: "512MiB",
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

    // 수동 퀴즈 타입별로 쿼리
    for (const quizType of MANUAL_QUIZ_TYPES) {
      const quizzes = await db
        .collection("quizzes")
        .where("type", "==", quizType)
        .get();

      for (const quizDoc of quizzes.docs) {
        const data = quizDoc.data();

        // AI 퀴즈면 스킵 (publishQuiz로 타입이 변경된 경우)
        if (data.originalType === "professor-ai") {
          skippedCount++;
          continue;
        }

        const questions = data.questions;
        if (!Array.isArray(questions) || questions.length === 0) {
          skippedCount++;
          continue;
        }

        let changed = false;
        const updatedQuestions = questions.map((q: any) => {
          const updated = { ...q };

          if (q.type === "multiple" || (!q.type && q.choices)) {
            // 객관식: 단일 정답
            if (typeof q.answer === "number" && q.answer >= 1) {
              updated.answer = q.answer - 1;
              changed = true;
            }
            // 객관식: 복수 정답 (comma-separated string)
            else if (typeof q.answer === "string" && q.answer.includes(",")) {
              const indices = q.answer.split(",").map((s: string) => {
                const n = parseInt(s.trim(), 10);
                return isNaN(n) ? s.trim() : n - 1;
              });
              updated.answer = indices;
              changed = true;
            }
            // 객관식: 복수 정답 (이미 배열, 1-indexed)
            else if (Array.isArray(q.answer) && q.answer.every((a: any) => typeof a === "number" && a >= 1)) {
              updated.answer = q.answer.map((a: number) => a - 1);
              changed = true;
            }
          }
          // OX는 0/1 그대로 유지 (변환 불필요)

          // 결합형 하위 문제도 동일 처리
          if (Array.isArray(q.subQuestions)) {
            updated.subQuestions = q.subQuestions.map((sq: any) => {
              const updatedSq = { ...sq };
              if (sq.type === "multiple" || (!sq.type && sq.choices)) {
                if (typeof sq.answer === "number" && sq.answer >= 1) {
                  updatedSq.answer = sq.answer - 1;
                  changed = true;
                } else if (typeof sq.answer === "string" && sq.answer.includes(",")) {
                  const indices = sq.answer.split(",").map((s: string) => {
                    const n = parseInt(s.trim(), 10);
                    return isNaN(n) ? s.trim() : n - 1;
                  });
                  updatedSq.answer = indices;
                  changed = true;
                } else if (Array.isArray(sq.answer) && sq.answer.every((a: any) => typeof a === "number" && a >= 1)) {
                  updatedSq.answer = sq.answer.map((a: number) => a - 1);
                  changed = true;
                }
              }
              return updatedSq;
            });
          }

          return updated;
        });

        if (changed) {
          try {
            await quizDoc.ref.update({ questions: updatedQuestions });
            migratedCount++;
          } catch (err) {
            console.error(`마이그레이션 실패: ${quizDoc.id}`, err);
            errorCount++;
          }
        } else {
          skippedCount++;
        }
      }
    }

    const result = {
      migrated: migratedCount,
      skipped: skippedCount,
      errors: errorCount,
    };

    console.log(`퀴즈 답안 마이그레이션 완료:`, result);
    return result;
  }
);
