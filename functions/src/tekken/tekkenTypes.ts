/**
 * 철권퀴즈 공유 타입 + 상수
 */

/** 배틀 문제 난이도 */
export type TekkenDifficulty = "easy" | "medium" | "hard";

/** Gemini로 생성된 배틀 문제 */
export interface GeneratedQuestion {
  text: string;
  type: "multiple";
  choices: string[];
  correctAnswer: number;
  difficulty?: TekkenDifficulty;
  /** 문제 해설 */
  explanation?: string;
  /** 선지별 해설 (choices와 같은 순서) */
  choiceExplanations?: string[];
  /** 챕터 ID (예: "ch_3") */
  chapterId?: string;
}

/** 과목명 매핑 */
export const COURSE_NAMES: Record<string, string> = {
  biology: "생물학",
  pathophysiology: "병태생리학",
  microbiology: "미생물학",
};

/** 매칭 대기 중 사전 생성 캐시 */
export interface PregenCache {
  questions: GeneratedQuestion[];
  createdAt: number;
  chapters: string[];
}

/** 배틀 토끼 스탯 */
export interface BattleRabbit {
  rabbitId: number;
  name?: string;
  discoveryOrder?: number;
  level: number;
  maxHp: number;
  currentHp: number;
  atk: number;
  def: number;
}

/** 배틀 플레이어 정보 (RTDB 저장 형태) */
export interface BattlePlayer {
  nickname: string;
  profileRabbitId: number;
  isBot: boolean;
  rabbits: BattleRabbit[];
  activeRabbitIndex: number;
  connected: boolean;
}

/** 라운드별 결과 (플레이어별) */
export interface RoundPlayerResult {
  isCorrect: boolean;
  answer?: number;
}

/** 라운드 데이터 */
export interface BattleRoundData {
  questionData: {
    text: string;
    type: string;
    choices: string[];
    explanation?: string;
    choiceExplanations?: string[];
    chapterId?: string;
  };
  startedAt: number;
  timeoutAt: number;
  started?: boolean;
  result?: Record<string, RoundPlayerResult>;
  answers?: Record<string, { answer: number }>;
}

/** RTDB 배틀 데이터 */
export interface BattleData {
  status: string;
  courseId: string;
  createdAt: number;
  countdownStartedAt?: number;
  endsAt: number;
  currentRound: number;
  totalRounds: number;
  rounds: Record<string, BattleRoundData>;
  colorAssignment: Record<string, string>;
  players: Record<string, BattlePlayer>;
  mash?: Record<string, unknown> | null;
  result?: {
    xpGranted?: boolean;
    winnerId?: string | null;
    loserId?: string | null;
    isDraw?: boolean;
    endReason?: string;
    xpByPlayer?: Record<string, number>;
  };
}

/** 배틀 생성 시 플레이어 설정 */
export interface PlayerSetup {
  userId: string;
  nickname: string;
  profileRabbitId: number;
  isBot: boolean;
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>;
}

/** 봇 플레이어 설정 (미리 계산된 토끼 스탯 포함) */
export interface BotPlayerSetup extends PlayerSetup {
  isBot: true;
  rabbits: BattleRabbit[];
}
