'use client';

/**
 * PDF PiP 뷰어 상태 (zustand)
 *
 * - savedPdfs: IndexedDB 기반 메타 목록 (페이지수/이름/lastGeom 등)
 * - openWindows: 현재 화면에 떠 있는 PiP 창 목록 (최대 2개)
 *
 * 원칙:
 * - 최대 2개 동시 오픈, 3번째 요청 시 가장 오래된 창 자동 닫힘
 * - PiP는 "앱 어디든 둥둥" — 화면 내 다른 기능과 독립 (pointer-events는 창 내부만)
 * - 앱 재시작 시 openWindows 초기화 (persistence 없음)
 * - savedPdfs는 IndexedDB가 source of truth — 이 store는 캐시+리프레시 트리거
 */

import { create } from 'zustand';
import type { PdfGeom, PdfRecord } from '@/lib/repositories/indexedDb/pdfStore';
import {
  listPdfMeta,
  updatePdfMeta,
  deletePdf,
} from '@/lib/repositories/indexedDb/pdfStore';

const MAX_OPEN = 2;

export interface OpenWindow {
  pdfId: string;
  /** 오픈 순서 (오래된 것 먼저 닫기용) */
  openedAt: number;
  geom: PdfGeom;
}

interface PdfViewerStore {
  savedPdfs: PdfRecord[];
  openWindows: OpenWindow[];
  isListExpanded: boolean;

  loadList: () => Promise<void>;
  toggleList: () => void;
  addPdfToList: (record: PdfRecord) => void;
  removePdf: (id: string) => Promise<void>;

  openPdf: (id: string, defaultGeom: PdfGeom) => void;
  closePdf: (id: string) => void;
  updateWindowGeom: (id: string, geom: Partial<PdfGeom>) => void;

  /** 북마크 토글 — 이미 북마크된 페이지면 해제, 아니면 추가. IDB에도 반영 */
  toggleBookmark: (pdfId: string, page: number) => void;

  /** 현재 열려 있는지 */
  isOpen: (id: string) => boolean;
}

export const usePdfViewerStore = create<PdfViewerStore>((set, get) => ({
  savedPdfs: [],
  openWindows: [],
  isListExpanded: false,

  loadList: async () => {
    try {
      const list = await listPdfMeta();
      set({ savedPdfs: list });
    } catch (err) {
      console.error('[pdfViewerStore] loadList 실패:', err);
    }
  },

  toggleList: () => set((s) => ({ isListExpanded: !s.isListExpanded })),

  addPdfToList: (record) =>
    set((s) => {
      const existing = s.savedPdfs.filter((p) => p.id !== record.id);
      return { savedPdfs: [record, ...existing] };
    }),

  removePdf: async (id) => {
    try {
      await deletePdf(id);
    } catch (err) {
      console.error('[pdfViewerStore] removePdf 실패:', err);
    }
    set((s) => ({
      savedPdfs: s.savedPdfs.filter((p) => p.id !== id),
      openWindows: s.openWindows.filter((w) => w.pdfId !== id),
    }));
  },

  openPdf: (id, defaultGeom) => {
    const { openWindows, savedPdfs } = get();
    // 이미 열려 있으면 no-op (optional: 맨 앞으로 올리기)
    if (openWindows.some((w) => w.pdfId === id)) return;

    // 저장된 lastGeom 우선, 없으면 defaultGeom
    const meta = savedPdfs.find((p) => p.id === id);
    const geom = meta?.lastGeom ?? defaultGeom;

    const next: OpenWindow = { pdfId: id, openedAt: Date.now(), geom };
    const combined = [...openWindows, next];
    // 최대 개수 초과 시 가장 오래된 것 제거
    const trimmed =
      combined.length > MAX_OPEN
        ? combined.sort((a, b) => a.openedAt - b.openedAt).slice(combined.length - MAX_OPEN)
        : combined;
    set({ openWindows: trimmed });
  },

  closePdf: (id) => {
    // 현재 창 geom을 IndexedDB에 저장 (다음 열 때 위치 기억)
    const win = get().openWindows.find((w) => w.pdfId === id);
    if (win) {
      updatePdfMeta(id, { lastGeom: win.geom }).catch(() => {});
      // 로컬 savedPdfs 캐시도 업데이트
      set((s) => ({
        savedPdfs: s.savedPdfs.map((p) => (p.id === id ? { ...p, lastGeom: win.geom } : p)),
      }));
    }
    set((s) => ({ openWindows: s.openWindows.filter((w) => w.pdfId !== id) }));
  },

  updateWindowGeom: (id, patch) =>
    set((s) => ({
      openWindows: s.openWindows.map((w) =>
        w.pdfId === id ? { ...w, geom: { ...w.geom, ...patch } } : w,
      ),
    })),

  toggleBookmark: (pdfId, page) => {
    const current = get().savedPdfs.find((p) => p.id === pdfId);
    if (!current) return;
    const existing = current.bookmarks ?? [];
    const nextSet = existing.includes(page)
      ? existing.filter((p) => p !== page)
      : [...existing, page].sort((a, b) => a - b);
    updatePdfMeta(pdfId, { bookmarks: nextSet }).catch(() => {});
    set((s) => ({
      savedPdfs: s.savedPdfs.map((p) => (p.id === pdfId ? { ...p, bookmarks: nextSet } : p)),
    }));
  },

  isOpen: (id) => get().openWindows.some((w) => w.pdfId === id),
}));
