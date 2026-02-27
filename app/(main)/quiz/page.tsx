'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useQuizBookmark } from '@/lib/hooks/useQuizBookmark';
import { useQuizUpdate, type QuizUpdateInfo } from '@/lib/hooks/useQuizUpdate';
import UpdateQuizModal from '@/components/quiz/UpdateQuizModal';
import QuizStatsModal from '@/components/quiz/manage/QuizStatsModal';
import { Skeleton, ScrollToTopButton, ExpandModal } from '@/components/common';
import { useExpandSource } from '@/lib/hooks/useExpandSource';
import { useCourse } from '@/lib/contexts';
import { COURSES, getCurrentSemesterByDate, getDefaultQuizTab, getPastExamOptions, type PastExamOption } from '@/lib/types/course';
import { generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';
import AutoVideo, { getDifficultyVideo } from '@/components/quiz/AutoVideo';
import { NEWSPAPER_BG_TEXT, parseAverageScore, sortByLatest, formatQuestionTypes } from '@/lib/utils/quizHelpers';
import { scaleCoord } from '@/lib/hooks/useViewportScale';

// ============================================================
// 타입 정의
// ============================================================

type NewsCardType = 'midterm' | 'final' | 'past';

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
  myFirstReviewScore?: number;
  creatorNickname?: string;
  creatorClassType?: 'A' | 'B' | 'C' | 'D';
  creatorId?: string;
  hasUpdate?: boolean;
  updatedQuestionCount?: number;
  tags?: string[];
  bookmarkCount?: number;
  createdAt?: any;
  attachmentUrl?: string;
  oneLineSummary?: string;
  multipleChoiceCount?: number;
  subjectiveCount?: number;
  oxCount?: number;
  difficultyImageUrl?: string;
  isAiGenerated?: boolean;
  pastYear?: number;
  pastExamType?: string;
}

// ============================================================
// 상수
// ============================================================

const NEWS_CARDS: { type: NewsCardType; title: string; subtitle: string }[] = [
  { type: 'midterm', title: 'MIDTERM PREP', subtitle: 'Vol.1 · Midterm Edition' },
  { type: 'past', title: 'PAST EXAM', subtitle: 'Official Archive' },
  { type: 'final', title: 'FINAL PREP', subtitle: 'Vol.2 · Final Edition' },
];

// 캐러셀 위치 저장 키
const QUIZ_CAROUSEL_KEY = 'quiz-carousel-index';
// 캐러셀 내 스크롤 위치 저장 키 (타입별)
const QUIZ_SCROLL_KEY = (type: string) => `quiz-scroll-${type}`;

// getDefaultQuizTab → 캐러셀 인덱스 매핑 (midterm=0, past=1, final=2)
function getDefaultCarouselIndex(): number {
  if (typeof window !== 'undefined') {
    const saved = sessionStorage.getItem(QUIZ_CAROUSEL_KEY);
    if (saved !== null) return parseInt(saved, 10);
  }
  const tab = getDefaultQuizTab();
  if (tab === 'midterm') return 0;
  if (tab === 'past') return 1;
  if (tab === 'final') return 2;
  return 0;
}


// (AutoVideo, getDifficultyVideo, NEWSPAPER_BG_TEXT, formatQuestionTypes → 공유 모듈에서 import)

// ============================================================
// 완료 뱃지 컴포넌트
// ============================================================

function CompletedBadge({ size = 'normal' }: { size?: 'normal' | 'small' }) {
  const [imgError, setImgError] = useState(false);

  if (imgError) {
    return (
      <div className={`bg-[#1A6B1A] text-[#F5F0E8] font-bold border-2 border-[#F5F0E8] ${
        size === 'small' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
      }`}>
        완료
      </div>
    );
  }

  return (
    <img
      src="/images/completed-badge.png"
      alt="완료"
      className={size === 'small' ? 'w-36 h-36 object-contain' : 'w-48 h-48 object-contain'}
      onError={() => setImgError(true)}
    />
  );
}

// ============================================================
// 뉴스 기사 컴포넌트 (퀴즈 — 교수 스타일)
// ============================================================

