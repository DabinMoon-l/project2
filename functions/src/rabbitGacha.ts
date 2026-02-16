/**
 * 토끼 뽑기 Cloud Function (2단계: Roll → Claim)
 *
 * Phase 1 (Roll): 랜덤 토끼 선택 + 상태 판별 → RollResult 반환
 * Phase 2 (Claim): 사용자 선택(discover/pass)에 따라 문서 생성/변경
 *
 * 발견은 무제한, 장착은 최대 2마리
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/** Roll 결과 타입 (Phase 1 반환값) */
interface RollResult {
  type: "undiscovered" | "discovered" | "already_discovered";
  rabbitId: number;
  rabbitName: string | null;
  nextDiscoveryOrder: number | null;
  myDiscoveryOrder: number | null;
  equippedCount: number;
}

/** Claim 결과 타입 (Phase 2 반환값) */
interface ClaimResult {
  success: boolean;
  discoveryOrder: number;
  needsNaming: boolean;
  rabbitName: string | null;
}

/**
 * spinRabbitGacha — Roll Only (Phase 1)
 *
 * 1. 마일스톤 검증 (floor(totalExp/50)*50 > lastGachaExp && totalExp >= 50)
 * 2. 랜덤 rabbitId (0-99) 선택
 * 3. rabbit 문서 존재 확인 → undiscovered / discovered 판별
 * 4. holding 존재 확인 → already_discovered 판별
 * 5. lastGachaExp 갱신 (스핀 소모)
 */
export const spinRabbitGacha = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId } = request.data as { courseId: string };

    if (!courseId) {
      throw new HttpsError("invalid-argument", "courseId가 필요합니다.");
    }

    const db = getFirestore();

    const result = await db.runTransaction(async (transaction) => {
      // 사용자 문서 읽기
      const userRef = db.collection("users").doc(userId);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
      }

      const userData = userDoc.data()!;
      const totalExp = userData.totalExp || 0;
      const lastGachaExp = userData.lastGachaExp || 0;
      const currentMilestone = Math.floor(totalExp / 50) * 50;

      // 마일스톤 검증
      if (currentMilestone <= lastGachaExp || totalExp < 50) {
        throw new HttpsError(
          "failed-precondition",
          "뽑기 조건을 충족하지 않습니다."
        );
      }

      // 랜덤 토끼 ID (0-79)
      const rabbitId = Math.floor(Math.random() * 80);
      const rabbitDocId = `${courseId}_${rabbitId}`;

      // 이미 보유하고 있는지 확인
      const holdingRef = userRef.collection("rabbitHoldings").doc(rabbitDocId);
      const holdingDoc = await transaction.get(holdingRef);

      // 토끼 문서 확인
      const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
      const rabbitDoc = await transaction.get(rabbitRef);
      const rabbitData = rabbitDoc.exists ? rabbitDoc.data()! : null;

      // lastGachaExp 갱신 (스핀 소모 — 놓아주기 선택해도 복구 안 됨)
      transaction.update(userRef, {
        lastGachaExp: currentMilestone,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 장착 수 계산
      const equippedRabbits: Array<{ rabbitId: number; courseId: string }> =
        userData.equippedRabbits || [];

      if (holdingDoc.exists) {
        // 이미 발견한 토끼
        return {
          type: "already_discovered",
          rabbitId,
          rabbitName: rabbitData?.name || null,
          nextDiscoveryOrder: null,
          myDiscoveryOrder: holdingDoc.data()!.discoveryOrder,
          equippedCount: equippedRabbits.length,
        } as RollResult;
      }

      if (!rabbitData) {
        // 미발견 — 아직 아무도 발견하지 않은 토끼
        return {
          type: "undiscovered",
          rabbitId,
          rabbitName: null,
          nextDiscoveryOrder: null,
          myDiscoveryOrder: null,
          equippedCount: equippedRabbits.length,
        } as RollResult;
      }

      // 발견 — 이미 존재하는 토끼 (다른 사람이 발견)
      return {
        type: "discovered",
        rabbitId,
        rabbitName: rabbitData.name || null,
        nextDiscoveryOrder: (rabbitData.discovererCount || 1) + 1,
        myDiscoveryOrder: null,
        equippedCount: equippedRabbits.length,
      } as RollResult;
    });

    return result;
  }
);

