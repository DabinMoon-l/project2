'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

/**
 * 추출된 키워드 타입 (두 카테고리)
 */
interface ExtractedKeywords {
  mainConcepts: string[];
  caseTriggers: string[];
}

interface KeywordBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (keywords: ExtractedKeywords) => void;
  keywords: ExtractedKeywords;
  isLoading?: boolean;
  loadingMessage?: string; // OCR 진행률 메시지
}

/**
 * 키워드 선택 바텀시트
 * 추출된 키워드를 두 카테고리(핵심 개념, 시나리오 단서)로 표시하고 사용자가 삭제 가능
 */
export default function KeywordBottomSheet({
  isOpen,
  onClose,
  onConfirm,
  keywords: initialKeywords,
  isLoading = false,
  loadingMessage,
}: KeywordBottomSheetProps) {
  const [mainConcepts, setMainConcepts] = useState<string[]>([]);
  const [caseTriggers, setCaseTriggers] = useState<string[]>([]);
  const [visibleMainCount, setVisibleMainCount] = useState(0);
  const [visibleTriggerCount, setVisibleTriggerCount] = useState(0);

  // 전체 키워드 수
  const totalInitialCount = useMemo(
    () => initialKeywords.mainConcepts.length + initialKeywords.caseTriggers.length,
    [initialKeywords]
  );
  const totalCurrentCount = mainConcepts.length + caseTriggers.length;
  const totalVisibleCount = visibleMainCount + visibleTriggerCount;

  // 키워드가 변경되면 상태 초기화 및 애니메이션 시작
  useEffect(() => {
    if (isOpen && totalInitialCount > 0) {
      setMainConcepts(initialKeywords.mainConcepts);
      setCaseTriggers(initialKeywords.caseTriggers);
      setVisibleMainCount(0);
      setVisibleTriggerCount(0);

      // 핵심 개념 먼저 애니메이션
      let mainDone = false;
      const mainInterval = setInterval(() => {
        setVisibleMainCount((prev) => {
          if (prev >= initialKeywords.mainConcepts.length) {
            clearInterval(mainInterval);
            mainDone = true;
            return prev;
          }
          return prev + 1;
        });
      }, 80);

      // 핵심 개념 완료 후 시나리오 단서 애니메이션
      const triggerDelay = initialKeywords.mainConcepts.length * 80 + 200;
      const triggerTimeout = setTimeout(() => {
        const triggerInterval = setInterval(() => {
          setVisibleTriggerCount((prev) => {
            if (prev >= initialKeywords.caseTriggers.length) {
              clearInterval(triggerInterval);
              return prev;
            }
            return prev + 1;
          });
        }, 80);

        return () => clearInterval(triggerInterval);
      }, triggerDelay);

      return () => {
        clearInterval(mainInterval);
        clearTimeout(triggerTimeout);
      };
    }
  }, [isOpen, initialKeywords, totalInitialCount]);

  // 핵심 개념 삭제
  const removeMainConcept = (keyword: string) => {
    setMainConcepts((prev) => prev.filter((k) => k !== keyword));
  };

  // 시나리오 단서 삭제
  const removeCaseTrigger = (keyword: string) => {
    setCaseTriggers((prev) => prev.filter((k) => k !== keyword));
  };

  // 완료 처리
  const handleConfirm = () => {
    if (mainConcepts.length === 0 && caseTriggers.length === 0) {
      alert('최소 1개 이상의 키워드가 필요합니다.');
      return;
    }
    onConfirm({ mainConcepts, caseTriggers });
  };

  // 전체 복원
  const handleRestoreAll = () => {
    setMainConcepts(initialKeywords.mainConcepts);
    setCaseTriggers(initialKeywords.caseTriggers);
  };

  // ESC 키로 닫기 (로딩 중에는 비활성화)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 로딩 중에는 ESC로 닫기 비활성화
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      lockScroll();
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unlockScroll();
    };
  }, [isOpen, onClose, isLoading]);

  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 백드롭 - 로딩 중에는 클릭으로 닫기 비활성화 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={isLoading ? undefined : onClose}
            className={`fixed inset-0 z-[70] bg-black/50 ${isLoading ? 'cursor-not-allowed' : ''}`}
          />

          {/* 바텀시트 */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 right-0 z-[71] bg-[#F5F0E8] border-t-2 border-[#1A1A1A] max-h-[70vh] flex flex-col"
            style={{ left: 'var(--detail-panel-left, 0)' }}
          >
            {/* 핸들 */}
            <div className="flex justify-center py-2">
              <div className="w-8 h-1 bg-[#D4CFC4] rounded-full" />
            </div>

            {/* 헤더 */}
            <div className="px-4 pb-2 border-b border-[#D4CFC4]">
              <h3 className="text-sm font-bold text-[#1A1A1A]">키워드 확인</h3>
              <p className="text-xs text-[#5C5C5C] mt-0.5">
                퀴즈 생성에 사용할 키워드입니다. 불필요한 키워드는 삭제하세요.
              </p>
            </div>

            {/* 키워드 목록 */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-3">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-6">
                  <div className="w-6 h-6 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin mb-2" />
                  <p className="text-xs text-[#5C5C5C]">{loadingMessage || '키워드 추출 중...'}</p>
                </div>
              ) : totalCurrentCount === 0 && totalVisibleCount >= totalInitialCount ? (
                <div className="flex flex-col items-center justify-center py-6">
                  <p className="text-xs text-[#5C5C5C]">추출된 키워드가 없습니다.</p>
                </div>
              ) : (
                <>
                  {/* 핵심 개념 섹션 */}
                  {(mainConcepts.length > 0 || visibleMainCount < initialKeywords.mainConcepts.length) && (
                    <div>
                      <h4 className="text-xs font-bold text-[#1A1A1A] mb-1.5 flex items-center gap-1.5">
                        핵심 개념
                        <span className="text-[10px] text-[#5C5C5C] font-normal">문제 제목이 됩니다</span>
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {mainConcepts.slice(0, visibleMainCount).map((keyword) => (
                          <motion.div
                            key={`main-${keyword}`}
                            initial={{ opacity: 0, x: -20, scale: 0.8 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            transition={{ duration: 0.2 }}
                            className="flex items-center gap-1 px-2 py-1 border-2 border-[#1A6B1A] bg-[#1A6B1A]/10 rounded-full"
                          >
                            <span className="text-xs font-medium text-[#1A6B1A]">{keyword}</span>
                            <button
                              type="button"
                              onClick={() => removeMainConcept(keyword)}
                              className="w-3.5 h-3.5 flex items-center justify-center text-[#1A6B1A] hover:text-[#8B1A1A] transition-colors"
                            >
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 시나리오 단서 섹션 */}
                  {(caseTriggers.length > 0 || visibleTriggerCount < initialKeywords.caseTriggers.length) && (
                    <div>
                      <h4 className="text-xs font-bold text-[#1A1A1A] mb-1.5 flex items-center gap-1.5">
                        시나리오 단서
                        <span className="text-[10px] text-[#5C5C5C] font-normal">문제 상황에 활용됩니다</span>
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {caseTriggers.slice(0, visibleTriggerCount).map((keyword) => (
                          <motion.div
                            key={`trigger-${keyword}`}
                            initial={{ opacity: 0, x: -20, scale: 0.8 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            transition={{ duration: 0.2 }}
                            className="flex items-center gap-1 px-2 py-1 border-2 border-[#4A0E0E] bg-[#4A0E0E]/10 rounded-full"
                          >
                            <span className="text-xs font-medium text-[#4A0E0E]">{keyword}</span>
                            <button
                              type="button"
                              onClick={() => removeCaseTrigger(keyword)}
                              className="w-3.5 h-3.5 flex items-center justify-center text-[#4A0E0E] hover:text-[#8B1A1A] transition-colors"
                            >
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 푸터 */}
            <div className="px-4 py-3 border-t-2 border-[#1A1A1A] bg-[#EDEAE4]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#5C5C5C]">
                  <span className="font-bold text-[#1A6B1A]">{mainConcepts.length}개</span> 개념 +
                  <span className="font-bold text-[#4A0E0E] ml-1">{caseTriggers.length}개</span> 단서
                </span>
                {totalCurrentCount < totalInitialCount && (
                  <button
                    type="button"
                    onClick={handleRestoreAll}
                    className="text-xs text-[#5C5C5C] underline"
                  >
                    전체 복원
                  </button>
                )}
              </div>
              <button
                onClick={handleConfirm}
                disabled={totalCurrentCount === 0 || totalVisibleCount < totalInitialCount}
                className={`w-full py-2 font-bold text-xs border-2 border-[#1A1A1A] transition-all ${
                  totalCurrentCount > 0 && totalVisibleCount >= totalInitialCount
                    ? 'bg-[#1A1A1A] text-white hover:bg-[#3A3A3A] shadow-[2px_2px_0px_#1A1A1A] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]'
                    : 'bg-[#E5E5E5] text-[#9A9A9A] cursor-not-allowed'
                }`}
              >
                {totalVisibleCount < totalInitialCount ? '키워드 추출 중...' : '완료'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
