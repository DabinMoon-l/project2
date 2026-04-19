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
      const defaultW = Math.min(360, window.innerWidth * 0.4);
      const defaultH = Math.min(520, window.innerHeight * 0.7);
      const defaultGeom = {
        x: Math.max(0, (window.innerWidth - defaultW) / 2),
        y: Math.max(0, (window.innerHeight - defaultH) / 2),
        w: defaultW,
        h: defaultH,
      };
      openPdf(id, defaultGeom);
    },
    [openPdf],
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
      // 페이지 수 파악
      const buffer = await file.arrayBuffer();
      const pdfjs = await getPdfjs();
      const doc = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
      const pageCount = doc.numPages;
      doc.destroy();

      const id = `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const blob = new Blob([buffer], { type: 'application/pdf' });
      await savePdf({ id, name: file.name, blob, pageCount });
      addPdfToList({ id, name: file.name, pageCount, addedAt: Date.now() });
      // 바로 열어주기
      handleOpen(id);
    } catch (err) {
      console.error('[PdfSidebarSection] 추가 실패:', err);
      alert('PDF를 불러오지 못했습니다.');
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
                  active ? 'bg-black/10' : 'hover:bg-black/5'
                }`}
                style={{ color: '#1A1A1A' }}
              >
                <button
                  type="button"
                  onClick={() => handleOpen(p.id)}
                  className="flex-1 text-left truncate font-medium"
                  title={p.name}
                  style={{ opacity: active ? 1 : 0.75 }}
                >
                  {p.name}
                </button>
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
