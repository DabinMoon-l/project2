/**
 * QuizStatsModal 관련 타입 정의
 */

import type { Timestamp } from '@/lib/repositories';

export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QuizStatsModalProps {
  quizId: string;
  quizTitle: string;
  isOpen: boolean;
  onClose: () => void;
  isProfessor?: boolean;
  sourceRect?: SourceRect | null;
}

export interface LabeledItem {
  label: string;
  content: string;
}

export interface BogiData {
  questionText: string;
  items: LabeledItem[];
}

export interface MixedExampleItem {
  id: string;
  type: 'text' | 'labeled' | 'gana' | 'bullet' | 'image' | 'grouped';
  label?: string;
  content?: string;
  items?: LabeledItem[];
  imageUrl?: string;
  children?: MixedExampleItem[];
}

export interface FlattenedQuestion {
  id: string;
  text: string;
  type: 'ox' | 'multiple' | 'short_answer' | 'short' | 'essay';
  choices?: string[];
  answer?: string;
  chapterId?: string;
  chapterDetailId?: string;
  // 이미지
  imageUrl?: string;
  // 제시문 관련
  mixedExamples?: MixedExampleItem[];
  passagePrompt?: string;
  // 보기 관련
  bogi?: BogiData | null;
  // 결합형 그룹 정보
  combinedGroupId?: string;
  combinedIndex?: number;
  combinedTotal?: number;
  // 공통 지문 정보 (첫 번째 하위 문제에만)
  passage?: string;
  passageType?: string;
  passageImage?: string;
  koreanAbcItems?: string[];
  // 해설
  explanation?: string;
  choiceExplanations?: string[];
  // 문제 수정 시간 (수정된 문제만)
  questionUpdatedAt?: number;
}

export interface QuestionStats {
  questionId: string;
  questionIndex: number;
  questionText: string;
  questionType: string;
  correctRate: number;
  wrongRate: number;
  discrimination: number;
  totalAttempts: number;
  correctCount: number;
  correctAnswer?: string;
  choices?: string[];
  chapterId?: string;
  chapterDetailId?: string;
  // 이미지
  imageUrl?: string;
  // 제시문 관련
  mixedExamples?: MixedExampleItem[];
  passagePrompt?: string;
  // 보기 정보
  bogi?: BogiData | null;
  // 결합형 공통 지문
  passage?: string;
  passageType?: string;
  passageImage?: string;
  koreanAbcItems?: string[];
  // 해설
  explanation?: string;
  choiceExplanations?: string[];
  // OX 선택 분포
  oxDistribution?: { o: number; x: number };
  // 객관식 선지별 선택 분포
  optionDistribution?: { option: string; count: number; isCorrect: boolean; percentage: number }[];
  // 주관식 오답 목록
  wrongAnswers?: { answer: string; count: number }[];
  // 서술형 답변 목록
  essayAnswers?: { answer: string; userId: string }[];
}

export interface QuizStats {
  participantCount: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  stdDev: number;
  questionStats: QuestionStats[];
  courseId?: string;
}

export interface ResultWithClass {
  userId: string;
  classType: 'A' | 'B' | 'C' | 'D' | null;
  score: number;
  questionScores: Record<string, { isCorrect: boolean; userAnswer: string; answeredAt?: Timestamp }>;
  createdAt?: Timestamp;
}

export type ClassFilter = 'all' | 'A' | 'B' | 'C' | 'D';

export const CLASS_FILTERS: { value: ClassFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'A', label: 'A반' },
  { value: 'B', label: 'B반' },
  { value: 'C', label: 'C반' },
  { value: 'D', label: 'D반' },
];
