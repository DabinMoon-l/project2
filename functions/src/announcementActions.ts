/**
 * 공지 채널 — 투표/리액션/읽음 처리 (서버사이드 검증)
 *
 * 클라이언트에서 announcements 문서를 직접 수정하는 대신,
 * CF에서 호출자 UID만 조작할 수 있도록 검증합니다.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// 허용 이모지 목록
const ALLOWED_EMOJIS = ["❤️", "👍", "🔥", "😂", "😮", "😢"];

/**
 * 공지 투표 (단일/복수 선택)
 *
 * 호출자의 UID만 추가/제거 — 다른 사용자의 투표는 변경 불가
 */
export const voteOnPoll = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const uid = request.auth.uid;
    const { announcementId, pollIdx, optIndices } = request.data as {
      announcementId: string;
      pollIdx: number;
      optIndices: number[];
    };

    if (!announcementId || pollIdx === undefined || !Array.isArray(optIndices)) {
      throw new HttpsError("invalid-argument", "필수 파라미터가 누락되었습니다.");
    }

    const db = getFirestore();
    const docRef = db.collection("announcements").doc(announcementId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        throw new HttpsError("not-found", "공지를 찾을 수 없습니다.");
      }

      const data = snap.data()!;

      // polls 배열 추출 (하위 호환: poll 단일 → 배열 래핑)
      let polls: any[] = data.polls || (data.poll ? [data.poll] : []);

      // 객체→배열 복구 (Firestore가 간혹 배열을 객체로 변환)
      if (polls && !Array.isArray(polls)) {
        polls = Object.values(polls);
      }

      const poll = polls[pollIdx];
      if (!poll) {
        throw new HttpsError("not-found", "투표를 찾을 수 없습니다.");
      }

      // 선지 범위 검증
      const maxOpt = (poll.options || []).length;
      for (const idx of optIndices) {
        if (idx < 0 || idx >= maxOpt) {
          throw new HttpsError("invalid-argument", "잘못된 선지 인덱스입니다.");
        }
      }

      // 복수선택 제한 검증
      if (!poll.allowMultiple && optIndices.length > 1) {
        throw new HttpsError("invalid-argument", "단일 선택 투표입니다.");
      }
      if (poll.allowMultiple && poll.maxSelections && optIndices.length > poll.maxSelections) {
        throw new HttpsError("invalid-argument", `최대 ${poll.maxSelections}개까지 선택 가능합니다.`);
      }

      // 현재 votes에서 호출자 UID만 제거 후 선택한 옵션에 추가
      const votes: Record<string, string[]> = { ...(poll.votes || {}) };
      for (const key of Object.keys(votes)) {
        votes[key] = votes[key].filter((id: string) => id !== uid);
      }
      for (const optIdx of optIndices) {
        const key = optIdx.toString();
        if (!votes[key]) votes[key] = [];
        votes[key].push(uid);
      }

      // polls 배열 전체 업데이트 (dot notation 금지 — Firestore 배열→객체 변환 버그 방지)
      const newPolls = polls.map((p: any, i: number) =>
        i === pollIdx ? { ...p, votes } : p
      );

      if (data.polls) {
        tx.update(docRef, { polls: newPolls });
      } else {
        // 하위 호환: 단일 poll 필드 (dot notation 금지)
        tx.update(docRef, { poll: { ...polls[0], votes } });
      }
    });

    return { success: true };
  }
);

/**
 * 공지 이모지 리액션 토글
 *
 * 호출자의 UID만 추가/제거 — 다른 사용자의 리액션은 변경 불가
 */
export const reactToAnnouncement = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const uid = request.auth.uid;
    const { announcementId, emoji } = request.data as {
      announcementId: string;
      emoji: string;
    };

    if (!announcementId || !emoji) {
      throw new HttpsError("invalid-argument", "필수 파라미터가 누락되었습니다.");
    }

    if (!ALLOWED_EMOJIS.includes(emoji)) {
      throw new HttpsError("invalid-argument", "허용되지 않은 이모지입니다.");
    }

    const db = getFirestore();
    const docRef = db.collection("announcements").doc(announcementId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        throw new HttpsError("not-found", "공지를 찾을 수 없습니다.");
      }

      const data = snap.data()!;
      const reactions: Record<string, string[]> = { ...(data.reactions || {}) };
      const arr = reactions[emoji] || [];
      const has = arr.includes(uid);

      if (has) {
        // 제거
        reactions[emoji] = arr.filter((id) => id !== uid);
        if (reactions[emoji].length === 0) delete reactions[emoji];
      } else {
        // 추가
        reactions[emoji] = [...arr, uid];
      }

      tx.update(docRef, { reactions });
    });

    return { success: true };
  }
);

/**
 * 공지 읽음 처리
 *
 * 호출자의 UID만 readBy에 추가 — 다른 사용자의 읽음 상태는 변경 불가
 */
export const markAnnouncementsRead = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const uid = request.auth.uid;
    const { announcementIds } = request.data as { announcementIds: string[] };

    if (!Array.isArray(announcementIds) || announcementIds.length === 0) {
      throw new HttpsError("invalid-argument", "announcementIds 배열이 필요합니다.");
    }

    // 한 번에 최대 50개
    if (announcementIds.length > 50) {
      throw new HttpsError("invalid-argument", "한 번에 최대 50개까지 처리 가능합니다.");
    }

    const db = getFirestore();
    const batch = db.batch();

    for (const id of announcementIds) {
      const docRef = db.collection("announcements").doc(id);
      batch.update(docRef, { readBy: FieldValue.arrayUnion(uid) });
    }

    await batch.commit();
    return { success: true };
  }
);
