'use client';

/**
 * 열린 PDF PiP 창들을 렌더하는 루트. main layout에 1회 마운트.
 * 가로모드 + createPortal(body)로 어떤 페이지든 위에 떠다님.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import PdfPipWindow from './PdfPipWindow';
import { usePdfViewerStore } from '@/lib/stores/pdfViewerStore';
import { useWideMode } from '@/lib/hooks/useViewportScale';

export default function PdfViewerRoot() {
  const isWide = useWideMode();
  const openWindows = usePdfViewerStore((s) => s.openWindows);
  const savedPdfs = usePdfViewerStore((s) => s.savedPdfs);
  const loadList = usePdfViewerStore((s) => s.loadList);

  // 앱 부팅 시 목록 1회 로드
  useEffect(() => {
    loadList();
  }, [loadList]);

  if (!isWide) return null;
  if (typeof window === 'undefined') return null;
  if (openWindows.length === 0) return null;

  return createPortal(
    <>
      {openWindows.map((w) => {
        const meta = savedPdfs.find((p) => p.id === w.pdfId);
        if (!meta) return null;
        return (
          <PdfPipWindow
            key={w.pdfId}
            pdfId={w.pdfId}
            pdfName={meta.name}
            aspect={meta.aspect}
            geom={w.geom}
          />
        );
      })}
    </>,
    document.body,
  );
}
