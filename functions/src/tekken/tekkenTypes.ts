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

/** 배틀 생성 시 플레이어 설정 */
export interface PlayerSetup {
  userId: string;
  nickname: string;
  profileRabbitId: number;
  isBot: boolean;
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>;
}
