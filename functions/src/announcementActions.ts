/**
 * 공지 채널 — 투표/리액션/읽음 처리 (서버사이드 검증)
 *
 * 클라이언트에서 announcements 문서를 직접 수정하는 대신,
 * CF에서 호출자 UID만 조작할 수 있도록 검증합니다.
 *
 * 투표 저장 구조 (학생 프라이버시 보호):
 * - 객관식: announcements/{aid}/pollVotes/{pollIdx}_{uid} 서브컬렉션
 * - 주관식: announcements/{aid}/pollResponses/{pollIdx}_{uid} 서브컬렉션
 * - 집계값(voteCounts, responseCount)은 parent 문서 polls 배열에 유지 (공개)
 * - 투표자 UID/주관식 본문은 서브컬렉션에 저장되며 보안 규칙으로 교수만 read
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

// 허용 이모지 목록
const ALLOWED_EMOJIS = ["❤️", "👍", "🔥", "😂", "😮", "😢"];

// 주관식 답변 최대 길이 (서버 검증)
const TEXT_RESPONSE_MAX_LEN = 2000;

interface PollData {
  question?: string;
  type?: "choice" | "text";
  options?: unknown[];
  allowMultiple?: boolean;
  maxSelections?: number;
  votes?: Record<string, string[]>;      // 레거시
  voteCounts?: Record<string, number>;
  responseCount?: number;
}

/** polls 배열 추출 + 객체→배열 복구 (Firestore 변환 버그 방어) */
function extractPolls(data: FirebaseFirestore.DocumentData): PollData[] {
  let polls: PollData[] = data.polls || (data.poll ? [data.poll] : []);
  if (polls && !Array.isArray(polls)) {
    polls = Object.values(polls as Record<string, PollData>);
  }
  return polls;
}

/** pollVotes 서브컬렉션 doc ID */
function pollVoteId(pollIdx: number, uid: string): string {
  return `${pollIdx}_${uid}`;
}

