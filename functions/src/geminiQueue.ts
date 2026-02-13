/**
 * Gemini AI 문제 생성 큐 시스템
 *
 * 동시 요청이 많을 때 순차적으로 처리하여 rate limit 방지
 * 사용자가 페이지를 떠나도 백그라운드에서 처리 완료
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";

// Gemini API 키
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// 분당 최대 처리 수 (Gemini 무료 티어: 15 RPM, 안전 마진 적용)
const MAX_REQUESTS_PER_MINUTE = 10;

// 사용자별 일일 한도
const DAILY_USER_LIMIT = 10;

// 큐 상태
type QueueStatus = "pending" | "processing" | "completed" | "failed";

interface QueueItem {
  id: string;
  userId: string;
  imageBase64: string;
  difficulty: "easy" | "medium" | "hard";
  status: QueueStatus;
  createdAt: Timestamp;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  result?: GeneratedQuestion[];
  error?: string;
  position?: number;
}

interface GeneratedQuestion {
  text: string;
  choices: string[];
  answer: number;
  explanation: string;
}

/**
 * 오늘 날짜 문자열 반환
 */
function getDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 사용자별 일일 사용량 조회
 */
async function getUserDailyUsage(userId: string): Promise<number> {
  const db = getFirestore();
  const today = getDateString();

  const usageDoc = await db
    .collection("geminiUsage")
    .doc("users")
    .collection(userId)
    .doc(today)
    .get();

  return usageDoc.exists ? (usageDoc.data()?.count || 0) : 0;
}

/**
 * 사용량 증가
 */
