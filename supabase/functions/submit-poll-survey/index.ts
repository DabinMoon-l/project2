// submit-poll-survey — 공지 투표 일괄 제출 (객관식 + 주관식)
//
// 이전 CF: functions/src/announcementActions.ts::submitPollSurvey
// voteOnPoll/submitPollTextResponse 의 통합 후속 버전. CF 콜드스타트 누적 방지용.
//
// 입력:
//   {
//     announcementId: "abc",
//     choices: { "0": [1, 3], "2": [0] }      // pollIdx → optIndices[]
//     texts:   { "1": "내 답변", "3": "다른 답변" } // pollIdx → text
//   }

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { verifyFirebaseIdToken, uidOf } from "../_shared/auth.ts";
import { getFirebaseFirestore } from "../_shared/firebaseAdmin.ts";
import { FieldValue, Timestamp } from "npm:firebase-admin@12/firestore";

const TEXT_RESPONSE_MAX_LEN = 2000;

interface PollData {
  question?: string;
  type?: "choice" | "text";
  options?: unknown[];
  allowMultiple?: boolean;
  maxSelections?: number;
  votes?: Record<string, string[]>; // 레거시
  voteCounts?: Record<string, number>;
  responseCount?: number;
}

function extractPolls(data: Record<string, unknown>): PollData[] {
  let polls = (data.polls as PollData[] | undefined) ||
    (data.poll ? [data.poll as PollData] : []);
  if (polls && !Array.isArray(polls)) {
    polls = Object.values(polls as Record<string, PollData>);
  }
  return polls;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const claims = await verifyFirebaseIdToken(req);
  const uid = claims ? uidOf(claims) : null;
  if (!uid) return json({ ok: false, error: "unauthorized" }, 401);

  const { announcementId, choices, texts } = (await req.json()) as {
    announcementId?: string;
    choices?: Record<string, number[]>;
    texts?: Record<string, string>;
  };

  if (!announcementId) {
    return json({ ok: false, error: "announcementId가 필요합니다." }, 400);
  }
  const choicesMap = choices || {};
  const textsMap = texts || {};

  const db = getFirebaseFirestore();
  const docRef = db.collection("announcements").doc(announcementId);
  const snap = await docRef.get();
  if (!snap.exists) {
    return json({ ok: false, error: "공지를 찾을 수 없습니다." }, 404);
  }
  const data = snap.data() as Record<string, unknown>;
  const polls = extractPolls(data);
  if (polls.length === 0) {
    return json({ ok: false, error: "투표가 없는 공지입니다." }, 400);
  }

  // 기존 본인 투표/응답 일괄 조회
  const [existingVotesSnap, existingResponsesSnap] = await Promise.all([
    docRef.collection("pollVotes").where("uid", "==", uid).get(),
    docRef.collection("pollResponses").where("uid", "==", uid).get(),
  ]);
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

  // polls 배열에서 voteCounts / responseCount 업데이트 준비
  const updatedPolls: PollData[] = polls.map((p) => ({ ...p }));
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
      return json({ ok: false, error: `pollIdx ${pollIdx} 없음` }, 400);
    }
    if (poll.type === "text") {
      return json({ ok: false, error: `pollIdx ${pollIdx}는 주관식입니다` }, 400);
    }
    if (!Array.isArray(optIndices)) continue;
    const newOpts = Array.from(new Set(optIndices)).filter(
      (idx) =>
        Number.isInteger(idx) && idx >= 0 && idx < (poll.options || []).length,
    );
    if (newOpts.length === 0) continue;
    if (!poll.allowMultiple && newOpts.length > 1) {
      return json({ ok: false, error: `pollIdx ${pollIdx}는 단일 선택` }, 400);
    }
    if (
      poll.allowMultiple &&
      poll.maxSelections &&
      newOpts.length > poll.maxSelections
    ) {
      return json(
        {
          ok: false,
          error: `pollIdx ${pollIdx}는 최대 ${poll.maxSelections}개 선택 가능`,
        },
        400,
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

    updatedPolls[pollIdx] = { ...poll, voteCounts };

    // 서브컬렉션 doc 작성
    const voteRef = docRef.collection("pollVotes").doc(`${pollIdx}_${uid}`);
    const existingVoteDoc = existingVotesSnap.docs.find(
      (d) => d.data().pollIdx === pollIdx,
    );
    batch.set(voteRef, {
      pollIdx,
      uid,
      optIndices: newOpts,
      createdAt: existingVotesByPoll.has(pollIdx)
        ? (existingVoteDoc?.data().createdAt as Timestamp | undefined) ||
          FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  // 주관식 처리
  for (const [pollIdxStr, text] of Object.entries(textsMap)) {
    const pollIdx = Number(pollIdxStr);
    const poll = updatedPolls[pollIdx];
    if (!poll) {
      return json({ ok: false, error: `pollIdx ${pollIdx} 없음` }, 400);
    }
    if (poll.type !== "text") {
      return json({ ok: false, error: `pollIdx ${pollIdx}는 객관식입니다` }, 400);
    }
    if (typeof text !== "string") continue;
    const trimmed = text.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > TEXT_RESPONSE_MAX_LEN) {
      return json(
        { ok: false, error: `답변은 ${TEXT_RESPONSE_MAX_LEN}자 이내` },
        400,
      );
    }

    const isFirst = !existingTextsByPoll.has(pollIdx);
    const newCount = isFirst
      ? (poll.responseCount || 0) + 1
      : poll.responseCount || 1;
    updatedPolls[pollIdx] = { ...poll, responseCount: newCount };

    const respRef = docRef.collection("pollResponses").doc(`${pollIdx}_${uid}`);
    const existingResp = existingResponsesSnap.docs.find(
      (d) => d.data().pollIdx === pollIdx,
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
  return json({ ok: true, success: true });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
