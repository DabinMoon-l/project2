import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import fetch from "node-fetch";
import {
  readUserForExp,
  addExpInTransaction,
  flushExpSupabase,
  EXP_REWARDS,
  type SupabaseExpPayload,
} from "./utils/gold";
import { enforceRateLimit } from "./rateLimit";
import { loadScopeForAI, inferChaptersFromText } from "./courseScope";
import {
  DEFAULT_ORG_ID_SECRET,
  SUPABASE_URL_SECRET,
  SUPABASE_SERVICE_ROLE_SECRET,
  supabaseDualUpsertPost,
  supabaseDualUpdatePostPartial,
  supabaseDualDeletePost,
  supabaseDualUpsertComment,
  supabaseDualUpdateCommentPartial,
  supabaseDualDeleteComment,
  supabaseDualAcceptComment,
} from "./utils/supabase";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/**
 * 게시글 문서 타입
 * 클라이언트에서 authorId를 사용하므로 두 필드 모두 허용
 */
interface Post {
  userId?: string;
  authorId?: string;
  userName?: string;
  authorNickname?: string;
  userClass?: string;
  authorClassType?: string;
  boardType?: "professor" | "students";
  tag?: string;
  category?: string;
  courseId?: string;
  title: string;
  content: string;
  imageUrls?: string[];
  likeCount?: number;
  likes?: number;
  commentCount: number;
  viewCount?: number;
  rewarded?: boolean;
  toProfessor?: boolean; // 교수님께 전달 여부
  aiDetailedAnswer?: boolean; // 콩콩이 상세 답변 요청
  isPrivate?: boolean; // 비공개 글 (나만의 콩콩이)
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
}

/**
 * 댓글 문서 타입
 * 클라이언트에서 authorId를 사용하므로 두 필드 모두 허용
 */
interface Comment {
  userId?: string;
  authorId?: string;
  userName?: string;
  authorNickname?: string;
  userClass?: string;
  postId: string;
  parentId?: string;
  content: string;
  imageUrls?: string[];
  likeCount?: number;
  rewarded?: boolean;
  isAIReply?: boolean;
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * 좋아요 문서 타입
 */
interface Like {
  userId: string;
  targetType: "post" | "comment";
  targetId: string;
  targetUserId: string;
  rewarded?: boolean;
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * 게시글 생성 시 경험치 지급
 */
export const onPostCreate = onDocumentCreated(
  {
    document: "posts/{postId}",
    region: "asia-northeast3",
    secrets: [
      GEMINI_API_KEY,
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_SECRET,
      DEFAULT_ORG_ID_SECRET,
    ],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("게시글 문서가 없습니다.");
      return;
    }

    const post = snapshot.data() as Post;
    const postId = event.params.postId;

    if (post.rewarded) {
      console.log(`이미 보상이 지급된 게시글입니다: ${postId}`);
      return;
    }

    // 클라이언트는 authorId를 사용, 레거시는 userId 사용
    const userId = post.authorId || post.userId;
    const { title, content } = post;

    if (!userId || !title || !content) {
      console.error("필수 데이터가 누락되었습니다", { userId, title });
      return;
    }

    const db = getFirestore();

    // 비공개 글(나만의 콩콩이)은 EXP 미지급
    const skipExp = !!post.isPrivate;

    try {
      if (!skipExp) {
        await enforceRateLimit(userId, "POST", postId);
      }

      const expReward = skipExp ? 0 : EXP_REWARDS.POST_CREATE;
      const reason = "게시글 작성";

      const postExpPayload = await db.runTransaction<SupabaseExpPayload | null>(
        async (transaction) => {
          // READ — 모든 읽기를 쓰기보다 먼저 실행 (Firestore 트랜잭션 규칙)
          const freshDoc = await transaction.get(snapshot.ref);
          if (freshDoc.data()?.rewarded) {
            console.log(`트랜잭션 내 중복 감지 (게시글): ${postId}`);
            return null;
          }

          const userDoc = !skipExp
            ? await readUserForExp(transaction, userId)
            : null;

          // WRITE — rewarded 마킹 (비공개도 마킹하여 중복 방지)
          transaction.update(snapshot.ref, {
            rewarded: true,
            rewardedAt: FieldValue.serverTimestamp(),
            expRewarded: expReward,
          });

          if (!skipExp && userDoc) {
            const { supabasePayload } = addExpInTransaction(
              transaction, userId, expReward, reason, userDoc, {
                type: "post_create",
                sourceId: postId,
                sourceCollection: "posts",
                metadata: { tag: post.tag || null },
              }
            );
            return supabasePayload;
          }
          return null;
        }
      );

      if (postExpPayload) {
        flushExpSupabase(postExpPayload).catch((e) =>
          console.warn("[Supabase post_create exp dual-write] 실패:", e)
        );
      }

      console.log(skipExp
        ? `비공개 글 EXP 스킵: ${postId}`
        : `게시글 보상 지급 완료: ${userId}`, { postId, expReward });

      // 비공개 글: 1인 1개 검증 (중복 시 새 글 삭제)
      if (post.isPrivate) {
        const existing = await db.collection("posts")
          .where("authorId", "==", userId)
          .where("isPrivate", "==", true)
          .get();
        const duplicates = existing.docs.filter(d => d.id !== postId);
        if (duplicates.length > 0) {
          console.log(`비공개 글 중복 감지 — 새 글 삭제: ${postId}`);
          await db.collection("posts").doc(postId).delete();
          return;
        }
      }

      // Supabase 듀얼 라이트 (AI 답변/교수 알림 전에 선행 — comments FK 매핑에 필요)
      await supabaseDualUpsertPost({
        firestoreId: postId,
        courseCode: post.courseId || null,
        authorId: userId,
        authorNickname: post.authorNickname || post.userName || null,
        authorClassType: post.authorClassType || post.userClass || null,
        title,
        content,
        category: post.category || null,
        tag: post.tag || null,
        isAnonymous: false,
        isNotice: false,
        isPrivate: !!post.isPrivate,
        toProfessor: !!post.toProfessor,
        imageUrls: post.imageUrls || [],
        likes: post.likes || 0,
        likeCount: post.likeCount || 0,
        commentCount: post.commentCount || 0,
        rewarded: true,
        rewardedAt: new Date(),
        expRewarded: skipExp ? 0 : EXP_REWARDS.POST_CREATE,
        createdAt: post.createdAt?.toDate?.() || new Date(),
      });

      // 학술 태그 또는 비공개 글이면 Gemini AI 자동답변 생성 (교수님 글 제외)
      if (post.tag === "학술" || post.isPrivate) {
        // 1단계: 작성자 역할 조회 — 실패해도 AI 답변은 시도 (student 로 간주)
        let authorRole: string | null = null;
        try {
          const authorDoc = await db.collection("users").doc(userId).get();
          authorRole = (authorDoc.data()?.role as string) || null;
        } catch (roleErr) {
          console.warn(`[onPostCreate] users/${userId} 조회 실패 — student 로 간주:`, roleErr);
        }

        if (authorRole === "professor") {
          console.log(`교수님 게시글이므로 AI 자동답변 스킵: ${postId}`);
        } else {
          // 2단계: 실제 AI 답변 생성 (실패 원인 구분 위해 로깅 강화)
          try {
            await generateBoardAIReply(post, postId, GEMINI_API_KEY.value());
            console.log(`[onPostCreate] AI 답변 생성 완료: ${postId} (isPrivate=${!!post.isPrivate}, tag=${post.tag || "-"})`);
          } catch (aiError) {
            const err = aiError as { message?: string; stack?: string; code?: string | number };
            console.error(
              `[onPostCreate] AI 자동답변 생성 실패: postId=${postId} isPrivate=${!!post.isPrivate} tag=${post.tag || "-"} courseId=${post.courseId || "-"} msg="${err?.message || aiError}" code=${err?.code || "-"}`,
              err?.stack || "",
            );
          }
        }
      }

      // 교수님께 전달 체크된 경우 교수님에게 알림 전송
      if (post.toProfessor && post.courseId) {
        try {
          // 해당 과목의 교수님들 조회
          const professorsSnapshot = await db.collection("users")
            .where("role", "==", "professor")
            .select()
            .get();

          const authorNickname = post.authorNickname || post.userName || "학생";
          const authorClass = post.authorClassType || post.userClass || "";

          // 각 교수님에게 알림 전송
          const notificationPromises = professorsSnapshot.docs.map((profDoc) =>
            db.collection("notifications").add({
              userId: profDoc.id,
              type: "TO_PROFESSOR_POST",
              title: "📬 학생 질문",
              message: `${authorNickname}${authorClass ? `(${authorClass}반)` : ""}님이 교수님께 질문을 남겼습니다`,
              data: {
                postId,
                courseId: post.courseId,
                title: post.title,
                authorNickname,
                authorClass,
              },
              read: false,
              createdAt: FieldValue.serverTimestamp(),
            })
          );

          await Promise.all(notificationPromises);
          console.log(`교수님께 알림 전송 완료: ${postId}`, {
            professorCount: professorsSnapshot.size,
          });
        } catch (notifError) {
          // 알림 실패해도 게시글 작성은 성공으로 처리
          console.error("교수님 알림 전송 실패:", notifError);
        }
      }
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error &&
          (error as { code: string }).code === "resource-exhausted") {
        console.log(`도배 방지로 보상 거부: ${userId}`, postId);
        return;
      }
      console.error("게시글 보상 지급 실패:", error);
      throw error;
    }
  }
);

