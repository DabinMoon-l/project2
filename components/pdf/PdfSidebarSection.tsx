'use client';

/**
 * 사이드바(1쪽) PDF 섹션 — 가로모드에서 게시판 밑에 배치.
 *
 * - 접힘 기본: "PDF >" 한 줄
 * - 펼치면: 저장된 목록 + "+ 추가" 버튼
 * - 목록 항목 탭 → PiP 창 열기 (최대 2개, 3번째는 가장 오래된 창 자동 닫힘)
 * - 항목 우측 ✕ → 파일 삭제 (확인 alert)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePdfViewerStore } from '@/lib/stores/pdfViewerStore';
import { savePdf } from '@/lib/repositories/indexedDb/pdfStore';
import { getPdfjs } from '@/lib/utils/pdfjs';

const MAX_SIZE_MB = 50;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

export default function PdfSidebarSection() {
  const savedPdfs = usePdfViewerStore((s) => s.savedPdfs);
  const isListExpanded = usePdfViewerStore((s) => s.isListExpanded);
  const toggleList = usePdfViewerStore((s) => s.toggleList);
  const openPdf = usePdfViewerStore((s) => s.openPdf);
  const closePdf = usePdfViewerStore((s) => s.closePdf);
  const isOpen = usePdfViewerStore((s) => s.isOpen);
  const addPdfToList = usePdfViewerStore((s) => s.addPdfToList);
  const removePdf = usePdfViewerStore((s) => s.removePdf);
  const loadList = usePdfViewerStore((s) => s.loadList);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // 컴포넌트 mount 시 IndexedDB에서 목록 동기화 (루트가 먼저 로드하지만 안전하게)
  useEffect(() => {
    if (savedPdfs.length === 0) loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpen = useCallback(
    (id: string) => {
      // 저장된 aspect(w/h)에 맞춰 기본 크기 결정 — 검정 여백 방지.
      const meta = savedPdfs.find((p) => p.id === id);
      const aspect = meta?.aspect ?? 1;
      // 대각선 기준 ~450px 목표 (화면의 절반 정도), 비율 유지해서 w/h 산출.
      // 가로 PDF면 폭이 넓고, 세로 PDF면 높이가 크게 됨.
      const maxW = window.innerWidth * 0.45;
      const maxH = window.innerHeight * 0.7;
      let w = 420;
      let h = w / aspect;
      if (h > maxH) {
        h = maxH;
        w = h * aspect;
      }
      if (w > maxW) {
        w = maxW;
        h = w / aspect;
      }
      const defaultGeom = {
        x: Math.max(0, (window.innerWidth - w) / 2),
        y: Math.max(0, (window.innerHeight - h) / 2),
        w,
        h,
      };
      openPdf(id, defaultGeom);
    },
    [openPdf, savedPdfs],
  );

  const handleAddClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // input 재사용을 위해 먼저 초기화
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('PDF 파일만 추가할 수 있습니다.');
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      alert(`파일이 너무 큽니다 (${MAX_SIZE_MB}MB 이하만 가능).`);
      return;
    }

    try {
      setIsProcessing(true);
      // Blob은 원본 file 그대로 (arrayBuffer 재사용하지 않아 detach 걱정 없음)
      const blob = file.slice(0, file.size, 'application/pdf');

      // pdfjs용으로는 별도 ArrayBuffer 생성 (getDocument가 소비/detach할 수 있음)
      const bufferForPdfjs = await blob.arrayBuffer();
      const pdfjs = await getPdfjs();
      const doc = await pdfjs.getDocument({ data: bufferForPdfjs }).promise;
      const pageCount = doc.numPages;
      const page1 = await doc.getPage(1);
      const vp1 = page1.getViewport({ scale: 1 });
      const aspect = vp1.width > 0 && vp1.height > 0 ? vp1.width / vp1.height : 1;
      doc.destroy();

      const id = `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await savePdf({ id, name: file.name, blob, pageCount, aspect });
      addPdfToList({ id, name: file.name, pageCount, aspect, addedAt: Date.now() });
      // state 반영 이후 handleOpen (다음 render 콜백은 savedPdfs에 방금 추가된 meta를 볼 수 있음)
      setTimeout(() => handleOpen(id), 0);
    } catch (err) {
      console.error('[PdfSidebarSection] 추가 실패:', err);
      alert('PDF를 불러오지 못했습니다. 파일이 손상되었거나 지원되지 않을 수 있습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemove = (id: string, name: string) => {
    if (!window.confirm(`"${name}"을 삭제할까요?`)) return;
    removePdf(id);
  };

  return (
    <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(0,0,0,0.1)' }}>
      <button
        type="button"
        onClick={toggleList}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-black/5"
        style={{ color: '#1A1A1A' }}
      >
        <span className="text-sm font-semibold" style={{ opacity: 0.7 }}>PDF</span>
        <span
          className="text-sm transition-transform"
          style={{
            transform: isListExpanded ? 'rotate(90deg)' : 'rotate(0)',
            opacity: 0.4,
          }}
        >
          ›
        </span>
      </button>

      {isListExpanded && (
        <div className="px-1 pb-2 space-y-0.5">
          {savedPdfs.map((p) => {
            const active = isOpen(p.id);
            return (
              <div
                key={p.id}
                className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${
                  active ? 'bg-black/15' : 'hover:bg-black/5'
                }`}
                style={{ color: '#1A1A1A' }}
              >
                {/* 이름 클릭 = 창 토글. 열리면 진한 회색 배경으로 "선택됨" 표시,
                    다시 누르면 닫힘(store.closePdf가 위치·페이지 자동 저장). */}
                <button
                  type="button"
                  onClick={() => {
                    if (active) closePdf(p.id);
                    else handleOpen(p.id);
                  }}
                  className="flex-1 text-left truncate font-medium"
                  title={p.name}
                  style={{ opacity: active ? 1 : 0.75 }}
                >
                  {p.name}
                </button>
                {/* X 버튼 = 파일 완전 삭제 (IDB에서 제거, 열림 상태도 해제) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(p.id, p.name);
                  }}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-black/10"
                  style={{ color: '#1A1A1A', opacity: 0.5 }}
                  title="삭제"
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={handleAddClick}
            disabled={isProcessing}
            className="w-full mt-1 px-2 py-1.5 text-xs rounded-lg disabled:opacity-50"
            style={{
              color: '#1A1A1A',
              opacity: isProcessing ? 0.5 : 0.65,
              border: '1px dashed rgba(0,0,0,0.25)',
            }}
          >
            {isProcessing ? '추가 중…' : '+ 추가'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      )}
    </div>
  );
}
