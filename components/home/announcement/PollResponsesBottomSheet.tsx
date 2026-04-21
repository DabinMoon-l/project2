'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { callFunction } from '@/lib/api';
import type { CloudFunctionMap } from '@/lib/api/types';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import type { Poll } from './types';
import {
  exportSurveyToExcel,
  exportSurveyToCSVZip,
  type SurveyExportData,
  type SurveyExportPoll,
} from './surveyExport';

type PollResponsesResult = CloudFunctionMap['getPollResponses']['output'];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 대상 공지 ID */
  announcementId: string | null;
  /** 해당 공지의 전체 투표 목록 (좌우 스와이프용) */
  polls: Poll[];
  /** 현재 보고 있는 투표 인덱스 */
  currentIdx: number;
  /** 인덱스 변경 (좌우 스와이프/버튼) */
  onIndexChange: (idx: number) => void;
  /** 내보내기 메타데이터 */
  announcementContent?: string;
  announcementCreatedAtMs?: number | null;
  courseName?: string;
}

/**
 * 교수 전용 — 투표 응답 확인 바텀시트
 *
 * - 공지 안의 여러 투표를 좌우 스와이프로 이동
 * - 각 투표의 응답 데이터는 pollIdx별로 캐싱 (스와이프 시 재요청 X)
 * - 가로모드: 부모 패널 내부 absolute
 * - 세로모드: document.body 포털
 */
