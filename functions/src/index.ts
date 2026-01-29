/**
 * 용사 퀴즈 - Firebase Cloud Functions
 *
 * 이 파일은 모든 Cloud Functions의 메인 엔트리 포인트입니다.
 * 각 기능별로 모듈화되어 있으며, 여기서 통합하여 export합니다.
 *
 * 주요 기능:
 * - 퀴즈 완료 시 골드/경험치 지급
 * - 피드백 작성 시 골드 지급
 * - 게시판 활동(글/댓글/좋아요) 시 골드/경험치 지급
 * - 도배 방지 (Rate Limiting)
 *
 * @author Hero Quiz Team
 * @version 1.0.0
 */

import { initializeApp } from "firebase-admin/app";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Firebase Admin 초기화
initializeApp();

// ============================================
// 퀴즈 관련 Functions
// ============================================
export { onQuizComplete, updateQuizStatistics } from "./quiz";

// ============================================
// 피드백 관련 Functions
// ============================================
export { onFeedbackSubmit, onFeedbackStatusChange } from "./feedback";

// ============================================
// 게시판 관련 Functions
// ============================================
export {
  onPostCreate,
  onCommentCreate,
  onLikeReceived,
  onLikeRemoved,
} from "./board";

// ============================================
// 알림 관련 Functions
// ============================================
export {
  sendNotificationToUser,
  sendNotificationToClass,
  onNewQuizCreated,
  onFeedbackReplied,
  onBoardCommentCreated,
  onBoardReplyCreated,
  onRankingChange,
} from "./notification";

// ============================================
// Rate Limit 관련 Functions
// ============================================
import { checkRateLimit, cleanupRateLimits, RateLimitType } from "./rateLimit";

/**
 * Rate limit 체크 (Callable Function)
 * 클라이언트에서 글/댓글 작성 전 호출하여 제한 여부 확인
 *
 * @param data.type - "POST" 또는 "COMMENT"
 * @returns 허용 여부, 남은 횟수, 리셋 시간
 */
export const checkRateLimitCall = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { type } = request.data as { type: RateLimitType };
    if (!type || !["POST", "COMMENT"].includes(type)) {
      throw new HttpsError("invalid-argument", "유효하지 않은 타입입니다.");
    }

    const userId = request.auth.uid;
    const result = await checkRateLimit(userId, type);

    return {
      allowed: result.allowed,
      remaining: result.remaining,
      resetAt: result.resetAt.toISOString(),
      message: result.message,
    };
  }
);

/**
 * Rate limit 기록 정리 (Scheduled Function)
 * 매시간 실행되어 오래된 Rate limit 기록 삭제
 */
export const cleanupRateLimitsScheduled = onSchedule(
  {
    schedule: "every 1 hours",
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
  },
  async () => {
    const deletedCount = await cleanupRateLimits();
    console.log(`Rate limit 기록 정리 완료: ${deletedCount}건 삭제`);
  }
);

// ============================================
// 사용자 통계 관련 Functions
// ============================================

/**
 * 사용자 프로필 조회 (Callable Function)
 * 골드, 경험치, 계급 등 통계 정보 반환
 */
export const getUserStats = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const db = getFirestore();

    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
    }

    const userData = userDoc.data()!;

    return {
      gold: userData.gold || 0,
      exp: userData.exp || 0,
      rank: userData.rank || "견습생",
      quizCount: userData.quizCount || 0,
      postCount: userData.postCount || 0,
      commentCount: userData.commentCount || 0,
    };
  }
);

/**
 * 리더보드 조회 (Callable Function)
 * 반별/전체 랭킹 조회
 *
 * @param data.classId - 반 ID (선택사항, 없으면 전체)
 * @param data.type - "gold" | "exp" | "quiz" (기본: exp)
 * @param data.limit - 조회 수 (기본: 10, 최대: 50)
 */
export const getLeaderboard = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { classId, type = "exp", limit = 10 } = request.data as {
      classId?: string;
      type?: "gold" | "exp" | "quiz";
      limit?: number;
    };

    const actualLimit = Math.min(Math.max(1, limit), 50);
    const db = getFirestore();

    // 정렬 필드 결정
    const orderField = type === "gold" ? "gold" :
                       type === "quiz" ? "quizCount" : "exp";

    let query = db.collection("users")
      .orderBy(orderField, "desc")
      .limit(actualLimit);

    // 반 필터링
    if (classId) {
      query = db.collection("users")
        .where("classId", "==", classId)
        .orderBy(orderField, "desc")
        .limit(actualLimit);
    }

    const snapshot = await query.get();
    const leaderboard = snapshot.docs.map((doc, index) => {
      const data = doc.data();
      return {
        rank: index + 1,
        userId: doc.id,
        userName: data.userName || "익명",
        userClass: data.classId || "",
        characterPreview: data.characterPreview || null,
        value: data[orderField] || 0,
        rankTitle: data.rank || "견습생",
      };
    });

    return { leaderboard, type, classId };
  }
);

