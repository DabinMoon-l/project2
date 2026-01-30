/**
 * 이메일 인증 대기 페이지
 *
 * 이메일 인증이 완료되지 않은 사용자를 위한 페이지
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/lib/hooks/useAuth';
import { auth, db } from '@/lib/firebase';

// 교수님 이메일 목록
const PROFESSOR_EMAILS = [
  'jkim@ccn.ac.kr',
];

export default function VerifyEmailPage() {
  const router = useRouter();
  const {
    user,
    loading,
    error,
    emailVerified,
    sendVerificationEmail,
    logout,
    clearError,
  } = useAuth();

  const [resendCooldown, setResendCooldown] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  // 로그인되지 않은 경우 로그인 페이지로
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  // 이메일 인증 완료된 경우
  useEffect(() => {
    const handleVerified = async () => {
      if (user && emailVerified) {
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

    handleVerified();
  }, [user, emailVerified, router]);

  // 주기적으로 인증 상태 확인 (5초마다)
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      await auth.currentUser?.reload();
      if (auth.currentUser?.emailVerified) {
        const isProfessor = PROFESSOR_EMAILS.includes(user.email || '');

        if (isProfessor) {
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
    }, 5000);

    return () => clearInterval(interval);
  }, [user, router]);

  // 쿨다운 타이머
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  // 에러 자동 초기화
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => clearError(), 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  const handleResend = async () => {
    if (resendCooldown > 0) return;

    await sendVerificationEmail();
    if (!error) {
      setMessage('인증 메일을 다시 보냈습니다.');
      setResendCooldown(60); // 60초 쿨다운
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#1a1a2e] to-[#16213e]">
        <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#1a1a2e] to-[#16213e]">
      <motion.div
        className="relative z-10 w-full max-w-sm px-6 text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* 아이콘 */}
        <div className="w-20 h-20 mx-auto mb-6 bg-yellow-500 rounded-full flex items-center justify-center">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>

        {/* 타이틀 */}
        <h1 className="text-2xl font-bold text-white mb-2">이메일 인증 필요</h1>
        <p className="text-white/80 text-sm mb-6">
          <span className="text-yellow-400 font-medium">{user.email}</span>
          <br />
          위 이메일로 발송된 인증 링크를 클릭해주세요.
        </p>

        {/* 안내 박스 */}
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 mb-6 text-left">
          <p className="text-white/90 text-sm leading-relaxed">
            • 메일함에서 인증 링크를 클릭하세요
            <br />
            • 스팸 메일함도 확인해주세요
            <br />
            • 인증 완료 후 자동으로 이동됩니다
          </p>
        </div>

        {/* 메시지 */}
        {message && (
          <div className="mb-4 p-3 bg-green-500/90 backdrop-blur-sm rounded-xl">
            <p className="text-white text-sm">{message}</p>
          </div>
        )}

        {/* 에러 메시지 */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/90 backdrop-blur-sm rounded-xl">
            <p className="text-white text-sm">{error}</p>
          </div>
        )}

        {/* 버튼들 */}
        <div className="space-y-3">
          <button
            onClick={handleResend}
            disabled={resendCooldown > 0}
            className="w-full py-3 bg-white text-gray-900 font-medium rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resendCooldown > 0 ? `재발송 (${resendCooldown}초)` : '인증 메일 다시 보내기'}
          </button>

          <button
            onClick={handleLogout}
            className="w-full py-3 bg-white/10 border border-white/30 text-white font-medium rounded-xl hover:bg-white/20 transition-colors"
          >
            다른 계정으로 로그인
          </button>
        </div>
      </motion.div>
    </main>
  );
}
