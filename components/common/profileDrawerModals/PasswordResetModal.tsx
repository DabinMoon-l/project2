'use client';

import { useState, useCallback, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { callFunction } from '@/lib/api';
import { GlassModal, maskEmail } from '../profileDrawerParts';

interface PasswordResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: { recoveryEmail?: string; studentId?: string } | null;
}

/**
 * 비밀번호 재설정 모달
 * - 복구 이메일로 인증 코드 전송 (모달 열릴 때 자동 전송)
 * - 6자리 인증 코드 입력 → 새 비밀번호 설정
 */
export default function PasswordResetModal({
  isOpen,
  onClose,
  profile,
}: PasswordResetModalProps) {
  // 비밀번호 재설정 관련 상태
  const [resetCode, setResetCode] = useState('');
  const [resetCodeSent, setResetCodeSent] = useState(false);
  const [resetCodeVerified, setResetCodeVerified] = useState(false);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const [resetMaskedEmail, setResetMaskedEmail] = useState('');

  // 모달이 열릴 때 자동으로 인증 코드 전송
  useEffect(() => {
    if (!isOpen) return;

    // 상태 초기화
    setResetCode('');
    setResetCodeSent(false);
    setResetCodeVerified(false);
    setResetNewPassword('');
    setResetConfirmPassword('');
    setResetMessage('');
    setResetMaskedEmail('');

    // 인증 코드 전송
    const sendCode = async () => {
      setResetLoading(true);
      try {
        const result = await callFunction('requestPasswordReset', {});
        if (result.codeSent) {
          setResetCodeSent(true);
          setResetMaskedEmail(result.maskedEmail || '');
        } else {
          setResetMessage(result.message || '');
        }
      } catch {
        setResetMessage('인증 코드 전송에 실패했습니다.');
      } finally {
        setResetLoading(false);
      }
    };

    sendCode();
  }, [isOpen]);

  /** 인증 코드 확인 */
  const handleVerifyResetCode = useCallback(async () => {
    if (resetCode.length !== 6) return;
    setResetCodeVerified(true);
    setResetMessage('');
  }, [resetCode]);

  /** 새 비밀번호 저장 */
  const handleResetNewPassword = useCallback(async () => {
    if (resetNewPassword.length < 6) {
      setResetMessage('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setResetMessage('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    setResetLoading(true);
    setResetMessage('');
    try {
      const result = await callFunction('requestPasswordReset', {
        verificationCode: resetCode,
        newPassword: resetNewPassword,
      });
      setResetMessage(result.message || '');
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch {
      setResetMessage('비밀번호 변경에 실패했습니다. 인증 코드를 확인해주세요.');
      setResetCodeVerified(false);
    } finally {
      setResetLoading(false);
    }
  }, [resetCode, resetNewPassword, resetConfirmPassword, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <GlassModal onClose={onClose}>
          <h3 className="text-base font-bold text-white mb-1">비밀번호 재설정</h3>

          {/* 인증 코드 전송 중 로딩 */}
          {resetLoading && !resetCodeSent && (
            <div className="flex items-center gap-2 py-6 justify-center">
              <div className="w-5 h-5 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
              <span className="text-sm text-white/50">인증 코드 전송 중...</span>
            </div>
          )}

          {/* 복구 이메일 없는 경우 안내 */}
          {!resetCodeSent && !resetLoading && (
            <p className="text-sm text-white/50 py-4">{resetMessage || '복구 이메일이 필요합니다.'}</p>
          )}

          {/* 인증 코드 입력 단계 */}
          {resetCodeSent && !resetCodeVerified && (
            <>
              <p className="text-xs text-white/40 mb-4">
                {resetMaskedEmail}로 인증 코드를 보냈습니다
              </p>
              <input
                type="text"
                value={resetCode}
                onChange={(e) => {
                  setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setResetMessage('');
                }}
                placeholder="인증 코드 6자리"
                maxLength={6}
                inputMode="numeric"
                className="w-full px-3 py-2 rounded-xl outline-none text-sm bg-white/10 text-white placeholder:text-white/40 border border-white/15 text-center tracking-[0.3em]"
              />
            </>
          )}

          {/* 새 비밀번호 입력 단계 */}
          {resetCodeVerified && (
            <>
              <p className="text-xs text-white/40 mb-4">새 비밀번호를 입력하세요</p>
              <div className="space-y-3">
                <input
                  type="password"
                  value={resetNewPassword}
                  onChange={(e) => {
                    setResetNewPassword(e.target.value);
                    setResetMessage('');
                  }}
                  placeholder="새 비밀번호 (6자 이상)"
                  className="w-full px-3 py-2 rounded-xl outline-none text-sm bg-white/10 text-white placeholder:text-white/40 border border-white/15"
                />
                <input
                  type="password"
                  value={resetConfirmPassword}
                  onChange={(e) => {
                    setResetConfirmPassword(e.target.value);
                    setResetMessage('');
                  }}
                  placeholder="새 비밀번호 확인"
                  className="w-full px-3 py-2 rounded-xl outline-none text-sm bg-white/10 text-white placeholder:text-white/40 border border-white/15"
                />
              </div>
            </>
          )}

          {/* 메시지 (성공/에러) */}
          {resetMessage && (
            <p className={`text-xs mt-2 ${resetMessage.includes('변경되었') ? 'text-green-300' : 'text-red-300'}`}>
              {resetMessage}
            </p>
          )}

          {/* 하단 버튼 (코드 전송 완료 후 또는 복구 이메일 없을 때) */}
          {(resetCodeSent || (!resetLoading && !resetCodeSent)) && (
            <div className="flex gap-3 mt-4">
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
              >
                취소
              </button>
              {resetCodeSent && !resetCodeVerified && (
                <button
                  onClick={handleVerifyResetCode}
                  disabled={resetCode.length !== 6}
                  className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
                >
                  확인
                </button>
              )}
              {resetCodeVerified && (
                <button
                  onClick={handleResetNewPassword}
                  disabled={resetLoading || resetNewPassword.length < 6}
                  className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
                >
                  {resetLoading ? '변경 중...' : '변경'}
                </button>
              )}
            </div>
          )}
        </GlassModal>
      )}
    </AnimatePresence>
  );
}
