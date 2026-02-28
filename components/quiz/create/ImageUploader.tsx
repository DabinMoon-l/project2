'use client';

import { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { isImageFile, isPDFFile, isSupportedFile, checkFileSize } from '@/lib/ocr';

// ============================================================
// 타입 정의
// ============================================================

interface ImageUploaderProps {
  /** 파일 선택 시 콜백 */
  onFileSelect: (file: File) => void;
  /** 이미지 추출 버튼 클릭 콜백 */
  onExtractClick?: () => void;
  /** 이미지 추출 처리 중 */
  isExtractProcessing?: boolean;
  /** 로딩 상태 */
  isLoading?: boolean;
  /** 에러 메시지 */
  error?: string | null;
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 이미지/PDF 업로더 컴포넌트
 *
 * 갤러리 선택, PDF 업로드를 지원합니다.
 * 드래그 앤 드롭도 지원합니다.
 */
export default function ImageUploader({
  onFileSelect,
  onExtractClick,
  isExtractProcessing = false,
  isLoading = false,
  error,
  className = '',
}: ImageUploaderProps) {
  // 상태
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * 파일 유효성 검사 및 처리
   */
  const handleFile = useCallback(
    (file: File) => {
      setLocalError(null);

      // 파일 타입 검사
      if (!isSupportedFile(file)) {
        setLocalError('이미지 또는 PDF 파일만 업로드할 수 있습니다.');
        return;
      }

      // 파일 크기 검사 (10MB 제한)
      if (!checkFileSize(file, 10)) {
        setLocalError('파일 크기는 10MB 이하여야 합니다.');
        return;
      }

      // 미리보기 생성
      if (isImageFile(file)) {
        const url = URL.createObjectURL(file);
        setPreview(url);
      } else if (isPDFFile(file)) {
        // PDF는 아이콘으로 표시
        setPreview(null);
      }

      setFileName(file.name);
      onFileSelect(file);
    },
    [onFileSelect]
  );

  /**
   * 파일 입력 변경 핸들러
   */
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  /**
   * 드래그 앤 드롭 핸들러
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  /**
   * 미리보기 제거
   */
  const handleRemovePreview = useCallback(() => {
    if (preview) {
      URL.revokeObjectURL(preview);
    }
    setPreview(null);
    setFileName(null);
    setLocalError(null);

    // input 초기화
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [preview]);

  const displayError = error || localError;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 업로드 영역 */}
      <motion.div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        animate={{
          borderColor: isDragging ? '#1A1A1A' : '#1A1A1A',
          backgroundColor: isDragging ? '#EDEAE4' : '#F5F0E8',
        }}
        className={`
          relative
          border-2 border-dashed
          p-6
          transition-colors duration-200
          ${isLoading ? 'pointer-events-none opacity-50' : ''}
        `}
      >
        {/* 미리보기가 있는 경우 */}
        <AnimatePresence mode="wait">
          {(preview || fileName) && !isLoading ? (
            <motion.div
              key="preview"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative"
            >
              {/* 이미지 미리보기 */}
              {preview ? (
                <div className="relative aspect-video bg-[#EDEAE4] overflow-hidden">
                  <img
                    src={preview}
                    alt="미리보기"
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                /* PDF 아이콘 표시 */
                <div className="flex flex-col items-center justify-center py-8 bg-[#EDEAE4]">
                  <svg
                    className="w-16 h-16 text-[#8B1A1A] mb-2"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v6h6v10H6z" />
                    <path d="M8 13h8v1H8zm0 2h8v1H8zm0 2h5v1H8z" />
                  </svg>
                  <span className="text-sm text-[#1A1A1A]">{fileName}</span>
                </div>
              )}

              {/* 파일명 */}
              {preview && (
                <p className="mt-2 text-sm text-center text-[#5C5C5C] truncate">
                  {fileName}
                </p>
              )}

              {/* 삭제 버튼 */}
              <button
                type="button"
                onClick={handleRemovePreview}
                className="
                  absolute -top-2 -right-2
                  w-8 h-8
                  bg-[#8B1A1A] text-[#F5F0E8]
                  flex items-center justify-center
                  hover:bg-[#6B1414]
                  transition-colors
                "
                aria-label="이미지 삭제"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </motion.div>
          ) : isLoading ? (
            /* 로딩 상태 */
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-12"
            >
              <div className="w-12 h-12 border-4 border-[#EDEAE4] border-t-[#1A1A1A] rounded-full animate-spin mb-4" />
              <p className="text-sm text-[#5C5C5C]">OCR 처리 중...</p>
            </motion.div>
          ) : (
            /* 업로드 안내 */
            <motion.div
              key="upload"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-6"
            >
              {/* 업로드 아이콘 */}
              <div className="w-12 h-12 bg-[#EDEAE4] flex items-center justify-center mb-3 border-2 border-[#1A1A1A]">
                <svg
                  className="w-6 h-6 text-[#1A1A1A]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>

              {/* 안내 텍스트 */}
              <p className="text-sm text-[#1A1A1A] text-center mb-1 font-bold">
                이미지 또는 PDF를 업로드하세요
              </p>
              <p className="text-[10px] text-[#5C5C5C] text-center">
                드래그 앤 드롭 또는 버튼 클릭
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 숨겨진 파일 입력 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          onChange={handleFileChange}
          className="hidden"
          disabled={isLoading}
        />
      </motion.div>

      {/* 갤러리/PDF + 이미지 추출 버튼 */}
      {!preview && !fileName && !isLoading && (
        <div className="flex gap-2">
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            갤러리 / PDF
          </motion.button>
          {onExtractClick && (
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onExtractClick}
              disabled={isExtractProcessing}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50"
            >
              {isExtractProcessing ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  처리 중...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                  </svg>
                  이미지 추출
                </>
              )}
            </motion.button>
          )}
        </div>
      )}

      {/* 에러 메시지 */}
      <AnimatePresence>
        {displayError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 p-3 bg-[#FDEAEA] border border-[#8B1A1A] text-[#8B1A1A]"
          >
            <svg
              className="w-5 h-5 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm">{displayError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* OCR 및 이미지 추출 안내 */}
      <div className="p-2.5 bg-[#FFF8E7] border border-[#D4A84B]">
        <div className="flex items-start gap-2">
          <svg
            className="w-4 h-4 text-[#D4A84B] flex-shrink-0 mt-0.5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <div className="text-[11px] text-[#8B6914]">
            <p className="font-bold mb-0.5">안내</p>
            <p>
              <strong>갤러리/PDF:</strong> OCR로 텍스트를 추출합니다. 100% 정확하지 않을 수 있으니 확인 후 수정해주세요.
            </p>
            <p className="mt-0.5">
              <strong>이미지 추출:</strong> 이미지/PDF/PPT에서 원하는 영역을 크롭하여 문제에 첨부합니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
