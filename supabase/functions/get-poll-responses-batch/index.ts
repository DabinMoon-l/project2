// get-poll-responses-batch — 교수 전용 공지 전체 투표 응답 일괄 조회
//
// 이전 CF: functions/src/announcementActions.ts::getPollResponsesBatch
// 한 공지에 poll N 개 → CF 1 회로 일괄. 바텀시트 초기 로딩 즉시 완료.

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { verifyFirebaseIdToken, uidOf } from "../_shared/auth.ts";
import { getFirebaseFirestore } from "../_shared/firebaseAdmin.ts";
import { Timestamp } from "npm:firebase-admin@12/firestore";

interface PollData {
  type?: "choice" | "text";
  options?: unknown[];
  votes?: Record<string, string[]>;
  voteCounts?: Record<string, number>;
  responseCount?: number;
}

interface Profile {
  uid: string;
  name: string;
  studentNumber: string;
  nickname?: string;
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

  const { announcementId } = (await req.json()) as { announcementId?: string };
  if (!announcementId) {
    return json({ ok: false, error: "announcementId가 필요합니다." }, 400);
  }

  const db = getFirebaseFirestore();
  const callerDoc = await db.collection("users").doc(uid).get();
  const callerData = callerDoc.exists
    ? (callerDoc.data() as { role?: string })
    : null;
  if (!callerData || callerData.role !== "professor") {
    return json({ ok: false, error: "교수님만 조회 가능합니다." }, 403);
  }

  const docRef = db.collection("announcements").doc(announcementId);
  const [docSnap, allVotesSnap, allResponsesSnap] = await Promise.all([
    docRef.get(),
    docRef.collection("pollVotes").get(),
    docRef.collection("pollResponses").get(),
  ]);
  if (!docSnap.exists) {
    return json({ ok: false, error: "공지를 찾을 수 없습니다." }, 404);
  }
  const data = docSnap.data() as Record<string, unknown>;
  const polls = extractPolls(data);

  // 모든 uid 수집
  const allUids = new Set<string>();
  allVotesSnap.forEach((d) => {
    const u = d.data().uid as string | undefined;
    if (u) allUids.add(u);
  });
  allResponsesSnap.forEach((d) => {
    const u = d.data().uid as string | undefined;
    if (u) allUids.add(u);
  });
  for (const p of polls) {
    if (p.type !== "text" && p.votes) {
      for (const arr of Object.values(p.votes)) {
        if (Array.isArray(arr)) arr.forEach((u) => allUids.add(u));
      }
    }
  }

  const profileMap: Record<string, Profile> = {};
  if (allUids.size > 0) {
    const refs = Array.from(allUids).map((u) => db.collection("users").doc(u));
    const docs = await db.getAll(...refs);
    for (const d of docs) {
      if (!d.exists) continue;
      const dd = d.data() as { name?: string; studentNumber?: string; nickname?: string };
      profileMap[d.id] = {
        uid: d.id,
        name: dd.name || "",
        studentNumber: dd.studentNumber || "",
        nickname: dd.nickname || undefined,
      };
    }
  }

  // pollVotes / pollResponses 를 pollIdx 별로 그룹
  const votesByPoll = new Map<number, Array<{ uid: string; optIndices: number[] }>>();
  allVotesSnap.forEach((d) => {
    const v = d.data();
    const pi = v.pollIdx as number | undefined;
    if (typeof pi !== "number") return;
    const arr = votesByPoll.get(pi) || [];
    arr.push({ uid: v.uid as string, optIndices: (v.optIndices as number[]) || [] });
    votesByPoll.set(pi, arr);
  });

  const responsesByPoll = new Map<
    number,
    Array<{ uid: string; text: string; createdAt: number | null; updatedAt: number | null }>
  >();
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

  // poll 별 결과 조합
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
          (a.studentNumber || "").localeCompare(b.studentNumber || ""),
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
          (a.studentNumber || "").localeCompare(b.studentNumber || ""),
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

  return json({ items });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