/**
 * 게시글 태그 변경 시 콩콩이 자동답변 트리거
 * 기타/학사 → 학술로 변경 시 콩콩이가 응답하도록
 */
export const onPostUpdate = onDocumentWritten(
  {
    document: "posts/{postId}",
    region: "asia-northeast3",
    secrets: [
      GEMINI_API_KEY,
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_SECRET,
      DEFAULT_ORG_ID_SECRET,
    ],
  },
  async (event) => {
    const before = event.data?.before?.data() as Post | undefined;
    const after = event.data?.after?.data() as Post | undefined;
    const postId = event.params.postId;

    // 삭제 이벤트 (after 없음) — Supabase 도 삭제
    if (!after && before) {
      await supabaseDualDeletePost(postId);
      return;
    }
    if (!before || !after) return;

    // Supabase 동기화 (변경된 필드만 patch)
    const patch: Record<string, unknown> = {};
    if (before.title !== after.title) patch.title = after.title;
    if (before.content !== after.content) patch.content = after.content;
    if (before.tag !== after.tag) patch.tag = after.tag || null;
    if ((before.likeCount || 0) !== (after.likeCount || 0)) patch.like_count = after.likeCount || 0;
    if ((before.likes || 0) !== (after.likes || 0)) patch.likes = after.likes || 0;
    if ((before.commentCount || 0) !== (after.commentCount || 0)) patch.comment_count = after.commentCount || 0;
    if ((before.viewCount || 0) !== (after.viewCount || 0)) patch.view_count = after.viewCount || 0;
    // likedBy, isPinned 등은 onLikeReceived / pinPost 훅 에서 별도 처리
    if (Object.keys(patch).length > 0) {
      await supabaseDualUpdatePostPartial(postId, patch);
    }

    // 태그가 학술로 변경된 경우에만 트리거
    if (before.tag === after.tag) return;
    if (after.tag !== "학술") return;

    // 이미 콩콩이 댓글이 있으면 스킵
    const existingAI = await getFirestore().collection("comments")
      .where("postId", "==", postId)
      .where("authorId", "==", "gemini-ai")
      .limit(1)
      .get();
    if (!existingAI.empty) {
      console.log(`이미 콩콩이 댓글 존재, 태그 변경 트리거 스킵: ${postId}`);
      return;
    }

    // 교수님 글 제외
    const userId = after.authorId || after.userId;
    if (userId) {
      const authorDoc = await getFirestore().collection("users").doc(userId).get();
      if (authorDoc.data()?.role === "professor") {
        console.log(`교수님 게시글이므로 태그 변경 AI 스킵: ${postId}`);
        return;
      }
    }

    try {
      console.log(`태그 변경 감지 (${before.tag} → 학술), 콩콩이 자동답변 생성: ${postId}`);
      await generateBoardAIReply(after, postId, GEMINI_API_KEY.value());
    } catch (aiError) {
      console.error("태그 변경 AI 자동답변 생성 실패:", aiError);
    }
  }
);

/**
 * 댓글 생성 시 경험치 지급
 * 클라이언트는 comments 컬렉션에 저장하므로 해당 경로를 리스닝
 */
export const onCommentCreate = onDocumentCreated(
  {
    document: "comments/{commentId}",
    region: "asia-northeast3",
    secrets: [
      GEMINI_API_KEY,
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_SECRET,
      DEFAULT_ORG_ID_SECRET,
    ],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("댓글 문서가 없습니다.");
      return;
    }

    const comment = snapshot.data() as Comment;
    const commentId = event.params.commentId;
    const db = getFirestore();

    // AI 댓글은 commentCount만 증가, EXP/알림 스킵
    if (comment.authorId === "gemini-ai") {
      console.log(`AI 댓글이므로 보상/알림 스킵: ${commentId}`);
      if (comment.postId) {
        await db.collection("posts").doc(comment.postId).update({
          commentCount: FieldValue.increment(1),
        }).catch((e) => console.warn("AI 댓글 commentCount 증가 실패:", e));

        // Supabase 듀얼 라이트: AI 댓글 + 게시글 comment_count 증가
        await supabaseDualUpsertComment({
          firestoreId: commentId,
          firestorePostId: comment.postId,
          firestoreParentId: comment.parentId || null,
          authorId: "gemini-ai",
          authorNickname: comment.authorNickname || "콩콩이",
          content: comment.content,
          imageUrls: comment.imageUrls || [],
          isAiReply: true,
          createdAt: comment.createdAt?.toDate?.() || new Date(),
        });
        // post.comment_count 동기화는 onPostUpdate 트리거가 처리
      }
      return;
    }

    if (comment.rewarded) {
      console.log(`이미 보상이 지급된 댓글입니다: ${commentId}`);
      return;
    }

    // 클라이언트는 authorId를 사용, 레거시는 userId 사용
    const userId = comment.authorId || comment.userId;
    const { content, postId } = comment;

    if (!userId || !content || !postId) {
      console.error("필수 데이터가 누락되었습니다", { userId, postId });
      return;
    }

    try {
      // 게시글 조회 (비공개 여부 확인 + 이후 알림/AI에서 재사용)
      const postDoc = await db.collection("posts").doc(postId).get();
      const postData = postDoc.exists ? postDoc.data() as Post : null;

      // 비공개 글(나만의 콩콩이): rate limit 면제 (콩콩이와 자연스러운 대화 위해)
      // EXP는 공개 댓글과 동일하게 지급
      const isPrivate = !!postData?.isPrivate;

      if (!isPrivate) {
        await enforceRateLimit(userId, "COMMENT", commentId);
      }

      const expReward = EXP_REWARDS.COMMENT_CREATE;
      const reason = "댓글 작성";

      const commentExpPayload = await db.runTransaction<SupabaseExpPayload | null>(
        async (transaction) => {
          // READ — 모든 읽기를 쓰기보다 먼저 실행 (Firestore 트랜잭션 규칙)
          const freshDoc = await transaction.get(snapshot.ref);
          if (freshDoc.data()?.rewarded) {
            console.log(`트랜잭션 내 중복 감지 (댓글): ${commentId}`);
            return null;
          }

          const userDoc = await readUserForExp(transaction, userId);

          // WRITE — rewarded 마킹
          transaction.update(snapshot.ref, {
            rewarded: true,
            rewardedAt: FieldValue.serverTimestamp(),
            expRewarded: expReward,
          });

          if (userDoc) {
            const { supabasePayload } = addExpInTransaction(
              transaction, userId, expReward, reason, userDoc, {
                type: "comment_create",
                sourceId: commentId,
                sourceCollection: "comments",
                metadata: { postId },
              }
            );
            return supabasePayload;
          }
          return null;
        }
      );

      if (commentExpPayload) {
        flushExpSupabase(commentExpPayload).catch((e) =>
          console.warn("[Supabase comment_create exp dual-write] 실패:", e)
        );
      }

      // 게시글의 댓글 수 서버사이드 증가
      await db.collection("posts").doc(postId).update({
        commentCount: FieldValue.increment(1),
      }).catch((e) => console.warn("commentCount 증가 실패:", e));

      // Supabase 듀얼 라이트 (일반 유저 댓글)
      await supabaseDualUpsertComment({
        firestoreId: commentId,
        firestorePostId: postId,
        firestoreParentId: comment.parentId || null,
        authorId: userId,
        authorNickname: comment.authorNickname || comment.userName || null,
        authorClassType: comment.userClass || null,
        content,
        imageUrls: comment.imageUrls || [],
        isAnonymous: false,
        rewarded: true,
        rewardedAt: new Date(),
        expRewarded: expReward,
        createdAt: comment.createdAt?.toDate?.() || new Date(),
      });

      console.log(`댓글 보상 지급 완료: ${userId}`, { postId, commentId, expReward, isPrivate });

      // 게시글 작성자에게 알림 (본인 댓글은 제외)
      if (postDoc.exists && postData) {
        const postAuthorId = postData.authorId || postData.userId;
        if (postAuthorId && postAuthorId !== userId) {
          await db.collection("notifications").add({
            userId: postAuthorId,
            type: "NEW_COMMENT",
            title: "새 댓글",
            message: "내 글에 새로운 댓글이 달렸습니다",
            data: { postId, commentId },
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }

        // 콩콩이 자동 응답 트리거
        const shouldTriggerAI = (() => {
          // 학술 글 루트 댓글: 콩콩이가 대댓글로 응답
          if (!comment.parentId && postData.tag === "학술") return true;
          // 비공개 글 루트 댓글: 콩콩이가 대댓글로 응답
          if (!comment.parentId && postData.isPrivate) return true;
          // 대댓글: 학술 또는 비공개 글
          if (comment.parentId && (postData.tag === "학술" || postData.isPrivate)) return true;
          return false;
        })();

        if (shouldTriggerAI) {
          try {
            const authorDoc = await db.collection("users").doc(userId).get();
            const authorRole = authorDoc.data()?.role;
            const authorStudentId = authorDoc.data()?.studentId || "";

            // 비공개 글 일일 대화 한도 (사용자 메시지 100개/일, 25010423 제외)
            if (postData.isPrivate && authorStudentId !== "25010423") {
              const todayStart = new Date();
              todayStart.setHours(0, 0, 0, 0);
              const todayUserMessages = await db.collection("comments")
                .where("postId", "==", postId)
                .where("authorId", "==", userId)
                .where("createdAt", ">=", todayStart)
                .get();
              if (todayUserMessages.size >= 100) {
                console.log(`비공개 콩콩이 일일 한도 초과 (${todayUserMessages.size}/100): ${userId}`);
                return;
              }
            }

            if (authorRole === "professor") {
              console.log(`교수님 댓글이므로 AI 응답 스킵: ${commentId}`);
            }
            // 루트 댓글 → 콩콩이가 대댓글로 응답 (학술 + 비공개 모두)
            else if (!comment.parentId) {
              await generateAIReplyToComment(
                postData,
                postId,
                commentId, // 이 루트 댓글이 브랜치의 parent
                comment,
                GEMINI_API_KEY.value(),
              );
            }
            // 대댓글 → 콩콩이 응답
            else if (comment.parentId) {
              const parentDoc = await db.collection("comments").doc(comment.parentId).get();
              if (parentDoc.exists) {
                const parentComment = parentDoc.data() as Comment;
                // 학술: 부모가 콩콩이여야 응답 / 비공개: 부모가 누구든 응답
                if (parentComment.authorId === "gemini-ai" || postData.isPrivate) {
                  // 스팸 방지: 같은 유저가 30초 내 연속 AI 응답 트리거하는 것 방지
                  const recentReplies = await db.collection("comments")
                    .where("parentId", "==", comment.parentId)
                    .get();

                  const thirtySecAgo = Date.now() - 30 * 1000;
                  const hasRecentAIForUser = recentReplies.docs.some((d) => {
                    const data = d.data();
                    if (data.authorId !== "gemini-ai") return false;
                    const ts = data.createdAt?.toMillis?.() || data.createdAt?._seconds * 1000 || 0;
                    if (ts <= thirtySecAgo) return false;
                    const sorted = recentReplies.docs
                      .map((r) => r.data())
                      .filter((r) => {
                        const rTs = r.createdAt?.toMillis?.() || r.createdAt?._seconds * 1000 || 0;
                        return rTs < ts && rTs > thirtySecAgo;
                      })
                      .sort((a, b) => {
                        const aTs = a.createdAt?.toMillis?.() || a.createdAt?._seconds * 1000 || 0;
                        const bTs = b.createdAt?.toMillis?.() || b.createdAt?._seconds * 1000 || 0;
                        return bTs - aTs;
                      });
                    return sorted.length > 0 && sorted[0].authorId === userId;
                  });

                  if (!hasRecentAIForUser) {
                    await generateAIReplyToComment(
                      postData,
                      postId,
                      comment.parentId,
                      comment,
                      GEMINI_API_KEY.value(),
                    );
                  } else {
                    console.log(`스팸 방지: ${userId}에 대한 30초 내 AI 대댓글 이미 존재`);
                  }
                }
              }
            }
          } catch (aiError) {
            console.error("콩콩이 자동 응답 실패:", aiError);
          }
        }
      }
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error &&
          (error as { code: string }).code === "resource-exhausted") {
        console.log(`도배 방지로 보상 거부: ${userId}`, commentId);
        return;
      }
      console.error("댓글 보상 지급 실패:", error);
      throw error;
    }
  }
);

