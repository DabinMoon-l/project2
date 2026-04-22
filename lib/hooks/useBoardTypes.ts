/**
 * useBoard 타입 정의
 *
 * 게시판 관련 타입, 인터페이스, 상수
 */

/** 게시판 카테고리 */
export type BoardCategory = 'toProfessor' | 'community' | 'all';

/** 게시판 태그 */
export type BoardTag = '학사' | '학술' | '기타' | '비공개';

/** 태그 목록 상수 (공개 태그만 — 비공개는 별도 토글) */
export const BOARD_TAGS: BoardTag[] = ['학사', '학술', '기타'];

/** 전체 태그 (비공개 포함) */
export const ALL_BOARD_TAGS: BoardTag[] = ['학사', '학술', '기타', '비공개'];

/** 첨부파일 정보 타입 */
export interface AttachedFile {
  name: string;
  url: string;
  type: string;
  size: number;
}

/** 게시글 데이터 타입 */
export interface Post {
  id: string;
  title: string;
  content: string;
  authorName?: string; // 실명 (교수님 화면에서 사용)
  imageUrl?: string; // 대표 이미지 (하위 호환)
  imageUrls?: string[]; // 여러 이미지
  fileUrls?: AttachedFile[]; // 첨부 파일 목록
  authorId: string;
  authorNickname: string;
  authorClassType?: 'A' | 'B' | 'C' | 'D'; // 작성자 반
  isAnonymous: boolean;
  category: BoardCategory;
  courseId?: string; // 과목 ID (과목별 분리)
  likes: number;
  likedBy: string[]; // 좋아요한 사용자 ID 배열
  commentCount: number;
  isNotice: boolean;
  createdAt: Date;
  updatedAt?: Date;
  // 고정 게시글 관련 필드
  isPinned?: boolean;
  pinnedAt?: Date;
  pinnedBy?: string;
  // 교수님께 전달 여부
  toProfessor?: boolean;
  // 조회수
  viewCount: number;
  // 태그 (학사/학술/기타)
  tag?: BoardTag;
  // 채택된 댓글 ID
  acceptedCommentId?: string;
  // 콩콩이 상세 답변 요청 여부
  aiDetailedAnswer?: boolean;
  // 챕터 태그 (예: ["1_미생물과 미생물학", "2_숙주면역반응"])
  chapterTags?: string[];
  // 비공개 글 (나만의 콩콩이)
  isPrivate?: boolean;
}

/** 댓글 데이터 타입 */
export interface Comment {
  id: string;
  postId: string;
  parentId?: string; // 대댓글인 경우 부모 댓글 ID
  authorId: string;
  authorNickname: string;
  authorClassType?: 'A' | 'B' | 'C' | 'D'; // 작성자 반
  authorRole?: 'professor' | 'student'; // 명시적 역할 (2026-04-22 추가, 과거 댓글엔 없음)
  content: string;
  imageUrls?: string[]; // 댓글 이미지
  isAnonymous: boolean;
  createdAt: Date;
  replies?: Comment[]; // 대댓글 목록 (클라이언트에서 구성)
  likes?: number; // 좋아요 수
  likedBy?: string[]; // 좋아요 누른 사용자 ID 목록
  isAIReply?: boolean; // AI 자동답변 여부
  isAccepted?: boolean; // 채택 여부
}

/** 글 작성 데이터 */
export interface CreatePostData {
  title: string;
  content: string;
  imageUrl?: string; // 대표 이미지 (하위 호환)
  imageUrls?: string[]; // 여러 이미지
  fileUrls?: AttachedFile[]; // 첨부 파일 목록
  isAnonymous: boolean;
  category: BoardCategory;
  courseId?: string; // 과목 ID (과목별 분리)
  toProfessor?: boolean; // 교수님께 전달 여부
  tag?: BoardTag; // 태그 (학사/학술/기타)
  aiDetailedAnswer?: boolean; // 콩콩이 상세 답변 요청
  chapterTags?: string[]; // 챕터 태그 (예: ["1_미생물과 미생물학"])
  isPrivate?: boolean; // 비공개 글 (나만의 콩콩이)
}

/** 댓글 작성 데이터 */
export interface CreateCommentData {
  postId: string;
  content: string;
  isAnonymous: boolean;
  parentId?: string; // 대댓글인 경우 부모 댓글 ID
  imageUrls?: string[]; // 댓글 이미지 URL
}

/** usePosts 훅 반환 타입 */
export interface UsePostsReturn {
  posts: Post[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

/** usePost 훅 반환 타입 */
export interface UsePostReturn {
  post: Post | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** useComments 훅 반환 타입 */
export interface UseCommentsReturn {
  comments: Comment[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** createPost 반환 — 생성된 postId 와 화면 즉시 렌더용 Post 객체 */
export interface CreatedPost {
  postId: string;
  post: Post;
}

/** useCreatePost 훅 반환 타입 */
export interface UseCreatePostReturn {
  createPost: (data: CreatePostData) => Promise<CreatedPost | null>;
  loading: boolean;
  error: string | null;
}

/** useUpdatePost 훅 반환 타입 */
export interface UseUpdatePostReturn {
  updatePost: (postId: string, data: Partial<CreatePostData>) => Promise<boolean>;
  loading: boolean;
  error: string | null;
}

/** useDeletePost 훅 반환 타입 */
export interface UseDeletePostReturn {
  deletePost: (postId: string) => Promise<boolean>;
  loading: boolean;
  error: string | null;
}

/** useCreateComment 훅 반환 타입 */
export interface UseCreateCommentReturn {
  createComment: (data: CreateCommentData) => Promise<string | null>;
  loading: boolean;
  error: string | null;
}

/** useDeleteComment 훅 반환 타입 */
export interface UseDeleteCommentReturn {
  deleteComment: (commentId: string, postId: string) => Promise<boolean>;
  loading: boolean;
  error: string | null;
}

/** useMyComments 훅 반환 타입 */
export interface UseMyCommentsReturn {
  comments: (Comment & { postTitle?: string })[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** useUpdateComment 훅 반환 타입 */
export interface UseUpdateCommentReturn {
  updateComment: (commentId: string, content: string, imageUrls?: string[]) => Promise<boolean>;
  loading: boolean;
  error: string | null;
}

/** useLike 훅 반환 타입 */
export interface UseLikeReturn {
  toggleLike: (postId: string) => Promise<boolean>;
  isLiked: (postId: string) => boolean;
  loading: boolean;
  error: string | null;
}

/** useMyLikedPosts 훅 반환 타입 */
export interface UseMyLikedPostsReturn {
  posts: Post[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** usePinnedPosts 훅 반환 타입 */
export interface UsePinnedPostsReturn {
  pinnedPosts: Post[];
  loading: boolean;
  error: string | null;
  pinPost: (postId: string) => Promise<boolean>;
  unpinPost: (postId: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

/** useToProfessorPosts 훅 반환 타입 */
export interface UseToProfessorPostsReturn {
  posts: Post[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** usePostsByClass 훅 반환 타입 */
export interface UsePostsByClassReturn {
  posts: Post[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
