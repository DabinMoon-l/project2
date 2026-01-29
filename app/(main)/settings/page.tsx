'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Header, Modal } from '@/components/common';
import { SettingsList } from '@/components/profile';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  useSettings,
  type NotificationSettings,
  type DisplaySettings,
  type PrivacySettings,
  DEFAULT_SETTINGS,
} from '@/lib/hooks/useSettings';
import { useTheme } from '@/styles/themes/useTheme';

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 설정 페이지
 *
 * 알림, 표시, 개인정보 설정을 관리합니다.
 */
export default function SettingsPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const { user, logout } = useAuth();
  const {
    settings,
    loading,
    error,
    fetchSettings,
    updateNotifications,
    updateDisplay,
    updatePrivacy,
    resetSettings,
    clearError,
  } = useSettings();

  // 로그아웃 확인 모달
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  // 초기화 확인 모달
  const [showResetModal, setShowResetModal] = useState(false);
  // 로딩 상태
  const [actionLoading, setActionLoading] = useState(false);

  // 설정 로드
  useEffect(() => {
    if (user?.uid) {
      fetchSettings(user.uid);
    }
  }, [user?.uid, fetchSettings]);

  // 실제 설정 또는 기본값 사용
  const displaySettings = settings || DEFAULT_SETTINGS;

  /**
   * 알림 설정 변경 핸들러
   */
  const handleNotificationChange = useCallback(
    async (key: keyof NotificationSettings, value: boolean) => {
      if (!user?.uid) return;
      await updateNotifications(user.uid, { [key]: value });
    },
    [user?.uid, updateNotifications]
  );

  /**
   * 표시 설정 변경 핸들러
   */
  const handleDisplayChange = useCallback(
    async (key: keyof DisplaySettings, value: boolean) => {
      if (!user?.uid) return;
      await updateDisplay(user.uid, { [key]: value });
    },
    [user?.uid, updateDisplay]
  );

  /**
   * 개인정보 설정 변경 핸들러
   */
  const handlePrivacyChange = useCallback(
    async (key: keyof PrivacySettings, value: boolean) => {
      if (!user?.uid) return;
      await updatePrivacy(user.uid, { [key]: value });
    },
    [user?.uid, updatePrivacy]
  );

  /**
   * 로그아웃 핸들러
   */
  const handleLogout = useCallback(async () => {
    try {
      setActionLoading(true);
      await logout();
      router.replace('/login');
    } catch (err) {
      console.error('로그아웃 에러:', err);
    } finally {
      setActionLoading(false);
      setShowLogoutModal(false);
    }
  }, [logout, router]);

  /**
   * 설정 초기화 핸들러
   */
  const handleResetSettings = useCallback(async () => {
    if (!user?.uid) return;

    try {
      setActionLoading(true);
      await resetSettings(user.uid);
      setShowResetModal(false);
    } catch (err) {
      console.error('설정 초기화 에러:', err);
    } finally {
      setActionLoading(false);
    }
  }, [user?.uid, resetSettings]);

  return (
    <div
      className="min-h-screen pb-24"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* 헤더 */}
      <Header title="설정" showBack />

      {/* 에러 메시지 */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-4 mb-4 p-3 bg-red-50 border border-red-200 rounded-xl"
        >
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={clearError}
            className="text-xs text-red-500 underline mt-1"
          >
            닫기
          </button>
        </motion.div>
      )}

      {/* 메인 컨텐츠 */}
      <main className="px-4 pt-4">
        <SettingsList
          notifications={displaySettings.notifications}
          display={displaySettings.display}
          privacy={displaySettings.privacy}
          onNotificationChange={handleNotificationChange}
          onDisplayChange={handleDisplayChange}
          onPrivacyChange={handlePrivacyChange}
          onLogout={() => setShowLogoutModal(true)}
          onResetSettings={() => setShowResetModal(true)}
          loading={loading}
        />
      </main>

      {/* 로그아웃 확인 모달 */}
      <Modal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        title="로그아웃"
      >
        <div className="p-4 text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🚪</span>
          </div>
          <p
            className="mb-2"
            style={{ color: theme.colors.text }}
          >
            정말 로그아웃 하시겠습니까?
          </p>
          <p
            className="text-sm mb-6"
            style={{ color: theme.colors.textSecondary }}
          >
            다시 로그인하면 모든 데이터가 복구됩니다.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowLogoutModal(false)}
              disabled={actionLoading}
              className="flex-1 py-3 rounded-xl font-medium"
              style={{
                backgroundColor: theme.colors.backgroundSecondary,
                color: theme.colors.text,
              }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleLogout}
              disabled={actionLoading}
              className="flex-1 py-3 rounded-xl font-medium bg-red-500 text-white"
            >
              {actionLoading ? '처리 중...' : '로그아웃'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 초기화 확인 모달 */}
      <Modal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        title="설정 초기화"
      >
        <div className="p-4 text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🔄</span>
          </div>
          <p
            className="mb-2"
            style={{ color: theme.colors.text }}
          >
            모든 설정을 초기화하시겠습니까?
          </p>
          <p
            className="text-sm mb-6"
            style={{ color: theme.colors.textSecondary }}
          >
            알림, 표시, 개인정보 설정이 기본값으로 돌아갑니다.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowResetModal(false)}
              disabled={actionLoading}
              className="flex-1 py-3 rounded-xl font-medium"
              style={{
                backgroundColor: theme.colors.backgroundSecondary,
                color: theme.colors.text,
              }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleResetSettings}
              disabled={actionLoading}
              className="flex-1 py-3 rounded-xl font-medium"
              style={{
                backgroundColor: theme.colors.accent,
                color: theme.colors.background,
              }}
            >
              {actionLoading ? '처리 중...' : '초기화'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
