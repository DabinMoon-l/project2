'use client';

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  arrayUnion,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { useUpload } from '@/lib/hooks/useStorage';

// ─── 타입 ───────────────────────────────────────────────

interface FileAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
}

interface Poll {
  question: string;
  options: string[];
  votes: Record<string, string[]>;
  allowMultiple: boolean;
  maxSelections?: number;
}

interface EditingPoll {
  question: string;
  options: string[];
  allowMultiple: boolean;
  maxSelections: number;
}

interface Announcement {
  id: string;
  content: string;
  imageUrl?: string;
  imageUrls?: string[];
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  files?: FileAttachment[];
  poll?: Poll;
  polls?: Poll[];
  reactions: Record<string, string[]>;
  readBy?: string[];
  createdAt: Timestamp;
  createdBy: string;
  courseId: string;
}

// ─── 상수 ───────────────────────────────────────────────

const REACTION_EMOJIS = ['❤️', '👍', '🔥', '😂', '😮', '😢'];
const BUBBLE_C = 14;
const BUBBLE_SIDE_MULTI = 26; // 다중 아이템 버블 좌우 패딩 (화살표 공간)
const ARROW_ZONE = 30; // BUBBLE_SIDE_MULTI + content px-1(4px) = 화살표 영역 너비

// ─── 유틸 ───────────────────────────────────────────────

/** 이미지 URL 배열 추출 (하위 호환) */
function getImageUrls(a: Announcement): string[] {
  return a.imageUrls ?? (a.imageUrl ? [a.imageUrl] : []);
}

/** 투표 배열 추출 (하위 호환 + 객체→배열 복구 + 유효성 필터) */
function getPolls(a: Announcement): Poll[] {
  let polls: Poll[] = [];
  if (a.polls) {
    // Firestore가 배열을 객체로 변환한 경우 복구
    polls = Array.isArray(a.polls) ? a.polls : Object.values(a.polls as Record<string, Poll>);
  } else if (a.poll) {
    polls = [a.poll];
  }
  // options 없는 깨진 데이터 필터
  return polls.filter((p) => p && Array.isArray(p.options) && p.options.length > 0);
}

/** 파일 배열 추출 (하위 호환) */
function getFiles(a: Announcement): FileAttachment[] {
  return a.files ?? (a.fileUrl ? [{ url: a.fileUrl, name: a.fileName || '파일', type: a.fileType || '', size: a.fileSize || 0 }] : []);
}

function fmtDate(ts: Timestamp): string {
  if (!ts) return '';
  return ts.toDate().toLocaleDateString('ko-KR', {
    month: 'long', day: 'numeric', weekday: 'long',
  });
}

function dateKey(ts: Timestamp): string {
  if (!ts) return '';
  return ts.toDate().toDateString();
}

