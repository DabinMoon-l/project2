'use client';

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Skeleton } from '@/components/common';
import AutoVideo, { getDifficultyVideo } from '@/components/quiz/AutoVideo';
import { NEWSPAPER_BG_TEXT, formatQuestionTypes } from '@/lib/utils/quizHelpers';
import { scaleCoord } from '@/lib/hooks/useViewportScale';
import {
  QUIZ_CAROUSEL_KEY,
  QUIZ_SCROLL_KEY,
  getDefaultCarouselIndex,
  CompletedBadge,
} from './quizPageParts';
import type { NewsCardType, QuizCardData, CarouselCard } from './quizPageParts';
import type { PastExamOption } from '@/lib/types/course';

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
  const isPerfectScore = quiz.myScore === 100;
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
          className="absolute top-2 right-2 z-30 w-5 h-5 bg-[#F5C518] rounded-full flex items-center justify-center border border-[#1A1A1A] hover:scale-110 transition-transform"
        >
          <span className="text-[#1A1A1A] font-bold text-[9px] leading-none">!</span>
        </button>
      )}

      {/* 난이도 비디오 — 남은 공간 전부 채움 (태그 min-h로 크기 통일) */}
      <div className="flex-1 min-h-0 relative overflow-hidden bg-black">
        <AutoVideo src={getDifficultyVideo(quiz.difficulty)} className="absolute inset-0 w-full h-full object-cover" />
      </div>

      {/* 하단 정보 — 고정 높이, 절대 줄어들지 않음 */}
      <div className="flex-shrink-0 bg-[#F5F0E8]">
        <div className="px-3 mt-1.5">
          <h3 className="text-3xl font-black text-[#1A1A1A] overflow-hidden whitespace-nowrap leading-tight" style={{ textOverflow: '".."' }}>
            {quiz.title}
          </h3>
        </div>
        <div className="px-3 mt-0.5">
          <p className="text-sm text-[#1A1A1A]">
            {quiz.questionCount}문제 · {formatQuestionTypes(quiz.oxCount, quiz.multipleChoiceCount, quiz.subjectiveCount)}
            {quiz.participantCount > 0 && ` · ${quiz.participantCount}명 참여`}
          </p>
        </div>
        <div className="px-3 pb-3 pt-1.5 flex gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDetails?.(); }}
            className="flex-1 py-3 text-base font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
          >
            Details
          </button>
          {isCompleted ? (
            isPerfectScore ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onReview?.(); }}
                className="flex-1 py-3 text-base font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors rounded-lg"
              >
                Review
              </button>
            ) : (
            <div className="relative flex-1" ref={reviewMenuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowReviewMenu(!showReviewMenu);
                }}
                className="w-full py-3 text-base font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors flex items-center justify-center gap-1 rounded-lg"
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
                    className="absolute bottom-full left-0 right-0 mb-1 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg z-50 rounded-lg overflow-hidden"
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
            )
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStart(); }}
              className="flex-1 py-3 text-base font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors rounded-lg"
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
    <div className="w-full h-full border border-[#999] bg-[#1A1A1A] flex flex-col overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.3)] rounded-xl">
      {/* 축소된 헤더 */}
      <div className="bg-[#1A1A1A] text-[#F5F0E8] px-4 py-1.5 text-center flex-shrink-0">
        <h1 className="font-serif text-lg font-black tracking-tight">{title}</h1>
        <p className="text-[9px] tracking-widest">{subtitle}</p>
      </div>

      {/* 퀴즈 목록 — 자유 스크롤. bg 검정 → 헤더-비디오 사이 틈 안 보임 */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[#1A1A1A]" data-scroll-inner>
        {isLoading ? (
          <div className="flex items-center justify-center h-full bg-[#F5F0E8]">
            <div className="animate-pulse text-[#5C5C5C]">로딩 중...</div>
          </div>
        ) : quizzes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center bg-[#F5F0E8]">
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
  const isPerfectScore = filteredQuiz?.myScore === 100;

  return (
    <div className="w-full h-full border border-[#999] bg-[#1A1A1A] flex flex-col overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.3)] rounded-xl">
      {/* 축소된 헤더 + 드롭다운 */}
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
                  className="absolute right-0 top-full mt-1 z-20 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg min-w-[100px] rounded-lg overflow-hidden"
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
            {/* 난이도 비디오 — 남은 공간 전부 채움 */}
            <div className="flex-1 min-h-0 relative overflow-hidden bg-black">
              <AutoVideo src={getDifficultyVideo(filteredQuiz.difficulty)} className="absolute inset-0 w-full h-full object-cover" />
            </div>

            {/* 하단 정보 */}
            <div className="flex-shrink-0 bg-[#F5F0E8]">
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
                  onClick={(e) => { e.stopPropagation(); onShowDetails?.(filteredQuiz); }}
                  className="flex-1 py-3 text-base font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
                >
                  Details
                </button>
                {isCompleted ? (
                  isPerfectScore ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onReview?.(filteredQuiz.id); }}
                      className="flex-1 py-3 text-base font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors rounded-lg"
                    >
                      Review
                    </button>
                  ) : (
                  <div className="relative flex-1" ref={reviewMenuRef}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(!showReviewMenu);
                      }}
                      className="w-full py-3 text-base font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors flex items-center justify-center gap-1 rounded-lg"
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
                          className="absolute bottom-full left-0 right-0 mb-1 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg z-50 rounded-lg overflow-hidden"
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
                  )
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onStart(filteredQuiz.id); }}
                    className="flex-1 py-3 text-base font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors rounded-lg"
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
// 단독 퀴즈 카드 (각 independent/professor/professor-ai 퀴즈 개별 표시)
// ============================================================

