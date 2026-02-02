'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  deleteDoc,
  doc,
  getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useQuizBookmark } from '@/lib/hooks/useQuizBookmark';
import { useQuizUpdate, type QuizUpdateInfo } from '@/lib/hooks/useQuizUpdate';
import UpdateQuizModal from '@/components/quiz/UpdateQuizModal';
import QuizStatsModal from '@/components/quiz/manage/QuizStatsModal';
import { Skeleton } from '@/components/common';
import { useCourse } from '@/lib/contexts';
import { COURSES } from '@/lib/types/course';

const QUIZZES_PER_PAGE = 20;

/** 필터 타입 */
type QuizFilter = 'all' | 'midterm' | 'final' | 'past' | 'custom';

/** 필터 옵션 */
const FILTER_OPTIONS: { value: QuizFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'midterm', label: '중간대비' },
  { value: 'final', label: '기말대비' },
  { value: 'past', label: '족보' },
  { value: 'custom', label: '제작' },
];

interface QuizCardData {
  id: string;
  title: string;
  type: string;
  questionCount: number;
  difficulty: string;
  participantCount: number;
  averageScore: number;
  isCompleted: boolean;
  myScore?: number;
  creatorNickname?: string;
  creatorClassType?: 'A' | 'B' | 'C' | 'D';
  creatorId?: string;
  hasUpdate?: boolean;
  updatedQuestionCount?: number;
}

/**
 * 슬라이드 필터 컴포넌트
 */
