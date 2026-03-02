'use client';

/** 완료된 퀴즈 데이터 타입 */
export interface CompletedQuizData {
  id: string;
  title: string;
  type: string;
  questionCount: number;
  participantCount: number;
  tags?: string[];
  creatorNickname?: string;
  attachmentUrl?: string;
  oneLineSummary?: string;
  difficultyImageUrl?: string;
  multipleChoiceCount?: number;
  subjectiveCount?: number;
  oxCount?: number;
  difficulty?: 'easy' | 'normal' | 'hard';
  pastYear?: number;
  pastExamType?: 'midterm' | 'final';
  /** 처음 푼 점수 */
  myScore?: number;
  /** 첫번째 복습 점수 */
  myFirstReviewScore?: number;
  /** AI 생성 퀴즈 여부 */
  isAiGenerated?: boolean;
  /** 평균 점수 */
  averageScore?: number;
}

/** 필터 타입 */
export type ReviewFilter = 'library' | 'wrong' | 'bookmark' | 'custom';

/** 필터 옵션 */
export const FILTER_OPTIONS: { value: ReviewFilter; line1: string; line2?: string }[] = [
  { value: 'library', line1: '서재' },
  { value: 'wrong', line1: '오답' },
  { value: 'bookmark', line1: '찜' },
  { value: 'custom', line1: '커스텀' },
];

/** 난이도별 이미지 */
export const DIFFICULTY_IMAGES: Record<string, string> = {
  easy: '/images/difficulty-easy.png',
  normal: '/images/difficulty-normal.png',
  hard: '/images/difficulty-hard.png',
};

/** 난이도 라벨 */
export const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '쉬움',
  normal: '보통',
  hard: '어려움',
};

/** 명언 목록 (뉴스 스타일 dead space 채우기용) */
export const MOTIVATIONAL_QUOTES = [
  "Success is not final, failure is not fatal.",
  "The secret of getting ahead is getting started.",
  "Believe you can and you're halfway there.",
  "Education is the passport to the future.",
  "The harder you work, the luckier you get.",
  "Knowledge is power, wisdom is freedom.",
  "Every expert was once a beginner.",
  "Dream big, work hard, stay focused.",
];

/** 신문 배경 텍스트 (생물학 관련 영어) */
export const NEWSPAPER_BG_TEXT = `The cell membrane, also known as the plasma membrane, is a biological membrane that separates and protects the interior of all cells from the outside environment. The cell membrane consists of a lipid bilayer, including cholesterols that sit between phospholipids to maintain their fluidity at various temperatures. The membrane also contains membrane proteins, including integral proteins that span the membrane serving as membrane transporters, and peripheral proteins that loosely attach to the outer side of the cell membrane, acting as enzymes to facilitate interaction with the cell's environment. Glycolipids embedded in the outer lipid layer serve a similar purpose. The cell membrane controls the movement of substances in and out of cells and organelles, being selectively permeable to ions and organic molecules. In addition, cell membranes are involved in a variety of cellular processes such as cell adhesion, ion conductivity, and cell signaling.`;

/**
 * 퀴즈 상세 정보 타입
 */
export interface QuizDetails {
  difficulty?: 'easy' | 'normal' | 'hard';
  chapterId?: string;
  creatorNickname?: string;
}
