'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { useRouter } from 'next/navigation';
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
import { Skeleton } from '@/components/common';
import { useCourse } from '@/lib/contexts';
import { COURSES, getCurrentSemesterByDate, getDefaultQuizTab, getPastExamOptions, type PastExamOption } from '@/lib/types/course';

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
}

// ============================================================
// 상수
// ============================================================

const NEWS_CARDS: { type: NewsCardType; title: string; subtitle: string }[] = [
  { type: 'midterm', title: 'MIDTERM PREP', subtitle: 'Vol.1 · Midterm Edition' },
  { type: 'final', title: 'FINAL PREP', subtitle: 'Vol.2 · Final Edition' },
  { type: 'past', title: 'PAST EXAM', subtitle: 'Official Archive' },
];

const MOTIVATIONAL_QUOTES = [
  "Success is not final, failure is not fatal.",
  "The secret of getting ahead is getting started.",
  "Believe you can and you're halfway there.",
  "Education is the passport to the future.",
  "The harder you work, the luckier you get.",
  "Knowledge is power, wisdom is freedom.",
  "Every expert was once a beginner.",
  "Dream big, work hard, stay focused.",
];

// 신문 배경 텍스트 (생물학 관련)
const NEWSPAPER_BG_TEXT = `The cell membrane, also known as the plasma membrane, is a biological membrane that separates and protects the interior of all cells from the outside environment. The cell membrane consists of a lipid bilayer, including cholesterols that sit between phospholipids to maintain their fluidity at various temperatures. The membrane also contains membrane proteins, including integral proteins that span the membrane serving as membrane transporters, and peripheral proteins that loosely attach to the outer side of the cell membrane, acting as enzymes to facilitate interaction with the cell's environment. Glycolipids embedded in the outer lipid layer serve a similar purpose. The cell membrane controls the movement of substances in and out of cells and organelles, being selectively permeable to ions and organic molecules. In addition, cell membranes are involved in a variety of cellular processes such as cell adhesion, ion conductivity, and cell signaling.`;

// ============================================================
// 유틸리티 함수
// ============================================================

function getRandomQuote(): string {
  return MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
}

function getQuestionTypeLabel(quiz: QuizCardData): string {
  const multiple = quiz.multipleChoiceCount || 0;
  const subjective = quiz.subjectiveCount || 0;
  if (multiple > 0 && subjective > 0) {
    return `객관 ${multiple} · 주관 ${subjective}`;
  }
  if (multiple > 0) return `객관 ${multiple}문제`;
  if (subjective > 0) return `주관 ${subjective}문제`;
  return `${quiz.questionCount}문제`;
}

/**
 * 문제 유형을 포맷하여 표시
 * 예: "OX 2 / 객관식 5 / 주관식 2"
 */
function formatQuestionTypes(
  oxCount: number = 0,
  multipleChoiceCount: number = 0,
  subjectiveCount: number = 0
): string {
  const parts: string[] = [];
  if (oxCount > 0) parts.push(`OX ${oxCount}`);
  if (multipleChoiceCount > 0) parts.push(`객관식 ${multipleChoiceCount}`);
  if (subjectiveCount > 0) parts.push(`주관식 ${subjectiveCount}`);

  if (parts.length === 0) {
    const total = oxCount + multipleChoiceCount + subjectiveCount;
    return total > 0 ? `${total}문제` : '-';
  }

  return parts.join(' / ');
}

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
// 뉴스 기사 컴포넌트 (퀴즈)
// ============================================================