const NewsArticle = memo(function NewsArticle({
  quiz,
  onStart,
  onUpdate,
  onDetails,
  onReview,
  onReviewWrongOnly,
}: {
  quiz: QuizCardData;
  onStart: () => void;
  onUpdate?: () => void;
  onDetails?: () => void;
  onReview?: () => void;
  onReviewWrongOnly?: () => void;
}) {
  const isCompleted = quiz.isCompleted && !quiz.hasUpdate;
  const hasUpdate = quiz.isCompleted && quiz.hasUpdate;
  const [showReviewMenu, setShowReviewMenu] = useState(false);
  const reviewMenuRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (reviewMenuRef.current && !reviewMenuRef.current.contains(event.target as Node)) {
        setShowReviewMenu(false);
      }
    };
    if (showReviewMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showReviewMenu]);

  return (
    <div className="h-full flex flex-col relative">
      {/* 업데이트 뱃지 */}
      {hasUpdate && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUpdate?.();
          }}
          className="absolute top-2 right-2 z-30 w-8 h-8 bg-[#F5C518] rounded-full flex items-center justify-center border-2 border-[#1A1A1A] hover:scale-110 transition-transform"
        >
          <span className="text-[#1A1A1A] font-bold text-sm">!</span>
        </button>
      )}

      {/* 난이도 비디오 — 남은 공간 전부 채움 */}
      <div className="flex-1 min-h-[120px] relative overflow-hidden bg-black">
        <AutoVideo src={getDifficultyVideo(quiz.difficulty)} className="absolute inset-0 w-full h-full object-cover" />
      </div>

      {/* 하단 정보 — 고정 높이, 절대 줄어들지 않음 */}
      <div className="flex-shrink-0">
        <div className="px-4 mt-2">
          <h3 className="text-3xl font-black text-[#1A1A1A] overflow-hidden whitespace-nowrap leading-tight" style={{ textOverflow: '".."' }}>
            {quiz.title}
          </h3>
        </div>
        <div className="px-4 mt-0.5">
          <p className="text-sm text-[#1A1A1A]">
            {quiz.questionCount}문제 · {formatQuestionTypes(quiz.oxCount, quiz.multipleChoiceCount, quiz.subjectiveCount)}
          </p>
          {quiz.tags && quiz.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {quiz.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] font-medium">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="px-4 pb-3 pt-2 flex gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDetails?.(); }}
            className="flex-1 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
          >
            Details
          </button>
          {isCompleted ? (
            <div className="relative flex-1" ref={reviewMenuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowReviewMenu(!showReviewMenu);
                }}
                className="w-full py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors flex items-center justify-center gap-1"
              >
                Review
                <svg className={`w-3 h-3 transition-transform ${showReviewMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              <AnimatePresence>
                {showReviewMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="absolute bottom-full left-0 right-0 mb-1 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg z-50"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(false);
                        onReview?.();
                      }}
                      className="w-full px-3 py-2 text-sm font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] text-left border-b border-[#EDEAE4]"
                    >
                      모두
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(false);
                        onReviewWrongOnly?.();
                      }}
                      className="w-full px-3 py-2 text-sm font-bold text-[#8B1A1A] hover:bg-[#FDEAEA] text-left"
                    >
                      오답만
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStart(); }}
              className="flex-1 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
            >
              Start
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

// ============================================================
// 뉴스 카드 컴포넌트 (중간/기말 — 교수 스타일 세로 스크롤)
// ============================================================

const NewsCard = memo(function NewsCard({
  type,
  title,
  subtitle,
  quizzes,
  isLoading,
  onStart,
  onUpdate,
  onShowDetails,
  onReview,
  onReviewWrongOnly,
}: {
  type: NewsCardType;
  title: string;
  subtitle: string;
  quizzes: QuizCardData[];
  isLoading: boolean;
  onStart: (quizId: string) => void;
  onUpdate: (quiz: QuizCardData) => void;
  onShowDetails?: (quiz: QuizCardData) => void;
  onReview: (quizId: string) => void;
  onReviewWrongOnly: (quizId: string) => void;
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
    const saved = sessionStorage.getItem(QUIZ_SCROLL_KEY(type));
    if (saved) el.scrollTop = parseInt(saved, 10);
  }, [type, itemHeight, isLoading, quizzes.length]);

  // 스크롤 위치 저장
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      sessionStorage.setItem(QUIZ_SCROLL_KEY(type), String(el.scrollTop));
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [type]);

  return (
    <div className="w-full h-full border border-[#999] bg-[#1A1A1A] flex flex-col overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
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
            <p className="text-sm text-[#5C5C5C]">곧 새로운 퀴즈가 추가될 예정입니다.</p>
          </div>
        ) : (
          quizzes.map((quiz) => (
            <div key={quiz.id} style={itemHeight ? { height: itemHeight } : undefined}>
              <NewsArticle
                quiz={quiz}
                onStart={() => onStart(quiz.id)}
                onUpdate={() => onUpdate(quiz)}
                onDetails={onShowDetails ? () => onShowDetails(quiz) : undefined}
                onReview={() => onReview(quiz.id)}
                onReviewWrongOnly={() => onReviewWrongOnly(quiz.id)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
});

// ============================================================
// 기출 뉴스 카드 컴포넌트 (교수 스타일)
// ============================================================

const PastExamNewsCard = memo(function PastExamNewsCard({
  quizzes,
  selectedPastExam,
  pastExamOptions,
  onSelectPastExam,
  isLoading,
  onStart,
  onShowDetails,
  onReview,
  onReviewWrongOnly,
}: {
  quizzes: QuizCardData[];
  selectedPastExam: string;
  pastExamOptions: PastExamOption[];
  onSelectPastExam: (value: string) => void;
  isLoading: boolean;
  onStart: (quizId: string) => void;
  onShowDetails?: (quiz: QuizCardData) => void;
  onReview?: (quizId: string) => void;
  onReviewWrongOnly?: (quizId: string) => void;
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showReviewMenu, setShowReviewMenu] = useState(false);
  const reviewMenuRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 리뷰 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (reviewMenuRef.current && !reviewMenuRef.current.contains(event.target as Node)) {
        setShowReviewMenu(false);
      }
    };
    if (showReviewMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showReviewMenu]);
  const selectedOption = pastExamOptions.find((opt) => opt.value === selectedPastExam);

  // 선택된 년도/시험으로 필터링
  const [yearStr, examType] = selectedPastExam.split('-');
  const year = parseInt(yearStr, 10);
  const filteredQuiz = quizzes.find(
    (q) => q.pastYear === year && q.pastExamType === examType
  ) || null;

  const isCompleted = filteredQuiz?.isCompleted && !filteredQuiz?.hasUpdate;

  return (
    <div className="w-full h-full border border-[#999] bg-[#1A1A1A] flex flex-col overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
      {/* 축소된 헤더 + 드롭다운 */}
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

      {/* 기출 내용 — 단일 퀴즈 full-height */}
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
          <div className="flex flex-col h-full relative">
            {/* 난이도 비디오 — 전체 너비, 크게 */}
            <div className="flex-1 min-h-[120px] relative overflow-hidden bg-black">
              <AutoVideo src={getDifficultyVideo(filteredQuiz.difficulty)} className="absolute inset-0 w-full h-full object-cover" />
            </div>

            {/* 하단 정보 */}
            <div className="flex-shrink-0 bg-[#F5F0E8]">
              <div className="px-4 mt-2">
                <h3 className="text-3xl font-black text-[#1A1A1A] overflow-hidden whitespace-nowrap leading-tight" style={{ textOverflow: '".."' }}>
                  {filteredQuiz.title}
                </h3>
              </div>
              <div className="px-4 mt-0.5">
                <p className="text-sm text-[#1A1A1A]">
                  {filteredQuiz.questionCount}문제 · {filteredQuiz.participantCount}명 참여
                  {filteredQuiz.participantCount > 0 && ` · 평균 ${filteredQuiz.averageScore}점`}
                </p>
              </div>
              <div className="px-4 pb-3 pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onShowDetails?.(filteredQuiz); }}
                  className="flex-1 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                >
                  Details
                </button>
                {isCompleted ? (
                  <div className="relative flex-1" ref={reviewMenuRef}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(!showReviewMenu);
                      }}
                      className="w-full py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors flex items-center justify-center gap-1"
                    >
                      Review
                      <svg className={`w-3 h-3 transition-transform ${showReviewMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <AnimatePresence>
                      {showReviewMenu && (
                        <motion.div
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -5 }}
                          className="absolute bottom-full left-0 right-0 mb-1 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg z-50"
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowReviewMenu(false);
                              onReview?.(filteredQuiz.id);
                            }}
                            className="w-full px-3 py-2 text-sm font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] text-left border-b border-[#EDEAE4]"
                          >
                            모두
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowReviewMenu(false);
                              onReviewWrongOnly?.(filteredQuiz.id);
                            }}
                            className="w-full px-3 py-2 text-sm font-bold text-[#8B1A1A] hover:bg-[#FDEAEA] text-left"
                          >
                            오답만
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onStart(filteredQuiz.id); }}
                    className="flex-1 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
                  >
                    Start
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// ============================================================
// 뉴스 캐러셀 (교수와 동일한 3D perspective + 무한 루프)
// ============================================================

