/**
 * Post Repository — Firestore 구현체
 *
 * posts, comments, feedbacks, likes 컬렉션 접근을 추상화.
 * 실시간 구독(subscribe*) 은 onSnapshot 래핑.
 * 페이지 커서는 opaque 타입(PostPageCursor) — 내부에 Firestore QueryDocumentSnapshot 보관.
 */

import {
  doc,
  collection,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit as fsLimit,
  startAfter,
  serverTimestamp,
  increment,
  deleteField,
  db,
  type QueryDocumentSnapshot,
  type QueryConstraint,
  type DocumentData,
} from './firestoreBase';
import type { Unsubscribe, ErrorCallback } from '../types';

// ============================================================
// 공통 타입
// ============================================================

export interface PostDoc {
  id: string;
  [key: string]: unknown;
}

export interface CommentDoc {
  id: string;
  [key: string]: unknown;
}

export interface PostPageCursor {
  readonly __firestoreCursor: QueryDocumentSnapshot<DocumentData>;
}

export interface PostPageResult {
  items: PostDoc[];
  hasMore: boolean;
  nextCursor: PostPageCursor | null;
}

export interface PostFeedFilters {
  courseId?: string | null;
  category?: string | null;
  authorId?: string | null;
  toProfessor?: boolean;
  isPinned?: boolean;
  isPrivate?: boolean;
  authorClassType?: 'A' | 'B' | 'C' | 'D' | null;
}

// ============================================================
// 게시글 — 실시간 구독
// ============================================================

/**
 * 공지+일반 통합 피드 실시간 구독.
 *
 * `listLimit` 은 onSnapshot 내부 limit.
 * 콜백에서 공지/일반 분리는 호출측 책임 (isNotice 플래그).
 */
