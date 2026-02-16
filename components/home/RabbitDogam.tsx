'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useUser } from '@/lib/contexts';
import { useRabbitHoldings, useRabbitsForCourse, type RabbitDoc, type RabbitHolding } from '@/lib/hooks/useRabbit';
import RabbitImage from '@/components/common/RabbitImage';

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
  const [filling, setFilling] = useState(false);

  // 도감 전체 채우기 (디버그)
  const handleFillDogam = async () => {
    if (filling) return;
    setFilling(true);
    try {
      const fillDogam = httpsCallable(functions, 'fillDogam');
      await fillDogam({ courseId });
      window.location.reload();
    } catch (err) {
      console.error('도감 채우기 실패:', err);
      setFilling(false);
    }
  };

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
          onClick={() => {
            if (selectedRabbitId !== null) {
              setSelectedRabbitId(null);
            } else {
              onClose();
            }
          }}
        >
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.9 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[80vh] bg-[#F5F0E8] border-2 border-[#1A1A1A] flex flex-col"
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between p-4 border-b-2 border-[#1A1A1A]">
              <span className="font-bold text-xl">
                {selectedRabbitId !== null ? '토끼 상세' : '토끼 도감'}
              </span>
              <div className="flex items-center gap-2">
                {selectedRabbitId === null && discoveredCount < 80 && (
                  <button
                    onClick={handleFillDogam}
                    disabled={filling}
                    className="text-xs px-2 py-1 border border-[#1A1A1A] bg-[#EDEAE4] disabled:opacity-50"
                  >
                    {filling ? '채우는 중...' : '전체 채우기'}
                  </button>
                )}
                <span className="font-bold text-xl">
                  {selectedRabbitId !== null
                    ? `#${selectedRabbitId + 1}`
                    : `${discoveredCount}/80`}
                </span>
              </div>
            </div>

            {/* 본문 */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="text-center py-8 text-[#5C5C5C]">로딩 중...</div>
              ) : selectedRabbitId !== null && selectedRabbit && selectedHolding ? (
                <RabbitDetail rabbit={selectedRabbit} holding={selectedHolding} />
              ) : (
                /* 100칸 그리드 */
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: 80 }).map((_, index) => {
                    const isDiscovered = myHoldingMap.has(index);
                    return (
                      <button
                        key={index}
                        onClick={() => isDiscovered && setSelectedRabbitId(index)}
                        className={`aspect-square border-2 flex flex-col items-center justify-center p-1 ${
                          isDiscovered
                            ? 'border-[#1A1A1A] bg-[#EDEAE4] cursor-pointer hover:bg-[#E5E0D8]'
                            : 'border-[#D4CFC4] bg-[#E5E0D8] cursor-default'
                        }`}
                      >
                        {isDiscovered ? (
                          <RabbitImage rabbitId={index} size={64} className="object-contain" />
                        ) : (
                          <span className="text-2xl text-[#D4CFC4]">?</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 푸터 */}
            <div className="p-4 border-t border-[#D4CFC4]">
              {selectedRabbitId !== null && selectedRabbit && selectedHolding ? (
                <FooterWithEquip
                  rabbit={selectedRabbit}
                  equippedRabbits={equippedRabbits}
                  courseId={courseId}
                  onBack={() => setSelectedRabbitId(null)}
                />
              ) : (
                <button
                  onClick={onClose}
                  className="w-full py-2 border-2 border-[#1A1A1A] font-bold"
                >
                  닫기
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
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
        <p className="text-2xl font-bold">{myDisplayName}</p>
        <p className="text-sm text-[#5C5C5C]">
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
        <span className="text-xs font-bold text-[#D4AF37] shrink-0">부모</span>
      ) : (
        <span className="text-xs font-bold text-[#5C5C5C] shrink-0">
          {d.discoveryOrder - 1}대
        </span>
      )}
      <span className="text-sm font-bold truncate">
        {d.nickname}
        {d.discoveryOrder > 1 && (
          <span className="text-xs text-[#5C5C5C] ml-1">
            ({baseName} {d.discoveryOrder}세)
          </span>
        )}
      </span>
    </div>
  );

  return (
    <div className="mb-4 p-4 bg-[#EDEAE4] border border-[#D4CFC4]">
      <p className="text-base font-bold mb-3">보유 집사</p>
      <div className="max-h-[200px] overflow-y-auto space-y-3">
        {groups.map(([left, right], gi) => (
          <div key={gi}>
            {gi > 0 && <hr className="border-[#D4CFC4] mb-3" />}
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
    <p className="mb-4 text-center text-base font-bold">
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
}: {
  rabbit: RabbitDoc;
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>;
  courseId: string;
  onBack: () => void;
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
        <div className="p-3 bg-[#EDEAE4] border border-[#D4CFC4]">
          <p className="text-xs text-[#5C5C5C] mb-2">교체할 슬롯을 선택하세요:</p>
          <div className="flex gap-2">
            {[0, 1].map((slot) => (
              <button
                key={slot}
                onClick={() => setSelectedSlot(slot)}
                className={`flex-1 py-2 border-2 text-sm font-bold ${
                  selectedSlot === slot
                    ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                    : 'border-[#D4CFC4]'
                }`}
              >
                슬롯 {slot + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 버튼 한 줄 */}
      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="flex-1 py-2 border-2 border-[#1A1A1A] font-bold"
        >
          도감으로 돌아가기
        </button>
        {isEquipped ? (
          <div className="flex-1 py-2 text-center text-[#5C5C5C] bg-[#EDEAE4] border border-[#D4CFC4] font-bold">
            데려옴
          </div>
        ) : (
          <button
            onClick={handleEquip}
            disabled={isProcessing || (slotsAreFull && selectedSlot === null)}
            className="flex-1 py-2 bg-[#1A1A1A] text-white font-bold disabled:opacity-50"
          >
            {isProcessing ? '처리 중...' : '데려오기'}
          </button>
        )}
      </div>
    </div>
  );
}
