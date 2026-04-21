/**
 * 토끼 뽑기 Cloud Function (2단계: Roll → Claim)
 *
 * Phase 1 (Roll): 랜덤 토끼 선택 + 상태 판별 → RollResult 반환
 * Phase 2 (Claim): 사용자 선택(discover/pass)에 따라 문서 생성/변경
 *
 * 보안:
 * - Phase 1에서 pendingSpin에 rabbitId 저장
 * - Phase 2에서 pendingSpin.rabbitId와 요청 rabbitId 일치 검증
 * - pendingSpin이 남아있으면 Phase 1에서 이전 결과 복구 (마일스톤 손실 방지)
 *
 * 발견/보유 무제한, 장착은 최대 2마리
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getBaseStats } from "./utils/rabbitStats";
import {
  SUPABASE_URL_SECRET,
  SUPABASE_SERVICE_ROLE_SECRET,
  DEFAULT_ORG_ID_SECRET,
  supabaseDualWriteRabbit,
  supabaseDualWriteRabbitHolding,
} from "./utils/supabase";

const RABBIT_DUAL_WRITE_SECRETS = [
  SUPABASE_URL_SECRET,
  SUPABASE_SERVICE_ROLE_SECRET,
  DEFAULT_ORG_ID_SECRET,
];

/** Roll 결과 타입 (Phase 1 반환값) */
interface RollResult {
  type: "undiscovered" | "discovered" | "owned";
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
 * 1. pendingSpin 존재 확인 → 이전 결과 복구 (마일스톤 손실 방지)
 * 2. 마일스톤 검증 (floor(totalExp/50)*50 > lastGachaExp && totalExp >= 50)
 * 3. 랜덤 rabbitId (0-79) 선택
 * 4. rabbit 문서 존재 확인 → undiscovered / discovered 판별
 * 5. lastGachaExp 갱신 + pendingSpin 저장
 */
// spinRabbitGacha: users 문서만 건드림 (lastGachaExp/pendingSpin/spinLock).
// rabbits/rabbit_holdings 에는 쓰지 않으므로 듀얼 라이트 불필요.
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
      const equippedRabbits: Array<{ rabbitId: number; courseId: string }> =
        userData.equippedRabbits || [];

      // === 이전 pendingSpin 복구 (같은 과목) ===
      if (userData.pendingSpin && userData.pendingSpin.courseId === courseId) {
        const psRabbitId = userData.pendingSpin.rabbitId as number;

        // 이미 보유 중인지 확인 (edge case: 다른 경로로 획득됨)
        const holdingRef = userRef
          .collection("rabbitHoldings")
          .doc(`${courseId}_${psRabbitId}`);
        const holdingDoc = await transaction.get(holdingRef);

        // 이전 결과 복구 — 마일스톤 소비 안 함
        const psRabbitRef = db
          .collection("rabbits")
          .doc(`${courseId}_${psRabbitId}`);
        const psRabbitDoc = await transaction.get(psRabbitRef);
        const psRabbitData = psRabbitDoc.exists ? psRabbitDoc.data()! : null;

        if (holdingDoc.exists) {
          // 이미 보유 중 → owned 복구
          return {
            type: "owned",
            rabbitId: psRabbitId,
            rabbitName: psRabbitData?.name || null,
            nextDiscoveryOrder: null,
            myDiscoveryOrder: holdingDoc.data()?.discoveryOrder || null,
            equippedCount: equippedRabbits.length,
          } as RollResult;
        }

        if (!psRabbitData) {
          return {
            type: "undiscovered",
            rabbitId: psRabbitId,
            rabbitName: null,
            nextDiscoveryOrder: null,
            myDiscoveryOrder: null,
            equippedCount: equippedRabbits.length,
          } as RollResult;
        }

        return {
          type: "discovered",
          rabbitId: psRabbitId,
          rabbitName: psRabbitData.name || null,
          nextDiscoveryOrder: (psRabbitData.discovererCount || 1) + 1,
          myDiscoveryOrder: null,
          equippedCount: equippedRabbits.length,
        } as RollResult;
      }

      // === 새 스핀 ===

      // 스핀 잠금 체크 (10초 이내 중복 방지)
      if (userData.spinLock && Date.now() - userData.spinLock < 10000) {
        throw new HttpsError(
          "failed-precondition",
          "이미 뽑기가 진행 중입니다."
        );
      }

      // 마일스톤 검증 (pending = floor(totalExp/50) - floor(lastGachaExp/50))
      const pendingMilestones =
        Math.floor(totalExp / 50) - Math.floor(lastGachaExp / 50);
      if (pendingMilestones <= 0) {
        throw new HttpsError(
          "failed-precondition",
          "뽑기 조건을 충족하지 않습니다."
        );
      }

