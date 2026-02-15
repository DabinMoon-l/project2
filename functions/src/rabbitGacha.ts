/**
 * 토끼 뽑기 Cloud Function (2단계: Roll → Claim)
 *
 * Phase 1 (Roll): 랜덤 토끼 선택 + 상태 판별 → RollResult 반환
 * Phase 2 (Claim): 사용자 선택(adopt/release)에 따라 문서 생성/변경
 *
 * 보유 제한: 전체 보유 최대 3마리 (집사+세대 통합)
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/** Roll 결과 타입 (Phase 1 반환값) */
interface RollResult {
  type: "undiscovered" | "discovered" | "duplicate";
  rabbitId: number;
  currentRabbitName: string | null;
  currentButlerName: string | null;
  holderCount: number;
  ownedCount: number;
  generationIndex: number | null;
}

/** Claim 결과 타입 (Phase 2 반환값) */
interface ClaimResult {
  success: boolean;
  resultType: "new_butler" | "new_generation";
  generationIndex: number;
  needsNaming: boolean;
  currentRabbitName: string | null;
}

/**
 * spinRabbitGacha — Roll Only (Phase 1)
 *
 * 1. 마일스톤 검증 (floor(totalExp/50)*50 > lastGachaExp && totalExp >= 50)
 * 2. 랜덤 rabbitId (0-99) 선택
 * 3. rabbit 문서 존재 확인 → undiscovered / discovered 판별
 * 4. holding 존재 확인 → duplicate 판별
 * 5. lastGachaExp 갱신 (스핀 소모)
 * 6. 문서 생성/변경 없음 (lastGachaExp 제외)
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

      // 랜덤 토끼 ID (0-99)
      const rabbitId = Math.floor(Math.random() * 100);
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

      // 보유 수 계산
      const ownedKeys: string[] = userData.ownedRabbitKeys || [];

      if (holdingDoc.exists) {
        // 중복 — 이미 보유한 토끼
        return {
          type: "duplicate",
          rabbitId,
          currentRabbitName: rabbitData?.currentName || null,
          currentButlerName: null,
          holderCount: rabbitData?.holderCount || 0,
          ownedCount: ownedKeys.length,
          generationIndex: holdingDoc.data()!.generationIndex,
        } as RollResult;
      }

      if (!rabbitData) {
        // 미발견 — 아직 아무도 발견하지 않은 토끼
        return {
          type: "undiscovered",
          rabbitId,
          currentRabbitName: null,
          currentButlerName: null,
          holderCount: 0,
          ownedCount: ownedKeys.length,
          generationIndex: null,
        } as RollResult;
      }

      // 발견 — 이미 존재하는 토끼 (다른 사람이 보유)
      // 현재 집사 닉네임 조회
      let currentButlerName: string | null = null;
      if (rabbitData.currentButlerUserId) {
        const butlerUserDoc = await transaction.get(
          db.collection("users").doc(rabbitData.currentButlerUserId)
        );
        if (butlerUserDoc.exists) {
          currentButlerName = butlerUserDoc.data()!.nickname || "용사";
        }
      }

      return {
        type: "discovered",
        rabbitId,
        currentRabbitName: rabbitData.currentName || null,
        currentButlerName,
        holderCount: rabbitData.holderCount || 0,
        ownedCount: ownedKeys.length,
        generationIndex: null,
      } as RollResult;
    });

    return result;
  }
);

/**
 * claimGachaRabbit — Claim (Phase 2)
 *
 * action === "release" → 즉시 반환 (아무 변경 없음)
 * action === "adopt" → 트랜잭션:
 *   1. 이미 보유 확인 → error
 *   2. ownedRabbitKeys.length 확인:
 *      - >= 3 && !replaceKey → error "교체 대상 필요"
 *      - >= 3 && replaceKey → 내부 release 로직 실행 후 진행
 *   3. rabbit 문서 재확인:
 *      - 미존재 → 집사(1세) 등록
 *      - 존재 → 세대 보유자 등록
 *   4. ownedRabbitKeys에 추가
 *   5. 첫 토끼면 자동 장착
 */
