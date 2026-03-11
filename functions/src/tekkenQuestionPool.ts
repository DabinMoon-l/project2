/**
 * 철권퀴즈 문제 풀 사전 생성 시스템
 *
 * - 야간 스케줄(매일 새벽 3시)로 문제를 미리 Firestore에 저장
 * - 배틀 시 풀에서 즉시 뽑아 사용 (Gemini 대기 제거)
 * - 같은 유저가 연속 배틀에서 동일 문제를 보지 않도록 seenQuestions 관리
 *
 * Firestore 구조:
 *   tekkenQuestionPool/{courseId}                    — 메타 문서
 *   tekkenQuestionPool/{courseId}/questions/{qId}    — 개별 문제
 *   tekkenQuestionPool/{courseId}/seenQuestions/{id}  — 유저별 본 문제 기록
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import {
  generateBattleQuestions,
  getTekkenChapters,
  COURSE_NAMES,
  type GeneratedQuestion,
} from "./tekkenBattle";
import type { TekkenDifficulty } from "./tekken/tekkenTypes";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// 과목 목록 (순환 의존성으로 모듈 초기화 시 COURSE_NAMES가 undefined → 지연 평가)
const getAllCourses = () => Object.keys(COURSE_NAMES);

/**
 * 현재 학기 과목만 반환
 * 1학기 (02-22 ~ 08-21): biology, microbiology
 * 2학기 (08-22 ~ 02-21): pathophysiology만
 * (생물학은 1학기 전용 과목)
 */
function getCurrentSemesterCourses(): string[] {
  const now = new Date();
  const month = now.getMonth() + 1; // 1~12
  const day = now.getDate();

  // 1학기: 2/22 ~ 8/21
  const isSemester1 =
    (month > 2 || (month === 2 && day >= 22)) &&
    (month < 8 || (month === 8 && day <= 21));

  if (isSemester1) {
    return ["biology", "microbiology"];
  }
  // 2학기: 8/22 ~ 2/21 (병태생리학만)
  return ["pathophysiology"];
}

/**
 * 과목별 챕터 조회
 * 교수 설정(settings/tekken/courses/{courseId}) 우선 사용
 */
async function getSeasonalChapters(courseId: string): Promise<string[]> {
  const chapters = await getTekkenChapters(courseId);
  console.log(`[챕터] ${courseId}: ${chapters.join(",")}`);
  return chapters;
}

/**
 * 배틀 10문제 난이도 배분: easy 5 + medium 5
 * 풀 생성 시에도 이 비율로 생성 (300문제 = easy 150 + medium 150)
 * hard 제거: Gemini 구조화 출력 실패율이 높아 풀 미달 → 배틀 로딩 지연 원인
 */
const DIFFICULTY_DISTRIBUTION: { difficulty: TekkenDifficulty; ratio: number }[] = [
  { difficulty: "easy", ratio: 0.5 },
  { difficulty: "medium", ratio: 0.5 },
];

// 풀 목표 크기 (매일 초기화 후 새로 생성)
const TARGET_POOL_SIZE = 300;
// 문제 유효 기간 (1일 — 매일 새벽 초기화)
const QUESTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// 배치당 문제 수 (풍부한 프롬프트로 토큰 증가 → 10개로 축소)
const BATCH_SIZE = 10;
// 배치 간 대기 (6초 — RPM 10 무료 제한 준수)
const BATCH_DELAY_MS = 6000;
// 목표 미달 시 보충 라운드 최대 횟수 (easy/medium만이므로 실패율 매우 낮음)
const MAX_SUPPLEMENT_ROUNDS = 5;

/**
 * 문제 풀 보충 — 챕터별 배치 분리 방식
 *
 * 핵심: "모든 챕터에서 20문제"가 아니라 "2장에서 15문제", "3장에서 15문제" 식으로
 * 챕터 1개당 1배치로 생성 → 챕터 간 주제 중복 원천 차단
 *
 * - 챕터 1은 과목별 2~4문제만 (역사/개론 → 중요도 낮음)
 * - 미생물학 1장은 코흐(Koch)만
 * - 보충 라운드에서 부족분은 주요 챕터에서 추가 생성
 */
