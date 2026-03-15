'use client';

import React, { useState, useRef, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import type { FileAttachment, Poll } from './types';
import { BUBBLE_STYLES, BUBBLE_SIDE_MULTI, fmtSize, URL_RE } from './types';

// ─── 9-slice 말풍선 ─────────────────────────────────────

export const Bubble = memo(function Bubble({ children, className, sidePadding }: { children: React.ReactNode; className?: string; sidePadding?: number }) {
  const padStyle = sidePadding ? BUBBLE_STYLES.padMulti : BUBBLE_STYLES.padDefault;
  return (
    <div className={`relative overflow-hidden ${className || ''}`} style={padStyle}>
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

export const ImageCarousel = memo(function ImageCarousel({
  urls,
  onImageClick,
}: {
  urls: string[];
  onImageClick: (urls: string[], index: number) => void;
}) {
  const [idx, setIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  if (urls.length === 0) return null;

  if (urls.length === 1) {
    return (
      <button onClick={() => onImageClick(urls, 0)} className="mt-1 block w-full">
        <img src={urls[0]} alt="이미지" className="w-full aspect-[4/3] object-cover border border-[#D4CFC4]" />
      </button>
    );
  }

  return (
    <div className="mt-1">
      <div className="flex items-center -mx-[30px]">
        {/* 좌측 화살표 — 버블 패딩 영역 중앙 */}
        <button
          onClick={() => { const el = containerRef.current?.children[idx - 1] as HTMLElement | undefined; el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }); }}
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
            if (!el || !el.children.length) return;
            // 각 아이템 너비 + gap 기반 정확한 인덱스 계산
            const itemW = (el.children[0] as HTMLElement).offsetWidth;
            const newIdx = Math.round(el.scrollLeft / (itemW + 2)); // gap-0.5 = 2px
            setIdx(Math.min(Math.max(0, newIdx), el.children.length - 1));
          }}
        >
          {/* 이미지 URL은 고유하므로 key로 사용 */}
          {urls.map((url, i) => (
            <button key={url} onClick={() => onImageClick(urls, i)} className="w-full shrink-0 snap-start">
              <img src={url} alt={`이미지 ${i + 1}`} className="w-full aspect-[4/3] object-cover border border-[#D4CFC4]" />
            </button>
          ))}
        </div>
        {/* 우측 화살표 — 버블 패딩 영역 중앙 */}
        <button
          onClick={() => { const el = containerRef.current?.children[idx + 1] as HTMLElement | undefined; el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }); }}
          className={`w-[30px] shrink-0 flex items-center justify-center text-[#5C5C5C] ${idx < urls.length - 1 ? '' : 'invisible'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      {/* 점 인디케이터 */}
      <div className="flex justify-center gap-1 mt-1">
        {urls.map((url, i) => (
          <div key={`dot-${url}`} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === idx ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'}`} />
        ))}
      </div>
    </div>
  );
});

// ─── 파일 캐러셀 ────────────────────────────────────────

export const FileCarousel = memo(function FileCarousel({ files }: { files: FileAttachment[] }) {
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
        <p className="text-xs font-medium text-[#1A1A1A] truncate">{f.name}</p>
        {f.size > 0 && <p className="text-[10px] text-[#8C8478]">{fmtSize(f.size)}</p>}
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
          onClick={() => { const el = containerRef.current?.children[idx - 1] as HTMLElement | undefined; el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }); }}
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
            if (!el || !el.children.length) return;
            const itemW = (el.children[0] as HTMLElement).offsetWidth;
            const newIdx = Math.round(el.scrollLeft / (itemW + 2));
            setIdx(Math.min(Math.max(0, newIdx), el.children.length - 1));
          }}
        >
          {files.map((f) => (
            <div key={f.url} className="w-full shrink-0 snap-start">
              <FileCard f={f} />
            </div>
          ))}
        </div>
        {/* 우측 화살표 — 버블 패딩 영역 중앙 */}
        <button
          onClick={() => { const el = containerRef.current?.children[idx + 1] as HTMLElement | undefined; el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }); }}
          className={`w-[30px] shrink-0 flex items-center justify-center text-[#5C5C5C] ${idx < files.length - 1 ? '' : 'invisible'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      {/* 점 인디케이터 */}
      <div className="flex justify-center gap-1 mt-1">
        {files.map((f, i) => (
          <div key={`dot-${f.url}`} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === idx ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'}`} />
        ))}
      </div>
    </div>
  );
});