function SlideFilter({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: QuizFilter;
  onFilterChange: (filter: QuizFilter) => void;
}) {
  const activeIndex = FILTER_OPTIONS.findIndex((opt) => opt.value === activeFilter);

  return (
    <div className="relative flex items-center bg-[#EDEAE4] border border-[#1A1A1A]">
      {/* 슬라이드 배경 */}
      <motion.div
        className="absolute h-full bg-[#1A1A1A]"
        initial={false}
        animate={{
          left: `${activeIndex * 20}%`,
        }}
        style={{
          width: '20%',
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      />

      {/* 필터 옵션들 */}
      {FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onFilterChange(option.value)}
          className={`relative z-10 flex-1 px-4 py-2 text-xs font-bold transition-colors ${
            activeFilter === option.value ? 'text-[#F5F0E8]' : 'text-[#1A1A1A]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 완료 뱃지 컴포넌트
 * public/images/completed-badge.png 파일이 있으면 커스텀 이미지 사용
 */
function CompletedBadge() {
  const [useCustom, setUseCustom] = useState(false);

  useEffect(() => {
    // 커스텀 뱃지 이미지 존재 여부 확인
    const img = new window.Image();
    img.onload = () => setUseCustom(true);
    img.onerror = () => setUseCustom(false);
    img.src = '/images/completed-badge.png';
  }, []);

  if (useCustom) {
    return (
      <img
        src="/images/completed-badge.png"
        alt="완료"
        className="w-32 h-32 object-contain"
      />
    );
  }

  // 기본 초록색 뱃지
  return (
    <div className="bg-[#1A6B1A] text-[#F5F0E8] px-3 py-1.5 font-bold text-xs border-2 border-[#F5F0E8]">
      완료
    </div>
  );
}

/**
 * 퀴즈 카드 컴포넌트 - 미니멀 스타일
 */
function QuizCard({
  quiz,
  onStart,
  onDetails,
  isBookmarked,
  onToggleBookmark,
  onUpdate,
}: {
  quiz: QuizCardData;
  onStart: () => void;
  onDetails: () => void;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  onUpdate?: () => void;
}) {
  return (
    <div className={`relative border border-[#1A1A1A] bg-[#F5F0E8] p-4 ${
      quiz.isCompleted && !quiz.hasUpdate ? 'pointer-events-none' : ''
    }`}>
      {/* 완료 오버레이 - 업데이트가 있으면 다른 스타일 */}
      {quiz.isCompleted && (
        <div className={`absolute inset-0 z-10 flex items-center justify-center ${
          quiz.hasUpdate ? 'bg-black/40' : 'bg-black/70'
        }`}>
          {quiz.hasUpdate ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate?.();
              }}
              className="bg-[#F5C518] text-[#1A1A1A] px-3 py-1.5 font-bold text-xs border-2 border-[#1A1A1A] hover:bg-[#E5B508] transition-colors pointer-events-auto"
            >
              업데이트 ({quiz.updatedQuestionCount})
            </button>
          ) : (
            <CompletedBadge />
          )}
        </div>
      )}

      {/* 북마크 하트 아이콘 */}
      {onToggleBookmark && !quiz.isCompleted && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleBookmark();
          }}
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center transition-transform hover:scale-110"
        >
          {isBookmarked ? (
            <svg className="w-5 h-5 text-[#8B1A1A]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-[#5C5C5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          )}
        </button>
      )}

      {/* 제목 */}
      <h3 className="font-serif-display font-bold text-sm mb-2 line-clamp-2 text-[#1A1A1A] pr-6">
        {quiz.title}
      </h3>

      {/* 메타 정보 */}
      <p className="text-xs text-[#5C5C5C] mb-1">
        {quiz.questionCount}문제 · {quiz.participantCount}명 참여
      </p>

      {/* 내 점수 */}
      {quiz.myScore !== undefined && (
        <p className="text-xs text-[#1A1A1A] mb-3">
          내 점수: {quiz.myScore}점
        </p>
      )}

      {/* 버튼 영역 */}
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDetails();
          }}
          className="flex-1 py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
        >
          Details
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStart();
          }}
          className="flex-1 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
        >
          Start
        </button>
      </div>
    </div>
  );
}

/**
 * 스켈레톤 카드
 */
function SkeletonCard() {
  return (
    <div className="border border-[#1A1A1A] bg-[#F5F0E8] p-4">
      <Skeleton className="w-3/4 h-4 mb-2 rounded-none" />
      <Skeleton className="w-1/2 h-3 mb-3 rounded-none" />
      <div className="flex gap-2">
        <Skeleton className="flex-1 h-8 rounded-none" />
        <Skeleton className="flex-1 h-8 rounded-none" />
      </div>
    </div>
  );
}

/**
 * 퀴즈 관리 카드
 */
function ManageQuizCard({
  quiz,
  onEdit,
  onDelete,
  onFeedback,
  onStats,
}: {
  quiz: QuizCardData;
  onEdit: () => void;
  onDelete: () => void;
  onFeedback: () => void;
  onStats: () => void;
}) {
  return (
    <div className="border border-[#1A1A1A] bg-[#F5F0E8] p-4">
      <h3 className="font-bold text-sm mb-2 line-clamp-2 text-[#1A1A1A]">
        {quiz.title}
      </h3>
      <p className="text-xs text-[#5C5C5C] mb-3">
        {quiz.questionCount}문제 · {quiz.participantCount}명 참여
      </p>

      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={onStats}
          className="flex-1 min-w-[45%] py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
        >
          통계
        </button>
        <button
          onClick={onFeedback}
          className="flex-1 min-w-[45%] py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
        >
          피드백
        </button>
        <button
          onClick={onEdit}
          className="flex-1 min-w-[45%] py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
        >
          수정
        </button>
        <button
          onClick={onDelete}
          className="flex-1 min-w-[45%] py-1.5 text-xs font-bold border border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
        >
          삭제
        </button>
      </div>
    </div>
  );
}

export default function QuizListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { isBookmarked, toggleBookmark } = useQuizBookmark();
  const { userCourseId } = useCourse();

  // 퀴즈 업데이트 훅
  const { updatedQuizzes, checkQuizUpdate, refresh: refreshUpdates } = useQuizUpdate();

  // 과목별 리본 이미지 및 스케일 (기본값: biology)
  const currentCourse = userCourseId && COURSES[userCourseId] ? COURSES[userCourseId] : null;
  const ribbonImage = currentCourse?.quizRibbonImage || '/images/biology-quiz-ribbon.png';
  const ribbonScale = currentCourse?.quizRibbonScale || 1;
  const ribbonOffsetY = currentCourse?.quizRibbonOffsetY || 0;

  const [activeFilter, setActiveFilter] = useState<QuizFilter>('all');
  const [quizzes, setQuizzes] = useState<QuizCardData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedQuiz, setSelectedQuiz] = useState<QuizCardData | null>(null);

  // 퀴즈 관리 모드
  const [isManageMode, setIsManageMode] = useState(false);
  const [myQuizzes, setMyQuizzes] = useState<QuizCardData[]>([]);
  const [isLoadingMyQuizzes, setIsLoadingMyQuizzes] = useState(false);

  // 피드백 모달
  const [feedbackQuiz, setFeedbackQuiz] = useState<QuizCardData | null>(null);
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [isLoadingFeedbacks, setIsLoadingFeedbacks] = useState(false);

  // 업데이트 모달
  const [updateModalInfo, setUpdateModalInfo] = useState<QuizUpdateInfo | null>(null);
  const [updateModalQuizCount, setUpdateModalQuizCount] = useState(0);

  // 통계 모달
  const [statsQuiz, setStatsQuiz] = useState<QuizCardData | null>(null);

  // 내 퀴즈 불러오기
  const fetchMyQuizzes = useCallback(async () => {
    if (!user) return;

    try {
      setIsLoadingMyQuizzes(true);
      const quizzesRef = collection(db, 'quizzes');
      const q = query(
        quizzesRef,
        where('creatorId', '==', user.uid)
      );

      const snapshot = await getDocs(q);
      const quizList: QuizCardData[] = [];

      snapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        quizList.push({
          id: docSnapshot.id,
          title: data.title || '제목 없음',
          type: data.type || 'custom',
          questionCount: data.questionCount || 0,
          difficulty: data.difficulty || 'normal',
          participantCount: data.participantCount || 0,
          averageScore: data.averageScore || 0,
          isCompleted: false,
          creatorId: data.creatorId,
          creatorNickname: data.creatorNickname,
          creatorClassType: data.creatorClassType,
        });
      });

      // 최신순 정렬 (클라이언트 측)
      quizList.sort((a, b) => b.id.localeCompare(a.id));
      setMyQuizzes(quizList);
    } catch (error) {
      console.error('내 퀴즈 불러오기 실패:', error);
    } finally {
      setIsLoadingMyQuizzes(false);
    }
  }, [user]);

  const fetchQuizzes = useCallback(
    async () => {
      if (!user) return;

      try {
        setIsLoading(true);

        const quizzesRef = collection(db, 'quizzes');
        let snapshot;

        // 인덱스 오류 방지를 위해 단순 쿼리 사용 후 클라이언트 필터링
        if (activeFilter === 'all') {
          // 전체: 모든 퀴즈 표시 (midterm, final, past, custom 모두)
          // courseId로 필터링 (과목별 분리)
          const q = userCourseId
            ? query(quizzesRef, where('courseId', '==', userCourseId), limit(100))
            : query(quizzesRef, limit(100));
          snapshot = await getDocs(q);
        } else if (activeFilter === 'custom') {
          // 제작: 현재 사용자가 만든 퀴즈만
          const q = query(
            quizzesRef,
            where('creatorId', '==', user.uid)
          );
          snapshot = await getDocs(q);
        } else {
          // 중간대비/기말대비/족보: 해당 타입만
          // courseId로 필터링 (과목별 분리)
          const q = userCourseId
            ? query(
                quizzesRef,
                where('type', '==', activeFilter),
                where('courseId', '==', userCourseId)
              )
            : query(
                quizzesRef,
                where('type', '==', activeFilter)
              );
          snapshot = await getDocs(q);
        }

        const newQuizzes: QuizCardData[] = [];

        snapshot.forEach((docSnapshot) => {
          const data = docSnapshot.data();
          const isCompleted = data.completedUsers?.includes(user.uid) || false;

          // 중간대비/기말대비/족보 필터일 때 custom 타입 제외
          if (['midterm', 'final', 'past'].includes(activeFilter) && data.type === 'custom') {
            return;
          }

          // 업데이트 정보 확인
          const updateInfo = updatedQuizzes.get(docSnapshot.id);

          newQuizzes.push({
            id: docSnapshot.id,
            title: data.title || '제목 없음',
            type: data.type || 'midterm',
            questionCount: data.questionCount || 0,
            difficulty: data.difficulty || 'normal',
            participantCount: data.participantCount || 0,
            averageScore: data.averageScore || 0,
            isCompleted, // 완료 여부 저장
            myScore: data.userScores?.[user.uid],
            creatorNickname: data.creatorNickname,
            creatorClassType: data.creatorClassType,
            creatorId: data.creatorId,
            hasUpdate: isCompleted && updateInfo?.hasUpdate,
            updatedQuestionCount: updateInfo?.updatedQuestionCount,
          });
        });

        // 미완료 퀴즈 먼저, 업데이트 있는 퀴즈, 완료된 퀴즈 순서로 정렬
        newQuizzes.sort((a, b) => {
          // 미완료 우선
          if (!a.isCompleted && b.isCompleted) return -1;
          if (a.isCompleted && !b.isCompleted) return 1;

          // 완료된 것 중에서는 업데이트 있는 것 우선
          if (a.isCompleted && b.isCompleted) {
            if (a.hasUpdate && !b.hasUpdate) return -1;
            if (!a.hasUpdate && b.hasUpdate) return 1;
          }

          // 같은 그룹 내에서는 최신순
          return b.id.localeCompare(a.id);
        });
        setQuizzes(newQuizzes);
      } catch (error) {
        console.error('퀴즈 목록 불러오기 실패:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [user, activeFilter, userCourseId, updatedQuizzes]
  );

  useEffect(() => {
    if (user && userCourseId) {
      fetchQuizzes();
    }
  }, [activeFilter, user, userCourseId, fetchQuizzes]);

  // 관리 모드 진입 시 내 퀴즈 불러오기
  useEffect(() => {
    if (isManageMode && user) {
      fetchMyQuizzes();
    }
  }, [isManageMode, user, fetchMyQuizzes]);

  const handleStartQuiz = (quizId: string) => {
    router.push(`/quiz/${quizId}`);
  };

  const handleShowDetails = (quiz: QuizCardData) => {
    setSelectedQuiz(quiz);
  };

  const handleDeleteQuiz = async (quizId: string) => {
    if (!window.confirm('정말 이 퀴즈를 삭제하시겠습니까?\n삭제된 퀴즈는 복구할 수 없습니다.')) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'quizzes', quizId));
      setMyQuizzes((prev) => prev.filter((q) => q.id !== quizId));
      alert('퀴즈가 삭제되었습니다.');
    } catch (error) {
      console.error('퀴즈 삭제 실패:', error);
      alert('삭제에 실패했습니다.');
    }
  };

  const handleEditQuiz = (quizId: string) => {
    router.push(`/quiz/${quizId}/edit`);
  };

  const handleViewFeedback = async (quiz: QuizCardData) => {
    setFeedbackQuiz(quiz);
    setIsLoadingFeedbacks(true);

    try {
      const feedbacksRef = collection(db, 'feedbacks');
      const q = query(feedbacksRef, where('quizId', '==', quiz.id));
      const snapshot = await getDocs(q);

      const feedbackList: any[] = [];
      snapshot.forEach((docSnapshot) => {
        feedbackList.push({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        });
      });

      setFeedbacks(feedbackList);
    } catch (error) {
      console.error('피드백 불러오기 실패:', error);
    } finally {
      setIsLoadingFeedbacks(false);
    }
  };

  /**
   * 업데이트 모달 열기
   */
  const handleOpenUpdateModal = useCallback(async (quiz: QuizCardData) => {
    const updateInfo = await checkQuizUpdate(quiz.id);
    if (updateInfo?.hasUpdate) {
      setUpdateModalInfo(updateInfo);
      setUpdateModalQuizCount(quiz.questionCount);
    } else {
      alert('업데이트할 문제가 없습니다.');
    }
  }, [checkQuizUpdate]);

  /**
   * 업데이트 완료 핸들러
   */
  const handleUpdateComplete = useCallback((newScore: number, newCorrectCount: number) => {
    // 퀴즈 목록 새로고침
    fetchQuizzes();
    refreshUpdates();
  }, [fetchQuizzes, refreshUpdates]);

  // 관리 모드 UI
  if (isManageMode) {
    return (
      <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
        {/* 헤더 - 리본 이미지 */}
        <header className="pt-6 pb-4 flex flex-col items-center">
          {/* 리본 이미지 */}
          <div className="relative w-full px-4 h-32 sm:h-44 md:h-56 mb-4 overflow-visible">
            <Image
              src={ribbonImage}
              alt="Quiz"
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 768px) 80vw, 60vw"
              className="object-contain"
              style={{ transform: `scale(${ribbonScale}) translateY(${ribbonOffsetY}px)` }}
              priority
            />
          </div>

          {/* 필터 + 버튼 영역 */}
          <div className="w-full px-4 flex items-center justify-between gap-4">
            <SlideFilter
              activeFilter={activeFilter}
              onFilterChange={(filter) => {
                setActiveFilter(filter);
                // 다른 필터 선택 시 관리 모드 종료
                if (filter !== 'custom') {
                  setIsManageMode(false);
                }
              }}
            />

            <div className="flex gap-2">
              <button
                onClick={() => setIsManageMode(false)}
                className="px-4 py-3 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors"
              >
                목록
              </button>
              <button
                onClick={() => router.push('/quiz/create')}
                className="px-4 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#3A3A3A] transition-colors"
              >
                퀴즈 만들기
              </button>
            </div>
          </div>
        </header>

        {/* 관리 제목 */}
        <div className="px-4 py-3 border-b border-[#EDEAE4]">
          <h2 className="text-lg font-bold text-[#1A1A1A]">내가 만든 퀴즈</h2>
          <p className="text-xs text-[#5C5C5C]">수정, 삭제, 피드백 확인이 가능합니다.</p>
        </div>

        <main className="px-4 py-4">
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
              <h3 className="font-bold text-lg mb-2 text-[#1A1A1A]">
                아직 만든 퀴즈가 없습니다
              </h3>
              <p className="text-sm text-[#5C5C5C] mb-4">
                첫 번째 퀴즈를 만들어보세요!
              </p>
              <button
                onClick={() => router.push('/quiz/create')}
                className="px-6 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold"
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
                  onDelete={() => handleDeleteQuiz(quiz.id)}
                  onFeedback={() => handleViewFeedback(quiz)}
                  onStats={() => setStatsQuiz(quiz)}
                />
              ))}
            </div>
          )}
        </main>

        {/* 피드백 모달 */}
        {feedbackQuiz && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => {
              setFeedbackQuiz(null);
              setFeedbacks([]);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-[#F5F0E8] border-2 border-[#1A1A1A] max-h-[80vh] overflow-visible flex flex-col"
            >
              <div className="p-4 border-b border-[#1A1A1A]">
                <h2 className="text-lg font-bold text-[#1A1A1A]">피드백</h2>
                <p className="text-sm text-[#5C5C5C]">{feedbackQuiz.title}</p>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {isLoadingFeedbacks && (
                  <div className="py-8 text-center">
                    <p className="text-[#5C5C5C]">로딩 중...</p>
                  </div>
                )}

                {!isLoadingFeedbacks && feedbacks.length === 0 && (
                  <div className="py-8 text-center">
                    <p className="text-[#5C5C5C]">아직 피드백이 없습니다.</p>
                  </div>
                )}

                {!isLoadingFeedbacks && feedbacks.length > 0 && (
                  <div className="space-y-3">
                    {feedbacks.map((feedback) => {
                      // 피드백 타입 한글 변환
                      const typeLabels: Record<string, string> = {
                        unclear: '문제가 이해가 안 돼요',
                        wrong: '정답이 틀린 것 같아요',
                        typo: '오타가 있어요',
                        other: '기타 의견',
                      };
                      const typeLabel = typeLabels[feedback.feedbackType] || feedback.feedbackType;

                      return (
                        <div
                          key={feedback.id}
                          className="p-3 border border-[#1A1A1A] bg-[#EDEAE4]"
                        >
                          <p className="text-xs text-[#5C5C5C] mb-1">
                            문제 {feedback.questionId}
                          </p>
                          <p className="text-xs font-bold text-[#8B6914] mb-1">
                            {typeLabel}
                          </p>
                          {feedback.feedback && (
                            <p className="text-sm text-[#1A1A1A]">
                              {feedback.feedback}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-[#1A1A1A]">
                <button
                  onClick={() => {
                    setFeedbackQuiz(null);
                    setFeedbacks([]);
                  }}
                  className="w-full py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4]"
                >
                  닫기
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* 통계 모달 */}
        {statsQuiz && (
          <QuizStatsModal
            quizId={statsQuiz.id}
            quizTitle={statsQuiz.title}
            isOpen={true}
            onClose={() => setStatsQuiz(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 - 리본 이미지 */}
      <header className="pt-6 pb-4 flex flex-col items-center">
        {/* 리본 이미지 */}
        <div className="relative w-full px-4 h-32 sm:h-44 md:h-56 mb-4 overflow-visible">
          <Image
            src={ribbonImage}
            alt="Quiz"
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 80vw, 60vw"
            className="object-contain"
            style={{ transform: `scale(${ribbonScale}) translateY(${ribbonOffsetY}px)` }}
            priority
          />
        </div>

        {/* 필터 + 버튼 영역 */}
        <div className="w-full px-4 flex items-center justify-between gap-4">
          {/* 슬라이드 필터 - 좌측 */}
          <SlideFilter
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
          />

          {/* 버튼 영역 - 우측 */}
          <div className="flex gap-2">
            {/* 퀴즈 관리 버튼 - 제작 필터에서만 표시 */}
            {activeFilter === 'custom' && (
              <button
                onClick={() => setIsManageMode(true)}
                className="px-4 py-3 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors"
              >
                퀴즈 관리
              </button>
            )}
            <button
              onClick={() => router.push('/quiz/create')}
              className="px-4 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#3A3A3A] transition-colors"
            >
              퀴즈 만들기
            </button>
          </div>
        </div>
      </header>

      <main className="px-4">
        {/* 로딩 스켈레톤 */}
        {isLoading && (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* 빈 상태 - 화면 중앙 배치 */}
        {!isLoading && quizzes.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center text-center"
            style={{ minHeight: 'calc(100vh - 280px)' }}
          >
            <h3 className="font-serif-display text-xl font-black mb-2 text-[#1A1A1A]">
              {activeFilter === 'custom' ? '아직 만든 퀴즈가 없습니다' : '아직 퀴즈가 없습니다'}
            </h3>
            <p className="text-sm text-[#3A3A3A]">
              {activeFilter === 'custom' ? '첫 번째 퀴즈를 만들어보세요!' : '새로운 퀴즈가 곧 추가됩니다.'}
            </p>
          </motion.div>
        )}

        {/* 퀴즈 그리드 (3열) */}
        {!isLoading && quizzes.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {quizzes.map((quiz, index) => (
              <motion.div
                key={quiz.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
              >
                <QuizCard
                  quiz={quiz}
                  onStart={() => handleStartQuiz(quiz.id)}
                  onDetails={() => handleShowDetails(quiz)}
                  isBookmarked={isBookmarked(quiz.id)}
                  onToggleBookmark={() => toggleBookmark(quiz.id)}
                  onUpdate={() => handleOpenUpdateModal(quiz)}
                />
              </motion.div>
            ))}
          </div>
        )}
      </main>

      {/* 퀴즈 상세 모달 */}
      {selectedQuiz && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setSelectedQuiz(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            <h2 className="text-lg font-bold text-[#1A1A1A] mb-4">{selectedQuiz.title}</h2>

            <div className="space-y-2 mb-6">
              <p className="text-sm text-[#5C5C5C]">
                문제 수: <span className="font-bold text-[#1A1A1A]">{selectedQuiz.questionCount}문제</span>
              </p>
              <p className="text-sm text-[#5C5C5C]">
                참여자: <span className="font-bold text-[#1A1A1A]">{selectedQuiz.participantCount}명</span>
              </p>
              {selectedQuiz.myScore !== undefined && (
                <p className="text-sm text-[#5C5C5C]">
                  내 점수: <span className="font-bold text-[#1A1A1A]">{selectedQuiz.myScore}점</span>
                </p>
              )}
              {selectedQuiz.creatorNickname && (
                <p className="text-sm text-[#5C5C5C]">
                  제작자: <span className="font-bold text-[#1A1A1A]">
                    {selectedQuiz.creatorNickname}·{selectedQuiz.creatorClassType || '?'}반
                  </span>
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setSelectedQuiz(null)}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  setSelectedQuiz(null);
                  handleStartQuiz(selectedQuiz.id);
                }}
                className="flex-1 py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
              >
                시작하기
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
    </div>
  );
}
