/**
 * 복습 관련 커스텀 훅
 *
 * useReview: 오답/찜한 문제 목록 가져오기, 삭제, 복습 완료 처리
 * 퀴즈 풀이 기록, 커스텀 폴더 관리 포함
 */

'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  deleteDoc,
  updateDoc,
  addDoc,
  setDoc,
  increment,
  limit,
  startAfter,
  serverTimestamp,
  Timestamp,
  getDoc,
  getDocs,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import { useCourse } from '../contexts/CourseContext';
import { getChapterById } from '../courseIndex';

// ============================================================
// 타입 정의
// ============================================================

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
 * ReviewItem 배열에서 실제 문제 수 계산 (결합형 문제는 1개로 계산)
 */
function calculateActualQuestionCount(items: ReviewItem[]): number {
  const seenCombinedGroups = new Set<string>();
  let count = 0;

  for (const item of items) {
    if (item.combinedGroupId) {
      // 결합형 문제: 그룹당 1개로 계산
      if (!seenCombinedGroups.has(item.combinedGroupId)) {
        seenCombinedGroups.add(item.combinedGroupId);
        count++;
      }
    } else {
      // 비결합형 문제: 각각 1개
      count++;
    }
  }

  return count;
}

/**
 * CustomFolderQuestion 배열에서 실제 문제 수 계산 (결합형 문제는 1개로 계산)
 */
