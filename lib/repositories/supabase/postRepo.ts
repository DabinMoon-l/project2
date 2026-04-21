/**
 * Post Repository — Supabase 구현체 (Phase 2 Step 3)
 *
 * Firebase postRepo 와 **동일한 API 시그니처** 유지.
 * 반환 shape 는 Firestore 문서와 호환되도록 카멜케이스 + Timestamp-like 객체로 매핑.
 *
 * 테이블:
 *   public.posts
 *   public.comments
 *
 * 구독은 Supabase Realtime `postgres_changes` 사용:
 *   - subscribePostsFeed / subscribePost / subscribeMyPrivatePost / subscribeComments
 *   - 초기 1회 full fetch + 이후 INSERT/UPDATE/DELETE 이벤트로 메모리 상태 갱신
 *
 * 좋아요는 posts.liked_by 배열 직접 update (likes 테이블은 Firebase 전용).
 * 휴지통(feedbacks) 등은 Firebase 위임 (Phase 2 이관 제외).
 */

import { getSupabaseClient } from '@/lib/clients/supabase';
import type { Unsubscribe, ErrorCallback } from '../types';
import type {
  PostDoc,
  CommentDoc,
  PostPageCursor,
  PostPageResult,
  PostFeedFilters,
} from '../firebase/postRepo';
import * as firebasePostRepo from '../firebase/postRepo';

const DEFAULT_ORG_ID = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID || '';

// ============================================================
// 공통 타입 재export (Firebase 와 동일 시그니처)
// ============================================================

export type {
  PostDoc,
  CommentDoc,
  PostPageCursor,
  PostPageResult,
  PostFeedFilters,
} from '../firebase/postRepo';

// ============================================================
// course UUID ↔ code 양방향 캐시
// ============================================================

const _courseUuidCache = new Map<string, string>();
const _uuidToCodeCache = new Map<string, string>();

async function buildCourseCaches(): Promise<void> {
  if (_courseUuidCache.size > 0) return;
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return;
  const { data } = await supabase
    .from('courses')
    .select('id, code')
    .eq('org_id', DEFAULT_ORG_ID);
  for (const row of (data as Array<{ id: string; code: string }> | null) || []) {
    _courseUuidCache.set(row.code, row.id);
    _uuidToCodeCache.set(row.id, row.code);
  }
}

async function resolveCourseUuid(courseCode: string): Promise<string | null> {
  await buildCourseCaches();
  return _courseUuidCache.get(courseCode) || null;
}

// ============================================================
// Row → Firestore 호환 doc 변환
// ============================================================