// ============================================
// 시즌 관련 Functions
// ============================================

/**
 * 시즌 리셋 (Callable Function - 교수님 전용)
 * 중간→기말 전환 시 계급, 갑옷/무기, Shop 아이템 초기화
 * 골드, 캐릭터 외형, 뱃지는 유지
 */
export const resetSeason = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const db = getFirestore();

    // 교수님 권한 확인
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 시즌 리셋이 가능합니다.");
    }

    const { classId, newSeason } = request.data as {
      classId: string;
      newSeason: "midterm" | "final";
    };

    if (!classId || !newSeason) {
      throw new HttpsError("invalid-argument", "classId와 newSeason이 필요합니다.");
    }

    // 해당 반 학생들 조회
    const studentsSnapshot = await db.collection("users")
      .where("classId", "==", classId)
      .where("role", "==", "student")
      .get();

    const batch = db.batch();
    let resetCount = 0;

    for (const studentDoc of studentsSnapshot.docs) {
      batch.update(studentDoc.ref, {
        // 초기화 항목
        exp: 0,
        rank: "견습생",
        unlockedArmors: {},
        unlockedWeapons: {},
        equippedArmor: null,
        equippedWeapon: null,
        purchasedItems: [],

        // 시즌 정보 업데이트
        currentSeason: newSeason,
        seasonResetAt: FieldValue.serverTimestamp(),

        // 골드, 캐릭터 외형, 뱃지는 유지 (업데이트하지 않음)
        updatedAt: FieldValue.serverTimestamp(),
      });
      resetCount++;
    }

    // 시즌 로그 기록
    const seasonLogRef = db.collection("seasonLogs").doc();
    batch.set(seasonLogRef, {
      classId,
      previousSeason: newSeason === "final" ? "midterm" : "final",
      newSeason,
      resetBy: userId,
      studentCount: resetCount,
      createdAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    console.log(`시즌 리셋 완료: ${classId}`, {
      newSeason,
      resetCount,
    });

    return {
      success: true,
      message: `${resetCount}명의 학생 시즌이 리셋되었습니다.`,
      resetCount,
    };
  }
);

// ============================================
// 관리자 유틸리티 Functions
// ============================================

/**
 * 수동 골드 지급 (Callable Function - 교수님 전용)
 * 특별 이벤트, 보상 등을 위한 수동 골드 지급
 */
export const grantGold = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const adminId = request.auth.uid;
    const db = getFirestore();

    // 교수님 권한 확인
    const adminDoc = await db.collection("users").doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 골드 지급이 가능합니다.");
    }

    const { targetUserId, amount, reason } = request.data as {
      targetUserId: string;
      amount: number;
      reason: string;
    };

    // 유효성 검사
    if (!targetUserId || !amount || !reason) {
      throw new HttpsError("invalid-argument", "targetUserId, amount, reason이 필요합니다.");
    }

    if (amount <= 0 || amount > 1000) {
      throw new HttpsError("invalid-argument", "골드는 1~1000 사이여야 합니다.");
    }

    // 대상 사용자 확인
    const targetUserDoc = await db.collection("users").doc(targetUserId).get();
    if (!targetUserDoc.exists) {
      throw new HttpsError("not-found", "대상 사용자를 찾을 수 없습니다.");
    }

    // 골드 지급
    await db.runTransaction(async (transaction) => {
      const userRef = db.collection("users").doc(targetUserId);
      transaction.update(userRef, {
        gold: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 히스토리 기록
      const historyRef = db.collection("users").doc(targetUserId)
        .collection("goldHistory").doc();
      transaction.set(historyRef, {
        amount,
        reason: `[관리자 지급] ${reason}`,
        grantedBy: adminId,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    console.log(`수동 골드 지급: ${targetUserId}`, { amount, reason, grantedBy: adminId });

    // 대상 사용자에게 알림
    await db.collection("notifications").add({
      userId: targetUserId,
      type: "GOLD_GRANTED",
      title: "골드 지급",
      message: `${amount} 골드가 지급되었습니다. (${reason})`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { success: true, amount };
  }
);
