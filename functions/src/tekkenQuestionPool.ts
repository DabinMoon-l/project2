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
 * 2학기 (08-22 ~ 02-21): biology, pathophysiology
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
  // 2학기: 8/22 ~ 2/21
  return ["biology", "pathophysiology"];
}

/**
 * 현재 시험 시즌 판별
 * 1학기 중간: 3~4월, 1학기 기말: 5~6월
 * 2학기 중간: 9~10월, 2학기 기말: 11~12월
 * 나머지(1~2월, 7~8월): 기말 범위 유지 (방학 중)
 */
type ExamSeason = "midterm" | "final";

function getDefaultExamSeason(): ExamSeason {
  const month = new Date().getMonth() + 1;
  // 중간고사: 3~4월, 9~10월
  if ([3, 4, 9, 10].includes(month)) return "midterm";
  // 기말고사: 5~6월, 11~12월, 1~2월(방학), 7~8월(방학)
  return "final";
}

/** Firestore settings/tekken.examSeason 수동 설정 우선, 없으면 월 기반 자동 판별 */
async function getCurrentExamSeason(): Promise<ExamSeason> {
  try {
    const snap = await getFirestore().doc("settings/tekken").get();
    const manual = snap.data()?.examSeason;
    if (manual === "midterm" || manual === "final") return manual;
  } catch {
    // Firestore 오류 시 자동 판별로 fallback
  }
  return getDefaultExamSeason();
}

/**
 * 미생물학 시험 시즌별 챕터 매핑
 * - 중간고사: 1장(코흐), 2장(면역), 3장(감염), 4장(세균), 5장(병원성 세균)
 * - 기말고사: 6장(바이러스 일반), 7장(병원성 바이러스), 8장(진균 일반), 9장(병원성 진균), 10장(원충), 11장(감염병 예방)
 */
const MICRO_EXAM_CHAPTERS: Record<ExamSeason, string[]> = {
  midterm: ["1", "2", "3", "4", "5"],
  final: ["6", "7", "8", "9", "10", "11"],
};

/**
 * 과목별 시험 시즌 챕터 조회
 * 미생물학만 시즌별 분리, 나머지는 교수 설정(getTekkenChapters) 사용
 */
async function getSeasonalChapters(courseId: string): Promise<string[]> {
  if (courseId === "microbiology") {
    const season = await getCurrentExamSeason();
    console.log(`[시즌] 미생물학 시험 시즌: ${season} → 챕터: ${MICRO_EXAM_CHAPTERS[season].join(",")}`);
    return MICRO_EXAM_CHAPTERS[season];
  }
  return getTekkenChapters(courseId);
}

/**
 * 배틀 10문제 난이도 배분: easy 4 + medium 4 + hard 2
 * 풀 생성 시에도 이 비율로 생성 (300문제 = easy 120 + medium 120 + hard 60)
 */
const DIFFICULTY_DISTRIBUTION: { difficulty: TekkenDifficulty; ratio: number }[] = [
  { difficulty: "easy", ratio: 0.4 },
  { difficulty: "medium", ratio: 0.4 },
  { difficulty: "hard", ratio: 0.2 },
];

// 풀 목표 크기 (매일 초기화 후 새로 생성)
const TARGET_POOL_SIZE = 300;
// 문제 유효 기간 (1일 — 매일 새벽 초기화)
const QUESTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// 배치당 문제 수
const BATCH_SIZE = 15;
// 배치 간 대기 (2초)
const BATCH_DELAY_MS = 2000;

/**
 * 문제 풀 보충
 * - 7일 지난 문제 삭제
 * - 현재 풀 크기 확인 → 부족분만큼 Gemini 호출
 */
