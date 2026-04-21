'use client';

import React, { useState, useRef, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import type { FileAttachment, Poll } from './types';
import { BUBBLE_STYLES, BUBBLE_SIDE_MULTI, fmtSize, URL_RE, getVoteCount, getTotalVoters } from './types';

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
  onOptionClick,
  onSubmitText,
  myTextResponse,
  myVotes,
  onViewResponses,
  isLastPoll,
  isSubmitted,
  isSubmitting,
  onSubmitSurvey,
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
  /** draft 모드에서 옵션 클릭 — 단일/복수 모두 이 콜백 사용 */
  onOptionClick?: (optIdx: number) => void;
  onSubmitText?: (text: string) => Promise<void> | void;
  myTextResponse?: string;
  /** 본인 투표 선지 (undefined=미투표, [0]=객관식 단일, [1,2]=복수) */
  myVotes?: number[];
  onViewResponses?: (pollIdx: number) => void;
  /** 이 카드가 마지막 설문인지 — 제출 버튼 표시 위치 */
  isLastPoll?: boolean;
  /** 제출 완료 */
  isSubmitted?: boolean;
  /** 제출 진행 중 */
  isSubmitting?: boolean;
  /** 설문 일괄 제출 */
  onSubmitSurvey?: () => void;
  isProfessor?: boolean;
}) {
  const isText = poll?.type === 'text';

  // ─── 주관식 투표 카드 ─────────────────────────
  if (isText) {
    return (
      <TextPollCard
        poll={poll}
        pollIdx={pollIdx}
        myTextResponse={myTextResponse}
        onSubmitText={onSubmitText}
        onViewResponses={onViewResponses}
        isLastPoll={isLastPoll}
        isSubmitted={isSubmitted}
        isSubmitting={isSubmitting}
        onSubmitSurvey={onSubmitSurvey}
        isProfessor={isProfessor}
      />
    );
  }

  // ─── 객관식 투표 카드 ─────────────────────────
  if (!poll || !poll.options) return null;
  const rawVotes = poll.votes || {};
  // 레거시 votes 값이 배열이 아닌 경우 방어
  const votes: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rawVotes)) {
    votes[k] = Array.isArray(v) ? v : [];
  }
  // hasVoted: myVotes(신규) 우선, 없으면 레거시 votes 배열 확인
  const myVoteSet = myVotes && myVotes.length > 0 ? new Set(myVotes) : null;
  const legacyVoted = profileUid && Object.values(votes).some((arr) => arr.includes(profileUid));
  const hasVoted = !!myVoteSet || !!legacyVoted;
  const maxSel = poll.allowMultiple ? (poll.maxSelections || poll.options.length) : 1;

  // 카운트는 서버 구독(~수백ms)이 즉시 반영. hasVoted/isMyVote만 낙관적 처리해서
  // 내가 투표했다는 시각적 피드백은 즉시, 숫자는 약간의 딜레이 후 부드럽게 업데이트.
  const total = getTotalVoters(poll);

  // 학생의 "편집 모드" — 교수X, 아직 제출 안 함
  const isDraftMode = !isProfessor && !isSubmitted;
  // 결과 바 표시 — 교수이거나 학생이 제출 완료
  const showResults = isProfessor || isSubmitted;
  // selected prop은 레거시 복수선택 임시 state — draft 모드에선 myVoteSet을 사용
  void selected; void onToggle; void onSubmitMulti;

  return (
    <div className="p-2 border border-[#D4CFC4]">
      <p className="font-bold text-base mb-1.5 text-[#1A1A1A] break-words">{poll.question}</p>
      {/* 복수선택 안내 */}
      {poll.allowMultiple && isDraftMode && (
        <p className="text-[10px] text-[#8C8478] mb-1.5">복수선택 (최대 {maxSel}개)</p>
      )}
      <div className="space-y-1">
        {poll.options.map((opt, oi) => {
          const count = getVoteCount(poll, oi);
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const v = votes[oi.toString()] || [];
          const legacyMyVote = !!(profileUid && v.includes(profileUid));
          const isMyVote = myVoteSet ? myVoteSet.has(oi) : legacyMyVote;

          // ─── 결과 뷰 (교수 or 학생 제출 후)
          if (showResults) {
            return (
              <div key={`pollopt-${oi}`} className="py-0.5">
                <div className="flex items-start gap-1.5">
                  {isMyVote && (
                    <span className="w-3.5 h-3.5 border-[1.5px] border-[#1A1A1A] shrink-0 mt-px flex items-center justify-center bg-[#1A1A1A]">
                      <span className="text-white text-[8px]">✓</span>
                    </span>
                  )}
                  <span className="flex-1 text-xs min-w-0 break-words">{opt}</span>
                  <span className="text-[11px] text-[#8C8478] shrink-0">
                    {isProfessor ? `${count}표 ` : ''}{pct}%
                  </span>
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
          }

          // ─── 학생 draft 모드: 선택 가능 (myVoteSet 기반)
          return (
            <button
              key={`pollopt-${oi}`}
              onClick={(e) => { e.stopPropagation(); onOptionClick?.(oi); }}
              className="w-full text-left py-1"
            >
              <div className="flex items-start gap-1.5">
                <span className={`w-3.5 h-3.5 border-[1.5px] border-[#1A1A1A] shrink-0 mt-px flex items-center justify-center transition-colors ${isMyVote ? 'bg-[#1A1A1A]' : ''}`}>
                  {isMyVote && <span className="text-white text-[8px]">✓</span>}
                </span>
                <span className="flex-1 text-sm min-w-0 break-words">{opt}</span>
              </div>
            </button>
          );
        })}
        {/* 하단 영역 — 참여자 수 + 교수 버튼 + 학생 제출 버튼 */}
        <div className="flex items-center justify-between mt-1 pt-1 border-t border-[#D4CFC4]/60">
          <p className="text-xs text-[#8C8478]">{total}명 참여</p>
          <div className="flex items-center gap-2">
            {isProfessor && onViewResponses && (
              <button
                onClick={(e) => { e.stopPropagation(); onViewResponses(pollIdx); }}
                className="text-[11px] font-bold text-[#1A1A1A] underline underline-offset-2 hover:opacity-70"
              >
                투표자 보기
              </button>
            )}
            {/* 학생: 마지막 설문의 제출 버튼 */}
            {isDraftMode && isLastPoll && onSubmitSurvey && (
              <button
                onClick={(e) => { e.stopPropagation(); onSubmitSurvey(); }}
                disabled={!!isSubmitting}
                className="px-3 py-1 text-xs font-bold bg-[#1A1A1A] text-white disabled:opacity-40 hover:opacity-80 transition-opacity"
              >
                {isSubmitting ? '제출 중...' : '제출'}
              </button>
            )}
            {/* 학생: 제출 완료 안내 (마지막 설문 하단) */}
            {!isProfessor && isSubmitted && isLastPoll && (
              <span className="text-[11px] font-bold text-[#1A7A1A]">✓ 제출 완료</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

// ─── 주관식 투표 카드 ─────────────────────────────────────

const TextPollCard = memo(function TextPollCard({
  poll,
  pollIdx,
  myTextResponse,
  onSubmitText,
  onViewResponses,
  isLastPoll,
  isSubmitted,
  isSubmitting,
  onSubmitSurvey,
  isProfessor,
}: {
  poll: Poll;
  pollIdx: number;
  myTextResponse?: string;
  onSubmitText?: (text: string) => Promise<void> | void;
  onViewResponses?: (pollIdx: number) => void;
  isLastPoll?: boolean;
  isSubmitted?: boolean;
  isSubmitting?: boolean;
  onSubmitSurvey?: () => void;
  isProfessor?: boolean;
}) {
  const count = poll.responseCount || 0;
  const isDraftMode = !isProfessor && !isSubmitted;
  // 타이핑 즉시성 확보: 로컬 state에 쓰고, 짧은 debounce로 부모 sync
  const [localDraft, setLocalDraft] = useState(myTextResponse || '');
  const syncedRef = useRef(myTextResponse || '');
  // 부모에서 새 응답 내려오면 로컬에도 반영 (예: 초기 로드, 제출 완료)
  if (syncedRef.current !== (myTextResponse || '')) {
    syncedRef.current = myTextResponse || '';
    setLocalDraft(myTextResponse || '');
  }
  // debounce로 부모 sync (200ms) — 제출 시 최신값 반영 보장
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeDraft = (next: string) => {
    setLocalDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSubmitText?.(next);
    }, 200);
  };
  // 제출 직전 debounce 즉시 flush
  const handleSubmitClick = () => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    onSubmitText?.(localDraft);
    // 마이크로태스크로 미뤄 부모 state 반영 후 제출
    Promise.resolve().then(() => onSubmitSurvey?.());
  };

  return (
    <div className="p-2 border border-[#D4CFC4]">
      <p className="font-bold text-base text-[#1A1A1A] break-words mb-1">{poll.question}</p>

      {/* 교수: 응답 수 + 확인 버튼 */}
      {isProfessor && (
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-[#8C8478]">{count}명 응답</p>
          {onViewResponses && (
            <button
              onClick={(e) => { e.stopPropagation(); onViewResponses(pollIdx); }}
              className="px-2 py-1 text-[11px] font-bold bg-[#1A1A1A] text-white hover:opacity-80 transition-opacity"
            >
              답변 확인
            </button>
          )}
        </div>
      )}

      {/* 학생 — draft 모드 (제출 전): 항상 편집 가능 */}
      {isDraftMode && (
        <div className="mt-1 space-y-1">
          <textarea
            value={localDraft}
            onChange={(e) => onChangeDraft(e.target.value)}
            onBlur={() => { onSubmitText?.(localDraft); }}
            onClick={(e) => e.stopPropagation()}
            placeholder="답변을 입력하세요..."
            maxLength={2000}
            rows={3}
            className="w-full p-2 border border-[#D4CFC4] bg-white text-xs text-[#1A1A1A] placeholder:text-[#B8B0A0] focus:outline-none focus:border-[#1A1A1A] resize-none"
          />
          <div className="flex items-center justify-between mt-1 pt-1 border-t border-[#D4CFC4]/60">
            <p className="text-[10px] text-[#8C8478]">{localDraft.length}/2000</p>
            {/* 마지막 설문일 때만 제출 버튼 */}
            {isLastPoll && onSubmitSurvey && (
              <button
                onClick={(e) => { e.stopPropagation(); handleSubmitClick(); }}
                disabled={!!isSubmitting}
                className="px-3 py-1 text-xs font-bold bg-[#1A1A1A] text-white disabled:opacity-40 hover:opacity-80 transition-opacity"
              >
                {isSubmitting ? '제출 중...' : '제출'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 학생 — 제출 완료: 본인 답변 read-only */}
      {!isProfessor && isSubmitted && (
        <div className="mt-1 space-y-1">
          <div className="p-2 bg-[#F5F0E8] border border-[#D4CFC4] text-xs text-[#1A1A1A] break-words whitespace-pre-wrap">
            {myTextResponse || <span className="text-[#B8B0A0] italic">답변 없음</span>}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-[#8C8478]">제출됨 (교수님만 열람)</p>
            {isLastPoll && <span className="text-[11px] font-bold text-[#1A7A1A]">✓ 제출 완료</span>}
          </div>
        </div>
      )}
    </div>
  );
});

// ─── 투표 캐러셀 ─────────────────────────────────────────

export const PollCarousel = memo(function PollCarousel({
  polls,
  announcementId,
  profileUid,
  onVote,
  onSubmitText,
  onViewResponses,
  myTextResponses,
  myChoiceVotes,
  isSubmitted,
  isSubmitting,
  onSubmitSurvey,
  isProfessor,
}: {
  polls: Poll[];
  announcementId: string;
  profileUid?: string;
  onVote: (aid: string, pollIdx: number, optIndices: number[]) => void;
  /** 주관식 응답 제출 */
  onSubmitText?: (aid: string, pollIdx: number, text: string) => Promise<void> | void;
  /** 교수 전용 응답 확인 바텀시트 오픈 */
  onViewResponses?: (aid: string, pollIdx: number) => void;
  /** 본인이 제출한 주관식 응답 — pollIdx → text */
  myTextResponses?: Record<number, string>;
  /** 본인 객관식 투표 — pollIdx → number[] (복수선택 지원) */
  myChoiceVotes?: Record<number, number[]>;
  /** 제출 완료 여부 */
  isSubmitted?: boolean;
  /** 제출 진행 중 */
  isSubmitting?: boolean;
  /** 설문 일괄 제출 */
  onSubmitSurvey?: () => void;
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

  // ─── 객관식 옵션 클릭 (draft 모드) — 단일/복수 통합
  const handleOptionClick = useCallback((pollIdx: number, optIdx: number) => {
    const poll = polls[pollIdx];
    if (!poll) return;
    const current = myChoiceVotes?.[pollIdx] || [];
    if (poll.allowMultiple) {
      const set = new Set(current);
      const maxSel = poll.maxSelections || poll.options.length;
      if (set.has(optIdx)) {
        set.delete(optIdx);
      } else if (set.size < maxSel) {
        set.add(optIdx);
      } else {
        return; // 최대치 초과 — 무시
      }
      onVote(announcementId, pollIdx, Array.from(set));
    } else {
      // 단일: 같은 옵션 클릭하면 선택 해제, 다른 옵션이면 교체
      if (current.length === 1 && current[0] === optIdx) {
        onVote(announcementId, pollIdx, []);
      } else {
        onVote(announcementId, pollIdx, [optIdx]);
      }
    }
  }, [polls, myChoiceVotes, onVote, announcementId]);

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
      onOptionClick={(oi) => handleOptionClick(pi, oi)}
      onSubmitText={onSubmitText ? (text) => onSubmitText(announcementId, pi, text) : undefined}
      myTextResponse={myTextResponses?.[pi]}
      myVotes={myChoiceVotes?.[pi]}
      onViewResponses={onViewResponses ? (idx) => onViewResponses(announcementId, idx) : undefined}
      isLastPoll={pi === polls.length - 1}
      isSubmitted={isSubmitted}
      isSubmitting={isSubmitting}
      onSubmitSurvey={onSubmitSurvey}
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
