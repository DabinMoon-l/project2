/**
 * Repository 공통 타입
 *
 * Supabase 마이그레이션 시 이 인터페이스는 유지, 구현체만 교체
 */

/** 구독 해제 함수 */
export type Unsubscribe = () => void;

/** 구독 콜백 */
export type SubscribeCallback<T> = (data: T) => void;

/** 에러 콜백 */
export type ErrorCallback = (error: Error) => void;

/** 문서 변환 옵션 */
export interface DocConvertOptions {
  dateFields?: string[];
  defaults?: Record<string, unknown>;
}

/** 페이지네이션 커서 (구현체별 내부 타입) */
export type PageCursor = unknown;

/** 페이지네이션 결과 */
export interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  cursor: PageCursor | null;
}

/** 정렬 방향 */
export type SortDirection = 'asc' | 'desc';

/** 쿼리 필터 연산자 */
export type FilterOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains' | 'array-contains-any';

/** 쿼리 필터 */
export interface QueryFilter {
  field: string;
  op: FilterOp;
  value: unknown;
}

/** 쿼리 정렬 */
export interface QueryOrder {
  field: string;
  direction: SortDirection;
}
