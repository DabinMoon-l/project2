'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/** Roll 결과 (spinRabbitGacha 반환값) */
export interface RollResultData {
  type: 'undiscovered' | 'discovered' | 'duplicate';
  rabbitId: number;
  currentRabbitName: string | null;
  currentButlerName: string | null;
  holderCount: number;
  ownedCount: number;
  generationIndex: number | null;
}

interface GachaResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: RollResultData | null;
  isAnimating: boolean;
  onSpin: () => void;
  canGacha: boolean;
  /** undiscovered: 집사되기 (이름 + adopt) */
  onAdoptAsButler: (result: RollResultData, name: string) => void;
  /** discovered: 데려오기 (adopt) */
  onAdoptAsGeneration: (result: RollResultData) => void;
}

/**
 * 뽑기 결과 모달 (2단계: Roll → 사용자 선택)
 *
 * - 준비 → 뽑기 애니메이션 → 결과:
 *   - undiscovered: "새로운 토끼!" + 이름 입력 + [집사되기] / [놓아주기]
 *   - discovered: "이름(n세)" + [데려오기] / [놓아주기]
 *   - duplicate: "이미 보유" + [확인]
 */
export default function GachaResultModal({
  isOpen,
  onClose,
  result,
  isAnimating,
  onSpin,
  canGacha,
  onAdoptAsButler,
  onAdoptAsGeneration,
}: GachaResultModalProps) {
  const [newName, setNewName] = useState('');

  const handleAdoptButler = () => {
    if (!result || !newName.trim()) return;
    onAdoptAsButler(result, newName.trim());
    setNewName('');
  };

  const handleAdoptGeneration = () => {
    if (!result) return;
    onAdoptAsGeneration(result);
  };

  const handleRelease = () => {
    // 놓아주기 → 모달 닫기 (서버 호출 불필요, spinRabbitGacha에서 이미 lastGachaExp 갱신)
    setNewName('');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
        >
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.8 }}
            className="w-full max-w-sm mx-4 bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            {isAnimating ? (
              /* 뽑기 애니메이션 */
              <div className="text-center py-12">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="text-8xl inline-block"
                >
                  🎰
                </motion.div>
                <p className="mt-4 font-bold">뽑는 중...</p>
              </div>
            ) : result ? (
              /* 결과 표시 */
              <div className="text-center">
                <div className="text-8xl mb-4">🐰</div>

                {result.type === 'undiscovered' ? (
                  /* 미발견 — 집사되기 + 이름 짓기 */
                  <>
                    <div className="mb-4">
                      <span className="px-3 py-1 bg-[#D4AF37] text-white text-sm font-bold">
                        새로운 토끼 발견!
                      </span>
                    </div>
                    <p className="text-lg font-bold mb-2">
                      토끼 #{result.rabbitId}을 처음 발견했어요!
                    </p>
                    <p className="text-sm text-[#5C5C5C] mb-4">
                      집사가 되어 이름을 지어주세요
                    </p>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="토끼 이름 (1-10자)"
                      maxLength={10}
                      className="w-full p-3 border-2 border-[#1A1A1A] text-center text-lg font-bold mb-4"
                    />
                    <button
                      onClick={handleAdoptButler}
                      disabled={!newName.trim()}
                      className="w-full py-3 bg-[#1A1A1A] text-white font-bold disabled:opacity-50 mb-2"
                    >
                      집사되기
                    </button>
                    <button
                      onClick={handleRelease}
                      className="w-full py-2 text-[#5C5C5C]"
                    >
                      놓아주기
                    </button>
                  </>
                ) : result.type === 'discovered' ? (
                  /* 발견 — 데려오기 */
                  <>
                    <p className="text-lg font-bold mb-2">
                      {result.currentRabbitName || `토끼 #${result.rabbitId}`}
                    </p>
                    <p className="text-sm text-[#5C5C5C] mb-1">
                      {result.currentButlerName
                        ? `집사: ${result.currentButlerName}`
                        : '집사 없음'
                      }
                      {' · '}보유자 {result.holderCount}명
                    </p>
                    <p className="text-sm text-[#5C5C5C] mb-4">
                      세대 보유자로 데려올 수 있어요!
                    </p>
                    <button
                      onClick={handleAdoptGeneration}
                      className="w-full py-3 bg-[#1A1A1A] text-white font-bold mb-2"
                    >
                      데려오기
                    </button>
                    <button
                      onClick={handleRelease}
                      className="w-full py-2 text-[#5C5C5C]"
                    >
                      놓아주기
                    </button>
                  </>
                ) : (
                  /* 중복 */
                  <>
                    <p className="text-lg font-bold mb-2">
                      {result.currentRabbitName || `토끼 #${result.rabbitId}`}
                      {result.generationIndex && result.generationIndex >= 2
                        ? ` ${result.generationIndex}세`
                        : ''}
                    </p>
                    <p className="text-sm text-[#5C5C5C] mb-4">이미 보유한 토끼예요!</p>
                    <button
                      onClick={() => {
                        setNewName('');
                        onClose();
                      }}
                      className="w-full py-3 bg-[#1A1A1A] text-white font-bold"
                    >
                      확인
                    </button>
                  </>
                )}
              </div>
            ) : (
              /* 뽑기 준비 */
              <div className="text-center">
                <div className="text-8xl mb-4">🎁</div>
                <p className="text-lg font-bold mb-2">뽑기 준비 완료!</p>
                <p className="text-sm text-[#5C5C5C] mb-6">
                  50 XP를 달성했어요!
                  <br />
                  새로운 토끼를 만나보세요
                </p>
                <button
                  onClick={onSpin}
                  disabled={!canGacha}
                  className="w-full py-3 bg-[#1A1A1A] text-white font-bold disabled:opacity-50"
                >
                  뽑기!
                </button>
                <button
                  onClick={onClose}
                  className="w-full py-2 mt-2 text-[#5C5C5C]"
                >
                  나중에 하기
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
