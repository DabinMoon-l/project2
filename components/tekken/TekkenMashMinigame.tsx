'use client';

/**
 * 연타 미니게임 — 줄다리기 (15초 시간제한)
 *
 * 게이지: 중앙(50%) 시작, 탭으로 밀고 당기기
 * - 내 탭 → 게이지가 상대쪽(100%)으로 이동
 * - 상대 탭 → 게이지가 내쪽(0%)으로 이동
 * - 승리 조건: 100% (내 승) 또는 0% (상대 승) 도달
 * - 타임아웃: 15초 내 미결정 시 현재 탭 차로 승패 결정
 *
 * 색상: 서버 colorAssignment 기반 perspective 렌더링
 * - myColor에 따라 좌/우 색상이 결정됨
 *
 * RTDB 실시간 동기화:
 * - writeMashTap(count): 내 탭 수 RTDB 쓰기 (100ms 스로틀)
 * - opponentMashTaps: 상대 탭 수 리스너로 수신
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BATTLE_CONFIG } from '@/lib/types/tekken';

interface TekkenMashMinigameProps {
  userId: string;
  battleId: string;
  mashEndsAt: number; // 연타 종료 시각
  opponentMashTaps: number;
  writeMashTap: (count: number) => void;
  onSubmit: (taps: number) => void;
  myColor: 'red' | 'blue';
}

const STEP = BATTLE_CONFIG.MASH_STEP_PER_TAP;

const COLORS = {
  red: { fill: 'bg-[#C06060]', label: 'text-[#C06060]' },
  blue: { fill: 'bg-[#6060A0]', label: 'text-[#6060A0]' },
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
  const [timeLeft, setTimeLeft] = useState<number>(BATTLE_CONFIG.MASH_TIMEOUT);
  const myTapsRef = useRef(0);
  const lastWriteRef = useRef(0);

  const opColor = myColor === 'red' ? 'blue' : 'red';

  // 게이지: 50 + (내 탭 - 상대 탭) × STEP
  const myPercent = Math.min(100, Math.max(0, 50 + (myTaps - opponentMashTaps) * STEP));

  // 타이머
  useEffect(() => {
    if (submitted || !mashEndsAt) return;

    const tick = () => {
      const remaining = Math.max(0, mashEndsAt - Date.now());
      setTimeLeft(remaining);

      // 타임아웃 → 현재 탭으로 제출
      if (remaining <= 0) {
        setSubmitted(true);
        writeMashTap(myTapsRef.current);
        onSubmit(myTapsRef.current);
      }
    };

    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [mashEndsAt, submitted, writeMashTap, onSubmit]);

  // 승패 판정 (게이지 끝까지 도달)
  useEffect(() => {
    if (submitted) return;

    if (myPercent >= 100 || myPercent <= 0) {
      setSubmitted(true);
      writeMashTap(myTapsRef.current);
      onSubmit(myTapsRef.current);
    }
  }, [myPercent, submitted, onSubmit, writeMashTap]);

  // 탭 핸들러
  const handleTap = useCallback(() => {
    if (submitted) return;
    myTapsRef.current += 1;
    setMyTaps(myTapsRef.current);

    // 100ms 스로틀로 RTDB 쓰기
    const now = Date.now();
    if (now - lastWriteRef.current >= 100) {
      writeMashTap(myTapsRef.current);
      lastWriteRef.current = now;
    }

    if (navigator.vibrate) navigator.vibrate(10);
  }, [submitted, writeMashTap]);

  // 게이지 색상: 내가 밀고 있으면 내 색, 상대가 밀고 있으면 상대 색
  const gaugeColor = myPercent > 50 ? COLORS[myColor].fill : COLORS[opColor].fill;
  const bgColor = COLORS[opColor].fill;
  const timeSeconds = Math.ceil(timeLeft / 1000);

  return (
    <div className="w-full px-4 flex-1 flex flex-col items-center justify-center">
      {/* 제목 + 타이머 */}
      <div className="text-center mb-5">
        <h2 className="text-2xl font-black text-white mb-1">
          연타 배틀!
        </h2>
        <p className="text-sm text-white/60">
          게이지를 끝까지 밀어라!
        </p>
        <span className={`text-lg font-black mt-1 inline-block ${
          timeSeconds <= 5 ? 'text-red-400' : 'text-white/70'
        }`}>
          {timeSeconds}초
        </span>
      </div>

      {/* 줄다리기 게이지 */}
      <div className="w-full max-w-xs mb-3">
        {/* 라벨: 왼쪽에 내 색상, 오른쪽에 상대 색상 */}
        <div className="flex justify-between mb-1">
          <span className={`text-xs font-bold ${COLORS[myColor].label}`}>나</span>
          <span className={`text-xs font-bold ${COLORS[opColor].label}`}>상대</span>
        </div>

        {/* 게이지 바 */}
        <div className={`h-8 rounded-full overflow-hidden border-2 border-white/20 relative ${bgColor}`}>
          <motion.div
            className={`h-full rounded-full ${gaugeColor}`}
            style={{ width: `${myPercent}%` }}
            transition={{ duration: 0.05 }}
          />
          {/* 중앙 기준선 */}
          <div className="absolute top-0 left-1/2 -translate-x-px h-full w-0.5 bg-white/30" />
        </div>

        {/* 탭 수 표시 */}
        <div className="flex justify-between mt-1.5">
          <span className="text-sm font-bold text-white/60">{myTaps}탭</span>
          <span className="text-sm font-bold text-white/60">{opponentMashTaps}탭</span>
        </div>
      </div>

      {/* 연타 버튼 */}
      <motion.button
        onClick={handleTap}
        onTouchStart={(e) => {
          e.preventDefault();
          handleTap();
        }}
        className="w-44 h-20 rounded-2xl bg-white/10 border-2 border-white/20 flex items-center justify-center active:scale-90 transition-transform backdrop-blur-sm"
        whileTap={{ scale: 0.9 }}
        disabled={submitted}
      >
        <span className="text-3xl font-black text-white">
          {submitted ? '완료!' : '연타!'}
        </span>
      </motion.button>
    </div>
  );
}
