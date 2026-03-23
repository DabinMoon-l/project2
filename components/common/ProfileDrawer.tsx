'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { callFunction } from '@/lib/api';
import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  where,
  db,
} from '@/lib/repositories';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUser } from '@/lib/contexts/UserContext';
import { useCourse } from '@/lib/contexts';
import { useMilestone } from '@/lib/contexts';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import {
  useSettings,
  type NotificationSettings,
  DEFAULT_SETTINGS,
} from '@/lib/hooks/useSettings';
import { calculateMilestoneInfo } from '@/components/home/StatsCard';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import { useHideNav } from '@/lib/hooks/useHideNav';
import {
  ADMIN_STUDENT_ID,
  NOTIFICATION_ITEMS,
  CLASS_OPTIONS,
  maskEmail,
  InquiryMessageItem,
  ToggleSwitch,
  GlassModal,
} from './profileDrawerParts';
import type { Inquiry, ProfileDrawerProps } from './profileDrawerParts';
import RecoveryEmailModal from './profileDrawerModals/RecoveryEmailModal';
import PasswordChangeModal from './profileDrawerModals/PasswordChangeModal';
import PasswordResetModal from './profileDrawerModals/PasswordResetModal';
import AccountDeletionDialog from './profileDrawerModals/AccountDeletionDialog';

/**
 * 글래스모피즘 프로필/설정 바텀시트
 */
