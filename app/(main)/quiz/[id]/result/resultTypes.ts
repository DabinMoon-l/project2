/**
 * 퀴즈 결과 페이지 타입 정의
 */

/**
 * 문제 결과 타입
 */
export interface QuestionResult {
  id: string;
  number: number;
  question: string;
  type: string;
  options?: string[];
  correctAnswer: string;
  userAnswer: string;
  isCorrect: boolean;
  explanation: string;
  /** 서술형 루브릭 */
  rubric?: Array<{ criteria: string; percentage: number; description?: string }>;
  isBookmarked: boolean;
  /** 결합형 그룹 ID */
  combinedGroupId?: string;
  /** 결합형 그룹 내 순서 */
  combinedIndex?: number;
  /** 결합형 그룹 내 총 문제 수 */
  combinedTotal?: number;
  /** 결합형 공통 지문 (첫 번째 문제에만) */
  passage?: string;
  /** 결합형 공통 지문 타입 */
  passageType?: string;
  /** 결합형 공통 이미지 */
  passageImage?: string;
  /** 결합형 ㄱㄴㄷ 보기 항목 */
  koreanAbcItems?: string[];
  /** 결합형 공통 지문 혼합 보기 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  passageMixedExamples?: any[];
  /** 결합형 공통 문제 */
  commonQuestion?: string;
  /** 문제 이미지 */
  image?: string;
  /** 하위 문제 보기 (ㄱㄴㄷ 형식) */
  subQuestionOptions?: string[];
  /** 보기 타입 */
  subQuestionOptionsType?: 'text' | 'labeled' | 'mixed';
  /** 혼합 보기 원본 데이터 (렌더링용) */
  mixedExamples?: Array<{
    id: string;
    type: 'text' | 'labeled' | 'gana' | 'image' | 'grouped';
    label?: string;
    content?: string;
    items?: Array<{ id: string; label: string; content: string }>;
    imageUrl?: string;
    children?: Array<{
      id: string;
      type: 'text' | 'labeled' | 'gana' | 'image';
      label?: string;
      content?: string;
      items?: Array<{ id: string; label: string; content: string }>;
      imageUrl?: string;
    }>;
  }>;
  /** 하위 문제 이미지 */
  subQuestionImage?: string;
  /** 챕터 ID */
  chapterId?: string;
  /** 챕터 세부항목 ID */
  chapterDetailId?: string;
  /** 제시문 발문 */
  passagePrompt?: string;
  /** 보기 발문 (보기 박스 위에 표시되는 질문) */
  bogiQuestionText?: string;
  /** 보기 (<보기> 박스 데이터) */
  bogi?: {
    questionText?: string;
    items: Array<{ label: string; content: string }>;
  } | null;
  /** 선지별 해설 (AI 생성 문제용) */
  choiceExplanations?: string[];
}

/**
 * 결과 화면에 표시될 아이템 (단일 문제 또는 결합형 그룹)
 */
export interface ResultDisplayItem {
  type: 'single' | 'combined_group';
  /** 단일 문제 (type === 'single'일 때) */
  result?: QuestionResult;
  /** 결합형 그룹 문제들 (type === 'combined_group'일 때) */
  results?: QuestionResult[];
  /** 결합형 그룹 ID */
  combinedGroupId?: string;
  /** 화면에 표시될 번호 */
  displayNumber: number;
}

/**
 * 퀴즈 결과 데이터 타입
 */
export interface QuizResultData {
  quizId: string;
  quizTitle: string;
  quizCreatorId?: string; // 퀴즈 제작자 ID
  quizType?: string; // 퀴즈 타입 (ai-generated, custom 등)
  correctCount: number;
  totalCount: number;
  earnedExp: number;
  questionResults: QuestionResult[];
  quizUpdatedAt?: any; // 퀴즈 수정 시간 (알림용)
}