export async function replenishQuestionPool(
  courseId: string,
  apiKey: string,
  targetSize: number = TARGET_POOL_SIZE
): Promise<{ added: number; deleted: number }> {
  const db = getFirestore();
  const poolRef = db.collection("tekkenQuestionPool").doc(courseId);
  const questionsRef = poolRef.collection("questions");

  // 1. 7일 지난 문제 삭제
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
  const currentSnap = await questionsRef.count().get();
  const currentCount = currentSnap.data().count;
  const needed = targetSize - currentCount;

  if (needed <= 0) {
    // 메타 문서 업데이트
    await poolRef.set({
      totalQuestions: currentCount,
      lastRefreshedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { added: 0, deleted };
  }

  // 3. 챕터 조회 (시즌별)
  const chapters = await getSeasonalChapters(courseId);

  // 4. 난이도별 부족분 계산 후 배치 생성
  let added = 0;

  for (const { difficulty, ratio } of DIFFICULTY_DISTRIBUTION) {
    const difficultyTarget = Math.round(needed * ratio);
    if (difficultyTarget <= 0) continue;

    let difficultyAdded = 0;
    const batchCount = Math.ceil(difficultyTarget / BATCH_SIZE);

    for (let i = 0; i < batchCount; i++) {
      const count = Math.min(difficultyTarget - difficultyAdded, BATCH_SIZE);
      if (count <= 0) break;

      try {
        const questions = await generateBattleQuestions(courseId, apiKey, count, chapters, difficulty);

        if (questions.length > 0) {
          const writeBatch = db.batch();
          const batchId = `${Date.now()}_${difficulty}_${i}`;

          for (const q of questions) {
            const docRef = questionsRef.doc();
            writeBatch.set(docRef, {
              text: q.text,
              type: q.type,
              choices: q.choices,
              correctAnswer: q.correctAnswer,
              difficulty: q.difficulty || difficulty,
              chapters,
              generatedAt: FieldValue.serverTimestamp(),
              batchId,
            });
            difficultyAdded++;
            added++;
          }
          await writeBatch.commit();
        }
      } catch (err) {
        console.error(`배치 ${difficulty}/${i + 1} 생성 실패 (${courseId}):`, err);
      }

      // 다음 배치 전 대기
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }

    console.log(`[풀 보충] ${courseId}/${difficulty}: ${difficultyAdded}/${difficultyTarget}개 생성`);
  }

  // 5. 메타 문서 업데이트
  await poolRef.set({
    totalQuestions: currentCount + added,
    lastRefreshedAt: FieldValue.serverTimestamp(),
    chapters,
  }, { merge: true });

  console.log(`문제 풀 보충 완료 (${courseId}): 추가 ${added}개, 삭제 ${deleted}개, 총 ${currentCount + added}개`);
  return { added, deleted };
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

  // 1. 풀 전체 조회
  const poolSnap = await questionsRef.get();
  if (poolSnap.empty) return null;

  // 2. 양쪽 플레이어의 최근 24시간 seenQuestions 조회
  const oneDayAgo = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
  const seenQuestionIds = new Set<string>();

  for (const pid of playerIds) {
    const seenSnap = await seenRef
      .where("userId", "==", pid)
      .where("seenAt", ">", oneDayAgo)
      .get();

    for (const doc of seenSnap.docs) {
      const ids = doc.data().questionIds as string[] | undefined;
      if (ids) {
        ids.forEach(id => seenQuestionIds.add(id));
      }
    }
  }

  // 3. 미시청 문제 필터링
  let available = poolSnap.docs.filter(doc => !seenQuestionIds.has(doc.id));

  if (available.length < count) {
    if (available.length < 5) {
      // 5문제 미만 → seen 기록 초기화 후 전체 풀에서 재시도 (헤비 유저 대응)
      console.log(`미시청 문제 부족 (${available.length}개) — seen 초기화 후 재사용`);
      const resetBatch = db.batch();
      for (const pid of playerIds) {
        const oldSeenSnap = await seenRef
          .where("userId", "==", pid)
          .get();
        oldSeenSnap.docs.forEach(doc => resetBatch.delete(doc.ref));
      }
      await resetBatch.commit();
      // 초기화 후 전체 풀 사용
      available = poolSnap.docs.sort(() => Math.random() - 0.5);
    }
  }

  // 4. 난이도별 분류 후 easy 4 + medium 4 + hard 2 순서대로 선택
  const byDifficulty: Record<string, typeof available> = { easy: [], medium: [], hard: [] };
  for (const doc of available) {
    const diff = doc.data().difficulty || "medium";
    if (byDifficulty[diff]) {
      byDifficulty[diff].push(doc);
    } else {
      byDifficulty["medium"].push(doc); // 알 수 없는 난이도 → medium
    }
  }

  // 각 난이도 셔플
  for (const key of Object.keys(byDifficulty)) {
    byDifficulty[key].sort(() => Math.random() - 0.5);
  }

  // easy 4 → medium 4 → hard 2 순서 (부족하면 다른 난이도에서 보충)
  const targets = [
    { difficulty: "easy", count: 4 },
    { difficulty: "medium", count: 4 },
    { difficulty: "hard", count: 2 },
  ];

  const selected: typeof available = [];
  const usedIds = new Set<string>();

  for (const target of targets) {
    const pool = byDifficulty[target.difficulty];
    let picked = 0;
    for (const doc of pool) {
      if (picked >= target.count) break;
      if (usedIds.has(doc.id)) continue;
      selected.push(doc);
      usedIds.add(doc.id);
      picked++;
    }
    // 부족하면 다른 난이도에서 보충
    if (picked < target.count) {
      for (const doc of available) {
        if (picked >= target.count) break;
        if (usedIds.has(doc.id)) continue;
        selected.push(doc);
        usedIds.add(doc.id);
        picked++;
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

  // 6. 문제 데이터 반환 (순서 유지: easy → medium → hard)
  return selected.map(doc => {
    const data = doc.data();
    return {
      text: data.text,
      type: data.type,
      choices: data.choices,
      correctAnswer: data.correctAnswer,
      difficulty: data.difficulty,
    };
  });
}

/**
 * 스케줄 CF: 매일 새벽 3시 KST 문제 풀 보충
 */
export const tekkenPoolRefillScheduled = onSchedule(
  {
    schedule: "0 3 * * *", // 매일 03:00 KST
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 540, // 9분 (2개 과목 × 300문제 순차 처리)
    memory: "1GiB",
  },
  async () => {
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      console.error("GEMINI_API_KEY가 설정되지 않았습니다.");
      return;
    }

    const db = getFirestore();

    // 현재 학기 과목만 생성 (1학기: biology+microbiology, 2학기: biology+pathophysiology)
    const courses = getCurrentSemesterCourses();
    console.log(`[스케줄] 매일 초기화 시작 — 과목: ${courses.join(", ")}`);

    for (const courseId of courses) {
      try {
        // 기존 문제 풀 전체 삭제 (매일 새 문제로 교체)
        const poolRef = db.collection("tekkenQuestionPool").doc(courseId);
        const questionsRef = poolRef.collection("questions");
        const existingSnap = await questionsRef.get();

        if (!existingSnap.empty) {
          // 500개씩 batch 삭제
          const refs = existingSnap.docs.map(doc => doc.ref);
          for (let i = 0; i < refs.length; i += 500) {
            const batch = db.batch();
            refs.slice(i, i + 500).forEach(ref => batch.delete(ref));
            await batch.commit();
          }
          console.log(`[스케줄] ${courseId}: 기존 ${existingSnap.size}개 삭제`);
        }

        // seenQuestions도 매일 초기화 (새 문제이므로)
        const seenRef = poolRef.collection("seenQuestions");
        const seenSnap = await seenRef.get();
        if (!seenSnap.empty) {
          const refs = seenSnap.docs.map(doc => doc.ref);
          for (let i = 0; i < refs.length; i += 500) {
            const batch = db.batch();
            refs.slice(i, i + 500).forEach(ref => batch.delete(ref));
            await batch.commit();
          }
        }

        // 300문제 새로 생성
        const result = await replenishQuestionPool(courseId, apiKey);
        console.log(`[스케줄] ${courseId}: 새로 ${result.added}개 생성`);
      } catch (err) {
        console.error(`[스케줄] ${courseId} 풀 생성 실패:`, err);
      }

      // 과목 간 딜레이
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
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