/**
 * 공지 투표 (객관식 단일/복수 선택)
 *
 * - 서브컬렉션 pollVotes에 호출자 UID 기록
 * - parent 문서 polls[pollIdx].voteCounts 집계값 갱신
 * - 학생 UID는 서브컬렉션에만 저장 (교수만 read 가능)
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

    if (
      !announcementId ||
      pollIdx === undefined ||
      pollIdx < 0 ||
      !Array.isArray(optIndices)
    ) {
      throw new HttpsError("invalid-argument", "필수 파라미터가 누락되었습니다.");
    }

    const db = getFirestore();
    const docRef = db.collection("announcements").doc(announcementId);
    const voteRef = docRef.collection("pollVotes").doc(pollVoteId(pollIdx, uid));

    await db.runTransaction(async (tx) => {
      const [snap, voteSnap] = await Promise.all([tx.get(docRef), tx.get(voteRef)]);
      if (!snap.exists) {
        throw new HttpsError("not-found", "공지를 찾을 수 없습니다.");
      }

      const data = snap.data()!;
      const polls = extractPolls(data);
      const poll = polls[pollIdx];
      if (!poll) {
        throw new HttpsError("not-found", "투표를 찾을 수 없습니다.");
      }
      if (poll.type === "text") {
        throw new HttpsError("invalid-argument", "주관식 투표는 submitPollTextResponse를 사용하세요.");
      }

      const maxOpt = (poll.options || []).length;
      for (const idx of optIndices) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= maxOpt) {
          throw new HttpsError("invalid-argument", "잘못된 선지 인덱스입니다.");
        }
      }
      // 선지 중복 제거
      const newOptIndices = Array.from(new Set(optIndices));

      if (!poll.allowMultiple && newOptIndices.length > 1) {
        throw new HttpsError("invalid-argument", "단일 선택 투표입니다.");
      }
      if (
        poll.allowMultiple &&
        poll.maxSelections &&
        newOptIndices.length > poll.maxSelections
      ) {
        throw new HttpsError(
          "invalid-argument",
          `최대 ${poll.maxSelections}개까지 선택 가능합니다.`
        );
      }
      if (newOptIndices.length === 0) {
        throw new HttpsError("invalid-argument", "최소 1개 이상 선택해야 합니다.");
      }

      // 기존 투표 (있으면 이전 선택 배열)
      const prevOptIndices: number[] = voteSnap.exists
        ? (voteSnap.data()?.optIndices as number[]) || []
        : [];

      // 레거시 votes 필드에 이 UID가 있는지 확인 (마이그레이션)
      const legacyVotes = poll.votes || {};
      const legacyOptIndices: number[] = [];
      for (const [key, arr] of Object.entries(legacyVotes)) {
        if (Array.isArray(arr) && arr.includes(uid)) {
          legacyOptIndices.push(Number(key));
        }
      }

      // 집계 delta 계산 — 이전(subcol 우선, 없으면 legacy) → 새 선택
      const effectivePrev = voteSnap.exists ? prevOptIndices : legacyOptIndices;
      const voteCounts: Record<string, number> = { ...(poll.voteCounts || {}) };

      // 레거시 필드만 있고 voteCounts가 비어있으면 초기 집계 부트스트랩
      if (Object.keys(voteCounts).length === 0 && Object.keys(legacyVotes).length > 0) {
        for (const [key, arr] of Object.entries(legacyVotes)) {
          if (Array.isArray(arr)) voteCounts[key] = arr.length;
        }
      }

      for (const idx of effectivePrev) {
        const key = String(idx);
        voteCounts[key] = Math.max(0, (voteCounts[key] || 0) - 1);
      }
      for (const idx of newOptIndices) {
        const key = String(idx);
        voteCounts[key] = (voteCounts[key] || 0) + 1;
      }

      // 레거시 votes에서 호출자 UID 제거 (새 스키마로 이전)
      const cleanedLegacyVotes: Record<string, string[]> = {};
      let legacyDirty = false;
      for (const [key, arr] of Object.entries(legacyVotes)) {
        if (Array.isArray(arr)) {
          const filtered = arr.filter((id: string) => id !== uid);
          if (filtered.length !== arr.length) legacyDirty = true;
          cleanedLegacyVotes[key] = filtered;
        }
      }

      // polls 배열 업데이트 (dot notation 금지)
      const newPolls = polls.map((p, i) =>
        i === pollIdx
          ? {
              ...p,
              voteCounts,
              ...(legacyDirty ? { votes: cleanedLegacyVotes } : {}),
            }
          : p
      );

      if (data.polls) {
        tx.update(docRef, { polls: newPolls });
      } else {
        // 단일 poll (레거시)
        tx.update(docRef, { poll: newPolls[0] });
      }

      // 서브컬렉션에 투표 기록 저장
      tx.set(voteRef, {
        pollIdx,
        uid,
        optIndices: newOptIndices,
        createdAt: voteSnap.exists
          ? voteSnap.data()?.createdAt || FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return { success: true };
  }
);

/**
 * 주관식 투표 응답 제출 (1인 1답변, 수정 가능)
 *
 * - 서브컬렉션 pollResponses에 응답 기록
 * - parent 문서 responseCount 갱신 (첫 응답 시에만)
 * - 답변 본문은 교수만 read 가능
 */
