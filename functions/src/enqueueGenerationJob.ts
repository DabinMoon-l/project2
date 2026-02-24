/**
 * AI 문제 생성 Job 등록 (Callable Function)
 *
 * 클라이언트에서 호출하면:
 * 1. Rate limit 검사 (분당 3회, 일 15회)
 * 2. dedupeKey로 중복 요청 방지
 * 3. jobs/{jobId} 문서 생성 (status: QUEUED)
 * 4. jobId 반환 → 클라이언트가 polling
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as crypto from "crypto";
import { checkRateLimitV2 } from "./utils/rateLimitV2";
import { buildMaterialFingerprint } from "./utils/materialCache";

// Job 상태
export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

// Job 문서 타입
export interface GenerationJob {
  jobId: string;
  userId: string;
  status: JobStatus;

  // 입력 데이터
  text: string;
  images: string[];     // Base64 이미지 배열
  difficulty: "easy" | "medium" | "hard";
  questionCount: number;
  courseId: string;
  courseName: string;
  courseCustomized: boolean; // 과목 맞춤형 (false면 스타일/범위/포커스 제외)

  // 교수 서재 옵션
  sliderWeights?: {
    style: number;       // 0-100
    scope: number;       // 0-100
    focusGuide: number;  // 0-100
    difficulty: number;  // 0-100
    questionCount: number; // 5-20
  };
  professorPrompt?: string;

  // 중복 방지
  dedupeKey: string;

  // 중간 결과 캐시 키 (사용자/옵션 무관, 학습 자료 기반)
  materialFingerprint: string;

  // 결과 (COMPLETED 시)
  result?: {
    questions: any[];
    meta?: any;
  };

  // 에러 (FAILED 시)
  error?: string;

  // 타임스탬프
  createdAt: FieldValue | Timestamp;
  startedAt?: FieldValue | Timestamp;
  completedAt?: FieldValue | Timestamp;

  // TTL (자동 삭제용)
  expiresAt: Timestamp;
}

/**
 * 입력 데이터로 dedupeKey 생성
 * 같은 텍스트 + 이미지 + 옵션 조합은 같은 키 → 중복 방지
 */
function buildDedupeKey(
  userId: string,
  text: string,
  images: string[],
  difficulty: string,
  questionCount: number,
  courseId: string,
  courseCustomized: boolean,
  sliderWeights?: { style: number; scope: number; focusGuide: number; difficulty: number; questionCount: number },
  professorPrompt?: string
): string {
  const hash = crypto.createHash("sha256");
  hash.update(userId);
  hash.update(text.slice(0, 2000)); // 텍스트 앞 2000자만 (성능)
  hash.update(difficulty);
  hash.update(String(questionCount));
  hash.update(courseId);
  hash.update(String(courseCustomized));

  // 슬라이더 + 프롬프트 포함
  if (sliderWeights) {
    hash.update(JSON.stringify(sliderWeights));
  }
  if (professorPrompt) {
    hash.update(professorPrompt.slice(0, 500));
  }

  // 이미지는 앞 100바이트씩만 해싱 (전체 base64는 너무 큼)
  for (const img of images.slice(0, 5)) {
    hash.update(img.slice(0, 100));
  }

  return hash.digest("hex").slice(0, 32);
}

/**
 * AI 문제 생성 Job 등록
 */