export const claimGachaRabbit = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId, rabbitId, action, name, replaceKey } = request.data as {
      courseId: string;
      rabbitId: number;
      action: "adopt" | "release";
      name?: string;
      replaceKey?: string;
    };

    if (!courseId || rabbitId === undefined || !action) {
      throw new HttpsError("invalid-argument", "courseId, rabbitId, action이 필요합니다.");
    }

    // 놓아주기 → 아무 변경 없음
    if (action === "release") {
      return { success: true, released: true };
    }

    // 이름 유효성 검사 (집사일 때)
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
      const ownedKeys: string[] = userData.ownedRabbitKeys || [];

      // 이미 보유 확인
      const holdingRef = userRef.collection("rabbitHoldings").doc(rabbitDocId);
      const holdingDoc = await transaction.get(holdingRef);
      if (holdingDoc.exists) {
        throw new HttpsError("already-exists", "이미 보유한 토끼입니다.");
      }

      // 보유 수 확인 + 교체 처리
      if (ownedKeys.length >= 3) {
        if (!replaceKey) {
          throw new HttpsError("failed-precondition", "교체 대상이 필요합니다.");
        }

        // 교체 대상 release 로직
        if (!ownedKeys.includes(replaceKey)) {
          throw new HttpsError("not-found", "교체 대상 토끼를 보유하고 있지 않습니다.");
        }

        // 교체 대상 holding 삭제
        const replaceHoldingRef = userRef.collection("rabbitHoldings").doc(replaceKey);
        const replaceHoldingDoc = await transaction.get(replaceHoldingRef);
        if (!replaceHoldingDoc.exists) {
          throw new HttpsError("not-found", "교체 대상 holding을 찾을 수 없습니다.");
        }

        const replaceHoldingData = replaceHoldingDoc.data()!;
        const replaceRabbitRef = db.collection("rabbits").doc(replaceKey);
        const replaceRabbitDoc = await transaction.get(replaceRabbitRef);

        // holding 삭제
        transaction.delete(replaceHoldingRef);

        if (replaceRabbitDoc.exists) {
          const replaceRabbitData = replaceRabbitDoc.data()!;

          if (replaceHoldingData.isButler && replaceRabbitData.currentButlerUserId === userId) {
            // 집사였던 경우 → 승계 처리
            const history = replaceRabbitData.butlerHistory || [];
            if (history.length > 0) {
              history[history.length - 1].endAt = new Date().toISOString();
            }

            // 승계 큐 확인
            const replaceSuccessorRef = db.collection("rabbit_successors").doc(replaceKey);
            const replaceSuccessorDoc = await transaction.get(replaceSuccessorRef);
            const candidates = replaceSuccessorDoc.exists
              ? (replaceSuccessorDoc.data()!.candidates || [])
              : [];

            // 승계자에서 현재 사용자 제거
            const filteredCandidates = candidates.filter(
              (c: { userId: string }) => c.userId !== userId
            );

            if (filteredCandidates.length > 0) {
              // 첫 번째 후보 → 새 집사
              const successor = filteredCandidates.shift()!;

              const successorHoldingRef = db
                .collection("users")
                .doc(successor.userId)
                .collection("rabbitHoldings")
                .doc(replaceKey);
              transaction.update(successorHoldingRef, {
                generationIndex: 1,
                isButler: true,
              });

              history.push({
                userId: successor.userId,
                userName: successor.userName,
                name: null,
                startAt: new Date().toISOString(),
                endAt: null,
              });

              transaction.update(replaceRabbitRef, {
                currentButlerUserId: successor.userId,
                currentName: null,
                butlerHistory: history,
                holderCount: FieldValue.increment(-1),
                updatedAt: FieldValue.serverTimestamp(),
              });

              if (replaceSuccessorDoc.exists) {
                transaction.update(replaceSuccessorRef, { candidates: filteredCandidates });
              }
            } else {
              // 후보 없음 → 빈 토끼
              transaction.update(replaceRabbitRef, {
                currentButlerUserId: null,
                currentName: null,
                butlerHistory: history,
                holderCount: FieldValue.increment(-1),
                updatedAt: FieldValue.serverTimestamp(),
              });
            }
          } else {
            // 세대 보유자였던 경우
            transaction.update(replaceRabbitRef, {
              holderCount: FieldValue.increment(-1),
              updatedAt: FieldValue.serverTimestamp(),
            });

            // 승계 큐에서 제거
            const replaceSuccessorRef = db.collection("rabbit_successors").doc(replaceKey);
            const replaceSuccessorDoc = await transaction.get(replaceSuccessorRef);
            if (replaceSuccessorDoc.exists) {
              const candidates = replaceSuccessorDoc.data()!.candidates || [];
              const filtered = candidates.filter(
                (c: { userId: string }) => c.userId !== userId
              );
              transaction.update(replaceSuccessorRef, { candidates: filtered });
            }
          }
        }

        // ownedRabbitKeys에서 교체 대상 제거
        transaction.update(userRef, {
          ownedRabbitKeys: FieldValue.arrayRemove(replaceKey),
        });

        // 장착 중이었으면 새 토끼로 자동 재설정
        if (
          userData.equippedRabbitId === replaceHoldingData.rabbitId &&
          userData.equippedRabbitCourseId === replaceHoldingData.courseId
        ) {
          transaction.update(userRef, {
            equippedRabbitId: rabbitId,
            equippedRabbitCourseId: courseId,
          });
        }
      }

      // rabbit 문서 재확인 (클레임 시점 상태)
      const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
      const rabbitDoc = await transaction.get(rabbitRef);
      const rabbitData = rabbitDoc.exists ? rabbitDoc.data()! : null;

      let resultType: "new_butler" | "new_generation";
      let generationIndex: number;
      let needsNaming = false;

      if (!rabbitData) {
        // 미존재 → 집사(1세) 등록
        resultType = "new_butler";
        generationIndex = 1;
        needsNaming = true;

        // 토끼 문서 생성
        transaction.set(rabbitRef, {
          courseId,
          rabbitId,
          currentButlerUserId: userId,
          currentName: trimmedName || null,
          nextGenerationCounter: 2,
          holderCount: 1,
          butlerHistory: [{
            userId,
            userName,
            name: trimmedName || null,
            startAt: FieldValue.serverTimestamp(),
            endAt: null,
          }],
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // 홀딩 생성
        transaction.set(holdingRef, {
          rabbitId,
          courseId,
          generationIndex: 1,
          isButler: true,
          acquiredAt: FieldValue.serverTimestamp(),
        });
      } else {
        // 존재 → 세대 보유자 등록
        const nextGen = rabbitData.nextGenerationCounter || 2;
        resultType = "new_generation";
        generationIndex = nextGen;

        transaction.update(rabbitRef, {
          nextGenerationCounter: FieldValue.increment(1),
          holderCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // 홀딩 생성
        transaction.set(holdingRef, {
          rabbitId,
          courseId,
          generationIndex: nextGen,
          isButler: false,
          acquiredAt: FieldValue.serverTimestamp(),
        });

        // 승계 큐에 추가
        const successorRef = db.collection("rabbit_successors").doc(rabbitDocId);
        const successorDoc = await transaction.get(successorRef);
        const existingCandidates = successorDoc.exists
          ? (successorDoc.data()!.candidates || [])
          : [];
        existingCandidates.push({
          userId,
          userName,
          generationIndex: nextGen,
          acquiredAt: new Date().toISOString(),
        });

        if (successorDoc.exists) {
          transaction.update(successorRef, { candidates: existingCandidates });
        } else {
          transaction.set(successorRef, { candidates: existingCandidates });
        }
      }

      // ownedRabbitKeys에 추가
      transaction.update(userRef, {
        ownedRabbitKeys: FieldValue.arrayUnion(rabbitDocId),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 첫 토끼면 자동 장착
      const currentOwnedKeys = userData.ownedRabbitKeys || [];
      if (
        currentOwnedKeys.length === 0 &&
        (userData.equippedRabbitId === undefined || userData.equippedRabbitId === null)
      ) {
        transaction.update(userRef, {
          equippedRabbitId: rabbitId,
          equippedRabbitCourseId: courseId,
        });
      }

      return {
        success: true,
        resultType,
        generationIndex,
        needsNaming,
        currentRabbitName: rabbitData?.currentName || trimmedName || null,
      } as ClaimResult;
    });

    return result;
  }
);
