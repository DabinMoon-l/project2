'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUser } from '@/lib/contexts/UserContext';
import { useTheme } from '@/styles/themes/useTheme';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import {
  useSettings,
  type NotificationSettings,
  type PrivacySettings,
  DEFAULT_SETTINGS,
} from '@/lib/hooks/useSettings';
import { calculateMilestoneInfo } from '@/components/home/StatsCard';
import Modal from './Modal';

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 빈티지 스타일 프로필/설정 드로어
 */
export default function ProfileDrawer({ isOpen, onClose }: ProfileDrawerProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const { user, logout } = useAuth();
  const { profile, updateNickname } = useUser();
  const {
    settings,
    fetchSettings,
    updateNotifications,
    updatePrivacy,
  } = useSettings();

  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [savingNickname, setSavingNickname] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // 닉네임 변경 쿨다운 계산 (30일)
  const getNicknameCooldownDays = (): number => {
    if (!profile?.lastNicknameChangeAt) return 0;
    const lastChangeDate = profile.lastNicknameChangeAt.toDate();
    const now = new Date();
    const diffTime = now.getTime() - lastChangeDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const remainingDays = 30 - diffDays;
    return remainingDays > 0 ? remainingDays : 0;
  };

  const nicknameCooldownDays = getNicknameCooldownDays();

  useEffect(() => {
    if (user?.uid && isOpen) {
      fetchSettings(user.uid);
    }
  }, [user?.uid, isOpen, fetchSettings]);

  const displaySettings = settings || DEFAULT_SETTINGS;

  const milestoneInfo = profile ? calculateMilestoneInfo(profile.totalExp, profile.lastGachaExp || 0) : null;
  const expProgress = milestoneInfo && milestoneInfo.maxExp > 0
    ? Math.min((milestoneInfo.currentExp / milestoneInfo.maxExp) * 100, 100)
    : 0;

  const handleNicknameChange = useCallback(async () => {
    // 쿨다운 체크
    if (nicknameCooldownDays > 0) {
      setNicknameError(`${nicknameCooldownDays}일 후에 변경할 수 있습니다.`);
      return;
    }

    if (newNickname.length < 2 || newNickname.length > 10) {
      setNicknameError('닉네임은 2-10자 사이여야 합니다.');
      return;
    }

    try {
      setSavingNickname(true);
      await updateNickname(newNickname);
      setShowNicknameModal(false);
      setNewNickname('');
    } catch {
      setNicknameError('닉네임 변경에 실패했습니다.');
    } finally {
      setSavingNickname(false);
    }
  }, [newNickname, updateNickname, nicknameCooldownDays]);

  const handleNotificationChange = useCallback(
    async (key: keyof NotificationSettings, value: boolean) => {
      if (!user?.uid) return;
      await updateNotifications(user.uid, { [key]: value });
    },
    [user?.uid, updateNotifications]
  );

  const handlePrivacyChange = useCallback(
    async (key: keyof PrivacySettings, value: boolean) => {
      if (!user?.uid) return;
      await updatePrivacy(user.uid, { [key]: value });
    },
    [user?.uid, updatePrivacy]
  );

  const handleLogout = useCallback(async () => {
    try {
      setLoggingOut(true);
      onClose();
      await logout();
    } catch (err) {
      console.error('로그아웃 에러:', err);
      setLoggingOut(false);
    }
  }, [logout, onClose]);

  const notificationItems = [
    { key: 'quizReminder' as const, label: '퀴즈 알림' },
    { key: 'newQuiz' as const, label: '새 퀴즈 알림' },
    { key: 'feedbackReply' as const, label: '피드백 답변' },
    { key: 'boardComment' as const, label: '게시판 알림' },
  ];

  const privacyItems = [
    { key: 'profilePublic' as const, label: '프로필 공개' },
    { key: 'activityPublic' as const, label: '활동 내역 공개' },
  ];

  // 빈티지 토글 스위치
  const ToggleSwitch = ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: () => void;
  }) => (
    <button
      onClick={onChange}
      className="w-12 h-6 relative transition-colors"
      style={{
        border: '1px solid #1A1A1A',
        backgroundColor: checked ? theme.colors.accent : theme.colors.backgroundSecondary,
      }}
    >
      <motion.div
        className="w-5 h-5 absolute top-0.5"
        style={{
          backgroundColor: checked ? '#F5F0E8' : '#1A1A1A',
        }}
        animate={{ left: checked ? '24px' : '2px' }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  );

  if (!profile) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 오버레이 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={onClose}
          />

          {/* 바텀시트 */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed left-0 right-0 bottom-0 z-50 overflow-y-auto max-h-[85vh]"
            style={{ backgroundColor: theme.colors.background }}
          >
            {/* 바텀시트 핸들 */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-[#D4CFC4]" />
            </div>

            {/* 헤더 */}
            <div className="px-5 pt-2 pb-4">
              <div className="flex items-center justify-between mb-6">
                <h2
                  className="font-serif-display text-2xl font-bold"
                  style={{ color: theme.colors.text }}
                >
                  Settings
                </h2>
                <button
                  onClick={onClose}
                  className="p-2 -mr-2"
                  style={{ color: theme.colors.textSecondary }}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 프로필 정보 */}
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-14 h-14 flex items-center justify-center flex-shrink-0 overflow-hidden"
                  style={{
                    border: '2px solid #1A1A1A',
                    backgroundColor: theme.colors.backgroundCard,
                  }}
                >
                  {profile.profileRabbitId != null ? (
                    <img
                      src={getRabbitProfileUrl(profile.profileRabbitId)}
                      alt="프로필"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="#1A1A1A">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
                    </svg>
                  )}
                </div>
                <div className="flex-1">
                  <button
                    onClick={() => {
                      setNewNickname(profile.nickname);
                      setNicknameError('');
                      setShowNicknameModal(true);
                    }}
                    className="flex items-center gap-1"
                  >
                    <span
                      className="font-serif-display text-lg font-bold"
                      style={{ color: theme.colors.text }}
                    >
                      {profile.nickname}
                    </span>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke={theme.colors.textSecondary}
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <p
                    className="text-sm"
                    style={{ color: theme.colors.textSecondary }}
                  >
                    {profile.classType}반 · {profile.studentId}
                  </p>
                </div>
              </div>

              {/* 뽑기 마일스톤 게이지 */}
              {milestoneInfo && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-sm font-serif-display"
                      style={{ color: theme.colors.accent }}
                    >
                      {profile.totalExp} XP
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: theme.colors.textSecondary }}
                    >
                      {milestoneInfo.currentExp} / {milestoneInfo.maxExp} XP
                      {milestoneInfo.canGacha && ' · 뽑기 가능!'}
                    </span>
                  </div>
                  <div
                    className="h-2 overflow-hidden"
                    style={{
                      border: '1px solid #1A1A1A',
                      backgroundColor: theme.colors.backgroundSecondary,
                    }}
                  >
                    <motion.div
                      className="h-full"
                      style={{ backgroundColor: theme.colors.accent }}
                      initial={{ width: 0 }}
                      animate={{ width: `${expProgress}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 구분선 */}
            <div className="h-px mx-5 bg-[#1A1A1A]" />

            {/* 설정 목록 */}
            <div className="px-5 py-6">
              {/* 알림 설정 */}
              <div className="mb-8">
                <h3
                  className="font-serif-display text-lg font-bold mb-4"
                  style={{ color: theme.colors.text }}
                >
                  Notifications
                </h3>
                <div className="space-y-4">
                  {notificationItems.map((item) => (
                    <div key={item.key} className="flex items-center justify-between">
                      <span
                        className="text-base"
                        style={{ color: theme.colors.text }}
                      >
                        {item.label}
                      </span>
                      <ToggleSwitch
                        checked={displaySettings.notifications[item.key]}
                        onChange={() => handleNotificationChange(item.key, !displaySettings.notifications[item.key])}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* 개인정보 설정 */}
              <div className="mb-8">
                <h3
                  className="font-serif-display text-lg font-bold mb-4"
                  style={{ color: theme.colors.text }}
                >
                  Privacy
                </h3>
                <div className="space-y-4">
                  {privacyItems.map((item) => (
                    <div key={item.key} className="flex items-center justify-between">
                      <span
                        className="text-base"
                        style={{ color: theme.colors.text }}
                      >
                        {item.label}
                      </span>
                      <ToggleSwitch
                        checked={displaySettings.privacy[item.key]}
                        onChange={() => handlePrivacyChange(item.key, !displaySettings.privacy[item.key])}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* 로그아웃 버튼 */}
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="w-full py-3 btn-vintage-outline text-center disabled:opacity-50"
                style={{ color: '#8B1A1A', borderColor: '#8B1A1A' }}
              >
                {loggingOut ? '로그아웃 중...' : '로그아웃'}
              </button>

              {/* 앱 정보 */}
              <div className="text-center pt-6">
                <p
                  className="text-xs  italic"
                  style={{ color: theme.colors.textSecondary }}
                >
                  RabbiTory v1.0.0
                </p>
              </div>
            </div>
          </motion.div>

          {/* 닉네임 변경 모달 */}
          <Modal
            isOpen={showNicknameModal}
            onClose={() => setShowNicknameModal(false)}
            title="닉네임 변경"
            noBlur
          >
            <div className="p-4">
              {nicknameCooldownDays > 0 && (
                <p className="text-sm mb-3" style={{ color: theme.colors.textSecondary }}>
                  닉네임은 변경 후 30일이 지나야 다시 변경할 수 있습니다.
                  <br />
                  <span style={{ color: '#8B1A1A' }}>({nicknameCooldownDays}일 후 변경 가능)</span>
                </p>
              )}
              <input
                type="text"
                value={newNickname}
                onChange={(e) => {
                  setNewNickname(e.target.value);
                  setNicknameError('');
                }}
                placeholder="새 닉네임 (2-10자)"
                maxLength={10}
                disabled={nicknameCooldownDays > 0}
                className="w-full px-4 py-3 outline-none disabled:opacity-50"
                style={{
                  border: `1px solid ${nicknameError ? '#8B1A1A' : '#1A1A1A'}`,
                  backgroundColor: theme.colors.backgroundCard,
                  color: theme.colors.text,
                }}
              />
              {nicknameError && (
                <p className="text-xs mt-1" style={{ color: '#8B1A1A' }}>{nicknameError}</p>
              )}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setShowNicknameModal(false)}
                  className="flex-1 py-3 btn-vintage-outline"
                >
                  취소
                </button>
                <button
                  onClick={handleNicknameChange}
                  disabled={savingNickname || newNickname.length < 2 || nicknameCooldownDays > 0}
                  className="flex-1 py-3 btn-vintage disabled:opacity-50"
                >
                  {savingNickname ? '저장 중...' : '변경'}
                </button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </AnimatePresence>
  );
}