/**
 * 좋아요 받으면 likeCount 증가 + 알림 (EXP 보상 없음)
 */
export const onLikeReceived = onDocumentCreated(
  {
    document: "likes/{likeId}",
    region: "asia-northeast3",
    secrets: [
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_SECRET,
      DEFAULT_ORG_ID_SECRET,
    ],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("좋아요 문서가 없습니다.");
      return;
    }

    const like = snapshot.data() as Like;
    const likeId = event.params.likeId;

    const { userId, targetType, targetId, targetUserId } = like;

    if (!userId || !targetType || !targetId || !targetUserId) {
      console.error("필수 데이터가 누락되었습니다", like);
      return;
    }

    const db = getFirestore();

    try {
      // likeCount/likes/likedBy 증가 (EXP 지급 없음)
      if (targetType === "post") {
        const postRef = db.collection("posts").doc(targetId);
        await postRef.update({
          likeCount: FieldValue.increment(1),
          likes: FieldValue.increment(1),
          likedBy: FieldValue.arrayUnion(userId),
        });
        // Supabase 듀얼 라이트: 최신 likedBy 값 반영
        const fresh = await postRef.get();
        const fdata = fresh.data();
        if (fdata) {
          await supabaseDualUpdatePostPartial(targetId, {
            likes: fdata.likes || 0,
            like_count: fdata.likeCount || 0,
            liked_by: fdata.likedBy || [],
          });
        }
      } else if (targetType === "comment") {
        const commentRef = db.collection("comments").doc(targetId);
        await commentRef.update({
          likeCount: FieldValue.increment(1),
          likes: FieldValue.increment(1),
          likedBy: FieldValue.arrayUnion(userId),
        });
        const fresh = await commentRef.get();
        const fdata = fresh.data();
        if (fdata) {
          await supabaseDualUpdateCommentPartial(targetId, {
            likes: fdata.likes || 0,
            like_count: fdata.likeCount || 0,
            liked_by: fdata.likedBy || [],
          });
        }
      }

      console.log("좋아요 처리 완료:", { likeId, targetType, targetId });

      // 자기 자신에게 좋아요면 알림 미전송
      if (userId !== targetUserId) {
        await db.collection("notifications").add({
          userId: targetUserId,
          type: "LIKE_RECEIVED",
          title: "좋아요",
          message: `내 ${targetType === "post" ? "글" : "댓글"}에 좋아요를 받았습니다`,
          data: { likeId, targetType, targetId },
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (error) {
      console.error("좋아요 처리 실패:", error);
      throw error;
    }
  }
);

/**
 * 좋아요 취소 시 좋아요 수 감소
 */
export const onLikeRemoved = onDocumentWritten(
  {
    document: "likes/{likeId}",
    region: "asia-northeast3",
    secrets: [
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_SECRET,
      DEFAULT_ORG_ID_SECRET,
    ],
  },
  async (event) => {
    // 삭제인 경우만 처리
    if (event.data?.after.exists) {
      return;
    }

    const beforeData = event.data?.before.data() as Like | undefined;
    if (!beforeData) {
      return;
    }

    const { userId, targetType, targetId } = beforeData;
    const db = getFirestore();

    try {
      if (targetType === "post") {
        const postRef = db.collection("posts").doc(targetId);
        await postRef.update({
          likeCount: FieldValue.increment(-1),
          likes: FieldValue.increment(-1),
          ...(userId ? { likedBy: FieldValue.arrayRemove(userId) } : {}),
        });
        const fresh = await postRef.get();
        const fdata = fresh.data();
        if (fdata) {
          await supabaseDualUpdatePostPartial(targetId, {
            likes: fdata.likes || 0,
            like_count: fdata.likeCount || 0,
            liked_by: fdata.likedBy || [],
          });
        }
      } else if (targetType === "comment") {
        const commentRef = db.collection("comments").doc(targetId);
        await commentRef.update({
          likeCount: FieldValue.increment(-1),
          likes: FieldValue.increment(-1),
          ...(userId ? { likedBy: FieldValue.arrayRemove(userId) } : {}),
        });
        const fresh = await commentRef.get();
        const fdata = fresh.data();
        if (fdata) {
          await supabaseDualUpdateCommentPartial(targetId, {
            likes: fdata.likes || 0,
            like_count: fdata.likeCount || 0,
            liked_by: fdata.likedBy || [],
          });
        }
      }

      console.log("좋아요 취소 처리 완료:", { targetType, targetId });
    } catch (error) {
      console.error("좋아요 취소 처리 실패:", error);
    }
  }
);

/**
 * 댓글 삭제 시 게시글 댓글 수 감소
 */
export const onCommentDeleted = onDocumentDeleted(
  {
    document: "comments/{commentId}",
    region: "asia-northeast3",
    secrets: [
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_SECRET,
      DEFAULT_ORG_ID_SECRET,
    ],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const comment = snapshot.data() as Comment;
    const { postId } = comment;
    const commentId = event.params.commentId;

    // Supabase 듀얼 삭제
    await supabaseDualDeleteComment(commentId);

    if (!postId) return;

    const db = getFirestore();
    try {
      await db.collection("posts").doc(postId).update({
        commentCount: FieldValue.increment(-1),
      });
      console.log(`댓글 삭제 → commentCount 감소: postId=${postId}`);
    } catch (error) {
      console.error("댓글 삭제 commentCount 감소 실패:", error);
    }
  }
);

/**
 * 학술 태그 게시글에 Gemini AI 자동답변 생성
 * 이미지가 있으면 함께 인식하여 통합 답변
 */
// 과목 ID → 과목명 매핑
const COURSE_NAMES: Record<string, string> = {
  biology: "생물학",
  pathophysiology: "병태생리학",
  microbiology: "미생물학",
};

/**
 * 해당 과목의 학술 게시글에 달린 교수 댓글을 최근 10개 로드
 */
async function loadProfessorComments(
  courseId: string,
  maxCount: number = 10,
): Promise<Array<{ content: string; imageUrls?: string[] }>> {
  const db = getFirestore();

  // 해당 과목의 학술 게시글 최근 50개 조회
  const postsSnap = await db.collection("posts")
    .where("courseId", "==", courseId)
    .where("tag", "==", "학술")
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  if (postsSnap.empty) return [];

  const postIds = postsSnap.docs.map((d) => d.id);

  // 교수 uid 목록 조회 (ID만 필요 — select()로 대역폭 절감)
  const professorsSnap = await db.collection("users")
    .where("role", "==", "professor")
    .select()
    .get();
  const professorIds = new Set(professorsSnap.docs.map((d) => d.id));

  if (professorIds.size === 0) return [];

  // 해당 게시글들의 댓글 중 교수 댓글 수집
  const result: Array<{ content: string; imageUrls?: string[]; createdMs: number }> = [];

  // Firestore in 쿼리 제한(30개)에 맞게 분할
  for (let i = 0; i < postIds.length; i += 30) {
    const batch = postIds.slice(i, i + 30);
    const commentsSnap = await db.collection("comments")
      .where("postId", "in", batch)
      .get();

    for (const doc of commentsSnap.docs) {
      const data = doc.data();
      if (!professorIds.has(data.authorId)) continue;
      if (!data.content) continue;

      const createdMs = data.createdAt?.toMillis?.() ||
        (data.createdAt as unknown as { _seconds: number })?._seconds * 1000 || 0;
      result.push({
        content: data.content,
        imageUrls: data.imageUrls?.length > 0 ? data.imageUrls : undefined,
        createdMs,
      });
    }

    if (result.length >= maxCount * 2) break;
  }

  // 최신순 정렬 후 상위 N개
  result.sort((a, b) => b.createdMs - a.createdMs);
  return result.slice(0, maxCount).map(({ content, imageUrls }) => ({ content, imageUrls }));
}

/**
 * 교수 퀴즈에서 관련 문제 + 오답 통계를 로드
 * 챕터 기반 필터링 → 문제text + explanation + 정답률/오답 선지 통계
 */
const PROFESSOR_QUIZ_TYPES = new Set(["midterm", "final", "past", "independent", "professor", "custom"]);

async function loadQuizContextForAI(
  courseId: string,
  chapters: string[],
  maxQuestions: number = 8,
): Promise<string> {
  const db = getFirestore();

  // 해당 과목의 교수 퀴즈 로드
  const quizzesSnap = await db.collection("quizzes")
    .where("courseId", "==", courseId)
    .get();

  if (quizzesSnap.empty) return "";

  // 교수 퀴즈만 필터 + 챕터 매칭 문제 추출
  interface QuizQuestion {
    text: string;
    choices?: string[];
    answer: number | string;
    explanation?: string;
    choiceExplanations?: string[];
    chapterId?: string;
    type?: string;
    quizTitle: string;
    quizType: string;
    questionIndex: number;
    quizId: string;
  }
  const matchedQuestions: QuizQuestion[] = [];
  const quizIds: string[] = [];

  for (const doc of quizzesSnap.docs) {
    const quiz = doc.data();
    if (!PROFESSOR_QUIZ_TYPES.has(quiz.type)) continue;
    if (!quiz.questions || quiz.questions.length === 0) continue;

    const quizId = doc.id;
    let hasMatch = false;

    for (let i = 0; i < quiz.questions.length; i++) {
      const q = quiz.questions[i];
      const qChapter = q.chapterId || "";
      // 챕터 매칭: chapterId가 있으면 비교, 없으면 전체 포함
      const chapterMatch = chapters.length === 0
        || !qChapter
        || chapters.some((ch) => qChapter.includes(ch) || qChapter.endsWith(`_${ch}`));

      if (chapterMatch && q.text) {
        matchedQuestions.push({
          text: q.text,
          choices: q.choices,
          answer: q.answer,
          explanation: q.explanation,
          choiceExplanations: q.choiceExplanations,
          chapterId: q.chapterId,
          type: q.type,
          quizTitle: quiz.title || "",
          quizType: quiz.type,
          questionIndex: i,
          quizId: quizId,
        });
        if (!hasMatch) { quizIds.push(quizId); hasMatch = true; }
      }
    }
  }

  if (matchedQuestions.length === 0) return "";

  // 오답 통계 수집: quizId별로 quizResults에서 questionScores 집계
  const wrongAnswerStats: Record<string, { total: number; wrong: number; wrongChoices: Record<string, number> }> = {};

  for (let i = 0; i < quizIds.length; i += 30) {
    const batch = quizIds.slice(i, i + 30);
    const resultsSnap = await db.collection("quizResults")
      .where("quizId", "in", batch)
      .get();

    for (const rDoc of resultsSnap.docs) {
      const r = rDoc.data();
      const scores = r.questionScores;
      if (!scores) continue;

      for (const [qKey, score] of Object.entries(scores)) {
        const s = score as { isCorrect?: boolean; userAnswer?: string; correctAnswer?: string };
        const statKey = `${r.quizId}_${qKey}`;
        if (!wrongAnswerStats[statKey]) {
          wrongAnswerStats[statKey] = { total: 0, wrong: 0, wrongChoices: {} };
        }
        wrongAnswerStats[statKey].total++;
        if (!s.isCorrect) {
          wrongAnswerStats[statKey].wrong++;
          const ua = String(s.userAnswer ?? "");
          if (ua) wrongAnswerStats[statKey].wrongChoices[ua] = (wrongAnswerStats[statKey].wrongChoices[ua] || 0) + 1;
        }
      }
    }
  }

  // 상위 N개 문제 선택 (오답률 높은 순 우선)
  const withStats = matchedQuestions.map((q) => {
    const statKey = `${q.quizId}_q${q.questionIndex + 1}`;
    const stat = wrongAnswerStats[statKey];
    const wrongRate = stat && stat.total >= 3 ? stat.wrong / stat.total : 0;
    return { ...q, stat, wrongRate };
  });
  withStats.sort((a, b) => b.wrongRate - a.wrongRate);
  const selected = withStats.slice(0, maxQuestions);

  // 컨텍스트 문자열 생성
  const lines = selected.map((q) => {
    let line = `문제: ${q.text}`;
    if (q.choices && q.choices.length > 0) {
      line += `\n선지: ${q.choices.map((c, i) => `${i + 1}) ${c}`).join(" / ")}`;
    }
    if (q.explanation) {
      line += `\n해설: ${q.explanation}`;
    }
    if (q.stat && q.stat.total >= 3) {
      const correctRate = Math.round((1 - q.wrongRate) * 100);
      line += `\n정답률: ${correctRate}% (${q.stat.total}명 응시)`;
      // 가장 많이 고른 오답 선지
      const topWrong = Object.entries(q.stat.wrongChoices).sort((a, b) => b[1] - a[1])[0];
      if (topWrong && q.choices) {
        const idx = parseInt(topWrong[0]);
        if (!isNaN(idx) && q.choices[idx]) {
          line += ` — 가장 많이 틀린 선지: ${idx + 1}번 "${q.choices[idx]}"`;
        }
      }
    }
    return line;
  });

  console.log(`[콩콩이] 퀴즈 컨텍스트 로드: ${courseId}, ${selected.length}문제 (전체 ${matchedQuestions.length}개 중)`);

  return `\n\n[이 과목의 교수 퀴즈 — 오답률 높은 순 ★★★]\n아래는 이 과목에서 출제된 관련 퀴즈 문제와 해설, 학생들의 정답률이야.\n**활용법**: 질문과 관련된 퀴즈가 있으면, 답변의 "참고로~" 부분에서 적극적으로 언급해줘. 특히 오답률이 높은 문제는 "이 개념, 시험에서 친구들이 많이 틀렸거든~" 하고 왜 헷갈리는지, 어떻게 구분하는지 짚어줘. 퀴즈 내용을 그대로 읊지는 말고 자연스럽게 녹여서.\n\n${lines.join("\n\n")}`;
}

async function generateBoardAIReply(
  post: Post,
  postId: string,
  apiKey: string,
): Promise<void> {
  const db = getFirestore();
  const isDetailed = post.aiDetailedAnswer === true || post.isPrivate === true;

  // scope 최대 길이: 기본 8,000자, 상세 12,000자
  const scopeMaxLength = isDetailed ? 12000 : 8000;

  // 과목명 확인
  const courseName = post.courseId ? COURSE_NAMES[post.courseId] || post.courseId : "";
  let courseContext = courseName ? `\n\n[과목 정보]\n이 질문은 "${courseName}" 과목 게시판에 올라온 글이야. 해당 과목 맥락에 맞게 답변해줘.` : "";

  // 챕터 추론 (scope + 퀴즈 양쪽에서 사용)
  let relatedChapters: string[] = [];
  if (post.courseId) {
    try {
      const questionText = post.isPrivate ? post.content : `${post.title} ${post.content}`;
      relatedChapters = await inferChaptersFromText(post.courseId, questionText);
    } catch {
      // 챕터 추론 실패 무시
    }
  }

  // Scope 참조: 질문과 관련된 챕터 범위를 로드하여 정확한 답변 지원
  if (post.courseId) {
    try {
      const scope = await loadScopeForAI(
        post.courseId,
        relatedChapters.length > 0 ? relatedChapters : undefined,
        scopeMaxLength,
      );
      if (scope && scope.content) {
        courseContext += `\n\n[과목 학습 범위 — 교과서 내용 ★★★]\n아래는 이 과목의 교과서 내용이야. 이 내용에 나오는 용어, 분류, 메커니즘, 비교를 답변의 뼈대로 삼아. scope에 해당 주제의 구체적인 설명(예: 특정 물질명, 구조 비교, 기전 차이 등)이 있으면 반드시 해당 내용을 답변에 포함해. scope에 없는 부분만 일반 지식으로 보충해.\n\n${scope.content}`;
        console.log(`[콩콩이] scope 로드: ${post.courseId}, 챕터=${scope.chaptersLoaded.join(",")}, ${scope.content.length}자`);
      }
    } catch (scopeErr) {
      console.warn("[콩콩이] scope 로드 실패 (무시):", scopeErr);
    }
  }

  // 교수 퀴즈 문제 + 오답 통계 로딩
  let quizContext = "";
  if (post.courseId) {
    try {
      quizContext = await loadQuizContextForAI(post.courseId, relatedChapters, 8);
    } catch (quizErr) {
      console.warn("[콩콩이] 퀴즈 컨텍스트 로드 실패 (무시):", quizErr);
    }
  }

  // 교수 댓글 로딩 (상세 모드에서만)
  let professorContext = "";
  if (isDetailed && post.courseId) {
    try {
      const profComments = await loadProfessorComments(post.courseId, 10);
      if (profComments.length > 0) {
        const formatted = profComments
          .map((c, i) => `${i + 1}. ${c.content}`)
          .join("\n\n");
        professorContext = `\n\n[교수님 답변 참고]\n교수님이 다른 학술 질문에 답변하신 내용이야. 이 내용과 강조점을 참고해서 답변에 녹여줘.\n\n${formatted}`;
        console.log(`[콩콩이] 교수 댓글 ${profComments.length}개 로드 (상세 모드)`);
      }
    } catch (profErr) {
      console.warn("[콩콩이] 교수 댓글 로드 실패 (무시):", profErr);
    }
  }

  // 답변 스타일 분기
  const answerStyle = isDetailed
    ? `\n[답변 스타일 — 상세 모드]
- scope와 교수님 댓글을 참고해서 깊이 있게 답변해줘.
- 연계 개념은 "참고로~" 정도로 가볍게 덧붙여.`
    : "";

  // 프롬프트 구성
  const systemPrompt = post.isPrivate
    ? `너는 "${post.authorNickname || "학생"}"의 개인 학습 친구 "콩콩이"야. 이건 비공개 대화방이라 너와 이 학생만 볼 수 있어.

[핵심 원칙]
- 이 학생이 하는 모든 말을 기억해. 별명, 요청, 이전 대화 내용을 기억하고 반영해.
- 수업 내용 질문이면 정확하고 자세하게 설명해줘.
- 수업 외 잡담이나 개인적인 대화도 자연스럽게 받아줘. 비공개 대화방이니까.
- 단, 유해하거나 위험한 내용(자해, 폭력, 불법 등)은 정중히 거절해.

[절대 금지]
- 이모지, 이모티콘, 특수 기호 문자 절대 사용 금지. 순수 텍스트만 써.
- 과하게 유치한 표현, 과한 칭찬 금지.

[콩콩이 말투]
- 20대 한국 여자 대학생이 같은 과 친구한테 말하듯 자연스러운 반말
- ~거든, ~지, ~잖아, ~인 듯, ~해, ~같아, ~거야 같은 구어체
- 친절하되 담백하게.

[설명 순서 — 수업 관련 질문일 때]
1. **결론 먼저** (scope에 답이 있으면 scope 기반으로)
2. **"우리 수업자료에 따르면:" — scope 기반 설명**: scope의 구체적인 용어, 물질명, 메커니즘을 활용. scope에 나온 내용은 빠뜨리지 마.
3. **"일반 지식으로 보충하면:" — 일반 지식 보충** (선택): scope만으로 부족하거나 학술적으로 더 정확한 맥락이 필요할 때. 수업 내용과 추가 지식을 명확히 구분해줘.
4. **"참고로~" — 연계 개념 + 시험 빈출** (선택): 관련 퀴즈 데이터에 고오답률 문제가 있으면 "참고로~" 하고 짚어줘.
5. **정리 + 끝인사**

- 복잡한 개념은 단계별로 쪼개서 설명하고, 헷갈리는 개념은 비교해줘.
- 중요 용어는 한글(영문) 형태로 써줘. 예: "정착(colonization)"
- 첫 답변이라도 질문에 맞게 충분히 자세하게 답변해. 짧게 끊지 마.
- 설명이 길어졌으면 "정리하면:" 하고 핵심만 1~3줄로 요약해줘.
- scope 내용을 그대로 복붙하지 말고, 대화체로 자연스럽게 녹여서 설명해.

[답변 규칙]
- 한국어로 답변해
- 학생이 너한테 별명을 지어주거나 역할을 부여하면 그에 맞게 행동해.
- 수업 관련 질문에는 정확하고 자세하게, 잡담에는 재미있게 답해줘.
- 답변 마지막에 "궁금한 게 더 있으면 댓글로 물어봐~" 라고 안내해.${courseContext}${quizContext}${professorContext}`
    : `너는 "콩콩이"라는 이름의 수업 보조 AI야. 학생이 학술 게시판에 올린 질문에 답변해줘.

[절대 금지]
- 이모지, 이모티콘, 특수 기호 문자 절대 사용 금지. 순수 텍스트만 써.
- "후배", "선배" 같은 호칭 금지. 너는 학생의 선배가 아니라 수업 보조 AI야.
- 과하게 유치한 표현, 과한 칭찬, 과한 감탄사 금지.
- 마크다운 헤딩(#, ##, ###) 사용 금지. 강조는 **볼드**만 사용.

[콩콩이 말투]
- 20대 한국 여자 대학생이 같은 과 친구한테 설명하듯 자연스러운 반말
- ~거든, ~지, ~잖아, ~인 듯, ~해, ~같아, ~거야 같은 구어체
- 친절하되 담백하게. 과하지 않은 톤.

[플랫폼 기능 질문 처리]
- 학생이 "이 앱 어떻게 써?", "배틀 어떻게 해?", "뽑기 언제 돼?", "EXP 얼마야?" 같은 앱/플랫폼 사용법 자체를 물어볼 때만 의견게시판으로 안내해.
- 안내 방법: 공감 한마디 + "이런 건 홈 탭에 있는 의견게시판에 올려보면 교수님이나 관리자가 직접 답해줄 수 있을 거야!" + 콩콩이는 수업 내용 도우미라 앱 기능은 잘 모른다고 솔직히 말해.
- 중요: "토끼", "배틀", "랭킹" 같은 단어가 포함되더라도 수업/학술 맥락의 질문이면 반드시 학술 답변을 해줘. 예를 들어 "토끼의 소화기관", "세균 간의 랭킹", "바이러스와 면역의 배틀" 등은 학술 질문이야.

[답변 순서 — 이게 제일 중요해!]
답변은 반드시 이 순서를 따라. 짧은 질문이면 1→4로 바로 가도 되지만, 순서 자체는 지켜.

1. **결론 먼저** (scope에 답이 있으면 scope 기반으로): 질문에 대한 답을 첫 1~2문장에서 바로 말해줘.
2. **"우리 수업자료에 따르면:" — scope 기반 설명**: scope에 나오는 구체적인 용어, 물질명, 메커니즘, 비교를 활용해서 설명해. 이게 답변의 핵심이야. scope에 나온 내용은 빠뜨리지 마. "우리 수업자료에 따르면:" 같은 표현으로 시작해서 학생이 시험 범위 내 내용임을 알 수 있게 해줘.
3. **"일반 지식으로 보충하면:" — 일반 지식 보충** (선택): scope만으로 설명이 부족하거나, 학술적으로 더 정확한 맥락이 필요할 때 일반 지식으로 보충해. "일반 지식으로 보충하면:" 같은 표현으로 구분해서, 학생이 수업 내용과 추가 지식을 명확히 구분할 수 있게 해줘.
4. **"참고로~" — 연계 개념 + 시험 빈출** (선택): scope에 관련 내용이 더 있거나, [교수 퀴즈] 데이터에 해당 주제의 고오답률 문제가 있으면 "참고로~", "이거 시험에서도 나왔는데~" 하고 짚어줘. 특히 오답률 높은 문제는 왜 헷갈리는지, 어떻게 구분하는지 알려주면 학생에게 큰 도움이 돼.
5. **정리 + 끝인사**: 설명이 길었으면 "정리하면:" 핵심 요약 → "궁금한 거 더 있으면 대댓글로 물어봐~"

[설명 테크닉]
- **왜 그런지 설명**: 결론 뒤에 "왜냐면~", "이게 왜 그러냐면~" 하고 근거를 붙여.
- **단계별 분해**: 복잡한 개념은 단계별로 쪼개서 설명해. 예: "부착 → 정착 → 침입, 이 3단계가 있는데..."
- **비유 적극 활용**: 어려운 개념은 일상적 비유로 풀어줘. 예: "쉽게 말하면 자리싸움이야", "면역세포가 경찰이라면 항체는 수배전단지인 셈이지"
- **헷갈리는 개념 비교**: 비슷한 용어나 개념이 있으면 "이건 OO과 헷갈리기 쉬운데, 차이점은~" 하고 비교해줘.
- **선지 분석 요청 시**: 각 선지가 왜 맞거나 틀린지 하나씩 짚어줘. 틀린 선지는 "어디가 틀렸는지" + "정확한 표현은 뭔지"를 같이 알려줘.
- **교과서 용어 병기**: 중요한 용어는 한글(영문) 형태로 써줘. 예: "정착(colonization)", "부착소(adhesin)"
- **핵심 정리**: 설명이 길어졌으면 "정리하면:" 하고 핵심만 1~3줄로 요약해줘.
- **scope는 녹여쓰기**: scope 내용을 그대로 복붙하지 말고, 대화체로 자연스럽게 녹여서 설명해. 교과서를 읽어주는 게 아니라 친구가 설명해주는 느낌으로.

[질문 유형별 대응]
- **"이렇게 이해한 게 맞아?" 확인형**: 맞는 부분은 "맞아!" 하고 인정해주고, 틀리거나 부정확한 부분은 "여기까지는 맞는데, 이 부분은 좀 더 정확하게 말하면~" 하고 교정해줘. 전부 틀렸어도 "좋은 시도인데~" 하고 시작해.
- **학생이 비유를 제시했을 때**: "좋은 비유야!" 한마디로 끝내지 말고, 비유가 정확한 점 + 한계점(비유와 실제가 다른 점)을 짚어줘.
- **용어 여러 개 나열형**: 하나씩 순서대로 정리해주되, 관련된 것끼리 묶어서 설명하면 기억에 도움 돼.
- **고급 추론 질문**: 학생이 개념을 연결해서 물어보면 "날카로운 질문이야!" 하고, 연결이 맞는 부분과 다른 부분을 구분해서 알려줘.

[답변 분량]
- 짧은 단답형 질문이 아닌 이상, 충분히 자세하게 설명해. 간단한 질문은 3~5문장, 복잡한 질문은 필요한 만큼.
- 단, 같은 말 반복하거나 뻔한 서론으로 분량 늘리지는 마.
- **답변이 절대 끊기면 안 돼!** 긴 설명이 필요하면 중간에 자르지 말고 끝까지 이어서 답변해.

[답변 형식]
- 한국어로 답변해
- 글의 제목, 본문, 첨부된 이미지를 모두 참고해서 답변해
- 불필요한 서론, 반복, 빈 줄 넣지 마. 바로 본론으로.
- 줄바꿈은 내용이 전환될 때만. 매 문장마다 줄바꿈하지 마.
- 자연스러운 문장 흐름으로 써. 번호/목록은 3개 이상 나열하거나 단계를 구분할 때만.${answerStyle}

[정확성 — 이건 설명 방법만큼 중요해!]
- **scope가 답변의 뼈대**: [과목 학습 범위]에 나온 내용과 너의 일반 지식이 다르면, scope를 따라. scope가 이 과목의 교과서야.
- **scope 구체 내용 필수 포함**: scope에 해당 주제의 구체적인 용어, 물질명, 메커니즘 비교, 분류가 나와 있으면 **반드시 답변에 포함해**. 예를 들어 scope에 "그람양성균은 리포테이코산으로 부착"이라고 나와 있는데 질문이 부착/섬모 관련이면 이걸 빠뜨리면 안 돼. scope의 구체적 내용을 너의 일반론으로 대체하지 마.
- **scope에 없는 내용**: 일반 지식으로 보충해도 되지만, 확신이 없으면 "이건 교수님한테 한번 확인해보는 게 좋을 것 같아!"로 안내해. 틀린 정보보다 모른다고 말하는 게 낫다.
- **용어 정밀도**: 의학/생물학은 비슷한 용어가 많아. "침입"과 "정착", "감염"과 "발병", "독소"와 "독력인자" 같은 구분을 정확히 해줘. 대충 비슷한 말로 바꿔 쓰지 마.
- **학생이 틀린 전제로 질문했을 때**: 바로 "틀렸어!"라고 하지 말고, "좋은 질문인데, 여기서 한 가지 짚고 가자면~" 하고 부드럽게 교정해줘. 왜 헷갈릴 수 있는지도 설명해주면 더 좋아.
- **인과관계 주의**: "A이므로 B이다"를 쓸 때, 진짜 인과관계인지 상관관계인지 구분해. 교과서에서 "~한다"라고 쓴 건 확정, "~할 수 있다"라고 쓴 건 가능성이야.
- 답변 작성 후 반드시 사실 관계, 수치, 용어를 한번 더 검토해.${courseContext}${quizContext}${professorContext}`;

  const userText = `제목: ${post.title}\n본문: ${post.content}`;

  // Gemini API 요청 parts 구성
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: systemPrompt + "\n\n" + userText },
  ];

  // 이미지가 있으면 base64로 변환하여 추가
  if (post.imageUrls && post.imageUrls.length > 0) {
    for (const imageUrl of post.imageUrls) {
      try {
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) continue;
        const buffer = await imgResponse.buffer();
        const base64 = buffer.toString("base64");
        const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
        parts.push({
          inlineData: {
            mimeType: contentType,
            data: base64,
          },
        });
      } catch (imgError) {
        console.warn("이미지 fetch 실패, 스킵:", imageUrl, imgError);
      }
    }
  }

  // 출력 토큰: 기본 8,192, 상세 16,384
  const maxOutputTokens = isDetailed ? 16384 : 8192;

  // 비공개 콩콩이는 thinking 끄기 (비용 5배 절감)
  const thinkingBudget = post.isPrivate ? 0 : 8192;
  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.5,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: thinkingBudget + maxOutputTokens,
      ...(thinkingBudget > 0 ? {
        thinkingConfig: {
          thinkingBudget,
        },
      } : {}),
    },
  };

  // Gemini 2.5 Flash API 호출
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    );
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "AbortError") {
      throw new Error("Gemini AI 답변 요청 시간 초과 (120초)");
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini AI 답변 API 오류:", response.status, errorText);
    throw new Error(`Gemini API 오류: ${response.status}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!aiText) {
    console.warn("Gemini AI 답변이 비어있습니다", data);
    return;
  }

  // comments 컬렉션에 AI 댓글 저장
  await db.collection("comments").add({
    postId: postId,
    authorId: "gemini-ai",
    authorNickname: "콩콩이",
    authorClassType: null,
    content: aiText.trim(),
    imageUrls: [],
    isAnonymous: false,
    isAIReply: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  // commentCount는 onCommentCreate 트리거에서 증가

  console.log(`AI 자동답변 생성 완료: postId=${postId}`);
}

/**
 * 콩콩이 댓글에 대댓글이 달리면 전체 대화 맥락을 이해하고 대댓글로 응답
 * 여러 유저가 각각 대댓글을 달아도 각자의 대화 맥락을 유지하며 응답
 */
async function generateAIReplyToComment(
  post: Post,
  postId: string,
  parentCommentId: string,
  userReply: Comment,
  apiKey: string,
): Promise<void> {
  const db = getFirestore();

  // 루트 댓글 로드
  const rootDoc = await db.collection("comments").doc(parentCommentId).get();
  if (!rootDoc.exists) return;
  const rootComment = rootDoc.data() as Comment;

  // 전체 대화 스레드 로드 (같은 parentId를 가진 모든 대댓글)
  const threadSnapshot = await db.collection("comments")
    .where("parentId", "==", parentCommentId)
    .get();

  // 시간순 정렬
  const threadComments = threadSnapshot.docs
    .map((d) => d.data() as Comment)
    .sort((a, b) => {
      const aTs = a.createdAt?.toMillis?.() || (a.createdAt as unknown as { _seconds: number })?._seconds * 1000 || 0;
      const bTs = b.createdAt?.toMillis?.() || (b.createdAt as unknown as { _seconds: number })?._seconds * 1000 || 0;
      return aTs - bTs;
    });

  // 학술글: 이 글의 다른 댓글/대댓글도 전체 맥락으로 참조 (제목, 본문, 기존 콩콩이 답변 등)
  let otherCommentsContext = "";
  if (post.tag === "학술" && !post.isPrivate) {
    try {
      const allCommentsSnap = await db.collection("comments")
        .where("postId", "==", postId)
        .get();
      const otherComments = allCommentsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() as Comment }))
        .filter((c) => c.id !== parentCommentId) // 현재 루트 댓글 제외 (아래서 별도 표시)
        .filter((c) => !c.parentId || c.parentId !== parentCommentId) // 현재 스레드 대댓글 제외
        .sort((a, b) => {
          const aTs = a.createdAt?.toMillis?.() || (a.createdAt as unknown as { _seconds: number })?._seconds * 1000 || 0;
          const bTs = b.createdAt?.toMillis?.() || (b.createdAt as unknown as { _seconds: number })?._seconds * 1000 || 0;
          return aTs - bTs;
        });
      if (otherComments.length > 0) {
        const lines = otherComments.map((c) => {
          const speaker = c.authorId === "gemini-ai" ? "콩콩이" : (c.authorNickname || "학생");
          const prefix = c.parentId ? "  (대댓글) " : "";
          return `${prefix}${speaker}: ${c.content}`;
        });
        otherCommentsContext = `\n\n[이 글의 다른 댓글/대댓글]\n${lines.join("\n\n")}`;
      }
    } catch {
      // 다른 댓글 로드 실패 무시
    }
  }

  // 대화 기록 구성 (루트 댓글 화자 자동 판별)
  const rootSpeaker = rootComment.authorId === "gemini-ai"
    ? "콩콩이"
    : (rootComment.authorNickname || "학생");
  let conversationHistory = `${rootSpeaker}: ${rootComment.content}`;
  for (const msg of threadComments) {
    const speaker = msg.authorId === "gemini-ai"
      ? "콩콩이"
      : (msg.authorNickname || "학생");
    conversationHistory += `\n\n${speaker}: ${msg.content}`;
  }

  // 과목명 확인
  const courseName = post.courseId ? COURSE_NAMES[post.courseId] || post.courseId : "";
  let courseContext = courseName ? `\n\n[과목 정보]\n이 대화는 "${courseName}" 과목 게시판의 글이야. 해당 과목 맥락에 맞게 답변해줘.` : "";

  // 챕터 추론
  let relatedChapters: string[] = [];
  if (post.courseId) {
    try {
      const questionText = post.isPrivate
        ? `${post.content} ${conversationHistory} ${userReply.content || ""}`
        : `${post.title} ${post.content} ${userReply.content || ""}`;
      relatedChapters = await inferChaptersFromText(post.courseId, questionText);
    } catch {
      // 챕터 추론 실패 무시
    }
  }

  // Scope 참조 (대댓글에도 과목 범위 제공)
  // 비공개 콩콩이는 12,000자, 공개 대댓글은 8,000자
  const replyScopeMax = post.isPrivate ? 12000 : 8000;
  if (post.courseId) {
    try {
      const scope = await loadScopeForAI(
        post.courseId,
        relatedChapters.length > 0 ? relatedChapters : undefined,
        replyScopeMax,
      );
      if (scope && scope.content) {
        courseContext += `\n\n[과목 학습 범위 — 교과서 내용 ★★★]\n아래 교과서 내용에 나오는 구체적인 용어, 물질명, 메커니즘을 답변에 반드시 반영해.\n\n${scope.content}`;
      }
    } catch {
      // scope 실패 무시
    }
  }

  // 교수 퀴즈 문제 + 오답 통계 (대댓글은 4개로 축소)
  let quizContext = "";
  if (post.courseId && !post.isPrivate) {
    try {
      quizContext = await loadQuizContextForAI(post.courseId, relatedChapters, 4);
    } catch {
      // 퀴즈 로드 실패 무시
    }
  }

  const systemPrompt = post.isPrivate
    ? `너는 "${post.authorNickname || "학생"}"의 개인 학습 친구 "콩콩이"야. 이건 비공개 대화방이라 너와 이 학생만 볼 수 있어. 전체 대화 흐름을 기억하고, 가장 마지막 메시지에 이어서 답변해줘.

[핵심 원칙]
- 이 학생이 하는 모든 말을 기억해. 이전 대화에서 한 말, 별명, 요청 등을 기억하고 반영해.
- 수업 내용 질문이면 정확하고 자세하게 설명해줘.
- 수업 외 잡담이나 개인적인 대화도 자연스럽게 받아줘. 비공개 대화방이니까.
- 단, 유해하거나 위험한 내용(자해, 폭력, 불법 등)은 정중히 거절해.

[절대 금지]
- 이모지, 이모티콘, 특수 기호 문자 절대 사용 금지. 순수 텍스트만 써.
- "후배", "선배" 같은 호칭 금지.
- 과하게 유치한 표현, 과한 칭찬, 과한 감탄사 금지.

[콩콩이 말투]
- 20대 한국 여자 대학생이 같은 과 친구한테 말하듯 자연스러운 반말
- ~거든, ~지, ~잖아, ~인 듯, ~해, ~같아, ~거야 같은 구어체
- 친절하되 담백하게. 과하지 않은 톤.

[설명 방법]
- 수업 관련 질문일 때: 결론 먼저 → 왜 그런지 근거 → 어려우면 비유로 풀어줘.
- 복잡한 개념은 단계별로 쪼개서 설명하고, 헷갈리는 개념은 비교해줘.
- 중요 용어는 한글(영문) 형태로 써줘.
- 충분히 자세하게 답변해. 짧게 끊지 마.
- 설명이 길어졌으면 "정리하면:" 하고 핵심만 1~3줄로 요약해줘.
- 과목 학습 범위가 주어지면 그대로 복붙하지 말고, 대화체로 자연스럽게 녹여서 설명해.

[답변 규칙]
- 한국어로 답변해
- 이전 대화와 자연스럽게 이어가. 이미 나눈 내용은 반복하지 마.
- 학생이 너한테 별명을 지어주거나 역할을 부여하면 그에 맞게 행동해.
- 수업 관련 질문에는 정확하고 자세하게, 잡담에는 재미있게 답해줘.${courseContext}`
    : `너는 "콩콩이"라는 이름의 수업 보조 AI야. 학생들이 학술 게시판에서 질문하고 있어. 전체 대화 흐름을 이해하고, 가장 마지막 메시지에 대해 이어서 답변해줘.

[절대 금지]
- 이모지, 이모티콘, 특수 기호 문자 절대 사용 금지. 순수 텍스트만 써.
- "후배", "선배" 같은 호칭 금지. 너는 학생의 선배가 아니라 수업 보조 AI야.
- 과하게 유치한 표현, 과한 칭찬, 과한 감탄사 금지.
- 마크다운 헤딩(#, ##, ###) 사용 금지. 강조는 **볼드**만 사용.

[콩콩이 말투]
- 20대 한국 여자 대학생이 같은 과 친구한테 설명하듯 자연스러운 반말
- ~거든, ~지, ~잖아, ~인 듯, ~해, ~같아, ~거야 같은 구어체
- 친절하되 담백하게. 과하지 않은 톤.

[플랫폼 기능 질문 처리]
- 학생이 "이 앱 어떻게 써?", "배틀 어떻게 해?", "뽑기 언제 돼?", "EXP 얼마야?" 같은 앱/플랫폼 사용법 자체를 물어볼 때만 의견게시판으로 안내해.
- 안내 방법: 공감 한마디 + "이런 건 홈 탭에 있는 의견게시판에 올려보면 교수님이나 관리자가 직접 답해줄 수 있을 거야!" + 콩콩이는 수업 내용 도우미라 앱 기능은 잘 모른다고 솔직히 말해.
- 중요: "토끼", "배틀", "랭킹" 같은 단어가 포함되더라도 수업/학술 맥락의 질문이면 반드시 학술 답변을 해줘.

[설명 방법 — 이게 제일 중요해!]
- **결론 먼저**: 질문에 대한 답을 첫 1~2문장에서 바로 말해줘.
- **왜 그런지 설명**: 결론 뒤에 "왜냐면~", "이게 왜 그러냐면~" 하고 근거를 붙여.
- **단계별 분해**: 복잡한 개념은 단계별로 쪼개서 설명해.
- **비유 적극 활용**: 어려운 개념은 일상적 비유로 풀어줘.
- **헷갈리는 개념 비교**: 비슷한 용어가 있으면 차이점을 짚어줘.
- **교과서 용어 병기**: 중요한 용어는 한글(영문) 형태로 써줘.
- **마지막에 핵심 정리**: 설명이 길어졌으면 "정리하면:" 하고 핵심만 1~3줄로 요약해줘.
- **scope는 녹여쓰기**: 과목 학습 범위가 주어지면 그대로 복붙하지 말고, 대화체로 자연스럽게 녹여서 설명해.

[답변 규칙]
- 한국어로 답변해
- 충분히 자세하게 설명해. 불필요한 서론/반복은 빼되, 설명 자체는 아끼지 마.
- 이전 대화와 자연스럽게 이어가되, 이미 설명한 내용은 반복하지 마.
- 관련 개념이 있으면 "참고로~" 하고 가볍게 덧붙여줘.

[정확성 — 이건 설명 방법만큼 중요해!]
- **scope 우선**: [과목 학습 범위]에 나온 내용과 너의 일반 지식이 다르면, scope를 따라.
- **scope에 없는 내용**: 일반 지식으로 보충해도 되지만, 확신이 없으면 "이건 교수님한테 한번 확인해보는 게 좋을 것 같아!"로 안내해.
- **용어 정밀도**: 비슷한 용어 구분을 정확히 해줘. 대충 비슷한 말로 바꿔 쓰지 마.
- **학생이 틀린 전제로 질문했을 때**: "좋은 질문인데, 여기서 한 가지 짚고 가자면~" 하고 부드럽게 교정해줘.
- **인과관계 주의**: "~한다"(확정)와 "~할 수 있다"(가능성)를 구분해서 써.
- 답변 작성 후 반드시 사실 관계, 수치, 용어를 한번 더 검토해.${courseContext}${quizContext}`;

  const contextText = `[원본 게시글]
제목: ${post.title}
본문: ${post.content}
${otherCommentsContext}

[현재 대화 스레드]
${conversationHistory}`;

  // Gemini API 요청 parts 구성
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: systemPrompt + "\n\n" + contextText },
  ];

  // 원본 게시글 이미지 추가
  if (post.imageUrls && post.imageUrls.length > 0) {
    for (const imageUrl of post.imageUrls) {
      try {
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) continue;
        const buffer = await imgResponse.buffer();
        const base64 = buffer.toString("base64");
        const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
        parts.push({ inlineData: { mimeType: contentType, data: base64 } });
      } catch (imgError) {
        console.warn("게시글 이미지 fetch 실패, 스킵:", imageUrl, imgError);
      }
    }
  }

  // 대댓글에 이미지가 있으면 base64로 변환하여 추가
  if (userReply.imageUrls && userReply.imageUrls.length > 0) {
    for (const imageUrl of userReply.imageUrls) {
      try {
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) continue;
        const buffer = await imgResponse.buffer();
        const base64 = buffer.toString("base64");
        const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
        parts.push({ inlineData: { mimeType: contentType, data: base64 } });
      } catch (imgError) {
        console.warn("대댓글 이미지 fetch 실패, 스킵:", imageUrl, imgError);
      }
    }
  }

  // 비공개 콩콩이는 thinking 끄기 (비용 5배 절감)
  const thinkingBudget = post.isPrivate ? 0 : 8192;
  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.5,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: thinkingBudget + 8192,
      ...(thinkingBudget > 0 ? {
        thinkingConfig: {
          thinkingBudget,
        },
      } : {}),
    },
  };

  // Gemini 2.5 Flash API 호출
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    );
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "AbortError") {
      throw new Error("콩콩이 대댓글 요청 시간 초과 (120초)");
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("콩콩이 대댓글 API 오류:", response.status, errorText);
    throw new Error(`Gemini API 오류: ${response.status}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!aiText) {
    console.warn("콩콩이 대댓글이 비어있습니다", data);
    return;
  }

  // 콩콩이 원본 댓글 아래 대댓글로 저장
  await db.collection("comments").add({
    postId: postId,
    parentId: parentCommentId,
    authorId: "gemini-ai",
    authorNickname: "콩콩이",
    authorClassType: null,
    content: aiText.trim(),
    imageUrls: [],
    isAnonymous: false,
    isAIReply: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  // commentCount는 onCommentCreate 트리거에서 증가

  console.log(`콩콩이 대댓글 생성 완료: postId=${postId}, parentId=${parentCommentId}, thread=${threadComments.length}개`);
}

/**
 * 댓글 채택 (글 작성자만 호출 가능)
 * - 글당 1개 댓글만 채택 가능
 * - 채택 시 댓글 작성자에게 추가 EXP 지급
 */
export const acceptComment = onCall(
  {
    region: "asia-northeast3",
    secrets: [
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_SECRET,
      DEFAULT_ORG_ID_SECRET,
    ],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { postId, commentId } = request.data as {
      postId?: string;
      commentId?: string;
    };

    if (!postId || !commentId) {
      throw new HttpsError("invalid-argument", "postId와 commentId가 필요합니다.");
    }

    const uid = request.auth.uid;
    const db = getFirestore();

    // 게시글 조회 + 작성자 확인
    const postDoc = await db.collection("posts").doc(postId).get();
    if (!postDoc.exists) {
      throw new HttpsError("not-found", "게시글을 찾을 수 없습니다.");
    }
    const postData = postDoc.data()!;
    const postAuthorId = postData.authorId || postData.userId;

    if (postAuthorId !== uid) {
      throw new HttpsError("permission-denied", "글 작성자만 댓글을 채택할 수 있습니다.");
    }

    // 이미 채택된 댓글이 있는지 확인
    if (postData.acceptedCommentId) {
      throw new HttpsError("already-exists", "이미 채택된 댓글이 있습니다.");
    }

    // 댓글 조회
    const commentDoc = await db.collection("comments").doc(commentId).get();
    if (!commentDoc.exists) {
      throw new HttpsError("not-found", "댓글을 찾을 수 없습니다.");
    }
    const commentData = commentDoc.data()!;

    // 자기 댓글 채택 방지
    if (commentData.authorId === uid) {
      throw new HttpsError("invalid-argument", "본인의 댓글은 채택할 수 없습니다.");
    }

    // AI 댓글 채택 방지
    if (commentData.authorId === "gemini-ai") {
      throw new HttpsError("invalid-argument", "AI 댓글은 채택할 수 없습니다.");
    }

    // 대댓글 채택 방지 (루트 댓글만 채택 가능)
    if (commentData.parentId) {
      throw new HttpsError("invalid-argument", "대댓글은 채택할 수 없습니다.");
    }

    const commentAuthorId = commentData.authorId;
    const expReward = EXP_REWARDS.COMMENT_ACCEPTED;

    // 트랜잭션으로 채택 처리 + EXP 지급
    const acceptExpPayload = await db.runTransaction<SupabaseExpPayload>(
      async (transaction) => {
        const userDoc = await readUserForExp(transaction, commentAuthorId);

        // 게시글에 채택 댓글 ID 저장
        transaction.update(postDoc.ref, {
          acceptedCommentId: commentId,
        });

        // 댓글에 채택 표시
        transaction.update(commentDoc.ref, {
          isAccepted: true,
          acceptedAt: FieldValue.serverTimestamp(),
        });

        // 댓글 작성자에게 EXP 지급
        const { supabasePayload } = addExpInTransaction(
          transaction, commentAuthorId, expReward, "댓글 채택", userDoc, {
            type: "comment_accepted",
            sourceId: commentId,
            sourceCollection: "comments",
            metadata: { postId },
          }
        );
        return supabasePayload;
      }
    );

    flushExpSupabase(acceptExpPayload).catch((e) =>
      console.warn("[Supabase comment_accepted exp dual-write] 실패:", e)
    );

    // 댓글 작성자에게 알림
    await db.collection("notifications").add({
      userId: commentAuthorId,
      type: "COMMENT_ACCEPTED",
      title: "댓글 채택",
      message: "내 댓글이 채택되었습니다!",
      data: { postId, commentId },
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Supabase 듀얼 라이트: posts.accepted_comment_id + comments.is_accepted
    await supabaseDualAcceptComment(postId, commentId);

    console.log(`댓글 채택 완료: postId=${postId}, commentId=${commentId}, author=${commentAuthorId}`);

    return { success: true, expReward };
  }
);

// ============================================================
// 게시글 삭제 (Admin SDK로 댓글까지 원자적 삭제)
// ============================================================

/**
 * 게시글 삭제 CF
 * 클라이언트에서 댓글을 직접 삭제하면 타인 댓글에 대한 권한이 없어 실패하므로
 * Admin SDK로 글 + 모든 댓글을 서버에서 삭제
 */
export const deletePost = onCall(
  {
    region: "asia-northeast3",
    secrets: [
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_SECRET,
      DEFAULT_ORG_ID_SECRET,
    ],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { postId } = request.data as { postId: string };
    if (!postId) {
      throw new HttpsError("invalid-argument", "postId가 필요합니다.");
    }

    const db = getFirestore();
    const postRef = db.collection("posts").doc(postId);
    const postSnap = await postRef.get();

    if (!postSnap.exists) {
      throw new HttpsError("not-found", "글을 찾을 수 없습니다.");
    }

    const postData = postSnap.data()!;
    const authorId = postData.authorId || postData.userId;

    // 권한 확인: 작성자 또는 교수님
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    const isProfessor = userDoc.exists && userDoc.data()?.role === "professor";

    if (request.auth.uid !== authorId && !isProfessor) {
      throw new HttpsError("permission-denied", "삭제 권한이 없습니다.");
    }

    // 해당 글의 모든 댓글 조회
    const commentsSnap = await db
      .collection("comments")
      .where("postId", "==", postId)
      .get();

    // 글 + 댓글 배치 삭제 (500건 제한 분할)
    const allRefs = [...commentsSnap.docs.map(d => d.ref), postRef];
    for (let i = 0; i < allRefs.length; i += 500) {
      const batch = db.batch();
      allRefs.slice(i, i + 500).forEach(ref => batch.delete(ref));
      await batch.commit();
    }

    // Supabase 듀얼 삭제 (CASCADE 로 comments 자동 삭제됨)
    await supabaseDualDeletePost(postId);

    console.log(`게시글 삭제 완료: postId=${postId}, 댓글 ${commentsSnap.size}개 포함`);
    return { success: true, deletedComments: commentsSnap.size };
  }
);

/**
 * 비공개 글 스레드 삭제 (루트 댓글 + 모든 대댓글)
 * admin SDK로 콩콩이 댓글도 삭제 가능
 */
export const deleteThread = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { rootCommentId, postId } = request.data as { rootCommentId: string; postId: string };
    if (!rootCommentId || !postId) {
      throw new HttpsError("invalid-argument", "rootCommentId와 postId가 필요합니다.");
    }

    const db = getFirestore();

    // 게시글 확인: 비공개 글의 작성자만 삭제 가능
    const postSnap = await db.collection("posts").doc(postId).get();
    if (!postSnap.exists) {
      throw new HttpsError("not-found", "글을 찾을 수 없습니다.");
    }
    const postData = postSnap.data()!;
    const postAuthorId = postData.authorId || postData.userId;

    if (!postData.isPrivate) {
      throw new HttpsError("permission-denied", "비공개 글에서만 스레드 삭제가 가능합니다.");
    }
    if (request.auth.uid !== postAuthorId) {
      throw new HttpsError("permission-denied", "본인의 비공개 글에서만 삭제할 수 있습니다.");
    }

    // 루트 댓글 + 대댓글 조회
    const rootRef = db.collection("comments").doc(rootCommentId);
    const repliesSnap = await db.collection("comments")
      .where("parentId", "==", rootCommentId)
      .get();

    // 배치 삭제
    const batch = db.batch();
    repliesSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(rootRef);
    await batch.commit();

    // commentCount 감소
    const deletedCount = repliesSnap.size + 1;
    await db.collection("posts").doc(postId).update({
      commentCount: FieldValue.increment(-deletedCount),
    });

    console.log(`스레드 삭제 완료: rootCommentId=${rootCommentId}, 총 ${deletedCount}개`);
    return { success: true, deletedCount };
  }
);
