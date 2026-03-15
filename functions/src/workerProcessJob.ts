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
import { getStorage } from "firebase-admin/storage";
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
  getCourseIndex,
  type StyleContext,
  type Difficulty,
  type GeneratedQuestion,
} from "./styledQuizGenerator";
import type { QuestionBank } from "./professorQuizAnalysis";
import {
  buildMaterialFingerprint,
  getMaterialCache,
  setMaterialCache,
  cleanupExpiredMaterials,
} from "./utils/materialCache";
import { extractChapterNumbersFromTags } from "./courseScope";

// Gemini API 키
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// 동시 실행 제한
const MAX_CONCURRENT_JOBS = 40;

// ========================================
// 공유 문제 생성 로직 (workerProcessJob + retryQueuedJobs 공용)
// ========================================

interface JobInput {
  text: string;
  images: string[]; // base64 이미지 (다운로드 완료)
  difficulty: string;
  questionCount: number;
  courseId: string;
  courseName: string;
  userId: string;
  courseCustomized: boolean;
  professorPrompt?: string;
  tags?: string[];
}

interface JobResult {
  questions: GeneratedQuestion[];
  meta: Record<string, unknown>;
}

/**
 * 문제 뱅크에서 랜덤 k개 추출 (Fisher-Yates Top-K)
 * 전체 셔플 O(n) 대신 필요한 k개만 O(k) 셔플
 */
function sampleFromArray<T>(arr: T[], k: number): T[] {
  if (arr.length <= k) return [...arr];
  const copy = [...arr];
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, k);
}

/**
 * 챕터 ID 유효성 검증 및 보정
 */
function validateChapterIds(
  questions: GeneratedQuestion[],
  courseId: string,
  tags?: string[]
) {
  const courseIndex = getCourseIndex(courseId);
  if (!courseIndex) return;

  const validChapterIds = new Set(courseIndex.chapters.map(c => c.id));
  const validDetailIds = new Set(
    courseIndex.chapters.flatMap(c => c.details.map(d => d.id))
  );

  // 태그 → 챕터 ID 매핑 (O(tags) with Map lookup 대신 O(tags × chapters) find)
  const chapterNumToId = new Map<string, string>();
  for (const c of courseIndex.chapters) {
    const num = c.id.split("_")[1];
    if (num) chapterNumToId.set(num, c.id);
  }

  const tagChapterIds = tags && tags.length > 0
    ? tags
        .filter(t => /^\d+_/.test(t))
        .map(t => chapterNumToId.get(t.split("_")[0]))
        .filter((id): id is string => !!id)
    : [];

  for (const q of questions) {
    if (q.chapterId && !validChapterIds.has(q.chapterId)) {
      q.chapterId = undefined;
    }
    if (q.chapterDetailId && !validDetailIds.has(q.chapterDetailId)) {
      q.chapterDetailId = undefined;
    }
    // chapterDetailId에서 chapterId 추론
    if (!q.chapterId && q.chapterDetailId) {
      const parts = q.chapterDetailId.split("_");
      if (parts.length >= 2) {
        const inferredChapterId = `${parts[0]}_${parts[1]}`;
        if (validChapterIds.has(inferredChapterId)) {
          q.chapterId = inferredChapterId;
        }
      }
    }
    // 폴백: 태그가 1개면 해당 챕터 할당
    if (!q.chapterId && tagChapterIds.length === 1) {
      q.chapterId = tagChapterIds[0];
    }
  }
}

/**
 * 핵심 문제 생성 로직 (공유 함수)
 * workerProcessJob과 retryQueuedJobs 모두 이 함수를 호출
 */
