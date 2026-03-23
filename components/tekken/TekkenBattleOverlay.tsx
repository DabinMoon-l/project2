'use client';

/**
 * 배틀 오버레이 — 포켓몬 스타일 전체 배틀 컨테이너 (v3)
 *
 * portal → body, z-[110]
 * 배경: home-bg.jpg + bg-black/90 (홈 완전히 가림)
 * 2분할: 상단 퀴즈(flex-[5]) + 하단 캐릭터(flex-[5])
 *
 * 변경사항:
 * - 양쪽 독립 답변: 답변 후 "상대방 답변 대기 중..." 표시
 * - 타임아웃: 항상 제출 (hasAnswered 가드 제거)
 * - 서버 카운트다운 동기화
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import TekkenCountdown from './TekkenCountdown';
import TekkenQuestionCard from './TekkenQuestionCard';
import TekkenMashMinigame from './TekkenMashMinigame';
import TekkenBattleResult from './TekkenBattleResult';
import TekkenBattleArena from './TekkenBattleArena';
import type { RoundResultData, BattleState, BattlePlayer, BattleRabbit, BattleResult, BattleStatus, RoundState, SubmitAnswerResult, MashState } from '@/lib/types/tekken';
import { useHideNav } from '@/lib/hooks/useHideNav';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

interface TekkenBattleOverlayProps {
  tekken: {
    battle: BattleState | null;
    battleStatus: BattleStatus | 'error' | null;
    myPlayer: BattlePlayer | null;
    opponent: BattlePlayer | null;
    myActiveRabbit: BattleRabbit | null;
    opponentActiveRabbit: BattleRabbit | null;
    currentRound: RoundState | null;
    currentRoundIndex: number;
    totalRounds: number;
    battleTimeLeft: number;
    questionTimeLeft: number;
    submitAnswer: (answer: number) => Promise<SubmitAnswerResult | null>;
    swapRabbit: () => Promise<void>;
    submitMashTaps: (taps: number) => Promise<void>;
    startRound: (roundIndex: number) => Promise<void>;
    submitTimeout: () => Promise<void>;
    writeMashTap: (count: number) => void;
    writeBotTap: (count: number) => void;
    opponentMashTaps: number;
    mash: MashState | null;
    result: BattleResult | null;
    leaveBattle: () => void;
    error: string | null;
  };
  userId: string;
  onClose: () => void;
}

export default function TekkenBattleOverlay({
  tekken,
  userId,
  onClose,
}: TekkenBattleOverlayProps) {
  const [phase, setPhase] = useState<'loading' | 'countdown' | 'battle' | 'result'>('loading');
  const [hasAnswered, setHasAnswered] = useState(false);
  const [showRoundResult, setShowRoundResult] = useState(false);
  const prevRoundRef = useRef(0);

  // 네비게이션 숨김
  useHideNav(true);

  // 스크롤 잠금
  useEffect(() => {
    lockScroll();
    return () => unlockScroll();
  }, []);

  // 배틀 상태에 따라 phase 전환
  useEffect(() => {
    if (!tekken.battle) return;

    if (tekken.battleStatus === 'finished') {
      setPhase('result');
    } else if (tekken.battleStatus === 'countdown' || tekken.battleStatus === 'loading') {
      // loading은 레거시 — 새 코드에서는 바로 countdown으로 생성됨
      setPhase('countdown');
    } else if (tekken.battleStatus === 'question' || tekken.battleStatus === 'mash' || tekken.battleStatus === 'roundResult') {
      setPhase('battle');
    } else if (tekken.battleStatus === 'error') {
      // 에러 시 배틀 종료
      onClose();
    }
  }, [tekken.battleStatus, tekken.battle]);

  // 라운드 변경 감지 → 답변 상태 초기화
  useEffect(() => {
    if (tekken.currentRoundIndex !== prevRoundRef.current) {
      setHasAnswered(false);
      setShowRoundResult(false);
      prevRoundRef.current = tekken.currentRoundIndex;
    }
  }, [tekken.currentRoundIndex]);

  // roundResult 상태 → 결과 표시 (0.8초)
  useEffect(() => {
    if (tekken.battleStatus === 'roundResult') {
      setShowRoundResult(true);
      const timer = setTimeout(() => setShowRoundResult(false), 800);
      return () => clearTimeout(timer);
    }
  }, [tekken.battleStatus]);

  // 타임아웃 자동 제출 — 실패 시 2초마다 재시도 (상태 변경 시 자동 정리)
  // scored transaction lock이 이중 채점을 방지하므로 안전
  useEffect(() => {
    if (tekken.battleStatus !== 'question') return;
    if (tekken.questionTimeLeft > 0) return;
    if (!tekken.currentRound?.timeoutAt) return;

    const attempt = () => {
      tekken.submitTimeout().catch(() => {});
    };

    attempt();
    const retryTimer = setInterval(attempt, 2000);
    return () => clearInterval(retryTimer);
  }, [tekken.questionTimeLeft, tekken.battleStatus]);

  // 카운트다운 완료 → 첫 라운드 시작 (RTDB status 변경이 phase 전환을 트리거)
  const handleCountdownComplete = useCallback(() => {
    tekken.startRound(0);
  }, [tekken]);

  // 답변 제출 — CF 실패 시 hasAnswered 복구 (재시도 가능)
  const handleAnswer = useCallback(async (answer: number) => {
    setHasAnswered(true);
    try {
      await tekken.submitAnswer(answer);
    } catch {
      setHasAnswered(false);
    }
  }, [tekken]);

  // 연타 결과 제출
  const handleMashSubmit = useCallback(async (taps: number) => {
    await tekken.submitMashTaps(taps);
  }, [tekken]);

  // 라운드 결과 — RTDB에서 직접 도출 (useMemo로 불필요 재생성 방지)
  const roundResult = tekken.currentRound?.result;
  const myResult: RoundResultData | null = useMemo(() => {
    if (!roundResult) return null;
    return roundResult[userId] ?? null;
  }, [roundResult, userId]);

  const opponentResult: RoundResultData | null = useMemo(() => {
    if (!roundResult) return null;
    const opponentIds = Object.keys(roundResult).filter((id) => id !== userId);
    return opponentIds.length > 0 ? roundResult[opponentIds[0]] : null;
  }, [roundResult, userId]);

  // 상대가 봇인지 여부 (매 렌더마다 재계산 방지)
  const isOpponentBot = useMemo(() => {
    const players = tekken.battle?.players;
    if (!players) return false;
    const opId = Object.keys(players).find(id => id !== userId);
    return opId ? !!players[opId]?.isBot : false;
  }, [tekken.battle?.players, userId]);

  if (typeof window === 'undefined') return null;

  return createPortal(
    <motion.div
      className="fixed top-0 right-0 bottom-0 z-[110] flex flex-col overflow-hidden"
      style={{ left: 'var(--home-sheet-left, 0px)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* 배경: home-bg.jpg + 어두운 오버레이 (90%) */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/images/home-bg.jpg)' }}
      />
      <div className="absolute inset-0 bg-black/75" />

      {/* 콘텐츠 */}
      <div className="relative flex flex-col flex-1 z-10">
        {/* 카운트다운 */}
        {phase === 'countdown' && (
          <TekkenCountdown
            onComplete={handleCountdownComplete}
            countdownStartedAt={tekken.battle?.countdownStartedAt}
          />
        )}

        {/* 배틀 */}
        {phase === 'battle' && (
          <>
            {/* ── 상단 바: 라운드 표시 (중앙) + CRITICAL (좌측) ── */}
            <div className="pt-[env(safe-area-inset-top)]">
              <div className="relative flex items-center justify-center px-4 py-2">
                {tekken.battleStatus === 'question' && tekken.questionTimeLeft > 0 && (20000 - tekken.questionTimeLeft) < 5000 && (
                  <span className="absolute left-4 bottom-1.5 text-base font-black text-yellow-400 animate-pulse">
                    CRITICAL!
                  </span>
                )}
                <span className="text-2xl font-black text-white">
                  R{tekken.currentRoundIndex + 1}/{tekken.totalRounds}
                </span>
              </div>
            </div>

            {/* ── 퀴즈 영역 ── */}
            <div className="flex-[5] flex flex-col min-h-0 overflow-hidden relative">
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

              {/* 연타 미니게임 (줄다리기, 15초 시간제한) */}
              {tekken.battleStatus === 'mash' && tekken.mash && (
                <TekkenMashMinigame
                  userId={userId}
                  battleId={tekken.battle?.battleId || ''}
                  mashEndsAt={tekken.mash.endsAt || (Date.now() + 15000)}
                  opponentMashTaps={tekken.opponentMashTaps}
                  writeMashTap={tekken.writeMashTap}
                  writeBotTap={tekken.writeBotTap}
                  onSubmit={handleMashSubmit}
                  myColor={tekken.battle?.colorAssignment?.[userId] || 'red'}
                  isOpponentBot={isOpponentBot}
                />
              )}

              {/* 답변 후 상대 대기 — 절대 위치 (캐릭터 영역 밀지 않도록) */}
              {hasAnswered && tekken.battleStatus === 'question' && (
                <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center pointer-events-none">
                  <span className="text-sm text-white/40 font-bold">
                    상대방 답변 대기 중...
                  </span>
                </div>
              )}
            </div>

            {/* ── 캐릭터 영역 ── */}
            <div className="flex-[5] min-h-0">
              <TekkenBattleArena
                myPlayer={tekken.myPlayer}
                opponent={tekken.opponent}
                myActiveRabbit={tekken.myActiveRabbit}
                opponentActiveRabbit={tekken.opponentActiveRabbit}
                myResult={myResult}
                opponentResult={opponentResult}
                showResult={showRoundResult}
                correctChoiceText={showRoundResult ? (myResult?.correctChoiceText || opponentResult?.correctChoiceText) : undefined}
              />
            </div>

            <div className="pb-1" />
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