const SingleQuizNewsCard = memo(function SingleQuizNewsCard({
  quiz,
  onStart,
  onShowDetails,
  onReview,
  onReviewWrongOnly,
}: {
  quiz: QuizCardData;
  onStart: (quizId: string) => void;
  onShowDetails?: (quiz: QuizCardData) => void;
  onReview: (quizId: string) => void;
  onReviewWrongOnly: (quizId: string) => void;
}) {
  return (
    <div className="w-full h-full border border-[#999] bg-[#1A1A1A] flex flex-col overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.3)] rounded-xl">
      {/* 헤더 */}
      <div className="bg-[#1A1A1A] text-[#F5F0E8] px-4 py-1.5 text-center flex-shrink-0">
        <p className="text-[6px] tracking-[0.2em] mb-0.5 opacity-60">━━━━━━━━━━━━━━━━</p>
        <h1 className="font-serif text-lg font-black tracking-tight">SPECIAL QUIZ</h1>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden" data-scroll-inner>
        <NewsArticle
          quiz={quiz}
          onStart={() => onStart(quiz.id)}
          onDetails={onShowDetails ? () => onShowDetails(quiz) : undefined}
          onReview={() => onReview(quiz.id)}
          onReviewWrongOnly={() => onReviewWrongOnly(quiz.id)}
        />
      </div>
    </div>
  );
});

// ============================================================
// 뉴스 캐러셀 (교수와 동일한 3D perspective + 무한 루프)
// ============================================================

