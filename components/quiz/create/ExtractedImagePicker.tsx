'use client';

import { motion } from 'framer-motion';

// ============================================================
// 타입 정의
// ============================================================

/** 추출된 이미지 데이터 */
interface ExtractedImageData {
  id: string;
  dataUrl: string;
  sourceFileName?: string;
}

interface ExtractedImagePickerProps {
  /** 추출된 이미지 목록 */
  extractedImages: ExtractedImageData[];
  /** 이미지 선택 시 콜백 */
  onSelect: (dataUrl: string) => void;
  /** 닫기 콜백 */
  onClose: () => void;
  /** 이미지 삭제 콜백 (선택) */
  onRemove?: (id: string) => void;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 추출된 이미지 선택 모달
 *
 * 이미지 영역 선택으로 추출한 이미지들 중 하나를 선택합니다.
 */
export default function ExtractedImagePicker({
  extractedImages,
  onSelect,
  onClose,
  onRemove,
}: ExtractedImagePickerProps) {
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
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />

      {/* 모달 */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-[#1A1A1A]">
          <h2 className="font-bold text-[#1A1A1A]">추출 이미지 선택</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 내용 */}
        <div className="flex-1 overflow-auto p-4">
          {extractedImages.length === 0 ? (
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
              {extractedImages.map((img, idx) => (
                <div
                  key={img.id}
                  className="relative group border-2 border-[#1A1A1A] bg-white overflow-hidden"
                >
                  {/* 이미지 */}
                  <button
                    type="button"
                    onClick={() => onSelect(img.dataUrl)}
                    className="w-full aspect-square"
                  >
                    <img
                      src={img.dataUrl}
                      alt={`추출 이미지 ${idx + 1}`}
                      className="w-full h-full object-contain"
                    />
                  </button>

                  {/* 번호 뱃지 */}
                  <div className="absolute top-1 left-1 bg-[#1A1A1A] text-[#F5F0E8] px-2 py-0.5 text-xs font-bold">
                    {idx + 1}
                  </div>

                  {/* 삭제 버튼 - onRemove가 제공된 경우에만 표시 */}
                  {onRemove && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(img.id);
                      }}
                      className="absolute top-1 right-1 w-6 h-6 bg-[#8B1A1A] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}

                  {/* 출처 */}
                  {img.sourceFileName && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                      <p className="text-white text-[10px] truncate">{img.sourceFileName}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 하단 안내 */}
        {extractedImages.length > 0 && (
          <div className="px-4 py-3 border-t border-[#D4CFC4] bg-[#EDEAE4]">
            <p className="text-xs text-[#5C5C5C] text-center">
              이미지를 클릭하여 선택하세요
            </p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
