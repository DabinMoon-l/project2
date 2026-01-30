'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  doc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { Button, Input } from '@/components/common';
import StepIndicator, { ONBOARDING_STEPS } from '@/components/onboarding/StepIndicator';
import CharacterPreview, {
  DEFAULT_CHARACTER_OPTIONS,
  type CharacterOptions,
} from '@/components/onboarding/CharacterPreview';

/**
 * 닉네임 유효성 상태
 */
type NicknameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

/**
 * 닉네임 설정 페이지
 * 온보딩 3단계: 닉네임 중복 확인 및 저장
 */
export default function NicknamePage() {
  const router = useRouter();

  // 닉네임 상태
  const [nickname, setNickname] = useState('');

  // 닉네임 유효성 상태
  const [nicknameStatus, setNicknameStatus] = useState<NicknameStatus>('idle');

  // 에러 메시지
  const [errorMessage, setErrorMessage] = useState('');

  // 로딩 상태
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 캐릭터 옵션 (로컬 스토리지에서 불러오기)
  const [characterOptions, setCharacterOptions] = useState<CharacterOptions>(
    DEFAULT_CHARACTER_OPTIONS
  );

  // 컴포넌트 마운트 시 캐릭터 정보 불러오기
  useEffect(() => {
    const savedCharacter = localStorage.getItem('onboarding_character');
    if (savedCharacter) {
      try {
        setCharacterOptions(JSON.parse(savedCharacter));
      } catch {
        console.error('캐릭터 정보 파싱 실패');
      }
    }
  }, []);

  /**
   * 닉네임 유효성 검사
   */
  const validateNickname = useCallback((value: string): boolean => {
    // 길이 검사 (2-10자)
    if (value.length < 2) {
      setErrorMessage('닉네임은 2자 이상이어야 합니다');
      setNicknameStatus('invalid');
      return false;
    }
    if (value.length > 10) {
      setErrorMessage('닉네임은 10자 이하여야 합니다');
      setNicknameStatus('invalid');
      return false;
    }

    // 특수문자 검사 (한글, 영문, 숫자만 허용)
    if (!/^[가-힣a-zA-Z0-9]+$/.test(value)) {
      setErrorMessage('한글, 영문, 숫자만 사용할 수 있습니다');
      setNicknameStatus('invalid');
      return false;
    }

    // 금지어 검사
    const bannedWords = ['관리자', 'admin', '운영자', '교수', 'professor'];
    if (bannedWords.some((word) => value.toLowerCase().includes(word.toLowerCase()))) {
      setErrorMessage('사용할 수 없는 닉네임입니다');
      setNicknameStatus('invalid');
      return false;
    }

    return true;
  }, []);

  /**
   * 닉네임 중복 확인
   */
  const checkNicknameDuplicate = useCallback(async (value: string) => {
    if (!validateNickname(value)) return;

    setNicknameStatus('checking');
    setErrorMessage('');

    try {
      // Firestore에서 닉네임 중복 확인
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('nickname', '==', value));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        setNicknameStatus('available');
        setErrorMessage('');
      } else {
        setNicknameStatus('taken');
        setErrorMessage('이미 사용 중인 닉네임입니다');
      }
    } catch (error) {
      console.error('닉네임 중복 확인 실패:', error);
      // 오프라인 또는 에러 시에도 진행 가능하도록 허용
      setNicknameStatus('available');
    }
  }, [validateNickname]);

  /**
   * 닉네임 입력 핸들러
   */
  const handleNicknameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setNickname(value);
    setNicknameStatus('idle');
    setErrorMessage('');
  }, []);

  /**
   * 중복 확인 버튼 핸들러
   */
  const handleCheckDuplicate = useCallback(() => {
    checkNicknameDuplicate(nickname);
  }, [nickname, checkNicknameDuplicate]);

  /**
   * 폼 제출 핸들러
   */
  const handleSubmit = async () => {
    // 닉네임 유효성 최종 확인
    if (!validateNickname(nickname)) return;

    // 중복 확인이 안 되었으면 자동으로 확인
    if (nicknameStatus !== 'available') {
      await checkNicknameDuplicate(nickname);
      // 중복이면 제출 중단
      if (nicknameStatus === 'taken') return;
    }

    setIsSubmitting(true);

    try {
      const user = auth.currentUser;

      if (user) {
        // Firestore에 닉네임 저장
        await setDoc(
          doc(db, 'users', user.uid),
          {
            nickname,
            onboardingStep: 3,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        // 로컬 스토리지에 임시 저장
        localStorage.setItem('onboarding_nickname', nickname);
      }

      // 다음 단계로 이동
      router.push(ONBOARDING_STEPS[2].path);
    } catch (error) {
      console.error('닉네임 저장 실패:', error);
      alert('저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 닉네임 상태에 따른 아이콘 렌더링
   */
  const renderStatusIcon = () => {
    switch (nicknameStatus) {
      case 'checking':
        return (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-5 h-5"
          >
            <svg className="w-5 h-5 text-[var(--theme-accent)]" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </motion.div>
        );
      case 'available':
        return (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-5 h-5 text-green-500"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </motion.div>
        );
      case 'taken':
      case 'invalid':
        return (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-5 h-5 text-red-500"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </motion.div>
        );
      default:
        return null;
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
          <h1 className="text-lg font-semibold text-[var(--theme-text)]">닉네임 설정</h1>
          <div className="w-10" />
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
            <CharacterPreview options={characterOptions} size="md" animated />

            {/* 닉네임 표시 영역 */}
            <motion.div
              className="mt-4 px-6 py-2 bg-[var(--theme-accent)]/20 rounded-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <span className="text-lg font-bold text-[var(--theme-accent)]">
                {nickname || '???'}
              </span>
            </motion.div>
          </motion.div>

          {/* 닉네임 입력 폼 */}
          <motion.div
            className="space-y-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            {/* 안내 문구 */}
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-[var(--theme-text)] mb-2">
                닉네임을 정해주세요
              </h2>
              <p className="text-sm text-[var(--theme-text-secondary)]">
                다른 용사들에게 보여질 이름입니다
              </p>
            </div>

            {/* 닉네임 입력 필드 */}
            <div>
              <label className="block text-sm font-medium text-[var(--theme-text)] mb-2">
                닉네임 *
              </label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Input
                    type="text"
                    placeholder="2-10자 (한글, 영문, 숫자)"
                    value={nickname}
                    onChange={handleNicknameChange}
                    maxLength={10}
                    error={errorMessage}
                    rightIcon={renderStatusIcon()}
                  />
                </div>
                <Button
                  onClick={handleCheckDuplicate}
                  disabled={!nickname || nicknameStatus === 'checking'}
                  variant="secondary"
                  size="md"
                  className="whitespace-nowrap"
                >
                  중복확인
                </Button>
              </div>

              {/* 상태 메시지 */}
              {nicknameStatus === 'available' && (
                <motion.p
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-2 text-sm text-green-500 flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  사용 가능한 닉네임입니다
                </motion.p>
              )}
            </div>

            {/* 닉네임 규칙 안내 */}
            <div className="bg-white/5 rounded-xl p-4">
              <h3 className="text-sm font-medium text-[var(--theme-text)] mb-3">
                닉네임 규칙
              </h3>
              <ul className="space-y-2 text-sm text-[var(--theme-text-secondary)]">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-accent)]" />
                  2자 이상 10자 이하
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-accent)]" />
                  한글, 영문, 숫자만 사용 가능
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-accent)]" />
                  부적절한 닉네임 사용 불가
                </li>
              </ul>
            </div>

          </motion.div>
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
            disabled={!nickname || nicknameStatus === 'invalid' || nicknameStatus === 'taken'}
            fullWidth
            size="lg"
            className="bg-white hover:bg-gray-100 text-black"
          >
            다음 단계로
          </Button>
        </motion.div>
      </footer>
    </motion.div>
  );
}