interface PostRow {
  id: string;
  org_id: string;
  course_id: string | null;
  author_id: string;
  author_nickname: string | null;
  author_class_type: string | null;
  title: string;
  content: string;
  category: string | null;
  tag: string | null;
  chapter_tags: string[];
  is_anonymous: boolean;
  is_notice: boolean;
  is_private: boolean;
  to_professor: boolean;
  image_url: string | null;
  image_urls: string[];
  file_urls: string[];
  ai_detailed_answer: string | null;
  likes: number;
  like_count: number;
  liked_by: string[];
  comment_count: number;
  view_count: number;
  accepted_comment_id: string | null;
  rewarded: boolean;
  rewarded_at: string | null;
  exp_rewarded: number | null;
  metadata: Record<string, unknown> | null;
  source_firestore_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CommentRow {
  id: string;
  org_id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  author_nickname: string | null;
  author_class_type: string | null;
  content: string;
  image_urls: string[];
  is_anonymous: boolean;
  is_ai_reply: boolean;
  is_accepted: boolean;
  accepted_at: string | null;
  likes: number;
  like_count: number;
  liked_by: string[];
  rewarded: boolean;
  rewarded_at: string | null;
  exp_rewarded: number | null;
  metadata: Record<string, unknown> | null;
  source_firestore_id: string | null;
  created_at: string;
  updated_at: string;
}

function tsLike(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  const ms = d.getTime();
  return {
    toDate: () => d,
    toMillis: () => ms,
    _seconds: Math.floor(ms / 1000),
  };
}

function postRowToDoc(row: PostRow): PostDoc {
  const courseCode = row.course_id ? _uuidToCodeCache.get(row.course_id) || null : null;
  const metadata = row.metadata || {};
  // 클라이언트는 Firestore post id 를 기대 — source_firestore_id 가 있으면 그걸 반환
  const clientId = row.source_firestore_id || row.id;

  return {
    id: clientId,
    authorId: row.author_id,
    authorNickname: row.author_nickname,
    authorClassType: row.author_class_type,
    title: row.title,
    content: row.content,
    category: row.category,
    tag: row.tag,
    chapterTags: row.chapter_tags,
    isAnonymous: row.is_anonymous,
    isNotice: row.is_notice,
    isPrivate: row.is_private,
    toProfessor: row.to_professor,
    imageUrl: row.image_url,
    imageUrls: row.image_urls,
    fileUrls: row.file_urls,
    aiDetailedAnswer: row.ai_detailed_answer,
    likes: row.likes,
    likeCount: row.like_count,
    likedBy: row.liked_by,
    commentCount: row.comment_count,
    viewCount: row.view_count,
    // metadata.acceptedCommentId 에 Firestore comment id 원본이 있으면 그걸 반환
    acceptedCommentId: (metadata.acceptedCommentId as string | undefined) ?? row.accepted_comment_id ?? null,
    isPinned: (metadata.isPinned as boolean | undefined) ?? false,
    pinnedAt: metadata.pinnedAt ? tsLike(metadata.pinnedAt as string) : null,
    pinnedBy: (metadata.pinnedBy as string | undefined) ?? null,
    courseId: courseCode,
    rewarded: row.rewarded,
    rewardedAt: tsLike(row.rewarded_at),
    expRewarded: row.exp_rewarded,
    createdAt: tsLike(row.created_at),
    updatedAt: tsLike(row.updated_at),
  };
}

function commentRowToDoc(row: CommentRow, postFirestoreIdMap?: Map<string, string>): CommentDoc {
  // post_id(uuid) → Firestore post id 매핑. postRowToDoc 이 로드된 상태가 아니면 uuid 그대로.
  const postFirestoreId = postFirestoreIdMap?.get(row.post_id) || row.post_id;
  return {
    id: row.source_firestore_id || row.id,
    postId: postFirestoreId,
    parentId: row.parent_id || undefined,
    authorId: row.author_id,
    authorNickname: row.author_nickname,
    authorClassType: row.author_class_type,
    content: row.content,
    imageUrls: row.image_urls,
    isAnonymous: row.is_anonymous,
    isAIReply: row.is_ai_reply,
    isAccepted: row.is_accepted,
    acceptedAt: tsLike(row.accepted_at),
    likes: row.likes,
    likeCount: row.like_count,
    likedBy: row.liked_by,
    rewarded: row.rewarded,
    rewardedAt: tsLike(row.rewarded_at),
    expRewarded: row.exp_rewarded,
    createdAt: tsLike(row.created_at),
    updatedAt: tsLike(row.updated_at),
  };
}

// ============================================================
// Firestore post id → Supabase uuid 캐시 (단건 조회용)
// ============================================================

const _postUuidCache = new Map<string, string>();

async function resolvePostUuid(firestoreId: string): Promise<string | null> {
  const cached = _postUuidCache.get(firestoreId);
  if (cached) return cached;
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from('posts')
    .select('id')
    .eq('source_firestore_id', firestoreId)
    .maybeSingle();
  const uuid = (data as { id?: string } | null)?.id || null;
  if (uuid) _postUuidCache.set(firestoreId, uuid);
  return uuid;
}

// ============================================================
// 필터 쿼리 빌더
// ============================================================

function buildFilterQuery<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  filters: PostFeedFilters,
  courseUuid: string | null,
): T {
  if (courseUuid) query = query.eq('course_id', courseUuid);
  if (filters.category && filters.category !== 'all') {
    query = query.eq('category', filters.category);
  }
  if (filters.authorId) query = query.eq('author_id', filters.authorId);
  if (filters.toProfessor !== undefined) query = query.eq('to_professor', filters.toProfessor);
  if (filters.isPrivate !== undefined) query = query.eq('is_private', filters.isPrivate);
  if (filters.authorClassType) query = query.eq('author_class_type', filters.authorClassType);
  // isPinned 은 Supabase 스키마의 최상위 컬럼이 없음 — metadata 에 저장됨
  if (filters.isPinned !== undefined) {
    query = query.eq('metadata->>isPinned', String(filters.isPinned));
  }
  return query as T;
}

