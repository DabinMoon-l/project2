/**
 * 실시간 배틀 신청(초대) 시스템
 *
 * 플로우:
 * 1. sendBattleInvite — 신청자가 접속자 중 1명에게 직접 신청.
 *    RTDB에 2곳 미러링 기록:
 *      - battleInvites/{receiverUid}/current (수신자 구독용)
 *      - battleInviteOutbox/{senderUid}/current (신청자 구독용, status/battleId 전파)
 * 2. respondBattleInvite('accept'|'decline') — 수신자 응답.
 *    accept 시 createBattle() 즉시 호출 → 매칭 단계 없이 countdown으로 직행.
 *
 * 만료: expiresAt = createdAt + 3000ms. 클라이언트 측 3초 타이머 + CF 서버 시간 검증.
 *
 * 바쁨 판정: presence/{courseId}/{receiverUid}.currentActivity 가
 * '퀴즈 풀이' | '배틀' | '연타 미니게임' 중 하나면 신청 불가.
 * 차단: 수신자 appSettings.privacy.allowBattleInvites === false 면 불가.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { createBattle } from "./tekkenRound";
import { getBaseStats } from "../utils/rabbitStats";
import type { PlayerSetup } from "./tekkenTypes";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/** 배틀 신청 유효 시간 (ms) — 3초 */
const INVITE_TTL_MS = 3_000;

/** 수신자가 "바쁨"으로 판정되는 활동 */
const BUSY_ACTIVITIES = new Set([
  "퀴즈 풀이",
  "배틀",
  "연타 미니게임",
  // 가로모드 3쪽 잠금 (퀴즈/복습/만들기 진행 중)을 useActivityTracker 가 반영
  "집중 학습",
]);

interface InviteRecord {
  id: string;
  senderUid: string;
  senderNickname: string;
  senderClass: string | null;
  senderRabbit: {
    rabbitId: number;
    name: string;
    level: number;
  };
  chapters: string[];
  courseId: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "accepted" | "declined" | "expired";
  battleId?: string;
}

interface OutboxRecord {
  id: string;
  receiverUid: string;
  receiverNickname: string;
  status: "pending" | "accepted" | "declined" | "expired";
  createdAt: number;
  expiresAt: number;
  battleId?: string;
}

/** 신청자의 장착 토끼 1마리(slot 0) 정보 조회 — 도전장에 표시용 */
async function getSenderRabbitInfo(
  senderUid: string,
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>
): Promise<{ rabbitId: number; name: string; level: number }> {
  const slot0 = equippedRabbits[0];
  // 장착 없으면 기본 토끼(0번) fallback — 실서비스에선 온보딩에서 자동 지급
  if (!slot0) {
    return { rabbitId: 0, name: "토끼", level: 1 };
  }

  const db = getFirestore();
  const holdingId = `${slot0.courseId}_${slot0.rabbitId}`;
  const [holdingDoc, rabbitDoc] = await Promise.all([
    db.collection("users").doc(senderUid)
      .collection("rabbitHoldings").doc(holdingId).get(),
    db.collection("rabbits").doc(holdingId).get(),
  ]);

  const holdingData = holdingDoc.exists ? holdingDoc.data() : null;
  const rabbitName = rabbitDoc.exists ? (rabbitDoc.data()?.name || null) : null;
  const level = holdingData?.level || 1;

  return {
    rabbitId: slot0.rabbitId,
    name: rabbitName || "토끼",
    level,
  };
}

