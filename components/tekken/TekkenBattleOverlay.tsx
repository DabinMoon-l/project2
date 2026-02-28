'use client';

/**
 * 배틀 오버레이 — 포켓몬 스타일 전체 배틀 컨테이너 (v2)
 *
 * portal → body, z-[110]
 * 배경: home-bg.jpg + bg-black/80 (홈 완전히 가림)
 * 2분할: 상단 퀴즈(flex-[5]) + 하단 캐릭터(flex-[5])
 *
 * 변경사항:
 * - loading 상태: 문제 생성 중 스피너
 * - 배경 불투명도: 50% → 80%
 * - 레이아웃: 5:5 (겹침 해소)
 * - 순발력 시스템: 대기 상태 제거
 * - 연타: RTDB 줄다리기
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
  const [phase, setPhase] = useState<'loading' | 'countdown' | 'battle' | 'result'>('loading');
  const [hasAnswered, setHasAnswered] = useState(false);
  const [lastAnswerResult, setLastAnswerResult] = useState<RoundResultData | null>(null);
  const [showRoundResult, setShowRoundResult] = useState(false);
  const prevRoundRef = useRef(0);
  const timeoutSubmittedRef = useRef(false);

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
      setLastAnswerResult(null);
      setShowRoundResult(false);
      timeoutSubmittedRef.current = false;
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

  // 타임아웃 자동 제출 (아무도 안 풀었을 때)
  useEffect(() => {
    if (tekken.battleStatus !== 'question') return;
    if (hasAnswered || timeoutSubmittedRef.current) return;

    if (tekken.questionTimeLeft <= 0 && tekken.currentRound?.timeoutAt > 0) {
      timeoutSubmittedRef.current = true;
      tekken.submitTimeout();
    }
  }, [tekken.questionTimeLeft, tekken.battleStatus, hasAnswered]);

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

  // 타이머 표시
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
      {/* 배경: home-bg.jpg + 어두운 오버레이 (80%) */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/home-bg.jpg)' }}
      />
      <div className="absolute inset-0 bg-black/80" />

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
          <TekkenCountdown onComplete={handleCountdownComplete} />
        )}

        {/* 배틀 */}
        {phase === 'battle' && (
          <>
            {/* ── 상단 바: 타이머 + 라운드 ── */}
            <div className="pt-[env(safe-area-inset-top)]">
              <div className="flex items-center justify-center gap-3 px-4 py-2">
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
                />
              )}

              {/* 순발력 시스템: 답변 후 연타 대기 */}
              {hasAnswered && tekken.battleStatus === 'question' && (
                <div className="flex items-center justify-center py-2">
                  <span className="text-sm text-white/40 font-bold">
                    연타 준비 중...
                  </span>
                </div>
              )}
            </div>

            {/* ── 캐릭터 영역 (50%) ── */}
            <div className="flex-[5] min-h-0 overflow-hidden">
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
