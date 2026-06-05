/**
 * 철권퀴즈 문제 풀 사전 생성 시스템
 *
 * v2 — 챕터당 150문제 생성 (전 챕터)
 *
 * 구조:
 * - 스케줄러(03:00 KST) → Firestore 태스크 디스패치 (per course×chapter)
 * - onDocumentCreated 워커 → 챕터당 150문제 생성 (무중단 교체)
 * - drawQuestionsFromPool → 학생 선택 챕터 기반 추출
 *
 * Firestore 구조:
 *   tekkenQuestionPool/{courseId}/questions/{qId}    — 개별 문제 (chapter 필드)
 *   tekkenQuestionPool/{courseId}/seenQuestions/{id}  — 유저별 본 문제 기록
 *   tekkenPoolTasks/{taskId}                         — 챕터별 생성 태스크
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { verifyProfessorAccess } from "./utils/professorAccess";
import {
  generateBattleQuestions,
  getTekkenChapters,
  COURSE_NAMES,
  type GeneratedQuestion,
} from "./tekkenBattle";
import type { TekkenDifficulty, TekkenPoolTask } from "./tekken/tekkenTypes";
import { loadScopeSubChaptersForAI, type ScopeSubChapter } from "./courseScope";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// 과목 목록 (순환 의존성으로 모듈 초기화 시 COURSE_NAMES가 undefined → 지연 평가)
const getAllCourses = () => Object.keys(COURSE_NAMES);

/**
 * 현재 학기 과목만 반환
 * 1학기 (02-22 ~ 08-21): biology, microbiology
 * 2학기 (08-22 ~ 02-21): pathophysiology만
 */
function getCurrentSemesterCourses(): string[] {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const isSemester1 =
    (month > 2 || (month === 2 && day >= 22)) &&
    (month < 8 || (month === 8 && day <= 21));

  if (isSemester1) {
    return ["biology", "microbiology"];
  }
  return ["pathophysiology"];
}

// ── 상수 ──

/** 챕터당 목표 문제 수 */
const TARGET_PER_CHAPTER = 150;
/** 배치당 문제 수 (Gemini 1회 호출) */
const BATCH_SIZE = 15;
/** 배치/청크 간 대기 (ms) — Gemini rate limit 완화 */
const BATCH_DELAY_MS = 3000;
/** 배틀 풀 난이도 (easy 제거 — 선지 소거가 너무 쉬움) */
const POOL_DIFFICULTY: TekkenDifficulty = "medium";

// ── 세부단원(병원체) 단위 생성 (B 방식) ──
// scope를 세부단원별로 100% 전달하기 위해, 상위 챕터 scope를 작은 "생성 청크"로 쪼갠다.
// 큰 병원체는 단독 청크, 작은 병원체끼리는 한 청크로 묶어 각 호출에 충분한 학습자료를 보장한다.

/** 생성 청크 1개의 목표 scope 길이(자). 이보다 작은 인접 세부단원은 합쳐 한 청크로. */
const CHUNK_TARGET_CHARS = 3500;
/** 이 길이 미만의 scope 노드는 헤더성(예: "DNA 바이러스")으로 보고 단독 생성 대상에서 제외 */
const MIN_NODE_CHARS = 50;
/** 청크당 최소/최대 문제 수 (한 병원체에 너무 적거나, 한 청크가 챕터를 독점하지 않도록) */
const MIN_QUESTIONS_PER_CHUNK = 5;
const MAX_QUESTIONS_PER_CHUNK = 25;

/** 생성 청크 — 세부단원 scope를 모아 한 번에 출제할 단위 */
interface GenerationChunk {
  /** 표시용 라벨 (예: "7-2-1") */
  label: string;
  /** 대표 세부단원 번호 (저장 시 subChapter 태그 — 추적용) */
  subChapter: string;
  /** 이 청크에 주입할 scope 본문. null이면 generator가 직접 챕터 scope를 로드(폴백). */
  content: string | null;
}

