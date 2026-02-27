/**
 * 토끼 스탯 마이그레이션 Callable CF
 *
 * 기존 홀딩 문서의 옛 공식 베이스 스탯을 새 룩업 테이블 베이스로 교체.
 * 레벨업 보너스(diff = currentStats - oldBase)를 보존하여:
 *   newStats = newBase + diff
 *
 * 운영자(교수)가 1회 호출.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getBaseStats, getOldBaseStats } from "./utils/rabbitStats";

export const migrateRabbitStats = onCall(
  { region: "asia-northeast3", timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const db = getFirestore();

    // 교수 권한 확인
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 실행 가능합니다.");
    }

    // 모든 유저 조회
    const usersSnap = await db.collection("users").get();
    let totalMigrated = 0;
    let totalSkipped = 0;

    // 유저별로 배치 처리 (Firestore 배치 한도 500)
    for (const userDoc of usersSnap.docs) {
      const holdingsSnap = await userDoc.ref
        .collection("rabbitHoldings")
        .get();

      if (holdingsSnap.empty) continue;

      const batch = db.batch();
      let batchCount = 0;

      for (const holdingDoc of holdingsSnap.docs) {
        const data = holdingDoc.data();
        const rabbitId = data.rabbitId as number;

        if (rabbitId === undefined || rabbitId === null) {
          totalSkipped++;
          continue;
        }

        const currentStats = data.stats;
        if (!currentStats) {
          // stats 필드 없음 → 새 베이스로 초기화
          batch.update(holdingDoc.ref, {
            stats: getBaseStats(rabbitId),
          });
          batchCount++;
          totalMigrated++;
          continue;
        }

        const oldBase = getOldBaseStats(rabbitId);
        const newBase = getBaseStats(rabbitId);

        // 레벨업 보너스 = 현재 스탯 - 옛 베이스
        const diffHp = Math.max(0, currentStats.hp - oldBase.hp);
        const diffAtk = Math.max(0, currentStats.atk - oldBase.atk);
        const diffDef = Math.max(0, currentStats.def - oldBase.def);

        const newStats = {
          hp: newBase.hp + diffHp,
          atk: newBase.atk + diffAtk,
          def: newBase.def + diffDef,
        };

        batch.update(holdingDoc.ref, { stats: newStats });
        batchCount++;
        totalMigrated++;
      }

      if (batchCount > 0) {
        await batch.commit();
      }
    }

    console.log(
      `토끼 스탯 마이그레이션 완료: ${totalMigrated}건 변환, ${totalSkipped}건 스킵`
    );

    return {
      success: true,
      migrated: totalMigrated,
      skipped: totalSkipped,
    };
  }
);