export function subscribePostsFeed(
  filters: PostFeedFilters,
  listLimit: number,
  callback: (posts: PostDoc[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const constraints: QueryConstraint[] = [];
  if (filters.courseId) constraints.push(where('courseId', '==', filters.courseId));
  if (filters.category && filters.category !== 'all') {
    constraints.push(where('category', '==', filters.category));
  }
  if (filters.authorId) constraints.push(where('authorId', '==', filters.authorId));
  if (filters.toProfessor !== undefined) constraints.push(where('toProfessor', '==', filters.toProfessor));
  if (filters.isPinned !== undefined) constraints.push(where('isPinned', '==', filters.isPinned));
  if (filters.isPrivate !== undefined) constraints.push(where('isPrivate', '==', filters.isPrivate));
  if (filters.authorClassType) constraints.push(where('authorClassType', '==', filters.authorClassType));

  constraints.push(orderBy('createdAt', 'desc'));
  constraints.push(fsLimit(listLimit));

  const q = query(collection(db, 'posts'), ...constraints);
  return onSnapshot(
    q,
    (snapshot) => {
      const posts: PostDoc[] = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(posts);
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

/** 단일 게시글 실시간 구독 */
export function subscribePost(
  postId: string,
  callback: (post: PostDoc | null) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const ref = doc(db, 'posts', postId);
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        callback({ id: snap.id, ...snap.data() });
      } else {
        callback(null);
      }
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

/** 내 비공개 글 (1개) 실시간 구독 */
export function subscribeMyPrivatePost(
  userId: string,
  callback: (post: PostDoc | null) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const q = query(
    collection(db, 'posts'),
    where('authorId', '==', userId),
    where('isPrivate', '==', true),
    fsLimit(1),
  );
  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty) callback(null);
      else {
        const d = snapshot.docs[0];
        callback({ id: d.id, ...d.data() });
      }
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

// ============================================================
// 게시글 — 일회성 조회 + 페이지네이션
// ============================================================

/** 단건 조회 */
export async function getPost(postId: string): Promise<PostDoc | null> {
  const snap = await getDoc(doc(db, 'posts', postId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/** 비공개 글 존재 여부 (중복 체크용) */
export async function hasPrivatePost(userId: string): Promise<boolean> {
  const q = query(
    collection(db, 'posts'),
    where('authorId', '==', userId),
    where('isPrivate', '==', true),
    fsLimit(1),
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

/** 내 글 페이지네이션 */
export async function fetchMyPostsPage(
  userId: string,
  pageSize: number,
  cursor?: PostPageCursor | null,
): Promise<PostPageResult> {
  const constraints: QueryConstraint[] = [
    where('authorId', '==', userId),
    orderBy('createdAt', 'desc'),
  ];
  if (cursor) constraints.push(startAfter(cursor.__firestoreCursor));
  constraints.push(fsLimit(pageSize + 1));

  const q = query(collection(db, 'posts'), ...constraints);
  const snap = await getDocs(q);
  const docs = snap.docs;
  const hasMore = docs.length > pageSize;
  const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;
  const items: PostDoc[] = pageDocs.map((d) => ({ id: d.id, ...d.data() }));
  const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
  return {
    items,
    hasMore,
    nextCursor: lastDoc ? { __firestoreCursor: lastDoc } : null,
  };
}

/** 내가 좋아요한 글 조회 (array-contains) */
export async function fetchLikedPostsByUser(
  userId: string,
  listLimit = 30,
): Promise<PostDoc[]> {
  const q = query(
    collection(db, 'posts'),
    where('likedBy', 'array-contains', userId),
    fsLimit(listLimit),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** 반별 게시글 일회성 조회 */
export async function fetchPostsByClass(
  courseId: string | null | undefined,
  classType: 'A' | 'B' | 'C' | 'D' | null | undefined,
  listLimit = 50,
): Promise<PostDoc[]> {
  const constraints: QueryConstraint[] = [];
  if (courseId) constraints.push(where('courseId', '==', courseId));
  if (classType) constraints.push(where('authorClassType', '==', classType));
  constraints.push(orderBy('createdAt', 'desc'));
  constraints.push(fsLimit(listLimit));

  const q = query(collection(db, 'posts'), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** 과목 전체 게시글 일회성 조회 (교수 대시보드) */
export async function fetchAllPostsForCourse(
  courseId: string,
  listLimit = 200,
): Promise<PostDoc[]> {
  const q = query(
    collection(db, 'posts'),
    where('courseId', '==', courseId),
    orderBy('createdAt', 'desc'),
    fsLimit(listLimit),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ============================================================
// 게시글 — CRUD
// ============================================================

/** 게시글 생성 */
export async function createPost(data: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, 'posts'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** 게시글 업데이트 */
export async function updatePost(postId: string, data: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, 'posts', postId), data as Partial<DocumentData>);
}

/** 게시글 조회수 증가 */
export async function incrementPostView(postId: string): Promise<void> {
  await updateDoc(doc(db, 'posts', postId), { viewCount: increment(1) } as Partial<DocumentData>);
}

/** 게시글 고정 (교수) */
export async function pinPost(postId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, 'posts', postId), {
    isPinned: true,
    pinnedAt: serverTimestamp(),
    pinnedBy: userId,
  });
}

/** 게시글 고정 해제 (교수) */
export async function unpinPost(postId: string): Promise<void> {
  await updateDoc(doc(db, 'posts', postId), {
    isPinned: false,
    pinnedAt: deleteField(),
    pinnedBy: deleteField(),
  });
}

// ============================================================
// 댓글 — 실시간 구독
// ============================================================

export function subscribeComments(
  postId: string,
  callback: (comments: CommentDoc[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const q = query(
    collection(db, 'comments'),
    where('postId', '==', postId),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: CommentDoc[] = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(items);
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

// ============================================================
// 댓글 — 조회
// ============================================================

/** 단건 조회 */
export async function getComment(commentId: string): Promise<CommentDoc | null> {
  const snap = await getDoc(doc(db, 'comments', commentId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/** postId 하나의 댓글 일회성 조회 */
export async function fetchCommentsByPost(postId: string): Promise<CommentDoc[]> {
  const q = query(
    collection(db, 'comments'),
    where('postId', '==', postId),
    orderBy('createdAt', 'asc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** 유저가 쓴 댓글 조회 */
export async function fetchCommentsByAuthor(
  userId: string,
  listLimit = 50,
): Promise<CommentDoc[]> {
  const q = query(
    collection(db, 'comments'),
    where('authorId', '==', userId),
    fsLimit(listLimit),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** 여러 postId 의 댓글 일괄 조회 (in 30개씩 배치) */
export async function fetchCommentsByPostIds(postIds: string[]): Promise<CommentDoc[]> {
  if (postIds.length === 0) return [];
  const batches: Promise<CommentDoc[]>[] = [];
  for (let i = 0; i < postIds.length; i += 30) {
    const batch = postIds.slice(i, i + 30);
    const q = query(collection(db, 'comments'), where('postId', 'in', batch));
    batches.push(getDocs(q).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }
  const results = await Promise.all(batches);
  return results.flat();
}

// ============================================================
// 댓글 — CRUD
// ============================================================

/** 댓글 생성 */
export async function createComment(data: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, 'comments'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** 댓글 업데이트 */
export async function updateComment(commentId: string, data: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, 'comments', commentId), data as Partial<DocumentData>);
}

/** 댓글 삭제 */
export async function deleteComment(commentId: string): Promise<void> {
  await deleteDoc(doc(db, 'comments', commentId));
}

// ============================================================
// 좋아요 (likes 컬렉션)
// ============================================================

/**
 * 게시글 좋아요 토글.
 *
 * @returns 'liked' | 'unliked' (결과 상태)
 */
export async function togglePostLike(
  postId: string,
  userId: string,
): Promise<'liked' | 'unliked'> {
  const likeDocId = `${userId}_post_${postId}`;
  const likeRef = doc(db, 'likes', likeDocId);
  const likeSnap = await getDoc(likeRef);

  if (likeSnap.exists()) {
    await deleteDoc(likeRef);
    return 'unliked';
  }
  const postSnap = await getDoc(doc(db, 'posts', postId));
  const postData = postSnap.data();
  const postAuthorId = (postData?.authorId as string | undefined) || (postData?.userId as string | undefined) || '';
  await setDoc(likeRef, {
    userId,
    targetType: 'post',
    targetId: postId,
    targetUserId: postAuthorId,
    createdAt: serverTimestamp(),
  });
  return 'liked';
}

/**
 * 댓글 좋아요 토글.
 *
 * @returns 'liked' | 'unliked'
 */
export async function toggleCommentLike(
  commentId: string,
  userId: string,
): Promise<'liked' | 'unliked'> {
  const likeDocId = `${userId}_comment_${commentId}`;
  const likeRef = doc(db, 'likes', likeDocId);
  const likeSnap = await getDoc(likeRef);

  if (likeSnap.exists()) {
    await deleteDoc(likeRef);
    return 'unliked';
  }
  const commentSnap = await getDoc(doc(db, 'comments', commentId));
  const commentData = commentSnap.data();
  const commentAuthorId = (commentData?.authorId as string | undefined) || (commentData?.userId as string | undefined) || '';
  await setDoc(likeRef, {
    userId,
    targetType: 'comment',
    targetId: commentId,
    targetUserId: commentAuthorId,
    createdAt: serverTimestamp(),
  });
  return 'liked';
}

// ============================================================
// 피드백
// ============================================================

/** 피드백 추가 */
export async function addFeedback(data: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, 'feedbacks'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
