// get-poll-responses — 교수 전용 단일 poll 응답 상세 조회
//
// 이전 CF: functions/src/announcementActions.ts::getPollResponses
// 권한: users.role === 'professor'
// 객관식: 선택지별 투표자 UID/이름/학번 목록
// 주관식: 학생별 답변 텍스트 + UID/이름/학번
// 레거시 votes 필드도 병합.

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

  const { announcementId, pollIdx } = (await req.json()) as {
    announcementId?: string;
    pollIdx?: number;
  };

  if (!announcementId || pollIdx === undefined || pollIdx < 0) {
    return json({ ok: false, error: "필수 파라미터가 누락되었습니다." }, 400);
  }

  const db = getFirebaseFirestore();

  // 교수 권한 확인
  const callerDoc = await db.collection("users").doc(uid).get();
  const callerData = callerDoc.exists
    ? (callerDoc.data() as { role?: string })
    : null;
  if (!callerData || callerData.role !== "professor") {
    return json({ ok: false, error: "교수님만 조회 가능합니다." }, 403);
  }

  const docRef = db.collection("announcements").doc(announcementId);
  const snap = await docRef.get();
  if (!snap.exists) {
    return json({ ok: false, error: "공지를 찾을 수 없습니다." }, 404);
  }

  const data = snap.data() as Record<string, unknown>;
  const polls = extractPolls(data);
  const poll = polls[pollIdx];
  if (!poll) {
    return json({ ok: false, error: "투표를 찾을 수 없습니다." }, 404);
  }

  async function fetchProfiles(uids: string[]): Promise<Record<string, Profile>> {
    const unique = Array.from(new Set(uids)).filter(Boolean);
    const result: Record<string, Profile> = {};
    if (unique.length === 0) return result;
    const refs = unique.map((id) => db.collection("users").doc(id));
    const docs = await db.getAll(...refs);
    for (const doc of docs) {
      if (!doc.exists) continue;
      const d = doc.data() as { name?: string; studentNumber?: string; nickname?: string };
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
    // 주관식
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
      .sort((a, b) =>
        (a.studentNumber || "").localeCompare(b.studentNumber || ""),
      );

    return json({
      type: "text" as const,
      responses,
      responseCount: responses.length,
    });
  }

  // 객관식
  const votesSnap = await docRef
    .collection("pollVotes")
    .where("pollIdx", "==", pollIdx)
    .get();

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
        (a.studentNumber || "").localeCompare(b.studentNumber || ""),
      );
    return { optIdx: i, option: String(opt), voters };
  });

  return json({
    type: "choice" as const,
    options,
    totalVoters: allUids.size,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
