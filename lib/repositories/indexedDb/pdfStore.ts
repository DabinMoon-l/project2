'use client';

/**
 * PDF 로컬 저장소 (IndexedDB)
 *
 * 용도: 가로모드 PDF PiP 뷰어용 개인 파일 캐시.
 * - 파일 Blob 자체 + 메타데이터(파일명/페이지수/위치·크기 기억값) 저장
 * - 서버 업로드 없음(학생 개인 강의자료, 본인만 보면 됨 → 네트워크/스토리지 비용 0)
 * - Supabase 마이그레이션 후에도 이 선택이 최적 — 클라우드 싱크 불필요
 *
 * 스키마:
 *   store "pdfs": key=id, value={ id, name, blob, pageCount, addedAt, lastGeom }
 *   lastGeom = { x, y, w, h } — 각 PDF의 마지막 PiP 위치·크기 기억
 */

const DB_NAME = 'rabbitory-pdf';
const STORE_NAME = 'pdfs';
const DB_VERSION = 1;

export interface PdfGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfRecord {
  id: string;
  name: string;
  pageCount: number;
  /** 첫 페이지 가로/세로 비율 (w/h). 창 크기를 이 비율에 맞춰 검정 여백 방지 */
  aspect: number;
  addedAt: number;
  lastGeom?: PdfGeom;
  /** 마지막으로 보고 있던 페이지 (1-indexed). 재오픈 시 복원 */
  lastPage?: number;
  /** 사용자가 북마크한 페이지 번호 배열 (1-indexed). 하단 슬라이더에 표시 */
  bookmarks?: number[];
}

interface PdfStoredRecord extends PdfRecord {
  blob: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 미지원 환경'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txRequest<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          reject(tx.error);
          db.close();
        };
      }),
  );
}

/** 메타데이터만 리스트 — Blob은 개별 요청으로 로드 (메모리 절약) */
export async function listPdfMeta(): Promise<PdfRecord[]> {
  const all = await txRequest<PdfStoredRecord[]>('readonly', (s) => s.getAll());
  return all
    .map((r) => ({
      id: r.id,
      name: r.name,
      pageCount: r.pageCount,
      aspect: r.aspect ?? 1, // 구버전 레코드 호환 (1:1 fallback)
      addedAt: r.addedAt,
      lastGeom: r.lastGeom,
      lastPage: r.lastPage,
      bookmarks: r.bookmarks ?? [],
    }))
    .sort((a, b) => b.addedAt - a.addedAt);
}

/** Blob 로드 */
export async function getPdfBlob(id: string): Promise<Blob | null> {
  const rec = await txRequest<PdfStoredRecord | undefined>('readonly', (s) => s.get(id));
  return rec?.blob ?? null;
}

/** PDF 저장 */
export async function savePdf(record: {
  id: string;
  name: string;
  blob: Blob;
  pageCount: number;
  aspect: number;
  addedAt?: number;
  lastGeom?: PdfGeom;
}): Promise<void> {
  await txRequest<IDBValidKey>('readwrite', (s) =>
    s.put({
      ...record,
      addedAt: record.addedAt ?? Date.now(),
    } satisfies PdfStoredRecord),
  );
}

/**
 * 메타데이터 업데이트 — 반드시 **단일 트랜잭션**에서 get→put.
 * Safari/WebKit은 Blob이 포함된 레코드를 별도 트랜잭션에서 read 후 다른 tx
 * 에서 다시 put하면 Blob 참조가 무효화되는 known 이슈가 있음
 * ("the object can not be found here"). get+put을 같은 tx에 묶으면
 * Blob이 tx 동안 살아있어 안전.
 */
export async function updatePdfMeta(
  id: string,
  patch: Partial<Omit<PdfRecord, 'id'>>,
): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as PdfStoredRecord | undefined;
      if (!existing) return; // 없으면 아무것도 안 함, 에러 아님
      const putReq = store.put({ ...existing, ...patch });
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error);
      db.close();
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error('transaction aborted'));
      db.close();
    };
  });
}

/** 삭제 */
export async function deletePdf(id: string): Promise<void> {
  await txRequest<undefined>('readwrite', (s) => s.delete(id));
}
