/**
 * 퀴즈 미리보기 페이지 타입 정의
 */

/**
 * 혼합 지문 블록 내 라벨 항목
 */
export interface PreviewLabeledItem {
  id: string;
  label: string;
  content: string;
}

/**
 * 혼합 지문 블록 내 자식 블록 (grouped 안의 블록)
 */
export interface PreviewMixedChild {
  id: string;
  type: 'text' | 'labeled' | 'gana' | 'image';
  label?: string;
  content?: string;
  items?: PreviewLabeledItem[];
  imageUrl?: string;
}

/**
 * 혼합 지문 블록 (text/labeled/gana/image/grouped)
 */
export interface PreviewMixedBlock {
  id: string;
  type: 'text' | 'labeled' | 'gana' | 'image' | 'grouped';
  label?: string;
  content?: string;
  items?: PreviewLabeledItem[];
  imageUrl?: string;
  children?: PreviewMixedChild[];
}

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
  passageMixedExamples?: PreviewMixedBlock[];
  commonQuestion?: string;
  /** 문제 이미지 */
  image?: string;
  subQuestionOptions?: string[];
  subQuestionOptionsType?: 'text' | 'labeled' | 'mixed';
  mixedExamples?: PreviewMixedBlock[];
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