// ============================================================
// 게시글 — 실시간 구독
// ============================================================

/**
 * 공지+일반 통합 피드 실시간 구독.
 * 초기 1회 full fetch + Realtime INSERT/UPDATE/DELETE 로 증분 갱신.
 */
export function subscribePostsFeed(
  filters: PostFeedFilters,
  listLimit: number,
  callback: (posts: PostDoc[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  let cancelled = false;
  let cache: PostRow[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let channel: any = null;

  const emit = () => {
    if (cancelled) return;
    // created_at desc 정렬 후 limit
    const sorted = [...cache].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    callback(sorted.slice(0, listLimit).map(postRowToDoc));
  };

  const init = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase || !DEFAULT_ORG_ID) {
        if (!cancelled) callback([]);
        return;
      }
      await buildCourseCaches();

      const courseUuid = filters.courseId ? await resolveCourseUuid(filters.courseId) : null;
      if (filters.courseId && !courseUuid) {
        if (!cancelled) callback([]);
        return;
      }

      let query = supabase
        .from('posts')
        .select('*')
        .eq('org_id', DEFAULT_ORG_ID);

      query = buildFilterQuery(query, filters, courseUuid);
      query = query.order('created_at', { ascending: false }).limit(listLimit);

      const { data, error } = await query;
      if (error) {
        if (!cancelled && onError) onError(error as unknown as Error);
        return;
      }
      if (cancelled) return;

      cache = (data as PostRow[] | null) || [];
      emit();

      // Realtime 구독 — 같은 org_id 안의 모든 posts 변경 수신, 클라이언트에서 필터
      channel = supabase
        .channel(`posts-feed-${Math.random().toString(36).slice(2)}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, (payload: any) => {
          if (cancelled) return;
          const newRow = payload.new as PostRow | undefined;
          const oldRow = payload.old as PostRow | undefined;

          // org 필터
          if (payload.eventType !== 'DELETE' && newRow?.org_id !== DEFAULT_ORG_ID) return;

          const matchesFilters = (row: PostRow): boolean => {
            if (row.org_id !== DEFAULT_ORG_ID) return false;
            if (courseUuid && row.course_id !== courseUuid) return false;
            if (filters.category && filters.category !== 'all' && row.category !== filters.category) return false;
            if (filters.authorId && row.author_id !== filters.authorId) return false;
            if (filters.toProfessor !== undefined && row.to_professor !== filters.toProfessor) return false;
            if (filters.isPrivate !== undefined && row.is_private !== filters.isPrivate) return false;
            if (filters.authorClassType && row.author_class_type !== filters.authorClassType) return false;
            if (filters.isPinned !== undefined) {
              const pinned = (row.metadata?.isPinned as boolean | undefined) ?? false;
              if (pinned !== filters.isPinned) return false;
            }
            return true;
          };

          if (payload.eventType === 'INSERT' && newRow && matchesFilters(newRow)) {
            cache = [newRow, ...cache.filter((r) => r.id !== newRow.id)];
          } else if (payload.eventType === 'UPDATE' && newRow) {
            if (matchesFilters(newRow)) {
              cache = cache.map((r) => (r.id === newRow.id ? newRow : r));
              if (!cache.find((r) => r.id === newRow.id)) cache.push(newRow);
            } else {
              cache = cache.filter((r) => r.id !== newRow.id);
            }
          } else if (payload.eventType === 'DELETE' && oldRow) {
            cache = cache.filter((r) => r.id !== oldRow.id);
          }
          emit();
        })
        .subscribe();
    } catch (err) {
      if (!cancelled && onError) onError(err as Error);
    }
  };

  init();

  return () => {
    cancelled = true;
    if (channel) {
      const supabase = getSupabaseClient();
      if (supabase) supabase.removeChannel(channel);
    }
  };
}

/** 단일 게시글 실시간 구독 (source_firestore_id 기준). */
export function subscribePost(
  postId: string,
  callback: (post: PostDoc | null) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  let cancelled = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let channel: any = null;

  const init = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        if (!cancelled) callback(null);
        return;
      }
      const uuid = await resolvePostUuid(postId);
      if (!uuid) {
        if (!cancelled) callback(null);
        return;
      }
      await buildCourseCaches();

      // 초기 fetch
      const { data } = await supabase
        .from('posts')
        .select('*')
        .eq('id', uuid)
        .maybeSingle();
      if (cancelled) return;
      callback(data ? postRowToDoc(data as PostRow) : null);

      // Realtime 단건 구독
      channel = supabase
        .channel(`post-${uuid}-${Math.random().toString(36).slice(2)}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'posts', filter: `id=eq.${uuid}` },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (cancelled) return;
            if (payload.eventType === 'DELETE') {
              callback(null);
            } else if (payload.new) {
              callback(postRowToDoc(payload.new as PostRow));
            }
          },
        )
        .subscribe();
    } catch (err) {
      if (!cancelled && onError) onError(err as Error);
    }
  };

  init();

  return () => {
    cancelled = true;
    if (channel) {
      const supabase = getSupabaseClient();
      if (supabase) supabase.removeChannel(channel);
    }
  };
}