export async function replenishQuestionPool(
  courseId: string,
  apiKey: string,
  targetSize: number = TARGET_POOL_SIZE
): Promise<{ added: number; deleted: number }> {
  const db = getFirestore();
  const poolRef = db.collection("tekkenQuestionPool").doc(courseId);
  const questionsRef = poolRef.collection("questions");

  // 1. 만료 문제 삭제
  const expiredThreshold = Timestamp.fromMillis(Date.now() - QUESTION_MAX_AGE_MS);
  const expiredSnap = await questionsRef
    .where("generatedAt", "<", expiredThreshold)
    .get();

  let deleted = 0;
  if (!expiredSnap.empty) {
    const batch = db.batch();
    for (const doc of expiredSnap.docs) {
      batch.delete(doc.ref);
      deleted++;
    }
    await batch.commit();
  }

  // 2. 현재 풀 크기 확인
  const initialSnap = await questionsRef.count().get();
  const initialCount = initialSnap.data().count;

  if (initialCount >= targetSize) {
    await poolRef.set({
      totalQuestions: initialCount,
      lastRefreshedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { added: 0, deleted };
  }

  // 3. 챕터 조회 + 분류
  const chapters = await getSeasonalChapters(courseId);
  const mainChapters = chapters.filter(c => c !== "1");
  const hasChapter1 = chapters.includes("1");

  // 챕터 1 예산: easy 2 + medium 2 = 4문제 (0~1문제만 배틀에 나오도록 풀에 소량만)
  const CH1_BUDGET = hasChapter1 ? 4 : 0;
  const mainBudget = targetSize - initialCount - CH1_BUDGET;

  let totalAdded = 0;

  // 중복 방지: 이번 세션에서 생성된 문제 텍스트 추적
  const generatedTexts: string[] = [];

  // Firestore 배치 저장 헬퍼 (해설 없는 문제 필터링)
  const saveQuestions = async (
    questions: GeneratedQuestion[],
    difficulty: TekkenDifficulty,
    chapter: string,
    batchLabel: string,
  ) => {
    if (questions.length === 0) return 0;
    // 해설 + 선지별해설 모두 있는 문제만 저장 (복습 오답 품질 보장)
    const withExplanation = questions.filter(
      q => q.explanation && q.choiceExplanations && q.choiceExplanations.length > 0
    );
    if (withExplanation.length < questions.length) {
      console.log(`[풀] ${courseId}/ch${chapter}/${difficulty}: 해설 없는 문제 ${questions.length - withExplanation.length}개 제외`);
    }
    if (withExplanation.length === 0) return 0;

    const writeBatch = db.batch();
    const batchId = `${Date.now()}_${difficulty}_ch${chapter}_${batchLabel}`;
    for (const q of withExplanation) {
      const docRef = questionsRef.doc();
      writeBatch.set(docRef, {
        text: q.text,
        type: q.type,
        choices: q.choices,
        correctAnswer: q.correctAnswer,
        difficulty: q.difficulty || difficulty,
        chapter: q.chapterId || chapter,
        chapters,
        generatedAt: FieldValue.serverTimestamp(),
        batchId,
        explanation: q.explanation,
        choiceExplanations: q.choiceExplanations,
      });
      // 중복 방지용 텍스트 기록
      generatedTexts.push(q.text);
    }
    await writeBatch.commit();
    return withExplanation.length;
  };

  // 4. 챕터별 배치 생성 (챕터 1개 = 1 Gemini 호출)
  for (const { difficulty, ratio } of DIFFICULTY_DISTRIBUTION) {
    const difficultyBudget = Math.round(mainBudget * ratio);
    if (difficultyBudget <= 0) continue;

    // 각 챕터에 균등 배분
    const perChapter = Math.ceil(difficultyBudget / mainChapters.length);
    let difficultyAdded = 0;

    for (const chapter of mainChapters) {
      const count = Math.min(perChapter, difficultyBudget - difficultyAdded);
      if (count <= 0) break;

      // 한 챕터에서 BATCH_SIZE 초과 시 분할
      const batches = Math.ceil(count / BATCH_SIZE);
      for (let b = 0; b < batches; b++) {
        const batchCount = Math.min(BATCH_SIZE, count - b * BATCH_SIZE);
        if (batchCount <= 0) break;

        try {
          const questions = await generateBattleQuestions(
            courseId, apiKey, batchCount, [chapter], difficulty, generatedTexts
          );
          const saved = await saveQuestions(questions, difficulty, chapter, `${b}`);
          difficultyAdded += saved;
          totalAdded += saved;
        } catch (err) {
          console.error(`[풀] ${courseId}/${difficulty}/ch${chapter} 실패:`, err);
        }

        // 배치 간 대기
        if (b < batches - 1) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      // 챕터 간 대기 (RPM 준수)
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }

    console.log(`[풀] ${courseId}/${difficulty}: ${difficultyAdded}문제 생성 (챕터별 분리)`);

    // 챕터 1 소량 생성
    if (hasChapter1) {
      const ch1Count = Math.round(CH1_BUDGET * ratio); // easy 2, medium 2
      if (ch1Count > 0) {
        try {
          const questions = await generateBattleQuestions(
            courseId, apiKey, ch1Count, ["1"], difficulty, generatedTexts
          );
          const saved = await saveQuestions(questions, difficulty, "1", "ch1");
          totalAdded += saved;
        } catch (err) {
          console.error(`[풀] ${courseId}/${difficulty}/ch1 실패 (무시):`, err);
        }
      }
    }
  }

  // 5. 보충 라운드 — 목표 미달 시 부족분을 주요 챕터에서 추가
  for (let round = 1; round <= MAX_SUPPLEMENT_ROUNDS; round++) {
    const remaining = targetSize - initialCount - totalAdded;
    if (remaining <= 0) break;

    console.log(`[풀 보충] ${courseId}: 라운드 ${round} — 부족분 ${remaining}개`);

    for (const { difficulty, ratio } of DIFFICULTY_DISTRIBUTION) {
      const supplementTarget = Math.round(remaining * ratio);
      if (supplementTarget <= 0) continue;

      // 부족분을 주요 챕터에 라운드 로빈 배분
      let supplementAdded = 0;
      let chIdx = 0;
      while (supplementAdded < supplementTarget && chIdx < mainChapters.length) {
        const chapter = mainChapters[chIdx % mainChapters.length];
        const count = Math.min(BATCH_SIZE, supplementTarget - supplementAdded);

        try {
          const questions = await generateBattleQuestions(
            courseId, apiKey, count, [chapter], difficulty, generatedTexts
          );
          const saved = await saveQuestions(questions, difficulty, chapter, `s${round}`);
          supplementAdded += saved;
          totalAdded += saved;
        } catch (err) {
          console.error(`[보충] ${courseId}/${difficulty}/ch${chapter}/r${round} 실패:`, err);
        }
        chIdx++;

        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
  }

  // 6. 메타 문서 업데이트
  const finalTotal = initialCount + totalAdded;
  await poolRef.set({
    totalQuestions: finalTotal,
    lastRefreshedAt: FieldValue.serverTimestamp(),
    chapters,
  }, { merge: true });

  console.log(`문제 풀 보충 완료 (${courseId}): 추가 ${totalAdded}개, 삭제 ${deleted}개, 총 ${finalTotal}개`);

  if (finalTotal < targetSize) {
    console.warn(`[경고] ${courseId}: 목표 미달 (${finalTotal}/${targetSize}) — ${targetSize - finalTotal}개 부족`);
  }

  return { added: totalAdded, deleted };
}

/**
 * 풀에서 문제 추출 (중복 방지)
 *
 * - 풀 전체 조회 (60문서 이하이므로 전체 로드)
 * - 양쪽 플레이어의 최근 24시간 seenQuestions 제외
 * - 부족 시 null 반환 (호출자가 Gemini 폴백)
 */
export async function drawQuestionsFromPool(
  courseId: string,
  playerIds: string[],
  count: number = 10
): Promise<GeneratedQuestion[] | null> {
  const db = getFirestore();
  const poolRef = db.collection("tekkenQuestionPool").doc(courseId);
  const questionsRef = poolRef.collection("questions");
  const seenRef = poolRef.collection("seenQuestions");

  // 1. 풀 전체 + seenQuestions 병렬 조회
  const seenQuestionIds = new Set<string>();

  // userId 단일 필드 쿼리 — 복합 인덱스 불필요, seenAt은 코드에서 필터
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const [poolSnap, ...seenSnaps] = await Promise.all([
    questionsRef.get(),
    ...playerIds.map(pid =>
      seenRef.where("userId", "==", pid).get()
    ),
  ]);
  if (poolSnap.empty) return null;

  for (const seenSnap of seenSnaps) {
    for (const doc of seenSnap.docs) {
      const data = doc.data();
      // seenAt 필터 (코드에서 24시간 체크 — 복합 인덱스 불필요)
      const seenAt = data.seenAt?.toMillis?.() || 0;
      if (seenAt < oneDayAgo) continue;
      const ids = data.questionIds as string[] | undefined;
      if (ids) {
        ids.forEach((id: string) => seenQuestionIds.add(id));
      }
    }
  }

  // 3. 미시청 문제 필터링
  let available = poolSnap.docs.filter(doc => !seenQuestionIds.has(doc.id));

  if (available.length < count) {
    if (available.length < 5) {
      // 5문제 미만 → seen 기록 초기화 후 전체 풀에서 재시도 (헤비 유저 대응)
      console.log(`미시청 문제 부족 (${available.length}개) — seen 초기화 후 재사용`);
      const oldSeenSnaps = await Promise.all(
        playerIds.map(pid => seenRef.where("userId", "==", pid).get())
      );
      const resetBatch = db.batch();
      for (const snap of oldSeenSnaps) {
        snap.docs.forEach(doc => resetBatch.delete(doc.ref));
      }
      await resetBatch.commit();
      // 초기화 후 전체 풀 사용 (Fisher-Yates 셔플)
      available = [...poolSnap.docs];
      for (let i = available.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [available[i], available[j]] = [available[j], available[i]];
      }
    }
  }

  // 4. 난이도별 + 챕터별 분류
  const byDifficulty: Record<string, typeof available> = { easy: [], medium: [], hard: [] };
  for (const doc of available) {
    const diff = doc.data().difficulty || "medium";
    if (byDifficulty[diff]) {
      byDifficulty[diff].push(doc);
    } else {
      byDifficulty["medium"].push(doc); // 알 수 없는 난이도 → medium
    }
  }

  // 각 난이도 Fisher-Yates 셔플
  for (const key of Object.keys(byDifficulty)) {
    const arr = byDifficulty[key];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /**
   * 챕터 균등 분배 선택 헬퍼
   * 난이도 풀에서 챕터별 라운드 로빈으로 선택 → 모든 챕터 골고루 커버
   */
  const pickBalanced = (
    pool: typeof available,
    targetCount: number,
    usedIds: Set<string>
  ): typeof available => {
    // 챕터별 그룹핑
    const byChapter: Record<string, typeof available> = {};
    for (const doc of pool) {
      if (usedIds.has(doc.id)) continue;
      const chapter = doc.data().chapter || "unknown";
      if (!byChapter[chapter]) byChapter[chapter] = [];
      byChapter[chapter].push(doc);
    }

    // 챕터 목록 셔플 (시작 챕터 랜덤화)
    const chapterKeys = Object.keys(byChapter);
    for (let i = chapterKeys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chapterKeys[i], chapterKeys[j]] = [chapterKeys[j], chapterKeys[i]];
    }

    // 라운드 로빈: 각 챕터에서 1개씩 순환
    const result: typeof available = [];
    const chapterIdx: Record<string, number> = {};
    for (const ch of chapterKeys) chapterIdx[ch] = 0;

    let round = 0;
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
      if (!pickedThisRound) break; // 모든 챕터 소진
      round++;
    }
    return result;
  };

  // easy 5 → medium 5 (챕터 균등 분배)
  const targets = [
    { difficulty: "easy", count: 5 },
    { difficulty: "medium", count: 5 },
  ];

  const selected: typeof available = [];
  const usedIds = new Set<string>();

  for (const target of targets) {
    const pool = byDifficulty[target.difficulty];
    const picked = pickBalanced(pool, target.count, usedIds);
    selected.push(...picked);

    // 부족하면 다른 난이도에서 보충
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

  if (selected.length < 5) return null; // 최소 5문제 확보 불가

  // 5. seenQuestions 기록
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

  // 6. 문제 데이터 반환 (해설+선지별해설+챕터 포함)
  // 풀의 chapter는 순수 번호("3")지만 클라이언트 courseIndex는 접두사 형식("bio_3")
  const chapterPrefix: Record<string, string> = {
    biology: "bio_",
    microbiology: "micro_",
    pathophysiology: "patho_",
  };
  const prefix = chapterPrefix[courseId] || "";

  return selected.map(doc => {
    const data = doc.data();
    // 이미 접두사가 있으면 그대로, 없으면 붙여줌
    let chapterId = data.chapter || "";
    if (chapterId && prefix && !chapterId.startsWith(prefix)) {
      chapterId = `${prefix}${chapterId}`;
    }
    return {
      text: data.text,
      type: data.type,
      choices: data.choices,
      correctAnswer: data.correctAnswer,
      difficulty: data.difficulty,
      ...(data.explanation ? { explanation: data.explanation } : {}),
      ...(data.choiceExplanations ? { choiceExplanations: data.choiceExplanations } : {}),
      ...(chapterId ? { chapterId } : {}),
    };
  });
}

/**
 * 단일 과목 문제 풀 초기화 + 재생성 (내부 헬퍼)
 */
async function refreshPoolForCourse(courseId: string, apiKey: string): Promise<void> {
  const db = getFirestore();
  const poolRef = db.collection("tekkenQuestionPool").doc(courseId);
  const questionsRef = poolRef.collection("questions");

  // 기존 문제 풀 + seenQuestions 병렬 조회 → 병렬 배치 삭제
  const [existingSnap, seenSnap] = await Promise.all([
    questionsRef.get(),
    poolRef.collection("seenQuestions").get(),
  ]);

  // 배치 삭제 (500개씩 청크 → 병렬 커밋)
  const deleteBatches = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
    const batches: Promise<void>[] = [];
    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      docs.slice(i, i + 500).forEach(doc => batch.delete(doc.ref));
      batches.push(batch.commit().then(() => {}));
    }
    return Promise.all(batches);
  };

  await Promise.all([
    existingSnap.empty ? Promise.resolve([]) : deleteBatches(existingSnap.docs),
    seenSnap.empty ? Promise.resolve([]) : deleteBatches(seenSnap.docs),
  ]);

  if (!existingSnap.empty) {
    console.log(`[스케줄] ${courseId}: 기존 ${existingSnap.size}개 삭제`);
  }

  // 300문제 새로 생성 (보충 루프 포함)
  const result = await replenishQuestionPool(courseId, apiKey);
  console.log(`[스케줄] ${courseId}: 새로 ${result.added}개 생성`);
}

/**
 * 스케줄 CF: 매일 새벽 3시 KST 문제 풀 초기화
 *
 * 각 과목을 병렬로 실행 → 타임아웃 격리 + 속도 향상
 * 과목당 독립 실행이므로 한 과목 실패가 다른 과목에 영향 안 줌
 */
export const tekkenPoolRefillScheduled = onSchedule(
  {
    schedule: "0 3 * * *", // 매일 03:00 KST
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 540, // 9분 (과목별 병렬 처리)
    memory: "1GiB",
  },
  async () => {
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      console.error("GEMINI_API_KEY가 설정되지 않았습니다.");
      return;
    }

    // 현재 학기 과목만 생성 (1학기: biology+microbiology, 2학기: pathophysiology만)
    const courses = getCurrentSemesterCourses();
    console.log(`[스케줄] 매일 초기화 시작 — 과목: ${courses.join(", ")}`);

    // 과목별 병렬 실행 (각 과목이 독립적으로 처리)
    const results = await Promise.allSettled(
      courses.map(courseId => refreshPoolForCourse(courseId, apiKey))
    );

    // 결과 로깅
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        console.error(`[스케줄] ${courses[i]} 풀 생성 실패:`, result.reason);
      }
    });
  }
);

