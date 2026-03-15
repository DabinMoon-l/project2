'use client';

import { useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { callFunction } from '@/lib/api';
import { reauthenticate } from '@/lib/auth';
import { auth } from '@/lib/firebase';
import { GlassModal } from '../profileDrawerParts';

// ============================================================
// 타입
// ============================================================

interface RecoveryEmailModalProps {
  /** 모달 열림 여부 */
  isOpen: boolean;
  /** 모달 닫기 콜백 */
  onClose: () => void;
  /** 마스킹된 기존 복구 이메일 (없으면 null) */
  maskedRecovery: string | null;
  /** 유저 프로필 (recoveryEmail 존재 여부 판단용) */
  profile: { recoveryEmail?: string } | null;
}

// ============================================================
// 복구 이메일 등록/변경 모달
// ============================================================

/**
 * 비밀번호 확인 → 이메일 입력 → 인증 코드 전송 → 인증 완료
 * 3단계 플로우를 하나의 모달에서 처리한다.
 */
export default function RecoveryEmailModal({
  isOpen,
  onClose,
  maskedRecovery,
  profile,
}: RecoveryEmailModalProps) {
  // 비밀번호 확인 단계
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [passwordVerified, setPasswordVerified] = useState(false);

  // 이메일 입력 단계
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [savingRecovery, setSavingRecovery] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');

  // 인증 코드 단계
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);

  // ----------------------------------------------------------
  // 모든 상태 초기화 + 부모 onClose 호출
  // ----------------------------------------------------------
  const resetAndClose = useCallback(() => {
    setRecoveryPassword('');
    setPasswordVerified(false);
    setRecoveryEmail('');
    setSavingRecovery(false);
    setRecoveryMessage('');
    setVerificationSent(false);
    setVerificationCode('');
    setVerifyingCode(false);
    onClose();
  }, [onClose]);

  // ----------------------------------------------------------
  // 1단계: 비밀번호 확인
  // ----------------------------------------------------------
  const handleRecoveryPasswordCheck = useCallback(async () => {
    if (!auth.currentUser?.email || !recoveryPassword) return;
    setSavingRecovery(true);
    setRecoveryMessage('');
    try {
      await reauthenticate(recoveryPassword);
      setPasswordVerified(true);
      setRecoveryMessage('');
    } catch {
      setRecoveryMessage('비밀번호가 올바르지 않습니다.');
    } finally {
      setSavingRecovery(false);
    }
  }, [recoveryPassword]);

  // ----------------------------------------------------------
  // 2단계: 복구 이메일 인증 코드 전송
  // ----------------------------------------------------------
  const handleSendVerification = useCallback(async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recoveryEmail)) {
      setRecoveryMessage('유효하지 않은 이메일 형식입니다.');
      return;
    }
    setSavingRecovery(true);
    setRecoveryMessage('');
    try {
      const result = await callFunction('updateRecoveryEmail', { recoveryEmail });
      if (result.needsVerification) {
        setVerificationSent(true);
        setRecoveryMessage('');
      }
    } catch {
      setRecoveryMessage('인증 코드 전송에 실패했습니다.');
    } finally {
      setSavingRecovery(false);
    }
  }, [recoveryEmail]);

  // ----------------------------------------------------------
  // 3단계: 인증 코드 확인
  // ----------------------------------------------------------
  const handleVerifyCode = useCallback(async () => {
    setVerifyingCode(true);
    setRecoveryMessage('');
    try {
      await callFunction('updateRecoveryEmail', { recoveryEmail, verificationCode });
      setRecoveryMessage('복구 이메일이 등록되었습니다.');
      setTimeout(() => {
        resetAndClose();
      }, 1200);
    } catch {
      setRecoveryMessage('인증 코드가 올바르지 않습니다.');
    } finally {
      setVerifyingCode(false);
    }
  }, [recoveryEmail, verificationCode, resetAndClose]);

  // ----------------------------------------------------------
  // 모달 열릴 때 초기 상태 결정
  // 기존 복구 이메일이 없으면 비밀번호 확인 스킵
  // ----------------------------------------------------------
  // NOTE: 부모(ProfileDrawer)에서 isOpen=true로 전환할 때
  //       passwordVerified를 !profile.recoveryEmail 로 세팅하는 로직이
  //       원래 ProfileDrawer에 있었다. 이제 이 컴포넌트가 isOpen 변경 시
  //       자체적으로 처리하도록, 부모에서 open 전에 상태가 리셋되어야 한다.
  //       → resetAndClose()가 닫을 때 전부 초기화하고,
  //         부모가 여는 시점에 passwordVerified 초기값은 props로 판단.

  return (
    <AnimatePresence>
      {isOpen && (
        <GlassModal onClose={resetAndClose}>
          <h3 className="text-base font-bold text-white mb-1">복구 이메일</h3>
          <p className="text-xs text-white/40 mb-4">비밀번호 찾기에 사용됩니다</p>

          {/* 비밀번호 확인이 필요한 경우 (기존 복구 이메일이 있을 때) */}
          {!passwordVerified && profile?.recoveryEmail ? (
            <>
              <p className="text-xs text-white/50 mb-2">
                본인 확인을 위해 비밀번호를 입력해주세요
              </p>
              <input
                type="password"
                value={recoveryPassword}
                onChange={(e) => {
                  setRecoveryPassword(e.target.value);
                  setRecoveryMessage('');
                }}
                placeholder="현재 비밀번호"
                className="w-full px-3 py-2 rounded-xl outline-none text-sm bg-white/10 text-white placeholder:text-white/40 border border-white/15"
              />
            </>
          ) : (
            <>
              {/* 기존 복구 이메일 표시 (인증 코드 전송 전에만) */}
              {maskedRecovery && !verificationSent && (
                <p className="text-xs text-white/50 mb-2">
                  현재: {maskedRecovery}
                </p>
              )}

              <input
                type="email"
                value={recoveryEmail}
                onChange={(e) => {
                  setRecoveryEmail(e.target.value);
                  setRecoveryMessage('');
                }}
                placeholder="이메일 주소"
                disabled={verificationSent}
                className="w-full px-3 py-2 rounded-xl outline-none text-sm bg-white/10 text-white placeholder:text-white/40 border border-white/15 disabled:opacity-50"
              />

              {/* 인증 코드 입력 영역 */}
              {verificationSent && (
                <div className="mt-3">
                  <p className="text-xs text-white/50 mb-2">
                    인증 코드가 전송되었습니다
                  </p>
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => {
                      setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                      setRecoveryMessage('');
                    }}
                    placeholder="인증 코드 6자리"
                    maxLength={6}
                    inputMode="numeric"
                    className="w-full px-3 py-2 rounded-xl outline-none text-sm bg-white/10 text-white placeholder:text-white/40 border border-white/15 text-center tracking-[0.3em]"
                  />
                </div>
              )}
            </>
          )}

          {/* 메시지 (성공: 녹색, 에러: 빨간색) */}
          {recoveryMessage && (
            <p className={`text-xs mt-2 ${recoveryMessage.includes('등록') ? 'text-green-300' : 'text-red-300'}`}>
              {recoveryMessage}
            </p>
          )}

          {/* 하단 버튼 */}
          <div className="flex gap-3 mt-4">
            <button
              onClick={resetAndClose}
              className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
            >
              취소
            </button>
            {!passwordVerified && profile?.recoveryEmail ? (
              <button
                onClick={handleRecoveryPasswordCheck}
                disabled={savingRecovery || !recoveryPassword}
                className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
              >
                {savingRecovery ? '확인 중...' : '확인'}
              </button>
            ) : verificationSent ? (
              <button
                onClick={handleVerifyCode}
                disabled={verifyingCode || verificationCode.length !== 6}
                className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
              >
                {verifyingCode ? '확인 중...' : '인증 완료'}
              </button>
            ) : (
              <button
                onClick={handleSendVerification}
                disabled={savingRecovery || !recoveryEmail}
                className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
              >
                {savingRecovery ? '전송 중...' : '인증 코드 전송'}
              </button>
            )}
          </div>
        </GlassModal>
      )}
    </AnimatePresence>
  );
}