// ============================================
// sendBattleInvite
// ============================================
export const sendBattleInvite = onCall(
  {
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const senderUid = request.auth.uid;
    const { receiverUid, chapters } = request.data as {
      receiverUid: string;
      chapters: string[];
    };

    if (!receiverUid) {
      throw new HttpsError("invalid-argument", "receiverUid가 필요합니다.");
    }
    if (senderUid === receiverUid) {
      throw new HttpsError("invalid-argument", "자기 자신에게 신청할 수 없습니다.");
    }
    if (!chapters || chapters.length === 0) {
      throw new HttpsError("invalid-argument", "최소 1개 챕터를 선택해야 합니다.");
    }

    const fsDb = getFirestore();
    const rtdb = getDatabase();

    // 신청자·수신자 문서 병렬 로드
    const [senderDoc, receiverDoc] = await Promise.all([
      fsDb.collection("users").doc(senderUid).get(),
      fsDb.collection("users").doc(receiverUid).get(),
    ]);
    if (!senderDoc.exists) {
      throw new HttpsError("not-found", "신청자 계정을 찾을 수 없습니다.");
    }
    if (!receiverDoc.exists) {
      throw new HttpsError("not-found", "상대를 찾을 수 없습니다.");
    }
    const sender = senderDoc.data()!;
    const receiver = receiverDoc.data()!;

    // 과목 일치 체크 (같은 과목 내에서만)
    const senderCourseId = sender.courseId;
    const receiverCourseId = receiver.courseId;
    if (!senderCourseId || senderCourseId !== receiverCourseId) {
      throw new HttpsError("failed-precondition", "같은 과목의 학생에게만 신청할 수 있습니다.");
    }

    // 수신자의 배틀 신청 차단 설정 체크 (기본 true)
    const allow = receiver.appSettings?.privacy?.allowBattleInvites;
    if (allow === false) {
      throw new HttpsError("permission-denied", "상대가 배틀 신청을 받지 않습니다.");
    }

    // 수신자 현재 활동(바쁨) 체크 — presence RTDB
    const presenceSnap = await rtdb
      .ref(`presence/${receiverCourseId}/${receiverUid}`)
      .once("value");
    const presence = presenceSnap.val() as {
      online?: boolean;
      currentActivity?: string;
    } | null;
    if (!presence?.online) {
      throw new HttpsError("failed-precondition", "상대가 접속 중이 아닙니다.");
    }
    if (presence.currentActivity && BUSY_ACTIVITIES.has(presence.currentActivity)) {
      throw new HttpsError("failed-precondition", "상대가 지금 다른 활동 중입니다.");
    }

    // 신청자 장착 토끼 정보 (도전장 표시용, slot 0만)
    const senderEquipped: Array<{ rabbitId: number; courseId: string }> =
      sender.equippedRabbits || [];
    const senderRabbit = await getSenderRabbitInfo(senderUid, senderEquipped);

    // 신규 invite 생성
    const inviteId = rtdb.ref(`battleInvites/${receiverUid}`).push().key!;
    const createdAt = Date.now();
    const expiresAt = createdAt + INVITE_TTL_MS;

    const inviteRecord: InviteRecord = {
      id: inviteId,
      senderUid,
      senderNickname: sender.nickname || "플레이어",
      senderClass: sender.classType || null,
      senderRabbit,
      chapters,
      courseId: senderCourseId,
      createdAt,
      expiresAt,
      status: "pending",
    };

    const outboxRecord: OutboxRecord = {
      id: inviteId,
      receiverUid,
      receiverNickname: receiver.nickname || "상대",
      status: "pending",
      createdAt,
      expiresAt,
    };

    // 양쪽 미러링 기록 — 기존 current 은 덮어쓰기 (가장 최근 하나만 유효)
    await Promise.all([
      rtdb.ref(`battleInvites/${receiverUid}/current`).set(inviteRecord),
      rtdb.ref(`battleInviteOutbox/${senderUid}/current`).set(outboxRecord),
    ]);

    return { inviteId, expiresAt };
  }
);

