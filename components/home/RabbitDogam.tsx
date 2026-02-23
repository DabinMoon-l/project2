'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useUser } from '@/lib/contexts';
import { useRabbitHoldings, useRabbitsForCourse, type RabbitDoc, type RabbitHolding } from '@/lib/hooks/useRabbit';
import RabbitImage from '@/components/common/RabbitImage';
import VirtualRabbitGrid from '@/components/common/VirtualRabbitGrid';

interface RabbitDogamProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  userId: string;
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>;
}

/**
 * 토끼 도감 — 내가 발견한 토끼 기반 80칸 그리드
 */
export default function RabbitDogam({
  isOpen,
  onClose,
  courseId,
  userId,
  equippedRabbits,
}: RabbitDogamProps) {
  // 도감 열림 시 네비게이션 숨김
  useEffect(() => {
    if (isOpen) {
      document.body.setAttribute('data-hide-nav', '');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => document.body.removeAttribute('data-hide-nav');
  }, [isOpen]);

  // 도감 열림 시 body 스크롤 방지
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const { rabbits: allRabbits, loading: rabbitsLoading } = useRabbitsForCourse(courseId);
  const { holdings, loading: holdingsLoading } = useRabbitHoldings(userId);
  const [selectedRabbitId, setSelectedRabbitId] = useState<number | null>(null);

  // 내가 발견한 토끼의 rabbitId Set
  const myHoldingMap = new Map<number, RabbitHolding>();
  holdings
    .filter((h) => h.courseId === courseId)
    .forEach((h) => myHoldingMap.set(h.rabbitId, h));

  // rabbitId → RabbitDoc 맵
  const rabbitDocMap = new Map<number, RabbitDoc>();
  allRabbits.forEach((r) => rabbitDocMap.set(r.rabbitId, r));

  const discoveredCount = myHoldingMap.size;
  const loading = rabbitsLoading || holdingsLoading;
  // 선택된 토끼의 상세 정보
  const selectedRabbit = selectedRabbitId !== null ? rabbitDocMap.get(selectedRabbitId) : null;
  const selectedHolding = selectedRabbitId !== null ? myHoldingMap.get(selectedRabbitId) : null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        >
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.9 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden rounded-2xl"
          >
            {/* 배경 이미지 + 글래스 오버레이 */}
            <div className="absolute inset-0 rounded-2xl overflow-hidden">
              <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
            </div>
            <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />

            {/* 헤더 */}
            <div className="relative z-10 flex items-center justify-between p-4 border-b border-white/15">
              <span className="font-bold text-xl text-white">
                {selectedRabbitId !== null ? '토끼 상세' : '토끼 도감'}
              </span>
              <div className="flex items-center gap-3">
                <span className="font-bold text-xl text-white/80">
                  {selectedRabbitId !== null
                    ? `#${selectedRabbitId + 1}`
                    : `${discoveredCount}/80`}
                </span>
                {selectedRabbitId === null && (
                  <button onClick={onClose} className="w-8 h-8 flex items-center justify-center">
                    <svg className="w-6 h-6 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* 본문 */}
            <div className="relative z-10 flex-1 overflow-y-auto overscroll-contain p-4">
              {loading ? (
                <div className="text-center py-8 text-white/50">로딩 중...</div>
              ) : selectedRabbitId !== null && selectedRabbit && selectedHolding ? (
                <RabbitDetail rabbit={selectedRabbit} holding={selectedHolding} />
              ) : (
                <StudentRabbitGrid
                  onSelect={setSelectedRabbitId}
                  myHoldingMap={myHoldingMap}
                  equippedRabbits={equippedRabbits}
                />
              )}
            </div>

            {/* 푸터 — 상세 보기일 때만 */}
            {selectedRabbitId !== null && selectedRabbit && selectedHolding && (
              <div className="relative z-10 p-4 border-t border-white/10">
                <FooterWithEquip
                  rabbit={selectedRabbit}
                  equippedRabbits={equippedRabbits}
                  courseId={courseId}
                  onBack={() => setSelectedRabbitId(null)}
                  rabbitNames={equippedRabbits.map((e) => {
                    const doc = rabbitDocMap.get(e.rabbitId);
                    return doc?.name || (e.rabbitId === 0 ? '기본 토끼' : `토끼 #${e.rabbitId + 1}`);
                  })}
                />
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/**
 * 80칸 가상 그리드 — 발견/장착 상태에 따라 셀 스타일링
 */
function StudentRabbitGrid({
  onSelect,
  myHoldingMap,
  equippedRabbits,
}: {
  onSelect: (id: number) => void;
  myHoldingMap: Map<number, RabbitHolding>;
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>;
}) {
  const renderCell = useCallback((index: number) => {
    const isDiscovered = myHoldingMap.has(index);
    const isEquippedInGrid = equippedRabbits.some(e => e.rabbitId === index);
    return (
      <button
        onClick={() => isDiscovered && onSelect(index)}
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
 * 토끼 상세 보기 — 보유 집사 섹션 (실시간)
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

  // 내 표시 이름 계산
  const myDisplayName = isDefaultRabbit
    ? '토끼'
    : holding.discoveryOrder === 1
      ? baseName
      : `${baseName} ${holding.discoveryOrder}세`;

  return (
    <div>
      {/* 토끼 기본 정보 */}
      <div className="text-center mb-6">
        <div className="flex justify-center mb-2">
          <RabbitImage rabbitId={rabbit.rabbitId} size={120} className="drop-shadow-md" />
        </div>
        <p className="text-2xl font-bold text-white">{myDisplayName}</p>
        <p className="text-sm text-white/50">
          {rabbit.discovererCount}명 발견
        </p>
      </div>

      {isDefaultRabbit ? (
        /* 기본 토끼 — 특별 메시지 */
        <DefaultRabbitMessage />
      ) : (
        /* 보유 집사 — 2열, 20명 단위 구분선 */
        <ButlerList discoverers={discoverers} baseName={baseName} />
      )}
    </div>
  );
}

/**
 * 보유 집사 2열 레이아웃
 * 좌: 부모~9대 (10명), 우: 10대~19대 (10명) → 구분선 → 반복
 */
function ButlerList({
  discoverers,
  baseName,
}: {
  discoverers: Array<{ userId: string; nickname: string; discoveryOrder: number }>;
  baseName: string;
}) {
  const sorted = [...discoverers].sort((a, b) => a.discoveryOrder - b.discoveryOrder);

  // 20명 단위로 그룹 (각 그룹: 좌10 + 우10)
  const groups: Array<typeof sorted>[] = [];
  for (let i = 0; i < sorted.length; i += 20) {
    groups.push([
      sorted.slice(i, i + 10),
      sorted.slice(i + 10, i + 20),
    ]);
  }

  const renderEntry = (d: { userId: string; nickname: string; discoveryOrder: number }) => (
    <div key={d.userId} className="flex items-baseline gap-1.5">
      {d.discoveryOrder === 1 ? (
        <span className="text-sm font-bold text-[#D4AF37] shrink-0">부모</span>
      ) : (
        <span className="text-sm font-bold text-white/50 shrink-0">
          {d.discoveryOrder - 1}대
        </span>
      )}
      <span className="text-sm font-bold text-white/90 truncate">
        {d.nickname}
        {d.discoveryOrder > 1 && (
          <span className="text-xs text-white/50 ml-1">
            ({baseName} {d.discoveryOrder}세)
          </span>
        )}
      </span>
    </div>
  );

  return (
    <div className="mb-4 p-4 bg-white/10 border border-white/15 rounded-xl">
      <p className="text-base font-bold mb-3 text-white">보유 집사</p>
      <div className="max-h-[200px] overflow-y-auto overscroll-contain space-y-3">
        {groups.map(([left, right], gi) => (
          <div key={gi}>
            {gi > 0 && <hr className="border-white/15 mb-3" />}
            <div className="flex gap-4">
              {/* 좌측 열 */}
              <div className="flex-1 space-y-1">
                {left.map(renderEntry)}
              </div>
              {/* 우측 열 */}
              {right.length > 0 && (
                <div className="flex-1 space-y-1">
                  {right.map(renderEntry)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 기본 토끼 특별 메시지
 */
function DefaultRabbitMessage() {
  const { profile } = useUser();
  const nickname = profile?.nickname || '여러분';
  return (
    <p className="mb-4 text-center text-base font-bold text-white">
      토끼는 언제나 {nickname} 편!
    </p>
  );
}

/**
 * 상세 보기 푸터 — 도감으로 돌아가기 + 데려오기/데려옴 버튼 한 줄
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
      {/* 슬롯 가득 찼을 때 선택 UI */}
      {!isEquipped && slotsAreFull && (
        <div className="p-3 bg-white/10 border border-white/15 rounded-xl">
          <p className="text-xs text-white/60 mb-2">교체할 토끼를 선택하세요:</p>
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

      {/* 버튼 한 줄 */}
      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="flex-1 py-2 border-2 border-white/30 text-white font-bold rounded-lg hover:bg-white/10 transition-colors"
        >
          도감으로 돌아가기
        </button>
        {isEquipped ? (
          <div className="flex-1 py-2 text-center text-white/50 bg-white/10 border border-white/15 font-bold rounded-lg">
            데려옴
          </div>
        ) : (
          <button
            onClick={handleEquip}
            disabled={isProcessing || (slotsAreFull && selectedSlot === null)}
            className="flex-1 py-2 bg-white/20 backdrop-blur-sm text-white font-bold rounded-lg disabled:opacity-50 hover:bg-white/30 transition-colors"
          >
            {isProcessing ? '처리 중...' : '데려오기'}
          </button>
        )}
      </div>
    </div>
  );
}
