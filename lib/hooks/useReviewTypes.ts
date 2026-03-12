/**
 * useReview 관련 타입 정의
 */

import { Timestamp } from 'firebase/firestore';
import type { CustomFolder, CustomFolderQuestion, FolderCategory } from './useCustomFolders';

// 커스텀 폴더 타입 재내보내기 (기존 사용처 호환)
export type { CustomFolder, CustomFolderQuestion, FolderCategory };

/**
 * 복습 문제 유형
 * - wrong: 오답
 * - bookmark: 찜한 문제
 * - solved: 푼 문제 (정답/오답 무관)
 */
export type ReviewType = 'wrong' | 'bookmark' | 'solved';

/**
 * 복습 문제 데이터 타입
 */
export interface ReviewItem {
  /** 복습 문제 ID */
  id: string;
  /** 사용자 ID */
  userId: string;
  /** 퀴즈 ID */
  quizId: string;
  /** 퀴즈 제목 */
  quizTitle?: string;
  /** 문제 ID */
  questionId: string;
  /** 문제 내용 */
  question: string;
  /** 문제 유형 */
  type: 'ox' | 'multiple' | 'short' | 'short_answer' | 'subjective' | 'essay' | 'combined' | string;
  /** 객관식 선지 */
  options?: string[];
  /** 정답 */
  correctAnswer: string;
  /** 내가 제출한 답 */
  userAnswer: string;
  /** 해설 */
  explanation?: string;
  /** 서술형 루브릭 */
  rubric?: Array<{ criteria: string; percentage: number; description?: string }>;
  /** 복습 유형 (오답/찜/푼문제) */
  reviewType: ReviewType;
  /** 찜 여부 */
  isBookmarked: boolean;
  /** 정답 여부 (solved 타입에서 사용) */
  isCorrect?: boolean;
  /** 복습 횟수 */
  reviewCount: number;
  /** 마지막 복습 일시 */
  lastReviewedAt: Timestamp | null;
  /** 추가된 일시 */
  createdAt: Timestamp;
  /** 퀴즈 수정 시간 (저장 당시) */
  quizUpdatedAt?: Timestamp | null;
  /** 결합형 그룹 ID */
  combinedGroupId?: string;
  /** 결합형 그룹 내 순서 (1부터 시작) */
  combinedIndex?: number;
  /** 결합형 그룹 내 총 문제 수 */
  combinedTotal?: number;
  /** 결합형 공통 지문 */
  passage?: string;
  /** 결합형 공통 지문 타입 */
  passageType?: 'text' | 'korean_abc' | 'mixed';
  /** 결합형 공통 이미지 */
  passageImage?: string;
  /** 결합형 ㄱㄴㄷ 보기 항목 */
  koreanAbcItems?: string[];
  /** 결합형 공통 지문 혼합 보기 */
  passageMixedExamples?: any[];
  /** 결합형 공통 문제 */
  commonQuestion?: string;
  /** 문제 이미지 */
  image?: string;
  /** 하위 문제 보기 (ㄱㄴㄷ 형식) */
  subQuestionOptions?: string[];
  /** 보기 타입 */
  subQuestionOptionsType?: 'text' | 'labeled' | 'mixed';
  /** 혼합 보기 원본 데이터 */
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
  /** 퀴즈 생성자 ID */
  quizCreatorId?: string;
  /** 퀴즈 타입 (ai-generated, custom 등) */
  quizType?: string;
  /** 챕터 ID */
  chapterId?: string;
  /** 챕터 세부항목 ID */
  chapterDetailId?: string;
  /** 선지별 해설 (AI 생성 문제용) */
  choiceExplanations?: string[];
  /** 크롭된 이미지 URL (AI 생성 문제용 - HARD 난이도) */
  imageUrl?: string;
  /** 제시문 발문 */
  passagePrompt?: string;
  /** 보기 발문 (보기 박스 위에 표시되는 질문) */
  bogiQuestionText?: string;
  /** 보기 (<보기> 박스 데이터) */
  bogi?: {
    questionText?: string;
    items: Array<{ label: string; content: string }>;
  } | null;
}

