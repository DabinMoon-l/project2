'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { Button } from '@/components/common';
import StepIndicator from '@/components/onboarding/StepIndicator';

/**
 * 튜토리얼 슬라이드 데이터 타입
 */
interface TutorialSlide {
  id: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  bgColor: string;
}

/**
 * 튜토리얼 슬라이드 데이터
 */
const TUTORIAL_SLIDES: TutorialSlide[] = [
  {
    id: 1,
    title: '퀴즈를 풀어보세요',
    description:
      '다양한 과목의 퀴즈를 풀고 경험치와 골드를 획득하세요.\nOX, 객관식, 주관식 문제가 준비되어 있어요.',
    icon: (
      <svg className="w-20 h-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
    ),
    bgColor: 'from-amber-500/20 to-orange-500/20',
  },
  {
    id: 2,
    title: '캐릭터를 성장시키세요',
    description:
      '퀴즈를 풀수록 캐릭터가 성장합니다.\n견습생에서 시작해 전설의 용사까지 도전하세요!',
    icon: (
      <svg className="w-20 h-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    ),
    bgColor: 'from-purple-500/20 to-pink-500/20',
  },
  {
    id: 3,
    title: '계급을 올려보세요',
    description:
      '경험치를 모아 계급을 올리세요.\n견습생에서 전설의 용사까지 도전해보세요!',
    icon: (
      <svg className="w-20 h-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
        />
      </svg>
    ),
    bgColor: 'from-emerald-500/20 to-teal-500/20',
  },
  {
    id: 4,
    title: '피드백으로 수업에 참여하세요',
    description:
      '문제에 대한 피드백을 남기고\n게시판에서 다른 용사들과 소통해보세요.',
    icon: (
      <svg className="w-20 h-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
        />
      </svg>
    ),
    bgColor: 'from-blue-500/20 to-indigo-500/20',
  },
];

/**
 * 튜토리얼 페이지
 * 온보딩 4단계: 앱 사용법 안내 슬라이드
 */
export default function TutorialPage() {
  const router = useRouter();

  // 현재 슬라이드 인덱스
  const [currentSlide, setCurrentSlide] = useState(0);

  // 로딩 상태
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * 다음 슬라이드로 이동
   */
  const handleNext = useCallback(() => {
    if (currentSlide < TUTORIAL_SLIDES.length - 1) {
      setCurrentSlide((prev) => prev + 1);
    }
  }, [currentSlide]);

  /**
   * 이전 슬라이드로 이동
   */
  const handlePrev = useCallback(() => {
    if (currentSlide > 0) {
      setCurrentSlide((prev) => prev - 1);
    }
  }, [currentSlide]);

  /**
   * 온보딩 완료 핸들러
   */
  const handleComplete = async () => {
    setIsSubmitting(true);

    try {
      const user = auth.currentUser;

      if (user) {
        // Firestore에 온보딩 완료 표시
        await setDoc(
          doc(db, 'users', user.uid),
          {
            onboardingCompleted: true,
            onboardingCompletedAt: serverTimestamp(),
            // 초기 스탯 설정
            stats: {
              level: 1,
              exp: 0,
              rank: '견습생',
            },
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      // 로컬 스토리지 정리
      localStorage.removeItem('onboarding_student_info');
      localStorage.removeItem('onboarding_character');
      localStorage.removeItem('onboarding_nickname');

      // 홈으로 이동
      router.push('/');
    } catch (error) {
      console.error('온보딩 완료 처리 실패:', error);
      // 에러가 나도 홈으로 이동
      router.push('/');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 스킵 핸들러 (바로 완료 처리)
   */
  const handleSkip = useCallback(() => {
    handleComplete();
  }, []);

  /**
   * 스와이프 핸들러
   */
  const handleDragEnd = useCallback(
    (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
      const swipeThreshold = 50;
      const swipeVelocity = 500;

      if (info.offset.x < -swipeThreshold || info.velocity.x < -swipeVelocity) {
        // 왼쪽으로 스와이프: 다음 슬라이드
        handleNext();
      } else if (info.offset.x > swipeThreshold || info.velocity.x > swipeVelocity) {
        // 오른쪽으로 스와이프: 이전 슬라이드
        handlePrev();
      }
    },
    [handleNext, handlePrev]
  );

  const currentSlideData = TUTORIAL_SLIDES[currentSlide];
  const isLastSlide = currentSlide === TUTORIAL_SLIDES.length - 1;

  /**
   * 페이지 전환 애니메이션 설정
   */
  const pageVariants = {
    initial: { opacity: 0, x: 50 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -50 },
  };

  /**
   * 슬라이드 애니메이션 설정
   */
  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 300 : -300,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 300 : -300,
      opacity: 0,
    }),
  };

  return (
    <motion.div
      className="min-h-screen bg-[var(--theme-background)] flex flex-col"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.3 }}
    >
      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-[var(--theme-background)]/95 backdrop-blur-sm border-b border-[var(--theme-border)] px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)]"
            aria-label="뒤로가기"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-[var(--theme-text)]">시작하기</h1>
          {/* 스킵 버튼 */}
          <button
            onClick={handleSkip}
            className="px-3 py-1 text-sm text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)]"
          >
            건너뛰기
          </button>
        </div>
        <StepIndicator currentStep={3} />
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 슬라이드 영역 */}
        <div className="flex-1 relative overflow-hidden">
          <AnimatePresence mode="wait" custom={currentSlide}>
            <motion.div
              key={currentSlide}
              custom={currentSlide}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                x: { type: 'spring', stiffness: 300, damping: 30 },
                opacity: { duration: 0.2 },
              }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.2}
              onDragEnd={handleDragEnd}
              className="absolute inset-0 flex flex-col items-center justify-center px-8"
            >
              {/* 아이콘 배경 */}
              <motion.div
                className={`
                  mb-8 p-8 rounded-full
                  bg-gradient-to-br ${currentSlideData.bgColor}
                `}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, type: 'spring' }}
              >
                <div className="text-[var(--theme-accent)]">
                  {currentSlideData.icon}
                </div>
              </motion.div>

              {/* 타이틀 */}
              <motion.h2
                className="text-2xl font-bold text-[var(--theme-text)] text-center mb-4"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                {currentSlideData.title}
              </motion.h2>

              {/* 설명 */}
              <motion.p
                className="text-base text-[var(--theme-text-secondary)] text-center whitespace-pre-line max-w-sm"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
              >
                {currentSlideData.description}
              </motion.p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 페이지 인디케이터 */}
        <div className="flex justify-center gap-2 py-4">
          {TUTORIAL_SLIDES.map((slide, index) => (
            <motion.button
              key={slide.id}
              onClick={() => setCurrentSlide(index)}
              className={`
                h-2 rounded-full transition-all duration-300
                ${
                  index === currentSlide
                    ? 'w-6 bg-[var(--theme-accent)]'
                    : 'w-2 bg-[var(--theme-text-secondary)]/30 hover:bg-[var(--theme-text-secondary)]/50'
                }
              `}
              whileHover={{ scale: 1.2 }}
              whileTap={{ scale: 0.9 }}
              aria-label={`슬라이드 ${index + 1}`}
            />
          ))}
        </div>
      </main>

      {/* 하단 버튼 영역 */}
      <footer className="bg-[var(--theme-background)]/95 backdrop-blur-sm border-t border-[var(--theme-border)] px-4 py-4 safe-area-pb">
        <div className="flex gap-3">
          {/* 이전 버튼 */}
          {currentSlide > 0 && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Button
                onClick={handlePrev}
                variant="ghost"
                size="lg"
                className="px-6"
              >
                이전
              </Button>
            </motion.div>
          )}

          {/* 다음/시작하기 버튼 */}
          <div className="flex-1">
            <Button
              onClick={isLastSlide ? handleComplete : handleNext}
              loading={isSubmitting}
              fullWidth
              size="lg"
              className="bg-white hover:bg-gray-100 text-black"
            >
              {isLastSlide ? (
                <span className="flex items-center gap-2">
                  시작하기
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              ) : (
                '다음'
              )}
            </Button>
          </div>
        </div>
      </footer>
    </motion.div>
  );
}
