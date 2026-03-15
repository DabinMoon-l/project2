'use client';

import { useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { changePassword } from '@/lib/auth';
import { auth } from '@/lib/firebase';
import { GlassModal } from '../profileDrawerParts';

interface PasswordChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 비밀번호 찾기(재설정) 모달 열기 콜백 */
  onForgotPassword: () => void;
  isProfessor: boolean;
}

/**
 * 비밀번호 변경 모달
 * - 현재 비밀번호 확인 후 새 비밀번호로 변경
 * - 학생만 "비밀번호를 잊으셨나요?" 링크 표시
 */
export default function PasswordChangeModal({
  isOpen,
  onClose,
  onForgotPassword,
  isProfessor,
}: PasswordChangeModalProps) {
  // 비밀번호 변경 관련 상태
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  /** 모든 상태 초기화 + 부모 onClose 호출 */
  const handleClose = useCallback(() => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setSavingPassword(false);
    onClose();
  }, [onClose]);

  /** 비밀번호 변경 처리 */
  const handlePasswordChange = useCallback(async () => {
    if (newPassword.length < 6) {
      setPasswordError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    if (!auth.currentUser?.email) return;
    setSavingPassword(true);
    setPasswordError('');
    try {
      await changePassword(currentPassword, newPassword);
      // 성공 시 상태 초기화 + 모달 닫기
      setPasswordError('');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onClose();
    } catch (err: unknown) {
      const fbErr = err as { code?: string };
      if (fbErr.code === 'auth/wrong-password' || fbErr.code === 'auth/invalid-credential') {
        setPasswordError('현재 비밀번호가 올바르지 않습니다.');
      } else {
        setPasswordError('비밀번호 변경에 실패했습니다.');
      }
    } finally {
      setSavingPassword(false);
    }
  }, [currentPassword, newPassword, confirmPassword, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <GlassModal onClose={handleClose}>
          <h3 className="text-base font-bold text-white mb-3">비밀번호 변경</h3>

          <div className="space-y-3">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setPasswordError('');
              }}
              placeholder="현재 비밀번호"
              className="w-full px-3 py-2 rounded-xl outline-none text-sm bg-white/10 text-white placeholder:text-white/40 border border-white/15"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setPasswordError('');
              }}
              placeholder="새 비밀번호 (6자 이상)"
              className="w-full px-3 py-2 rounded-xl outline-none text-sm bg-white/10 text-white placeholder:text-white/40 border border-white/15"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setPasswordError('');
              }}
              placeholder="새 비밀번호 확인"
              className="w-full px-3 py-2 rounded-xl outline-none text-sm bg-white/10 text-white placeholder:text-white/40 border border-white/15"
            />
          </div>
          {passwordError && (
            <p className="text-xs mt-2 text-red-300">{passwordError}</p>
          )}
          {!isProfessor && (
            <div className="mt-3">
              <button
                type="button"
                onClick={onForgotPassword}
                className="text-xs text-white/40 hover:text-white/60 transition-colors"
              >
                비밀번호를 잊으셨나요?
              </button>
              <p className="text-xs text-white/30 mt-1.5">
                문의를 통해 비밀번호를 초기화한 경우 123456으로 설정됩니다.
              </p>
            </div>
          )}
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleClose}
              className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handlePasswordChange}
              disabled={savingPassword || !currentPassword || newPassword.length < 6}
              className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
            >
              {savingPassword ? '변경 중...' : '변경'}
            </button>
          </div>
        </GlassModal>
      )}
    </AnimatePresence>
  );
}
