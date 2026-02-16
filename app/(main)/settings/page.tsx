'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { Header, Modal } from '@/components/common';
import { SettingsList } from '@/components/profile';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUser, useCourse } from '@/lib/contexts';
import { useRabbitHoldings } from '@/lib/hooks/useRabbit';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
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
  const { profile, updateProfile } = useUser();
  const { userCourseId } = useCourse();
  const { holdings } = useRabbitHoldings(user?.uid);
  const [showProfilePicker, setShowProfilePicker] = useState(false);
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

      {/* 프로필 사진 설정 */}
      <div className="px-4 pt-4 pb-2">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl overflow-hidden"
          style={{
            backgroundColor: theme.colors.backgroundSecondary,
            border: `1px solid ${theme.colors.border}`,
          }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: theme.colors.border }}>
            <h3 className="font-bold" style={{ color: theme.colors.text }}>프로필 사진</h3>
          </div>
          <button
            onClick={() => setShowProfilePicker(true)}
            className="w-full flex items-center gap-4 px-4 py-4 transition-colors hover:bg-black/5"
          >
            <div className="w-16 h-16 flex-shrink-0 border-2 border-[#1A1A1A] overflow-hidden flex items-center justify-center bg-[#FDFBF7]">
              {profile?.profileRabbitId != null ? (
                <Image
                  src={getRabbitProfileUrl(profile.profileRabbitId)}
                  alt="프로필"
                  width={64}
                  height={64}
                  className="w-full h-full object-cover"
                />
              ) : (
                <svg width={32} height={32} viewBox="0 0 24 24" fill="#1A1A1A">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
                </svg>
              )}
            </div>
            <div className="flex-1 text-left">
              <p className="font-bold text-[#1A1A1A]">프로필 사진 변경</p>
              <p className="text-sm text-[#5C5C5C]">발견한 토끼로 프로필을 꾸며보세요</p>
            </div>
            <svg className="w-5 h-5 text-[#9A9A9A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </motion.div>
      </div>

      {/* 메인 컨텐츠 */}
      <main className="px-4 pt-2">
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

      {/* 프로필 사진 선택 모달 */}
      <Modal
        isOpen={showProfilePicker}
        onClose={() => setShowProfilePicker(false)}
        title="프로필 사진 선택"
      >
        <div className="p-4">
          <p className="text-sm text-[#5C5C5C] mb-4">발견한 토끼 중 하나를 선택하세요</p>

          {/* 기본 프로필 (초기화) */}
          <button
            onClick={async () => {
              await updateProfile({ profileRabbitId: null  });
              setShowProfilePicker(false);
            }}
            className={`w-full flex items-center gap-3 p-3 mb-3 border-2 transition-colors ${
              profile?.profileRabbitId == null
                ? 'border-[#1A1A1A] bg-[#EDEAE4]'
                : 'border-[#D4CFC4]'
            }`}
          >
            <div className="w-12 h-12 flex items-center justify-center bg-[#FDFBF7] border border-[#D4CFC4]">
              <svg width={24} height={24} viewBox="0 0 24 24" fill="#1A1A1A">
                <circle cx="12" cy="8" r="4" />
                <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
              </svg>
            </div>
            <span className="font-bold text-[#1A1A1A]">기본 프로필</span>
            {profile?.profileRabbitId == null && (
              <span className="ml-auto text-sm text-[#5C5C5C]">선택됨</span>
            )}
          </button>

          {/* 발견한 토끼 그리드 */}
          {holdings.length > 0 ? (
            <div className="grid grid-cols-4 gap-2 max-h-[50vh] overflow-y-auto">
              {holdings
                .filter(h => h.rabbitId > 0)
                .sort((a, b) => a.rabbitId - b.rabbitId)
                .map(h => (
                  <button
                    key={h.id}
                    onClick={async () => {
                      await updateProfile({ profileRabbitId: h.rabbitId } );
                      setShowProfilePicker(false);
                    }}
                    className={`aspect-square border-2 overflow-hidden transition-all ${
                      profile?.profileRabbitId === h.rabbitId
                        ? 'border-[#1A1A1A] scale-95 bg-[#EDEAE4]'
                        : 'border-[#D4CFC4] hover:border-[#9A9A9A]'
                    }`}
                  >
                    <Image
                      src={getRabbitProfileUrl(h.rabbitId)}
                      alt={`토끼 #${h.rabbitId}`}
                      width={80}
                      height={80}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
            </div>
          ) : (
            <div className="text-center py-8 text-[#5C5C5C]">
              <p className="text-lg mb-1">아직 발견한 토끼가 없어요</p>
              <p className="text-sm">퀴즈를 풀어 토끼를 발견해보세요!</p>
            </div>
          )}
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