/**
 * 퀴즈별로 그룹핑된 복습 문제
 */
export interface GroupedReviewItems {
  quizId: string;
  quizTitle: string;
  items: ReviewItem[];
  /** 실제 문제 수 (결합형 문제는 1개로 계산) */
  questionCount: number;
  /** 퀴즈가 수정되었는지 여부 */
  hasUpdate?: boolean;
}

/**
 * 챕터별로 그룹핑된 오답 (챕터 → 문제지 구조)
 */
export interface ChapterGroupedWrongItems {
  /** 챕터 ID (null이면 미분류) */
  chapterId: string | null;
  /** 챕터 이름 */
  chapterName: string;
  /** 해당 챕터의 문제지별 폴더 */
  folders: GroupedReviewItems[];
  /** 총 문제 수 */
  totalCount: number;
}

/**
 * 퀴즈 풀이 기록 (푼 문제)
 */
export interface QuizAttempt {
  /** 결과 ID */
  id: string;
  /** 퀴즈 ID */
  quizId: string;
  /** 퀴즈 제목 */
  quizTitle: string;
  /** 맞은 개수 */
  correctCount: number;
  /** 전체 문제 수 */
  totalCount: number;
  /** 획득 골드 */
  earnedGold: number;
  /** 획득 경험치 */
  earnedExp: number;
  /** 소요 시간 (초) */
  timeSpentSeconds: number;
  /** 완료 일시 */
  completedAt: Timestamp;
}

/**
 * 퀴즈 업데이트 정보
 */
export interface QuizUpdateInfo {
  quizId: string;
  quizTitle: string;
  hasUpdate: boolean;
}

/**
 * 비공개 퀴즈 (내가 만든 비공개 퀴즈)
 */
export interface PrivateQuiz {
  /** 퀴즈 ID */
  id: string;
  /** 퀴즈 제목 */
  title: string;
  /** 문제 수 */
  questionCount: number;
  /** 생성 일시 */
  createdAt: Timestamp;
}

/**
 * 삭제된 항목 (휴지통)
 */
export interface DeletedItem {
  /** 삭제 항목 ID */
  id: string;
  /** 사용자 ID */
  userId: string;
  /** 과목 ID */
  courseId: string | null;
  /** 삭제 유형: solved(푼 문제), wrong(오답), bookmark(찜한 퀴즈), custom(내맘대로 폴더) */
  type: 'solved' | 'wrong' | 'bookmark' | 'custom';
  /** 원본 ID (퀴즈 ID 또는 폴더 ID) */
  originalId: string;
  /** 제목 */
  title: string;
  /** 문제 수 */
  questionCount: number;
  /** 삭제 일시 */
  deletedAt: Timestamp;
  /** 복원에 필요한 데이터 */
  restoreData?: any;
}

/**
 * useReview 훅 반환 타입
 */
