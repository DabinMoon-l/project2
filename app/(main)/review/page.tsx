'use client';

import { useState, useCallback, useEffect, Suspense, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { doc, getDoc, getDocs, collection, query, where, updateDoc, limit, db, type DocumentData } from '@/lib/repositories';
import { useExpandSource } from '@/lib/hooks/useExpandSource';
import dynamic from 'next/dynamic';
import type { PracticeResult } from '@/components/review/ReviewPractice';
import { useReview, calculateCustomFolderQuestionCount, type ReviewItem, type QuizUpdateInfo } from '@/lib/hooks/useReview';
import { useQuizUpdate, type QuizUpdateInfo as DetailedQuizUpdateInfo } from '@/lib/hooks/useQuizUpdate';

// 대형 컴포넌트 lazy load
const ReviewPractice = dynamic(() => import('@/components/review/ReviewPractice'), { ssr: false });
const UpdateQuizModal = dynamic(() => import('@/components/quiz/UpdateQuizModal'), { ssr: false });
const FolderDetailPage = dynamic(() => import('./[type]/[id]/page'), { ssr: false });
import QuizPanelContainer from '@/components/quiz/QuizPanelContainer';
import { useQuizBookmark, type BookmarkedQuiz } from '@/lib/hooks/useQuizBookmark';
import { useLearningQuizzes, type LearningQuiz } from '@/lib/hooks/useLearningQuizzes';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse, useUser, useDetailPanel } from '@/lib/contexts';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { getChapterById, generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';
import type { QuestionExportData as PdfQuestionData } from '@/lib/utils/questionPdfExport';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import { useHideNav } from '@/lib/hooks/useHideNav';
import { useFolderCategories } from '@/lib/hooks/useFolderCategories';
import { useCompletedQuizzes } from '@/lib/hooks/useCompletedQuizzes';
import { type CompletedQuizData, type ReviewFilter } from '@/components/review/types';
import { formatQuestionTypes } from '@/components/review/utils';
import SlideFilter from '@/components/review/SlideFilter';
import SkeletonQuizCard from '@/components/review/SkeletonQuizCard';
import EmptyState from '@/components/review/EmptyState';
import QuestionListModal from '@/components/review/QuestionListModal';
import CreateFolderModal from '@/components/review/CreateFolderModal';
import ReviewDeleteSheet from '@/components/review/ReviewDeleteSheet';
import ReviewPublishModal from '@/components/review/ReviewPublishModal';
import ReviewLibraryDetailModal from '@/components/review/ReviewLibraryDetailModal';
import FolderCategoryModal from '@/components/review/FolderCategoryModal';
import LibraryTab from '@/components/review/tabs/LibraryTab';
import WrongTab from '@/components/review/tabs/WrongTab';
import BookmarkTab from '@/components/review/tabs/BookmarkTab';
import CustomTab from '@/components/review/tabs/CustomTab';
import BookmarkDetailSheet from '@/components/review/BookmarkDetailSheet';
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
  const isWide = useWideMode();
  const { openDetail, replaceDetail, closeDetail, isDetailOpen, isLocked } = useDetailPanel();

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
  const {
    folderCategories,
    folderCategoryMap,
    folderOrderMap,
    isSortMode,
    setIsSortMode,
    isAssignMode,
    setIsAssignMode,
    selectedFolderForAssign,
    setSelectedFolderForAssign,
    addCategory: handleAddFolderCategory,
    removeCategory: handleRemoveFolderCategory,
    assignFolderToCategory: handleAssignFolderToCategory,
    swapFolderCategories: handleSwapFolderCategoriesRaw,
    handleFolderClickInAssignMode: handleFolderClickInAssignModeRaw,
  } = useFolderCategories();

  // 네비게이션 숨김 (폴더생성/정렬모드/서재상세/공개전환모달)
  useHideNav(!!(showCreateFolder || isSortMode || selectedLibraryQuiz || publishConfirmQuizId));

  // 카테고리 설정 모달 열릴 때 body 스크롤 방지 (키보드 올라올 때 자유 스크롤 방지)
  useEffect(() => {
    if (isSortMode) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isSortMode]);

  // 폴더 교환/클릭 래퍼 (customFolders 의존)
  const handleSwapFolderCategories = (folderId1: string, folderId2: string) =>
    handleSwapFolderCategoriesRaw(folderId1, folderId2, customFolders);
  const handleFolderClickInAssignMode = (folderId: string) =>
    handleFolderClickInAssignModeRaw(folderId, customFolders);


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
  const { completedQuizzes, completedLoading } = useCompletedQuizzes(user, userCourseId, libraryQuizzesRaw);

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
    } else if (isWide && !isLocked) {
      // 가로모드: 2쪽 유지, 3쪽에 상세 표시
      const action = isDetailOpen ? replaceDetail : openDetail;
      action(<FolderDetailPage panelType={folder.filterType} panelId={folder.id} />);
    } else {
      // 모바일 또는 잠금: 폴더 상세로 이동
      router.push(`/review/${folder.filterType}/${folder.id}`);
    }
  };

  // 가로모드에서 복습 상세 열기 (3쪽 패널)
  const openReviewDetail = useCallback((type: string, id: string, autoStart?: string) => {
    if (isWide && !isLocked) {
      const action = isDetailOpen ? replaceDetail : openDetail;
      action(<FolderDetailPage panelType={type} panelId={id} panelAutoStart={autoStart} />);
    } else {
      const qs = autoStart ? `?autoStart=${autoStart}` : '';
      router.push(`/review/${type}/${id}${qs}`);
    }
  }, [isWide, isLocked, isDetailOpen, openDetail, replaceDetail, router]);

  // 가로모드: ReviewPractice를 3쪽 패널에서 열기 (2쪽 복습 목록 유지)
  // handleEndPractice는 아래 정의 → ref로 안전 참조
  const handleEndPracticeRef = useRef<(results?: PracticeResult[]) => void>(() => {});
  const startPractice = useCallback((items: ReviewItem[], mode: 'all' | 'wrongOnly') => {
    if (isWide && !isLocked) {
      const action = isDetailOpen ? replaceDetail : openDetail;
      action(
        <ReviewPractice
          items={items}
          onComplete={(results) => { handleEndPracticeRef.current(results); }}
          onClose={() => { handleEndPracticeRef.current(); }}
          currentUserId={user?.uid}
          isPanelMode
        />
      );
    } else {
      setPracticeMode(mode);
      setPracticeItems(items);
    }
  }, [isWide, isLocked, isDetailOpen, openDetail, replaceDetail, user?.uid]);

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
      startPractice(items, 'all');
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

          questions.forEach((q: Record<string, any>, idx: number) => {
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
              createdAt: quizData.createdAt || null,
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
            } as ReviewItem);
          });
        }
      } catch (error) {
        console.error('서재 퀴즈 로드 오류:', error);
      }
    }

    if (items.length > 0) {
      startPractice(items, 'all');
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
    const solvedGroup = groupedSolvedItems.find(g => g.quizId === quizId);
    if (solvedGroup && solvedGroup.items.length > 0) {
      startPractice(solvedGroup.items, 'all');
    } else if (isWide && !isLocked) {
      // solved 아이템 없음 = 아직 안 푼 퀴즈 → 퀴즈로 시작
      const action = isDetailOpen ? replaceDetail : openDetail;
      action(<QuizPanelContainer quizId={quizId} />);
    } else {
      router.push(`/quiz/${quizId}`);
    }
  }, [groupedSolvedItems, router, isWide, isLocked, isDetailOpen, openDetail, replaceDetail, startPractice]);

  // 퀴즈 ID로 오답만 복습 시작
  const handleStartReviewWrongOnlyByQuizId = useCallback((quizId: string) => {
    // wrong에서 해당 퀴즈의 오답 문제들 찾기
    const wrongGroup = groupedWrongItems.find(g => g.quizId === quizId);
    if (wrongGroup && wrongGroup.items.length > 0) {
      startPractice(wrongGroup.items, 'wrongOnly');
    } else {
      alert('이 문제지에 오답이 없습니다.');
    }
  }, [groupedWrongItems, startPractice]);

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
    // 가로모드: 3쪽 패널도 닫기
    if (isWide && isDetailOpen) closeDetail();
  }, [user, markAsReviewed, isWide, isDetailOpen, closeDetail]);

  // startPractice에서 사용하는 ref 업데이트
  useEffect(() => { handleEndPracticeRef.current = handleEndPractice; }, [handleEndPractice]);

  // 가로모드: practiceItems가 실수로 set된 경우 3쪽 패널로 이동
  useEffect(() => {
    if (isWide && !isLocked && practiceItems) {
      const items = practiceItems;
      const mode = practiceMode || 'all';
      setPracticeItems(null);
      setPracticeMode(null);
      const action = isDetailOpen ? replaceDetail : openDetail;
      action(
        <ReviewPractice
          items={items}
          onComplete={(results) => { handleEndPracticeRef.current(results); }}
          onClose={() => { handleEndPracticeRef.current(); }}
          currentUserId={user?.uid}
          isPanelMode
        />
      );
    }
  }, [isWide, isLocked, practiceItems, practiceMode, isDetailOpen, openDetail, replaceDetail, user?.uid]);

  // 연습 모드 (모바일 전용 — 가로모드에서는 위 useEffect가 3쪽으로 리다이렉트)
  if (practiceItems && !isWide) {
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
                        const quizCache = new Map<string, Record<string, any>>();
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
                            const quizQuestions = (quizData.questions as DocumentData[]) || [];
                            // questionId로 매칭 시도
                            let question: DocumentData | null | undefined = q.questionId
                              ? quizQuestions.find((qq: DocumentData, idx: number) => (qq.id || `q${idx}`) === q.questionId)
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
                              ? rawAnswer.map((a: unknown) => String(a)).join(',')
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
          <LibraryTab
            allLibraryQuizzes={allLibraryQuizzes}
            libraryQuizzes={libraryQuizzes}
            librarySelectedTags={librarySelectedTags}
            setLibrarySelectedTags={setLibrarySelectedTags}
            showLibraryTagFilter={showLibraryTagFilter}
            setShowLibraryTagFilter={setShowLibraryTagFilter}
            libraryTagOptions={libraryTagOptions}
            isLibrarySelectMode={isLibrarySelectMode}
            librarySelectedIds={librarySelectedIds}
            setLibrarySelectedIds={setLibrarySelectedIds}
            isReviewSelectMode={isReviewSelectMode}
            reviewSelectedIds={reviewSelectedIds}
            setReviewSelectedIds={setReviewSelectedIds}
            registerLibraryRef={registerLibraryRef}
            onCardNavigate={(quizId) => openReviewDetail('library', quizId)}
            onOpenDetailModal={openLibraryQuizModal}
            onReview={(quizId) => openReviewDetail('library', quizId, 'all')}
            onReviewWrongOnly={(quizId) => openReviewDetail('library', quizId, 'wrongOnly')}
            onPublish={(quizId) => setPublishConfirmQuizId(quizId)}
            currentUserId={user?.uid}
          />
        )}

        {/* 찜 탭 - 2열 그리드 레이아웃 */}
        {!loading && !bookmarkLoading && activeFilter === 'bookmark' && (
          <BookmarkTab
            bookmarkedQuizzes={bookmarkedQuizzes}
            filteredBookmarkedQuizzes={filteredBookmarkedQuizzes}
            bookmarkSelectedTags={bookmarkSelectedTags}
            setBookmarkSelectedTags={setBookmarkSelectedTags}
            showBookmarkTagFilter={showBookmarkTagFilter}
            setShowBookmarkTagFilter={setShowBookmarkTagFilter}
            bookmarkTagOptions={bookmarkTagOptions}
            isFolderDeleteMode={isFolderDeleteMode}
            deleteFolderIds={deleteFolderIds}
            setDeleteFolderIds={setDeleteFolderIds}
            isReviewSelectMode={isReviewSelectMode}
            reviewSelectedIds={reviewSelectedIds}
            setReviewSelectedIds={setReviewSelectedIds}
            updatedQuizzes={updatedQuizzes}
            onQuizCardClick={(quizId) => openReviewDetail('bookmark', quizId)}
            onQuizDetails={(quiz) => setSelectedBookmarkedQuiz(quiz)}
            onStartQuiz={(quizId) => {
              if (isWide && !isLocked) {
                // Start: 퀴즈 풀기 (복습 아님) → QuizPanelContainer로 3쪽 잠금
                const action = isDetailOpen ? replaceDetail : openDetail;
                action(<QuizPanelContainer quizId={quizId} />);
              } else {
                router.push(`/quiz/${quizId}`);
              }
            }}
            onStartReview={handleStartReviewByQuizId}
            onStartReviewWrongOnly={handleStartReviewWrongOnlyByQuizId}
            onUnbookmark={toggleQuizBookmark}
            onUpdateClick={(quizId, quizTitle, filterType) => {
              setUpdateModalInfo({ quizId, quizTitle, filterType });
            }}
          />
        )}

        {/* 빈 상태 (서재/찜 탭 제외) - 화면 중앙 배치 */}
        {!loading && activeFilter !== 'library' && activeFilter !== 'bookmark' && currentFolders.length === 0 && (
          <EmptyState filter={activeFilter} fullHeight />
        )}

        {/* 오답 탭 - 챕터별 그룹화 */}
        {!loading && activeFilter === 'wrong' && currentFolders.length > 0 && chapterGroupedWrongItems.length > 0 && (
          <WrongTab
            chapterGroupedWrongItems={chapterGroupedWrongItems}
            isFolderDeleteMode={isFolderDeleteMode}
            deleteFolderIds={deleteFolderIds}
            setDeleteFolderIds={setDeleteFolderIds}
            isReviewSelectMode={isReviewSelectMode}
            reviewSelectedIds={reviewSelectedIds}
            setReviewSelectedIds={setReviewSelectedIds}
            updatedQuizzes={updatedQuizzes}
            onFolderNavigate={(url) => {
              if (isWide && !isLocked) {
                // URL에서 type, id, chapter 추출: /review/wrong/quizId?chapter=xxx
                const match = url.match(/\/review\/([^/]+)\/([^?]+)/);
                if (match) {
                  const action = isDetailOpen ? replaceDetail : openDetail;
                  action(<FolderDetailPage panelType={match[1]} panelId={match[2]} />);
                  return;
                }
              }
              router.push(url);
            }}
            onUpdateClick={(quizId, quizTitle) => {
              setUpdateModalInfo({ quizId, quizTitle, filterType: 'wrong' });
            }}
          />
        )}

        {/* 커스텀(내맘대로) 탭 - 카테고리 기반 폴더 */}
        {!loading && activeFilter === 'custom' && currentFolders.length > 0 && (
          <CustomTab
            currentFolders={currentFolders.map(f => ({ ...f, filterType: 'custom' as const }))}
            folderCategories={folderCategories}
            folderCategoryMap={folderCategoryMap}
            folderOrderMap={folderOrderMap}
            updatedQuizzes={updatedQuizzes}
            isFolderDeleteMode={isFolderDeleteMode}
            deleteFolderIds={deleteFolderIds}
            setDeleteFolderIds={setDeleteFolderIds}
            isReviewSelectMode={isReviewSelectMode}
            reviewSelectedIds={reviewSelectedIds}
            setReviewSelectedIds={setReviewSelectedIds}
            isPdfSelectMode={isPdfSelectMode}
            selectedPdfFolders={selectedPdfFolders}
            setSelectedPdfFolders={setSelectedPdfFolders}
            isAssignMode={isAssignMode}
            selectedFolderForAssign={selectedFolderForAssign}
            handleAssignFolderToCategory={handleAssignFolderToCategory}
            handleFolderClickInAssignMode={handleFolderClickInAssignMode}
            handleFolderClick={handleFolderClick}
            onUpdateClick={(quizId, quizTitle, filterType) => {
              setUpdateModalInfo({ quizId, quizTitle, filterType });
            }}
          />
        )}
      </main>

      {/* 새 폴더 생성 모달 */}
      <CreateFolderModal
        isOpen={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        onCreate={handleCreateFolder}
      />

      {/* 찜한 퀴즈 상세보기 */}
      <BookmarkDetailSheet
        quiz={selectedBookmarkedQuiz}
        isWide={isWide}
        onClose={() => setSelectedBookmarkedQuiz(null)}
        onAction={() => {
          if (!selectedBookmarkedQuiz) return;
          const qId = selectedBookmarkedQuiz.quizId;
          const hasCompleted = selectedBookmarkedQuiz.hasCompleted;
          setSelectedBookmarkedQuiz(null);
          if (hasCompleted) {
            openReviewDetail('bookmark', qId);
          } else if (isWide && !isLocked) {
            const action = isDetailOpen ? replaceDetail : openDetail;
            action(<QuizPanelContainer quizId={qId} />);
          } else {
            router.push(`/quiz/${qId}`);
          }
        }}
      />

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
            style={{ left: 'var(--modal-left, 0px)', right: 'var(--modal-right, 0px)' }}
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
          style={{ left: 'var(--modal-left, 0px)', right: 'var(--modal-right, 0px)' }}
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
