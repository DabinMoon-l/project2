'use client';

import { useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import type { CompletedQuizData } from './types';
import { NEWSPAPER_BG_TEXT } from './types';
import { ReviewNewsArticle, ReviewQuoteArticle } from './ReviewNewsArticle';
import type { PastExamOption } from '@/lib/types/course';

/**
 * 뉴스 카드 컴포넌트 (중간/기말 복습용)
 */
function ReviewNewsCard({
  type,
  title,
  subtitle,
  quizzes,
  isLoading,
  onReview,
  onShowDetails,
  isQuizBookmarked,
  onToggleBookmark,
}: {
  type: 'midterm' | 'final';
  title: string;
  subtitle: string;
  quizzes: CompletedQuizData[];
  isLoading: boolean;
  onReview: (quizId: string) => void;
  onShowDetails?: (quiz: CompletedQuizData) => void;
  isQuizBookmarked?: (quizId: string) => boolean;
  onToggleBookmark?: (quizId: string) => void;
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
          <div className="h-full" />
        ) : quizzes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <h3 className="font-bold text-lg mb-2 text-[#1A1A1A]">완료한 퀴즈가 없습니다</h3>
            <p className="text-sm text-[#5C5C5C]">퀴즈를 풀면 여기에 표시됩니다.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 auto-rows-[minmax(80px,auto)] gap-2">
            {quizzes.slice(0, 4).map((quiz, index) => (
              <ReviewNewsArticle
                key={quiz.id}
                quiz={quiz}
                size={getArticleSize(index, Math.min(quizzes.length, 4))}
                onReview={() => onReview(quiz.id)}
                onDetails={onShowDetails ? () => onShowDetails(quiz) : undefined}
                isBookmarked={isQuizBookmarked?.(quiz.id)}
                onToggleBookmark={onToggleBookmark ? () => onToggleBookmark(quiz.id) : undefined}
              />
            ))}
            {/* Dead space를 명언으로 채우기 */}
            {quizzes.length === 1 && <ReviewQuoteArticle size="normal" />}
            {quizzes.length === 3 && <ReviewQuoteArticle size="small" />}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 기출 뉴스 카드 컴포넌트 (복습용)
 */
function ReviewPastExamNewsCard({
  quiz,
  selectedPastExam,
  pastExamOptions,
  onSelectPastExam,
  isLoading,
  onReview,
  onShowDetails,
}: {
  quiz: CompletedQuizData | null;
  selectedPastExam: string;
  pastExamOptions: PastExamOption[];
  onSelectPastExam: (value: string) => void;
  isLoading: boolean;
  onReview: () => void;
  onShowDetails?: (quiz: CompletedQuizData) => void;
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
          <div className="h-full" />
        ) : !quiz ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <h3 className="font-bold text-lg mb-2 text-[#1A1A1A]">완료한 기출문제가 없습니다</h3>
            <p className="text-sm text-[#5C5C5C]">해당 시험의 기출문제를 풀면 여기에 표시됩니다.</p>
          </div>
        ) : (
          <div
            onClick={() => onShowDetails?.(quiz)}
            className="relative border-2 border-[#1A1A1A] bg-[#F5F0E8] h-full cursor-pointer"
          >
            {/* 신문 배경 텍스트 */}
            <div className="absolute inset-0 p-3 overflow-hidden pointer-events-none">
              <p className="text-[7px] text-[#D8D8D8] leading-tight break-words">
                {NEWSPAPER_BG_TEXT}
              </p>
            </div>

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
                      &quot;{quiz.oneLineSummary}&quot;
                    </p>
                  )}
                </div>
              </div>

              {/* 버튼 영역 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReview();
                }}
                className="w-full py-3 font-bold text-sm bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors mt-4"
              >
                복습하기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 뉴스 캐러셀 컴포넌트 (복습용)
 */
export default function ReviewNewsCarousel({
  midtermQuizzes,
  finalQuizzes,
  pastQuiz,
  pastExamOptions,
  selectedPastExam,
  onSelectPastExam,
  isLoading,
  onReview,
  onShowDetails,
  isQuizBookmarked,
  onToggleBookmark,
}: {
  midtermQuizzes: CompletedQuizData[];
  finalQuizzes: CompletedQuizData[];
  pastQuiz: CompletedQuizData | null;
  pastExamOptions: PastExamOption[];
  selectedPastExam: string;
  onSelectPastExam: (value: string) => void;
  isLoading: { midterm: boolean; final: boolean; past: boolean };
  onReview: (quizId: string) => void;
  onShowDetails?: (quiz: CompletedQuizData) => void;
  isQuizBookmarked?: (quizId: string) => boolean;
  onToggleBookmark?: (quizId: string) => void;
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
          <motion.div className="w-full flex-shrink-0 px-2" style={{ perspective: 1000 }}>
            <motion.div
              animate={{
                rotateY: currentIndex === 0 ? 0 : currentIndex < 0 ? 15 : -15,
                scale: currentIndex === 0 ? 1 : 0.9,
                opacity: currentIndex === 0 ? 1 : 0.7,
              }}
              transition={{ duration: 0.3 }}
              className="h-[420px]"
            >
              <ReviewNewsCard
                type="midterm"
                title="MIDTERM REVIEW"
                subtitle="Vol.1 · Midterm Edition"
                quizzes={midtermQuizzes}
                isLoading={isLoading.midterm}
                onReview={onReview}
                onShowDetails={onShowDetails}
                isQuizBookmarked={isQuizBookmarked}
                onToggleBookmark={onToggleBookmark}
              />
            </motion.div>
          </motion.div>

          {/* 기말 카드 */}
          <motion.div className="w-full flex-shrink-0 px-2" style={{ perspective: 1000 }}>
            <motion.div
              animate={{
                rotateY: currentIndex === 1 ? 0 : currentIndex < 1 ? 15 : -15,
                scale: currentIndex === 1 ? 1 : 0.9,
                opacity: currentIndex === 1 ? 1 : 0.7,
              }}
              transition={{ duration: 0.3 }}
              className="h-[420px]"
            >
              <ReviewNewsCard
                type="final"
                title="FINAL REVIEW"
                subtitle="Vol.2 · Final Edition"
                quizzes={finalQuizzes}
                isLoading={isLoading.final}
                onReview={onReview}
                onShowDetails={onShowDetails}
                isQuizBookmarked={isQuizBookmarked}
                onToggleBookmark={onToggleBookmark}
              />
            </motion.div>
          </motion.div>

          {/* 기출 카드 */}
          <motion.div className="w-full flex-shrink-0 px-2" style={{ perspective: 1000 }}>
            <motion.div
              animate={{
                rotateY: currentIndex === 2 ? 0 : currentIndex < 2 ? 15 : -15,
                scale: currentIndex === 2 ? 1 : 0.9,
                opacity: currentIndex === 2 ? 1 : 0.7,
              }}
              transition={{ duration: 0.3 }}
              className="h-[420px]"
            >
              <ReviewPastExamNewsCard
                quiz={pastQuiz}
                selectedPastExam={selectedPastExam}
                pastExamOptions={pastExamOptions}
                onSelectPastExam={onSelectPastExam}
                isLoading={isLoading.past}
                onReview={() => pastQuiz && onReview(pastQuiz.id)}
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
              currentIndex === index ? 'bg-[#1A1A1A] w-4' : 'bg-[#D4CFC4]'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
