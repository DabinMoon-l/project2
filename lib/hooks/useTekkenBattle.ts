'use client';

/**
 * 철권퀴즈 메인 훅
 *
 * RTDB 리스너 + CF 호출 통합
 * 매칭 → 배틀 → 결과까지 전체 흐름 관리
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ref, onValue, off, onDisconnect } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { getRtdb, functions } from '@/lib/firebase';
import type {
  MatchState,
  BattleState,
  BattlePlayer,
  RoundState,
  MashState,
  BattleResult,
  JoinMatchmakingResult,
  SubmitAnswerResult,
  BattleStatus,
  BattleRabbit,
} from '@/lib/types/tekken';
import { BATTLE_CONFIG } from '@/lib/types/tekken';

interface UseTekkenBattleReturn {
  // 매칭
  matchState: MatchState;
  waitTime: number;
  startMatchmaking: (courseId: string) => Promise<void>;
  cancelMatch: () => void;

  // 배틀 상태
  battle: BattleState | null;
  battleStatus: BattleStatus | null;
  myPlayer: BattlePlayer | null;
  opponent: BattlePlayer | null;
  myActiveRabbit: BattleRabbit | null;
  opponentActiveRabbit: BattleRabbit | null;
  currentRound: RoundState | null;
  currentRoundIndex: number;
  totalRounds: number;
  battleTimeLeft: number;
  questionTimeLeft: number;

  // 액션
  submitAnswer: (answer: number) => Promise<SubmitAnswerResult | null>;
  swapRabbit: () => Promise<void>;
  submitMashTaps: (taps: number) => Promise<void>;
  startRound: (roundIndex: number) => Promise<void>;

  // 연타
  mash: MashState | null;

  // 결과
  result: BattleResult | null;
  leaveBattle: () => void;

  // 에러
  error: string | null;
}

export function useTekkenBattle(userId: string | undefined): UseTekkenBattleReturn {
  const [matchState, setMatchState] = useState<MatchState>('idle');
  const [waitTime, setWaitTime] = useState(0);
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [battleTimeLeft, setBattleTimeLeft] = useState(0);
  const [questionTimeLeft, setQuestionTimeLeft] = useState(0);

  const battleIdRef = useRef<string | null>(null);
  const courseIdRef = useRef<string | null>(null);
  const waitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const matchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const battleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 타이머 정리
  const clearTimers = useCallback(() => {
    if (waitTimerRef.current) clearInterval(waitTimerRef.current);
    if (matchTimeoutRef.current) clearTimeout(matchTimeoutRef.current);
    if (battleTimerRef.current) clearInterval(battleTimerRef.current);
    waitTimerRef.current = null;
    matchTimeoutRef.current = null;
    battleTimerRef.current = null;
  }, []);

  // RTDB 배틀 리스너
  useEffect(() => {
    if (!battleIdRef.current) return;

    const battleRef = ref(getRtdb(), `tekken/battles/${battleIdRef.current}`);
    const unsubscribe = onValue(battleRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setBattle({
          ...data,
          battleId: battleIdRef.current!,
        });
      }
    });

    // 연결 끊김 시 처리
    if (userId) {
      const connectedRef = ref(getRtdb(), `tekken/battles/${battleIdRef.current}/players/${userId}/connected`);
      onDisconnect(connectedRef).set(false);
    }

    return () => {
      off(battleRef);
    };
  }, [battleIdRef.current, userId]);

  // 배틀/문제 타이머
  useEffect(() => {
    if (!battle || battle.status === 'finished') {
      setBattleTimeLeft(0);
      setQuestionTimeLeft(0);
      if (battleTimerRef.current) clearInterval(battleTimerRef.current);
      return;
    }

    const tick = () => {
      const now = Date.now();

      // 배틀 전체 타이머
      if (battle.endsAt) {
        setBattleTimeLeft(Math.max(0, battle.endsAt - now));
      }

      // 현재 라운드 문제 타이머
      const round = battle.rounds?.[battle.currentRound];
      if (round?.timeoutAt && battle.status === 'question') {
        setQuestionTimeLeft(Math.max(0, round.timeoutAt - now));
      } else {
        setQuestionTimeLeft(0);
      }
    };

    tick();
    battleTimerRef.current = setInterval(tick, 100);

    return () => {
      if (battleTimerRef.current) clearInterval(battleTimerRef.current);
    };
  }, [battle?.status, battle?.currentRound, battle?.endsAt]);

  // 매칭 시작
  const startMatchmaking = useCallback(async (courseId: string) => {
    if (!userId) return;
    setMatchState('searching');
    setWaitTime(0);
    setError(null);
    courseIdRef.current = courseId;

    // 대기 시간 타이머
    waitTimerRef.current = setInterval(() => {
      setWaitTime((prev) => prev + 1);
    }, 1000);

    try {
      const joinFn = httpsCallable<{ courseId: string }, JoinMatchmakingResult>(
        functions,
        'joinMatchmaking'
      );
      const result = await joinFn({ courseId });

      if (result.data.status === 'matched' && result.data.battleId) {
        // 즉시 매칭 성공
        setMatchState('matched');
        battleIdRef.current = result.data.battleId;
        clearTimers();
        // 대기 타이머만 정리, 리스너는 useEffect에서 자동 설정
        return;
      }

      // 대기 상태 — RTDB 매칭 큐 리스너 설정
      const queueRef = ref(getRtdb(), `tekken/matchmaking/${courseId}`);
      const queueUnsub = onValue(queueRef, (snapshot) => {
        const data = snapshot.val();
        // 큐에서 내가 사라졌다면 → 누군가 매칭해줌
        if (data && !data[userId]) {
          // 매칭됨 → battles에서 내 배틀 찾기
          off(queueRef);
        }
      });

      // 배틀 리스너로 매칭 감지
      const battlesRef = ref(getRtdb(), 'tekken/battles');
      const battlesUnsub = onValue(battlesRef, (snapshot) => {
        const battles = snapshot.val();
        if (!battles) return;

        for (const [bid, bdata] of Object.entries(battles)) {
          const b = bdata as any;
          if (b.players?.[userId] && b.status !== 'finished') {
            battleIdRef.current = bid;
            setMatchState('matched');
            clearTimers();
            off(battlesRef);
            off(queueRef);
            return;
          }
        }
      });

      // 30초 후 봇 매칭
      matchTimeoutRef.current = setTimeout(async () => {
        off(battlesRef);
        off(queueRef);

        try {
          const botFn = httpsCallable<{ courseId: string }, JoinMatchmakingResult>(
            functions,
            'matchWithBot'
          );
          const botResult = await botFn({ courseId });

          if (botResult.data.battleId) {
            battleIdRef.current = botResult.data.battleId;
            setMatchState('matched');
          }
        } catch (err: any) {
          console.error('봇 매칭 실패:', err);
          setMatchState('error');
          setError('매칭에 실패했습니다.');
        }
        clearTimers();
      }, BATTLE_CONFIG.MATCH_TIMEOUT);
    } catch (err: any) {
      console.error('매칭 실패:', err);
      setMatchState('error');
      setError(err?.message || '매칭에 실패했습니다.');
      clearTimers();
    }
  }, [userId, clearTimers]);

  // 매칭 취소
  const cancelMatch = useCallback(() => {
    if (!courseIdRef.current) return;

    const cancelFn = httpsCallable(functions, 'cancelMatchmaking');
    cancelFn({ courseId: courseIdRef.current }).catch(console.error);

    setMatchState('idle');
    setWaitTime(0);
    clearTimers();
    battleIdRef.current = null;
  }, [clearTimers]);

  // 답변 제출
  const handleSubmitAnswer = useCallback(async (answer: number): Promise<SubmitAnswerResult | null> => {
    if (!battleIdRef.current || !battle) return null;

    try {
      const fn = httpsCallable<any, SubmitAnswerResult>(functions, 'submitAnswer');
      const result = await fn({
        battleId: battleIdRef.current,
        roundIndex: battle.currentRound,
        answer,
      });
      return result.data;
    } catch (err: any) {
      console.error('답변 제출 실패:', err);
      return null;
    }
  }, [battle?.currentRound]);

  // 토끼 교체
  const handleSwapRabbit = useCallback(async () => {
    if (!battleIdRef.current) return;

    try {
      const fn = httpsCallable(functions, 'swapRabbit');
      await fn({ battleId: battleIdRef.current });
    } catch (err: any) {
      console.error('토끼 교체 실패:', err);
    }
  }, []);

  // 연타 결과 제출
  const handleSubmitMashTaps = useCallback(async (taps: number) => {
    if (!battleIdRef.current) return;

    try {
      const fn = httpsCallable(functions, 'submitMashResult');
      await fn({ battleId: battleIdRef.current, taps });
    } catch (err: any) {
      console.error('연타 제출 실패:', err);
    }
  }, []);

  // 라운드 시작 (카운트다운 후 클라이언트에서 호출)
  const handleStartRound = useCallback(async (roundIndex: number) => {
    if (!battleIdRef.current) return;

    try {
      const fn = httpsCallable(functions, 'startBattleRound');
      await fn({ battleId: battleIdRef.current, roundIndex });
    } catch (err: any) {
      console.error('라운드 시작 실패:', err);
    }
  }, []);

  // 배틀 나가기
  const leaveBattle = useCallback(() => {
    if (battleIdRef.current) {
      const battleRef = ref(getRtdb(), `tekken/battles/${battleIdRef.current}`);
      off(battleRef);
    }
    battleIdRef.current = null;
    courseIdRef.current = null;
    setBattle(null);
    setMatchState('idle');
    setWaitTime(0);
    setError(null);
    clearTimers();
  }, [clearTimers]);

  // 파생 상태
  const playerIds = battle?.players ? Object.keys(battle.players) : [];
  const myPlayer = userId && battle?.players?.[userId] ? battle.players[userId] : null;
  const opponentId = playerIds.find((id) => id !== userId);
  const opponent = opponentId && battle?.players?.[opponentId] ? battle.players[opponentId] : null;
  const currentRound = battle?.rounds?.[battle.currentRound] ?? null;
  const myActiveRabbit = myPlayer ? myPlayer.rabbits?.[myPlayer.activeRabbitIndex] ?? null : null;
  const opponentActiveRabbit = opponent ? opponent.rabbits?.[opponent.activeRabbitIndex] ?? null : null;

  // 정리
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  return {
    matchState,
    waitTime,
    startMatchmaking,
    cancelMatch,

    battle,
    battleStatus: battle?.status ?? null,
    myPlayer,
    opponent,
    myActiveRabbit,
    opponentActiveRabbit,
    currentRound,
    currentRoundIndex: battle?.currentRound ?? 0,
    totalRounds: (battle as any)?.totalRounds ?? BATTLE_CONFIG.MAX_ROUNDS,
    battleTimeLeft,
    questionTimeLeft,

    submitAnswer: handleSubmitAnswer,
    swapRabbit: handleSwapRabbit,
    submitMashTaps: handleSubmitMashTaps,
    startRound: handleStartRound,

    mash: battle?.mash ?? null,

    result: battle?.result ?? null,
    leaveBattle,

    error,
  };
}
