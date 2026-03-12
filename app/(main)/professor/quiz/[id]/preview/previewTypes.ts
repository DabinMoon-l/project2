/**
 * 퀴즈 미리보기 페이지 타입 정의
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PreviewQuestion {
  id: string;
  number: number;
  question: string;
  type: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  /** 결합형 그룹 ID */
  combinedGroupId?: string;
  combinedIndex?: number;
  combinedTotal?: number;
  /** 결합형 공통 지문 (첫 번째 문제에만) */
  passage?: string;
  passageType?: string;
  passageImage?: string;
  koreanAbcItems?: string[];
  passageMixedExamples?: any[];
  commonQuestion?: string;
  /** 문제 이미지 */
  image?: string;
  subQuestionOptions?: string[];
  subQuestionOptionsType?: 'text' | 'labeled' | 'mixed';
  mixedExamples?: any[];
  subQuestionImage?: string;
  chapterId?: string;
  chapterDetailId?: string;
  passagePrompt?: string;
  bogiQuestionText?: string;
  bogi?: {
    questionText?: string;
    items: Array<{ label: string; content: string }>;
  } | null;
  choiceExplanations?: string[];
}

export interface DisplayItem {
  type: 'single' | 'combined_group';
  result?: PreviewQuestion;
  results?: PreviewQuestion[];
  combinedGroupId?: string;
  displayNumber: number;
}
