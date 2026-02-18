'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUser } from '@/lib/contexts/UserContext';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import {
  useSettings,
  type NotificationSettings,
  type PrivacySettings,
  DEFAULT_SETTINGS,
} from '@/lib/hooks/useSettings';
import { calculateMilestoneInfo } from '@/components/home/StatsCard';

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 글래스모피즘 프로필/설정 바텀시트
 */
export default function ProfileDrawer({ isOpen, onClose }: ProfileDrawerProps) {
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

  // 모달 열림 시 네비게이션 숨김
  useEffect(() => {
    if (isOpen) document.body.setAttribute('data-hide-nav', '');
    else document.body.removeAttribute('data-hide-nav');
    return () => document.body.removeAttribute('data-hide-nav');
  }, [isOpen]);

  const displaySettings = settings || DEFAULT_SETTINGS;

  const milestoneInfo = profile ? calculateMilestoneInfo(profile.totalExp, profile.lastGachaExp || 0) : null;
  const expProgress = milestoneInfo && milestoneInfo.maxExp > 0
    ? Math.min((milestoneInfo.currentExp / milestoneInfo.maxExp) * 100, 100)
    : 0;

  const handleNicknameChange = useCallback(async () => {
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

  // 글래스 토글 스위치
  const ToggleSwitch = ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: () => void;
  }) => (
    <button
      onClick={onChange}
      className={`w-12 h-7 relative rounded-full transition-colors ${
        checked ? 'bg-white/40' : 'bg-white/15'
      }`}
    >
      <motion.div
        className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm"
        animate={{ left: checked ? 24 : 4 }}
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
            className="fixed left-0 right-0 bottom-0 z-50 max-h-[85vh] rounded-t-2xl overflow-hidden"
          >
            {/* 글래스 배경 레이어 */}
            <div className="absolute inset-0 rounded-t-2xl overflow-hidden">
              <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
            </div>
            <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />

            {/* 스크롤 영역 */}
            <div className="relative z-10 overflow-y-auto max-h-[85vh]">
              {/* 드래그 핸들 */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 bg-white/40 rounded-full" />
              </div>

              {/* 헤더 */}
              <div className="px-5 pt-2 pb-4">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-white">Settings</h2>
                  <button onClick={onClose} className="p-2 -mr-2">
                    <svg className="w-6 h-6 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* 프로필 정보 */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-14 h-14 flex items-center justify-center flex-shrink-0 overflow-hidden rounded-xl border-2 border-white/30 bg-white/10">
                    {profile.profileRabbitId != null ? (
                      <Image
                        src={getRabbitProfileUrl(profile.profileRabbitId)}
                        alt="프로필"
                        width={56}
                        height={56}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="rgba(255,255,255,0.6)">
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
                      <span className="text-lg font-bold text-white">
                        {profile.nickname}
                      </span>
                      <svg className="w-4 h-4 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <p className="text-sm text-white/50">
                      {profile.classType}반 · {profile.studentId}
                    </p>
                  </div>
                </div>

                {/* 뽑기 마일스톤 게이지 */}
                {milestoneInfo && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-white">
                        {profile.totalExp} XP
                      </span>
                      <span className="text-xs text-white/50">
                        {milestoneInfo.currentExp} / {milestoneInfo.maxExp} XP
                        {milestoneInfo.canGacha && ' · 뽑기 가능!'}
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden bg-white/15">
                      <motion.div
                        className="h-full rounded-full bg-white/60"
                        initial={{ width: 0 }}
                        animate={{ width: `${expProgress}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 구분선 */}
              <div className="h-px mx-5 bg-white/15" />

              {/* 설정 목록 */}
              <div className="px-5 py-6">
                {/* 알림 설정 */}
                <div className="mb-8">
                  <h3 className="text-lg font-bold text-white mb-4">
                    Notifications
                  </h3>
                  <div className="space-y-4">
                    {notificationItems.map((item) => (
                      <div key={item.key} className="flex items-center justify-between">
                        <span className="text-base text-white/80">
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
                  <h3 className="text-lg font-bold text-white mb-4">
                    Privacy
                  </h3>
                  <div className="space-y-4">
                    {privacyItems.map((item) => (
                      <div key={item.key} className="flex items-center justify-between">
                        <span className="text-base text-white/80">
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
                  className="w-full py-3 rounded-xl text-center font-medium transition-colors bg-red-500/20 border border-red-400/30 text-red-300 hover:bg-red-500/30 disabled:opacity-50"
                >
                  {loggingOut ? '로그아웃 중...' : '로그아웃'}
                </button>

                {/* 앱 정보 */}
                <div className="text-center pt-6 pb-2">
                  <p className="text-xs text-white/30">
                    RabbiTory v1.0.0
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* 닉네임 변경 모달 */}
          <AnimatePresence>
            {showNicknameModal && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/50"
                onClick={() => setShowNicknameModal(false)}
              >
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0.9 }}
                  onClick={(e) => e.stopPropagation()}
                  className="relative w-full max-w-sm rounded-2xl overflow-hidden p-6"
                >
                  <div className="absolute inset-0 rounded-2xl overflow-hidden">
                    <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />
                  <div className="relative z-10">
                    <h3 className="text-lg font-bold text-white mb-4">닉네임 변경</h3>

                    {nicknameCooldownDays > 0 && (
                      <p className="text-sm text-white/50 mb-3">
                        닉네임은 변경 후 30일이 지나야 다시 변경할 수 있습니다.
                        <br />
                        <span className="text-red-300">({nicknameCooldownDays}일 후 변경 가능)</span>
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
                      className={`w-full px-4 py-3 rounded-xl outline-none bg-white/10 text-white placeholder:text-white/40 disabled:opacity-50 border ${
                        nicknameError ? 'border-red-400/50' : 'border-white/15'
                      }`}
                    />
                    {nicknameError && (
                      <p className="text-xs mt-1 text-red-300">{nicknameError}</p>
                    )}
                    <div className="flex gap-3 mt-4">
                      <button
                        onClick={() => setShowNicknameModal(false)}
                        className="flex-1 py-3 rounded-xl font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
                      >
                        취소
                      </button>
                      <button
                        onClick={handleNicknameChange}
                        disabled={savingNickname || newNickname.length < 2 || nicknameCooldownDays > 0}
                        className="flex-1 py-3 rounded-xl font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
                      >
                        {savingNickname ? '저장 중...' : '변경'}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
}
