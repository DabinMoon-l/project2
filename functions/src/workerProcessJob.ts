/**
 * AI 문제 생성 Worker (Firestore Trigger)
 *
 * jobs/{jobId} 문서가 생성되면 자동 실행:
 * 1. 동시 실행 RUNNING 수 확인 (최대 20)
 * 2. status → RUNNING 전환
 * 3. 스타일 프로필 + 키워드 + Scope 병렬 로드
 * 4. 이미지 크롭 (HARD 난이도)
 * 5. Gemini API로 문제 생성
 * 6. status → COMPLETED (결과 저장) 또는 FAILED (에러)
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import type { StyleProfile, KeywordStore } from "./professorQuizAnalysis";
import type { CroppedImage } from "./imageCropping";
import { processImagesForQuiz } from "./imageCropping";
import { analyzeImageRegions } from "./imageRegionAnalysis";
import {
  buildFullPrompt,
  generateWithGemini,
  loadScopeForQuiz,
  type StyleContext,
  type Difficulty,
} from "./styledQuizGenerator";
import {
  buildMaterialFingerprint,
  getMaterialCache,
  setMaterialCache,
  cleanupExpiredMaterials,
} from "./utils/materialCache";

// Gemini API 키
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// 동시 실행 제한
const MAX_CONCURRENT_JOBS = 20;

/**
 * Job 생성 트리거 → 문제 생성 워커
 */
