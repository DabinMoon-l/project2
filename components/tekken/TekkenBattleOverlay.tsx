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
import type { RoundResultData } from '@/lib/types/tekken';
import { useHideNav } from '@/lib/hooks/useHideNav';

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
  const [phase, setPhase] = useState<'loading' | 'countdown' | 'battle' | 'result'>('loading');
  const [hasAnswered, setHasAnswered] = useState(false);
  const [showRoundResult, setShowRoundResult] = useState(false);
  const prevRoundRef = useRef(0);
  const timeoutSubmittedRef = useRef(false);

  // 네비게이션 숨김
  useHideNav(true);

  // 배틀 상태에 따라 phase 전환
  useEffect(() => {
    if (!tekken.battle) return;

    if (tekken.battleStatus === 'finished') {
      setPhase('result');
    } else if (tekken.battleStatus === 'loading') {
      setPhase('loading');
    } else if (tekken.battleStatus === 'countdown') {
      setPhase('countdown');
    } else if (tekken.battleStatus === 'question' || tekken.battleStatus === 'mash' || tekken.battleStatus === 'roundResult') {
      setPhase('battle');
    }
  }, [tekken.battleStatus, tekken.battle]);

  // 라운드 변경 감지 → 답변 상태 초기화
  useEffect(() => {
    if (tekken.currentRoundIndex !== prevRoundRef.current) {
      setHasAnswered(false);
      setShowRoundResult(false);
      timeoutSubmittedRef.current = false;
      prevRoundRef.current = tekken.currentRoundIndex;
    }
  }, [tekken.currentRoundIndex]);

  // roundResult 상태 → 결과 표시
  useEffect(() => {
    if (tekken.battleStatus === 'roundResult') {
      setShowRoundResult(true);
      const timer = setTimeout(() => setShowRoundResult(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [tekken.battleStatus]);

  // 타임아웃 자동 제출 (항상 — 내가 답변해도 상대가 안 풀었을 수 있음)
  // CF 실패 시 timeoutSubmitted 복구 (재시도 가능)
  useEffect(() => {
    if (tekken.battleStatus !== 'question') return;
    if (timeoutSubmittedRef.current) return;

    if (tekken.questionTimeLeft <= 0 && tekken.currentRound?.timeoutAt > 0) {
      timeoutSubmittedRef.current = true;
      tekken.submitTimeout().catch(() => {
        timeoutSubmittedRef.current = false;
      });
    }
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

  if (typeof window === 'undefined') return null;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[110] flex flex-col overflow-hidden"
      style={{ left: 'var(--modal-left, 0px)' }}
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
        {/* 로딩 (문제 생성 중) */}
        {phase === 'loading' && (
          <div className="flex-1 flex flex-col items-center justify-center">
            <motion.div
              className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full mb-4"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
            <p className="text-lg font-bold text-white/80">문제 생성 중...</p>
            <p className="text-sm text-white/40 mt-1">잠시만 기다려주세요</p>
          </div>
        )}

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
            {/* ── 상단 바: 라운드 표시 ── */}
            <div className="pt-[env(safe-area-inset-top)]">
              <div className="flex items-center justify-center px-4 py-2">
                <span className="text-2xl font-black text-white">
                  R{tekken.currentRoundIndex + 1}/{tekken.totalRounds}
                </span>
              </div>
            </div>

            {/* ── 퀴즈 영역 (50%) ── */}
            <div className="flex-[5] flex flex-col min-h-0 overflow-hidden">
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
                  onSubmit={handleMashSubmit}
                  myColor={tekken.battle?.colorAssignment?.[userId] || 'red'}
                />
              )}

              {/* 답변 후 상대 대기 */}
              {hasAnswered && tekken.battleStatus === 'question' && (
                <div className="flex items-center justify-center py-2">
                  <span className="text-sm text-white/40 font-bold">
                    상대방 답변 대기 중...
                  </span>
                </div>
              )}
            </div>

            {/* ── 캐릭터 영역 (50%) ── */}
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
