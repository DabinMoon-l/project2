/**
 * 학기 전환 Cloud Functions
 *
 * 자동 스케줄로 학생들의 과목을 이동시킵니다.
 *
 * 2월 22일: 병태생리학 → 미생물학 (1학년 2학기 → 2학년 1학기 진급)
 * 8월 22일: 미생물학 학생 삭제(졸업) + 생물학 → 병태생리학 (1학년 1학기 → 1학년 2학기)
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, FieldValue, Firestore } from "firebase-admin/firestore";
import { getAuth, Auth } from "firebase-admin/auth";

// 과목 ID 상수
const COURSE_IDS = {
  BIOLOGY: "biology",
  PATHOPHYSIOLOGY: "pathophysiology",
  MICROBIOLOGY: "microbiology",
} as const;

/**
 * 학생 데이터 초기화
 * EXP, 랭크, 캐릭터, 복습창 데이터를 초기화합니다.
 */
async function resetStudentData(
  db: Firestore,
  userId: string,
  newCourseId: string,
  newGrade: number
): Promise<void> {
  const batch = db.batch();

  // 1. 사용자 문서 업데이트
  const userRef = db.collection("users").doc(userId);
  batch.update(userRef, {
    // 과목 변경
    courseId: newCourseId,
    grade: newGrade,

    // 초기화 항목
    totalExp: 0,
    lastGachaExp: 0,

    // 토끼 장착 초기화
    equippedRabbitId: null,
    equippedRabbitCourseId: null,
    ownedRabbitKeys: [],
    purchasedItems: [],

    // 퀴즈 통계 초기화
    totalQuizzes: 0,
    correctAnswers: 0,

    // 타임스탬프
    courseTransitionAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  // 2. 복습창 데이터 삭제 (reviews)
  const reviewsSnapshot = await db
    .collection("reviews")
    .where("userId", "==", userId)
    .get();

  if (!reviewsSnapshot.empty) {
    const reviewBatch = db.batch();
    for (const doc of reviewsSnapshot.docs) {
      reviewBatch.delete(doc.ref);
    }
    await reviewBatch.commit();
  }

  // 3. 퀴즈 결과 삭제 (quizResults)
  const resultsSnapshot = await db
    .collection("quizResults")
    .where("userId", "==", userId)
    .get();

  if (!resultsSnapshot.empty) {
    const resultsBatch = db.batch();
    for (const doc of resultsSnapshot.docs) {
      resultsBatch.delete(doc.ref);
    }
    await resultsBatch.commit();
  }

  // 4. 커스텀 폴더 삭제 (customFolders)
  const foldersSnapshot = await db
    .collection("customFolders")
    .where("userId", "==", userId)
    .get();

  if (!foldersSnapshot.empty) {
    const foldersBatch = db.batch();
    for (const doc of foldersSnapshot.docs) {
      foldersBatch.delete(doc.ref);
    }
    await foldersBatch.commit();
  }

  // 5. 퀴즈 북마크 삭제 (quizBookmarks)
  const bookmarksSnapshot = await db
    .collection("quizBookmarks")
    .where("userId", "==", userId)
    .get();

  if (!bookmarksSnapshot.empty) {
    const bookmarksBatch = db.batch();
    for (const doc of bookmarksSnapshot.docs) {
      bookmarksBatch.delete(doc.ref);
    }
    await bookmarksBatch.commit();
  }

  // 6. 퀴즈 진행 상황 삭제 (quizProgress)
  const progressSnapshot = await db
    .collection("quizProgress")
    .where("userId", "==", userId)
    .get();

  if (!progressSnapshot.empty) {
    const progressBatch = db.batch();
    for (const doc of progressSnapshot.docs) {
      progressBatch.delete(doc.ref);
    }
    await progressBatch.commit();
  }
}

/**
 * 학생 계정 완전 삭제
 * Firebase Auth와 Firestore에서 모두 삭제합니다.
 */
async function deleteStudentAccount(
  db: Firestore,
  auth: Auth,
  userId: string
): Promise<void> {
  // 1. 관련 데이터 먼저 삭제
  const collectionsToDelete = [
    "reviews",
    "quizResults",
    "customFolders",
    "quizBookmarks",
    "quizProgress",
    "notifications",
    "feedbacks",
    "questionFeedbacks",
  ];

  for (const collectionName of collectionsToDelete) {
    const snapshot = await db
      .collection(collectionName)
      .where("userId", "==", userId)
      .get();

    if (!snapshot.empty) {
      const batch = db.batch();
      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }
  }

  // 2. 경험치 히스토리 삭제 (서브컬렉션)
  const expHistorySnapshot = await db
    .collection("users")
    .doc(userId)
    .collection("expHistory")
    .get();

  if (!expHistorySnapshot.empty) {
    const batch = db.batch();
    for (const doc of expHistorySnapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }

  // 3. 사용자 문서 삭제
  await db.collection("users").doc(userId).delete();

  // 4. Firebase Auth에서 삭제
  try {
    await auth.deleteUser(userId);
  } catch (error) {
    console.error(`Firebase Auth 사용자 삭제 실패: ${userId}`, error);
    // Auth 삭제 실패해도 계속 진행 (이미 삭제된 경우 등)
  }
}

/**
 * 2월 22일: 병태생리학 → 미생물학
 *
 * 2학기 → 1학기 전환 (새 학년)
 * - 병태생리학(1학년 2학기) 학생들을 미생물학(2학년 1학기)으로 이동
 * - 데이터 초기화 (EXP, 랭크, 캐릭터, 복습창)
 */
export const februaryTransition = onSchedule(
  {
    schedule: "0 0 22 2 *", // 매년 2월 22일 0시 (자정)
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
  },
  async () => {
    console.log("=== 2월 22일 학기 전환 시작 ===");

    const db = getFirestore();
    let transitionCount = 0;
    let errorCount = 0;

    try {
      // 병태생리학 학생 조회
      const pathophysiologyStudentsSnapshot = await db
        .collection("users")
        .where("courseId", "==", COURSE_IDS.PATHOPHYSIOLOGY)
        .where("role", "==", "student")
        .get();

      console.log(`병태생리학 학생 수: ${pathophysiologyStudentsSnapshot.size}명`);

      // 각 학생을 미생물학으로 이동
      for (const studentDoc of pathophysiologyStudentsSnapshot.docs) {
        try {
          await resetStudentData(
            db,
            studentDoc.id,
            COURSE_IDS.MICROBIOLOGY,
            2 // 1학년 → 2학년 진급
          );
          transitionCount++;
          console.log(`학생 이동 완료: ${studentDoc.id}`);
        } catch (error) {
          console.error(`학생 이동 실패: ${studentDoc.id}`, error);
          errorCount++;
        }
      }

      // 전환 로그 기록
      await db.collection("semesterTransitionLogs").add({
        type: "february",
        date: "02-22",
        fromCourse: COURSE_IDS.PATHOPHYSIOLOGY,
        toCourse: COURSE_IDS.MICROBIOLOGY,
        transitionCount,
        errorCount,
        createdAt: FieldValue.serverTimestamp(),
      });

      console.log(`=== 2월 22일 학기 전환 완료 ===`);
      console.log(`이동 성공: ${transitionCount}명, 실패: ${errorCount}명`);
    } catch (error) {
      console.error("2월 22일 학기 전환 전체 실패:", error);
      throw error;
    }
  }
);

/**
 * 8월 22일: 미생물학 삭제 + 생물학 → 병태생리학
 *
 * 1학기 → 2학기 전환
 * - 미생물학(2학년 1학기) 학생들은 졸업 처리 (계정 삭제)
 * - 생물학(1학년 1학기) 학생들을 병태생리학(1학년 2학기)으로 이동
 * - 데이터 초기화 (EXP, 랭크, 캐릭터, 복습창)
 */
export const augustTransition = onSchedule(
  {
    schedule: "0 0 22 8 *", // 매년 8월 22일 0시 (자정)
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
  },
  async () => {
    console.log("=== 8월 22일 학기 전환 시작 ===");

    const db = getFirestore();
    const auth = getAuth();

    let deleteCount = 0;
    let transitionCount = 0;
    let errorCount = 0;

    try {
      // ========================================
      // Step 1: 미생물학 학생 삭제 (졸업 처리)
      // ========================================
      console.log("Step 1: 미생물학 학생 삭제 시작");

      const microbiologyStudentsSnapshot = await db
        .collection("users")
        .where("courseId", "==", COURSE_IDS.MICROBIOLOGY)
        .where("role", "==", "student")
        .get();

      console.log(`미생물학 학생 수: ${microbiologyStudentsSnapshot.size}명`);

      for (const studentDoc of microbiologyStudentsSnapshot.docs) {
        try {
          await deleteStudentAccount(db, auth, studentDoc.id);
          deleteCount++;
          console.log(`학생 삭제 완료: ${studentDoc.id}`);
        } catch (error) {
          console.error(`학생 삭제 실패: ${studentDoc.id}`, error);
          errorCount++;
        }
      }

      console.log(`미생물학 학생 삭제 완료: ${deleteCount}명`);

      // ========================================
      // Step 2: 생물학 → 병태생리학 이동
      // ========================================
      console.log("Step 2: 생물학 → 병태생리학 이동 시작");

      const biologyStudentsSnapshot = await db
        .collection("users")
        .where("courseId", "==", COURSE_IDS.BIOLOGY)
        .where("role", "==", "student")
        .get();

      console.log(`생물학 학생 수: ${biologyStudentsSnapshot.size}명`);

      for (const studentDoc of biologyStudentsSnapshot.docs) {
        try {
          await resetStudentData(
            db,
            studentDoc.id,
            COURSE_IDS.PATHOPHYSIOLOGY,
            1 // 1학년 유지 (1학기 → 2학기)
          );
          transitionCount++;
          console.log(`학생 이동 완료: ${studentDoc.id}`);
        } catch (error) {
          console.error(`학생 이동 실패: ${studentDoc.id}`, error);
          errorCount++;
        }
      }

      // 전환 로그 기록
      await db.collection("semesterTransitionLogs").add({
        type: "august",
        date: "08-22",
        deletedCourse: COURSE_IDS.MICROBIOLOGY,
        deleteCount,
        fromCourse: COURSE_IDS.BIOLOGY,
        toCourse: COURSE_IDS.PATHOPHYSIOLOGY,
        transitionCount,
        errorCount,
        createdAt: FieldValue.serverTimestamp(),
      });

      console.log(`=== 8월 22일 학기 전환 완료 ===`);
      console.log(`삭제: ${deleteCount}명, 이동: ${transitionCount}명, 실패: ${errorCount}명`);
    } catch (error) {
      console.error("8월 22일 학기 전환 전체 실패:", error);
      throw error;
    }
  }
);
