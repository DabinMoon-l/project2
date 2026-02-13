/**
 * quizResults 문서 생성 시 reviews를 비동기로 생성하는 트리거
 *
 * recordAttempt에서 reviews 배치 생성을 분리하여:
 * - recordAttempt 응답 시간 단축 (채점 + 결과 저장만 동기)
 * - reviews 생성은 백그라운드에서 처리
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const db = getFirestore();

export const generateReviewsOnResult = onDocumentCreated(
  {
    document: "quizResults/{resultId}",
    region: "asia-northeast3",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const result = snapshot.data();
    const resultId = event.params.resultId;

    // gradedOnServer가 true인 경우만 처리 (recordAttempt에서 생성된 결과)
    if (!result.gradedOnServer) return;

    // 이미 reviews가 생성된 경우 스킵
    if (result.reviewsGenerated) return;

    const { userId, quizId, questionScores } = result;
    if (!userId || !quizId || !questionScores) {
      console.warn(`reviews 생성 스킵 (데이터 부족): ${resultId}`);
      return;
    }

    // 퀴즈 문서 로드 (문제 상세 정보)
    const quizDoc = await db.doc(`quizzes/${quizId}`).get();
    if (!quizDoc.exists) {
      console.warn(`reviews 생성 스킵 (퀴즈 없음): ${quizId}`);
      return;
    }

    const quizData = quizDoc.data()!;
    const questions: any[] = quizData.questions || [];

    if (questions.length === 0) return;

    // reviews 배치 생성
    const batch = db.batch();
    let batchCount = 0;

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qId = q.id || `q${i}`;
      const qs = questionScores[qId];
      if (!qs) continue;

      let normalizedType = q.type || "multiple";
      if (normalizedType === "short") normalizedType = "short_answer";

      const reviewBase = {
        userId,
        quizId,
        quizTitle: quizData.title || "",
        questionId: qId,
        question: q.text || "",
        type: normalizedType,
        options: q.choices || [],
        correctAnswer: qs.correctAnswer,
        userAnswer: qs.userAnswer,
        explanation: q.explanation || "",
        isCorrect: qs.isCorrect,
        isBookmarked: false,
        reviewCount: 0,
        lastReviewedAt: null,
        courseId: quizData.courseId || null,
        quizUpdatedAt: quizData.updatedAt || quizData.createdAt || null,
        quizCreatorId: quizData.creatorId || null,
        image: q.image || null,
        chapterId: q.chapterId || null,
        chapterDetailId: q.chapterDetailId || null,
        choiceExplanations: q.choiceExplanations || null,
        imageUrl: q.imageUrl || null,
        createdAt: FieldValue.serverTimestamp(),
      };

      // solved 타입 저장
      batch.create(db.collection("reviews").doc(), {
        ...reviewBase,
        reviewType: "solved",
      });
      batchCount++;

      // wrong 타입 추가 저장 (오답만)
      if (!qs.isCorrect) {
        batch.create(db.collection("reviews").doc(), {
          ...reviewBase,
          reviewType: "wrong",
        });
        batchCount++;
      }

      // Firestore batch 한계 (500 operations)
      if (batchCount >= 490) {
        await batch.commit();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    // reviews 생성 완료 플래그
    await snapshot.ref.update({
      reviewsGenerated: true,
    });

    console.log(
      `reviews 비동기 생성 완료: resultId=${resultId}, ` +
      `userId=${userId}, quizId=${quizId}, reviews=${batchCount}건`
    );
  }
);
