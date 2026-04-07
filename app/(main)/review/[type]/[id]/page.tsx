'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  Timestamp,
  limit,
  db,
  type DocumentData,
} from '@/lib/repositories';
import { callFunction } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { useReview, type ReviewItem, type FolderCategory, type CustomFolderQuestion } from '@/lib/hooks/useReview';
import { useCourse } from '@/lib/contexts/CourseContext';
import { useDetailPanel, useClosePanel, useDetailPosition, usePanelStatePreservation, usePanelLock, useUser } from '@/lib/contexts';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import dynamic from 'next/dynamic';
import { Skeleton, useExpToast } from '@/components/common';
import { EXP_REWARDS } from '@/lib/utils/expRewards';
import type { PracticeResult } from '@/components/review/ReviewPractice';

// 대형 컴포넌트 lazy load (2,513줄 — 복습 풀이 시에만 로드)
const ReviewPractice = dynamic(() => import('@/components/review/ReviewPractice'), { ssr: false });
// 퀴즈 수정 모드용 에디터 (lazy load)
const QuestionEditor = dynamic(() => import('@/components/quiz/create/QuestionEditor'));
import { formatChapterLabel, getChapterById, generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';
import { useHideNav } from '@/lib/hooks/useHideNav';
import { type FeedbackType, type ReviewFilter } from '@/components/review/types';
import { parseQuestionId, sortByQuestionId, createDisplayItems } from '@/lib/utils/reviewQuestionUtils';
import QuestionList from '@/components/quiz/create/QuestionList';
import type { QuestionData } from '@/components/quiz/create/questionTypes';
import AddQuestionsView from '@/components/review/AddQuestionsView';
import { convertToQuestionDataList } from '@/components/professor/library/professorLibraryUtils';
import { flattenQuestionsForSave } from '@/lib/utils/questionSerializer';
import FolderDetailHeader from '@/components/review/detail/FolderDetailHeader';
import QuestionListSection from '@/components/review/detail/QuestionListSection';
import FolderDetailBottomSheets from '@/components/review/detail/FolderDetailBottomSheets';
import EditMetadataSection from '@/components/review/detail/EditMetadataSection';

/**
 * 가로모드 페이지에서 3쪽으로 열리는 복습 연습 래퍼
 * mount 시 lockDetail, close/complete 시 closePanel
 */
function WidePagePractice({
  items,
  quizTitle,
  onComplete,
  onBeforeClose,
  currentUserId,
  showFeedback,
}: {
  items: ReviewItem[];
  quizTitle: string;
  onComplete: (results: PracticeResult[]) => void;
  onBeforeClose?: () => void;
  currentUserId?: string;
  showFeedback: boolean;
}) {
  const closePanel = useClosePanel();
  usePanelLock();

  const handleClose = useCallback(() => {
    onBeforeClose?.(); // 잠금 상태에서 호출 → 대기열에 콘텐츠 추가
    closePanel();
  }, [onBeforeClose, closePanel]);

  return (
    <ReviewPractice
      items={items}
      quizTitle={quizTitle}
      onComplete={(results) => { onComplete(results); handleClose(); }}
      onClose={handleClose}
      currentUserId={currentUserId}
      showFeedback={showFeedback}
      isPanelMode
    />
  );
}

/**
 * 폴더 상세 페이지
 * panelType/panelId가 주어지면 3쪽 패널 모드 (가로모드)
 */
interface FolderDetailPageProps {
  panelType?: string;
  panelId?: string;
  panelAutoStart?: string | null;
}

export default function FolderDetailPage({ panelType, panelId, panelAutoStart }: FolderDetailPageProps = {}) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { profile } = useUser();
  const isProfessor = profile?.role === 'professor';
  const { userCourse, userClassId } = useCourse();
  const { showExpToast } = useExpToast();
  const { lockDetail, unlockDetail, openDetail } = useDetailPanel();
  const closePanel = useClosePanel();
  const isWide = useWideMode();

  // 패널 모드: prop 우선, 없으면 라우트 params 폴백
  const isPanelMode = !!panelType;
  const folderType = panelType || (params.type as string); // solved, wrong, bookmark, custom
  const folderId = panelId || (params.id as string);

  // 최초 진입 시에만 슬라이드 애니메이션 (뒤로가기 시 재발동 방지)
  const [slideIn] = useState(() => {
    if (isPanelMode || typeof window === 'undefined') return false;
    const key = `visited_review_${folderId}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  });
  const chapterFilter = isPanelMode ? null : searchParams.get('chapter');
  const fromQuizPage = isPanelMode ? false : searchParams.get('from') === 'quiz';
  const autoStart = isPanelMode ? (panelAutoStart || null) : searchParams.get('autoStart');

  // 뒤로가기: 3쪽이면 잠금해제+승격, 2쪽이면 대기만 닫기 (useClosePanel이 자동 분기)
  const goBackToList = useCallback((filter?: string) => {
    if (isPanelMode) { closePanel(); return; }
    router.push(`/review?filter=${filter || folderType}`);
  }, [isPanelMode, closePanel, router, folderType]);

  // 과목별 리본 이미지
  // 교수: quiz(archive) 리본, 학생 solved/퀴즈 경유: quiz 리본, 나머지: review 리본
  const ribbonImage = (isProfessor || folderType === 'solved' || fromQuizPage)
    ? (userCourse?.quizRibbonImage || '/images/biology-quiz-ribbon.png')
    : (userCourse?.reviewRibbonImage || '/images/biology-review-ribbon.png');
  const ribbonScale = (isProfessor || folderType === 'solved' || fromQuizPage)
    ? (userCourse?.quizRibbonScale || 1)
    : (userCourse?.reviewRibbonScale || 1);

  const {
    groupedSolvedItems,
    groupedWrongItems,
    groupedBookmarkedItems,
    customFolders,
    solvedItems,
    wrongItems,
    addToCustomFolder,
    removeFromCustomFolder,
    deleteReviewItem,
    deleteCustomFolder,
    addCategoryToFolder,
    removeCategoryFromFolder,
    assignQuestionToCategory,
    loading: reviewLoading,
    markAsReviewed,
  } = useReview();

  const [customQuestions, setCustomQuestions] = useState<ReviewItem[]>([]);
  const [customLoading, setCustomLoading] = useState(false);
  // 서재(library) 퀴즈 상태
  const [libraryQuestions, setLibraryQuestions] = useState<ReviewItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  // 찜 퀴즈 폴백 상태 (reviews에 bookmark 타입 문제가 없을 때 퀴즈 문서에서 로드)
  const [bookmarkFallbackQuestions, setBookmarkFallbackQuestions] = useState<ReviewItem[]>([]);
  const [bookmarkFallbackLoading, setBookmarkFallbackLoading] = useState(false);
  const [bookmarkFallbackTitle, setBookmarkFallbackTitle] = useState('');
  const [libraryQuizTitle, setLibraryQuizTitle] = useState<string>('');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [practiceItems, setPracticeItems] = useState<ReviewItem[] | null>(null);
  const [practiceMode, setPracticeMode] = useState<'all' | 'wrongOnly' | null>(null); // 복습 모드 (첫복습점수 저장용)
  const practiceModeRef = useRef<'all' | 'wrongOnly' | null>(null);
  // practiceMode 변경 시 ref 동기화 (useCallback 클로저 문제 방지)
  useEffect(() => { practiceModeRef.current = practiceMode; }, [practiceMode]);

  // 패널 모드 연습: 시작 시 잠금, 종료 시 해제 (3쪽에서만 — 2쪽 cleanup이 3쪽 잠금 해제 방지)
  const hasPracticeItems = !!practiceItems;
  const position = useDetailPosition();
  useEffect(() => {
    if (isPanelMode && hasPracticeItems && position === 'detail') {
      lockDetail();
      return () => unlockDetail();
    }
  }, [isPanelMode, hasPracticeItems, position, lockDetail, unlockDetail]);

  // 승격 시 practiceItems/practiceMode 보존 (연습 중 승격 시 연습 상태 유지)
  usePanelStatePreservation(
    'folder-detail',
    () => isPanelMode ? ({ practiceItems, practiceMode }) : ({}),
    (saved) => {
      if (saved.practiceItems) setPracticeItems(saved.practiceItems as ReviewItem[]);
      if (saved.practiceMode) setPracticeMode(saved.practiceMode as 'all' | 'wrongOnly');
    },
  );

  const [isAddMode, setIsAddMode] = useState(false);
  const [showEmptyMessage, setShowEmptyMessage] = useState(false);

  // 폴더/서재 삭제 모달 상태
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // 토스트 메시지 상태
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 토스트 표시 함수
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2000);
  };

  // 결합형 그룹 펼침 상태
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  // 퀴즈별 생성자 ID 맵 (자기 문제 피드백 방지용)
  const [quizCreatorsMap, setQuizCreatorsMap] = useState<Map<string, string>>(new Map());
  // 퀴즈별 AI 생성 여부 맵 (AI 문제 피드백 방지용)
  const [quizAiMap, setQuizAiMap] = useState<Map<string, boolean>>(new Map());

  // 카테고리 관련 상태
  const [isCategoryMode, setIsCategoryMode] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAssignMode, setIsAssignMode] = useState(false);
  const [selectedCategoryForAssign, setSelectedCategoryForAssign] = useState<string | null>(null);

  // 퀴즈 점수 상태 (solved/bookmark 타입용)
  const [quizScores, setQuizScores] = useState<{ myScore?: number; myFirstReviewScore?: number; averageScore?: number; isPublic?: boolean } | null>(null);

  // 수정된 문제 ID 집합 (문제별 뱃지 표시용)
  const [updatedQuestionIds, setUpdatedQuestionIds] = useState<Set<string>>(new Set());

  // 수정 모드 상태 (QuestionList + QuestionEditor 방식 — 교수 서재와 동일)
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editableQuestions, setEditableQuestions] = useState<QuestionData[]>([]);
  const [originalQuestions, setOriginalQuestions] = useState<Record<string, any>[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDifficulty, setEditDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal');
  const [editedTags, setEditedTags] = useState<string[]>([]);
  const [showEditTagPicker, setShowEditTagPicker] = useState(false);

  const loadedFolderRef = useRef<string | null>(null);
  const supplementedExpsRef = useRef<string | null>(null);

  // 네비게이션 숨김
  useHideNav(!isPanelMode); // 패널 모드에서는 네비게이션 숨기지 않음

  // 커스텀 폴더 찾기
  const customFolder = useMemo(() => {
    if (folderType === 'custom') {
      return customFolders.find(f => f.id === folderId) || null;
    }
    return null;
  }, [folderType, folderId, customFolders]);

  // 폴더 데이터 계산 (useMemo로 무한 루프 방지)
  const folderData = useMemo(() => {
    if (folderType === 'library') {
      // 서재 타입: 비동기로 로드됨
      return libraryQuizTitle ? { title: libraryQuizTitle, items: libraryQuestions } : null;
    } else if (folderType === 'solved') {
      const group = groupedSolvedItems.find(g => g.quizId === folderId);
      return group ? { title: group.quizTitle, items: group.items } : null;
    } else if (folderType === 'wrong') {
      const group = groupedWrongItems.find(g => g.quizId === folderId);
      if (!group) return null;
      // 챕터 필터가 있으면 해당 챕터의 문제만 필터링
      const filteredItems = chapterFilter
        ? group.items.filter(item => item.chapterId === chapterFilter)
        : group.items;
      return { title: group.quizTitle, items: filteredItems };
    } else if (folderType === 'bookmark') {
      // 1) bookmark 리뷰에서 찾기 (개별 문제 찜)
      const bookmarkGroup = groupedBookmarkedItems.find(g => g.quizId === folderId);
      if (bookmarkGroup) return { title: bookmarkGroup.quizTitle, items: bookmarkGroup.items };
      // 2) solved 리뷰에서 폴백 (퀴즈 레벨만 찜한 경우, 풀이 기록이 있으면 사용)
      const solvedGroup = groupedSolvedItems.find(g => g.quizId === folderId);
      if (solvedGroup) return { title: solvedGroup.quizTitle, items: solvedGroup.items };
      // 3) 퀴즈 문서에서 직접 로드한 폴백 데이터
      if (bookmarkFallbackTitle) return { title: bookmarkFallbackTitle, items: bookmarkFallbackQuestions };
      return null;
    } else if (folderType === 'custom' && customFolder) {
      return { title: customFolder.name, items: null as ReviewItem[] | null };
    }
    return null;
  }, [folderType, folderId, groupedSolvedItems, groupedWrongItems, groupedBookmarkedItems, customFolder, chapterFilter, libraryQuizTitle, libraryQuestions, bookmarkFallbackTitle, bookmarkFallbackQuestions]);

  // 비서재 타입(wrong/solved/bookmark)에서 choiceExplanations가 빠진 경우 퀴즈 문서에서 보충
  useEffect(() => {
    if (!user || folderType === 'library') return;
    if (!folderData?.items || folderData.items.length === 0) return;
    if (supplementedExpsRef.current === folderId) return;

    const hasMissing = folderData.items.some(
      item => !item.choiceExplanations && item.type === 'multiple'
    );
    if (!hasMissing) return;

    const supplementExps = async () => {
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
        if (!quizDoc.exists()) return;
        const questions = quizDoc.data().questions || [];
        const expsMap: Record<string, string[]> = {};
        questions.forEach((q: DocumentData, idx: number) => {
          if (q.choiceExplanations?.length > 0) {
            expsMap[q.id || `q${idx}`] = q.choiceExplanations;
            expsMap[(idx + 1).toString()] = q.choiceExplanations;
          }
        });

        let changed = false;
        folderData.items?.forEach(item => {
          if (!item.choiceExplanations && item.type === 'multiple') {
            const exps = expsMap[item.questionId] || expsMap[item.questionId?.replace(/^q/, '')];
            if (exps) {
              item.choiceExplanations = exps;
              changed = true;
            }
          }
        });

        if (changed) {
          supplementedExpsRef.current = folderId;
          setUpdatedQuestionIds(prev => new Set(prev));
        }
      } catch (e) {
        console.error('choiceExplanations 보충 오류:', e);
      }
    };

    supplementExps();
  }, [user, folderType, folderId, folderData]);

  // 커스텀 폴더일 때만 비동기로 문제 로드
  useEffect(() => {
    if (!user || folderType !== 'custom' || !customFolder) return;
    if (loadedFolderRef.current === folderId) return;

    const loadCustomQuestions = async () => {
      setCustomLoading(true);

      // 교수: reviews가 없으므로 quizzes 문서에서 직접 로드
      if (isProfessor) {
        const quizGroups = new Map<string, string[]>();
        for (const q of customFolder.questions) {
          const ids = quizGroups.get(q.quizId) || [];
          ids.push(q.questionId);
          quizGroups.set(q.quizId, ids);
        }
        const items: ReviewItem[] = [];
        for (const [quizId, questionIds] of quizGroups) {
          try {
            const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
            if (!quizDoc.exists()) continue;
            const quizData = quizDoc.data();
            const quizQuestions = quizData.questions || [];
            const quizTitle = quizData.title || '';
            for (const qId of questionIds) {
              // 결합형 문제: q1_0 → q1 (부모 ID로 매칭)
              const parentId = qId.includes('_') ? qId.split('_').slice(0, -1).join('_') : qId;
              const matched = quizQuestions.find((qq: DocumentData, idx: number) =>
                (qq.id || `q${idx}`) === qId || (qq.id || `q${idx}`) === parentId
              );
              if (matched) {
                items.push({
                  id: `${quizId}_${qId}`,
                  userId: user.uid,
                  quizId,
                  quizTitle,
                  questionId: qId,
                  question: matched.question || matched.text || '',
                  type: matched.type || 'multiple',
                  options: matched.options || matched.choices || [],
                  correctAnswer: String(matched.answer ?? matched.correctAnswer ?? ''),
                  userAnswer: '',
                  isCorrect: true,
                  reviewType: 'solved',
                  isBookmarked: false,
                  reviewCount: 0,
                  courseId: quizData.courseId || '',
                  explanation: matched.explanation || '',
                  choiceExplanations: matched.choiceExplanations || [],
                  chapterId: matched.chapterId || '',
                  createdAt: quizData.createdAt || null,
                } as unknown as ReviewItem);
              }
            }
          } catch {}
        }
        setCustomQuestions(sortByQuestionId(items));
        loadedFolderRef.current = folderId;
        setCustomLoading(false);
        return;
      }

      // 학생: reviews에서 조회
      // quizId별로 questionId 그룹화 (in 쿼리 일괄 조회용)
      const quizGroups = new Map<string, string[]>();
      for (const q of customFolder.questions) {
        const ids = quizGroups.get(q.quizId) || [];
        ids.push(q.questionId);
        quizGroups.set(q.quizId, ids);
      }

      // quizId별로 병렬 일괄 쿼리 (in 쿼리 최대 30개씩)
      const batchPromises: Promise<ReviewItem[]>[] = [];
      for (const [quizId, questionIds] of quizGroups) {
        for (let i = 0; i < questionIds.length; i += 30) {
          const batch = questionIds.slice(i, i + 30);
          batchPromises.push((async () => {
            const snap = await getDocs(query(
              collection(db, 'reviews'),
              where('userId', '==', user.uid),
              where('quizId', '==', quizId),
              where('questionId', 'in', batch),
              where('reviewType', '==', 'solved')
            ));
            return snap.docs.map(d => {
              const data = d.data();
              return {
                id: d.id,
                ...data,
                reviewCount: data.reviewCount || 0,
              } as ReviewItem;
            });
          })());
        }
      }

      const results = await Promise.all(batchPromises);
      const items = results.flat();

      // questionId 기준으로 정렬 (결합형 문제 순서 유지)
      setCustomQuestions(sortByQuestionId(items));
      loadedFolderRef.current = folderId;
      setCustomLoading(false);
    };

    loadCustomQuestions();
  }, [user, folderType, folderId, customFolder]);

  // 서재(library) 퀴즈 로드
  useEffect(() => {
    if (!user || folderType !== 'library') return;

    const loadLibraryQuiz = async () => {
      setLibraryLoading(true);
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));

        // quizResults에서 사용자 풀이 결과 가져오기
        const resultQuery = query(
          collection(db, 'quizResults'),
          where('userId', '==', user.uid),
          where('quizId', '==', folderId)
        );
        const resultDocs = await getDocs(resultQuery);

        // 가장 최근 결과의 questionScores 가져오기
        let questionScores: Record<string, any> = {};
        if (!resultDocs.empty) {
          const sorted = resultDocs.docs.sort((a, b) => {
            const aTime = a.data().createdAt?.toMillis?.() || 0;
            const bTime = b.data().createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          });
          questionScores = sorted[0].data().questionScores || {};
        }

        // 삭제된 퀴즈: reviews 컬렉션에서 폴백 로드 (solved만 — wrong은 중복)
        if (!quizDoc.exists()) {
          const reviewFallbackQuery = query(
            collection(db, 'reviews'),
            where('userId', '==', user.uid),
            where('quizId', '==', folderId),
            where('reviewType', '==', 'solved')
          );
          const reviewFallbackDocs = await getDocs(reviewFallbackQuery);
          if (reviewFallbackDocs.empty) {
            setLibraryQuestions([]);
            setLibraryQuizTitle('퀴즈');
            setLibraryLoading(false);
            return;
          }
          // reviews에서 퀴즈 제목 추출
          const firstReview = reviewFallbackDocs.docs[0].data();
          setLibraryQuizTitle(firstReview.quizTitle || '퀴즈');
          // reviews를 ReviewItem으로 변환
          const fallbackItems: ReviewItem[] = reviewFallbackDocs.docs.map(d => {
            const data = d.data();
            return {
              id: d.id,
              reviewId: d.id,
              userId: user.uid,
              quizId: folderId,
              quizTitle: data.quizTitle || '퀴즈',
              questionId: data.questionId || '',
              question: data.question || '',
              type: data.type || 'multiple',
              options: data.options || [],
              correctAnswer: data.correctAnswer || '',
              userAnswer: data.userAnswer || '',
              explanation: data.explanation || '',
              choiceExplanations: data.choiceExplanations || undefined,
              reviewType: data.reviewType || 'solved',
              isBookmarked: data.isBookmarked || false,
              isCorrect: data.isCorrect,
              reviewCount: data.reviewCount || 0,
              lastReviewedAt: data.lastReviewedAt || null,
              createdAt: data.createdAt,
              image: data.image || undefined,
              imageUrl: data.imageUrl || undefined,
              passage: data.passage || undefined,
              passageType: data.passageType || undefined,
              passageImage: data.passageImage || undefined,
              koreanAbcItems: data.koreanAbcItems || undefined,
              passageMixedExamples: data.passageMixedExamples || undefined,
              commonQuestion: data.commonQuestion || undefined,
              mixedExamples: data.passageBlocks || data.mixedExamples || undefined,
              bogi: data.bogi || undefined,
              subQuestionOptions: data.subQuestionOptions || undefined,
              subQuestionOptionsType: data.subQuestionOptionsType || undefined,
              subQuestionImage: data.subQuestionImage || undefined,
              passagePrompt: data.passagePrompt || undefined,
              bogiQuestionText: data.bogiQuestionText || undefined,
              combinedGroupId: data.combinedGroupId || undefined,
              combinedIndex: data.combinedIndex,
              combinedTotal: data.combinedTotal,
              quizCreatorId: data.quizCreatorId || undefined,
            };
          });
          setLibraryQuestions(sortByQuestionId(fallbackItems));
          setLibraryLoading(false);
          return;
        }

        const quizData = quizDoc.data();
        setLibraryQuizTitle(quizData.title || '퀴즈');

        // reviews 컬렉션에서 choiceExplanations 가져오기 (퀴즈 문서에 없을 수 있음)
        const reviewQuery = query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('quizId', '==', folderId),
          where('reviewType', '==', 'solved')
        );
        const reviewDocs = await getDocs(reviewQuery);
        const reviewChoiceExplanationsMap: Record<string, string[]> = {};
        reviewDocs.docs.forEach(d => {
          const data = d.data();
          if (data.choiceExplanations && Array.isArray(data.choiceExplanations) && data.choiceExplanations.length > 0) {
            reviewChoiceExplanationsMap[data.questionId] = data.choiceExplanations;
          }
        });
        // questions 배열을 ReviewItem 형식으로 변환
        const questions = quizData.questions || [];


        const items: ReviewItem[] = questions.map((q: DocumentData, idx: number) => {
          // 정답 변환 (0-indexed 그대로)
          let correctAnswer = '';
          if (q.type === 'multiple') {
            if (Array.isArray(q.answer)) {
              correctAnswer = q.answer.map((a: number) => String(a)).join(',');
            } else {
              correctAnswer = String(q.answer ?? 0);
            }
          } else if (q.type === 'ox') {
            correctAnswer = q.answer === 0 ? 'O' : 'X';
          } else {
            correctAnswer = String(q.answer ?? '');
          }

          // 사용자 답변 변환 (0-indexed 그대로)
          let userAnswer = '';
          if (q.userAnswer !== undefined && q.userAnswer !== null) {
            if (q.type === 'multiple') {
              if (Array.isArray(q.userAnswer)) {
                userAnswer = q.userAnswer.map((a: number) => String(Number(a))).join(',');
              } else if (typeof q.userAnswer === 'number') {
                userAnswer = String(q.userAnswer);
              } else {
                userAnswer = String(q.userAnswer);
              }
            } else if (q.type === 'ox') {
              const ua = typeof q.userAnswer === 'number' ? q.userAnswer : Number(q.userAnswer);
              if (ua === 0 || q.userAnswer === 'O') userAnswer = 'O';
              else if (ua === 1 || q.userAnswer === 'X') userAnswer = 'X';
              else userAnswer = String(q.userAnswer);
            } else {
              userAnswer = String(q.userAnswer);
            }
          }

          // quizResults에서 해당 문제 결과 가져오기
          const questionId = q.id || `q${idx}`;
          const scoreData = questionScores[questionId];

          // scoreData.userAnswer (0-indexed 그대로 사용)
          let finalUserAnswer = userAnswer;
          if (scoreData?.userAnswer !== undefined) {
            finalUserAnswer = String(scoreData.userAnswer);
          }

          return {
            id: `library-${folderId}-${q.id || `q${idx}`}`,
            userId: user.uid,
            quizId: folderId,
            quizTitle: quizData.title || '퀴즈',
            questionId: q.id || `q${idx}`,
            question: q.text || '',
            type: q.type || 'multiple',
            options: q.choices || [],
            correctAnswer,
            userAnswer: finalUserAnswer,
            explanation: q.explanation || '',
            choiceExplanations: q.choiceExplanations || reviewChoiceExplanationsMap[q.id || `q${idx}`] || undefined,
            reviewType: scoreData?.isCorrect === false ? 'wrong' as const : 'solved' as const,
            isBookmarked: false,
            isCorrect: scoreData?.isCorrect ?? (q.isCorrect !== undefined ? q.isCorrect : undefined),
            reviewCount: 0,
            lastReviewedAt: null,
            createdAt: quizData.createdAt,
            // 이미지
            image: q.image || undefined,
            imageUrl: q.imageUrl || undefined,
            // 제시문
            passage: q.passage || undefined,
            passageType: q.passageType || undefined,
            passageImage: q.passageImage || undefined,
            koreanAbcItems: q.koreanAbcItems || undefined,
            passageMixedExamples: q.passageMixedExamples || undefined,
            commonQuestion: q.commonQuestion || undefined,
            // 보기 — passageBlocks 우선
            mixedExamples: q.passageBlocks || q.mixedExamples || undefined,
            bogi: q.bogi || undefined,
            subQuestionOptions: q.subQuestionOptions || undefined,
            subQuestionOptionsType: q.subQuestionOptionsType || undefined,
            subQuestionImage: q.subQuestionImage || undefined,
            // 발문
            passagePrompt: q.passagePrompt || undefined,
            bogiQuestionText: q.bogiQuestionText || undefined,
            // 결합형
            combinedGroupId: q.combinedGroupId || undefined,
            combinedIndex: q.combinedIndex,
            combinedTotal: q.combinedTotal,
            // 기타
            quizCreatorId: quizData.creatorId || undefined,
          };
        });

        setLibraryQuestions(sortByQuestionId(items));
      } catch (err) {
        console.error('서재 퀴즈 로드 오류:', err);
        setLibraryQuestions([]);
        setLibraryQuizTitle('');
      }
      setLibraryLoading(false);
    };

    loadLibraryQuiz();
  }, [user, folderType, folderId]);

  // 찜 퀴즈 폴백 로드 (bookmark 리뷰도 solved 리뷰도 없을 때 퀴즈 문서에서 직접 로드)
  useEffect(() => {
    if (!user || folderType !== 'bookmark') return;
    if (reviewLoading) return; // useReview 로딩 완료 대기

    // bookmark 또는 solved 리뷰가 있으면 폴백 불필요
    const hasBookmarkReviews = groupedBookmarkedItems.some(g => g.quizId === folderId);
    const hasSolvedReviews = groupedSolvedItems.some(g => g.quizId === folderId);
    if (hasBookmarkReviews || hasSolvedReviews) return;

    const loadBookmarkFallback = async () => {
      setBookmarkFallbackLoading(true);
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
        if (!quizDoc.exists()) {
          setBookmarkFallbackQuestions([]);
          setBookmarkFallbackTitle('');
          setBookmarkFallbackLoading(false);
          return;
        }

        const quizData = quizDoc.data();
        setBookmarkFallbackTitle(quizData.title || '퀴즈');

        const rawQuestions = quizData.questions || [];
        const items: ReviewItem[] = rawQuestions.map((q: Record<string, any>, idx: number) => {
          let correctAnswer = '';
          if (q.type === 'multiple') {
            if (Array.isArray(q.answer)) {
              correctAnswer = q.answer.map((a: number) => String(a)).join(',');
            } else {
              correctAnswer = String(q.answer ?? 0);
            }
          } else if (q.type === 'ox') {
            correctAnswer = q.answer === 0 ? 'O' : 'X';
          } else {
            correctAnswer = String(q.answer ?? '');
          }

          const questionId = q.id || `q${idx}`;
          return {
            id: `fallback-${folderId}-${questionId}`,
            userId: user.uid,
            quizId: folderId,
            quizTitle: quizData.title || '퀴즈',
            questionId,
            question: q.question || q.text || '',
            type: q.type === 'short' ? 'short_answer' : (q.type || 'multiple'),
            options: q.choices || q.options || [],
            correctAnswer,
            userAnswer: '',
            explanation: q.explanation || '',
            reviewType: 'bookmark' as const,
            isBookmarked: true,
            isCorrect: undefined,
            reviewCount: 0,
            lastReviewedAt: null,
            createdAt: quizData.createdAt || Timestamp.now(),
            // 결합형 문제 필드
            combinedGroupId: q.combinedGroupId,
            combinedIndex: q.combinedIndex,
            combinedTotal: q.combinedTotal,
            passage: q.passage,
            passageType: q.passageType,
            passageImage: q.passageImage,
            koreanAbcItems: q.koreanAbcItems,
            passageMixedExamples: q.passageMixedExamples,
            commonQuestion: q.commonQuestion,
            image: q.image || q.imageUrl,
            mixedExamples: q.passageBlocks || q.mixedExamples,
            subQuestionOptions: q.subQuestionOptions,
            subQuestionOptionsType: q.subQuestionOptionsType,
            subQuestionImage: q.subQuestionImage,
            choiceExplanations: q.choiceExplanations,
            passagePrompt: q.passagePrompt,
            bogiQuestionText: q.bogiQuestionText,
            bogi: q.bogi,
          } as ReviewItem;
        });

        setBookmarkFallbackQuestions(sortByQuestionId(items));
      } catch (err) {
        console.error('찜 퀴즈 폴백 로드 실패:', err);
        setBookmarkFallbackQuestions([]);
        setBookmarkFallbackTitle('');
      }
      setBookmarkFallbackLoading(false);
    };

    loadBookmarkFallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, folderType, folderId, reviewLoading, groupedBookmarkedItems, groupedSolvedItems]);

  // 최종 데이터
  const baseFolderTitle = folderData?.title || '';
  // 챕터 필터가 있으면 제목에 챕터 정보 추가
  const chapterName = chapterFilter && userCourse?.id
    ? getChapterById(userCourse.id, chapterFilter)?.name
    : null;
  const folderTitle = chapterName ? `${baseFolderTitle} (${chapterName})` : baseFolderTitle;
  const questions = folderType === 'library'
    ? libraryQuestions
    : folderType === 'custom'
      ? customQuestions
      : (folderData?.items || []);

  // 퀴즈별 creatorId 로드 (자기 문제 피드백 방지용)
  useEffect(() => {
    if (questions.length === 0) return;

    const loadQuizCreators = async () => {
      // 고유한 quizId 목록
      const quizIds = [...new Set(questions.map(q => q.quizId))];
      const newCreatorMap = new Map<string, string>();
      const newAiMap = new Map<string, boolean>();

      for (const quizId of quizIds) {
        // 이미 로드된 것은 스킵
        if (quizCreatorsMap.has(quizId)) {
          newCreatorMap.set(quizId, quizCreatorsMap.get(quizId)!);
          newAiMap.set(quizId, quizAiMap.get(quizId) || false);
          continue;
        }

        try {
          const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
          if (quizDoc.exists()) {
            const data = quizDoc.data();
            if (data?.creatorId) {
              newCreatorMap.set(quizId, data.creatorId);
            }
            newAiMap.set(quizId, data?.isAiGenerated || data?.type === 'ai-generated' || false);
          }
        } catch (err) {
          console.error(`퀴즈 ${quizId} creatorId 로드 실패:`, err);
        }
      }

      if (newCreatorMap.size > 0) {
        setQuizCreatorsMap(prev => {
          const merged = new Map(prev);
          newCreatorMap.forEach((v, k) => merged.set(k, v));
          return merged;
        });
      }
      if (newAiMap.size > 0) {
        setQuizAiMap(prev => {
          const merged = new Map(prev);
          newAiMap.forEach((v, k) => merged.set(k, v));
          return merged;
        });
      }
    };

    loadQuizCreators();
  }, [questions]);

  // 문제별 수정 여부 체크 (문제 아코디언 뱃지 표시용)
  useEffect(() => {
    if (questions.length === 0) return;
    // bookmark 타입은 문제지 단위만 표시하므로 문제별 뱃지 불필요
    if (folderType === 'bookmark') return;

    const checkQuestionUpdates = async () => {
      const newUpdatedIds = new Set<string>();
      // 고유 quizId별로 그룹화
      const quizIdToItems = new Map<string, ReviewItem[]>();
      for (const q of questions) {
        const list = quizIdToItems.get(q.quizId) || [];
        list.push(q);
        quizIdToItems.set(q.quizId, list);
      }

      for (const [quizId, items] of quizIdToItems) {
        try {
          const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
          if (!quizDoc.exists()) continue;

          const quizData = quizDoc.data();
          const quizQuestions = quizData?.questions || [];

          // quizQuestions를 questionId로 매핑
          const questionMap = new Map<string, DocumentData>();
          quizQuestions.forEach((q: DocumentData, idx: number) => {
            const qId = q.id || `q${idx}`;
            questionMap.set(qId, q);
          });

          for (const item of items) {
            const savedTime = item.quizUpdatedAt?.toMillis?.() || 0;
            if (!savedTime) continue;

            const quizQuestion = questionMap.get(item.questionId);
            if (!quizQuestion?.questionUpdatedAt) continue;

            const questionTime = quizQuestion.questionUpdatedAt.toMillis
              ? quizQuestion.questionUpdatedAt.toMillis()
              : 0;

            if (questionTime > savedTime) {
              newUpdatedIds.add(item.questionId);
            }
          }
        } catch (err) {
          console.error(`퀴즈 ${quizId} 문제 수정 여부 확인 실패:`, err);
        }
      }

      setUpdatedQuestionIds(newUpdatedIds);
    };

    checkQuestionUpdates();
  }, [questions, folderType]);

  // solved/bookmark/library 타입일 때 퀴즈 점수 가져오기
  useEffect(() => {
    if (!user || (folderType !== 'solved' && folderType !== 'bookmark' && folderType !== 'library')) {
      setQuizScores(null);
      return;
    }

    const loadQuizScores = async () => {
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
        if (quizDoc.exists()) {
          const data = quizDoc.data();
          let myScore = data.userScores?.[user.uid] ?? data.score;

          // userScores에 점수가 없으면 quizResults에서 폴백 조회
          if (myScore === undefined || myScore === null) {
            try {
              const resultsQuery = query(
                collection(db, 'quizResults'),
                where('userId', '==', user.uid),
                where('quizId', '==', folderId)
              );
              const resultsSnap = await getDocs(resultsQuery);
              if (!resultsSnap.empty) {
                // 퀴즈 점수(isReviewPractice 아닌 것) 우선, 없으면 복습 점수 사용
                const quizResult = resultsSnap.docs.find(d => !d.data().isReviewPractice);
                const anyResult = quizResult || resultsSnap.docs[0];
                myScore = anyResult.data().score;
              }
            } catch { /* 폴백 실패 무시 */ }
          }

          setQuizScores({
            myScore,
            myFirstReviewScore: data.userFirstReviewScores?.[user.uid],
            averageScore: Math.min(data.averageScore || 0, 100),
            isPublic: data.isPublic ?? false,
          });
        }
      } catch (err) {
        console.error('퀴즈 점수 로드 실패:', err);
      }
    };

    loadQuizScores();
  }, [user, folderType, folderId]);

  const loading = folderType === 'library'
    ? libraryLoading
    : folderType === 'custom'
      ? customLoading
      : folderType === 'bookmark'
        ? (!folderData && (reviewLoading || bookmarkFallbackLoading))
        : !folderData;

  // displayItems 계산 (결합형 문제 그룹핑)
  const displayItems = useMemo(() => {
    return createDisplayItems(questions);
  }, [questions]);

  // 결합형 그룹 펼침/접힘 토글
  const toggleGroupExpand = useCallback((groupId: string) => {
    setExpandedGroupIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  }, []);

  // 문제 선택/해제
  const handleSelectQuestion = (questionId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(questionId)) {
      newSelected.delete(questionId);
    } else {
      newSelected.add(questionId);
    }
    setSelectedIds(newSelected);
  };

  // 선택된 문제로 연습 시작 (전체 복습)
  const handleStartPractice = () => {
    const targetItems = selectedIds.size === 0
      ? questions
      : questions.filter(q => selectedIds.has(q.id));

    if (targetItems.length === 0) {
      // 복습할 문제가 없으면 임시 메시지 표시
      setShowEmptyMessage(true);
      setTimeout(() => setShowEmptyMessage(false), 500);
      return;
    }

    setPracticeMode('all');

    // 가로모드 + 페이지: 기존 3쪽 잠금 해제 후 새 복습 열기
    if (isWide && !isPanelMode) {
      unlockDetail(true);
      openDetail(
        <WidePagePractice
          items={targetItems}
          quizTitle={folderTitle}
          onComplete={(results) => handlePracticeCompleteRef.current(results)}
          onBeforeClose={() => {
            openDetail(<FolderDetailPage panelType={folderType} panelId={folderId} />, `/review/${folderType}/${folderId}`);
            router.replace('/review');
          }}
          currentUserId={user?.uid}
          showFeedback={folderType !== 'library'}
        />,
        `/review/${folderType}/${folderId}`
      );
    } else {
      setPracticeItems(targetItems);
    }

    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  // 오답만 복습하기
  const handleStartWrongOnlyPractice = () => {
    // 현재 questions 중에서 wrongItems에도 있는 것만 필터링
    const wrongQuestionKeys = new Set(
      wrongItems
        .filter(w => w.quizId === folderId)
        .map(w => `${w.quizId}:${w.questionId}`)
    );

    const wrongOnlyItems = questions.filter(q =>
      wrongQuestionKeys.has(`${q.quizId}:${q.questionId}`)
    );

    if (wrongOnlyItems.length === 0) {
      showToast('이 문제지에 오답이 없습니다');
      return;
    }

    setPracticeMode('wrongOnly');

    // 가로모드 + 페이지: 기존 3쪽 잠금 해제 후 새 복습 열기
    if (isWide && !isPanelMode) {
      unlockDetail(true);
      openDetail(
        <WidePagePractice
          items={wrongOnlyItems}
          quizTitle={folderTitle}
          onComplete={(results) => handlePracticeCompleteRef.current(results)}
          onBeforeClose={() => {
            openDetail(<FolderDetailPage panelType={folderType} panelId={folderId} />, `/review/${folderType}/${folderId}`);
            router.replace('/review');
          }}
          currentUserId={user?.uid}
          showFeedback={folderType !== 'library'}
        />,
        `/review/${folderType}/${folderId}`
      );
    } else {
      setPracticeItems(wrongOnlyItems);
    }

    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  // 수정 모드 진입 핸들러 (퀴즈 문서에서 questions 로드 → QuestionData 변환)
  const handleEnterEditMode = async () => {
    setEditedTitle(libraryQuizTitle);
    setEditingIndex(null);
    setShowEditTagPicker(false);

    try {
      const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
      if (quizDoc.exists()) {
        const data = quizDoc.data();
        const questions = data.questions || [];
        setOriginalQuestions(questions);
        setEditableQuestions(convertToQuestionDataList(questions));
        setEditDifficulty(data.difficulty || 'normal');
        setEditedTags(data.tags || []);
      }
    } catch (err) {
      console.error('퀴즈 로드 실패:', err);
    }

    setIsEditMode(true);
  };

  // 수정 모드 저장 핸들러 (QuestionData → Firestore 형식 변환 후 저장)
  const handleSaveEdits = async () => {
    if (editableQuestions.length < 1) return;

    setIsSavingEdit(true);
    try {
      const updateData: Record<string, any> = {};
      const titleChanged = editedTitle.trim() && editedTitle.trim() !== libraryQuizTitle;

      if (titleChanged) {
        updateData.title = editedTitle.trim();
      }

      const flattenedQuestions = flattenQuestionsForSave(editableQuestions, originalQuestions, { cleanupUndefined: true });
      updateData.questions = flattenedQuestions;
      updateData.totalQuestions = flattenedQuestions.length;
      updateData.difficulty = editDifficulty;
      updateData.tags = editedTags;

      await updateDoc(doc(db, 'quizzes', folderId), updateData);

      // 로컬 state 갱신
      if (titleChanged) {
        setLibraryQuizTitle(editedTitle.trim());
      }

      // libraryQuestions 갱신 — 저장된 문제 데이터로 재구성
      setLibraryQuestions(flattenedQuestions.map((q: Record<string, any>, idx: number) => {
        const qId = q.id || `q${idx}`;
        // 기존 libraryQuestions에서 매칭되는 항목 찾기
        const existing = libraryQuestions.find(lq => lq.questionId === qId);

        let correctAnswer = '';
        if (q.type === 'multiple') {
          correctAnswer = Array.isArray(q.answer) ? q.answer.map(String).join(',') : String(q.answer ?? 0);
        } else if (q.type === 'ox') {
          correctAnswer = q.answer === 0 ? 'O' : 'X';
        } else {
          correctAnswer = String(q.answer ?? '');
        }

        return {
          ...(existing || {}),
          id: existing?.id || `temp_${qId}`,
          questionId: qId,
          quizId: folderId,
          question: q.text || '',
          type: q.type || 'multiple',
          options: q.choices || [],
          correctAnswer,
          explanation: q.explanation || '',
          choiceExplanations: q.choiceExplanations || null,
          image: q.imageUrl || null,
          isCorrect: existing?.isCorrect ?? true,
          userAnswer: existing?.userAnswer || correctAnswer,
          reviewType: existing?.reviewType || 'solved',
          isBookmarked: existing?.isBookmarked || false,
          reviewCount: existing?.reviewCount || 0,
          lastReviewedAt: existing?.lastReviewedAt || null,
        } as ReviewItem;
      }));

      setIsEditMode(false);
      setEditingIndex(null);
    } catch (err) {
      console.error('수정 실패:', err);
      showToast('수정에 실패했습니다');
    }
    setIsSavingEdit(false);
  };

  // 문제 편집 핸들러 (QuestionList → QuestionEditor 전환)
  const handleEditQuestion = (index: number) => setEditingIndex(index);
  const handleAddQuestion = () => setEditingIndex(-1);
  const handleCancelQuestionEdit = () => setEditingIndex(null);
  const handleSaveQuestion = (question: QuestionData) => {
    if (editingIndex === -1) {
      setEditableQuestions(prev => [...prev, question]);
    } else if (editingIndex !== null) {
      setEditableQuestions(prev => prev.map((q, i) => i === editingIndex ? question : q));
    }
    setEditingIndex(null);
  };

  // 수정 모드 취소 핸들러
  const handleCancelEdit = () => {
    setIsEditMode(false);
    setEditingIndex(null);
    setEditableQuestions([]);
    setOriginalQuestions([]);
    setEditedTitle('');
    setEditedTags([]);
    setShowEditTagPicker(false);
  };

  // 태그 옵션 생성
  const editTagOptions = useMemo(() => {
    const courseTags = userCourse?.id ? generateCourseTags(userCourse.id) : [];
    return [...courseTags, ...COMMON_TAGS];
  }, [userCourse?.id]);

  // 현재 문제지의 오답 개수 계산
  const wrongCount = useMemo(() => {
    if (folderType === 'wrong') return questions.length; // 이미 오답만 보여주는 경우
    const wrongQuestionKeys = new Set(
      wrongItems
        .filter(w => w.quizId === folderId)
        .map(w => `${w.quizId}:${w.questionId}`)
    );
    return questions.filter(q => wrongQuestionKeys.has(`${q.quizId}:${q.questionId}`)).length;
  }, [folderType, folderId, questions, wrongItems]);

  // 가로모드 페이지에서 3쪽으로 열 때 사용하는 콜백 ref (stale closure 방지)
  const handlePracticeCompleteRef = useRef<(results: PracticeResult[]) => void>(() => {});

  // autoStart: folderId별 1회만 실행 + 데이터 신선도 검증 (같은 라우트에서 퀴즈 전환 시 race condition 방지)
  const autoStartedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoStart || loading || questions.length === 0) return;
    // 이미 이 폴더에서 autoStart 했으면 스킵
    if (autoStartedForRef.current === folderId) return;
    // 데이터가 현재 폴더의 것인지 확인 (folderId 변경 직후 이전 데이터로 실행 방지)
    if (folderType === 'library' && questions[0]?.quizId && questions[0].quizId !== folderId) return;
    autoStartedForRef.current = folderId;

    let items: ReviewItem[];
    let mode: 'all' | 'wrongOnly' = 'all';

    if (autoStart === 'wrongOnly') {
      mode = 'wrongOnly';
      if (folderType === 'wrong') {
        items = questions;
      } else {
        const wrongQuestionKeys = new Set(
          wrongItems.filter(w => w.quizId === folderId).map(w => `${w.quizId}:${w.questionId}`)
        );
        items = questions.filter(q => wrongQuestionKeys.has(`${q.quizId}:${q.questionId}`));
        if (items.length === 0) return;
      }
    } else {
      items = questions;
    }

    setPracticeMode(mode);

    // 가로모드 + 페이지: 기존 3쪽 잠금 해제 후 새 복습 열기
    if (isWide && !isPanelMode) {
      unlockDetail(true);
      openDetail(
        <WidePagePractice
          items={items}
          quizTitle={folderTitle}
          onComplete={(results) => handlePracticeCompleteRef.current(results)}
          onBeforeClose={() => {
            openDetail(<FolderDetailPage panelType={folderType} panelId={folderId} />, `/review/${folderType}/${folderId}`);
            router.replace('/review');
          }}
          currentUserId={user?.uid}
          showFeedback={folderType !== 'library'}
        />,
        `/review/${folderType}/${folderId}`
      );
    } else {
      setPracticeItems(items);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, loading, questions, wrongItems, folderType, folderId]);

  // 선택된 문제들 삭제
  const handleDeleteSelectedQuestions = async () => {
    if (selectedIds.size === 0) return;

    const confirmed = window.confirm(`선택한 ${selectedIds.size}개의 문제를 삭제하시겠습니까?`);
    if (!confirmed) return;

    const deletedCount = selectedIds.size;

    try {
      if (folderType === 'custom') {
        // 커스텀 폴더에서 문제 제거
        for (const itemId of selectedIds) {
          const item = questions.find(q => q.id === itemId);
          if (item) {
            await removeFromCustomFolder(folderId, item.questionId);
          }
        }
        setCustomQuestions(prev => prev.filter(q => !selectedIds.has(q.id)));
      } else {
        // reviews에서 직접 삭제
        for (const itemId of selectedIds) {
          await deleteReviewItem(itemId);
        }
      }
      // 삭제된 항목만 선택에서 제거 (선택 모드 유지)
      setSelectedIds(new Set());
      showToast(`${deletedCount}개 문제 삭제 완료`);
    } catch (err) {
      console.error('문제 삭제 실패:', err);
      alert('삭제에 실패했습니다.');
    }
  };

  // 문제 추가 확정
  const handleAddQuestions = async (selectedKeys: string[]) => {
    if (selectedKeys.length === 0) return;

    try {
      const uniqueItems: ReviewItem[] = [];
      const seenKeys = new Set<string>();

      for (const key of selectedKeys) {
        if (seenKeys.has(key)) continue;
        const colonIndex = key.indexOf(':');
        if (colonIndex === -1) continue;
        const quizId = key.substring(0, colonIndex);
        const questionId = key.substring(colonIndex + 1);
        const item = solvedItems.find(i =>
          i.questionId === questionId && i.quizId === quizId
        );
        if (item) {
          uniqueItems.push(item);
          seenKeys.add(key);
        }
      }

      const questionsToAdd = uniqueItems.map(item => ({
        questionId: item.questionId,
        quizId: item.quizId,
        quizTitle: item.quizTitle || '',
        combinedGroupId: item.combinedGroupId || null, // 결합형 그룹 ID 포함
      }));

      await addToCustomFolder(folderId, questionsToAdd);

      // 추가된 문제 UI 업데이트
      setCustomQuestions(prev => [...prev, ...uniqueItems]);

      // 실제 문제 수 계산 (결합형은 1문제로 계산)
      const combinedGroups = new Set<string>();
      let actualQuestionCount = 0;
      for (const item of uniqueItems) {
        if (item.combinedGroupId) {
          if (!combinedGroups.has(item.combinedGroupId)) {
            combinedGroups.add(item.combinedGroupId);
            actualQuestionCount++;
          }
        } else {
          actualQuestionCount++;
        }
      }
      showToast(`${actualQuestionCount}개 문제 추가 완료`);
    } catch (err) {
      console.error('문제 추가 실패:', err);
      alert('추가에 실패했습니다.');
    }
  };

  // 카테고리 추가 핸들러
  const handleAddCategory = async () => {
    if (!newCategoryName.trim() || folderType !== 'custom') return;

    try {
      await addCategoryToFolder(folderId, newCategoryName.trim());
      setNewCategoryName('');
    } catch (err) {
      console.error('카테고리 추가 실패:', err);
      alert('카테고리 추가에 실패했습니다.');
    }
  };

  // 카테고리 삭제 핸들러
  const handleRemoveCategory = async (categoryId: string) => {
    if (folderType !== 'custom') return;

    const confirmed = window.confirm('이 카테고리를 삭제하시겠습니까? 해당 문제들은 미분류로 변경됩니다.');
    if (!confirmed) return;

    try {
      await removeCategoryFromFolder(folderId, categoryId);
    } catch (err) {
      console.error('카테고리 삭제 실패:', err);
      alert('카테고리 삭제에 실패했습니다.');
    }
  };

  // 문제 카테고리 배정 핸들러
  const handleAssignToCategory = async (questionId: string, categoryId: string | null) => {
    if (folderType !== 'custom') return;

    try {
      await assignQuestionToCategory(folderId, questionId, categoryId);
      // 로컬 상태 업데이트
      setCustomQuestions(prev => prev.map(q => {
        if (q.questionId === questionId) {
          return { ...q, categoryId: categoryId || undefined } as ReviewItem & { categoryId?: string };
        }
        return q;
      }));
    } catch (err) {
      console.error('카테고리 배정 실패:', err);
    }
  };

  // 선택된 문제들을 카테고리에 일괄 배정
  const handleBulkAssign = async () => {
    if (selectedIds.size === 0 || !selectedCategoryForAssign) return;

    try {
      for (const itemId of selectedIds) {
        const item = questions.find(q => q.id === itemId);
        if (item) {
          await assignQuestionToCategory(folderId, item.questionId, selectedCategoryForAssign);
        }
      }
      // 로컬 상태 업데이트
      setCustomQuestions(prev => prev.map(q => {
        if (selectedIds.has(q.id)) {
          return { ...q, categoryId: selectedCategoryForAssign || undefined } as ReviewItem & { categoryId?: string };
        }
        return q;
      }));
      setSelectedIds(new Set());
      setIsSelectMode(false);
      setIsAssignMode(false);
      setSelectedCategoryForAssign(null);
    } catch (err) {
      console.error('일괄 배정 실패:', err);
      alert('배정에 실패했습니다.');
    }
  };

  // 카테고리별로 문제 그룹핑
  const groupedByCategory = useMemo(() => {
    if (folderType !== 'custom' || !customFolder?.categories?.length) {
      return null;
    }

    const categories = customFolder.categories;
    const folderQuestions = customFolder.questions || [];

    // 각 카테고리별 문제 그룹
    const groups: { category: FolderCategory | null; items: ReviewItem[] }[] = [];

    // 미분류 그룹
    const uncategorized: ReviewItem[] = [];

    // 카테고리별로 문제 분류
    for (const category of categories) {
      const categoryQuestionIds = folderQuestions
        .filter((q: CustomFolderQuestion) => q.categoryId === category.id)
        .map((q: CustomFolderQuestion) => q.questionId);

      const categoryItems = customQuestions.filter(q =>
        categoryQuestionIds.includes(q.questionId)
      );

      groups.push({ category, items: categoryItems });
    }

    // 미분류 문제
    const categorizedQuestionIds = folderQuestions
      .filter((q: CustomFolderQuestion) => q.categoryId)
      .map((q: CustomFolderQuestion) => q.questionId);

    const uncategorizedItems = customQuestions.filter(q =>
      !categorizedQuestionIds.includes(q.questionId)
    );

    if (uncategorizedItems.length > 0) {
      groups.push({ category: null, items: uncategorizedItems });
    }

    return groups;
  }, [folderType, customFolder, customQuestions]);

  // 피드백 제출 핸들러
  const handleFeedbackSubmit = async (questionId: string, type: FeedbackType, content: string) => {
    if (!user) return;

    // 문제 정보 찾기
    const item = questions.find(q => q.questionId === questionId);
    const quizId = item?.quizId || folderId;

    // quizCreatorId 결정: 1) 리뷰 아이템에서, 2) quizCreatorsMap에서
    const creatorId = item?.quizCreatorId || quizCreatorsMap.get(quizId) || null;

    // questionId에서 문제 번호 추출 (예: "q0" → 1, "q2-1" → 3)
    const [mainIdx] = parseQuestionId(questionId);
    const questionNumber = mainIdx + 1;

    const feedbackRef = collection(db, 'questionFeedbacks');
    await addDoc(feedbackRef, {
      questionId,
      quizId,
      quizCreatorId: creatorId, // 퀴즈 생성자 ID (조회 최적화용)
      userId: user.uid,
      questionNumber, // 문제 번호 (표시용)
      type,
      content,
      createdAt: serverTimestamp(),
    });
  };

  // 피드백 제출 완료 → EXP 토스트 (CF에서 피드백당 15XP 지급)
  const handleFeedbackDone = useCallback((count: number) => {
    showExpToast(EXP_REWARDS.FEEDBACK_SUBMIT * count, '피드백 작성');
  }, [showExpToast]);

  // 복습 완료 핸들러
  const handlePracticeComplete = useCallback(async (results: PracticeResult[]) => {
    // 복습 완료된 문제 reviewCount 증가 (복습력 측정용)
    // 합성 ID(library-, fallback-)는 Firestore에 실제 문서가 없으므로 스킵
    for (const r of results) {
      if (r.reviewId.startsWith('library-') || r.reviewId.startsWith('fallback-')) continue;
      try { await markAsReviewed(r.reviewId); } catch { /* 개별 실패 무시 */ }
    }

    if (folderId && user && folderType !== 'custom' && results.length > 0) {
      const quizDocSnap = await getDoc(doc(db, 'quizzes', folderId)).catch(() => null);
      const quizData = quizDocSnap?.data();
      const correctCount = results.filter(r => r.isCorrect).length;
      const totalCount = quizData?.questions?.length || results.length;
      const reviewScore = Math.round((correctCount / totalCount) * 100);

      // 1. 복습 연습 EXP 지급 — CF가 quizResults 생성 + EXP 처리
      try {
        await callFunction('recordReviewPractice', {
          quizId: folderId,
          correctCount,
          totalCount,
          score: reviewScore,
        });
      } catch (err) {
        console.error('복습 EXP 지급 실패:', err);
      }

      // 2. 첫 복습 점수 저장 (전체 복습 모드에서만, 최초 1회)
      if (practiceModeRef.current === 'all' && quizData) {
        try {
          const existingReviewScore = quizData.userFirstReviewScores?.[user.uid];
          if (existingReviewScore === undefined) {
            await updateDoc(doc(db, 'quizzes', folderId), {
              [`userFirstReviewScores.${user.uid}`]: reviewScore,
            });
            // 로컬 상태 즉시 갱신
            setQuizScores(prev => prev ? { ...prev, myFirstReviewScore: reviewScore } : prev);
          }
        } catch (err) {
          console.error('첫 복습 점수 저장 실패:', err);
        }
      }

      // 3. 해당 퀴즈의 모든 reviews 문서 업데이트 (뱃지 제거)
      if (quizData) {
        try {
          const currentQuizUpdatedAt = quizData.updatedAt || quizData.createdAt || null;
          const reviewsQuery = query(
            collection(db, 'reviews'),
            where('userId', '==', user.uid),
            where('quizId', '==', folderId)
          );
          const reviewsSnapshot = await getDocs(reviewsQuery);
          for (const reviewDoc of reviewsSnapshot.docs) {
            await updateDoc(reviewDoc.ref, { quizUpdatedAt: currentQuizUpdatedAt });
          }
        } catch (err) {
          console.error('리뷰 뱃지 업데이트 실패:', err);
        }
      }

      // 4. 서재 AI 퀴즈: 퀴즈 점수 저장 + 오답 reviews 생성 (최초 1회)
      // AI 생성 직후 풀기 = 퀴즈 점수, 서재에서 처음 풀기도 퀴즈 점수로 취급
      if (folderType === 'library' && quizData) {
        const existingQuizScore = quizData.userScores?.[user.uid];

        // 4-1. 퀴즈 점수가 없으면 저장 (첫 풀이 = 퀴즈 점수)
        if (existingQuizScore === undefined) {
          try {
            await updateDoc(doc(db, 'quizzes', folderId), {
              [`userScores.${user.uid}`]: reviewScore,
              score: reviewScore,
              participantCount: 1,
            });
            // 로컬 상태 즉시 갱신
            setQuizScores(prev => prev ? { ...prev, myScore: reviewScore } : prev);
          } catch (err) {
            console.error('퀴즈 점수 저장 실패:', err);
          }
        }

        // 4-2. reviews가 없으면 생성 (오답 탭 분류용)
        try {
          const existingSolvedReviews = await getDocs(query(
            collection(db, 'reviews'),
            where('userId', '==', user.uid),
            where('quizId', '==', folderId),
            where('reviewType', '==', 'solved'),
            limit(1)
          ));

          if (existingSolvedReviews.empty && questions.length > 0) {
            const courseId = userCourse?.id || quizData.courseId || null;
            const reviewsRef = collection(db, 'reviews');

            for (const result of results) {
              const item = questions.find(q => q.questionId === result.questionId);
              if (!item) continue;

              // result.userAnswer는 0-indexed 그대로 저장
              const convertedUserAnswer = result.userAnswer;

              const reviewData = {
                userId: user.uid,
                quizId: folderId,
                quizTitle: quizData.title || folderTitle,
                questionId: result.questionId,
                question: item.question,
                type: item.type,
                options: item.options || null,
                correctAnswer: item.correctAnswer,
                userAnswer: convertedUserAnswer,
                explanation: item.explanation || '',
                choiceExplanations: item.choiceExplanations || null,
                isBookmarked: false,
                isCorrect: result.isCorrect,
                reviewCount: 0,
                lastReviewedAt: null,
                createdAt: serverTimestamp(),
                quizUpdatedAt: serverTimestamp(),
                chapterId: item.chapterId || null,
                chapterDetailId: item.chapterDetailId || null,
                imageUrl: item.imageUrl || null,
                image: item.image || null,
                courseId,
                quizType: quizData.type || 'ai-generated',
                quizCreatorId: quizData.creatorId || user.uid,
                reviewType: 'solved' as const,
              };

              // 모든 문제를 solved로 저장
              await addDoc(reviewsRef, reviewData);

              // 오답은 wrong으로도 저장 (오답 탭 분류)
              if (!result.isCorrect) {
                await addDoc(reviewsRef, { ...reviewData, reviewType: 'wrong' as const });
              }
            }
          }
        } catch (err) {
          console.error('오답 reviews 생성 실패:', err);
        }
      }
    }

    // 가로모드 + 페이지: 2쪽 상세뷰 유지 (네비게이션 안 함)
    if (autoStart && !(isWide && !isPanelMode)) {
      goBackToList();
    } else {
      setPracticeItems(null);
      setPracticeMode(null);
    }
  }, [folderId, user, folderType, autoStart, markAsReviewed, router, questions, folderTitle, userCourse, isWide, isPanelMode]);

  // handlePracticeCompleteRef 동기화 (3쪽 WidePagePractice에서 참조)
  useEffect(() => { handlePracticeCompleteRef.current = handlePracticeComplete; }, [handlePracticeComplete]);

  // autoStart 모드: 데이터 로딩 중이면 로딩 스피너만 표시 (폴더 상세 안 보여줌)
  // 가로모드 + 페이지: 2쪽 상세뷰를 보여주므로 스피너 스킵
  if (autoStart && !practiceItems && (loading || questions.length === 0) && !(isWide && !isPanelMode)) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
          <p className="text-[#3A3A3A] text-sm">복습 준비 중...</p>
        </div>
      </div>
    );
  }

  // 연습 모드
  if (practiceItems) {
    return (
      <ReviewPractice
        items={practiceItems}
        quizTitle={folderTitle}
        onComplete={handlePracticeComplete}
        onClose={() => {
          if (isPanelMode) {
            // 패널 모드: 복습 전체 닫기 (다른 고정창처럼 한 번에)
            closePanel();
          } else if (autoStart) {
            goBackToList();
          } else {
            setPracticeItems(null);
            setPracticeMode(null);
          }
        }}
        currentUserId={user?.uid}
        showFeedback={folderType !== 'library'}
        isPanelMode={isPanelMode}
      />
    );
  }

  // 문제 추가 모드 - AddQuestionsView 컴포넌트로 분리
  if (isAddMode && folderType === 'custom' && customFolder) {
    return (
      <AddQuestionsView
        groupedSolvedItems={groupedSolvedItems}
        solvedItems={solvedItems}
        customFolderQuestions={customFolder.questions}
        onClose={() => setIsAddMode(false)}
        onAddQuestions={handleAddQuestions}
      />
    );
  }

  // 필터 변경 핸들러 (리뷰 페이지로 이동)
  const handleFilterChange = (filter: ReviewFilter) => {
    // 현재 폴더 타입과 다른 필터를 선택하면 리뷰 페이지로 이동
    if (filter !== folderType) {
      goBackToList(filter);
    }
  };

  return (
    <motion.div
      className={isPanelMode ? "min-h-full flex flex-col" : "min-h-screen pb-24"} style={{ backgroundColor: '#F5F0E8' }}
      initial={slideIn ? { opacity: 0, x: 60 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 35 }}
    >
      {/* 헤더 - 배너 이미지 */}
      <FolderDetailHeader
        ribbonImage={ribbonImage}
        ribbonScale={ribbonScale}
        folderType={folderType}
        folderTitle={folderTitle}
        fromQuizPage={fromQuizPage}
        quizScores={quizScores}
        onBack={() => goBackToList()}
      />

      {/* 폴더 제목 + 점수 (solved 타입 제외) */}
      {folderType !== 'solved' && (
        <div className="px-4 py-3">
          {/* bookmark/library 타입일 때 제목 + 점수 표시 */}
          {(folderType === 'bookmark' || folderType === 'library') ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                {/* 뒤로가기 < 화살표 */}
                {!isEditMode && (
                  <button
                    onClick={() => goBackToList()}
                    className="p-1 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors flex-shrink-0"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                {(folderType === 'library' || (isProfessor && (folderType as string) === 'custom')) && isEditMode ? (
                  <input
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    className="flex-1 min-w-0 text-2xl font-black text-[#1A1A1A] bg-[#EDEAE4] border-2 border-[#1A1A1A] px-2 py-1 focus:outline-none focus:bg-[#FDFBF7]"
                    autoFocus
                  />
                ) : (
                  <>
                    <h2 className="text-2xl font-black text-[#1A1A1A] flex-1">
                      {folderTitle}
                    </h2>
                    {((folderType === 'library' && !fromQuizPage && quizCreatorsMap.get(folderId) === user?.uid)
                      || (isProfessor && (folderType as string) === 'custom')) && !isSelectMode && (
                      <>
                        <button
                          onClick={handleEnterEditMode}
                          className="p-1.5 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors flex-shrink-0"
                          title="수정 모드"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setShowDeleteModal(true)}
                          className="p-1.5 text-[#5C5C5C] hover:text-[#C44] transition-colors flex-shrink-0"
                          title="퀴즈 삭제"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
              {/* 수정 모드 또는 교수일 때 점수 영역 숨김 */}
              {!isEditMode && !isProfessor && (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-black text-[#1A1A1A]">
                        {quizScores?.myScore !== undefined ? quizScores.myScore : '-'}
                      </span>
                      <span className="text-base text-[#5C5C5C]">/</span>
                      <span className="text-2xl font-black text-[#1A1A1A]">
                        {quizScores?.myFirstReviewScore !== undefined ? quizScores.myFirstReviewScore : '-'}
                      </span>
                    </div>
                    <div className="flex items-center gap-5 mt-1">
                      <span className="text-xs text-[#5C5C5C]">퀴즈</span>
                      <span className="text-xs text-[#5C5C5C]">복습</span>
                    </div>
                  </div>
                  {/* 평균 점수 (공개 퀴즈만) */}
                  {quizScores?.isPublic && (
                    <div className="flex flex-col items-center">
                      <span className="text-2xl font-black text-[#1A1A1A]">
                        {quizScores?.averageScore !== undefined ? Math.round(quizScores.averageScore) : '-'}
                      </span>
                      <span className="text-xs text-[#5C5C5C] mt-1">평균</span>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => goBackToList()}
                className="p-1 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors flex-shrink-0"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-2xl font-black text-[#1A1A1A] truncate flex-1">
                {folderTitle}
              </h2>
              {folderType === 'custom' && !isSelectMode && (
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className="p-1.5 text-[#5C5C5C] hover:text-[#C44] transition-colors flex-shrink-0"
                  title="폴더 삭제"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 커스텀 폴더일 때 문제 추가 버튼 (교수는 숨김) */}
      {folderType === 'custom' && !isSelectMode && !isProfessor && (
        <div className="px-4 pt-2">
          <button
            onClick={() => setIsAddMode(true)}
            className="w-full py-1.5 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
          >
            + 문제 추가하기
          </button>
        </div>
      )}

      {/* 상단 정보 */}
      <div className="px-4 py-3 flex items-center justify-between">
        <p className="text-lg font-bold text-[#5C5C5C]">
          {loading ? '불러오는 중...' : `총 ${isEditMode ? editableQuestions.length : questions.length}문제`}
          {isSelectMode && selectedIds.size > 0 && (
            <span className="ml-2 text-[#1A1A1A] font-bold">
              ({selectedIds.size}개 선택)
            </span>
          )}
        </p>
        {/* 수정 모드 또는 교수일 때 선택 버튼 숨김 */}
        {!isEditMode && !isProfessor && (
          <div className="flex gap-2">
            {/* 선택 모드일 때 전체 선택 버튼 */}
            {isSelectMode && (
              <button
                onClick={() => {
                  if (selectedIds.size === questions.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(questions.map(q => q.id)));
                  }
                }}
                className="px-2.5 py-1 text-xs font-bold border transition-colors bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#EDEAE4] rounded-md"
              >
                {selectedIds.size === questions.length ? '전체 해제' : '전체'}
              </button>
            )}
            <button
              onClick={() => {
                if (isSelectMode) {
                  setIsSelectMode(false);
                  setIsDeleteMode(false);
                  setIsAssignMode(false);
                  setSelectedIds(new Set());
                } else {
                  setIsSelectMode(true);
                  // 선택 모드에서는 삭제 모드 비활성화 (복습용으로만 사용)
                  setIsDeleteMode(false);
                }
              }}
              className={`px-2.5 py-1 text-xs font-bold border-2 transition-colors rounded-md ${
                isSelectMode
                  ? 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A]'
                  : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#EDEAE4]'
              }`}
            >
              {isSelectMode ? '취소' : '선택'}
            </button>
          </div>
        )}
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="px-4 space-y-2">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-20 rounded-none" />
          ))}
        </div>
      )}

      {/* 수정 모드: 메타 편집 + QuestionList + QuestionEditor (교수 서재와 동일) */}
      {!loading && isEditMode && folderType === 'library' && (
        <main className={isPanelMode ? "px-4 space-y-2 flex-1" : "px-4 space-y-2"}>
          {editingIndex !== null ? (
            <QuestionEditor
              initialQuestion={editingIndex >= 0 ? editableQuestions[editingIndex] : undefined}
              questionNumber={editingIndex >= 0 ? editingIndex + 1 : editableQuestions.length + 1}
              onSave={handleSaveQuestion}
              onCancel={handleCancelQuestionEdit}
              userRole="student"
              courseId={userCourse?.id}
            />
          ) : (
            <>
              {/* 메타 편집 영역 (난이도 + 태그) */}
              <EditMetadataSection
                editDifficulty={editDifficulty}
                onDifficultyChange={setEditDifficulty}
                editedTags={editedTags}
                onRemoveTag={(tag) => setEditedTags(prev => prev.filter(t => t !== tag))}
                onAddTag={(tag) => setEditedTags(prev => [...prev, tag])}
                showEditTagPicker={showEditTagPicker}
                onToggleTagPicker={() => setShowEditTagPicker(!showEditTagPicker)}
                editTagOptions={editTagOptions}
              />

              <QuestionList
                questions={editableQuestions}
                onQuestionsChange={setEditableQuestions}
                onEditQuestion={handleEditQuestion}
                userRole="student"
                courseId={userCourse?.id}
                isPanelMode={isPanelMode}
              />
              <motion.button
                onClick={handleAddQuestion}
                className="w-full py-3 border-2 border-dashed border-[#1A1A1A] text-[#1A1A1A] font-bold text-sm hover:bg-[#EDEAE4] transition-colors"
              >
                + 새 문제 추가
              </motion.button>
            </>
          )}
        </main>
      )}

      {/* 문제 목록 (일반 모드) */}
      {!loading && !(isEditMode && folderType === 'library') && (
        <main className={isPanelMode ? "px-4 space-y-2 flex-1" : "px-4 space-y-2"}>
          <QuestionListSection
            questions={questions}
            displayItems={displayItems}
            groupedByCategory={groupedByCategory}
            isSelectMode={isSelectMode}
            selectedIds={selectedIds}
            onSelectQuestion={handleSelectQuestion}
            onSetSelectedIds={setSelectedIds}
            expandedGroupIds={expandedGroupIds}
            onToggleGroupExpand={toggleGroupExpand}
            onFeedbackSubmit={handleFeedbackSubmit}
            onFeedbackDone={handleFeedbackDone}
            currentUserId={user?.uid}
            quizCreatorsMap={quizCreatorsMap}
            quizAiMap={quizAiMap}
            folderType={folderType}
            courseId={userCourse?.id}
            updatedQuestionIds={updatedQuestionIds}
          />
        </main>
      )}

      {/* 하단 버튼 영역 — 교수 custom에서는 숨김 (복습/선택 없음) */}
      {!loading && !(isProfessor && (folderType as string) === 'custom') && (questions.length > 0 || (isEditMode && editableQuestions.length > 0)) && !(isSelectMode && !isAssignMode && selectedIds.size === 0) && !(isEditMode && editingIndex !== null) && (
        <div className={isPanelMode ? "sticky bottom-0 p-3 bg-[#F5F0E8] border-t-2 border-[#1A1A1A]" : "fixed bottom-0 right-0 p-3 bg-[#F5F0E8] border-t-2 border-[#1A1A1A]"} style={isPanelMode ? {} : { left: 'var(--detail-panel-left, 0)', paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
          {isEditMode ? (
            /* 수정 모드일 때 - 취소/저장 */
            <div className="flex gap-2">
              <button
                onClick={handleCancelEdit}
                disabled={isSavingEdit}
                className="flex-1 py-3 text-sm font-bold bg-[#F5F0E8] text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                취소
              </button>
              <button
                onClick={handleSaveEdits}
                disabled={isSavingEdit || editableQuestions.length < 1}
                className={`flex-1 py-3 text-sm font-bold border-2 transition-colors rounded-lg ${
                  editableQuestions.length > 0
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A] hover:bg-[#3A3A3A]'
                    : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C] cursor-not-allowed'
                }`}
              >
                {isSavingEdit ? '저장 중...' : '저장'}
              </button>
            </div>
          ) : !isProfessor && isSelectMode && selectedIds.size > 0 ? (
            /* 선택 모드일 때 - 선택한 문제 복습 (교수는 숨김) */
            <button
              onClick={handleStartPractice}
              className="w-full py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors rounded-lg"
            >
              선택 복습하기 ({selectedIds.size})
            </button>
          ) : !isSelectMode && !isProfessor ? (
            /* 기본 모드 - 전체 복습 + 오답 복습 (교수는 숨김) */
            <div className="flex gap-2">
              <button
                onClick={handleStartPractice}
                className="flex-1 py-2.5 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors rounded-lg"
              >
                전체 복습
              </button>
              <button
                onClick={handleStartWrongOnlyPractice}
                disabled={wrongCount === 0}
                className={`flex-1 py-2.5 text-sm font-bold border-2 transition-colors rounded-lg ${
                  wrongCount > 0
                    ? 'bg-[#8B1A1A] text-[#F5F0E8] border-[#8B1A1A] hover:bg-[#6B1414]'
                    : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C] cursor-not-allowed'
                }`}
              >
                오답 복습 {wrongCount > 0 && `(${wrongCount})`}
              </button>
            </div>
          ) : null}
        </div>
      )}


      {/* 배정 모드일 때 하단 안내 */}
      {!loading && isAssignMode && isSelectMode && selectedIds.size === 0 && (
        <div className={isPanelMode ? "sticky bottom-0 p-3 bg-[#EDEAE4] border-t-2 border-[#1A1A1A]" : "fixed bottom-0 right-0 p-3 bg-[#EDEAE4] border-t-2 border-[#1A1A1A]"} style={isPanelMode ? {} : { left: 'var(--detail-panel-left, 0)', paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
          <p className="text-xs text-center text-[#5C5C5C]">
            분류할 문제를 선택하세요
          </p>
        </div>
      )}

      {/* 빈 폴더 임시 메시지 */}
      <AnimatePresence>
        {showEmptyMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-[#F5F0E8] border-2 border-[#1A1A1A] px-6 py-4 text-center"
            >
              <p className="text-sm font-bold text-[#1A1A1A]">
                선택된 폴더에 복습할 문제가 없습니다
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 토스트 메시지 */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-28 right-4 z-50"
            style={{ left: 'max(1rem, var(--detail-panel-left, 1rem))' }}
          >
            <div className="bg-[#1A1A1A] text-[#F5F0E8] px-4 py-3 text-center border-2 border-[#1A1A1A]">
              <p className="text-sm font-bold">{toastMessage}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 카테고리 관리 + 배정 + 삭제 모달 모음 */}
      <FolderDetailBottomSheets
        isCategoryMode={isCategoryMode}
        onCloseCategoryMode={() => { setIsCategoryMode(false); setNewCategoryName(''); }}
        newCategoryName={newCategoryName}
        onNewCategoryNameChange={setNewCategoryName}
        onAddCategory={handleAddCategory}
        onRemoveCategory={handleRemoveCategory}
        customFolder={customFolder}
        onEnterAssignMode={() => {
          setIsCategoryMode(false);
          setIsSelectMode(true);
          setIsDeleteMode(false);
          setIsAssignMode(true);
        }}
        isAssignSheetOpen={isAssignMode && isSelectMode && selectedIds.size > 0}
        onCloseAssignSheet={() => setSelectedCategoryForAssign(null)}
        selectedCount={selectedIds.size}
        selectedCategoryForAssign={selectedCategoryForAssign}
        onSelectCategoryForAssign={setSelectedCategoryForAssign}
        onAssign={async () => {
          if (!selectedCategoryForAssign) return;
          const categoryId = selectedCategoryForAssign === 'uncategorized' ? null : selectedCategoryForAssign;
          try {
            for (const itemId of selectedIds) {
              const item = questions.find(q => q.id === itemId);
              if (item) {
                await assignQuestionToCategory(folderId, item.questionId, categoryId);
              }
            }
            setSelectedIds(new Set());
            setIsSelectMode(false);
            setIsAssignMode(false);
            setSelectedCategoryForAssign(null);
          } catch (err) {
            console.error('배정 실패:', err);
            alert('배정에 실패했습니다.');
          }
        }}
        showDeleteModal={showDeleteModal}
        onCloseDeleteModal={() => setShowDeleteModal(false)}
        folderType={folderType}
        onDelete={async () => {
          try {
            if (folderType === 'custom') {
              await deleteCustomFolder(folderId);
            } else if (folderType === 'library') {
              await deleteDoc(doc(db, 'quizzes', folderId));
            }
            setShowDeleteModal(false);
            goBackToList();
          } catch (err) {
            console.error('삭제 실패:', err);
          }
        }}
        isPanelMode={isPanelMode}
      />
    </motion.div>
  );
}
