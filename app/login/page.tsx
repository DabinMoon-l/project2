/**
 * 로그인 페이지
 *
 * Apple, Google, Naver 소셜 로그인을 제공합니다.
 * 이미 로그인된 사용자는 홈 화면으로 리다이렉트됩니다.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import SocialLoginButton from '@/components/auth/SocialLoginButton';

// ============================================================
// 애니메이션 설정
// ============================================================

/** 컨테이너 애니메이션 (stagger children) */
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

/** 개별 요소 애니메이션 */
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: 'easeOut',
    },
  },
};

/** 로고 애니메이션 */
const logoVariants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.6,
      ease: 'easeOut',
    },
  },
};

// ============================================================
// 컴포넌트
// ============================================================

export default function LoginPage() {
  const router = useRouter();
  const {
    user,
    loading,
    error,
    loginWithApple,
    loginWithGoogle,
    loginWithNaver,
    clearError,
  } = useAuth();

  // 이미 로그인된 경우 홈으로 리다이렉트
  useEffect(() => {
    if (user && !loading) {
      router.replace('/');
    }
  }, [user, loading, router]);

  // 에러 발생 시 3초 후 자동 초기화
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        clearError();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  // 로딩 중이거나 이미 로그인된 경우 로딩 화면 표시
  if (loading || user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-indigo-50 to-white">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
        >
          {/* 로딩 스피너 */}
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">로딩 중...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-indigo-50 to-white">
      <motion.div
        className="w-full max-w-sm flex flex-col items-center"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* 로고 영역 */}
        <motion.div
          className="mb-8 flex flex-col items-center"
          variants={logoVariants}
        >
          {/* 앱 아이콘/로고 */}
          <div className="w-24 h-24 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl flex items-center justify-center shadow-lg mb-4">
            <span className="text-4xl" role="img" aria-label="용사">
              ⚔️
            </span>
          </div>

          {/* 앱 이름 */}
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            용사 퀴즈
          </h1>

          {/* 앱 설명 */}
          <p className="text-gray-500 text-center text-sm leading-relaxed">
            퀴즈를 풀고 경험치를 얻어
            <br />
            전설의 용사가 되어보세요!
          </p>
        </motion.div>

        {/* 에러 메시지 */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="w-full mb-4 p-3 bg-red-50 border border-red-200 rounded-xl"
          >
            <p className="text-red-600 text-sm text-center">{error}</p>
          </motion.div>
        )}

        {/* 소셜 로그인 버튼 영역 */}
        <motion.div
          className="w-full space-y-3"
          variants={itemVariants}
        >
          {/* Apple 로그인 */}
          <motion.div variants={itemVariants}>
            <SocialLoginButton
              provider="apple"
              onClick={loginWithApple}
              loading={loading}
            />
          </motion.div>

          {/* Google 로그인 */}
          <motion.div variants={itemVariants}>
            <SocialLoginButton
              provider="google"
              onClick={loginWithGoogle}
              loading={loading}
            />
          </motion.div>

          {/* Naver 로그인 */}
          <motion.div variants={itemVariants}>
            <SocialLoginButton
              provider="naver"
              onClick={loginWithNaver}
              loading={loading}
            />
          </motion.div>
        </motion.div>

        {/* 하단 안내 문구 */}
        <motion.p
          className="mt-8 text-xs text-gray-400 text-center leading-relaxed"
          variants={itemVariants}
        >
          로그인 시{' '}
          <a href="/terms" className="underline hover:text-gray-600">
            이용약관
          </a>{' '}
          및{' '}
          <a href="/privacy" className="underline hover:text-gray-600">
            개인정보처리방침
          </a>
          에 동의하게 됩니다.
        </motion.p>
      </motion.div>
    </main>
  );
}