export function NewsCarousel({
  midtermQuizzes,
  finalQuizzes,
  pastQuizzes,
  independentQuizzes,
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
  independentQuizzes: QuizCardData[];
  pastExamOptions: PastExamOption[];
  selectedPastExam: string;
  onSelectPastExam: (value: string) => void;
  isLoading: { midterm: boolean; final: boolean; past: boolean; independent: boolean };
  onStart: (quizId: string) => void;
  onUpdate: (quiz: QuizCardData) => void;
  onShowDetails?: (quiz: QuizCardData) => void;
  onReview: (quizId: string) => void;
  onReviewWrongOnly: (quizId: string) => void;
}) {
  // 동적 카드 배열: 비어있지 않은 고정 카드 + 단독 퀴즈
  const carouselCards: CarouselCard[] = useMemo(() => {
    const cards: CarouselCard[] = [];
    if (midtermQuizzes.length > 0) {
      cards.push({ kind: 'list', type: 'midterm', title: 'MIDTERM PREP', subtitle: 'Vol.1 · Midterm Edition' });
    }
    if (pastQuizzes.length > 0) {
      cards.push({ kind: 'past' });
    }
    if (finalQuizzes.length > 0) {
      cards.push({ kind: 'list', type: 'final', title: 'FINAL PREP', subtitle: 'Vol.2 · Final Edition' });
    }
    for (const quiz of independentQuizzes) {
      cards.push({ kind: 'single', quiz });
    }
    // 교수가 퀴즈를 하나도 업로드하지 않은 경우 플레이스홀더
    if (cards.length === 0) {
      cards.push({ kind: 'list', type: 'midterm', title: 'QUIZ ARCHIVE', subtitle: 'Coming Soon' });
    }
    return cards;
  }, [midtermQuizzes, pastQuizzes, finalQuizzes, independentQuizzes]);

  // 카드 인덱스 → 퀴즈 배열/로딩 매핑 (auto-navigation에서 사용하므로 먼저 선언)
  const quizzesByIndex: QuizCardData[][] = useMemo(() =>
    carouselCards.map(card => {
      if (card.kind === 'past') return pastQuizzes;
      if (card.kind === 'single') return [card.quiz];
      if (card.kind === 'list') {
        if (card.type === 'midterm') return midtermQuizzes;
        if (card.type === 'final') return finalQuizzes;
      }
      return [];
    }),
    [carouselCards, midtermQuizzes, pastQuizzes, finalQuizzes]
  );

  const loadingByIndex: boolean[] = useMemo(() =>
    carouselCards.map(card => {
      if (card.kind === 'past') return isLoading.past;
      if (card.kind === 'single') return isLoading.independent;
      if (card.kind === 'list') {
        if (card.type === 'midterm') return isLoading.midterm;
        if (card.type === 'final') return isLoading.final;
      }
      return false;
    }),
    [carouselCards, isLoading]
  );

  const TOTAL = carouselCards.length;
  // visualIndex: 0=clone_last, 1~TOTAL=real cards, TOTAL+1=clone_first
  const [visualIndex, setVisualIndex] = useState(() => getDefaultCarouselIndex(TOTAL) + 1);
  const [transitionOn, setTransitionOn] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  // 카드별 래퍼 ref (클론 스크롤 동기화용)
  const cardWrapperRefs = useRef<(HTMLDivElement | null)[]>([]);
  // 최신 퀴즈 탭 자동 이동 (최초 1회만)
  const autoNavigatedRef = useRef(false);
  // TOTAL 변경 추적
  const prevTotalRef = useRef(TOTAL);

  // TOTAL이 변경되면 visualIndex 보정
  useEffect(() => {
    if (prevTotalRef.current !== TOTAL && TOTAL > 0) {
      setTransitionOn(false);
      setVisualIndex(prev => {
        const real = prev <= 0 ? TOTAL - 1 : prev > prevTotalRef.current ? 0 : prev - 1;
        return Math.min(real, TOTAL - 1) + 1;
      });
      prevTotalRef.current = TOTAL;
      requestAnimationFrame(() => setTransitionOn(true));
    }
  }, [TOTAL]);

  // 실제 인덱스 (0 ~ TOTAL-1)
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

  // 데이터 로드 후 최신 퀴즈가 있는 탭으로 자동 이동 (세션 내 1회)
  useEffect(() => {
    if (autoNavigatedRef.current) return;
    if (isLoading.midterm || isLoading.final || isLoading.past || isLoading.independent) return;
    autoNavigatedRef.current = true;
    // 유저가 직접 스와이프한 적 있으면 유지
    if (sessionStorage.getItem('quiz_carousel_user_set') === '1') return;

    // 각 카드의 최신 퀴즈 createdAt 비교 (동적 카드 배열 기반)
    let latestTime = 0;
    let latestIndex = 0;
    quizzesByIndex.forEach((quizzes, index) => {
      for (const q of quizzes) {
        const ca = q.createdAt;
        const t = ca instanceof Date ? ca.getTime()
          : ca?.toMillis ? ca.toMillis()
          : ca?.seconds ? ca.seconds * 1000
          : 0;
        if (t > latestTime) {
          latestTime = t;
          latestIndex = index;
        }
      }
    });
    setTransitionOn(false);
    setVisualIndex(latestIndex + 1);
    requestAnimationFrame(() => setTransitionOn(true));
  }, [isLoading, quizzesByIndex, TOTAL]);

  // 클론 카드 스크롤을 실제 카드와 동기화
  const syncCloneScroll = useCallback(() => {
    const refs = cardWrapperRefs.current;
    const getScroller = (el: HTMLDivElement | null) =>
      el?.querySelector<HTMLElement>('[data-scroll-inner]');
    const clone0 = getScroller(refs[0]);
    const realLast = getScroller(refs[TOTAL]);
    if (clone0 && realLast) clone0.scrollTop = realLast.scrollTop;
    const cloneEnd = getScroller(refs[TOTAL + 1]);
    const realFirst = getScroller(refs[1]);
    if (cloneEnd && realFirst) cloneEnd.scrollTop = realFirst.scrollTop;
  }, [TOTAL]);

  const goToNext = useCallback(() => {
    syncCloneScroll();
    setTransitionOn(true);
    setVisualIndex((prev) => prev + 1);
    sessionStorage.setItem('quiz_carousel_user_set', '1');
  }, [syncCloneScroll]);

  const goToPrev = useCallback(() => {
    syncCloneScroll();
    setTransitionOn(true);
    setVisualIndex((prev) => prev - 1);
    sessionStorage.setItem('quiz_carousel_user_set', '1');
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

  // 확장 카드: [clone_last, card_0, ..., card_N-1, clone_first]
  const extendedCardIndices = useMemo(
    () => [TOTAL - 1, ...Array.from({ length: TOTAL }, (_, i) => i), 0],
    [TOTAL]
  );

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
            // 고유 키 생성
            const cardKey = card.kind === 'single' ? `single-${card.quiz.id}-${i}` : `${card.kind}-${i}`;

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
                      opacity: isActive ? 0.15 : 0.04,
                      scaleX: isActive ? 0.88 : 0.78,
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
                    whileTap={{ scale: 0.97 }}
                    transition={transitionOn ? { duration: 0.35, ease: 'easeOut' } : { duration: 0 }}
                    className="absolute inset-0 origin-center rounded-xl"
                    style={{ transformStyle: 'preserve-3d' }}
                  >
                  {card.kind === 'past' ? (
                    <PastExamNewsCard
                      quizzes={pastQuizzes}
                      isLoading={loadingByIndex[cardIdx]}
                      onStart={onStart}
                      onShowDetails={onShowDetails}
                      selectedPastExam={selectedPastExam}
                      pastExamOptions={pastExamOptions}
                      onSelectPastExam={onSelectPastExam}
                      onReview={onReview}
                      onReviewWrongOnly={onReviewWrongOnly}
                    />
                  ) : card.kind === 'single' ? (
                    <SingleQuizNewsCard
                      quiz={card.quiz}
                      onStart={onStart}
                      onShowDetails={onShowDetails}
                      onReview={onReview}
                      onReviewWrongOnly={onReviewWrongOnly}
                    />
                  ) : (
                    <NewsCard
                      title={card.title}
                      subtitle={card.subtitle}
                      type={card.type}
                      quizzes={quizzesByIndex[cardIdx]}
                      isLoading={loadingByIndex[cardIdx]}
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
// 복습 퀴즈 카드 컴포넌트 (Details + Review 드롭다운)
// ============================================================

export function ReviewQuizCard({
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
      <div className="absolute top-2 right-2 z-30 flex items-start gap-1.5">
        {/* 업데이트 뱃지 */}
        {hasUpdate && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdate?.();
            }}
            className="w-5 h-5 bg-[#F5C518] rounded-full flex items-center justify-center border border-[#1A1A1A] hover:scale-110 transition-transform"
          >
            <span className="text-[#1A1A1A] font-bold text-[9px] leading-none">!</span>
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
      <div className="relative z-10 p-3 bg-[#F5F0E8]/60">
        {/* 제목 (2줄 고정 높이) */}
        <div className="h-[36px] mb-1.5">
          <h3 className="font-bold text-sm line-clamp-2 text-[#1A1A1A] leading-snug">
            {quiz.title}
          </h3>
        </div>

        {/* 메타 정보 */}
        <p className="text-xs text-[#5C5C5C] mb-1">
          {quiz.questionCount}문제 · {quiz.participantCount}명 참여
        </p>

        {/* 태그 (2줄 고정 높이) */}
        <div className="h-[42px] mb-1.5 overflow-hidden">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.slice(0, 8).map((tag) => (
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
              className="w-full py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors flex items-center justify-center gap-0.5 rounded-lg"
            >
              Review
              {onReviewWrongOnly && (
                <svg className={`w-2.5 h-2.5 transition-transform ${showReviewMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
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
                  className="absolute bottom-full left-0 right-0 mb-1 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg z-50 rounded-lg overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowReviewMenu(false);
                      onReview();
                    }}
                    className="w-full px-2.5 py-1.5 text-xs font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] text-left border-b border-[#EDEAE4]"
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
                    className="w-full px-2.5 py-1.5 text-xs font-bold text-[#8B1A1A] hover:bg-[#FDEAEA] text-left"
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

export function CustomQuizCard({
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
      className="relative border border-[#999] bg-[#F5F0E8]/70 backdrop-blur-sm overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.06)] rounded-xl"
    >
      {/* 신문 배경 텍스트 */}
      <div className="absolute inset-0 p-2 overflow-hidden pointer-events-none">
        <p className="text-[5px] text-[#E8E8E8] leading-tight break-words">
          {NEWSPAPER_BG_TEXT.slice(0, 300)}
        </p>
      </div>

      {/* 업데이트 뱃지 + 북마크 + 지구 아이콘 (세로 배치) */}
      <div className="absolute top-2 right-2 z-30 flex flex-col items-center gap-1">
        {/* 업데이트 뱃지 */}
        {hasUpdate && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdate?.();
            }}
            className="w-5 h-5 bg-[#F5C518] rounded-full flex items-center justify-center border border-[#1A1A1A] hover:scale-110 transition-transform"
          >
            <span className="text-[#1A1A1A] font-bold text-[9px] leading-none">!</span>
          </button>
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

        {/* 지구 아이콘 (AI 생성 공개 퀴즈) — 찜 아이콘 아래 */}
        {quiz.isAiGenerated && !isCompleted && (
          <div className="w-5 h-5 flex items-center justify-center text-[#5C5C5C]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
            </svg>
          </div>
        )}
      </div>

      {/* 완료 오버레이 */}
      {isCompleted && (
        <div className="absolute inset-0 z-20 bg-black/65 flex items-center justify-center pointer-events-none">
          <CompletedBadge size="small" />
        </div>
      )}

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
            className="flex-1 py-1.5 text-[11px] font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
          >
            Details
          </button>
          {isCompleted ? (
            <div className="flex-1 py-1.5 text-[11px] font-bold bg-[#1A1A1A]/40 text-[#F5F0E8] text-center rounded-lg cursor-default">
              Review
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onStart();
              }}
              className="flex-1 py-1.5 text-[11px] font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors rounded-lg"
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

export function SkeletonCard() {
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

export function ManageQuizCard({
  quiz,
  onEdit,
  onDelete,
  onStats,
}: {
  quiz: QuizCardData;
  onEdit: () => void;
  onDelete: (rect: { x: number; y: number; width: number; height: number }) => void;
  onStats: (rect: { x: number; y: number; width: number; height: number }) => void;
}) {
  return (
    <motion.div
      whileHover={{ y: -4, boxShadow: '0 8px 20px rgba(0, 0, 0, 0.08)' }}
      whileTap={{ scale: 0.95, opacity: 0.7 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="relative border border-[#999] bg-[#F5F0E8]/70 backdrop-blur-sm overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.06)] rounded-xl"
    >
      {/* 신문 배경 */}
      <div className="absolute inset-0 p-2 overflow-hidden pointer-events-none">
        <p className="text-[5px] text-[#E8E8E8] leading-tight break-words">
          {NEWSPAPER_BG_TEXT.slice(0, 300)}
        </p>
      </div>

      <div className="relative z-10 p-3 bg-[#F5F0E8]/60">
        <div className="mb-2">
          <h3 className="font-bold text-sm line-clamp-2 text-[#1A1A1A] leading-snug">
            {quiz.title}
          </h3>
        </div>

        <div className="flex flex-col gap-1.5">
          <button
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onStats({ x: r.x, y: r.y, width: r.width, height: r.height });
            }}
            className="w-full py-1.5 text-[11px] font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
          >
            통계
          </button>
          <div className="flex gap-1.5">
            <button
              onClick={onEdit}
              className="flex-1 py-1.5 text-[11px] font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
            >
              수정
            </button>
            <button
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onDelete({ x: r.x, y: r.y, width: r.width, height: r.height });
              }}
              className="flex-1 py-1.5 text-[11px] font-bold border border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors rounded-lg"
            >
              삭제
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