// ============================================
// respondBattleInvite
// ============================================
export const respondBattleInvite = onCall(
  {
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const receiverUid = request.auth.uid;
    const { inviteId, action } = request.data as {
      inviteId: string;
      action: "accept" | "decline";
    };

    if (!inviteId) {
      throw new HttpsError("invalid-argument", "inviteId가 필요합니다.");
    }
    if (action !== "accept" && action !== "decline") {
      throw new HttpsError("invalid-argument", "action은 accept 또는 decline.");
    }

    const rtdb = getDatabase();
    const fsDb = getFirestore();

    const inviteRef = rtdb.ref(`battleInvites/${receiverUid}/current`);
    const inviteSnap = await inviteRef.once("value");
    const invite = inviteSnap.val() as InviteRecord | null;

    if (!invite || invite.id !== inviteId) {
      throw new HttpsError("not-found", "신청을 찾을 수 없습니다.");
    }
    if (invite.status !== "pending") {
      throw new HttpsError("failed-precondition", "이미 처리된 신청입니다.");
    }

    const now = Date.now();
    const outboxRef = rtdb.ref(`battleInviteOutbox/${invite.senderUid}/current`);

    // 서버 시간 기준 만료 검증
    if (now > invite.expiresAt) {
      const expiredPatch = { status: "expired" as const };
      await Promise.all([
        inviteRef.update(expiredPatch),
        outboxRef.update(expiredPatch),
      ]);
      throw new HttpsError("failed-precondition", "신청이 만료되었습니다.");
    }

    // 거절
    if (action === "decline") {
      const declinedPatch = { status: "declined" as const };
      await Promise.all([
        inviteRef.update(declinedPatch),
        outboxRef.update(declinedPatch),
      ]);
      return { status: "declined" as const };
    }

    // 수락 — createBattle 즉시 호출 (매칭 스킵, countdown 상태로 방 생성)
    // 양쪽 유저의 equippedRabbits 조회
    const [senderDoc, receiverDoc] = await Promise.all([
      fsDb.collection("users").doc(invite.senderUid).get(),
      fsDb.collection("users").doc(receiverUid).get(),
    ]);
    if (!senderDoc.exists || !receiverDoc.exists) {
      throw new HttpsError("not-found", "플레이어 정보를 찾을 수 없습니다.");
    }
    const senderData = senderDoc.data()!;
    const receiverData = receiverDoc.data()!;

    // 장착 토끼 — 없으면 기본 토끼(0번) fallback
    const defaultRabbit = (courseId: string) => ({ rabbitId: 0, courseId });
    const senderEquipped: Array<{ rabbitId: number; courseId: string }> =
      (senderData.equippedRabbits && senderData.equippedRabbits.length > 0)
        ? senderData.equippedRabbits
        : [defaultRabbit(invite.courseId)];
    const receiverEquipped: Array<{ rabbitId: number; courseId: string }> =
      (receiverData.equippedRabbits && receiverData.equippedRabbits.length > 0)
        ? receiverData.equippedRabbits
        : [defaultRabbit(invite.courseId)];

    // 장착 토끼 기본 스탯 존재 확인 (getBaseStats 호출만 — 유효성)
    getBaseStats(senderEquipped[0].rabbitId);
    getBaseStats(receiverEquipped[0].rabbitId);

    const player1: PlayerSetup = {
      userId: invite.senderUid,
      nickname: invite.senderNickname,
      profileRabbitId: senderEquipped[0].rabbitId,
      isBot: false,
      equippedRabbits: senderEquipped,
    };
    const player2: PlayerSetup = {
      userId: receiverUid,
      nickname: receiverData.nickname || "상대",
      profileRabbitId: receiverEquipped[0].rabbitId,
      isBot: false,
      equippedRabbits: receiverEquipped,
    };

    const battleId = await createBattle(
      invite.courseId,
      player1,
      player2,
      GEMINI_API_KEY.value(),
      invite.chapters,
    );

    // invite/outbox 양쪽에 battleId + accepted 기록
    const acceptedPatch = { status: "accepted" as const, battleId };
    await Promise.all([
      inviteRef.update(acceptedPatch),
      outboxRef.update(acceptedPatch),
    ]);

    return { status: "accepted" as const, battleId };
  }
);
