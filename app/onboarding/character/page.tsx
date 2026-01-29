'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { Button } from '@/components/common';
import StepIndicator, { ONBOARDING_STEPS } from '@/components/onboarding/StepIndicator';
import CharacterPreview, {
  HAIR_STYLES,
  SKIN_COLORS,
  BEARD_STYLES,
  DEFAULT_CHARACTER_OPTIONS,
  type CharacterOptions,
} from '@/components/onboarding/CharacterPreview';

/**
 * 현재 선택 중인 옵션 탭
 */
type OptionTab = 'hair' | 'skin' | 'beard';

/**
 * 캐릭터 생성 페이지
 * 온보딩 2단계: 머리스타일, 피부색, 수염 선택
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
   * 랜덤 캐릭터 생성
   */
  const handleRandomize = useCallback(() => {
    setOptions({
      hairStyle: Math.floor(Math.random() * HAIR_STYLES.length),
      skinColor: Math.floor(Math.random() * SKIN_COLORS.length),
      beard: Math.floor(Math.random() * BEARD_STYLES.length),
    });
  }, []);

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
              beard: options.beard,
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

  /**
   * 탭 정보
   */
  const tabs: { id: OptionTab; label: string; icon: string }[] = [
    { id: 'hair', label: '머리', icon: '💇' },
    { id: 'skin', label: '피부', icon: '🎨' },
    { id: 'beard', label: '수염', icon: '🧔' },
  ];

  /**
   * 현재 탭에 해당하는 옵션 목록 렌더링
   */
  const renderOptions = () => {
    switch (activeTab) {
      case 'hair':
        return (
          <div className="grid grid-cols-4 gap-2">
            {HAIR_STYLES.map((style, index) => (
              <motion.button
                key={style}
                type="button"
                onClick={() => handleOptionChange('hairStyle', index)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={`
                  px-3 py-2.5 rounded-xl text-xs font-medium
                  transition-all duration-200
                  ${
                    options.hairStyle === index
                      ? 'bg-[var(--theme-accent)] text-white shadow-lg'
                      : 'bg-white/10 text-[var(--theme-text)] border border-[var(--theme-border)] hover:bg-white/20'
                  }
                `}
              >
                {style}
              </motion.button>
            ))}
          </div>
        );

      case 'skin':
        return (
          <div className="grid grid-cols-5 gap-3">
            {SKIN_COLORS.map((skin, index) => (
              <motion.button
                key={skin.name}
                type="button"
                onClick={() => handleOptionChange('skinColor', index)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className={`
                  relative flex flex-col items-center justify-center
                  p-2 rounded-xl
                  transition-all duration-200
                  ${
                    options.skinColor === index
                      ? 'ring-2 ring-[var(--theme-accent)] ring-offset-2 ring-offset-[var(--theme-background)] shadow-lg'
                      : 'hover:bg-white/10'
                  }
                `}
                title={skin.name}
              >
                {/* 색상 원 */}
                <div
                  className="w-10 h-10 rounded-full shadow-inner mb-1"
                  style={{ backgroundColor: skin.color }}
                />
                {/* 이모지 */}
                <span className="text-lg">{skin.emoji}</span>
                {/* 선택 표시 */}
                {options.skinColor === index && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center"
                  >
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </motion.div>
                )}
              </motion.button>
            ))}
          </div>
        );

      case 'beard':
        return (
          <div className="grid grid-cols-2 gap-3">
            {BEARD_STYLES.map((style, index) => (
              <motion.button
                key={style}
                type="button"
                onClick={() => handleOptionChange('beard', index)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`
                  flex items-center justify-center gap-2
                  px-4 py-4 rounded-2xl text-base font-medium
                  transition-all duration-200
                  ${
                    options.beard === index
                      ? 'bg-[var(--theme-accent)] text-white shadow-lg'
                      : 'bg-white/10 text-[var(--theme-text)] border border-[var(--theme-border)] hover:bg-white/20'
                  }
                `}
              >
                {/* 수염 아이콘 */}
                <span className="text-2xl">
                  {index === 0 ? '😊' : index === 1 ? '🥸' : index === 2 ? '🧔' : '🧔‍♂️'}
                </span>
                <span>{style}</span>
              </motion.button>
            ))}
          </div>
        );
    }
  };

  /**
   * 페이지 전환 애니메이션 설정
   */
  const pageVariants = {
    initial: { opacity: 0, x: 50 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -50 },
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
          <h1 className="text-lg font-semibold text-[var(--theme-text)]">캐릭터 만들기</h1>
          {/* 랜덤 버튼 */}
          <motion.button
            onClick={handleRandomize}
            whileHover={{ scale: 1.1, rotate: 180 }}
            whileTap={{ scale: 0.9 }}
            className="p-2 -mr-2 text-[var(--theme-accent)] hover:bg-[var(--theme-accent)]/10 rounded-full"
            aria-label="랜덤 캐릭터"
            title="랜덤 생성"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </motion.button>
        </div>
        <StepIndicator currentStep={2} />
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 px-4 py-6 overflow-y-auto">
        <div className="max-w-md mx-auto">
          {/* 캐릭터 미리보기 */}
          <motion.div
            className="flex flex-col items-center mb-8"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="relative">
              {/* 배경 장식 */}
              <div className="absolute inset-0 -m-8 bg-gradient-to-b from-[var(--theme-accent)]/20 to-transparent rounded-full blur-2xl" />
              <CharacterPreview options={options} size="lg" animated />
            </div>

            {/* 캐릭터 정보 태그 */}
            <motion.div
              className="flex gap-2 mt-8"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <span className="px-3 py-1 bg-[var(--theme-accent)]/20 text-[var(--theme-accent)] rounded-full text-xs font-medium">
                {HAIR_STYLES[options.hairStyle]}
              </span>
              <span className="px-3 py-1 bg-[var(--theme-accent)]/20 text-[var(--theme-accent)] rounded-full text-xs font-medium">
                {SKIN_COLORS[options.skinColor].name}
              </span>
              <span className="px-3 py-1 bg-[var(--theme-accent)]/20 text-[var(--theme-accent)] rounded-full text-xs font-medium">
                {BEARD_STYLES[options.beard]}
              </span>
            </motion.div>
          </motion.div>

          {/* 옵션 탭 */}
          <div className="mb-4">
            <div className="flex bg-white/5 rounded-xl p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex-1 flex items-center justify-center gap-2
                    py-2.5 rounded-lg text-sm font-medium
                    transition-all duration-200
                    ${
                      activeTab === tab.id
                        ? 'bg-[var(--theme-accent)] text-white shadow-md'
                        : 'text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)]'
                    }
                  `}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 옵션 선택 영역 */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="bg-white/5 rounded-2xl p-4 min-h-[200px]"
            >
              <h3 className="text-sm font-medium text-[var(--theme-text-secondary)] mb-4">
                {activeTab === 'hair' && `머리스타일 (${HAIR_STYLES.length}종)`}
                {activeTab === 'skin' && `피부색 (${SKIN_COLORS.length}종)`}
                {activeTab === 'beard' && `수염 (${BEARD_STYLES.length}종)`}
              </h3>
              {renderOptions()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* 하단 버튼 영역 */}
      <footer className="sticky bottom-0 bg-[var(--theme-background)]/95 backdrop-blur-sm border-t border-[var(--theme-border)] px-4 py-4 safe-area-pb">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Button
            onClick={handleSubmit}
            loading={isSubmitting}
            fullWidth
            size="lg"
            className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-light)]"
          >
            캐릭터 저장
          </Button>
        </motion.div>
      </footer>
    </motion.div>
  );
}