/**
 * claimGachaRabbit — Claim (Phase 2)
 *
 * action === "pass" → 즉시 반환 (아무 변경 없음)
 * action === "discover" → 트랜잭션:
 *   1. 이미 보유 확인 → error
 *   2. rabbit 문서 재확인:
 *      - 미존재 → 최초 발견자 등록 (name 필수)
 *      - 존재 → 후속 발견자 등록
 *   3. 빈 슬롯 있으면 자동 장착 (2개 미만)
 *   4. equipSlot 파라미터로 슬롯 지정 가능
 */
export const claimGachaRabbit = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId, rabbitId, action, name, equipSlot } = request.data as {
      courseId: string;
      rabbitId: number;
      action: "discover" | "pass";
      name?: string;
      equipSlot?: number; // 0 또는 1
    };

    if (!courseId || rabbitId === undefined || !action) {
      throw new HttpsError("invalid-argument", "courseId, rabbitId, action이 필요합니다.");
    }

    // 놓아주기 → 아무 변경 없음
    if (action === "pass") {
      return { success: true, passed: true };
    }

    // 이름 유효성 검사
    const trimmedName = name?.trim();
    if (trimmedName && (trimmedName.length < 1 || trimmedName.length > 10)) {
      throw new HttpsError("invalid-argument", "이름은 1-10자여야 합니다.");
    }

    const db = getFirestore();
    const rabbitDocId = `${courseId}_${rabbitId}`;

    const result = await db.runTransaction(async (transaction) => {
      const userRef = db.collection("users").doc(userId);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
      }

      const userData = userDoc.data()!;
      const userName = userData.nickname || "용사";

      // 이미 보유 확인
      const holdingRef = userRef.collection("rabbitHoldings").doc(rabbitDocId);
      const holdingDoc = await transaction.get(holdingRef);
      if (holdingDoc.exists) {
        throw new HttpsError("already-exists", "이미 발견한 토끼입니다.");
      }

      // rabbit 문서 재확인 (클레임 시점 상태)
      const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
      const rabbitDoc = await transaction.get(rabbitRef);
      const rabbitData = rabbitDoc.exists ? rabbitDoc.data()! : null;

      let discoveryOrder: number;
      let needsNaming = false;
      let rabbitName: string | null;

      if (!rabbitData) {
        // 미존재 → 최초 발견자 등록
        if (!trimmedName) {
          throw new HttpsError("invalid-argument", "최초 발견 시 이름이 필요합니다.");
        }

        discoveryOrder = 1;
        needsNaming = true;
        rabbitName = trimmedName;

        // 토끼 문서 생성
        transaction.set(rabbitRef, {
          courseId,
          rabbitId,
          name: trimmedName,
          firstDiscovererUserId: userId,
          firstDiscovererName: userName,
          discovererCount: 1,
          discoverers: [{ userId, nickname: userName, discoveryOrder: 1 }],
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // 홀딩 생성
        transaction.set(holdingRef, {
          rabbitId,
          courseId,
          discoveryOrder: 1,
          discoveredAt: FieldValue.serverTimestamp(),
        });
      } else {
        // 존재 → 후속 발견자 등록
        discoveryOrder = (rabbitData.discovererCount || 1) + 1;
        rabbitName = rabbitData.name || null;

        transaction.update(rabbitRef, {
          discovererCount: FieldValue.increment(1),
          discoverers: FieldValue.arrayUnion({ userId, nickname: userName, discoveryOrder }),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // 홀딩 생성
        transaction.set(holdingRef, {
          rabbitId,
          courseId,
          discoveryOrder,
          discoveredAt: FieldValue.serverTimestamp(),
        });
      }

      // 장착 처리: 빈 슬롯 자동 장착 (2개 미만)
      const equippedRabbits: Array<{ rabbitId: number; courseId: string }> =
        userData.equippedRabbits || [];

      if (equippedRabbits.length < 2) {
        // 빈 슬롯에 자동 장착
        const newEquipped = [...equippedRabbits, { rabbitId, courseId }];
        transaction.update(userRef, {
          equippedRabbits: newEquipped,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else if (equipSlot !== undefined && (equipSlot === 0 || equipSlot === 1)) {
        // 슬롯 지정 교체
        const newEquipped = [...equippedRabbits];
        newEquipped[equipSlot] = { rabbitId, courseId };
        transaction.update(userRef, {
          equippedRabbits: newEquipped,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        // 슬롯 가득 & 미지정 → 장착하지 않음
        transaction.update(userRef, {
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return {
        success: true,
        discoveryOrder,
        needsNaming,
        rabbitName,
      } as ClaimResult;
    });

    return result;
  }
);