export default function PollResponsesBottomSheet({
  isOpen,
  onClose,
  announcementId,
  polls,
  currentIdx,
  onIndexChange,
  announcementContent,
  announcementCreatedAtMs,
  courseName,
}: Props) {
  const [cache, setCache] = useState<Record<number, PollResponsesResult>>({});
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  const [errorByIdx, setErrorByIdx] = useState<Record<number, string>>({});
  const [exportingFormat, setExportingFormat] = useState<'excel' | 'csv' | null>(null);
  const isWide = useWideMode();

  const total = polls.length;
  const poll = polls[currentIdx];
  const data = cache[currentIdx];
  const loading = loadingIdx === currentIdx;
  const error = errorByIdx[currentIdx];

  // ─── 데이터 로드 (batch CF 1회로 전체 캐시) ──────
  const loadAll = useCallback(
    async (signalIdx: number) => {
      if (!announcementId) return;
      setLoadingIdx(signalIdx);
      setErrorByIdx({});
      try {
        const result = await callFunction('getPollResponsesBatch', { announcementId });
        const newCache: Record<number, PollResponsesResult> = {};
        for (const item of result.items) {
          const { pollIdx, ...rest } = item;
          newCache[pollIdx] = rest as PollResponsesResult;
        }
        setCache(newCache);
      } catch (err) {
        console.error('응답 조회 실패:', err);
        const msg = err instanceof Error ? err.message : '조회에 실패했습니다.';
        setErrorByIdx({ [signalIdx]: msg });
      } finally {
        setLoadingIdx((cur) => (cur === signalIdx ? null : cur));
      }
    },
    [announcementId]
  );

  // 바텀시트 열릴 때 한 번만 전체 로드
  useEffect(() => {
    if (!isOpen || !announcementId) return;
    if (Object.keys(cache).length > 0) return; // 이미 로드됨
    loadAll(currentIdx);
    // cache는 의도적으로 의존성 배열 밖 — 최초 1회만 로드
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, announcementId]);

  // 공지 자체가 바뀌면 캐시 초기화
  const lastAidRef = useRef<string | null>(null);
  useEffect(() => {
    if (announcementId !== lastAidRef.current) {
      lastAidRef.current = announcementId;
      setCache({});
      setErrorByIdx({});
    }
  }, [announcementId]);

  // 세로모드 스크롤 잠금
  useEffect(() => {
    if (isOpen && !isWide) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isOpen, isWide]);

  // ─── 전체 투표 일괄 fetch + 내보내기 ────────────────
  const handleExport = useCallback(
    async (format: 'excel' | 'csv') => {
      if (!announcementId || polls.length === 0 || exportingFormat) return;
      setExportingFormat(format);
      try {
        // 캐시 안 된 모든 pollIdx 병렬 fetch
        const missing = polls
          .map((_, i) => i)
          .filter((i) => !cache[i]);
        const fetched = await Promise.all(
          missing.map(async (i) => {
            const result = await callFunction('getPollResponses', {
              announcementId,
              pollIdx: i,
            });
            return [i, result] as const;
          })
        );
        const fullCache: Record<number, PollResponsesResult> = { ...cache };
        for (const [i, result] of fetched) fullCache[i] = result;
        // 캐시도 업데이트 해두면 재조회 생략됨
        if (fetched.length > 0) setCache(fullCache);

        // 내보내기 데이터 빌드
        const exportPolls: SurveyExportPoll[] = polls.map((p, i) => ({
          pollIdx: i,
          question: p.question,
          type: p.type === 'text' ? 'text' : 'choice',
          options: p.options || [],
          allowMultiple: !!p.allowMultiple,
          result: fullCache[i],
        }));
        const data: SurveyExportData = {
          announcementId,
          announcementContent: announcementContent || '',
          announcementCreatedAt: announcementCreatedAtMs
            ? new Date(announcementCreatedAtMs)
            : null,
          courseName,
          polls: exportPolls,
        };

        if (format === 'excel') {
          await exportSurveyToExcel(data);
        } else {
          await exportSurveyToCSVZip(data);
        }
      } catch (err) {
        console.error('내보내기 실패:', err);
        alert('내보내기에 실패했습니다. 잠시 후 다시 시도해주세요.');
      } finally {
        setExportingFormat(null);
      }
    },
    [announcementId, polls, cache, exportingFormat, announcementContent, announcementCreatedAtMs, courseName]
  );

  const goPrev = useCallback(() => {
    if (currentIdx > 0) onIndexChange(currentIdx - 1);
  }, [currentIdx, onIndexChange]);

  const goNext = useCallback(() => {
    if (currentIdx < total - 1) onIndexChange(currentIdx + 1);
  }, [currentIdx, total, onIndexChange]);

  // 드래그 종료: 수평 스와이프 감지
  const handleDragEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const { offset, velocity } = info;
      // 수평 스와이프가 수직보다 커야만 페이지 전환 (세로 스크롤 의도 방어)
      if (Math.abs(offset.x) < Math.abs(offset.y)) return;
      if (offset.x < -60 || velocity.x < -500) goNext();
      else if (offset.x > 60 || velocity.x > 500) goPrev();
    },
    [goPrev, goNext]
  );

  // 공통 콘텐츠
  const content = (
    <>
      {/* 핸들 */}
      <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
        <div className="w-10 h-1 rounded-full bg-[#C4C0B8]" />
      </div>

      {/* 내보내기 행 — 전체 투표 결과 한 번에 */}
      <div className="px-3 py-1.5 border-b border-[#D4CFC4] flex items-center justify-between gap-2 flex-shrink-0">
        <span className="text-[10px] text-[#8C8478]">전체 투표 결과 내보내기</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleExport('excel')}
            disabled={!!exportingFormat}
            className="px-2 py-1 text-[11px] font-bold border border-[#1A1A1A] hover:bg-[#EDEAE4] disabled:opacity-40 rounded transition-colors"
          >
            {exportingFormat === 'excel' ? '생성 중...' : 'XLSX'}
          </button>
          <button
            onClick={() => handleExport('csv')}
            disabled={!!exportingFormat}
            className="px-2 py-1 text-[11px] font-bold border border-[#1A1A1A] hover:bg-[#EDEAE4] disabled:opacity-40 rounded transition-colors"
          >
            {exportingFormat === 'csv' ? '생성 중...' : 'CSV'}
          </button>
        </div>
      </div>

      {/* 헤더 */}
      <div className="px-3 pb-2 pt-2 border-b border-[#1A1A1A] flex items-center gap-2 flex-shrink-0">
        {total > 1 && (
          <button
            onClick={goPrev}
            disabled={currentIdx === 0}
            className="shrink-0 w-7 h-7 flex items-center justify-center border border-[#1A1A1A] bg-[#FDFBF7] hover:bg-[#EDEAE4] rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="이전 투표"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-[#1A1A1A] truncate">
            {poll?.question || '투표 응답'}
          </h2>
          {total > 1 && (
            <p className="text-[10px] text-[#8C8478] mt-0.5">
              {currentIdx + 1} / {total}
            </p>
          )}
        </div>

        {total > 1 && (
          <button
            onClick={goNext}
            disabled={currentIdx >= total - 1}
            className="shrink-0 w-7 h-7 flex items-center justify-center border border-[#1A1A1A] bg-[#FDFBF7] hover:bg-[#EDEAE4] rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="다음 투표"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        <button
          onClick={onClose}
          className="shrink-0 w-7 h-7 flex items-center justify-center border border-[#1A1A1A] bg-[#FDFBF7] hover:bg-[#EDEAE4] rounded-lg"
          aria-label="닫기"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 본문 — 드래그 가능 (수평 스와이프로 페이지 이동) */}
      <motion.div
        key={`page-${currentIdx}`}
        drag={total > 1 ? 'x' : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
        className="flex-1 overflow-y-auto p-3 touch-pan-y"
      >
        {loading && (
          <div className="py-10 text-center text-sm text-[#8C8478]">불러오는 중...</div>
        )}

        {!loading && error && (
          <div className="py-6 text-center text-sm text-red-600">{error}</div>
        )}

        {!loading && !error && data && data.type === 'choice' && (
          <ChoiceResponsesView data={data} />
        )}

        {!loading && !error && data && data.type === 'text' && (
          <TextResponsesView data={data} />
        )}

        {!loading && !error && !data && (
          <div className="py-10 text-center text-sm text-[#8C8478]">응답이 없습니다.</div>
        )}
      </motion.div>

      {/* 페이지 인디케이터 (점) */}
      {total > 1 && (
        <div className="flex justify-center gap-1 py-2 flex-shrink-0 border-t border-[#D4CFC4]">
          {polls.map((_, i) => (
            <button
              key={`dot-${i}`}
              onClick={() => onIndexChange(i)}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${i === currentIdx ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'}`}
              aria-label={`투표 ${i + 1}`}
            />
          ))}
        </div>
      )}
    </>
  );

  // ─── 가로모드: 부모 패널 내부 absolute 바텀시트 ─────────
  if (isWide) {
    return (
      <AnimatePresence>
        {isOpen && (
          <>
            {/* 투명 오버레이 (클릭 시 닫기 — 배경 어두워지지 않음) */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[105]"
              onClick={onClose}
            />
            {/* 바텀시트 */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              className="absolute bottom-0 left-0 right-0 z-[105] bg-[#F5F0E8] border-t-2 border-[#1A1A1A] rounded-t-2xl overflow-hidden flex flex-col max-h-[75%]"
            >
              {content}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  }

  // ─── 세로모드: document.body 포털 바텀시트 ──────────────
  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[105]"
          style={{ left: 'var(--modal-left, 0px)', right: 'var(--modal-right, 0px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="absolute bottom-0 left-0 right-0 bg-[#F5F0E8] border-t-2 border-[#1A1A1A] rounded-t-2xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            {content}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ─── 객관식 응답 뷰 ───────────────────────────────────────

function ChoiceResponsesView({
  data,
}: {
  data: Extract<PollResponsesResult, { type: 'choice' }>;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[#8C8478]">
        총 <span className="font-bold text-[#1A1A1A]">{data.totalVoters}</span>명 참여
      </p>
      {data.options.map((opt) => (
        <div key={`opt-${opt.optIdx}`} className="border border-[#D4CFC4] bg-[#FDFBF7]">
          <div className="px-3 py-2 bg-[#F5F0E8] border-b border-[#D4CFC4] flex items-center justify-between">
            <span className="font-bold text-sm text-[#1A1A1A] break-words flex-1 min-w-0">{opt.option}</span>
            <span className="text-xs text-[#8C8478] shrink-0 ml-2">{opt.voters.length}명</span>
          </div>
          {opt.voters.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-[#B8B0A0]">투표자 없음</div>
          ) : (
            <ul className="divide-y divide-[#E8E3D8]">
              {opt.voters.map((v) => (
                <li key={`${opt.optIdx}-${v.uid}`} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                  <span className="font-bold text-[#1A1A1A]">{v.name || '(이름 없음)'}</span>
                  {v.studentNumber && <span className="text-[#8C8478]">{v.studentNumber}</span>}
                  {v.nickname && <span className="text-[#B8B0A0] text-[10px]">@{v.nickname}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── 주관식 응답 뷰 ───────────────────────────────────────

function TextResponsesView({
  data,
}: {
  data: Extract<PollResponsesResult, { type: 'text' }>;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-[#8C8478]">
        총 <span className="font-bold text-[#1A1A1A]">{data.responseCount}</span>명 응답
      </p>
      {data.responses.length === 0 ? (
        <div className="py-10 text-center text-sm text-[#8C8478]">응답이 없습니다.</div>
      ) : (
        data.responses.map((r) => (
          <div key={r.uid} className="p-3 border border-[#D4CFC4] bg-[#FDFBF7]">
            <div className="flex items-center gap-2 mb-1 text-xs">
              <span className="font-bold text-[#1A1A1A]">{r.name || '(이름 없음)'}</span>
              {r.studentNumber && <span className="text-[#8C8478]">{r.studentNumber}</span>}
              {r.nickname && <span className="text-[#B8B0A0] text-[10px]">@{r.nickname}</span>}
              {r.createdAt !== r.updatedAt && (
                <span className="text-[10px] text-[#B8B0A0] ml-auto">수정됨</span>
              )}
            </div>
            <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap break-words">{r.text}</p>
          </div>
        ))
      )}
    </div>
  );
}
