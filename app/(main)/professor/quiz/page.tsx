'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/common';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts';
import { COURSES, type CourseId, getDefaultQuizTab, getPastExamOptions, type PastExamOption } from '@/lib/types/course';
import { useProfessorQuiz, type ProfessorQuiz, type QuizTypeFilter } from '@/lib/hooks/useProfessorQuiz';
import { calcFeedbackScore, getFeedbackLabel } from '@/lib/utils/feedbackScore';
import { generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';
import QuizStatsModal from '@/components/quiz/manage/QuizStatsModal';
import ProfessorLibraryTab from '@/components/professor/library/ProfessorLibraryTab';
import { useCustomFolders } from '@/lib/hooks/useCustomFolders';
import type { FeedbackType } from '@/components/quiz/InstantFeedbackButton';

// ============================================================
// 타입
// ============================================================

interface QuizFeedbackInfo {
  quizId: string;
  score: number;
  count: number;
}

// ============================================================
// 상수
// ============================================================

const NEWS_CARDS: { type: QuizTypeFilter; title: string; subtitle: string }[] = [
  { type: 'midterm', title: 'MIDTERM PREP', subtitle: 'Vol.1 · Midterm Edition' },
  { type: 'past', title: 'PAST EXAM', subtitle: 'Official Archive' },
  { type: 'final', title: 'FINAL PREP', subtitle: 'Vol.2 · Final Edition' },
];

// 캐러셀 위치 저장 키
const PROF_QUIZ_CAROUSEL_KEY = 'prof-quiz-carousel-index';
// 캐러셀 내 스크롤 위치 저장 키 (타입별)
const PROF_QUIZ_SCROLL_KEY = (type: string) => `prof-quiz-scroll-${type}`;

const COURSE_IDS: CourseId[] = ['biology', 'microbiology', 'pathophysiology'];

// 신문 배경 텍스트
const NEWSPAPER_BG_TEXT = `The cell membrane, also known as the plasma membrane, is a biological membrane that separates and protects the interior of all cells from the outside environment. The cell membrane consists of a lipid bilayer, including cholesterols that sit between phospholipids to maintain their fluidity at various temperatures. The membrane also contains membrane proteins, including integral proteins that span the membrane serving as membrane transporters, and peripheral proteins that loosely attach to the outer side of the cell membrane, acting as enzymes to facilitate interaction with the cell's environment.`;


// 난이도별 비디오 경로
function getDifficultyVideo(difficulty: string): string {
  switch (difficulty) {
    case 'easy': return '/videos/difficulty-easy.mp4';
    case 'hard': return '/videos/difficulty-hard.mp4';
    default: return '/videos/difficulty-normal.mp4';
  }
}

// 자동재생 비디오 — 탭 전환 시에도 안정적으로 재생
function AutoVideo({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.play().catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === 'visible') el.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [src]);

  return (
    <video
      ref={ref}
      autoPlay
      loop
      muted
      playsInline
      className={className}
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}

// ============================================================
// 뉴스 기사 컴포넌트 (교수용 — 난이도 이미지 + 왼쪽 정렬)
// ============================================================

function ProfessorNewsArticle({
  quiz,
  onDetails,
  onStats,
  onPublish,
}: {
  quiz: ProfessorQuiz;
  onDetails: () => void;
  onStats: () => void;
  onPublish?: () => void;
}) {
  return (
    <div className="h-full flex flex-col">
      {/* 난이도 비디오 — 남은 공간 전부 채움 */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <AutoVideo src={getDifficultyVideo(quiz.difficulty)} className="absolute inset-0 w-full h-full object-cover" />
      </div>

      {/* 하단 정보 — 고정 높이, 절대 줄어들지 않음 */}
      <div className="flex-shrink-0">
        <div className="px-4 mt-2">
          <h3 className="text-3xl font-black text-[#1A1A1A] overflow-hidden whitespace-nowrap leading-tight" style={{ textOverflow: '".."' }}>
            {quiz.title}
          </h3>
        </div>
        <div className="px-4 mt-0.5 flex items-center justify-between">
          <p className="text-sm text-[#1A1A1A]">
            {quiz.questionCount}문제 · {quiz.participantCount}명 참여
            {quiz.participantCount > 0 && ` · 평균 ${quiz.averageScore}점`}
          </p>
          {!quiz.isPublished ? (
            <button
              onClick={(e) => { e.stopPropagation(); onPublish?.(); }}
              className="w-5 h-5 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] hover:scale-110 transition-all flex-shrink-0"
              title="비공개 — 클릭하여 공개"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </button>
          ) : (
            <span className="w-5 h-5 flex items-center justify-center text-[#5C5C5C] flex-shrink-0" title="공개됨">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
              </svg>
            </span>
          )}
        </div>
        <div className="px-4 pb-3 pt-2 flex gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDetails(); }}
            className="flex-1 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
          >
            Details
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStats(); }}
            className={`flex-1 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] transition-colors ${
              !quiz.isPublished ? 'opacity-40 pointer-events-none' : 'hover:bg-[#3A3A3A]'
            }`}
          >
            Stats
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 뉴스 카드 컴포넌트 (교수용)
// ============================================================

function ProfessorNewsCard({
  title,
  subtitle,
  type,
  quizzes,
  isLoading,
  onDetails,
  onStats,
  onPublish,
}: {
  title: string;
  subtitle: string;
  type: QuizTypeFilter;
  quizzes: ProfessorQuiz[];
  isLoading: boolean;
  onDetails: (quiz: ProfessorQuiz) => void;
  onStats: (quiz: ProfessorQuiz) => void;
  onPublish?: (quizId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [itemHeight, setItemHeight] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setItemHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 스크롤 위치 복원
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !itemHeight || isLoading || quizzes.length === 0) return;
    const saved = sessionStorage.getItem(PROF_QUIZ_SCROLL_KEY(type));
    if (saved) el.scrollTop = parseInt(saved, 10);
  }, [type, itemHeight, isLoading, quizzes.length]);

  // 스크롤 위치 저장
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      sessionStorage.setItem(PROF_QUIZ_SCROLL_KEY(type), String(el.scrollTop));
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [type]);

  return (
    <div className="w-full h-full border-4 border-[#1A1A1A] bg-[#1A1A1A] flex flex-col overflow-hidden">
      {/* 축소된 헤더 */}
      <div className="bg-[#1A1A1A] text-[#F5F0E8] px-4 py-2 text-center flex-shrink-0">
        <h1 className="font-serif text-lg font-black tracking-tight">{title}</h1>
        <p className="text-[9px] tracking-widest">{subtitle}</p>
      </div>

      {/* 퀴즈 목록 — 자유 스크롤, 각 아이템 px 높이로 고정 */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[#F5F0E8]" data-scroll-inner>
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-pulse text-[#5C5C5C]">로딩 중...</div>
          </div>
        ) : quizzes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <h3 className="font-bold text-lg mb-2 text-[#1A1A1A]">퀴즈가 없습니다</h3>
            <p className="text-sm text-[#5C5C5C]">아직 출제한 퀴즈가 없습니다.</p>
          </div>
        ) : (
          quizzes.map((quiz) => (
            <div key={quiz.id} style={itemHeight ? { height: itemHeight } : undefined}>
              <ProfessorNewsArticle
                quiz={quiz}
                onDetails={() => onDetails(quiz)}
                onStats={() => onStats(quiz)}
                onPublish={() => onPublish?.(quiz.id)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================
// 기출 전용 뉴스 카드 (학생과 동일한 드롭다운 스타일)
// ============================================================

function ProfessorPastExamNewsCard({
  quizzes,
  isLoading,
  onDetails,
  onStats,
  onPublish,
  selectedPastExam,
  pastExamOptions,
  onSelectPastExam,
}: {
  quizzes: ProfessorQuiz[];
  isLoading: boolean;
  onDetails: (quiz: ProfessorQuiz) => void;
  onStats: (quiz: ProfessorQuiz) => void;
  onPublish?: (quizId: string) => void;
  selectedPastExam: string;
  pastExamOptions: PastExamOption[];
  onSelectPastExam: (value: string) => void;
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const selectedOption = pastExamOptions.find((opt) => opt.value === selectedPastExam);

  // 선택된 년도/시험으로 필터링
  const [yearStr, examType] = selectedPastExam.split('-');
  const year = parseInt(yearStr, 10);
  const filteredQuiz = quizzes.find(
    (q) => q.pastYear === year && q.pastExamType === examType
  ) || null;

  return (
    <div className="w-full h-full border-4 border-[#1A1A1A] bg-[#1A1A1A] flex flex-col overflow-hidden">
      {/* 축소된 헤더 + 드롭다운 — 수직 중앙 정렬 */}
      <div className="bg-[#1A1A1A] text-[#F5F0E8] px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div>
          <p className="text-[7px] tracking-[0.2em] mb-0.5 opacity-60">━━━━━━━━━━━━━━━━</p>
          <h1 className="font-serif text-xl font-black tracking-tight">PAST EXAM</h1>
        </div>

        {/* 드롭다운 — 터치 이벤트 캐러셀 전파 차단 */}
        <div className="relative" onPointerDownCapture={(e) => e.stopPropagation()}>
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="px-3 py-1.5 bg-[#F5F0E8] text-[#1A1A1A] text-sm font-bold flex items-center justify-between gap-2 min-w-[100px]"
          >
            <span>{selectedOption?.label || '선택'}</span>
            <svg
              className={`w-3 h-3 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>

          <AnimatePresence>
            {isDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)} onPointerDownCapture={(e) => e.stopPropagation()} />
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute right-0 top-full mt-1 z-20 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg min-w-[100px]"
                >
                  {pastExamOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        onSelectPastExam(option.value);
                        setIsDropdownOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left text-sm font-medium transition-colors ${
                        selectedPastExam === option.value
                          ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                          : 'text-[#1A1A1A] hover:bg-[#EDEAE4]'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 기출 내용 — 넓은 레이아웃 (단일 퀴즈) */}
      <div className="flex-1 overflow-y-auto" data-scroll-inner>
        {isLoading ? (
          <div className="flex items-center justify-center h-full bg-[#F5F0E8]">
            <div className="animate-pulse text-[#5C5C5C]">로딩 중...</div>
          </div>
        ) : !filteredQuiz ? (
          <div className="flex flex-col items-center justify-center h-full text-center bg-[#F5F0E8]">
            <h3 className="font-bold text-lg mb-2 text-[#1A1A1A]">기출문제가 없습니다</h3>
            <p className="text-sm text-[#5C5C5C]">해당 시험의 기출문제가 아직 등록되지 않았습니다.</p>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* 난이도 비디오 — 전체 너비, 크게 */}
            <div className="flex-1 min-h-0 relative overflow-hidden">
              <AutoVideo src={getDifficultyVideo(filteredQuiz.difficulty)} className="absolute inset-0 w-full h-full object-cover" />
            </div>

            {/* 하단 정보 — 고정, 절대 줄어들지 않음 */}
            <div className="flex-shrink-0 bg-[#F5F0E8]">
              <div className="px-4 mt-2">
                <h3 className="text-3xl font-black text-[#1A1A1A] overflow-hidden whitespace-nowrap leading-tight" style={{ textOverflow: '".."' }}>
                  {filteredQuiz.title}
                </h3>
              </div>
              <div className="px-4 mt-0.5 flex items-center justify-between">
                <p className="text-sm text-[#1A1A1A]">
                  {filteredQuiz.questionCount}문제 · {filteredQuiz.participantCount}명 참여
                  {filteredQuiz.participantCount > 0 && ` · 평균 ${filteredQuiz.averageScore}점`}
                </p>
                {!filteredQuiz.isPublished ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onPublish?.(filteredQuiz.id); }}
                    className="w-5 h-5 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] hover:scale-110 transition-all flex-shrink-0"
                    title="비공개 — 클릭하여 공개"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </button>
                ) : (
                  <span className="w-5 h-5 flex items-center justify-center text-[#5C5C5C] flex-shrink-0" title="공개됨">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
                    </svg>
                  </span>
                )}
              </div>
              <div className="px-4 pb-3 pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDetails(filteredQuiz); }}
                  className="flex-1 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                >
                  Details
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onStats(filteredQuiz); }}
                  className={`flex-1 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] transition-colors ${
                    !filteredQuiz.isPublished ? 'opacity-40 pointer-events-none' : 'hover:bg-[#3A3A3A]'
                  }`}
                >
                  Stats
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 뉴스 캐러셀 (학생과 동일한 3D perspective 효과)
// ============================================================

function getProfCarouselDefault(): number {
  if (typeof window !== 'undefined') {
    const saved = sessionStorage.getItem(PROF_QUIZ_CAROUSEL_KEY);
    if (saved !== null) return parseInt(saved, 10);
  }
  const tab = getDefaultQuizTab();
  if (tab === 'midterm') return 0;
  if (tab === 'past') return 1;
  if (tab === 'final') return 2;
  return 0;
}

function ProfessorNewsCarousel({
  midtermQuizzes,
  finalQuizzes,
  pastQuizzes,
  isLoading,
  onDetails,
  onStats,
  onPublish,
  selectedPastExam,
  pastExamOptions,
  onSelectPastExam,
}: {
  midtermQuizzes: ProfessorQuiz[];
  finalQuizzes: ProfessorQuiz[];
  pastQuizzes: ProfessorQuiz[];
  isLoading: { midterm: boolean; final: boolean; past: boolean };
  onDetails: (quiz: ProfessorQuiz) => void;
  onStats: (quiz: ProfessorQuiz) => void;
  onPublish?: (quizId: string) => void;
  selectedPastExam: string;
  pastExamOptions: PastExamOption[];
  onSelectPastExam: (value: string) => void;
}) {
  const TOTAL = NEWS_CARDS.length; // 3
  // visualIndex: 0=clone_last, 1~3=real cards, 4=clone_first
  const [visualIndex, setVisualIndex] = useState(() => getProfCarouselDefault() + 1);
  const [transitionOn, setTransitionOn] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  // 카드별 래퍼 ref (클론 스크롤 동기화용)
  const cardWrapperRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 실제 인덱스 (0~2)
  const realIndex = useMemo(() => {
    if (visualIndex <= 0) return TOTAL - 1;
    if (visualIndex > TOTAL) return 0;
    return visualIndex - 1;
  }, [visualIndex, TOTAL]);

  // sessionStorage 저장
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(PROF_QUIZ_CAROUSEL_KEY, String(realIndex));
    }
  }, [realIndex]);

  // 클론 카드 스크롤을 실제 카드와 동기화
  const syncCloneScroll = useCallback(() => {
    const refs = cardWrapperRefs.current;
    const getScroller = (el: HTMLDivElement | null) =>
      el?.querySelector<HTMLElement>('[data-scroll-inner]');
    // clone_last(0) ← real_last(TOTAL)
    const clone0 = getScroller(refs[0]);
    const realLast = getScroller(refs[TOTAL]);
    if (clone0 && realLast) clone0.scrollTop = realLast.scrollTop;
    // clone_first(TOTAL+1) ← real_first(1)
    const cloneEnd = getScroller(refs[TOTAL + 1]);
    const realFirst = getScroller(refs[1]);
    if (cloneEnd && realFirst) cloneEnd.scrollTop = realFirst.scrollTop;
  }, [TOTAL]);

  const goToNext = useCallback(() => {
    syncCloneScroll();
    setTransitionOn(true);
    setVisualIndex((prev) => prev + 1);
  }, [syncCloneScroll]);

  const goToPrev = useCallback(() => {
    syncCloneScroll();
    setTransitionOn(true);
    setVisualIndex((prev) => prev - 1);
  }, [syncCloneScroll]);

  // 터치 스와이프로 카드 전환 (세로 스크롤 허용)
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeLocked = useRef<'none' | 'horizontal' | 'vertical'>('none');

  const handleTouchStart = (e: React.TouchEvent) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
    swipeLocked.current = 'none';
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (swipeLocked.current !== 'none') return;
    const dx = Math.abs(e.touches[0].clientX - swipeStartX.current);
    const dy = Math.abs(e.touches[0].clientY - swipeStartY.current);
    if (dx > 10 || dy > 10) {
      swipeLocked.current = dx > dy ? 'horizontal' : 'vertical';
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (swipeLocked.current === 'vertical') return;
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    if (Math.abs(dx) > 40) {
      if (dx > 0) goToPrev();
      else goToNext();
    }
  };

  // PC 마우스 드래그로 카드 전환
  const mouseStartX = useRef(0);
  const isMouseDown = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseStartX.current = e.clientX;
    isMouseDown.current = true;
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isMouseDown.current) return;
    isMouseDown.current = false;
    const dx = e.clientX - mouseStartX.current;
    if (Math.abs(dx) > 40) {
      if (dx > 0) goToPrev();
      else goToNext();
    }
  };

  const handleMouseLeave = () => { isMouseDown.current = false; };

  // 클론 위치 도달 시 → 즉시 실제 위치로 점프 (애니메이션 없이)
  const handleAnimationComplete = useCallback(() => {
    if (visualIndex === 0) {
      setTransitionOn(false);
      setVisualIndex(TOTAL);
      requestAnimationFrame(() => requestAnimationFrame(() => setTransitionOn(true)));
    } else if (visualIndex === TOTAL + 1) {
      setTransitionOn(false);
      setVisualIndex(1);
      requestAnimationFrame(() => requestAnimationFrame(() => setTransitionOn(true)));
    }
  }, [visualIndex, TOTAL]);

  // 확장 카드: [clone_last, card_0, card_1, card_2, clone_first]
  const extendedCardIndices = useMemo(
    () => [TOTAL - 1, ...Array.from({ length: TOTAL }, (_, i) => i), 0],
    [TOTAL]
  );

  // 순서: midterm(0), past(1), final(2)
  const quizzesByType = [midtermQuizzes, pastQuizzes, finalQuizzes];
  const loadingByType = [isLoading.midterm, isLoading.past, isLoading.final];

  const CARD_WIDTH_PERCENT = 82;
  const SIDE_PEEK_PERCENT = (100 - CARD_WIDTH_PERCENT) / 2;

  return (
    <div
      className="relative select-none cursor-grab active:cursor-grabbing"
      style={{ perspective: 1200, touchAction: 'pan-y' }}
      data-no-pull
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <div ref={containerRef} className="overflow-x-clip overflow-y-visible">
        <motion.div
          className="flex"
          initial={false}
          animate={{
            x: `calc(-${visualIndex * CARD_WIDTH_PERCENT}% + ${SIDE_PEEK_PERCENT}%)`,
          }}
          transition={
            transitionOn
              ? { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }
              : { duration: 0 }
          }
          onAnimationComplete={handleAnimationComplete}
        >
          {extendedCardIndices.map((cardIdx, i) => {
            const card = NEWS_CARDS[cardIdx];
            const isActive = i === visualIndex;
            const offset = i - visualIndex;

            return (
              <motion.div
                key={`${card.type}-${i}`}
                ref={(el: HTMLDivElement | null) => { cardWrapperRefs.current[i] = el; }}
                className="flex-shrink-0 px-1.5"
                style={{ width: `${CARD_WIDTH_PERCENT}%` }}
              >
                {/* 카드 + 바닥 그림자 */}
                <div className="relative h-[440px]">
                  {/* 바닥 그림자 — 지면에 드리워지는 타원 */}
                  <motion.div
                    animate={{
                      opacity: isActive ? 0.25 : 0.06,
                      scaleX: isActive ? 0.92 : 0.82,
                    }}
                    transition={transitionOn ? { duration: 0.35, ease: 'easeOut' } : { duration: 0 }}
                    className="absolute left-[2%] right-[2%] -bottom-2 h-8 rounded-[50%] bg-black pointer-events-none"
                    style={{ filter: 'blur(16px)' }}
                  />
                  {/* 카드 본체 */}
                  <motion.div
                    animate={{
                      rotateY: isActive ? 0 : offset < 0 ? 4 : -4,
                      scale: isActive ? 1 : 0.92,
                      opacity: isActive ? 1 : 0.85,
                      y: isActive ? -10 : 2,
                    }}
                    transition={transitionOn ? { duration: 0.35, ease: 'easeOut' } : { duration: 0 }}
                    className="absolute inset-0 origin-center rounded-sm"
                    style={{ transformStyle: 'preserve-3d' }}
                  >
                  {card.type === 'past' ? (
                    <ProfessorPastExamNewsCard
                      quizzes={pastQuizzes}
                      isLoading={loadingByType[cardIdx]}
                      onDetails={onDetails}
                      onStats={onStats}
                      onPublish={onPublish}
                      selectedPastExam={selectedPastExam}
                      pastExamOptions={pastExamOptions}
                      onSelectPastExam={onSelectPastExam}
                    />
                  ) : (
                    <ProfessorNewsCard
                      title={card.title}
                      subtitle={card.subtitle}
                      type={card.type}
                      quizzes={quizzesByType[cardIdx]}
                      isLoading={loadingByType[cardIdx]}
                      onDetails={onDetails}
                      onStats={onStats}
                      onPublish={onPublish}
                    />
                  )}
                  </motion.div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* 인디케이터 — realIndex 기반 */}
      <div className="relative z-10 flex justify-center gap-2 mt-1">
        {Array.from({ length: TOTAL }, (_, index) => (
          <button
            key={index}
            onClick={() => {
              setTransitionOn(true);
              setVisualIndex(index + 1);
            }}
            className={`h-2 rounded-full transition-all duration-300 ${
              realIndex === index ? 'bg-[#1A1A1A] w-5' : 'bg-[#CCCCCC] w-2'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 과목 리본 스와이프 헤더
// ============================================================

function CourseRibbonHeader({
  currentCourseId,
  onCourseChange,
}: {
  currentCourseId: CourseId;
  onCourseChange: (courseId: CourseId) => void;
}) {
  const currentIndex = COURSE_IDS.indexOf(currentCourseId);
  const course = COURSES[currentCourseId];
  const ribbonImage = course?.quizRibbonImage || '/images/biology-quiz-ribbon.png';
  const ribbonScale = course?.quizRibbonScale || 1;

  const goToPrev = () => {
    const prevIdx = (currentIndex - 1 + COURSE_IDS.length) % COURSE_IDS.length;
    onCourseChange(COURSE_IDS[prevIdx]);
  };

  const goToNext = () => {
    const nextIdx = (currentIndex + 1) % COURSE_IDS.length;
    onCourseChange(COURSE_IDS[nextIdx]);
  };

  // 터치 + 마우스 드래그 스와이프 (세로 스크롤 허용)
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeDir = useRef<'none' | 'horizontal' | 'vertical'>('none');

  const handleTouchStart = (e: React.TouchEvent) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
    swipeDir.current = 'none';
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (swipeDir.current !== 'none') return; // 방향 판별 이후는 touchMove에서 처리
    const touch = e.changedTouches[0];
    const dx = touch.clientX - swipeStartX.current;
    const dy = touch.clientY - swipeStartY.current;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
      if (dx > 0) goToPrev();
      else goToNext();
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (swipeDir.current !== 'none') return;
    const dx = Math.abs(e.touches[0].clientX - swipeStartX.current);
    const dy = Math.abs(e.touches[0].clientY - swipeStartY.current);
    if (dx > 10 || dy > 10) {
      swipeDir.current = dx > dy ? 'horizontal' : 'vertical';
    }
  };

  // PC 마우스 드래그
  const mouseStartX = useRef(0);
  const isMouseDragging = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseStartX.current = e.clientX;
    isMouseDragging.current = true;
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isMouseDragging.current) return;
    isMouseDragging.current = false;
    const diff = e.clientX - mouseStartX.current;
    if (diff > 40) goToPrev();
    else if (diff < -40) goToNext();
  };

  return (
    <div className="flex flex-col items-center">
      {/* 리본 이미지 — 터치/마우스 드래그로 과목 전환 */}
      <div
        className="w-full h-[260px] pt-2 cursor-grab active:cursor-grabbing select-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        data-no-pull
        style={{ touchAction: 'pan-y' }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={currentCourseId}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.2 }}
            className="w-full h-full"
          >
            <img
              src={ribbonImage}
              alt={course?.name || 'Quiz'}
              className="w-full h-full object-contain pointer-events-none"
              style={{ transform: `scale(${ribbonScale}) scaleX(1.15)` }}
              draggable={false}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 페이지네이션 도트 */}
      <div className="flex justify-center gap-2 mt-1">
        {COURSE_IDS.map((id, idx) => (
          <button
            key={id}
            onClick={() => onCourseChange(id)}
            className={`w-2 h-2 rounded-full transition-all ${
              idx === currentIndex ? 'bg-[#1A1A1A] w-4' : 'bg-[#CCCCCC]'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 자작 퀴즈 카드 (학생 CustomQuizCard 스타일)
// ============================================================

function ProfessorCustomQuizCard({
  quiz,
  feedbackInfo,
  onStats,
  onDetails,
  onClick,
}: {
  quiz: ProfessorQuiz;
  feedbackInfo?: QuizFeedbackInfo;
  onStats: () => void;
  onDetails: () => void;
  onClick: () => void;
}) {
  const fbLabel = feedbackInfo ? getFeedbackLabel(feedbackInfo.score) : null;

  return (
    <motion.div
      whileHover={{ y: -4, boxShadow: '0 8px 25px rgba(26, 26, 26, 0.15)' }}
      transition={{ duration: 0.2 }}
      className="relative border border-[#1A1A1A] bg-[#F5F0E8] overflow-hidden shadow-md cursor-pointer"
      onClick={onClick}
    >
      {/* 신문 배경 텍스트 */}
      <div className="absolute inset-0 p-2 overflow-hidden pointer-events-none">
        <p className="text-[5px] text-[#E8E8E8] leading-tight break-words">
          {NEWSPAPER_BG_TEXT.slice(0, 300)}
        </p>
      </div>

      {/* 비공개 + 반 뱃지 */}
      <div className="absolute top-2 right-2 z-30 flex items-center gap-1">
        {quiz.targetClass !== 'all' && (
          <span className="text-[10px] px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] font-medium">
            {quiz.targetClass}반
          </span>
        )}
        {!quiz.isPublished && (
          <span className="text-[10px] text-[#8B1A1A] border border-[#8B1A1A] px-1.5 py-0.5 bg-[#F5F0E8]">
            비공개
          </span>
        )}
      </div>

      {/* 카드 내용 */}
      <div className="relative z-10 p-4 bg-[#F5F0E8]/90">
        {/* 제목 (2줄 고정 높이) */}
        <div className="h-[44px] mb-2">
          <h3 className="font-bold text-base line-clamp-2 text-[#1A1A1A] pr-6 leading-snug">
            {quiz.title}
          </h3>
        </div>

        {/* 메타 정보 */}
        <p className="text-sm text-[#5C5C5C] mb-1">
          {quiz.questionCount}문제 · {quiz.participantCount}명 참여
          {quiz.participantCount > 0 && ` · 평균 ${quiz.averageScore}점`}
        </p>

        {/* 태그 (2줄 고정 높이) */}
        <div className="h-[48px] mb-2 overflow-hidden">
          {quiz.tags && quiz.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {quiz.tags.slice(0, 8).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-medium"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 버튼 */}
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDetails();
            }}
            className="flex-1 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
          >
            Details
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStats();
            }}
            className="flex-1 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
          >
            Stats
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================
// 스켈레톤 카드
// ============================================================

function SkeletonCard() {
  return (
    <div className="border border-[#1A1A1A] bg-[#F5F0E8] p-4 shadow-md">
      <Skeleton className="w-3/4 h-4 mb-2 rounded-none" />
      <Skeleton className="w-1/2 h-3 mb-3 rounded-none" />
      <div className="flex gap-2">
        <Skeleton className="flex-1 h-8 rounded-none" />
        <Skeleton className="flex-1 h-8 rounded-none" />
      </div>
    </div>
  );
}

// ============================================================
// 메인 페이지
// ============================================================

export default function ProfessorQuizListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { userCourseId, setProfessorCourse } = useCourse();

  // 과목별 퀴즈 로드용 인스턴스 3개 (중간/기말/기출 캐러셀)
  const midtermHook = useProfessorQuiz();
  const finalHook = useProfessorQuiz();
  const pastHook = useProfessorQuiz();

  // 섹션 필터 (자작/서재/커스텀) — sessionStorage로 유지
  const [sectionFilter, setSectionFilter] = useState<'custom' | 'library' | 'folder'>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('prof_quiz_section_filter');
      if (saved === 'custom' || saved === 'library' || saved === 'folder') return saved;
    }
    return 'custom';
  });

  // 필터 변경 시 sessionStorage에 저장
  useEffect(() => {
    sessionStorage.setItem('prof_quiz_section_filter', sectionFilter);
  }, [sectionFilter]);

  // 서재 탭 인라인 프리뷰 모드
  const [isLibraryPreview, setIsLibraryPreview] = useState(false);

  // 자작 섹션 (type: 'custom' 퀴즈, 학생과 동일한 데이터)
  const [customLoading, setCustomLoading] = useState(true);
  const [customError, setCustomError] = useState<string | null>(null);

  // 태그 검색
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showTagFilter, setShowTagFilter] = useState(false);

  // 커스텀 폴더
  const { customFolders, createCustomFolder, deleteCustomFolder } = useCustomFolders();
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<{ id: string; name: string } | null>(null);

  const fixedTagOptions = useMemo(() => {
    const courseTags = generateCourseTags(userCourseId);
    return [...COMMON_TAGS.map(t => t.value), ...courseTags.map(t => t.value)];
  }, [userCourseId]);

  // 기출 드롭다운
  const pastExamOptions = useMemo(() => getPastExamOptions(userCourseId), [userCourseId]);
  const [selectedPastExam, setSelectedPastExam] = useState<string>(() => {
    const options = getPastExamOptions(userCourseId);
    return options.length > 0 ? options[0].value : '2025-midterm';
  });

  // 공개 전환 모달
  const [publishConfirmQuizId, setPublishConfirmQuizId] = useState<string | null>(null);
  const publishHook = useProfessorQuiz();

  // 스크롤 맨 위로 버튼
  const headerRef = useRef<HTMLElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowScrollTop(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // 피드백 점수 데이터
  const [feedbackMap, setFeedbackMap] = useState<Record<string, QuizFeedbackInfo>>({});

  // 중간/기말/기출 퀴즈 전체 로드 (과목 전환은 클라이언트 필터링)
  useEffect(() => {
    if (user?.uid) {
      midtermHook.fetchQuizzes(user.uid, { quizType: 'midterm', pageSize: 50 });
      finalHook.fetchQuizzes(user.uid, { quizType: 'final', pageSize: 50 });
      pastHook.fetchQuizzes(user.uid, { quizType: 'past', pageSize: 50 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // 과목별 클라이언트 사이드 필터링 (과목 전환 시 즉시 반영)
  const filteredMidterm = useMemo(() => {
    if (!userCourseId) return midtermHook.quizzes;
    return midtermHook.quizzes.filter(q => q.courseId === userCourseId);
  }, [midtermHook.quizzes, userCourseId]);

  const filteredFinal = useMemo(() => {
    if (!userCourseId) return finalHook.quizzes;
    return finalHook.quizzes.filter(q => q.courseId === userCourseId);
  }, [finalHook.quizzes, userCourseId]);

  const filteredPast = useMemo(() => {
    if (!userCourseId) return pastHook.quizzes;
    return pastHook.quizzes.filter(q => q.courseId === userCourseId);
  }, [pastHook.quizzes, userCourseId]);

  // 자작 퀴즈 전체 로드 (과목 전환은 클라이언트 필터링)
  const [allCustomQuizzes, setAllCustomQuizzes] = useState<ProfessorQuiz[]>([]);
  useEffect(() => {
    if (!user) return;

    setCustomLoading(true);
    setCustomError(null);

    const q = query(
      collection(db, 'quizzes'),
      where('type', '==', 'custom')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const quizzes: ProfessorQuiz[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        quizzes.push({
          id: docSnap.id,
          title: data.title || '',
          description: data.description,
          type: data.type,
          courseId: data.courseId,
          targetClass: data.targetClass || 'all',
          difficulty: data.difficulty || 'normal',
          isPublished: data.isPublished ?? true,
          questions: data.questions || [],
          questionCount: data.questionCount || 0,
          creatorUid: data.creatorUid || data.creatorId || '',
          creatorNickname: data.creatorNickname || '',
          participantCount: data.participantCount || 0,
          averageScore: data.averageScore || 0,
          feedbackCount: data.feedbackCount || 0,
          tags: data.tags || [],
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
        });
      });
      // 최신순 정렬
      quizzes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setAllCustomQuizzes(quizzes);
      setCustomLoading(false);
    }, (err) => {
      console.error('자작 퀴즈 로드 실패:', err);
      setCustomError('자작 퀴즈를 불러오는데 실패했습니다.');
      setCustomLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // 자작 퀴즈 과목별 필터링
  const customQuizzes = useMemo(() => {
    if (!userCourseId) return allCustomQuizzes;
    return allCustomQuizzes.filter(q => !q.courseId || q.courseId === userCourseId);
  }, [allCustomQuizzes, userCourseId]);

  // 과목 변경 시 태그 초기화
  useEffect(() => {
    setSelectedTags([]);
    setShowTagFilter(false);
  }, [userCourseId]);

  // 전체 퀴즈 목록 합산 (피드백 로드용 — 전체 데이터로 1회만 로드)
  const allQuizzes = useMemo(() => {
    const carouselQuizzes = [...midtermHook.quizzes, ...finalHook.quizzes, ...pastHook.quizzes];
    const ids = new Set(carouselQuizzes.map(q => q.id));
    const uniqueCustomQuizzes = allCustomQuizzes.filter(q => !ids.has(q.id));
    return [...carouselQuizzes, ...uniqueCustomQuizzes];
  }, [midtermHook.quizzes, finalHook.quizzes, pastHook.quizzes, allCustomQuizzes]);

  // 태그 필터링된 자작 퀴즈
  const filteredCustomQuizzes = useMemo(() => {
    if (selectedTags.length === 0) return customQuizzes;
    return customQuizzes.filter(quiz =>
      quiz.tags && selectedTags.some(tag => quiz.tags!.includes(tag))
    );
  }, [customQuizzes, selectedTags]);

  // 피드백 점수 실시간 구독
  useEffect(() => {
    if (allQuizzes.length === 0) {
      setFeedbackMap({});
      return;
    }

    const quizIds = allQuizzes.map(q => q.id);
    const unsubscribes: (() => void)[] = [];
    // 청크별 피드백 데이터 저장
    const chunkData: Record<number, { quizId: string; type: FeedbackType }[]> = {};

    const recalcFeedbackMap = () => {
      const byQuiz: Record<string, { type: FeedbackType }[]> = {};
      Object.values(chunkData).flat().forEach(({ quizId: qid, type }) => {
        if (!byQuiz[qid]) byQuiz[qid] = [];
        byQuiz[qid].push({ type });
      });

      const newMap: Record<string, QuizFeedbackInfo> = {};
      Object.entries(byQuiz).forEach(([qid, feedbacks]) => {
        newMap[qid] = {
          quizId: qid,
          score: calcFeedbackScore(feedbacks),
          count: feedbacks.length,
        };
      });
      setFeedbackMap(newMap);
    };

    for (let i = 0; i < quizIds.length; i += 30) {
      const chunkIdx = Math.floor(i / 30);
      const chunk = quizIds.slice(i, i + 30);
      const q = query(
        collection(db, 'questionFeedbacks'),
        where('quizId', 'in', chunk)
      );

      const unsub = onSnapshot(q, (snap) => {
        chunkData[chunkIdx] = snap.docs.map(d => {
          const data = d.data();
          return { quizId: data.quizId as string, type: data.type as FeedbackType };
        });
        recalcFeedbackMap();
      });
      unsubscribes.push(unsub);
    }

    return () => {
      unsubscribes.forEach(fn => fn());
    };
  }, [allQuizzes]);

  // Details 모달 상태
  const [detailsQuiz, setDetailsQuiz] = useState<ProfessorQuiz | null>(null);
  const [detailsSource, setDetailsSource] = useState<'carousel' | 'custom'>('carousel');
  // Stats 모달 상태
  const [statsQuizId, setStatsQuizId] = useState<{ id: string; title: string } | null>(null);

  // Details 모달 열릴 때 네비게이션 숨김 + 스크롤 완전 잠금
  useEffect(() => {
    if (detailsQuiz) {
      document.body.setAttribute('data-hide-nav', 'true');
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      return () => {
        document.body.removeAttribute('data-hide-nav');
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [detailsQuiz]);

  // 문제 유형 포맷
  const formatQuestionTypes = useCallback((quiz: ProfessorQuiz): string => {
    const questions = quiz.questions || [];
    let oxCount = 0;
    let multipleCount = 0;
    let subjectiveCount = 0;
    questions.forEach(q => {
      if (q.type === 'ox') oxCount++;
      else if (q.type === 'multiple') multipleCount++;
      else if (q.type === 'short_answer' || q.type === 'subjective' || q.type === 'essay') subjectiveCount++;
    });
    const parts: string[] = [];
    if (oxCount > 0) parts.push(`OX ${oxCount}`);
    if (multipleCount > 0) parts.push(`객관식 ${multipleCount}`);
    if (subjectiveCount > 0) parts.push(`주관식 ${subjectiveCount}`);
    return parts.length > 0 ? parts.join(' · ') : '-';
  }, []);

  // 캐러셀 내부 Details → 모달
  const handleCarouselDetails = useCallback(
    (quiz: ProfessorQuiz) => {
      setDetailsSource('carousel');
      setDetailsQuiz(quiz);
    },
    []
  );

  // 캐러셀 내부 Stats → 통계 모달 (비공개면 무시)
  const handleCarouselStats = useCallback(
    (quiz: ProfessorQuiz) => {
      if (!quiz.isPublished) return;
      setStatsQuizId({ id: quiz.id, title: quiz.title });
    },
    []
  );

  const handleCourseChange = useCallback(
    (courseId: CourseId) => {
      setProfessorCourse(courseId);
    },
    [setProfessorCourse]
  );

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 리본 헤더 — 과목 스와이프 전환 */}
      <header ref={headerRef} className="flex flex-col items-center">
        <CourseRibbonHeader
          currentCourseId={userCourseId || 'biology'}
          onCourseChange={handleCourseChange}
        />
      </header>

      {/* 뉴스 캐러셀 (중간/기말/기출) */}
      <section className="mt-6 mb-8 px-4">
        <ProfessorNewsCarousel
          midtermQuizzes={filteredMidterm}
          finalQuizzes={filteredFinal}
          pastQuizzes={filteredPast}
          isLoading={{
            midterm: midtermHook.loading,
            final: finalHook.loading,
            past: pastHook.loading,
          }}
          onDetails={handleCarouselDetails}
          onStats={handleCarouselStats}
          onPublish={(quizId) => setPublishConfirmQuizId(quizId)}
          selectedPastExam={selectedPastExam}
          pastExamOptions={pastExamOptions}
          onSelectPastExam={setSelectedPastExam}
        />
      </section>

      {/* 하단 섹션 */}
      <section className="px-4">
        {/* 필터 탭 (자작|서재|커스텀) + 퀴즈 만들기 / 뒤로가기 */}
        <div className="flex items-center justify-between mb-3">
          <div className="relative flex w-[252px] bg-[#EDEAE4] border border-[#1A1A1A] overflow-hidden">
            <motion.div
              className="absolute inset-y-0 bg-[#1A1A1A]"
              initial={false}
              animate={{ left: `${(['custom', 'library', 'folder'].indexOf(sectionFilter)) * (100 / 3)}%` }}
              style={{ width: `${100 / 3}%` }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
            {([
              { key: 'custom' as const, label: '자작' },
              { key: 'library' as const, label: '서재' },
              { key: 'folder' as const, label: '커스텀' },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => {
                  // 프리뷰 모드에서 다른 탭 클릭하면 프리뷰 해제
                  if (isLibraryPreview) setIsLibraryPreview(false);
                  setSectionFilter(key);
                }}
                className={`relative z-10 w-1/3 py-3 text-sm font-bold transition-colors text-center whitespace-nowrap ${
                  sectionFilter === key ? 'text-[#F5F0E8]' : 'text-[#1A1A1A]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {isLibraryPreview ? (
            <button
              onClick={() => setIsLibraryPreview(false)}
              className="px-4 py-3 text-xs font-bold bg-[#EDEAE4] text-[#1A1A1A] border border-[#1A1A1A] whitespace-nowrap hover:bg-[#F5F0E8] transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              뒤로가기
            </button>
          ) : (
            <button
              onClick={() => router.push('/professor/quiz/create')}
              className="px-6 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#3A3A3A] transition-colors border border-[#1A1A1A]"
            >
              퀴즈 만들기
            </button>
          )}
        </div>

        {/* 태그 검색 버튼 — 자작 탭에서만, 밑줄 우측 배치 (프리뷰 모드에서 숨김) */}
        {sectionFilter === 'custom' && !isLibraryPreview && (
          <div className="flex justify-end mb-2">
            <button
              onClick={() => setShowTagFilter(!showTagFilter)}
              className={`flex items-center justify-center w-11 h-11 border transition-colors shrink-0 ${
                showTagFilter
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A]'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </button>
          </div>
        )}

        {/* 선택된 태그 + 태그 필터 목록 — 자작 탭에서만 */}
        {sectionFilter === 'custom' && !isLibraryPreview && selectedTags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {selectedTags.map((tag) => (
              <div
                key={tag}
                className="flex items-center gap-1 px-2 py-1 bg-[#F5F0E8] text-[#1A1A1A] text-sm font-bold border border-[#1A1A1A]"
              >
                #{tag}
                <button
                  onClick={() => setSelectedTags(prev => prev.filter(t => t !== tag))}
                  className="ml-0.5 hover:text-[#5C5C5C]"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <AnimatePresence>
          {sectionFilter === 'custom' && !isLibraryPreview && showTagFilter && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-3"
            >
              <div className="flex flex-wrap gap-2 p-3 bg-[#EDEAE4] border border-[#D4CFC4]">
                {fixedTagOptions
                  .filter(tag => !selectedTags.includes(tag))
                  .map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        setSelectedTags(prev => [...prev, tag]);
                        setShowTagFilter(false);
                      }}
                      className="px-3 py-1.5 text-sm font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#E5E0D8] transition-colors"
                    >
                      #{tag}
                    </button>
                  ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ====== 자작 탭 ====== */}
        {sectionFilter === 'custom' && !isLibraryPreview && (
          <>
            {customLoading && (
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            )}

            {!customLoading && customQuizzes.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center text-center py-12"
              >
                <h3 className="font-serif-display text-lg font-black mb-2 text-[#1A1A1A]">
                  자작 퀴즈가 없습니다
                </h3>
                <p className="text-sm text-[#5C5C5C]">
                  첫 번째 퀴즈를 만들어보세요!
                </p>
              </motion.div>
            )}

            {!customLoading && customQuizzes.length > 0 && filteredCustomQuizzes.length === 0 && selectedTags.length > 0 && (
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

            {!customLoading && filteredCustomQuizzes.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {filteredCustomQuizzes.map((quiz, index) => (
                  <motion.div
                    key={quiz.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                  >
                    <ProfessorCustomQuizCard
                      quiz={quiz}
                      feedbackInfo={feedbackMap[quiz.id]}
                      onDetails={() => { setDetailsSource('custom'); setDetailsQuiz(quiz); }}
                      onStats={() => setStatsQuizId({ id: quiz.id, title: quiz.title })}
                      onClick={() => router.push(`/professor/quiz/${quiz.id}/preview`)}
                    />
                  </motion.div>
                ))}
              </div>
            )}

            {customError && (
              <div className="mt-4 p-3 border border-[#1A1A1A] bg-[#FDFBF7]">
                <p className="text-sm text-[#8B1A1A]">{customError}</p>
              </div>
            )}
          </>
        )}

        {/* ====== 서재 탭 ====== */}
        {(sectionFilter === 'library' || isLibraryPreview) && (
          <ProfessorLibraryTab
            onPreviewChange={setIsLibraryPreview}
            isPreviewActive={isLibraryPreview}
            onPublish={() => {
              if (user?.uid) {
                midtermHook.fetchQuizzes(user.uid, { quizType: 'midterm', pageSize: 50 });
                finalHook.fetchQuizzes(user.uid, { quizType: 'final', pageSize: 50 });
              }
            }}
          />
        )}

        {/* ====== 커스텀 탭 (폴더) ====== */}
        {sectionFilter === 'folder' && !isLibraryPreview && (
          <div>
            {/* 새 폴더 입력 */}
            {showNewFolderInput && (
              <div className="mb-3 flex gap-2">
                <input
                  type="text"
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && newFolderName.trim()) {
                      await createCustomFolder(newFolderName.trim());
                      setNewFolderName('');
                      setShowNewFolderInput(false);
                    } else if (e.key === 'Escape') {
                      setNewFolderName('');
                      setShowNewFolderInput(false);
                    }
                  }}
                  placeholder="폴더 이름"
                  className="flex-1 px-3 py-2 border-2 border-[#1A1A1A] bg-[#FDFBF7] text-sm text-[#1A1A1A] placeholder-[#5C5C5C] outline-none"
                />
                <button
                  onClick={async () => {
                    if (newFolderName.trim()) {
                      await createCustomFolder(newFolderName.trim());
                      setNewFolderName('');
                      setShowNewFolderInput(false);
                    }
                  }}
                  className="px-3 py-2 border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8] text-sm font-bold"
                >
                  만들기
                </button>
                <button
                  onClick={() => { setNewFolderName(''); setShowNewFolderInput(false); }}
                  className="px-3 py-2 border-2 border-[#D4CFC4] text-sm text-[#5C5C5C]"
                >
                  취소
                </button>
              </div>
            )}

            {/* 폴더 그리드 */}
            <div className="grid grid-cols-3 gap-3 p-1">
              {/* 새 폴더 버튼 */}
              <button
                onClick={() => setShowNewFolderInput(true)}
                className="aspect-square border-2 border-dashed border-[#D4CFC4] flex flex-col items-center justify-center gap-2 hover:border-[#1A1A1A] transition-colors"
              >
                <svg className="w-8 h-8 text-[#5C5C5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-[10px] text-[#5C5C5C] font-bold">새 폴더</span>
              </button>

              {/* 폴더 목록 */}
              {customFolders.map((folder) => (
                <div
                  key={folder.id}
                  className="relative aspect-square flex flex-col items-center justify-center gap-1 cursor-pointer hover:scale-105 active:scale-95 transition-transform duration-150"
                  onClick={() => router.push(`/professor/quiz/best-q?tab=custom&folder=${folder.id}`)}
                >
                  {/* 삭제 버튼 */}
                  {deleteFolderTarget?.id === folder.id ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#F5F0E8]/90 z-10 gap-1">
                      <p className="text-xs font-bold text-[#8B1A1A]">삭제?</p>
                      <div className="flex gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteCustomFolder(folder.id); setDeleteFolderTarget(null); }}
                          className="px-2 py-1 text-xs bg-[#8B1A1A] text-[#F5F0E8] font-bold"
                        >
                          삭제
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteFolderTarget(null); }}
                          className="px-2 py-1 text-xs border border-[#1A1A1A] text-[#1A1A1A] font-bold"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <svg className="w-20 h-20 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span className="text-sm font-bold text-[#1A1A1A] text-center px-1 truncate w-full">
                    {folder.name}
                  </span>
                  <span className="text-xs text-[#5C5C5C]">{folder.questions.length}문제</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Details 모달 */}
      {detailsQuiz && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-hidden overscroll-none"
          onClick={() => setDetailsQuiz(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            <h2 className="text-lg font-bold text-[#1A1A1A] mb-2">{detailsQuiz.title}</h2>

            {/* 총평 */}
            {detailsQuiz.description && (
              <p className="text-sm text-[#5C5C5C] mb-4 line-clamp-3">&ldquo;{detailsQuiz.description}&rdquo;</p>
            )}
            {!detailsQuiz.description && <div className="mb-2" />}

            {/* 평균 점수 대형 박스 */}
            <div className="text-center py-4 mb-4 border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]">
              <p className="text-xs text-[#5C5C5C] mb-1">평균 점수</p>
              <p className="text-4xl font-black text-[#1A1A1A]">
                {detailsQuiz.participantCount > 0
                  ? <>{(detailsQuiz.averageScore ?? 0).toFixed(0)}<span className="text-lg font-bold">점</span></>
                  : '-'}
              </p>
            </div>

            <div className="space-y-2 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">문제 수</span>
                <span className="font-bold text-[#1A1A1A]">{detailsQuiz.questionCount}문제</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">참여자</span>
                <span className="font-bold text-[#1A1A1A]">{detailsQuiz.participantCount}명</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">난이도</span>
                <span className="font-bold text-[#1A1A1A]">
                  {detailsQuiz.difficulty === 'easy' ? '쉬움' : detailsQuiz.difficulty === 'hard' ? '어려움' : '보통'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">문제 유형</span>
                <span className="font-bold text-[#1A1A1A]">
                  {formatQuestionTypes(detailsQuiz)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">제작자</span>
                <span className="font-bold text-[#1A1A1A]">
                  {detailsQuiz.creatorNickname || '익명'}
                </span>
              </div>
              {/* 피드백 점수 */}
              {(() => {
                const fb = feedbackMap[detailsQuiz.id];
                const label = fb ? getFeedbackLabel(fb.score) : null;
                return fb && label && fb.count > 0 ? (
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-[#5C5C5C]">피드백</span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-xs font-bold px-1.5 py-0.5 border"
                        style={{ color: label.color, borderColor: label.color }}
                      >
                        {label.label}
                      </span>
                      <span className="text-xs text-[#5C5C5C]">{fb.count}건</span>
                    </div>
                  </div>
                ) : null;
              })()}

              {detailsQuiz.tags && detailsQuiz.tags.length > 0 && (
                <div className="pt-2 border-t border-[#A0A0A0]">
                  <div className="flex flex-wrap gap-1.5">
                    {detailsQuiz.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-1 bg-[#1A1A1A] text-[#F5F0E8] text-sm font-medium"
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
                onClick={() => setDetailsQuiz(null)}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                닫기
              </button>
              {detailsSource === 'carousel' && (
                <button
                  onClick={() => {
                    const quiz = detailsQuiz;
                    setDetailsQuiz(null);
                    router.push(`/professor/quiz/${quiz.id}/preview`);
                  }}
                  className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
                >
                  미리보기
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Stats 모달 */}
      {statsQuizId && (
        <QuizStatsModal
          quizId={statsQuizId.id}
          quizTitle={statsQuizId.title}
          isOpen={true}
          onClose={() => setStatsQuizId(null)}
          isProfessor
        />
      )}

      {/* 공개 확인 모달 */}
      <AnimatePresence>
        {publishConfirmQuizId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => setPublishConfirmQuizId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
            >
              <div className="flex justify-center mb-4">
                <div className="w-12 h-12 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                  <svg className="w-6 h-6 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
                  </svg>
                </div>
              </div>
              <h3 className="text-center font-bold text-lg text-[#1A1A1A] mb-2">
                퀴즈를 공개할까요?
              </h3>
              <p className="text-center text-sm text-[#5C5C5C] mb-6">
                공개하면 학생들이 풀 수 있어요.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setPublishConfirmQuizId(null)}
                  className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={async () => {
                    if (publishConfirmQuizId) {
                      await publishHook.togglePublish(publishConfirmQuizId, true);
                      // 각 hook의 퀴즈 목록에서도 업데이트 반영
                      midtermHook.fetchQuizzes(user!.uid, { quizType: 'midterm', pageSize: 50 });
                      finalHook.fetchQuizzes(user!.uid, { quizType: 'final', pageSize: 50 });
                      pastHook.fetchQuizzes(user!.uid, { quizType: 'past', pageSize: 50 });
                    }
                    setPublishConfirmQuizId(null);
                  }}
                  className="flex-1 py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
                >
                  공개
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 스크롤 맨 위로 버튼 (프리뷰 모드에서 숨김) */}
      <AnimatePresence>
        {showScrollTop && !isLibraryPreview && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={scrollToTop}
            className="fixed bottom-24 right-4 z-40 w-12 h-12 bg-[#1A1A1A] text-[#F5F0E8] rounded-full shadow-lg flex items-center justify-center hover:bg-[#3A3A3A] transition-colors"
            aria-label="맨 위로"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
