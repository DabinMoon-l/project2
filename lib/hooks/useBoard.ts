/**
 * 게시판 훅 통합 배럴 파일
 *
 * 모든 게시판 훅을 단일 경로에서 import 가능하도록 re-export.
 * 실제 구현은 도메인별 파일로 분리:
 * - useBoardPosts.ts — 게시글 목록/조회/작성/수정/삭제/고정/반별/교수전달
 * - useBoardComments.ts — 댓글 목록/작성/수정/삭제/내 댓글/채택
 * - useBoardLike.ts — 좋아요 토글 (게시글/댓글)
 * - useBoardTypes.ts — 타입 정의
 * - useBoardUtils.ts — 유틸리티 함수
 */

// 게시글 훅
export {
  usePosts,
  useMyPosts,
  usePost,
  useCreatePost,
  useUpdatePost,
  useDeletePost,
  usePinnedPosts,
  useToProfessorPosts,
  usePostsByClass,
  useAllPostsForCourse,
} from './useBoardPosts';

// 댓글 훅
export {
  useComments,
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
  useMyComments,
  useAcceptComment,
} from './useBoardComments';

// 좋아요 훅
export { useLike, useCommentLike, useMyLikedPosts } from './useBoardLike';

// 타입 및 상수 re-export
export type {
  BoardCategory,
  BoardTag,
  AttachedFile,
  Post,
  Comment,
  CreatePostData,
  CreateCommentData,
} from './useBoardTypes';
export { BOARD_TAGS } from './useBoardTypes';
