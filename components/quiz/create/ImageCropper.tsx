'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { scaleCoord } from '@/lib/hooks/useViewportScale';

// ============================================================
// 타입 정의
// ============================================================

interface CropArea {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface ImageCropperProps {
  /** 크롭할 이미지 소스 (URL 또는 base64) */
  imageSource: string;
  /** 크롭 완료 시 콜백 */
  onCrop: (croppedImage: string) => void;
  /** 닫기 콜백 */
  onClose: () => void;
  /** 모달 타이틀 */
  title?: string;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 이미지 크롭 컴포넌트
 *
 * 사용자가 드래그로 영역을 선택하면 해당 영역을 크롭하여 반환합니다.
 * 표, 그림, 그래프 등을 수동으로 선택할 때 사용합니다.
 */
export default function ImageCropper({
  imageSource,
  onCrop,
  onClose,
  title = '이미지 영역 선택',
}: ImageCropperProps) {
  // 상태
  const [isSelecting, setIsSelecting] = useState(false);
  const [cropArea, setCropArea] = useState<CropArea | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /**
   * 이미지 로드 완료 시
   */
  const handleImageLoad = useCallback(() => {
    if (imageRef.current && containerRef.current) {
      const img = imageRef.current;
      const container = containerRef.current;

      // 컨테이너에 맞게 스케일 계산
      const containerWidth = container.clientWidth - 32; // padding 고려
      const containerHeight = container.clientHeight - 150; // 버튼 영역 고려

      const scaleX = containerWidth / img.naturalWidth;
      const scaleY = containerHeight / img.naturalHeight;
      const newScale = Math.min(scaleX, scaleY, 1); // 최대 1배

      setScale(newScale);
      setImageSize({
        width: img.naturalWidth * newScale,
        height: img.naturalHeight * newScale,
      });
    }
  }, []);

  /**
   * 마우스/터치 좌표를 이미지 좌표로 변환
   */
  const getImageCoordinates = useCallback((clientX: number, clientY: number) => {
    if (!imageRef.current) return { x: 0, y: 0 };

    const rect = imageRef.current.getBoundingClientRect();
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;

    return {
      x: Math.max(0, Math.min(x, imageRef.current.naturalWidth)),
      y: Math.max(0, Math.min(y, imageRef.current.naturalHeight)),
    };
  }, [scale]);

  /**
   * 선택 시작
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const { x, y } = getImageCoordinates(scaleCoord(e.clientX), scaleCoord(e.clientY));

    setIsSelecting(true);
    setCropArea({
      startX: x,
      startY: y,
      endX: x,
      endY: y,
    });
  }, [getImageCoordinates]);

  /**
   * 선택 중 (드래그)
   */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isSelecting || !cropArea) return;

    const { x, y } = getImageCoordinates(scaleCoord(e.clientX), scaleCoord(e.clientY));