async function executeJobProcessing(
  input: JobInput,
  apiKey: string,
  db: FirebaseFirestore.Firestore,
  logPrefix: string = "[Worker]"
): Promise<JobResult> {
  const {
    text, images, difficulty, questionCount,
    courseId, courseName, userId,
    courseCustomized, professorPrompt, tags,
  } = input;

  const trimmedText = (text || "").trim();
  const isShortText = trimmedText.length < 200;
  const isVeryShortText = trimmedText.length < 50;

  const validDifficulty: Difficulty = ["easy", "medium", "hard"].includes(difficulty)
    ? difficulty as Difficulty
    : "medium";
  const validQuestionCount = Math.min(Math.max(questionCount, 5), 20);

  // ========================================
  // 1단계: 캐시 조회 + 사용자 역할 조회 (병렬)
  // ========================================
  const startTime = Date.now();
  const fingerprint = buildMaterialFingerprint(trimmedText, courseId, images, validDifficulty);

  const [cached, userDoc] = await Promise.all([
    getMaterialCache(fingerprint),
    userId ? db.collection("users").doc(userId).get() : Promise.resolve(null),
  ]);

  const isProfessor = userDoc?.data()?.role === "professor";

  let cacheHit = false;
  let styleContext: StyleContext = { profile: null, keywords: null, questionBank: [], scope: null };
  let croppedImages: CroppedImage[] = [];

  if (cached) {
    cacheHit = true;
    if (cached.scopeData && courseCustomized) {
      styleContext.scope = cached.scopeData;
    }
    croppedImages = cached.croppedImages || [];
    console.log(`${logPrefix} 캐시 히트: scope=${!!cached.scopeData}, images=${croppedImages.length}`);
  }

  // ========================================
  // 2단계: 스타일/키워드/스코프 로드 + 반복 횟수 카운트 (병렬)
  // ========================================
  const shouldLoadScope = !cacheHit && courseCustomized && (isShortText || validDifficulty !== "easy");

  const forcedChapters = tags && tags.length > 0
    ? extractChapterNumbersFromTags(tags)
    : undefined;
  const combinedText = [trimmedText, professorPrompt].filter(Boolean).join("\n");

  // 병렬 실행할 작업 모음
  const parallelTasks: Promise<unknown>[] = [];

  // Task 0~2: 스타일 프로필/키워드/문제뱅크
  const analysisRef = courseCustomized
    ? db.collection("professorQuizAnalysis").doc(courseId)
    : null;

  if (courseCustomized && analysisRef) {
    parallelTasks.push(
      analysisRef.collection("data").doc("styleProfile").get(),
      analysisRef.collection("data").doc("keywords").get(),
      analysisRef.collection("data").doc("questionBank").get(),
    );
  } else {
    parallelTasks.push(
      Promise.resolve(null),
      Promise.resolve(null),
      Promise.resolve(null),
    );
  }

  // Task 3: Scope 로드 (캐시 미스일 때만)
  parallelTasks.push(
    shouldLoadScope
      ? loadScopeForQuiz(courseId, combinedText || "general", validDifficulty, forcedChapters)
      : Promise.resolve(null)
  );

  // Task 4: 챕터 반복 횟수 카운트 (사용자별)
  parallelTasks.push(
    userId && tags && tags.length > 0
      ? (async () => {
          const [byCreatorId, byCreatorUid] = await Promise.all([
            db.collection("quizzes")
              .where("creatorId", "==", userId)
              .where("type", "==", "ai-generated")
              .where("courseId", "==", courseId)
              .select("tags")
              .get(),
            db.collection("quizzes")
              .where("creatorUid", "==", userId)
              .where("type", "==", "ai-generated")
              .where("courseId", "==", courseId)
              .select("tags")
              .get(),
          ]);
          // 중복 제거
          const seen = new Set<string>();
          const allDocs = [...byCreatorId.docs, ...byCreatorUid.docs].filter(d => {
            if (seen.has(d.id)) return false;
            seen.add(d.id);
            return true;
          });
          const map: Record<string, number> = {};
          const tagSet = new Set(tags as string[]);
          for (const d of allDocs) {
            const qTags: string[] = d.data().tags || [];
            for (const t of qTags) {
              if (tagSet.has(t)) {
                map[t] = (map[t] || 0) + 1;
              }
            }
          }
          return map;
        })().catch(e => {
          console.warn(`${logPrefix} 반복 횟수 조회 실패:`, e);
          return {} as Record<string, number>;
        })
      : Promise.resolve({} as Record<string, number>)
  );

  const parallelResults = await Promise.all(parallelTasks);
  const profileDoc = parallelResults[0] as FirebaseFirestore.DocumentSnapshot | null;
  const keywordsDoc = parallelResults[1] as FirebaseFirestore.DocumentSnapshot | null;
  const bankDoc = parallelResults[2] as FirebaseFirestore.DocumentSnapshot | null;
  const scopeResult = parallelResults[3] as StyleContext["scope"] | null;
  const chapterRepetitionMap = parallelResults[4] as Record<string, number>;

  // 결과 적용
  if (profileDoc?.exists) {
    styleContext.profile = profileDoc.data() as StyleProfile;
  }
  if (keywordsDoc?.exists) {
    styleContext.keywords = keywordsDoc.data() as KeywordStore;
  }
  if (bankDoc?.exists) {
    const bank = bankDoc.data() as QuestionBank;
    if (bank.questions && bank.questions.length > 0) {
      // Fisher-Yates Top-K (8개만 셔플 — 프롬프트에 8문제 삽입)
      styleContext.questionBank = sampleFromArray(bank.questions, 8);
    }
  }
  if (scopeResult) {
    styleContext.scope = scopeResult;
  }

  // 반복 횟수 평균 계산
  const repValues = Object.values(chapterRepetitionMap);
  const chapterRepetition = repValues.length > 0
    ? Math.round(repValues.reduce((a: number, b: number) => a + b, 0) / repValues.length)
    : 0;

  const nonZero = Object.entries(chapterRepetitionMap).filter(([, v]) => v > 0);
  if (nonZero.length > 0) {
    console.log(`${logPrefix} 챕터별 반복: ${nonZero.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }

  const loadTime = Date.now() - startTime;
  console.log(
    `${logPrefix} 데이터 로드: ${loadTime}ms (캐시=${cacheHit}) - ` +
    `profile=${!!styleContext.profile}, keywords=${!!styleContext.keywords}, scope=${!!styleContext.scope}`
  );

  // ========================================
  // 3단계: HARD 난이도 이미지 크롭 (캐시 미스일 때만)
  // ========================================
  if (!cacheHit && validDifficulty === "hard" && images && images.length > 0) {
    console.log(`${logPrefix} 이미지 처리: ${images.length}개`);
    try {
      croppedImages = await processImagesForQuiz(
        images,
        analyzeImageRegions,
        apiKey,
        userId
      );
      console.log(`${logPrefix} 이미지 크롭 완료: ${croppedImages.length}개`);
    } catch (imageError) {
      console.error(`${logPrefix} 이미지 처리 오류:`, imageError);
    }
  }

  // 캐시 미스 → 결과 저장 (비동기, 에러 무시)
  if (!cacheHit) {
    setMaterialCache(
      fingerprint,
      courseId,
      trimmedText.length,
      styleContext.scope,
      croppedImages
    ).catch((err) => console.warn(`${logPrefix} 캐시 저장 실패:`, err));
  }

  // ========================================
  // 4단계: 프롬프트 생성 + Gemini 호출
  // ========================================
  const pageImages = images.filter((img: string) => img.startsWith("data:image/"));

  const prompt = buildFullPrompt(
    trimmedText,
    validDifficulty,
    validQuestionCount,
    styleContext,
    courseName,
    courseId,
    isShortText,
    isVeryShortText,
    croppedImages,
    courseCustomized,
    professorPrompt,
    pageImages.length > 0,
    tags,
    chapterRepetition,
    chapterRepetitionMap,
    isProfessor
  );

  console.log(
    `${logPrefix} 문제 생성 시작: ` +
    `과목=${courseName}, 난이도=${validDifficulty}, 개수=${validQuestionCount}, 맞춤형=${courseCustomized}` +
    `, 페이지이미지=${pageImages.length}장` +
    ""
  );

  // HARD + 크롭 이미지 있으면 크롭본만 전송 (원본 중복 제거 → 토큰/시간 절약)
  const finalPageImages = croppedImages.length > 0 ? [] : pageImages;

  let { questions, title: generatedTitle } = await generateWithGemini(
    prompt,
    apiKey,
    validQuestionCount,
    croppedImages,
    finalPageImages
  );

  // 문제 수 부족 시 보충 생성 (최대 2회 재시도)
  if (questions.length < validQuestionCount) {
    const shortage = validQuestionCount - questions.length;
    console.log(`${logPrefix} 문제 부족: ${questions.length}/${validQuestionCount} — ${shortage}개 보충 생성`);

    for (let retry = 0; retry < 2 && questions.length < validQuestionCount; retry++) {
      const remaining = validQuestionCount - questions.length;
      try {
        const supplementPrompt = buildFullPrompt(
          trimmedText,
          validDifficulty,
          remaining,
          styleContext,
          courseName,
          courseId,
          isShortText,
          isVeryShortText,
          croppedImages,
          courseCustomized,
          professorPrompt,
          pageImages.length > 0,
          tags,
          chapterRepetition + 1, // 반복 횟수 증가 → 다른 문제 유도
          chapterRepetitionMap,
          isProfessor
        );
        const supplement = await generateWithGemini(
          supplementPrompt,
          apiKey,
          remaining,
          croppedImages,
          finalPageImages
        );
        questions = [...questions, ...supplement.questions];
        console.log(`${logPrefix} 보충 ${retry + 1}차: +${supplement.questions.length}개 → 총 ${questions.length}개`);
      } catch (err) {
        console.warn(`${logPrefix} 보충 생성 ${retry + 1}차 실패:`, err);
        break;
      }
    }
  }

  // 챕터 ID 유효성 검증
  validateChapterIds(questions, courseId, tags);

  const questionsWithImages = questions.filter((q) => q.imageUrl).length;

  // 사용 로그 기록 (비동기, 에러 무시)
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
    .catch((err) => console.warn(`${logPrefix} 사용 로그 기록 실패:`, err));

  console.log(
    `${logPrefix} 완료: ${questions.length}개 생성됨 (${Date.now() - startTime}ms, 캐시=${cacheHit})`
  );

  return {
    questions: JSON.parse(JSON.stringify(questions)),
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
      ...(generatedTitle ? { title: generatedTitle } : {}),
    },
  };
}

/**
 * Storage에서 이미지 다운로드 (base64 데이터로 변환)
 */
async function downloadJobImages(rawImages: string[], jobId?: string): Promise<string[]> {
  if (rawImages.length === 0) return [];
  if (typeof rawImages[0] !== "string" || !rawImages[0].startsWith("tmp/jobs/")) {
    return rawImages; // 레거시: 직접 base64가 저장된 경우
  }

  const bucket = getStorage().bucket();
  const images = await Promise.all(
    rawImages.map(async (path: string) => {
      const [content] = await bucket.file(path).download();
      const raw = content.toString("utf-8");
      if (!raw.startsWith("data:")) {
        return `data:image/jpeg;base64,${raw}`;
      }
      return raw;
    })
  );

  if (jobId) {
    console.log(`[Worker] Job ${jobId}: Storage에서 이미지 ${images.length}개 다운로드`);
  }
  return images;
}

/**
 * Storage 임시 이미지 정리
 */
async function cleanupJobImages(rawImages: string[], logPrefix: string, jobId: string): Promise<void> {
  if (rawImages.length === 0) return;
  if (typeof rawImages[0] !== "string" || !rawImages[0].startsWith("tmp/jobs/")) return;

  try {
    const bucket = getStorage().bucket();
    await Promise.all(rawImages.map((p: string) => bucket.file(p).delete().catch(() => {})));
    console.log(`${logPrefix} Job ${jobId}: 임시 이미지 ${rawImages.length}개 삭제`);
  } catch (e) {
    console.warn(`${logPrefix} Job ${jobId}: 임시 이미지 삭제 실패`, e);
  }
}

/**
 * Job 생성 트리거 → 문제 생성 워커
 */
export const workerProcessJob = onDocumentCreated(
  {
    document: "jobs/{jobId}",
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
    memory: "1GiB",
    timeoutSeconds: 300,
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
      return;
    }

    // status → RUNNING (CAS로 중복 실행 방지)
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

    const rawImages = jobData.images || [];

    try {
      const images = await downloadJobImages(rawImages, jobId);

      const result = await executeJobProcessing({
        text: jobData.text,
        images,
        difficulty: jobData.difficulty,
        questionCount: jobData.questionCount,
        courseId: jobData.courseId,
        courseName: jobData.courseName,
        userId: jobData.userId,
        courseCustomized: jobData.courseCustomized ?? true,
        professorPrompt: jobData.professorPrompt,
        tags: jobData.tags,
      }, apiKey, db, `[Worker] Job ${jobId}`);

      // 문제별 고유 ID 부여
      const cleanQuestions = result.questions.map((q) => {
        const qWithId = q as GeneratedQuestion & { id?: string };
        if (qWithId.id) return qWithId;
        return { ...q, id: `q_${crypto.randomUUID().slice(0, 8)}` };
      });

      await jobRef.update({
        status: "COMPLETED",
        result: { questions: cleanQuestions, meta: result.meta },
        completedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error(`[Worker] Job ${jobId} 실패:`, error);
      await jobRef.update({
        status: "FAILED",
        error: error instanceof Error
          ? error.message
          : "문제 생성 중 오류가 발생했습니다.",
        completedAt: FieldValue.serverTimestamp(),
      });
    } finally {
      await cleanupJobImages(rawImages, "[Worker]", jobId);
    }
  }
);

/**
 * QUEUED 상태 Job 재시도 (Scheduled)
 * 동시 실행 한도 초과로 QUEUED에 남은 Job을 1분마다 처리
 * 5분 이상 RUNNING인 Job은 FAILED 처리 (타임아웃)
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

    console.log(`[Retry] ${queuedJobs.size}개 QUEUED Job 병렬 재처리 시작`);

    const apiKey = GEMINI_API_KEY.value();

    // 병렬 처리 — 순차 대비 N배 빠름 (동시성은 MAX_CONCURRENT_JOBS로 이미 제한)
    await Promise.allSettled(
      queuedJobs.docs.map(async (jobDoc) => {
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
          return;
        }

        const rawImages = jobData.images || [];

        try {
          const images = await downloadJobImages(rawImages);

          const result = await executeJobProcessing({
            text: jobData.text,
            images,
            difficulty: jobData.difficulty,
            questionCount: jobData.questionCount,
            courseId: jobData.courseId,
            courseName: jobData.courseName,
            userId: jobData.userId,
            courseCustomized: jobData.courseCustomized ?? true,
            professorPrompt: jobData.professorPrompt,
            tags: jobData.tags,
          }, apiKey, db, `[Retry] Job ${jobId}`);

          // 문제별 고유 ID 부여
          const cleanQuestions = result.questions.map((q) => {
            const qWithId = q as GeneratedQuestion & { id?: string };
            if (qWithId.id) return qWithId;
            return { ...q, id: `q_${crypto.randomUUID().slice(0, 8)}` };
          });

          await jobRef.update({
            status: "COMPLETED",
            result: { questions: cleanQuestions, meta: result.meta },
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
        } finally {
          await cleanupJobImages(rawImages, "[Retry]", jobId);
        }
      })
    );
  }
);

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
