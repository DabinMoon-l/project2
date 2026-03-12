/**
 * 퀴즈 피드백 페이지 타입 정의
 */

/**
 * 피드백 타입
 */
export type FeedbackType = 'unclear' | 'wrong' | 'typo' | 'other' | 'praise' | 'wantmore';

/**
 * 피드백 타입 옵션
 */
export const FEEDBACK_TYPE_OPTIONS: { type: FeedbackType; label: string; positive?: boolean }[] = [
  { type: 'praise', label: '문제가 좋아요!', positive: true },
  { type: 'wantmore', label: '더 풀고 싶어요', positive: true },
  { type: 'unclear', label: '문제가 이해가 안 돼요' },
  { type: 'wrong', label: '정답이 틀린 것 같아요' },
  { type: 'typo', label: '오타가 있어요' },
  { type: 'other', label: '기타 의견' },
];

/**
 * 문제 결과 타입
 */
export interface QuestionResult {
  id: string;
  number: number;
  question: string;
  type: 'ox' | 'multiple' | 'short' | 'essay' | 'combined';
  options?: string[];
  correctAnswer: string;
  userAnswer: string;
  isCorrect: boolean;
  explanation?: string;
  /** 서술형 루브릭 */
  rubric?: Array<{ criteria: string; percentage: number; description?: string }>;
  // 결합형 문제 관련
  combinedGroupId?: string;
  subQuestionIndex?: number;
  // 문제 이미지
  image?: string;
  // 하위 문제 지문 (ㄱㄴㄷ 형식 등)
  subQuestionOptions?: string[];
  subQuestionOptionsType?: 'text' | 'labeled' | 'mixed';
  // 혼합 지문 원본 데이터
  mixedExamples?: Array<{
    id: string;
    type: 'text' | 'labeled' | 'image' | 'grouped';
    label?: string;
    content?: string;
    items?: Array<{ id: string; label: string; content: string }>;
    imageUrl?: string;
    children?: Array<{
      id: string;
      type: 'text' | 'labeled' | 'image';
      label?: string;
      content?: string;
      items?: Array<{ id: string; label: string; content: string }>;
      imageUrl?: string;
    }>;
  }>;
  // 발문 정보
  passagePrompt?: string;
  bogiQuestionText?: string;
  // 보기 (<보기> 박스 데이터)
  bogi?: {
    questionText?: string;
    items: Array<{ label: string; content: string }>;
  } | null;
}

/**
 * 결합형 문제 그룹 타입
 */
export interface CombinedGroup {
  groupId: string;
  groupNumber: number;
  commonQuestion?: string;
  passage?: string;
  passageType?: string;
  passageImage?: string;
  koreanAbcItems?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  passageMixedExamples?: any[];
  subQuestions: QuestionResult[];
}

/**
 * 페이지 아이템 타입 (일반 문제 또는 결합형 그룹)
 */
export type PageItem =
  | { type: 'single'; question: QuestionResult }
  | { type: 'combined'; group: CombinedGroup };

/**
 * 피드백 페이지 데이터 타입
 */
export interface FeedbackPageData {
  quizId: string;
  quizTitle: string;
  quizCreatorId: string;
  questionResults: QuestionResult[];
  pageItems: PageItem[]; // 페이지 단위 아이템 (일반 문제 또는 결합형 그룹)
  isQuizDeleted?: boolean; // 퀴즈 삭제 여부
}

/**
 * 스와이프 방향 감지 임계값
 */
export const SWIPE_THRESHOLD = 50;

/**
 * 일반 문제 카드 props
 */
export interface SingleQuestionCardProps {
  question: QuestionResult;
  feedbackTypes: Record<string, FeedbackType | null>;
  feedbacks: Record<string, string>;
  onFeedbackTypeChange: (questionId: string, type: FeedbackType) => void;
  onFeedbackChange: (questionId: string, value: string) => void;
}
