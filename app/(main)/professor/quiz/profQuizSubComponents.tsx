'use client';

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TAP_SCALE } from '@/lib/constants/springs';
import { type ProfessorQuiz, type QuizTypeFilter } from '@/lib/hooks/useProfessorQuiz';
import { useCourse } from '@/lib/contexts';
import { calcFeedbackScore, getFeedbackLabel } from '@/lib/utils/feedbackScore';
import type { FeedbackType } from '@/components/quiz/InstantFeedbackButton';
import AutoVideo, { getDifficultyVideo } from '@/components/quiz/AutoVideo';
import { NEWSPAPER_BG_TEXT } from '@/lib/utils/quizHelpers';
import { type CourseId, getDefaultQuizTab, type PastExamOption } from '@/lib/types/course';
import type { QuizFeedbackInfo, CarouselCard } from './profQuizPageParts';
import { FIXED_CARDS, PROF_QUIZ_CAROUSEL_KEY, PROF_QUIZ_SCROLL_KEY } from './profQuizPageParts';
import { scaleCoord } from '@/lib/hooks/useViewportScale';

// ============================================================
// 뉴스 기사 컴포넌트 (교수용 — 난이도 이미지 + 왼쪽 정렬)
// ============================================================

const ProfessorNewsArticle = memo(function ProfessorNewsArticle({
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
      <div className="flex-1 min-h-0 relative overflow-hidden bg-black -mb-px">
        <AutoVideo src={getDifficultyVideo(quiz.difficulty)} className="absolute inset-0 w-full h-full object-cover" />
      </div>

      {/* 하단 정보 — 고정 높이, 절대 줄어들지 않음 */}
      <div className="flex-shrink-0 relative bg-[#F5F0E8]">
        <div className="px-3 pt-1.5">
          <h3 className="text-3xl font-black text-[#1A1A1A] overflow-hidden whitespace-nowrap leading-tight" style={{ textOverflow: '".."' }}>
            {quiz.title}
          </h3>
        </div>
        <div className="px-3 mt-0.5">
          <p className="text-sm text-[#1A1A1A]">
            {quiz.questionCount}문제 · {quiz.participantCount}명 참여
            {quiz.participantCount > 0 && ` · 평균 ${quiz.averageScore}점`}
          </p>
        </div>
        <div className="px-3 pb-3 pt-1.5 flex gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDetails(); }}
            className="flex-1 py-3 text-base font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
          >
            Details
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStats(); }}
            className="flex-1 py-3 text-base font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors rounded-lg"
          >
            Stats
          </button>
        </div>
      </div>
    </div>
  );
});

// ============================================================
// 뉴스 카드 컴포넌트 (교수용)
// ============================================================

