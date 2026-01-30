'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { Button } from '@/components/common';
import StepIndicator, { ONBOARDING_STEPS } from '@/components/onboarding/StepIndicator';
import {
  HAIR_STYLES,
  SKIN_COLORS,
  DEFAULT_CHARACTER_OPTIONS,
  type CharacterOptions,
} from '@/components/onboarding/CharacterPreview';

/**
 * 현재 선택 중인 옵션 탭
 */
type OptionTab = 'hair' | 'skin';

/**
 * 캐릭터 생성 페이지
 * 온보딩 2단계: 머리스타일, 피부색 선택
 */
export default function CharacterPage() {
  const router = useRouter();

  // 캐릭터 옵션 상태
  const [options, setOptions] = useState<CharacterOptions>(DEFAULT_CHARACTER_OPTIONS);

  // 현재 선택 중인 탭
  const [activeTab, setActiveTab] = useState<OptionTab>('hair');

  // 로딩 상태
  const [isSubmitting, setIsSubmitting] = useState(false);


  /**
   * 옵션 변경 핸들러
   */
  const handleOptionChange = useCallback(
    (key: keyof CharacterOptions, value: number) => {
      setOptions((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  /**
   * 폼 제출 핸들러
   */
  const handleSubmit = async () => {
    setIsSubmitting(true);

    try {
      const user = auth.currentUser;

      if (user) {
        // Firestore에 캐릭터 정보 저장
        await setDoc(
          doc(db, 'users', user.uid),
          {
            character: {
              hairStyle: options.hairStyle,
              skinColor: options.skinColor,
            },
            onboardingStep: 3,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        // 로컬 스토리지에 임시 저장
        localStorage.setItem('onboarding_character', JSON.stringify(options));
      }

      // 다음 단계로 이동
      router.push(ONBOARDING_STEPS[2].path);
    } catch (error) {
      console.error('캐릭터 저장 실패:', error);
      alert('저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 캐릭터 이미지 경로
  const characterImagePath = `/images/characters/skin_${options.skinColor}_hair_${options.hairStyle}.png`;

  // 현재 탭의 옵션 목록
  const currentOptions = activeTab === 'hair' ? HAIR_STYLES : SKIN_COLORS;

  return (
    <motion.div
      className="min-h-screen bg-[var(--theme-background)] flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* 헤더 */}
      <header className="sticky top-0 z-20 bg-[var(--theme-background)]/95 backdrop-blur-sm border-b border-[var(--theme-border)] px-4 py-3">
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
          <h1 className="text-lg font-semibold text-[var(--theme-text)]">캐릭터 만들기</h1>
          <div className="w-10" />
        </div>
        <StepIndicator currentStep={2} />
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 relative overflow-hidden">
        {/* 비디오 배경 - 전체 화면 */}
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/videos/character-bg.mp4" type="video/mp4" />
        </video>

        {/* 오버레이 */}
        <div className="absolute inset-0 bg-black/30" />

        {/* 왼쪽 사이드 - 탭 선택 (절대 위치) */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-4">
          <button
            onClick={() => setActiveTab('hair')}
            className={`
              px-6 py-4 rounded-xl transition-all duration-200 text-base font-medium
              ${activeTab === 'hair'
                ? 'bg-[var(--theme-accent)] text-white'
                : 'bg-black/40 text-white/80 hover:bg-black/60'
              }
            `}
          >
            머리
          </button>
          <button
            onClick={() => setActiveTab('skin')}
            className={`
              px-6 py-4 rounded-xl transition-all duration-200 text-base font-medium
              ${activeTab === 'skin'
                ? 'bg-[var(--theme-accent)] text-white'
                : 'bg-black/40 text-white/80 hover:bg-black/60'
              }
            `}
          >
            피부
          </button>
        </div>

        {/* 중앙 - 캐릭터 이미지 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            key={`${options.hairStyle}-${options.skinColor}`}
            className="relative z-10 w-64 h-80"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            <Image
              src={characterImagePath}
              alt="캐릭터 미리보기"
              fill
              className="object-contain drop-shadow-2xl"
              priority
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = '/images/characters/default.png';
              }}
            />
          </motion.div>
        </div>

        {/* 선택 정보 표시 */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-3">
          <span className="px-4 py-2 bg-black/50 backdrop-blur-sm text-white rounded-full text-sm font-medium">
            {HAIR_STYLES[options.hairStyle]?.name}
          </span>
          <span className="px-4 py-2 bg-black/50 backdrop-blur-sm text-white rounded-full text-sm font-medium">
            {SKIN_COLORS[options.skinColor]?.name}
          </span>
        </div>

        {/* 오른쪽 사이드 - 옵션 선택 (절대 위치) */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              className="flex flex-col gap-2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {currentOptions.map((option, index) => {
                const isSelected = activeTab === 'hair'
                  ? options.hairStyle === index
                  : options.skinColor === index;

                // 옵션별 썸네일 이미지 경로
                const thumbnailPath = activeTab === 'hair'
                  ? `/images/characters/thumbnails/hair_${index}.png`
                  : `/images/characters/thumbnails/skin_${index}.png`;

                return (
                  <motion.button
                    key={option.id}
                    onClick={() => handleOptionChange(
                      activeTab === 'hair' ? 'hairStyle' : 'skinColor',
                      index
                    )}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`
                      relative w-20 h-20 rounded-xl overflow-hidden
                      transition-all duration-200 border-2
                      ${isSelected
                        ? 'border-[var(--theme-accent)] shadow-lg'
                        : 'border-white/50 hover:border-white'
                      }
                    `}
                  >
                    {/* 썸네일 이미지 */}
                    <Image
                      src={thumbnailPath}
                      alt={option.name}
                      fill
                      className="object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = '/images/characters/thumbnails/default.png';
                      }}
                    />

                    {/* 선택 표시 */}
                    {isSelected && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute top-1 right-1 w-5 h-5 bg-[var(--theme-accent)] rounded-full flex items-center justify-center"
                      >
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </motion.div>
                    )}

                    {/* 라벨 */}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 py-1">
                      <p className="text-[10px] text-white text-center truncate px-1">
                        {option.name}
                      </p>
                    </div>
                  </motion.button>
                );
              })}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* 하단 버튼 영역 */}
      <footer className="sticky bottom-0 z-20 bg-[var(--theme-background)]/95 backdrop-blur-sm border-t border-[var(--theme-border)] px-4 py-4 safe-area-pb">
        <Button
          onClick={handleSubmit}
          loading={isSubmitting}
          fullWidth
          size="lg"
          className="bg-white hover:bg-gray-100 text-black"
        >
          캐릭터 저장
        </Button>
      </footer>
    </motion.div>
  );
}
