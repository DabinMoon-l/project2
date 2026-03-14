'use client';

import { useState, useCallback, useEffect, Suspense, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { doc, getDoc, getDocs, collection, query, where, onSnapshot, updateDoc, limit, db } from '@/lib/repositories';
import { Skeleton } from '@/components/common';
import { useExpandSource } from '@/lib/hooks/useExpandSource';
import { SPRING_TAP, TAP_SCALE } from '@/lib/constants/springs';
import FolderSlider from '@/components/common/FolderSlider';
import dynamic from 'next/dynamic';
import type { PracticeResult } from '@/components/review/ReviewPractice';
import { useReview, calculateCustomFolderQuestionCount, type ReviewItem, type GroupedReviewItems, type QuizUpdateInfo, type PrivateQuiz, type CustomFolder, type QuizAttempt } from '@/lib/hooks/useReview';
import { useQuizUpdate, type QuizUpdateInfo as DetailedQuizUpdateInfo } from '@/lib/hooks/useQuizUpdate';

// 대형 컴포넌트 lazy load
const ReviewPractice = dynamic(() => import('@/components/review/ReviewPractice'), { ssr: false });
const UpdateQuizModal = dynamic(() => import('@/components/quiz/UpdateQuizModal'), { ssr: false });
import { useQuizBookmark, type BookmarkedQuiz } from '@/lib/hooks/useQuizBookmark';
import { useLearningQuizzes, type LearningQuiz } from '@/lib/hooks/useLearningQuizzes';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse, useUser } from '@/lib/contexts';
import { getPastExamOptions } from '@/lib/types/course';
import { getChapterById, generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';
import type { QuestionExportData as PdfQuestionData } from '@/lib/utils/questionPdfExport';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import { useHideNav } from '@/lib/hooks/useHideNav';
import { type CompletedQuizData, type ReviewFilter, FILTER_OPTIONS } from '@/components/review/types';
import { formatQuestionTypes } from '@/components/review/utils';
import SlideFilter from '@/components/review/SlideFilter';
import FolderCard from '@/components/review/FolderCard';
import SkeletonQuizCard from '@/components/review/SkeletonQuizCard';
import EmptyState from '@/components/review/EmptyState';
import LibraryQuizCard from '@/components/review/LibraryQuizCard';
import BookmarkGridView from '@/components/review/BookmarkGridView';
import QuestionListModal from '@/components/review/QuestionListModal';
import CreateFolderModal from '@/components/review/CreateFolderModal';
import ReviewDeleteSheet from '@/components/review/ReviewDeleteSheet';
import ReviewPublishModal from '@/components/review/ReviewPublishModal';
import ReviewLibraryDetailModal from '@/components/review/ReviewLibraryDetailModal';
import FolderCategoryModal from '@/components/review/FolderCategoryModal';
import { PROFESSOR_QUIZ_TYPES } from '@/app/(main)/quiz/quizPageParts';

/* ============================================================
 * 아래는 모든 서브 컴포넌트가 components/review/에 분리됨
 * FolderCard, BookmarkedQuizCard, LargeBookmarkedQuizCard,
 * LargeSolvedQuizCard, ReviewNewsArticle, ReviewNewsCarousel,
 * CustomReviewQuizCard, SkeletonQuizCard, EmptyState,
 * ScrollIndicator, LibraryQuizCard, BookmarkQuizCard,
 * BookmarkGridView, SolvedQuizLayout, QuestionListModal,
 * CreateFolderModal
 * ============================================================ */

function ReviewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { userCourseId, semesterSettings, getCourseById } = useCourse();
  const { profile } = useUser();

  // 과목별 리본 이미지
  const currentCourse = userCourseId ? getCourseById(userCourseId) : null;
  const ribbonImage = currentCourse?.reviewRibbonImage || '/images/biology-review-ribbon.png';
  const ribbonScale = currentCourse?.reviewRibbonScale || 1;

  // URL 쿼리 파라미터에서 초기 필터값 가져오기 (기본값: 서재)
  const initialFilter = (searchParams.get('filter') as ReviewFilter) || 'library';
  const [activeFilter, setActiveFilter] = useState<ReviewFilter>(initialFilter);
  const [practiceItems, setPracticeItems] = useState<ReviewItem[] | null>(null);
  // 복습 모드: 'all' (모두) vs 'wrongOnly' (오답만) - 첫 복습 점수 저장 여부 결정에 사용
  const [practiceMode, setPracticeMode] = useState<'all' | 'wrongOnly' | null>(null);
  const practiceModeRef = useRef<'all' | 'wrongOnly' | null>(null);
  useEffect(() => { practiceModeRef.current = practiceMode; }, [practiceMode]);
  const [showCreateFolder, setShowCreateFolder] = useState(false);

  // 폴더 삭제 선택 모드 (모든 탭에서 통합 사용)
  const [isFolderDeleteMode, setIsFolderDeleteMode] = useState(false);
  const [deleteFolderIds, setDeleteFolderIds] = useState<Set<string>>(new Set());

  // 복습 선택 모드
  const [isReviewSelectMode, setIsReviewSelectMode] = useState(false);
  const [reviewSelectedIds, setReviewSelectedIds] = useState<Set<string>>(new Set());

  // 서재 공개 업로드 선택 모드
  const [isLibrarySelectMode, setIsLibrarySelectMode] = useState(false);
  const [librarySelectedIds, setLibrarySelectedIds] = useState<Set<string>>(new Set());

  // 서재 퀴즈 공개 확인 모달
  const [publishConfirmQuizId, setPublishConfirmQuizId] = useState<string | null>(null);

  // 서재 퀴즈 상세 모달
  const [selectedLibraryQuiz, setSelectedLibraryQuiz] = useState<typeof libraryQuizzesRaw[number] | null>(null);

  // 모달 열기 시 최신 점수를 퀴즈 문서에서 직접 읽어 갱신
  const openLibraryQuizModal = useCallback(async (quiz: typeof libraryQuizzesRaw[number]) => {
    captureLibraryRect(quiz.id);
    setSelectedLibraryQuiz(quiz);
    try {
      const quizDoc = await getDoc(doc(db, 'quizzes', quiz.id));
      if (quizDoc.exists() && user) {
        const data = quizDoc.data();
        const freshScore = data.userScores?.[user.uid] ?? quiz.myScore;
        const freshReviewScore = data.userFirstReviewScores?.[user.uid];
        if (freshScore !== quiz.myScore || freshReviewScore !== quiz.myFirstReviewScore) {
          setSelectedLibraryQuiz(prev => prev?.id === quiz.id ? {
            ...prev!,
            myScore: freshScore,
            myFirstReviewScore: freshReviewScore,
          } : prev);
        }
      }
    } catch { /* 실패 시 캐시된 값 유지 */ }
  }, [user]);
  const { sourceRect: librarySourceRect, registerRef: registerLibraryRef, captureRect: captureLibraryRect, clearRect: clearLibraryRect } = useExpandSource();

  // 서재 태그 필터 상태
  const [librarySelectedTags, setLibrarySelectedTags] = useState<string[]>([]);
  const [showLibraryTagFilter, setShowLibraryTagFilter] = useState(false);

  // 찜 태그 필터 상태
  const [bookmarkSelectedTags, setBookmarkSelectedTags] = useState<string[]>([]);
  const [showBookmarkTagFilter, setShowBookmarkTagFilter] = useState(false);

  // 삭제 확인 바텀시트 (휴지통)
  const [showDeleteConfirmSheet, setShowDeleteConfirmSheet] = useState(false);

  // 빈 폴더 메시지
  const [showEmptyMessage, setShowEmptyMessage] = useState(false);

  // 찜한 퀴즈 상세보기 모달
  const [selectedBookmarkedQuiz, setSelectedBookmarkedQuiz] = useState<BookmarkedQuiz | null>(null);


  // 문제 상세보기 모달 (문제 목록 표시)
  const [questionListQuiz, setQuestionListQuiz] = useState<CompletedQuizData | null>(null);

  // PDF 폴더 선택 모드
  const [isPdfSelectMode, setIsPdfSelectMode] = useState(false);
  const [selectedPdfFolders, setSelectedPdfFolders] = useState<Set<string>>(new Set());

  // 폴더 정렬(카테고리) 관련 상태
  const [isSortMode, setIsSortMode] = useState(false);
  const [folderCategories, setFolderCategories] = useState<{ id: string; name: string }[]>([]);
  const [folderCategoryMap, setFolderCategoryMap] = useState<Record<string, string>>({});
  const [folderOrderMap, setFolderOrderMap] = useState<Record<string, number>>({}); // 폴더 순서
  const [isAssignMode, setIsAssignMode] = useState(false);
  const [selectedFolderForAssign, setSelectedFolderForAssign] = useState<string | null>(null);

  // 네비게이션 숨김 (폴더생성/정렬모드/서재상세/공개전환모달)
  useHideNav(!!(showCreateFolder || isSortMode || selectedLibraryQuiz || publishConfirmQuizId));

  // 카테고리 설정 모달 열릴 때 body 스크롤 방지 (키보드 올라올 때 자유 스크롤 방지)
  useEffect(() => {
    if (isSortMode) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isSortMode]);

  // 로컬 스토리지에서 카테고리 정보 로드
  useEffect(() => {
    const savedCategories = localStorage.getItem('review_folder_categories');
    const savedMap = localStorage.getItem('review_folder_category_map');
    const savedOrder = localStorage.getItem('review_folder_order_map');
    if (savedCategories) {
      try {
        setFolderCategories(JSON.parse(savedCategories));
      } catch (e) {
        console.error('카테고리 로드 실패:', e);
      }
    }
    if (savedMap) {
      try {
        setFolderCategoryMap(JSON.parse(savedMap));
      } catch (e) {
        console.error('카테고리 맵 로드 실패:', e);
      }
    }
    if (savedOrder) {
      try {
        setFolderOrderMap(JSON.parse(savedOrder));
      } catch (e) {
        console.error('폴더 순서 로드 실패:', e);
      }
    }
  }, []);

  // 카테고리 정보를 로컬 스토리지에 저장
  const saveFolderCategories = (
    categories: { id: string; name: string }[],
    map: Record<string, string>,
    order?: Record<string, number>
  ) => {
    localStorage.setItem('review_folder_categories', JSON.stringify(categories));
    localStorage.setItem('review_folder_category_map', JSON.stringify(map));
    if (order) {
      localStorage.setItem('review_folder_order_map', JSON.stringify(order));
    }
  };

  // 카테고리 추가 (최대 8개)
  const handleAddFolderCategory = (name: string) => {
    if (!name.trim()) return;
    if (folderCategories.length >= 8) {
      alert('카테고리는 최대 8개까지 추가할 수 있습니다.');
      return;
    }
    const newCategory = {
      id: `fcat_${Date.now()}`,
      name: name.trim(),
    };
    const newCategories = [...folderCategories, newCategory];
    setFolderCategories(newCategories);
    saveFolderCategories(newCategories, folderCategoryMap, folderOrderMap);
  };

  // 카테고리 삭제
  const handleRemoveFolderCategory = (categoryId: string) => {
    const newCategories = folderCategories.filter(c => c.id !== categoryId);
    // 해당 카테고리의 폴더들은 미분류로 변경
    const newMap = { ...folderCategoryMap };
    Object.keys(newMap).forEach(folderId => {
      if (newMap[folderId] === categoryId) {
        delete newMap[folderId];
      }
    });
    setFolderCategories(newCategories);
    setFolderCategoryMap(newMap);
    saveFolderCategories(newCategories, newMap, folderOrderMap);
  };

  // 폴더를 카테고리에 배정 (분류 모드 유지)
  const handleAssignFolderToCategory = (folderId: string, categoryId: string | null) => {
    const newMap = { ...folderCategoryMap };
    if (categoryId) {
      newMap[folderId] = categoryId;
    } else {
      delete newMap[folderId];
    }
    setFolderCategoryMap(newMap);
    saveFolderCategories(folderCategories, newMap, folderOrderMap);
    setSelectedFolderForAssign(null);
    // 분류 모드는 유지 (사용자가 종료 버튼 클릭 시에만 종료)
  };

  // 두 폴더의 카테고리 또는 위치 교환
  const handleSwapFolderCategories = (folderId1: string, folderId2: string) => {
    const cat1 = folderCategoryMap[folderId1];
    const cat2 = folderCategoryMap[folderId2];

    // 같은 카테고리 내에 있으면 순서만 교환
    if (cat1 === cat2 || (!cat1 && !cat2)) {
      const newOrderMap = { ...folderOrderMap };
      // 순서가 없으면 현재 인덱스 기반으로 초기화
      const sameCategoryFolders = customFolders
        .filter(f => (cat1 ? folderCategoryMap[f.id] === cat1 : !folderCategoryMap[f.id]))
        .sort((a, b) => (folderOrderMap[a.id] ?? 999) - (folderOrderMap[b.id] ?? 999));

      // 현재 인덱스 찾기
      const idx1 = sameCategoryFolders.findIndex(f => f.id === folderId1);
      const idx2 = sameCategoryFolders.findIndex(f => f.id === folderId2);

      if (idx1 !== -1 && idx2 !== -1) {
        // 실제 인덱스로 순서 교환
        newOrderMap[folderId1] = idx2;
        newOrderMap[folderId2] = idx1;
        setFolderOrderMap(newOrderMap);
        saveFolderCategories(folderCategories, folderCategoryMap, newOrderMap);
      }
      setSelectedFolderForAssign(null);
      return;
    }

    // 다른 카테고리면 카테고리 교환
    const newMap = { ...folderCategoryMap };
    if (cat2) {
      newMap[folderId1] = cat2;
    } else {
      delete newMap[folderId1];
    }
    if (cat1) {
      newMap[folderId2] = cat1;
    } else {
      delete newMap[folderId2];
    }

    setFolderCategoryMap(newMap);
    saveFolderCategories(folderCategories, newMap, folderOrderMap);
    setSelectedFolderForAssign(null);
  };

  // 분류 모드에서 폴더 클릭 핸들러
  const handleFolderClickInAssignMode = (folderId: string) => {
    if (!selectedFolderForAssign) {
      // 선택된 폴더가 없으면 이 폴더를 선택
      setSelectedFolderForAssign(folderId);
    } else if (selectedFolderForAssign === folderId) {
      // 같은 폴더를 다시 클릭하면 선택 해제
      setSelectedFolderForAssign(null);
    } else {
      // 다른 폴더를 클릭하면 카테고리 교환
      handleSwapFolderCategories(selectedFolderForAssign, folderId);
    }
  };


  const {
    wrongItems,
    bookmarkedItems,
    solvedItems,
    groupedWrongItems,
    groupedBookmarkedItems,
    groupedSolvedItems,
    chapterGroupedWrongItems,
    quizAttempts,
    customFolders: customFoldersData,
    privateQuizzes,
    updatedQuizzes,
    loading,
    createCustomFolder,
    deleteCustomFolder,
    deleteWrongQuiz,
    deleteWrongQuizByChapter,
    deleteBookmarkQuiz,
    updateReviewItemsFromQuiz,
    refresh,
    deletedItems,
    restoreDeletedItem,
    permanentlyDeleteItem,
    markAsReviewed,
  } = useReview();

  // 퀴즈 북마크 훅
  const {
    bookmarkedQuizzes,
    toggleBookmark: toggleQuizBookmark,
    isBookmarked: isQuizBookmarked,
    loading: bookmarkLoading,
  } = useQuizBookmark();

  // 서재 (AI 학습 퀴즈) 훅
  const {
    quizzes: libraryQuizzesRaw,
    loading: libraryLoading,
    deleteQuiz: deleteLibraryQuiz,
    uploadToPublic,
  } = useLearningQuizzes();

  // 완료된 퀴즈 구독 (커스텀 + 교수 퀴즈 — AI 생성 제외)
  const [completedQuizzes, setCompletedQuizzes] = useState<LearningQuiz[]>([]);
  const [completedLoading, setCompletedLoading] = useState(true);

  useEffect(() => {
    if (!user || !userCourseId) {
      setCompletedQuizzes([]);
      setCompletedLoading(false);
      return;
    }

    // quiz_completions에서 완료된 퀴즈 ID 가져오기
    const completionsRef = collection(db, 'quiz_completions');
    const q = query(completionsRef, where('userId', '==', user.uid));

    const unsub = onSnapshot(q, async (snap) => {
      const completionMap = new Map<string, { score: number; total: number; courseId: string | null; completedAt: any }>();
      snap.docs.forEach(d => {
        const data = d.data();
        completionMap.set(data.quizId, {
          score: data.score ?? 0,
          total: data.totalCount ?? data.totalQuestions ?? 0,
          courseId: data.courseId ?? null,
          completedAt: data.completedAt,
        });
      });

      if (completionMap.size === 0) {
        setCompletedQuizzes([]);
        setCompletedLoading(false);
        return;
      }

      // AI 생성 퀴즈는 이미 libraryQuizzesRaw에 있으므로 제외
      const aiQuizIds = new Set(libraryQuizzesRaw.map(q => q.id));
      const quizIds = Array.from(completionMap.keys()).filter(id => !aiQuizIds.has(id));

      if (quizIds.length === 0) {
        setCompletedQuizzes([]);
        setCompletedLoading(false);
        return;
      }

      // 퀴즈 메타데이터 로드 (10개씩 배치)
      const quizzes: LearningQuiz[] = [];
      const foundIds = new Set<string>();
      for (let i = 0; i < quizIds.length; i += 10) {
        const batch = quizIds.slice(i, i + 10);
        const quizzesRef = collection(db, 'quizzes');
        const batchQuery = query(quizzesRef, where('__name__', 'in', batch));
        const batchSnap = await getDocs(batchQuery);
        batchSnap.docs.forEach(d => {
          const data = d.data();
          // 현재 과목 퀴즈만
          if (data.courseId !== userCourseId) return;
          foundIds.add(d.id);
          const comp = completionMap.get(d.id);
          quizzes.push({
            id: d.id,
            title: data.title || '제목 없음',
            questionCount: data.questions?.length || data.questionCount || 0,
            score: comp?.score ?? 0,
            totalQuestions: comp?.total ?? data.questions?.length ?? data.questionCount ?? 0,
            createdAt: data.createdAt?.toDate?.() ?? new Date(),
            completedAt: data.createdAt?.toDate?.() ?? new Date(),
            isPublic: data.isPublic ?? false,
            tags: data.tags || [],
            difficulty: data.difficulty || 'medium',
            myScore: data.userScores?.[user.uid] ?? comp?.score,
            myFirstReviewScore: data.userFirstReviewScores?.[user.uid],
            creatorId: data.creatorId || undefined,
            quizType: data.type || undefined,
            oxCount: data.oxCount,
            multipleChoiceCount: data.multipleChoiceCount,
            subjectiveCount: data.subjectiveCount,
          });
        });
      }

      // 삭제된 퀴즈 폴백: quizResults에서 제목 가져오기
      const missingIds = quizIds.filter(id => !foundIds.has(id));
      for (const missingId of missingIds) {
        const comp = completionMap.get(missingId);
        // 현재 과목 퀴즈만
        if (comp?.courseId && comp.courseId !== userCourseId) continue;
        // quizResults에서 제목 조회
        let title = '퀴즈';
        let totalCount = comp?.total ?? 0;
        let quizCreatorId: string | undefined;
        let quizType: string | undefined;
        let quizIsPublic = false;
        try {
          const resultQuery = query(
            collection(db, 'quizResults'),
            where('userId', '==', user.uid),
            where('quizId', '==', missingId),
            limit(1)
          );
          const resultSnap = await getDocs(resultQuery);
          if (!resultSnap.empty) {
            const resultData = resultSnap.docs[0].data();
            title = resultData.quizTitle || '퀴즈';
            totalCount = resultData.totalCount || totalCount;
            quizCreatorId = resultData.quizCreatorId || undefined;
            quizType = resultData.quizType || undefined;
            quizIsPublic = resultData.quizIsPublic ?? false;
          }
        } catch { /* 무시 */ }
        // quizType이 없으면 creatorId로 추정
        if (!quizType && quizCreatorId && quizCreatorId !== user.uid) {
          quizType = 'professor';
        }
        quizzes.push({
          id: missingId,
          title,
          questionCount: totalCount,
          score: comp?.score ?? 0,
          totalQuestions: totalCount,
          createdAt: comp?.completedAt?.toDate?.() ?? new Date(),
          completedAt: comp?.completedAt?.toDate?.() ?? new Date(),
          isPublic: quizIsPublic,
          tags: [],
          difficulty: 'medium',
          myScore: comp?.score,
          creatorId: quizCreatorId,
          quizType,
        });
      }

      // 최신순 정렬
      quizzes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setCompletedQuizzes(quizzes);
      setCompletedLoading(false);
    });

    return () => unsub();
  }, [user, userCourseId, libraryQuizzesRaw]);

  // 서재 고정 태그 목록
  // 과목별 동적 태그 목록 (공통 태그 + 챕터 태그)
  const libraryTagOptions = useMemo(() => {
    const courseTags = generateCourseTags(userCourseId);
    return [...COMMON_TAGS.map(t => t.value), ...courseTags.map(t => t.value)];
  }, [userCourseId]);

  // 서재 통합 목록 (AI 생성 + 완료된 퀴즈)
  const allLibraryQuizzes = useMemo(() => {
    return [...libraryQuizzesRaw, ...completedQuizzes];
  }, [libraryQuizzesRaw, completedQuizzes]);

  // 태그 필터링된 서재 퀴즈
  const libraryQuizzes = useMemo(() => {
    if (librarySelectedTags.length === 0) return allLibraryQuizzes;
    return allLibraryQuizzes.filter(quiz =>
      librarySelectedTags.every(tag => quiz.tags?.includes(tag))
    );
  }, [allLibraryQuizzes, librarySelectedTags]);

  // 찜 고정 태그 목록 (서재와 동일)
  // 찜 태그 목록 (서재와 동일)
  const bookmarkTagOptions = libraryTagOptions;

  // 태그 필터링된 찜 퀴즈
  const filteredBookmarkedQuizzes = useMemo(() => {
    if (bookmarkSelectedTags.length === 0) return bookmarkedQuizzes;
    // 선택된 모든 태그를 포함하는 퀴즈만 필터링 (AND 조건)
    return bookmarkedQuizzes.filter(quiz =>
      bookmarkSelectedTags.every(tag => quiz.tags?.includes(tag))
    );
  }, [bookmarkedQuizzes, bookmarkSelectedTags]);

  // 퀴즈 업데이트 감지 훅 (상세 정보 포함)
  const {
    checkQuizUpdate,
    refresh: refreshQuizUpdate,
  } = useQuizUpdate();

  // 업데이트 확인 모달
  const [updateModalInfo, setUpdateModalInfo] = useState<{
    quizId: string;
    quizTitle: string;
    filterType: string;
  } | null>(null);

  // UpdateQuizModal용 상세 업데이트 정보
  const [detailedUpdateInfo, setDetailedUpdateInfo] = useState<DetailedQuizUpdateInfo | null>(null);
  const [updateModalLoading, setUpdateModalLoading] = useState(false);
  const [totalQuestionCount, setTotalQuestionCount] = useState(0);

  // 업데이트 모달이 열릴 때 네비게이션 숨김
  useHideNav(!!(updateModalInfo || detailedUpdateInfo));

  // 커스텀 폴더 (결합형 문제는 1개로 계산)
  const customFolders = customFoldersData.map(f => ({
    id: f.id,
    title: f.name,
    count: calculateCustomFolderQuestionCount(f.questions),
    type: 'custom' as const,
  }));

  // 현재 필터에 따른 데이터
  const getCurrentFolders = () => {
    switch (activeFilter) {
      case 'library':
        // 서재 탭은 LibraryGridView에서 별도 처리 (폴더 목록 불필요)
        return [];
      case 'wrong':
        return groupedWrongItems.map(g => ({
          id: g.quizId,
          title: g.quizTitle,
          count: g.questionCount,
          filterType: 'wrong' as const,
        }));
      case 'bookmark':
        // 찜 탭은 BookmarkGridView에서 별도 처리 (폴더 목록 불필요)
        return [];
      case 'custom':
        return customFolders.map(f => ({ ...f, filterType: 'custom' as const }));
      default:
        return [];
    }
  };

  const currentFolders = getCurrentFolders();

  // 선택된 폴더 수
  const selectedCount = deleteFolderIds.size;

  // URL 파라미터 변경 시 필터 업데이트
  useEffect(() => {
    const filterParam = searchParams.get('filter') as ReviewFilter;
    if (filterParam && ['library', 'wrong', 'bookmark', 'custom'].includes(filterParam)) {
      setActiveFilter(filterParam);
    }
  }, [searchParams]);

  // 필터 변경 시 삭제 선택 모드는 유지 (다른 탭에서도 추가 선택 가능)

  const handleFolderClick = (folder: { id: string; title: string; count: number; filterType: string }) => {
    if (isFolderDeleteMode) {
      // 폴더 삭제 선택 모드 - 모든 타입 삭제 가능
      const newSelected = new Set(deleteFolderIds);
      const folderId = `${folder.filterType}-${folder.id}`;

      if (newSelected.has(folderId)) {
        newSelected.delete(folderId);
      } else {
        newSelected.add(folderId);
      }
      setDeleteFolderIds(newSelected);
    } else {
      // 일반 모드에서는 폴더 상세로 이동
      router.push(`/review/${folder.filterType}/${folder.id}`);
    }
  };

  // 폴더 삭제 핸들러
  const handleDeleteFolder = async (folder: { id: string; filterType: string }) => {
    const confirmed = window.confirm('이 폴더를 삭제하시겠습니까?\n삭제 시 퀴즈 목록에서 다시 풀 수 있습니다.');
    if (!confirmed) return;

    try {
      if (folder.filterType === 'custom') {
        await deleteCustomFolder(folder.id);
      }
    } catch (err) {
      console.error('폴더 삭제 실패:', err);
      alert('삭제에 실패했습니다.');
    }
  };

  // 복습하기 버튼 클릭 - 전체 복습 시작
  const handleReviewButtonClick = () => {
    // 현재 탭의 모든 문제로 복습 시작
    let items: ReviewItem[] = [];

    if (activeFilter === 'wrong') {
      items = wrongItems;
    } else if (activeFilter === 'bookmark') {
      // 찜한 문제만 복습 (bookmarkedItems 사용)
      items = bookmarkedItems;
    }

    if (items.length > 0) {
      setPracticeItems(items);
    }
  };

  const handleCreateFolder = async (name: string) => {
    const folderId = await createCustomFolder(name);
    if (folderId) {
      // 폴더 생성 성공 - onSnapshot이 자동으로 업데이트
      console.log('폴더 생성 성공:', folderId);
    } else {
      alert('폴더 생성에 실패했습니다.');
    }
  };

  // 선택된 폴더들 삭제 (바텀시트에서 확인 후 호출)
  const handleDeleteSelectedFolders = async () => {
    if (deleteFolderIds.size === 0) return;

    try {
      // 중복 삭제 방지를 위한 Set (wrong은 quizId+chapterId 조합으로)
      const deletedWrongKeys = new Set<string>();
      const deletedBookmarkQuizIds = new Set<string>();

      for (const folderId of deleteFolderIds) {
        if (folderId.startsWith('custom-')) {
          const id = folderId.replace('custom-', '');
          await deleteCustomFolder(id);
        } else if (folderId.startsWith('wrong-')) {
          // wrong-{quizId}-chapter-{chapterId} 형식 처리
          const withoutPrefix = folderId.replace('wrong-', '');
          const parts = withoutPrefix.split('-chapter-');
          const quizId = parts[0];
          const chapterId = parts[1] === 'uncategorized' ? null : parts[1];

          // 중복 체크 (quizId + chapterId 조합)
          const key = `${quizId}-${chapterId || 'null'}`;
          if (!deletedWrongKeys.has(key)) {
            deletedWrongKeys.add(key);

            // 챕터 이름 가져오기
            let chapterName: string | undefined;
            if (chapterId && userCourseId) {
              const chapter = getChapterById(userCourseId, chapterId);
              chapterName = chapter?.name;
            }

            await deleteWrongQuizByChapter(quizId, chapterId, chapterName);
          }
        } else if (folderId.startsWith('bookmark-')) {
          const id = folderId.replace('bookmark-', '');
          if (!deletedBookmarkQuizIds.has(id)) {
            deletedBookmarkQuizIds.add(id);
            // 퀴즈 북마크 해제 (useQuizBookmark 사용)
            await toggleQuizBookmark(id);
          }
        }
      }
    } catch (err) {
      console.error('폴더 삭제 실패:', err);
      alert('삭제에 실패했습니다.');
    } finally {
      // 성공/실패 여부와 관계없이 삭제 모드 해제
      setDeleteFolderIds(new Set());
      setIsFolderDeleteMode(false);
      setShowDeleteConfirmSheet(false);
    }
  };

  // 삭제 확인 바텀시트에서 개별 항목 제거 (되살리기)
  const handleRemoveFromDeleteList = (folderId: string) => {
    const newSelected = new Set(deleteFolderIds);
    newSelected.delete(folderId);
    setDeleteFolderIds(newSelected);
  };

  // 선택한 폴더/문제지로 복습 시작
  const handleStartSelectedReview = useCallback(async () => {
    if (reviewSelectedIds.size === 0) return;

    const items: ReviewItem[] = [];
    const seenQuestions = new Set<string>(); // quizId:questionId 중복 방지
    const libraryQuizIds: string[] = [];

    for (const folderId of reviewSelectedIds) {
      if (folderId.startsWith('wrong-')) {
        // wrong-quizId-chapter-chapterId 형식 처리
        const parts = folderId.replace('wrong-', '').split('-chapter-');
        const quizId = parts[0];
        const chapterKey = parts[1]; // 'uncategorized' 또는 실제 chapterId

        // chapterGroupedWrongItems에서 해당 챕터 그룹 찾기
        const chapterGroup = chapterGroupedWrongItems.find(cg =>
          (cg.chapterId || 'uncategorized') === chapterKey
        );
        if (chapterGroup) {
          // 해당 퀴즈의 아이템만 추가
          const folder = chapterGroup.folders.find(f => f.quizId === quizId);
          if (folder) {
            for (const item of folder.items) {
              const key = `${item.quizId}:${item.questionId}`;
              if (!seenQuestions.has(key)) {
                seenQuestions.add(key);
                items.push(item);
              }
            }
          }
        }
      } else if (folderId.startsWith('bookmark-')) {
        const quizId = folderId.replace('bookmark-', '');
        // 찜한 퀴즈의 문제들은 bookmarkedItems에서 가져옴
        const bookmarkGroup = groupedBookmarkedItems.find(g => g.quizId === quizId);
        if (bookmarkGroup) {
          for (const item of bookmarkGroup.items) {
            const key = `${item.quizId}:${item.questionId}`;
            if (!seenQuestions.has(key)) {
              seenQuestions.add(key);
              items.push(item);
            }
          }
        }
      } else if (folderId.startsWith('custom-')) {
        const id = folderId.replace('custom-', '');
        const folder = customFoldersData.find(f => f.id === id);
        if (folder) {
          // 커스텀 폴더의 문제들을 solvedItems에서 찾아서 추가
          // solvedItems에 없으면 Firestore에서 직접 조회 (50건 제한 폴백)
          for (const q of folder.questions) {
            const dedupKey = `${q.quizId}:${q.questionId}`;
            if (seenQuestions.has(dedupKey)) continue;
            const solvedItem = solvedItems.find(s => s.questionId === q.questionId && s.quizId === q.quizId);
            if (solvedItem) {
              seenQuestions.add(dedupKey);
              items.push(solvedItem);
            } else if (user?.uid) {
              try {
                const reviewSnap = await getDocs(query(
                  collection(db, 'reviews'),
                  where('userId', '==', user.uid),
                  where('quizId', '==', q.quizId),
                  where('questionId', '==', q.questionId),
                  limit(1)
                ));
                if (!reviewSnap.empty) {
                  const data = reviewSnap.docs[0].data();
                  seenQuestions.add(dedupKey);
                  items.push({ id: reviewSnap.docs[0].id, ...data } as ReviewItem);
                }
              } catch (err) {
                console.error('커스텀 폴더 폴백 조회 실패:', err);
              }
            }
          }
        }
      } else if (folderId.startsWith('library-')) {
        // 서재 퀴즈 ID 수집 (나중에 일괄 처리)
        const quizId = folderId.replace('library-', '');
        libraryQuizIds.push(quizId);
      }
    }

    // 서재 퀴즈들의 문제 가져오기
    for (const quizId of libraryQuizIds) {
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (quizDoc.exists()) {
          const quizData = quizDoc.data();
          const questions = quizData.questions || [];
          const quizTitle = quizData.title || '서재 퀴즈';

          questions.forEach((q: any, idx: number) => {
            // 중복 체크
            const qId = q.id || `q${idx}`;
            const dedupKey = `${quizId}:${qId}`;
            if (seenQuestions.has(dedupKey)) return;
            seenQuestions.add(dedupKey);

            // ReviewItem 형식으로 변환
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

            items.push({
              id: `library-${quizId}-${q.id || idx}`,
              userId: user?.uid || '',
              quizId,
              quizTitle,
              questionId: q.id || `q${idx}`,
              question: q.text || '',
              type: q.type === 'short' ? 'short_answer' : (q.type || 'multiple'),
              options: q.choices || [],
              correctAnswer,
              userAnswer: correctAnswer, // 서재 퀴즈는 정답으로 설정
              explanation: q.explanation || '',
              choiceExplanations: q.choiceExplanations || undefined,
              isCorrect: true,
              reviewType: 'solved',
              isBookmarked: false,
              reviewCount: 0,
              lastReviewedAt: null,
              createdAt: quizData.createdAt || new Date() as any,
              // 이미지
              courseId: userCourseId || null,
              image: q.image || null,
              imageUrl: q.imageUrl || null,
              chapterId: q.chapterId || null,
              // 제시문
              passage: q.passage || undefined,
              passageType: q.passageType || undefined,
              passageImage: q.passageImage || undefined,
              koreanAbcItems: q.koreanAbcItems || undefined,
              passageMixedExamples: q.passageMixedExamples || undefined,
              commonQuestion: q.commonQuestion || undefined,
              // 보기
              mixedExamples: q.mixedExamples || undefined,
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
            } as any);
          });
        }
      } catch (error) {
        console.error('서재 퀴즈 로드 오류:', error);
      }
    }

    if (items.length > 0) {
      setPracticeMode('all'); // 선택 복습도 "모두" 복습으로 취급
      setPracticeItems(items);
      setIsReviewSelectMode(false);
      setReviewSelectedIds(new Set());
    } else {
      alert('선택한 항목에 복습할 문제가 없습니다.');
    }
  }, [reviewSelectedIds, groupedSolvedItems, groupedBookmarkedItems, chapterGroupedWrongItems, customFoldersData, solvedItems, user?.uid, userCourseId]);

  // 선택한 폴더 정보 가져오기 (바텀시트 표시용)
  const getSelectedFolderInfo = useCallback(() => {
    const info: { id: string; title: string; type: string; count: number }[] = [];

    deleteFolderIds.forEach(folderId => {
      if (folderId.startsWith('wrong-')) {
        // wrong-quizId-chapter-chapterId 형식 처리
        const parts = folderId.replace('wrong-', '').split('-chapter-');
        const quizId = parts[0];
        const chapterKey = parts[1]; // 'uncategorized' 또는 실제 chapterId

        // chapterGroupedWrongItems에서 해당 챕터 그룹 찾기
        const chapterGroup = chapterGroupedWrongItems.find(cg =>
          (cg.chapterId || 'uncategorized') === chapterKey
        );
        if (chapterGroup) {
          const folder = chapterGroup.folders.find(f => f.quizId === quizId);
          if (folder) {
            // 챕터명 · 퀴즈명 형식
            const displayTitle = chapterGroup.chapterName !== '기타'
              ? `${chapterGroup.chapterName} · ${folder.quizTitle}`
              : folder.quizTitle;
            info.push({ id: folderId, title: displayTitle, type: '오답', count: folder.questionCount });
          }
        }
      } else if (folderId.startsWith('bookmark-')) {
        const quizId = folderId.replace('bookmark-', '');
        const quiz = bookmarkedQuizzes.find(bq => bq.quizId === quizId);
        if (quiz) {
          info.push({ id: folderId, title: quiz.title, type: '찜', count: quiz.questionCount });
        }
      } else if (folderId.startsWith('custom-')) {
        const id = folderId.replace('custom-', '');
        const folder = customFoldersData.find(f => f.id === id);
        if (folder) {
          info.push({ id: folderId, title: folder.name, type: '커스텀', count: calculateCustomFolderQuestionCount(folder.questions) });
        }
      }
    });

    return info;
  }, [deleteFolderIds, chapterGroupedWrongItems, bookmarkedQuizzes, customFoldersData]);

  // 퀴즈 ID로 복습 시작 (찜탭, 문제탭에서 Review 버튼 클릭 시)
  const handleStartReviewByQuizId = useCallback((quizId: string) => {
    // solved에서 해당 퀴즈의 문제들 찾기
    const solvedGroup = groupedSolvedItems.find(g => g.quizId === quizId);
    if (solvedGroup && solvedGroup.items.length > 0) {
      setPracticeMode('all'); // 모두 복습 모드
      setPracticeItems(solvedGroup.items);
    } else {
      // 복습할 문제가 없으면 퀴즈 페이지로 이동
      router.push(`/quiz/${quizId}`);
    }
  }, [groupedSolvedItems, router]);

  // 퀴즈 ID로 오답만 복습 시작
  const handleStartReviewWrongOnlyByQuizId = useCallback((quizId: string) => {
    // wrong에서 해당 퀴즈의 오답 문제들 찾기
    const wrongGroup = groupedWrongItems.find(g => g.quizId === quizId);
    if (wrongGroup && wrongGroup.items.length > 0) {
      setPracticeMode('wrongOnly'); // 오답만 복습 모드
      setPracticeItems(wrongGroup.items);
    } else {
      alert('이 문제지에 오답이 없습니다.');
    }
  }, [groupedWrongItems]);

  const handleEndPractice = useCallback(async (results?: PracticeResult[]) => {
    // 복습 완료된 문제 reviewCount 증가 (복습력 측정용)
    if (results && results.length > 0) {
      for (const r of results) {
        try {
          await markAsReviewed(r.reviewId);
        } catch {
          // 개별 실패 무시
        }
      }
    }

    // 복습 결과가 있고, "모두" 복습 모드일 때만 첫번째 복습 점수 저장
    // "오답만" 복습은 첫 복습 점수에 포함되지 않음
    if (results && results.length > 0 && user && practiceModeRef.current === 'all') {
      // 퀴즈별로 그룹화
      const scoresByQuiz = new Map<string, { correct: number; total: number }>();
      results.forEach(r => {
        const existing = scoresByQuiz.get(r.quizId) || { correct: 0, total: 0 };
        existing.total++;
        if (r.isCorrect) existing.correct++;
        scoresByQuiz.set(r.quizId, existing);
      });

      // 각 퀴즈에 대해 첫번째 복습 점수 저장 (아직 없는 경우에만)
      for (const [quizId, { correct, total }] of scoresByQuiz) {
        try {
          const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
          if (quizDoc.exists()) {
            const quizData = quizDoc.data();
            // 첫번째 복습 점수가 없는 경우에만 저장
            if (!quizData.userFirstReviewScores?.[user.uid]) {
              const score = Math.round((correct / total) * 100);
              await updateDoc(doc(db, 'quizzes', quizId), {
                [`userFirstReviewScores.${user.uid}`]: score,
              });
            }
          }
        } catch (err) {
          console.error('복습 점수 저장 실패:', err);
        }
      }
    }
    setPracticeItems(null);
    setPracticeMode(null);
  }, [user, markAsReviewed]);

  // 연습 모드
  if (practiceItems) {
    return (
      <ReviewPractice
        items={practiceItems}
        onComplete={(results) => handleEndPractice(results)}
        onClose={() => handleEndPractice()}
        currentUserId={user?.uid}
      />
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 - 배너 이미지 */}
      <header className="flex flex-col items-center">
        <div className="w-full h-[160px] mt-2">
          <img
            src={ribbonImage}
            alt="Review"
            className="w-full h-full object-contain"
            style={{ transform: `scale(${ribbonScale}) scaleX(1.15)` }}
          />
        </div>

        {/* 필터 + 버튼 영역 */}
        <div className="w-full px-4 py-1 flex items-center justify-between gap-4">
          {/* 슬라이드 필터 - 좌측 */}
          <SlideFilter
            activeFilter={activeFilter}
            onFilterChange={(filter) => {
              setActiveFilter(filter);
              // 필터 변경 시 선택 모드 유지하되 선택 초기화
            }}
          />

          {/* 버튼 영역 - 우측 */}
          <div className="flex gap-2">
            <AnimatePresence mode="wait">
              {isFolderDeleteMode ? (
                // 삭제 선택 모드 버튼들
                <>
                  <motion.button
                    key="cancel-delete"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => {
                      setIsFolderDeleteMode(false);
                      setDeleteFolderIds(new Set());
                    }}
                    className="px-3 py-2 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors rounded-lg"
                  >
                    취소
                  </motion.button>
                  {/* 휴지통 버튼 */}
                  <motion.button
                    key="trash-button"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => setShowDeleteConfirmSheet(true)}
                    className="px-3 py-2 text-xs font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#FDEAEA] whitespace-nowrap transition-colors flex items-center justify-center rounded-lg"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </motion.button>
                  {/* 삭제 버튼 */}
                  <motion.button
                    key="delete-button"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={async () => {
                      if (deleteFolderIds.size > 0) {
                        const confirmed = window.confirm(`${deleteFolderIds.size}개 항목을 삭제하시겠습니까?`);
                        if (confirmed) {
                          await handleDeleteSelectedFolders();
                        }
                      }
                    }}
                    disabled={deleteFolderIds.size === 0}
                    className={`px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors rounded-lg ${
                      deleteFolderIds.size > 0
                        ? 'bg-[#8B1A1A] text-[#F5F0E8] hover:bg-[#7A1717]'
                        : 'bg-[#D4CFC4] text-[#EDEAE4] cursor-not-allowed'
                    }`}
                  >
                    삭제{deleteFolderIds.size > 0 && ` (${deleteFolderIds.size})`}
                  </motion.button>
                </>
              ) : isLibrarySelectMode ? (
                // 서재 삭제 선택 모드 버튼들
                <>
                  <motion.button
                    key="cancel-library"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => {
                      setIsLibrarySelectMode(false);
                      setLibrarySelectedIds(new Set());
                    }}
                    className="px-3 py-2 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors rounded-lg"
                  >
                    취소
                  </motion.button>
                  {/* 삭제 버튼 */}
                  <motion.button
                    key="delete-library"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={async () => {
                      if (librarySelectedIds.size > 0) {
                        const confirmed = window.confirm(`${librarySelectedIds.size}개 퀴즈를 삭제하시겠습니까?`);
                        if (confirmed) {
                          for (const quizId of librarySelectedIds) {
                            try {
                              await deleteLibraryQuiz(quizId);
                            } catch (err) {
                              console.error('삭제 오류:', err);
                            }
                          }
                          setIsLibrarySelectMode(false);
                          setLibrarySelectedIds(new Set());
                        }
                      }
                    }}
                    disabled={librarySelectedIds.size === 0}
                    className={`px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors rounded-lg ${
                      librarySelectedIds.size > 0
                        ? 'bg-[#8B1A1A] text-[#F5F0E8] hover:bg-[#7A1717]'
                        : 'bg-[#D4CFC4] text-[#EDEAE4] cursor-not-allowed'
                    }`}
                  >
                    삭제 {librarySelectedIds.size > 0 && `(${librarySelectedIds.size})`}
                  </motion.button>
                </>
              ) : isPdfSelectMode ? (
                // PDF 폴더 선택 모드 버튼들
                <>
                  <motion.button
                    key="cancel-pdf"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => {
                      setIsPdfSelectMode(false);
                      setSelectedPdfFolders(new Set());
                    }}
                    className="px-3 py-2 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors rounded-lg"
                  >
                    취소
                  </motion.button>
                  <motion.button
                    key="download-pdf"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    disabled={selectedPdfFolders.size === 0}
                    onClick={async () => {
                      const includeAnswers = true;
                      const includeExplanations = true;

                      try {
                        const { exportQuestionsToPdf } = await import('@/lib/utils/questionPdfExport');
                        const allQuestions: PdfQuestionData[] = [];

                        const selectedFolders = customFoldersData.filter(f => selectedPdfFolders.has(f.id));

                        // 고유 quizId 수집 → 한 번씩만 fetch
                        const quizIdSet = new Set<string>();
                        for (const folder of selectedFolders) {
                          for (const q of folder.questions) quizIdSet.add(q.quizId);
                        }

                        // 배치 fetch → Map 캐시
                        const quizCache = new Map<string, any>();
                        let fetchFailed = 0;
                        for (const quizId of quizIdSet) {
                          try {
                            const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
                            if (quizDoc.exists()) quizCache.set(quizId, quizDoc.data());
                            else fetchFailed++;
                          } catch { fetchFailed++; }
                        }

                        // 문제 매핑 (누락 카운트)
                        let skippedCount = 0;
                        const quizIndexCounters: Record<string, number> = {};
                        for (const folder of selectedFolders) {
                          for (const q of folder.questions) {
                            const quizData = quizCache.get(q.quizId);
                            if (!quizData) { skippedCount++; continue; }
                            const quizQuestions = (quizData.questions as any[]) || [];
                            // questionId로 매칭 시도
                            let question: any = q.questionId
                              ? quizQuestions.find((qq: any, idx: number) => (qq.id || `q${idx}`) === q.questionId)
                              : null;
                            // 폴백: questionId 누락/매칭 실패 시 같은 퀴즈 내 순서대로 매칭
                            if (!question) {
                              const counter = quizIndexCounters[q.quizId] || 0;
                              if (counter < quizQuestions.length) question = quizQuestions[counter];
                              quizIndexCounters[q.quizId] = counter + 1;
                            }
                            if (!question) { skippedCount++; continue; }
                            // answer 안전 변환 (배열/숫자/문자열 모두 대응)
                            const rawAnswer = question.answer;
                            const answerStr = Array.isArray(rawAnswer)
                              ? rawAnswer.map((a: any) => String(a)).join(',')
                              : String(rawAnswer ?? '');

                            // AI 퀴즈(0-indexed) vs 수동 퀴즈(1-indexed) 구분
                            const isAiQuiz = quizData.type === 'professor-ai' || quizData.type === 'ai-generated' || quizData.originalType === 'professor-ai';

                            allQuestions.push({
                              text: question.text || '',
                              type: question.type || 'multiple',
                              choices: Array.isArray(question.choices) ? question.choices : undefined,
                              answer: answerStr,
                              explanation: question.explanation || '',
                              imageUrl: question.imageUrl || undefined,
                              passage: question.passage || undefined,
                              passageType: question.passageType || undefined,
                              koreanAbcItems: question.koreanAbcItems || undefined,
                              bogi: question.bogi || undefined,
                              passagePrompt: question.commonQuestion || question.passagePrompt || undefined,
                              hasMultipleAnswers: answerStr.includes(','),
                              answerZeroIndexed: isAiQuiz,
                              // 결합형 문제 필드
                              passageImage: question.passageImage || undefined,
                              combinedGroupId: question.combinedGroupId || undefined,
                              combinedIndex: question.combinedIndex ?? undefined,
                              combinedTotal: question.combinedTotal ?? undefined,
                              // 복합 제시문
                              passageMixedExamples: question.passageMixedExamples || undefined,
                              mixedExamples: question.mixedExamples || undefined,
                            });
                          }
                        }

                        // 누락 알림
                        if (skippedCount > 0) {
                          alert(`${skippedCount}개 문제를 찾을 수 없어 제외되었습니다.`);
                        }
                        if (allQuestions.length === 0) {
                          alert('내보낼 문제가 없습니다.');
                          return;
                        }

                        const folderName = selectedFolders.length === 1 ? selectedFolders[0].name : '커스텀 문제집';
                        await exportQuestionsToPdf(allQuestions, {
                          includeAnswers,
                          includeExplanations,
                          folderName,
                          userName: profile?.nickname || '',
                          studentId: profile?.studentId || '',
                          courseName: userCourseId ? getCourseById(userCourseId)?.name : undefined,
                        });
                      } catch (err) {
                        console.error('PDF 다운로드 실패:', err);
                      } finally {
                        setIsPdfSelectMode(false);
                        setSelectedPdfFolders(new Set());
                      }
                    }}
                    className={`px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors rounded-lg ${
                      selectedPdfFolders.size > 0
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A]'
                        : 'bg-[#D4CFC4] text-[#EDEAE4] cursor-not-allowed'
                    }`}
                  >
                    PDF 다운
                  </motion.button>
                </>
              ) : isReviewSelectMode ? (
                // 복습 선택 모드 버튼들
                <>
                  <motion.button
                    key="cancel-review"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => {
                      setIsReviewSelectMode(false);
                      setReviewSelectedIds(new Set());
                    }}
                    className="px-3 py-2 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors rounded-lg"
                  >
                    취소
                  </motion.button>
                  {/* 복습 시작 버튼 */}
                  <motion.button
                    key="start-review"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => {
                      if (reviewSelectedIds.size > 0) {
                        handleStartSelectedReview();
                      }
                    }}
                    disabled={reviewSelectedIds.size === 0}
                    className={`px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors rounded-lg ${
                      reviewSelectedIds.size > 0
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A]'
                        : 'bg-[#D4CFC4] text-[#EDEAE4] cursor-not-allowed'
                    }`}
                  >
                    복습 시작 {reviewSelectedIds.size > 0 && `(${reviewSelectedIds.size})`}
                  </motion.button>
                </>
              ) : (
                // 일반 모드 버튼들
                <>
                  {/* 선택 복습 버튼 */}
                  <motion.button
                    key="review"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => {
                      setIsReviewSelectMode(true);
                    }}
                    className="px-3 py-2 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#3A3A3A] transition-colors flex items-center gap-1 overflow-visible rounded-lg"
                  >
                    선택 복습
                  </motion.button>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 선택 모드 안내 */}
        <AnimatePresence>
          {(isFolderDeleteMode || isReviewSelectMode || isAssignMode || isLibrarySelectMode) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full px-4 mt-3"
            >
              {isReviewSelectMode ? (
                <p className="text-center text-xs text-[#5C5C5C]">
                  {reviewSelectedIds.size > 0
                    ? `${reviewSelectedIds.size}개 선택됨 (다른 탭에서도 추가 선택 가능)`
                    : '복습할 폴더나 문제지를 선택하세요 (다른 탭에서도 추가 선택 가능)'
                  }
                </p>
              ) : (
                <div className={`p-2 border border-dashed text-center ${
                  isFolderDeleteMode || isLibrarySelectMode
                    ? 'bg-[#FDEAEA] border-[#8B1A1A]'
                    : 'bg-[#E8F5E9] border-[#1A6B1A]'
                }`}>
                  <p className={`text-xs ${
                    isFolderDeleteMode || isLibrarySelectMode
                      ? 'text-[#8B1A1A]'
                      : 'text-[#1A6B1A]'
                  }`}>
                    {isFolderDeleteMode
                      ? deleteFolderIds.size > 0
                        ? `${deleteFolderIds.size}개 선택됨 (다른 탭에서도 추가 선택 가능)`
                        : '삭제할 폴더나 문제지를 선택하세요 (다른 탭에서도 추가 선택 가능)'
                      : isLibrarySelectMode
                        ? librarySelectedIds.size > 0
                          ? `${librarySelectedIds.size}개 선택됨`
                          : '삭제할 퀴즈를 선택하세요'
                        : selectedFolderForAssign
                          ? '카테고리 영역 또는 다른 폴더를 탭하세요'
                          : '이동할 폴더를 선택하세요'
                    }
                  </p>
                  {isAssignMode && (
                    <button
                      onClick={() => {
                        setIsAssignMode(false);
                        setSelectedFolderForAssign(null);
                      }}
                      className="mt-2 px-3 py-1 text-xs font-bold border border-[#1A6B1A] text-[#1A6B1A] hover:bg-[#C8E6C9] transition-colors"
                    >
                      카테고리 배정 종료
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 내맘대로 탭일 때 폴더 만들기 + 정렬 + PDF 버튼 */}
        {activeFilter === 'custom' && !isAssignMode && !isFolderDeleteMode && !isPdfSelectMode && !isReviewSelectMode && (
          <div className="w-full px-4 mt-3 flex gap-2">
            <button
              onClick={() => setShowCreateFolder(true)}
              className="flex-1 py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              + 새 폴더
            </button>
            <button
              onClick={() => setIsSortMode(true)}
              className="flex-1 py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors flex items-center justify-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              카테고리 설정
            </button>
            <button
              onClick={() => {
                if (customFoldersData.length === 0) return;
                setIsPdfSelectMode(true);
                setSelectedPdfFolders(new Set());
              }}
              className="flex-1 py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors flex items-center justify-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              PDF 다운
            </button>
          </div>
        )}
      </header>

      <main className="px-4 mt-3">
        {/* 로딩 스켈레톤 (2열 카드 그리드) */}
        {(loading || (activeFilter === 'bookmark' && bookmarkLoading) || (activeFilter === 'library' && (libraryLoading || completedLoading))) && (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <SkeletonQuizCard key={i} />
            ))}
          </div>
        )}

        {/* 서재 탭 - AI 학습 퀴즈 */}
        {!loading && !libraryLoading && !completedLoading && activeFilter === 'library' && (
          <div className="space-y-4">
            {/* 태그 검색 헤더 (3개 이상일 때만 표시) */}
            {allLibraryQuizzes.length >= 3 && (
              <div className="mb-4">
                <div className="flex items-center justify-end mb-2">
                  {/* 선택된 태그들 + 태그 아이콘 */}
                  <div className="flex items-center gap-2">
                    {/* 선택된 태그들 (태그 아이콘 왼쪽에 배치) */}
                    {librarySelectedTags.map((tag) => (
                      <div
                        key={tag}
                        className="flex items-center gap-1 px-2 py-1 bg-[#F5F0E8] text-[#1A1A1A] text-sm font-bold border border-[#1A1A1A]"
                      >
                        #{tag}
                        <button
                          onClick={() => setLibrarySelectedTags(prev => prev.filter(t => t !== tag))}
                          className="ml-0.5 hover:text-[#5C5C5C]"
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    {/* 태그 검색 버튼 */}
                    <button
                      onClick={() => setShowLibraryTagFilter(!showLibraryTagFilter)}
                      className={`flex items-center justify-center w-9 h-9 border transition-colors shrink-0 rounded-lg ${
                        showLibraryTagFilter
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A]'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* 태그 필터 목록 */}
                <AnimatePresence>
                  {showLibraryTagFilter && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-wrap gap-1.5 p-2 bg-[#EDEAE4] border border-[#D4CFC4]">
                        {/* 태그 버튼들 (이미 선택된 태그 제외) */}
                        {libraryTagOptions
                          .filter(tag => !librarySelectedTags.includes(tag))
                          .map((tag) => (
                            <button
                              key={tag}
                              onClick={() => {
                                setLibrarySelectedTags(prev => [...prev, tag]);
                                setShowLibraryTagFilter(false);
                              }}
                              className="px-2 py-1 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#E5E0D8] transition-colors"
                            >
                              #{tag}
                            </button>
                          ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* 필터링 결과가 없을 때 (원본에는 퀴즈가 있지만 필터링 결과가 없을 때) */}
            {allLibraryQuizzes.length > 0 && libraryQuizzes.length === 0 && librarySelectedTags.length > 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center text-center py-8"
              >
                <p className="text-sm text-[#5C5C5C]">
                  {librarySelectedTags.map(t => `#${t}`).join(' ')} 태그가 있는 퀴즈가 없습니다
                </p>
                <button
                  onClick={() => setLibrarySelectedTags([])}
                  className="mt-2 px-4 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                >
                  필터 해제
                </button>
              </motion.div>
            ) : libraryQuizzes.length === 0 ? (
              <EmptyState filter="library" fullHeight />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {libraryQuizzes.map((quiz, index) => {
                  const libraryKey = `library-${quiz.id}`;
                  const isSelected = isLibrarySelectMode
                    ? librarySelectedIds.has(quiz.id)
                    : isReviewSelectMode
                      ? reviewSelectedIds.has(libraryKey)
                      : false;
                  return (
                    <motion.div
                      key={quiz.id}
                      ref={(el) => registerLibraryRef(quiz.id, el)}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                    >
                      <LibraryQuizCard
                        quiz={quiz}
                        onCardClick={() => {
                          if (isLibrarySelectMode) {
                            // 삭제 선택 모드일 때는 체크박스 토글
                            const newSelected = new Set(librarySelectedIds);
                            if (newSelected.has(quiz.id)) {
                              newSelected.delete(quiz.id);
                            } else {
                              newSelected.add(quiz.id);
                            }
                            setLibrarySelectedIds(newSelected);
                          } else if (isReviewSelectMode) {
                            // 복습 선택 모드일 때는 reviewSelectedIds 토글
                            const newSelected = new Set(reviewSelectedIds);
                            if (newSelected.has(libraryKey)) {
                              newSelected.delete(libraryKey);
                            } else {
                              newSelected.add(libraryKey);
                            }
                            setReviewSelectedIds(newSelected);
                          } else {
                            // 일반 모드일 때는 상세 페이지로 이동
                            router.push(`/review/library/${quiz.id}`);
                          }
                        }}
                        onDetails={() => {
                          openLibraryQuizModal(quiz);
                        }}
                        onReview={() => {
                          // 서재 퀴즈는 항상 ReviewPractice로 열기
                          router.push(`/review/library/${quiz.id}?autoStart=all`);
                        }}
                        onReviewWrongOnly={quiz.myScore === 100 ? undefined : () => {
                          // 서재 퀴즈 오답만 복습
                          router.push(`/review/library/${quiz.id}?autoStart=wrongOnly`);
                        }}
                        onPublish={!quiz.isPublic && quiz.creatorId === user?.uid ? () => {
                          setPublishConfirmQuizId(quiz.id);
                        } : undefined}
                        isSelectMode={isLibrarySelectMode || isReviewSelectMode}
                        isSelected={isSelected}
                        currentUserId={user?.uid}
                      />
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 찜 탭 - 2열 그리드 레이아웃 (자작 탭과 동일) */}
        {!loading && !bookmarkLoading && activeFilter === 'bookmark' && (
          <div className="space-y-4">
            {/* 태그 검색 헤더 (3개 이상일 때만 표시) */}
            {bookmarkedQuizzes.length >= 3 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-serif-display text-lg font-black text-[#1A1A1A]">찜</h2>

                  {/* 선택된 태그들 + 태그 아이콘 (우측) */}
                  <div className="flex items-center gap-2">
                    {/* 선택된 태그들 */}
                    {bookmarkSelectedTags.map((tag) => (
                      <div
                        key={tag}
                        className="flex items-center gap-1 px-2 py-1 bg-[#F5F0E8] text-[#1A1A1A] text-sm font-bold border border-[#1A1A1A]"
                      >
                        #{tag}
                        <button
                          onClick={() => setBookmarkSelectedTags(prev => prev.filter(t => t !== tag))}
                          className="ml-0.5 hover:text-[#5C5C5C]"
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    {/* 태그 검색 버튼 */}
                    <button
                      onClick={() => setShowBookmarkTagFilter(!showBookmarkTagFilter)}
                      className={`flex items-center justify-center w-9 h-9 border transition-colors shrink-0 rounded-lg ${
                        showBookmarkTagFilter
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A]'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* 태그 필터 목록 */}
                <AnimatePresence>
                  {showBookmarkTagFilter && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-wrap gap-1.5 p-2 bg-[#EDEAE4] border border-[#D4CFC4]">
                        {bookmarkTagOptions
                          .filter(tag => !bookmarkSelectedTags.includes(tag))
                          .map((tag) => (
                            <button
                              key={tag}
                              onClick={() => {
                                setBookmarkSelectedTags(prev => [...prev, tag]);
                                setShowBookmarkTagFilter(false);
                              }}
                              className="px-2 py-1 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#E5E0D8] transition-colors"
                            >
                              #{tag}
                            </button>
                          ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* 필터링 결과가 없을 때 */}
            {bookmarkedQuizzes.length > 0 && filteredBookmarkedQuizzes.length === 0 && bookmarkSelectedTags.length > 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center text-center py-8"
              >
                <p className="text-sm text-[#5C5C5C]">
                  {bookmarkSelectedTags.map(t => `#${t}`).join(' ')} 태그가 있는 퀴즈가 없습니다
                </p>
                <button
                  onClick={() => setBookmarkSelectedTags([])}
                  className="mt-2 px-4 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                >
                  필터 해제
                </button>
              </motion.div>
            ) : (
              <BookmarkGridView
                bookmarkedQuizzes={filteredBookmarkedQuizzes}
                onQuizCardClick={(quizId) => router.push(`/review/bookmark/${quizId}`)}
                onQuizDetails={(quiz) => setSelectedBookmarkedQuiz(quiz)}
                onStartQuiz={(quizId) => router.push(`/quiz/${quizId}`)}
                onStartReview={(quizId) => handleStartReviewByQuizId(quizId)}
                onStartReviewWrongOnly={(quizId) => handleStartReviewWrongOnlyByQuizId(quizId)}
                onUnbookmark={(quizId) => toggleQuizBookmark(quizId)}
                isSelectMode={isFolderDeleteMode || isReviewSelectMode}
                selectedFolderIds={isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds}
                onSelectToggle={(quizId) => {
                  const key = `bookmark-${quizId}`;
                  if (isFolderDeleteMode) {
                    const newSelected = new Set(deleteFolderIds);
                    if (newSelected.has(key)) {
                      newSelected.delete(key);
                    } else {
                      newSelected.add(key);
                    }
                    setDeleteFolderIds(newSelected);
                  } else if (isReviewSelectMode) {
                    const newSelected = new Set(reviewSelectedIds);
                    if (newSelected.has(key)) {
                      newSelected.delete(key);
                    } else {
                      newSelected.add(key);
                    }
                    setReviewSelectedIds(newSelected);
                  }
                }}
                getQuizUpdateInfo={(quizId) => {
                  const updateKey = `quiz-${quizId}`;
                  const info = updatedQuizzes.get(updateKey);
                  if (info && info.hasUpdate) {
                    return { hasUpdate: true, updatedCount: 0 };
                  }
                  return null;
                }}
                onUpdateClick={(quizId) => {
                  const updateKey = `quiz-${quizId}`;
                  const info = updatedQuizzes.get(updateKey);
                  if (info) {
                    setUpdateModalInfo({
                      quizId,
                      quizTitle: info.quizTitle,
                      filterType: 'bookmark',
                    });
                  }
                }}
              />
            )}
          </div>
        )}

        {/* 빈 상태 (서재/찜 탭 제외) - 화면 중앙 배치 */}
        {!loading && activeFilter !== 'library' && activeFilter !== 'bookmark' && currentFolders.length === 0 && (
          <EmptyState filter={activeFilter} fullHeight />
        )}

        {/* 폴더 그리드 (3열) - 서재/찜 탭 제외 */}
        {!loading && activeFilter !== 'library' && activeFilter !== 'bookmark' && currentFolders.length > 0 && (
          <>
            {/* 오답 탭에서 챕터별로 그룹화 */}
            {activeFilter === 'wrong' && chapterGroupedWrongItems.length > 0 ? (
              <div className="space-y-4">
                {chapterGroupedWrongItems.map((chapterGroup) => (
                  <div key={chapterGroup.chapterId || 'uncategorized'} className="border-b border-dashed border-[#EDEAE4] pb-3">
                    {/* 챕터 헤더 (내맘대로 스타일) */}
                    <div
                      onClick={() => {
                        if (isFolderDeleteMode || isReviewSelectMode) {
                          // 해당 챕터의 모든 폴더 키 가져오기 (챕터 ID 포함)
                          const chapterFolderKeys = chapterGroup.folders.map(f =>
                            `wrong-${f.quizId}-chapter-${chapterGroup.chapterId || 'uncategorized'}`
                          );
                          const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                          const setSelectedIds = isFolderDeleteMode ? setDeleteFolderIds : setReviewSelectedIds;
                          // 모든 폴더가 선택되어 있는지 확인
                          const allSelected = chapterFolderKeys.every(key => currentSelectedIds.has(key));
                          const newSelected = new Set(currentSelectedIds);
                          if (allSelected) {
                            // 모두 선택되어 있으면 모두 해제
                            chapterFolderKeys.forEach(key => newSelected.delete(key));
                          } else {
                            // 하나라도 선택 안되어 있으면 모두 선택
                            chapterFolderKeys.forEach(key => newSelected.add(key));
                          }
                          setSelectedIds(newSelected);
                        }
                      }}
                      className={`flex items-center mb-2 ${
                        (isFolderDeleteMode || isReviewSelectMode) ? 'cursor-pointer' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-[60px]">
                        {/* 선택 모드일 때 체크박스 표시 */}
                        {(isFolderDeleteMode || isReviewSelectMode) && (() => {
                          const chapterKey = chapterGroup.chapterId || 'uncategorized';
                          const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                          const allSelected = chapterGroup.folders.every(f =>
                            currentSelectedIds.has(`wrong-${f.quizId}-chapter-${chapterKey}`)
                          );
                          const someSelected = chapterGroup.folders.some(f =>
                            currentSelectedIds.has(`wrong-${f.quizId}-chapter-${chapterKey}`)
                          );
                          return (
                            <div className={`w-4 h-4 border-2 flex items-center justify-center ${
                              allSelected
                                ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                                : someSelected
                                  ? 'bg-[#5C5C5C] border-[#1A1A1A]'
                                  : 'border-[#1A1A1A]'
                            }`}>
                              {allSelected && (
                                <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                              {!allSelected && someSelected && (
                                <div className="w-2 h-0.5 bg-[#F5F0E8]" />
                              )}
                            </div>
                          );
                        })()}
                        <span className="font-bold text-sm text-[#1A1A1A]">{chapterGroup.chapterName}</span>
                      </div>
                      <div className="flex-1 border-t border-dashed border-[#5C5C5C] mx-2" />
                      <span className="text-xs text-[#5C5C5C] min-w-[30px] text-right">{chapterGroup.totalCount}문제</span>
                    </div>
                    {/* 챕터 내 퀴즈 폴더들 */}
                    <div>
                      {chapterGroup.folders.length >= 4 ? (
                        /* 4개 이상: 가로 스크롤 */
                        <div className="overflow-x-auto pb-2 -mx-4 px-4">
                          <div className="flex gap-3" style={{ minWidth: 'min-content' }}>
                            {chapterGroup.folders.map((folder) => {
                              const chapterKey = chapterGroup.chapterId || 'uncategorized';
                              const selectKey = `wrong-${folder.quizId}-chapter-${chapterKey}`;
                              const quizUpdateKey = `wrong-${folder.quizId}`;
                              const hasUpdate = updatedQuizzes.has(quizUpdateKey);
                              return (
                                <div key={selectKey} className="w-[100px] flex-shrink-0">
                                  <FolderCard
                                    title={folder.quizTitle}
                                    count={folder.questionCount}
                                    onClick={() => {
                                      if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(selectKey)) {
                                          newSelected.delete(selectKey);
                                        } else {
                                          newSelected.add(selectKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(selectKey)) {
                                          newSelected.delete(selectKey);
                                        } else {
                                          newSelected.add(selectKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else {
                                        // 챕터별 필터링을 위해 chapterId 쿼리 파라미터 추가
                                        const url = chapterGroup.chapterId
                                          ? `/review/wrong/${folder.quizId}?chapter=${chapterGroup.chapterId}`
                                          : `/review/wrong/${folder.quizId}`;
                                        router.push(url);
                                      }
                                    }}
                                    isSelectMode={isFolderDeleteMode || isReviewSelectMode}
                                    isSelected={(isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(selectKey)}
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.quizId,
                                        quizTitle: folder.quizTitle,
                                        filterType: 'wrong',
                                      });
                                    }}
                                    variant="folder"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        /* 3개 이하: 그리드 */
                        <div className="grid grid-cols-3 gap-3">
                          {chapterGroup.folders.map((folder) => {
                            const chapterKey = chapterGroup.chapterId || 'uncategorized';
                            const selectKey = `wrong-${folder.quizId}-chapter-${chapterKey}`;
                            const quizUpdateKey = `wrong-${folder.quizId}`;
                            const hasUpdate = updatedQuizzes.has(quizUpdateKey);
                            return (
                              <FolderCard
                                key={selectKey}
                                title={folder.quizTitle}
                                count={folder.questionCount}
                                onClick={() => {
                                  if (isFolderDeleteMode) {
                                    const newSelected = new Set(deleteFolderIds);
                                    if (newSelected.has(selectKey)) {
                                      newSelected.delete(selectKey);
                                    } else {
                                      newSelected.add(selectKey);
                                    }
                                    setDeleteFolderIds(newSelected);
                                  } else if (isReviewSelectMode) {
                                    const newSelected = new Set(reviewSelectedIds);
                                    if (newSelected.has(selectKey)) {
                                      newSelected.delete(selectKey);
                                    } else {
                                      newSelected.add(selectKey);
                                    }
                                    setReviewSelectedIds(newSelected);
                                  } else {
                                    // 챕터별 필터링을 위해 chapterId 쿼리 파라미터 추가
                                    const url = chapterGroup.chapterId
                                      ? `/review/wrong/${folder.quizId}?chapter=${chapterGroup.chapterId}`
                                      : `/review/wrong/${folder.quizId}`;
                                    router.push(url);
                                  }
                                }}
                                isSelectMode={isFolderDeleteMode || isReviewSelectMode}
                                isSelected={(isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(selectKey)}
                                showDelete={false}
                                hasUpdate={hasUpdate}
                                onUpdateClick={() => {
                                  setUpdateModalInfo({
                                    quizId: folder.quizId,
                                    quizTitle: folder.quizTitle,
                                    filterType: 'wrong',
                                  });
                                }}
                                variant="folder"
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : activeFilter === 'custom' && folderCategories.length > 0 ? (
              (() => {
                // 총 카테고리 수 = 사용자 카테고리 + 미분류(1)
                const totalCategories = folderCategories.length + 1;
                const uncategorizedFolders = currentFolders.filter(
                  (f) => !folderCategoryMap[f.id]
                );

                // 카테고리가 2개 이하일 때: 찜 탭처럼 수직 리스트
                if (totalCategories <= 2) {
                  const firstCategoryFolders = folderCategories[0]
                    ? [...currentFolders.filter(f => folderCategoryMap[f.id] === folderCategories[0].id)]
                        .sort((a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0))
                    : [...uncategorizedFolders].sort((a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0));
                  const sortedUncategorized = [...uncategorizedFolders].sort((a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0));
                  const hasUncategorized = sortedUncategorized.length > 0;

                  return (
                    <div
                      className="flex flex-col"
                      style={{ height: 'calc(100vh - 340px - 100px)' }}
                    >
                      {/* 첫 번째 카테고리 */}
                      <section className={`flex flex-col min-h-0 ${hasUncategorized ? 'flex-1 border-b border-[#D4CFC4]' : 'flex-1'}`}>
                        {/* 헤더 - 클릭으로 폴더 이동/선택 가능 */}
                        <div
                          onClick={() => {
                            if (isFolderDeleteMode || isReviewSelectMode) {
                              // 선택/삭제 모드: 해당 카테고리 폴더 전체 선택/해제
                              const categoryFolderKeys = firstCategoryFolders.map(f => `${f.filterType}-${f.id}`);
                              const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                              const setSelectedIds = isFolderDeleteMode ? setDeleteFolderIds : setReviewSelectedIds;
                              const allSelected = categoryFolderKeys.length > 0 && categoryFolderKeys.every(key => currentSelectedIds.has(key));
                              const newSelected = new Set(currentSelectedIds);
                              if (allSelected) {
                                categoryFolderKeys.forEach(key => newSelected.delete(key));
                              } else {
                                categoryFolderKeys.forEach(key => newSelected.add(key));
                              }
                              setSelectedIds(newSelected);
                            } else if (isAssignMode && selectedFolderForAssign && folderCategories[0]) {
                              handleAssignFolderToCategory(selectedFolderForAssign, folderCategories[0].id);
                            }
                          }}
                          className={`flex items-center gap-2 py-2 flex-shrink-0 transition-all ${
                            (isFolderDeleteMode || isReviewSelectMode)
                              ? 'cursor-pointer'
                              : isAssignMode && selectedFolderForAssign
                                ? 'cursor-pointer px-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
                                : ''
                          }`}
                        >
                          {/* 선택/삭제 모드일 때 체크박스 */}
                          {(isFolderDeleteMode || isReviewSelectMode) && (() => {
                            const categoryFolderKeys = firstCategoryFolders.map(f => `${f.filterType}-${f.id}`);
                            const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                            const allSelected = categoryFolderKeys.length > 0 && categoryFolderKeys.every(key => currentSelectedIds.has(key));
                            const someSelected = categoryFolderKeys.some(key => currentSelectedIds.has(key));
                            return (
                              <div className={`w-4 h-4 border-2 flex items-center justify-center ${
                                allSelected
                                  ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                                  : someSelected
                                    ? 'bg-[#5C5C5C] border-[#1A1A1A]'
                                    : 'border-[#1A1A1A]'
                              }`}>
                                {allSelected && (
                                  <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                                {!allSelected && someSelected && (
                                  <div className="w-2 h-0.5 bg-[#F5F0E8]" />
                                )}
                              </div>
                            );
                          })()}
                          <h3 className={`font-bold text-xl ${
                            isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#1A1A1A]'
                          }`}>
                            {folderCategories[0]?.name || '미분류'}
                          </h3>
                          <span className={`text-xl ml-1.5 ${
                            isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
                          }`}>
                            ({firstCategoryFolders.length})
                          </span>
                        </div>
                        <div className="flex-1 overflow-y-auto min-h-0">
                          {firstCategoryFolders.length === 0 ? (
                            <div className="h-full flex items-center justify-center">
                              <p className="text-sm text-[#5C5C5C]">폴더가 없습니다</p>
                            </div>
                          ) : firstCategoryFolders.length >= 4 ? (
                            <FolderSlider>
                              {firstCategoryFolders.map((folder) => {
                                const canDelete = true;
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isPdfMode) {
                                        const newSelected = new Set(selectedPdfFolders);
                                        if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                        else newSelected.add(folder.id);
                                        setSelectedPdfFolders(newSelected);
                                      } else if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                    isSelected={
                                      isPdfMode
                                        ? selectedPdfFolders.has(folder.id)
                                        : isAssignMode
                                          ? selectedFolderForAssign === folder.id
                                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                    }
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.id,
                                        quizTitle: folder.title,
                                        filterType: folder.filterType,
                                      });
                                    }}
                                    variant="folder"
                                  />
                                );
                              })}
                            </FolderSlider>
                          ) : (
                            <div className="grid grid-cols-3 gap-3 pb-2">
                              {firstCategoryFolders.map((folder) => {
                                const canDelete = true;
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isPdfMode) {
                                        const newSelected = new Set(selectedPdfFolders);
                                        if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                        else newSelected.add(folder.id);
                                        setSelectedPdfFolders(newSelected);
                                      } else if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                    isSelected={
                                      isPdfMode
                                        ? selectedPdfFolders.has(folder.id)
                                        : isAssignMode
                                          ? selectedFolderForAssign === folder.id
                                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                    }
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.id,
                                        quizTitle: folder.title,
                                        filterType: folder.filterType,
                                      });
                                    }}
                                    variant="folder"
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </section>

                      {/* 미분류 섹션 - 폴더가 있을 때만 표시 */}
                      {hasUncategorized && (
                        <section className="flex-1 flex flex-col min-h-0">
                          {/* 헤더 - 클릭으로 폴더 이동/선택 가능 */}
                          <div
                            onClick={() => {
                              if (isFolderDeleteMode || isReviewSelectMode) {
                                // 선택 모드: 미분류 폴더 전체 선택/해제
                                const uncategorizedKeys = sortedUncategorized.map(f => `${f.filterType}-${f.id}`);
                                const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                                const setSelectedIds = isFolderDeleteMode ? setDeleteFolderIds : setReviewSelectedIds;
                                const allSelected = uncategorizedKeys.length > 0 && uncategorizedKeys.every(key => currentSelectedIds.has(key));
                                const newSelected = new Set(currentSelectedIds);
                                if (allSelected) {
                                  uncategorizedKeys.forEach(key => newSelected.delete(key));
                                } else {
                                  uncategorizedKeys.forEach(key => newSelected.add(key));
                                }
                                setSelectedIds(newSelected);
                              } else if (isAssignMode && selectedFolderForAssign) {
                                handleAssignFolderToCategory(selectedFolderForAssign, null);
                              }
                            }}
                            className={`flex items-center gap-2 py-2 flex-shrink-0 transition-all ${
                              (isFolderDeleteMode || isReviewSelectMode)
                                ? 'cursor-pointer'
                                : isAssignMode && selectedFolderForAssign
                                  ? 'cursor-pointer px-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
                                  : ''
                            }`}
                          >
                            {/* 선택 모드일 때 체크박스 */}
                            {(isFolderDeleteMode || isReviewSelectMode) && (() => {
                              const uncategorizedKeys = sortedUncategorized.map(f => `${f.filterType}-${f.id}`);
                              const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                              const allSelected = uncategorizedKeys.length > 0 && uncategorizedKeys.every(key => currentSelectedIds.has(key));
                              const someSelected = uncategorizedKeys.some(key => currentSelectedIds.has(key));
                              return (
                                <div className={`w-4 h-4 border-2 flex items-center justify-center ${
                                  allSelected
                                    ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                                    : someSelected
                                      ? 'bg-[#5C5C5C] border-[#1A1A1A]'
                                      : 'border-[#1A1A1A]'
                                }`}>
                                  {allSelected && (
                                    <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                  {!allSelected && someSelected && (
                                    <div className="w-2 h-0.5 bg-[#F5F0E8]" />
                                  )}
                                </div>
                              );
                            })()}
                            <h3 className={`font-bold text-xl ${
                              isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#1A1A1A]'
                            }`}>
                              미분류
                            </h3>
                            <span className={`text-xl ml-1.5 ${
                              isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
                            }`}>
                              ({sortedUncategorized.length})
                            </span>
                          </div>
                          <div className="flex-1 overflow-y-auto min-h-0">
                            {sortedUncategorized.length >= 4 ? (
                            <FolderSlider>
                              {sortedUncategorized.map((folder) => {
                                const canDelete = true;
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isPdfMode) {
                                        const newSelected = new Set(selectedPdfFolders);
                                        if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                        else newSelected.add(folder.id);
                                        setSelectedPdfFolders(newSelected);
                                      } else if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                    isSelected={
                                      isPdfMode
                                        ? selectedPdfFolders.has(folder.id)
                                        : isAssignMode
                                          ? selectedFolderForAssign === folder.id
                                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                    }
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.id,
                                        quizTitle: folder.title,
                                        filterType: folder.filterType,
                                      });
                                    }}
                                    variant="folder"
                                  />
                                );
                              })}
                            </FolderSlider>
                            ) : (
                            <div className="grid grid-cols-3 gap-3 pb-2">
                              {sortedUncategorized.map((folder) => {
                                const canDelete = true;
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isPdfMode) {
                                        const newSelected = new Set(selectedPdfFolders);
                                        if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                        else newSelected.add(folder.id);
                                        setSelectedPdfFolders(newSelected);
                                      } else if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                    isSelected={
                                      isPdfMode
                                        ? selectedPdfFolders.has(folder.id)
                                        : isAssignMode
                                          ? selectedFolderForAssign === folder.id
                                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                    }
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.id,
                                        quizTitle: folder.title,
                                        filterType: folder.filterType,
                                      });
                                    }}
                                    variant="folder"
                                  />
                                );
                              })}
                            </div>
                            )}
                          </div>
                        </section>
                      )}
                    </div>
                  );
                }

                // 카테고리가 3개 이상일 때: 고정 높이 + 가로 스크롤
                const sortedUncategorizedForMany = [...uncategorizedFolders].sort(
                  (a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0)
                );

                return (
                  <div className="space-y-3">
                    {/* 사용자 카테고리들 */}
                    {folderCategories.map((cat) => {
                      const categoryFolders = currentFolders
                        .filter((f) => folderCategoryMap[f.id] === cat.id)
                        .sort((a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0));

                      // 사용자 생성 카테고리는 폴더가 없어도 표시 (미분류만 폴더가 없을 때 생략)

                      return (
                        <div
                          key={cat.id}
                          data-category-id={cat.id}
                          className="border-b border-dashed border-[#EDEAE4] pb-3"
                        >
                          {/* 카테고리 헤더 */}
                          <div
                            onClick={() => {
                              if (isFolderDeleteMode || isReviewSelectMode) {
                                // 선택/삭제 모드: 카테고리 내 모든 폴더 선택/해제
                                const categoryFolderKeys = categoryFolders.map(f => `${f.filterType}-${f.id}`);
                                const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                                const setSelectedIds = isFolderDeleteMode ? setDeleteFolderIds : setReviewSelectedIds;
                                const allSelected = categoryFolderKeys.every(key => currentSelectedIds.has(key));
                                const newSelected = new Set(currentSelectedIds);
                                if (allSelected) {
                                  categoryFolderKeys.forEach(key => newSelected.delete(key));
                                } else {
                                  categoryFolderKeys.forEach(key => newSelected.add(key));
                                }
                                setSelectedIds(newSelected);
                              } else if (isAssignMode && selectedFolderForAssign) {
                                handleAssignFolderToCategory(selectedFolderForAssign, cat.id);
                              }
                            }}
                            className={`flex items-center mb-2 transition-all ${
                              (isFolderDeleteMode || isReviewSelectMode)
                                ? 'cursor-pointer'
                                : isAssignMode && selectedFolderForAssign
                                  ? 'cursor-pointer p-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
                                  : ''
                            }`}
                          >
                            {/* 선택/삭제 모드일 때 체크박스 */}
                            {(isFolderDeleteMode || isReviewSelectMode) && (() => {
                              const categoryFolderKeys = categoryFolders.map(f => `${f.filterType}-${f.id}`);
                              const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                              const allSelected = categoryFolderKeys.length > 0 && categoryFolderKeys.every(key => currentSelectedIds.has(key));
                              const someSelected = categoryFolderKeys.some(key => currentSelectedIds.has(key));
                              return (
                                <div className={`w-4 h-4 border-2 flex items-center justify-center mr-2 ${
                                  allSelected
                                    ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                                    : someSelected
                                      ? 'bg-[#5C5C5C] border-[#1A1A1A]'
                                      : 'border-[#1A1A1A]'
                                }`}>
                                  {allSelected && (
                                    <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                  {!allSelected && someSelected && (
                                    <div className="w-2 h-0.5 bg-[#F5F0E8]" />
                                  )}
                                </div>
                              );
                            })()}
                            <span className={`font-bold text-xl ${
                              isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#1A1A1A]'
                            }`}>{cat.name}</span>
                            <span className={`text-xl ml-1.5 ${
                              isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
                            }`}>({categoryFolders.length})</span>
                          </div>

                          {/* 폴더들 - 4개 이상이면 좌우 슬라이드 */}
                          {categoryFolders.length === 0 ? (
                            // 빈 카테고리
                            <div className="py-4 text-center text-[#5C5C5C] text-sm border border-dashed border-[#EDEAE4]">
                              폴더가 없습니다
                            </div>
                          ) : categoryFolders.length >= 4 ? (
                            // 4개 이상: 슬라이더
                            <FolderSlider>
                              {categoryFolders.map((folder) => {
                                const canDelete = true;
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isPdfMode) {
                                        const newSelected = new Set(selectedPdfFolders);
                                        if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                        else newSelected.add(folder.id);
                                        setSelectedPdfFolders(newSelected);
                                      } else if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                    isSelected={
                                      isPdfMode
                                        ? selectedPdfFolders.has(folder.id)
                                        : isAssignMode
                                          ? selectedFolderForAssign === folder.id
                                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                    }
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.id,
                                        quizTitle: folder.title,
                                        filterType: folder.filterType,
                                      });
                                    }}
                                    variant="folder"
                                  />
                                );
                              })}
                            </FolderSlider>
                          ) : (
                            // 3개 이하: 일반 그리드
                            <div className="grid grid-cols-3 gap-3">
                              {categoryFolders.map((folder) => {
                                const canDelete = true;
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isPdfMode) {
                                        const newSelected = new Set(selectedPdfFolders);
                                        if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                        else newSelected.add(folder.id);
                                        setSelectedPdfFolders(newSelected);
                                      } else if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                    isSelected={
                                      isPdfMode
                                        ? selectedPdfFolders.has(folder.id)
                                        : isAssignMode
                                          ? selectedFolderForAssign === folder.id
                                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                    }
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.id,
                                        quizTitle: folder.title,
                                        filterType: folder.filterType,
                                      });
                                    }}
                                    variant="folder"
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* 미분류 폴더 - 폴더가 있을 때만 표시 */}
                    {sortedUncategorizedForMany.length > 0 && (
                      <div data-category-id="uncategorized">
                        {/* 미분류 헤더 */}
                        <div
                          onClick={() => {
                            if (isFolderDeleteMode || isReviewSelectMode) {
                              // 선택 모드: 미분류 폴더 전체 선택/해제
                              const uncategorizedFolderKeys = sortedUncategorizedForMany.map(f => `${f.filterType}-${f.id}`);
                              const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                              const setSelectedIds = isFolderDeleteMode ? setDeleteFolderIds : setReviewSelectedIds;
                              const allSelected = uncategorizedFolderKeys.every(key => currentSelectedIds.has(key));
                              const newSelected = new Set(currentSelectedIds);
                              if (allSelected) {
                                uncategorizedFolderKeys.forEach(key => newSelected.delete(key));
                              } else {
                                uncategorizedFolderKeys.forEach(key => newSelected.add(key));
                              }
                              setSelectedIds(newSelected);
                            } else if (isAssignMode && selectedFolderForAssign) {
                              handleAssignFolderToCategory(selectedFolderForAssign, null);
                            }
                          }}
                          className={`flex items-center mb-2 transition-all ${
                            (isFolderDeleteMode || isReviewSelectMode)
                              ? 'cursor-pointer'
                              : isAssignMode && selectedFolderForAssign
                                ? 'cursor-pointer p-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
                                : ''
                          }`}
                        >
                          {/* 선택 모드일 때 체크박스 */}
                          {(isFolderDeleteMode || isReviewSelectMode) && (() => {
                            const uncategorizedFolderKeys = sortedUncategorizedForMany.map(f => `${f.filterType}-${f.id}`);
                            const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                            const allSelected = uncategorizedFolderKeys.length > 0 && uncategorizedFolderKeys.every(key => currentSelectedIds.has(key));
                            const someSelected = uncategorizedFolderKeys.some(key => currentSelectedIds.has(key));
                            return (
                              <div className={`w-4 h-4 border-2 flex items-center justify-center mr-2 ${
                                allSelected
                                  ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                                  : someSelected
                                    ? 'bg-[#5C5C5C] border-[#1A1A1A]'
                                    : 'border-[#1A1A1A]'
                              }`}>
                                {allSelected && (
                                  <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                                {!allSelected && someSelected && (
                                  <div className="w-2 h-0.5 bg-[#F5F0E8]" />
                                )}
                              </div>
                            );
                          })()}
                          <span className={`font-bold text-sm min-w-[60px] ${
                            isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#1A1A1A]'
                          }`}>미분류</span>
                          <div className={`flex-1 border-t border-dashed mx-2 ${
                            isAssignMode && selectedFolderForAssign ? 'border-[#1A6B1A]' : 'border-[#5C5C5C]'
                          }`} />
                          <span className={`text-xs min-w-[30px] text-right ${
                            isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
                          }`}>{sortedUncategorizedForMany.length}개</span>
                        </div>

                        {/* 미분류 폴더들 */}
                        {sortedUncategorizedForMany.length >= 4 ? (
                        // 4개 이상: 슬라이더
                        <FolderSlider>
                          {sortedUncategorizedForMany.map((folder) => {
                            const canDelete = true;
                            const updateKey = `${folder.filterType}-${folder.id}`;
                            const hasUpdate = updatedQuizzes.has(updateKey);
                            const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                            return (
                              <FolderCard
                                key={updateKey}
                                title={folder.title}
                                count={folder.count}
                                onClick={() => {
                                  if (isPdfMode) {
                                    const newSelected = new Set(selectedPdfFolders);
                                    if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                    else newSelected.add(folder.id);
                                    setSelectedPdfFolders(newSelected);
                                  } else if (isFolderDeleteMode) {
                                    const newSelected = new Set(deleteFolderIds);
                                    if (newSelected.has(updateKey)) {
                                      newSelected.delete(updateKey);
                                    } else {
                                      newSelected.add(updateKey);
                                    }
                                    setDeleteFolderIds(newSelected);
                                  } else if (isReviewSelectMode) {
                                    const newSelected = new Set(reviewSelectedIds);
                                    if (newSelected.has(updateKey)) {
                                      newSelected.delete(updateKey);
                                    } else {
                                      newSelected.add(updateKey);
                                    }
                                    setReviewSelectedIds(newSelected);
                                  } else if (isAssignMode) {
                                    handleFolderClickInAssignMode(folder.id);
                                  } else {
                                    handleFolderClick(folder);
                                  }
                                }}
                                isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                isSelected={
                                  isPdfMode
                                    ? selectedPdfFolders.has(folder.id)
                                    : isAssignMode
                                      ? selectedFolderForAssign === folder.id
                                      : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                }
                                showDelete={false}
                                hasUpdate={hasUpdate}
                                onUpdateClick={() => {
                                  setUpdateModalInfo({
                                    quizId: folder.id,
                                    quizTitle: folder.title,
                                    filterType: folder.filterType,
                                  });
                                }}
                                variant="folder"
                              />
                            );
                          })}
                        </FolderSlider>
                      ) : (
                        // 3개 이하: 일반 그리드
                        <div className="grid grid-cols-3 gap-3">
                          {sortedUncategorizedForMany.map((folder) => {
                            const canDelete = true;
                            const updateKey = `${folder.filterType}-${folder.id}`;
                            const hasUpdate = updatedQuizzes.has(updateKey);
                            const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                            return (
                              <FolderCard
                                key={updateKey}
                                title={folder.title}
                                count={folder.count}
                                onClick={() => {
                                  if (isPdfMode) {
                                    const newSelected = new Set(selectedPdfFolders);
                                    if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                    else newSelected.add(folder.id);
                                    setSelectedPdfFolders(newSelected);
                                  } else if (isFolderDeleteMode) {
                                    const newSelected = new Set(deleteFolderIds);
                                    if (newSelected.has(updateKey)) {
                                      newSelected.delete(updateKey);
                                    } else {
                                      newSelected.add(updateKey);
                                    }
                                    setDeleteFolderIds(newSelected);
                                  } else if (isReviewSelectMode) {
                                    const newSelected = new Set(reviewSelectedIds);
                                    if (newSelected.has(updateKey)) {
                                      newSelected.delete(updateKey);
                                    } else {
                                      newSelected.add(updateKey);
                                    }
                                    setReviewSelectedIds(newSelected);
                                  } else if (isAssignMode) {
                                    handleFolderClickInAssignMode(folder.id);
                                  } else {
                                    handleFolderClick(folder);
                                  }
                                }}
                                isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                isSelected={
                                  isPdfMode
                                    ? selectedPdfFolders.has(folder.id)
                                    : isAssignMode
                                      ? selectedFolderForAssign === folder.id
                                      : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                }
                                showDelete={false}
                                hasUpdate={hasUpdate}
                                onUpdateClick={() => {
                                  setUpdateModalInfo({
                                    quizId: folder.id,
                                    quizTitle: folder.title,
                                    filterType: folder.filterType,
                                  });
                                }}
                                variant="folder"
                              />
                            );
                          })}
                        </div>
                      )}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              // 기본 그리드 (카테고리 없을 때)
              currentFolders.length >= 4 ? (
                <FolderSlider>
                  {currentFolders.map((folder) => {
                    const canDelete = true;
                    const updateKey = `${folder.filterType}-${folder.id}`;
                    const hasUpdate = updatedQuizzes.has(updateKey);
                    const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                    return (
                      <FolderCard
                        key={updateKey}
                        title={folder.title}
                        count={folder.count}
                        onClick={() => {
                          if (isPdfMode) {
                            const newSelected = new Set(selectedPdfFolders);
                            if (newSelected.has(folder.id)) {
                              newSelected.delete(folder.id);
                            } else {
                              newSelected.add(folder.id);
                            }
                            setSelectedPdfFolders(newSelected);
                          } else if (isFolderDeleteMode) {
                            const newSelected = new Set(deleteFolderIds);
                            if (newSelected.has(updateKey)) {
                              newSelected.delete(updateKey);
                            } else {
                              newSelected.add(updateKey);
                            }
                            setDeleteFolderIds(newSelected);
                          } else if (isReviewSelectMode) {
                            const newSelected = new Set(reviewSelectedIds);
                            if (newSelected.has(updateKey)) {
                              newSelected.delete(updateKey);
                            } else {
                              newSelected.add(updateKey);
                            }
                            setReviewSelectedIds(newSelected);
                          } else {
                            handleFolderClick(folder);
                          }
                        }}
                        isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isPdfMode}
                        isSelected={
                          isPdfMode
                            ? selectedPdfFolders.has(folder.id)
                            : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                        }
                        showDelete={false}
                        hasUpdate={hasUpdate}
                        onUpdateClick={() => {
                          setUpdateModalInfo({
                            quizId: folder.id,
                            quizTitle: folder.title,
                            filterType: folder.filterType,
                          });
                        }}
                        variant="folder"
                      />
                    );
                  })}
                </FolderSlider>
              ) : (
              <div className="grid grid-cols-3 gap-3">
                {currentFolders.map((folder) => {
                  const canDelete = true;
                  const updateKey = `${folder.filterType}-${folder.id}`;
                  const hasUpdate = updatedQuizzes.has(updateKey);
                  const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                  return (
                    <FolderCard
                      key={updateKey}
                      title={folder.title}
                      count={folder.count}
                      onClick={() => {
                        if (isPdfMode) {
                          const newSelected = new Set(selectedPdfFolders);
                          if (newSelected.has(folder.id)) {
                            newSelected.delete(folder.id);
                          } else {
                            newSelected.add(folder.id);
                          }
                          setSelectedPdfFolders(newSelected);
                        } else if (isFolderDeleteMode) {
                          const newSelected = new Set(deleteFolderIds);
                          if (newSelected.has(updateKey)) {
                            newSelected.delete(updateKey);
                          } else {
                            newSelected.add(updateKey);
                          }
                          setDeleteFolderIds(newSelected);
                        } else if (isReviewSelectMode) {
                          const newSelected = new Set(reviewSelectedIds);
                          if (newSelected.has(updateKey)) {
                            newSelected.delete(updateKey);
                          } else {
                            newSelected.add(updateKey);
                          }
                          setReviewSelectedIds(newSelected);
                        } else {
                          handleFolderClick(folder);
                        }
                      }}
                      isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isPdfMode}
                      isSelected={
                        isPdfMode
                          ? selectedPdfFolders.has(folder.id)
                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                      }
                      showDelete={false}
                      hasUpdate={hasUpdate}
                      onUpdateClick={() => {
                        setUpdateModalInfo({
                          quizId: folder.id,
                          quizTitle: folder.title,
                          filterType: folder.filterType,
                        });
                      }}
                      variant="folder"
                    />
                  );
                })}
              </div>
              )
            )}
          </>
        )}
      </main>

      {/* 새 폴더 생성 모달 */}
      <CreateFolderModal
        isOpen={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        onCreate={handleCreateFolder}
      />

      {/* 찜한 퀴즈 상세보기 모달 */}
      {selectedBookmarkedQuiz && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
          style={{ left: 'var(--modal-left, 0px)' }}
          onClick={() => setSelectedBookmarkedQuiz(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-3"
          >
            <h2 className="text-xs font-bold text-[#1A1A1A] mb-2">
              {selectedBookmarkedQuiz.title}
            </h2>

            {/* 미완료 퀴즈: 평균 점수 대형 표시 (Start 버전) */}
            {!selectedBookmarkedQuiz.hasCompleted && (
              <div className="text-center py-1.5 mb-1.5 border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]">
                <p className="text-[9px] text-[#5C5C5C] mb-0.5">평균 점수</p>
                <p className="text-xl font-black text-[#1A1A1A]">
                  {selectedBookmarkedQuiz.participantCount > 0
                    ? <>{(selectedBookmarkedQuiz.averageScore ?? 0).toFixed(0)}<span className="text-[10px] font-bold">점</span></>
                    : '-'}
                </p>
              </div>
            )}

            <div className="space-y-1 mb-3">
              <div className="flex justify-between text-[11px]">
                <span className="text-[#5C5C5C]">문제 수</span>
                <span className="font-bold text-[#1A1A1A]">{selectedBookmarkedQuiz.questionCount}문제</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[#5C5C5C]">참여자</span>
                <span className="font-bold text-[#1A1A1A]">{selectedBookmarkedQuiz.participantCount}명</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[#5C5C5C]">난이도</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedBookmarkedQuiz.difficulty === 'easy' ? '쉬움' : selectedBookmarkedQuiz.difficulty === 'hard' ? '어려움' : '보통'}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[#5C5C5C]">문제 유형</span>
                <span className="font-bold text-[#1A1A1A]">
                  {formatQuestionTypes(
                    selectedBookmarkedQuiz.oxCount || 0,
                    selectedBookmarkedQuiz.multipleChoiceCount || 0,
                    selectedBookmarkedQuiz.subjectiveCount || 0
                  )}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[#5C5C5C]">제작자</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedBookmarkedQuiz.type && PROFESSOR_QUIZ_TYPES.has(selectedBookmarkedQuiz.type) ? '교수님' : (selectedBookmarkedQuiz.creatorNickname || '익명')}
                </span>
              </div>

              {/* 완료된 퀴즈: 평균 점수 행 + 점수 표시 (Review 버전) */}
              {selectedBookmarkedQuiz.hasCompleted && (
                <>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#5C5C5C]">평균 점수</span>
                    <span className="font-bold text-[#1A1A1A]">
                      {selectedBookmarkedQuiz.participantCount > 0
                        ? `${(selectedBookmarkedQuiz.averageScore ?? 0).toFixed(0)}점`
                        : '-'}
                    </span>
                  </div>
                  <div className="py-1.5 border-t border-[#A0A0A0]">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-xl font-black text-[#1A1A1A]">
                        {selectedBookmarkedQuiz.myScore !== undefined ? selectedBookmarkedQuiz.myScore : '-'}
                      </span>
                      <span className="text-xs text-[#5C5C5C]">/</span>
                      <span className="text-2xl font-black text-[#1A1A1A]">
                        {selectedBookmarkedQuiz.myFirstReviewScore !== undefined ? selectedBookmarkedQuiz.myFirstReviewScore : '-'}
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-6 mt-0.5">
                      <span className="text-[9px] text-[#5C5C5C]">퀴즈</span>
                      <span className="text-[9px] text-[#5C5C5C]">복습</span>
                    </div>
                  </div>
                </>
              )}

              {selectedBookmarkedQuiz.tags && selectedBookmarkedQuiz.tags.length > 0 && (
                <div className="pt-1.5 border-t border-[#A0A0A0]">
                  <div className="flex flex-wrap gap-1">
                    {selectedBookmarkedQuiz.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-[10px] font-medium"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setSelectedBookmarkedQuiz(null)}
                className="flex-1 py-1.5 text-[11px] font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  router.push(`/quiz/${selectedBookmarkedQuiz.quizId}`);
                  setSelectedBookmarkedQuiz(null);
                }}
                className="flex-1 py-1.5 text-[11px] font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
              >
                {selectedBookmarkedQuiz.hasCompleted ? '복습하기' : '시작하기'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* 문제 상세보기 모달 (문제 목록 표시) */}
      {questionListQuiz && (
        <QuestionListModal
          quiz={questionListQuiz}
          onClose={() => setQuestionListQuiz(null)}
          onReview={() => {
            handleStartReviewByQuizId(questionListQuiz.id);
            setQuestionListQuiz(null);
          }}
          groupedSolvedItems={groupedSolvedItems}
        />
      )}

      {/* 빈 폴더 임시 메시지 */}
      <AnimatePresence>
        {showEmptyMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
            style={{ left: 'var(--modal-left, 0px)' }}
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

      {/* 퀴즈 업데이트 확인 모달 */}
      {updateModalInfo && !detailedUpdateInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          style={{ left: 'var(--modal-left, 0px)' }}
          onClick={() => !updateModalLoading && setUpdateModalInfo(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4"
          >
            {/* 아이콘 */}
            <div className="flex justify-center mb-3">
              <div className="w-9 h-9 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                <svg
                  className="w-4 h-4 text-[#1A1A1A]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
            </div>

            <h3 className="text-center font-bold text-sm text-[#1A1A1A] mb-2">
              수정된 문제를 풀까요?
            </h3>
            <p className="text-xs text-[#5C5C5C] mb-1">
              - 수정된 문제만 다시 풀 수 있습니다.
            </p>
            <p className="text-xs text-[#5C5C5C] mb-1">
              - 새로운 답변이 복습 기록에 반영됩니다.
            </p>
            <p className="text-xs text-[#5C5C5C] mb-4">
              - 정답 여부와 복습 횟수가 업데이트됩니다.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setUpdateModalInfo(null)}
                disabled={updateModalLoading}
                className="flex-1 py-1.5 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  try {
                    setUpdateModalLoading(true);
                    const info = await checkQuizUpdate(updateModalInfo.quizId);
                    if (info && info.hasUpdate && info.updatedQuestions.length > 0) {
                      const quizDoc = await getDoc(doc(db, 'quizzes', updateModalInfo.quizId));
                      if (quizDoc.exists()) {
                        const quizData = quizDoc.data();
                        setTotalQuestionCount(quizData.questions?.length || 0);
                      }
                      setDetailedUpdateInfo(info);
                    } else {
                      alert('이미 최신 상태입니다.');
                      setUpdateModalInfo(null);
                    }
                  } catch (err) {
                    alert('업데이트 정보를 불러오는데 실패했습니다.');
                  } finally {
                    setUpdateModalLoading(false);
                  }
                }}
                disabled={updateModalLoading}
                className="flex-1 py-1.5 text-xs font-bold border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {updateModalLoading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    로딩...
                  </>
                ) : (
                  '풀기'
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* 수정된 문제 풀기 모달 (UpdateQuizModal) */}
      {detailedUpdateInfo && (
        <UpdateQuizModal
          isOpen={!!detailedUpdateInfo}
          onClose={() => {
            setDetailedUpdateInfo(null);
            setUpdateModalInfo(null);
          }}
          updateInfo={detailedUpdateInfo}
          totalQuestionCount={totalQuestionCount}
          onComplete={(newScore, newCorrectCount) => {
            // 완료 후 새로고침
            refresh();
            refreshQuizUpdate();
            setDetailedUpdateInfo(null);
            setUpdateModalInfo(null);
          }}
        />
      )}

      {/* 폴더 카테고리 설정 모달 */}
      <FolderCategoryModal
        isOpen={isSortMode}
        onClose={() => setIsSortMode(false)}
        folderCategories={folderCategories}
        folderCategoryMap={folderCategoryMap}
        hasCustomFolders={customFolders.length > 0}
        onAddCategory={handleAddFolderCategory}
        onRemoveCategory={handleRemoveFolderCategory}
        onStartAssignMode={() => {
          setIsSortMode(false);
          setIsAssignMode(true);
        }}
      />

      {/* 삭제 확인 바텀시트 (휴지통) */}
      <ReviewDeleteSheet
        isOpen={showDeleteConfirmSheet}
        onClose={() => setShowDeleteConfirmSheet(false)}
        deletedItems={deletedItems}
        permanentlyDeleteItem={permanentlyDeleteItem}
        restoreDeletedItem={restoreDeletedItem}
        onRestoreSuccess={() => {
          setIsFolderDeleteMode(false);
          setDeleteFolderIds(new Set());
          setIsReviewSelectMode(false);
          setReviewSelectedIds(new Set());
        }}
      />

      {/* 서재 퀴즈 공개 확인 모달 */}
      <ReviewPublishModal
        quizId={publishConfirmQuizId}
        onClose={() => setPublishConfirmQuizId(null)}
        onConfirm={uploadToPublic}
      />

      {/* 서재 퀴즈 상세 모달 */}
      <ReviewLibraryDetailModal
        quiz={selectedLibraryQuiz}
        sourceRect={librarySourceRect}
        onClose={() => { setSelectedLibraryQuiz(null); clearLibraryRect(); }}
      />

    </div>
  );
}

// useSearchParams를 Suspense로 감싸서 export
export default function ReviewPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ backgroundColor: '#F5F0E8' }}
        >
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent animate-spin mx-auto mb-4" />
            <p className="text-sm text-[#5C5C5C]">로딩 중...</p>
          </div>
        </div>
      }
    >
      <ReviewPageContent />
    </Suspense>
  );
}