function fmtTime(ts: Timestamp): string {
  if (!ts) return '';
  return ts.toDate().toLocaleTimeString('ko-KR', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function lastReadKey(cid: string) {
  return `announcement_lastRead_${cid}`;
}

// ─── 9-slice 말풍선 ─────────────────────────────────────

// 9-slice 스타일 상수 (매 렌더마다 객체 재생성 방지)
// 가장자리를 코너와 1px 겹쳐서 서브픽셀 갭(절단선) 방지
const _bg = (name: string) => `url(/notice/bubble_professor_${name}.png)`;
const _C = BUBBLE_C;
const _O = 1; // overlap
const BUBBLE_STYLES = {
  tl: { width: _C, height: _C, backgroundImage: _bg('tl'), backgroundSize: 'cover' } as React.CSSProperties,
  tr: { width: _C, height: _C, backgroundImage: _bg('tr'), backgroundSize: 'cover' } as React.CSSProperties,
  bl: { width: _C, height: _C, backgroundImage: _bg('bl'), backgroundSize: 'cover' } as React.CSSProperties,
  br: { width: _C, height: _C, backgroundImage: _bg('br'), backgroundSize: 'cover' } as React.CSSProperties,
  top: { top: 0, left: _C - _O, right: _C - _O, height: _C, backgroundImage: _bg('top'), backgroundSize: '100% 100%' } as React.CSSProperties,
  bottom: { bottom: 0, left: _C - _O, right: _C - _O, height: _C, backgroundImage: _bg('bottom'), backgroundSize: '100% 100%' } as React.CSSProperties,
  left: { top: _C - _O, left: 0, width: _C, bottom: _C - _O, backgroundImage: _bg('left'), backgroundSize: '100% 100%' } as React.CSSProperties,
  right: { top: _C - _O, right: 0, width: _C, bottom: _C - _O, backgroundImage: _bg('right'), backgroundSize: '100% 100%' } as React.CSSProperties,
  center: { top: _C - _O, left: _C - _O, right: _C - _O, bottom: _C - _O, backgroundImage: _bg('center'), backgroundSize: '100% 100%' } as React.CSSProperties,
  padDefault: { padding: `${_C}px` } as React.CSSProperties,
  padMulti: { padding: `${_C}px ${BUBBLE_SIDE_MULTI}px` } as React.CSSProperties,
};

const Bubble = memo(function Bubble({ children, className, sidePadding }: { children: React.ReactNode; className?: string; sidePadding?: number }) {
  const padStyle = sidePadding ? BUBBLE_STYLES.padMulti : BUBBLE_STYLES.padDefault;
  return (
    <div className={`relative ${className || ''}`} style={padStyle}>
      <div className="absolute top-0 left-0" style={BUBBLE_STYLES.tl} />
      <div className="absolute top-0 right-0" style={BUBBLE_STYLES.tr} />
      <div className="absolute bottom-0 left-0" style={BUBBLE_STYLES.bl} />
      <div className="absolute bottom-0 right-0" style={BUBBLE_STYLES.br} />
      <div className="absolute" style={BUBBLE_STYLES.top} />
      <div className="absolute" style={BUBBLE_STYLES.bottom} />
      <div className="absolute" style={BUBBLE_STYLES.left} />
      <div className="absolute" style={BUBBLE_STYLES.right} />
      <div className="absolute" style={BUBBLE_STYLES.center} />
      <div className="relative px-1 py-0.5">{children}</div>
    </div>
  );
});

// ─── 이미지 캐러셀 ─────────────────────────────────────

const ImageCarousel = memo(function ImageCarousel({
  urls,
  onImageClick,
}: {
  urls: string[];
  onImageClick: (url: string) => void;
}) {
  const [idx, setIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  if (urls.length === 0) return null;

  if (urls.length === 1) {
    return (
      <button onClick={() => onImageClick(urls[0])} className="mt-1 block w-full">
        <img src={urls[0]} alt="이미지" className="w-full aspect-[4/3] object-cover border border-[#D4CFC4]" />
      </button>
    );
  }

  return (
    <div className="mt-1">
      <div className="flex items-center -mx-[30px]">
        {/* 좌측 화살표 — 버블 패딩 영역 중앙 */}
        <button
          onClick={() => { if (idx > 0) containerRef.current?.scrollTo({ left: (idx - 1) * (containerRef.current?.clientWidth || 0), behavior: 'smooth' }); }}
          className={`w-[30px] shrink-0 flex items-center justify-center text-[#5C5C5C] ${idx > 0 ? '' : 'invisible'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
        </button>
        {/* 이미지 영역 */}
        <div
          ref={containerRef}
          className="flex-1 overflow-x-auto snap-x snap-mandatory flex gap-0.5 scrollbar-hide"
          onScroll={() => {
            const el = containerRef.current;
            if (!el) return;
            const newIdx = Math.round(el.scrollLeft / el.clientWidth);
            setIdx(newIdx);
          }}
        >
          {urls.map((url, i) => (
            <button key={i} onClick={() => onImageClick(url)} className="w-full shrink-0 snap-start">
              <img src={url} alt={`이미지 ${i + 1}`} className="w-full aspect-[4/3] object-cover border border-[#D4CFC4]" />
            </button>
          ))}
        </div>
        {/* 우측 화살표 — 버블 패딩 영역 중앙 */}
        <button
          onClick={() => { if (idx < urls.length - 1) containerRef.current?.scrollTo({ left: (idx + 1) * (containerRef.current?.clientWidth || 0), behavior: 'smooth' }); }}
          className={`w-[30px] shrink-0 flex items-center justify-center text-[#5C5C5C] ${idx < urls.length - 1 ? '' : 'invisible'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      {/* 점 인디케이터 */}
      <div className="flex justify-center gap-1 mt-1">
        {urls.map((_, i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === idx ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'}`} />
        ))}
      </div>
    </div>
  );
});

// ─── 파일 캐러셀 ────────────────────────────────────────

const FileCarousel = memo(function FileCarousel({ files }: { files: FileAttachment[] }) {
  const [idx, setIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  if (files.length === 0) return null;

  const FileCard = ({ f }: { f: FileAttachment }) => (
    <a href={f.url} target="_blank" rel="noopener noreferrer" download={f.name}
      className="flex items-center gap-1.5 p-1.5 border border-[#D4CFC4] bg-[#F5F0E8]/60 hover:bg-[#F5F0E8] transition-colors"
    >
      <svg className="w-4 h-4 text-[#5C5C5C] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1A1A1A] truncate">{f.name}</p>
        {f.size > 0 && <p className="text-xs text-[#8C8478]">{fmtSize(f.size)}</p>}
      </div>
      <svg className="w-4 h-4 text-[#8C8478] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </a>
  );

  if (files.length === 1) {
    return <div className="mt-1"><FileCard f={files[0]} /></div>;
  }

  return (
    <div className="mt-1">
      <div className="flex items-center -mx-[30px]">
        {/* 좌측 화살표 — 버블 패딩 영역 중앙 */}
        <button
          onClick={() => { if (idx > 0) containerRef.current?.scrollTo({ left: (idx - 1) * (containerRef.current?.clientWidth || 0), behavior: 'smooth' }); }}
          className={`w-[30px] shrink-0 flex items-center justify-center text-[#5C5C5C] ${idx > 0 ? '' : 'invisible'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
        </button>
        {/* 파일 영역 */}
        <div
          ref={containerRef}
          className="flex-1 overflow-x-auto snap-x snap-mandatory flex gap-0.5 scrollbar-hide"
          onScroll={() => {
            const el = containerRef.current;
            if (!el) return;
            const newIdx = Math.round(el.scrollLeft / el.clientWidth);
            setIdx(newIdx);
          }}
        >
          {files.map((f, i) => (
            <div key={i} className="w-full shrink-0 snap-start">
              <FileCard f={f} />
            </div>
          ))}
        </div>
        {/* 우측 화살표 — 버블 패딩 영역 중앙 */}
        <button
          onClick={() => { if (idx < files.length - 1) containerRef.current?.scrollTo({ left: (idx + 1) * (containerRef.current?.clientWidth || 0), behavior: 'smooth' }); }}
          className={`w-[30px] shrink-0 flex items-center justify-center text-[#5C5C5C] ${idx < files.length - 1 ? '' : 'invisible'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      {/* 점 인디케이터 */}
      <div className="flex justify-center gap-1 mt-1">
        {files.map((_, i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === idx ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'}`} />
        ))}
      </div>
    </div>
  );
});

// ─── 투표 캐러셀 ─────────────────────────────────────────

// ─── 투표 카드 (PollCarousel 밖에 정의 — 복수선택 state 유지) ──

const PollCard = memo(function PollCard({
  poll,
  pollIdx,
  profileUid,
  shouldAnimate,
  selected,
  onToggle,
  onSingleVote,
  onSubmitMulti,
}: {
  poll: Poll;
  pollIdx: number;
  profileUid?: string;
  shouldAnimate: boolean;
  selected: Set<number>;
  onToggle: (optIdx: number) => void;
  onSingleVote: (optIdx: number) => void;
  onSubmitMulti: () => void;
}) {
  if (!poll || !poll.options) return null;
  const votes = poll.votes || {};
  const hasVoted = profileUid && Object.values(votes).some((arr) => Array.isArray(arr) && arr.includes(profileUid));
  const maxSel = poll.allowMultiple ? (poll.maxSelections || poll.options.length) : 1;

  return (
    <div className="p-2 border border-[#D4CFC4]">
      <p className="font-bold text-base mb-1.5 text-[#1A1A1A] break-words">{poll.question}</p>
      {/* 복수선택 안내 */}
      {poll.allowMultiple && !hasVoted && (
        <p className="text-[10px] text-[#8C8478] mb-1.5">복수선택 (최대 {maxSel}개)</p>
      )}
      <div className="space-y-1">
        {poll.options.map((opt, oi) => {
          const v = votes[oi.toString()] || [];
          const total = new Set(Object.values(votes).flat()).size;
          const pct = total > 0 ? Math.round((v.length / total) * 100) : 0;
          const isMyVote = profileUid && v.includes(profileUid);
          const isSelected = selected.has(oi);

          // 투표 전
          if (!hasVoted) {
            if (poll.allowMultiple) {
              // 복수선택: 체크박스 토글
              return (
                <button
                  key={oi}
                  onClick={(e) => { e.stopPropagation(); onToggle(oi); }}
                  className="w-full text-left py-1"
                >
                  <div className="flex items-start gap-1.5">
                    <span className={`w-3.5 h-3.5 border-[1.5px] border-[#1A1A1A] shrink-0 mt-px flex items-center justify-center transition-colors ${isSelected ? 'bg-[#1A1A1A]' : ''}`}>
                      {isSelected && <span className="text-white text-[8px]">✓</span>}
                    </span>
                    <span className="flex-1 text-base min-w-0 break-words">{opt}</span>
                  </div>
                </button>
              );
            }
            // 단일선택: 즉시 투표
            return (
              <button key={oi} onClick={(e) => { e.stopPropagation(); onSingleVote(oi); }} className="w-full text-left py-0.5">
                <div className="flex items-start gap-1.5">
                  <span className="w-3.5 h-3.5 border-[1.5px] border-[#1A1A1A] shrink-0 mt-px" />
                  <span className="flex-1 text-xs min-w-0 break-words">{opt}</span>
                </div>
              </button>
            );
          }

          // 투표 후: 결과 표시
          return (
            <div key={oi} className="py-0.5">
              <div className="flex items-start gap-1.5">
                <span className={`w-3.5 h-3.5 border-[1.5px] border-[#1A1A1A] shrink-0 mt-px flex items-center justify-center ${isMyVote ? 'bg-[#1A1A1A]' : ''}`}>
                  {isMyVote && <span className="text-white text-[8px]">✓</span>}
                </span>
                <span className="flex-1 text-xs min-w-0 break-words">{opt}</span>
                <span className="text-[11px] text-[#8C8478] shrink-0">{pct}%</span>
              </div>
              <div className="mt-0.5 h-1 bg-[#D4CFC4] rounded-full overflow-hidden">
                {shouldAnimate ? (
                  <motion.div
                    className="h-full bg-[#1A1A1A] rounded-full"
                    initial={{ width: '0%' }}
                    animate={{ width: `${pct}%` }}
                    transition={{ type: 'spring', stiffness: 80, damping: 18, delay: 0.15 * oi }}
                  />
                ) : (
                  <div className="h-full bg-[#1A1A1A] rounded-full" style={{ width: `${pct}%` }} />
                )}
              </div>
            </div>
          );
        })}
        {/* 복수선택 투표 버튼 */}
        {poll.allowMultiple && !hasVoted && (
          <button
            onClick={(e) => { e.stopPropagation(); onSubmitMulti(); }}
            disabled={selected.size === 0}
            className="w-full mt-0.5 py-1 text-xs font-bold border-[1.5px] border-[#1A1A1A] text-[#1A1A1A] disabled:opacity-30 transition-opacity"
          >
            투표하기 ({selected.size}/{maxSel})
          </button>
        )}
        {hasVoted && (
          <p className="text-xs text-[#8C8478] text-right">
            {new Set(Object.values(votes).flat()).size}명 참여
          </p>
        )}
      </div>
    </div>
  );
});

// ─── 투표 캐러셀 ─────────────────────────────────────────

const PollCarousel = memo(function PollCarousel({
  polls,
  announcementId,
  profileUid,
  onVote,
}: {
  polls: Poll[];
  announcementId: string;
  profileUid?: string;
  onVote: (aid: string, pollIdx: number, optIndices: number[]) => void;
}) {
  const [idx, setIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  // 이번 세션에서 방금 투표한 poll만 애니메이션
  const [justVoted, setJustVoted] = useState<Set<number>>(new Set());
  // 복수선택 임시 선택 상태
  const [selections, setSelections] = useState<Map<number, Set<number>>>(new Map());

  const toggleSelection = useCallback((pollIdx: number, optIdx: number, maxSel: number) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const cur = new Set(next.get(pollIdx) || []);
      if (cur.has(optIdx)) {
        cur.delete(optIdx);
      } else if (cur.size < maxSel) {
        cur.add(optIdx);
      }
      next.set(pollIdx, cur);
      return next;
    });
  }, []);

  const handleSingleVote = useCallback((pollIdx: number, optIdx: number) => {
    setJustVoted((prev) => new Set(prev).add(pollIdx));
    onVote(announcementId, pollIdx, [optIdx]);
  }, [onVote, announcementId]);

  const handleMultiVote = useCallback((pollIdx: number) => {
    const sel = selections.get(pollIdx);
    if (!sel || sel.size === 0) return;
    setJustVoted((prev) => new Set(prev).add(pollIdx));
    onVote(announcementId, pollIdx, Array.from(sel));
  }, [onVote, announcementId, selections]);

  if (polls.length === 0) return null;

  const EMPTY_SET = new Set<number>();

  const renderCard = (poll: Poll, pi: number) => (
    <PollCard
      key={pi}
      poll={poll}
      pollIdx={pi}
      profileUid={profileUid}
      shouldAnimate={justVoted.has(pi)}
      selected={selections.get(pi) || EMPTY_SET}
      onToggle={(oi) => toggleSelection(pi, oi, poll.maxSelections || poll.options.length)}
      onSingleVote={(oi) => handleSingleVote(pi, oi)}
      onSubmitMulti={() => handleMultiVote(pi)}
    />
  );

  if (polls.length === 1) {
    return <div className="mt-1">{renderCard(polls[0], 0)}</div>;
  }

  return (
    <div className="mt-1">
      <div className="flex items-center -mx-[30px]">
        {/* 좌측 화살표 — 버블 패딩 영역 중앙 */}
        <button
          onClick={() => { if (idx > 0) containerRef.current?.scrollTo({ left: (idx - 1) * (containerRef.current?.clientWidth || 0), behavior: 'smooth' }); }}
          className={`w-[30px] shrink-0 flex items-center justify-center text-[#5C5C5C] ${idx > 0 ? '' : 'invisible'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
        </button>
        {/* 투표 영역 */}
        <div
          ref={containerRef}
          className="flex-1 overflow-x-auto snap-x snap-mandatory flex items-center gap-0.5 scrollbar-hide"
          onScroll={() => {
            const el = containerRef.current;
            if (!el) return;
            const newIdx = Math.round(el.scrollLeft / el.clientWidth);
            setIdx(newIdx);
          }}
        >
          {polls.map((poll, i) => (
            <div key={i} className="w-full shrink-0 snap-start flex items-center">
              <div className="w-full">{renderCard(poll, i)}</div>
            </div>
          ))}
        </div>
        {/* 우측 화살표 — 버블 패딩 영역 중앙 */}
        <button
          onClick={() => { if (idx < polls.length - 1) containerRef.current?.scrollTo({ left: (idx + 1) * (containerRef.current?.clientWidth || 0), behavior: 'smooth' }); }}
          className={`w-[30px] shrink-0 flex items-center justify-center text-[#5C5C5C] ${idx < polls.length - 1 ? '' : 'invisible'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      {/* 점 인디케이터 */}
      <div className="flex justify-center gap-1 mt-1">
        {polls.map((_, i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === idx ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'}`} />
        ))}
      </div>
    </div>
  );
});

// ─── 이미지 전체화면 뷰어 ──────────────────────────────

const ImageViewer = memo(function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ delay: 0.15 }}
        onClick={onClose} className="absolute top-4 right-4 text-white p-2 z-10"
      >
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </motion.button>
      <motion.a
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ delay: 0.15 }}
        href={src} target="_blank" rel="noopener noreferrer" download
        onClick={(e) => e.stopPropagation()}
        className="absolute top-4 left-4 text-white p-2 z-10"
      >
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </motion.a>
      <motion.img
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        src={src} alt="" className="max-w-[90vw] max-h-[85vh] object-contain" onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
});

// ─── 펼치기/접기 메시지 본문 ────────────────────────────

const MessageContent = memo(function MessageContent({
  content,
  expanded,
  onToggle,
  textRight,
}: {
  content: string;
  expanded: boolean;
  onToggle: () => void;
  textRight?: boolean;
}) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [isClamped, setIsClamped] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    // scrollHeight > clientHeight → 2줄 초과
    setIsClamped(el.scrollHeight > el.clientHeight + 1);
  }, [content]);

  if (!content) return null;

  return (
    <div className="relative">
      <p
        ref={textRef}
        className={`text-base text-[#1A1A1A] whitespace-pre-wrap break-words leading-snug ${!expanded ? 'line-clamp-2' : ''} ${textRight ? 'text-right' : ''}`}
      >
        {content}
      </p>
      {isClamped && !expanded && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="absolute right-0 bottom-0 bg-gradient-to-l from-[#FDFBF7] via-[#FDFBF7] to-transparent pl-6 pr-0.5 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 13l-7 7-7-7" />
          </svg>
        </button>
      )}
      {expanded && isClamped && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="mt-1 text-xs text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors"
        >
          접기
        </button>
      )}
    </div>
  );
});

