/**
 * ReviewPractice 관련 타입 정의
 */

import type { ReviewItem } from '@/lib/hooks/useReview';

export interface ReviewPracticeProps {
  /** 복습할 문제 목록 */
  items: ReviewItem[];
  /** 퀴즈 제목 (선택) */
  quizTitle?: string;
  /** 완료 핸들러 */
  onComplete: (results: PracticeResult[]) => void;
  /** 닫기 핸들러 */
  onClose: () => void;
  /** 현재 사용자 ID (본인 문제 피드백 방지용) */
  currentUserId?: string;
  /** 헤더 타이틀 커스터마이징 (기본값: "복습") */
  headerTitle?: string;
  /** 피드백 기능 표시 여부 (기본값: true) */
  showFeedback?: boolean;
}

/**
 * 연습 결과 타입
 */
export interface PracticeResult {
  /** 복습 문제 ID */
  reviewId: string;
  /** 퀴즈 ID */
  quizId: string;
  /** 문제 ID (통계 반영용) */
  questionId: string;
  /** 사용자 답변 */
  userAnswer: string;
  /** 정답 여부 */
  isCorrect: boolean;
}

/** 답안 타입 */
export type AnswerType = string | number | number[] | null;

/** 화면 단계 */
export type Phase = 'practice' | 'result' | 'feedback';

/** ㄱㄴㄷ 라벨 */
export const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'];

/** 문제 유형 라벨 */
export const TYPE_LABELS: Record<string, string> = {
  ox: 'OX',
  multiple: '객관식',
  short: '주관식',
  short_answer: '주관식',
  subjective: '주관식',
};

/** 그룹화된 아이템 (결합형 문제 처리) */
export interface GroupedItem {
  isCombined: boolean;
  items: ReviewItem[];
  groupId?: string;
}

/** 챕터별 그룹 */
export interface ChapterGroup {
  chapterId: string | null;
  chapterName: string;
  items: ReviewItem[];
}

import type { CustomFolder } from '@/lib/hooks/useReview';
import type { FeedbackType } from '@/components/review/types';

/** 결과 화면 props */
export interface ResultStageProps {
  // 데이터
  groupedItems: GroupedItem[];
  resultsMap: Record<number, PracticeResult>;
  combinedResultsMap: Record<number, Record<number, PracticeResult>>;
  correctCount: number;
  totalQuestionCount: number;
  headerTitle: string;
  showFeedback: boolean;
  userCourseId: string | null;
  currentUserId?: string;

  // expand 상태
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
  expandedSubIds: Set<string>;
  toggleSubExpand: (id: string) => void;
  expandedChoiceExplanations: Set<string>;
  setExpandedChoiceExplanations: React.Dispatch<React.SetStateAction<Set<string>>>;

  // 피드백 바텀시트
  submittedFeedbackIds: Set<string>;
  openFeedbackSheet: (item: ReviewItem) => void;
  feedbackTargetItem: ReviewItem | null;
  closeFeedbackSheet: () => void;
  selectedFeedbackTypes: Set<FeedbackType>;
  toggleFeedbackType: (type: FeedbackType) => void;
  feedbackContent: string;
  setFeedbackContent: (value: string) => void;
  isFeedbackSubmitting: boolean;
  isFeedbackDone: boolean;
  handleFeedbackSubmit: () => void;

  // 액션
  onGoToFeedback: () => void;
  onBackToPractice: () => void;
}

/** 피드백(완료) 화면 props */
export interface FeedbackStageProps {
  // 데이터
  wrongItems: ReviewItem[];
  correctCount: number;
  totalQuestionCount: number;
  headerTitle: string;
  chapterGroupedWrongItems: ChapterGroup[];
  totalDisplayExp: number;

  // 폴더 저장 관련
  customFolders: CustomFolder[];
  selectedFolderId: string | null;
  setSelectedFolderId: (id: string | null) => void;
  newFolderName: string;
  setNewFolderName: (name: string) => void;
  isCreatingFolder: boolean;
  handleCreateFolder: () => void;
  isSaving: boolean;
  handleSaveToFolder: () => void;
  saveSuccess: boolean;

  // 액션
  onBackToResult: () => void;
  onFinish: () => void;
  /** 완료 처리 중 (중복 클릭 방지) */
  isFinishing?: boolean;
}

/** 문제 풀이 화면 props */
export interface PracticeStageProps {
  // 데이터
  groupedItems: GroupedItem[];
  currentIndex: number;
  totalCount: number;
  currentGroup: GroupedItem | undefined;
  currentItem: ReviewItem | null;
  progress: number;
  headerTitle: string;
  quizTitle?: string;
  userCourseId: string | null;
  typeLabels: Record<string, string>;

  // 답안 상태
  answers: Record<number, AnswerType>;
  combinedAnswers: Record<number, Record<number, AnswerType>>;
  answer: AnswerType;
  isSubmitted: boolean;
  isCorrect: boolean;
  isLastQuestion: boolean;
  resultsMap: Record<number, PracticeResult>;
  combinedResultsMap: Record<number, Record<number, PracticeResult>>;

  // 답안 설정
  setAnswer: (value: AnswerType) => void;
  setCombinedAnswer: (subIndex: number, value: AnswerType) => void;

  // 복수정답 여부
  isMultipleAnswerQuestion: () => boolean;

  // 액션
  handleSubmit: () => void;
  handleNext: () => void;
  handlePrev: () => void;
  onClose: () => void;

  // 선지별 해설 펼침
  expandedChoiceExplanations: Set<string>;
  setExpandedChoiceExplanations: React.Dispatch<React.SetStateAction<Set<string>>>;

  // 인라인 피드백
  inlineFeedbackOpen: string | null;
  setInlineFeedbackOpen: React.Dispatch<React.SetStateAction<string | null>>;
  submittedFeedbackIds: Set<string>;
  setSubmittedFeedbackIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  feedbackSubmitCount: number;
  setFeedbackSubmitCount: React.Dispatch<React.SetStateAction<number>>;
  user: { uid: string } | null;
}