export function subscribeMyPrivatePost(
  userId: string,
  callback: (post: PostDoc | null) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  let cancelled = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let channel: any = null;

  const init = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase || !DEFAULT_ORG_ID) {
        if (!cancelled) callback(null);
        return;
      }
      await buildCourseCaches();

      const fetchOnce = async () => {
        const { data } = await supabase
          .from('posts')
          .select('*')
          .eq('org_id', DEFAULT_ORG_ID)
          .eq('author_id', userId)
          .eq('is_private', true)
          .limit(1);
        const row = (data as PostRow[] | null)?.[0] || null;
        if (!cancelled) callback(row ? postRowToDoc(row) : null);
      };

      await fetchOnce();

      channel = supabase
        .channel(`my-private-${userId}-${Math.random().toString(36).slice(2)}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .on('postgres_changes', { event: '*', schema: 'public', table: 'posts', filter: `author_id=eq.${userId}` }, async () => {
          if (cancelled) return;
          await fetchOnce();
        })
        .subscribe();
    } catch (err) {
      if (!cancelled && onError) onError(err as Error);
    }
  };

  init();

  return () => {
    cancelled = true;
    if (channel) {
      const supabase = getSupabaseClient();
      if (supabase) supabase.removeChannel(channel);
    }
  };
}

// ============================================================
// 게시글 — 일회성 조회
// ============================================================

export async function getPost(postId: string): Promise<PostDoc | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  await buildCourseCaches();

  const uuid = await resolvePostUuid(postId);
  if (!uuid) return null;

  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('id', uuid)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;
  return postRowToDoc(data as PostRow);
}

export async function hasPrivatePost(userId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return false;

  const { data } = await supabase
    .from('posts')
    .select('id')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('author_id', userId)
    .eq('is_private', true)
    .limit(1);
  return ((data as { id: string }[] | null) || []).length > 0;
}

export async function fetchMyPostsPage(
  userId: string,
  pageSize: number,
  cursor?: PostPageCursor | null,
): Promise<PostPageResult> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) {
    return { items: [], hasMore: false, nextCursor: null };
  }
  await buildCourseCaches();

  // Supabase 커서는 { createdAt, id } opaque — Firebase 의 __firestoreCursor 와 호환 안 돼도
  // 내부적으로만 사용되므로 타입 단언으로 전달받는다.
  const supaCursor = cursor as unknown as { __supabaseCursor?: { createdAt: string; id: string } } | null;

  let query = supabase
    .from('posts')
    .select('*')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('author_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1);

  if (supaCursor?.__supabaseCursor) {
    const { createdAt, id } = supaCursor.__supabaseCursor;
    query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data as PostRow[] | null) || [];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const items = pageRows.map(postRowToDoc);
  const lastRow = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;

  return {
    items,
    hasMore,
    nextCursor: lastRow
      ? ({ __supabaseCursor: { createdAt: lastRow.created_at, id: lastRow.id } } as unknown as PostPageCursor)
      : null,
  };
}

export async function fetchLikedPostsByUser(
  userId: string,
  listLimit = 30,
): Promise<PostDoc[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return [];
  await buildCourseCaches();

  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('org_id', DEFAULT_ORG_ID)
    .contains('liked_by', [userId])
    .limit(listLimit);
  if (error) throw error;
  return ((data as PostRow[] | null) || []).map(postRowToDoc);
}

export async function fetchPostsByClass(
  courseId: string | null | undefined,
  classType: 'A' | 'B' | 'C' | 'D' | null | undefined,
  listLimit = 50,
): Promise<PostDoc[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return [];
  await buildCourseCaches();

  let query = supabase
    .from('posts')
    .select('*')
    .eq('org_id', DEFAULT_ORG_ID)
    .order('created_at', { ascending: false })
    .limit(listLimit);
  if (courseId) {
    const uuid = await resolveCourseUuid(courseId);
    if (uuid) query = query.eq('course_id', uuid);
  }
  if (classType) query = query.eq('author_class_type', classType);

  const { data, error } = await query;
  if (error) throw error;
  return ((data as PostRow[] | null) || []).map(postRowToDoc);
}

export async function fetchAllPostsForCourse(
  courseId: string,
  listLimit = 200,
): Promise<PostDoc[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return [];
  await buildCourseCaches();
  const uuid = await resolveCourseUuid(courseId);
  if (!uuid) return [];

  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('course_id', uuid)
    .order('created_at', { ascending: false })
    .limit(listLimit);
  if (error) throw error;
  return ((data as PostRow[] | null) || []).map(postRowToDoc);
}

// ============================================================
// 게시글 — CRUD (Firestore 가 여전히 primary 이므로 직접 insert 대신 위임하는 방식)
//
// 현 단계(Phase 2 Step 3): Firestore 에 쓰면 CF 트리거가 Supabase 에 동기.
// 플래그 on 이어도 "쓰기 경로는 Firebase 를 통과하는 게 안전" — CF 로직(EXP/AI)이
// Firestore 트리거에 묶여있어서 Supabase 에 직접 insert 하면 그게 실행 안 됨.
//
// 따라서 create/update/delete/like 는 Firebase repo 위임.
// ============================================================

export const createPost = firebasePostRepo.createPost;
export const updatePost = firebasePostRepo.updatePost;
export const incrementPostView = firebasePostRepo.incrementPostView;
export const pinPost = firebasePostRepo.pinPost;
export const unpinPost = firebasePostRepo.unpinPost;

// ============================================================
// 댓글 — 실시간 구독
// ============================================================

export function subscribeComments(
  postId: string,
  callback: (comments: CommentDoc[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  let cancelled = false;
  let cache: CommentRow[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let channel: any = null;
  let postUuid: string | null = null;
  // post uuid → firestore id 매핑 1건 (comments.postId 복원용)
  const postIdMap = new Map<string, string>();

  const emit = () => {
    if (cancelled) return;
    const sorted = [...cache].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    callback(sorted.map((r) => commentRowToDoc(r, postIdMap)));
  };

  const init = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        if (!cancelled) callback([]);
        return;
      }
      postUuid = await resolvePostUuid(postId);
      if (!postUuid) {
        if (!cancelled) callback([]);
        return;
      }
      postIdMap.set(postUuid, postId);

      const { data, error } = await supabase
        .from('comments')
        .select('*')
        .eq('post_id', postUuid)
        .order('created_at', { ascending: true });
      if (error) {
        if (!cancelled && onError) onError(error as unknown as Error);
        return;
      }
      if (cancelled) return;
      cache = (data as CommentRow[] | null) || [];
      emit();

      channel = supabase
        .channel(`comments-${postUuid}-${Math.random().toString(36).slice(2)}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'comments', filter: `post_id=eq.${postUuid}` },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (cancelled) return;
            const newRow = payload.new as CommentRow | undefined;
            const oldRow = payload.old as CommentRow | undefined;

            if (payload.eventType === 'INSERT' && newRow) {
              cache = [...cache.filter((r) => r.id !== newRow.id), newRow];
            } else if (payload.eventType === 'UPDATE' && newRow) {
              cache = cache.map((r) => (r.id === newRow.id ? newRow : r));
              if (!cache.find((r) => r.id === newRow.id)) cache.push(newRow);
            } else if (payload.eventType === 'DELETE' && oldRow) {
              cache = cache.filter((r) => r.id !== oldRow.id);
            }
            emit();
          },
        )
        .subscribe();
    } catch (err) {
      if (!cancelled && onError) onError(err as Error);
    }
  };

  init();

  return () => {
    cancelled = true;
    if (channel) {
      const supabase = getSupabaseClient();
      if (supabase) supabase.removeChannel(channel);
    }
  };
}