const ProfessorNewsCard = memo(function ProfessorNewsCard({
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
    <div className="w-full h-full border border-[#999] bg-[#1A1A1A] flex flex-col overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.3)] rounded-xl">
      {/* 축소된 헤더 */}
      <div className="bg-[#1A1A1A] text-[#F5F0E8] px-4 py-2 text-center flex-shrink-0">
        <h1 className="font-serif text-lg font-black tracking-tight">{title}</h1>
        <p className="text-[9px] tracking-widest">{subtitle}</p>
      </div>

      {/* 퀴즈 목록 — 자유 스크롤. bg를 검정으로 → 헤더-비디오 사이 틈 안 보임 */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[#1A1A1A]" data-scroll-inner>
        {isLoading ? (
          <div className="flex items-center justify-center h-full bg-[#F5F0E8]">
            <div className="animate-pulse text-[#5C5C5C]">로딩 중...</div>
          </div>
        ) : quizzes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center bg-[#F5F0E8]">
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
});

// ============================================================
// 기출 전용 뉴스 카드 (학생과 동일한 드롭다운 스타일)
// ============================================================

const ProfessorPastExamNewsCard = memo(function ProfessorPastExamNewsCard({
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
    <div className="w-full h-full border border-[#999] bg-[#1A1A1A] flex flex-col overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.3)] rounded-xl">
      {/* 축소된 헤더 + 드롭다운 — 수직 중앙 정렬 */}
      <div className="bg-[#1A1A1A] text-[#F5F0E8] px-3 py-1.5 flex items-center justify-between flex-shrink-0">
        <div>
          <p className="text-[6px] tracking-[0.2em] mb-0.5 opacity-60">━━━━━━━━━━━━━━━━</p>
          <h1 className="font-serif text-xl font-black tracking-tight">PAST EXAM</h1>
        </div>

        {/* 드롭다운 — 터치 이벤트 캐러셀 전파 차단 */}
        <div className="relative" onPointerDownCapture={(e) => e.stopPropagation()}>
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="px-2 py-1 bg-[#F5F0E8] text-[#1A1A1A] text-sm font-bold flex items-center justify-between gap-1.5 min-w-[90px] rounded-lg"
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
                  className="absolute right-0 top-full mt-1 z-20 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg min-w-[90px] rounded-lg overflow-hidden"
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
            <div className="flex-1 min-h-0 relative overflow-hidden bg-black -mb-px">
              <AutoVideo src={getDifficultyVideo(filteredQuiz.difficulty)} className="absolute inset-0 w-full h-full object-cover" />
            </div>

            {/* 하단 정보 — 고정, 절대 줄어들지 않음 */}
            <div className="flex-shrink-0 bg-[#F5F0E8] relative">
              <div className="px-3 pt-1.5">
                <h3 className="text-3xl font-black text-[#1A1A1A] overflow-hidden whitespace-nowrap leading-tight" style={{ textOverflow: '".."' }}>
                  {filteredQuiz.title}
                </h3>
              </div>
              <div className="px-3 mt-0.5">
                <p className="text-sm text-[#1A1A1A]">
                  {filteredQuiz.questionCount}문제 · {filteredQuiz.participantCount}명 참여
                  {filteredQuiz.participantCount > 0 && ` · 평균 ${filteredQuiz.averageScore}점`}
                </p>
              </div>
              <div className="px-3 pb-3 pt-1.5 flex gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDetails(filteredQuiz); }}
                  className="flex-1 py-3 text-base font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
                >
                  Details
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onStats(filteredQuiz); }}
                  className="flex-1 py-3 text-base font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors rounded-lg"
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
});

// ============================================================
// 단독 퀴즈 전용 뉴스 카드
// ============================================================

const ProfessorIndependentNewsCard = memo(function ProfessorIndependentNewsCard({
  quiz,
  isLoading,
  onDetails,
  onStats,
  onPublish,
}: {
  quiz: ProfessorQuiz | null;
  isLoading: boolean;
  onDetails: (quiz: ProfessorQuiz) => void;
  onStats: (quiz: ProfessorQuiz) => void;
  onPublish?: (quizId: string) => void;
}) {
  return (
    <div className="w-full h-full border border-[#999] bg-[#1A1A1A] flex flex-col overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.3)] rounded-xl">
      {/* 헤더 — 기출과 동일한 스타일 */}
      <div className="bg-[#1A1A1A] text-[#F5F0E8] px-3 py-1.5 flex items-center justify-center flex-shrink-0">
        <div className="text-center">
          <p className="text-[6px] tracking-[0.2em] mb-0.5 opacity-60">━━━━━━━━━━━━━━━━</p>
          <h1 className="font-serif text-xl font-black tracking-tight">SPECIAL EDITION</h1>
        </div>
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[#1A1A1A]" data-scroll-inner>
        {isLoading ? (
          <div className="flex items-center justify-center h-full bg-[#F5F0E8]">
            <div className="animate-pulse text-[#5C5C5C]">로딩 중...</div>
          </div>
        ) : !quiz ? (
          <div className="flex flex-col items-center justify-center h-full text-center bg-[#F5F0E8]">
            <h3 className="font-bold text-lg mb-2 text-[#1A1A1A]">퀴즈가 없습니다</h3>
            <p className="text-sm text-[#5C5C5C]">단독 퀴즈가 아직 등록되지 않았습니다.</p>
          </div>
        ) : (
          <div className="h-full">
            <ProfessorNewsArticle
              quiz={quiz}
              onDetails={() => onDetails(quiz)}
              onStats={() => onStats(quiz)}
              onPublish={() => onPublish?.(quiz.id)}
            />
          </div>
        )}
      </div>
    </div>
  );
});

// ============================================================
// 뉴스 캐러셀 (학생과 동일한 3D perspective 효과)
// ============================================================

export function ProfessorNewsCarousel({
  midtermQuizzes,
  finalQuizzes,
  pastQuizzes,
  independentQuizzes,
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
  independentQuizzes: ProfessorQuiz[];
  isLoading: { midterm: boolean; final: boolean; past: boolean; independent: boolean };
  onDetails: (quiz: ProfessorQuiz) => void;
  onStats: (quiz: ProfessorQuiz) => void;
  onPublish?: (quizId: string) => void;
  selectedPastExam: string;
  pastExamOptions: PastExamOption[];
  onSelectPastExam: (value: string) => void;
}) {
  // 동적 캐러셀 카드 배열: [중간, 기출, 기말, 단독1, 단독2, ...]
  const carouselCards: CarouselCard[] = useMemo(() => {
    const fixed: CarouselCard[] = FIXED_CARDS.map(c => ({ ...c }));
    // 단독 퀴즈는 각각 개별 카드 (최신순)
    const indCards: CarouselCard[] = independentQuizzes.map(quiz => ({
      type: 'independent' as QuizTypeFilter,
      title: 'SPECIAL EDITION',
      subtitle: quiz.title,
      independentQuiz: quiz,
    }));
    return [...fixed, ...indCards];
  }, [independentQuizzes]);

  const TOTAL = carouselCards.length;

  // 가장 최근 퀴즈가 있는 카드 인덱스 계산
  const latestCardIndex = useMemo(() => {
    const quizzesPerCard: (ProfessorQuiz | undefined)[] = carouselCards.map(card => {
      if (card.type === 'independent') return card.independentQuiz;
      if (card.type === 'midterm') return midtermQuizzes[0];
      if (card.type === 'past') return pastQuizzes[0];
      if (card.type === 'final') return finalQuizzes[0];
      return undefined;
    });

    let bestIdx = -1;
    let bestTime = 0;
    quizzesPerCard.forEach((quiz, idx) => {
      if (quiz && quiz.createdAt.getTime() > bestTime) {
        bestTime = quiz.createdAt.getTime();
        bestIdx = idx;
      }
    });
    return bestIdx;
  }, [carouselCards, midtermQuizzes, pastQuizzes, finalQuizzes]);

  // visualIndex: 0=clone_last, 1~TOTAL=real cards, TOTAL+1=clone_first
  // 초기값: 데이터가 있으면 최신 카드, 없으면 sessionStorage → 학기 기반 폴백
  const [visualIndex, setVisualIndex] = useState(() => {
    if (latestCardIndex >= 0) return latestCardIndex + 1;
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem(PROF_QUIZ_CAROUSEL_KEY);
      if (saved !== null) {
        const idx = parseInt(saved, 10);
        if (idx >= 0 && idx < TOTAL) return idx + 1;
      }
    }
    const tab = getDefaultQuizTab();
    if (tab === 'midterm') return 1;
    if (tab === 'past') return 2;
    if (tab === 'final') return 3;
    return 1;
  });
  const [transitionOn, setTransitionOn] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  // 카드별 래퍼 ref (클론 스크롤 동기화용)
  const cardWrapperRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 실제 인덱스 (0~TOTAL-1)
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
    swipeStartX.current = scaleCoord(e.touches[0].clientX);
    swipeStartY.current = scaleCoord(e.touches[0].clientY);
    swipeLocked.current = 'none';
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (swipeLocked.current !== 'none') return;
    const dx = Math.abs(scaleCoord(e.touches[0].clientX) - swipeStartX.current);
    const dy = Math.abs(scaleCoord(e.touches[0].clientY) - swipeStartY.current);
    if (dx > 10 || dy > 10) {
      swipeLocked.current = dx > dy ? 'horizontal' : 'vertical';
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (swipeLocked.current === 'vertical') return;
    const dx = scaleCoord(e.changedTouches[0].clientX) - swipeStartX.current;
    if (Math.abs(dx) > 40) {
      if (dx > 0) goToPrev();
      else goToNext();
    }
  };

  // PC 마우스 드래그로 카드 전환
  const mouseStartX = useRef(0);
  const isMouseDown = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseStartX.current = scaleCoord(e.clientX);
    isMouseDown.current = true;
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isMouseDown.current) return;
    isMouseDown.current = false;
    const dx = scaleCoord(e.clientX) - mouseStartX.current;
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

  // 카드별 퀴즈/로딩 헬퍼
  const getQuizzesForCard = useCallback((card: CarouselCard): ProfessorQuiz[] => {
    if (card.type === 'midterm') return midtermQuizzes;
    if (card.type === 'past') return pastQuizzes;
    if (card.type === 'final') return finalQuizzes;
    if (card.type === 'independent' && card.independentQuiz) return [card.independentQuiz];
    return [];
  }, [midtermQuizzes, pastQuizzes, finalQuizzes]);

  const getLoadingForCard = useCallback((card: CarouselCard): boolean => {
    if (card.type === 'midterm') return isLoading.midterm;
    if (card.type === 'past') return isLoading.past;
    if (card.type === 'final') return isLoading.final;
    if (card.type === 'independent') return isLoading.independent;
    return false;
  }, [isLoading]);

  // 카드 렌더 헬퍼
  const renderCard = useCallback((card: CarouselCard) => {
    if (card.type === 'past') {
      return (
        <ProfessorPastExamNewsCard
          quizzes={pastQuizzes}
          isLoading={isLoading.past}
          onDetails={onDetails}
          onStats={onStats}
          onPublish={onPublish}
          selectedPastExam={selectedPastExam}
          pastExamOptions={pastExamOptions}
          onSelectPastExam={onSelectPastExam}
        />
      );
    }
    if (card.type === 'independent') {
      return (
        <ProfessorIndependentNewsCard
          quiz={card.independentQuiz || null}
          isLoading={isLoading.independent}
          onDetails={onDetails}
          onStats={onStats}
          onPublish={onPublish}
        />
      );
    }
    return (
      <ProfessorNewsCard
        title={card.title}
        subtitle={card.subtitle}
        type={card.type}
        quizzes={getQuizzesForCard(card)}
        isLoading={getLoadingForCard(card)}
        onDetails={onDetails}
        onStats={onStats}
        onPublish={onPublish}
      />
    );
  }, [pastQuizzes, isLoading, onDetails, onStats, onPublish, selectedPastExam, pastExamOptions, onSelectPastExam, getQuizzesForCard, getLoadingForCard]);

  const CARD_WIDTH_PERCENT = 82;
  const SIDE_PEEK_PERCENT = (100 - CARD_WIDTH_PERCENT) / 2;

  return (
    <div
      className="relative select-none cursor-grab active:cursor-grabbing"
      style={{ perspective: 1200, touchAction: 'pan-y' }}
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
            const card = carouselCards[cardIdx];
            const isActive = i === visualIndex;
            const offset = i - visualIndex;
            // 단독 카드는 퀴즈 ID로 고유키, 고정 카드는 type으로
            const cardKey = card.independentQuiz
              ? `ind-${card.independentQuiz.id}-${i}`
              : `${card.type}-${i}`;

            return (
              <motion.div
                key={cardKey}
                ref={(el: HTMLDivElement | null) => { cardWrapperRefs.current[i] = el; }}
                className="flex-shrink-0 px-1.5"
                style={{ width: `${CARD_WIDTH_PERCENT}%` }}
              >
                {/* 카드 + 바닥 그림자 */}
                <div className="relative h-[400px]">
                  {/* 바닥 그림자 — 지면에 드리워지는 타원 */}
                  <motion.div
                    animate={{
                      opacity: isActive ? 0.25 : 0.06,
                      scaleX: isActive ? 0.92 : 0.82,
                    }}
                    transition={transitionOn ? { duration: 0.35, ease: 'easeOut' } : { duration: 0 }}
                    className="absolute left-[4%] right-[4%] -bottom-1 h-5 rounded-[50%] bg-black pointer-events-none"
                    style={{ filter: 'blur(10px)' }}
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
                    className="absolute inset-0 origin-center rounded-xl"
                    style={{ transformStyle: 'preserve-3d' }}
                  >
                    {renderCard(card)}
                  </motion.div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* 인디케이터 — realIndex 기반 */}
      <div className="relative z-10 flex justify-center gap-2 mt-3">
        {Array.from({ length: TOTAL }, (_, index) => (
          <button
            key={index}
            onClick={() => {
              setTransitionOn(true);
              setVisualIndex(index + 1);
            }}
            className={`h-2 rounded-full transition-all duration-300 ${
              realIndex === index ? 'bg-[#1A1A1A] w-5' : 'bg-[#D4CFC4] w-2'
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

export function CourseRibbonHeader({
  currentCourseId,
  onCourseChange,
  courseIds,
}: {
  currentCourseId: CourseId;
  onCourseChange: (courseId: CourseId) => void;
  courseIds: CourseId[];
}) {
  const { getCourseById } = useCourse();
  const currentIndex = courseIds.indexOf(currentCourseId);
  const course = getCourseById(currentCourseId);
  const ribbonImage = course?.quizRibbonImage || '/images/biology-quiz-ribbon.png';
  const ribbonScale = course?.quizRibbonScale || 1;

  const goToPrev = () => {
    const prevIdx = (currentIndex - 1 + courseIds.length) % courseIds.length;
    onCourseChange(courseIds[prevIdx]);
  };

  const goToNext = () => {
    const nextIdx = (currentIndex + 1) % courseIds.length;
    onCourseChange(courseIds[nextIdx]);
  };

  // 터치 + 마우스 드래그 스와이프 (세로 스크롤 허용)
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeDir = useRef<'none' | 'horizontal' | 'vertical'>('none');

  const handleTouchStart = (e: React.TouchEvent) => {
    swipeStartX.current = scaleCoord(e.touches[0].clientX);
    swipeStartY.current = scaleCoord(e.touches[0].clientY);
    swipeDir.current = 'none';
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (swipeDir.current === 'vertical') return; // 세로 스크롤 중이면 무시
    const touch = e.changedTouches[0];
    const dx = scaleCoord(touch.clientX) - swipeStartX.current;
    if (Math.abs(dx) > 40) {
      if (dx > 0) goToPrev();
      else goToNext();
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (swipeDir.current !== 'none') return;
    const dx = Math.abs(scaleCoord(e.touches[0].clientX) - swipeStartX.current);
    const dy = Math.abs(scaleCoord(e.touches[0].clientY) - swipeStartY.current);
    if (dx > 10 || dy > 10) {
      swipeDir.current = dx > dy ? 'horizontal' : 'vertical';
    }
  };

  // PC 마우스 드래그
  const mouseStartX = useRef(0);
  const isMouseDragging = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseStartX.current = scaleCoord(e.clientX);
    isMouseDragging.current = true;
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isMouseDragging.current) return;
    isMouseDragging.current = false;
    const diff = scaleCoord(e.clientX) - mouseStartX.current;
    if (diff > 40) goToPrev();
    else if (diff < -40) goToNext();
  };

  return (
    <div className="flex flex-col items-center">
      {/* 리본 이미지 — 터치/마우스 드래그로 과목 전환 */}
      <div
        className="w-full h-[160px] mt-2 cursor-grab active:cursor-grabbing select-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
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
      <div className="flex justify-center gap-2 mt-3">
        {courseIds.map((id, idx) => (
          <button
            key={id}
            onClick={() => onCourseChange(id)}
            className={`w-2 h-2 rounded-full transition-all ${
              idx === currentIndex ? 'bg-[#1A1A1A] w-4' : 'bg-[#D4CFC4]'
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

export function ProfessorCustomQuizCard({
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
      whileHover={{ y: -4, boxShadow: '0 8px 20px rgba(0, 0, 0, 0.08)' }}
      whileTap={TAP_SCALE}
      transition={{ duration: 0.2 }}
      className="relative border border-[#999] bg-[#F5F0E8]/70 backdrop-blur-sm overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.06)] cursor-pointer rounded-xl"
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
      <div className="relative z-10 p-3 bg-[#F5F0E8]/60">
        {/* 제목 (2줄 고정 높이) */}
        <div className="h-[36px] mb-1.5">
          <h3 className="font-bold text-sm line-clamp-2 text-[#1A1A1A] pr-6 leading-snug">
            {quiz.title}
          </h3>
        </div>

        {/* 메타 정보 */}
        <p className="text-xs text-[#5C5C5C] mb-1">
          {quiz.questionCount}문제 · {quiz.participantCount}명 참여
          {quiz.participantCount > 0 && ` · 평균 ${quiz.averageScore}점`}
        </p>

        {/* 태그 (2줄 고정 높이) */}
        <div className="h-[42px] mb-1.5 overflow-hidden">
          {quiz.tags && quiz.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {quiz.tags.slice(0, 8).map((tag) => (
                <span
                  key={tag}
                  className="px-1 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-[10px] font-medium"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 버튼 */}
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDetails();
            }}
            className="flex-1 py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
          >
            Details
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStats();
            }}
            className="flex-1 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors rounded-lg"
          >
            Stats
          </button>
        </div>
      </div>
    </motion.div>
  );
}