      // 보유 토끼 목록 조회
      const holdingsSnap = await transaction.get(
        userRef.collection("rabbitHoldings")
      );
      const ownedIds = new Set(
        holdingsSnap.docs
          .filter((d) => d.data().courseId === courseId)
          .map((d) => d.data().rabbitId as number)
      );

      // 미보유 토끼만 풀에서 선택
      const availableIds = [];
      for (let i = 0; i < 80; i++) {
        if (!ownedIds.has(i)) availableIds.push(i);
      }

      if (availableIds.length === 0) {
        throw new HttpsError(
          "failed-precondition",
          "모든 토끼를 발견했습니다! 더 이상 뽑을 토끼가 없어요."
        );
      }

      const rabbitId = availableIds[Math.floor(Math.random() * availableIds.length)];
      const rabbitDocId = `${courseId}_${rabbitId}`;

      // 토끼 문서 확인
      const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
      const rabbitDoc = await transaction.get(rabbitRef);
      const rabbitData = rabbitDoc.exists ? rabbitDoc.data()! : null;

      // lastGachaExp += 50 + pendingSpin 저장 + 스핀 잠금 설정
      transaction.update(userRef, {
        lastGachaExp: lastGachaExp + 50,
        spinLock: Date.now(),
        pendingSpin: { rabbitId, courseId },
        updatedAt: FieldValue.serverTimestamp(),
      });

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
 * action === "pass" → pendingSpin 정리 (마일스톤 이미 소비됨)
 * action === "discover" → 트랜잭션:
 *   0. pendingSpin.rabbitId === request.rabbitId 검증 (보안)
 *   1. 이미 보유 확인 → error
 *   2. rabbit 문서 재확인:
 *      - 미존재 → 최초 발견자 등록 (name 필수)
 *      - 존재 → 후속 발견자 등록
 *   3. 빈 슬롯 있으면 자동 장착 (2개 미만)
 *   4. equipSlot 파라미터로 슬롯 지정 가능
 */
export const claimGachaRabbit = onCall(
  { region: "asia-northeast3", secrets: RABBIT_DUAL_WRITE_SECRETS },
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
      throw new HttpsError(
        "invalid-argument",
        "courseId, rabbitId, action이 필요합니다."
      );
    }

    // rabbitId 범위 검증
    if (typeof rabbitId !== "number" || rabbitId < 0 || rabbitId > 79) {
      throw new HttpsError(
        "invalid-argument",
        "rabbitId는 0-79 범위여야 합니다."
      );
    }

    const db = getFirestore();

