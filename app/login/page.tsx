/**
 * 로그인 페이지
 *
 * 픽셀 아트 스타일 배경과 깔끔한 로그인 UI
 * 이미 로그인된 사용자는 온보딩으로 리다이렉트됩니다.
 */

'use client';

import { useEffect, useState, useRef } from 'react';
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
    loginWithEmail,
    emailVerified,
    clearError,
  } = useAuth();

  // 이메일 로그인 폼 상태
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 리다이렉트 중복 방지
  const isRedirecting = useRef(false);

  // 이미 로그인된 경우
  useEffect(() => {
    const handleLogin = async () => {
      if (user && !loading && !isRedirecting.current) {
        isRedirecting.current = true;

        try {
          // 이메일 인증이 필요한 경우 (이메일/비밀번호 로그인)
          // 테스트 계정(test로 시작) 또는 특정 이메일은 인증 스킵
          const isTestAccount = user.email?.startsWith('test') || user.email === 'jkim@ccn.ac.kr';
          if (user.providerData[0]?.providerId === 'password' && !emailVerified && !isTestAccount) {
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
                onboardingCompleted: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }

            router.replace('/');
          } else {
            // 학생: 온보딩 완료 여부 확인
            const userDocRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);

            if (userDoc.exists() && userDoc.data()?.onboardingCompleted) {
              // 온보딩 완료된 학생은 홈으로
              router.replace('/');
            } else {
              // 온보딩 미완료 학생은 학적정보 입력으로 직접 이동
              router.replace('/onboarding/student-info');
            }
          }
        } catch (err) {
          console.error('로그인 처리 에러:', err);
          isRedirecting.current = false;
          // 에러 발생 시에도 홈으로 시도 (layout에서 다시 체크함)
          router.replace('/');
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
      <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
        {/* 비디오 배경 */}
        <VideoBackground />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="relative z-10 flex flex-col items-center gap-4"
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
      <div className="absolute top-12 left-6 z-10">
        <Image
          src="/images/corner-image.png"
          alt="장식 이미지"
          width={280}
          height={140}
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

        {/* 로그인 폼 영역 */}
        <motion.div
          className="max-w-xs mx-auto mt-4 space-y-3"
          variants={itemVariants}
        >
          {/* 이메일 로그인 폼 */}
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 bg-white/10 border border-white/30 text-white placeholder-white/50 rounded-xl focus:outline-none focus:border-white/60"
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-white/10 border border-white/30 text-white placeholder-white/50 rounded-xl focus:outline-none focus:border-white/60"
          />
          <button
            onClick={async () => {
              if (email && password) {
                await loginWithEmail(email, password);
              }
            }}
            disabled={loading || !email || !password}
            className="w-full py-3 bg-white text-black font-medium rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>

          {/* 이메일 회원가입 링크 */}
          <Link
            href="/signup"
            className="block w-full py-2 text-white/70 text-sm text-center hover:text-white transition-colors"
          >
            계정이 없으신가요? <span className="underline">회원가입</span>
          </Link>

          {/* 구분선 */}
          <div className="flex items-center gap-3 pt-2">
            <div className="flex-1 h-px bg-white/30" />
            <span className="text-white/50 text-xs">또는</span>
            <div className="flex-1 h-px bg-white/30" />
          </div>

          {/* 구글 로그인 */}
          <SocialLoginButton
            provider="google"
            onClick={loginWithGoogle}
            loading={loading}
          />
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
