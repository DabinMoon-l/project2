/**
 * 철권퀴즈 공유 타입 + 상수
 */

/** Gemini로 생성된 배틀 문제 */
export interface GeneratedQuestion {
  text: string;
  type: "multiple";
  choices: string[];
  correctAnswer: number;
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
