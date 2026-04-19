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

/** 메타데이터만 업데이트 (위치·크기 기억 등) — blob 재저장 없이 효율적 */
export async function updatePdfMeta(
  id: string,
  patch: Partial<Omit<PdfRecord, 'id'>>,
): Promise<void> {
  const existing = await txRequest<PdfStoredRecord | undefined>('readonly', (s) => s.get(id));
  if (!existing) return;
  await txRequest<IDBValidKey>('readwrite', (s) =>
    s.put({ ...existing, ...patch }),
  );
}

/** 삭제 */
export async function deletePdf(id: string): Promise<void> {
  await txRequest<undefined>('readwrite', (s) => s.delete(id));
}
