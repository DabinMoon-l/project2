'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as pdfjsLib from 'pdfjs-dist';
import { scaleCoord } from '@/lib/hooks/useViewportScale';

// PDF.js 워커 설정
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
}

// ============================================================
// 타입 정의
// ============================================================

export interface UploadedFileItem {
  id: string;
  file: File;
  preview: string; // base64 또는 'pdf'
}

export interface ExtractedImageItem {
  id: string;
  dataUrl: string;
  sourceFileName?: string;
}

interface ImageRegionSelectorProps {
  uploadedFiles: UploadedFileItem[];
  extractedImages: ExtractedImageItem[];
  onExtract: (dataUrl: string, sourceFileName?: string) => void;
  onRemoveExtracted?: (id: string) => void;
  onClose: () => void;
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfPageCache {
  [fileId: string]: {
    pages: string[];
    totalPages: number;
  };
}

type DragMode = 'none' | 'create' | 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-t' | 'resize-b' | 'resize-l' | 'resize-r';

// ============================================================
// 컴포넌트
// ============================================================

export default function ImageRegionSelector({
  uploadedFiles,
  extractedImages,
  onExtract,
  onRemoveExtracted,
  onClose,
}: ImageRegionSelectorProps) {
  // 파일 네비게이션
  const [currentFileIndex, setCurrentFileIndex] = useState(0);

  // 선택 영역
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);