// ============================================================
// 댓글 — 일회성 조회
// ============================================================

export async function getComment(commentId: string): Promise<CommentDoc | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('comments')
    .select('*, post:posts!inner(source_firestore_id)')
    .eq('source_firestore_id', commentId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;

  const row = data as CommentRow & { post?: { source_firestore_id: string | null } };
  const postIdMap = new Map<string, string>();
  if (row.post?.source_firestore_id) {
    postIdMap.set(row.post_id, row.post.source_firestore_id);
  }
  return commentRowToDoc(row as CommentRow, postIdMap);
}

export async function fetchCommentsByPost(postId: string): Promise<CommentDoc[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const uuid = await resolvePostUuid(postId);
  if (!uuid) return [];

  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('post_id', uuid)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const postIdMap = new Map<string, string>();
  postIdMap.set(uuid, postId);
  return ((data as CommentRow[] | null) || []).map((r) => commentRowToDoc(r, postIdMap));
}

export async function fetchCommentsByAuthor(
  userId: string,
  listLimit = 50,
): Promise<CommentDoc[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return [];

  const { data, error } = await supabase
    .from('comments')
    .select('*, post:posts!inner(source_firestore_id)')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('author_id', userId)
    .limit(listLimit);
  if (error) throw error;

  const rows = (data as Array<CommentRow & { post?: { source_firestore_id: string | null } }> | null) || [];
  const postIdMap = new Map<string, string>();
  for (const row of rows) {
    if (row.post?.source_firestore_id) {
      postIdMap.set(row.post_id, row.post.source_firestore_id);
    }
  }
  return rows.map((r) => commentRowToDoc(r, postIdMap));
}

