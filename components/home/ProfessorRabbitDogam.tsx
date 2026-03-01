'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import RabbitImage from '@/components/common/RabbitImage';
import VirtualRabbitGrid from '@/components/common/VirtualRabbitGrid';
import {
  getAllProfessorRabbitData,
  equipProfessorRabbit,
  setProfessorRabbitName,
  setProfessorRabbitNote,
  getProfessorRabbitName,
  getProfessorRabbitNote,
} from '@/lib/utils/professorRabbit';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import { useHideNav } from '@/lib/hooks/useHideNav';

interface ProfessorRabbitDogamProps {
  isOpen: boolean;
  onClose: () => void;
  equipped: number[];
  onEquipChange: (equipped: number[]) => void;
}

/**
 * 교수님 전용 토끼 도감 — 80마리 전부 발견, 이름/비고 편집, 장착
 */
export default function ProfessorRabbitDogam({
  isOpen,
  onClose,
  equipped,
  onEquipChange,
}: ProfessorRabbitDogamProps) {
  const [selectedRabbitId, setSelectedRabbitId] = useState<number | null>(null);

  // 네비게이션 숨김
  useHideNav(isOpen);

  // body 스크롤 방지
  useEffect(() => {
    if (!isOpen) return;
    lockScroll();
    return () => { unlockScroll(); };
  }, [isOpen]);

  // 도감 닫을 때 상세 초기화
  useEffect(() => {
    if (!isOpen) setSelectedRabbitId(null);
  }, [isOpen]);

  const handleBack = () => setSelectedRabbitId(null);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.9 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden rounded-2xl"
          >
            {/* 배경 */}
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
                  {selectedRabbitId !== null ? `#${selectedRabbitId + 1}` : '80/80'}
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
              {selectedRabbitId !== null ? (
                <ProfessorRabbitDetail
                  rabbitId={selectedRabbitId}
                  equipped={equipped}
                  onEquipChange={onEquipChange}
                />
              ) : (
                <ProfessorRabbitGrid onSelect={setSelectedRabbitId} equipped={equipped} />
              )}
            </div>

            {/* 푸터 — 상세 보기일 때만 */}
            {selectedRabbitId !== null && (
              <ProfessorFooter
                rabbitId={selectedRabbitId}
                equipped={equipped}
                onEquipChange={onEquipChange}
                onBack={handleBack}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/**
 * 80칸 그리드 — 전부 발견 상태
 */
function ProfessorRabbitGrid({
  onSelect,
  equipped,
}: {
  onSelect: (id: number) => void;
  equipped: number[];
}) {
  const renderCell = useCallback((index: number) => {
    const isEquipped = equipped.includes(index);
    return (
      <button
        onClick={() => onSelect(index)}
        className={`w-full aspect-square flex items-center justify-center p-1 rounded-lg overflow-hidden cursor-pointer hover:bg-white/25 transition-colors ${
          isEquipped
            ? 'border-[3px] border-black bg-black/25'
            : 'border-2 border-white/20 bg-white/15'
        }`}
      >
        <RabbitImage rabbitId={index} size={64} className="w-full h-full object-contain" thumbnail />
      </button>
    );
  }, [equipped, onSelect]);

  return <VirtualRabbitGrid renderCell={renderCell} />;
}

/**
 * 토끼 상세 — 이름/비고 편집 가능
 */
function ProfessorRabbitDetail({
  rabbitId,
  equipped,
  onEquipChange,
}: {
  rabbitId: number;
  equipped: number[];
  onEquipChange: (equipped: number[]) => void;
}) {
  const [name, setName] = useState(() => getProfessorRabbitName(rabbitId));
  const [note, setNote] = useState(() => getProfessorRabbitNote(rabbitId));
  const [saved, setSaved] = useState(false);

  // rabbitId 변경 시 리셋
  useEffect(() => {
    setName(getProfessorRabbitName(rabbitId));
    setNote(getProfessorRabbitNote(rabbitId));
    setSaved(false);
  }, [rabbitId]);

  const handleSave = useCallback(() => {
    setProfessorRabbitName(rabbitId, name);
    setProfessorRabbitNote(rabbitId, note);
    setSaved(true);
    // 장착된 토끼 이름이 바뀌면 상위에 알림
    if (equipped.includes(rabbitId)) {
      onEquipChange([...equipped]);
    }
    setTimeout(() => setSaved(false), 1500);
  }, [rabbitId, name, note, equipped, onEquipChange]);

  const isEquipped = equipped.includes(rabbitId);

  return (
    <div>
      {/* 토끼 이미지 */}
      <div className="text-center mb-4">
        <div className="flex justify-center mb-2">
          <RabbitImage rabbitId={rabbitId} size={120} className="drop-shadow-md" />
        </div>
        {isEquipped && (
          <span className="inline-block px-2 py-0.5 bg-white/15 border border-white/30 rounded-full text-xs font-bold text-white/70">
            장착 중
          </span>
        )}
      </div>

      {/* 이름 편집 */}
      <div className="mb-3">
        <label className="block text-sm font-bold text-white/70 mb-1">이름</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="토끼 이름을 지어주세요"
          className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white/40"
          maxLength={20}
        />
      </div>

      {/* 비고 편집 */}
      <div className="mb-4">
        <label className="block text-sm font-bold text-white/70 mb-1">비고</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="메모를 남겨보세요"
          rows={3}
          className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 resize-none"
          maxLength={200}
        />
      </div>

      {/* 저장 버튼 */}
      <button
        onClick={handleSave}
        className={`w-full py-2.5 font-bold rounded-lg transition-all ${
          saved
            ? 'bg-green-500/30 border border-green-400/50 text-green-300'
            : 'bg-white/20 border border-white/20 text-white hover:bg-white/30'
        }`}
      >
        {saved ? '저장됨!' : '저장'}
      </button>
    </div>
  );
}

/**
 * 상세 푸터 — 돌아가기 + 장착
 */
function ProfessorFooter({
  rabbitId,
  equipped,
  onEquipChange,
  onBack,
}: {
  rabbitId: number;
  equipped: number[];
  onEquipChange: (equipped: number[]) => void;
  onBack: () => void;
}) {
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const isEquipped = equipped.includes(rabbitId);
  const slotsAreFull = equipped.length >= 2;

  const handleEquip = () => {
    let newEquipped: number[];
    if (slotsAreFull) {
      if (selectedSlot === null) return;
      newEquipped = equipProfessorRabbit(rabbitId, selectedSlot);
    } else {
      newEquipped = equipProfessorRabbit(rabbitId);
    }
    onEquipChange(newEquipped);
    setSelectedSlot(null);
  };

  return (
    <div className="relative z-10 p-4 border-t border-white/10 space-y-3">
      {/* 슬롯 가득 찼을 때 교체 선택 */}
      {!isEquipped && slotsAreFull && (
        <div className="p-3 bg-white/10 border border-white/15 rounded-xl">
          <p className="text-xs text-white/60 mb-2">교체할 토끼를 선택하세요:</p>
          <div className="flex gap-2">
            {equipped.map((slotRabbitId, idx) => {
              const slotName = getProfessorRabbitName(slotRabbitId) || `토끼 #${slotRabbitId + 1}`;
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
                  <RabbitImage rabbitId={slotRabbitId} size={28} thumbnail />
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
            장착 중
          </div>
        ) : (
          <button
            onClick={handleEquip}
            disabled={slotsAreFull && selectedSlot === null}
            className="flex-1 py-2 bg-white/20 backdrop-blur-sm text-white font-bold rounded-lg disabled:opacity-50 hover:bg-white/30 transition-colors"
          >
            데려오기
          </button>
        )}
      </div>
    </div>
  );
}