// ─── 투표 카드 (PollCarousel 밖에 정의 — 복수선택 state 유지) ──

export const PollCard = memo(function PollCard({
  poll,
  pollIdx,
  profileUid,
  shouldAnimate,
  selected,
  onToggle,
  onSingleVote,
  onSubmitMulti,
  isProfessor,
}: {
  poll: Poll;
  pollIdx: number;
  profileUid?: string;
  shouldAnimate: boolean;
  selected: Set<number>;
  onToggle: (optIdx: number) => void;
  onSingleVote: (optIdx: number) => void;
  onSubmitMulti: () => void;
  isProfessor?: boolean;
}) {
  if (!poll || !poll.options) return null;
  const rawVotes = poll.votes || {};
  // votes 값이 배열이 아닌 경우 방어 (Firestore 데이터 변환 버그 대비)
  const votes: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rawVotes)) {
    votes[k] = Array.isArray(v) ? v : [];
  }
  const hasVoted = profileUid && Object.values(votes).some((arr) => arr.includes(profileUid));
  const maxSel = poll.allowMultiple ? (poll.maxSelections || poll.options.length) : 1;
  // 교수님은 투표 안 해도 결과 항상 표시
  const showResults = hasVoted || isProfessor;
  const total = new Set(Object.values(votes).flat()).size;

  return (
    <div className="p-2 border border-[#D4CFC4]">
      <p className="font-bold text-base mb-1.5 text-[#1A1A1A] break-words">{poll.question}</p>
      {/* 복수선택 안내 */}
      {poll.allowMultiple && !hasVoted && !isProfessor && (
        <p className="text-[10px] text-[#8C8478] mb-1.5">복수선택 (최대 {maxSel}개)</p>
      )}
      <div className="space-y-1">
        {poll.options.map((opt, oi) => {
          const v = votes[oi.toString()] || [];
          const pct = total > 0 ? Math.round((v.length / total) * 100) : 0;
          const isMyVote = profileUid && v.includes(profileUid);
          const isSelected = selected.has(oi);

          // 교수님: 결과 + 투표 가능 (클릭 시 투표)
          if (isProfessor) {
            return (
              <button key={`pollopt-${oi}`} onClick={(e) => { e.stopPropagation(); if (!hasVoted) { if (poll.allowMultiple) onToggle(oi); else onSingleVote(oi); } }}
                className="w-full text-left py-0.5"
              >
                <div className="flex items-start gap-1.5">
                  <span className={`w-3.5 h-3.5 border-[1.5px] border-[#1A1A1A] shrink-0 mt-px flex items-center justify-center ${isMyVote || isSelected ? 'bg-[#1A1A1A]' : ''}`}>
                    {(isMyVote || isSelected) && <span className="text-white text-[8px]">✓</span>}
                  </span>
                  <span className="flex-1 text-xs min-w-0 break-words">{opt}</span>
                  <span className="text-[11px] text-[#8C8478] shrink-0">{v.length}표 {pct}%</span>
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
              </button>
            );
          }

          // 학생: 투표 전
          if (!hasVoted) {
            if (poll.allowMultiple) {
              return (
                <button
                  key={`pollopt-${oi}`}
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
            return (
              <button key={`pollopt-${oi}`} onClick={(e) => { e.stopPropagation(); onSingleVote(oi); }} className="w-full text-left py-0.5">
                <div className="flex items-start gap-1.5">
                  <span className="w-3.5 h-3.5 border-[1.5px] border-[#1A1A1A] shrink-0 mt-px" />
                  <span className="flex-1 text-xs min-w-0 break-words">{opt}</span>
                </div>
              </button>
            );
          }

          // 학생: 투표 후 결과 표시
          return (
            <div key={`pollopt-${oi}`} className="py-0.5">
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
        {/* 복수선택 투표 버튼 (학생 + 교수님 미투표 시) */}
        {poll.allowMultiple && !hasVoted && (
          <button
            onClick={(e) => { e.stopPropagation(); onSubmitMulti(); }}
            disabled={selected.size === 0}
            className="w-full mt-0.5 py-1 text-xs font-bold border-[1.5px] border-[#1A1A1A] text-[#1A1A1A] disabled:opacity-30 transition-opacity"
          >
            투표하기 ({selected.size}/{maxSel})
          </button>
        )}
        <p className="text-xs text-[#8C8478] text-right">
          {total}명 참여
        </p>
      </div>
    </div>
  );
});

// ─── 투표 캐러셀 ─────────────────────────────────────────

export const PollCarousel = memo(function PollCarousel({
  polls,
  announcementId,
  profileUid,
  onVote,
  isProfessor,
}: {
  polls: Poll[];
  announcementId: string;
  profileUid?: string;
  onVote: (aid: string, pollIdx: number, optIndices: number[]) => void;
  isProfessor?: boolean;
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
      key={`pollcard-${pi}`}
      poll={poll}
      pollIdx={pi}
      profileUid={profileUid}
      shouldAnimate={justVoted.has(pi)}
      selected={selections.get(pi) || EMPTY_SET}
      onToggle={(oi) => toggleSelection(pi, oi, poll.maxSelections || poll.options.length)}
      onSingleVote={(oi) => handleSingleVote(pi, oi)}
      onSubmitMulti={() => handleMultiVote(pi)}
      isProfessor={isProfessor}
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
          onClick={() => { const el = containerRef.current; if (!el || idx <= 0) return; const target = el.children[idx - 1] as HTMLElement; target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }); }}
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
            if (!el || !el.children.length) return;
            const itemW = (el.children[0] as HTMLElement).offsetWidth;
            const newIdx = Math.round(el.scrollLeft / (itemW + 2));
            setIdx(newIdx);
          }}
        >
          {polls.map((poll, i) => (
            <div key={`poll-slide-${i}`} className="w-full shrink-0 snap-start flex items-center">
              <div className="w-full">{renderCard(poll, i)}</div>
            </div>
          ))}
        </div>
        {/* 우측 화살표 — 버블 패딩 영역 중앙 */}
        <button
          onClick={() => { const el = containerRef.current; if (!el || idx >= polls.length - 1) return; const target = el.children[idx + 1] as HTMLElement; target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }); }}
          className={`w-[30px] shrink-0 flex items-center justify-center text-[#5C5C5C] ${idx < polls.length - 1 ? '' : 'invisible'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      {/* 점 인디케이터 */}
      <div className="flex justify-center gap-1 mt-1">
        {polls.map((_, i) => (
          <div key={`poll-dot-${i}`} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === idx ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'}`} />
        ))}
      </div>
    </div>
  );
});

// ─── 펼치기/접기 메시지 본문 ────────────────────────────

/** 텍스트에서 URL을 <a> 태그로 변환 */
function linkify(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const url = match[0];
    parts.push(
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer"
        className="text-[#5C5C5C] underline break-all"
        onClick={(e) => e.stopPropagation()}
      >{url}</a>
    );
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export const MessageContent = memo(function MessageContent({ content }: { content: string }) {
  if (!content) return null;
  const linked = linkify(content);
  return (
    <p
      className="text-sm text-[#1A1A1A] whitespace-pre-wrap break-words leading-snug"
      style={{ overflowWrap: 'anywhere' }}
    >
      {linked}
    </p>
  );
});