/**
 * 세부단원 목록을 "생성 청크"로 묶는다.
 * - 헤더성 빈 노드(내용 < MIN_NODE_CHARS)는 제외
 * - 인접 세부단원을 CHUNK_TARGET_CHARS 한도까지 합쳐 한 청크로 (작은 병원체끼리 묶임)
 * - 큰 세부단원은 자연히 단독 청크가 된다
 */
function buildGenerationChunks(subs: ScopeSubChapter[]): GenerationChunk[] {
  const chunks: GenerationChunk[] = [];
  let cur: GenerationChunk | null = null;

  for (const s of subs) {
    const body = (s.content || "").trim();
    if (body.length < MIN_NODE_CHARS) continue; // 헤더성 노드 스킵
    const label = s.chapterNumber.replace(/_/g, "-");
    const piece = `[${label} ${s.chapterName}]\n${body}`;

    // 현재 청크에 더하면 한도 초과 → 현재 청크 마감하고 새로 시작
    if (cur && cur.content && cur.content.length + piece.length > CHUNK_TARGET_CHARS) {
      chunks.push(cur);
      cur = null;
    }
    if (!cur) {
      cur = { label, subChapter: s.chapterNumber, content: "" };
    }
    cur.content = cur.content ? `${cur.content}\n\n${piece}` : piece;
  }
  if (cur && cur.content) chunks.push(cur);
  return chunks;
}

/**
 * 청크별 문제 수 배분 — scope 길이에 비례, [MIN, MAX]로 클램프.
 * content=null 단일 폴백 청크면 전량 배정.
 */
function allocateBudgets(chunks: GenerationChunk[], targetSize: number): number[] {
  if (chunks.length === 1 && chunks[0].content === null) return [targetSize];
  const lens = chunks.map((c) => (c.content ? c.content.length : 0));
  const totalLen = lens.reduce((a, b) => a + b, 0) || 1;
  return chunks.map((_, i) => {
    const raw = Math.round(targetSize * (lens[i] / totalLen));
    return Math.max(MIN_QUESTIONS_PER_CHUNK, Math.min(MAX_QUESTIONS_PER_CHUNK, raw));
  });
}

// ── 챕터별 풀 생성 ──

/**
 * 단일 (상위)챕터의 문제 풀 생성 — B 방식(세부단원/병원체별 100% scope 주입)
 *
 * 1) 해당 챕터의 scope를 세부단원별로 로드
 * 2) 작은 세부단원은 합쳐 "생성 청크" 구성
 * 3) 청크마다 그 scope만 주입해 generateBattleQuestions 호출
 *    → 모든 병원체가 고르게 커버되고, 각 문제는 해당 scope 100% 안에서만 출제됨
 * 4) scope가 없거나(과목에 scope 미등록) 세부 구조가 없으면 기존 방식으로 폴백
 *
 * 저장되는 chapter 필드는 항상 상위 챕터 번호(예: "5") — 학생의 챕터 선택/추출과 호환.
 * subChapter 필드로 어느 병원체에서 나왔는지 추적할 수 있다.
 */
