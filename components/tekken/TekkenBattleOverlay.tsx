'use client';

/**
 * 배틀 오버레이 — 전체 배틀 컨테이너
 *
 * portal → body, z-50
 * 카운트다운 → 배틀 → 결과까지 전체 흐름 관리
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import TekkenCountdown from './TekkenCountdown';
import TekkenBattleHUD from './TekkenBattleHUD';
import TekkenQuestionCard from './TekkenQuestionCard';
import TekkenSwapButton from './TekkenSwapButton';
import TekkenRoundResult from './TekkenRoundResult';
import TekkenMashMinigame from './TekkenMashMinigame';
import TekkenBattleResult from './TekkenBattleResult';
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
      if (result.mashTriggered) {
        // 연타 미니게임으로 전환됨 (배틀 상태가 mash로 변경)
      }
    }
  }, [tekken]);

  // 토끼 교체
  const handleSwap = useCallback(async () => {
    await tekken.swapRabbit();
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

  if (typeof window === 'undefined') return null;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 bg-[#1a1020] flex flex-col overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{
        backgroundImage: 'radial-gradient(ellipse at 50% 0%, rgba(139,26,26,0.15) 0%, transparent 60%)',
      }}
    >
      {/* 카운트다운 */}
      {phase === 'countdown' && (
        <TekkenCountdown onComplete={handleCountdownComplete} />
      )}

      {/* 배틀 */}
      {phase === 'battle' && (
        <>
          {/* HUD */}
          <div className="pt-[env(safe-area-inset-top)]">
            <TekkenBattleHUD
              myPlayer={tekken.myPlayer}
              opponent={tekken.opponent}
              myActiveRabbit={tekken.myActiveRabbit}
              opponentActiveRabbit={tekken.opponentActiveRabbit}
              battleTimeLeft={tekken.battleTimeLeft}
              currentRound={tekken.currentRoundIndex}
              totalRounds={tekken.totalRounds}
            />
          </div>

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

          {/* 라운드 결과 오버레이 */}
          {showRoundResult && (
            <TekkenRoundResult
              myResult={lastAnswerResult}
              opponentResult={opponentResult}
            />
          )}

          {/* 연타 미니게임 */}
          {tekken.battleStatus === 'mash' && tekken.mash && (
            <TekkenMashMinigame
              endsAt={tekken.mash.endsAt}
              triggeredBy={tekken.mash.triggeredBy}
              userId={userId}
              onSubmit={handleMashSubmit}
            />
          )}

          {/* 교체 버튼 + 하단 여백 */}
          <div className="px-4 pb-4 pt-2 flex items-center justify-between">
            <TekkenSwapButton
              myPlayer={tekken.myPlayer}
              onSwap={handleSwap}
              disabled={tekken.battleStatus !== 'question'}
              hasAnswered={hasAnswered}
            />

            {/* 대기 상태 텍스트 */}
            {hasAnswered && tekken.battleStatus === 'question' && (
              <span className="text-sm text-white/40 font-bold">
                상대 대기 중...
              </span>
            )}
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
    </motion.div>,
    document.body
  );
}
