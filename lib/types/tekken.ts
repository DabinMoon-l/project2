/**
 * 철권퀴즈 (Tekken Quiz) 타입 정의
 *
 * 실시간 1v1 토끼 배틀 퀴즈 시스템
 * Firebase Realtime Database 기반
 */

/** 배틀 상태 */
export type BattleStatus =
  | 'loading'     // 문제 생성 중
  | 'countdown'   // 3-2-1 카운트다운
  | 'question'    // 문제 풀이 중
  | 'swap'        // 토끼 교체 애니메이션
  | 'mash'        // 연타 미니게임
  | 'roundResult' // 라운드 결과 표시
  | 'finished';   // 배틀 종료

/** 매칭 상태 */
export type MatchState = 'idle' | 'searching' | 'matched' | 'error';

/** 토끼 배틀 스탯 */
export interface BattleRabbit {
  rabbitId: number;
  maxHp: number;
  currentHp: number;
  atk: number;
  def: number;
}

/** 플레이어 정보 */
export interface BattlePlayer {
  nickname: string;
  profileRabbitId: number;
  isBot: boolean;
  rabbits: BattleRabbit[];
  activeRabbitIndex: number;
  connected: boolean;
}

/** 문제 데이터 (클라이언트용 — 정답 미포함) */
export interface BattleQuestion {
  text: string;
  type: 'multiple';
  choices: string[];
}

/** 라운드 답변 */
export interface RoundAnswer {
  answer: number;
  answeredAt: number;
}

/** 라운드 결과 */
export interface RoundResultData {
  isCorrect: boolean;
  damage: number;        // 내가 준 데미지
  isCritical: boolean;
  damageReceived: number; // 내가 받은 데미지
}

/** 라운드 상태 */
export interface RoundState {
  questionData: BattleQuestion;
  startedAt: number;
  timeoutAt: number;
  answers?: Record<string, RoundAnswer>;
  result?: Record<string, RoundResultData>;
  scored?: boolean;  // 채점 완료 플래그 (transaction lock)
}

/** 연타 미니게임 상태 (줄다리기) */
export interface MashState {
  mashId: string;
  startedAt: number;
  endsAt: number; // 연타 시간제한 (startedAt + 15000)
  taps?: Record<string, number>;
  result?: {
    winnerId: string;
    bonusDamage: number;
  };
}

/** 배틀 결과 */
export interface BattleResult {
  winnerId: string | null;
  loserId: string | null;
  isDraw: boolean;
  endReason: 'ko' | 'timeout' | 'disconnect';
  xpGranted: boolean;
}

/** 전체 배틀 상태 */
export interface BattleState {
  battleId: string;
  status: BattleStatus;
  courseId: string;
  createdAt: number;
  endsAt: number; // createdAt + 180000 (3분)
  currentRound: number;
  nextRound?: number; // roundResult 상태에서 다음 라운드 인덱스
  players: Record<string, BattlePlayer>;
  rounds?: Record<number, RoundState>;
  mash?: MashState;
  result?: BattleResult;
  colorAssignment?: Record<string, 'red' | 'blue'>; // uid → 색상
  countdownStartedAt?: number;  // 서버 타임스탬프
}

/** 매칭 큐 엔트리 */
export interface MatchmakingEntry {
  userId: string;
  nickname: string;
  profileRabbitId: number;
  equippedRabbits: Array<{
    rabbitId: number;
    courseId: string;
  }>;
  joinedAt: number;
}

/** 연승 기록 */
export interface StreakData {
  currentStreak: number;
  lastBattleAt: number;
}

/** joinMatchmaking 응답 */
export interface JoinMatchmakingResult {
  status: 'waiting' | 'matched';
  battleId?: string;
}

/** submitAnswer 응답 */
export interface SubmitAnswerResult {
  status: 'scored' | 'waiting';  // 채점됨 or 상대 대기
  isCorrect?: boolean;           // scored일 때만
  damage?: number;
  isCritical?: boolean;
  damageReceived?: number;
  mashTriggered?: boolean;
  mashId?: string;
}

/** submitMashResult 응답 */
export interface SubmitMashResultResponse {
  winnerId: string;
  bonusDamage: number;
}

/** 배틀 XP 보상 상수 */
export const BATTLE_XP = {
  WIN: 30,
  LOSE: 10,
  STREAK_BONUS: 5,
  MAX_TOTAL: 50,
} as const;

/** 배틀 설정 상수 */
export const BATTLE_CONFIG = {
  MATCH_TIMEOUT: 20000,     // 매칭 대기 20초 (봇 매칭)
  BATTLE_DURATION: 180000,  // 배틀 3분
  QUESTION_TIMEOUT: 20000,  // 문제 타임아웃 20초
  CRITICAL_TIME: 5000,      // 크리티컬 기준 5초
  MASH_STEP_PER_TAP: 1.5,  // 연타 게이지 이동량 (탭당 %)
  MASH_TIMEOUT: 15000,      // 연타 줄다리기 시간제한 15초
  COUNTDOWN_SECONDS: 3,     // 카운트다운 3초
  LONG_PRESS_MS: 500,       // 롱프레스 500ms
} as const;