function NewsCarousel({
  midtermQuizzes,
  finalQuizzes,
  pastQuizzes,
  pastExamOptions,
  selectedPastExam,
  onSelectPastExam,
  isLoading,
  onStart,
  onUpdate,
  onShowDetails,
  onReview,
  onReviewWrongOnly,
}: {
  midtermQuizzes: QuizCardData[];
  finalQuizzes: QuizCardData[];
  pastQuizzes: QuizCardData[];
  pastExamOptions: PastExamOption[];
  selectedPastExam: string;
  onSelectPastExam: (value: string) => void;
  isLoading: { midterm: boolean; final: boolean; past: boolean };
  onStart: (quizId: string) => void;
  onUpdate: (quiz: QuizCardData) => void;
  onShowDetails?: (quiz: QuizCardData) => void;
  onReview: (quizId: string) => void;
  onReviewWrongOnly: (quizId: string) => void;
}) {
  const TOTAL = NEWS_CARDS.length; // 3
  // visualIndex: 0=clone_last, 1~3=real cards, 4=clone_first
  const [visualIndex, setVisualIndex] = useState(() => getDefaultCarouselIndex() + 1);
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
      sessionStorage.setItem(QUIZ_CAROUSEL_KEY, String(realIndex));
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
                    whileTap={{ scale: 0.97 }}
                    transition={transitionOn ? { duration: 0.35, ease: 'easeOut' } : { duration: 0 }}
                    className="absolute inset-0 origin-center rounded-sm"
                    style={{ transformStyle: 'preserve-3d' }}
                  >
                  {card.type === 'past' ? (
                    <PastExamNewsCard
                      quizzes={pastQuizzes}
                      isLoading={loadingByType[cardIdx]}
                      onStart={onStart}
                      onShowDetails={onShowDetails}
                      selectedPastExam={selectedPastExam}
                      pastExamOptions={pastExamOptions}
                      onSelectPastExam={onSelectPastExam}
                      onReview={onReview}
                      onReviewWrongOnly={onReviewWrongOnly}
                    />
                  ) : (
                    <NewsCard
                      title={card.title}
                      subtitle={card.subtitle}
                      type={card.type}
                      quizzes={quizzesByType[cardIdx]}
                      isLoading={loadingByType[cardIdx]}
                      onStart={onStart}
                      onUpdate={onUpdate}
                      onShowDetails={onShowDetails}
                      onReview={onReview}
                      onReviewWrongOnly={onReviewWrongOnly}
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
              realIndex === index ? 'bg-[#1A1A1A] w-5' : 'bg-[#D4CFC4] w-2'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 복습 퀴즈 카드 컴포넌트 (Details + Review 드롭다운)
// ============================================================

function ReviewQuizCard({
  quiz,
  onCardClick,
  onDetails,
  onReview,
  onReviewWrongOnly,
  isBookmarked,
  onToggleBookmark,
  hasUpdate,
  onUpdate,
}: {
  quiz: QuizCardData;
  onCardClick: () => void;
  onDetails: () => void;
  onReview: () => void;
  onReviewWrongOnly?: () => void;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  hasUpdate?: boolean;
  onUpdate?: () => void;
}) {
  const tags = quiz.tags || [];
  const [showReviewMenu, setShowReviewMenu] = useState(false);
  const reviewMenuRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (reviewMenuRef.current && !reviewMenuRef.current.contains(event.target as Node)) {
        setShowReviewMenu(false);
      }
    };
    if (showReviewMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showReviewMenu]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, boxShadow: '0 8px 20px rgba(0, 0, 0, 0.08)' }}
      whileTap={{ scale: 0.95, opacity: 0.7 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      onClick={(e) => {
        // 버튼/드롭다운 클릭은 카드 네비게이션 무시
        if ((e.target as HTMLElement).closest('button') || showReviewMenu) return;
        onCardClick();
      }}
      className="relative border border-[#999] bg-[#F5F0E8]/70 backdrop-blur-sm overflow-hidden cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    >
      {/* 신문 배경 텍스트 */}
      <div className="absolute inset-0 p-2 overflow-hidden pointer-events-none">
        <p className="text-[5px] text-[#E8E8E8] leading-tight break-words">
          {NEWSPAPER_BG_TEXT.slice(0, 300)}
        </p>
      </div>

      {/* 업데이트 뱃지 + 북마크 버튼 */}
      <div className="absolute top-2 right-2 z-30 flex items-center gap-1.5">
        {/* 업데이트 뱃지 */}
        {hasUpdate && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdate?.();
            }}
            className="w-6 h-6 bg-[#F5C518] rounded-full flex items-center justify-center border-2 border-[#1A1A1A] hover:scale-110 transition-transform"
          >
            <span className="text-[#1A1A1A] font-bold text-xs">!</span>
          </button>
        )}

        {/* 북마크 버튼 */}
        {onToggleBookmark && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleBookmark();
            }}
            className="flex flex-col items-center transition-transform hover:scale-110"
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
            {(quiz.bookmarkCount ?? 0) > 0 && (
              <span className="text-[10px] text-[#5C5C5C] font-bold mt-0.5">
                {quiz.bookmarkCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* 카드 내용 */}
      <div className="relative z-10 p-4 bg-[#F5F0E8]/60">
        {/* 제목 (2줄 고정 높이) */}
        <div className="h-[44px] mb-2">
          <h3 className="font-bold text-base line-clamp-2 text-[#1A1A1A] leading-snug">
            {quiz.title}
          </h3>
        </div>

        {/* 메타 정보 */}
        <p className="text-sm text-[#5C5C5C] mb-1">
          {quiz.questionCount}문제 · {quiz.participantCount}명 참여
        </p>

        {/* 태그 (2줄 고정 높이) */}
        <div className="h-[48px] mb-2 overflow-hidden">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.slice(0, 8).map((tag) => (
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
          {/* Review 버튼 with 드롭다운 */}
          <div className="relative flex-1" ref={reviewMenuRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (onReviewWrongOnly) {
                  setShowReviewMenu(!showReviewMenu);
                } else {
                  onReview();
                }
              }}
              className="w-full py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors flex items-center justify-center gap-1"
            >
              Review
              {onReviewWrongOnly && (
                <svg className={`w-3 h-3 transition-transform ${showReviewMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              )}
            </button>
            {/* 드롭다운 메뉴 */}
            <AnimatePresence>
              {showReviewMenu && onReviewWrongOnly && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="absolute bottom-full left-0 right-0 mb-1 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg z-50"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowReviewMenu(false);
                      onReview();
                    }}
                    className="w-full px-3 py-2 text-sm font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] text-left border-b border-[#EDEAE4]"
                  >
                    모두
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowReviewMenu(false);
                      onReviewWrongOnly();
                    }}
                    className="w-full px-3 py-2 text-sm font-bold text-[#8B1A1A] hover:bg-[#FDEAEA] text-left"
                  >
                    오답만
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================
// 자작 퀴즈 카드 컴포넌트
// ============================================================

function CustomQuizCard({
  quiz,
  onStart,
  onDetails,
  isBookmarked,
  onToggleBookmark,
  onUpdate,
  onReview,
  onReviewWrongOnly,
}: {
  quiz: QuizCardData;
  onStart: () => void;
  onDetails: () => void;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  onUpdate?: () => void;
  onReview?: () => void;
  onReviewWrongOnly?: () => void;
}) {
  const isCompleted = quiz.isCompleted && !quiz.hasUpdate;
  const hasUpdate = quiz.isCompleted && quiz.hasUpdate;
  const [showReviewMenu, setShowReviewMenu] = useState(false);
  const reviewMenuRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (reviewMenuRef.current && !reviewMenuRef.current.contains(event.target as Node)) {
        setShowReviewMenu(false);
      }
    };
    if (showReviewMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showReviewMenu]);

  return (
    <motion.div
      whileHover={{ y: -4, boxShadow: '0 8px 20px rgba(0, 0, 0, 0.08)' }}
      whileTap={{ scale: 0.95, opacity: 0.7 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="relative border border-[#999] bg-[#F5F0E8]/70 backdrop-blur-sm overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    >
      {/* 신문 배경 텍스트 */}
      <div className="absolute inset-0 p-2 overflow-hidden pointer-events-none">
        <p className="text-[5px] text-[#E8E8E8] leading-tight break-words">
          {NEWSPAPER_BG_TEXT.slice(0, 300)}
        </p>
      </div>

      {/* 업데이트 뱃지 + 지구 아이콘 (AI 공개) + 북마크 버튼 */}
      <div className="absolute top-2 right-2 z-30 flex items-center gap-2">
        {/* 업데이트 뱃지 */}
        {hasUpdate && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdate?.();
            }}
            className="w-6 h-6 bg-[#F5C518] rounded-full flex items-center justify-center border-2 border-[#1A1A1A] hover:scale-110 transition-transform"
          >
            <span className="text-[#1A1A1A] font-bold text-xs">!</span>
          </button>
        )}

        {/* 지구 아이콘 (AI 생성 공개 퀴즈) - 상호작용 없음 */}
        {quiz.isAiGenerated && !isCompleted && (
          <div className="w-5 h-5 flex items-center justify-center text-[#5C5C5C]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
            </svg>
          </div>
        )}

        {/* 북마크 버튼 */}
        {onToggleBookmark && !isCompleted && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleBookmark();
            }}
            className="flex flex-col items-center transition-transform hover:scale-110"
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
          {(quiz.bookmarkCount ?? 0) > 0 && (
            <span className="text-[10px] text-[#5C5C5C] font-bold mt-0.5">
              {quiz.bookmarkCount}
            </span>
          )}
        </button>
        )}
      </div>

      {/* 카드 내용 */}
      <div className="relative z-10 p-4 bg-[#F5F0E8]/60">
        {/* 제목 (2줄 고정 높이) */}
        <div className="h-[44px] mb-2">
          <h3 className="font-bold text-base line-clamp-2 text-[#1A1A1A] pr-6 leading-snug">
            {quiz.title}
          </h3>
        </div>

        {/* 메타 정보 */}
        <p className="text-sm text-[#5C5C5C] mb-1">
          {quiz.questionCount}문제 · {quiz.participantCount}명 참여
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
          {isCompleted ? (
            <div className="relative flex-1" ref={reviewMenuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowReviewMenu(!showReviewMenu);
                }}
                className="w-full py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors flex items-center justify-center gap-1"
              >
                Review
                <svg className={`w-3 h-3 transition-transform ${showReviewMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              <AnimatePresence>
                {showReviewMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="absolute bottom-full left-0 right-0 mb-1 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg z-50"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(false);
                        onReview?.();
                      }}
                      className="w-full px-3 py-2 text-sm font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] text-left border-b border-[#EDEAE4]"
                    >
                      모두
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(false);
                        onReviewWrongOnly?.();
                      }}
                      className="w-full px-3 py-2 text-sm font-bold text-[#8B1A1A] hover:bg-[#FDEAEA] text-left"
                    >
                      오답만
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onStart();
              }}
              className="flex-1 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
            >
              Start
            </button>
          )}
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
// 퀴즈 관리 카드
// ============================================================