function NewsArticle({
  quiz,
  size = 'normal',
  onStart,
  onUpdate,
  onDetails,
}: {
  quiz: QuizCardData;
  size?: 'large' | 'normal' | 'small';
  onStart: () => void;
  onUpdate?: () => void;
  onDetails?: () => void;
}) {
  const isCompleted = quiz.isCompleted && !quiz.hasUpdate;
  const hasUpdate = quiz.isCompleted && quiz.hasUpdate;

  // 크기별 스타일
  const sizeStyles = {
    large: {
      container: 'col-span-2 row-span-2',
      title: 'text-lg font-black',
      meta: 'text-sm',
      tags: 'text-xs',
      button: 'py-2.5 px-4 text-sm',
      image: 'w-20 h-28',
    },
    normal: {
      container: 'col-span-1 row-span-2',
      title: 'text-base font-bold',
      meta: 'text-xs',
      tags: 'text-[10px]',
      button: 'py-2 px-3 text-xs',
      image: 'w-14 h-20',
    },
    small: {
      container: 'col-span-1 row-span-1',
      title: 'text-sm font-bold',
      meta: 'text-[10px]',
      tags: 'text-[10px]',
      button: 'py-1.5 px-2 text-[10px]',
      image: 'w-10 h-14',
    },
  };

  const styles = sizeStyles[size];

  return (
    <div
      onClick={!isCompleted ? onDetails : undefined}
      className={`relative border border-[#1A1A1A] bg-[#F5F0E8] overflow-hidden ${!isCompleted ? 'cursor-pointer' : ''} ${styles.container}`}
    >
      {/* 신문 배경 텍스트 */}
      <div className="absolute inset-0 p-2 overflow-hidden pointer-events-none">
        <p className="text-[6px] text-[#D0D0D0] leading-tight break-words">
          {NEWSPAPER_BG_TEXT.slice(0, size === 'large' ? 800 : size === 'normal' ? 400 : 200)}
        </p>
      </div>

      {/* 완료 오버레이 */}
      {(isCompleted || hasUpdate) && (
        <div className={`absolute inset-0 z-20 flex items-center justify-center ${
          hasUpdate ? 'bg-black/40' : 'bg-black/70'
        }`}>
          {hasUpdate ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate?.();
              }}
              className="bg-[#F5C518] text-[#1A1A1A] px-3 py-1.5 font-bold text-xs border-2 border-[#1A1A1A] hover:bg-[#E5B508] transition-colors"
            >
              업데이트 ({quiz.updatedQuestionCount})
            </button>
          ) : (
            <CompletedBadge size={size === 'small' ? 'small' : 'normal'} />
          )}
        </div>
      )}

      {/* 기사 내용 */}
      <div className={`relative z-10 p-3 h-full flex ${size === 'small' ? 'flex-col' : 'gap-3'}`}>
        {/* 난이도 이미지 */}
        {quiz.difficultyImageUrl && size !== 'small' && (
          <div className={`${styles.image} flex-shrink-0 border border-[#1A1A1A] bg-white`}>
            <img
              src={quiz.difficultyImageUrl}
              alt="난이도"
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* 텍스트 영역 */}
        <div className="flex-1 flex flex-col justify-between bg-[#F5F0E8]/90 p-2">
          <div>
            {/* 제목 */}
            <h3 className={`${styles.title} text-[#1A1A1A] mb-1 line-clamp-2`}>
              {quiz.title}
            </h3>

            {/* 문제 양식 */}
            <p className={`${styles.meta} text-[#5C5C5C] mb-1`}>
              {getQuestionTypeLabel(quiz)}
            </p>

            {/* 태그 */}
            {quiz.tags && quiz.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {quiz.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className={`${styles.tags} px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] font-medium`}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Start 버튼 */}
          {!isCompleted && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStart();
              }}
              className={`${styles.button} font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors self-start`}
            >
              Start
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 명언 기사 컴포넌트
// ============================================================

function QuoteArticle({ size = 'small' }: { size?: 'normal' | 'small' }) {
  const quote = useMemo(() => getRandomQuote(), []);

  return (
    <div className={`relative border border-[#1A1A1A] bg-[#EDEAE4] p-3 flex items-center justify-center ${
      size === 'small' ? 'col-span-1 row-span-1' : 'col-span-1 row-span-2'
    }`}>
      <p className={`text-center italic text-[#1A1A1A] font-serif ${
        size === 'small' ? 'text-xs' : 'text-sm'
      }`}>
        "{quote}"
      </p>
    </div>
  );
}

// ============================================================
// 뉴스 카드 컴포넌트 (중간/기말)
// ============================================================

function NewsCard({
  type,
  title,
  subtitle,
  quizzes,
  isLoading,
  onStart,
  onUpdate,
  onShowDetails,
}: {
  type: NewsCardType;
  title: string;
  subtitle: string;
  quizzes: QuizCardData[];
  isLoading: boolean;
  onStart: (quizId: string) => void;
  onUpdate: (quiz: QuizCardData) => void;
  onShowDetails?: (quiz: QuizCardData) => void;
}) {
  // 기사 크기 배분 (가지각색)
  const getArticleSize = (index: number, total: number): 'large' | 'normal' | 'small' => {
    if (total === 1) return 'large';
    if (total === 2) return index === 0 ? 'large' : 'normal';
    if (index === 0) return 'large';
    if (index === 1 || index === 2) return 'normal';
    return 'small';
  };

  return (
    <div className="w-full h-full border-4 border-[#1A1A1A] bg-[#F5F0E8] flex flex-col overflow-hidden">
      {/* 헤더 */}
      <div className="bg-[#1A1A1A] text-[#F5F0E8] px-4 py-3 text-center flex-shrink-0">
        <p className="text-[8px] tracking-[0.3em] mb-1">━━━━━━━━━━━━━━━━━━━━</p>
        <h1 className="font-serif text-2xl font-black tracking-tight">{title}</h1>
        <p className="text-[10px] tracking-widest mt-1">{subtitle}</p>
      </div>

      {/* 기사 영역 (스크롤 가능) */}
      <div className="flex-1 overflow-y-auto p-3">
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
          <div className="grid grid-cols-2 auto-rows-[minmax(80px,auto)] gap-2">
            {quizzes.slice(0, 4).map((quiz, index) => (
              <NewsArticle
                key={quiz.id}
                quiz={quiz}
                size={getArticleSize(index, Math.min(quizzes.length, 4))}
                onStart={() => onStart(quiz.id)}
                onUpdate={() => onUpdate(quiz)}
                onDetails={onShowDetails ? () => onShowDetails(quiz) : undefined}
              />
            ))}
            {/* Dead space를 명언으로 채우기 */}
            {quizzes.length === 1 && <QuoteArticle size="normal" />}
            {quizzes.length === 3 && <QuoteArticle size="small" />}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 기출 뉴스 카드 컴포넌트 (특별)
// ============================================================

function PastExamNewsCard({
  quiz,
  selectedPastExam,
  pastExamOptions,
  onSelectPastExam,
  isLoading,
  onStart,
  onDownload,
  onShowDetails,
}: {
  quiz: QuizCardData | null;
  selectedPastExam: string;
  pastExamOptions: PastExamOption[];
  onSelectPastExam: (value: string) => void;
  isLoading: boolean;
  onStart: () => void;
  onDownload: () => void;
  onShowDetails?: (quiz: QuizCardData) => void;
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const selectedOption = pastExamOptions.find((opt) => opt.value === selectedPastExam);

  return (
    <div className="w-full h-full border-4 border-[#1A1A1A] bg-[#F5F0E8] flex flex-col overflow-hidden">
      {/* 헤더 + 드롭다운 */}
      <div className="bg-[#1A1A1A] text-[#F5F0E8] px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[8px] tracking-[0.3em] mb-1">━━━━━━━━━━━━</p>
            <h1 className="font-serif text-2xl font-black tracking-tight">PAST EXAM</h1>
          </div>

          {/* 드롭다운 */}
          <div className="relative">
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
                  <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)} />
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
        <p className="text-[10px] tracking-widest mt-1">Official Archive · {selectedOption?.label}</p>
      </div>

      {/* 큰 기사 하나 */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-pulse text-[#5C5C5C]">로딩 중...</div>
          </div>
        ) : !quiz ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <h3 className="font-bold text-lg mb-2 text-[#1A1A1A]">기출문제가 없습니다</h3>
            <p className="text-sm text-[#5C5C5C]">해당 시험의 기출문제가 아직 등록되지 않았습니다.</p>
          </div>
        ) : (
          <div
            onClick={!quiz.isCompleted ? () => onShowDetails?.(quiz) : undefined}
            className={`relative border-2 border-[#1A1A1A] bg-[#F5F0E8] h-full ${!quiz.isCompleted ? 'cursor-pointer' : ''}`}
          >
            {/* 신문 배경 텍스트 */}
            <div className="absolute inset-0 p-3 overflow-hidden pointer-events-none">
              <p className="text-[7px] text-[#D8D8D8] leading-tight break-words">
                {NEWSPAPER_BG_TEXT}
              </p>
            </div>

            {/* 완료 오버레이 */}
            {quiz.isCompleted && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
                <CompletedBadge />
              </div>
            )}

            {/* 기사 내용 */}
            <div className="relative z-10 p-4 h-full flex flex-col">
              <div className="flex gap-4 flex-1">
                {/* 난이도 이미지 */}
                {quiz.difficultyImageUrl && (
                  <div className="w-28 h-40 flex-shrink-0 border-2 border-[#1A1A1A] bg-white">
                    <img
                      src={quiz.difficultyImageUrl}
                      alt="난이도"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {/* 텍스트 */}
                <div className="flex-1 bg-[#F5F0E8]/95 p-3">
                  <h2 className="text-xl font-black text-[#1A1A1A] mb-2">
                    {quiz.title}
                  </h2>

                  <p className="text-sm text-[#5C5C5C] mb-2">
                    객관 {quiz.multipleChoiceCount || 0} · 주관 {quiz.subjectiveCount || 0} · 총 {quiz.questionCount}문제
                  </p>

                  <p className="text-sm text-[#5C5C5C] mb-3">
                    {quiz.participantCount}명 참여
                  </p>

                  {quiz.tags && quiz.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {quiz.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-medium"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {quiz.oneLineSummary && (
                    <p className="text-sm italic text-[#5C5C5C] border-l-2 border-[#1A1A1A] pl-2 mb-3">
                      "{quiz.oneLineSummary}"
                    </p>
                  )}
                </div>
              </div>

              {/* 버튼 영역 */}
              {!quiz.isCompleted && (
                <div className="flex gap-3 mt-4">
                  {quiz.attachmentUrl && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownload();
                      }}
                      className="flex-1 py-3 font-bold text-sm border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
                    >
                      다운로드
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onStart();
                    }}
                    className="flex-1 py-3 font-bold text-sm bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
                  >
                    Start
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 뉴스 캐러셀 컴포넌트
// ============================================================

function NewsCarousel({
  midtermQuizzes,
  finalQuizzes,
  pastQuiz,
  pastExamOptions,
  selectedPastExam,
  onSelectPastExam,
  isLoading,
  onStart,
  onUpdate,
  onDownload,
  onShowDetails,
}: {
  midtermQuizzes: QuizCardData[];
  finalQuizzes: QuizCardData[];
  pastQuiz: QuizCardData | null;
  pastExamOptions: PastExamOption[];
  selectedPastExam: string;
  onSelectPastExam: (value: string) => void;
  isLoading: { midterm: boolean; final: boolean; past: boolean };
  onStart: (quizId: string) => void;
  onUpdate: (quiz: QuizCardData) => void;
  onDownload: (url: string) => void;
  onShowDetails?: (quiz: QuizCardData) => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const goToPrev = () => setCurrentIndex((prev) => Math.max(0, prev - 1));
  const goToNext = () => setCurrentIndex((prev) => Math.min(2, prev + 1));

  const handleDragEnd = (e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x > 50) {
      goToPrev();
    } else if (info.offset.x < -50) {
      goToNext();
    }
  };

  return (
    <div className="relative px-4">
      {/* 좌측 화살표 */}
      <button
        onClick={goToPrev}
        disabled={currentIndex === 0}
        className={`absolute left-0 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center rounded-full border-2 border-[#1A1A1A] bg-[#F5F0E8] shadow-md transition-all ${
          currentIndex === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
        }`}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </button>

      {/* 우측 화살표 */}
      <button
        onClick={goToNext}
        disabled={currentIndex === 2}
        className={`absolute right-0 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center rounded-full border-2 border-[#1A1A1A] bg-[#F5F0E8] shadow-md transition-all ${
          currentIndex === 2 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
        }`}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      </button>

      {/* 카드 컨테이너 */}
      <div ref={containerRef} className="overflow-hidden mx-6">
        <motion.div
          className="flex"
          animate={{ x: `${-currentIndex * 100}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          onDragEnd={handleDragEnd}
        >
          {/* 중간 카드 */}
          <motion.div
            className="w-full flex-shrink-0 px-2"
            style={{
              perspective: 1000,
            }}
          >
            <motion.div
              animate={{
                rotateY: currentIndex === 0 ? 0 : currentIndex < 0 ? 15 : -15,
                scale: currentIndex === 0 ? 1 : 0.9,
                opacity: currentIndex === 0 ? 1 : 0.7,
              }}
              transition={{ duration: 0.3 }}
              className="h-[420px]"
            >
              <NewsCard
                type="midterm"
                title="MIDTERM PREP"
                subtitle="Vol.1 · Midterm Edition"
                quizzes={midtermQuizzes}
                isLoading={isLoading.midterm}
                onStart={onStart}
                onUpdate={onUpdate}
                onShowDetails={onShowDetails}
              />
            </motion.div>
          </motion.div>

          {/* 기말 카드 */}
          <motion.div
            className="w-full flex-shrink-0 px-2"
            style={{
              perspective: 1000,
            }}
          >
            <motion.div
              animate={{
                rotateY: currentIndex === 1 ? 0 : currentIndex < 1 ? 15 : -15,
                scale: currentIndex === 1 ? 1 : 0.9,
                opacity: currentIndex === 1 ? 1 : 0.7,
              }}
              transition={{ duration: 0.3 }}
              className="h-[420px]"
            >
              <NewsCard
                type="final"
                title="FINAL PREP"
                subtitle="Vol.2 · Final Edition"
                quizzes={finalQuizzes}
                isLoading={isLoading.final}
                onStart={onStart}
                onUpdate={onUpdate}
                onShowDetails={onShowDetails}
              />
            </motion.div>
          </motion.div>

          {/* 기출 카드 */}
          <motion.div
            className="w-full flex-shrink-0 px-2"
            style={{
              perspective: 1000,
            }}
          >
            <motion.div
              animate={{
                rotateY: currentIndex === 2 ? 0 : currentIndex < 2 ? 15 : -15,
                scale: currentIndex === 2 ? 1 : 0.9,
                opacity: currentIndex === 2 ? 1 : 0.7,
              }}
              transition={{ duration: 0.3 }}
              className="h-[420px]"
            >
              <PastExamNewsCard
                quiz={pastQuiz}
                selectedPastExam={selectedPastExam}
                pastExamOptions={pastExamOptions}
                onSelectPastExam={onSelectPastExam}
                isLoading={isLoading.past}
                onStart={() => pastQuiz && onStart(pastQuiz.id)}
                onDownload={() => pastQuiz?.attachmentUrl && onDownload(pastQuiz.attachmentUrl)}
                onShowDetails={onShowDetails}
              />
            </motion.div>
          </motion.div>
        </motion.div>
      </div>

      {/* 인디케이터 */}
      <div className="flex justify-center gap-2 mt-4">
        {[0, 1, 2].map((index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`w-2 h-2 rounded-full transition-all ${
              currentIndex === index ? 'bg-[#1A1A1A] w-4' : 'bg-[#CCCCCC]'
            }`}
          />
        ))}
      </div>
    </div>
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
}: {
  quiz: QuizCardData;
  onStart: () => void;
  onDetails: () => void;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  onUpdate?: () => void;
}) {
  const isCompleted = quiz.isCompleted && !quiz.hasUpdate;
  const hasUpdate = quiz.isCompleted && quiz.hasUpdate;

  return (
    <motion.div
      whileHover={isCompleted ? {} : { y: -4, boxShadow: '0 8px 25px rgba(26, 26, 26, 0.15)' }}
      transition={{ duration: 0.2 }}
      onClick={isCompleted ? undefined : onDetails}
      className={`relative border border-[#1A1A1A] bg-[#F5F0E8] overflow-hidden shadow-md ${
        isCompleted ? 'pointer-events-none' : 'cursor-pointer'
      }`}
    >
      {/* 신문 배경 텍스트 */}
      <div className="absolute inset-0 p-2 overflow-hidden pointer-events-none">
        <p className="text-[5px] text-[#E8E8E8] leading-tight break-words">
          {NEWSPAPER_BG_TEXT.slice(0, 300)}
        </p>
      </div>

      {/* 완료 오버레이 */}
      {(isCompleted || hasUpdate) && (
        <div className={`absolute inset-0 z-20 flex items-center justify-center ${
          hasUpdate ? 'bg-black/40' : 'bg-black/70'
        }`}>
          {hasUpdate ? (
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
            <CompletedBadge size="small" />
          )}
        </div>
      )}

      {/* 북마크 버튼 */}
      {onToggleBookmark && !isCompleted && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleBookmark();
          }}
          className="absolute top-2 right-2 z-30 flex flex-col items-center transition-transform hover:scale-110"
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

      {/* 카드 내용 */}
      <div className="relative z-10 p-4 bg-[#F5F0E8]/90">
        {/* 제목 (2줄 고정 높이) */}
        <div className="h-[44px] mb-2">
          <h3 className="font-serif-display font-bold text-base line-clamp-2 text-[#1A1A1A] pr-6 leading-snug">
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
// 퀴즈 관리 카드
// ============================================================

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
    <motion.div
      whileHover={{ y: -4, boxShadow: '0 8px 25px rgba(26, 26, 26, 0.15)' }}
      transition={{ duration: 0.2 }}
      className="border border-[#1A1A1A] bg-[#F5F0E8] p-4 shadow-md cursor-pointer"
    >
      <div className="h-[44px] mb-2">
        <h3 className="font-serif-display font-bold text-base line-clamp-2 text-[#1A1A1A] leading-snug">
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

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={onStats}
          className="flex-1 min-w-[45%] py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
        >
          통계
        </button>
        <button
          onClick={onFeedback}
          className="flex-1 min-w-[45%] py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
        >
          피드백
        </button>
        <button
          onClick={onEdit}
          className="flex-1 min-w-[45%] py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
        >
          수정
        </button>
        <button
          onClick={onDelete}
          className="flex-1 min-w-[45%] py-2 text-sm font-bold border border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
        >
          삭제
        </button>
      </div>
    </motion.div>
  );
}

// ============================================================
// 메인 페이지 컴포넌트
// ============================================================

export default function QuizListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { isBookmarked, toggleBookmark } = useQuizBookmark();
  const { userCourseId } = useCourse();
  const { updatedQuizzes, checkQuizUpdate, refresh: refreshUpdates } = useQuizUpdate();

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

  const [isLoading, setIsLoading] = useState({
    midterm: true,
    final: true,
    past: true,
    custom: true,
  });

  const [selectedQuiz, setSelectedQuiz] = useState<QuizCardData | null>(null);

  // 기출 드롭다운
  const pastExamOptions = useMemo(() => getPastExamOptions(userCourseId), [userCourseId]);
  const [selectedPastExam, setSelectedPastExam] = useState<string>(() => {
    const options = getPastExamOptions(userCourseId);
    return options.length > 0 ? options[0].value : '2025-midterm';
  });

  // 퀴즈 관리 모드
  const [isManageMode, setIsManageMode] = useState(false);
  const [myQuizzes, setMyQuizzes] = useState<QuizCardData[]>([]);
  const [isLoadingMyQuizzes, setIsLoadingMyQuizzes] = useState(false);

  // 모달 상태
  const [feedbackQuiz, setFeedbackQuiz] = useState<QuizCardData | null>(null);
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [isLoadingFeedbacks, setIsLoadingFeedbacks] = useState(false);
  const [updateModalInfo, setUpdateModalInfo] = useState<QuizUpdateInfo | null>(null);
  const [updateModalQuizCount, setUpdateModalQuizCount] = useState(0);
  const [statsQuiz, setStatsQuiz] = useState<QuizCardData | null>(null);

  // ============================================================
  // 데이터 로드 함수들
  // ============================================================

  // 퀴즈 데이터 파싱
  const parseQuizData = useCallback((docSnapshot: any, userId: string): QuizCardData => {
    const data = docSnapshot.data();
    const isCompleted = data.completedUsers?.includes(userId) || false;
    const updateInfo = updatedQuizzes.get(docSnapshot.id);

    return {
      id: docSnapshot.id,
      title: data.title || '제목 없음',
      type: data.type || 'midterm',
      questionCount: data.questionCount || 0,
      difficulty: data.difficulty || 'normal',
      participantCount: data.participantCount || 0,
      averageScore: data.averageScore || 0,
      isCompleted,
      myScore: data.userScores?.[userId],
      creatorNickname: data.creatorNickname,
      creatorClassType: data.creatorClassType,
      creatorId: data.creatorId,
      hasUpdate: isCompleted && updateInfo?.hasUpdate,
      updatedQuestionCount: updateInfo?.updatedQuestionCount,
      tags: data.tags || [],
      bookmarkCount: data.bookmarkCount || 0,
      createdAt: data.createdAt,
      attachmentUrl: data.attachmentUrl,
      oneLineSummary: data.oneLineSummary,
      difficultyImageUrl: data.difficultyImageUrl,
      multipleChoiceCount: data.multipleChoiceCount || 0,
      subjectiveCount: data.subjectiveCount || 0,
      oxCount: data.oxCount || 0,
    };
  }, [updatedQuizzes]);

  // 퀴즈 정렬
  const sortQuizzes = (quizzes: QuizCardData[]): QuizCardData[] => {
    return quizzes.sort((a, b) => {
      if (!a.isCompleted && b.isCompleted) return -1;
      if (a.isCompleted && !b.isCompleted) return 1;
      if (a.isCompleted && b.isCompleted) {
        if (a.hasUpdate && !b.hasUpdate) return -1;
        if (!a.hasUpdate && b.hasUpdate) return 1;
      }
      const aBookmarks = a.bookmarkCount || 0;
      const bBookmarks = b.bookmarkCount || 0;
      if (aBookmarks !== bBookmarks) return bBookmarks - aBookmarks;
      return b.id.localeCompare(a.id);
    });
  };

  // 중간/기말 퀴즈 로드
  useEffect(() => {
    if (!user || !userCourseId) return;

    const loadQuizzes = async (type: 'midterm' | 'final') => {
      setIsLoading((prev) => ({ ...prev, [type]: true }));

      const quizzesRef = collection(db, 'quizzes');
      const q = query(
        quizzesRef,
        where('type', '==', type),
        where('courseId', '==', userCourseId)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const quizzes: QuizCardData[] = [];
        snapshot.forEach((doc) => {
          quizzes.push(parseQuizData(doc, user.uid));
        });

        const sorted = sortQuizzes(quizzes);
        if (type === 'midterm') {
          setMidtermQuizzes(sorted);
        } else {
          setFinalQuizzes(sorted);
        }
        setIsLoading((prev) => ({ ...prev, [type]: false }));
      });

      return unsubscribe;
    };

    const unsubMidterm = loadQuizzes('midterm');
    const unsubFinal = loadQuizzes('final');

    return () => {
      unsubMidterm.then((unsub) => unsub());
      unsubFinal.then((unsub) => unsub());
    };
  }, [user, userCourseId, parseQuizData]);

  // 기출 퀴즈 로드
  useEffect(() => {
    if (!user || !userCourseId) return;

    setIsLoading((prev) => ({ ...prev, past: true }));

    const [yearStr, examType] = selectedPastExam.split('-');
    const year = parseInt(yearStr, 10);

    const quizzesRef = collection(db, 'quizzes');
    const q = query(
      quizzesRef,
      where('type', '==', 'past'),
      where('courseId', '==', userCourseId),
      where('pastYear', '==', year),
      where('pastExamType', '==', examType)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const quizzes: QuizCardData[] = [];
      snapshot.forEach((doc) => {
        quizzes.push(parseQuizData(doc, user.uid));
      });
      setPastQuizzes(quizzes);
      setIsLoading((prev) => ({ ...prev, past: false }));
    });

    return () => unsubscribe();
  }, [user, userCourseId, selectedPastExam, parseQuizData]);

  // 자작 퀴즈 로드
  useEffect(() => {
    if (!user) return;

    setIsLoading((prev) => ({ ...prev, custom: true }));

    const quizzesRef = collection(db, 'quizzes');
    const q = query(
      quizzesRef,
      where('type', '==', 'custom')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const quizzes: QuizCardData[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        // 현재 과목의 자작 퀴즈만 (courseId가 없거나 일치하는 경우)
        if (!userCourseId || !data.courseId || data.courseId === userCourseId) {
          quizzes.push(parseQuizData(doc, user.uid));
        }
      });
      setCustomQuizzes(sortQuizzes(quizzes));
      setIsLoading((prev) => ({ ...prev, custom: false }));
    });

    return () => unsubscribe();
  }, [user, userCourseId, parseQuizData]);

  // 내 퀴즈 로드 (관리 모드)
  const fetchMyQuizzes = useCallback(async () => {
    if (!user) return;

    setIsLoadingMyQuizzes(true);
    const quizzesRef = collection(db, 'quizzes');
    const q = query(quizzesRef, where('creatorId', '==', user.uid));

    const snapshot = await getDocs(q);
    const quizzes: QuizCardData[] = [];
    snapshot.forEach((doc) => {
      quizzes.push(parseQuizData(doc, user.uid));
    });

    setMyQuizzes(sortQuizzes(quizzes));
    setIsLoadingMyQuizzes(false);
  }, [user, parseQuizData]);

  useEffect(() => {
    if (isManageMode) {
      fetchMyQuizzes();
    }
  }, [isManageMode, fetchMyQuizzes]);

  // ============================================================
  // 핸들러 함수들
  // ============================================================

  const handleStartQuiz = (quizId: string) => {
    router.push(`/quiz/${quizId}`);
  };

  const handleShowDetails = (quiz: QuizCardData) => {
    setSelectedQuiz(quiz);
  };

  const handleOpenUpdateModal = async (quiz: QuizCardData) => {
    const updateInfo = await checkQuizUpdate(quiz.id);
    if (updateInfo) {
      setUpdateModalInfo(updateInfo);
      setUpdateModalQuizCount(quiz.questionCount);
    }
  };

  const handleUpdateComplete = () => {
    setUpdateModalInfo(null);
    refreshUpdates();
  };

  const handleEditQuiz = (quizId: string) => {
    router.push(`/quiz/${quizId}/edit`);
  };

  const handleDeleteQuiz = async (quizId: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;

    try {
      await deleteDoc(doc(db, 'quizzes', quizId));
      setMyQuizzes((prev) => prev.filter((q) => q.id !== quizId));
    } catch (error) {
      console.error('퀴즈 삭제 실패:', error);
      alert('퀴즈 삭제에 실패했습니다.');
    }
  };

  const handleViewFeedback = async (quiz: QuizCardData) => {
    setFeedbackQuiz(quiz);
    setIsLoadingFeedbacks(true);

    try {
      const feedbacksRef = collection(db, 'feedbacks');
      const q = query(feedbacksRef, where('quizId', '==', quiz.id));
      const snapshot = await getDocs(q);

      const feedbackList: any[] = [];
      snapshot.forEach((doc) => {
        feedbackList.push({ id: doc.id, ...doc.data() });
      });
      setFeedbacks(feedbackList);
    } catch (error) {
      console.error('피드백 로드 실패:', error);
    } finally {
      setIsLoadingFeedbacks(false);
    }
  };

  // ============================================================
  // 렌더링
  // ============================================================

  // 관리 모드
  if (isManageMode) {
    return (
      <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
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
                      const typeLabels: Record<string, string> = {
                        unclear: '문제가 이해가 안 돼요',
                        wrong: '정답이 틀린 것 같아요',
                        typo: '오타가 있어요',
                        other: '기타 의견',
                      };
                      const typeLabel = typeLabels[feedback.feedbackType] || feedback.feedbackType;
                      // questionId에서 숫자 추출 후 +1 (q0 → 1, q1 → 2)
                      const questionNum = parseInt(feedback.questionId.replace(/\D/g, ''), 10) + 1;

                      return (
                        <div
                          key={feedback.id}
                          className="p-4 border border-[#1A1A1A] bg-[#EDEAE4]"
                        >
                          <p className="text-sm text-[#5C5C5C] mb-1">
                            문제 {questionNum}.
                          </p>
                          <p className="text-base font-bold text-[#8B6914] mb-2">
                            {typeLabel}
                          </p>
                          {feedback.feedback && (
                            <p className="text-base text-[#1A1A1A]">
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

  // 메인 페이지
  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="pt-6 pb-4 flex flex-col items-center">
        <div className="relative w-full px-4 h-32 sm:h-44 md:h-56 mb-4">
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

        {/* 버튼 영역 */}
        <div className="w-full px-4 flex items-center justify-between">
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
      <section className="mb-8 px-4">
        <NewsCarousel
          midtermQuizzes={midtermQuizzes}
          finalQuizzes={finalQuizzes}
          pastQuiz={pastQuizzes.length > 0 ? pastQuizzes[0] : null}
          pastExamOptions={pastExamOptions}
          selectedPastExam={selectedPastExam}
          onSelectPastExam={setSelectedPastExam}
          isLoading={isLoading}
          onStart={handleStartQuiz}
          onUpdate={handleOpenUpdateModal}
          onDownload={(url) => window.open(url, '_blank')}
          onShowDetails={handleShowDetails}
        />
      </section>

      {/* 자작 섹션 */}
      <section className="px-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif-display text-xl font-black text-[#1A1A1A]">자작</h2>
        </div>

        {isLoading.custom && (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {!isLoading.custom && customQuizzes.length === 0 && (
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

        {!isLoading.custom && customQuizzes.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {customQuizzes.map((quiz, index) => (
              <motion.div
                key={quiz.id}
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
                />
              </motion.div>
            ))}
          </div>
        )}
      </section>

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
            <h2 className="font-serif-display text-lg font-bold text-[#1A1A1A] mb-4">{selectedQuiz.title}</h2>

            <div className="text-center py-4 mb-4 border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]">
              <p className="text-xs text-[#5C5C5C] mb-1">평균 점수</p>
              <p className="text-4xl font-black text-[#1A1A1A]">
                {selectedQuiz.participantCount > 0 ? selectedQuiz.averageScore.toFixed(0) : '-'}
                <span className="text-lg font-bold">점</span>
              </p>
            </div>

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
              {selectedQuiz.myScore !== undefined && (
                <div className="flex justify-between text-sm pt-2 border-t border-[#1A1A1A]">
                  <span className="text-[#5C5C5C]">내 점수</span>
                  <span className="font-bold text-[#1A6B1A]">{selectedQuiz.myScore}점</span>
                </div>
              )}
              {selectedQuiz.tags && selectedQuiz.tags.length > 0 && (
                <div className={`pt-2 ${selectedQuiz.myScore === undefined ? 'border-t border-[#EDEAE4]' : ''}`}>
                  <div className="flex flex-wrap gap-1">
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
