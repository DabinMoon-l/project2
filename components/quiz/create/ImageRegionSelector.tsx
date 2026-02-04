'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import * as pdfjsLib from 'pdfjs-dist';

// PDF.js 워커 설정 (CDN 사용 - 로컬 파일보다 안정적)
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

// 터치/마우스 모드
type DragMode = 'none' | 'create' | 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br';

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
  // 파일 네비게이션 상태
  const [currentFileIndex, setCurrentFileIndex] = useState(0);

  // 선택 영역 상태
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);

  // PDF 관련 상태
  const [pdfCache, setPdfCache] = useState<PdfPageCache>({});
  const [currentPdfPage, setCurrentPdfPage] = useState(1);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);

  // 원본 이미지 (추출용)
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayImageRef = useRef<HTMLImageElement | null>(null);

  // 현재 선택된 파일
  const currentFile = uploadedFiles[currentFileIndex] || null;
  const isPdf = currentFile?.preview === 'pdf';
  const totalFiles = uploadedFiles.length;

  /**
   * PDF 파일 로드 (한 페이지씩 로드)
   */
  const loadPdfPage = useCallback(async (file: File, fileId: string, pageNum: number) => {
    setIsLoadingPdf(true);
    try {
      const arrayBuffer = await file.arrayBuffer();

      // PDF 문서 로드
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        cMapUrl: 'https://unpkg.com/pdfjs-dist@4.10.38/cmaps/',
        cMapPacked: true,
      });

      const pdf = await loadingTask.promise;
      const totalPages = pdf.numPages;

      setPdfTotalPages(totalPages);

      const page = await pdf.getPage(pageNum);
      // 고해상도 렌더링
      const viewport = page.getViewport({ scale: 2.5 });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas context failed');

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;

      const dataUrl = canvas.toDataURL('image/png');

      // 캐시에 저장
      setPdfCache((prev) => {
        const existing = prev[fileId] || { pages: [], totalPages };
        const newPages = [...existing.pages];
        newPages[pageNum - 1] = dataUrl;
        return {
          ...prev,
          [fileId]: {
            pages: newPages,
            totalPages,
          },
        };
      });

      setOriginalImageUrl(dataUrl);
    } catch (error) {
      console.error('PDF 로드 오류:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('worker')) {
        alert('PDF 워커 로딩 오류가 발생했습니다. 페이지를 새로고침 해주세요.');
      } else {
        alert('PDF 파일을 로드하는 중 오류가 발생했습니다.');
      }
    } finally {
      setIsLoadingPdf(false);
    }
  }, []);

  /**
   * 파일 변경 시
   */
  useEffect(() => {
    if (!currentFile) {
      setOriginalImageUrl(null);
      setPdfTotalPages(0);
      return;
    }

    setSelection(null);
    setCurrentPdfPage(1);

    if (currentFile.preview !== 'pdf') {
      setOriginalImageUrl(currentFile.preview);
      setPdfTotalPages(0);
    } else {
      // PDF 파일
      const cached = pdfCache[currentFile.id];
      if (cached && cached.pages[0]) {
        setOriginalImageUrl(cached.pages[0]);
        setPdfTotalPages(cached.totalPages);
      } else {
        loadPdfPage(currentFile.file, currentFile.id, 1);
      }
    }
  }, [currentFile, pdfCache, loadPdfPage]);

  /**
   * PDF 페이지 변경 시
   */
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

  /**
   * 파일 네비게이션
   */
  const handleFileChange = useCallback((direction: 'prev' | 'next') => {
    if (direction === 'prev' && currentFileIndex > 0) {
      setCurrentFileIndex(currentFileIndex - 1);
    } else if (direction === 'next' && currentFileIndex < totalFiles - 1) {
      setCurrentFileIndex(currentFileIndex + 1);
    }
  }, [currentFileIndex, totalFiles]);

  /**
   * 원본 이미지 로드 (추출용)
   */
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

    return () => {
      img.onload = null;
    };
  }, [originalImageUrl]);

  /**
   * 표시 이미지 로드 완료 시
   */
  const handleDisplayImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    displayImageRef.current = img;

    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;

    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const maxWidth = containerRect.width - 32;
      const maxHeight = containerRect.height - 32;

      const scaleX = maxWidth / naturalWidth;
      const scaleY = maxHeight / naturalHeight;
      const newScale = Math.min(scaleX, scaleY, 1);

      setScale(newScale);
      setDisplaySize({
        width: naturalWidth * newScale,
        height: naturalHeight * newScale,
      });
    }
  }, []);

  /**
   * 좌표 변환 (화면 → 이미지)
   */
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

  /**
   * 드래그 모드 판별 (선택 영역의 어느 부분을 터치했는지)
   */
  const getDragMode = useCallback((clientX: number, clientY: number): DragMode => {
    if (!selection || !displayImageRef.current) return 'create';

    const imgRect = displayImageRef.current.getBoundingClientRect();
    const handleSize = 30; // 터치 영역 크기 (모바일 친화적)

    // 선택 영역의 화면 좌표
    const selLeft = imgRect.left + selection.x * scale;
    const selTop = imgRect.top + selection.y * scale;
    const selRight = selLeft + selection.width * scale;
    const selBottom = selTop + selection.height * scale;

    // 모서리 체크 (터치 친화적으로 크게)
    const nearLeft = Math.abs(clientX - selLeft) < handleSize;
    const nearRight = Math.abs(clientX - selRight) < handleSize;
    const nearTop = Math.abs(clientY - selTop) < handleSize;
    const nearBottom = Math.abs(clientY - selBottom) < handleSize;

    if (nearTop && nearLeft) return 'resize-tl';
    if (nearTop && nearRight) return 'resize-tr';
    if (nearBottom && nearLeft) return 'resize-bl';
    if (nearBottom && nearRight) return 'resize-br';

    // 선택 영역 내부 체크 (이동)
    if (clientX >= selLeft && clientX <= selRight && clientY >= selTop && clientY <= selBottom) {
      return 'move';
    }

    return 'create';
  }, [selection, scale]);

  /**
   * 드래그 시작
   */
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
    setDragStart(coords);

    if (mode === 'create') {
      setSelection({ x: coords.x, y: coords.y, width: 0, height: 0 });
    }
  }, [getImageCoords, getDragMode, originalImageUrl]);

  /**
   * 드래그 중
   */
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
      }

      // 최소 크기 보장
      if (newW >= 20 && newH >= 20) {
        setSelection({ x: newX, y: newY, width: newW, height: newH });
      }
    }
  }, [dragMode, selection, dragStart, getImageCoords, imageSize]);

  /**
   * 드래그 종료
   */
  const handleDragEnd = useCallback(() => {
    setDragMode('none');
  }, []);

  // 마우스 이벤트
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    handleDragStart(e.clientX, e.clientY);
  }, [handleDragStart]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    handleDragMove(e.clientX, e.clientY);
  }, [handleDragMove]);

  const handleMouseUp = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // 터치 이벤트
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      handleDragStart(touch.clientX, touch.clientY);
    }
  }, [handleDragStart]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      e.preventDefault();
      const touch = e.touches[0];
      handleDragMove(touch.clientX, touch.clientY);
    }
  }, [handleDragMove]);

  const handleTouchEnd = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  /**
   * 선택 영역 추출
   */
  const handleExtractRegion = useCallback(() => {
    if (!selection || !originalImageRef.current || !canvasRef.current) return;

    if (selection.width < 10 || selection.height < 10) {
      alert('선택 영역이 너무 작습니다.');
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    canvas.width = Math.round(selection.width);
    canvas.height = Math.round(selection.height);
    ctx.imageSmoothingEnabled = false;

    ctx.drawImage(
      originalImageRef.current,
      Math.round(selection.x),
      Math.round(selection.y),
      Math.round(selection.width),
      Math.round(selection.height),
      0,
      0,
      Math.round(selection.width),
      Math.round(selection.height)
    );

    const dataUrl = canvas.toDataURL('image/png');

    let fileName = currentFile?.file.name || '이미지';
    if (isPdf) {
      fileName = `${fileName} (${currentPdfPage}페이지)`;
    }

    onExtract(dataUrl, fileName);
    setSelection(null);
  }, [selection, onExtract, currentFile, isPdf, currentPdfPage]);

  const hasValidSelection = selection && selection.width >= 10 && selection.height >= 10;

  // 파일이 없으면 안내 메시지 표시
  if (uploadedFiles.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80"
        />
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6 max-w-sm text-center"
        >
          <p className="text-[#1A1A1A] mb-4">선택된 파일이 없습니다.</p>
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-[#1A1A1A] text-[#F5F0E8] font-bold"
          >
            닫기
          </button>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80"
      />

      <canvas ref={canvasRef} className="hidden" />

      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] w-full max-w-4xl h-[95vh] overflow-hidden flex flex-col"
      >
        {/* 헤더 - 파일 네비게이션 포함 */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b-2 border-[#1A1A1A] bg-[#EDEAE4]">
          <div className="flex items-center gap-3">
            {/* 파일 이동 버튼 (여러 파일일 때만) */}
            {totalFiles > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => handleFileChange('prev')}
                  disabled={currentFileIndex === 0}
                  className="w-8 h-8 flex items-center justify-center border border-[#1A1A1A] bg-[#F5F0E8] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-sm font-bold text-[#1A1A1A] min-w-[80px] text-center">
                  {currentFileIndex + 1} / {totalFiles}
                </span>
                <button
                  type="button"
                  onClick={() => handleFileChange('next')}
                  disabled={currentFileIndex === totalFiles - 1}
                  className="w-8 h-8 flex items-center justify-center border border-[#1A1A1A] bg-[#F5F0E8] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}
            <h2 className="font-bold text-[#1A1A1A] truncate max-w-[150px] sm:max-w-[250px]">
              {currentFile?.file.name || '이미지 영역 선택'}
            </h2>
          </div>
          {/* 닫기/완료 버튼 - 추출된 이미지가 있으면 완료 버튼으로 표시 */}
          {extractedImages.length > 0 ? (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-sm border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
            >
              완료({extractedImages.length})
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A]"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* 이미지 뷰어 */}
        <div className="flex-1 flex flex-col bg-[#D4CFC4] min-h-0 overflow-hidden">
          <div
            ref={containerRef}
            className={`flex-1 overflow-auto flex items-center justify-center p-4 select-none touch-none
              ${originalImageUrl && !isLoadingPdf ? 'cursor-crosshair' : ''}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {isLoadingPdf ? (
              <div className="text-center text-[#5C5C5C]">
                <svg className="w-12 h-12 mx-auto mb-3 animate-spin text-[#1A1A1A]" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <p className="font-bold">PDF 로딩 중...</p>
                {isPdf && pdfTotalPages > 0 && (
                  <p className="text-sm mt-1">{currentPdfPage} / {pdfTotalPages} 페이지</p>
                )}
              </div>
            ) : originalImageUrl ? (
              <div
                className="relative bg-white border-2 border-[#1A1A1A] shadow-lg flex-shrink-0"
                style={{
                  width: displaySize.width || 'auto',
                  height: displaySize.height || 'auto',
                  maxWidth: '100%',
                  maxHeight: '100%',
                }}
              >
                <img
                  ref={displayImageRef}
                  src={originalImageUrl}
                  alt="선택 이미지"
                  onLoad={handleDisplayImageLoad}
                  className="block w-full h-full object-contain pointer-events-none"
                  draggable={false}
                />

                {/* 선택 영역 */}
                {selection && (
                  <div
                    className="absolute border-2 border-dashed border-[#1A1A1A] bg-[#1A1A1A]/10"
                    style={{
                      left: selection.x * scale,
                      top: selection.y * scale,
                      width: selection.width * scale,
                      height: selection.height * scale,
                    }}
                  >
                    {/* 크기 표시 */}
                    <div className="absolute -top-7 left-0 bg-[#1A1A1A] text-[#F5F0E8] text-xs px-2 py-1 font-bold whitespace-nowrap">
                      {Math.round(selection.width)} x {Math.round(selection.height)}
                    </div>
                    {/* 모서리 핸들 (터치 친화적) */}
                    <div className="absolute -top-3 -left-3 w-6 h-6 bg-[#1A1A1A] border-2 border-[#F5F0E8]" />
                    <div className="absolute -top-3 -right-3 w-6 h-6 bg-[#1A1A1A] border-2 border-[#F5F0E8]" />
                    <div className="absolute -bottom-3 -left-3 w-6 h-6 bg-[#1A1A1A] border-2 border-[#F5F0E8]" />
                    <div className="absolute -bottom-3 -right-3 w-6 h-6 bg-[#1A1A1A] border-2 border-[#F5F0E8]" />
                    {/* 이동 아이콘 (중앙) */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="bg-[#1A1A1A]/50 rounded-full p-2">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                      </div>
                    </div>
                  </div>
                )}

                {/* 안내 텍스트 */}
                {!selection && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-[#1A1A1A]/70 text-[#F5F0E8] px-4 py-3 text-center">
                      <p className="font-bold">드래그하여 영역 선택</p>
                      <p className="text-xs mt-1 opacity-80">선택 후 모서리를 드래그하여 조절</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-[#5C5C5C]">
                <svg className="w-16 h-16 mx-auto mb-3 text-[#B0A99F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="font-bold">이미지를 로드하는 중...</p>
              </div>
            )}
          </div>

          {/* PDF 페이지 네비게이션 (PDF일 때만) */}
          {isPdf && pdfTotalPages > 1 && (
            <div className="flex-shrink-0 flex items-center justify-center gap-4 py-3 bg-[#EDEAE4] border-t border-[#D4CFC4]">
              <button
                type="button"
                onClick={() => handlePdfPageChange(currentPdfPage - 1)}
                disabled={currentPdfPage <= 1 || isLoadingPdf}
                className="w-10 h-10 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#F5F0E8] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-sm font-bold text-[#1A1A1A] min-w-[120px] text-center">
                페이지 {currentPdfPage} / {pdfTotalPages}
              </span>
              <button
                type="button"
                onClick={() => handlePdfPageChange(currentPdfPage + 1)}
                disabled={currentPdfPage >= pdfTotalPages || isLoadingPdf}
                className="w-10 h-10 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#F5F0E8] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* 액션 버튼 */}
        <div className="flex-shrink-0 border-t-2 border-[#1A1A1A] bg-[#EDEAE4] px-4 py-3">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setSelection(null)}
              disabled={!selection}
              className="flex-1 py-3 text-sm font-bold border-2 border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
            >
              선택 초기화
            </button>
            <button
              type="button"
              onClick={handleExtractRegion}
              disabled={!hasValidSelection}
              className="flex-1 py-3 text-sm font-bold border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#333] transition-colors"
            >
              영역 추출
            </button>
          </div>
        </div>

        {/* 추출된 이미지 */}
        <div className="flex-shrink-0 border-t-2 border-[#1A1A1A] bg-[#F5F0E8] px-4 py-3">
          <p className="text-xs font-bold text-[#5C5C5C] mb-2">추출된 이미지 ({extractedImages.length}개)</p>
          {extractedImages.length === 0 ? (
            <p className="text-sm text-[#5C5C5C]">아직 추출된 이미지가 없습니다.</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {extractedImages.map((img, idx) => (
                <div
                  key={img.id}
                  className="relative flex-shrink-0 w-16 h-16 border-2 border-[#1A1A1A] bg-white overflow-hidden group"
                >
                  <img src={img.dataUrl} alt={`추출 ${idx + 1}`} className="w-full h-full object-contain" />
                  <div className="absolute top-0.5 left-0.5 bg-[#1A1A1A] text-[#F5F0E8] px-1 py-0.5 text-[10px] font-bold">
                    {idx + 1}
                  </div>
                  {onRemoveExtracted && (
                    <button
                      type="button"
                      onClick={() => onRemoveExtracted(img.id)}
                      className="absolute top-0.5 right-0.5 w-6 h-6 bg-[#8B1A1A] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