function ManageQuizCard({
  quiz,
  onEdit,
  onDelete,
  onStats,
}: {
  quiz: QuizCardData;
  onEdit: () => void;
  onDelete: () => void;
  onStats: () => void;
}) {
  return (
    <motion.div
      whileHover={{ y: -4, boxShadow: '0 8px 20px rgba(0, 0, 0, 0.08)' }}
      whileTap={{ scale: 0.95, opacity: 0.7 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="border border-[#999] bg-[#F5F0E8]/70 backdrop-blur-sm p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] cursor-pointer"
    >
      <div className="h-[44px] mb-2">
        <h3 className="font-bold text-base line-clamp-2 text-[#1A1A1A] leading-snug">
          {quiz.title}
        </h3>
      </div>

      <p className="text-sm text-[#5C5C5C] mb-1">
        {quiz.questionCount}문제 · {quiz.participantCount}명 참여
      </p>

      <div className="h-[48px] mb-3 overflow-hidden">
        {quiz.tags && quiz.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {quiz.tags.slice(0, 5).map((tag) => (
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

      <div className="flex flex-col gap-2">
        {/* 통계 */}
        <button
          onClick={onStats}
          className="w-full py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
        >
          통계
        </button>
        {/* 수정 + 삭제 */}
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="flex-1 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
          >
            수정
          </button>
          <button
            onClick={onDelete}
            className="flex-1 py-2 text-sm font-bold border border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
          >
            삭제
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================
// 메인 페이지 컴포넌트
// ============================================================

function QuizListPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { isBookmarked, toggleBookmark } = useQuizBookmark();
  const { userCourseId, semesterSettings } = useCourse();
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
  const [customQuizzes, setCustomQuizzes] = useState<QuizCardData[]>([]);

  // quiz_completions 기반 완료 데이터 (useRef로 구독 재시작 방지)
  const completionMapRef = useRef<Map<string, number>>(new Map());
  const [completionVer, setCompletionVer] = useState(0);

  const [isLoading, setIsLoading] = useState({
    midterm: true,
    final: true,
    past: true,
    custom: true,
  });

  // 업데이트 정보 포함한 실제 로딩 상태 (퀴즈 + 업데이트 정보 모두 로드 완료 시 false)
  const actualLoading = useMemo(() => ({
    midterm: isLoading.midterm || updatesLoading,
    final: isLoading.final || updatesLoading,
    past: isLoading.past || updatesLoading,
    custom: isLoading.custom || updatesLoading,
  }), [isLoading, updatesLoading]);

  const [selectedQuiz, setSelectedQuiz] = useState<QuizCardData | null>(null);
  const { sourceRect, registerRef, captureRect, clearRect } = useExpandSource();
  const { sourceRect: reviewSourceRect, registerRef: registerReviewRef, captureRect: captureReviewRect, clearRect: clearReviewRect } = useExpandSource();

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

  // 모달 상태
  const [updateModalInfo, setUpdateModalInfo] = useState<QuizUpdateInfo | null>(null);
  const [updateModalQuizCount, setUpdateModalQuizCount] = useState(0);
  const [updateConfirmQuiz, setUpdateConfirmQuiz] = useState<QuizCardData | null>(null);
  const [updateConfirmLoading, setUpdateConfirmLoading] = useState(false);
  const [statsQuiz, setStatsQuiz] = useState<QuizCardData | null>(null);

  // 자작 섹션 탭 (퀴즈 / 복습)
  const [customSectionTab, setCustomSectionTab] = useState<'quiz' | 'review'>('quiz');

  // 스크롤 맨 위로 버튼
  const customSectionRef = useRef<HTMLDivElement>(null);

  // 복습 탭 Details 모달
  const [reviewDetailsQuiz, setReviewDetailsQuiz] = useState<QuizCardData | null>(null);

  // Details 모달 열릴 때 네비게이션 숨김
  useEffect(() => {
    if (selectedQuiz || reviewDetailsQuiz) {
      document.body.setAttribute('data-hide-nav', 'true');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, [selectedQuiz, reviewDetailsQuiz]);

  // 삭제 확인 모달
  const [quizToDelete, setQuizToDelete] = useState<QuizCardData | null>(null);

  // body 스크롤 방지 통합 (모달/관리모드 열림 시 PullToHome 스와이프 방지)
  useEffect(() => {
    const lock = !!quizToDelete || isManageMode;
    document.body.style.overflow = lock ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [quizToDelete, isManageMode]);

  // 삭제 모달 열림 시 네비게이션 숨기기
  useEffect(() => {
    if (quizToDelete) {
      document.body.setAttribute('data-hide-nav', '');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => { document.body.removeAttribute('data-hide-nav'); };
  }, [quizToDelete]);

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
  const { midtermQuizzesWithUpdate, finalQuizzesWithUpdate, pastQuizzesWithUpdate, customQuizzesWithUpdate } = useMemo(() => ({
    midtermQuizzesWithUpdate: applyCompletionAndSort(midtermQuizzes),
    finalQuizzesWithUpdate: applyCompletionAndSort(finalQuizzes),
    pastQuizzesWithUpdate: applyCompletionAndSort(pastQuizzes),
    customQuizzesWithUpdate: applyCompletionAndSort(customQuizzes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [midtermQuizzes, finalQuizzes, pastQuizzes, customQuizzes, completionVer, applyCompletionAndSort]);

  // 태그 필터링된 자작 퀴즈 (퀴즈 탭)
  const filteredCustomQuizzes = useMemo(() => {
    if (selectedTags.length === 0) return customQuizzesWithUpdate;
    return customQuizzesWithUpdate.filter(quiz =>
      selectedTags.every(tag => quiz.tags?.includes(tag))
    );
  }, [customQuizzesWithUpdate, selectedTags]);

  // 태그 필터링된 완료 퀴즈 (복습 탭) - 수정 > 최신순 정렬
  const filteredCompletedQuizzes = useMemo(() => {
    let completed = customQuizzesWithUpdate.filter(q => q.isCompleted);
    if (selectedTags.length > 0) {
      completed = completed.filter(quiz =>
        selectedTags.every(tag => quiz.tags?.includes(tag))
      );
    }
    // 수정 상태 적용 + 정렬: 수정 > 최신순
    return completed.map(quiz => {
      const updateInfo = updatedQuizzes.get(quiz.id);
      if (updateInfo?.hasUpdate) {
        return { ...quiz, hasUpdate: true, updatedQuestionCount: updateInfo.updatedQuestionCount };
      }
      return quiz;
    }).sort((a, b) => {
      if (a.hasUpdate && !b.hasUpdate) return -1;
      if (!a.hasUpdate && b.hasUpdate) return 1;
      return sortByLatest(a, b);
    });
  }, [customQuizzesWithUpdate, selectedTags, updatedQuizzes]);

  // ============================================================
  // 데이터 로드 함수들
  // ============================================================

  // quiz_completions 구독 (useRef로 다른 구독에 영향 안 줌)
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'quiz_completions'),
      where('userId', '==', user.uid)
    );
    const unsub = onSnapshot(q, (snap) => {
      const map = new Map<string, number>();
      snap.forEach(d => {
        const data = d.data();
        map.set(data.quizId, data.score ?? 0);
      });
      completionMapRef.current = map;
      setCompletionVer(v => v + 1);
    });
    return unsub;
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

    setIsLoading((prev) => ({ ...prev, midterm: true, final: true, past: true }));

    const q = query(
      collection(db, 'quizzes'),
      where('type', 'in', ['midterm', 'final', 'past']),
      where('courseId', '==', userCourseId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const midterm: QuizCardData[] = [];
      const final_: QuizCardData[] = [];
      const past: QuizCardData[] = [];

      snapshot.forEach((doc) => {
        const quiz = parseQuizData(doc, user.uid);
        if (quiz.type === 'midterm') midterm.push(quiz);
        else if (quiz.type === 'final') final_.push(quiz);
        else if (quiz.type === 'past') past.push(quiz);
      });

      setMidtermQuizzes(midterm);
      setFinalQuizzes(final_);
      setPastQuizzes(past);
      setIsLoading((prev) => ({ ...prev, midterm: false, final: false, past: false }));
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
      where('courseId', '==', userCourseId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const quizzes: QuizCardData[] = [];
      snapshot.forEach((d) => {
        quizzes.push(parseQuizData(d, user.uid));
      });
      setCustomQuizzes(quizzes);
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
    refreshUpdates();
  };

  const handleEditQuiz = (quizId: string) => {
    // 관리 모드에서 수정 페이지로 이동 시 from=manage 파라미터 추가
    router.push(`/quiz/${quizId}/edit?from=manage`);
  };

  const handleDeleteQuiz = (quiz: QuizCardData) => {
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

  // 관리 모드
  if (isManageMode) {
    return (
      <div className="fixed inset-0 overflow-y-auto overscroll-contain pb-28 z-[5]" style={{ backgroundColor: '#F5F0E8' }}>
        <header className="px-4 pt-4 pb-3 border-b border-[#EDEAE4]">
          <div className="flex items-center justify-between gap-4">
            <Image
              src={ribbonImage}
              alt="Quiz"
              width={120}
              height={60}
              className="object-contain"
              style={{ transform: `scale(${ribbonScale})` }}
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
                  onDelete={() => handleDeleteQuiz(quiz)}
                  onStats={() => setStatsQuiz(quiz)}
                />
              ))}
            </div>
          )}
        </main>

        {/* 통계 모달 */}
        {statsQuiz && (
          <QuizStatsModal
            quizId={statsQuiz.id}
            quizTitle={statsQuiz.title}
            isOpen={true}
            onClose={() => setStatsQuiz(null)}
          />
        )}

        {/* 삭제 확인 모달 */}
        {quizToDelete && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50"
            onClick={() => setQuizToDelete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
            >
              {/* 아이콘 */}
              <div className="flex justify-center mb-4">
                <div className="w-12 h-12 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                  <svg
                    className="w-6 h-6 text-[#8B1A1A]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </div>
              </div>

              <h3 className="text-center font-bold text-lg text-[#1A1A1A] mb-2">
                퀴즈를 삭제할까요?
              </h3>
              <p className="text-sm text-[#5C5C5C] mb-1">
                - 삭제된 퀴즈는 복구할 수 없습니다.
              </p>
              <p className="text-sm text-[#5C5C5C] mb-6">
                - 이미 푼 사람은 복습 가능합니다.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setQuizToDelete(null)}
                  className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={confirmDeleteQuiz}
                  className="flex-1 py-3 font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] transition-colors"
                >
                  삭제
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    );
  }

  // 메인 페이지
  return (
    <div className="min-h-screen pb-72" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 - 배너 이미지 */}
      <header className="flex flex-col items-center">
        <div className="w-full h-[230px]">
          <img
            src={ribbonImage}
            alt="Quiz"
            className="w-full h-full object-contain"
            style={{ transform: `scale(${ribbonScale}) scaleX(1.15)` }}
          />
        </div>

        {/* 버튼 영역 */}
        <div className="w-full px-4 py-2 flex items-center justify-between">
          <button
            onClick={() => setIsManageMode(true)}
            className="px-4 py-3 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors"
          >
            퀴즈 관리
          </button>
          <button
            onClick={() => router.push('/quiz/create')}
            className="px-4 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#3A3A3A] transition-colors"
          >
            퀴즈 만들기
          </button>
        </div>
      </header>

      {/* 뉴스 캐러셀 (중간/기말/기출) */}
      <section className="mt-3 mb-8">
        <NewsCarousel
          midtermQuizzes={midtermQuizzesWithUpdate}
          finalQuizzes={finalQuizzesWithUpdate}
          pastQuizzes={pastQuizzesWithUpdate}
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
        <div ref={customSectionRef} className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black text-[#1A1A1A] shrink-0">자작</h2>

          {/* 탭 버튼 */}
          <div className="relative flex items-stretch bg-[#EDEAE4] border border-[#1A1A1A] overflow-hidden">
            <motion.div
              className="absolute h-full bg-[#1A1A1A]"
              initial={false}
              animate={{ left: customSectionTab === 'quiz' ? '0%' : '50%' }}
              style={{ width: '50%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
            <button
              onClick={() => setCustomSectionTab('quiz')}
              className={`relative z-10 w-1/2 px-6 py-3 text-sm font-bold transition-colors text-center ${
                customSectionTab === 'quiz' ? 'text-[#F5F0E8]' : 'text-[#1A1A1A]'
              }`}
            >
              퀴즈
            </button>
            <button
              onClick={() => setCustomSectionTab('review')}
              className={`relative z-10 w-1/2 px-6 py-3 text-sm font-bold transition-colors text-center ${
                customSectionTab === 'review' ? 'text-[#F5F0E8]' : 'text-[#1A1A1A]'
              }`}
            >
              복습
            </button>
          </div>
        </div>

        {/* 태그 검색 영역 (우측 정렬) */}
        <div className="flex items-center justify-end gap-2 mb-4">
          {/* 선택된 태그들 */}
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

          {/* 태그 검색 버튼 */}
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

        {/* 태그 필터 목록 */}
        <AnimatePresence>
          {showTagFilter && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-4"
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

        {/* 퀴즈 탭 */}
        {customSectionTab === 'quiz' && (
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
                      onReviewWrongOnly={() => router.push(`/review/library/${quiz.id}?from=quiz&autoStart=wrongOnly`)}
                    />
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 복습 탭 - 완료된 자작 퀴즈 */}
        {customSectionTab === 'review' && (
          <>
            {actualLoading.custom && (
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            )}

            {!actualLoading.custom && customQuizzes.filter(q => q.isCompleted).length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center text-center py-12"
              >
                <h3 className="text-lg font-black mb-2 text-[#1A1A1A]">
                  복습할 퀴즈가 없습니다
                </h3>
                <p className="text-sm text-[#5C5C5C]">
                  퀴즈를 풀면 여기에 표시됩니다
                </p>
              </motion.div>
            )}

            {/* 필터링 결과가 없을 때 */}
            {!actualLoading.custom && customQuizzes.filter(q => q.isCompleted).length > 0 && filteredCompletedQuizzes.length === 0 && selectedTags.length > 0 && (
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

            {!actualLoading.custom && filteredCompletedQuizzes.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {filteredCompletedQuizzes.map((quiz, index) => (
                  <motion.div
                    key={quiz.id}
                    ref={(el) => registerReviewRef(quiz.id, el)}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                  >
                    <ReviewQuizCard
                      quiz={quiz}
                      onCardClick={() => router.push(`/review/library/${quiz.id}?from=quiz`)}
                      onDetails={() => { captureReviewRect(quiz.id); setReviewDetailsQuiz(quiz); }}
                      onReview={() => router.push(`/review/library/${quiz.id}?from=quiz&autoStart=all`)}
                      onReviewWrongOnly={() => router.push(`/review/library/${quiz.id}?from=quiz&autoStart=wrongOnly`)}
                      isBookmarked={isBookmarked(quiz.id)}
                      onToggleBookmark={() => toggleBookmark(quiz.id)}
                      hasUpdate={quiz.hasUpdate}
                      onUpdate={() => handleOpenUpdateModal(quiz)}
                    />
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* 퀴즈 상세 모달 */}
      <ExpandModal
        isOpen={!!selectedQuiz}
        onClose={() => { setSelectedQuiz(null); clearRect(); }}
        sourceRect={sourceRect}
        className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
      >
        {selectedQuiz && (
          <>
            <h2 className="text-lg font-bold text-[#1A1A1A] mb-4">{selectedQuiz.title}</h2>

            {/* 미완료: 평균 점수 대형 박스 (Start 버전) */}
            {!selectedQuiz.isCompleted && (
              <div className="text-center py-4 mb-4 border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]">
                <p className="text-xs text-[#5C5C5C] mb-1">평균 점수</p>
                <p className="text-4xl font-black text-[#1A1A1A]">
                  {selectedQuiz.participantCount > 0
                    ? <>{(selectedQuiz.averageScore ?? 0).toFixed(0)}<span className="text-lg font-bold">점</span></>
                    : '-'}
                </p>
              </div>
            )}

            <div className="space-y-2 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">문제 수</span>
                <span className="font-bold text-[#1A1A1A]">{selectedQuiz.questionCount}문제</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">참여자</span>
                <span className="font-bold text-[#1A1A1A]">{selectedQuiz.participantCount}명</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">난이도</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedQuiz.difficulty === 'easy' ? '쉬움' : selectedQuiz.difficulty === 'hard' ? '어려움' : '보통'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">문제 유형</span>
                <span className="font-bold text-[#1A1A1A]">
                  {formatQuestionTypes(
                    selectedQuiz.oxCount || 0,
                    selectedQuiz.multipleChoiceCount || 0,
                    selectedQuiz.subjectiveCount || 0
                  )}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">제작자</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedQuiz.creatorNickname || '익명'}
                  {selectedQuiz.creatorClassType && ` · ${selectedQuiz.creatorClassType}반`}
                </span>
              </div>

              {/* 완료: 평균 점수 행 + 퀴즈/복습 점수 (Review 버전) */}
              {selectedQuiz.isCompleted && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#5C5C5C]">평균 점수</span>
                    <span className="font-bold text-[#1A1A1A]">
                      {selectedQuiz.participantCount > 0
                        ? `${(selectedQuiz.averageScore ?? 0).toFixed(0)}점`
                        : '-'}
                    </span>
                  </div>
                  <div className="py-3 border-t border-[#A0A0A0]">
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-5xl font-black text-[#1A1A1A]">
                        {selectedQuiz.myScore !== undefined ? selectedQuiz.myScore : '-'}
                      </span>
                      <span className="text-xl text-[#5C5C5C]">/</span>
                      <span className="text-5xl font-black text-[#1A1A1A]">
                        {selectedQuiz.myFirstReviewScore !== undefined ? selectedQuiz.myFirstReviewScore : '-'}
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-6 mt-1">
                      <span className="text-xs text-[#5C5C5C]">퀴즈</span>
                      <span className="text-xs text-[#5C5C5C]">복습</span>
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
                        className="px-2 py-1 bg-[#1A1A1A] text-[#F5F0E8] text-sm font-medium"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setSelectedQuiz(null); clearRect(); }}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
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
                className="flex-1 py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
              >
                {selectedQuiz.isCompleted ? '복습하기' : '시작하기'}
              </button>
            </div>
          </>
        )}
      </ExpandModal>

      {/* 복습 탭 Details 모달 */}
      <ExpandModal
        isOpen={!!reviewDetailsQuiz}
        onClose={() => { setReviewDetailsQuiz(null); clearReviewRect(); }}
        sourceRect={reviewSourceRect}
        className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
        zIndex={60}
      >
        {reviewDetailsQuiz && (
          <>
            <h2 className="text-2xl font-bold text-[#1A1A1A] mb-4">
              {reviewDetailsQuiz.title}
            </h2>

            <div className="space-y-2 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">문제 수</span>
                <span className="font-bold text-[#1A1A1A]">{reviewDetailsQuiz.questionCount}문제</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">참여자</span>
                <span className="font-bold text-[#1A1A1A]">{reviewDetailsQuiz.participantCount}명</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">난이도</span>
                <span className="font-bold text-[#1A1A1A]">
                  {reviewDetailsQuiz.difficulty === 'easy' ? '쉬움' : reviewDetailsQuiz.difficulty === 'hard' ? '어려움' : '보통'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">문제 유형</span>
                <span className="font-bold text-[#1A1A1A]">
                  {formatQuestionTypes(
                    reviewDetailsQuiz.oxCount || 0,
                    reviewDetailsQuiz.multipleChoiceCount || 0,
                    reviewDetailsQuiz.subjectiveCount || 0
                  )}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">제작자</span>
                <span className="font-bold text-[#1A1A1A]">
                  {reviewDetailsQuiz.creatorNickname || '익명'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">평균 점수</span>
                <span className="font-bold text-[#1A1A1A]">
                  {reviewDetailsQuiz.participantCount > 0
                    ? `${(reviewDetailsQuiz.averageScore ?? 0).toFixed(0)}점`
                    : '-'}
                </span>
              </div>
              {/* 점수 표시: 퀴즈 점수 / 첫번째 복습 점수 */}
              <div className="py-3 border-t border-[#A0A0A0]">
                <div className="flex items-center justify-center gap-3">
                  <span className="text-5xl font-black text-[#1A1A1A]">
                    {reviewDetailsQuiz.myScore !== undefined ? reviewDetailsQuiz.myScore : '-'}
                  </span>
                  <span className="text-xl text-[#5C5C5C]">/</span>
                  <span className="text-5xl font-black text-[#1A1A1A]">
                    {reviewDetailsQuiz.myFirstReviewScore !== undefined ? reviewDetailsQuiz.myFirstReviewScore : '-'}
                  </span>
                </div>
                <div className="flex items-center justify-center gap-6 mt-1">
                  <span className="text-xs text-[#5C5C5C]">퀴즈</span>
                  <span className="text-xs text-[#5C5C5C]">복습</span>
                </div>
              </div>
              {reviewDetailsQuiz.tags && reviewDetailsQuiz.tags.length > 0 && (
                <div className="pt-2 border-t border-[#A0A0A0]">
                  <div className="flex flex-wrap gap-1.5">
                    {reviewDetailsQuiz.tags.map((tag) => (
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

            <div className="flex gap-3">
              <button
                onClick={() => { setReviewDetailsQuiz(null); clearReviewRect(); }}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  const quiz = reviewDetailsQuiz;
                  setReviewDetailsQuiz(null);
                  clearReviewRect();
                  router.push(`/review/library/${quiz.id}?from=quiz`);
                }}
                className="flex-1 py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
              >
                복습하기
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
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            {/* 아이콘 */}
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                <svg
                  className="w-6 h-6 text-[#1A1A1A]"
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

            <h3 className="text-center font-bold text-lg text-[#1A1A1A] mb-2">
              수정된 문제를 풀까요?
            </h3>
            <p className="text-sm text-[#5C5C5C] mb-1">
              - 수정된 {updateConfirmQuiz.updatedQuestionCount || '일부'}문제만 다시 풀 수 있습니다.
            </p>
            <p className="text-sm text-[#5C5C5C] mb-1">
              - 새로운 답변이 점수에 반영됩니다.
            </p>
            <p className="text-sm text-[#5C5C5C] mb-6">
              - 정답 여부와 복습 기록이 업데이트됩니다.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setUpdateConfirmQuiz(null)}
                disabled={updateConfirmLoading}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleConfirmUpdate}
                disabled={updateConfirmLoading}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
      {quizToDelete && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setQuizToDelete(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            {/* 아이콘 */}
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                <svg
                  className="w-6 h-6 text-[#8B1A1A]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </div>
            </div>

            <h3 className="text-center font-bold text-lg text-[#1A1A1A] mb-2">
              퀴즈를 삭제할까요?
            </h3>
            <p className="text-center text-sm text-[#5C5C5C] mb-1">
              삭제해도 이미 푼 사람은 복습 가능합니다.
            </p>
            <p className="text-center text-sm text-[#5C5C5C] mb-6">
              삭제된 퀴즈는 복구할 수 없습니다.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setQuizToDelete(null)}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                취소
              </button>
              <button
                onClick={confirmDeleteQuiz}
                className="flex-1 py-3 font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] transition-colors"
              >
                삭제
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* 스크롤 맨 위로 버튼 */}
      <ScrollToTopButton targetRef={customSectionRef} bottom="bottom-[120px]" side="left" />
    </div>
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
