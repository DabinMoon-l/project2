/**
 * 비밀번호 찾기 페이지
 *
 * 1단계: 학번 + 이메일 입력 → requestPasswordReset CF → 인증 코드 발송
 * 2단계: 인증 코드 + 새 비밀번호 + 확인 → requestPasswordReset CF → 비밀번호 변경
 * 하단: 문의하기 (비로그인 문의)
 */

'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

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

// 단계: initial → codeSent → complete
type Phase = 'initial' | 'codeSent' | 'complete';

export default function ForgotPasswordPage() {
  const [studentId, setStudentId] = useState('');
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phase, setPhase] = useState<Phase>('initial');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 문의하기 상태
  const [showInquiry, setShowInquiry] = useState(false);
  const [inquiryMessage, setInquiryMessage] = useState('');
  const [inquirySubmitting, setInquirySubmitting] = useState(false);
  const [inquirySent, setInquirySent] = useState(false);

  // 로고 숨김 조건: 문의하기 열림 또는 인증코드 단계
  const hideLogo = showInquiry || phase === 'codeSent';

  // 에러 자동 초기화
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // 1단계: 학번 + 이메일 → 인증 코드 발송
  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!studentId) {
      setError('학번을 입력해주세요.');
      return;
    }
    if (!/^\d{7,10}$/.test(studentId)) {
      setError('학번은 7-10자리 숫자입니다.');
      return;
    }
    if (!email) {
      setError('이메일을 입력해주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      const fn = httpsCallable<
        { studentId: string; email: string },
        { success: boolean; hasRecoveryEmail: boolean; codeSent?: boolean; maskedEmail?: string; message: string }
      >(functions, 'requestPasswordReset');

      const res = await fn({ studentId, email });
      const data = res.data;

      if (data.hasRecoveryEmail && data.codeSent) {
        setMaskedEmail(data.maskedEmail || '');
        setPhase('codeSent');
      } else if (!data.hasRecoveryEmail) {
        setError('복구 이메일이 등록되어 있지 않습니다. 아래 문의하기를 이용해주세요.');
      }
    } catch (err: unknown) {
      const firebaseError = err as { message?: string };
      setError(firebaseError.message || '비밀번호 찾기에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 2단계: 인증 코드 + 새 비밀번호 → 비밀번호 변경
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!verificationCode) {
      setError('인증 코드를 입력해주세요.');
      return;
    }
    if (newPassword.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    setIsSubmitting(true);
    try {
      const fn = httpsCallable<
        { studentId: string; verificationCode: string; newPassword: string },
        { success: boolean; message: string }
      >(functions, 'requestPasswordReset');

      const res = await fn({ studentId, verificationCode, newPassword });
      if (res.data.success) {
        setPhase('complete');
      }
    } catch (err: unknown) {
      const firebaseError = err as { message?: string };
      setError(firebaseError.message || '비밀번호 변경에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

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

  return (
    <motion.div
      className="relative z-10 w-full max-w-sm px-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* 로고 (문의하기/인증코드 단계에서 숨김) */}
      {!hideLogo && (
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
      )}

      <motion.h1
        className="text-xl font-bold text-white text-center mb-3"
        variants={itemVariants}
      >
        비밀번호 찾기
      </motion.h1>

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

      {/* ── 1단계: 학번 + 이메일 입력 ── */}
      {phase === 'initial' && (
        <>
          <motion.form onSubmit={handleRequestCode} className="flex flex-col items-center space-y-2" variants={itemVariants}>
            <input
              type="text"
              inputMode="numeric"
              placeholder="학번 (7-10자리)"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value.replace(/\D/g, ''))}
              maxLength={10}
              className="w-[80%] px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-colors"
              disabled={isSubmitting}
            />
            <input
              type="email"
              placeholder="인증한 이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="w-[80%] px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-colors"
              disabled={isSubmitting}
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-[80%] mt-1 py-2.5 text-sm bg-white text-gray-900 font-medium rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? '확인 중...' : '인증 코드 받기'}
            </button>
          </motion.form>

          <motion.div className="mt-4 space-y-2 flex flex-col items-center" variants={itemVariants}>
            <p className="text-xs text-white/50 text-center">
              설정에서 복구 이메일을 등록한 경우<br />인증 코드를 받아 비밀번호를 재설정할 수 있습니다.
            </p>
          </motion.div>

          <motion.p className="mt-4 text-center text-white/70 text-sm" variants={itemVariants}>
            <Link href="/login" className="text-white underline hover:text-white/80">
              로그인으로 돌아가기
            </Link>
          </motion.p>

          {/* 문의하기 */}
          <motion.div className="mt-4 flex flex-col items-center" variants={itemVariants}>
            <AnimatePresence mode="wait">
              {inquirySent ? (
                <motion.div
                  key="sent"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="w-[80%] p-3 bg-green-500/20 border border-green-400/30 rounded-xl backdrop-blur-sm"
                >
                  <p className="text-white text-xs text-center">문의가 전송되었습니다.</p>
                </motion.div>
              ) : showInquiry ? (
                <motion.div
                  key="form"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="w-[80%] overflow-hidden"
                >
                  <div className="space-y-2">
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
                        onClick={() => { setShowInquiry(false); setInquiryMessage(''); }}
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
                  className="text-xs text-white/60 text-center underline underline-offset-2 hover:text-white/80 transition-colors"
                >
                  문의하기
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        </>
      )}

      {/* ── 2단계: 인증 코드 + 새 비밀번호 ── */}
      {phase === 'codeSent' && (
        <>
          <motion.p
            className="text-xs text-white/60 text-center mb-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {maskedEmail}로 인증 코드를 보냈습니다.
          </motion.p>

          <motion.form
            onSubmit={handleResetPassword}
            className="flex flex-col items-center space-y-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <input
              type="text"
              inputMode="numeric"
              placeholder="인증 코드 (6자리)"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
              maxLength={6}
              className="w-[80%] px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-colors"
              disabled={isSubmitting}
            />
            <input
              type="password"
              placeholder="새 비밀번호 (6자 이상)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-[80%] px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-colors"
              disabled={isSubmitting}
            />
            <input
              type="password"
              placeholder="새 비밀번호 확인"
              value={newPasswordConfirm}
              onChange={(e) => setNewPasswordConfirm(e.target.value)}
              className="w-[80%] px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:border-white/50 transition-colors"
              disabled={isSubmitting}
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-[80%] mt-1 py-2.5 text-sm bg-white text-gray-900 font-medium rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? '변경 중...' : '비밀번호 변경'}
            </button>
          </motion.form>

          <motion.p
            className="mt-4 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <button
              onClick={() => { setPhase('initial'); setVerificationCode(''); setNewPassword(''); setNewPasswordConfirm(''); }}
              className="text-white/70 text-sm underline hover:text-white/80"
            >
              돌아가기
            </button>
          </motion.p>
        </>
      )}

      {/* ── 완료 ── */}
      {phase === 'complete' && (
        <motion.div
          className="flex flex-col items-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="w-12 h-12 mb-3 bg-green-500 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-white text-sm text-center mb-4">
            비밀번호가 변경되었습니다.
          </p>
          <Link
            href="/login"
            className="w-[80%] py-2.5 text-sm bg-white text-gray-900 font-medium rounded-xl text-center block hover:bg-gray-100 transition-colors"
          >
            로그인하기
          </Link>
        </motion.div>
      )}
    </motion.div>
  );
}
