/**
 * 유틸리티 함수 모듈 내보내기
 */

// Firestore 유틸리티
export {
  timestampToDate,
  docToObject,
  docsToArray,
  getUserNickname,
  getUserRole,
  docExists,
  isDocAuthor,
  type TimestampFields,
  type DocConvertOptions,
  type PaginatedResult,
} from './firestore';

// 비동기 작업 핸들러
export {
  safeAsync,
  getErrorMessage,
  useAsyncState,
  useLoadingState,
  handleFirebaseError,
  type AsyncState,
  type AsyncResult,
  type AsyncOptions,
} from './asyncHandler';
