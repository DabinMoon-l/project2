/**
 * 온보딩 완료 시 기본 토끼(rabbitId: 0) 자동 지급
 *
 * users/{uid} 문서에 onboardingCompleted가 true로 변경되면
 * 기본 토끼를 rabbitHoldings에 생성하고 equippedRabbits에 장착
 *
 * transaction 사용: discoveryOrder 중복 방지
 */

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getBaseStats } from "./utils/rabbitStats";
import {
  SUPABASE_URL_SECRET,
  SUPABASE_SERVICE_ROLE_SECRET,
  DEFAULT_ORG_ID_SECRET,
  supabaseDualUpdateUserPartial,
  supabaseDualWriteRabbit,
  supabaseDualWriteRabbitHolding,
} from "./utils/supabase";

export const onOnboardingComplete = onDocumentUpdated(
  {
    document: "users/{uid}",
    region: "asia-northeast3",
    secrets: [SUPABASE_URL_SECRET, SUPABASE_SERVICE_ROLE_SECRET, DEFAULT_ORG_ID_SECRET],
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    // onboardingCompleted가 false→true로 변경된 경우만
    if (before.onboardingCompleted || !after.onboardingCompleted) return;

    // 이미 equippedRabbits가 있으면 중복 방지
    if (after.equippedRabbits && after.equippedRabbits.length > 0) return;

    const uid = event.params.uid;
    const courseId = after.courseId;
    if (!courseId) return;

    const db = getFirestore();
    const rabbitId = 0;
    const holdingKey = `${courseId}_${rabbitId}`;
    const nickname = after.nickname || "알 수 없음";

    const userRef = db.collection("users").doc(uid);
    const holdingRef = userRef.collection("rabbitHoldings").doc(holdingKey);
    const rabbitRef = db.collection("rabbits").doc(holdingKey);

    interface SupabasePayload {
      holding: { level: number; stats: { hp: number; atk: number; def: number }; discoveryOrder: number };
      rabbit: {
        isNew: boolean;
        discoverers: Array<{ userId: string; nickname: string; discoveryOrder: number }>;
        discovererCount: number;
      };
      equippedUpdated: boolean;
      newEquipped: Array<{ rabbitId: number; courseId: string }>;
    }

    const supabasePayload = await db.runTransaction<SupabasePayload | null>(
      async (transaction) => {
        // ALL READS FIRST (Firestore 트랜잭션 요구사항)
        const holdingDoc = await transaction.get(holdingRef);
        if (holdingDoc.exists) return null; // 이미 홀딩 존재 — 중복 방지

        const rabbitDoc = await transaction.get(rabbitRef);
        const userDoc = await transaction.get(userRef);

        // ALL WRITES
        // 1. rabbitHoldings 서브컬렉션에 기본 토끼 추가
        const baseStats = getBaseStats(rabbitId);
        transaction.set(holdingRef, {
          rabbitId,
          courseId,
          discoveryOrder: 1,
          discoveredAt: FieldValue.serverTimestamp(),
          level: 1,
          stats: baseStats,
        });

        let rabbitIsNew: boolean;
        let discoverers: Array<{ userId: string; nickname: string; discoveryOrder: number }>;
        let discovererCount: number;

        // 2. rabbits 컬렉션에 기본 토끼 문서 생성/업데이트
        if (!rabbitDoc.exists) {
          rabbitIsNew = true;
          discoverers = [{ userId: uid, nickname, discoveryOrder: 1 }];
          discovererCount = 1;
          transaction.set(rabbitRef, {
            rabbitId,
            courseId,
            name: null,
            firstDiscovererUserId: uid,
            firstDiscovererName: nickname,
            discovererCount,
            discoverers,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          rabbitIsNew = false;
          // 트랜잭션 내에서 읽은 값으로 discoveryOrder 계산 (중복 방지)
          const existingData = rabbitDoc.data()!;
          discovererCount = (existingData.discovererCount || 1) + 1;
          const existingDiscoverers = (existingData.discoverers as Array<{ userId: string; nickname: string; discoveryOrder: number }>) || [];
          discoverers = [
            ...existingDiscoverers,
            { userId: uid, nickname, discoveryOrder: discovererCount },
          ];
          transaction.update(rabbitRef, {
            discovererCount,
            discoverers: FieldValue.arrayUnion({
              userId: uid,
              nickname,
              discoveryOrder: discovererCount,
            }),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        // 3. equippedRabbits에 기본 토끼 장착 (현재 상태 기반)
        const currentEquipped = (userDoc.data()?.equippedRabbits as Array<{ rabbitId: number; courseId: string }>) || [];
        let equippedUpdated = false;
        let newEquipped = currentEquipped;
        if (currentEquipped.length === 0) {
          equippedUpdated = true;
          newEquipped = [{ rabbitId, courseId }];
          transaction.update(userRef, {
            equippedRabbits: newEquipped,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        return {
          holding: { level: 1, stats: baseStats, discoveryOrder: 1 },
          rabbit: { isNew: rabbitIsNew, discoverers, discovererCount },
          equippedUpdated,
          newEquipped,
        };
      }
    );

    console.log(`기본 토끼 지급 완료: uid=${uid}, courseId=${courseId}`);

    // Supabase dual-write (rabbits / rabbit_holdings / user_profiles.equipped_rabbits)
    if (supabasePayload) {
      await Promise.all([
        supabaseDualWriteRabbitHolding(courseId, uid, rabbitId, {
          level: supabasePayload.holding.level,
          stats: supabasePayload.holding.stats,
          discoveryOrder: supabasePayload.holding.discoveryOrder,
          discoveredAt: new Date(),
        }).catch((e) => console.warn("[Supabase onboarding holding dual-write]", e)),
        supabaseDualWriteRabbit(courseId, rabbitId, {
          ...(supabasePayload.rabbit.isNew
            ? {
              firstDiscovererUserId: uid,
              firstDiscovererName: nickname,
              firstDiscovererNickname: nickname,
            }
            : {}),
          discoverers: supabasePayload.rabbit.discoverers,
          discovererCount: supabasePayload.rabbit.discovererCount,
        }).catch((e) => console.warn("[Supabase onboarding rabbit dual-write]", e)),
        supabasePayload.equippedUpdated
          ? supabaseDualUpdateUserPartial(uid, {
            equippedRabbits: supabasePayload.newEquipped,
          }).catch((e) => console.warn("[Supabase onboarding equipped dual-write]", e))
          : Promise.resolve(),
      ]);
    }
  }
);
