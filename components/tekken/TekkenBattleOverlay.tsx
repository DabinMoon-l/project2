'use client';

/**
 * 배틀 오버레이 — 포켓몬 스타일 전체 배틀 컨테이너
 *
 * portal → body, z-[110] (HomeOverlay z-100 위)
 * 배경: home-bg.jpg + 어두운 오버레이
 * 2분할: 상단 퀴즈(flex-[5.5]) + 하단 캐릭터(flex-[4.5])
 * 카운트다운 → 배틀 → 결과까지 전체 흐름 관리
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import TekkenCountdown from './TekkenCountdown';
import TekkenQuestionCard from './TekkenQuestionCard';
import TekkenMashMinigame from './TekkenMashMinigame';
import TekkenBattleResult from './TekkenBattleResult';
import TekkenBattleArena from './TekkenBattleArena';
import type { RoundResultData } from '@/lib/types/tekken';

interface TekkenBattleOverlayProps {
  tekken: any; // UseTekkenBattleReturn
  userId: string;
  onClose: () => void;
}

export default function TekkenBattleOverlay({
  tekken,
  userId,
  onClose,
}: TekkenBattleOverlayProps) {
  const [phase, setPhase] = useState<'countdown' | 'battle' | 'result'>('countdown');
  const [hasAnswered, setHasAnswered] = useState(false);
  const [lastAnswerResult, setLastAnswerResult] = useState<RoundResultData | null>(null);
  const [showRoundResult, setShowRoundResult] = useState(false);
  const prevRoundRef = useRef(0);

  // data-hide-nav 설정
  useEffect(() => {
    document.body.setAttribute('data-hide-nav', '');
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, []);

  // 배틀 상태에 따라 phase 전환
  useEffect(() => {
    if (!tekken.battle) return;

    if (tekken.battleStatus === 'finished') {
      setPhase('result');
    } else if (tekken.battleStatus === 'question' || tekken.battleStatus === 'mash' || tekken.battleStatus === 'roundResult') {
      setPhase('battle');
    }
  }, [tekken.battleStatus, tekken.battle]);

  // 라운드 변경 감지 → 답변 상태 초기화
  useEffect(() => {
    if (tekken.currentRoundIndex !== prevRoundRef.current) {
      setHasAnswered(false);
      setLastAnswerResult(null);
      setShowRoundResult(false);
      prevRoundRef.current = tekken.currentRoundIndex;
    }
  }, [tekken.currentRoundIndex]);

  // roundResult 상태 → 결과 표시
  useEffect(() => {
    if (tekken.battleStatus === 'roundResult') {
      setShowRoundResult(true);
      const timer = setTimeout(() => setShowRoundResult(false), 1800);
      return () => clearTimeout(timer);
    }
  }, [tekken.battleStatus]);

  // 카운트다운 완료 → 첫 라운드 시작
  const handleCountdownComplete = useCallback(() => {
    setPhase('battle');
    tekken.startRound(0);
  }, [tekken]);

  // 답변 제출
  const handleAnswer = useCallback(async (answer: number) => {
    setHasAnswered(true);
    const result = await tekken.submitAnswer(answer);
    if (result) {
      setLastAnswerResult(result);
    }
  }, [tekken]);

  // 연타 결과 제출
  const handleMashSubmit = useCallback(async (taps: number) => {
    await tekken.submitMashTaps(taps);
  }, [tekken]);

  // 상대의 라운드 결과
  const opponentResult: RoundResultData | null = (() => {
    const round = tekken.currentRound;
    if (!round?.result) return null;
    const opponentIds = Object.keys(round.result).filter((id) => id !== userId);
    return opponentIds.length > 0 ? round.result[opponentIds[0]] : null;
  })();

  // 타이머 + 라운드 표시
  const minutes = Math.floor((tekken.battleTimeLeft ?? 0) / 60000);
  const seconds = Math.floor(((tekken.battleTimeLeft ?? 0) % 60000) / 1000);
  const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

  if (typeof window === 'undefined') return null;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[110] flex flex-col overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* 배경: home-bg.jpg + 어두운 오버레이 */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/home-bg.jpg)' }}
      />
      <div className="absolute inset-0 bg-black/50" />

      {/* 콘텐츠 */}
      <div className="relative flex flex-col flex-1 z-10">
        {/* 카운트다운 */}
        {phase === 'countdown' && (
          <TekkenCountdown onComplete={handleCountdownComplete} />
        )}

        {/* 배틀 */}
        {phase === 'battle' && (
          <>
            {/* ── 상단 바: 타이머 + 라운드 ── */}
            <div className="pt-[env(safe-area-inset-top)]">
              <div className="flex items-center justify-center gap-3 px-4" style={{ paddingBlock: 'clamp(6px, 1.2dvh, 12px)' }}>
                <div className="px-4 py-1 bg-black/40 border border-white/15 rounded-full backdrop-blur-sm">
                  <span className={`text-lg font-black ${(tekken.battleTimeLeft ?? 0) < 30000 ? 'text-red-400' : 'text-white'}`}>
                    {timeStr}
                  </span>
                </div>
                <span className="text-sm text-white/60 font-bold">
                  R{tekken.currentRoundIndex + 1}/{tekken.totalRounds}
                </span>
              </div>
            </div>

            {/* ── 퀴즈 영역 (55%) ── */}
            <div className="flex-[5.5] flex flex-col min-h-0">
              {/* 문제 카드 */}
              {tekken.battleStatus === 'question' && tekken.currentRound && (
                <TekkenQuestionCard
                  question={tekken.currentRound.questionData}
                  questionTimeLeft={tekken.questionTimeLeft}
                  onAnswer={handleAnswer}
                  disabled={hasAnswered}
                  roundIndex={tekken.currentRoundIndex}
                />
              )}

              {/* 연타 미니게임 (퀴즈 영역 내에서 표시) */}
              {tekken.battleStatus === 'mash' && tekken.mash && (
                <TekkenMashMinigame
                  endsAt={tekken.mash.endsAt}
                  triggeredBy={tekken.mash.triggeredBy}
                  userId={userId}
                  onSubmit={handleMashSubmit}
                />
              )}

              {/* 대기 상태 */}
              {hasAnswered && tekken.battleStatus === 'question' && (
                <div className="flex items-center justify-center py-2">
                  <span className="text-sm text-white/40 font-bold">
                    상대 대기 중...
                  </span>
                </div>
              )}
            </div>

            {/* ── 캐릭터 영역 (45%) ── */}
            <div className="flex-[4.5] min-h-0">
              <TekkenBattleArena
                myPlayer={tekken.myPlayer}
                opponent={tekken.opponent}
                myActiveRabbit={tekken.myActiveRabbit}
                opponentActiveRabbit={tekken.opponentActiveRabbit}
                myResult={lastAnswerResult}
                opponentResult={opponentResult}
                showResult={showRoundResult}
              />
            </div>

            <div className="pb-[env(safe-area-inset-bottom)]" />
          </>
        )}

        {/* 결과 */}
        {phase === 'result' && tekken.result && (
          <TekkenBattleResult
            result={tekken.result}
            userId={userId}
            opponentNickname={tekken.opponent?.nickname ?? '상대방'}
            onClose={onClose}
          />
        )}
      </div>
    </motion.div>,
    document.body
  );
}