export async function replenishChapterPool(
  courseId: string,
  chapter: string,
  apiKey: string,
  targetSize: number = TARGET_PER_CHAPTER,
  runId?: string,
): Promise<{ added: number }> {
  const db = getFirestore();
  const poolRef = db.collection("tekkenQuestionPool").doc(courseId);
  const questionsRef = poolRef.collection("questions");

  let totalAdded = 0;
  const generatedTexts: string[] = [];
  // runId: 이 생성 라운드의 고유 식별자 (무중단 교체 시 old/new 구분용)
  const currentRunId = runId || `run_${Date.now()}_ch${chapter}`;

  // Firestore 배치 저장 헬퍼 (subChapter 추적 태그 포함)
  const saveQuestions = async (
    questions: GeneratedQuestion[],
    subChapter: string,
    batchLabel: string,
  ): Promise<number> => {
    if (questions.length === 0) return 0;
    const withExplanation = questions.filter(
      (q) => q.explanation && q.choiceExplanations && q.choiceExplanations.length > 0,
    );
    if (withExplanation.length < questions.length) {
      console.log(`[풀] ${courseId}/ch${chapter}/${subChapter}: 해설 없는 문제 ${questions.length - withExplanation.length}개 제외`);
    }
    if (withExplanation.length === 0) return 0;

    const writeBatch = db.batch();
    const batchId = `${Date.now()}_ch${chapter}_${batchLabel}`;
    for (const q of withExplanation) {
      const docRef = questionsRef.doc();
      writeBatch.set(docRef, {
        text: q.text,
        type: q.type,
        choices: q.choices,
        correctAnswer: q.correctAnswer,
        difficulty: POOL_DIFFICULTY,
        chapter,        // 상위 챕터 고정 (학생 챕터 선택/추출과 호환)
        subChapter,     // 출처 세부단원 (추적용)
        generatedAt: FieldValue.serverTimestamp(),
        batchId,
        runId: currentRunId,
        explanation: q.explanation,
        choiceExplanations: q.choiceExplanations,
      });
      generatedTexts.push(q.text);
    }
    await writeBatch.commit();
    return withExplanation.length;
  };

  // 1. 세부단원 scope 로드 → 생성 청크 구성
  const subChapters = await loadScopeSubChaptersForAI(courseId, chapter);
  let chunks = buildGenerationChunks(subChapters);

  // scope 없음/플랫 → 폴백: generator가 직접 챕터 scope 로드
  if (chunks.length === 0) {
    console.log(`[풀] ${courseId}/ch${chapter}: 세부단원 scope 없음 → 챕터 통째 생성으로 폴백`);
    chunks = [{ label: `ch${chapter}`, subChapter: chapter, content: null }];
  }

  // 2. 청크별 문제 수 배분 (scope 길이 비례)
  const budgets = allocateBudgets(chunks, targetSize);

  // 3. 청크(병원체)별 생성
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const budget = budgets[i];
    if (budget <= 0) continue;

    let chunkAdded = 0;
    const batches = Math.ceil(budget / BATCH_SIZE);
    for (let b = 0; b < batches; b++) {
      const batchCount = Math.min(BATCH_SIZE, budget - chunkAdded);
      if (batchCount <= 0) break;
      try {
        const questions = await generateBattleQuestions(
          courseId, apiKey, batchCount, [chapter], POOL_DIFFICULTY, generatedTexts,
          chunk.content ?? undefined, // null이면 undefined → generator가 직접 scope 로드
        );
        const saved = await saveQuestions(questions, chunk.subChapter, `${i}_${b}`);
        chunkAdded += saved;
        totalAdded += saved;
      } catch (err) {
        console.error(`[풀] ${courseId}/ch${chapter}/${chunk.label} 배치${b} 실패:`, err);
      }
      if (b < batches - 1) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
    console.log(`[풀] ${courseId}/ch${chapter}/${chunk.label}: ${chunkAdded}/${budget}문제`);

    // 청크 간 대기 (마지막 제외)
    if (i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log(`[풀] ${courseId}/ch${chapter}: 총 ${totalAdded}문제 생성 (목표 ${targetSize}, 청크 ${chunks.length}개)`);
  return { added: totalAdded };
}

// ── 풀에서 문제 추출 ──

/**
 * 풀에서 문제 추출 (중복 방지)
 *
 * - 선택 챕터만 Firestore 쿼리로 로드
 * - 양쪽 플레이어의 최근 24시간 seenQuestions 제외
 * - 챕터별 라운드 로빈으로 균등 분배
 * - 부족 시 null 반환
 */
export async function drawQuestionsFromPool(
  courseId: string,
  playerIds: string[],
  count: number = 10,
  chapters?: string[]
): Promise<GeneratedQuestion[] | null> {
  const db = getFirestore();
  const poolRef = db.collection("tekkenQuestionPool").doc(courseId);
  const questionsRef = poolRef.collection("questions");
  const seenRef = poolRef.collection("seenQuestions");

  // 1. 풀 조회 (챕터 필터)
  const seenQuestionIds = new Set<string>();
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  // 챕터 필터 (기존 접두사 데이터 호환: "3" + "bio_3" 모두 매칭)
  const chapterPrefixMap: Record<string, string> = {
    biology: "bio_", microbiology: "micro_", pathophysiology: "patho_",
  };
  let poolQuery: FirebaseFirestore.Query = questionsRef;
  if (chapters && chapters.length > 0) {
    const pfx = chapterPrefixMap[courseId] || "";
    const allFormats = [...chapters];
    if (pfx) {
      for (const ch of chapters) {
        if (!ch.startsWith(pfx)) allFormats.push(`${pfx}${ch}`);
      }
    }
    poolQuery = questionsRef.where("chapter", "in", allFormats);
  }

  const [poolSnap, ...seenSnaps] = await Promise.all([
    poolQuery.get(),
    ...playerIds.map(pid =>
      seenRef.where("userId", "==", pid).get()
    ),
  ]);
  if (poolSnap.empty) return null;

  for (const seenSnap of seenSnaps) {
    for (const doc of seenSnap.docs) {
      const data = doc.data();
      const seenAt = data.seenAt?.toMillis?.() || 0;
      if (seenAt < oneDayAgo) continue;
      const ids = data.questionIds as string[] | undefined;
      if (ids) {
        ids.forEach((id: string) => seenQuestionIds.add(id));
      }
    }
  }

  // 2. 미시청 문제 필터링
  let available = poolSnap.docs.filter(doc => !seenQuestionIds.has(doc.id));

  if (available.length < count) {
    if (available.length < 5) {
      console.log(`미시청 문제 부족 (${available.length}개) — seen 초기화 후 재사용`);
      const oldSeenSnaps = await Promise.all(
        playerIds.map(pid => seenRef.where("userId", "==", pid).get())
      );
      const resetBatch = db.batch();
      for (const snap of oldSeenSnaps) {
        snap.docs.forEach(doc => resetBatch.delete(doc.ref));
      }
      await resetBatch.commit();
      available = [...poolSnap.docs];
      for (let i = available.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [available[i], available[j]] = [available[j], available[i]];
      }
    }
  }

  // 3. 난이도별 분류 + 셔플
  const byDifficulty: Record<string, typeof available> = { easy: [], medium: [], hard: [] };
  for (const doc of available) {
    const diff = doc.data().difficulty || "medium";
    if (byDifficulty[diff]) {
      byDifficulty[diff].push(doc);
    } else {
      byDifficulty["medium"].push(doc);
    }
  }

  for (const key of Object.keys(byDifficulty)) {
    const arr = byDifficulty[key];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /** 챕터 균등 분배 선택 — 라운드 로빈 */
  const pickBalanced = (
    pool: typeof available,
    targetCount: number,
    usedIds: Set<string>
  ): typeof available => {
    const byChapter: Record<string, typeof available> = {};
    for (const doc of pool) {
      if (usedIds.has(doc.id)) continue;
      const chapter = doc.data().chapter || "unknown";
      if (!byChapter[chapter]) byChapter[chapter] = [];
      byChapter[chapter].push(doc);
    }

    const chapterKeys = Object.keys(byChapter);
    for (let i = chapterKeys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chapterKeys[i], chapterKeys[j]] = [chapterKeys[j], chapterKeys[i]];
    }

    const result: typeof available = [];
    const chapterIdx: Record<string, number> = {};
    for (const ch of chapterKeys) chapterIdx[ch] = 0;

    while (result.length < targetCount) {
      let pickedThisRound = false;
      for (const ch of chapterKeys) {
        if (result.length >= targetCount) break;
        const docs = byChapter[ch];
        if (chapterIdx[ch] < docs.length) {
          result.push(docs[chapterIdx[ch]]);
          usedIds.add(docs[chapterIdx[ch]].id);
          chapterIdx[ch]++;
          pickedThisRound = true;
        }
      }
      if (!pickedThisRound) break;
    }
    return result;
  };

  const targets = [
    { difficulty: "medium", count: 10 },
  ];

  const selected: typeof available = [];
  const usedIds = new Set<string>();

  for (const target of targets) {
    const pool = byDifficulty[target.difficulty];
    const picked = pickBalanced(pool, target.count, usedIds);
    selected.push(...picked);

    if (picked.length < target.count) {
      let need = target.count - picked.length;
      for (const doc of available) {
        if (need <= 0) break;
        if (usedIds.has(doc.id)) continue;
        selected.push(doc);
        usedIds.add(doc.id);
        need--;
      }
    }
  }

  if (selected.length < 5) return null;

  // 4. seenQuestions 기록
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

  // 5. 반환 (챕터 접두사 추가)
  const chapterPrefix: Record<string, string> = {
    biology: "bio_",
    microbiology: "micro_",
    pathophysiology: "patho_",
  };
  const prefix = chapterPrefix[courseId] || "";

  // 챕터 폴백: 풀에 chapter 필드가 없는 문제 대비
  const fallbackChapter = chapters && chapters.length > 0
    ? (prefix && !chapters[0].startsWith(prefix) ? `${prefix}${chapters[0]}` : chapters[0])
    : "";

  return selected.map(doc => {
    const data = doc.data();
    let chapterId = data.chapter || "";
    if (chapterId && prefix && !chapterId.startsWith(prefix)) {
      chapterId = `${prefix}${chapterId}`;
    }
    // chapterId가 없으면 요청 챕터로 폴백 (미분류 방지)
    if (!chapterId) chapterId = fallbackChapter;
    return {
      text: data.text,
      type: data.type,
      choices: data.choices,
      correctAnswer: data.correctAnswer,
      difficulty: data.difficulty,
      ...(data.explanation ? { explanation: data.explanation } : {}),
      ...(data.choiceExplanations ? { choiceExplanations: data.choiceExplanations } : {}),
      chapterId,
    };
  });
}

// ── 스케줄러 (디스패처) ──

/**
 * 매일 새벽 3시 KST — 챕터별 태스크 디스패치
 *
 * 전 챕터 × 현재 학기 과목에 대해 tekkenPoolTasks 문서 생성
 * → onDocumentCreated 워커가 병렬로 처리 (maxInstances: 5)
 */
export const tekkenPoolRefillScheduled = onSchedule(
  {
    schedule: "0 3 1 * *",  // 월 1회 (1일)
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
    timeoutSeconds: 120,
    memory: "256MiB",
  },
  async () => {
    const db = getFirestore();
    const courses = getCurrentSemesterCourses();
    console.log(`[스케줄] 챕터별 태스크 디스패치 — 과목: ${courses.join(", ")}`);

    const tasks: Promise<FirebaseFirestore.DocumentReference>[] = [];

    for (const courseId of courses) {
      const chapters = getTekkenChapters(courseId);
      console.log(`[스케줄] ${courseId}: ${chapters.length}챕터 × ${TARGET_PER_CHAPTER}문제`);

      for (const chapter of chapters) {
        const task: TekkenPoolTask = {
          courseId,
          chapter,
          status: "pending",
          targetSize: TARGET_PER_CHAPTER,
          createdAt: Date.now(),
        };
        tasks.push(db.collection("tekkenPoolTasks").add(task));
      }
    }

    const results = await Promise.allSettled(tasks);
    const created = results.filter(r => r.status === "fulfilled").length;
    console.log(`[스케줄] ${created}개 태스크 생성 완료`);
  }
);

// ── 워커 (챕터별 문제 생성) ──

/**
 * 챕터별 풀 생성 워커
 *
 * tekkenPoolTasks/{taskId} 생성 시 트리거
 * 무중단 교체: 새 문제 생성 → 기존 문제 삭제
 */
export const tekkenPoolWorker = onDocumentCreated(
  {
    document: "tekkenPoolTasks/{taskId}",
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 5,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const task = snap.data() as TekkenPoolTask;
    const { courseId, chapter, targetSize } = task;
    const taskRef = snap.ref;

    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      await taskRef.update({ status: "failed", error: "GEMINI_API_KEY 미설정" });
      return;
    }

    // 상태: processing
    await taskRef.update({ status: "processing" });

    const db = getFirestore();
    const poolRef = db.collection("tekkenQuestionPool").doc(courseId);
    const questionsRef = poolRef.collection("questions");

    try {
      // runId로 old/new 구분 (old ID 캡처 방식의 race condition 방지)
      const runId = `run_${Date.now()}_${courseId}_ch${chapter}`;

      console.log(`[워커] ${courseId}/ch${chapter}: 새 ${targetSize}개 생성 시작 (runId: ${runId})`);

      // 1. 새 문제 생성 (기존 풀과 공존, 모두 runId 태그)
      const result = await replenishChapterPool(courseId, chapter, apiKey, targetSize, runId);

      // 2. 이 챕터의 runId가 아닌 문제 삭제 (무중단 교체)
      const chapterPfxMap: Record<string, string> = {
        biology: "bio_", microbiology: "micro_", pathophysiology: "patho_",
      };
      const pfx = chapterPfxMap[courseId] || "";
      const chapterFormats = [chapter];
      if (pfx) chapterFormats.push(`${pfx}${chapter}`);

      const existingSnaps = await Promise.all(
        chapterFormats.map(ch => questionsRef.where("chapter", "==", ch).get())
      );
      // 구형 하위섹션 형식 (e.g., "micro_3_1", "micro_3_2", ...) 추가 스캔
      let legacySnap: FirebaseFirestore.QuerySnapshot | null = null;
      if (pfx) {
        legacySnap = await questionsRef
          .where("chapter", ">=", `${pfx}${chapter}_`)
          .where("chapter", "<", `${pfx}${chapter}_~`)
          .get();
      }
      // runId가 다른(=old) 문서만 삭제
      const oldDocs = [
        ...existingSnaps.flatMap(snap => snap.docs),
        ...(legacySnap ? legacySnap.docs : []),
      ].filter(doc => doc.data().runId !== runId);

      if (oldDocs.length > 0) {
        for (let i = 0; i < oldDocs.length; i += 500) {
          const batch = db.batch();
          oldDocs.slice(i, i + 500).forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        }
      }
      console.log(`[워커] ${courseId}/ch${chapter}: old ${oldDocs.length}개 삭제`);

      // 4. seenQuestions 중 이 챕터 관련은 자연 만료 (24시간)

      // 5. 메타 업데이트
      const totalSnap = await questionsRef.count().get();
      await poolRef.set({
        totalQuestions: totalSnap.data().count,
        lastRefreshedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      // 6. 태스크 완료
      await taskRef.update({
        status: "completed",
        completedAt: Date.now(),
        addedCount: result.added,
      });

      console.log(`[워커] ${courseId}/ch${chapter}: ${result.added}문제 생성 완료, old ${oldDocs.length}개 삭제`);
    } catch (err) {
      console.error(`[워커] ${courseId}/ch${chapter} 실패:`, err);
      await taskRef.update({
        status: "failed",
        error: String(err),
      });
    }
  }
);

// ── 교수 수동 풀 초기화 ──

/**
 * Callable CF: 교수 수동 풀 초기화
 * 전체 챕터에 대해 태스크 디스패치
 */
export const tekkenPoolRefill = onCall(
  {
    region: "asia-northeast3",
    timeoutSeconds: 60,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const db = getFirestore();
    const { courseId } = request.data as { courseId: string };

    await verifyProfessorAccess(request.auth.uid, courseId);
    if (!courseId || !getAllCourses().includes(courseId)) {
      throw new HttpsError("invalid-argument", "유효한 courseId가 필요합니다.");
    }

    const chapters = getTekkenChapters(courseId);
    const tasks: Promise<FirebaseFirestore.DocumentReference>[] = [];

    for (const chapter of chapters) {
      const task: TekkenPoolTask = {
        courseId,
        chapter,
        status: "pending",
        targetSize: TARGET_PER_CHAPTER,
        createdAt: Date.now(),
      };
      tasks.push(db.collection("tekkenPoolTasks").add(task));
    }

    await Promise.all(tasks);

    console.log(`[수동] ${courseId}: ${chapters.length}챕터 태스크 디스패치 완료`);

    return {
      success: true,
      chaptersDispatched: chapters.length,
    };
  }
);