    setCropArea((prev) => prev ? {
      ...prev,
      endX: x,
      endY: y,
    } : null);
  }, [isSelecting, cropArea, getImageCoordinates]);

  /**
   * 선택 완료
   */
  const handleMouseUp = useCallback(() => {
    setIsSelecting(false);
  }, []);

  /**
   * 터치 이벤트 핸들러
   */
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const { x, y } = getImageCoordinates(scaleCoord(touch.clientX), scaleCoord(touch.clientY));

    setIsSelecting(true);
    setCropArea({
      startX: x,
      startY: y,
      endX: x,
      endY: y,
    });
  }, [getImageCoordinates]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isSelecting || !cropArea || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const { x, y } = getImageCoordinates(scaleCoord(touch.clientX), scaleCoord(touch.clientY));

    setCropArea((prev) => prev ? {
      ...prev,
      endX: x,
      endY: y,
    } : null);
  }, [isSelecting, cropArea, getImageCoordinates]);

  const handleTouchEnd = useCallback(() => {
    setIsSelecting(false);
  }, []);

  /**
   * 크롭 실행
   */
  const handleCrop = useCallback(() => {
    if (!cropArea || !imageRef.current || !canvasRef.current) return;

    const img = imageRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 정규화된 좌표 (시작점이 항상 왼쪽 위)
    const x = Math.min(cropArea.startX, cropArea.endX);
    const y = Math.min(cropArea.startY, cropArea.endY);
    const width = Math.abs(cropArea.endX - cropArea.startX);
    const height = Math.abs(cropArea.endY - cropArea.startY);

    // 최소 크기 체크
    if (width < 10 || height < 10) {
      alert('선택 영역이 너무 작습니다.');
      return;
    }

    // 캔버스 크기 설정
    canvas.width = width;
    canvas.height = height;

    // 이미지 크롭
    ctx.drawImage(
      img,
      x, y, width, height, // 소스 영역
      0, 0, width, height  // 대상 영역
    );

    // Base64로 변환
    const croppedImage = canvas.toDataURL('image/png');
    onCrop(croppedImage);
  }, [cropArea, onCrop]);

  /**
   * 선택 영역 초기화
   */
  const handleReset = useCallback(() => {
    setCropArea(null);
  }, []);

  /**
   * 선택 영역 스타일 계산
   */
  const getSelectionStyle = useCallback(() => {
    if (!cropArea) return {};

    const x = Math.min(cropArea.startX, cropArea.endX) * scale;
    const y = Math.min(cropArea.startY, cropArea.endY) * scale;
    const width = Math.abs(cropArea.endX - cropArea.startX) * scale;
    const height = Math.abs(cropArea.endY - cropArea.startY) * scale;

    return {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    };
  }, [cropArea, scale]);

  /**
   * 유효한 선택 영역인지 확인
   */
  const isValidSelection = cropArea &&
    Math.abs(cropArea.endX - cropArea.startX) >= 10 &&
    Math.abs(cropArea.endY - cropArea.startY) >= 10;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-[#F5F0E8] border-2 border-[#1A1A1A] w-full max-w-4xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
          ref={containerRef}
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between p-4 border-b-2 border-[#1A1A1A]">
            <h2 className="font-bold text-lg text-[#1A1A1A]">{title}</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 안내 메시지 */}
          <div className="px-4 py-2 bg-[#EDEAE4] border-b border-[#1A1A1A]">
            <p className="text-sm text-[#5C5C5C]">
              마우스로 드래그하여 표, 그림, 그래프 등의 영역을 선택하세요.
            </p>
          </div>

          {/* 이미지 영역 */}
          <div className="flex-1 overflow-auto p-4">
            <div
              className="relative inline-block cursor-crosshair mx-auto"
              style={{ width: imageSize.width, height: imageSize.height, touchAction: 'none' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              {/* 원본 이미지 */}
              <img
                ref={imageRef}
                src={imageSource}
                alt="크롭할 이미지"
                className="block select-none pointer-events-none"
                style={{ width: imageSize.width, height: imageSize.height }}
                onLoad={handleImageLoad}
                draggable={false}
              />

              {/* 선택 영역 오버레이 */}
              {cropArea && (
                <>
                  {/* 어두운 오버레이 (선택 영역 외부) */}
                  <div
                    className="absolute inset-0 bg-black/40 pointer-events-none"
                    style={{
                      clipPath: `polygon(
                        0 0, 100% 0, 100% 100%, 0 100%, 0 0,
                        ${Math.min(cropArea.startX, cropArea.endX) * scale}px ${Math.min(cropArea.startY, cropArea.endY) * scale}px,
                        ${Math.min(cropArea.startX, cropArea.endX) * scale}px ${Math.max(cropArea.startY, cropArea.endY) * scale}px,
                        ${Math.max(cropArea.startX, cropArea.endX) * scale}px ${Math.max(cropArea.startY, cropArea.endY) * scale}px,
                        ${Math.max(cropArea.startX, cropArea.endX) * scale}px ${Math.min(cropArea.startY, cropArea.endY) * scale}px,
                        ${Math.min(cropArea.startX, cropArea.endX) * scale}px ${Math.min(cropArea.startY, cropArea.endY) * scale}px
                      )`,
                    }}
                  />

                  {/* 선택 영역 테두리 */}
                  <div
                    className="absolute border-2 border-dashed border-[#1A6B1A] bg-[#1A6B1A]/10 pointer-events-none"
                    style={getSelectionStyle()}
                  >
                    {/* 크기 표시 */}
                    {isValidSelection && (
                      <div className="absolute -top-6 left-0 bg-[#1A1A1A] text-[#F5F0E8] text-xs px-2 py-0.5">
                        {Math.round(Math.abs(cropArea.endX - cropArea.startX))} x {Math.round(Math.abs(cropArea.endY - cropArea.startY))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 하단 버튼 */}
          <div className="flex items-center justify-between p-4 border-t-2 border-[#1A1A1A]">
            <button
              onClick={handleReset}
              disabled={!cropArea}
              className={`
                px-4 py-2 text-sm font-bold border border-[#1A1A1A] transition-colors
                ${cropArea
                  ? 'text-[#1A1A1A] hover:bg-[#EDEAE4]'
                  : 'text-[#5C5C5C] cursor-not-allowed'
                }
              `}
            >
              선택 초기화
            </button>

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleCrop}
                disabled={!isValidSelection}
                className={`
                  px-4 py-2 text-sm font-bold border transition-colors
                  ${isValidSelection
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A] hover:bg-[#333]'
                    : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C] cursor-not-allowed'
                  }
                `}
              >
                선택 영역 추출
              </button>
            </div>
          </div>

          {/* 숨겨진 캔버스 (크롭용) */}
          <canvas ref={canvasRef} className="hidden" />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