export const workerProcessJob = onDocumentCreated(
  {
    document: "jobs/{jobId}",
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
    memory: "1GiB",
    timeoutSeconds: 300, // 5분 (이미지 처리 + Gemini 호출)
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const jobId = event.params.jobId;
    const jobData = snapshot.data();

    // QUEUED 상태만 처리
    if (jobData.status !== "QUEUED") {
      console.log(`[Worker] Job ${jobId}: status=${jobData.status}, 건너뜀`);
      return;
    }

    const db = getFirestore();
    const jobRef = db.collection("jobs").doc(jobId);

    // 동시 실행 수 확인
    const runningJobs = await db
      .collection("jobs")
      .where("status", "==", "RUNNING")
      .count()
      .get();

    if (runningJobs.data().count >= MAX_CONCURRENT_JOBS) {
      console.log(
        `[Worker] 동시 실행 한도 초과 (${runningJobs.data().count}/${MAX_CONCURRENT_JOBS}), ` +
        `Job ${jobId} 대기 유지`
      );
      // QUEUED 상태 유지 → 다음 스케줄 실행에서 재시도
      return;
    }

    // status → RUNNING (낙관적 잠금: CAS로 중복 실행 방지)
    try {
      await db.runTransaction(async (tx) => {
        const currentDoc = await tx.get(jobRef);
        if (!currentDoc.exists || currentDoc.data()?.status !== "QUEUED") {
          throw new Error("이미 처리 중이거나 완료된 Job입니다.");
        }
        tx.update(jobRef, {
          status: "RUNNING",
          startedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (err) {
      console.log(`[Worker] Job ${jobId}: CAS 실패 (이미 처리 중)`, err);
      return;
    }

    // API 키 확인
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      await jobRef.update({
        status: "FAILED",
        error: "AI 서비스가 설정되지 않았습니다.",
        completedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const {
      text,
      images = [],
      difficulty,
      questionCount,
      courseId,
      courseName,
      userId,
    } = jobData;

    try {
      const trimmedText = (text || "").trim();
      const isShortText = trimmedText.length < 200;
      const isVeryShortText = trimmedText.length < 50;

      const validDifficulty: Difficulty = ["easy", "medium", "hard"].includes(difficulty)
        ? difficulty
        : "medium";
      const validQuestionCount = Math.min(Math.max(questionCount, 5), 20);

      // ========================================
      // materialFingerprint 캐시 조회
      // ========================================
      const startTime = Date.now();
      const fingerprint = buildMaterialFingerprint(trimmedText, courseId, images);
      const cached = await getMaterialCache(fingerprint);
      let cacheHit = false;

      let styleContext: StyleContext = { profile: null, keywords: null, scope: null };
      let croppedImages: CroppedImage[] = [];

      if (cached) {
        // 캐시 히트: scope + 이미지 크롭 결과 재사용
        cacheHit = true;
        if (cached.scopeData) {
          styleContext.scope = cached.scopeData;
        }
        croppedImages = cached.croppedImages || [];
        console.log(
          `[Worker] Job ${jobId} 캐시 히트: scope=${!!cached.scopeData}, images=${croppedImages.length}`
        );
      }

      // ========================================
      // 스타일 프로필 + 키워드는 항상 최신 조회
      // Scope는 캐시 미스일 때만 로드
      // ========================================
      const analysisRef = db.collection("professorQuizAnalysis").doc(courseId);
      const shouldLoadScope = !cacheHit && (isShortText || validDifficulty !== "easy");

      const [profileDoc, keywordsDoc, scopeResult] = await Promise.all([
        analysisRef.collection("data").doc("styleProfile").get(),
        analysisRef.collection("data").doc("keywords").get(),
        shouldLoadScope
          ? loadScopeForQuiz(courseId, trimmedText || "general", validDifficulty)
          : Promise.resolve(null),
      ]);

      if (profileDoc.exists) {
        styleContext.profile = profileDoc.data() as StyleProfile;
      }
      if (keywordsDoc.exists) {
        styleContext.keywords = keywordsDoc.data() as KeywordStore;
      }
      if (scopeResult) {
        styleContext.scope = scopeResult;
      }

      const loadTime = Date.now() - startTime;
      console.log(
        `[Worker] Job ${jobId} 데이터 로드: ${loadTime}ms (캐시=${cacheHit}) - ` +
        `profile=${!!styleContext.profile}, keywords=${!!styleContext.keywords}, scope=${!!styleContext.scope}`
      );

      // ========================================
      // HARD 난이도: 이미지 크롭 (캐시 미스일 때만)
      // ========================================
      if (!cacheHit && validDifficulty === "hard" && images && images.length > 0) {
        console.log(`[Worker] Job ${jobId} 이미지 처리: ${images.length}개`);
        try {
          croppedImages = await processImagesForQuiz(
            images,
            analyzeImageRegions,
            apiKey,
            userId
          );
          console.log(`[Worker] 이미지 크롭 완료: ${croppedImages.length}개`);
        } catch (imageError) {
          console.error(`[Worker] Job ${jobId} 이미지 처리 오류:`, imageError);
        }
      }

      // ========================================
      // 캐시 미스 → 결과 저장 (비동기)
      // ========================================
      if (!cacheHit) {
        setMaterialCache(
          fingerprint,
          courseId,
          trimmedText.length,
          styleContext.scope,
          croppedImages
        ).catch((err) => console.warn(`[Worker] 캐시 저장 실패:`, err));
      }

      // ========================================
      // 프롬프트 생성 + Gemini 호출
      // ========================================
      const prompt = buildFullPrompt(
        trimmedText,
        validDifficulty,
        validQuestionCount,
        styleContext,
        courseName,
        courseId,
        isShortText,
        isVeryShortText,
        croppedImages
      );

      console.log(
        `[Worker] Job ${jobId} 문제 생성 시작: ` +
        `과목=${courseName}, 난이도=${validDifficulty}, 개수=${validQuestionCount}`
      );

      const questions = await generateWithGemini(
        prompt,
        apiKey,
        validQuestionCount,
        croppedImages
      );

      const questionsWithImages = questions.filter((q) => q.imageUrl).length;

      // 사용 로그 기록 (비동기)
      const today = new Date().toISOString().split("T")[0];
      db.collection("styledQuizUsage")
        .doc(userId)
        .collection("daily")
        .doc(today)
        .set(
          {
            count: FieldValue.increment(1),
            lastUsedAt: FieldValue.serverTimestamp(),
            lastCourseId: courseId,
            lastDifficulty: validDifficulty,
            hasImages: croppedImages.length > 0,
          },
          { merge: true }
        )
        .catch((err) => console.warn("[Worker] 사용 로그 기록 실패:", err));

      // ========================================
      // COMPLETED
      // ========================================
      await jobRef.update({
        status: "COMPLETED",
        result: {
          questions,
          meta: {
            courseId,
            difficulty: validDifficulty,
            hasStyleProfile: !!styleContext.profile,
            hasKeywords: !!styleContext.keywords,
            hasScope: !!styleContext.scope,
            scopeChaptersLoaded: styleContext.scope?.chaptersLoaded || [],
            analyzedQuestionCount: styleContext.profile?.analyzedQuestionCount || 0,
            croppedImagesCount: croppedImages.length,
            questionsWithImages,
            materialCacheHit: cacheHit,
          },
        },
        completedAt: FieldValue.serverTimestamp(),
      });

      console.log(
        `[Worker] Job ${jobId} 완료: ${questions.length}개 생성됨 (${Date.now() - startTime}ms, 캐시=${cacheHit})`
      );
    } catch (error) {
      console.error(`[Worker] Job ${jobId} 실패:`, error);
      await jobRef.update({
        status: "FAILED",
        error: error instanceof Error
          ? error.message
          : "문제 생성 중 오류가 발생했습니다.",
        completedAt: FieldValue.serverTimestamp(),
      });
    }
  }
);

/**
 * QUEUED 상태 Job 재시도 (Scheduled)
 *
 * 동시 실행 한도 초과로 QUEUED 상태에 남은 Job을
 * 1분마다 확인하여 처리 시작
 *
 * 또한 5분 이상 RUNNING 상태인 Job을 FAILED 처리 (타임아웃)
 */
export const retryQueuedJobs = onSchedule(
  {
    schedule: "every 1 minutes",
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
    memory: "1GiB",
    timeoutSeconds: 300,
  },
  async () => {
    const db = getFirestore();

    // 5분 이상 RUNNING인 Job → FAILED (타임아웃)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const stuckJobs = await db
      .collection("jobs")
      .where("status", "==", "RUNNING")
      .where("startedAt", "<", fiveMinutesAgo)
      .get();

    for (const doc of stuckJobs.docs) {
      console.log(`[Retry] 타임아웃 Job: ${doc.id}`);
      await doc.ref.update({
        status: "FAILED",
        error: "처리 시간 초과 (5분). 다시 시도해주세요.",
        completedAt: FieldValue.serverTimestamp(),
      });
    }

    // RUNNING 수 확인
    const runningCount = await db
      .collection("jobs")
      .where("status", "==", "RUNNING")
      .count()
      .get();

    const available = MAX_CONCURRENT_JOBS - runningCount.data().count;
    if (available <= 0) {
      console.log(`[Retry] 동시 실행 가득 참 (${runningCount.data().count}/${MAX_CONCURRENT_JOBS})`);
      return;
    }

    // QUEUED Job 가져오기 (오래된 순)
    const queuedJobs = await db
      .collection("jobs")
      .where("status", "==", "QUEUED")
      .orderBy("createdAt", "asc")
      .limit(available)
      .get();

    if (queuedJobs.empty) return;

    console.log(`[Retry] ${queuedJobs.size}개 QUEUED Job 재처리 시작`);

    const apiKey = GEMINI_API_KEY.value();

    for (const jobDoc of queuedJobs.docs) {
      const jobId = jobDoc.id;
      const jobData = jobDoc.data();
      const jobRef = jobDoc.ref;

      // CAS: QUEUED → RUNNING
      try {
        await db.runTransaction(async (tx) => {
          const current = await tx.get(jobRef);
          if (current.data()?.status !== "QUEUED") {
            throw new Error("이미 처리 중");
          }
          tx.update(jobRef, {
            status: "RUNNING",
            startedAt: FieldValue.serverTimestamp(),
          });
        });
      } catch {
        continue;
      }

      // 문제 생성 실행
      try {
        const result = await processJobData(jobData, apiKey, db);
        await jobRef.update({
          status: "COMPLETED",
          result,
          completedAt: FieldValue.serverTimestamp(),
        });
        console.log(`[Retry] Job ${jobId} 완료`);
      } catch (error) {
        await jobRef.update({
          status: "FAILED",
          error: error instanceof Error
            ? error.message
            : "문제 생성 중 오류가 발생했습니다.",
          completedAt: FieldValue.serverTimestamp(),
        });
        console.error(`[Retry] Job ${jobId} 실패:`, error);
      }
    }
  }
);

/**
 * Job 데이터로 문제 생성 실행 (재사용 함수)
 */
async function processJobData(
  jobData: FirebaseFirestore.DocumentData,
  apiKey: string,
  db: FirebaseFirestore.Firestore
) {
  const {
    text,
    images = [],
    difficulty,
    questionCount,
    courseId,
    courseName,
    userId,
  } = jobData;

  const trimmedText = (text || "").trim();
  const isShortText = trimmedText.length < 200;
  const isVeryShortText = trimmedText.length < 50;

  const validDifficulty: Difficulty = ["easy", "medium", "hard"].includes(difficulty)
    ? difficulty
    : "medium";
  const validQuestionCount = Math.min(Math.max(questionCount, 5), 20);

  // materialFingerprint 캐시 조회
  const fingerprint = buildMaterialFingerprint(trimmedText, courseId, images);
  const cached = await getMaterialCache(fingerprint);
  let cacheHit = false;

  let styleContext: StyleContext = { profile: null, keywords: null, scope: null };
  let croppedImages: CroppedImage[] = [];

  if (cached) {
    cacheHit = true;
    if (cached.scopeData) styleContext.scope = cached.scopeData;
    croppedImages = cached.croppedImages || [];
    console.log(`[processJobData] 캐시 히트: scope=${!!cached.scopeData}, images=${croppedImages.length}`);
  }

  // 스타일 프로필 + 키워드 항상 최신 조회, Scope는 캐시 미스일 때만
  const analysisRef = db.collection("professorQuizAnalysis").doc(courseId);
  const shouldLoadScope = !cacheHit && (isShortText || validDifficulty !== "easy");

  const [profileDoc, keywordsDoc, scopeResult] = await Promise.all([
    analysisRef.collection("data").doc("styleProfile").get(),
    analysisRef.collection("data").doc("keywords").get(),
    shouldLoadScope
      ? loadScopeForQuiz(courseId, trimmedText || "general", validDifficulty)
      : Promise.resolve(null),
  ]);

  if (profileDoc.exists) {
    styleContext.profile = profileDoc.data() as StyleProfile;
  }
  if (keywordsDoc.exists) {
    styleContext.keywords = keywordsDoc.data() as KeywordStore;
  }
  if (scopeResult) {
    styleContext.scope = scopeResult;
  }

  // 이미지 크롭 (캐시 미스일 때만)
  if (!cacheHit && validDifficulty === "hard" && images && images.length > 0) {
    try {
      croppedImages = await processImagesForQuiz(
        images,
        analyzeImageRegions,
        apiKey,
        userId
      );
    } catch {
      // 이미지 실패해도 문제 생성 진행
    }
  }

  // 캐시 미스 → 저장
  if (!cacheHit) {
    setMaterialCache(
      fingerprint,
      courseId,
      trimmedText.length,
      styleContext.scope,
      croppedImages
    ).catch(() => {});
  }

  // 프롬프트 + Gemini
  const prompt = buildFullPrompt(
    trimmedText,
    validDifficulty,
    validQuestionCount,
    styleContext,
    courseName,
    courseId,
    isShortText,
    isVeryShortText,
    croppedImages
  );

  const questions = await generateWithGemini(
    prompt,
    apiKey,
    validQuestionCount,
    croppedImages
  );

  const questionsWithImages = questions.filter((q) => q.imageUrl).length;

  // 사용 로그
  const today = new Date().toISOString().split("T")[0];
  db.collection("styledQuizUsage")
    .doc(userId)
    .collection("daily")
    .doc(today)
    .set(
      {
        count: FieldValue.increment(1),
        lastUsedAt: FieldValue.serverTimestamp(),
        lastCourseId: courseId,
        lastDifficulty: validDifficulty,
      },
      { merge: true }
    )
    .catch(() => {});

  return {
    questions,
    meta: {
      courseId,
      difficulty: validDifficulty,
      hasStyleProfile: !!styleContext.profile,
      hasKeywords: !!styleContext.keywords,
      hasScope: !!styleContext.scope,
      scopeChaptersLoaded: styleContext.scope?.chaptersLoaded || [],
      croppedImagesCount: croppedImages.length,
      questionsWithImages,
      materialCacheHit: cacheHit,
    },
  };
}

/**
 * 만료된 Job 정리 (매시간)
 * expiresAt이 지난 Job 문서 삭제
 */
export const cleanupExpiredJobs = onSchedule(
  {
    schedule: "every 1 hours",
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
  },
  async () => {
    const db = getFirestore();
    const now = new Date();

    // 1. 만료된 Jobs 삭제
    const expiredJobs = await db
      .collection("jobs")
      .where("expiresAt", "<", now)
      .limit(500)
      .get();

    if (!expiredJobs.empty) {
      const batch = db.batch();
      for (const doc of expiredJobs.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      console.log(`[Cleanup] ${expiredJobs.size}개 만료 Job 삭제`);
    }

    // 2. 만료된 Materials 캐시 삭제
    const deletedMaterials = await cleanupExpiredMaterials();
    if (deletedMaterials > 0) {
      console.log(`[Cleanup] ${deletedMaterials}개 만료 Material 캐시 삭제`);
    }
  }
);
