'use client';

/**
 * 연타 미니게임 — 줄다리기 (타이머 없음, 먼저 채우면 승리)
 *
 * 게이지: 중앙(50%) 시작, 탭으로 밀고 당기기
 * - 내 탭 → 게이지가 상대쪽(100%)으로 이동
 * - 상대 탭 → 게이지가 내쪽(0%)으로 이동
 * - 승리 조건: 100% 도달 (내 승) 또는 0% 도달 (상대 승)
 *
 * 색상: 서버 colorAssignment 기반 perspective 렌더링
 * - 왼쪽 = 내 색상, 오른쪽 = 상대 색상
 * - 양쪽 플레이어가 좌우 대칭으로 동일 게이지를 봄
 *
 * RTDB 실시간 동기화:
 * - writeMashTap(count): 내 탭 수 RTDB 쓰기 (100ms 스로틀)
 * - opponentMashTaps: 상대 탭 수 리스너로 수신
 *
 * CF 실패 복구: 자동 재시도 (최대 3회, 1.5초 간격)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BATTLE_CONFIG } from '@/lib/types/tekken';

interface TekkenMashMinigameProps {
  userId: string;
  battleId: string;
  mashEndsAt: number; // 안전 타임아웃 (UI에 표시 안 함)
  opponentMashTaps: number;
  writeMashTap: (count: number) => void;
  onSubmit: (taps: number) => Promise<void>;
  myColor: 'red' | 'blue';
}

const STEP = BATTLE_CONFIG.MASH_STEP_PER_TAP;

const COLORS = {
  red: { fill: 'bg-red-500', text: 'text-red-400', hex: '#ef4444' },
  blue: { fill: 'bg-blue-500', text: 'text-blue-400', hex: '#3b82f6' },
};

export default function TekkenMashMinigame({
  userId,
  battleId,
  mashEndsAt,
  opponentMashTaps,
  writeMashTap,
  onSubmit,
  myColor,
}: TekkenMashMinigameProps) {
  const [myTaps, setMyTaps] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const myTapsRef = useRef(0);
  const lastWriteRef = useRef(0);
  const submittedRef = useRef(false);
  const retryRef = useRef(0);

  const opColor = myColor === 'red' ? 'blue' : 'red';

  // 게이지: 50 + (내 탭 - 상대 탭) × STEP
  const myPercent = Math.min(100, Math.max(0, 50 + (myTaps - opponentMashTaps) * STEP));

  // 결과 제출 — CF 실패 시 자동 재시도 (최대 3회)
  const handleSubmitResult = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);
    writeMashTap(myTapsRef.current);
    try {
      await onSubmit(myTapsRef.current);
    } catch {
      // CF 실패 → 자동 재시도
      if (retryRef.current < 3) {
        retryRef.current++;
        setTimeout(() => {
          submittedRef.current = false;
          setSubmitted(false);
        }, 1500);
      }
    }
  }, [writeMashTap, onSubmit]);

  // 안전 타임아웃 (UI에 표시 안 함, 30초 안전장치)
  useEffect(() => {
    if (submittedRef.current || !mashEndsAt) return;

    const tick = () => {
      if (submittedRef.current) return;
      const remaining = Math.max(0, mashEndsAt - Date.now());
      if (remaining <= 0) {
        handleSubmitResult();
      }
    };

    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [mashEndsAt, handleSubmitResult]);

  // 승패 판정 (게이지 끝까지 도달)
  useEffect(() => {
    if (submittedRef.current) return;

    if (myPercent >= 100 || myPercent <= 0) {
      handleSubmitResult();
    }
  }, [myPercent, handleSubmitResult]);

  // 탭 핸들러
  const handleTap = useCallback(() => {
    if (submittedRef.current) return;
    myTapsRef.current += 1;
    setMyTaps(myTapsRef.current);

    // 50ms 스로틀로 RTDB 쓰기 (동기화 향상)
    const now = Date.now();
    if (now - lastWriteRef.current >= 50) {
      writeMashTap(myTapsRef.current);
      lastWriteRef.current = now;
    }

    if (navigator.vibrate) navigator.vibrate(10);
  }, [writeMashTap]);

  // 게이지 상태 텍스트
  const statusText = myPercent > 60
    ? '밀고 있어!'
    : myPercent < 40
      ? '밀리고 있어!'
      : '팽팽!';

  return (
    <div className="w-full px-4 flex-1 flex flex-col items-center justify-center">
      {/* 제목 */}
      <div className="text-center mb-5">
        <h2 className="text-2xl font-black text-white mb-1">
          연타 배틀!
        </h2>
        <p className="text-sm text-white/60">
          게이지를 끝까지 밀어라!
        </p>
        <motion.span
          className={`text-base font-black mt-1 inline-block ${
            myPercent > 60 ? 'text-green-400' : myPercent < 40 ? 'text-red-400' : 'text-yellow-400'
          }`}
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 0.5, repeat: Infinity }}
        >
          {statusText}
        </motion.span>
      </div>

      {/* 줄다리기 게이지 */}
      <div className="w-full max-w-xs mb-4">
        {/* 라벨: 왼쪽에 내 색상, 오른쪽에 상대 색상 */}
        <div className="flex justify-between mb-1.5">
          <span className={`text-xs font-bold ${COLORS[myColor].text}`}>나</span>
          <span className={`text-xs font-bold ${COLORS[opColor].text}`}>상대</span>
        </div>

        {/* 게이지 바: 배경 = 상대색, 전경 = 내 색 */}
        <div className={`h-10 rounded-full overflow-hidden border-2 border-white/30 relative ${COLORS[opColor].fill}`}>
          <motion.div
            className={`h-full ${COLORS[myColor].fill}`}
            animate={{ width: `${myPercent}%` }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          />
          {/* 중앙 기준선 */}
          <div className="absolute top-0 left-1/2 -translate-x-px h-full w-0.5 bg-white/40" />
        </div>

        {/* 탭 수 표시 */}
        <div className="flex justify-between mt-1.5">
          <span className={`text-sm font-bold ${COLORS[myColor].text}`}>{myTaps}탭</span>
          <span className={`text-sm font-bold ${COLORS[opColor].text}`}>{opponentMashTaps}탭</span>
        </div>
      </div>

      {/* 연타 버튼 — onPointerDown만 사용 (onClick+onTouchStart 이중 호출 방지) */}
      <motion.button
        onPointerDown={(e) => {
          e.preventDefault();
          handleTap();
        }}
        className={`w-48 h-24 rounded-2xl border-3 flex items-center justify-center transition-transform backdrop-blur-sm select-none touch-none ${
          submitted
            ? 'bg-white/5 border-white/10'
            : `bg-white/10 border-white/25 active:scale-90`
        }`}
        whileTap={submitted ? {} : { scale: 0.88 }}
        disabled={submitted}
      >
        <span className="text-3xl font-black text-white">
          {submitted ? '완료!' : '연타!'}
        </span>
      </motion.button>
    </div>
  );
}