// ─── 미디어/파일 드로어 (좌측 슬라이드) ─────────────────

const MediaDrawer = memo(function MediaDrawer({
  announcements, onClose, onImageClick, headerContent,
}: {
  announcements: Announcement[];
  onClose: () => void;
  onImageClick: (url: string) => void;
  headerContent?: React.ReactNode;
}) {
  // 다중 이미지/파일 지원 (하위 호환)
  const images = announcements.flatMap(getImageUrls);
  const files = announcements.flatMap(getFiles);

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
        className="absolute left-0 top-0 bottom-0 w-[280px] z-30 flex flex-col bg-black/60 backdrop-blur-2xl"
      >
        <div className="flex items-center gap-3 px-4 h-[52px] shrink-0 border-b border-white/10">
          <button onClick={onClose} className="p-1">
            <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="font-bold text-white/90 text-sm">미디어 · 파일</span>
        </div>
        {headerContent && (
          <div className="shrink-0 px-4 py-2 border-b border-white/10">{headerContent}</div>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-5">
          {images.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-white/50 mb-2 tracking-wider">이미지</p>
              <div className="grid grid-cols-3 gap-1.5">
                {images.map((url, i) => (
                  <button key={i} onClick={() => onImageClick(url)} className="aspect-square overflow-hidden rounded-md border border-white/10">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {files.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-white/50 mb-2 tracking-wider">파일</p>
              <div className="space-y-2">
                {files.map((f, i) => (
                  <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" download={f.name}
                    className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-5 h-5 text-white/50 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white/90 truncate">{f.name}</p>
                      {f.size > 0 && <p className="text-[10px] text-white/40">{fmtSize(f.size)}</p>}
                    </div>
                    <svg className="w-4 h-4 text-white/40 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </a>
                ))}
              </div>
            </div>
          )}
          {images.length === 0 && files.length === 0 && (
            <div className="flex items-center justify-center text-sm text-white/40 py-20">
              아직 올린 미디어가 없습니다.
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
});

// ─── 메시지 아이템 (memo로 불필요한 리렌더 방지) ────────

const AnnouncementMessageItem = memo(function AnnouncementMessageItem({
  announcement: a,
  showDate,
  isOwnProfessor,
  isExpanded,
  isHighlighted,
  showEmojiPickerForThis,
  profileUid,
  onToggleExpand,
  onReaction,
  onToggleEmojiPicker,
  onVote,
  onImageClick,
}: {
  announcement: Announcement;
  showDate: boolean;
  isOwnProfessor: boolean;
  isExpanded: boolean;
  isHighlighted: boolean;
  showEmojiPickerForThis: boolean;
  profileUid?: string;
  onToggleExpand: (id: string) => void;
  onReaction: (aid: string, emoji: string) => void;
  onToggleEmojiPicker: (aid: string | null) => void;
  onVote: (aid: string, pollIdx: number, optIndices: number[]) => void;
  onImageClick: (url: string) => void;
}) {
  const readCount = useMemo(() => (a.readBy?.filter((uid) => uid !== a.createdBy) || []).length, [a.readBy, a.createdBy]);
  const reactions = useMemo(() => Object.entries(a.reactions || {}), [a.reactions]);
  const imgUrls = useMemo(() => getImageUrls(a), [a.imageUrls, a.imageUrl]);
  const fileList = useMemo(() => getFiles(a), [a.files, a.fileUrl, a.fileName, a.fileType, a.fileSize]);
  const pollList = useMemo(() => getPolls(a), [a.polls, a.poll]);

  const hasMedia = imgUrls.length > 0 || fileList.length > 0 || pollList.length > 0;
  const hasMultiItems = imgUrls.length > 1 || fileList.length > 1 || pollList.length > 1;

  const handleToggleExpand = useCallback(() => onToggleExpand(a.id), [onToggleExpand, a.id]);

  return (
    <div data-msg-id={a.id}>
      {showDate && a.createdAt && (
        <div className="flex items-center gap-3 my-1.5">
          <div className="flex-1 border-t border-dashed border-white/20" />
          <span className="text-xs text-white/60 whitespace-nowrap">{fmtDate(a.createdAt)}</span>
          <div className="flex-1 border-t border-dashed border-white/20" />
        </div>
      )}
      <div className={`flex gap-2 ${isOwnProfessor ? 'flex-row-reverse' : ''} ${isHighlighted ? 'bg-black/15 rounded-xl p-1 -m-1' : ''}`}>
        <img src="/notice/avatar_professor.png" alt="교수님" className="w-14 h-14 shrink-0 object-cover rounded-full mt-0.5" />
        <div className={`min-w-0 ${hasMedia ? 'w-[65%]' : 'min-w-[50%] max-w-[70%]'} ${isOwnProfessor ? 'flex flex-col items-end' : ''}`}>
          <p className={`text-base font-bold text-white/70 mb-0.5 ${isOwnProfessor ? 'text-right' : ''}`}>Prof. Kim</p>
          <Bubble className={hasMedia ? 'w-full' : 'w-fit'} sidePadding={hasMultiItems ? BUBBLE_SIDE_MULTI : undefined}>
            <MessageContent content={a.content} expanded={isExpanded} onToggle={handleToggleExpand} textRight={isOwnProfessor && hasMedia} />
            <ImageCarousel urls={imgUrls} onImageClick={onImageClick} />
            <FileCarousel files={fileList} />
            <PollCarousel polls={pollList} announcementId={a.id} profileUid={profileUid} onVote={onVote} />
          </Bubble>
          <p className={`text-xs text-white/50 mt-1 ${isOwnProfessor ? 'text-right' : ''}`}>
            {readCount > 0 && <>{readCount}명 읽음</>}
            {readCount > 0 && a.createdAt && ' · '}
            {a.createdAt && fmtTime(a.createdAt)}
          </p>
          <div className={`flex items-center gap-1 mt-1 relative flex-wrap ${isOwnProfessor ? 'flex-row-reverse' : ''}`}>
            {reactions.map(([emoji, uids]) => (
              <button key={emoji} onClick={() => onReaction(a.id, emoji)}
                className={`text-sm px-1 py-0.5 rounded border ${profileUid && uids.includes(profileUid) ? 'border-white/40 bg-white/20' : 'border-white/20 bg-white/10'}`}
              >
                {emoji} <span className="text-xs text-white/60">{uids.length}</span>
              </button>
            ))}
            <button
              onClick={(e) => { e.stopPropagation(); onToggleEmojiPicker(showEmojiPickerForThis ? null : a.id); }}
              className="text-white/30 hover:text-white/60 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {showEmojiPickerForThis && (
              <div
                className={`absolute ${isOwnProfessor ? 'right-0' : 'left-0'} bottom-full mb-1 bg-black/60 backdrop-blur-md border border-white/20 rounded-lg p-1.5 flex gap-1 z-20 shadow-lg`}
                onClick={(e) => e.stopPropagation()}
              >
                {REACTION_EMOJIS.map((em) => (
                  <button key={em} onClick={() => onReaction(a.id, em)} className="text-lg hover:scale-110 transition-transform">{em}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

// ─── 메인 컴포넌트 ──────────────────────────────────────

export default function AnnouncementChannel({
  overrideCourseId,
  headerContent,
}: {
  overrideCourseId?: string;
  headerContent?: React.ReactNode;
} = {}) {
  const { profile, isProfessor } = useUser();
  const { userCourseId: contextCourseId } = useCourse();
  const userCourseId = overrideCourseId ?? contextCourseId;
  const { theme } = useTheme();
  const { uploadImage, uploadFile, uploadMultipleImages, uploadMultipleFiles, loading: uploadLoading } = useUpload();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [hasText, setHasText] = useState(false);
  const prevOverflowRef = useRef(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  // 캐러셀 투표 편집기: 각 항목이 하나의 투표 폼
  const [editingPolls, setEditingPolls] = useState<EditingPoll[]>([{ question: '', options: ['', ''], allowMultiple: false, maxSelections: 2 }]);
  const [editingPollIdx, setEditingPollIdx] = useState(0);
  const [showMaxSelDropdown, setShowMaxSelDropdown] = useState(false);
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [pendingImagePreviews, setPendingImagePreviews] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  const [sheetTop, setSheetTop] = useState(0);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [showScrollFab, setShowScrollFab] = useState(false);
  // 모달 콘텐츠 지연 렌더링 (애니메이션 후 메시지 표시)
  const [modalReady, setModalReady] = useState(false);
  // 검색
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [searchIdx, setSearchIdx] = useState(0);
  // 캘린더
  const [showCalendar, setShowCalendar] = useState(false);
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  // 캘린더 닫힐 때 년도/월 초기화
  useEffect(() => {
    if (!showCalendar) {
      setCalYear(new Date().getFullYear());
      setCalMonth(new Date().getMonth());
    }
  }, [showCalendar]);
  // 입력창 확장 (2줄 이상일 때 max-height 해제)
  const [inputExpanded, setInputExpanded] = useState(false);
  const [inputOverflows, setInputOverflows] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollFabRef = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const msgAreaRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ─── 네비게이션 숨김
  useEffect(() => {
    if (showModal) document.body.setAttribute('data-hide-nav', '');
    else document.body.removeAttribute('data-hide-nav');
    return () => document.body.removeAttribute('data-hide-nav');
  }, [showModal]);

  // ─── 모달 열림 시 body 스크롤 방지
  useEffect(() => {
    if (!showModal) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [showModal]);

  // ─── 모달 콘텐츠 지연 렌더링 (닫힐 때 초기화)
  useEffect(() => {
    if (!showModal) setModalReady(false);
  }, [showModal]);

  // ─── 공지 구독 (증분 업데이트: 변경된 문서만 새 객체 생성 → memo 유지)
  useEffect(() => {
    if (!userCourseId) return;
    let isFirst = true;
    const q = query(
      collection(db, 'announcements'),
      where('courseId', '==', userCourseId),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(q, (snap) => {
      if (isFirst) {
        // 최초 로드: 전부 생성
        isFirst = false;
        setAnnouncements(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Announcement[]);
        setLoading(false);
        return;
      }
      // 증분: 변경된 문서만 교체, 나머지는 기존 참조 유지
      const changes = snap.docChanges();
      if (changes.length === 0) return;
      setAnnouncements((prev) => {
        const map = new Map(prev.map((a) => [a.id, a]));
        changes.forEach((change) => {
          if (change.type === 'removed') {
            map.delete(change.doc.id);
          } else {
            map.set(change.doc.id, { id: change.doc.id, ...change.doc.data() } as Announcement);
          }
        });
        return Array.from(map.values()).sort((a, b) => {
          const ta = a.createdAt?.toMillis() ?? 0;
          const tb = b.createdAt?.toMillis() ?? 0;
          return tb - ta;
        });
      });
    });
    return () => unsub();
  }, [userCourseId]);

  // ─── 미읽음
  useEffect(() => {
    if (!userCourseId || !announcements.length) { setHasUnread(false); return; }
    const lr = localStorage.getItem(lastReadKey(userCourseId));
    if (!lr) { setHasUnread(true); return; }
    const latest = announcements[0];
    if (!latest?.createdAt) { setHasUnread(false); return; }
    setHasUnread(latest.createdAt.toDate().getTime() > new Date(lr).getTime());
  }, [announcements, userCourseId, showModal]);

  // ─── 읽음 처리 (모달 열릴 때 1회만 실행 — 캐스케이드 방지)
  const readMarkedRef = useRef(false);
  useEffect(() => {
    if (!showModal) { readMarkedRef.current = false; return; }
    if (readMarkedRef.current || !userCourseId || !profile || !announcements.length) return;
    readMarkedRef.current = true;
    localStorage.setItem(lastReadKey(userCourseId), new Date().toISOString());
    setHasUnread(false);
    // 아직 읽지 않은 공지만 업데이트
    const unread = announcements.filter((a) => !a.readBy?.includes(profile.uid));
    unread.forEach((a) => {
      updateDoc(doc(db, 'announcements', a.id), { readBy: arrayUnion(profile.uid) }).catch(() => {});
    });
  }, [showModal, userCourseId, profile, announcements]);

  // ─── 스크롤
  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (showModal && !showMedia) {
      const t = setTimeout(scrollToBottom, 100);
      return () => clearTimeout(t);
    }
  }, [showModal, showMedia, announcements.length, scrollToBottom]);

  // ─── 시간순 정렬 (검색/렌더링에서 사용)
  const chrono = useMemo(() => [...announcements].reverse(), [announcements]);

  // ─── 이미지 선택 (다중)
  const onImgSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPendingImages((prev) => [...prev, ...files]);
    setPendingImagePreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))]);
    e.target.value = '';
  };
  const clearImg = (idx: number) => {
    URL.revokeObjectURL(pendingImagePreviews[idx]);
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
    setPendingImagePreviews((prev) => prev.filter((_, i) => i !== idx));
  };
  const clearAllImgs = () => {
    pendingImagePreviews.forEach((url) => URL.revokeObjectURL(url));
    setPendingImages([]);
    setPendingImagePreviews([]);
  };

  // ─── 파일 선택 (다중)
  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  };
  const clearFile = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // ─── 드래그 앤 드롭 (PC에서 파일/이미지 드래그로 첨부)
  const dragCountRef = useRef(0);
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCountRef.current++;
    if (dragCountRef.current === 1) setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current <= 0) { dragCountRef.current = 0; setIsDragOver(false); }
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCountRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    const others = files.filter((f) => !f.type.startsWith('image/'));
    if (images.length > 0) {
      setPendingImages((prev) => [...prev, ...images]);
      setPendingImagePreviews((prev) => [...prev, ...images.map((f) => URL.createObjectURL(f))]);
    }
    if (others.length > 0) {
      setPendingFiles((prev) => [...prev, ...others]);
    }
  }, []);

  // ─── 검색 로직
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); setSearchIdx(0); return; }
    const q = searchQuery.toLowerCase();
    const ids = chrono.filter((a) => a.content?.toLowerCase().includes(q)).map((a) => a.id);
    setSearchResults(ids);
    setSearchIdx(ids.length > 0 ? ids.length - 1 : 0);
  }, [searchQuery, chrono]);

  const scrollToMessage = useCallback((msgId: string) => {
    const el = msgAreaRef.current?.querySelector(`[data-msg-id="${msgId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const navigateSearch = useCallback((dir: 'up' | 'down') => {
    if (!searchResults.length) return;
    const next = dir === 'up' ? searchIdx - 1 : searchIdx + 1;
    if (next < 0 || next >= searchResults.length) return;
    setSearchIdx(next);
    scrollToMessage(searchResults[next]);
  }, [searchResults, searchIdx, scrollToMessage]);

  // ─── 입력창 확장 토글
  const toggleInputExpand = useCallback(() => {
    setInputExpanded((prev) => {
      const next = !prev;
      requestAnimationFrame(() => {
        const t = textareaRef.current;
        if (!t) return;
        t.style.height = 'auto';
        t.style.height = (next ? t.scrollHeight : 36) + 'px';
        if (!next) t.scrollTop = t.scrollHeight;
      });
      return next;
    });
  }, []);

  // ─── 펼치기/접기 토글
  const toggleExpand = useCallback((id: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── 공지 작성
  const handlePost = async () => {
    const validPolls = showPollCreator ? editingPolls.filter((p) => p.question.trim() && p.options.filter((o) => o.trim()).length >= 2) : [];
    const hasPoll = validPolls.length > 0;
    const content = textareaRef.current?.value?.trim() || '';
    if (!profile || !userCourseId || (!content && !pendingImages.length && !pendingFiles.length && !hasPoll)) return;
    try {
      const data: Record<string, unknown> = {
        content, reactions: {}, readBy: [],
        createdAt: serverTimestamp(), createdBy: profile.uid, courseId: userCourseId,
      };
      // 다중 이미지 업로드
      if (pendingImages.length > 0) {
        const urls = await uploadMultipleImages(pendingImages);
        if (urls.length > 0) data.imageUrls = urls;
      }
      // 다중 파일 업로드
      if (pendingFiles.length > 0) {
        const fileInfos = await uploadMultipleFiles(pendingFiles);
        if (fileInfos.length > 0) {
          data.files = fileInfos.map((fi) => ({ url: fi.url, name: fi.name, type: fi.type, size: fi.size }));
        }
      }
      // 다중 투표 수집
      if (validPolls.length > 0) {
        data.polls = validPolls.map((p) => {
          const opts = p.options.filter((o) => o.trim());
          return {
            question: p.question.trim(), options: opts, votes: {}, allowMultiple: p.allowMultiple,
            ...(p.allowMultiple ? { maxSelections: Math.min(p.maxSelections, opts.length) } : {}),
          };
        });
      }
      await addDoc(collection(db, 'announcements'), data);
      if (textareaRef.current) textareaRef.current.value = '';
      setHasText(false); setShowPollCreator(false);
      setEditingPolls([{ question: '', options: ['', ''], allowMultiple: false, maxSelections: 2 }]);
      setEditingPollIdx(0); clearAllImgs(); setPendingFiles([]); setShowToolbar(false);
      setInputExpanded(false); setInputOverflows(false);
      requestAnimationFrame(() => { const t = textareaRef.current; if (t) t.style.height = '36px'; });
    } catch (err) { console.error('공지 작성 실패:', err); }
  };

  // ─── 이모지 반응
  const handleReaction = useCallback(async (aid: string, emoji: string) => {
    if (!profile) return;
    const a = announcements.find((x) => x.id === aid); if (!a) return;
    const cur = a.reactions || {}; const arr = cur[emoji] || [];
    const has = arr.includes(profile.uid);
    const upd = { ...cur };
    if (has) { upd[emoji] = arr.filter((id) => id !== profile.uid); if (!upd[emoji].length) delete upd[emoji]; }
    else { upd[emoji] = [...arr, profile.uid]; }
    try { await updateDoc(doc(db, 'announcements', aid), { reactions: upd }); } catch {}
    setShowEmojiPicker(null);
  }, [profile, announcements]);

  // ─── 투표 (단일/복수 공통)
  const handleVote = useCallback(async (aid: string, pollIdx: number, optIndices: number[]) => {
    if (!profile || optIndices.length === 0) return;
    const a = announcements.find((x) => x.id === aid); if (!a) return;
    const allPolls = getPolls(a);
    const poll = allPolls[pollIdx]; if (!poll) return;
    const cur = poll.votes || {};
    const upd: Record<string, string[]> = {};
    Object.keys(cur).forEach((k) => { upd[k] = cur[k].filter((id) => id !== profile.uid); });
    optIndices.forEach((optIdx) => {
      const key = optIdx.toString(); if (!upd[key]) upd[key] = [];
      upd[key].push(profile.uid);
    });
    // polls 배열 전체를 복사 후 해당 투표의 votes만 교체하여 통째로 업데이트
    // (dot notation polls.0.votes 사용 시 Firestore가 배열→객체로 변환하는 버그 방지)
    if (a.polls) {
      const newPolls = allPolls.map((p, i) => i === pollIdx ? { ...p, votes: upd } : p);
      try { await updateDoc(doc(db, 'announcements', aid), { polls: newPolls }); } catch (err) { console.error('투표 실패:', err); }
    } else {
      try { await updateDoc(doc(db, 'announcements', aid), { 'poll.votes': upd }); } catch (err) { console.error('투표 실패:', err); }
    }
  }, [profile, announcements]);

  // ─── 이모지 피커 토글
  const handleToggleEmojiPicker = useCallback((aid: string | null) => {
    setShowEmojiPicker(aid);
  }, []);

  // ─── 이미지 클릭
  const handleImageClick = useCallback((url: string) => {
    setViewerImage(url);
  }, []);

  // ─── 파생
  const latest = announcements[0];
  const closeModal = useCallback(() => { setShowModal(false); setShowEmojiPicker(null); setShowMedia(false); setSearchOpen(false); setSearchQuery(''); setShowCalendar(false); }, []);

  // ─── 캘린더 msgDays 메모이제이션
  const calendarYear = isProfessor ? calYear : new Date().getFullYear();
  const msgDays = useMemo(() => {
    const days = new Set<number>();
    chrono.forEach((a) => {
      if (!a.createdAt) return;
      const d = a.createdAt.toDate();
      if (d.getFullYear() === calendarYear && d.getMonth() === calMonth) {
        days.add(d.getDate());
      }
    });
    return days;
  }, [chrono, calendarYear, calMonth]);

  // ═══════════════════════════════════════════════════════
  // 렌더링
  // ═══════════════════════════════════════════════════════

  return (
    <>
      {/* ═══ 홈 미리보기 (2줄: 첫 단어 / 나머지) ═══ */}
      {(() => {
        let raw = '아직 공지가 없습니다.';
        if (loading) {
          raw = '불러오는 중...';
        } else if (latest) {
          // 마지막 메시지가 사진/파일만인 경우 대체 텍스트
          const hasImages = getImageUrls(latest).length > 0;
          const hasFiles = getFiles(latest).length > 0;
          if (latest.content) {
            raw = latest.content;
          } else if (hasImages) {
            raw = '사진을 보냈습니다.';
          } else if (hasFiles) {
            raw = '파일을 보냈습니다.';
          } else if (getPolls(latest).length > 0) {
            raw = '투표를 보냈습니다.';
          }
        }
        const spaceIdx = raw.indexOf(' ');
        // 띄어쓰기가 없으면 첫 글자 / 나머지로 분리
        const firstWord = spaceIdx > 0 ? raw.slice(0, spaceIdx) : raw.slice(0, 1);
        const rest = spaceIdx > 0 ? raw.slice(spaceIdx + 1) : (raw.length > 1 ? raw.slice(1) : '');
        return (
          <div ref={previewRef}>
          <button onClick={() => {
            if (previewRef.current) {
              setSheetTop(previewRef.current.getBoundingClientRect().bottom);
            }
            setShowModal(true);
          }} className="w-full text-left flex items-center">
            <div className="flex-1 min-w-0">
              <p className="text-4xl font-bold text-white">{firstWord}</p>
              <p className="text-4xl font-bold text-white truncate">{rest || '\u00A0'}</p>
            </div>
            <div className="flex-shrink-0 ml-3 self-center">
              <svg className="w-6 h-6 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
          </div>
        );
      })()}

      {/* ═══ 바텀시트 ═══ */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showModal && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end bg-black/40"
              onClick={closeModal}
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                onAnimationComplete={() => setModalReady(true)}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full flex flex-col overflow-hidden rounded-t-2xl will-change-transform"
                style={{ height: sheetTop > 0 ? `calc(100vh - ${sheetTop + 16}px)` : '92vh' }}
              >
                {/* ── 배경 이미지 (blur를 이미지에 직접 적용 — backdrop-blur보다 GPU 효율적) ── */}
                <div className="absolute inset-0 rounded-t-2xl overflow-hidden">
                  <img
                    src="/images/home-bg.jpg" alt=""
                    className="w-full h-full object-cover blur-2xl scale-110"
                  />
                </div>
                {/* ── 글래스 오버레이 ── */}
                <div className="absolute inset-0 bg-white/10" />

                {/* ── 상단 바 ── */}
                <div className="relative z-10 shrink-0 pt-3 pb-2 px-4">
                  {/* 드래그 핸들 */}
                  <div className="flex justify-center mb-3">
                    <div className="w-10 h-1 bg-white/40 rounded-full" />
                  </div>
                  {/* 메뉴 + 아이콘 + 닫기 */}
                  <div className="flex items-center gap-1">
                    {/* 메뉴 (미디어) */}
                    <button onClick={() => setShowMedia(true)} className="w-9 h-9 flex items-center justify-center">
                      <svg className="w-6 h-6 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    </button>
                    {/* 학생: 캘린더 + 검색 */}
                    {!isProfessor && (
                      <>
                        <button onClick={() => { setShowCalendar(!showCalendar); setSearchOpen(false); }} className="w-9 h-9 flex items-center justify-center">
                          <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </button>
                        {searchOpen ? (
                          <div className="flex-1 flex items-center gap-1 ml-1">
                            <input
                              ref={searchInputRef}
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder="검색..."
                              autoFocus
                              className="flex-1 bg-white/10 border border-white/20 rounded-lg text-sm text-white placeholder:text-white/40 px-2 py-1 focus:outline-none"
                            />
                            <span className="text-xs text-white/50 shrink-0">{searchResults.length > 0 ? `${searchIdx + 1}/${searchResults.length}` : '0'}</span>
                            <button onClick={() => { setSearchOpen(false); setSearchQuery(''); }} className="w-7 h-7 flex items-center justify-center text-white/60">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => { setSearchOpen(true); setShowCalendar(false); }} className="w-9 h-9 flex items-center justify-center">
                            <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                          </button>
                        )}
                      </>
                    )}
                    {!searchOpen && <div className="flex-1" />}
                    <button onClick={closeModal} className="w-9 h-9 flex items-center justify-center shrink-0">
                      <svg className="w-6 h-6 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* 교수님 전용: 과목 행 + 캘린더/검색 */}
                {isProfessor && (
                  <div className="relative z-10 shrink-0 px-4 pb-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setShowCalendar(!showCalendar); setSearchOpen(false); }} className="w-9 h-9 flex items-center justify-center shrink-0">
                        <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </button>
                      <div className="flex-1">{headerContent}</div>
                      {searchOpen ? (
                        <div className="flex items-center gap-1">
                          <input
                            ref={searchInputRef}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="검색..."
                            autoFocus
                            className="w-32 bg-white/10 border border-white/20 rounded-lg text-sm text-white placeholder:text-white/40 px-2 py-1 focus:outline-none"
                          />
                          <span className="text-xs text-white/50">{searchResults.length > 0 ? `${searchIdx + 1}/${searchResults.length}` : '0'}</span>
                          <button onClick={() => { setSearchOpen(false); setSearchQuery(''); }} className="w-7 h-7 flex items-center justify-center text-white/60">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setSearchOpen(true); setShowCalendar(false); }} className="w-9 h-9 flex items-center justify-center shrink-0">
                          <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* 학생 전용: 커스텀 헤더 (과목 전환 없음 - 학생은 자기 과목만) */}
                {!isProfessor && headerContent && (
                  <div className="relative z-10 shrink-0 px-4 pb-2">{headerContent}</div>
                )}

                {/* ── 캘린더 패널 ── */}
                <AnimatePresence>
                  {showCalendar && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="relative z-10 shrink-0 overflow-hidden"
                    >
                      <div className="px-4 pb-3">
                        {/* 연도 선택 (교수님만) */}
                        {isProfessor && (
                          <div className="flex items-center justify-center gap-3 mb-2">
                            <button onClick={() => setCalYear((y) => y - 1)} className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                            </button>
                            <span className="text-sm font-bold text-white/90 min-w-[48px] text-center">{calYear}</span>
                            <button onClick={() => setCalYear((y) => y + 1)} className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                            </button>
                          </div>
                        )}
                        {/* 월 선택 */}
                        <div className="flex items-center justify-center gap-3 mb-2">
                          <button onClick={() => setCalMonth((m) => m === 0 ? 11 : m - 1)} className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                          </button>
                          <span className="text-sm font-bold text-white/90 min-w-[48px] text-center">{calMonth + 1}월</span>
                          <button onClick={() => setCalMonth((m) => m === 11 ? 0 : m + 1)} className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          </button>
                        </div>
                        {/* 달력 그리드 */}
                        {(() => {
                          const firstDay = new Date(calendarYear, calMonth, 1).getDay();
                          const daysInMonth = new Date(calendarYear, calMonth + 1, 0).getDate();
                          const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
                          return (
                            <div>
                              <div className="grid grid-cols-7 gap-0.5 mb-1">
                                {dayLabels.map((d) => (
                                  <div key={d} className="text-center text-[10px] text-white/40 py-0.5">{d}</div>
                                ))}
                              </div>
                              <div className="grid grid-cols-7 gap-1 px-1">
                                {Array.from({ length: firstDay }).map((_, i) => (
                                  <div key={`e-${i}`} />
                                ))}
                                {Array.from({ length: daysInMonth }).map((_, i) => {
                                  const day = i + 1;
                                  const hasMsg = msgDays.has(day);
                                  return (
                                    <button
                                      key={day}
                                      onClick={() => {
                                        if (!hasMsg) return;
                                        const target = chrono.find((a) => {
                                          if (!a.createdAt) return false;
                                          const d = a.createdAt.toDate();
                                          return d.getFullYear() === calendarYear && d.getMonth() === calMonth && d.getDate() === day;
                                        });
                                        if (target) {
                                          setShowCalendar(false);
                                          setTimeout(() => scrollToMessage(target.id), 100);
                                        }
                                      }}
                                      className={`w-7 h-7 mx-auto flex items-center justify-center text-[11px] rounded-full ${hasMsg ? 'bg-white/20 text-white font-bold ring-1 ring-white/40' : 'text-white/40'}`}
                                    >
                                      {day}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* ── 메시지 영역 ── */}
                <div
                  ref={msgAreaRef}
                  className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-4"
                  onClick={() => setShowEmojiPicker(null)}
                  onScroll={() => {
                    const el = msgAreaRef.current;
                    if (!el) return;
                    const shouldShow = (el.scrollHeight - el.scrollTop - el.clientHeight) > 200;
                    if (shouldShow !== scrollFabRef.current) {
                      scrollFabRef.current = shouldShow;
                      setShowScrollFab(shouldShow);
                    }
                  }}
                >
                  {!modalReady || !announcements.length ? (
                    <div className="h-full flex items-center justify-center text-white/50 text-sm">
                      {loading || !modalReady ? '불러오는 중...' : '아직 공지가 없습니다.'}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {chrono.map((a, i) => {
                        const prev = chrono[i - 1];
                        const showDate = i === 0 || !prev?.createdAt || dateKey(prev.createdAt) !== dateKey(a.createdAt);
                        const isOwnProfessor = !!(isProfessor && profile && a.createdBy === profile.uid);
                        const isHighlighted = searchResults.length > 0 && searchResults[searchIdx] === a.id;

                        return (
                          <AnnouncementMessageItem
                            key={a.id}
                            announcement={a}
                            showDate={showDate}
                            isOwnProfessor={isOwnProfessor}
                            isExpanded={expandedMessages.has(a.id)}
                            isHighlighted={isHighlighted}
                            showEmojiPickerForThis={showEmojiPicker === a.id}
                            profileUid={profile?.uid}
                            onToggleExpand={toggleExpand}
                            onReaction={handleReaction}
                            onToggleEmojiPicker={handleToggleEmojiPicker}
                            onVote={handleVote}
                            onImageClick={handleImageClick}
                          />
                        );
                      })}
                      <div ref={endRef} />
                    </div>
                  )}
                </div>

                {/* ── 하단 FAB 영역 (교수: 좌측, 학생: 우측) ── */}
                <div className={`absolute ${isProfessor ? 'left-4' : 'right-4'} bottom-20 z-20 flex flex-col gap-2`}>
                  {/* 검색 네비게이션 (검색 중일 때만) */}
                  <AnimatePresence>
                    {searchResults.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex flex-col gap-1"
                      >
                        {searchIdx > 0 && (
                          <button
                            onClick={() => navigateSearch('up')}
                            className="w-10 h-10 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white/70 hover:text-white shadow-lg"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                            </svg>
                          </button>
                        )}
                        {searchIdx < searchResults.length - 1 && (
                          <button
                            onClick={() => navigateSearch('down')}
                            className="w-10 h-10 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white/70 hover:text-white shadow-lg"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                            </svg>
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {/* 스크롤 초기화 */}
                  <AnimatePresence>
                    {showScrollFab && !searchQuery && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        onClick={scrollToBottom}
                        className="w-10 h-10 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white/70 hover:text-white shadow-lg"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>

                {/* ── 하단 입력 (교수님 전용) ── */}
                {isProfessor && (
                  <div
                    className="relative z-10 shrink-0 border-t border-white/10 bg-black/20 backdrop-blur-sm px-3 py-3"
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                  >
                    {/* 드래그 오버레이 */}
                    {isDragOver && (
                      <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/10 backdrop-blur-sm border-2 border-dashed border-white/40 rounded-xl pointer-events-none">
                        <p className="text-sm font-bold text-white/70">파일을 여기에 놓으세요</p>
                      </div>
                    )}
                    {/* 첨부 미리보기 */}
                    {(pendingImagePreviews.length > 0 || pendingFiles.length > 0 || showPollCreator) && (
                      <div className="mb-2 space-y-1.5">
                        {/* 다중 이미지 미리보기 */}
                        {pendingImagePreviews.length > 0 && (
                          <div className="flex gap-1.5 overflow-x-auto">
                            {pendingImagePreviews.map((url, idx) => (
                              <div key={idx} className="relative shrink-0">
                                <img src={url} alt="" className="h-14 object-cover rounded-lg border border-white/15" />
                                <button onClick={() => clearImg(idx)} className="absolute -top-1 -right-1 w-4 h-4 bg-white/80 text-black flex items-center justify-center text-[8px] rounded-full">✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* 다중 파일 미리보기 */}
                        {pendingFiles.map((f, idx) => (
                          <div key={idx} className="flex items-center gap-2 p-1.5 bg-white/5 border border-white/15 rounded-lg text-[11px]">
                            <span className="truncate flex-1 text-white/80">{f.name}</span>
                            <span className="text-white/40 shrink-0">{fmtSize(f.size)}</span>
                            <button onClick={() => clearFile(idx)} className="text-white/60 font-bold shrink-0">✕</button>
                          </div>
                        ))}
                        {/* 투표 캐러셀 편집기 */}
                        {showPollCreator && (() => {
                          const cur = editingPolls[editingPollIdx] || editingPolls[0];
                          const pi = editingPollIdx;
                          const updateCur = (fn: (p: EditingPoll) => EditingPoll) => {
                            setEditingPolls((prev) => prev.map((p, i) => i === pi ? fn(p) : p));
                          };
                          return (
                            <div className="flex items-stretch gap-1.5">
                              {/* 메인 투표 폼 */}
                              <div className="flex-1 min-w-0 p-2 border border-white/15 bg-white/5 rounded-lg space-y-1">
                                {/* 투표 인디케이터 (2개 이상일 때) */}
                                {editingPolls.length > 1 && (
                                  <div className="flex items-center justify-between mb-1">
                                    <button
                                      onClick={() => setEditingPollIdx(Math.max(0, pi - 1))}
                                      disabled={pi === 0}
                                      className="p-0.5 text-white/40 hover:text-white/80 disabled:text-white/15 transition-colors"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                                      </svg>
                                    </button>
                                    <div className="flex items-center gap-1">
                                      {editingPolls.map((_, di) => (
                                        <button
                                          key={di}
                                          onClick={() => setEditingPollIdx(di)}
                                          className={`w-1.5 h-1.5 rounded-full transition-colors ${di === pi ? 'bg-white/80' : 'bg-white/25'}`}
                                        />
                                      ))}
                                    </div>
                                    <button
                                      onClick={() => setEditingPollIdx(Math.min(editingPolls.length - 1, pi + 1))}
                                      disabled={pi === editingPolls.length - 1}
                                      className="p-0.5 text-white/40 hover:text-white/80 disabled:text-white/15 transition-colors"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                      </svg>
                                    </button>
                                  </div>
                                )}
                                <input value={cur.question} onChange={(e) => updateCur((p) => ({ ...p, question: e.target.value }))} placeholder="투표 질문"
                                  className="w-full p-1.5 border border-white/15 bg-white/10 rounded-lg text-[11px] text-white placeholder:text-white/40 focus:outline-none" />
                                {cur.options.map((o, idx) => (
                                  <div key={idx} className="flex items-center w-full border border-white/15 bg-white/10 rounded-lg">
                                    <input value={o}
                                      onChange={(e) => updateCur((p) => {
                                        const opts = [...p.options]; opts[idx] = e.target.value; return { ...p, options: opts };
                                      })}
                                      placeholder={`선택지 ${idx + 1}`}
                                      className="flex-1 min-w-0 p-1.5 bg-transparent text-[11px] text-white placeholder:text-white/40 focus:outline-none" />
                                    {cur.options.length > 2 && (
                                      <button
                                        onClick={() => updateCur((p) => ({ ...p, options: p.options.filter((_, i) => i !== idx) }))}
                                        className="px-1.5 shrink-0 text-white/30 hover:text-white/70 transition-colors"
                                      >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                ))}
                                <button onClick={() => updateCur((p) => ({ ...p, options: [...p.options, ''] }))} className="text-[11px] text-white/40 hover:text-white/70">+ 선택지 추가</button>
                                {/* 복수선택 + 삭제 */}
                                <div className="flex items-center gap-2 pt-1 border-t border-white/10">
                                  <label className="flex items-center gap-1.5 text-[11px] text-white/70 cursor-pointer select-none">
                                    <input
                                      type="checkbox" checked={cur.allowMultiple}
                                      onChange={(e) => { updateCur((p) => ({ ...p, allowMultiple: e.target.checked, maxSelections: 2 })); setShowMaxSelDropdown(false); }}
                                      className="w-3 h-3 accent-white"
                                    />
                                    복수선택
                                  </label>
                                  {cur.allowMultiple && (() => {
                                    const totalSlots = Math.max(cur.options.length, 1);
                                    const choices = Array.from({ length: totalSlots }, (_, i) => i + 1);
                                    return (
                                      <div className="flex items-center gap-1">
                                        <span className="text-[11px] text-white/50">최대</span>
                                        <div className="relative">
                                          <button
                                            onClick={() => setShowMaxSelDropdown((v) => !v)}
                                            className="flex items-center gap-0.5 px-2 py-0.5 border border-white/20 bg-white/10 rounded-md text-[11px] text-white hover:bg-white/20 transition-colors"
                                          >
                                            {cur.maxSelections}개
                                            <svg className={`w-2.5 h-2.5 text-white/50 transition-transform ${showMaxSelDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                                            </svg>
                                          </button>
                                          <AnimatePresence>
                                            {showMaxSelDropdown && (
                                              <>
                                                <div className="fixed inset-0 z-30" onClick={() => setShowMaxSelDropdown(false)} />
                                                <motion.div
                                                  initial={{ opacity: 0, y: 4 }}
                                                  animate={{ opacity: 1, y: 0 }}
                                                  exit={{ opacity: 0, y: 4 }}
                                                  transition={{ duration: 0.15 }}
                                                  className="absolute left-0 right-0 bottom-full mb-1 bg-black/70 backdrop-blur-md border border-white/20 rounded-lg overflow-hidden shadow-lg z-40"
                                                >
                                                  {choices.map((n) => (
                                                    <button
                                                      key={n}
                                                      onClick={() => { updateCur((p) => ({ ...p, maxSelections: n })); setShowMaxSelDropdown(false); }}
                                                      className={`w-full px-2 py-1.5 text-[11px] text-center hover:bg-white/15 transition-colors ${n === cur.maxSelections ? 'text-white font-bold bg-white/10' : 'text-white/70'}`}
                                                    >
                                                      {n}개
                                                    </button>
                                                  ))}
                                                </motion.div>
                                              </>
                                            )}
                                          </AnimatePresence>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                  <div className="flex-1" />
                                  {/* 이 투표 삭제 (2개 이상일 때만) */}
                                  {editingPolls.length > 1 && (
                                    <button
                                      onClick={() => {
                                        setEditingPolls((prev) => prev.filter((_, i) => i !== pi));
                                        setEditingPollIdx(Math.max(0, pi - 1));
                                      }}
                                      className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors"
                                    >
                                      삭제
                                    </button>
                                  )}
                                </div>
                              </div>
                              {/* 우측 + 버튼 */}
                              <button
                                onClick={() => {
                                  setEditingPolls((prev) => [...prev, { question: '', options: ['', ''], allowMultiple: false, maxSelections: 2 }]);
                                  setEditingPollIdx(editingPolls.length);
                                }}
                                className="shrink-0 w-8 flex items-center justify-center border border-white/15 bg-white/5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                                title="투표 추가"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* 입력 행 */}
                    <div className="flex items-center gap-2">
                      <button onClick={() => setShowToolbar(!showToolbar)}
                        className="w-9 h-9 flex items-center justify-center shrink-0 text-white/50 hover:text-white/80 transition-colors -mt-1"
                      >
                        <motion.svg animate={{ rotate: showToolbar ? 45 : 0 }} className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </motion.svg>
                      </button>

                      <div className="flex-1 relative">
                        <textarea
                          ref={textareaRef}
                          onInput={(e) => {
                            const t = e.currentTarget;
                            // 빈↔비어있지않음 경계에서만 상태 업데이트 (리렌더 최소화)
                            const hasNow = t.value.trim().length > 0;
                            if (hasNow !== hasText) setHasText(hasNow);
                            // 높이 조절 (직접 DOM, 상태 X)
                            t.style.height = 'auto';
                            const oneLineH = 36;
                            const isMultiLine = t.scrollHeight > oneLineH + 4;
                            if (isMultiLine !== prevOverflowRef.current) {
                              prevOverflowRef.current = isMultiLine;
                              setInputOverflows(isMultiLine);
                            }
                            if (inputExpanded) {
                              t.style.height = t.scrollHeight + 'px';
                            } else {
                              t.style.height = oneLineH + 'px';
                              t.scrollTop = t.scrollHeight;
                            }
                          }}
                          placeholder="공지를 입력하세요..."
                          className={`w-full bg-white/10 border border-white/15 rounded-xl resize-none focus:outline-none text-sm text-white placeholder:text-white/40 px-3 py-2 pr-8 min-h-[36px] ${inputExpanded ? '' : 'max-h-[36px] overflow-hidden'}`}
                          rows={1}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
                        />
                        {/* 입력창 확장/축소 버튼 (2줄 이상일 때만) */}
                        {inputOverflows && (
                          <button
                            onClick={toggleInputExpand}
                            className="absolute right-1.5 top-1.5 w-6 h-6 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors"
                            title={inputExpanded ? '입력창 줄이기' : '입력창 펼치기'}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {inputExpanded ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              )}
                            </svg>
                          </button>
                        )}
                      </div>

                      <button onClick={handlePost}
                        disabled={(!hasText && !pendingImages.length && !pendingFiles.length && !(showPollCreator && editingPolls.some((p) => p.question.trim() && p.options.filter((o) => o.trim()).length >= 2))) || uploadLoading}
                        className="w-9 h-9 flex items-center justify-center shrink-0 text-white/70 disabled:text-white/20 transition-colors -mt-1"
                      >
                        {uploadLoading ? (
                          <div className="w-5 h-5 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
                        ) : (
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                          </svg>
                        )}
                      </button>
                    </div>

                    {/* 도구 바 */}
                    <AnimatePresence>
                      {showToolbar && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="flex items-center gap-1.5 pt-2">
                            <button onClick={() => imgRef.current?.click()} className="p-1.5 text-white/50 hover:text-white/80 transition-colors" title="이미지">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </button>
                            <button onClick={() => fileRef.current?.click()} className="p-1.5 text-white/50 hover:text-white/80 transition-colors" title="파일">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                              </svg>
                            </button>
                            <button onClick={() => {
                              if (showPollCreator) {
                                setShowPollCreator(false);
                                setEditingPolls([{ question: '', options: ['', ''], allowMultiple: false, maxSelections: 2 }]);
                                setEditingPollIdx(0);
                              } else {
                                setShowPollCreator(true);
                              }
                            }}
                              className={`p-1.5 transition-colors ${showPollCreator ? 'text-white/80' : 'text-white/50'} hover:text-white/80`} title="투표"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                              </svg>
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={onImgSelect} />
                    <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" multiple className="hidden" onChange={onFileSelect} />
                  </div>
                )}

                {/* ── 미디어 드로어 ── */}
                <AnimatePresence>
                  {showMedia && (
                    <MediaDrawer
                      announcements={announcements}
                      onClose={() => setShowMedia(false)}
                      onImageClick={(url) => { setViewerImage(url); setShowMedia(false); }}
                      headerContent={headerContent}
                    />
                  )}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* 전체화면 편집 모달 제거됨 — 입력창 인라인 확장으로 대체 */}

      {/* ═══ 이미지 뷰어 ═══ */}
      {typeof document !== 'undefined' && viewerImage && createPortal(
        <AnimatePresence>
          <ImageViewer src={viewerImage} onClose={() => setViewerImage(null)} />
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
