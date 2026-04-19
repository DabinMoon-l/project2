/**
 * 철권퀴즈 Cloud Functions — 배럴 re-export
 *
 * 실제 구현은 ./tekken/ 모듈로 분리됨.
 * 기존 import 경로 호환을 위해 모든 export를 여기서 재노출.
 */

// 타입 + 상수
export { GeneratedQuestion, COURSE_NAMES } from "./tekken/tekkenTypes";
export type { PlayerSetup, PregenCache } from "./tekken/tekkenTypes";

// 문제 생성
export { getTekkenChapters, generateBattleQuestions } from "./tekken/tekkenQuestions";

// 매칭
export { joinMatchmaking, cancelMatchmaking, matchWithBot } from "./tekken/tekkenMatchmaking";

// 채점
export { submitAnswer, submitTimeout } from "./tekken/tekkenScoring";

// 라운드 + 배틀 종료
export { startBattleRound } from "./tekken/tekkenRound";

// 액션
export { swapRabbit, submitMashResult } from "./tekken/tekkenActions";

// 실시간 배틀 신청 (1:1 다이렉트 초대, 매칭 스킵)
export { sendBattleInvite, respondBattleInvite } from "./tekken/battleInvite";
