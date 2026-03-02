'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useRabbitHoldings, useRabbitsForCourse, getRabbitStats, type RabbitDoc, type RabbitHolding } from '@/lib/hooks/useRabbit';
import RabbitImage from '@/components/common/RabbitImage';
import VirtualRabbitGrid from '@/components/common/VirtualRabbitGrid';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import { useHideNav } from '@/lib/hooks/useHideNav';

const OPEN_MS = 380;
const CLOSE_MS = 320;
const EASE_OPEN = 'cubic-bezier(0.4, 0, 0.2, 1)';

interface Rect { x: number; y: number; width: number; height: number }
type Phase = 'hidden' | 'entering' | 'open' | 'exiting';

interface RabbitDogamProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  userId: string;
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>;
  buttonRect?: Rect | null;
}

/**
 * 토끼 도감 — 요술지니 애니메이션
 * 도감 버튼 → 도감 모달 (요술지니)
 * 토끼 셀 → 상세 모달 (별도 레이어, 셀 위치에서 요술지니)
 */
export default function RabbitDogam({
  isOpen,
  onClose,
  courseId,
  userId,
  equippedRabbits,
  buttonRect,
}: RabbitDogamProps) {
  // 도감 열림 시 네비게이션 숨김
  useHideNav(isOpen);

  // 도감 열림 시 body 스크롤 방지
  useEffect(() => {
    if (!isOpen) return;
    lockScroll();
    return () => { unlockScroll(); };
  }, [isOpen]);

  const { rabbits: allRabbits, loading: rabbitsLoading } = useRabbitsForCourse(courseId);
  const { holdings, loading: holdingsLoading } = useRabbitHoldings(userId);

  // === 도감 모달 요술지니 ===
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<Phase>('hidden');
  const phaseRef = useRef<Phase>('hidden');

  // === 상세 모달 요술지니 ===
  const [selectedRabbitId, setSelectedRabbitId] = useState<number | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailPhase, setDetailPhase] = useState<Phase>('hidden');
  const detailPhaseRef = useRef<Phase>('hidden');
  const [cellOrigin, setCellOrigin] = useState('center center');

  // 도감 열기
  useEffect(() => {
    if (isOpen && phaseRef.current === 'hidden') {
      setVisible(true);
      setPhase('entering');
      phaseRef.current = 'entering';
      const raf1 = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (phaseRef.current === 'entering') {
            setPhase('open');
            phaseRef.current = 'open';
          }
        });
      });
      return () => cancelAnimationFrame(raf1);
    }
  }, [isOpen]);

  // 외부 즉시 닫기
  useEffect(() => {
    if (!isOpen && phaseRef.current !== 'hidden' && phaseRef.current !== 'exiting') {
      setVisible(false);
      setPhase('hidden');
      phaseRef.current = 'hidden';
      setSelectedRabbitId(null);
      setDetailVisible(false);
      setDetailPhase('hidden');
      detailPhaseRef.current = 'hidden';
    }
  }, [isOpen]);

  // 도감 닫기 (요술지니 축소)
  const runCloseAnimation = useCallback(() => {
    if (phaseRef.current === 'exiting') return;
    // 상세가 열려있으면 먼저 닫기
    if (detailPhaseRef.current === 'open') {
      setDetailPhase('exiting');
      detailPhaseRef.current = 'exiting';
    }
    setPhase('exiting');
    phaseRef.current = 'exiting';
    setTimeout(() => {
      onClose();
      setVisible(false);
      setPhase('hidden');
      phaseRef.current = 'hidden';
      setSelectedRabbitId(null);
      setDetailVisible(false);
      setDetailPhase('hidden');
      detailPhaseRef.current = 'hidden';
    }, CLOSE_MS);
  }, [onClose]);

  // 상세 열기 (셀에서 요술지니 확장)
  const openDetail = useCallback((id: number, cellRect?: DOMRect) => {
    if (cellRect) {
      const cx = cellRect.x + cellRect.width / 2;
      const cy = cellRect.y + cellRect.height / 2;
      setCellOrigin(`${cx}px ${cy}px`);
    } else {
      setCellOrigin('center center');
    }
    setSelectedRabbitId(id);
    setDetailVisible(true);
    setDetailPhase('entering');
    detailPhaseRef.current = 'entering';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (detailPhaseRef.current === 'entering') {
          setDetailPhase('open');
          detailPhaseRef.current = 'open';
        }
      });
    });
  }, []);

  // 상세 닫기 (셀로 요술지니 축소)
  const closeDetail = useCallback(() => {
    if (detailPhaseRef.current === 'exiting') return;
    setDetailPhase('exiting');
    detailPhaseRef.current = 'exiting';
    setTimeout(() => {
      setSelectedRabbitId(null);
      setDetailVisible(false);
      setDetailPhase('hidden');
      detailPhaseRef.current = 'hidden';
    }, CLOSE_MS);
  }, []);

  // 데이터
  const myHoldingMap = new Map<number, RabbitHolding>();
  holdings
    .filter((h) => h.courseId === courseId)
    .forEach((h) => myHoldingMap.set(h.rabbitId, h));

  const rabbitDocMap = new Map<number, RabbitDoc>();
  allRabbits.forEach((r) => rabbitDocMap.set(r.rabbitId, r));

  const discoveredCount = myHoldingMap.size;
  const loading = rabbitsLoading || holdingsLoading;
  const selectedRabbit = selectedRabbitId !== null ? rabbitDocMap.get(selectedRabbitId) : undefined;
  const selectedHolding = selectedRabbitId !== null ? myHoldingMap.get(selectedRabbitId) : undefined;

  // 도감 모달 origin
  const modalOrigin = buttonRect
    ? `${buttonRect.x + buttonRect.width / 2}px ${buttonRect.y + buttonRect.height / 2}px`
    : 'center center';

  const makeStyle = (p: Phase, origin: string) => ({
    left: 'var(--modal-left, 0px)',
    transform: p === 'entering' || p === 'exiting' ? 'scale(0)' : 'scale(1)',
    opacity: p === 'entering' || p === 'exiting' ? 0 : 1,
    transformOrigin: origin,
    transition: `transform ${p === 'exiting' ? CLOSE_MS : OPEN_MS}ms ${EASE_OPEN}, opacity ${p === 'exiting' ? CLOSE_MS : OPEN_MS}ms ${EASE_OPEN}`,
    willChange: p !== 'open' ? 'transform, opacity' as const : undefined,
  });

  const backdropStyle = (p: Phase) => ({
    left: 'var(--modal-left, 0px)',
    opacity: p === 'entering' || p === 'exiting' ? 0 : 1,
    transition: `opacity ${p === 'exiting' ? CLOSE_MS : OPEN_MS}ms ease`,
  });

  if (!visible) return null;

  return createPortal(
    <>
      {/* ====== 도감 모달 ====== */}
      {/* 백드롭 */}
      <div
        className="fixed inset-0 z-[110] bg-black/60"
        style={backdropStyle(phase)}
        onClick={runCloseAnimation}
      />
      {/* 도감 — 요술지니 */}
      <div
        className="fixed inset-0 z-[111] flex items-center justify-center p-4 pointer-events-none"
        style={makeStyle(phase, modalOrigin)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto relative w-full max-w-[320px] max-h-[70vh] flex flex-col overflow-hidden rounded-2xl"
        >
          {/* 배경 */}
          <div className="absolute inset-0 rounded-2xl overflow-hidden">
            <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
          </div>
          <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />

          {/* 헤더 */}
          <div className="relative z-10 flex items-center justify-between px-3 py-2.5 border-b border-white/15">
            <span className="font-bold text-base text-white">토끼 도감</span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-white/80">{discoveredCount}/80</span>
              <button onClick={runCloseAnimation} className="w-8 h-8 flex items-center justify-center">
                <svg className="w-6 h-6 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* 그리드 */}
          <div className="relative z-10 flex-1 overflow-y-auto overscroll-contain p-3">
            {loading ? (
              <div className="text-center py-8 text-white/50">로딩 중...</div>
            ) : (
              <StudentRabbitGrid
                onSelect={openDetail}
                myHoldingMap={myHoldingMap}
                equippedRabbits={equippedRabbits}
              />
            )}
          </div>
        </div>
      </div>

      {/* ====== 상세 모달 (별도 레이어, 셀에서 요술지니) ====== */}
      {detailVisible && (
        <>
          {/* 상세 백드롭 */}
          <div
            className="fixed inset-0 z-[112] bg-black/40"
            style={backdropStyle(detailPhase)}
            onClick={closeDetail}
          />
          {/* 상세 모달 — 셀 위치에서 요술지니 */}
          <div
            className="fixed inset-0 z-[113] flex items-center justify-center p-4 pointer-events-none"
            style={makeStyle(detailPhase, cellOrigin)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto relative w-full max-w-[320px] max-h-[70vh] flex flex-col overflow-hidden rounded-2xl"
            >
              {/* 배경 */}
              <div className="absolute inset-0 rounded-2xl overflow-hidden">
                <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
              </div>
              <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />

              {/* 헤더 */}
              <div className="relative z-10 flex items-center justify-between px-3 py-2.5 border-b border-white/15">
                <span className="font-bold text-base text-white">토끼 상세</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base text-white/80">
                    {selectedRabbitId !== null ? `#${selectedRabbitId + 1}` : ''}
                  </span>
                  <button onClick={closeDetail} className="w-8 h-8 flex items-center justify-center">
                    <svg className="w-6 h-6 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* 상세 본문 */}
              <div className="relative z-10 flex-1 overflow-y-auto overscroll-contain p-3">
                {selectedRabbit && selectedHolding ? (
                  <RabbitDetail rabbit={selectedRabbit} holding={selectedHolding} />
                ) : (
                  <div className="text-center py-8 text-white/50">로딩 중...</div>
                )}
              </div>

              {/* 푸터 */}
              {selectedRabbit && selectedHolding && (
                <div className="relative z-10 px-3 py-2 border-t border-white/10">
                  <FooterWithEquip
                    rabbit={selectedRabbit}
                    equippedRabbits={equippedRabbits}
                    courseId={courseId}
                    onBack={closeDetail}
                    rabbitNames={equippedRabbits.map((e) => {
                      const doc = rabbitDocMap.get(e.rabbitId);
                      return doc?.name || (e.rabbitId === 0 ? '기본 토끼' : `토끼 #${e.rabbitId + 1}`);
                    })}
                  />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>,
    document.body
  );
}

/**
 * 80칸 가상 그리드
 */
function StudentRabbitGrid({
  onSelect,
  myHoldingMap,
  equippedRabbits,
}: {
  onSelect: (id: number, cellRect?: DOMRect) => void;
  myHoldingMap: Map<number, RabbitHolding>;
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>;
}) {
  const renderCell = useCallback((index: number) => {
    const isDiscovered = myHoldingMap.has(index);
    const isEquippedInGrid = equippedRabbits.some(e => e.rabbitId === index);
    return (
      <button
        onClick={(e) => {
          if (isDiscovered) {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onSelect(index, rect);
          }
        }}
        className={`w-full aspect-square flex items-center justify-center p-1 rounded-lg overflow-hidden ${
          isEquippedInGrid
            ? 'border-[3px] border-black bg-black/25 cursor-pointer hover:bg-black/30'
            : isDiscovered
              ? 'border-2 border-white/30 bg-white/15 cursor-pointer hover:bg-white/25'
              : 'border border-white/10 bg-white/5 cursor-default'
        }`}
      >
        {isDiscovered ? (
          <RabbitImage rabbitId={index} size={64} className="w-full h-full object-contain" thumbnail />
        ) : (
          <span className="text-2xl text-white/20">?</span>
        )}
      </button>
    );
  }, [myHoldingMap, equippedRabbits, onSelect]);

  return <VirtualRabbitGrid renderCell={renderCell} />;
}

/**
 * 토끼 상세 보기
 */
function RabbitDetail({
  rabbit,
  holding,
}: {
  rabbit: RabbitDoc;
  holding: RabbitHolding;
}) {
  const isDefaultRabbit = rabbit.rabbitId === 0 && !rabbit.name;
  const baseName = rabbit.name || '토끼';
  const discoverers = rabbit.discoverers || [];

  const myDisplayName = isDefaultRabbit
    ? '토끼'
    : holding.discoveryOrder === 1
      ? baseName
      : `${baseName} ${holding.discoveryOrder}세`;

  const { level, stats } = getRabbitStats(holding);

  return (
    <div>
      <div className="flex items-center justify-center gap-3.5 mb-3">
        <div className="flex-shrink-0">
          <RabbitImage rabbitId={rabbit.rabbitId} size={72} className="drop-shadow-md" />
        </div>
        <div className="flex flex-col items-center">
          <p className="text-sm font-bold text-white truncate">{myDisplayName}</p>
          <p className="text-[10px] text-white/50 mb-1.5">
            {rabbit.discovererCount}명 발견 · Lv.{level}
          </p>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 px-2 py-0.5 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="#f87171">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
              <span className="text-white font-bold text-xs">{stats.hp}</span>
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="#fb923c">
                <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
              </svg>
              <span className="text-white font-bold text-xs">{stats.atk}</span>
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="#60a5fa">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
              </svg>
              <span className="text-white font-bold text-xs">{stats.def}</span>
            </div>
          </div>
        </div>
      </div>

      {!isDefaultRabbit && discoverers.length > 0 && (
        <ParentLabel discoverers={discoverers} />
      )}
    </div>
  );
}

/**
 * 부모(최초 발견자)만 표시 — 박스 없이 흰색 글씨
 */
function ParentLabel({
  discoverers,
}: {
  discoverers: Array<{ userId: string; nickname: string; discoveryOrder: number }>;
}) {
  const parent = discoverers.find(d => d.discoveryOrder === 1);
  if (!parent) return null;

  return (
    <p className="mb-3 text-center text-sm text-white">
      부모 <span className="font-bold">{parent.nickname}</span>
    </p>
  );
}

/**
 * 상세 보기 푸터
 */
function FooterWithEquip({
  rabbit,
  equippedRabbits,
  courseId,
  onBack,
  rabbitNames,
}: {
  rabbit: RabbitDoc;
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>;
  courseId: string;
  onBack: () => void;
  rabbitNames?: string[];
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);

  const isEquipped = equippedRabbits.some(
    (e) => e.rabbitId === rabbit.rabbitId && e.courseId === courseId
  );
  const slotsAreFull = equippedRabbits.length >= 2;

  const handleEquip = async () => {
    setIsProcessing(true);
    try {
      const equipRabbit = httpsCallable(functions, 'equipRabbit');
      let slotIndex: number;
      if (slotsAreFull) {
        if (selectedSlot === null) return;
        slotIndex = selectedSlot;
      } else {
        slotIndex = equippedRabbits.length;
      }
      await equipRabbit({ courseId, rabbitId: rabbit.rabbitId, slotIndex });
    } catch (error) {
      console.error('장착 실패:', error);
    } finally {
      setIsProcessing(false);
      setSelectedSlot(null);
    }
  };

  return (
    <div className="space-y-3">
      {!isEquipped && slotsAreFull && (
        <div className="p-2.5 bg-white/10 border border-white/15 rounded-xl">
          <p className="text-xs text-white/60 mb-1.5">교체할 토끼를 선택하세요:</p>
          <div className="flex gap-2">
            {equippedRabbits.map((slot, idx) => {
              const slotName = slot.rabbitId === 0 ? '기본 토끼' : (rabbitNames?.[idx] || `토끼 #${slot.rabbitId + 1}`);
              return (
                <button
                  key={idx}
                  onClick={() => setSelectedSlot(idx)}
                  className={`flex-1 py-2 px-2 text-sm font-bold text-white flex items-center justify-center gap-2 rounded-lg ${
                    selectedSlot === idx
                      ? 'border-[3px] border-black bg-black/25'
                      : 'border-2 border-white/20'
                  }`}
                >
                  <RabbitImage rabbitId={slot.rabbitId} size={28} thumbnail />
                  <span className="truncate">{slotName}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="flex-1 py-1.5 text-xs border-2 border-white/30 text-white font-bold rounded-lg hover:bg-white/10 transition-colors"
        >
          도감으로
        </button>
        {isEquipped ? (
          <div className="flex-1 py-1.5 text-center text-xs text-white/50 bg-white/10 border border-white/15 font-bold rounded-lg">
            데려옴
          </div>
        ) : (
          <button
            onClick={handleEquip}
            disabled={isProcessing || (slotsAreFull && selectedSlot === null)}
            className="flex-1 py-1.5 text-xs bg-white/20 backdrop-blur-sm text-white font-bold rounded-lg disabled:opacity-50 hover:bg-white/30 transition-colors"
          >
            {isProcessing ? '처리 중...' : '데려오기'}
          </button>
        )}
      </div>
    </div>
  );
}
