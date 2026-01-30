/**
 * 로그인 페이지
 *
 * 픽셀 아트 스타일 배경과 깔끔한 로그인 UI
 * 이미 로그인된 사용자는 온보딩으로 리다이렉트됩니다.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import SocialLoginButton from '@/components/auth/SocialLoginButton';

// 교수님 이메일 목록
const PROFESSOR_EMAILS = [
  'jkim@ccn.ac.kr',
];

// ============================================================
// 애니메이션 설정
// ============================================================

/** 컨테이너 애니메이션 */
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.3,
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

// ============================================================
// 비디오 배경 컴포넌트
// ============================================================

/** 비디오 배경 (MP4) */
function VideoBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* 비디오 배경 */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        poster="/images/login-poster.jpg"  // 비디오 로딩 전 표시할 이미지 (선택)
      >
        <source src="/videos/login-bg.mp4" type="video/mp4" />
        {/* 비디오 미지원 브라우저용 폴백 */}
        Your browser does not support the video tag.
      </video>

      {/* 오버레이 (가독성을 위해 살짝 어둡게) */}
      <div className="absolute inset-0 bg-black/20" />
    </div>
  );
}

// ============================================================
// 컴포넌트
// ============================================================

export default function LoginPage() {
  const router = useRouter();
  const {
    user,
    loading,
    error,
    loginWithGoogle,
    emailVerified,
    clearError,
  } = useAuth();

  // 이미 로그인된 경우
  useEffect(() => {
    const handleLogin = async () => {
      if (user && !loading) {
        // 이메일 인증이 필요한 경우 (이메일/비밀번호 로그인)
        if (user.providerData[0]?.providerId === 'password' && !emailVerified) {
          router.replace('/verify-email');
          return;
        }

        // 교수님 이메일 체크
        const isProfessor = PROFESSOR_EMAILS.includes(user.email || '');

        if (isProfessor) {
          // 교수님은 Firestore에 바로 저장하고 홈으로 이동
          const userDocRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userDocRef);

          if (!userDoc.exists()) {
            // 첫 로그인인 경우 교수님 정보 생성
            await setDoc(userDocRef, {
              email: user.email,
              nickname: '교수님',
              role: 'professor',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          router.replace('/');
        } else {
          // 학생은 온보딩으로
          router.replace('/onboarding');
        }
      }
    };

    handleLogin();
  }, [user, loading, emailVerified, router]);

  // 에러 발생 시 5초 후 자동 초기화
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#1a1a2e] to-[#16213e]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          <p className="text-white text-sm font-medium drop-shadow-md">로딩 중...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-start pt-44 overflow-hidden">
      {/* 비디오 배경 */}
      <VideoBackground />

      {/* 좌측 상단 이미지 */}
      <div className="absolute top-0 left-0 z-10">
        <Image
          src="/images/corner-image.png"
          alt="장식 이미지"
          width={360}
          height={360}
          className="drop-shadow-lg"
        />
      </div>

      {/* 콘텐츠 영역 */}
      <motion.div
        className="relative z-10 w-full px-6"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* 로고 이미지 */}
        <motion.div
          className="flex justify-center"
          variants={itemVariants}
        >
          <Image
            src="/images/logo.png"
            alt="QuizBunny"
            width={300}
            height={100}
            className="drop-shadow-lg"
            priority
          />
        </motion.div>

        {/* 로그인 버튼 영역 */}
        <motion.div
          className="max-w-xs mx-auto mt-4 space-y-3"
          variants={itemVariants}
        >
          <SocialLoginButton
            provider="google"
            onClick={loginWithGoogle}
            loading={loading}
          />

          {/* 구분선 */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/30" />
            <span className="text-white/50 text-xs">또는</span>
            <div className="flex-1 h-px bg-white/30" />
          </div>

          {/* 이메일 회원가입 링크 */}
          <Link
            href="/signup"
            className="block w-full py-3 bg-white/10 border border-white/30 text-white font-medium rounded-xl text-center hover:bg-white/20 transition-colors"
          >
            이메일로 회원가입
          </Link>
        </motion.div>

        {/* 에러 메시지 */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="max-w-sm mx-auto mt-4 p-3 bg-red-500/90 backdrop-blur-sm rounded-xl"
          >
            <p className="text-white text-sm text-center">{error}</p>
          </motion.div>
        )}

        {/* 하단 안내 문구 */}
        <motion.p
          className="mt-6 text-xs text-white/70 text-center"
          variants={itemVariants}
        >
          로그인 시{' '}
          <a href="/terms" className="underline hover:text-white">
            이용약관
          </a>{' '}
          및{' '}
          <a href="/privacy" className="underline hover:text-white">
            개인정보처리방침
          </a>
          에 동의하게 됩니다.
        </motion.p>
      </motion.div>
    </main>
  );
}