export async function fetchCommentsByPostIds(postIds: string[]): Promise<CommentDoc[]> {
  if (postIds.length === 0) return [];
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  // Firestore post ids → Supabase uuid 매핑
  const uuidToFsId = new Map<string, string>();
  const uuids: string[] = [];
  for (const fsId of postIds) {
    const uuid = await resolvePostUuid(fsId);
    if (uuid) {
      uuids.push(uuid);
      uuidToFsId.set(uuid, fsId);
    }
  }
  if (uuids.length === 0) return [];

  // IN 쿼리 (Supabase 는 제한 없음 — 안전 마진 500)
  const results: CommentRow[] = [];
  for (let i = 0; i < uuids.length; i += 500) {
    const chunk = uuids.slice(i, i + 500);
    const { data, error } = await supabase
      .from('comments')
      .select('*')
      .in('post_id', chunk);
    if (error) throw error;
    results.push(...((data as CommentRow[] | null) || []));
  }
  return results.map((r) => commentRowToDoc(r, uuidToFsId));
}

// ============================================================
// 댓글 — CRUD (Firebase 위임)
// ============================================================

export const createComment = firebasePostRepo.createComment;
export const updateComment = firebasePostRepo.updateComment;
export const deleteComment = firebasePostRepo.deleteComment;

// ============================================================
// 좋아요 (Firebase 위임 — likes 컬렉션은 Firebase 전용)
// ============================================================

export const togglePostLike = firebasePostRepo.togglePostLike;
export const toggleCommentLike = firebasePostRepo.toggleCommentLike;

// ============================================================
// 피드백
// ============================================================

export const addFeedback = firebasePostRepo.addFeedback;
