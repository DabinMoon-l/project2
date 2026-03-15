'use client';

import { useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { callFunction } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { GlassModal } from '../profileDrawerParts';

interface AccountDeletionDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 계정 삭제 확인 다이얼로그
 * - "삭제" 텍스트 입력 확인 후 계정 영구 삭제
 * - deleteStudentAccount CF 호출 → 로그아웃 → /login 리다이렉트
 */
export default function AccountDeletionDialog({
  isOpen,
  onClose,
}: AccountDeletionDialogProps) {
  const { logout } = useAuth();

  // 계정 삭제 관련 상태
  const [deleteInput, setDeleteInput] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  /** 계정 삭제 처리 */
  const handleDeleteAccount = useCallback(async () => {
    if (deleteInput !== '삭제') return;
    setDeletingAccount(true);
    try {
      await callFunction('deleteStudentAccount');
      // CF에서 서버측 Auth 삭제 완료 → 클라이언트 로그아웃으로 즉시 인증 상태 초기화
      // onAuthStateChanged가 null 감지 → useRequireAuth가 /login으로 리다이렉트
      onClose();
      await logout();
    } catch (err) {
      console.error('계정 삭제 실패:', err);
      setDeletingAccount(false);
    }
  }, [deleteInput, onClose, logout]);

  return (
    <AnimatePresence>
      {isOpen && (
        <GlassModal onClose={onClose}>
          <h3 className="text-lg font-bold text-red-300 mb-2">계정 삭제</h3>
          <p className="text-sm text-white/60 mb-1">
            계정을 삭제하면 모든 데이터가 영구 삭제됩니다.
          </p>
          <p className="text-sm text-white/60 mb-4">
            같은 학번으로 다시 가입할 수 있습니다.
          </p>
          <div className="mb-4">
            <p className="text-xs text-white/40 mb-2">
              확인을 위해 &quot;삭제&quot;를 입력하세요
            </p>
            <input
              type="text"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              placeholder="삭제"
              className="w-full px-3 py-2 rounded-xl outline-none text-sm bg-white/10 text-white placeholder:text-white/40 border border-red-400/30"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleDeleteAccount}
              disabled={deletingAccount || deleteInput !== '삭제'}
              className="flex-1 py-2 rounded-xl text-sm font-medium bg-red-500/30 border border-red-400/30 text-red-200 hover:bg-red-500/40 transition-colors disabled:opacity-50"
            >
              {deletingAccount ? '삭제 중...' : '계정 삭제'}
            </button>
          </div>
        </GlassModal>
      )}
    </AnimatePresence>
  );
}