export default function ProfileDrawer({ isOpen, onClose, isPanelMode }: ProfileDrawerProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { profile, updateNickname, updateProfile, isProfessor } = useUser();
  const { userCourseId } = useCourse();
  const isWide = useWideMode();
  const { holdings } = useMilestone();
  const {
    settings,
    loading: settingsLoading,
    fetchSettings,
    updateNotifications,
  } = useSettings();

  const sheetRef = useRef<HTMLDivElement>(null);
  const [pickerHeight, setPickerHeight] = useState(0);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [showProfilePicker, setShowProfilePicker] = useState(false);
  const [pickerReady, setPickerReady] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [showClassModal, setShowClassModal] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [savingNickname, setSavingNickname] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [selectedClass, setSelectedClass] = useState<'A' | 'B' | 'C' | 'D'>('A');

  // Account 섹션 — 모달 열림/닫힘 토글 (내부 상태는 각 모달 컴포넌트에서 관리)
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showCacheConfirm, setShowCacheConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [showInquiryModal, setShowInquiryModal] = useState(false);
  const [inquiryMessage, setInquiryMessage] = useState('');
  const [sendingInquiry, setSendingInquiry] = useState(false);
  const [inquirySent, setInquirySent] = useState(false);

  // 관리자 문의 확인 상태
  const [showInquiryList, setShowInquiryList] = useState(false);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // 관리자 비밀번호 초기화 상태
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [adminResetStudentId, setAdminResetStudentId] = useState('');
  const [adminResetPassword, setAdminResetPassword] = useState('');
  const [adminResetResult, setAdminResetResult] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [adminResetting, setAdminResetting] = useState(false);

  const isAdmin = profile?.studentId === ADMIN_STUDENT_ID;

  // ============================================================
  // 메모이제이션 — 렌더마다 재계산 방지
  // ============================================================

  const nicknameCooldownDays = useMemo(() => {
    if (!profile?.lastNicknameChangeAt) return 0;
    const lastChangeDate = profile.lastNicknameChangeAt.toDate();
    const diffDays = Math.floor((Date.now() - lastChangeDate.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(30 - diffDays, 0);
  }, [profile?.lastNicknameChangeAt]);

  const displaySettings = useMemo(() => settings || DEFAULT_SETTINGS, [settings]);
  const settingsReady = !settingsLoading && settings !== null;

  const milestoneInfo = useMemo(
    () => profile ? calculateMilestoneInfo(profile.totalExp, profile.lastGachaExp || 0) : null,
    [profile?.totalExp, profile?.lastGachaExp]
  );

  const expProgress = useMemo(
    () => milestoneInfo && milestoneInfo.maxExp > 0
      ? Math.min((milestoneInfo.currentExp / milestoneInfo.maxExp) * 100, 100)
      : 0,
    [milestoneInfo]
  );

  const maskedRecovery = useMemo(
    () => profile?.recoveryEmail ? maskEmail(profile.recoveryEmail) : null,
    [profile?.recoveryEmail]
  );

  // 학생 토끼 목록 — filter/sort 캐싱
  const sortedHoldings = useMemo(
    () => holdings.slice().sort((a, b) => a.rabbitId - b.rabbitId),
    [holdings]
  );

  // ============================================================
  // Effects
  // ============================================================

  useEffect(() => {
    if (user?.uid && isOpen) {
      fetchSettings(user.uid);
    }
  }, [user?.uid, isOpen, fetchSettings]);

  // 네비게이션 숨김 (패널 모드에서는 불필요)
  useHideNav(isOpen && !isPanelMode);

  // body 스크롤 방지 (패널 모드에서는 불필요 — 3쪽 패널 내부)
  useEffect(() => {
    if (!isOpen || isPanelMode) return;
    lockScroll();
    return () => unlockScroll();
  }, [isOpen, isPanelMode]);

  // 프로필 피커 점진적 렌더링 — 애니메이션 완료 후 12개씩
  useEffect(() => {
    if (!showProfilePicker) {
      setPickerReady(false);
      setVisibleCount(0);
      return;
    }
    const timer = setTimeout(() => {
      setPickerReady(true);
      setVisibleCount(12);
    }, 350);
    return () => clearTimeout(timer);
  }, [showProfilePicker]);

  useEffect(() => {
    if (!pickerReady) return;
    const total = isProfessor ? 80 : sortedHoldings.length;
    if (visibleCount >= total) return;
    const raf = requestAnimationFrame(() => {
      setVisibleCount(prev => Math.min(prev + 12, total));
    });
    return () => cancelAnimationFrame(raf);
  }, [pickerReady, visibleCount, isProfessor, sortedHoldings.length]);

  // 관리자: 읽지 않은 문의 수 실시간 구독 (목록이 닫혀 있을 때만 — 열려 있으면 목록 구독이 카운트 갱신)
  useEffect(() => {
    if (!isAdmin || !isOpen || showInquiryList) return;
    const q = query(
      collection(db, 'inquiries'),
      where('isRead', '==', false)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUnreadCount(snapshot.size);
    }, () => {
      // Firestore 권한 에러 무시 (inquiries는 교수만 읽기 가능)
    });
    return () => unsubscribe();
  }, [isAdmin, isOpen, showInquiryList]);

  // 관리자: 문의 목록 실시간 구독
  useEffect(() => {
    if (!isAdmin || !showInquiryList) return;
    const q = query(
      collection(db, 'inquiries'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: Inquiry[] = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt || null,
      } as Inquiry));
      setInquiries(items);
      setUnreadCount(items.filter(i => !i.isRead).length);
    }, () => {
      // Firestore 권한 에러 무시 (inquiries는 교수만 읽기 가능)
    });
    return () => unsubscribe();
  }, [isAdmin, showInquiryList]);

  // ============================================================
  // 핸들러
  // ============================================================

  const handleNicknameChange = useCallback(async () => {
    if (nicknameCooldownDays > 0) {
      setNicknameError(`${nicknameCooldownDays}일 후에 변경할 수 있습니다.`);
      return;
    }
    const trimmed = newNickname.trim();
    if (trimmed.length < 2 || trimmed.length > 6) {
      setNicknameError('닉네임은 2-6자 사이여야 합니다.');
      return;
    }
    if (!/^[가-힣a-zA-Z0-9]+$/.test(trimmed)) {
      setNicknameError('닉네임은 한글, 영문, 숫자만 가능합니다.');
      return;
    }
    if (trimmed === profile?.nickname) {
      setNicknameError('현재 닉네임과 동일합니다.');
      return;
    }
    try {
      setSavingNickname(true);
      await updateNickname(trimmed);
      setShowNicknameModal(false);
      setNewNickname('');
    } catch {
      setNicknameError('닉네임 변경에 실패했습니다.');
    } finally {
      setSavingNickname(false);
    }
  }, [newNickname, updateNickname, nicknameCooldownDays, profile?.nickname]);

  const handleNotificationChange = useCallback(
    async (key: keyof NotificationSettings, value: boolean) => {
      if (!user?.uid) return;
      await updateNotifications(user.uid, { [key]: value });
    },
    [user?.uid, updateNotifications]
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


  // 캐시 초기화
  const handleClearCache = useCallback(async () => {
    localStorage.clear();
    sessionStorage.clear();
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        await caches.delete(name);
      }
    }
    window.location.reload();
  }, []);

  // 문의하기
  const handleSendInquiry = useCallback(async () => {
    if (!inquiryMessage.trim() || !user?.uid || !profile) return;
    setSendingInquiry(true);
    try {
      await addDoc(collection(db, 'inquiries'), {
        authorUid: user.uid,
        message: inquiryMessage.trim(),
        createdAt: serverTimestamp(),
        courseId: userCourseId || '',
        isRead: false,
      });
      setInquirySent(true);
      setInquiryMessage('');
      setTimeout(() => {
        setShowInquiryModal(false);
        setInquirySent(false);
      }, 1500);
    } catch {
      // 조용히 실패
    } finally {
      setSendingInquiry(false);
    }
  }, [inquiryMessage, user?.uid, profile, userCourseId]);

  // 관리자: 문의 읽음 처리
  const handleMarkRead = useCallback(async (inquiryId: string) => {
    await updateDoc(doc(db, 'inquiries', inquiryId), { isRead: true });
  }, []);

  // 관리자: 비밀번호 초기화
  const handleAdminResetPassword = useCallback(async () => {
    if (!adminResetStudentId || !adminResetPassword || !userCourseId) return;

    if (!/^\d{7,10}$/.test(adminResetStudentId)) {
      setAdminResetResult({ message: '학번은 7-10자리 숫자입니다.', type: 'error' });
      return;
    }
    if (adminResetPassword.length < 6) {
      setAdminResetResult({ message: '비밀번호는 6자 이상이어야 합니다.', type: 'error' });
      return;
    }

    setAdminResetting(true);
    setAdminResetResult(null);
    try {
      const res = await callFunction('resetStudentPassword', {
        studentId: adminResetStudentId,
        courseId: userCourseId,
        newPassword: adminResetPassword,
      });
      setAdminResetResult({ message: res.message, type: 'success' });
      setAdminResetStudentId('');
      setAdminResetPassword('');
    } catch (err: unknown) {
      const firebaseError = err as { message?: string };
      setAdminResetResult({
        message: firebaseError.message || '비밀번호 초기화에 실패했습니다.',
        type: 'error',
      });
    } finally {
      setAdminResetting(false);
    }
  }, [adminResetStudentId, adminResetPassword, userCourseId]);

  if (!profile) return null;

  // ============================================================
  // 공유 JSX — 패널 모드와 바텀시트 모드에서 동일하게 사용
  // ============================================================

  /** 메인 콘텐츠 (헤더 + 프로필 + 설정 목록) */
  const drawerContent = (
    <>
      {/* 헤더 */}
      <div className="px-5 pt-1 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Settings</h2>
          <button onClick={onClose} className="p-2 -mr-2">
            <svg className="w-6 h-6 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 프로필 정보 */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => {
              if (sheetRef.current) setPickerHeight(sheetRef.current.offsetHeight);
              setShowProfilePicker(true);
            }}
            className="w-14 h-14 flex items-center justify-center flex-shrink-0 overflow-hidden rounded-xl border-2 border-white/30 bg-white/10 transition-transform active:scale-95"
          >
            {profile.profileRabbitId != null ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
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
          </button>
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
              <svg className="w-3.5 h-3.5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
            {!isProfessor && (
              <div className="flex items-center gap-1 text-sm text-white/50">
                <span>{profile.studentId}</span>
                <span>·</span>
                <button
                  onClick={() => {
                    setSelectedClass((profile.classType as 'A' | 'B' | 'C' | 'D') || 'A');
                    setShowClassModal(true);
                  }}
                  className="flex items-center gap-0.5 hover:text-white/70 transition-colors"
                >
                  <span>{profile.classType}반</span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 뽑기 마일스톤 게이지 (학생만) */}
        {milestoneInfo && !isProfessor && (
          <div>
            <div className="flex justify-end mb-1">
              <span className="text-sm font-medium text-white">
                {profile.totalExp} XP
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
      <div className="px-5 py-4">
        {/* 알림 설정 (학생만) */}
        {!isProfessor && (
          <div className="mb-6">
            <h3 className="text-sm font-bold text-white/70 mb-3">
              Notifications
            </h3>
            <div className="space-y-4">
              {NOTIFICATION_ITEMS.map((item) => (
                <div key={item.key} className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-white/80">
                      {item.label}
                    </span>
                    <p className="text-xs text-white/40">{item.desc}</p>
                  </div>
                  <ToggleSwitch
                    checked={displaySettings.notifications[item.key]}
                    onChange={() => handleNotificationChange(item.key, !displaySettings.notifications[item.key])}
                    animated={settingsReady}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Account 섹션 */}
        <div className="mb-6">
          <h3 className="text-sm font-bold text-white/70 mb-3">
            Account
          </h3>
          <div className="space-y-3">
            {/* 복구 이메일 (학생만) */}
            {!isProfessor && (
              <button
                onClick={() => setShowRecoveryModal(true)}
                className="w-full flex items-center justify-between py-2.5"
              >
                <div className="text-left">
                  <span className="text-sm text-white/80">복구 이메일</span>
                  <p className="text-xs text-white/40">
                    {maskedRecovery || '미등록'}
                  </p>
                </div>
                <svg className="w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}

            {/* 비밀번호 변경 */}
            <button
              onClick={() => setShowPasswordModal(true)}
              className="w-full flex items-center justify-between py-2.5"
            >
              <span className="text-sm text-white/80">비밀번호 변경</span>
              <svg className="w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Support 섹션 */}
        <div className="mb-6">
          <h3 className="text-sm font-bold text-white/70 mb-3">
            Support
          </h3>
          <div className="space-y-3">
            {/* 캐시 초기화 */}
            <button
              onClick={() => setShowCacheConfirm(true)}
              className="w-full flex items-center justify-between py-2.5"
            >
              <div className="text-left">
                <span className="text-sm text-white/80">캐시 초기화</span>
                <p className="text-xs text-white/40">앱 데이터 초기화</p>
              </div>
              <svg className="w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* 관리자 비밀번호 초기화 */}
            {isAdmin && (
              <>
                <div className="border-t border-white/5 my-1" />
                <button
                  onClick={() => setShowPasswordReset(prev => !prev)}
                  className="w-full flex items-center justify-between py-2.5"
                >
                  <span className="text-sm text-white/80">비밀번호 초기화</span>
                  <svg
                    className={`w-4 h-4 text-white/30 transition-transform ${showPasswordReset ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                <AnimatePresence>
                  {showPasswordReset && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-2 pb-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="학번 (7-10자리)"
                          value={adminResetStudentId}
                          onChange={(e) => setAdminResetStudentId(e.target.value.replace(/\D/g, ''))}
                          maxLength={10}
                          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/10 text-white placeholder:text-white/40 border border-white/15"
                        />
                        <input
                          type="text"
                          placeholder="새 비밀번호 (6자 이상)"
                          value={adminResetPassword}
                          onChange={(e) => setAdminResetPassword(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none bg-white/10 text-white placeholder:text-white/40 border border-white/15"
                        />
                        <button
                          onClick={handleAdminResetPassword}
                          disabled={adminResetting || !adminResetStudentId || !adminResetPassword}
                          className="w-full py-2.5 rounded-xl text-sm font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-40"
                        >
                          {adminResetting ? '초기화 중...' : '비밀번호 초기화'}
                        </button>
                        {adminResetResult && (
                          <p className={`text-xs text-center ${adminResetResult.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                            {adminResetResult.message}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </div>
        </div>

        {/* 로그아웃 버튼 */}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full py-2 rounded-xl text-center text-sm font-medium transition-colors bg-red-500/20 border border-red-400/30 text-red-300 hover:bg-red-500/30 disabled:opacity-50"
        >
          {loggingOut ? '로그아웃 중...' : '로그아웃'}
        </button>

        {/* 계정 삭제 (학생만) */}
        {!isProfessor && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full mt-3 text-center text-xs text-red-400/60 hover:text-red-400/80 transition-colors py-2"
          >
            계정 삭제
          </button>
        )}

        {/* 앱 정보 */}
        <div className="text-center pt-4 pb-2">
          <p className="text-xs text-white/30">
            RabbiTory v1.0.0
          </p>
        </div>
      </div>
    </>
  );

  /** 서브 모달 (프로필 피커, 닉네임, 반 변경, 복구 이메일, 비밀번호 등) */
  const subModals = (
    <>
      {/* 프로필 사진 선택 드로어 (좌측 슬라이드) */}
      <AnimatePresence>
        {showProfilePicker && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`fixed inset-0 z-[60] ${isWide ? '' : 'bg-black/50'}`}
              style={isWide
                ? undefined
                : { left: 'var(--modal-left, 0px)', right: 'var(--modal-right, 0px)' }
              }
              onClick={() => setShowProfilePicker(false)}
            />
            <motion.div
              initial={isWide ? { y: '100%' } : { x: '-100%' }}
              animate={isWide ? { y: 0 } : { x: 0 }}
              exit={isWide ? { y: '100%' } : { x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className={isWide
                ? "fixed bottom-0 right-0 z-[60] rounded-t-2xl overflow-hidden"
                : "fixed left-0 bottom-0 z-[60] w-56 rounded-tr-2xl overflow-hidden"
              }
              style={isWide
                ? { left: 'var(--home-sheet-left, 0px)', maxHeight: '70vh' }
                : { height: pickerHeight > 0 ? pickerHeight : '85vh' }
              }
            >
              {/* 글래스 배경 */}
              <div className="absolute inset-0 overflow-hidden">
                <Image src="/images/home-bg.jpg" alt="" fill className="object-cover" />
              </div>
              <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />

              <div className={`relative z-10 flex flex-col ${isWide ? 'max-h-[70vh]' : 'h-full'}`}>
                {/* 드래그 핸들 (가로모드) */}
                {isWide && (
                  <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 bg-white/40 rounded-full" />
                  </div>
                )}
                {/* 헤더 */}
                <div className="flex items-center justify-between px-4 pt-5 pb-3 border-b border-white/10">
                  <h3 className="text-lg font-bold text-white">프로필 사진</h3>
                  <button onClick={() => setShowProfilePicker(false)} className="p-1">
                    <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* 기본 프로필 */}
                <button
                  onClick={async () => {
                    await updateProfile({ profileRabbitId: null });
                    setShowProfilePicker(false);
                  }}
                  className={`flex items-center gap-3 mx-3 mt-3 p-3 rounded-xl border transition-colors ${
                    profile.profileRabbitId == null
                      ? 'border-white/40 bg-white/15'
                      : 'border-white/15 hover:bg-white/5'
                  }`}
                >
                  <div className="w-10 h-10 flex items-center justify-center bg-white/10 border border-white/20 rounded-lg">
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="rgba(255,255,255,0.6)">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
                    </svg>
                  </div>
                  <span className="text-sm font-bold text-white">기본</span>
                  {profile.profileRabbitId == null && (
                    <span className="ml-auto text-xs text-white/50">선택됨</span>
                  )}
                </button>

                {/* 토끼 그리드 */}
                <div className="flex-1 overflow-y-auto p-3 min-h-0">
                  {!pickerReady ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-6 h-6 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
                    </div>
                  ) : isProfessor ? (
                    <div className={`grid ${isWide ? 'grid-cols-5' : 'grid-cols-3'} gap-2`}>
                      {Array.from({ length: 80 }, (_, i) => i).map(rabbitId => (
                        <button
                          key={rabbitId}
                          onClick={async () => {
                            await updateProfile({ profileRabbitId: rabbitId });
                            setShowProfilePicker(false);
                          }}
                          className={`aspect-square rounded-xl border overflow-hidden transition-all ${
                            profile.profileRabbitId === rabbitId
                              ? 'border-white/50 scale-95 bg-white/20'
                              : 'border-white/15 hover:border-white/30'
                          }`}
                          style={{ contentVisibility: 'auto', containIntrinsicSize: '80px 80px' }}
                        >
                          {rabbitId < visibleCount ? (
                            <img
                              src={getRabbitProfileUrl(rabbitId)}
                              alt={`토끼 #${rabbitId}`}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-white/5" />
                          )}
                        </button>
                      ))}
                    </div>
                  ) : sortedHoldings.length > 0 ? (
                    <div className={`grid ${isWide ? 'grid-cols-5' : 'grid-cols-3'} gap-2`}>
                      {sortedHoldings.map((h, idx) => (
                        <button
                          key={h.id}
                          onClick={async () => {
                            await updateProfile({ profileRabbitId: h.rabbitId });
                            setShowProfilePicker(false);
                          }}
                          className={`aspect-square rounded-xl border overflow-hidden transition-all ${
                            profile.profileRabbitId === h.rabbitId
                              ? 'border-white/50 scale-95 bg-white/20'
                              : 'border-white/15 hover:border-white/30'
                          }`}
                          style={{ contentVisibility: 'auto', containIntrinsicSize: '80px 80px' }}
                        >
                          {idx < visibleCount ? (
                            <img
                              src={getRabbitProfileUrl(h.rabbitId)}
                              alt={`토끼 #${h.rabbitId}`}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-white/5" />
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-sm text-white/60">아직 발견한 토끼가 없어요</p>
                      <p className="text-xs text-white/40 mt-1">퀴즈를 풀어 토끼를 발견해보세요!</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 닉네임 변경 모달 */}
      <AnimatePresence>
        {showNicknameModal && (
          <GlassModal onClose={() => setShowNicknameModal(false)}>
            <h3 className="text-base font-bold text-white mb-3">닉네임 변경</h3>

            {nicknameCooldownDays > 0 && (
              <p className="text-xs text-white/50 mb-2">
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
              placeholder="새 닉네임 (2-6자)"
              maxLength={6}
              disabled={nicknameCooldownDays > 0}
              className={`w-full px-3 py-2 rounded-xl outline-none text-sm bg-white/10 text-white placeholder:text-white/40 disabled:opacity-50 border ${
                nicknameError ? 'border-red-400/50' : 'border-white/15'
              }`}
            />
            {nicknameError && (
              <p className="text-xs mt-1 text-red-300">{nicknameError}</p>
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowNicknameModal(false)}
                className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleNicknameChange}
                disabled={savingNickname || newNickname.length < 2 || newNickname.length > 6 || nicknameCooldownDays > 0}
                className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
              >
                {savingNickname ? '저장 중...' : '변경'}
              </button>
            </div>
          </GlassModal>
        )}
      </AnimatePresence>

      {/* 반 변경 모달 */}
      <AnimatePresence>
        {showClassModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/50"
            style={isWide ? { left: '240px', right: 'calc(50% - 120px)' } : {}}
            onClick={() => setShowClassModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-xs rounded-2xl overflow-hidden p-6"
            >
              <div className="absolute inset-0 rounded-2xl overflow-hidden">
                <Image src="/images/home-bg.jpg" alt="" fill className="object-cover" />
              </div>
              <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />
              <div className="relative z-10">
                <h3 className="text-sm font-bold text-white/70 mb-3">반 변경</h3>
                <div className="grid grid-cols-4 gap-2">
                  {CLASS_OPTIONS.map((cls) => (
                    <button
                      key={cls}
                      onClick={() => setSelectedClass(cls)}
                      className={`py-2 rounded-xl text-sm font-bold text-white transition-colors ${
                        selectedClass === cls
                          ? 'bg-white/30 border border-white/50'
                          : 'bg-white/10 border border-white/15 hover:bg-white/20'
                      }`}
                    >
                      {cls}
                    </button>
                  ))}
                </div>
                <div className="flex gap-3 mt-3">
                  <button
                    onClick={() => setShowClassModal(false)}
                    className="flex-1 py-2.5 rounded-xl font-medium bg-white/15 text-white/70 hover:bg-white/20 transition-colors text-sm"
                  >
                    취소
                  </button>
                  <button
                    onClick={async () => {
                      if (selectedClass && selectedClass !== profile.classType && user?.uid) {
                        await updateDoc(doc(db, 'users', user.uid), {
                          classId: selectedClass,
                          updatedAt: serverTimestamp(),
                        });
                      }
                      setShowClassModal(false);
                    }}
                    disabled={selectedClass === profile.classType}
                    className="flex-1 py-2.5 rounded-xl font-medium bg-white/30 text-white hover:bg-white/40 transition-colors text-sm disabled:opacity-50"
                  >
                    변경
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 복구 이메일 모달 */}
      <RecoveryEmailModal
        isOpen={showRecoveryModal}
        onClose={() => setShowRecoveryModal(false)}
        maskedRecovery={maskedRecovery}
        profile={profile}
      />

      {/* 비밀번호 변경 모달 */}
      <PasswordChangeModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onForgotPassword={() => {
          setShowPasswordModal(false);
          setShowResetModal(true);
        }}
        isProfessor={isProfessor}
      />

      {/* 비밀번호 재설정 모달 (인증코드 → 새 비밀번호) */}
      <PasswordResetModal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        profile={profile}
      />

      {/* 캐시 초기화 확인 모달 */}
      <AnimatePresence>
        {showCacheConfirm && (
          <GlassModal onClose={() => setShowCacheConfirm(false)}>
            <h3 className="text-base font-bold text-white mb-2">캐시 초기화</h3>
            <p className="text-sm text-white/60 mb-2">
              앱 데이터를 초기화합니다. 로그인은 유지됩니다.
            </p>
            <p className="text-xs text-white/40 mb-4">
              작성 중인 임시저장, 추출한 이미지, 복습 폴더 분류/순서가 초기화됩니다.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCacheConfirm(false)}
                className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleClearCache}
                className="flex-1 py-2 rounded-xl text-sm font-medium bg-red-500/30 border border-red-400/30 text-red-200 hover:bg-red-500/40 transition-colors"
              >
                초기화
              </button>
            </div>
          </GlassModal>
        )}
      </AnimatePresence>

      {/* 계정 삭제 확인 모달 */}
      <AccountDeletionDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
      />
    </>
  );

  // ============================================================
  // 패널 모드 — 3쪽 패널 내부에 full-height로 렌더링
  // ============================================================
  if (isPanelMode && isOpen) {
    return (
      <div className="h-full relative overflow-hidden" style={{ backgroundImage: 'url(/images/home-bg-3.jpg)', backgroundSize: '102% 102%', backgroundPosition: 'center' }}>
        {/* 스크롤 영역 */}
        <div ref={sheetRef} className="relative z-10 overflow-y-auto overscroll-contain h-full">
          {drawerContent}
        </div>

        {/* 서브 모달 */}
        {subModals}
      </div>
    );
  }

  // ============================================================
  // 기본 모드 — 바텀시트 (포털/fixed)
  // ============================================================
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 오버레이 — 가로모드에서는 숨김 (홈 배경이 보여야 함) */}
          {!isWide && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={onClose}
            />
          )}

          {/* 바텀시트 */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-0 z-50 max-h-[75vh] rounded-t-2xl overflow-hidden"
            style={isWide
              ? { left: '240px', right: 'calc(50% - 120px)' }
              : { left: 'var(--home-sheet-left, 0px)', right: '0' }
            }
          >
            {/* 글래스 배경 레이어 — pointer-events-none으로 클릭 관통 */}
            <div className="absolute inset-0 rounded-t-2xl overflow-hidden pointer-events-none">
              <Image src="/images/home-bg.jpg" alt="" fill className="object-cover" />
            </div>
            <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl pointer-events-none" />

            {/* 스크롤 영역 — safe area 패딩 내부 적용 */}
            <div ref={sheetRef} className="relative z-10 overflow-y-auto overscroll-contain max-h-[75vh]" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
              {/* 드래그 핸들 */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 bg-white/40 rounded-full" />
              </div>

              {drawerContent}
            </div>
          </motion.div>

          {/* 서브 모달 */}
          {subModals}
        </>
      )}
    </AnimatePresence>
  );
}

// ============================================================
// 퀴즈 답안 마이그레이션 버튼 (교수 전용, 1회성)
// ============================================================

function MigrateAnswerIndexButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const calledRef = useRef(false);

  const handleMigrate = async () => {
    if (calledRef.current || loading) return;
    calledRef.current = true;
    setLoading(true);
    try {
      const res = await callFunction('migrateQuizAnswersTo0Indexed');
      const { migrated, skipped, errors } = res;
      setResult({
        message: `${migrated}개 변환, ${skipped}개 건너뜀${errors > 0 ? `, ${errors}개 오류` : ''}`,
        ok: errors === 0,
      });
    } catch (err: unknown) {
      setResult({ message: (err as Error)?.message || '실패', ok: false });
      calledRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-6">
      <h3 className="text-sm font-bold text-white/70 mb-3">
        Data Migration
      </h3>
      <button
        onClick={handleMigrate}
        disabled={loading || calledRef.current}
        className="w-full flex items-center justify-between py-2.5 disabled:opacity-50"
      >
        <div className="text-left">
          <span className="text-sm text-white/80">퀴즈 답안 마이그레이션</span>
          <p className="text-xs text-white/40">기존 퀴즈 답안 인덱싱 보정 (1회만)</p>
        </div>
        <span className="text-xs font-medium text-white/60 px-2.5 py-1 rounded-lg bg-white/10">
          {loading ? '실행 중...' : calledRef.current ? '완료' : '실행'}
        </span>
      </button>
      {result && (
        <p className={`text-xs mt-1 ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
