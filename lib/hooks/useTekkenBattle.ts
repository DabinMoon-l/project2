'use client';

/**
 * 철권퀴즈 메인 훅 (v3 — 양쪽 독립 답변)
 *
 * RTDB 리스너 + CF 호출 통합
 * 매칭 → 배틀 → 결과까지 전체 흐름 관리
 *
 * 변경사항:
 * - 양쪽 독립 답변: 둘 다 제출 후 채점
 * - 답변 후 "상대방 답변 대기 중..." 표시
 * - 셀프데미지 제거, 양쪽 오답 시 상호 고정 데미지
 * - 타임아웃: 항상 제출 (내가 답변해도 상대가 안 풀었을 수 있음)
 * - CF 네트워크 에러 전파 (호출자가 상태 복구 가능)
 * - 봇 매칭 레이스 방지 (matchResult 리스너 유지)
 * - startBattleRound 실패 시 재시도 (최대 3회)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ref, onValue, off, onDisconnect, remove, set } from 'firebase/database';
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

/** 예상된 CF 에러인지 (상태 불일치, 이미 처리됨 등) */
function isExpectedError(err: any): boolean {
  const code = err?.code || '';
  return (
    code === 'functions/failed-precondition' ||
    code === 'functions/not-found' ||
    code === 'functions/permission-denied' ||
    code === 'functions/already-exists'
  );
}

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
  submitTimeout: () => Promise<void>;

  // 연타 RTDB
  writeMashTap: (count: number) => void;
  opponentMashTaps: number;

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
  const [opponentMashTaps, setOpponentMashTaps] = useState(0);
  const [activeBattleId, setActiveBattleId] = useState<string | null>(null);

  const battleIdRef = useRef<string | null>(null);
  const courseIdRef = useRef<string | null>(null);
  const waitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const matchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const battleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const matchResultUnsubRef = useRef<(() => void) | null>(null);
  const mashTapUnsubRef = useRef<(() => void) | null>(null);
  const roundResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 타이머 + 리스너 정리
  const clearTimers = useCallback(() => {
    if (waitTimerRef.current) clearInterval(waitTimerRef.current);
    if (matchTimeoutRef.current) clearTimeout(matchTimeoutRef.current);
    if (battleTimerRef.current) clearInterval(battleTimerRef.current);
    if (roundResultTimerRef.current) clearTimeout(roundResultTimerRef.current);
    if (matchResultUnsubRef.current) {
      matchResultUnsubRef.current();
      matchResultUnsubRef.current = null;
    }
    if (mashTapUnsubRef.current) {
      mashTapUnsubRef.current();
      mashTapUnsubRef.current = null;
    }
    waitTimerRef.current = null;
    matchTimeoutRef.current = null;
    battleTimerRef.current = null;
    roundResultTimerRef.current = null;
  }, []);

  // RTDB 배틀 리스너 (activeBattleId state로 dependency 관리)
  useEffect(() => {
    if (!activeBattleId) return;

    const battleRef = ref(getRtdb(), `tekken/battles/${activeBattleId}`);
    const unsubscribe = onValue(battleRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setBattle({
          ...data,
          battleId: activeBattleId,
        });
      }
    });

    // 연결 끊김 시 처리
    let connectedRef: ReturnType<typeof ref> | null = null;
    if (userId) {
      connectedRef = ref(getRtdb(), `tekken/battles/${activeBattleId}/players/${userId}/connected`);
      onDisconnect(connectedRef).set(false);
    }

    return () => {
      off(battleRef);
      // onDisconnect 핸들러 해제 (배틀 종료 후 잔류 방지)
      if (connectedRef) {
        onDisconnect(connectedRef).cancel().catch(() => {});
      }
    };
  }, [activeBattleId, userId]);

  // 연타 상대 탭 RTDB 리스너
  useEffect(() => {
    if (!battle?.mash || !battleIdRef.current || !userId) {
      setOpponentMashTaps(0);
      if (mashTapUnsubRef.current) {
        mashTapUnsubRef.current();
        mashTapUnsubRef.current = null;
      }
      return;
    }

    // 상대 ID 찾기
    const playerIds = Object.keys(battle.players || {});
    const opponentId = playerIds.find((id) => id !== userId);
    if (!opponentId) return;

    const opTapsRef = ref(getRtdb(), `tekken/battles/${battleIdRef.current}/mash/taps/${opponentId}`);
    const unsub = onValue(opTapsRef, (snapshot) => {
      setOpponentMashTaps(snapshot.val() || 0);
    });
    mashTapUnsubRef.current = unsub;

    return () => {
      unsub();
      mashTapUnsubRef.current = null;
    };
  }, [battle?.mash?.mashId, userId]);

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

      if (battle.endsAt) {
        setBattleTimeLeft(Math.max(0, battle.endsAt - now));
      }

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

  // roundResult 감지 → 2초 후 다음 라운드 시작 (재시도 최대 3회)
  useEffect(() => {
    if (battle?.status !== 'roundResult' || battle?.nextRound === undefined) return;

    const nextRound = battle.nextRound;
    let retryCount = 0;

    const attemptStart = async () => {
      try {
        const fn = httpsCallable(functions, 'startBattleRound');
        await fn({ battleId: battleIdRef.current, roundIndex: nextRound });
      } catch (err: any) {
        // 이미 시작된 경우 무시
        if (isExpectedError(err)) return;
        // 네트워크 에러 → 재시도 (최대 3회)
        if (retryCount < 2) {
          retryCount++;
          roundResultTimerRef.current = setTimeout(attemptStart, 1000);
        } else {
          console.error('다음 라운드 시작 실패 (재시도 소진):', err);
        }
      }
    };

    roundResultTimerRef.current = setTimeout(attemptStart, 2000);

    return () => {
      if (roundResultTimerRef.current) {
        clearTimeout(roundResultTimerRef.current);
        roundResultTimerRef.current = null;
      }
    };
  }, [battle?.status, battle?.nextRound]);

  // 매칭 시작
  const startMatchmaking = useCallback(async (courseId: string) => {
    if (!userId) return;
    setMatchState('searching');
    setWaitTime(0);
    setError(null);
    courseIdRef.current = courseId;

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
        battleIdRef.current = result.data.battleId;
        setActiveBattleId(result.data.battleId);
        setMatchState('matched');
        clearTimers();
        return;
      }

      // 대기 상태 — 매칭 결과 리스너
      const matchResultRef = ref(getRtdb(), `tekken/matchResults/${userId}`);
      const unsubMatchResult = onValue(matchResultRef, (snapshot) => {
        const data = snapshot.val();
        if (data?.battleId) {
          battleIdRef.current = data.battleId;
          setActiveBattleId(data.battleId);
          setMatchState('matched');
          clearTimers();
          remove(matchResultRef).catch(() => {});
        }
      });
      matchResultUnsubRef.current = unsubMatchResult;

      // 봇 매칭 타임아웃 (20초)
      // matchResult 리스너를 유지한 상태로 봇 매칭 시도 (레이스 방지)
      matchTimeoutRef.current = setTimeout(async () => {
        // 이미 실제 매칭 성사 시 무시
        if (battleIdRef.current) return;

        try {
          const botFn = httpsCallable<{ courseId: string }, JoinMatchmakingResult>(
            functions,
            'matchWithBot'
          );
          const botResult = await botFn({ courseId });

          // 봇 CF 실행 중 실제 매칭이 성사됐으면 무시 (실제 매칭 우선)
          if (battleIdRef.current) return;

          if (botResult.data.battleId) {
            battleIdRef.current = botResult.data.battleId;
            setActiveBattleId(botResult.data.battleId);
            setMatchState('matched');
            clearTimers();
          }
        } catch (err: any) {
          // 실제 매칭이 성사됐으면 에러 무시
          if (battleIdRef.current) return;

          console.error('봇 매칭 실패:', err);
          setMatchState('error');
          setError('매칭에 실패했습니다.');
          clearTimers();
        }
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
    setActiveBattleId(null);
  }, [clearTimers]);

  // 답변 제출 — 네트워크 에러 시 throw (호출자가 hasAnswered 복구)
  const handleSubmitAnswer = useCallback(async (answer: number): Promise<SubmitAnswerResult | null> => {
    if (!battleIdRef.current || !battle) return null;

    try {
      const fn = httpsCallable<any, SubmitAnswerResult>(functions, 'submitAnswer');
      const result = await fn({
        battleId: battleIdRef.current,
        roundIndex: battle.currentRound,
        answer,
      });
      // status === 'waiting' → 상대 대기 (UI에서 "상대방 답변 대기 중..." 표시)
      if (result.data.status === 'waiting') {
        return null;
      }
      // status === 'scored' → 결과 반환
      return result.data;
    } catch (err: any) {
      // 예상된 상태 에러 (이미 채점됨 등) → 무시
      if (isExpectedError(err)) return null;
      // 네트워크/기타 에러 → 호출자에게 전파 (hasAnswered 복구용)
      throw err;
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

  // 연타 결과 제출 — 네트워크 에러 시 throw (호출자가 submitted 복구)
  const handleSubmitMashTaps = useCallback(async (taps: number) => {
    if (!battleIdRef.current) return;

    try {
      const fn = httpsCallable(functions, 'submitMashResult');
      await fn({ battleId: battleIdRef.current, taps });
    } catch (err: any) {
      // 예상된 에러 (이미 처리됨 등) → 무시
      if (isExpectedError(err)) return;
      // 네트워크/기타 에러 → 호출자에게 전파
      throw err;
    }
  }, []);

  // 연타 탭 수 RTDB 직접 쓰기 (실시간 동기화용)
  const writeMashTap = useCallback((count: number) => {
    if (!battleIdRef.current || !userId) return;
    const tapRef = ref(getRtdb(), `tekken/battles/${battleIdRef.current}/mash/taps/${userId}`);
    set(tapRef, count).catch(() => {});
  }, [userId]);

  // 타임아웃 제출 — 네트워크 에러 시 throw (호출자가 timeoutSubmitted 복구)
  const handleSubmitTimeout = useCallback(async () => {
    if (!battleIdRef.current || !battle) return;

    try {
      const fn = httpsCallable(functions, 'submitTimeout');
      await fn({
        battleId: battleIdRef.current,
        roundIndex: battle.currentRound,
      });
    } catch (err: any) {
      // 예상된 에러 → 무시
      if (isExpectedError(err)) return;
      // 네트워크/기타 에러 → 호출자에게 전파
      throw err;
    }
  }, [battle?.currentRound]);

  // 라운드 시작
  const handleStartRound = useCallback(async (roundIndex: number) => {
    if (!battleIdRef.current) return;

    try {
      const fn = httpsCallable(functions, 'startBattleRound');
      await fn({ battleId: battleIdRef.current, roundIndex });
    } catch (err: any) {
      if (!isExpectedError(err)) {
        console.error('라운드 시작 실패:', err);
      }
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
    setActiveBattleId(null);
    setBattle(null);
    setMatchState('idle');
    setWaitTime(0);
    setError(null);
    setOpponentMashTaps(0);
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
    totalRounds: (battle as any)?.totalRounds ?? 10,
    battleTimeLeft,
    questionTimeLeft,

    submitAnswer: handleSubmitAnswer,
    swapRabbit: handleSwapRabbit,
    submitMashTaps: handleSubmitMashTaps,
    startRound: handleStartRound,
    submitTimeout: handleSubmitTimeout,

    writeMashTap,
    opponentMashTaps,

    mash: battle?.mash ?? null,

    result: battle?.result ?? null,
    leaveBattle,

    error,
  };
}
