/**
 * 회원가입 페이지
 *
 * 이메일/비밀번호로 회원가입 후 인증 메일 발송
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';

// 교수님 이메일 목록
const PROFESSOR_EMAILS = [
  'jkim@ccn.ac.kr',
];

// 애니메이션 설정
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

export default function SignupPage() {
  const router = useRouter();
  const {
    user,
    loading,
    error,
    signUpWithEmailPassword,
    emailVerified,
    clearError,
  } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState(false);

  // 이미 로그인된 경우
  useEffect(() => {
    const handleLoggedIn = async () => {
      if (user && emailVerified) {
        // 교수님 이메일 체크
        const isProfessor = PROFESSOR_EMAILS.includes(user.email || '');

        if (isProfessor) {
          // 교수님은 Firestore에 바로 저장하고 홈으로 이동
          const userDocRef = doc(db, 'users', user.uid);
          await setDoc(userDocRef, {
            email: user.email,
            nickname: '교수님',
            role: 'professor',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true });

          router.replace('/');
        } else {
          router.replace('/onboarding');
        }
      }
    };

    handleLoggedIn();
  }, [user, emailVerified, router]);

  // 에러 자동 초기화
  useEffect(() => {
    if (error || localError) {
      const timer = setTimeout(() => {
        clearError();
        setLocalError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, localError, clearError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    // 유효성 검사
    if (!email || !password || !passwordConfirm) {
      setLocalError('모든 필드를 입력해주세요.');
      return;
    }

    if (password !== passwordConfirm) {
      setLocalError('비밀번호가 일치하지 않습니다.');
      return;
    }

    if (password.length < 6) {
      setLocalError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }

    await signUpWithEmailPassword(email, password);

    // 에러가 없으면 성공
    if (!error) {
      setSignupSuccess(true);
    }
  };

  // 회원가입 성공 후 인증 메일 안내
  if (signupSuccess && user && !emailVerified) {
    return (
      <main className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#1a1a2e] to-[#16213e]">
        <motion.div
          className="relative z-10 w-full max-w-sm px-6 text-center"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={itemVariants} className="mb-8">
            <div className="w-20 h-20 mx-auto mb-4 bg-green-500 rounded-full flex items-center justify-center">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">인증 메일 발송 완료</h1>
            <p className="text-white/80 text-sm">
              <span className="text-green-400 font-medium">{email}</span>
              <br />
              위 이메일로 인증 메일을 보냈습니다.
            </p>
          </motion.div>

          <motion.div variants={itemVariants} className="bg-white/10 backdrop-blur-sm rounded-xl p-4 mb-6">
            <p className="text-white/90 text-sm leading-relaxed">
              1. 이메일에서 인증 링크를 클릭해주세요
              <br />
              2. 인증 완료 후 다시 앱을 열어주세요
              <br />
              3. 학적정보 입력으로 이동합니다
            </p>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Link
              href="/login"
              className="block w-full py-3 bg-white/20 text-white font-medium rounded-xl hover:bg-white/30 transition-colors"
            >
              로그인 페이지로 돌아가기
            </Link>
          </motion.div>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#1a1a2e] to-[#16213e]">
      <motion.div
        className="relative z-10 w-full max-w-sm px-6"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* 로고 */}
        <motion.div className="flex justify-center mb-8" variants={itemVariants}>
          <Image
            src="/images/logo.png"
            alt="QuizBunny"
            width={200}
            height={70}
            className="drop-shadow-lg"
            priority
          />
        </motion.div>

        {/* 타이틀 */}
        <motion.h1
          className="text-2xl font-bold text-white text-center mb-6"
          variants={itemVariants}
        >
          회원가입
        </motion.h1>

        {/* 에러 메시지 */}
        {(error || localError) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 p-3 bg-red-500/90 backdrop-blur-sm rounded-xl"
          >
            <p className="text-white text-sm text-center">{error || localError}</p>
          </motion.div>
        )}

        {/* 회원가입 폼 */}
        <motion.form onSubmit={handleSubmit} variants={itemVariants}>
          <div className="space-y-4">
            <div>
              <input
                type="email"
                placeholder="이메일"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-colors"
                disabled={loading}
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="비밀번호 (6자 이상)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-colors"
                disabled={loading}
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="비밀번호 확인"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-colors"
                disabled={loading}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 py-3 bg-white text-gray-900 font-medium rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '처리 중...' : '회원가입'}
          </button>
        </motion.form>

        {/* 로그인 링크 */}
        <motion.p
          className="mt-6 text-center text-white/70 text-sm"
          variants={itemVariants}
        >
          이미 계정이 있으신가요?{' '}
          <Link href="/login" className="text-white underline hover:text-white/80">
            로그인
          </Link>
        </motion.p>
      </motion.div>
    </main>
  );
}