async function incrementUsage(userId: string): Promise<void> {
  const db = getFirestore();
  const today = getDateString();

  const userUsageRef = db
    .collection("geminiUsage")
    .doc("users")
    .collection(userId)
    .doc(today);

  await userUsageRef.set(
    {
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const totalUsageRef = db.collection("geminiUsage").doc(today);
  await totalUsageRef.set(
    {
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Gemini API 호출
 */
async function callGeminiApi(
  imageBase64: string,
  apiKey: string,
  difficulty: "easy" | "medium" | "hard"
): Promise<GeneratedQuestion[]> {
  const base64Data = imageBase64.includes(",")
    ? imageBase64.split(",")[1]
    : imageBase64;

  let mimeType = "image/jpeg";
  if (imageBase64.startsWith("data:image/png")) {
    mimeType = "image/png";
  } else if (imageBase64.startsWith("data:image/gif")) {
    mimeType = "image/gif";
  } else if (imageBase64.startsWith("data:image/webp")) {
    mimeType = "image/webp";
  }

  const difficultyKorean = {
    easy: "쉬움 (기본 개념 이해 확인)",
    medium: "보통 (응용 및 이해력 테스트)",
    hard: "어려움 (심화 분석 및 추론 필요)",
  };

  const prompt = `당신은 대학 교수입니다. 이 교재/강의자료 이미지를 분석하여 학생들의 학습을 돕기 위한 객관식 문제 5개를 만들어주세요.

난이도: ${difficultyKorean[difficulty]}

요구사항:
1. 이미지에 보이는 내용을 기반으로 문제를 만들어주세요
2. 각 문제는 4개의 선지를 가져야 합니다
3. 문제는 핵심 개념을 테스트해야 합니다
4. 해설은 왜 정답이 맞고 오답이 틀린지 설명해주세요
5. 한국어로 작성해주세요

반드시 아래 JSON 형식으로만 응답해주세요. 다른 텍스트는 포함하지 마세요:
{
  "questions": [
    {
      "text": "문제 내용",
      "choices": ["선지1", "선지2", "선지3", "선지4"],
      "answer": 0,
      "explanation": "해설 내용"
    }
  ]
}

answer는 0부터 시작하는 인덱스입니다 (0=첫 번째 선지).`;

  const requestBody = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 4096,
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API 오류:", response.status, errorText);

    if (response.status === 429) {
      throw new Error("RATE_LIMIT");
    }

    throw new Error(`Gemini API 오류: ${response.status}`);
  }

  const result = (await response.json()) as any;

  if (
    !result.candidates ||
    result.candidates.length === 0 ||
    !result.candidates[0].content
  ) {
    throw new Error("AI 응답을 받지 못했습니다.");
  }

  const textContent = result.candidates[0].content.parts
    .filter((p: any) => p.text)
    .map((p: any) => p.text)
    .join("");

  let jsonText = textContent;
  const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonText);

  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    throw new Error("questions 배열이 없습니다.");
  }

  const validQuestions: GeneratedQuestion[] = [];
  for (const q of parsed.questions) {
    if (
      q.text &&
      Array.isArray(q.choices) &&
      q.choices.length >= 2 &&
      typeof q.answer === "number" &&
      q.answer >= 0 &&
      q.answer < q.choices.length
    ) {
      validQuestions.push({
        text: q.text,
        choices: q.choices,
        answer: q.answer,
        explanation: q.explanation || "",
      });
    }
  }

  if (validQuestions.length === 0) {
    throw new Error("유효한 문제가 없습니다.");
  }

  return validQuestions;
}

/**
 * 큐에 요청 추가 (Callable Function)
 */
export const addToGeminiQueue = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { image, difficulty = "medium" } = request.data as {
      image: string;
      difficulty?: "easy" | "medium" | "hard";
    };

    if (!image) {
      throw new HttpsError("invalid-argument", "이미지 데이터가 필요합니다.");
    }

    // 사용량 확인
    const userUsage = await getUserDailyUsage(userId);
    if (userUsage >= DAILY_USER_LIMIT) {
      throw new HttpsError(
        "resource-exhausted",
        `오늘의 AI 문제 생성 횟수(${DAILY_USER_LIMIT}회)를 모두 사용했습니다.`
      );
    }

    const db = getFirestore();

    // 이미 대기 중인 요청이 있는지 확인
    const existingPending = await db
      .collection("geminiQueue")
      .where("userId", "==", userId)
      .where("status", "in", ["pending", "processing"])
      .limit(1)
      .get();

    if (!existingPending.empty) {
      const existing = existingPending.docs[0];
      return {
        queueId: existing.id,
        status: existing.data().status,
        position: await getQueuePosition(existing.id),
        message: "이미 대기 중인 요청이 있습니다.",
      };
    }

    // 큐에 추가
    const queueRef = await db.collection("geminiQueue").add({
      userId,
      imageBase64: image,
      difficulty,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    const position = await getQueuePosition(queueRef.id);

    console.log(`큐 추가: ${queueRef.id} (사용자: ${userId}, 대기 순서: ${position})`);

    return {
      queueId: queueRef.id,
      status: "pending",
      position,
      message: position === 1
        ? "요청이 접수되었습니다. 곧 처리됩니다."
        : `요청이 접수되었습니다. 대기 순서: ${position}번째`,
    };
  }
);

/**
 * 큐 상태 확인 (Callable Function)
 */
export const checkGeminiQueueStatus = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { queueId } = request.data as { queueId?: string };

    const db = getFirestore();

    // 특정 queueId가 있으면 해당 항목 확인
    if (queueId) {
      const queueDoc = await db.collection("geminiQueue").doc(queueId).get();

      if (!queueDoc.exists) {
        throw new HttpsError("not-found", "요청을 찾을 수 없습니다.");
      }

      const data = queueDoc.data()!;

      if (data.userId !== userId) {
        throw new HttpsError("permission-denied", "접근 권한이 없습니다.");
      }

      return {
        queueId: queueDoc.id,
        status: data.status,
        position: data.status === "pending" ? await getQueuePosition(queueId) : 0,
        result: data.result || null,
        error: data.error || null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        completedAt: data.completedAt?.toDate?.()?.toISOString() || null,
      };
    }

    // queueId가 없으면 사용자의 최근 요청 확인
    const userQueue = await db
      .collection("geminiQueue")
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (userQueue.empty) {
      return { status: "none", message: "대기 중인 요청이 없습니다." };
    }

    const doc = userQueue.docs[0];
    const data = doc.data();

    return {
      queueId: doc.id,
      status: data.status,
      position: data.status === "pending" ? await getQueuePosition(doc.id) : 0,
      result: data.result || null,
      error: data.error || null,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      completedAt: data.completedAt?.toDate?.()?.toISOString() || null,
    };
  }
);

/**
 * 완료된 큐 항목 확인 후 삭제 (결과 수령)
 */
export const claimGeminiQueueResult = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { queueId } = request.data as { queueId: string };

    if (!queueId) {
      throw new HttpsError("invalid-argument", "queueId가 필요합니다.");
    }

    const db = getFirestore();
    const queueRef = db.collection("geminiQueue").doc(queueId);
    const queueDoc = await queueRef.get();

    if (!queueDoc.exists) {
      throw new HttpsError("not-found", "요청을 찾을 수 없습니다.");
    }

    const data = queueDoc.data()!;

    if (data.userId !== userId) {
      throw new HttpsError("permission-denied", "접근 권한이 없습니다.");
    }

    if (data.status !== "completed") {
      throw new HttpsError("failed-precondition", "아직 처리가 완료되지 않았습니다.");
    }

    // 결과 반환 후 삭제
    const result = data.result;
    await queueRef.delete();

    return {
      success: true,
      questions: result,
    };
  }
);

