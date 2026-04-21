/**
 * quizResults 문서 생성 시 reviews를 비동기로 생성하는 트리거
 *
 * recordAttempt에서 reviews 배치 생성을 분리하여:
 * - recordAttempt 응답 시간 단축 (채점 + 결과 저장만 동기)
 * - reviews 생성은 백그라운드에서 처리
 *
 * 재시도(retake) 시 기존 reviews를 삭제하고 새로 생성
 * (중복 review 문서 방지)
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  DEFAULT_ORG_ID_SECRET,
  SUPABASE_URL_SECRET,
  SUPABASE_SERVICE_ROLE_SECRET,
  supabaseDualDeleteReviewsByQuiz,
  supabaseDualBatchUpsertReviews,
  type SupabaseReviewInput,
} from "./utils/supabase";

/** Firestore 퀴즈 문제 필드 (reviews 생성에 필요한 부분) */
interface QuizQuestionData {
  id?: string;
  type?: string;
  text?: string;
  choices?: string[];
  explanation?: string;
  image?: string;
  chapterId?: string;
  chapterDetailId?: string;
  choiceExplanations?: string[];
  imageUrl?: string;
  combinedGroupId?: string;
  combinedIndex?: number;
  combinedTotal?: number;
  passage?: string;
  passageType?: string;
  passageImage?: string;
  koreanAbcItems?: unknown;
  passageMixedExamples?: unknown;
  commonQuestion?: string;
  combinedMainText?: string;
  bogi?: unknown;
  mixedExamples?: unknown;
}

const db = getFirestore();

interface QuestionScoreEntry {
  correctAnswer?: unknown;
  userAnswer?: unknown;
  isCorrect?: boolean;
}

/** reviewsGenerator 전용: Firestore review 1건 → Supabase 입력 변환 */
function toSupabaseReviewInput(
  firestoreId: string,
  userId: string,
  firestoreQuizId: string,
  questionId: string,
  q: QuizQuestionData,
  qs: QuestionScoreEntry,
  quizData: FirebaseFirestore.DocumentData,
  reviewType: "solved" | "wrong",
  bookmarkedQuestionIds: Set<string>,
  preserved: { count: number; lastAt: FirebaseFirestore.Timestamp | null } | undefined,
): SupabaseReviewInput {
  let normalizedType = q.type || "multiple";
  if (normalizedType === "short") normalizedType = "short_answer";

  const questionData: Record<string, unknown> = {
    question: q.text || "",
    type: normalizedType,
    options: q.choices || [],
    correctAnswer: qs.correctAnswer,
    userAnswer: qs.userAnswer,
    explanation: q.explanation || "",
    choiceExplanations: q.choiceExplanations || null,
    image: q.image || null,
    imageUrl: q.imageUrl || null,
    combinedGroupId: q.combinedGroupId ?? null,
    combinedIndex: q.combinedIndex ?? null,
    combinedTotal: q.combinedTotal ?? null,
    passage: q.passage ?? null,
    passageType: q.passageType ?? null,
    passageImage: q.passageImage ?? null,
    koreanAbcItems: q.koreanAbcItems ?? null,
    passageMixedExamples: q.passageMixedExamples ?? null,
    commonQuestion: q.commonQuestion ?? null,
    combinedMainText: q.combinedMainText ?? null,
    bogi: q.bogi ?? null,
    mixedExamples: q.mixedExamples ?? null,
  };

  return {
    firestoreId,
    userId,
    firestoreQuizId,
    courseCode: (quizData.courseId as string) || null,
    questionId,
    chapterId: q.chapterId ?? null,
    chapterDetailId: q.chapterDetailId ?? null,
    reviewType,
    isCorrect: qs.isCorrect ?? null,
    isBookmarked: bookmarkedQuestionIds.has(questionId),
    reviewCount: preserved?.count ?? 0,
    lastReviewedAt: preserved?.lastAt ? preserved.lastAt.toDate() : null,
    questionData,
    metadata: {
      quizTitle: quizData.title || "",
      quizCreatorId: quizData.creatorId || null,
      quizUpdatedAt: quizData.updatedAt?.toDate?.()?.toISOString?.() || null,
    },
  };
}

