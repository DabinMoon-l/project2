/**
 * 회원가입 페이지
 *
 * 학년(→과목 자동), 학번, 반, 닉네임, 비밀번호로 가입
 * CF registerStudent를 호출하여 enrolledStudents 검증 후 가입
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { getCurrentSemesterByDate, determineCourse, getAvailableGrades } from '@/lib/types/course';

// 반 옵션
const CLASS_OPTIONS = ['A', 'B', 'C', 'D'] as const;

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
    transition: { duration: 0.5, ease: 'easeOut' },
  },
};

export default function SignupPage() {
  const router = useRouter();
  const {
    user,
    loading,
    error,
    signUpWithStudentId,
    clearError,
  } = useAuth();

  const [grade, setGrade] = useState<number>(0);
  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 현재 학기 + 학년 → 과목 자동 결정
  const currentSemester = useMemo(() => getCurrentSemesterByDate(), []);
  const availableGrades = useMemo(() => getAvailableGrades(currentSemester), [currentSemester]);
  const courseAssignment = useMemo(
    () => (grade ? determineCourse(grade, currentSemester) : null),
    [grade, currentSemester]
  );

  // 이미 로그인된 경우 → 홈으로
  useEffect(() => {
    if (user && !loading) {
      router.replace('/');
    }
  }, [user, loading, router]);

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

    if (!grade || !studentId || !classId || !nickname || !password || !passwordConfirm) {
      setLocalError('모든 필드를 입력해주세요.');
      return;
    }

    if (!courseAssignment) {
      setLocalError('해당 학년/학기에 배정된 과목이 없습니다.');
      return;
    }

    if (!/^\d{7,10}$/.test(studentId)) {
      setLocalError('학번은 7-10자리 숫자입니다.');
      return;
    }

    if (nickname.length < 2 || nickname.length > 6) {
      setLocalError('닉네임은 2-6자 사이여야 합니다.');
      return;
    }

    if (!/^[가-힣a-zA-Z0-9]+$/.test(nickname)) {
      setLocalError('닉네임은 한글, 영문, 숫자만 가능합니다.');
      return;
    }

    if (password.length < 6) {
      setLocalError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }

    if (password !== passwordConfirm) {
      setLocalError('비밀번호가 일치하지 않습니다.');
      return;
    }

    setIsSubmitting(true);
    const result = await signUpWithStudentId(
      studentId,
      password,
      courseAssignment.courseId,
      classId,
      nickname
    );
    setIsSubmitting(false);

    if (result.success) {
      // 가입 성공 → 로그인 처리 후 홈으로 이동
      // user 상태 변경 → useEffect에서 리다이렉트
    }
  };

  return (
    <motion.div
      className="relative z-10 w-full max-w-sm px-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* 타이틀 */}
      <motion.h1
        className="text-xl font-bold text-white text-center mb-3"
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
      <motion.form onSubmit={handleSubmit} className="flex flex-col items-center" variants={itemVariants}>
        <div className="w-[80%] space-y-2">
          {/* 학년 선택 */}
          <div>
            <label className="block text-xs font-medium text-white/80 mb-1">학년</label>
            <div className="grid grid-cols-2 gap-2">
              {availableGrades.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrade(g)}
                  className={`px-3 py-2 rounded-xl text-center transition-all ${
                    grade === g
                      ? 'bg-white text-black'
                      : 'bg-white/10 border border-white/20 text-white hover:bg-white/20'
                  }`}
                >
                  <p className="text-xs font-bold">{g}학년</p>
                </button>
              ))}
            </div>
            {/* 과목 자동 표시 */}
            {courseAssignment && (
              <p className="mt-1.5 text-xs text-white/60 text-center">
                과목: {courseAssignment.courseName}
              </p>
            )}
          </div>

          {/* 반 선택 */}
          <div>
            <label className="block text-xs font-medium text-white/80 mb-1">반</label>
            <div className="grid grid-cols-4 gap-2">
              {CLASS_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setClassId(c)}
                  className={`px-3 py-2 rounded-xl text-center transition-all ${
                    classId === c
                      ? 'bg-white text-black'
                      : 'bg-white/10 border border-white/20 text-white hover:bg-white/20'
                  }`}
                >
                  <p className="text-xs font-bold">{c}</p>
                </button>
              ))}
            </div>
          </div>

          {/* 학번 */}
          <input
            type="text"
            inputMode="numeric"
            placeholder="학번"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value.replace(/\D/g, ''))}
            maxLength={10}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            className="w-full px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-colors"
            disabled={isSubmitting}
          />

          {/* 닉네임 */}
          <input
            type="text"
            placeholder="닉네임 (2-6자)"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={6}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            className="w-full px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-colors"
            disabled={isSubmitting}
          />

          {/* 비밀번호 */}
          <input
            type="password"
            placeholder="비밀번호 (6자 이상)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="w-full px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-colors"
            disabled={isSubmitting}
          />

          {/* 비밀번호 확인 */}
          <input
            type="password"
            placeholder="비밀번호 확인"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            autoComplete="new-password"
            className="w-full px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-colors"
            disabled={isSubmitting}
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || loading}
          className="w-[80%] mt-3 py-2.5 text-sm bg-white text-gray-900 font-medium rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? '가입 처리 중...' : '회원가입'}
        </button>
      </motion.form>

      {/* 로그인 링크 */}
      <motion.p
        className="mt-3 text-center text-white/70 text-sm"
        variants={itemVariants}
      >
        이미 계정이 있으신가요?{' '}
        <Link href="/login" className="text-white underline hover:text-white/80">
          로그인
        </Link>
      </motion.p>
    </motion.div>
  );
}
