/**
 * 토끼 집사 관리 Cloud Functions
 *
 * 이름 짓기, 졸업(승계), 놓아주기, 장착 등
 * 모든 쓰기 작업은 서버사이드 트랜잭션으로 처리.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/**
 * nameButlerRabbit — 집사 토끼 이름 짓기
 *
 * 집사만 호출 가능. 이름 1-10자.
 * rabbit.currentName + butlerHistory 마지막 항목 업데이트.
 */
export const nameButlerRabbit = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId, rabbitId, name } = request.data as {
      courseId: string;
      rabbitId: number;
      name: string;
    };

    if (!courseId || rabbitId === undefined || !name) {
      throw new HttpsError("invalid-argument", "courseId, rabbitId, name이 필요합니다.");
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 10) {
      throw new HttpsError("invalid-argument", "이름은 1-10자여야 합니다.");
    }

    const db = getFirestore();
    const rabbitDocId = `${courseId}_${rabbitId}`;

    await db.runTransaction(async (transaction) => {
      const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
      const rabbitDoc = await transaction.get(rabbitRef);

      if (!rabbitDoc.exists) {
        throw new HttpsError("not-found", "토끼를 찾을 수 없습니다.");
      }

      const rabbitData = rabbitDoc.data()!;

      // 집사 권한 확인
      if (rabbitData.currentButlerUserId !== userId) {
        throw new HttpsError("permission-denied", "집사만 이름을 지을 수 있습니다.");
      }

      // butlerHistory 마지막 항목 업데이트
      const history = rabbitData.butlerHistory || [];
      if (history.length > 0) {
        history[history.length - 1].name = trimmedName;
      }

      transaction.update(rabbitRef, {
        currentName: trimmedName,
        butlerHistory: history,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return { success: true, name: trimmedName };
  }
);

/**
 * graduateButlerRabbit — 집사 졸업 (승계)
 *
 * 1. 졸업자 butlerHistory 종료
 * 2. ownedRabbitKeys에서 제거하지 않음 (세대 보유자로 전환)
 * 3. 승계 큐 첫 번째 후보 → 새 집사
 * 4. 후보 없음 → 빈 토끼
 * 5. 졸업자는 세대 보유자로 전환
 */
export const graduateButlerRabbit = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId, rabbitId } = request.data as {
      courseId: string;
      rabbitId: number;
    };

    if (!courseId || rabbitId === undefined) {
      throw new HttpsError("invalid-argument", "courseId와 rabbitId가 필요합니다.");
    }

    const db = getFirestore();
    const rabbitDocId = `${courseId}_${rabbitId}`;

    const result = await db.runTransaction(async (transaction) => {
      const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
      const rabbitDoc = await transaction.get(rabbitRef);

      if (!rabbitDoc.exists) {
        throw new HttpsError("not-found", "토끼를 찾을 수 없습니다.");
      }

      const rabbitData = rabbitDoc.data()!;

      if (rabbitData.currentButlerUserId !== userId) {
        throw new HttpsError("permission-denied", "집사만 졸업할 수 있습니다.");
      }

      // 졸업자 사용자 문서
      const userRef = db.collection("users").doc(userId);
      const userDoc = await transaction.get(userRef);
      const userData = userDoc.data()!;
      const userName = userData.nickname || "용사";

      // butlerHistory 마지막 항목 종료
      const history = rabbitData.butlerHistory || [];
      if (history.length > 0) {
        history[history.length - 1].endAt = new Date().toISOString();
      }

      // 졸업자 holding을 세대 보유자로 전환
      const holdingRef = userRef.collection("rabbitHoldings").doc(rabbitDocId);
      const holdingDoc = await transaction.get(holdingRef);

      // 승계 큐 확인
      const successorRef = db.collection("rabbit_successors").doc(rabbitDocId);
      const successorDoc = await transaction.get(successorRef);
      const candidates = successorDoc.exists
        ? (successorDoc.data()!.candidates || [])
        : [];

      let newButlerUserId: string | null = null;
      let newButlerUserName: string | null = null;

      if (candidates.length > 0) {
        // 첫 번째 후보 = 새 집사
        const successor = candidates.shift()!;
        newButlerUserId = successor.userId;
        newButlerUserName = successor.userName;

        // 승계자 holding 업데이트 (generationIndex=1, isButler=true)
        const successorHoldingRef = db
          .collection("users")
          .doc(successor.userId)
          .collection("rabbitHoldings")
          .doc(rabbitDocId);

        transaction.update(successorHoldingRef, {
          generationIndex: 1,
          isButler: true,
        });

        // butlerHistory에 새 집사 추가
        history.push({
          userId: successor.userId,
          userName: successor.userName,
          name: null, // 새 집사가 이름을 지을 때까지
          startAt: new Date().toISOString(),
          endAt: null,
        });

        // 승계 큐 업데이트
        transaction.update(successorRef, { candidates });

        // 토끼 문서 업데이트
        transaction.update(rabbitRef, {
          currentButlerUserId: successor.userId,
          currentName: null, // 새 집사가 이름 지정
          butlerHistory: history,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        // 후보 없음 → 빈 토끼
        transaction.update(rabbitRef, {
          currentButlerUserId: null,
          currentName: null,
          butlerHistory: history,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // 졸업자 처리
      // holding → 세대 보유자 (nextGenerationCounter 사용)
      const nextGen = rabbitData.nextGenerationCounter || 2;
      if (holdingDoc.exists) {
        transaction.update(holdingRef, {
          generationIndex: nextGen,
          isButler: false,
        });
      }

      // nextGenerationCounter 증가
      transaction.update(rabbitRef, {
        nextGenerationCounter: FieldValue.increment(1),
      });

      // 승계 큐에 졸업자 추가 (세대 보유자로)
      const updatedCandidates = [...candidates, {
        userId,
        userName,
        generationIndex: nextGen,
        acquiredAt: new Date().toISOString(),
      }];

      if (successorDoc.exists) {
        transaction.update(successorRef, { candidates: updatedCandidates });
      } else {
        transaction.set(successorRef, { candidates: updatedCandidates });
      }

      // 장착 중이던 토끼라면 장착 유지 (세대 보유자로 바뀌어도 장착은 유지)

      return {
        success: true,
        newButlerUserId,
        newButlerUserName,
        graduatedGenerationIndex: nextGen,
      };
    });

    return result;
  }
);

/**
 * releaseRabbit — 토끼 놓아주기
 *
 * 집사/세대 무관하게 보유 토끼를 놓아주기
 * 1. holding 존재 확인 → 삭제
 * 2. ownedRabbitKeys에서 제거
 * 3. 집사였을 경우: butlerHistory 종료 → 승계자 승격
 * 4. 세대였을 경우: 승계 큐에서 제거, holderCount 감소
 * 5. 장착 중이었으면: 남은 토끼 중 첫 번째로 재설정 (없으면 null)
 */
export const releaseRabbit = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId, rabbitId } = request.data as {
      courseId: string;
      rabbitId: number;
    };

    if (!courseId || rabbitId === undefined) {
      throw new HttpsError("invalid-argument", "courseId와 rabbitId가 필요합니다.");
    }

    const db = getFirestore();
    const rabbitDocId = `${courseId}_${rabbitId}`;

    await db.runTransaction(async (transaction) => {
      const userRef = db.collection("users").doc(userId);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
      }

      const userData = userDoc.data()!;

      // holding 존재 확인
      const holdingRef = userRef.collection("rabbitHoldings").doc(rabbitDocId);
      const holdingDoc = await transaction.get(holdingRef);

      if (!holdingDoc.exists) {
        throw new HttpsError("not-found", "보유하지 않은 토끼입니다.");
      }

      const holdingData = holdingDoc.data()!;

      // rabbit 문서
      const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
      const rabbitDoc = await transaction.get(rabbitRef);

      // holding 삭제
      transaction.delete(holdingRef);

      // ownedRabbitKeys에서 제거
      transaction.update(userRef, {
        ownedRabbitKeys: FieldValue.arrayRemove(rabbitDocId),
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (rabbitDoc.exists) {
        const rabbitData = rabbitDoc.data()!;

        if (holdingData.isButler && rabbitData.currentButlerUserId === userId) {
          // 집사였던 경우 → 승계 처리
          const history = rabbitData.butlerHistory || [];
          if (history.length > 0) {
            history[history.length - 1].endAt = new Date().toISOString();
          }

          // 승계 큐 확인
          const successorRef = db.collection("rabbit_successors").doc(rabbitDocId);
          const successorDoc = await transaction.get(successorRef);
          const candidates = successorDoc.exists
            ? (successorDoc.data()!.candidates || [])
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
              .doc(rabbitDocId);
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

            transaction.update(rabbitRef, {
              currentButlerUserId: successor.userId,
              currentName: null,
              butlerHistory: history,
              holderCount: FieldValue.increment(-1),
              updatedAt: FieldValue.serverTimestamp(),
            });

            if (successorDoc.exists) {
              transaction.update(successorRef, { candidates: filteredCandidates });
            }
          } else {
            // 후보 없음 → 빈 토끼
            transaction.update(rabbitRef, {
              currentButlerUserId: null,
              currentName: null,
              butlerHistory: history,
              holderCount: FieldValue.increment(-1),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        } else {
          // 세대 보유자였던 경우
          transaction.update(rabbitRef, {
            holderCount: FieldValue.increment(-1),
            updatedAt: FieldValue.serverTimestamp(),
          });

          // 승계 큐에서 제거
          const successorRef = db.collection("rabbit_successors").doc(rabbitDocId);
          const successorDoc = await transaction.get(successorRef);
          if (successorDoc.exists) {
            const candidates = successorDoc.data()!.candidates || [];
            const filtered = candidates.filter(
              (c: { userId: string }) => c.userId !== userId
            );
            transaction.update(successorRef, { candidates: filtered });
          }
        }
      }

      // 장착 중이었으면 재설정
      if (
        userData.equippedRabbitId === rabbitId &&
        userData.equippedRabbitCourseId === courseId
      ) {
        const ownedKeys: string[] = userData.ownedRabbitKeys || [];
        const remainingKeys = ownedKeys.filter((k) => k !== rabbitDocId);

        if (remainingKeys.length > 0) {
          // 남은 토끼 중 첫 번째로 재설정
          const [newCourseId, newRabbitIdStr] = remainingKeys[0].split("_");
          transaction.update(userRef, {
            equippedRabbitId: parseInt(newRabbitIdStr, 10),
            equippedRabbitCourseId: newCourseId,
          });
        } else {
          // 보유 토끼 없음
          transaction.update(userRef, {
            equippedRabbitId: null,
            equippedRabbitCourseId: null,
          });
        }
      }
    });

    return { success: true };
  }
);

/**
 * equipRabbit — 토끼 장착
 *
 * rabbitHoldings에 존재하는 토끼만 장착 가능.
 */
export const equipRabbit = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId, rabbitId } = request.data as {
      courseId: string;
      rabbitId: number;
    };

    if (!courseId || rabbitId === undefined) {
      throw new HttpsError("invalid-argument", "courseId와 rabbitId가 필요합니다.");
    }

    const db = getFirestore();
    const rabbitDocId = `${courseId}_${rabbitId}`;

    // 보유 여부 확인
    const holdingRef = db
      .collection("users")
      .doc(userId)
      .collection("rabbitHoldings")
      .doc(rabbitDocId);

    const holdingDoc = await holdingRef.get();
    if (!holdingDoc.exists) {
      throw new HttpsError("not-found", "보유하지 않은 토끼입니다.");
    }

    // 장착
    await db.collection("users").doc(userId).update({
      equippedRabbitId: rabbitId,
      equippedRabbitCourseId: courseId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  }
);
