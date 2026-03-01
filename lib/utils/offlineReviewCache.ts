/**
 * 복습 문제 오프라인 캐시 (IndexedDB)
 *
 * 복습 데이터를 IndexedDB에 저장하여 오프라인에서도 열람/풀이 가능
 * 온라인 복귀 시 Firestore와 자동 동기화
 */

const DB_NAME = 'rabbitory_offline';
const DB_VERSION = 1;
const REVIEW_STORE = 'reviews';
const QUIZ_STORE = 'quizzes';

/**
 * IndexedDB 싱글턴 인스턴스 (연결 누수 방지)
 */
let _dbInstance: IDBDatabase | null = null;
let _dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  // 이미 열린 연결이 있으면 재사용
  if (_dbInstance) return Promise.resolve(_dbInstance);
  // 열기 진행 중이면 같은 Promise 반환 (중복 호출 방지)
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      _dbPromise = null;
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(REVIEW_STORE)) {
        db.createObjectStore(REVIEW_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(QUIZ_STORE)) {
        db.createObjectStore(QUIZ_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      _dbInstance = request.result;
      // 연결이 닫히면 싱글턴 초기화
      _dbInstance.onclose = () => {
        _dbInstance = null;
        _dbPromise = null;
      };
      resolve(_dbInstance);
    };
    request.onerror = () => {
      _dbPromise = null;
      reject(request.error);
    };
  });

  return _dbPromise;
}

/**
 * 트랜잭션 래퍼
 */
async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = callback(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ============================================================
// 복습 데이터 캐시
// ============================================================

export interface CachedReview {
  id: string; // reviewDoc.id
  userId: string;
  quizId: string;
  questionId: string;
  reviewType: 'wrong' | 'bookmark' | 'solved';
  questionText: string;
  questionType: string;
  choices?: string[];
  correctAnswer: string;
  userAnswer?: string;
  isCorrect?: boolean;
  explanation?: string;
  image?: string;
  imageUrl?: string;
  cachedAt: number;
}

/**
 * 복습 데이터 배치 저장
 */
export async function cacheReviews(reviews: CachedReview[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(REVIEW_STORE, 'readwrite');
    const store = tx.objectStore(REVIEW_STORE);

    for (const review of reviews) {
      store.put(review);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB 실패 시 무시 (오프라인 캐시는 필수가 아님)
  }
}

/**
 * 캐시된 복습 데이터 조회 (userId + reviewType 필터)
 */
export async function getCachedReviews(
  userId: string,
  reviewType?: string
): Promise<CachedReview[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(REVIEW_STORE, 'readonly');
      const store = tx.objectStore(REVIEW_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        let results = (request.result as CachedReview[]).filter(
          (r) => r.userId === userId
        );
        if (reviewType) {
          results = results.filter((r) => r.reviewType === reviewType);
        }
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

/**
 * 특정 복습 데이터 조회
 */
export async function getCachedReview(reviewId: string): Promise<CachedReview | null> {
  try {
    const result = await withStore<CachedReview | undefined>(
      REVIEW_STORE,
      'readonly',
      (store) => store.get(reviewId)
    );
    return result || null;
  } catch {
    return null;
  }
}

/**
 * 캐시된 복습 데이터 삭제
 */
export async function removeCachedReview(reviewId: string): Promise<void> {
  try {
    await withStore(REVIEW_STORE, 'readwrite', (store) => store.delete(reviewId));
  } catch {
    // 무시
  }
}

/**
 * 전체 캐시 클리어
 */
export async function clearReviewCache(): Promise<void> {
  try {
    await withStore(REVIEW_STORE, 'readwrite', (store) => store.clear());
  } catch {
    // 무시
  }
}

// ============================================================
// 퀴즈 데이터 캐시 (문제 전체 데이터)
// ============================================================

export interface CachedQuiz {
  id: string; // quizId
  title: string;
  questions: any[];
  cachedAt: number;
}

/**
 * 퀴즈 데이터 캐시
 */
export async function cacheQuiz(quiz: CachedQuiz): Promise<void> {
  try {
    await withStore(QUIZ_STORE, 'readwrite', (store) => store.put(quiz));
  } catch {
    // 무시
  }
}

/**
 * 캐시된 퀴즈 데이터 조회
 */
export async function getCachedQuiz(quizId: string): Promise<CachedQuiz | null> {
  try {
    const result = await withStore<CachedQuiz | undefined>(
      QUIZ_STORE,
      'readonly',
      (store) => store.get(quizId)
    );
    return result || null;
  } catch {
    return null;
  }
}

/**
 * 오프라인 복습 결과 저장 (로컬, 온라인 복귀 시 동기화)
 */
export interface OfflineReviewResult {
  reviewId: string;
  userAnswer: string;
  isCorrect: boolean;
  answeredAt: number;
}

const OFFLINE_RESULTS_KEY = 'rabbitory_offline_review_results';

export function saveOfflineReviewResult(result: OfflineReviewResult): void {
  try {
    const existing = getOfflineReviewResults();
    // 같은 reviewId 있으면 덮어쓰기
    const filtered = existing.filter((r) => r.reviewId !== result.reviewId);
    filtered.push(result);
    localStorage.setItem(OFFLINE_RESULTS_KEY, JSON.stringify(filtered));
  } catch {
    // 무시
  }
}

export function getOfflineReviewResults(): OfflineReviewResult[] {
  try {
    const raw = localStorage.getItem(OFFLINE_RESULTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearOfflineReviewResults(): void {
  localStorage.removeItem(OFFLINE_RESULTS_KEY);
}