export const submitPollTextResponse = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const uid = request.auth.uid;
    const { announcementId, pollIdx, text } = request.data as {
      announcementId: string;
      pollIdx: number;
      text: string;
    };

    if (
      !announcementId ||
      pollIdx === undefined ||
      pollIdx < 0 ||
      typeof text !== "string"
    ) {
      throw new HttpsError("invalid-argument", "필수 파라미터가 누락되었습니다.");
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new HttpsError("invalid-argument", "빈 답변은 제출할 수 없습니다.");
    }
    if (trimmed.length > TEXT_RESPONSE_MAX_LEN) {
      throw new HttpsError(
        "invalid-argument",
        `답변은 ${TEXT_RESPONSE_MAX_LEN}자 이내로 작성해주세요.`
      );
    }

    const db = getFirestore();
    const docRef = db.collection("announcements").doc(announcementId);
    const respRef = docRef.collection("pollResponses").doc(pollVoteId(pollIdx, uid));

    await db.runTransaction(async (tx) => {
      const [snap, respSnap] = await Promise.all([tx.get(docRef), tx.get(respRef)]);
      if (!snap.exists) {
        throw new HttpsError("not-found", "공지를 찾을 수 없습니다.");
      }

      const data = snap.data()!;
      const polls = extractPolls(data);
      const poll = polls[pollIdx];
      if (!poll) {
        throw new HttpsError("not-found", "투표를 찾을 수 없습니다.");
      }
      if (poll.type !== "text") {
        throw new HttpsError("invalid-argument", "주관식 투표가 아닙니다.");
      }

      const isFirst = !respSnap.exists;
      const newResponseCount = isFirst
        ? (poll.responseCount || 0) + 1
        : poll.responseCount || 1;

      const newPolls = polls.map((p, i) =>
        i === pollIdx ? { ...p, responseCount: newResponseCount } : p
      );

      if (data.polls) {
        tx.update(docRef, { polls: newPolls });
      } else {
        tx.update(docRef, { poll: newPolls[0] });
      }

      tx.set(respRef, {
        pollIdx,
        uid,
        text: trimmed,
        createdAt: respSnap.exists
          ? respSnap.data()?.createdAt || FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return { success: true };
  }
);

/**
 * 설문 일괄 제출 — 여러 투표(객관식/주관식)를 한 번의 CF 호출로 처리
 *
 * 목적: 공지 하나에 투표 N개 있을 때 매 투표마다 CF 호출하지 않고 1회로 완료.
 * 특히 에뮬레이터 환경에서 CF 콜드스타트 누적 방지.
 *
 * 입력 예:
 *   {
 *     announcementId: "abc",
 *     choices: { "0": [1, 3], "2": [0] },       // pollIdx → optIndices[]
 *     texts:   { "1": "내 답변", "3": "다른 답변" } // pollIdx → text
 *   }
 *
 * 동작:
 *  - pollVotes 서브컬렉션에 배치 write
 *  - pollResponses 서브컬렉션에 배치 write
 *  - parent 문서 polls[i].voteCounts / responseCount 일괄 갱신
 *  - 레거시 votes 필드에서 본인 UID 제거 (마이그레이션)
 */
export const submitPollSurvey = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const uid = request.auth.uid;
    const { announcementId, choices, texts } = request.data as {
      announcementId: string;
      choices?: Record<string, number[]>;
      texts?: Record<string, string>;
    };

    if (!announcementId) {
      throw new HttpsError("invalid-argument", "announcementId가 필요합니다.");
    }
    const choicesMap = choices || {};
    const textsMap = texts || {};

    const db = getFirestore();
    const docRef = db.collection("announcements").doc(announcementId);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "공지를 찾을 수 없습니다.");
    }
    const data = snap.data()!;
    const polls = extractPolls(data);
    if (polls.length === 0) {
      throw new HttpsError("failed-precondition", "투표가 없는 공지입니다.");
    }

    // 기존 본인 투표 문서 일괄 조회 (있으면 덮어쓰기, 없으면 신규)
    const existingVotesSnap = await docRef
      .collection("pollVotes")
      .where("uid", "==", uid)
      .get();
    const existingResponsesSnap = await docRef
      .collection("pollResponses")
      .where("uid", "==", uid)
      .get();
    const existingVotesByPoll = new Map<number, number[]>();
    existingVotesSnap.forEach((d) => {
      const v = d.data();
      if (typeof v.pollIdx === "number" && Array.isArray(v.optIndices)) {
        existingVotesByPoll.set(v.pollIdx, v.optIndices as number[]);
      }
    });
    const existingTextsByPoll = new Set<number>();
    existingResponsesSnap.forEach((d) => {
      const v = d.data();
      if (typeof v.pollIdx === "number") existingTextsByPoll.add(v.pollIdx);
    });

    // polls 배열에서 voteCounts/responseCount 업데이트
    const updatedPolls = polls.map((p) => ({ ...p }));
    const legacyVotesByPoll: Map<number, Record<string, string[]>> = new Map();

    // 레거시 votes 초기 복사 + 본인 UID 제거 준비
    for (let i = 0; i < updatedPolls.length; i++) {
      const p = updatedPolls[i];
      if (p.votes) {
        const cleaned: Record<string, string[]> = {};
        let dirty = false;
        for (const [key, arr] of Object.entries(p.votes)) {
          if (Array.isArray(arr)) {
            const filtered = arr.filter((id) => id !== uid);
            if (filtered.length !== arr.length) dirty = true;
            cleaned[key] = filtered;
          }
        }
        if (dirty) legacyVotesByPoll.set(i, cleaned);
      }
    }

    const batch = db.batch();

    // 객관식 처리
    for (const [pollIdxStr, optIndices] of Object.entries(choicesMap)) {
      const pollIdx = Number(pollIdxStr);
      const poll = updatedPolls[pollIdx];
      if (!poll) {
        throw new HttpsError("invalid-argument", `pollIdx ${pollIdx} 없음`);
      }
      if (poll.type === "text") {
        throw new HttpsError("invalid-argument", `pollIdx ${pollIdx}는 주관식입니다`);
      }
      if (!Array.isArray(optIndices)) continue;
      const newOpts = Array.from(new Set(optIndices)).filter(
        (idx) => Number.isInteger(idx) && idx >= 0 && idx < (poll.options || []).length
      );
      if (newOpts.length === 0) continue;
      if (!poll.allowMultiple && newOpts.length > 1) {
        throw new HttpsError("invalid-argument", `pollIdx ${pollIdx}는 단일 선택`);
      }
      if (
        poll.allowMultiple &&
        poll.maxSelections &&
        newOpts.length > poll.maxSelections
      ) {
        throw new HttpsError(
          "invalid-argument",
          `pollIdx ${pollIdx}는 최대 ${poll.maxSelections}개 선택 가능`
        );
      }

      // voteCounts 갱신 — 이전 본인 투표 감산, 신규 가산
      const voteCounts: Record<string, number> = { ...(poll.voteCounts || {}) };

      // 레거시 bootstrap: voteCounts 비었고 legacy votes 있으면 채움
      if (Object.keys(voteCounts).length === 0 && poll.votes) {
        for (const [k, arr] of Object.entries(poll.votes)) {
          if (Array.isArray(arr)) voteCounts[k] = arr.length;
        }
      }

      // 이전 본인 선택 (서브컬렉션 또는 레거시에서)
      const prevOpts = existingVotesByPoll.get(pollIdx) || [];
      const legacyPrev: number[] = [];
      if (poll.votes) {
        for (const [k, arr] of Object.entries(poll.votes)) {
          if (Array.isArray(arr) && arr.includes(uid)) legacyPrev.push(Number(k));
        }
      }
      const effectivePrev = existingVotesByPoll.has(pollIdx) ? prevOpts : legacyPrev;

      for (const idx of effectivePrev) {
        const key = String(idx);
        voteCounts[key] = Math.max(0, (voteCounts[key] || 0) - 1);
      }
      for (const idx of newOpts) {
        const key = String(idx);
        voteCounts[key] = (voteCounts[key] || 0) + 1;
      }

      updatedPolls[pollIdx] = {
        ...poll,
        voteCounts,
      };

      // 서브컬렉션 doc 작성
      const voteRef = docRef.collection("pollVotes").doc(`${pollIdx}_${uid}`);
      batch.set(voteRef, {
        pollIdx,
        uid,
        optIndices: newOpts,
        createdAt: existingVotesByPoll.has(pollIdx)
          ? (existingVotesSnap.docs.find((d) => d.data().pollIdx === pollIdx)?.data()
              .createdAt as Timestamp | undefined) || FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // 주관식 처리
    for (const [pollIdxStr, text] of Object.entries(textsMap)) {
      const pollIdx = Number(pollIdxStr);
      const poll = updatedPolls[pollIdx];
      if (!poll) {
        throw new HttpsError("invalid-argument", `pollIdx ${pollIdx} 없음`);
      }
      if (poll.type !== "text") {
        throw new HttpsError("invalid-argument", `pollIdx ${pollIdx}는 객관식입니다`);
      }
      if (typeof text !== "string") continue;
      const trimmed = text.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.length > TEXT_RESPONSE_MAX_LEN) {
        throw new HttpsError(
          "invalid-argument",
          `답변은 ${TEXT_RESPONSE_MAX_LEN}자 이내`
        );
      }

      const isFirst = !existingTextsByPoll.has(pollIdx);
      const newCount = isFirst ? (poll.responseCount || 0) + 1 : poll.responseCount || 1;
      updatedPolls[pollIdx] = { ...poll, responseCount: newCount };

      const respRef = docRef.collection("pollResponses").doc(`${pollIdx}_${uid}`);
      const existingResp = existingResponsesSnap.docs.find(
        (d) => d.data().pollIdx === pollIdx
      );
      batch.set(respRef, {
        pollIdx,
        uid,
        text: trimmed,
        createdAt:
          (existingResp?.data().createdAt as Timestamp | undefined) ||
          FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // 레거시 votes 필드에서 본인 UID 정리
    for (const [i, cleaned] of legacyVotesByPoll.entries()) {
      updatedPolls[i] = { ...updatedPolls[i], votes: cleaned };
    }

    // parent 문서 polls 배열 갱신
    if (data.polls) {
      batch.update(docRef, { polls: updatedPolls });
    } else if (data.poll) {
      batch.update(docRef, { poll: updatedPolls[0] });
    }

    await batch.commit();
    return { success: true };
  }
);

/**
 * 교수 전용 — 투표 응답 상세 조회
 *
 * - 객관식: 선택지별 투표자 UID/이름/학번 목록
 * - 주관식: 학생별 답변 텍스트 + UID/이름/학번
 * - 교수 권한 검증 (users.role === 'professor')
 */
export const getPollResponses = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const uid = request.auth.uid;
    const { announcementId, pollIdx } = request.data as {
      announcementId: string;
      pollIdx: number;
    };

    if (!announcementId || pollIdx === undefined || pollIdx < 0) {
      throw new HttpsError("invalid-argument", "필수 파라미터가 누락되었습니다.");
    }

    const db = getFirestore();

    // 교수 권한 확인
    const callerDoc = await db.collection("users").doc(uid).get();
    if (!callerDoc.exists || callerDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 조회 가능합니다.");
    }

    const docRef = db.collection("announcements").doc(announcementId);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "공지를 찾을 수 없습니다.");
    }

    const data = snap.data()!;
    const polls = extractPolls(data);
    const poll = polls[pollIdx];
    if (!poll) {
      throw new HttpsError("not-found", "투표를 찾을 수 없습니다.");
    }

    // 사용자 프로필 일괄 조회 헬퍼
    async function fetchProfiles(uids: string[]): Promise<Record<string, {
      uid: string;
      name: string;
      studentNumber: string;
      nickname?: string;
    }>> {
      const unique = Array.from(new Set(uids)).filter(Boolean);
      const result: Record<string, {
        uid: string;
        name: string;
        studentNumber: string;
        nickname?: string;
      }> = {};
      if (unique.length === 0) return result;

      // Admin SDK는 getAll(...refs)로 배치 fetch (in-query 30개 제한 회피)
      const refs = unique.map((id) => db.collection("users").doc(id));
      const docs = await db.getAll(...refs);
      for (const doc of docs) {
        if (!doc.exists) continue;
        const d = doc.data()!;
        result[doc.id] = {
          uid: doc.id,
          name: d.name || "",
          studentNumber: d.studentNumber || "",
          nickname: d.nickname || undefined,
        };
      }
      return result;
    }

    if (poll.type === "text") {
      // 주관식 응답 조회
      const respSnap = await docRef
        .collection("pollResponses")
        .where("pollIdx", "==", pollIdx)
        .get();

      const uids = respSnap.docs.map((d) => d.data().uid as string);
      const profiles = await fetchProfiles(uids);

      const responses = respSnap.docs
        .map((d) => {
          const r = d.data();
          const prof = profiles[r.uid as string];
          const createdAtTs = r.createdAt as Timestamp | undefined;
          const updatedAtTs = r.updatedAt as Timestamp | undefined;
          return {
            uid: r.uid as string,
            name: prof?.name || "",
            studentNumber: prof?.studentNumber || "",
            nickname: prof?.nickname,
            text: r.text as string,
            createdAt: createdAtTs?.toMillis?.() || null,
            updatedAt: updatedAtTs?.toMillis?.() || null,
          };
        })
        .sort((a, b) => (a.studentNumber || "").localeCompare(b.studentNumber || ""));

      return { type: "text" as const, responses, responseCount: responses.length };
    }

    // 객관식 응답 조회
    const votesSnap = await docRef
      .collection("pollVotes")
      .where("pollIdx", "==", pollIdx)
      .get();

    // 레거시 votes 필드도 병합 (아직 마이그레이션 안 된 투표자)
    const legacyVotes = poll.votes || {};
    const votersByOpt: Record<string, Set<string>> = {};

    for (const doc of votesSnap.docs) {
      const d = doc.data();
      const u = d.uid as string;
      const arr = (d.optIndices as number[]) || [];
      for (const optIdx of arr) {
        const key = String(optIdx);
        if (!votersByOpt[key]) votersByOpt[key] = new Set();
        votersByOpt[key].add(u);
      }
    }
    // 레거시 병합 — 서브컬렉션에 이미 있으면 스킵
    const newVotersSet = new Set(votesSnap.docs.map((d) => d.data().uid as string));
    for (const [key, arr] of Object.entries(legacyVotes)) {
      if (!Array.isArray(arr)) continue;
      for (const u of arr) {
        if (newVotersSet.has(u)) continue;
        if (!votersByOpt[key]) votersByOpt[key] = new Set();
        votersByOpt[key].add(u);
      }
    }

    const allUids = new Set<string>();
    for (const s of Object.values(votersByOpt)) s.forEach((u) => allUids.add(u));
    const profiles = await fetchProfiles(Array.from(allUids));

    const options = (poll.options || []).map((opt, i) => {
      const key = String(i);
      const voterUids = Array.from(votersByOpt[key] || []);
      const voters = voterUids
        .map((u) => {
          const prof = profiles[u];
          return {
            uid: u,
            name: prof?.name || "",
            studentNumber: prof?.studentNumber || "",
            nickname: prof?.nickname,
          };
        })
        .sort((a, b) =>
          (a.studentNumber || "").localeCompare(b.studentNumber || "")
        );
      return { optIdx: i, option: String(opt), voters };
    });

    return {
      type: "choice" as const,
      options,
      totalVoters: allUids.size,
    };
  }
);