    // 놓아주기 → pendingSpin 정리 (마일스톤은 이미 Phase 1에서 소비됨)
    if (action === "pass") {
      await db
        .collection("users")
        .doc(userId)
        .update({
          pendingSpin: FieldValue.delete(),
          spinLock: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      return { success: true, passed: true };
    }

    // 이름 유효성 검사
    const trimmedName = name?.trim();
    if (trimmedName && (trimmedName.length < 1 || trimmedName.length > 10)) {
      throw new HttpsError("invalid-argument", "이름은 1-10자여야 합니다.");
    }

    const rabbitDocId = `${courseId}_${rabbitId}`;

    const result = await db.runTransaction(async (transaction) => {
      const userRef = db.collection("users").doc(userId);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
      }

      const userData = userDoc.data()!;
      const userName = userData.nickname || "용사";

      // pendingSpin 검증 (보안: spin에서 할당된 rabbitId만 claim 가능)
      const pendingSpin = userData.pendingSpin;
      if (
        !pendingSpin ||
        pendingSpin.rabbitId !== rabbitId ||
        pendingSpin.courseId !== courseId
      ) {
        throw new HttpsError(
          "failed-precondition",
          "유효하지 않은 뽑기입니다. 다시 뽑기해주세요."
        );
      }

      // 이미 보유 확인
      const holdingRef = userRef.collection("rabbitHoldings").doc(rabbitDocId);
      const holdingDoc = await transaction.get(holdingRef);
      if (holdingDoc.exists) {
        // 이미 보유 → pendingSpin 정리
        transaction.update(userRef, {
          pendingSpin: FieldValue.delete(),
          spinLock: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
        throw new HttpsError("already-exists", "이미 발견한 토끼입니다.");
      }

      // rabbit 문서 재확인 (클레임 시점 상태)
      const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
      const rabbitDoc = await transaction.get(rabbitRef);
      const rabbitData = rabbitDoc.exists ? rabbitDoc.data()! : null;

      let discoveryOrder: number;
      let needsNaming = false;
      let rabbitName: string | null;

      // 트랜잭션 이후 Supabase dual-write 에 쓸 값 캡처
      let rabbitUpsertPayload: {
        name: string | null;
        firstDiscovererUserId?: string;
        firstDiscovererName?: string;
        discoverers: Array<{ userId: string; nickname: string; discoveryOrder: number }>;
        discovererCount: number;
      };

      if (!rabbitData) {
        // 미존재 → 최초 발견자 등록
        if (!trimmedName) {
          throw new HttpsError(
            "invalid-argument",
            "최초 발견 시 이름이 필요합니다."
          );
        }

        // 이름 중복 체크 (트랜잭션 내 원자적 — rabbitNames 인덱스 문서)
        const nameDocId = `${courseId}_${trimmedName}`;
        const nameRef = db.collection("rabbitNames").doc(nameDocId);
        const nameDoc = await transaction.get(nameRef);
        if (nameDoc.exists) {
          throw new HttpsError(
            "already-exists",
            "이미 같은 이름의 토끼가 있어요!"
          );
        }

        discoveryOrder = 1;
        needsNaming = true;
        rabbitName = trimmedName;

        // 이름 인덱스 문서 생성 (원자적)
        transaction.set(nameRef, {
          courseId,
          rabbitId,
          rabbitDocId: `${courseId}_${rabbitId}`,
          createdAt: FieldValue.serverTimestamp(),
        });

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

        // 홀딩 생성 (level/stats 초기화)
        transaction.set(holdingRef, {
          rabbitId,
          courseId,
          discoveryOrder: 1,
          discoveredAt: FieldValue.serverTimestamp(),
          level: 1,
          stats: getBaseStats(rabbitId),
        });

        rabbitUpsertPayload = {
          name: trimmedName,
          firstDiscovererUserId: userId,
          firstDiscovererName: userName,
          discoverers: [{ userId, nickname: userName, discoveryOrder: 1 }],
          discovererCount: 1,
        };
      } else {
        // 존재 → 후속 발견자 등록
        discoveryOrder = (rabbitData.discovererCount || 1) + 1;
        rabbitName = rabbitData.name || null;

        // Supabase 는 FieldValue.increment/arrayUnion 을 직접 인식 못 함 → 새 값 계산
        const existingDiscoverers: Array<{ userId: string; nickname: string; discoveryOrder: number }> =
          Array.isArray(rabbitData.discoverers) ? rabbitData.discoverers : [];
        const nextDiscoverers = [
          ...existingDiscoverers,
          { userId, nickname: userName, discoveryOrder },
        ];

        transaction.update(rabbitRef, {
          discovererCount: FieldValue.increment(1),
          discoverers: FieldValue.arrayUnion({
            userId,
            nickname: userName,
            discoveryOrder,
          }),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // 홀딩 생성 (level/stats 초기화)
        transaction.set(holdingRef, {
          rabbitId,
          courseId,
          discoveryOrder,
          discoveredAt: FieldValue.serverTimestamp(),
          level: 1,
          stats: getBaseStats(rabbitId),
        });

        rabbitUpsertPayload = {
          name: rabbitName,
          discoverers: nextDiscoverers,
          discovererCount: discoveryOrder,
        };
      }

      // 장착 처리: 빈 슬롯 자동 장착 (2개 미만)
      const equippedRabbits: Array<{ rabbitId: number; courseId: string }> =
        userData.equippedRabbits || [];

      if (equippedRabbits.length < 2) {
        // 빈 슬롯에 자동 장착 + pendingSpin 정리 + 스핀 잠금 해제
        const newEquipped = [...equippedRabbits, { rabbitId, courseId }];
        transaction.update(userRef, {
          equippedRabbits: newEquipped,
          pendingSpin: FieldValue.delete(),
          spinLock: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else if (
        equipSlot !== undefined &&
        (equipSlot === 0 || equipSlot === 1)
      ) {
        // 슬롯 지정 교체 + pendingSpin 정리 + 스핀 잠금 해제
        const newEquipped = [...equippedRabbits];
        newEquipped[equipSlot] = { rabbitId, courseId };
        transaction.update(userRef, {
          equippedRabbits: newEquipped,
          pendingSpin: FieldValue.delete(),
          spinLock: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        // 슬롯 가득 & 미지정 → 장착하지 않음 + pendingSpin 정리 + 스핀 잠금 해제
        transaction.update(userRef, {
          pendingSpin: FieldValue.delete(),
          spinLock: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return {
        success: true,
        discoveryOrder,
        needsNaming,
        rabbitName,
        // 트랜잭션 외부에서 dual-write 하기 위한 payload (반환 타입엔 없음)
        _supabasePayload: rabbitUpsertPayload,
      } as ClaimResult & { _supabasePayload: typeof rabbitUpsertPayload };
    });

    // Supabase dual-write (트랜잭션 성공 후)
    await supabaseDualWriteRabbit(courseId, rabbitId, result._supabasePayload);
    await supabaseDualWriteRabbitHolding(courseId, userId, rabbitId, {
      level: 1,
      stats: getBaseStats(rabbitId),
      discoveryOrder: result.discoveryOrder,
      discoveredAt: new Date(),
    });

    // 내부 페이로드 노출 방지
    const { _supabasePayload: _unused, ...publicResult } = result;
    void _unused;
    return publicResult;
  }
);
