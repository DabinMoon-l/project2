'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { scaleCoord } from '@/lib/hooks/useViewportScale';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

// ============================================================
// 타입 정의
// ============================================================

/** 추출된 이미지 데이터 */
interface ExtractedImageData {
  id: string;
  dataUrl: string;
  sourceFileName?: string;
}

/** 크롭 영역 */
interface CropArea {
  x: number;      // 좌상단 x (픽셀)
  y: number;      // 좌상단 y (픽셀)
  width: number;  // 너비 (픽셀)
  height: number; // 높이 (픽셀)
}

/** 현재 화면 상태 */
type ViewState = 'list' | 'crop' | 'preview';

interface ExtractedImagePickerProps {
  /** 추출된 이미지 목록 */
  extractedImages: ExtractedImageData[];
  /** 이미지 선택 시 콜백 */
  onSelect: (dataUrl: string) => void;
  /** 닫기 콜백 */
  onClose: () => void;
  /** 이미지 삭제 콜백 (선택) */
  onRemove?: (id: string) => void;
  /** 크롭 이미지를 추출 이미지 풀에 추가하는 콜백 (선택) */
  onAddExtracted?: (dataUrl: string, sourceFileName?: string) => void;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 추출된 이미지 선택 모달 (크롭 기능 포함)
 *
 * 플로우:
 * 1. 이미지 목록 → "수정" → 크롭 모달
 * 2. 크롭 모달 → "자르기" → 크롭 미리보기
 * 3. 크롭 미리보기 → "다시 자르기" → 크롭 모달 (원본)
 * 4. 크롭 미리보기 → "선택" → 이미지 목록 (크롭 이미지 포함)
 * 5. 이미지 목록 → "선택" → 삽입 + 모달 닫힘
 */
export default function ExtractedImagePicker({
  extractedImages,
  onSelect,
  onClose,
  onRemove,
  onAddExtracted,
}: ExtractedImagePickerProps) {
  // ============================================================
  // 상태 관리
  // ============================================================

  // 현재 화면 상태
  const [viewState, setViewState] = useState<ViewState>('list');

  // 크롭 관련 상태
  const [cropSourceImage, setCropSourceImage] = useState<ExtractedImageData | null>(null);
  const [cropArea, setCropArea] = useState<CropArea | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  // 크롭 완료된 이미지 (미리보기 및 목록에 추가될 이미지)
  const [croppedImage, setCroppedImage] = useState<ExtractedImageData | null>(null);

  // 드래그 상태
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState<'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [initialCrop, setInitialCrop] = useState<CropArea | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // body 스크롤 방지
  useEffect(() => {
    lockScroll();
    return () => {
      unlockScroll();
    };
  }, []);

  // ============================================================
  // 드래그 이벤트 핸들러
  // ============================================================

  // 터치/마우스 이벤트 좌표 계산
  const getEventPosition = useCallback((e: MouseEvent | TouchEvent): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };

    if ('touches' in e && e.touches.length > 0) {
      return {
        x: scaleCoord(e.touches[0].clientX) - rect.left,
        y: scaleCoord(e.touches[0].clientY) - rect.top,
      };
    } else if ('clientX' in e) {
      return {
        x: scaleCoord(e.clientX) - rect.left,
        y: scaleCoord(e.clientY) - rect.top,
      };
    }
    return { x: 0, y: 0 };
  }, []);

  // 드래그 이동 처리
  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDragging || !dragStart || !initialCrop || !imageSize) return;

    e.preventDefault();
    const pos = getEventPosition(e);
    const dx = pos.x - dragStart.x;
    const dy = pos.y - dragStart.y;

    let newCrop = { ...initialCrop };
    const minSize = 30;

    switch (dragType) {
      case 'move':
        newCrop.x = Math.max(0, Math.min(imageSize.width - initialCrop.width, initialCrop.x + dx));
        newCrop.y = Math.max(0, Math.min(imageSize.height - initialCrop.height, initialCrop.y + dy));
        break;
      case 'nw':
        newCrop.x = Math.max(0, Math.min(initialCrop.x + initialCrop.width - minSize, initialCrop.x + dx));
        newCrop.y = Math.max(0, Math.min(initialCrop.y + initialCrop.height - minSize, initialCrop.y + dy));
        newCrop.width = initialCrop.width - (newCrop.x - initialCrop.x);
        newCrop.height = initialCrop.height - (newCrop.y - initialCrop.y);
        break;
      case 'ne':
        newCrop.y = Math.max(0, Math.min(initialCrop.y + initialCrop.height - minSize, initialCrop.y + dy));
        newCrop.width = Math.max(minSize, Math.min(imageSize.width - initialCrop.x, initialCrop.width + dx));
        newCrop.height = initialCrop.height - (newCrop.y - initialCrop.y);
        break;
      case 'sw':
        newCrop.x = Math.max(0, Math.min(initialCrop.x + initialCrop.width - minSize, initialCrop.x + dx));
        newCrop.width = initialCrop.width - (newCrop.x - initialCrop.x);
        newCrop.height = Math.max(minSize, Math.min(imageSize.height - initialCrop.y, initialCrop.height + dy));
        break;
      case 'se':
        newCrop.width = Math.max(minSize, Math.min(imageSize.width - initialCrop.x, initialCrop.width + dx));
        newCrop.height = Math.max(minSize, Math.min(imageSize.height - initialCrop.y, initialCrop.height + dy));
        break;
      case 'n':
        newCrop.y = Math.max(0, Math.min(initialCrop.y + initialCrop.height - minSize, initialCrop.y + dy));
        newCrop.height = initialCrop.height - (newCrop.y - initialCrop.y);
        break;
      case 's':
        newCrop.height = Math.max(minSize, Math.min(imageSize.height - initialCrop.y, initialCrop.height + dy));
        break;
      case 'w':
        newCrop.x = Math.max(0, Math.min(initialCrop.x + initialCrop.width - minSize, initialCrop.x + dx));
        newCrop.width = initialCrop.width - (newCrop.x - initialCrop.x);
        break;
      case 'e':
        newCrop.width = Math.max(minSize, Math.min(imageSize.width - initialCrop.x, initialCrop.width + dx));
        break;
    }

    setCropArea(newCrop);
  }, [isDragging, dragStart, initialCrop, imageSize, dragType, getEventPosition]);

  // 드래그 종료 처리
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragType(null);
    setDragStart(null);
    setInitialCrop(null);
  }, []);

  // 드래그 이벤트 리스너 등록/해제
  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent | TouchEvent) => handleDragMove(e);
    const handleEnd = () => handleDragEnd();

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  // ============================================================
  // 액션 핸들러
  // ============================================================

  // 이미지 로드 시 크롭 영역 초기화
  const handleImageLoad = useCallback(() => {
    if (imageRef.current) {
      const { width, height } = imageRef.current;
      setImageSize({ width, height });
      setCropArea({ x: 0, y: 0, width, height });
    }
  }, []);

  // 드래그 시작
  const handleDragStart = useCallback((
    e: React.MouseEvent | React.TouchEvent,
    type: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    let x: number, y: number;
    if ('touches' in e && e.touches.length > 0) {
      x = scaleCoord(e.touches[0].clientX) - rect.left;
      y = scaleCoord(e.touches[0].clientY) - rect.top;
    } else if ('clientX' in e) {
      x = scaleCoord(e.clientX) - rect.left;
      y = scaleCoord(e.clientY) - rect.top;
    } else {
      return;
    }

    setIsDragging(true);
    setDragType(type);
    setDragStart({ x, y });
    setInitialCrop(cropArea);
  }, [cropArea]);

  // 크롭 모드 시작 (수정 버튼)
  const handleStartCrop = useCallback((img: ExtractedImageData) => {
    setCropSourceImage(img);
    setCropArea(null);
    setImageSize(null);
    setViewState('crop');
  }, []);

  // 크롭 모드 취소
  const handleCancelCrop = useCallback(() => {
    setCropSourceImage(null);
    setCropArea(null);
    setImageSize(null);
    setViewState('list');
  }, []);

  // 자르기 실행
  const handleCrop = useCallback(() => {
    if (!cropSourceImage || !cropArea || !imageRef.current) {
      console.error('크롭 실행 실패: 필수 데이터 없음', { cropSourceImage, cropArea, imageRef: imageRef.current });
      return;
    }

    const img = imageRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      console.error('크롭 실행 실패: 캔버스 컨텍스트 없음');
      return;
    }

    // 실제 이미지 크기와 표시 크기의 비율 계산
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;

    // 크롭 영역을 실제 이미지 크기에 맞게 변환
    const realCrop = {
      x: cropArea.x * scaleX,
      y: cropArea.y * scaleY,
      width: cropArea.width * scaleX,
      height: cropArea.height * scaleY,
    };

    canvas.width = realCrop.width;
    canvas.height = realCrop.height;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(
      img,
      realCrop.x,
      realCrop.y,
      realCrop.width,
      realCrop.height,
      0,
      0,
      realCrop.width,
      realCrop.height
    );

    const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.95);

    // 크롭된 이미지 생성
    const newCroppedImage: ExtractedImageData = {
      id: `cropped-${Date.now()}`,
      dataUrl: croppedDataUrl,
      sourceFileName: cropSourceImage.sourceFileName ? `${cropSourceImage.sourceFileName} (크롭)` : '크롭된 이미지',
    };

    setCroppedImage(newCroppedImage);
    setViewState('preview');
  }, [cropSourceImage, cropArea]);

  // 다시 자르기 (미리보기에서)
  const handleRecrop = useCallback(() => {
    // 원본 이미지로 크롭 모달 다시 열기
    setCroppedImage(null);
    setCropArea(null);
    setImageSize(null);
    setViewState('crop');
  }, []);

  // 크롭된 이미지 선택 (미리보기에서) → 풀에 저장 + 목록으로 돌아감
  const handleSelectCroppedToList = useCallback(() => {
    // 크롭 이미지를 추출 이미지 풀에 영구 저장
    if (croppedImage && onAddExtracted) {
      onAddExtracted(croppedImage.dataUrl, croppedImage.sourceFileName);
    }
    setCroppedImage(null);
    setViewState('list');
  }, [croppedImage, onAddExtracted]);

  // 최종 이미지 선택 (목록에서) → 삽입 + 모달 닫힘
  const handleFinalSelect = useCallback((img: ExtractedImageData) => {
    onSelect(img.dataUrl);
    // 상태 초기화
    setCroppedImage(null);
    setCropSourceImage(null);
  }, [onSelect]);

  // 모달 닫기
  const handleClose = useCallback(() => {
    // 상태 초기화
    setCroppedImage(null);
    setCropSourceImage(null);
    setCropArea(null);
    setImageSize(null);
    setViewState('list');
    onClose();
  }, [onClose]);

  // ============================================================
  // 렌더링: 크롭 모드
  // ============================================================
  if (viewState === 'crop' && cropSourceImage) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        {/* 백드롭 */}
        <div className="absolute inset-0 bg-black/80" />

        {/* 크롭 모달 */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b-2 border-[#1A1A1A]">
            <h2 className="font-bold text-[#1A1A1A]">이미지 자르기</h2>
            <button
              type="button"
              onClick={handleCancelCrop}
              className="w-8 h-8 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 크롭 영역 */}
          <div className="flex-1 overflow-hidden p-4 bg-[#2A2A2A] flex items-center justify-center">
            <div
              ref={containerRef}
              className="relative inline-block"
              style={{ touchAction: 'none' }}
            >
              {/* 원본 이미지 */}
              <img
                ref={imageRef}
                src={cropSourceImage.dataUrl}
                alt="크롭할 이미지"
                onLoad={handleImageLoad}
                className="max-w-full max-h-[50vh] object-contain"
                draggable={false}
              />

              {/* 크롭 오버레이 */}
              {cropArea && imageSize && (
                <>
                  {/* 어두운 영역 (크롭 외부) */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: `linear-gradient(to right,
                        rgba(0,0,0,0.6) ${(cropArea.x / imageSize.width) * 100}%,
                        transparent ${(cropArea.x / imageSize.width) * 100}%,
                        transparent ${((cropArea.x + cropArea.width) / imageSize.width) * 100}%,
                        rgba(0,0,0,0.6) ${((cropArea.x + cropArea.width) / imageSize.width) * 100}%
                      )`,
                    }}
                  />
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: cropArea.x,
                      top: 0,
                      width: cropArea.width,
                      height: cropArea.y,
                      backgroundColor: 'rgba(0,0,0,0.6)',
                    }}
                  />
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: cropArea.x,
                      top: cropArea.y + cropArea.height,
                      width: cropArea.width,
                      height: imageSize.height - cropArea.y - cropArea.height,
                      backgroundColor: 'rgba(0,0,0,0.6)',
                    }}
                  />

                  {/* 크롭 영역 테두리 */}
                  <div
                    className="absolute border-2 border-white cursor-move"
                    style={{
                      left: cropArea.x,
                      top: cropArea.y,
                      width: cropArea.width,
                      height: cropArea.height,
                    }}
                    onMouseDown={(e) => handleDragStart(e, 'move')}
                    onTouchStart={(e) => handleDragStart(e, 'move')}
                  >
                    {/* 그리드 라인 */}
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/40" />
                      <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/40" />
                      <div className="absolute top-1/3 left-0 right-0 h-px bg-white/40" />
                      <div className="absolute top-2/3 left-0 right-0 h-px bg-white/40" />
                    </div>

                    {/* 코너 핸들 */}
                    <div
                      className="absolute -left-2 -top-2 w-5 h-5 bg-white border border-[#1A1A1A] cursor-nw-resize"
                      onMouseDown={(e) => handleDragStart(e, 'nw')}
                      onTouchStart={(e) => handleDragStart(e, 'nw')}
                    />
                    <div
                      className="absolute -right-2 -top-2 w-5 h-5 bg-white border border-[#1A1A1A] cursor-ne-resize"
                      onMouseDown={(e) => handleDragStart(e, 'ne')}
                      onTouchStart={(e) => handleDragStart(e, 'ne')}
                    />
                    <div
                      className="absolute -left-2 -bottom-2 w-5 h-5 bg-white border border-[#1A1A1A] cursor-sw-resize"
                      onMouseDown={(e) => handleDragStart(e, 'sw')}
                      onTouchStart={(e) => handleDragStart(e, 'sw')}
                    />
                    <div
                      className="absolute -right-2 -bottom-2 w-5 h-5 bg-white border border-[#1A1A1A] cursor-se-resize"
                      onMouseDown={(e) => handleDragStart(e, 'se')}
                      onTouchStart={(e) => handleDragStart(e, 'se')}
                    />

                    {/* 가장자리 핸들 */}
                    <div
                      className="absolute left-1/2 -translate-x-1/2 -top-2 w-8 h-4 bg-white border border-[#1A1A1A] cursor-n-resize"
                      onMouseDown={(e) => handleDragStart(e, 'n')}
                      onTouchStart={(e) => handleDragStart(e, 'n')}
                    />
                    <div
                      className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-8 h-4 bg-white border border-[#1A1A1A] cursor-s-resize"
                      onMouseDown={(e) => handleDragStart(e, 's')}
                      onTouchStart={(e) => handleDragStart(e, 's')}
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -left-2 w-4 h-8 bg-white border border-[#1A1A1A] cursor-w-resize"
                      onMouseDown={(e) => handleDragStart(e, 'w')}
                      onTouchStart={(e) => handleDragStart(e, 'w')}
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -right-2 w-4 h-8 bg-white border border-[#1A1A1A] cursor-e-resize"
                      onMouseDown={(e) => handleDragStart(e, 'e')}
                      onTouchStart={(e) => handleDragStart(e, 'e')}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 안내 */}
          <div className="px-4 py-2 bg-[#EDEAE4] border-t border-[#D4CFC4]">
            <p className="text-xs text-[#5C5C5C] text-center">
              모서리나 가장자리를 드래그하여 영역 조절
            </p>
          </div>

          {/* 버튼 */}
          <div className="flex gap-2 px-4 py-3 border-t-2 border-[#1A1A1A]">
            <button
              type="button"
              onClick={handleCancelCrop}
              className="flex-1 py-2.5 text-sm font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleCrop}
              disabled={!cropArea}
              className="flex-1 py-2.5 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#2A2A2A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              자르기
            </button>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  // ============================================================
  // 렌더링: 크롭 미리보기
  // ============================================================
  if (viewState === 'preview' && croppedImage) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        {/* 백드롭 */}
        <div className="absolute inset-0 bg-black/80" />

        {/* 미리보기 모달 */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b-2 border-[#1A1A1A]">
            <h2 className="font-bold text-[#1A1A1A]">크롭 완료</h2>
            <button
              type="button"
              onClick={handleSelectCroppedToList}
              className="w-8 h-8 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 미리보기 이미지 */}
          <div className="flex-1 overflow-auto overscroll-contain p-4 bg-[#2A2A2A] flex items-center justify-center">
            <img
              src={croppedImage.dataUrl}
              alt="크롭된 이미지"
              className="max-w-full max-h-[50vh] object-contain border-2 border-white"
            />
          </div>

          {/* 안내 */}
          <div className="px-4 py-2 bg-[#EDEAE4] border-t border-[#D4CFC4]">
            <p className="text-xs text-[#5C5C5C] text-center">
              이미지를 확인하세요
            </p>
          </div>

          {/* 버튼 */}
          <div className="flex gap-2 px-4 py-3 border-t-2 border-[#1A1A1A]">
            <button
              type="button"
              onClick={handleRecrop}
              className="flex-1 py-2.5 text-sm font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              다시 자르기
            </button>
            <button
              type="button"
              onClick={handleSelectCroppedToList}
              className="flex-1 py-2.5 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#2A2A2A] transition-colors"
            >
              선택
            </button>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  // ============================================================
  // 렌더링: 이미지 목록
  // ============================================================

  // 크롭된 이미지가 있으면 목록 맨 앞에 추가
  const displayImages = croppedImage
    ? [croppedImage, ...extractedImages]
    : extractedImages;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* 백드롭 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/70"
        onClick={handleClose}
      />

      {/* 모달 */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b-2 border-[#1A1A1A]">
          <h2 className="font-bold text-[#1A1A1A]">추출 이미지 선택</h2>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 내용 — 4개(2행)까지 보이고 이후 스크롤 */}
        <div
          className="overflow-y-auto overscroll-contain p-4"
          style={{
            maxHeight: 'min(55vh, 500px)',
            // 5개+ 이미지일 때 스크롤바 항상 표시
            ...(displayImages.length > 4 ? { scrollbarWidth: 'thin', scrollbarColor: '#999 transparent' } : {}),
          }}
        >
          {displayImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <svg className="w-16 h-16 mb-4 text-[#D4CFC4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-[#5C5C5C] text-center">
                추출된 이미지가 없습니다.<br />
                <span className="text-sm">이미지 영역 선택에서 먼저 추출해주세요.</span>
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {displayImages.map((img, idx) => {
                const isCropped = img.id.startsWith('cropped-');

                return (
                  <div
                    key={img.id}
                    className={`relative group border-2 ${isCropped ? 'border-[#1A6B1A]' : 'border-[#1A1A1A]'} bg-white`}
                  >
                    {/* 이미지 미리보기 */}
                    <div className="w-full aspect-square overflow-hidden">
                      <img
                        src={img.dataUrl}
                        alt={`추출 이미지 ${idx + 1}`}
                        className="w-full h-full object-contain"
                      />
                    </div>

                    {/* 번호/크롭 뱃지 */}
                    <div className={`absolute top-1 left-1 ${isCropped ? 'bg-[#1A6B1A]' : 'bg-[#1A1A1A]'} text-[#F5F0E8] px-2 py-0.5 text-xs font-bold`}>
                      {isCropped ? '크롭' : idx + 1}
                    </div>

                    {/* 삭제 버튼 — 카드 내부 우측상단, 잘리지 않게 */}
                    {!isCropped && onRemove && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(img.id);
                        }}
                        className="absolute top-1 right-1 w-6 h-6 bg-[#8B1A1A] text-white rounded-full flex items-center justify-center shadow-md active:scale-90 transition-transform z-10"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}

                    {/* 출처 */}
                    {img.sourceFileName && (
                      <div className="absolute bottom-[52px] left-0 right-0 bg-black/60 px-2 py-1">
                        <p className="text-white text-[10px] truncate">{img.sourceFileName}</p>
                      </div>
                    )}

                    {/* 버튼 영역 */}
                    <div className="flex border-t-2 border-[#1A1A1A]">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFinalSelect(img);
                        }}
                        className={`flex-1 py-2 text-xs font-bold ${isCropped ? 'bg-[#1A6B1A]' : 'bg-[#1A1A1A]'} text-[#F5F0E8] hover:opacity-80 transition-opacity`}
                      >
                        선택
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartCrop(img);
                        }}
                        className="flex-1 py-2 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border-l-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                      >
                        수정
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 하단 안내 */}
        {displayImages.length > 0 && (
          <div className="flex-shrink-0 px-4 py-3 border-t border-[#D4CFC4] bg-[#EDEAE4]">
            <p className="text-xs text-[#5C5C5C] text-center">
              &quot;선택&quot;으로 바로 삽입 / &quot;수정&quot;으로 크롭 후 삽입
            </p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