/**
 * 교수 전용 — 공지 전체 투표 응답 일괄 조회 (배치)
 *
 * getPollResponses를 poll 개수만큼 호출하면 CF 콜드스타트가 쌓여 느림.
 * 한 번에 다 내려줘서 바텀시트 초기 로딩을 즉시 완료.
 */
export const getPollResponsesBatch = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    const uid = request.auth.uid;
    const { announcementId } = request.data as { announcementId: string };
    if (!announcementId) {
      throw new HttpsError("invalid-argument", "announcementId가 필요합니다.");
    }

    const db = getFirestore();
    const callerDoc = await db.collection("users").doc(uid).get();
    if (!callerDoc.exists || callerDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 조회 가능합니다.");
    }

    const docRef = db.collection("announcements").doc(announcementId);
    const [docSnap, allVotesSnap, allResponsesSnap] = await Promise.all([
      docRef.get(),
      docRef.collection("pollVotes").get(),
      docRef.collection("pollResponses").get(),
    ]);
    if (!docSnap.exists) {
      throw new HttpsError("not-found", "공지를 찾을 수 없습니다.");
    }
    const data = docSnap.data()!;
    const polls = extractPolls(data);

    // 모든 uid 수집 후 한 번에 프로필 조회
    const allUids = new Set<string>();
    allVotesSnap.forEach((d) => {
      const u = d.data().uid as string | undefined;
      if (u) allUids.add(u);
    });
    allResponsesSnap.forEach((d) => {
      const u = d.data().uid as string | undefined;
      if (u) allUids.add(u);
    });
    // 레거시 votes도 포함
    for (const p of polls) {
      if (p.type !== "text" && p.votes) {
        for (const arr of Object.values(p.votes)) {
          if (Array.isArray(arr)) arr.forEach((u) => allUids.add(u));
        }
      }
    }

    const profileMap: Record<string, {
      uid: string;
      name: string;
      studentNumber: string;
      nickname?: string;
    }> = {};
    if (allUids.size > 0) {
      const refs = Array.from(allUids).map((u) => db.collection("users").doc(u));
      const docs = await db.getAll(...refs);
      for (const d of docs) {
        if (!d.exists) continue;
        const dd = d.data()!;
        profileMap[d.id] = {
          uid: d.id,
          name: dd.name || "",
          studentNumber: dd.studentNumber || "",
          nickname: dd.nickname || undefined,
        };
      }
    }

    // pollVotes / pollResponses를 pollIdx별로 그룹
    const votesByPoll = new Map<number, Array<{ uid: string; optIndices: number[] }>>();
    allVotesSnap.forEach((d) => {
      const v = d.data();
      const pi = v.pollIdx as number | undefined;
      if (typeof pi !== "number") return;
      const arr = votesByPoll.get(pi) || [];
      arr.push({ uid: v.uid as string, optIndices: (v.optIndices as number[]) || [] });
      votesByPoll.set(pi, arr);
    });
    const responsesByPoll = new Map<number, Array<{
      uid: string;
      text: string;
      createdAt: number | null;
      updatedAt: number | null;
    }>>();
    allResponsesSnap.forEach((d) => {
      const v = d.data();
      const pi = v.pollIdx as number | undefined;
      if (typeof pi !== "number") return;
      const arr = responsesByPoll.get(pi) || [];
      const createdTs = v.createdAt as Timestamp | undefined;
      const updatedTs = v.updatedAt as Timestamp | undefined;
      arr.push({
        uid: v.uid as string,
        text: (v.text as string) || "",
        createdAt: createdTs?.toMillis?.() || null,
        updatedAt: updatedTs?.toMillis?.() || null,
      });
      responsesByPoll.set(pi, arr);
    });

    // 각 poll별 결과 조합
    const items = polls.map((poll, pollIdx) => {
      if (poll.type === "text") {
        const entries = responsesByPoll.get(pollIdx) || [];
        const responses = entries
          .map((e) => {
            const prof = profileMap[e.uid];
            return {
              uid: e.uid,
              name: prof?.name || "",
              studentNumber: prof?.studentNumber || "",
              nickname: prof?.nickname,
              text: e.text,
              createdAt: e.createdAt,
              updatedAt: e.updatedAt,
            };
          })
          .sort((a, b) =>
            (a.studentNumber || "").localeCompare(b.studentNumber || "")
          );
        return {
          pollIdx,
          type: "text" as const,
          responses,
          responseCount: responses.length,
        };
      }

      // 객관식 — pollVotes + 레거시 votes 병합
      const votersByOpt: Record<string, Set<string>> = {};
      const subEntries = votesByPoll.get(pollIdx) || [];
      for (const e of subEntries) {
        for (const optIdx of e.optIndices) {
          const key = String(optIdx);
          if (!votersByOpt[key]) votersByOpt[key] = new Set();
          votersByOpt[key].add(e.uid);
        }
      }
      const subUidSet = new Set(subEntries.map((e) => e.uid));
      const legacy = poll.votes || {};
      for (const [key, arr] of Object.entries(legacy)) {
        if (!Array.isArray(arr)) continue;
        for (const u of arr) {
          if (subUidSet.has(u)) continue;
          if (!votersByOpt[key]) votersByOpt[key] = new Set();
          votersByOpt[key].add(u);
        }
      }

      const allVoterUids = new Set<string>();
      for (const s of Object.values(votersByOpt)) s.forEach((u) => allVoterUids.add(u));

      const options = (poll.options || []).map((opt, i) => {
        const key = String(i);
        const voterUids = Array.from(votersByOpt[key] || []);
        const voters = voterUids
          .map((u) => {
            const prof = profileMap[u];
            return {
              uid: u,
              name: prof?.name || "",
              studentNumber: prof?.studentNumber || "",
              nickname: prof?.nickname,
            };
          })
          .sort((a, b) =>
            (a.studentNumber || "").localeCompare(b.studentNumber || "")
          );
        return { optIdx: i, option: String(opt), voters };
      });

      return {
        pollIdx,
        type: "choice" as const,
        options,
        totalVoters: allVoterUids.size,
      };
    });

    return { items };
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
        reactions[emoji] = arr.filter((id) => id !== uid);
        if (reactions[emoji].length === 0) delete reactions[emoji];
      } else {
        reactions[emoji] = [...arr, uid];
      }

      tx.update(docRef, { reactions });
    });

    return { success: true };
  }
);

/**
 * 공지 읽음 처리
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
