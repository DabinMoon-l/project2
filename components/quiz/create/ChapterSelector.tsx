'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getCourseIndex,
  formatChapterLabel,
  type Chapter,
  type ChapterDetail,
} from '@/lib/courseIndex';

interface ChapterSelectorProps {
  /** 과목 ID */
  courseId?: string;
  /** 선택된 챕터 ID */
  chapterId?: string;
  /** 선택된 세부항목 ID */
  detailId?: string;
  /** 챕터 변경 콜백 */
  onChange: (chapterId: string, detailId?: string) => void;
  /** 에러 메시지 */
  error?: string;
  /** 컴팩트 모드 (문제 목록에서 사용) */
  compact?: boolean;
}

/**
 * 챕터·세부항목 선택 컴포넌트
 */
export default function ChapterSelector({
  courseId,
  chapterId,
  detailId,
  onChange,
  error,
  compact = false,
}: ChapterSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);

  const courseIndex = courseId ? getCourseIndex(courseId) : null;

  // 표시 라벨
  const displayLabel = courseId && chapterId
    ? formatChapterLabel(courseId, chapterId, detailId)
    : '미설정';

  const handleChapterSelect = (chapter: Chapter) => {
    if (chapter.details.length === 0) {
      // 세부항목이 없으면 바로 선택 완료
      onChange(chapter.id, undefined);
      setIsOpen(false);
      setSelectedChapter(null);
    } else {
      // 세부항목이 있으면 다음 단계로
      setSelectedChapter(chapter);
    }
  };

  const handleDetailSelect = (detail: ChapterDetail) => {
    if (selectedChapter) {
      onChange(selectedChapter.id, detail.id);
      setIsOpen(false);
      setSelectedChapter(null);
    }
  };

  const handleBack = () => {
    setSelectedChapter(null);
  };

  // 과목 인덱스가 없으면 비활성화
  if (!courseIndex) {
    return (
      <div
        className={`inline-flex items-center gap-1 px-2 py-1 text-xs border border-dashed border-[#5C5C5C] text-[#5C5C5C] ${
          compact ? '' : 'ml-2'
        }`}
      >
        <span>챕터 미지원</span>
      </div>
    );
  }

  return (
    <div className={`relative ${compact ? '' : 'inline-block ml-2'}`}>
      {/* 선택 버튼 */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`
          inline-flex items-center gap-1 px-2 py-1 text-xs font-bold
          border transition-colors
          ${error
            ? 'border-[#8B1A1A] text-[#8B1A1A] bg-[#FDEAEA]'
            : chapterId
              ? 'border-[#1A6B1A] text-[#1A6B1A] bg-[#E8F5E9]'
              : 'border-[#1A1A1A] text-[#1A1A1A] bg-[#EDEAE4] hover:bg-[#D4CFC4]'
          }
        `}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
        <span>{displayLabel}</span>
        <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 에러 메시지 */}
      {error && !compact && (
        <p className="absolute top-full left-0 mt-1 text-xs text-[#8B1A1A] whitespace-nowrap">
          {error}
        </p>
      )}

      {/* 드롭다운 */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* 백드롭 */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => {
                setIsOpen(false);
                setSelectedChapter(null);
              }}
            />

            {/* 메뉴 */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-full left-0 mt-1 z-50 bg-[#F5F0E8] border-2 border-[#1A1A1A] shadow-lg min-w-[240px] max-h-[300px] overflow-y-auto"
            >
              {/* 헤더 */}
              <div className="sticky top-0 bg-[#1A1A1A] text-[#F5F0E8] px-3 py-2 text-xs font-bold flex items-center justify-between">
                {selectedChapter ? (
                  <>
                    <button
                      type="button"
                      onClick={handleBack}
                      className="flex items-center gap-1 hover:underline"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      <span>뒤로</span>
                    </button>
                    <span>{selectedChapter.shortName}</span>
                  </>
                ) : (
                  <span>챕터 선택</span>
                )}
              </div>

              {/* 목록 */}
              <div className="py-1">
                {selectedChapter ? (
                  // 세부항목 목록
                  <>
                    {/* 챕터만 선택 옵션 */}
                    <button
                      type="button"
                      onClick={() => {
                        onChange(selectedChapter.id, undefined);
                        setIsOpen(false);
                        setSelectedChapter(null);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-[#EDEAE4] transition-colors flex items-center gap-2"
                    >
                      <span className="text-[#5C5C5C]">(전체)</span>
                    </button>
                    {selectedChapter.details.map((detail) => (
                      <button
                        key={detail.id}
                        type="button"
                        onClick={() => handleDetailSelect(detail)}
                        className={`
                          w-full px-3 py-2 text-left text-sm hover:bg-[#EDEAE4] transition-colors
                          ${detailId === detail.id ? 'bg-[#E8F5E9] text-[#1A6B1A] font-bold' : ''}
                        `}
                      >
                        {detail.name}
                      </button>
                    ))}
                  </>
                ) : (
                  // 챕터 목록
                  courseIndex.chapters.map((chapter) => (
                    <button
                      key={chapter.id}
                      type="button"
                      onClick={() => handleChapterSelect(chapter)}
                      className={`
                        w-full px-3 py-2 text-left text-sm hover:bg-[#EDEAE4] transition-colors
                        flex items-center justify-between
                        ${chapterId === chapter.id ? 'bg-[#E8F5E9] text-[#1A6B1A] font-bold' : ''}
                      `}
                    >
                      <span>{chapter.name}</span>
                      {chapter.details.length > 0 && (
                        <svg className="w-4 h-4 text-[#5C5C5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