/**
 * 대기 순서 계산
 */
async function getQueuePosition(queueId: string): Promise<number> {
  const db = getFirestore();

  const targetDoc = await db.collection("geminiQueue").doc(queueId).get();
  if (!targetDoc.exists) return 0;

  const targetCreatedAt = targetDoc.data()?.createdAt;
  if (!targetCreatedAt) return 1;

  const pendingBefore = await db
    .collection("geminiQueue")
    .where("status", "==", "pending")
    .where("createdAt", "<", targetCreatedAt)
    .get();

  return pendingBefore.size + 1;
}

/**
 * 큐 처리 스케줄러 (매분 실행)
 */
export const processGeminiQueue = onSchedule(
  {
    schedule: "every 1 minutes",
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
    secrets: [GEMINI_API_KEY],
  },
  async () => {
    const db = getFirestore();
    const apiKey = GEMINI_API_KEY.value();

    if (!apiKey) {
      console.error("GEMINI_API_KEY가 설정되지 않았습니다.");
      return;
    }

    // 대기 중인 요청 가져오기 (최대 MAX_REQUESTS_PER_MINUTE개)
    const pendingQueue = await db
      .collection("geminiQueue")
      .where("status", "==", "pending")
      .orderBy("createdAt", "asc")
      .limit(MAX_REQUESTS_PER_MINUTE)
      .get();

    if (pendingQueue.empty) {
      console.log("처리할 대기 항목 없음");
      return;
    }

    console.log(`큐 처리 시작: ${pendingQueue.size}개 항목`);

    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;

    for (const doc of pendingQueue.docs) {
      const data = doc.data() as QueueItem;
      const queueRef = db.collection("geminiQueue").doc(doc.id);

      try {
        // 상태를 processing으로 변경
        await queueRef.update({
          status: "processing",
          startedAt: FieldValue.serverTimestamp(),
        });

        console.log(`처리 중: ${doc.id} (사용자: ${data.userId})`);

        // Gemini API 호출
        const questions = await callGeminiApi(
          data.imageBase64,
          apiKey,
          data.difficulty
        );

        // 사용량 증가
        await incrementUsage(data.userId);

        // 완료 상태로 변경
        await queueRef.update({
          status: "completed",
          result: questions,
          completedAt: FieldValue.serverTimestamp(),
          // 이미지 데이터 삭제 (저장 공간 절약)
          imageBase64: FieldValue.delete(),
        });

        console.log(`처리 완료: ${doc.id} (문제 ${questions.length}개 생성)`);
        successCount++;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "알 수 없는 오류";

        // Rate limit 에러면 다시 pending으로
        if (errorMessage === "RATE_LIMIT") {
          console.log(`Rate limit 발생, 재시도 대기: ${doc.id}`);
          await queueRef.update({
            status: "pending",
            startedAt: FieldValue.delete(),
          });
          // Rate limit 발생 시 나머지 처리 중단
          break;
        }

        // 다른 에러는 실패 처리
        await queueRef.update({
          status: "failed",
          error: errorMessage,
          completedAt: FieldValue.serverTimestamp(),
          imageBase64: FieldValue.delete(),
        });

        console.error(`처리 실패: ${doc.id}`, errorMessage);
        failedCount++;
      }

      processedCount++;

      // 요청 간 간격 (rate limit 방지)
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log(
      `큐 처리 완료: 총 ${processedCount}개 (성공: ${successCount}, 실패: ${failedCount})`
    );
  }
);

/**
 * 오래된 큐 항목 정리 (하루 지난 항목 삭제)
 */
export const cleanupGeminiQueue = onSchedule(
  {
    schedule: "every 6 hours",
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
  },
  async () => {
    const db = getFirestore();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const oldItems = await db
      .collection("geminiQueue")
      .where("createdAt", "<", Timestamp.fromDate(oneDayAgo))
      .get();

    if (oldItems.empty) {
      console.log("정리할 오래된 큐 항목 없음");
      return;
    }

    const batch = db.batch();
    oldItems.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`오래된 큐 항목 ${oldItems.size}개 삭제`);
  }
);