  // PDF
  const [pdfCache, setPdfCache] = useState<PdfPageCache>({});
  const [currentPdfPage, setCurrentPdfPage] = useState(1);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);

  // 원본 이미지
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);

  // 미리보기
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);

  // 추출 성공 피드백
  const [extractFeedback, setExtractFeedback] = useState(false);

  // 커서 스타일
  const [cursorStyle, setCursorStyle] = useState<string>('crosshair');

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayImageRef = useRef<HTMLImageElement | null>(null);

  // 파생값
  const currentFile = uploadedFiles[currentFileIndex] || null;
  const isPdf = currentFile?.preview === 'pdf';
  const totalFiles = uploadedFiles.length;
  const hasValidSelection = selection && selection.width >= 10 && selection.height >= 10;
  const previewImage = previewImageId
    ? extractedImages.find(img => img.id === previewImageId)
    : null;

  // ============================================================
  // Effects
  // ============================================================

  // 바디 스크롤 잠금
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // 컨테이너 리사이즈 대응
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const img = displayImageRef.current;
      if (!img || !img.naturalWidth) return;
      const rect = container.getBoundingClientRect();
      const maxW = rect.width - 32;
      const maxH = rect.height - 32;
      const newScale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      setScale(newScale);
      setDisplaySize({
        width: img.naturalWidth * newScale,
        height: img.naturalHeight * newScale,
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ============================================================
  // PDF 로딩
  // ============================================================

  const loadPdfPage = useCallback(async (file: File, fileId: string, pageNum: number) => {
    setIsLoadingPdf(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({
        data: arrayBuffer,
        cMapUrl: 'https://unpkg.com/pdfjs-dist@4.10.38/cmaps/',
        cMapPacked: true,
      }).promise;

      const totalPages = pdf.numPages;
      setPdfTotalPages(totalPages);

      const page = await pdf.getPage(pageNum);
      // 고해상도 렌더링 (화질 보존)
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas context failed');

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/png');

      setPdfCache((prev) => {
        const existing = prev[fileId] || { pages: [], totalPages };
        const newPages = [...existing.pages];
        newPages[pageNum - 1] = dataUrl;
        return { ...prev, [fileId]: { pages: newPages, totalPages } };
      });

      setOriginalImageUrl(dataUrl);
    } catch (error) {
      console.error('PDF 로드 오류:', error);
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('worker')) {
        alert('PDF 워커 로딩 오류가 발생했습니다. 페이지를 새로고침 해주세요.');
      } else {
        alert('PDF 파일을 로드하는 중 오류가 발생했습니다.');
      }
    } finally {
      setIsLoadingPdf(false);
    }
  }, []);

  // 파일 변경 시 — currentFile이 실제로 바뀔 때만 초기화
  const prevFileIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentFile) {
      setOriginalImageUrl(null);
      setPdfTotalPages(0);
      prevFileIdRef.current = null;
      return;
    }

    // 같은 파일이면 무시 (캐시 업데이트 시 재실행 방지)
    if (prevFileIdRef.current === currentFile.id) return;
    prevFileIdRef.current = currentFile.id;

    setSelection(null);
    setCurrentPdfPage(1);

    if (currentFile.preview !== 'pdf') {
      setOriginalImageUrl(currentFile.preview);
      setPdfTotalPages(0);
    } else {
      const cached = pdfCache[currentFile.id];
      if (cached && cached.pages[0]) {
        setOriginalImageUrl(cached.pages[0]);
        setPdfTotalPages(cached.totalPages);
      } else {
        loadPdfPage(currentFile.file, currentFile.id, 1);
      }
    }
  }, [currentFile, pdfCache, loadPdfPage]);

  const handlePdfPageChange = useCallback((newPage: number) => {
    if (!currentFile || !isPdf) return;
    if (newPage < 1 || newPage > pdfTotalPages) return;

    setCurrentPdfPage(newPage);
    setSelection(null);

    const cached = pdfCache[currentFile.id];
    if (cached && cached.pages[newPage - 1]) {
      setOriginalImageUrl(cached.pages[newPage - 1]);
    } else {
      loadPdfPage(currentFile.file, currentFile.id, newPage);
    }
  }, [currentFile, isPdf, pdfTotalPages, pdfCache, loadPdfPage]);

  const handleFileChange = useCallback((direction: 'prev' | 'next') => {
    if (direction === 'prev' && currentFileIndex > 0) {
      setCurrentFileIndex(currentFileIndex - 1);
    } else if (direction === 'next' && currentFileIndex < totalFiles - 1) {
      setCurrentFileIndex(currentFileIndex + 1);
    }
  }, [currentFileIndex, totalFiles]);

  // ============================================================
  // 이미지 로드
  // ============================================================

  // 원본 이미지 (고해상도 추출용)
  useEffect(() => {
    if (!originalImageUrl) {
      originalImageRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      originalImageRef.current = img;
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = originalImageUrl;
    return () => { img.onload = null; };
  }, [originalImageUrl]);

  // 표시 이미지 로드 완료
  const handleDisplayImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    displayImageRef.current = img;

    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const maxW = rect.width - 32;
      const maxH = rect.height - 32;
      const newScale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      setScale(newScale);
      setDisplaySize({
        width: img.naturalWidth * newScale,
        height: img.naturalHeight * newScale,
      });
    }
  }, []);

  // ============================================================
  // 드래그 핸들링
  // ============================================================

  // 좌표 변환 (화면 → 이미지 원본 픽셀)
  const getImageCoords = useCallback((clientX: number, clientY: number) => {
    if (!displayImageRef.current) return { x: 0, y: 0 };
    const imgRect = displayImageRef.current.getBoundingClientRect();
    const x = (clientX - imgRect.left) / scale;
    const y = (clientY - imgRect.top) / scale;
    return {
      x: Math.max(0, Math.min(imageSize.width, x)),
      y: Math.max(0, Math.min(imageSize.height, y)),
    };
  }, [scale, imageSize]);

  // 드래그 모드 판별 (터치 영역 36px로 모바일 친화적)
  const getDragMode = useCallback((clientX: number, clientY: number): DragMode => {
    if (!selection || !displayImageRef.current) return 'create';

    const imgRect = displayImageRef.current.getBoundingClientRect();
    const handleSize = 36;

    const selLeft = imgRect.left + selection.x * scale;
    const selTop = imgRect.top + selection.y * scale;
    const selRight = selLeft + selection.width * scale;
    const selBottom = selTop + selection.height * scale;

    const nearLeft = Math.abs(clientX - selLeft) < handleSize;
    const nearRight = Math.abs(clientX - selRight) < handleSize;
    const nearTop = Math.abs(clientY - selTop) < handleSize;
    const nearBottom = Math.abs(clientY - selBottom) < handleSize;

    if (nearTop && nearLeft) return 'resize-tl';
    if (nearTop && nearRight) return 'resize-tr';
    if (nearBottom && nearLeft) return 'resize-bl';
    if (nearBottom && nearRight) return 'resize-br';

    // 동서남북 엣지 리사이즈
    const betweenHoriz = clientX > selLeft + handleSize && clientX < selRight - handleSize;
    const betweenVert = clientY > selTop + handleSize && clientY < selBottom - handleSize;

    if (nearTop && betweenHoriz) return 'resize-t';
    if (nearBottom && betweenHoriz) return 'resize-b';
    if (nearLeft && betweenVert) return 'resize-l';
    if (nearRight && betweenVert) return 'resize-r';

    if (clientX >= selLeft && clientX <= selRight && clientY >= selTop && clientY <= selBottom) {
      return 'move';
    }

    return 'create';
  }, [selection, scale]);

  // 드래그 모드 → 커서 스타일 매핑
  const getCursorForMode = useCallback((mode: DragMode): string => {
    switch (mode) {
      case 'resize-tl': case 'resize-br': return 'nwse-resize';
      case 'resize-tr': case 'resize-bl': return 'nesw-resize';
      case 'resize-t': case 'resize-b': return 'ns-resize';
      case 'resize-l': case 'resize-r': return 'ew-resize';
      case 'move': return 'move';
      case 'create': return 'crosshair';
      default: return 'crosshair';
    }
  }, []);

  const handleDragStart = useCallback((clientX: number, clientY: number) => {
    if (!originalImageUrl || !displayImageRef.current) return;

    const imgRect = displayImageRef.current.getBoundingClientRect();
    if (clientX < imgRect.left || clientX > imgRect.right ||
        clientY < imgRect.top || clientY > imgRect.bottom) {
      return;
    }

    const coords = getImageCoords(clientX, clientY);
    const mode = getDragMode(clientX, clientY);

    setDragMode(mode);
    setCursorStyle(getCursorForMode(mode));
    setDragStart(coords);

    if (mode === 'create') {
      setSelection({ x: coords.x, y: coords.y, width: 0, height: 0 });
    }
  }, [getImageCoords, getDragMode, originalImageUrl]);

  const handleDragMove = useCallback((clientX: number, clientY: number) => {
    if (dragMode === 'none' || !selection) return;

    const coords = getImageCoords(clientX, clientY);

    if (dragMode === 'create') {
      setSelection({
        x: Math.min(dragStart.x, coords.x),
        y: Math.min(dragStart.y, coords.y),
        width: Math.abs(coords.x - dragStart.x),
        height: Math.abs(coords.y - dragStart.y),
      });
    } else if (dragMode === 'move') {
      const dx = coords.x - dragStart.x;
      const dy = coords.y - dragStart.y;
      const newX = Math.max(0, Math.min(imageSize.width - selection.width, selection.x + dx));
      const newY = Math.max(0, Math.min(imageSize.height - selection.height, selection.y + dy));
      setSelection({ ...selection, x: newX, y: newY });
      setDragStart(coords);
    } else if (dragMode.startsWith('resize')) {
      let newX = selection.x;
      let newY = selection.y;
      let newW = selection.width;
      let newH = selection.height;

      if (dragMode === 'resize-tl') {
        newW = selection.x + selection.width - coords.x;
        newH = selection.y + selection.height - coords.y;
        newX = coords.x;
        newY = coords.y;
      } else if (dragMode === 'resize-tr') {
        newW = coords.x - selection.x;
        newH = selection.y + selection.height - coords.y;
        newY = coords.y;
      } else if (dragMode === 'resize-bl') {
        newW = selection.x + selection.width - coords.x;
        newH = coords.y - selection.y;
        newX = coords.x;
      } else if (dragMode === 'resize-br') {
        newW = coords.x - selection.x;
        newH = coords.y - selection.y;
      } else if (dragMode === 'resize-t') {
        newH = selection.y + selection.height - coords.y;
        newY = coords.y;
      } else if (dragMode === 'resize-b') {
        newH = coords.y - selection.y;
      } else if (dragMode === 'resize-l') {
        newW = selection.x + selection.width - coords.x;
        newX = coords.x;
      } else if (dragMode === 'resize-r') {
        newW = coords.x - selection.x;
      }

      if (newW >= 20 && newH >= 20) {
        setSelection({ x: newX, y: newY, width: newW, height: newH });
      }
    }
  }, [dragMode, selection, dragStart, getImageCoords, imageSize]);

  // 드래그 종료 — 너무 작은 선택 (실수 탭) 자동 해제
  const handleDragEnd = useCallback(() => {
    if (dragMode === 'create' && selection) {
      if (selection.width < 10 || selection.height < 10) {
        setSelection(null);
      }
    }
    setDragMode('none');
    setCursorStyle('crosshair');
  }, [dragMode, selection]);

  // 마우스 이벤트
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    handleDragStart(scaleCoord(e.clientX), scaleCoord(e.clientY));
  }, [handleDragStart]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragMode === 'none') {
      // 드래그 중이 아닐 때 커서 스타일 업데이트
      const mode = getDragMode(scaleCoord(e.clientX), scaleCoord(e.clientY));
      setCursorStyle(getCursorForMode(mode));
    }
    handleDragMove(scaleCoord(e.clientX), scaleCoord(e.clientY));
  }, [dragMode, getDragMode, getCursorForMode, handleDragMove]);

  const handleMouseUp = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // 터치 이벤트
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      handleDragStart(scaleCoord(e.touches[0].clientX), scaleCoord(e.touches[0].clientY));
    }
  }, [handleDragStart]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      e.preventDefault();
      handleDragMove(scaleCoord(e.touches[0].clientX), scaleCoord(e.touches[0].clientY));
    }
  }, [handleDragMove]);

  const handleTouchEnd = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // ============================================================
  // 영역 추출 (원본 해상도, 무손실 PNG)
  // ============================================================

  const handleExtractRegion = useCallback(() => {
    if (!selection || !originalImageRef.current || !canvasRef.current) return;

    if (selection.width < 10 || selection.height < 10) {
      alert('선택 영역이 너무 작습니다.');
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // 원본 해상도로 크롭 — 화질 손실 없음
    canvas.width = Math.round(selection.width);
    canvas.height = Math.round(selection.height);
    ctx.imageSmoothingEnabled = false;

    ctx.drawImage(
      originalImageRef.current,
      Math.round(selection.x),
      Math.round(selection.y),
      Math.round(selection.width),
      Math.round(selection.height),
      0, 0,
      Math.round(selection.width),
      Math.round(selection.height)
    );

    const dataUrl = canvas.toDataURL('image/png');

    let fileName = currentFile?.file.name || '이미지';
    if (isPdf) {
      fileName = `${fileName} (${currentPdfPage}페이지)`;
    }

    onExtract(dataUrl, fileName);

    // 선택 영역 유지 — 미세 조정 후 재추출 가능
    // 성공 피드백 표시
    setExtractFeedback(true);
    setTimeout(() => setExtractFeedback(false), 1200);
  }, [selection, onExtract, currentFile, isPdf, currentPdfPage]);

  // ============================================================
  // 렌더링
  // ============================================================

  // 파일 없음
  if (uploadedFiles.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="absolute inset-0 bg-black/80" onClick={onClose} />
        <div className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6 max-w-sm text-center">
          <p className="text-[#1A1A1A] mb-4">선택된 파일이 없습니다.</p>
          <button type="button" onClick={onClose} className="px-6 py-2 bg-[#1A1A1A] text-[#F5F0E8] font-bold">
            닫기
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: '#1a1a1a' }}
    >
      <canvas ref={canvasRef} className="hidden" />

      {/* ====== 헤더 ====== */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2.5 bg-[#F5F0E8] border-b-2 border-[#1A1A1A]">
        <div className="flex items-center gap-2 min-w-0">
          {/* 파일 네비게이션 */}
          {totalFiles > 1 && (
            <>
              <button
                type="button"
                onClick={() => handleFileChange('prev')}
                disabled={currentFileIndex === 0}
                className="w-8 h-8 flex items-center justify-center border border-[#1A1A1A] bg-[#F5F0E8] disabled:opacity-30 hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-xs font-bold text-[#1A1A1A] min-w-[48px] text-center">
                {currentFileIndex + 1}/{totalFiles}
              </span>
              <button
                type="button"
                onClick={() => handleFileChange('next')}
                disabled={currentFileIndex >= totalFiles - 1}
                className="w-8 h-8 flex items-center justify-center border border-[#1A1A1A] bg-[#F5F0E8] disabled:opacity-30 hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}
          <h2 className="font-bold text-sm text-[#1A1A1A] truncate max-w-[140px] sm:max-w-[280px]">
            {currentFile?.file.name || '이미지 영역 선택'}
          </h2>
        </div>

        {/* 완료/닫기 */}
        {extractedImages.length > 0 ? (
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-sm border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
          >
            완료 ({extractedImages.length})
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A]"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* ====== 크롭 영역 (다크 배경) ====== */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden flex items-center justify-center select-none touch-none min-h-0"
        style={{ cursor: originalImageUrl && !isLoadingPdf ? cursorStyle : 'default' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {isLoadingPdf ? (
          <div className="text-center text-[#999]">
            <svg className="w-10 h-10 mx-auto mb-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="font-bold text-sm">PDF 로딩 중...</p>
            {pdfTotalPages > 0 && (
              <p className="text-xs mt-1 opacity-70">{currentPdfPage} / {pdfTotalPages} 페이지</p>
            )}
          </div>
        ) : originalImageUrl ? (
          <div
            className="relative flex-shrink-0"
            style={{
              width: displaySize.width || 'auto',
              height: displaySize.height || 'auto',
              maxWidth: '100%',
              maxHeight: '100%',
            }}
          >
            {/* 이미지 */}
            <img
              ref={(el) => { displayImageRef.current = el; }}
              src={originalImageUrl}
              alt="선택 이미지"
              onLoad={handleDisplayImageLoad}
              className="block w-full h-full object-contain pointer-events-none"
              draggable={false}
            />

            {/* 선택 영역 + 주변 딤 처리 (box-shadow 트릭) */}
            {selection && selection.width > 0 && selection.height > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: selection.x * scale,
                  top: selection.y * scale,
                  width: selection.width * scale,
                  height: selection.height * scale,
                  boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
                  border: '2px solid rgba(255, 255, 255, 0.9)',
                  zIndex: 10,
                }}
              >
                {/* 사이즈 라벨 */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 bg-black/80 text-white text-[11px] px-2 py-0.5 font-bold whitespace-nowrap pointer-events-none"
                  style={{ top: -24 }}
                >
                  {Math.round(selection.width)} x {Math.round(selection.height)}
                </div>

                {/* 모서리 핸들 (터치 친화적 — 시각 7x7, 터치 영역은 getDragMode에서 36px) */}
                <div className="absolute -top-[5px] -left-[5px] w-[10px] h-[10px] bg-white border-2 border-[#333] shadow-sm pointer-events-none" />
                <div className="absolute -top-[5px] -right-[5px] w-[10px] h-[10px] bg-white border-2 border-[#333] shadow-sm pointer-events-none" />
                <div className="absolute -bottom-[5px] -left-[5px] w-[10px] h-[10px] bg-white border-2 border-[#333] shadow-sm pointer-events-none" />
                <div className="absolute -bottom-[5px] -right-[5px] w-[10px] h-[10px] bg-white border-2 border-[#333] shadow-sm pointer-events-none" />

                {/* 가장자리 중앙 핸들 (시각적 보조) */}
                <div className="absolute top-1/2 -left-[4px] -translate-y-1/2 w-[8px] h-[20px] bg-white/80 border border-[#333] pointer-events-none" />
                <div className="absolute top-1/2 -right-[4px] -translate-y-1/2 w-[8px] h-[20px] bg-white/80 border border-[#333] pointer-events-none" />
                <div className="absolute -top-[4px] left-1/2 -translate-x-1/2 w-[20px] h-[8px] bg-white/80 border border-[#333] pointer-events-none" />
                <div className="absolute -bottom-[4px] left-1/2 -translate-x-1/2 w-[20px] h-[8px] bg-white/80 border border-[#333] pointer-events-none" />

              </div>
            )}

            {/* 안내 텍스트 (선택 없을 때) */}
            {!selection && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/60 text-white px-5 py-3 text-center backdrop-blur-sm">
                  <svg className="w-6 h-6 mx-auto mb-1.5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="font-bold text-sm">드래그하여 영역 선택</p>
                  <p className="text-xs mt-1 opacity-70">모서리를 드래그하여 크기 조절</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-[#999]">
            <svg className="w-14 h-14 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="font-bold text-sm">이미지를 로드하는 중...</p>
          </div>
        )}
      </div>

      {/* ====== PDF 페이지 네비게이션 ====== */}
      {isPdf && pdfTotalPages > 1 && (
        <div className="flex-shrink-0 flex items-center justify-center gap-3 py-2 bg-[#2a2a2a] border-t border-[#3a3a3a]">
          <button
            type="button"
            onClick={() => handlePdfPageChange(currentPdfPage - 1)}
            disabled={currentPdfPage <= 1 || isLoadingPdf}
            className="w-9 h-9 flex items-center justify-center border border-[#555] bg-[#333] text-white disabled:opacity-30 hover:bg-[#555] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-bold text-white/90 min-w-[100px] text-center">
            {currentPdfPage} / {pdfTotalPages} 페이지
          </span>
          <button
            type="button"
            onClick={() => handlePdfPageChange(currentPdfPage + 1)}
            disabled={currentPdfPage >= pdfTotalPages || isLoadingPdf}
            className="w-9 h-9 flex items-center justify-center border border-[#555] bg-[#333] text-white disabled:opacity-30 hover:bg-[#555] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {/* ====== 하단 컨트롤 ====== */}
      <div className="flex-shrink-0 bg-[#F5F0E8] border-t-2 border-[#1A1A1A]">
        {/* 액션 버튼 */}
        <div className="flex gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => setSelection(null)}
            disabled={!selection}
            className="flex-1 py-2.5 text-sm font-bold border-2 border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
          >
            선택 초기화
          </button>
          <button
            type="button"
            onClick={handleExtractRegion}
            disabled={!hasValidSelection}
            className="flex-1 py-2.5 text-sm font-bold border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#333] transition-colors"
          >
            {extractFeedback ? '추출 완료!' : '영역 추출'}
          </button>
        </div>

        {/* 추출된 이미지 스트립 */}
        <div
          className={`px-3 pb-3 pt-1 border-t border-[#D4CFC4] transition-colors duration-300 ${
            extractFeedback ? 'bg-[#E8F5E9]' : 'bg-[#F5F0E8]'
          }`}
          style={{ paddingBottom: `calc(0.75rem + env(safe-area-inset-bottom, 0px))` }}
        >
          <p className="text-xs font-bold text-[#5C5C5C] mb-2">
            추출된 이미지 ({extractedImages.length}개)
          </p>

          {extractedImages.length === 0 ? (
            <p className="text-xs text-[#9A9A9A] py-1">영역을 선택하고 추출 버튼을 눌러주세요</p>
          ) : (
            <div className="flex gap-2.5 overflow-x-auto pt-2 pb-1 -mt-1" style={{ touchAction: 'pan-x' }}>
              {extractedImages.map((img, idx) => (
                <div
                  key={img.id}
                  className="relative flex-shrink-0 w-[72px] h-[72px] border-2 border-[#1A1A1A] bg-white cursor-pointer active:scale-95 transition-transform mr-0.5"
                  onClick={() => setPreviewImageId(img.id)}
                >
                  <img
                    src={img.dataUrl}
                    alt={`추출 ${idx + 1}`}
                    className="w-full h-full object-contain"
                    draggable={false}
                  />
                  {/* 번호 뱃지 */}
                  <div className="absolute top-0 left-0 bg-[#1A1A1A] text-[#F5F0E8] px-1.5 py-0.5 text-[10px] font-bold leading-none">
                    {idx + 1}
                  </div>
                  {/* 삭제 버튼 — 항상 표시 */}
                  {onRemoveExtracted && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRemoveExtracted(img.id); }}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-[#8B1A1A] text-white rounded-full flex items-center justify-center shadow-md active:scale-90 transition-transform"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ====== 이미지 미리보기 오버레이 ====== */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[60] bg-black/95 flex flex-col items-center justify-center p-4"
            onClick={() => setPreviewImageId(null)}
          >
            {/* 이미지 */}
            <motion.img
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.15 }}
              src={previewImage.dataUrl}
              alt="미리보기"
              className="max-w-full max-h-[70vh] object-contain border border-white/20"
              onClick={(e) => e.stopPropagation()}
              draggable={false}
            />

            {/* 파일명 */}
            {previewImage.sourceFileName && (
              <p className="text-white/50 text-xs mt-2 text-center">
                {previewImage.sourceFileName}
              </p>
            )}

            {/* 버튼 */}
            <div className="flex gap-3 mt-5">
              {onRemoveExtracted && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveExtracted(previewImage.id);
                    setPreviewImageId(null);
                  }}
                  className="px-5 py-2.5 bg-[#8B1A1A] text-white font-bold text-sm border-2 border-[#8B1A1A] hover:bg-[#a52020] active:scale-95 transition-all"
                >
                  삭제
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewImageId(null);
                }}
                className="px-5 py-2.5 bg-white/10 text-white font-bold text-sm border-2 border-white/30 hover:bg-white/20 active:scale-95 transition-all"
              >
                닫기
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
