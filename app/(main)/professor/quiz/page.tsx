'use client';

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, onSnapshot, getDocs, getDoc, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton, ScrollToTopButton, ExpandModal } from '@/components/common';
import { useExpandSource } from '@/lib/hooks/useExpandSource';
import { TAP_SCALE } from '@/lib/constants/springs';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse, useUser } from '@/lib/contexts';
import { COURSES, type CourseId, getDefaultQuizTab, getPastExamOptions, type PastExamOption } from '@/lib/types/course';
import { type ProfessorQuiz, type QuizTypeFilter } from '@/lib/hooks/useProfessorQuiz';
import { calcFeedbackScore, getFeedbackLabel } from '@/lib/utils/feedbackScore';
import { generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';
import QuizStatsModal from '@/components/quiz/manage/QuizStatsModal';
import PreviewQuestionCard from '@/components/professor/PreviewQuestionCard';
import ProfessorLibraryTab from '@/components/professor/library/ProfessorLibraryTab';
import { useCustomFolders } from '@/lib/hooks/useCustomFolders';
import type { FeedbackType } from '@/components/quiz/InstantFeedbackButton';
import AutoVideo, { getDifficultyVideo } from '@/components/quiz/AutoVideo';
import { NEWSPAPER_BG_TEXT } from '@/lib/utils/quizHelpers';
import type { QuestionExportData as PdfQuestionData } from '@/lib/utils/questionPdfExport';
import { scaleCoord } from '@/lib/hooks/useViewportScale';

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

// (AutoVideo, getDifficultyVideo, NEWSPAPER_BG_TEXT → 공유 모듈에서 import)

// ============================================================
// 자작/서재/커스텀 탭 (밑줄 스타일)
// ============================================================

const SECTION_OPTIONS: { key: 'custom' | 'library' | 'folder'; label: string }[] = [
  { key: 'custom', label: '자작' },
  { key: 'library', label: '서재' },
  { key: 'folder', label: '커스텀' },
];

function ProfSectionTabs({
  sectionFilter,
  onChangeFilter,
}: {
  sectionFilter: 'custom' | 'library' | 'folder';
  onChangeFilter: (key: 'custom' | 'library' | 'folder') => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [underline, setUnderline] = useState({ left: 0, width: 0 });
  const activeIdx = SECTION_OPTIONS.findIndex(o => o.key === sectionFilter);

  const measureUnderline = useCallback(() => {
    if (activeIdx < 0 || !containerRef.current || !btnRefs.current[activeIdx]) return;
    const container = containerRef.current.getBoundingClientRect();
    const btn = btnRefs.current[activeIdx]!.getBoundingClientRect();
    setUnderline({ left: btn.left - container.left, width: btn.width });
  }, [activeIdx]);

  useEffect(() => {
    measureUnderline();
  }, [measureUnderline]);

  return (
    <div ref={containerRef} className="relative flex gap-4">
      {SECTION_OPTIONS.map((opt, i) => (
        <button
          key={opt.key}
          ref={el => { btnRefs.current[i] = el; }}
          onClick={() => onChangeFilter(opt.key)}
          className={`pb-1.5 text-base font-bold transition-colors ${
            sectionFilter === opt.key ? 'text-[#1A1A1A]' : 'text-[#5C5C5C]'
          }`}
        >
          {opt.label}
        </button>
      ))}
      {activeIdx >= 0 && underline.width > 0 && (
        <motion.div
          className="absolute bottom-0 h-[2px] bg-[#1A1A1A]"
          animate={{ left: underline.left, width: underline.width }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}
    </div>
  );
}

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
        <div className="px-3 mt-0.5 flex items-center justify-between">
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
            className={`flex-1 py-3 text-base font-bold bg-[#1A1A1A] text-[#F5F0E8] transition-colors rounded-lg ${
              !quiz.isPublished ? 'opacity-40 pointer-events-none' : 'hover:bg-[#3A3A3A]'
            }`}
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
              <div className="px-3 mt-0.5 flex items-center justify-between">
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
                  className={`flex-1 py-3 text-base font-bold bg-[#1A1A1A] text-[#F5F0E8] transition-colors rounded-lg ${
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
});

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

  // 순서: midterm(0), past(1), final(2)
  const quizzesByType = [midtermQuizzes, pastQuizzes, finalQuizzes];
  const loadingByType = [isLoading.midterm, isLoading.past, isLoading.final];

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
    swipeStartX.current = scaleCoord(e.touches[0].clientX);
    swipeStartY.current = scaleCoord(e.touches[0].clientY);
    swipeDir.current = 'none';
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (swipeDir.current !== 'none') return; // 방향 판별 이후는 touchMove에서 처리
    const touch = e.changedTouches[0];
    const dx = scaleCoord(touch.clientX) - swipeStartX.current;
    const dy = scaleCoord(touch.clientY) - swipeStartY.current;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
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
        {COURSE_IDS.map((id, idx) => (
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

// ============================================================
// 스켈레톤 카드
// ============================================================

function SkeletonCard() {
  return (
    <div className="border border-[#999] bg-[#F5F0E8]/70 backdrop-blur-sm p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
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
  const { profile } = useUser();

  // 과목별 퀴즈 통합 로드 (useProfessorQuiz ×3 → 단일 fetch + state)
  const [allMidterm, setAllMidterm] = useState<ProfessorQuiz[]>([]);
  const [allFinal, setAllFinal] = useState<ProfessorQuiz[]>([]);
  const [allPast, setAllPast] = useState<ProfessorQuiz[]>([]);
  const [examLoading, setExamLoading] = useState(true);

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

  // 서재 탭 시 네비게이션만 숨김 (PullToHome은 유지)
  // data-hide-nav는 PullToHome 제스처도 차단하므로 data-hide-nav-only 사용
  useEffect(() => {
    if (sectionFilter === 'library') {
      document.body.setAttribute('data-hide-nav-only', '');
    } else {
      document.body.removeAttribute('data-hide-nav-only');
    }
    return () => document.body.removeAttribute('data-hide-nav-only');
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

  // 폴더 상세 뷰
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [folderQuestions, setFolderQuestions] = useState<any[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);

  // 폴더 클릭 시 문제 로드 (useEffect 대신 직접 호출 — onSnapshot이 customFolders를 갱신하면 useEffect가 cancelled되는 문제 방지)
  const handleOpenFolder = useCallback(async (folder: { id: string; questions: any[] }) => {
    setOpenFolderId(folder.id);
    setFolderQuestions([]);

    if (!folder.questions || folder.questions.length === 0) {
      setFolderLoading(false);
      return;
    }

    setFolderLoading(true);

    try {
      const quizIdSet = new Set<string>();
      for (const q of folder.questions) quizIdSet.add(q.quizId);

      const quizCache = new Map<string, any>();
      for (const quizId of quizIdSet) {
        try {
          const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
          if (quizDoc.exists()) quizCache.set(quizId, quizDoc.data());
        } catch (e) {
          console.error('퀴즈 로드 실패:', quizId, e);
        }
      }

      const questions: any[] = [];
      // questionId가 없는 기존 데이터 대응: 같은 퀴즈에서 몇 번째인지 추적
      const quizIndexCounters: Record<string, number> = {};
      for (const q of folder.questions) {
        const quizData = quizCache.get(q.quizId);
        if (!quizData) continue;
        const quizQuestions = (quizData.questions as any[]) || [];

        let question: any = null;

        if (q.questionId) {
          // 정상 매칭: questionId로 찾기
          question = quizQuestions.find((qq: any, idx: number) => {
            const qId = qq.id || `q${idx}`;
            return qId === q.questionId;
          });
        }

        if (!question) {
          // 폴백: questionId가 없거나 매칭 실패 → 같은 퀴즈 내 순서대로 매칭
          const counter = quizIndexCounters[q.quizId] || 0;
          if (counter < quizQuestions.length) {
            question = quizQuestions[counter];
          }
          quizIndexCounters[q.quizId] = counter + 1;
        }

        if (!question) continue;
        questions.push({ ...question, _quizTitle: q.quizTitle });
      }
      setFolderQuestions(questions);
    } catch (e) {
      console.error('폴더 문제 로드 실패:', e);
      setFolderQuestions([]);
    } finally {
      setFolderLoading(false);
    }
  }, []);

  // PDF 폴더 선택 모드
  const [isProfPdfSelectMode, setIsProfPdfSelectMode] = useState(false);
  const [selectedProfPdfFolders, setSelectedProfPdfFolders] = useState<Set<string>>(new Set());

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

  // 스크롤 맨 위로 버튼
  const headerRef = useRef<HTMLElement>(null);

  // 피드백 점수 데이터
  const [feedbackMap, setFeedbackMap] = useState<Record<string, QuizFeedbackInfo>>({});

  // 퀴즈 문서 → ProfessorQuiz 파싱 헬퍼
  const docToQuiz = useCallback((docSnap: any): ProfessorQuiz => {
    const data = docSnap.data();
    return {
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
      pastYear: data.pastYear,
      pastExamType: data.pastExamType,
      createdAt: data.createdAt?.toDate() || new Date(),
      updatedAt: data.updatedAt?.toDate() || new Date(),
    };
  }, []);

  // 중간/기말/기출 통합 fetch (단일 쿼리 → 클라이언트 분류)
  const refreshExamQuizzes = useCallback(async () => {
    if (!user?.uid) return;
    setExamLoading(true);

    try {
      // creatorUid 또는 creatorId로 조회 (AI 퀴즈는 creatorId만 있을 수 있음)
      const [byUid, byId] = await Promise.all([
        getDocs(query(
          collection(db, 'quizzes'),
          where('creatorUid', '==', user.uid),
          where('type', 'in', ['midterm', 'final', 'past', 'professor']),
        )),
        getDocs(query(
          collection(db, 'quizzes'),
          where('creatorId', '==', user.uid),
          where('type', 'in', ['midterm', 'final', 'past', 'professor']),
        )),
      ]);

      // 중복 제거 (creatorUid와 creatorId 둘 다 있는 문서)
      const seen = new Set<string>();
      const allQuizzes: ProfessorQuiz[] = [];
      for (const snapshot of [byUid, byId]) {
        for (const d of snapshot.docs) {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            allQuizzes.push(docToQuiz(d));
          }
        }
      }

      const sortDesc = (a: ProfessorQuiz, b: ProfessorQuiz) =>
        b.createdAt.getTime() - a.createdAt.getTime();

      setAllMidterm(allQuizzes.filter(q => q.type === 'midterm').sort(sortDesc));
      setAllFinal(allQuizzes.filter(q => q.type === 'final').sort(sortDesc));
      setAllPast(allQuizzes.filter(q => q.type === 'past').sort(sortDesc));
    } catch (err) {
      console.error('[refreshExamQuizzes] 오류:', err);
    }
    setExamLoading(false);
  }, [user?.uid, docToQuiz]);

  useEffect(() => {
    refreshExamQuizzes();
  }, [refreshExamQuizzes]);

  // 과목별 클라이언트 사이드 필터링 (과목 전환 시 즉시 반영)
  const filteredMidterm = useMemo(() => {
    if (!userCourseId) return allMidterm;
    return allMidterm.filter(q => q.courseId === userCourseId);
  }, [allMidterm, userCourseId]);

  const filteredFinal = useMemo(() => {
    if (!userCourseId) return allFinal;
    return allFinal.filter(q => q.courseId === userCourseId);
  }, [allFinal, userCourseId]);

  const filteredPast = useMemo(() => {
    if (!userCourseId) return allPast;
    return allPast.filter(q => q.courseId === userCourseId);
  }, [allPast, userCourseId]);

  // 자작 퀴즈 로드 (courseId 필터로 해당 과목만 구독)
  const [allCustomQuizzes, setAllCustomQuizzes] = useState<ProfessorQuiz[]>([]);
  useEffect(() => {
    if (!user || !userCourseId) return;

    setCustomLoading(true);
    setCustomError(null);

    const q = query(
      collection(db, 'quizzes'),
      where('type', '==', 'custom'),
      where('courseId', '==', userCourseId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const quizzes: ProfessorQuiz[] = snapshot.docs.map(docToQuiz);
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
  }, [user, userCourseId, docToQuiz]);

  // 자작 퀴즈 (이미 courseId로 필터됨)
  const customQuizzes = allCustomQuizzes;

  // 과목 변경 시 태그 초기화
  useEffect(() => {
    setSelectedTags([]);
    setShowTagFilter(false);
  }, [userCourseId]);

  // 전체 퀴즈 목록 합산 (피드백 로드용 — 전체 데이터로 1회만 로드)
  const allQuizzes = useMemo(() => {
    const carouselQuizzes = [...allMidterm, ...allFinal, ...allPast];
    const ids = new Set(carouselQuizzes.map(q => q.id));
    const uniqueCustomQuizzes = allCustomQuizzes.filter(q => !ids.has(q.id));
    return [...carouselQuizzes, ...uniqueCustomQuizzes];
  }, [allMidterm, allFinal, allPast, allCustomQuizzes]);

  // 태그 필터링된 자작 퀴즈
  const filteredCustomQuizzes = useMemo(() => {
    if (selectedTags.length === 0) return customQuizzes;
    return customQuizzes.filter(quiz =>
      quiz.tags && selectedTags.some(tag => quiz.tags!.includes(tag))
    );
  }, [customQuizzes, selectedTags]);

  // 피드백 구독용 quizId 목록 — ID가 실제로 변경될 때만 재구독 (churn 방지)
  const feedbackQuizIdsKey = useMemo(
    () => allQuizzes.map(q => q.id).sort().join(','),
    [allQuizzes]
  );

  // 피드백 점수 실시간 구독 (debounce로 배치 처리)
  useEffect(() => {
    if (!feedbackQuizIdsKey) {
      setFeedbackMap({});
      return;
    }

    const quizIds = feedbackQuizIdsKey.split(',');
    const unsubscribes: (() => void)[] = [];
    const chunkData: Record<number, { quizId: string; type: FeedbackType }[]> = {};
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const recalcFeedbackMap = () => {
      // debounce: 여러 chunk가 연속 도착해도 150ms 후 1회만 계산
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
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
      }, 150);
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
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribes.forEach(fn => fn());
    };
  }, [feedbackQuizIdsKey]);

  // Details 모달 상태
  const [detailsQuiz, setDetailsQuiz] = useState<ProfessorQuiz | null>(null);
  const [detailsSource, setDetailsSource] = useState<'carousel' | 'custom'>('carousel');
  const { sourceRect: detailsSourceRect, registerRef: registerDetailsRef, captureRect: captureDetailsRect, clearRect: clearDetailsRect } = useExpandSource();
  // Stats 모달 상태
  const [statsQuizId, setStatsQuizId] = useState<{ id: string; title: string } | null>(null);

  // 제작자 실명 캐시 (uid → { name, classId })
  const creatorInfoCache = useRef<Map<string, { name?: string; classId?: string }>>(new Map());
  const [detailsCreatorInfo, setDetailsCreatorInfo] = useState<{ role?: string; name?: string; nickname?: string; classId?: string } | null>(null);

  // Details 모달 열릴 때 제작자 실명 조회
  useEffect(() => {
    if (!detailsQuiz?.creatorUid) { setDetailsCreatorInfo(null); return; }
    const uid = detailsQuiz.creatorUid;
    const cached = creatorInfoCache.current.get(uid);
    if (cached) { setDetailsCreatorInfo(cached); return; }
    getDoc(doc(db, 'users', uid)).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        const info = { role: data.role || 'student', name: data.name || undefined, nickname: data.nickname || undefined, classId: data.classId || undefined };
        creatorInfoCache.current.set(uid, info);
        setDetailsCreatorInfo(info);
      } else {
        setDetailsCreatorInfo(null);
      }
    }).catch(() => setDetailsCreatorInfo(null));
  }, [detailsQuiz?.creatorUid]);

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
      captureDetailsRect(quiz.id);
      setDetailsSource('carousel');
      setDetailsQuiz(quiz);
    },
    [captureDetailsRect]
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
      <section className="mt-6" style={{ transform: 'scale(0.85)', transformOrigin: 'top center', width: '117.65%', marginLeft: '-8.825%', marginBottom: '-12px' }}>
        <ProfessorNewsCarousel
          midtermQuizzes={filteredMidterm}
          finalQuizzes={filteredFinal}
          pastQuizzes={filteredPast}
          isLoading={{
            midterm: examLoading,
            final: examLoading,
            past: examLoading,
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
      <section className="px-4 pb-16">
        {/* 필터 탭 (자작|서재|커스텀) + 퀴즈 만들기 / 뒤로가기 */}
        <div className="flex items-center justify-between mb-2">
          <ProfSectionTabs
            sectionFilter={sectionFilter}
            onChangeFilter={(key) => {
              if (isLibraryPreview) setIsLibraryPreview(false);
              setSectionFilter(key);
            }}
          />

          {isLibraryPreview ? (
            <div />
          ) : isProfPdfSelectMode ? (
            <div className="flex gap-2">
              <button
                onClick={() => { setIsProfPdfSelectMode(false); setSelectedProfPdfFolders(new Set()); }}
                className="px-4 py-3 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                취소
              </button>
              <button
                disabled={selectedProfPdfFolders.size === 0}
                onClick={async () => {
                  const includeAnswers = true;
                  const includeExplanations = true;

                  try {
                    const { exportQuestionsToPdf } = await import('@/lib/utils/questionPdfExport');
                    const allQuestions: PdfQuestionData[] = [];

                    const selectedFolders = customFolders.filter(f => selectedProfPdfFolders.has(f.id));

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
                        let question: any = q.questionId
                          ? quizQuestions.find((qq: any, idx: number) => (qq.id || `q${idx}`) === q.questionId)
                          : null;
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
                      studentId: '',
                      courseName: userCourseId ? COURSES[userCourseId]?.name : undefined,
                    });
                  } catch (err) {
                    console.error('PDF 다운로드 실패:', err);
                  } finally {
                    setIsProfPdfSelectMode(false);
                    setSelectedProfPdfFolders(new Set());
                  }
                }}
                className={`px-4 py-3 text-sm font-bold whitespace-nowrap transition-colors rounded-lg ${
                  selectedProfPdfFolders.size > 0
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A]'
                    : 'bg-[#D4CFC4] text-[#EDEAE4] cursor-not-allowed'
                }`}
              >
                PDF 다운 {selectedProfPdfFolders.size > 0 && `(${selectedProfPdfFolders.size})`}
              </button>
            </div>
          ) : (
            <button
              onClick={() => router.push('/professor/quiz/create')}
              className="px-4 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#3A3A3A] transition-colors rounded-lg"
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
        )}

        {/* 선택된 태그 + 태그 필터 목록 — 자작 탭에서만 */}
        {sectionFilter === 'custom' && !isLibraryPreview && selectedTags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {selectedTags.map((tag) => (
              <div
                key={tag}
                className="flex items-center gap-1 px-2.5 h-9 bg-[#F5F0E8] text-[#1A1A1A] text-sm font-bold border border-[#1A1A1A]"
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
              <div className="flex flex-wrap gap-1.5 p-2 bg-[#EDEAE4] border border-[#D4CFC4] rounded-lg">
                {fixedTagOptions
                  .filter(tag => !selectedTags.includes(tag))
                  .map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        setSelectedTags(prev => [...prev, tag]);
                        setShowTagFilter(false);
                      }}
                      className="px-2 py-1 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#E5E0D8] transition-colors rounded"
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
                    ref={(el) => registerDetailsRef(quiz.id, el)}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                  >
                    <ProfessorCustomQuizCard
                      quiz={quiz}
                      feedbackInfo={feedbackMap[quiz.id]}
                      onDetails={() => { captureDetailsRect(quiz.id); setDetailsSource('custom'); setDetailsQuiz(quiz); }}
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
              refreshExamQuizzes();
            }}
          />
        )}

        {/* ====== 커스텀 탭 (폴더) ====== */}
        {sectionFilter === 'folder' && !isLibraryPreview && (
          <div>
            {/* 상단 버튼 행: 폴더 생성 + PDF 다운 (PDF 선택 모드/상세 뷰에서 숨김) */}
            {!isProfPdfSelectMode && !openFolderId && <div className="flex gap-2 mb-3">
              <button
                onClick={() => setShowNewFolderInput(true)}
                className="flex-1 py-2 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
              >
                + 폴더 생성
              </button>
              <button
                onClick={() => {
                  if (customFolders.length === 0) return;
                  setIsProfPdfSelectMode(true);
                  setSelectedProfPdfFolders(new Set());
                }}
                className="flex-1 py-2 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors flex items-center justify-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                PDF 다운
              </button>
            </div>}

            {/* 새 폴더 입력 */}
            {showNewFolderInput && !openFolderId && !isProfPdfSelectMode && (
              <div className="mb-3 flex gap-2 items-center">
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
                  className="min-w-0 flex-1 max-w-[50%] px-3 py-2 border-2 border-[#1A1A1A] bg-[#FDFBF7] text-sm text-[#1A1A1A] placeholder-[#5C5C5C] outline-none rounded-lg"
                />
                <button
                  onClick={async () => {
                    if (newFolderName.trim()) {
                      await createCustomFolder(newFolderName.trim());
                      setNewFolderName('');
                      setShowNewFolderInput(false);
                    }
                  }}
                  className="px-4 py-2.5 border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8] text-sm font-bold whitespace-nowrap rounded-lg"
                >
                  만들기
                </button>
                <button
                  onClick={() => { setNewFolderName(''); setShowNewFolderInput(false); }}
                  className="px-4 py-2.5 border-2 border-[#1A1A1A] text-sm text-[#1A1A1A] font-bold whitespace-nowrap rounded-lg"
                >
                  취소
                </button>
              </div>
            )}

            {/* 폴더 그리드 (상세 뷰 열려있으면 숨김) */}
            {!openFolderId && <div className="grid grid-cols-3 gap-3 p-1">
              {customFolders.map((folder) => (
                <div
                  key={folder.id}
                  className={`relative flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all duration-150 ${
                    isProfPdfSelectMode
                      ? selectedProfPdfFolders.has(folder.id)
                        ? ''
                        : ''
                      : 'hover:scale-105 active:scale-95'
                  }`}
                  onClick={() => {
                    if (isProfPdfSelectMode) {
                      const newSelected = new Set(selectedProfPdfFolders);
                      if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                      else newSelected.add(folder.id);
                      setSelectedProfPdfFolders(newSelected);
                    } else {
                      handleOpenFolder(folder);
                    }
                  }}
                >
                  {/* PDF 선택 체크마크 */}
                  {isProfPdfSelectMode && selectedProfPdfFolders.has(folder.id) && (
                    <div className="absolute top-0.5 right-0.5 w-5 h-5 bg-[#1A1A1A] rounded-full flex items-center justify-center z-10">
                      <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}

                  {/* 삭제 확인 */}
                  {!isProfPdfSelectMode && deleteFolderTarget?.id === folder.id ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-1">
                      <p className="text-xs font-bold text-[#8B1A1A]">삭제?</p>
                      <div className="flex gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteCustomFolder(folder.id); setDeleteFolderTarget(null); }}
                          className="px-2 py-1 text-xs bg-[#8B1A1A] text-[#F5F0E8] font-bold rounded"
                        >
                          삭제
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteFolderTarget(null); }}
                          className="px-2 py-1 text-xs border border-[#1A1A1A] text-[#1A1A1A] font-bold rounded"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* 폴더 아이콘 — 다크 글래스 */}
                  <svg className={`w-28 h-28 drop-shadow-lg -mb-1 ${
                    isProfPdfSelectMode && selectedProfPdfFolders.has(folder.id) ? 'opacity-100' : ''
                  }`} viewBox="0 0 24 24" fill="none">
                    <defs>
                      <linearGradient id={`fg-${folder.id}`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="rgba(50,50,50,0.85)" />
                        <stop offset="100%" stopColor="rgba(25,25,25,0.9)" />
                      </linearGradient>
                    </defs>
                    <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" fill={`url(#fg-${folder.id})`} />
                    <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke="rgba(255,255,255,0.1)" strokeWidth="0.4" fill="none" />
                  </svg>
                  <span className="text-sm font-bold text-[#1A1A1A] text-center px-1 truncate w-full -mt-0.5">
                    {folder.name}
                  </span>
                  <span className="text-sm text-[#5C5C5C]">{folder.questions.length}문제</span>
                </div>
              ))}
            </div>}

            {/* 폴더 상세 뷰 */}
            {openFolderId && (() => {
              const folder = customFolders.find(f => f.id === openFolderId);
              if (!folder) return null;
              return (
                <div>
                  {/* 헤더 */}
                  <div className="flex items-center gap-2 mb-4">
                    <button
                      onClick={() => { setOpenFolderId(null); setFolderQuestions([]); }}
                      className="p-1 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <h3 className="text-3xl font-black text-[#1A1A1A] flex-1 truncate">{folder.name}</h3>
                    <span className="text-xs text-[#5C5C5C]">{folder.questions.length}문제</span>
                    <button
                      onClick={() => setDeleteFolderTarget({ id: folder.id, name: folder.name })}
                      className="p-1 text-[#5C5C5C] hover:text-[#8B1A1A] transition-colors flex-shrink-0"
                      title="폴더 삭제"
                    >
                      <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>

                  {/* 로딩 */}
                  {folderLoading && (
                    <div className="flex justify-center py-8">
                      <div className="w-6 h-6 border-2 border-[#1A1A1A] border-t-transparent animate-spin" style={{ borderRadius: '50%' }} />
                    </div>
                  )}

                  {/* 문제 목록 */}
                  {!folderLoading && folderQuestions.length === 0 && (
                    <p className="text-sm text-[#5C5C5C] text-center py-8">문제가 없습니다.</p>
                  )}

                  {!folderLoading && folderQuestions.length > 0 && (
                    <div className="space-y-2">
                      {folderQuestions.map((q, idx) => (
                        <PreviewQuestionCard
                          key={q.id || `fq${idx}`}
                          question={q}
                          questionNumber={idx + 1}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </section>

      {/* 폴더 삭제 확인 모달 */}
      {deleteFolderTarget && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setDeleteFolderTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            <h3 className="text-center font-bold text-lg text-[#1A1A1A] mb-2">폴더 삭제</h3>
            <p className="text-center text-sm text-[#5C5C5C] mb-6">
              &lsquo;{deleteFolderTarget.name}&rsquo; 폴더를 삭제하시겠습니까?<br />이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteFolderTarget(null)}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  await deleteCustomFolder(deleteFolderTarget.id);
                  setDeleteFolderTarget(null);
                  setOpenFolderId(null);
                  setFolderQuestions([]);
                }}
                className="flex-1 py-3 font-bold bg-[#C44] text-white border-2 border-[#C44] hover:bg-[#A33] transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Details 모달 */}
      <ExpandModal
        isOpen={!!detailsQuiz}
        onClose={() => { setDetailsQuiz(null); clearDetailsRect(); }}
        sourceRect={detailsSourceRect}
        className="w-full max-w-[260px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-xl"
      >
        {detailsQuiz && (
          <>
            <h2 className="text-sm font-bold text-[#1A1A1A] mb-2">{detailsQuiz.title}</h2>

            {/* 총평 */}
            {detailsQuiz.description && (
              <p className="text-xs text-[#5C5C5C] mb-3 line-clamp-3">&ldquo;{detailsQuiz.description}&rdquo;</p>
            )}
            {!detailsQuiz.description && <div className="mb-1" />}

            {/* 평균 점수 대형 박스 */}
            <div className="text-center py-2 mb-2 border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4] rounded-lg">
              <p className="text-[10px] text-[#5C5C5C] mb-0.5">평균 점수</p>
              <p className="text-2xl font-black text-[#1A1A1A]">
                {detailsQuiz.participantCount > 0
                  ? <>{(detailsQuiz.averageScore ?? 0).toFixed(0)}<span className="text-xs font-bold">점</span></>
                  : '-'}
              </p>
            </div>

            <div className="space-y-1.5 mb-4">
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">문제 수</span>
                <span className="font-bold text-[#1A1A1A]">{detailsQuiz.questionCount}문제</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">참여자</span>
                <span className="font-bold text-[#1A1A1A]">{detailsQuiz.participantCount}명</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">난이도</span>
                <span className="font-bold text-[#1A1A1A]">
                  {detailsQuiz.difficulty === 'easy' ? '쉬움' : detailsQuiz.difficulty === 'hard' ? '어려움' : '보통'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">문제 유형</span>
                <span className="font-bold text-[#1A1A1A]">
                  {formatQuestionTypes(detailsQuiz)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">제작자</span>
                <span className="font-bold text-[#1A1A1A]">
                  {detailsCreatorInfo?.role === 'professor'
                    ? `${detailsCreatorInfo.name || '교수'} ${detailsCreatorInfo.nickname || detailsQuiz.creatorNickname || ''}`
                    : `${detailsCreatorInfo?.nickname || detailsQuiz.creatorNickname || '익명'} ${detailsCreatorInfo?.classId ? detailsCreatorInfo.classId + '반' : ''}`
                  }
                </span>
              </div>
              {/* 피드백 점수 */}
              {(() => {
                const fb = feedbackMap[detailsQuiz.id];
                const label = fb ? getFeedbackLabel(fb.score) : null;
                return fb && label && fb.count > 0 ? (
                  <div className="flex justify-between text-xs items-center">
                    <span className="text-[#5C5C5C]">피드백</span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 border rounded"
                        style={{ color: label.color, borderColor: label.color }}
                      >
                        {label.label}
                      </span>
                      <span className="text-[10px] text-[#5C5C5C]">{fb.count}건</span>
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
                onClick={() => { setDetailsQuiz(null); clearDetailsRect(); }}
                className="flex-1 py-2 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                닫기
              </button>
              {detailsSource === 'carousel' && (
                <button
                  onClick={() => {
                    const quiz = detailsQuiz;
                    setDetailsQuiz(null);
                    clearDetailsRect();
                    router.push(`/professor/quiz/${quiz.id}/preview`);
                  }}
                  className="flex-1 py-2 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
                >
                  미리보기
                </button>
              )}
            </div>
          </>
        )}
      </ExpandModal>

      {/* Stats 모달 */}
      <QuizStatsModal
        quizId={statsQuizId?.id || ''}
        quizTitle={statsQuizId?.title || ''}
        isOpen={!!statsQuizId}
        onClose={() => setStatsQuizId(null)}
        isProfessor
      />

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
              initial={{ scale: 0.88, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.88, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4"
            >
              <div className="flex justify-center mb-3">
                <div className="w-9 h-9 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                  <svg className="w-4 h-4 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
                  </svg>
                </div>
              </div>
              <h3 className="text-center font-bold text-sm text-[#1A1A1A] mb-2">
                퀴즈를 공개할까요?
              </h3>
              <p className="text-center text-xs text-[#5C5C5C] mb-4">
                공개하면 학생들이 풀 수 있어요.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPublishConfirmQuizId(null)}
                  className="flex-1 py-1.5 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={async () => {
                    if (publishConfirmQuizId) {
                      // 인라인 togglePublish (publishHook 인스턴스 제거)
                      await updateDoc(doc(db, 'quizzes', publishConfirmQuizId), {
                        isPublished: true,
                        updatedAt: Timestamp.now(),
                      });
                      refreshExamQuizzes();
                    }
                    setPublishConfirmQuizId(null);
                  }}
                  className="flex-1 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
                >
                  공개
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 스크롤 맨 위로 버튼 (프리뷰 모드에서 숨김) */}
      <ScrollToTopButton
        targetRef={headerRef}
        hidden={isLibraryPreview}
        bottomPx={90}
        side="right"
      />
    </div>
  );
}
