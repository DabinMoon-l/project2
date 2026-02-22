'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { isStudentEmail, extractStudentId } from '@/lib/auth';
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

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 설정 페이지 (글래스모피즘)
 */
export default function SettingsPage() {
  const router = useRouter();
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

  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // 네비게이션 숨김
  useEffect(() => {
    document.body.setAttribute('data-hide-nav', 'true');
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, []);

  // 설정 로드
  useEffect(() => {
    if (user?.uid) {
      fetchSettings(user.uid);
    }
  }, [user?.uid, fetchSettings]);

  const displaySettings = settings || DEFAULT_SETTINGS;

  const handleNotificationChange = useCallback(
    async (key: keyof NotificationSettings, value: boolean) => {
      if (!user?.uid) return;
      await updateNotifications(user.uid, { [key]: value });
    },
    [user?.uid, updateNotifications]
  );

  const handleDisplayChange = useCallback(
    async (key: keyof DisplaySettings, value: boolean) => {
      if (!user?.uid) return;
      await updateDisplay(user.uid, { [key]: value });
    },
    [user?.uid, updateDisplay]
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
    <div className="relative min-h-screen pb-8">
      {/* 배경 이미지 + 글래스 오버레이 */}
      <div className="fixed inset-0">
        <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
      </div>
      <div className="fixed inset-0 bg-white/10 backdrop-blur-2xl" />

      {/* 헤더 */}
      <header className="relative z-10 flex items-center justify-between px-4 pt-4 pb-2">
        <button
          onClick={() => router.back()}
          className="w-10 h-10 flex items-center justify-center"
          aria-label="닫기"
        >
          <svg className="w-7 h-7 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-white">설정</h1>
        <div className="w-10" />
      </header>

      {/* 에러 메시지 */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 mx-4 mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl backdrop-blur-sm"
        >
          <p className="text-sm text-red-200">{error}</p>
          <button
            type="button"
            onClick={clearError}
            className="text-xs text-red-300 underline mt-1"
          >
            닫기
          </button>
        </motion.div>
      )}

      {/* 프로필 사진 설정 */}
      <div className="relative z-10 px-4 pt-2 pb-2">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl overflow-hidden bg-white/10 border border-white/15 backdrop-blur-sm"
        >
          <div className="px-4 py-3 border-b border-white/10">
            <h3 className="font-bold text-white">프로필 사진</h3>
          </div>
          <button
            onClick={() => setShowProfilePicker(true)}
            className="w-full flex items-center gap-4 px-4 py-4 transition-colors hover:bg-white/5"
          >
            <div className="w-16 h-16 flex-shrink-0 border-2 border-white/30 rounded-xl overflow-hidden flex items-center justify-center bg-white/10">
              {profile?.profileRabbitId != null ? (
                <Image
                  src={getRabbitProfileUrl(profile.profileRabbitId)}
                  alt="프로필"
                  width={64}
                  height={64}
                  className="w-full h-full object-cover"
                />
              ) : (
                <svg width={32} height={32} viewBox="0 0 24 24" fill="rgba(255,255,255,0.5)">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
                </svg>
              )}
            </div>
            <div className="flex-1 text-left">
              <p className="font-bold text-white">프로필 사진 변경</p>
              <p className="text-sm text-white/50">발견한 토끼로 프로필을 꾸며보세요</p>
            </div>
            <svg className="w-5 h-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </motion.div>
      </div>

      {/* 복구 이메일 (학생만) */}
      {user?.email && isStudentEmail(user.email) && (
        <RecoveryEmailSection />
      )}

      {/* 메인 컨텐츠 */}
      <main className="relative z-10 px-4 pt-2">
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
      <AnimatePresence>
        {showLogoutModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50"
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
              <div className="relative z-10 text-center">
                <p className="text-white font-bold text-lg mb-2">정말 로그아웃 하시겠습니까?</p>
                <p className="text-sm text-white/50 mb-6">다시 로그인하면 모든 데이터가 복구됩니다.</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowLogoutModal(false)}
                    disabled={actionLoading}
                    className="flex-1 py-3 rounded-xl font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleLogout}
                    disabled={actionLoading}
                    className="flex-1 py-3 rounded-xl font-medium bg-red-500/80 text-white hover:bg-red-500 transition-colors"
                  >
                    {actionLoading ? '처리 중...' : '로그아웃'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 프로필 사진 선택 모달 */}
      <AnimatePresence>
        {showProfilePicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowProfilePicker(false)}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-sm rounded-2xl overflow-hidden"
            >
              <div className="absolute inset-0 rounded-2xl overflow-hidden">
                <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
              </div>
              <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />
              <div className="relative z-10">
                {/* 헤더 */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <h2 className="text-lg font-bold text-white">프로필 사진 선택</h2>
                  <button
                    onClick={() => setShowProfilePicker(false)}
                    className="w-8 h-8 flex items-center justify-center"
                  >
                    <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="p-5">
                  <p className="text-sm text-white/50 mb-4">발견한 토끼 중 하나를 선택하세요</p>

                  {/* 기본 프로필 */}
                  <button
                    onClick={async () => {
                      await updateProfile({ profileRabbitId: null });
                      setShowProfilePicker(false);
                    }}
                    className={`w-full flex items-center gap-3 p-3 mb-3 rounded-xl border transition-colors ${
                      profile?.profileRabbitId == null
                        ? 'border-white/40 bg-white/15'
                        : 'border-white/15 hover:bg-white/5'
                    }`}
                  >
                    <div className="w-12 h-12 flex items-center justify-center bg-white/10 border border-white/20 rounded-lg">
                      <svg width={24} height={24} viewBox="0 0 24 24" fill="rgba(255,255,255,0.6)">
                        <circle cx="12" cy="8" r="4" />
                        <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
                      </svg>
                    </div>
                    <span className="font-bold text-white">기본 프로필</span>
                    {profile?.profileRabbitId == null && (
                      <span className="ml-auto text-sm text-white/50">선택됨</span>
                    )}
                  </button>

                  {/* 발견한 토끼 그리드 */}
                  {holdings.length > 0 ? (
                    <div className="grid grid-cols-4 gap-2 max-h-[50vh] overflow-y-auto">
                      {holdings
                        .slice()
                        .sort((a, b) => a.rabbitId - b.rabbitId)
                        .map(h => (
                          <button
                            key={h.id}
                            onClick={async () => {
                              await updateProfile({ profileRabbitId: h.rabbitId });
                              setShowProfilePicker(false);
                            }}
                            className={`aspect-square rounded-xl border overflow-hidden transition-all ${
                              profile?.profileRabbitId === h.rabbitId
                                ? 'border-white/50 scale-95 bg-white/20'
                                : 'border-white/15 hover:border-white/30'
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
                    <div className="text-center py-8">
                      <p className="text-lg text-white/60 mb-1">아직 발견한 토끼가 없어요</p>
                      <p className="text-sm text-white/40">퀴즈를 풀어 토끼를 발견해보세요!</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 초기화 확인 모달 */}
      <AnimatePresence>
        {showResetModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50"
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
              <div className="relative z-10 text-center">
                <p className="text-white font-bold text-lg mb-2">모든 설정을 초기화하시겠습니까?</p>
                <p className="text-sm text-white/50 mb-6">알림, 표시, 개인정보 설정이 기본값으로 돌아갑니다.</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowResetModal(false)}
                    disabled={actionLoading}
                    className="flex-1 py-3 rounded-xl font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleResetSettings}
                    disabled={actionLoading}
                    className="flex-1 py-3 rounded-xl font-medium bg-white/30 text-white hover:bg-white/40 transition-colors"
                  >
                    {actionLoading ? '처리 중...' : '초기화'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// 복구 이메일 섹션 컴포넌트
// ============================================================

function RecoveryEmailSection() {
  const { profile } = useUser();
  const [email, setEmail] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const maskedEmail = profile?.recoveryEmail
    ? maskEmailForDisplay(profile.recoveryEmail)
    : null;

  const handleSave = async () => {
    if (!email) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setMessage('유효하지 않은 이메일 형식입니다.');
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const updateFn = httpsCallable<
        { recoveryEmail: string },
        { success: boolean; maskedEmail: string }
      >(functions, 'updateRecoveryEmail');

      const result = await updateFn({ recoveryEmail: email });
      setMessage('복구 이메일이 등록되었습니다.');
      setIsEditing(false);
      setEmail('');
    } catch (err: unknown) {
      const firebaseError = err as { message?: string };
      setMessage(firebaseError.message || '등록에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative z-10 px-4 pt-2 pb-2">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-2xl overflow-hidden bg-white/10 border border-white/15 backdrop-blur-sm"
      >
        <div className="px-4 py-3 border-b border-white/10">
          <h3 className="font-bold text-white">복구 이메일</h3>
          <p className="text-xs text-white/50 mt-0.5">비밀번호 찾기에 사용됩니다</p>
        </div>
        <div className="px-4 py-3">
          {!isEditing ? (
            <div className="flex items-center justify-between">
              <div>
                {maskedEmail ? (
                  <p className="text-sm text-white">{maskedEmail}</p>
                ) : (
                  <p className="text-sm text-white/40">등록된 이메일 없음</p>
                )}
              </div>
              <button
                onClick={() => setIsEditing(true)}
                className="px-3 py-1.5 text-xs font-medium text-white bg-white/15 rounded-lg hover:bg-white/20 transition-colors"
              >
                {maskedEmail ? '변경' : '등록'}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="email"
                placeholder="개인 이메일 입력"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:border-white/40"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEmail('');
                    setMessage(null);
                  }}
                  className="flex-1 py-2 text-xs font-medium text-white/70 bg-white/10 rounded-lg hover:bg-white/15"
                >
                  취소
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !email}
                  className="flex-1 py-2 text-xs font-medium text-white bg-white/25 rounded-lg hover:bg-white/30 disabled:opacity-50"
                >
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          )}
          {message && (
            <p className={`mt-2 text-xs ${message.includes('등록되었') ? 'text-green-400' : 'text-red-400'}`}>
              {message}
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function maskEmailForDisplay(email: string): string {
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${local[1]}***@${domain}`;
}
