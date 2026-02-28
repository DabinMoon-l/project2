/**
 * 로그인 페이지
 *
 * 학번 + 비밀번호 로그인 (교수님은 이메일 로그인)
 */

'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';

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

export default function LoginPage() {
  const router = useRouter();
  const {
    user,
    loading,
    error,
    loginWithStudentId,
    loginWithEmail,
    clearError,
  } = useAuth();

  // 학번/이메일 + 비밀번호 입력
  const [idInput, setIdInput] = useState('');
  const [password, setPassword] = useState('');

  // 리다이렉트 중복 방지
  const isRedirecting = useRef(false);

  // 이미 로그인된 경우
  useEffect(() => {
    const handleLogin = async () => {
      if (user && !loading && !isRedirecting.current) {
        isRedirecting.current = true;

        try {
          // 교수님 도메인 체크 → 서버에서 정확한 이메일 검증
          const email = user.email || '';
          const isProfessorDomain = email.endsWith('@ccn.ac.kr');

          if (isProfessorDomain) {
            try {
              await httpsCallable(functions, 'initProfessorAccount')();
              router.replace('/professor');
            } catch {
              // CF에서 권한 거부 → 일반 사용자로 처리
              router.replace('/');
            }
          } else {
            router.replace('/');
          }
        } catch (err) {
          console.error('로그인 처리 에러:', err);
          isRedirecting.current = false;
          router.replace('/');
        }
      }
    };

    handleLogin();
  }, [user, loading, router]);

  // 에러 자동 초기화 (5초)
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => clearError(), 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  // 로그인 처리
  const handleLogin = async () => {
    if (!idInput || !password) return;

    const trimmed = idInput.trim();

    // 이메일 형식이면 → 교수님 이메일 로그인
    if (trimmed.includes('@')) {
      await loginWithEmail(trimmed, password);
    } else {
      // 숫자만 → 학번 로그인
      await loginWithStudentId(trimmed, password);
    }
  };

  // 로딩 중이거나 이미 로그인된 경우
  if (loading || user) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative z-10 flex flex-col items-center gap-4"
      >
        <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
        <p className="text-white text-sm font-medium drop-shadow-md">로딩 중...</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="relative z-10 w-full max-w-sm px-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* 로고 */}
      <motion.div
        className="flex justify-center mb-3"
        variants={itemVariants}
      >
        <Image
          src="/images/logo.png"
          alt="RabbiTory"
          width={200}
          height={67}
          style={{ width: 'auto', height: 'auto', maxWidth: '50vw' }}
          className="drop-shadow-lg"
          priority
        />
      </motion.div>

      {/* 로그인 폼 */}
      <motion.div
        className="w-full flex flex-col items-center space-y-2"
        variants={itemVariants}
      >
        <input
          type="text"
          inputMode="numeric"
          placeholder="학번"
          value={idInput}
          onChange={(e) => setIdInput(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className="w-[80%] px-3 py-2 text-sm bg-white/10 border border-white/30 text-white placeholder-white/50 rounded-xl focus:outline-none focus:border-white/60"
        />
        <input
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          autoComplete="off"
          className="w-[80%] px-3 py-2 text-sm bg-white/10 border border-white/30 text-white placeholder-white/50 rounded-xl focus:outline-none focus:border-white/60"
        />

        {/* 회원가입 / 비밀번호 찾기 링크 */}
        <div className="w-[80%] flex items-center justify-between">
          <Link
            href="/signup"
            className="text-white/70 text-xs hover:text-white transition-colors"
          >
            회원가입
          </Link>
          <Link
            href="/forgot-password"
            className="text-white/70 text-xs hover:text-white transition-colors"
          >
            비밀번호 찾기
          </Link>
        </div>

        <button
          onClick={handleLogin}
          disabled={loading || !idInput || !password}
          className="w-[80%] py-2 text-sm bg-white text-black font-medium rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
        >
          {loading ? '로그인 중...' : '로그인'}
        </button>
      </motion.div>

      {/* 에러 메시지 */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="w-full mt-4 p-3 bg-red-500/90 backdrop-blur-sm rounded-xl"
        >
          <p className="text-white text-sm text-center">{error}</p>
        </motion.div>
      )}
    </motion.div>
  );
}
