'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useQuizBookmark } from '@/lib/hooks/useQuizBookmark';
import dynamic from 'next/dynamic';
import { useQuizUpdate, type QuizUpdateInfo } from '@/lib/hooks/useQuizUpdate';
import { ScrollToTopButton, ExpandModal } from '@/components/common';

// 대형 모달 lazy load (버튼 클릭 시에만 로드)
const UpdateQuizModal = dynamic(() => import('@/components/quiz/UpdateQuizModal'), { ssr: false });
const QuizStatsModal = dynamic(() => import('@/components/quiz/manage/QuizStatsModal'), { ssr: false });
import { useExpandSource } from '@/lib/hooks/useExpandSource';
import { useCourse } from '@/lib/contexts';
import { COURSES, getPastExamOptions, type PastExamOption } from '@/lib/types/course';
import { generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';
import { parseAverageScore, sortByLatest, formatQuestionTypes } from '@/lib/utils/quizHelpers';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import EditQuizSheet from '@/components/quiz/EditQuizSheet';
import { useHideNav } from '@/lib/hooks/useHideNav';
import {
  PROFESSOR_QUIZ_TYPES,
  ClassFilterTabs,
} from './quizPageParts';
import type { QuizCardData } from './quizPageParts';
import { NewsCarousel, CustomQuizCard, SkeletonCard, ManageQuizCard } from './quizPageCards';


function QuizListPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { isBookmarked, toggleBookmark } = useQuizBookmark();
  const { userCourseId } = useCourse();
  const { updatedQuizzes, checkQuizUpdate, refresh: refreshUpdates, loading: updatesLoading } = useQuizUpdate();

  // 과목별 리본 이미지
  const currentCourse = userCourseId && COURSES[userCourseId] ? COURSES[userCourseId] : null;
  const ribbonImage = currentCourse?.quizRibbonImage || '/images/biology-quiz-ribbon.png';
  const ribbonScale = currentCourse?.quizRibbonScale || 1;
  const ribbonOffsetY = currentCourse?.quizRibbonOffsetY || 0;

  // 상태
  const [midtermQuizzes, setMidtermQuizzes] = useState<QuizCardData[]>([]);
  const [finalQuizzes, setFinalQuizzes] = useState<QuizCardData[]>([]);
  const [pastQuizzes, setPastQuizzes] = useState<QuizCardData[]>([]);
  const [independentQuizzes, setIndependentQuizzes] = useState<QuizCardData[]>([]);
  const [customQuizzes, setCustomQuizzes] = useState<QuizCardData[]>([]);

  // quiz_completions 기반 완료 데이터 (useRef로 구독 재시작 방지)
  const completionMapRef = useRef<Map<string, number>>(new Map());
  const [completionVer, setCompletionVer] = useState(0);

  const [isLoading, setIsLoading] = useState({
    midterm: true,
    final: true,
    past: true,
    independent: true,
    custom: true,
  });

  // 업데이트 정보 포함한 실제 로딩 상태 (퀴즈 + 업데이트 정보 모두 로드 완료 시 false)
  const actualLoading = useMemo(() => ({
    midterm: isLoading.midterm || updatesLoading,
    final: isLoading.final || updatesLoading,
    past: isLoading.past || updatesLoading,
    independent: isLoading.independent || updatesLoading,
    custom: isLoading.custom || updatesLoading,
  }), [isLoading, updatesLoading]);

  const [selectedQuiz, setSelectedQuiz] = useState<QuizCardData | null>(null);
  const { sourceRect, registerRef, captureRect, clearRect } = useExpandSource();

  // 기출 드롭다운
  const pastExamOptions = useMemo(() => getPastExamOptions(userCourseId), [userCourseId]);
  const [selectedPastExam, setSelectedPastExam] = useState<string>(() => {
    const options = getPastExamOptions(userCourseId);
    return options.length > 0 ? options[0].value : '2025-midterm';
  });

  // 퀴즈 관리 모드 (URL 파라미터로 상태 유지)
  const [isManageMode, setIsManageMode] = useState(() => {
    return searchParams.get('manage') === 'true';
  });
  const [myQuizzes, setMyQuizzes] = useState<QuizCardData[]>([]);
  const [isLoadingMyQuizzes, setIsLoadingMyQuizzes] = useState(false);
  // 인라인 수정 바텀시트
  const [editingQuizId, setEditingQuizId] = useState<string | null>(null);

  // 모달 상태
  const [updateModalInfo, setUpdateModalInfo] = useState<QuizUpdateInfo | null>(null);
  const [updateModalQuizCount, setUpdateModalQuizCount] = useState(0);
  const [updateConfirmQuiz, setUpdateConfirmQuiz] = useState<QuizCardData | null>(null);
  const [updateConfirmLoading, setUpdateConfirmLoading] = useState(false);
  const [statsQuiz, setStatsQuiz] = useState<QuizCardData | null>(null);
  const [statsSourceRect, setStatsSourceRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [deleteSourceRect, setDeleteSourceRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // 자작 섹션 반별 필터
  const [classFilter, setClassFilter] = useState<'all' | 'A' | 'B' | 'C' | 'D'>('all');

  // 스크롤 맨 위로 버튼
  const customSectionRef = useRef<HTMLDivElement>(null);

  // 삭제 확인 모달
  const [quizToDelete, setQuizToDelete] = useState<QuizCardData | null>(null);

  // Details/관리 모달 열릴 때 네비게이션 숨김
  useHideNav(!!(selectedQuiz || quizToDelete || isManageMode || statsQuiz));

  // body 스크롤 방지 통합 (모달/관리모드 열림 시 PullToHome 스와이프 방지)
  useEffect(() => {
    const lock = !!quizToDelete || isManageMode;
    if (lock) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [quizToDelete, isManageMode]);

  // (삭제 모달은 위의 통합 useEffect에서 처리)

  // 태그 필터링 상태
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showTagFilter, setShowTagFilter] = useState(false);

  // 과목별 동적 태그 목록
  const fixedTagOptions = useMemo(() => {
    const courseTags = generateCourseTags(userCourseId);
    return [...COMMON_TAGS.map(t => t.value), ...courseTags.map(t => t.value)];
  }, [userCourseId]);

  // 완료 상태 병합 + 정렬 (completionMapRef 사용 → completionVer로 갱신 트리거)
  const applyCompletionAndSort = useCallback((quizzes: QuizCardData[]): QuizCardData[] => {
    const cm = completionMapRef.current;
    const withCompletion = quizzes.map(quiz => {
      const completionScore = cm.get(quiz.id);
      const isCompleted = completionScore !== undefined || quiz.isCompleted;
      const myScore = completionScore ?? quiz.myScore;
      return { ...quiz, isCompleted, myScore };
    });
    return [...withCompletion].sort((a, b) => {
      if (!a.isCompleted && b.isCompleted) return -1;
      if (a.isCompleted && !b.isCompleted) return 1;
      return sortByLatest(a, b);
    });
  }, []);

  // 단일 useMemo — completionVer 변경 시 1회 정렬
  const { midtermQuizzesWithUpdate, finalQuizzesWithUpdate, pastQuizzesWithUpdate, independentQuizzesWithUpdate, customQuizzesWithUpdate } = useMemo(() => ({
    midtermQuizzesWithUpdate: applyCompletionAndSort(midtermQuizzes),
    finalQuizzesWithUpdate: applyCompletionAndSort(finalQuizzes),
    pastQuizzesWithUpdate: applyCompletionAndSort(pastQuizzes),
    independentQuizzesWithUpdate: applyCompletionAndSort(independentQuizzes),
    customQuizzesWithUpdate: applyCompletionAndSort(customQuizzes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [midtermQuizzes, finalQuizzes, pastQuizzes, independentQuizzes, customQuizzes, completionVer, applyCompletionAndSort]);

  // 태그 + 반별 필터링된 자작 퀴즈
  const filteredCustomQuizzes = useMemo(() => {
    let result = customQuizzesWithUpdate;
    // 반별 필터
    if (classFilter !== 'all') {
      result = result.filter(quiz => quiz.creatorClassType === classFilter);
    }
    // 태그 필터
    if (selectedTags.length > 0) {
      result = result.filter(quiz =>
        selectedTags.every(tag => quiz.tags?.includes(tag))
      );
    }
    return result;
  }, [customQuizzesWithUpdate, classFilter, selectedTags]);

  // ============================================================
  // 데이터 로드 함수들
  // ============================================================

  // quiz_completions 1회 조회 (onSnapshot → getDocs: 목록에서 실시간 불필요, 재마운트 시 갱신)
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'quiz_completions'),
      where('userId', '==', user.uid)
    );
    getDocs(q).then((snap) => {
      const map = new Map<string, number>();
      snap.forEach(d => {
        const data = d.data();
        map.set(data.quizId, data.score ?? 0);
      });
      completionMapRef.current = map;
      setCompletionVer(v => v + 1);
    }).catch((err) => {
      console.error('quiz_completions 조회 에러:', err);
    });
  }, [user]);

  // 퀴즈 데이터 파싱 (updatedQuizzes 의존성 제거 - 재로딩 방지)
  const parseQuizData = useCallback((docSnapshot: any, userId: string): QuizCardData => {
    const data = docSnapshot.data();
    const isCompleted = data.completedUsers?.includes(userId) || false;
    const participantCount = data.participantCount || 0;
    const averageScore = parseAverageScore(data);

    return {
      id: docSnapshot.id,
      title: data.title || '제목 없음',
      type: data.type || 'midterm',
      questionCount: data.questionCount || 0,
      difficulty: data.difficulty || 'normal',
      participantCount,
      averageScore,
      isCompleted,
      myScore: data.userScores?.[userId],
      myFirstReviewScore: data.userFirstReviewScores?.[userId],
      creatorNickname: data.creatorNickname,
      creatorClassType: data.creatorClassType,
      creatorId: data.creatorId,
      hasUpdate: false,
      updatedQuestionCount: undefined,
      tags: data.tags || [],
      bookmarkCount: data.bookmarkCount || 0,
      createdAt: data.createdAt,
      attachmentUrl: data.attachmentUrl,
      oneLineSummary: data.oneLineSummary,
      description: data.description,
      difficultyImageUrl: data.difficultyImageUrl,
      multipleChoiceCount: data.multipleChoiceCount || 0,
      subjectiveCount: data.subjectiveCount || 0,
      oxCount: data.oxCount || 0,
      isAiGenerated: data.isAiGenerated || data.type === 'ai-generated' || !!data.uploadedAt,
      pastYear: data.pastYear,
      pastExamType: data.pastExamType,
    };
  }, []);

  // 중간/기말/기출 통합 구독 (3개 → 1개: type in ['midterm','final','past'] AND courseId)
  useEffect(() => {
    if (!user || !userCourseId) return;

    setIsLoading((prev) => ({ ...prev, midterm: true, final: true, past: true, independent: true }));

    const q = query(
      collection(db, 'quizzes'),
      where('type', 'in', ['midterm', 'final', 'past', 'independent', 'professor', 'professor-ai']),
      where('courseId', '==', userCourseId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const midterm: QuizCardData[] = [];
      const final_: QuizCardData[] = [];
      const past: QuizCardData[] = [];
      const independent: QuizCardData[] = [];

      snapshot.forEach((doc) => {
        // 비공개 퀴즈 필터링 (isPublished 또는 isPublic)
        const data = doc.data();
        if (data.isPublished === false || data.isPublic === false) return;
        const quiz = parseQuizData(doc, user.uid);
        if (quiz.type === 'midterm') midterm.push(quiz);
        else if (quiz.type === 'final') final_.push(quiz);
        else if (quiz.type === 'past') past.push(quiz);
        else if (quiz.type === 'independent' || quiz.type === 'professor' || quiz.type === 'professor-ai') independent.push(quiz);
      });

      setMidtermQuizzes(midterm);
      setFinalQuizzes(final_);
      setPastQuizzes(past);
      setIndependentQuizzes(independent);
      setIsLoading((prev) => ({ ...prev, midterm: false, final: false, past: false, independent: false }));
    }, (err) => {
      console.error('퀴즈 목록 구독 에러:', err);
      setIsLoading((prev) => ({ ...prev, midterm: false, final: false, past: false, independent: false }));
    });

    return () => unsubscribe();
  }, [user, userCourseId, parseQuizData]);

  // 자작 퀴즈 로드 (courseId 서버 필터)
  useEffect(() => {
    if (!user || !userCourseId) return;

    setIsLoading((prev) => ({ ...prev, custom: true }));

    const q = query(
      collection(db, 'quizzes'),
      where('type', '==', 'custom'),
      where('courseId', '==', userCourseId),
      where('isPublic', '==', true)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const quizzes: QuizCardData[] = [];
      snapshot.forEach((d) => {
        quizzes.push(parseQuizData(d, user.uid));
      });
      setCustomQuizzes(quizzes);
      setIsLoading((prev) => ({ ...prev, custom: false }));
    }, (err) => {
      console.error('자작 퀴즈 구독 에러:', err);
      setIsLoading((prev) => ({ ...prev, custom: false }));
    });

    return () => unsubscribe();
  }, [user, userCourseId, parseQuizData]);

  // 내 퀴즈 로드 (관리 모드) - 최신순 정렬, courseId 필터
  const fetchMyQuizzes = useCallback(async () => {
    if (!user || !userCourseId) return;

    setIsLoadingMyQuizzes(true);
    const quizzesRef = collection(db, 'quizzes');
    const q = query(quizzesRef, where('creatorId', '==', user.uid), where('isPublic', '==', true), where('courseId', '==', userCourseId));

    const snapshot = await getDocs(q);
    const quizzes: QuizCardData[] = [];
    snapshot.forEach((doc) => {
      quizzes.push(parseQuizData(doc, user.uid));
    });

    // 관리 모드는 최신순만 적용
    quizzes.sort(sortByLatest);

    setMyQuizzes(quizzes);
    setIsLoadingMyQuizzes(false);
  }, [user, userCourseId, parseQuizData]);

  useEffect(() => {
    if (isManageMode) {
      fetchMyQuizzes();
    }
  }, [isManageMode, fetchMyQuizzes]);

  // 관리 모드 URL 동기화 (뒤로가기 지원)
  useEffect(() => {
    const currentManage = searchParams.get('manage') === 'true';
    if (isManageMode !== currentManage) {
      const newUrl = isManageMode ? '/quiz?manage=true' : '/quiz';
      router.replace(newUrl, { scroll: false });
    }
  }, [isManageMode, searchParams, router]);


  // ============================================================
  // 핸들러 함수들
  // ============================================================

  const handleStartQuiz = (quizId: string) => {
    router.push(`/quiz/${quizId}`);
  };

  const handleShowDetails = (quiz: QuizCardData) => {
    captureRect(quiz.id);
    setSelectedQuiz(quiz);
  };

  const handleOpenUpdateModal = (quiz: QuizCardData) => {
    setUpdateConfirmQuiz(quiz);
  };

  const handleConfirmUpdate = async () => {
    if (!updateConfirmQuiz) return;
    try {
      setUpdateConfirmLoading(true);
      const info = await checkQuizUpdate(updateConfirmQuiz.id);
      if (info && info.hasUpdate && info.updatedQuestions.length > 0) {
        setUpdateModalInfo(info);
        setUpdateModalQuizCount(updateConfirmQuiz.questionCount);
        setUpdateConfirmQuiz(null);
      } else {
        alert('이미 최신 상태입니다.');
        setUpdateConfirmQuiz(null);
      }
    } catch (err) {
      alert('업데이트 정보를 불러오는데 실패했습니다.');
    } finally {
      setUpdateConfirmLoading(false);
    }
  };

  const handleUpdateComplete = () => {
    setUpdateModalInfo(null);
    // refreshUpdates() 제거 — 리렌더링으로 스크롤 초기화 방지
    // Firestore 업데이트는 다음 접속 시 자동 반영
  };

  const handleEditQuiz = (quizId: string) => {
    // 관리 모드에서 인라인 바텀시트로 수정
    setEditingQuizId(quizId);
  };

  const handleDeleteQuiz = (quiz: QuizCardData, rect?: { x: number; y: number; width: number; height: number }) => {
    if (rect) setDeleteSourceRect(rect);
    setQuizToDelete(quiz);
  };

  const confirmDeleteQuiz = async () => {
    if (!quizToDelete) return;

    try {
      await deleteDoc(doc(db, 'quizzes', quizToDelete.id));
      setMyQuizzes((prev) => prev.filter((q) => q.id !== quizToDelete.id));
      setQuizToDelete(null);
    } catch (error) {
      console.error('퀴즈 삭제 실패:', error);
      alert('퀴즈 삭제에 실패했습니다.');
    }
  };

  // ============================================================
  // 렌더링
  // ============================================================

  // 관리 모드 — AnimatePresence 오버레이로 이전 (하단 메인 리턴에서 렌더링)
  if (false as boolean) {
    return (
      <motion.div
        initial={{ x: '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: '-100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        className="fixed inset-0 overflow-y-auto overscroll-contain pb-28 z-[5]"
        style={{ backgroundColor: '#F5F0E8' }}
      >
        {/* 헤더: 제목 + 오른쪽 화살표(닫기) */}
        <header className="px-4 pt-4 pb-3 border-b border-[#EDEAE4]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-[#1A1A1A]">내가 만든 퀴즈</h2>
              <p className="text-xs text-[#5C5C5C]">수정, 삭제, 통계 확인</p>
            </div>
            <button
              onClick={() => setIsManageMode(false)}
              className="flex items-center justify-center text-[#1A1A1A] hover:text-[#5C5C5C] transition-colors shrink-0 p-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </header>

        <main className="px-4 py-3">
          {isLoadingMyQuizzes && (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}

          {!isLoadingMyQuizzes && myQuizzes.length === 0 && (
            <div
              className="flex flex-col items-center justify-center text-center"
              style={{ minHeight: 'calc(100vh - 320px)' }}
            >
              <h3 className="font-bold text-base mb-2 text-[#1A1A1A]">
                아직 만든 퀴즈가 없습니다
              </h3>
              <p className="text-sm text-[#5C5C5C] mb-4">
                첫 번째 퀴즈를 만들어보세요!
              </p>
              <button
                onClick={() => router.push('/quiz/create')}
                className="px-5 py-2.5 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-sm"
              >
                퀴즈 만들기
              </button>
            </div>
          )}

          {!isLoadingMyQuizzes && myQuizzes.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {myQuizzes.map((quiz) => (
                <ManageQuizCard
                  key={quiz.id}
                  quiz={quiz}
                  onEdit={() => handleEditQuiz(quiz.id)}
                  onDelete={(rect) => handleDeleteQuiz(quiz, rect)}
                  onStats={(rect) => { setStatsSourceRect(rect); setStatsQuiz(quiz); }}
                />
              ))}
            </div>
          )}
        </main>

        {/* 통계 모달 */}
        <QuizStatsModal
          quizId={statsQuiz?.id || ''}
          quizTitle={statsQuiz?.title || ''}
          isOpen={!!statsQuiz}
          onClose={() => setStatsQuiz(null)}
          sourceRect={statsSourceRect}
        />

        {/* 삭제 확인 모달 */}
        <AnimatePresence>
        {quizToDelete && (() => {
          const sr = deleteSourceRect;
          const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
          const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
          const dx = sr ? (sr.x + sr.width / 2 - cx) : 0;
          const dy = sr ? (sr.y + sr.height / 2 - cy) : 0;
          return (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-black/50"
            onClick={() => setQuizToDelete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.05, x: dx, y: dy }}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, scale: 0.05, x: dx, y: dy }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[260px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-xl"
            >
              <div className="flex justify-center mb-3">
                <div className="w-10 h-10 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                  <svg className="w-5 h-5 text-[#8B1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
              </div>
              <h3 className="text-center font-bold text-sm text-[#1A1A1A] mb-1.5">퀴즈를 삭제할까요?</h3>
              <p className="text-xs text-[#5C5C5C] mb-0.5">- 삭제된 퀴즈는 복구할 수 없습니다.</p>
              <p className="text-xs text-[#5C5C5C] mb-4">- 이미 푼 사람은 복습 가능합니다.</p>
              <div className="flex gap-2">
                <button onClick={() => setQuizToDelete(null)} className="flex-1 py-2 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg">취소</button>
                <button onClick={confirmDeleteQuiz} className="flex-1 py-2 text-xs font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] transition-colors rounded-lg">삭제</button>
              </div>
            </motion.div>
          </motion.div>
          );
        })()}
        </AnimatePresence>
      </motion.div>
    );
  }

  // 메인 페이지
  return (
    <>
    <div className={`min-h-screen pb-72 ${isManageMode ? 'pointer-events-none' : ''}`} style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 - 배너 이미지 */}
      <header className="flex flex-col items-center">
        <div className="w-full h-[160px] mt-2">
          <img
            src={ribbonImage}
            alt="Quiz"
            className="w-full h-full object-contain"
            style={{ transform: `scale(${ribbonScale}) scaleX(1.15)` }}
          />
        </div>

        {/* 버튼 영역 */}
        <div className="w-full px-4 py-1.5 flex items-center justify-between">
          <button
            onClick={() => setIsManageMode(true)}
            className="px-4 py-3 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors rounded-lg"
          >
            퀴즈 관리
          </button>
          <button
            onClick={() => router.push('/quiz/create')}
            className="px-4 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#3A3A3A] transition-colors rounded-lg"
          >
            퀴즈 만들기
          </button>
        </div>
      </header>

      {/* 뉴스 캐러셀 (중간/기말/기출) */}
      <section data-no-tab-swipe className="mt-4" style={{ transform: 'scale(0.85)', transformOrigin: 'top center', width: '117.65%', marginLeft: '-8.825%', marginBottom: '-12px' }}>
        <NewsCarousel
          midtermQuizzes={midtermQuizzesWithUpdate}
          finalQuizzes={finalQuizzesWithUpdate}
          pastQuizzes={pastQuizzesWithUpdate}
          independentQuizzes={independentQuizzesWithUpdate}
          pastExamOptions={pastExamOptions}
          selectedPastExam={selectedPastExam}
          onSelectPastExam={setSelectedPastExam}
          isLoading={actualLoading}
          onStart={handleStartQuiz}
          onUpdate={handleOpenUpdateModal}
          onShowDetails={handleShowDetails}
          onReview={(quizId) => router.push(`/review/library/${quizId}?from=quiz&autoStart=all`)}
          onReviewWrongOnly={(quizId) => router.push(`/review/library/${quizId}?from=quiz&autoStart=wrongOnly`)}
        />
      </section>

      {/* 자작 섹션 */}
      <section className="px-4">
        <div ref={customSectionRef} className="flex items-center justify-between mb-2">
          <ClassFilterTabs
            activeTab={classFilter}
            onChangeTab={setClassFilter}
          />
        </div>

        {/* 태그 검색 영역 (우측 정렬) */}
        <div className="flex items-center justify-end gap-1.5 mb-1.5">
          {/* 선택된 태그들 */}
          {selectedTags.map((tag) => {
            const useShort = selectedTags.length >= 3 && tag.includes('_');
            const label = useShort ? `#${tag.split('_')[0]}` : `#${tag}`;
            return (
              <div
                key={tag}
                title={`#${tag}`}
                className="flex items-center gap-0.5 px-1.5 h-9 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold border border-[#1A1A1A] rounded-lg shrink-0"
              >
                {label}
                <button
                  onClick={() => setSelectedTags(prev => prev.filter(t => t !== tag))}
                  className="ml-0.5 hover:text-[#999]"
                >
                  ✕
                </button>
              </div>
            );
          })}

          {/* 태그 검색 버튼 */}
          <button
            onClick={() => setShowTagFilter(!showTagFilter)}
            className={`flex items-center justify-center w-9 h-9 border transition-colors shrink-0 rounded-lg ${
              showTagFilter
                ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A]'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </button>
        </div>

        {/* 태그 필터 목록 */}
        <AnimatePresence>
          {showTagFilter && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-2"
            >
              <div className="flex flex-wrap gap-1.5 p-2 bg-[#EDEAE4] border border-[#D4CFC4]">
                {fixedTagOptions
                  .filter(tag => !selectedTags.includes(tag))
                  .map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        setSelectedTags(prev => [...prev, tag]);
                        setShowTagFilter(false);
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

        {/* 자작 퀴즈 목록 */}
        <>
            {actualLoading.custom && (
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            )}

            {!actualLoading.custom && customQuizzes.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center text-center py-12"
              >
                <h3 className="text-lg font-black mb-2 text-[#1A1A1A]">
                  자작 퀴즈가 없습니다
                </h3>
                <p className="text-sm text-[#5C5C5C]">
                  첫 번째 퀴즈를 만들어보세요!
                </p>
              </motion.div>
            )}

            {/* 필터링 결과가 없을 때 */}
            {!actualLoading.custom && customQuizzes.length > 0 && filteredCustomQuizzes.length === 0 && selectedTags.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center text-center py-8"
              >
                <p className="text-sm text-[#5C5C5C]">
                  {selectedTags.map(t => `#${t}`).join(' ')} 태그가 있는 퀴즈가 없습니다
                </p>
              </motion.div>
            )}

            {!actualLoading.custom && filteredCustomQuizzes.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {filteredCustomQuizzes.map((quiz, index) => (
                  <motion.div
                    key={quiz.id}
                    ref={(el) => registerRef(quiz.id, el)}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                  >
                    <CustomQuizCard
                      quiz={quiz}
                      onStart={() => handleStartQuiz(quiz.id)}
                      onDetails={() => handleShowDetails(quiz)}
                      isBookmarked={isBookmarked(quiz.id)}
                      onToggleBookmark={() => toggleBookmark(quiz.id)}
                      onUpdate={() => handleOpenUpdateModal(quiz)}
                      onReview={() => router.push(`/review/library/${quiz.id}?from=quiz&autoStart=all`)}
                      onReviewWrongOnly={quiz.myScore === 100 ? undefined : () => router.push(`/review/library/${quiz.id}?from=quiz&autoStart=wrongOnly`)}
                    />
                  </motion.div>
                ))}
              </div>
            )}
          </>

      </section>

      {/* 퀴즈 상세 모달 */}
      <ExpandModal
        isOpen={!!selectedQuiz}
        onClose={() => { setSelectedQuiz(null); clearRect(); }}
        sourceRect={sourceRect}
        className="w-full max-w-[260px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-xl"
      >
        {selectedQuiz && (
          <>
            <h2 className="text-sm font-bold text-[#1A1A1A] mb-2">{selectedQuiz.title}</h2>

            {/* 총평 */}
            {selectedQuiz.description && (
              <p className="text-xs text-[#5C5C5C] mb-3 line-clamp-3">&ldquo;{selectedQuiz.description}&rdquo;</p>
            )}
            {!selectedQuiz.description && <div className="mb-1" />}

            {/* 미완료: 평균 점수 대형 박스 (Start 버전) */}
            {!selectedQuiz.isCompleted && (
              <div className="text-center py-2 mb-2 border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4] rounded-lg">
                <p className="text-[10px] text-[#5C5C5C] mb-0.5">평균 점수</p>
                <p className="text-2xl font-black text-[#1A1A1A]">
                  {selectedQuiz.participantCount > 0
                    ? <>{(selectedQuiz.averageScore ?? 0).toFixed(0)}<span className="text-xs font-bold">점</span></>
                    : '-'}
                </p>
              </div>
            )}

            <div className="space-y-1.5 mb-4">
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">문제 수</span>
                <span className="font-bold text-[#1A1A1A]">{selectedQuiz.questionCount}문제</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">참여자</span>
                <span className="font-bold text-[#1A1A1A]">{selectedQuiz.participantCount}명</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">난이도</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedQuiz.difficulty === 'easy' ? '쉬움' : selectedQuiz.difficulty === 'hard' ? '어려움' : '보통'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">문제 유형</span>
                <span className="font-bold text-[#1A1A1A]">
                  {formatQuestionTypes(
                    selectedQuiz.oxCount || 0,
                    selectedQuiz.multipleChoiceCount || 0,
                    selectedQuiz.subjectiveCount || 0
                  )}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">제작자</span>
                <span className="font-bold text-[#1A1A1A]">
                  {PROFESSOR_QUIZ_TYPES.has(selectedQuiz.type) ? '교수님' : (selectedQuiz.creatorNickname || '익명')}
                  {!PROFESSOR_QUIZ_TYPES.has(selectedQuiz.type) && selectedQuiz.creatorClassType && ` · ${selectedQuiz.creatorClassType}반`}
                </span>
              </div>

              {/* 완료: 평균 점수 행 + 퀴즈/복습 점수 (Review 버전) */}
              {selectedQuiz.isCompleted && (
                <>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#5C5C5C]">평균 점수</span>
                    <span className="font-bold text-[#1A1A1A]">
                      {selectedQuiz.participantCount > 0
                        ? `${(selectedQuiz.averageScore ?? 0).toFixed(0)}점`
                        : '-'}
                    </span>
                  </div>
                  <div className="py-2 border-t border-[#A0A0A0]">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-3xl font-black text-[#1A1A1A]">
                        {selectedQuiz.myScore !== undefined ? selectedQuiz.myScore : '-'}
                      </span>
                      <span className="text-sm text-[#5C5C5C]">/</span>
                      <span className="text-3xl font-black text-[#1A1A1A]">
                        {selectedQuiz.myFirstReviewScore !== undefined ? selectedQuiz.myFirstReviewScore : '-'}
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-6 mt-0.5">
                      <span className="text-[10px] text-[#5C5C5C]">퀴즈</span>
                      <span className="text-[10px] text-[#5C5C5C]">복습</span>
                    </div>
                  </div>
                </>
              )}

              {selectedQuiz.tags && selectedQuiz.tags.length > 0 && (
                <div className="pt-2 border-t border-[#A0A0A0]">
                  <div className="flex flex-wrap gap-1.5">
                    {selectedQuiz.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-medium"
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
                onClick={() => { setSelectedQuiz(null); clearRect(); }}
                className="flex-1 py-2 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  const quiz = selectedQuiz;
                  setSelectedQuiz(null);
                  clearRect();
                  if (quiz.isCompleted) {
                    router.push(`/review/library/${quiz.id}?from=quiz`);
                  } else {
                    handleStartQuiz(quiz.id);
                  }
                }}
                className="flex-1 py-2 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg"
              >
                {selectedQuiz.isCompleted ? '복습하기' : '시작하기'}
              </button>
            </div>
          </>
        )}
      </ExpandModal>

      {/* 업데이트 확인 모달 */}
      {updateConfirmQuiz && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50"
          onClick={() => !updateConfirmLoading && setUpdateConfirmQuiz(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-3 rounded-2xl"
          >
            {/* 아이콘 */}
            <div className="flex justify-center mb-2">
              <div className="w-7 h-7 flex items-center justify-center border border-[#1A1A1A] bg-[#EDEAE4]">
                <svg
                  className="w-3.5 h-3.5 text-[#1A1A1A]"
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

            <h3 className="text-center font-bold text-xs text-[#1A1A1A] mb-1.5">
              수정된 문제를 풀까요?
            </h3>
            <p className="text-[10px] text-[#5C5C5C] mb-0.5">
              - 수정된 {updateConfirmQuiz.updatedQuestionCount || '일부'}문제만 다시 풀 수 있습니다.
            </p>
            <p className="text-[10px] text-[#5C5C5C] mb-0.5">
              - 새로운 답변이 점수에 반영됩니다.
            </p>
            <p className="text-[10px] text-[#5C5C5C] mb-3">
              - 정답 여부와 복습 기록이 업데이트됩니다.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setUpdateConfirmQuiz(null)}
                disabled={updateConfirmLoading}
                className="flex-1 py-1.5 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors disabled:opacity-50 rounded-xl"
              >
                취소
              </button>
              <button
                onClick={handleConfirmUpdate}
                disabled={updateConfirmLoading}
                className="flex-1 py-1.5 text-xs font-bold border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors disabled:opacity-50 flex items-center justify-center gap-2 rounded-xl"
              >
                {updateConfirmLoading ? (
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

      {/* 업데이트 모달 */}
      {updateModalInfo && (
        <UpdateQuizModal
          isOpen={true}
          onClose={() => setUpdateModalInfo(null)}
          updateInfo={updateModalInfo}
          totalQuestionCount={updateModalQuizCount}
          onComplete={handleUpdateComplete}
        />
      )}

      {/* 삭제 확인 모달 */}
      <AnimatePresence>
      {quizToDelete && !isManageMode && (() => {
        const sr = deleteSourceRect;
        const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
        const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
        const dx = sr ? (sr.x + sr.width / 2 - cx) : 0;
        const dy = sr ? (sr.y + sr.height / 2 - cy) : 0;
        return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-black/50"
          onClick={() => setQuizToDelete(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.05, x: dx, y: dy }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.05, x: dx, y: dy }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[260px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-xl"
          >
            <div className="flex justify-center mb-3">
              <div className="w-10 h-10 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                <svg className="w-5 h-5 text-[#8B1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
            </div>
            <h3 className="text-center font-bold text-sm text-[#1A1A1A] mb-1.5">퀴즈를 삭제할까요?</h3>
            <p className="text-xs text-[#5C5C5C] mb-0.5">- 삭제된 퀴즈는 복구할 수 없습니다.</p>
            <p className="text-xs text-[#5C5C5C] mb-4">- 이미 푼 사람은 복습 가능합니다.</p>
            <div className="flex gap-2">
              <button onClick={() => setQuizToDelete(null)} className="flex-1 py-2 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg">취소</button>
              <button onClick={confirmDeleteQuiz} className="flex-1 py-2 text-xs font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] transition-colors rounded-lg">삭제</button>
            </div>
          </motion.div>
        </motion.div>
        );
      })()}
      </AnimatePresence>

      {/* 스크롤 맨 위로 버튼 */}
      <ScrollToTopButton targetRef={customSectionRef} bottomPx={90} side="left" />
    </div>

    {/* 관리 모드 오버레이 (들어갈 때 + 나갈 때 슬라이드 애니메이션) */}
    <AnimatePresence>
      {isManageMode && (
        <motion.div
          key="manage-mode"
          initial={{ x: '-100%' }}
          animate={{ x: 0 }}
          exit={{ x: '-100%' }}
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          className="fixed inset-0 overflow-y-auto overscroll-contain pb-28 z-[60]"
          style={{ backgroundColor: '#F5F0E8' }}
        >
          {/* 헤더: 제목 + 오른쪽 화살표(닫기) */}
          <header className="px-4 pb-3 border-b border-[#EDEAE4]" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-[#1A1A1A]">내가 만든 퀴즈</h2>
                <p className="text-xs text-[#5C5C5C]">수정, 삭제, 통계 확인</p>
              </div>
              <button
                onClick={() => setIsManageMode(false)}
                className="flex items-center justify-center text-[#1A1A1A] hover:text-[#5C5C5C] transition-colors shrink-0 p-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </header>

          <main className="px-4 py-3">
            {isLoadingMyQuizzes && (
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            )}

            {!isLoadingMyQuizzes && myQuizzes.length === 0 && (
              <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: 'calc(100vh - 320px)' }}>
                <h3 className="font-bold text-base mb-2 text-[#1A1A1A]">아직 만든 퀴즈가 없습니다</h3>
                <p className="text-sm text-[#5C5C5C] mb-4">첫 번째 퀴즈를 만들어보세요!</p>
                <button onClick={() => router.push('/quiz/create')} className="px-5 py-2.5 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-sm">퀴즈 만들기</button>
              </div>
            )}

            {!isLoadingMyQuizzes && myQuizzes.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {myQuizzes.map((quiz) => (
                  <ManageQuizCard
                    key={quiz.id}
                    quiz={quiz}
                    onEdit={() => handleEditQuiz(quiz.id)}
                    onDelete={(rect) => handleDeleteQuiz(quiz, rect)}
                    onStats={(rect) => { setStatsSourceRect(rect); setStatsQuiz(quiz); }}
                  />
                ))}
              </div>
            )}
          </main>
        </motion.div>
      )}
    </AnimatePresence>

    {/* 관리 모드 모달 (슬라이드 밖에서 렌더링 — transform 영향 방지) */}
    {isManageMode && (
      <>
        <QuizStatsModal
          quizId={statsQuiz?.id || ''}
          quizTitle={statsQuiz?.title || ''}
          isOpen={!!statsQuiz}
          onClose={() => setStatsQuiz(null)}
          sourceRect={statsSourceRect}
        />
        <AnimatePresence>
          {quizToDelete && (() => {
            const sr = deleteSourceRect;
            const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
            const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
            const dx = sr ? (sr.x + sr.width / 2 - cx) : 0;
            const dy = sr ? (sr.y + sr.height / 2 - cy) : 0;
            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-black/50"
                onClick={() => setQuizToDelete(null)}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.05, x: dx, y: dy }}
                  animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                  exit={{ opacity: 0, scale: 0.05, x: dx, y: dy }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-[260px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-xl"
                >
                  <div className="flex justify-center mb-3">
                    <div className="w-10 h-10 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                      <svg className="w-5 h-5 text-[#8B1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="text-center font-bold text-sm text-[#1A1A1A] mb-1.5">퀴즈를 삭제할까요?</h3>
                  <p className="text-xs text-[#5C5C5C] mb-0.5">- 삭제된 퀴즈는 복구할 수 없습니다.</p>
                  <p className="text-xs text-[#5C5C5C] mb-4">- 이미 푼 사람은 복습 가능합니다.</p>
                  <div className="flex gap-2">
                    <button onClick={() => setQuizToDelete(null)} className="flex-1 py-2 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg">취소</button>
                    <button onClick={confirmDeleteQuiz} className="flex-1 py-2 text-xs font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] transition-colors rounded-lg">삭제</button>
                  </div>
                </motion.div>
              </motion.div>
            );
          })()}
        </AnimatePresence>
      </>
    )}

    {/* 인라인 수정 바텀시트 (관리 모드 위에 오버레이) */}
    <AnimatePresence>
      {editingQuizId && (
        <EditQuizSheet
          key={editingQuizId}
          quizId={editingQuizId}
          onClose={() => setEditingQuizId(null)}
          onSaved={() => {
            // 수정 완료 후 내 퀴즈 목록 새로고침
            if (fetchMyQuizzes) fetchMyQuizzes();
          }}
        />
      )}
    </AnimatePresence>
    </>
  );
}

// useSearchParams를 Suspense로 감싸서 export
export default function QuizListPage() {
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
      <QuizListPageContent />
    </Suspense>
  );
}