export function calculateCustomFolderQuestionCount(
  questions: { combinedGroupId?: string | null }[]
): number {
  const seenCombinedGroups = new Set<string>();
  let count = 0;

  for (const q of questions) {
    if (q.combinedGroupId) {
      // 결합형 문제: 그룹당 1개로 계산
      if (!seenCombinedGroups.has(q.combinedGroupId)) {
        seenCombinedGroups.add(q.combinedGroupId);
        count++;
      }
    } else {
      // 비결합형 문제: 각각 1개
      count++;
    }
  }

  return count;
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
 * 커스텀 폴더 카테고리
 */
export interface FolderCategory {
  /** 카테고리 ID */
  id: string;
  /** 카테고리 이름 */
  name: string;
}

/**
 * 커스텀 폴더 문제 항목
 */
export interface CustomFolderQuestion {
  questionId: string;
  quizId: string;
  quizTitle: string;
  /** 배정된 카테고리 ID (없으면 미분류) */
  categoryId?: string;
  /** 결합형 그룹 ID (결합형 문제의 경우) */
  combinedGroupId?: string | null;
}

/**
 * 커스텀 폴더
 */
export interface CustomFolder {
  /** 폴더 ID */
  id: string;
  /** 폴더 이름 */
  name: string;
  /** 생성 일시 */
  createdAt: Timestamp;
  /** 문제 목록 */
  questions: CustomFolderQuestion[];
  /** 카테고리 목록 */
  categories?: FolderCategory[];
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
 * useReview 훅의 반환 타입
 */
interface UseReviewReturn {
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

// ============================================================
// 유틸리티 함수
// ============================================================

/**
 * questionId에서 주문제 번호와 하위문제 번호를 추출
 * 예: "q0" → [0, 0], "q1" → [1, 0], "q1-1" → [1, 1], "q1-2" → [1, 2]
 */
function parseQuestionId(questionId: string): [number, number] {
  if (!questionId) return [0, 0];

  // 형식: "q{main}" 또는 "q{main}-{sub}" 또는 "q{main}_{sub}"
  const match = questionId.match(/q?(\d+)(?:[-_](\d+))?/i);
  if (match) {
    const main = parseInt(match[1], 10);
    const sub = match[2] ? parseInt(match[2], 10) : 0;
    return [main, sub];
  }

  // 숫자만 있는 경우
  const numMatch = questionId.match(/(\d+)/);
  return numMatch ? [parseInt(numMatch[1], 10), 0] : [0, 0];
}

/**
 * 문제를 questionId 기준으로 정렬하는 비교 함수
 * 결합형 문제 ID (q1-1, q1-2) 를 올바르게 처리
 */
function compareQuestionIds(a: ReviewItem, b: ReviewItem): number {
  const [aMain, aSub] = parseQuestionId(a.questionId);
  const [bMain, bSub] = parseQuestionId(b.questionId);

  // 주문제 번호로 먼저 정렬
  if (aMain !== bMain) {
    return aMain - bMain;
  }
  // 같은 주문제면 하위문제 번호로 정렬
  return aSub - bSub;
}

/**
 * 복습 문제를 퀴즈별로 그룹핑
 */
function groupByQuiz(items: ReviewItem[]): GroupedReviewItems[] {
  const grouped = new Map<string, GroupedReviewItems>();

  items.forEach((item) => {
    const existing = grouped.get(item.quizId);
    if (existing) {
      existing.items.push(item);
    } else {
      grouped.set(item.quizId, {
        quizId: item.quizId,
        quizTitle: item.quizTitle || '퀴즈',
        items: [item],
        questionCount: 0, // 나중에 계산
      });
    }
  });

  // 각 그룹 내 문제를 questionId 기준으로 정렬 (결합형 문제 순서 유지)
  // 그리고 실제 문제 수 계산 (결합형은 1개로 계산)
  for (const group of grouped.values()) {
    group.items.sort(compareQuestionIds);
    group.questionCount = calculateActualQuestionCount(group.items);
  }

  // 그룹은 최신 추가 순으로 정렬
  return Array.from(grouped.values()).sort((a, b) => {
    const aTime = a.items[0]?.createdAt?.toMillis() || 0;
    const bTime = b.items[0]?.createdAt?.toMillis() || 0;
    return bTime - aTime;
  });
}

/**
 * 오답 문제를 챕터별로 그룹핑 (챕터 → 문제지 구조)
 * 1차: chapterId로 카테고리 생성
 * 2차: 각 카테고리 내에서 quizId로 폴더 생성
 */
function groupByChapterAndQuiz(items: ReviewItem[], courseId?: string): ChapterGroupedWrongItems[] {
  // 1차: chapterId로 그룹핑
  const chapterMap = new Map<string | null, ReviewItem[]>();

  items.forEach(item => {
    const chapterId = item.chapterId || null;
    const existing = chapterMap.get(chapterId);
    if (existing) {
      existing.push(item);
    } else {
      chapterMap.set(chapterId, [item]);
    }
  });

  // 2차: 각 챕터 내에서 quizId로 그룹핑
  const result: ChapterGroupedWrongItems[] = [];

  chapterMap.forEach((chapterItems, chapterId) => {
    // 챕터 내 문제를 퀴즈별로 그룹핑
    const folders = groupByQuiz(chapterItems);
    // 결합형 문제를 1문제로 계산한 총 문제 수
    const totalCount = folders.reduce((sum, f) => sum + f.questionCount, 0);

    // 챕터 이름 가져오기
    let chapterName = '미분류';
    if (chapterId && courseId) {
      const chapter = getChapterById(courseId, chapterId);
      if (chapter) {
        chapterName = chapter.name;
      }
    }

    result.push({
      chapterId,
      chapterName,
      folders,
      totalCount,
    });
  });

  // 챕터 순서대로 정렬 (미분류는 마지막)
  return result.sort((a, b) => {
    if (!a.chapterId) return 1;  // 미분류는 마지막
    if (!b.chapterId) return -1;
    return a.chapterId.localeCompare(b.chapterId);
  });
}

// ============================================================
// useReview 훅
// ============================================================

/**
 * 복습 문제(오답/찜)를 관리하는 커스텀 훅
 *
 * Firestore의 reviews 컬렉션을 실시간으로 구독하고,
 * 문제 삭제, 복습 완료 처리 기능을 제공합니다.
 *
 * @example
 * ```tsx
 * const {
 *   wrongItems,
 *   bookmarkedItems,
 *   groupedWrongItems,
 *   loading,
 *   deleteReviewItem,
 *   markAsReviewed
 * } = useReview();
 *
 * if (loading) return <LoadingSpinner />;
 *
 * return (
 *   <ReviewList
 *     items={groupedWrongItems}
 *     onDelete={deleteReviewItem}
 *   />
 * );
 * ```
 */
export const useReview = (): UseReviewReturn => {
  // 상태 관리
  const { user } = useAuth();
  const { userCourseId } = useCourse();
  const [wrongItems, setWrongItems] = useState<ReviewItem[]>([]);
  const [bookmarkedItems, setBookmarkedItems] = useState<ReviewItem[]>([]);
  const [solvedItems, setSolvedItems] = useState<ReviewItem[]>([]);
  const [hasMoreSolved, setHasMoreSolved] = useState(false);
  const [hasMoreWrong, setHasMoreWrong] = useState(false);
  const [hasMoreBookmark, setHasMoreBookmark] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const solvedLastDocRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrongLastDocRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bookmarkLastDocRef = useRef<any>(null);
  const solvedQueryBaseRef = useRef<ReturnType<typeof query> | null>(null);
  const wrongQueryBaseRef = useRef<ReturnType<typeof query> | null>(null);
  const bookmarkQueryBaseRef = useRef<ReturnType<typeof query> | null>(null);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>([]);
  const [customFolders, setCustomFolders] = useState<CustomFolder[]>([]);
  const [privateQuizzes, setPrivateQuizzes] = useState<PrivateQuiz[]>([]);
  const [deletedItems, setDeletedItems] = useState<DeletedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // 퀴즈 제목 캐시 (ref로 관리하여 useEffect 재실행 방지)
  const quizTitlesCacheRef = useRef<Record<string, string>>({});

  // 퀴즈 업데이트 정보
  const [updatedQuizzes, setUpdatedQuizzes] = useState<Map<string, QuizUpdateInfo>>(new Map());

  /**
   * 퀴즈 제목 가져오기 (ref 캐시 사용, 상태 변경 없음)
   */
  const fetchQuizTitle = useCallback(async (quizId: string): Promise<string> => {
    // 캐시 확인
    if (quizTitlesCacheRef.current[quizId]) {
      return quizTitlesCacheRef.current[quizId];
    }

    try {
      const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
      if (quizDoc.exists()) {
        const title = quizDoc.data()?.title || '퀴즈';
        quizTitlesCacheRef.current[quizId] = title;
        return title;
      }
    } catch (err) {
      console.error('퀴즈 제목 로드 실패:', err);
    }

    return '퀴즈';
  }, []);


  // 스냅샷 문서를 ReviewItem으로 변환하는 헬퍼
  const mapDocToReviewItem = useCallback((docSnapshot: any): ReviewItem => {
    const data = docSnapshot.data();
    return {
      id: docSnapshot.id,
      userId: data.userId,
      quizId: data.quizId,
      quizTitle: data.quizTitle,
      questionId: data.questionId,
      question: data.question,
      type: data.type,
      options: data.options,
      correctAnswer: data.correctAnswer,
      userAnswer: data.userAnswer,
      explanation: data.explanation,
      reviewType: data.reviewType,
      isBookmarked: data.isBookmarked,
      isCorrect: data.isCorrect,
      reviewCount: data.reviewCount || 0,
      lastReviewedAt: data.lastReviewedAt,
      createdAt: data.createdAt,
      quizUpdatedAt: data.quizUpdatedAt || null,
      combinedGroupId: data.combinedGroupId,
      combinedIndex: data.combinedIndex,
      combinedTotal: data.combinedTotal,
      passage: data.passage,
      passageType: data.passageType,
      passageImage: data.passageImage,
      koreanAbcItems: data.koreanAbcItems,
      passageMixedExamples: data.passageMixedExamples,
      commonQuestion: data.commonQuestion,
      image: data.image,
      subQuestionOptions: data.subQuestionOptions,
      subQuestionOptionsType: data.subQuestionOptionsType,
      mixedExamples: data.mixedExamples,
      subQuestionImage: data.subQuestionImage,
      quizCreatorId: data.quizCreatorId,
      quizType: data.quizType,
      chapterId: data.chapterId,
      chapterDetailId: data.chapterDetailId,
      choiceExplanations: data.choiceExplanations || null,
      imageUrl: data.imageUrl || null,
      passagePrompt: data.passagePrompt,
      bogiQuestionText: data.bogiQuestionText,
      bogi: data.bogi || null,
    };
  }, []);

  // 퀴즈 제목을 병렬로 가져와서 아이템에 채우는 헬퍼
  const fillQuizTitles = useCallback(async (items: { quizId: string; quizTitle?: string }[]) => {
    const quizIds = new Set<string>();
    items.forEach(item => quizIds.add(item.quizId));

    // 병렬로 제목 가져오기
    const titleEntries = await Promise.all(
      Array.from(quizIds).map(async (quizId) => {
        const title = await fetchQuizTitle(quizId);
        return [quizId, title] as const;
      })
    );
    const titleMap = new Map(titleEntries);

    items.forEach((item) => {
      if (!item.quizTitle) {
        item.quizTitle = titleMap.get(item.quizId) || '퀴즈';
      }
    });
  }, [fetchQuizTitle]);

  /**
   * 복습 문제 구독
   * - 로딩 카운터로 초기 로딩을 한 번만 표시
   * - fetchQuizTitle을 의존성에서 제거하여 무한 루프 방지
   */
  useEffect(() => {
    if (!user) {
      setLoading(false);
      setWrongItems([]);
      setBookmarkedItems([]);
      setSolvedItems([]);
      return;
    }

    setLoading(true);
    setError(null);

    // 초기 로딩 카운터: 핵심 3개 리스너(wrong, bookmark, solved) 응답 후 로딩 해제
    let loadedCount = 0;
    const CORE_LISTENER_COUNT = 3;
    let isMounted = true;

    const markLoaded = () => {
      loadedCount++;
      if (loadedCount >= CORE_LISTENER_COUNT && isMounted) {
        setLoading(false);
      }
    };

    // 오답/찜 페이지네이션 크기
    const REVIEW_PAGE_SIZE = 100;

    // 오답 문제 구독 (orderBy + limit으로 무제한 스캔 방지)
    const wrongQuery = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'wrong'),
          where('courseId', '==', userCourseId),
          orderBy('createdAt', 'desc'),
          limit(REVIEW_PAGE_SIZE + 1)
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'wrong'),
          orderBy('createdAt', 'desc'),
          limit(REVIEW_PAGE_SIZE + 1)
        );

    // 오답 페이지네이션용 기본 쿼리 저장
    wrongQueryBaseRef.current = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'wrong'),
          where('courseId', '==', userCourseId),
          orderBy('createdAt', 'desc')
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'wrong'),
          orderBy('createdAt', 'desc')
        );

    const unsubscribeWrong = onSnapshot(
      wrongQuery,
      async (snapshot) => {
        try {
          const docs = snapshot.docs;
          const hasMore = docs.length > REVIEW_PAGE_SIZE;
          const pageDocs = hasMore ? docs.slice(0, REVIEW_PAGE_SIZE) : docs;

          const items: ReviewItem[] = pageDocs.map(mapDocToReviewItem);
          await fillQuizTitles(items);
          // Firestore orderBy로 이미 정렬되어 있으므로 클라이언트 sort 불필요

          if (isMounted) {
            setWrongItems(items);
            setHasMoreWrong(hasMore);
            wrongLastDocRef.current = pageDocs.length > 0
              ? pageDocs[pageDocs.length - 1]
              : null;
          }
        } catch (e) {
          console.error('오답 처리 실패:', e);
        } finally {
          if (isMounted) markLoaded();
        }
      },
      (err) => {
        console.error('오답 목록 로드 실패:', err);
        if (isMounted) {
          setError('오답 목록을 불러오는데 실패했습니다.');
          markLoaded();
        }
      }
    );

    // 찜한 문제 구독 (orderBy + limit으로 무제한 스캔 방지)
    const bookmarkQuery = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'bookmark'),
          where('courseId', '==', userCourseId),
          orderBy('createdAt', 'desc'),
          limit(REVIEW_PAGE_SIZE + 1)
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'bookmark'),
          orderBy('createdAt', 'desc'),
          limit(REVIEW_PAGE_SIZE + 1)
        );

    // 찜 페이지네이션용 기본 쿼리 저장
    bookmarkQueryBaseRef.current = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'bookmark'),
          where('courseId', '==', userCourseId),
          orderBy('createdAt', 'desc')
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'bookmark'),
          orderBy('createdAt', 'desc')
        );

    const unsubscribeBookmark = onSnapshot(
      bookmarkQuery,
      async (snapshot) => {
        try {
          const docs = snapshot.docs;
          const hasMore = docs.length > REVIEW_PAGE_SIZE;
          const pageDocs = hasMore ? docs.slice(0, REVIEW_PAGE_SIZE) : docs;

          const items: ReviewItem[] = pageDocs.map(mapDocToReviewItem);
          await fillQuizTitles(items);
          // Firestore orderBy로 이미 정렬되어 있으므로 클라이언트 sort 불필요

          if (isMounted) {
            setBookmarkedItems(items);
            setHasMoreBookmark(hasMore);
            bookmarkLastDocRef.current = pageDocs.length > 0
              ? pageDocs[pageDocs.length - 1]
              : null;
          }
        } catch (e) {
          console.error('찜한 문제 처리 실패:', e);
        } finally {
          if (isMounted) markLoaded();
        }
      },
      (err) => {
        console.error('찜한 문제 목록 로드 실패:', err);
        if (isMounted) markLoaded();
      }
    );

    // 푼 문제 구독 (페이지네이션: 첫 50건만 로드)
    const SOLVED_PAGE_SIZE = 50;
    const solvedBaseQuery = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'solved'),
          where('courseId', '==', userCourseId),
          orderBy('createdAt', 'desc'),
          limit(SOLVED_PAGE_SIZE + 1)
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'solved'),
          orderBy('createdAt', 'desc'),
          limit(SOLVED_PAGE_SIZE + 1)
        );

    // 페이지네이션용 기본 쿼리 저장 (courseId 포함 여부)
    solvedQueryBaseRef.current = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'solved'),
          where('courseId', '==', userCourseId),
          orderBy('createdAt', 'desc')
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'solved'),
          orderBy('createdAt', 'desc')
        );

    const unsubscribeSolved = onSnapshot(
      solvedBaseQuery,
      async (snapshot) => {
        try {
          const docs = snapshot.docs;
          const hasMore = docs.length > SOLVED_PAGE_SIZE;
          const pageDocs = hasMore ? docs.slice(0, SOLVED_PAGE_SIZE) : docs;

          const items: ReviewItem[] = pageDocs.map(mapDocToReviewItem);
          await fillQuizTitles(items);

          if (isMounted) {
            setSolvedItems(items);
            setHasMoreSolved(hasMore);
            solvedLastDocRef.current = pageDocs.length > 0
              ? pageDocs[pageDocs.length - 1]
              : null;
          }
        } catch (e) {
          console.error('푼 문제 처리 실패:', e);
        } finally {
          if (isMounted) markLoaded();
        }
      },
      (err) => {
        console.error('푼 문제 목록 로드 실패:', err);
        if (isMounted) markLoaded();
      }
    );

    // 퀴즈 풀이 기록 구독
    const attemptsQuery = userCourseId
      ? query(
          collection(db, 'quizResults'),
          where('userId', '==', user.uid),
          where('courseId', '==', userCourseId)
        )
      : query(
          collection(db, 'quizResults'),
          where('userId', '==', user.uid)
        );

    const unsubscribeAttempts = onSnapshot(
      attemptsQuery,
      async (snapshot) => {
        try {
          const attempts: QuizAttempt[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            attempts.push({
              id: docSnap.id,
              quizId: data.quizId,
              quizTitle: '',
              correctCount: data.correctCount || 0,
              totalCount: data.totalCount || 0,
              earnedGold: data.earnedGold || 0,
              earnedExp: data.earnedExp || 0,
              timeSpentSeconds: data.timeSpentSeconds || 0,
              completedAt: data.createdAt,
            });
          });
          await fillQuizTitles(attempts);
          attempts.sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0));
          if (isMounted) setQuizAttempts(attempts);
        } catch (e) {
          console.error('퀴즈 풀이 기록 처리 실패:', e);
        }
      },
      (err) => {
        console.error('퀴즈 풀이 기록 로드 실패:', err);
      }
    );

    // 커스텀 폴더 구독
    const foldersQuery = userCourseId
      ? query(
          collection(db, 'customFolders'),
          where('userId', '==', user.uid),
          where('courseId', '==', userCourseId)
        )
      : query(
          collection(db, 'customFolders'),
          where('userId', '==', user.uid)
        );

    const unsubscribeFolders = onSnapshot(
      foldersQuery,
      (snapshot) => {
        const folders: CustomFolder[] = [];

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          folders.push({
            id: docSnap.id,
            name: data.name,
            createdAt: data.createdAt,
            questions: data.questions || [],
            categories: data.categories || [],
          });
        });

        folders.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || Date.now();
          const bTime = b.createdAt?.toMillis?.() || Date.now();
          return bTime - aTime;
        });

        if (isMounted) setCustomFolders(folders);
      },
      (err) => {
        console.error('커스텀 폴더 로드 실패:', err);
      }
    );

    // 비공개 퀴즈 구독
    const privateQuizzesQuery = userCourseId
      ? query(
          collection(db, 'quizzes'),
          where('creatorId', '==', user.uid),
          where('isPublic', '==', false),
          where('courseId', '==', userCourseId)
        )
      : query(
          collection(db, 'quizzes'),
          where('creatorId', '==', user.uid),
          where('isPublic', '==', false)
        );

    const unsubscribePrivateQuizzes = onSnapshot(
      privateQuizzesQuery,
      (snapshot) => {
        const quizzes: PrivateQuiz[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          quizzes.push({
            id: docSnap.id,
            title: data.title || '퀴즈',
            questionCount: data.questions?.length || 0,
            createdAt: data.createdAt,
          });
        });

        quizzes.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        });

        if (isMounted) setPrivateQuizzes(quizzes);
      },
      (err) => {
        console.error('비공개 퀴즈 로드 실패:', err);
      }
    );

    // 삭제된 항목 구독 (휴지통)
    const deletedQuery = userCourseId
      ? query(
          collection(db, 'deletedReviewItems'),
          where('userId', '==', user.uid),
          where('courseId', '==', userCourseId),
          orderBy('deletedAt', 'desc')
        )
      : query(
          collection(db, 'deletedReviewItems'),
          where('userId', '==', user.uid),
          orderBy('deletedAt', 'desc')
        );

    const unsubscribeDeleted = onSnapshot(
      deletedQuery,
      (snapshot) => {
        const items: DeletedItem[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          items.push({
            id: docSnap.id,
            userId: data.userId,
            courseId: data.courseId,
            type: data.type,
            originalId: data.originalId,
            title: data.title,
            questionCount: data.questionCount || 0,
            deletedAt: data.deletedAt,
            restoreData: data.restoreData,
          });
        });
        if (isMounted) setDeletedItems(items);
      },
      (err) => {
        console.error('삭제된 항목 로드 실패:', err);
      }
    );

    return () => {
      isMounted = false;
      unsubscribeWrong();
      unsubscribeBookmark();
      unsubscribeSolved();
      unsubscribeAttempts();
      unsubscribeFolders();
      unsubscribePrivateQuizzes();
      unsubscribeDeleted();
    };
    // fetchQuizTitle, fillQuizTitles, mapDocToReviewItem은 안정적인 ref이므로 의존성에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userCourseId, refreshKey]);

  /**
   * 복습 문제 삭제
   */
  const deleteReviewItem = useCallback(async (reviewId: string): Promise<void> => {
    if (!user) return;

    try {
      await deleteDoc(doc(db, 'reviews', reviewId));
    } catch (err) {
      console.error('복습 문제 삭제 실패:', err);
      throw new Error('문제 삭제에 실패했습니다.');
    }
  }, [user]);

  /**
   * 푼 문제(퀴즈) 삭제 - 퀴즈 목록에서 다시 풀 수 있도록
   */
  const deleteSolvedQuiz = useCallback(async (quizId: string): Promise<void> => {
    if (!user) return;

    try {
      // 퀴즈 제목 가져오기
      let quizTitle = '퀴즈';
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (quizDoc.exists()) {
          quizTitle = quizDoc.data()?.title || '퀴즈';
        }
      } catch (e) {
        console.error('퀴즈 제목 로드 실패:', e);
      }

      // 해당 퀴즈의 모든 solved 리뷰 가져오기
      const solvedQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId),
        where('reviewType', '==', 'solved')
      );
      const solvedDocs = await getDocs(solvedQuery);

      // 휴지통에 저장 (복원 데이터 포함)
      const restoreData = {
        solvedReviews: solvedDocs.docs.map(d => ({ id: d.id, ...d.data() })),
      };

      await addDoc(collection(db, 'deletedReviewItems'), {
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'solved',
        originalId: quizId,
        title: quizTitle,
        questionCount: solvedDocs.size,
        deletedAt: serverTimestamp(),
        restoreData,
      });

      // 해당 퀴즈의 모든 solved 리뷰 삭제
      for (const docSnap of solvedDocs.docs) {
        await deleteDoc(docSnap.ref);
      }

      // 해당 퀴즈의 모든 wrong 리뷰도 삭제
      const wrongQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId),
        where('reviewType', '==', 'wrong')
      );
      const wrongDocs = await getDocs(wrongQuery);
      for (const docSnap of wrongDocs.docs) {
        await deleteDoc(docSnap.ref);
      }

      // quizResults에서 해당 기록 삭제
      const resultsQuery = query(
        collection(db, 'quizResults'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId)
      );
      const resultsDocs = await getDocs(resultsQuery);
      for (const docSnap of resultsDocs.docs) {
        await deleteDoc(docSnap.ref);
      }

      // quiz_completions에서 완료 기록 삭제
      try {
        const completionDocId = `${quizId}_${user.uid}`;
        await deleteDoc(doc(db, 'quiz_completions', completionDocId));
      } catch (updateErr) {
        console.error('quiz_completions 삭제 실패:', updateErr);
      }
    } catch (err) {
      console.error('푼 문제 삭제 실패:', err);
      throw new Error('삭제에 실패했습니다.');
    }
  }, [user, userCourseId]);

  /**
   * 오답 폴더 삭제 (챕터별) - 특정 챕터의 오답만 삭제
   * @param quizId 퀴즈 ID
   * @param chapterId 챕터 ID (null이면 미분류)
   * @param chapterName 챕터 이름 (휴지통 표시용)
   */
  const deleteWrongQuizByChapter = useCallback(async (
    quizId: string,
    chapterId: string | null,
    chapterName?: string
  ): Promise<void> => {
    if (!user) return;

    try {
      // 퀴즈 제목 가져오기
      let quizTitle = '퀴즈';
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (quizDoc.exists()) {
          quizTitle = quizDoc.data()?.title || '퀴즈';
        } else {
          const privateQuizDoc = await getDoc(doc(db, 'privateQuizzes', quizId));
          if (privateQuizDoc.exists()) {
            quizTitle = privateQuizDoc.data()?.title || '퀴즈';
          }
        }
      } catch (e) {
        console.error('퀴즈 제목 로드 실패:', e);
      }

      // 해당 챕터의 오답만 가져오기
      let wrongQuery;
      if (chapterId) {
        wrongQuery = query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('quizId', '==', quizId),
          where('chapterId', '==', chapterId),
          where('reviewType', '==', 'wrong')
        );
      } else {
        // 미분류 (chapterId가 null 또는 없음)
        wrongQuery = query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('quizId', '==', quizId),
          where('reviewType', '==', 'wrong')
        );
        // chapterId가 없는 문서만 필터링
      }
      const wrongDocs = await getDocs(wrongQuery);

      // chapterId가 null인 경우 추가 필터링
      let filteredDocs = wrongDocs.docs;
      if (!chapterId) {
        filteredDocs = wrongDocs.docs.filter(d => !d.data().chapterId);
      }

      // 0문제면 삭제할 것이 없음
      if (filteredDocs.length === 0) {
        return;
      }

      // 휴지통에 저장 (챕터명 · 퀴즈명 형식)
      const displayTitle = chapterName
        ? `${chapterName} · ${quizTitle}`
        : `미분류 · ${quizTitle}`;

      const restoreData = {
        wrongReviews: filteredDocs.map(d => ({ id: d.id, ...d.data() })),
      };

      await addDoc(collection(db, 'deletedReviewItems'), {
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'wrong',
        originalId: quizId,
        chapterId: chapterId || null,
        title: displayTitle,
        questionCount: filteredDocs.length,
        deletedAt: serverTimestamp(),
        restoreData,
      });

      // 삭제
      for (const docSnap of filteredDocs) {
        await deleteDoc(docSnap.ref);
      }
    } catch (err) {
      console.error('오답 폴더 삭제 실패:', err);
      throw new Error('삭제에 실패했습니다.');
    }
  }, [user, userCourseId]);

  /**
   * 오답 폴더 삭제 - 해당 퀴즈의 오답만 삭제 (레거시, 전체 삭제)
   */
  const deleteWrongQuiz = useCallback(async (quizId: string): Promise<void> => {
    if (!user) return;

    try {
      // 퀴즈 제목 가져오기 (공개 퀴즈 또는 비공개 퀴즈)
      let quizTitle = '퀴즈';
      try {
        // 먼저 공개 퀴즈에서 찾기
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (quizDoc.exists()) {
          quizTitle = quizDoc.data()?.title || '퀴즈';
        } else {
          // 비공개 퀴즈에서 찾기
          const privateQuizDoc = await getDoc(doc(db, 'privateQuizzes', quizId));
          if (privateQuizDoc.exists()) {
            quizTitle = privateQuizDoc.data()?.title || '퀴즈';
          }
        }
      } catch (e) {
        console.error('퀴즈 제목 로드 실패:', e);
      }

      // 해당 퀴즈의 모든 wrong 리뷰 가져오기
      const wrongQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId),
        where('reviewType', '==', 'wrong')
      );
      const wrongDocs = await getDocs(wrongQuery);

      // 휴지통에 저장
      const restoreData = {
        wrongReviews: wrongDocs.docs.map(d => ({ id: d.id, ...d.data() })),
      };

      await addDoc(collection(db, 'deletedReviewItems'), {
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'wrong',
        originalId: quizId,
        title: quizTitle,
        questionCount: wrongDocs.size,
        deletedAt: serverTimestamp(),
        restoreData,
      });

      // 삭제
      for (const docSnap of wrongDocs.docs) {
        await deleteDoc(docSnap.ref);
      }
    } catch (err) {
      console.error('오답 폴더 삭제 실패:', err);
      throw new Error('삭제에 실패했습니다.');
    }
  }, [user, userCourseId]);

  /**
   * 찜한 문제 폴더 삭제 - 해당 퀴즈의 찜한 문제만 삭제 (isBookmarked 해제)
   */
  const deleteBookmarkQuiz = useCallback(async (quizId: string): Promise<void> => {
    if (!user) return;

    try {
      // 퀴즈 제목 가져오기
      let quizTitle = '퀴즈';
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (quizDoc.exists()) {
          quizTitle = quizDoc.data()?.title || '퀴즈';
        }
      } catch (e) {
        console.error('퀴즈 제목 로드 실패:', e);
      }

      // 해당 퀴즈의 bookmark 전용 리뷰 가져오기
      const bookmarkQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId),
        where('reviewType', '==', 'bookmark')
      );
      const bookmarkDocs = await getDocs(bookmarkQuery);

      // 다른 타입(solved/wrong)에서 isBookmarked=true인 리뷰도 가져오기
      const flaggedQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId),
        where('isBookmarked', '==', true)
      );
      const flaggedDocs = await getDocs(flaggedQuery);
      // bookmark 타입이 아닌 문서만 필터
      const nonBookmarkFlagged = flaggedDocs.docs.filter(d => d.data().reviewType !== 'bookmark');

      // 휴지통에 저장 (복원용 review ID 목록)
      const restoreData = {
        bookmarkedReviewIds: bookmarkDocs.docs.map(d => d.id),
        flaggedReviewIds: nonBookmarkFlagged.map(d => d.id),
      };

      await addDoc(collection(db, 'deletedReviewItems'), {
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'bookmark',
        originalId: quizId,
        title: quizTitle,
        questionCount: bookmarkDocs.size,
        deletedAt: serverTimestamp(),
        restoreData,
      });

      // bookmark 전용 리뷰는 삭제
      for (const docSnap of bookmarkDocs.docs) {
        await deleteDoc(docSnap.ref);
      }
      // 다른 타입 리뷰의 isBookmarked 플래그만 해제
      for (const docSnap of nonBookmarkFlagged) {
        await updateDoc(docSnap.ref, { isBookmarked: false });
      }
    } catch (err) {
      console.error('찜한 문제 폴더 삭제 실패:', err);
      throw new Error('삭제에 실패했습니다.');
    }
  }, [user, userCourseId]);

  /**
   * 복습 완료 처리
   */
  const markAsReviewed = useCallback(async (reviewId: string): Promise<void> => {
    if (!user) return;

    try {
      await updateDoc(doc(db, 'reviews', reviewId), {
        reviewCount: increment(1),
        lastReviewedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('복습 완료 처리 실패:', err);
      throw new Error('복습 완료 처리에 실패했습니다.');
    }
  }, [user]);

  /**
   * 데이터 새로고침
   */
  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
    setUpdatedQuizzes(new Map());
  }, []);

  /**
   * 삭제된 항목 복원
   */
  const restoreDeletedItem = useCallback(async (deletedItemId: string): Promise<void> => {
    if (!user) return;

    try {
      // 삭제된 항목 가져오기
      const deletedRef = doc(db, 'deletedReviewItems', deletedItemId);
      const deletedDoc = await getDoc(deletedRef);

      if (!deletedDoc.exists()) {
        throw new Error('삭제된 항목을 찾을 수 없습니다.');
      }

      const data = deletedDoc.data();
      const restoreData = data.restoreData;

      // 타입에 따라 복원
      if (data.type === 'solved' && restoreData?.solvedReviews) {
        // 푼 문제 복원 - reviews 컬렉션에 다시 추가
        for (const review of restoreData.solvedReviews) {
          const { id, ...reviewData } = review;
          await addDoc(collection(db, 'reviews'), {
            ...reviewData,
            createdAt: serverTimestamp(),
          });
        }
        // quiz_completions 복원
        try {
          const completionDocId = `${data.originalId}_${user.uid}`;
          await setDoc(doc(db, 'quiz_completions', completionDocId), {
            quizId: data.originalId,
            userId: user.uid,
            completedAt: serverTimestamp(),
          }, { merge: true });
        } catch (e) {
          console.error('quiz_completions 복원 실패:', e);
        }
      } else if (data.type === 'wrong' && restoreData?.wrongReviews) {
        // 오답 복원
        for (const review of restoreData.wrongReviews) {
          const { id, ...reviewData } = review;
          await addDoc(collection(db, 'reviews'), {
            ...reviewData,
            createdAt: serverTimestamp(),
          });
        }
      } else if (data.type === 'bookmark' && restoreData?.bookmarkedReviewIds) {
        // 찜 복원 - isBookmarked를 true로 변경
        for (const reviewId of restoreData.bookmarkedReviewIds) {
          try {
            await updateDoc(doc(db, 'reviews', reviewId), { isBookmarked: true });
          } catch (e) {
            console.error('리뷰 복원 실패:', reviewId, e);
          }
        }
      } else if (data.type === 'custom' && restoreData?.folderData) {
        // 커스텀 폴더 복원
        const { id, ...folderData } = restoreData.folderData;
        await addDoc(collection(db, 'customFolders'), {
          ...folderData,
          createdAt: serverTimestamp(),
        });
      }

      // 휴지통에서 삭제
      await deleteDoc(deletedRef);
    } catch (err) {
      console.error('항목 복원 실패:', err);
      throw new Error('복원에 실패했습니다.');
    }
  }, [user]);

  /**
   * 삭제된 항목 영구 삭제
   */
  const permanentlyDeleteItem = useCallback(async (deletedItemId: string): Promise<void> => {
    if (!user) return;

    try {
      await deleteDoc(doc(db, 'deletedReviewItems', deletedItemId));
    } catch (err) {
      console.error('영구 삭제 실패:', err);
      throw new Error('영구 삭제에 실패했습니다.');
    }
  }, [user]);

  /**
   * 퀴즈에서 업데이트된 문제를 review 항목에 반영
   * 기존 리뷰 데이터를 최대한 보존하면서 문제 내용만 업데이트
   */
  const updateReviewItemsFromQuiz = useCallback(async (quizId: string): Promise<void> => {
    if (!user) return;

    try {
      // 퀴즈 데이터 가져오기
      const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
      if (!quizDoc.exists()) return;

      const quizData = quizDoc.data();
      const questions = quizData.questions || [];
      const quizTitle = quizData.title || '퀴즈';
      const quizUpdatedAt = quizData.updatedAt || quizData.createdAt || null;

      // 해당 퀴즈의 기존 review 항목들 가져오기
      const existingReviewsQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId)
      );
      const existingReviews = await getDocs(existingReviewsQuery);

      // 기존 리뷰를 questionId+reviewType 키로 매핑
      const existingReviewMap = new Map<string, { docId: string; data: any }>();
      existingReviews.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        const key = `${data.questionId}-${data.reviewType}`;
        existingReviewMap.set(key, { docId: docSnapshot.id, data });
      });

      // 새 퀴즈의 questionId 집합
      const newQuestionIds = new Set<string>();
      questions.forEach((q: any, i: number) => {
        newQuestionIds.add(q.id || `q${i}`);
      });

      // 기존 리뷰에서 새 퀴즈에 없는 문제의 리뷰는 삭제하지 않고 유지
      // (단, questionId가 완전히 달라진 경우는 인덱스 기반으로 매핑 시도)

      // 인덱스 기반 매핑을 위해 기존 리뷰의 questionId 추출 (sorted)
      const existingQuestionIds = new Set<string>();
      existingReviews.forEach((docSnapshot) => {
        existingQuestionIds.add(docSnapshot.data().questionId);
      });

      // 각 문제에 대해 업데이트 또는 생성
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const questionId = q.id || `q${i}`;

        // 타입 정규화: subjective -> short
        const rawType = q.type || 'short';
        const normalizedType = rawType === 'subjective' ? 'short' : rawType;

        // 이 문제에 대한 기존 리뷰 타입들 찾기
        const existingTypesForQuestion: string[] = [];
        existingReviewMap.forEach((value, key) => {
          if (key.startsWith(`${questionId}-`)) {
            existingTypesForQuestion.push(key.split('-')[1]);
          }
        });

        // 기존 타입이 없으면 'solved'만 생성
        const typesToProcess = existingTypesForQuestion.length > 0
          ? existingTypesForQuestion
          : ['solved'];

        for (const reviewType of typesToProcess) {
          const key = `${questionId}-${reviewType}`;
          const existing = existingReviewMap.get(key);

          if (existing) {
            // 기존 리뷰 업데이트 - 문제 내용만 업데이트하고 userAnswer, isCorrect 등은 유지
            await updateDoc(doc(db, 'reviews', existing.docId), {
              quizTitle,
              question: q.text || q.question || '',
              type: normalizedType,
              options: q.choices || q.options || [],
              correctAnswer: q.correctAnswer ?? q.answer ?? '',
              explanation: q.explanation || '',
              quizUpdatedAt,
              // userAnswer, isCorrect, reviewCount, lastReviewedAt 등은 유지
            });
            // 처리됨 표시
            existingReviewMap.delete(key);
          } else {
            // 새 리뷰 생성
            await addDoc(collection(db, 'reviews'), {
              userId: user.uid,
              quizId,
              quizTitle,
              questionId,
              question: q.text || q.question || '',
              type: normalizedType,
              options: q.choices || q.options || [],
              correctAnswer: q.correctAnswer ?? q.answer ?? '',
              userAnswer: '',
              explanation: q.explanation || '',
              reviewType,
              isBookmarked: reviewType === 'bookmark',
              isCorrect: null,
              reviewCount: 0,
              lastReviewedAt: null,
              quizUpdatedAt,
              courseId: userCourseId || null,
              createdAt: serverTimestamp(),
            });
          }
        }
      }

      // 남은 기존 리뷰들 (새 퀴즈에 없는 문제들)은 삭제하지 않고 유지
      // 사용자가 직접 삭제할 때까지 보존

      // 업데이트 정보 제거
      setUpdatedQuizzes((prev) => {
        const newMap = new Map(prev);
        newMap.delete(`wrong-${quizId}`);
        newMap.delete(`bookmark-${quizId}`);
        newMap.delete(`solved-${quizId}`);
        return newMap;
      });

    } catch (err) {
      console.error('문제 업데이트 실패:', err);
      throw new Error('문제 업데이트에 실패했습니다.');
    }
  }, [user, userCourseId]);

  /**
   * 커스텀 폴더 생성
   */
  const createCustomFolder = useCallback(async (name: string): Promise<string | null> => {
    if (!user) {
      console.error('커스텀 폴더 생성 실패: 로그인 필요');
      return null;
    }

    try {
      console.log('[useReview] 폴더 생성 시도:', name, 'userId:', user.uid);
      const docRef = await addDoc(collection(db, 'customFolders'), {
        userId: user.uid,
        name,
        questions: [],
        courseId: userCourseId || null,
        createdAt: serverTimestamp(),
      });
      console.log('[useReview] 폴더 생성 성공:', docRef.id);
      return docRef.id;
    } catch (err: any) {
      console.error('커스텀 폴더 생성 실패:', err);
      console.error('에러 코드:', err.code);
      console.error('에러 메시지:', err.message);
      return null;
    }
  }, [user, userCourseId]);

  /**
   * 커스텀 폴더 삭제
   */
  const deleteCustomFolder = useCallback(async (folderId: string): Promise<void> => {
    if (!user) return;

    try {
      // 폴더 데이터 가져오기
      const folderRef = doc(db, 'customFolders', folderId);
      const folderDoc = await getDoc(folderRef);

      if (!folderDoc.exists()) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const folderData = folderDoc.data();

      // 휴지통에 저장
      await addDoc(collection(db, 'deletedReviewItems'), {
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'custom',
        originalId: folderId,
        title: folderData.name || '폴더',
        questionCount: folderData.questions?.length || 0,
        deletedAt: serverTimestamp(),
        restoreData: {
          folderData: { ...folderData, id: folderId },
        },
      });

      // 삭제
      await deleteDoc(folderRef);
    } catch (err) {
      console.error('커스텀 폴더 삭제 실패:', err);
      throw new Error('폴더 삭제에 실패했습니다.');
    }
  }, [user, userCourseId]);

  /**
   * 문제를 커스텀 폴더에 추가
   */
  const addToCustomFolder = useCallback(async (
    folderId: string,
    questions: { questionId: string; quizId: string; quizTitle: string; combinedGroupId?: string | null }[]
  ): Promise<void> => {
    if (!user) return;

    try {
      const folderRef = doc(db, 'customFolders', folderId);
      const folderDoc = await getDoc(folderRef);

      if (!folderDoc.exists()) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const currentQuestions = folderDoc.data().questions || [];
      const newQuestions = [...currentQuestions];

      // 중복 제거하며 추가 (questionId + quizId 조합으로 확인)
      for (const q of questions) {
        if (!newQuestions.some(existing =>
          existing.questionId === q.questionId && existing.quizId === q.quizId
        )) {
          newQuestions.push(q);
        }
      }

      await updateDoc(folderRef, { questions: newQuestions });
    } catch (err) {
      console.error('문제 추가 실패:', err);
      throw new Error('문제 추가에 실패했습니다.');
    }
  }, [user]);

  /**
   * 커스텀 폴더에서 문제 제거
   */
  const removeFromCustomFolder = useCallback(async (
    folderId: string,
    questionId: string
  ): Promise<void> => {
    if (!user) return;

    try {
      const folderRef = doc(db, 'customFolders', folderId);
      const folderDoc = await getDoc(folderRef);

      if (!folderDoc.exists()) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const currentQuestions = folderDoc.data().questions || [];
      const newQuestions = currentQuestions.filter(
        (q: { questionId: string }) => q.questionId !== questionId
      );

      await updateDoc(folderRef, { questions: newQuestions });
    } catch (err) {
      console.error('문제 제거 실패:', err);
      throw new Error('문제 제거에 실패했습니다.');
    }
  }, [user]);

  /**
   * 문제 찜 토글 (찜한 문제로 추가/제거)
   */
  const toggleQuestionBookmark = useCallback(async (item: ReviewItem): Promise<void> => {
    if (!user) return;

    try {
      if (item.isBookmarked) {
        // 이미 찜한 문제면 bookmark 리뷰 삭제
        const bookmarkQuery = query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('quizId', '==', item.quizId),
          where('questionId', '==', item.questionId),
          where('reviewType', '==', 'bookmark')
        );
        const bookmarkDocs = await getDocs(bookmarkQuery);
        for (const docSnap of bookmarkDocs.docs) {
          await deleteDoc(docSnap.ref);
        }

        // 원본 리뷰의 isBookmarked 플래그 업데이트
        if (item.reviewType !== 'bookmark') {
          await updateDoc(doc(db, 'reviews', item.id), { isBookmarked: false });
        }
      } else {
        // 찜 안한 문제면 bookmark 리뷰 생성
        await addDoc(collection(db, 'reviews'), {
          userId: user.uid,
          quizId: item.quizId,
          quizTitle: item.quizTitle || '',
          questionId: item.questionId,
          question: item.question,
          type: item.type,
          options: item.options || [],
          correctAnswer: item.correctAnswer,
          userAnswer: item.userAnswer || '',
          explanation: item.explanation || '',
          reviewType: 'bookmark',
          isBookmarked: true,
          isCorrect: item.isCorrect ?? null,
          reviewCount: 0,
          lastReviewedAt: null,
          quizUpdatedAt: item.quizUpdatedAt || null,
          courseId: userCourseId || null,
          // 결합형 문제 필드
          ...(item.combinedGroupId && { combinedGroupId: item.combinedGroupId }),
          ...(item.combinedIndex !== undefined && { combinedIndex: item.combinedIndex }),
          ...(item.combinedTotal !== undefined && { combinedTotal: item.combinedTotal }),
          ...(item.passage && { passage: item.passage }),
          ...(item.passageType && { passageType: item.passageType }),
          ...(item.passageImage && { passageImage: item.passageImage }),
          ...(item.koreanAbcItems && { koreanAbcItems: item.koreanAbcItems }),
          ...(item.passageMixedExamples && { passageMixedExamples: item.passageMixedExamples }),
          ...(item.commonQuestion && { commonQuestion: item.commonQuestion }),
          // 이미지/보기 필드
          ...(item.image && { image: item.image }),
          ...(item.imageUrl && { imageUrl: item.imageUrl }),
          ...(item.subQuestionOptions && { subQuestionOptions: item.subQuestionOptions }),
          ...(item.subQuestionOptionsType && { subQuestionOptionsType: item.subQuestionOptionsType }),
          ...(item.subQuestionImage && { subQuestionImage: item.subQuestionImage }),
          ...(item.mixedExamples && { mixedExamples: item.mixedExamples }),
          // 챕터/해설 필드
          ...(item.chapterId && { chapterId: item.chapterId }),
          ...(item.chapterDetailId && { chapterDetailId: item.chapterDetailId }),
          ...(item.choiceExplanations && { choiceExplanations: item.choiceExplanations }),
          ...(item.passagePrompt && { passagePrompt: item.passagePrompt }),
          ...(item.bogiQuestionText && { bogiQuestionText: item.bogiQuestionText }),
          ...(item.bogi && { bogi: item.bogi }),
          createdAt: serverTimestamp(),
        });

        // 원본 리뷰의 isBookmarked 플래그 업데이트
        if (item.reviewType !== 'bookmark') {
          await updateDoc(doc(db, 'reviews', item.id), { isBookmarked: true });
        }
      }
    } catch (err) {
      console.error('찜 토글 실패:', err);
      throw new Error('찜 처리에 실패했습니다.');
    }
  }, [user, userCourseId]);

  /**
   * 커스텀 폴더에 카테고리 추가
   */
  const addCategoryToFolder = useCallback(async (
    folderId: string,
    categoryName: string
  ): Promise<string | null> => {
    if (!user) return null;

    try {
      const folderRef = doc(db, 'customFolders', folderId);
      const folderDoc = await getDoc(folderRef);

      if (!folderDoc.exists()) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const currentCategories = folderDoc.data().categories || [];
      const newCategoryId = `cat_${Date.now()}`;
      const newCategory: FolderCategory = {
        id: newCategoryId,
        name: categoryName,
      };

      await updateDoc(folderRef, {
        categories: [...currentCategories, newCategory],
      });

      return newCategoryId;
    } catch (err) {
      console.error('카테고리 추가 실패:', err);
      return null;
    }
  }, [user]);

  /**
   * 커스텀 폴더에서 카테고리 삭제
   * 해당 카테고리에 배정된 문제들은 미분류로 변경
   */
  const removeCategoryFromFolder = useCallback(async (
    folderId: string,
    categoryId: string
  ): Promise<void> => {
    if (!user) return;

    try {
      const folderRef = doc(db, 'customFolders', folderId);
      const folderDoc = await getDoc(folderRef);

      if (!folderDoc.exists()) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const data = folderDoc.data();
      const currentCategories = data.categories || [];
      const currentQuestions = data.questions || [];

      // 카테고리 삭제
      const newCategories = currentCategories.filter(
        (cat: FolderCategory) => cat.id !== categoryId
      );

      // 해당 카테고리의 문제들은 미분류로 변경
      const newQuestions = currentQuestions.map((q: CustomFolderQuestion) => ({
        ...q,
        categoryId: q.categoryId === categoryId ? undefined : q.categoryId,
      }));

      await updateDoc(folderRef, {
        categories: newCategories,
        questions: newQuestions,
      });
    } catch (err) {
      console.error('카테고리 삭제 실패:', err);
      throw new Error('카테고리 삭제에 실패했습니다.');
    }
  }, [user]);

  /**
   * 문제를 카테고리에 배정
   * categoryId가 null이면 미분류로 변경
   */
  const assignQuestionToCategory = useCallback(async (
    folderId: string,
    questionId: string,
    categoryId: string | null
  ): Promise<void> => {
    if (!user) return;

    try {
      const folderRef = doc(db, 'customFolders', folderId);
      const folderDoc = await getDoc(folderRef);

      if (!folderDoc.exists()) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const currentQuestions = folderDoc.data().questions || [];
      const newQuestions = currentQuestions.map((q: CustomFolderQuestion) => {
        if (q.questionId === questionId) {
          return {
            ...q,
            categoryId: categoryId || undefined,
          };
        }
        return q;
      });

      await updateDoc(folderRef, { questions: newQuestions });
    } catch (err) {
      console.error('문제 카테고리 배정 실패:', err);
      throw new Error('카테고리 배정에 실패했습니다.');
    }
  }, [user]);

  /**
   * 카테고리 이름 수정
   */
  const updateCategoryName = useCallback(async (
    folderId: string,
    categoryId: string,
    newName: string
  ): Promise<void> => {
    if (!user) return;

    try {
      const folderRef = doc(db, 'customFolders', folderId);
      const folderDoc = await getDoc(folderRef);

      if (!folderDoc.exists()) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const currentCategories = folderDoc.data().categories || [];
      const newCategories = currentCategories.map((cat: FolderCategory) => {
        if (cat.id === categoryId) {
          return { ...cat, name: newName };
        }
        return cat;
      });

      await updateDoc(folderRef, { categories: newCategories });
    } catch (err) {
      console.error('카테고리 이름 수정 실패:', err);
      throw new Error('카테고리 수정에 실패했습니다.');
    }
  }, [user]);

  // 그룹핑된 데이터 (useMemo로 메모이제이션하여 무한 루프 방지)
  const groupedWrongItems = useMemo(() => groupByQuiz(wrongItems), [wrongItems]);
  const chapterGroupedWrongItems = useMemo(
    () => groupByChapterAndQuiz(wrongItems, userCourseId || undefined),
    [wrongItems, userCourseId]
  );
  const groupedBookmarkedItems = useMemo(() => groupByQuiz(bookmarkedItems), [bookmarkedItems]);
  const groupedSolvedItems = useMemo(() => groupByQuiz(solvedItems), [solvedItems]);

  /**
   * 퀴즈의 문제 수정 여부 확인 (기본정보 수정은 제외)
   * 각 문제의 questionUpdatedAt과 저장된 quizUpdatedAt을 비교하여
   * 문제 내용이 수정되었는지 확인합니다.
   */
  const checkQuizQuestionUpdates = useCallback(async (
    quizId: string,
    savedQuizUpdatedAt: Timestamp | null
  ): Promise<boolean> => {
    if (!savedQuizUpdatedAt) return false;

    try {
      const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
      if (!quizDoc.exists()) return false;

      const quizData = quizDoc.data();
      const questions = quizData?.questions || [];
      const savedTime = savedQuizUpdatedAt.toMillis ? savedQuizUpdatedAt.toMillis() : 0;

      // 각 문제의 questionUpdatedAt을 확인하여 수정된 문제가 있는지 체크
      for (const q of questions) {
        const questionUpdatedAt = q.questionUpdatedAt;
        if (questionUpdatedAt) {
          const updatedTime = questionUpdatedAt.toMillis ? questionUpdatedAt.toMillis() : 0;
          // 문제가 저장 이후에 수정되었으면 업데이트 있음
          if (updatedTime > savedTime) {
            return true;
          }
        }
      }

      return false;
    } catch (err) {
      console.error('문제 수정 확인 실패:', err);
      return false;
    }
  }, []);

  // 퀴즈 업데이트 확인 (최초 로드 후 한 번만 실행)
  const updateCheckDoneRef = useRef(false);

  // loading/user/courseId가 바뀌면 체크 플래그 리셋
  useEffect(() => {
    updateCheckDoneRef.current = false;
  }, [user, userCourseId, refreshKey]);

  useEffect(() => {
    // 로딩 중이거나 이미 체크했으면 스킵
    if (loading) return;
    if (updateCheckDoneRef.current) return;
    if (wrongItems.length === 0 && bookmarkedItems.length === 0 && solvedItems.length === 0) return;

    updateCheckDoneRef.current = true;

    const checkAllUpdates = async () => {
      const newUpdatedQuizzes = new Map<string, QuizUpdateInfo>();

      // 오답 문제 업데이트 확인
      for (const group of groupedWrongItems) {
        if (group.items.length > 0 && group.items[0].quizUpdatedAt) {
          const hasQuestionUpdate = await checkQuizQuestionUpdates(
            group.quizId,
            group.items[0].quizUpdatedAt
          );
          if (hasQuestionUpdate) {
            newUpdatedQuizzes.set(`wrong-${group.quizId}`, {
              quizId: group.quizId,
              quizTitle: group.quizTitle,
              hasUpdate: true,
            });
          }
        }
      }

      // 찜한 문제 업데이트 확인
      for (const group of groupedBookmarkedItems) {
        if (group.items.length > 0 && group.items[0].quizUpdatedAt) {
          const hasQuestionUpdate = await checkQuizQuestionUpdates(
            group.quizId,
            group.items[0].quizUpdatedAt
          );
          if (hasQuestionUpdate) {
            newUpdatedQuizzes.set(`bookmark-${group.quizId}`, {
              quizId: group.quizId,
              quizTitle: group.quizTitle,
              hasUpdate: true,
            });
          }
        }
      }

      // 푼 문제 업데이트 확인
      for (const group of groupedSolvedItems) {
        if (group.items.length > 0 && group.items[0].quizUpdatedAt) {
          const hasQuestionUpdate = await checkQuizQuestionUpdates(
            group.quizId,
            group.items[0].quizUpdatedAt
          );
          if (hasQuestionUpdate) {
            newUpdatedQuizzes.set(`solved-${group.quizId}`, {
              quizId: group.quizId,
              quizTitle: group.quizTitle,
              hasUpdate: true,
            });
          }
        }
      }

      // 커스텀 폴더(내맘대로) 업데이트 확인
      // 폴더에 포함된 문제 중 수정된 문제가 있는지 확인
      for (const folder of customFolders) {
        const folderQuestions = folder.questions || [];
        if (folderQuestions.length === 0) continue;

        // 폴더 내 퀴즈별로 그룹핑
        const quizGroups = new Map<string, string[]>();
        for (const q of folderQuestions) {
          const existing = quizGroups.get(q.quizId) || [];
          existing.push(q.questionId);
          quizGroups.set(q.quizId, existing);
        }

        // 각 퀴즈에서 수정된 문제가 있는지 확인
        let hasAnyUpdate = false;
        for (const [quizId, questionIds] of quizGroups) {
          try {
            const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
            if (!quizDoc.exists()) continue;

            const quizData = quizDoc.data();
            const questions = quizData?.questions || [];

            // 폴더에 포함된 문제들 중 수정된 것이 있는지 확인
            for (const q of questions) {
              if (!questionIds.includes(q.id)) continue;

              const questionUpdatedAt = q.questionUpdatedAt;
              if (questionUpdatedAt) {
                const updatedTime = questionUpdatedAt.toMillis ? questionUpdatedAt.toMillis() : 0;
                // 폴더 생성 시간 이후에 수정되었으면 업데이트 있음
                const folderCreatedAt = folder.createdAt?.toMillis ? folder.createdAt.toMillis() : 0;
                if (updatedTime > folderCreatedAt) {
                  hasAnyUpdate = true;
                  break;
                }
              }
            }
            if (hasAnyUpdate) break;
          } catch (err) {
            console.error('커스텀 폴더 업데이트 확인 실패:', err);
          }
        }

        if (hasAnyUpdate) {
          newUpdatedQuizzes.set(`custom-${folder.id}`, {
            quizId: folder.id,
            quizTitle: folder.name,
            hasUpdate: true,
          });
        }
      }

      setUpdatedQuizzes(newUpdatedQuizzes);
    };

    checkAllUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, groupedWrongItems, groupedBookmarkedItems, groupedSolvedItems, customFolders, checkQuizQuestionUpdates]);

  // 푼 문제 추가 로드 (페이지네이션)
  const loadMoreSolved = useCallback(async () => {
    if (!hasMoreSolved || !solvedLastDocRef.current || !solvedQueryBaseRef.current) return;

    const PAGE_SIZE = 50;
    const nextQuery = query(
      solvedQueryBaseRef.current,
      startAfter(solvedLastDocRef.current),
      limit(PAGE_SIZE + 1)
    );

    const snapshot = await getDocs(nextQuery);
    const docs = snapshot.docs;
    const hasMore = docs.length > PAGE_SIZE;
    const pageDocs = hasMore ? docs.slice(0, PAGE_SIZE) : docs;

    const newItems: ReviewItem[] = pageDocs.map(mapDocToReviewItem);
    await fillQuizTitles(newItems);

    setSolvedItems(prev => [...prev, ...newItems]);
    setHasMoreSolved(hasMore);
    solvedLastDocRef.current = pageDocs.length > 0
      ? pageDocs[pageDocs.length - 1]
      : null;
  }, [hasMoreSolved, mapDocToReviewItem, fillQuizTitles]);

  // 오답 추가 로드 (페이지네이션)
  const loadMoreWrong = useCallback(async () => {
    if (!hasMoreWrong || !wrongLastDocRef.current || !wrongQueryBaseRef.current) return;

    const PAGE_SIZE = 100;
    const nextQuery = query(
      wrongQueryBaseRef.current,
      startAfter(wrongLastDocRef.current),
      limit(PAGE_SIZE + 1)
    );

    const snapshot = await getDocs(nextQuery);
    const docs = snapshot.docs;
    const hasMore = docs.length > PAGE_SIZE;
    const pageDocs = hasMore ? docs.slice(0, PAGE_SIZE) : docs;

    const newItems: ReviewItem[] = pageDocs.map(mapDocToReviewItem);
    await fillQuizTitles(newItems);

    setWrongItems(prev => [...prev, ...newItems]);
    setHasMoreWrong(hasMore);
    wrongLastDocRef.current = pageDocs.length > 0
      ? pageDocs[pageDocs.length - 1]
      : null;
  }, [hasMoreWrong, mapDocToReviewItem, fillQuizTitles]);

  // 찜한 문제 추가 로드 (페이지네이션)
  const loadMoreBookmark = useCallback(async () => {
    if (!hasMoreBookmark || !bookmarkLastDocRef.current || !bookmarkQueryBaseRef.current) return;

    const PAGE_SIZE = 100;
    const nextQuery = query(
      bookmarkQueryBaseRef.current,
      startAfter(bookmarkLastDocRef.current),
      limit(PAGE_SIZE + 1)
    );

    const snapshot = await getDocs(nextQuery);
    const docs = snapshot.docs;
    const hasMore = docs.length > PAGE_SIZE;
    const pageDocs = hasMore ? docs.slice(0, PAGE_SIZE) : docs;

    const newItems: ReviewItem[] = pageDocs.map(mapDocToReviewItem);
    await fillQuizTitles(newItems);

    setBookmarkedItems(prev => [...prev, ...newItems]);
    setHasMoreBookmark(hasMore);
    bookmarkLastDocRef.current = pageDocs.length > 0
      ? pageDocs[pageDocs.length - 1]
      : null;
  }, [hasMoreBookmark, mapDocToReviewItem, fillQuizTitles]);

  return {
    wrongItems,
    bookmarkedItems,
    solvedItems,
    hasMoreSolved,
    loadMoreSolved,
    hasMoreWrong,
    loadMoreWrong,
    hasMoreBookmark,
    loadMoreBookmark,
    groupedWrongItems,
    groupedBookmarkedItems,
    groupedSolvedItems,
    chapterGroupedWrongItems,
    quizAttempts,
    customFolders,
    privateQuizzes,
    updatedQuizzes,
    loading,
    error,
    deleteReviewItem,
    deleteSolvedQuiz,
    deleteWrongQuiz,
    deleteWrongQuizByChapter,
    deleteBookmarkQuiz,
    markAsReviewed,
    createCustomFolder,
    deleteCustomFolder,
    addToCustomFolder,
    removeFromCustomFolder,
    toggleQuestionBookmark,
    updateReviewItemsFromQuiz,
    refresh,
    addCategoryToFolder,
    removeCategoryFromFolder,
    assignQuestionToCategory,
    updateCategoryName,
    deletedItems,
    restoreDeletedItem,
    permanentlyDeleteItem,
  };
};

export default useReview;
