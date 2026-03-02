'use client';

import React, { useMemo, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import type { Announcement, FileAttachment } from './types';
import { getImageUrls, getFiles, fmtSize } from './types';

// ─── 미디어/파일 드로어 (좌측 슬라이드) ─────────────────

interface DatedImage { url: string; date: Date }
interface DatedFile { file: FileAttachment; date: Date }

/** 날짜별 그룹핑 (이미 최신순 정렬된 데이터 기준) */
function groupByDate<T extends { date: Date }>(items: T[]): { label: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  items.forEach(item => {
    const key = item.date.toDateString();
    const arr = groups.get(key);
    if (arr) arr.push(item);
    else groups.set(key, [item]);
  });
  return Array.from(groups.entries()).map(([key, gItems]) => ({
    label: new Date(key).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }),
    items: gItems,
  }));
}

const PREVIEW_IMAGES = 6;
const PREVIEW_FILES = 3;

const MediaDrawer = memo(function MediaDrawer({
  announcements, onClose, onImageClick, filter, onFilterChange,
}: {
  announcements: Announcement[];
  onClose: () => void;
  onImageClick: (urls: string[], index: number) => void;
  filter?: 'images' | 'files';
  onFilterChange: (f: 'images' | 'files' | undefined) => void;
}) {
  // 날짜 포함 데이터 수집
  const datedImages = useMemo<DatedImage[]>(() =>
    announcements.flatMap(a => {
      const date = a.createdAt?.toDate() ?? new Date(0);
      return getImageUrls(a).map(url => ({ url, date }));
    }), [announcements]);

  const datedFiles = useMemo<DatedFile[]>(() =>
    announcements.flatMap(a => {
      const date = a.createdAt?.toDate() ?? new Date(0);
      return getFiles(a).map(file => ({ file, date }));
    }), [announcements]);

  // 날짜별 그룹 (필터 뷰용)
  const imageGroups = useMemo(() => groupByDate(datedImages), [datedImages]);
  const fileGroups = useMemo(() => groupByDate(datedFiles), [datedFiles]);

  const isAllView = !filter;
  const hasMoreImages = datedImages.length > PREVIEW_IMAGES;
  const hasMoreFiles = datedFiles.length > PREVIEW_FILES;

  // < 버튼: 필터 뷰 → 기본 뷰, 기본 뷰 → 닫기
  const onBack = useCallback(() => {
    if (filter) onFilterChange(undefined);
    else onClose();
  }, [filter, onFilterChange, onClose]);

  return (
    <>
      {/* 백드롭 */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 z-20 bg-black/30"
        onClick={onClose}
      />
      {/* 좌측 드로어 */}
      <motion.div
        initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="absolute left-0 top-0 bottom-0 w-[220px] z-30 flex flex-col bg-black/60 backdrop-blur-2xl"
      >
        <div className="flex items-center gap-2 px-3 h-[44px] shrink-0 border-b border-white/10">
          <button onClick={onBack} className="p-1">
            <svg className="w-4 h-4 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="font-bold text-white/90 text-sm">
            {filter === 'images' ? '이미지' : filter === 'files' ? '파일' : '미디어 · 파일'}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-5">

          {/* ── 기본 뷰: 미리보기 + 더보기 ── */}
          {isAllView && (
            <>
              {datedImages.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold text-white/50 tracking-wider">이미지</p>
                    <span className="text-sm text-white/40">{datedImages.length}장</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {datedImages.slice(0, PREVIEW_IMAGES).map((d, i) => (
                      <button key={i} onClick={() => onImageClick(datedImages.map(x => x.url), i)} className="aspect-square overflow-hidden rounded-md border border-white/10">
                        <img src={d.url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                  {hasMoreImages && (
                    <button
                      onClick={() => onFilterChange('images')}
                      className="w-full mt-1.5 py-1.5 text-xs text-white/60 hover:text-white/80 border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      더보기
                    </button>
                  )}
                </div>
              )}
              {datedFiles.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold text-white/50 tracking-wider">파일</p>
                    <span className="text-sm text-white/40">{datedFiles.length}개</span>
                  </div>
                  <div className="space-y-2">
                    {datedFiles.slice(0, PREVIEW_FILES).map((d, i) => (
                      <a key={i} href={d.file.url} target="_blank" rel="noopener noreferrer" download={d.file.name}
                        className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
                      >
                        <svg className="w-5 h-5 text-white/50 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white/90 truncate">{d.file.name}</p>
                          {d.file.size > 0 && <p className="text-[10px] text-white/40">{fmtSize(d.file.size)}</p>}
                        </div>
                        <svg className="w-4 h-4 text-white/40 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </a>
                    ))}
                  </div>
                  {hasMoreFiles && (
                    <button
                      onClick={() => onFilterChange('files')}
                      className="w-full mt-1.5 py-1.5 text-xs text-white/60 hover:text-white/80 border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      더보기
                    </button>
                  )}
                </div>
              )}
              {datedImages.length === 0 && datedFiles.length === 0 && (
                <div className="flex items-center justify-center text-sm text-white/40 py-20">
                  아직 올린 미디어가 없습니다.
                </div>
              )}
            </>
          )}

          {/* ── 필터 뷰: 날짜별 그룹핑 ── */}
          {filter === 'images' && (
            <>
              {imageGroups.length > 0 ? imageGroups.map((group, gi) => {
                const groupUrls = group.items.map(x => x.url);
                return (
                <div key={gi}>
                  <p className="text-xs font-bold text-white/40 tracking-wider mb-2">{group.label}</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {group.items.map((d, i) => (
                      <button key={i} onClick={() => onImageClick(groupUrls, i)} className="aspect-square overflow-hidden rounded-md border border-white/10">
                        <img src={d.url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
                );
              }) : (
                <div className="flex items-center justify-center text-sm text-white/40 py-20">
                  아직 올린 이미지가 없습니다.
                </div>
              )}
            </>
          )}
          {filter === 'files' && (
            <>
              {fileGroups.length > 0 ? fileGroups.map((group, gi) => (
                <div key={gi}>
                  <p className="text-xs font-bold text-white/40 tracking-wider mb-2">{group.label}</p>
                  <div className="space-y-2">
                    {group.items.map((d, i) => (
                      <a key={i} href={d.file.url} target="_blank" rel="noopener noreferrer" download={d.file.name}
                        className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
                      >
                        <svg className="w-5 h-5 text-white/50 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white/90 truncate">{d.file.name}</p>
                          {d.file.size > 0 && <p className="text-[10px] text-white/40">{fmtSize(d.file.size)}</p>}
                        </div>
                        <svg className="w-4 h-4 text-white/40 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </a>
                    ))}
                  </div>
                </div>
              )) : (
                <div className="flex items-center justify-center text-sm text-white/40 py-20">
                  아직 올린 파일이 없습니다.
                </div>
              )}
            </>
          )}

        </div>
      </motion.div>
    </>
  );
});

export default MediaDrawer;
