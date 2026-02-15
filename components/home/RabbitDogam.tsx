'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRabbitsForCourse, type RabbitDoc } from '@/lib/hooks/useRabbit';

interface RabbitDogamProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
}

/**
 * 토끼 도감 — 과목의 100마리 토끼 그리드
 *
 * 발견된 토끼: 이름 + 현재 집사 표시, 클릭하면 역사 보기
 * 미발견 토끼: ? 표시
 */
export default function RabbitDogam({ isOpen, onClose, courseId }: RabbitDogamProps) {
  const { rabbits, loading } = useRabbitsForCourse(courseId);
  const [selectedRabbit, setSelectedRabbit] = useState<RabbitDoc | null>(null);

  // rabbitId → RabbitDoc 맵
  const rabbitMap = new Map<number, RabbitDoc>();
  rabbits.forEach((r) => rabbitMap.set(r.rabbitId, r));

  const discoveredCount = rabbits.length;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => {
            if (selectedRabbit) {
              setSelectedRabbit(null);
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
              <span className="font-bold text-lg">
                {selectedRabbit ? '🐰 토끼 역사' : '🐰 토끼 도감'}
              </span>
              <span className="text-sm text-[#5C5C5C]">
                {selectedRabbit
                  ? `#${selectedRabbit.rabbitId}`
                  : `${discoveredCount}/100 발견`}
              </span>
            </div>

            {/* 본문 */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="text-center py-8 text-[#5C5C5C]">로딩 중...</div>
              ) : selectedRabbit ? (
                /* 역사 보기 */
                <RabbitHistory rabbit={selectedRabbit} onBack={() => setSelectedRabbit(null)} />
              ) : (
                /* 100칸 그리드 */
                <div className="grid grid-cols-5 gap-2">
                  {Array.from({ length: 100 }).map((_, index) => {
                    const rabbit = rabbitMap.get(index);
                    return (
                      <button
                        key={index}
                        onClick={() => rabbit && setSelectedRabbit(rabbit)}
                        className={`aspect-square border-2 flex flex-col items-center justify-center p-1 ${
                          rabbit
                            ? 'border-[#1A1A1A] bg-[#EDEAE4] cursor-pointer hover:bg-[#E5E0D8]'
                            : 'border-[#D4CFC4] bg-[#E5E0D8] cursor-default'
                        }`}
                      >
                        {rabbit ? (
                          <>
                            <span className="text-2xl">🐰</span>
                            <span className="text-[8px] truncate w-full text-center mt-1">
                              {rabbit.currentName || `#${index}`}
                            </span>
                            {rabbit.holderCount > 0 && (
                              <span className="text-[6px] text-[#5C5C5C]">
                                {rabbit.holderCount}명
                              </span>
                            )}
                          </>
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
              <button
                onClick={() => {
                  if (selectedRabbit) {
                    setSelectedRabbit(null);
                  } else {
                    onClose();
                  }
                }}
                className="w-full py-2 border-2 border-[#1A1A1A] font-bold"
              >
                {selectedRabbit ? '도감으로 돌아가기' : '닫기'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * 토끼 역사 상세
 */
function RabbitHistory({
  rabbit,
  onBack,
}: {
  rabbit: RabbitDoc;
  onBack: () => void;
}) {
  return (
    <div>
      {/* 토끼 기본 정보 */}
      <div className="text-center mb-6">
        <div className="text-6xl mb-2">🐰</div>
        <p className="text-xl font-bold">
          {rabbit.currentName || `토끼 #${rabbit.rabbitId}`}
        </p>
        <p className="text-sm text-[#5C5C5C]">
          #{rabbit.rabbitId} · 보유자 {rabbit.holderCount}명
        </p>
      </div>

      {/* 현재 집사 */}
      <div className="mb-4 p-3 bg-[#EDEAE4] border border-[#D4CFC4]">
        <p className="text-xs text-[#5C5C5C] mb-1">현재 집사</p>
        <p className="font-bold">
          {rabbit.currentButlerUserId
            ? rabbit.butlerHistory?.[rabbit.butlerHistory.length - 1]?.userName || '알 수 없음'
            : '없음 (공석)'}
        </p>
      </div>

      {/* 역대 집사 목록 */}
      {rabbit.butlerHistory && rabbit.butlerHistory.length > 0 && (
        <div>
          <p className="text-sm font-bold mb-2">역대 집사</p>
          <div className="space-y-2">
            {rabbit.butlerHistory.map((entry, idx) => (
              <div
                key={idx}
                className={`p-3 border ${
                  entry.endAt ? 'border-[#D4CFC4] bg-[#E5E0D8]' : 'border-[#D4AF37] bg-[#D4AF37]/5'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-sm">{entry.userName}</p>
                    {entry.name && (
                      <p className="text-xs text-[#5C5C5C]">
                        지은 이름: &ldquo;{entry.name}&rdquo;
                      </p>
                    )}
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 ${
                      entry.endAt
                        ? 'bg-[#D4CFC4] text-[#5C5C5C]'
                        : 'bg-[#D4AF37] text-white'
                    }`}
                  >
                    {entry.endAt ? '졸업' : '현직'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
