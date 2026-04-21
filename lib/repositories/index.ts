/**
 * Repository DI 컨테이너
 *
 * Supabase 마이그레이션 시 이 파일의 import 경로만 교체하면 됩니다.
 * 예: './firebase/userRepo' → './supabase/userRepo'
 */

// 공통 타입
export type {
  Unsubscribe,
  SubscribeCallback,
  ErrorCallback,
  DocConvertOptions,
  PageCursor,
  PaginatedResult,
  SortDirection,
  FilterOp,
  QueryFilter,
  QueryOrder,
} from './types';

// Firestore 베이스 유틸리티 (점진적 마이그레이션용)
export {
  timestampToDate,
  docToObject,
  docsToArray,
  docRef,
  collectionRef,
  getDocument,
  getDocumentRaw,
  documentExists,
  setDocument,
  updateDocument,
  deleteDocument,
  addDocument,
  queryDocuments,
  subscribeDocument,
  subscribeQuery,
  createBatch,
  // 필드 값 헬퍼
  serverTimestamp,
  increment,
  arrayUnion,
  arrayRemove,
  deleteField,
  documentId,
  Timestamp,
  // Raw Firestore (복잡한 쿼리 — 점진적 전환용)
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  writeBatch,
  db,
  // 타입 re-export
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type DocumentData,
  type DocumentReference,
  type CollectionReference,
  type WriteBatch,
} from './firebase/firestoreBase';

// 도메인 Repository
export * as userRepo from './firebase/userRepo';
export * as settingsRepo from './firebase/settingsRepo';
export * as announcementRepo from './firebase/announcementRepo';
export * as battleRepo from './firebase/battleRepo';
export * as storageRepo from './firebase/storageRepo';

// postRepo 타입 re-export
export type {
  PostDoc,
  CommentDoc,
  PostPageCursor,
  PostPageResult,
  PostFeedFilters,
} from './firebase/postRepo';

// quizRepo 타입 re-export
export type {
  QuizDoc,
  QuizResultDoc,
  QuizCompletionDoc,
  FeedbackDoc,
  QuizPageCursor,
  QuizPageResult,
  QuizFeedFilters,
} from './firebase/quizRepo';

// Enrollment Repo — Feature flag 기반 분기 (Phase 2 Step 3)
// NEXT_PUBLIC_USE_SUPABASE_ENROLLMENT=true → Supabase, 아니면 Firestore
import * as firebaseEnrollmentRepo from './firebase/enrollmentRepo';
import * as supabaseEnrollmentRepo from './supabase/enrollmentRepo';

const _useSupabaseEnrollment =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_SUPABASE_ENROLLMENT === 'true';

export const enrollmentRepo: typeof firebaseEnrollmentRepo = _useSupabaseEnrollment
  ? (supabaseEnrollmentRepo as typeof firebaseEnrollmentRepo)
  : firebaseEnrollmentRepo;

// Rabbit Repo — Feature flag 기반 분기 (Phase 2 Step 3)
import * as firebaseRabbitRepo from './firebase/rabbitRepo';
import * as supabaseRabbitRepo from './supabase/rabbitRepo';

const _useSupabaseRabbits =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_SUPABASE_RABBITS === 'true';

export const rabbitRepo: typeof firebaseRabbitRepo = _useSupabaseRabbits
  ? (supabaseRabbitRepo as typeof firebaseRabbitRepo)
  : firebaseRabbitRepo;

// Review Repo — Feature flag 기반 분기 (Phase 2 Step 3)
// NEXT_PUBLIC_USE_SUPABASE_REVIEWS=true → Supabase, 아니면 Firestore
import * as firebaseReviewRepo from './firebase/reviewRepo';
import * as supabaseReviewRepo from './supabase/reviewRepo';

const _useSupabaseReviews =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_SUPABASE_REVIEWS === 'true';

export const reviewRepo: typeof firebaseReviewRepo = _useSupabaseReviews
  ? (supabaseReviewRepo as unknown as typeof firebaseReviewRepo)
  : firebaseReviewRepo;

// Post Repo — Feature flag 기반 분기 (Phase 2 Step 3)
// NEXT_PUBLIC_USE_SUPABASE_POSTS=true → Supabase Realtime, 아니면 Firestore onSnapshot
import * as firebasePostRepo from './firebase/postRepo';
import * as supabasePostRepo from './supabase/postRepo';

const _useSupabasePosts =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_SUPABASE_POSTS === 'true';

export const postRepo: typeof firebasePostRepo = _useSupabasePosts
  ? (supabasePostRepo as unknown as typeof firebasePostRepo)
  : firebasePostRepo;

// Ranking Repo — Feature flag 기반 분기 (Phase 1 마이그레이션)
// NEXT_PUBLIC_USE_SUPABASE_RANKINGS=true → Supabase, 아니면 Firestore
// getRanking / subscribeRanking / getRadarNorm 모두 동일 시그니처 유지
import * as firebaseRankingRepo from './firebase/rankingRepo';
import * as supabaseRankingRepo from './supabase/rankingRepo';

const _useSupabaseRankings =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_SUPABASE_RANKINGS === 'true';

export const rankingRepo: typeof firebaseRankingRepo = _useSupabaseRankings
  ? (supabaseRankingRepo as typeof firebaseRankingRepo)
  : firebaseRankingRepo;

// Quiz Repo — Feature flag 기반 분기 (Phase 2 Step 3)
// NEXT_PUBLIC_USE_SUPABASE_QUIZZES=true → Supabase, 아니면 Firestore
// 읽기는 Supabase, 쓰기는 Firebase 위임 (CF onQuizSync 가 dual-write 담당)
import * as firebaseQuizRepo from './firebase/quizRepo';
import * as supabaseQuizRepo from './supabase/quizRepo';

const _useSupabaseQuizzes =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_SUPABASE_QUIZZES === 'true';

export const quizRepo: typeof firebaseQuizRepo = _useSupabaseQuizzes
  ? (supabaseQuizRepo as unknown as typeof firebaseQuizRepo)
  : firebaseQuizRepo;
