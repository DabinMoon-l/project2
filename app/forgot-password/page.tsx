/**
 * 비밀번호 찾기 페이지
 *
 * 학번 입력 → requestPasswordReset CF 호출
 * - 복구 이메일 등록된 경우: 재설정 링크 발송 안내
 * - 미등록: 교수님께 문의 안내
 */

'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

// 비디오 배경
function VideoBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      >
        <source src="/videos/login-bg.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-black/20" />
    </div>
  );
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.2 },
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

export default function ForgotPasswordPage() {
  const [studentId, setStudentId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    hasRecoveryEmail: boolean;
    maskedEmail?: string;
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 문의하기 상태
  const [showInquiry, setShowInquiry] = useState(false);
  const [inquiryMessage, setInquiryMessage] = useState('');
  const [inquirySubmitting, setInquirySubmitting] = useState(false);
  const [inquirySent, setInquirySent] = useState(false);

  // 에러 자동 초기화
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // 문의 전송
  const handleInquirySubmit = async () => {
    const trimmed = inquiryMessage.trim();
    if (!trimmed || !studentId) return;

    setInquirySubmitting(true);
    try {
      const submitInquiryFn = httpsCallable<
        { studentId: string; message: string },
        { success: boolean }
      >(functions, 'submitInquiry');
      await submitInquiryFn({ studentId, message: trimmed });
      setInquirySent(true);
      setInquiryMessage('');
      setTimeout(() => {
        setShowInquiry(false);
        setInquirySent(false);
      }, 2000);
    } catch (err: unknown) {
      const firebaseError = err as { message?: string };
      setError(firebaseError.message || '문의 전송에 실패했습니다.');
    } finally {
      setInquirySubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!studentId) {
      setError('학번을 입력해주세요.');
      return;
    }

    if (!/^\d{7,10}$/.test(studentId)) {
      setError('학번은 7-10자리 숫자입니다.');
      return;
    }

    setIsSubmitting(true);

    try {
      const requestPasswordResetFn = httpsCallable<
        { studentId: string },
        { success: boolean; hasRecoveryEmail: boolean; maskedEmail?: string; message: string }
      >(functions, 'requestPasswordReset');

      const response = await requestPasswordResetFn({ studentId });
      setResult(response.data);
    } catch (err: unknown) {
      const firebaseError = err as { message?: string };
      setError(firebaseError.message || '비밀번호 찾기에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
      <VideoBackground />

      {/* 좌측 상단 이미지 */}
      <div className="absolute top-0 left-0 z-10">
        <Image
          src="/images/corner-image.png"
          alt="장식 이미지"
          width={150}
          height={75}
          style={{ width: 'auto', height: 'auto', maxWidth: '38vw' }}
          className="drop-shadow-lg"
        />
      </div>

      <motion.div
        className="relative z-10 w-full max-w-sm px-6"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* 로고 */}
        <motion.div className="flex justify-center mb-3" variants={itemVariants}>
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

        <motion.h1
          className="text-xl font-bold text-white text-center mb-3"
          variants={itemVariants}
        >
          비밀번호 찾기
        </motion.h1>

        {/* 결과 표시 */}
        {result && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            {result.hasRecoveryEmail ? (
              // 복구 이메일로 발송 성공
              <div className="p-4 bg-green-500/20 border border-green-400/30 rounded-xl backdrop-blur-sm">
                <div className="w-10 h-10 mx-auto mb-2 bg-green-500 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-white text-sm text-center">{result.message}</p>
              </div>
            ) : (
              // 복구 이메일 미등록
              <div className="p-4 bg-yellow-500/20 border border-yellow-400/30 rounded-xl backdrop-blur-sm">
                <div className="w-10 h-10 mx-auto mb-2 bg-yellow-500 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <p className="text-white text-sm text-center">{result.message}</p>
              </div>
            )}

            <Link
              href="/login"
              className="block w-full mt-3 py-2.5 text-sm bg-white/20 text-white font-medium rounded-xl text-center hover:bg-white/30 transition-colors"
            >
              로그인 페이지로 돌아가기
            </Link>
          </motion.div>
        )}

        {/* 폼 (결과 미표시 시에만) */}
        {!result && (
          <>
            {/* 에러 */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 p-3 bg-red-500/90 backdrop-blur-sm rounded-xl"
              >
                <p className="text-white text-sm text-center">{error}</p>
              </motion.div>
            )}

            <motion.form onSubmit={handleSubmit} variants={itemVariants}>
              <div className="space-y-3">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="학번 (7-10자리)"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value.replace(/\D/g, ''))}
                  maxLength={10}
                  className="w-full px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-colors"
                  disabled={isSubmitting}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-3 py-2.5 text-sm bg-white text-gray-900 font-medium rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                {isSubmitting ? '확인 중...' : '비밀번호 찾기'}
              </button>
            </motion.form>

            <motion.div className="mt-4 space-y-2" variants={itemVariants}>
              <p className="text-xs text-white/50 text-center">
                설정에서 복구 이메일을 등록한 경우 재설정 링크를 받을 수 있습니다.
              </p>

              {/* 문의하기 버튼/영역 */}
              <AnimatePresence mode="wait">
                {inquirySent ? (
                  <motion.div
                    key="sent"
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="p-3 bg-green-500/20 border border-green-400/30 rounded-xl backdrop-blur-sm"
                  >
                    <p className="text-white text-xs text-center">문의가 전송되었습니다.</p>
                  </motion.div>
                ) : showInquiry ? (
                  <motion.div
                    key="form"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2">
                      {!studentId && (
                        <p className="text-xs text-yellow-300/80 text-center">
                          먼저 학번을 입력해주세요.
                        </p>
                      )}
                      <textarea
                        value={inquiryMessage}
                        onChange={(e) => setInquiryMessage(e.target.value)}
                        placeholder="문의 내용을 입력하세요 (최대 500자)"
                        rows={2}
                        maxLength={500}
                        className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-xl text-white text-sm placeholder-white/40 focus:outline-none focus:border-white/50 transition-colors resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setShowInquiry(false);
                            setInquiryMessage('');
                          }}
                          className="flex-1 py-2 bg-white/10 text-white/70 text-xs font-medium rounded-xl hover:bg-white/20 transition-colors"
                        >
                          취소
                        </button>
                        <button
                          onClick={handleInquirySubmit}
                          disabled={inquirySubmitting || !inquiryMessage.trim() || !studentId}
                          className="flex-1 py-2 bg-white/20 text-white text-xs font-medium rounded-xl hover:bg-white/30 transition-colors disabled:opacity-40"
                        >
                          {inquirySubmitting ? '전송 중...' : '전송'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.button
                    key="btn"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setShowInquiry(true)}
                    className="w-full text-xs text-white/60 text-center underline underline-offset-2 hover:text-white/80 transition-colors"
                  >
                    문의하기
                  </motion.button>
                )}
              </AnimatePresence>
            </motion.div>

            <motion.p
              className="mt-4 text-center text-white/70 text-sm"
              variants={itemVariants}
            >
              <Link href="/login" className="text-white underline hover:text-white/80">
                로그인으로 돌아가기
              </Link>
            </motion.p>
          </>
        )}
      </motion.div>
    </main>
  );
}