export const enqueueGenerationJob = onCall(
  {
    region: "asia-northeast3",
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const raw = request.data as {
      text?: string | null;
      images?: string[] | null;
      difficulty?: "easy" | "medium" | "hard";
      questionCount?: number;
      courseId?: string;
      courseName?: string;
      courseCustomized?: boolean;
      sliderWeights?: {
        style: number;
        scope: number;
        focusGuide: number;
        difficulty: number;
        questionCount: number;
      } | null;
      professorPrompt?: string | null;
    };
    // Firebase SDK가 undefined → null로 직렬화하므로 ?? 로 안전하게 처리
    const text = raw.text ?? "";
    const images = raw.images ?? [];
    const difficulty = raw.difficulty ?? "medium";
    const questionCount = raw.questionCount ?? 5;
    const courseId = raw.courseId ?? "general";
    const courseName = raw.courseName ?? "일반";
    const courseCustomized = raw.courseCustomized ?? true;
    const sliderWeights = raw.sliderWeights ?? undefined;
    const professorPrompt = raw.professorPrompt ?? undefined;

    // Rate limit 검사
    try {
      await checkRateLimitV2(userId, "ai-generate");
      await checkRateLimitV2(userId, "ai-generate-daily");
    } catch (err) {
      throw new HttpsError(
        "resource-exhausted",
        err instanceof Error ? err.message : "요청 한도 초과"
      );
    }

    const db = getFirestore();

    // dedupeKey 생성
    const dedupeKey = buildDedupeKey(
      userId,
      text,
      images,
      difficulty,
      questionCount,
      courseId,
      courseCustomized,
      sliderWeights,
      professorPrompt
    );

    // 중복 Job 확인 (최근 10분 이내 같은 dedupeKey)
    const existingJobs = await db
      .collection("jobs")
      .where("dedupeKey", "==", dedupeKey)
      .where("status", "in", ["QUEUED", "RUNNING", "COMPLETED"])
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (!existingJobs.empty) {
      const existingJob = existingJobs.docs[0];
      const jobData = existingJob.data();
      const createdAt = jobData.createdAt?.toDate?.();
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

      // 10분 이내 같은 요청이 있으면 기존 jobId 반환
      if (createdAt && createdAt > tenMinutesAgo) {
        return {
          jobId: existingJob.id,
          status: jobData.status as JobStatus,
          deduplicated: true,
        };
      }
    }

    // 유효성 검사
    const validDifficulty = ["easy", "medium", "hard"].includes(difficulty)
      ? difficulty
      : "medium";
    const validQuestionCount = Math.min(Math.max(questionCount, 5), 20);

    // TTL: 1시간 후 만료 (자동 삭제 대상)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    // materialFingerprint 생성 (사용자/옵션 무관, 학습 자료 기반 캐시 키)
    const materialFingerprint = buildMaterialFingerprint(text, courseId, images);

    // Job 문서 생성
    const jobRef = db.collection("jobs").doc();
    const limitedImages = images.slice(0, 10);

    // 이미지를 Firebase Storage에 임시 저장 (Firestore 1MB 문서 크기 제한 회피)
    let storagePaths: string[] = [];
    if (limitedImages.length > 0) {
      const bucket = getStorage().bucket();
      storagePaths = await Promise.all(
        limitedImages.map(async (img, idx) => {
          const path = `tmp/jobs/${jobRef.id}/image-${idx}.b64`;
          await bucket.file(path).save(Buffer.from(img, "utf-8"), {
            contentType: "text/plain",
            metadata: { cacheControl: "no-cache" },
          });
          return path;
        })
      );
    }

    const jobData: GenerationJob = {
      jobId: jobRef.id,
      userId,
      status: "QUEUED",
      text: text.slice(0, 50000), // 텍스트 크기 제한
      images: storagePaths, // Storage 경로만 저장 (base64 대신)
      difficulty: validDifficulty as "easy" | "medium" | "hard",
      questionCount: validQuestionCount,
      courseId,
      courseName,
      courseCustomized,
      ...(sliderWeights ? { sliderWeights } : {}),
      ...(professorPrompt ? { professorPrompt } : {}),
      dedupeKey,
      materialFingerprint,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
    };

    await jobRef.set(jobData);

    console.log(`[enqueueGenerationJob] Job 생성: ${jobRef.id}`, {
      userId,
      courseId,
      difficulty: validDifficulty,
      questionCount: validQuestionCount,
      textLength: text.length,
      imageCount: images.length,
    });

    return {
      jobId: jobRef.id,
      status: "QUEUED" as JobStatus,
      deduplicated: false,
    };
  }
);

/**
 * Job 상태 조회 (Callable Function)
 * 클라이언트 polling용
 */
export const checkJobStatus = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { jobId } = request.data as { jobId: string };
    if (!jobId) {
      throw new HttpsError("invalid-argument", "jobId가 필요합니다.");
    }

    const db = getFirestore();
    const jobDoc = await db.collection("jobs").doc(jobId).get();

    if (!jobDoc.exists) {
      throw new HttpsError("not-found", "Job을 찾을 수 없습니다.");
    }

    const jobData = jobDoc.data()!;

    // 본인 Job만 조회 가능
    if (jobData.userId !== request.auth.uid) {
      throw new HttpsError("permission-denied", "권한이 없습니다.");
    }

    const response: any = {
      jobId,
      status: jobData.status,
    };

    // COMPLETED: 결과 포함
    if (jobData.status === "COMPLETED" && jobData.result) {
      response.result = jobData.result;
    }

    // FAILED: 에러 메시지 포함
    if (jobData.status === "FAILED" && jobData.error) {
      response.error = jobData.error;
    }

    return response;
  }
);