export const generateReviewsOnResult = onDocumentCreated(
  {
    document: "quizResults/{resultId}",
    region: "asia-northeast3",
    memory: "512MiB",
    timeoutSeconds: 120,
    secrets: [
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_SECRET,
      DEFAULT_ORG_ID_SECRET,
    ],
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
    const questions: QuizQuestionData[] = quizData.questions || [];

    if (questions.length === 0) return;

    // ── 기존 reviews 삭제 (재시도 시 중복 방지) ──
    // 같은 userId + quizId의 기존 reviews를 삭제한 뒤 새로 생성
    let restoredBookmarkedQuestionIds: Set<string> | null = null;
    let restoredPreservedReviewCounts: Map<string, { count: number; lastAt: FirebaseFirestore.Timestamp | null }> | null = null;
    const existingReviews = await db.collection("reviews")
      .where("userId", "==", userId)
      .where("quizId", "==", quizId)
      .get();

    if (!existingReviews.empty) {
      // 기존 reviews의 isBookmarked + reviewCount 보존 (복습 기록 유지)
      const bookmarkedQuestionIds = new Set<string>();
      const preservedReviewCounts = new Map<string, { count: number; lastAt: FirebaseFirestore.Timestamp | null }>();
      existingReviews.docs.forEach(d => {
        const data = d.data();
        if (data.isBookmarked) {
          bookmarkedQuestionIds.add(data.questionId);
        }
        // 능동적 복습 기록 보존 (퀴즈 재시도로 리셋되지 않도록)
        const existing = preservedReviewCounts.get(data.questionId);
        const rc = data.reviewCount || 0;
        if (!existing || rc > existing.count) {
          preservedReviewCounts.set(data.questionId, {
            count: rc,
            lastAt: data.lastReviewedAt || null,
          });
        }
      });

      // 기존 reviews 삭제
      const deleteBatch = db.batch();
      let deleteCount = 0;
      for (const d of existingReviews.docs) {
        deleteBatch.delete(d.ref);
        deleteCount++;
        if (deleteCount >= 490) {
          await deleteBatch.commit();
          deleteCount = 0;
        }
      }
      if (deleteCount > 0) {
        await deleteBatch.commit();
      }

      // Supabase 듀얼 라이트: 같은 user_id + quiz_id reviews 전체 삭제
      await supabaseDualDeleteReviewsByQuiz(userId, quizId);

      // 보존된 데이터를 아래에서 사용 (클로저 캡처)
      restoredBookmarkedQuestionIds = bookmarkedQuestionIds;
      restoredPreservedReviewCounts = preservedReviewCounts;
    }

    const bookmarkedQuestionIds: Set<string> =
      restoredBookmarkedQuestionIds || new Set<string>();
    const preservedReviewCounts: Map<string, { count: number; lastAt: FirebaseFirestore.Timestamp | null }> =
      restoredPreservedReviewCounts || new Map();

    // reviews 배치 생성
    const batch = db.batch();
    let batchCount = 0;
    const supabaseInputs: SupabaseReviewInput[] = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qId = q.id || `q${i}`;
      const qs = questionScores[qId];
      if (!qs) continue;

      let normalizedType = q.type || "multiple";
      if (normalizedType === "short") normalizedType = "short_answer";

      // 기존 복습 기록 복원 (퀴즈 재시도 시 리셋 방지)
      const preserved = preservedReviewCounts.get(qId);

      const reviewBase: Record<string, unknown> = {
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
        isBookmarked: bookmarkedQuestionIds.has(qId),
        reviewCount: preserved?.count ?? 0,
        lastReviewedAt: preserved?.lastAt ?? null,
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

      // 결합형 문제 필드 추가
      if (q.combinedGroupId) {
        reviewBase.combinedGroupId = q.combinedGroupId;
      }
      if (q.combinedIndex !== undefined) {
        reviewBase.combinedIndex = q.combinedIndex;
      }
      if (q.combinedTotal !== undefined) {
        reviewBase.combinedTotal = q.combinedTotal;
      }
      if (q.passage) {
        reviewBase.passage = q.passage;
      }
      if (q.passageType) {
        reviewBase.passageType = q.passageType;
      }
      if (q.passageImage) {
        reviewBase.passageImage = q.passageImage;
      }
      if (q.koreanAbcItems) {
        reviewBase.koreanAbcItems = q.koreanAbcItems;
      }
      if (q.passageMixedExamples) {
        reviewBase.passageMixedExamples = q.passageMixedExamples;
      }
      if (q.commonQuestion) {
        reviewBase.commonQuestion = q.commonQuestion;
      }
      if (q.combinedMainText) {
        reviewBase.combinedMainText = q.combinedMainText;
      }
      if (q.bogi) {
        reviewBase.bogi = q.bogi;
      }
      if (q.mixedExamples) {
        reviewBase.mixedExamples = q.mixedExamples;
      }

      // solved 타입 저장
      const solvedRef = db.collection("reviews").doc();
      batch.create(solvedRef, {
        ...reviewBase,
        reviewType: "solved",
      });
      batchCount++;
      supabaseInputs.push(
        toSupabaseReviewInput(solvedRef.id, userId, quizId, qId, q, qs, quizData, "solved", bookmarkedQuestionIds, preserved),
      );

      // wrong 타입 추가 저장 (오답만)
      if (!qs.isCorrect) {
        const wrongRef = db.collection("reviews").doc();
        batch.create(wrongRef, {
          ...reviewBase,
          reviewType: "wrong",
        });
        batchCount++;
        supabaseInputs.push(
          toSupabaseReviewInput(wrongRef.id, userId, quizId, qId, q, qs, quizData, "wrong", bookmarkedQuestionIds, preserved),
        );
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

    // Supabase 듀얼 라이트: reviews 배치 upsert
    if (supabaseInputs.length > 0) {
      await supabaseDualBatchUpsertReviews(supabaseInputs);
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
