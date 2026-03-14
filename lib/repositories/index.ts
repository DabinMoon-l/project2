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
export * as quizRepo from './firebase/quizRepo';
export * as reviewRepo from './firebase/reviewRepo';
export * as postRepo from './firebase/postRepo';
export * as rabbitRepo from './firebase/rabbitRepo';
export * as rankingRepo from './firebase/rankingRepo';
export * as announcementRepo from './firebase/announcementRepo';
export * as battleRepo from './firebase/battleRepo';
export * as enrollmentRepo from './firebase/enrollmentRepo';
export * as storageRepo from './firebase/storageRepo';