/**
 * Callable CF: 교수 수동 풀 초기화/재생성
 * 챕터 변경 시 기존 풀 전체 삭제 + 새 챕터로 재생성
 */
export const tekkenPoolRefill = onCall(
  {
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 300, // 5분
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    // 교수 권한 확인
    const db = getFirestore();
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 실행 가능합니다.");
    }

    const { courseId } = request.data as { courseId: string };
    if (!courseId || !getAllCourses().includes(courseId)) {
      throw new HttpsError("invalid-argument", "유효한 courseId가 필요합니다.");
    }

    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError("internal", "GEMINI_API_KEY가 설정되지 않았습니다.");
    }

    // 기존 풀 전체 삭제
    const poolRef = db.collection("tekkenQuestionPool").doc(courseId);
    const questionsRef = poolRef.collection("questions");
    const existingSnap = await questionsRef.get();

    if (!existingSnap.empty) {
      // 500개씩 batch 삭제
      const chunks: FirebaseFirestore.DocumentReference[] = [];
      existingSnap.docs.forEach(doc => chunks.push(doc.ref));

      for (let i = 0; i < chunks.length; i += 500) {
        const batch = db.batch();
        chunks.slice(i, i + 500).forEach(ref => batch.delete(ref));
        await batch.commit();
      }
    }

    // seenQuestions도 전체 삭제 (챕터 변경으로 문제가 완전히 바뀌므로)
    const seenRef = poolRef.collection("seenQuestions");
    const seenSnap = await seenRef.get();
    if (!seenSnap.empty) {
      const batch = db.batch();
      seenSnap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    // 새로 채우기
    const result = await replenishQuestionPool(courseId, apiKey);

    console.log(`[수동] ${courseId} 풀 초기화: 기존 ${existingSnap.size}개 삭제, 새로 ${result.added}개 생성`);

    return {
      success: true,
      deleted: existingSnap.size,
      added: result.added,
    };
  }
);
