/**
 * 소셜 통계 수집
 *
 * 게시판, 콩콩이 사용, 댓글, 키워드 추출
 */

import { getFirestore } from "firebase-admin/firestore";
import fetch from "node-fetch";
import { CollectContext, SocialStats } from "./types";

export async function collectSocial(ctx: CollectContext, apiKey: string): Promise<SocialStats> {
  const db = getFirestore();
  const { courseId, startTs, endTs } = ctx;

  // ── 게시판 ──
  const postsSnap = await db.collection("posts")
    .where("courseId", "==", courseId)
    .where("createdAt", ">=", startTs)
    .where("createdAt", "<", endTs)
    .get();

  let totalViews = 0;
  const classCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  const postTexts: string[] = [];
  const postIds: string[] = [];
  let privatePostCount = 0;

  postsSnap.docs.forEach(d => {
    const data = d.data();
    postIds.push(d.id);
    totalViews += data.viewCount || 0;
    const cls = data.authorClassType;
    if (cls && classCounts[cls] !== undefined) classCounts[cls]++;
    if (data.isPrivate) privatePostCount++;
    const title = data.title || "";
    const content = data.content || "";
    if (title || content) postTexts.push(`${title} ${content}`);
  });

  // 댓글 수 집계
  let commentCount = 0;
  for (let i = 0; i < postIds.length; i += 30) {
    const chunk = postIds.slice(i, i + 30);
    const commSnap = await db.collection("comments")
      .where("postId", "in", chunk)
      .get();
    commentCount += commSnap.size;
  }

  // ── 콩콩이 사용 ──
  // 학술 게시글에 대한 콩콩이 답변 (gemini-ai 댓글)
  let academicReplies = 0;
  let followUpCount = 0;

  // 주간 게시글의 콩콩이 댓글
  for (let i = 0; i < postIds.length; i += 30) {
    const chunk = postIds.slice(i, i + 30);
    const kongiSnap = await db.collection("comments")
      .where("postId", "in", chunk)
      .where("authorId", "==", "gemini-ai")
      .get();
    kongiSnap.docs.forEach(d => {
      const data = d.data();
      if (data.parentId) {
        followUpCount++; // 대댓글 (후속질문에 대한 답변)
      } else {
        academicReplies++; // 최초 답변
      }
    });
  }

  // 비공개 글(나만의 콩콩이) 대화 수
  // 이미 postsSnap에서 privatePostCount 집계됨
  const privateChats = privatePostCount;

  // ── 키워드 추출 (Claude Haiku) ──
  let keywords: { text: string; value: number }[] = [];
  if (postTexts.length > 0 && apiKey) {
    try {
      keywords = await extractKeywords(apiKey, postTexts);
    } catch (err) {
      console.warn(`[${courseId}] 키워드 추출 실패:`, err);
    }
  }

  return {
    board: {
      postCount: postsSnap.size,
      commentCount,
      totalViews,
      classParticipation: classCounts,
    },
    kongi: {
      academicReplies,
      privateChats,
      followUpCount,
    },
    keywords,
  };
}

// ── Claude Haiku 키워드 추출 (기존 로직 이전) ──
async function extractKeywords(apiKey: string, texts: string[]): Promise<{ text: string; value: number }[]> {
  const combined = texts.slice(0, 50).join("\n---\n").slice(0, 8000);
  if (!combined.trim()) return [];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `다음은 대학 수업 게시판의 게시글 제목과 본문입니다. 의미 있는 핵심 키워드를 추출해주세요.

규칙:
- 조사, 접속사, 대명사, 일반 동사 제외
- 1글자 단어 제외
- 빈도가 높은 순으로 최대 30개
- JSON 배열로만 응답: [{"text":"키워드","value":빈도수}]
- 다른 설명 없이 JSON만 출력

게시글:
${combined}`,
      }],
    }),
  });

  if (!response.ok) return [];

  const data = await response.json() as { content: Array<{ type: string; text: string }> };
  const textBlock = data.content.find((c: { type: string }) => c.type === "text");
  if (!textBlock?.text) return [];

  try {
    const cleaned = textBlock.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item: { text?: string; value?: number }) => item.text && typeof item.value === "number")
        .slice(0, 30);
    }
  } catch { /* 파싱 실패 무시 */ }

  return [];
}