export interface UseReviewReturn {
  /** 오답 문제 목록 */
  wrongItems: ReviewItem[];
  /** 찜한 문제 목록 */
  bookmarkedItems: ReviewItem[];
  /** 푼 문제 목록 */
  solvedItems: ReviewItem[];
  /** 푼 문제 추가 로드 가능 여부 */
  hasMoreSolved: boolean;
  /** 푼 문제 추가 로드 */
  loadMoreSolved: () => Promise<void>;
  /** 오답 추가 로드 가능 여부 */
  hasMoreWrong: boolean;
  /** 오답 추가 로드 */
  loadMoreWrong: () => Promise<void>;
  /** 찜한 문제 추가 로드 가능 여부 */
  hasMoreBookmark: boolean;
  /** 찜한 문제 추가 로드 */
  loadMoreBookmark: () => Promise<void>;
  /** 퀴즈별 그룹핑된 오답 */
  groupedWrongItems: GroupedReviewItems[];
  /** 챕터별로 그룹핑된 오답 (챕터 → 문제지 구조) */
  chapterGroupedWrongItems: ChapterGroupedWrongItems[];
  /** 퀴즈별 그룹핑된 찜한 문제 */
  groupedBookmarkedItems: GroupedReviewItems[];
  /** 퀴즈별 그룹핑된 푼 문제 */
  groupedSolvedItems: GroupedReviewItems[];
  /** 퀴즈 풀이 기록 (푼 문제) */
  quizAttempts: QuizAttempt[];
  /** 커스텀 폴더 목록 */
  customFolders: CustomFolder[];
  /** 업데이트된 퀴즈 목록 */
  updatedQuizzes: Map<string, QuizUpdateInfo>;
  /** 로딩 상태 */
  loading: boolean;
  /** 에러 메시지 */
  error: string | null;
  /** 문제 삭제 */
  deleteReviewItem: (reviewId: string) => Promise<void>;
  /** 푼 문제(폴더) 삭제 - 퀴즈 목록에 다시 표시 */
  deleteSolvedQuiz: (quizId: string) => Promise<void>;
  /** 오답 폴더 삭제 (해당 퀴즈의 오답만 삭제) */
  deleteWrongQuiz: (quizId: string) => Promise<void>;
  /** 오답 폴더 삭제 (챕터별) */
  deleteWrongQuizByChapter: (quizId: string, chapterId: string | null, chapterName?: string) => Promise<void>;
  /** 찜한 문제 폴더 삭제 (해당 퀴즈의 찜한 문제만 삭제) */
  deleteBookmarkQuiz: (quizId: string) => Promise<void>;
  /** 복습 완료 처리 */
  markAsReviewed: (reviewId: string) => Promise<void>;
  /** 커스텀 폴더 생성 */
  createCustomFolder: (name: string) => Promise<string | null>;
  /** 커스텀 폴더 삭제 */
  deleteCustomFolder: (folderId: string) => Promise<void>;
  /** 문제를 커스텀 폴더에 추가 */
  addToCustomFolder: (folderId: string, questions: { questionId: string; quizId: string; quizTitle: string; combinedGroupId?: string | null }[]) => Promise<void>;
  /** 커스텀 폴더에서 문제 제거 */
  removeFromCustomFolder: (folderId: string, questionId: string) => Promise<void>;
  /** 퀴즈 업데이트 확인 후 review 항목 업데이트 */
  updateReviewItemsFromQuiz: (quizId: string) => Promise<void>;
  /** 비공개 퀴즈 목록 */
  privateQuizzes: PrivateQuiz[];
  /** 문제 찜 토글 */
  toggleQuestionBookmark: (item: ReviewItem) => Promise<void>;
  /** 데이터 새로고침 */
  refresh: () => void;
  /** 커스텀 폴더에 카테고리 추가 */
  addCategoryToFolder: (folderId: string, categoryName: string) => Promise<string | null>;
  /** 커스텀 폴더에서 카테고리 삭제 */
  removeCategoryFromFolder: (folderId: string, categoryId: string) => Promise<void>;
  /** 문제를 카테고리에 배정 */
  assignQuestionToCategory: (folderId: string, questionId: string, categoryId: string | null) => Promise<void>;
  /** 카테고리 이름 수정 */
  updateCategoryName: (folderId: string, categoryId: string, newName: string) => Promise<void>;
  /** 삭제된 항목 목록 (휴지통) */
  deletedItems: DeletedItem[];
  /** 삭제된 항목 복원 */
  restoreDeletedItem: (deletedItemId: string) => Promise<void>;
  /** 삭제된 항목 영구 삭제 */
  permanentlyDeleteItem: (deletedItemId: string) => Promise<void>;
}
