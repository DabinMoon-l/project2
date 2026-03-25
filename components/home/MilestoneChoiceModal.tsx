'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

const OPEN_MS = 380;
const CLOSE_MS = 320;
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

type Phase = 'hidden' | 'entering' | 'open' | 'exiting';

interface MilestoneChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  pendingCount: number;
  onChooseLevelUp: () => void;
  onChooseGacha: () => void;
  allRabbitsDiscovered: boolean;
  buttonRect?: { x: number; y: number; width: number; height: number } | null;
}

/**
 * 마일스톤 선택 모달 — 별 아이콘에서 요술지니
 */
export default function MilestoneChoiceModal({
  isOpen,
  onClose,
  pendingCount,
  onChooseLevelUp,
  onChooseGacha,
  allRabbitsDiscovered,
  buttonRect,
}: MilestoneChoiceModalProps) {
  const isWide = useWideMode();
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<Phase>('hidden');
  const phaseRef = useRef<Phase>('hidden');

  // 스크롤 잠금
  useEffect(() => {
    if (isOpen) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isOpen]);

  // 열기 — visible → entering(마운트) → rAF×3 → open(애니메이션 시작)
  useEffect(() => {
    if (isOpen && phaseRef.current === 'hidden') {
      setVisible(true);
      setPhase('entering');
      phaseRef.current = 'entering';
      // 3프레임 대기: 마운트 → 레이아웃 → transition 시작점 확보
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (phaseRef.current === 'entering') {
              setPhase('open');
              phaseRef.current = 'open';
            }
          });
        });
      });
    }
  }, [isOpen]);

  // 외부 즉시 닫기
  useEffect(() => {
    if (!isOpen && phaseRef.current !== 'hidden' && phaseRef.current !== 'exiting') {
      setVisible(false);
      setPhase('hidden');
      phaseRef.current = 'hidden';
    }
  }, [isOpen]);

  // 닫기 애니메이션
  const runClose = useCallback(() => {
    if (phaseRef.current === 'exiting') return;
    setPhase('exiting');
    phaseRef.current = 'exiting';
    setTimeout(() => {
      onClose();
      setVisible(false);
      setPhase('hidden');
      phaseRef.current = 'hidden';
    }, CLOSE_MS);
  }, [onClose]);

  // 선택 → 닫기 후 콜백
  const handleChoose = useCallback((cb: () => void) => {
    if (phaseRef.current === 'exiting') return;
    setPhase('exiting');
    phaseRef.current = 'exiting';
    setTimeout(() => {
      cb();
      setVisible(false);
      setPhase('hidden');
      phaseRef.current = 'hidden';
    }, CLOSE_MS);
  }, []);

  const origin = buttonRect
    ? `${buttonRect.x + buttonRect.width / 2}px ${buttonRect.y + buttonRect.height / 2}px`
    : 'center center';

  const isTransition = phase === 'entering' || phase === 'exiting';
  const dur = phase === 'exiting' ? CLOSE_MS : OPEN_MS;

  if (!visible) return null;

  // 공통 컨텐츠
  const milestoneContent = (
    <div className="relative z-10 p-4 text-center">
      <div className="w-9 h-9 mx-auto mb-2 flex items-center justify-center">
        <svg className="w-6 h-6" viewBox="0 0 24 24">
          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="#D4AF37" />
        </svg>
      </div>
      <h2 className="text-base font-bold text-white mb-1">마일스톤 달성!</h2>
      <p className="text-xs text-white/60 mb-4">
        사용 가능: <span className="font-bold text-white">{pendingCount}개</span>
      </p>
      <div className="flex flex-col gap-2">
        <button onClick={() => handleChoose(onChooseLevelUp)} className="w-full py-2 text-sm bg-white/25 text-white font-bold border border-white/30 rounded-full active:scale-[0.98] transition-transform">토끼 레벨업</button>
        <button onClick={() => handleChoose(onChooseGacha)} disabled={allRabbitsDiscovered} className="w-full py-2 text-sm bg-white/15 text-white font-bold border border-white/20 rounded-full active:scale-[0.98] transition-transform disabled:opacity-30 disabled:cursor-not-allowed">{allRabbitsDiscovered ? '모든 토끼 발견 완료!' : '토끼 뽑기'}</button>
        <button onClick={runClose} className="w-full py-1.5 text-white/50 text-xs hover:text-white/80 transition-colors">나중에 하기</button>
      </div>
    </div>
  );

  // 가로모드: 바텀시트 + 투명 오버레이(다른 곳 터치 시 닫기)
  if (isWide) {
    return createPortal(
      <>
        {/* 투명 오버레이 — 2쪽 영역, 클릭 시 닫기 */}
        <div
          className="fixed inset-0 z-[110]"
          style={{ left: '240px', right: 'calc(50% - 120px)' }}
          onClick={runClose}
        />
        {/* 바텀시트 */}
        <div
          className="fixed bottom-0 z-[111] overflow-hidden rounded-t-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.15)] border-t-2 border-x-2 border-white/20"
          style={{
            left: '240px',
            right: 'calc(50% - 120px)',
            transform: phase === 'open' ? 'translateY(0)' : 'translateY(100%)',
            transition: `transform ${dur}ms ${EASE}`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="absolute inset-0 backdrop-blur-2xl" style={{ backgroundColor: 'rgba(120, 80, 100, 0.52)' }} />
          <div className="relative z-10 flex justify-center pt-2 pb-1"><div className="w-8 h-1 rounded-full bg-white/30" /></div>
          {milestoneContent}
        </div>
      </>,
      document.body
    );
  }

  // 모바일: 기존 요술지니 모달
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[110] bg-black/40"
        style={{ opacity: isTransition ? 0 : 1, transition: `opacity ${dur}ms ease` }}
        onClick={runClose}
      />
      <div
        className="fixed inset-0 z-[111] flex items-center justify-center p-6 pointer-events-none"
        style={{
          transform: isTransition ? 'scale(0)' : 'scale(1)',
          opacity: isTransition ? 0 : 1,
          transformOrigin: origin,
          transition: `transform ${dur}ms ${EASE}, opacity ${dur}ms ${EASE}`,
          willChange: phase !== 'open' ? 'transform, opacity' : undefined,
        }}
      >
        <div className="pointer-events-auto w-full max-w-[260px] relative overflow-hidden rounded-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0"><Image src="/images/home-bg.jpg" alt="" fill className="object-cover" /></div>
          <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />
          {milestoneContent}
        </div>
      </div>
    </>,
    document.body
  );
}
