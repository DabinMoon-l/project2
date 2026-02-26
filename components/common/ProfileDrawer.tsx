'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
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
  Timestamp,
} from 'firebase/firestore';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUser } from '@/lib/contexts/UserContext';
import { useCourse } from '@/lib/contexts';
import { useRabbitHoldings } from '@/lib/hooks/useRabbit';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import {
  useSettings,
  type NotificationSettings,
  DEFAULT_SETTINGS,
} from '@/lib/hooks/useSettings';
import { calculateMilestoneInfo } from '@/components/home/StatsCard';
import { auth, db, functions } from '@/lib/firebase';

// ============================================================
// 상수 (컴포넌트 외부 — 렌더마다 재생성 방지)
// ============================================================

const ADMIN_STUDENT_ID = '25010423';

const NOTIFICATION_ITEMS: { key: keyof NotificationSettings; label: string; desc: string }[] = [
  { key: 'announcement', label: '공지 알림', desc: '교수님 공지사항' },
  { key: 'boardComment', label: '댓글 알림', desc: '내 게시글 댓글' },
  { key: 'newQuiz', label: '퀴즈 알림', desc: '새 퀴즈 등록' },
];

const CLASS_OPTIONS = ['A', 'B', 'C', 'D'] as const;

// 이메일 마스킹
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${local[1]}***@${domain}`;
}

interface Inquiry {
  id: string;
  authorUid: string;
  message: string;
  createdAt: Timestamp | null;
  courseId: string;
  isRead: boolean;
}

// 글래스 토글 스위치 (컴포넌트 외부 정의 — 리렌더 시 재생성 방지)
function ToggleSwitch({
  checked,
  onChange,
  animated,
}: {
  checked: boolean;
  onChange: () => void;
  animated: boolean;
}) {
  return (
    <button
      onClick={onChange}
      className={`w-12 h-7 relative rounded-full transition-colors ${
        checked ? 'bg-white/40' : 'bg-white/15'
      }`}
    >
      <motion.div
        className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm"
        initial={false}
        animate={{ left: checked ? 24 : 4 }}
        transition={animated ? { type: 'spring', stiffness: 500, damping: 30 } : { duration: 0 }}
      />
    </button>
  );
}

// 글래스 모달 래퍼 (컴포넌트 외부 정의 — 리렌더 시 재생성 방지)
function GlassModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/50"
      onClick={onClose}
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
        <div className="relative z-10">{children}</div>
      </motion.div>
    </motion.div>
  );
}

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 글래스모피즘 프로필/설정 바텀시트
 */
export default function ProfileDrawer({ isOpen, onClose }: ProfileDrawerProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { profile, updateNickname, updateProfile, isProfessor } = useUser();
  const { userCourseId } = useCourse();
  const { holdings } = useRabbitHoldings(user?.uid);
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

  // Account 섹션 상태
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [savingRecovery, setSavingRecovery] = useState(false);
  const [passwordVerified, setPasswordVerified] = useState(false);

  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [resetCodeSent, setResetCodeSent] = useState(false);
  const [resetCodeVerified, setResetCodeVerified] = useState(false);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const [resetMaskedEmail, setResetMaskedEmail] = useState('');

  const [showCacheConfirm, setShowCacheConfirm] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

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

  // 모달 열림 시 네비게이션 숨김 + body 스크롤 방지 (통합)
  useEffect(() => {
    if (!isOpen) {
      document.body.removeAttribute('data-hide-nav');
      document.body.style.overflow = '';
      return;
    }
    document.body.setAttribute('data-hide-nav', '');
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.removeAttribute('data-hide-nav');
      document.body.style.overflow = '';
    };
  }, [isOpen]);

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

  // 비밀번호 확인 후 이메일 인증 진행
  const handleRecoveryPasswordCheck = useCallback(async () => {
    if (!auth.currentUser?.email || !recoveryPassword) return;
    setSavingRecovery(true);
    setRecoveryMessage('');
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, recoveryPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      setPasswordVerified(true);
      setRecoveryMessage('');
    } catch {
      setRecoveryMessage('비밀번호가 올바르지 않습니다.');
    } finally {
      setSavingRecovery(false);
    }
  }, [recoveryPassword]);

  // 복구 이메일 인증 코드 전송
  const handleSendVerification = useCallback(async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recoveryEmail)) {
      setRecoveryMessage('유효하지 않은 이메일 형식입니다.');
      return;
    }
    setSavingRecovery(true);
    setRecoveryMessage('');
    try {
      const updateFn = httpsCallable<
        { recoveryEmail: string },
        { needsVerification?: boolean; success?: boolean; maskedEmail: string }
      >(functions, 'updateRecoveryEmail');
      const result = await updateFn({ recoveryEmail });
      if (result.data.needsVerification) {
        setVerificationSent(true);
        setRecoveryMessage('');
      }
    } catch {
      setRecoveryMessage('인증 코드 전송에 실패했습니다.');
    } finally {
      setSavingRecovery(false);
    }
  }, [recoveryEmail]);

  // 복구 이메일 인증 코드 확인
  const handleVerifyCode = useCallback(async () => {
    setVerifyingCode(true);
    setRecoveryMessage('');
    try {
      const updateFn = httpsCallable<
        { recoveryEmail: string; verificationCode: string },
        { success: boolean; maskedEmail: string }
      >(functions, 'updateRecoveryEmail');
      await updateFn({ recoveryEmail, verificationCode });
      setRecoveryMessage('복구 이메일이 등록되었습니다.');
      setTimeout(() => {
        setShowRecoveryModal(false);
        setRecoveryEmail('');
        setRecoveryMessage('');
        setVerificationSent(false);
        setVerificationCode('');
      }, 1200);
    } catch {
      setRecoveryMessage('인증 코드가 올바르지 않습니다.');
    } finally {
      setVerifyingCode(false);
    }
  }, [recoveryEmail, verificationCode]);

  // 비밀번호 변경
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
      const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, newPassword);
      setPasswordError('');
      setShowPasswordModal(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
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
  }, [currentPassword, newPassword, confirmPassword]);

  // 비밀번호 찾기 모달 열기 + 인증 코드 전송
  const handleOpenResetModal = useCallback(async () => {
    setShowPasswordModal(false);
    setShowResetModal(true);
    setResetCode('');
    setResetCodeSent(false);
    setResetCodeVerified(false);
    setResetNewPassword('');
    setResetConfirmPassword('');
    setResetMessage('');
    setResetMaskedEmail('');
    setResetLoading(true);
    try {
      const resetFn = httpsCallable<
        Record<string, never>,
        { success: boolean; codeSent?: boolean; hasRecoveryEmail: boolean; maskedEmail?: string; message: string }
      >(functions, 'requestPasswordReset');
      const result = await resetFn({});
      if (result.data.codeSent) {
        setResetCodeSent(true);
        setResetMaskedEmail(result.data.maskedEmail || '');
      } else {
        setResetMessage(result.data.message);
      }
    } catch {
      setResetMessage('인증 코드 전송에 실패했습니다.');
    } finally {
      setResetLoading(false);
    }
  }, []);

  // 비밀번호 찾기 — 인증 코드 확인
  const handleVerifyResetCode = useCallback(async () => {
    if (resetCode.length !== 6) return;
    setResetCodeVerified(true);
    setResetMessage('');
  }, [resetCode]);

  // 비밀번호 찾기 — 새 비밀번호 저장
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
      const resetFn = httpsCallable<
        { verificationCode: string; newPassword: string },
        { success: boolean; message: string }
      >(functions, 'requestPasswordReset');
      const result = await resetFn({ verificationCode: resetCode, newPassword: resetNewPassword });
      setResetMessage(result.data.message);
      setTimeout(() => {
        setShowResetModal(false);
      }, 1200);
    } catch {
      setResetMessage('비밀번호 변경에 실패했습니다. 인증 코드를 확인해주세요.');
      setResetCodeVerified(false);
    } finally {
      setResetLoading(false);
    }
  }, [resetCode, resetNewPassword, resetConfirmPassword]);

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

  // 계정 삭제
  const handleDeleteAccount = useCallback(async () => {
    if (deleteInput !== '삭제') return;
    setDeletingAccount(true);
    try {
      const deleteFn = httpsCallable<void, { success: boolean }>(functions, 'deleteStudentAccount');
      await deleteFn();
      onClose();
      router.replace('/login');
    } catch (err) {
      console.error('계정 삭제 실패:', err);
      setDeletingAccount(false);
    }
  }, [deleteInput, onClose, router]);

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
      const resetStudentPasswordFn = httpsCallable<
        { studentId: string; courseId: string; newPassword: string },
        { success: boolean; message: string }
      >(functions, 'resetStudentPassword');
      const res = await resetStudentPasswordFn({
        studentId: adminResetStudentId,
        courseId: userCourseId,
        newPassword: adminResetPassword,
      });
      setAdminResetResult({ message: res.data.message, type: 'success' });
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
            <div ref={sheetRef} className="relative z-10 overflow-y-auto overscroll-contain max-h-[85vh]">
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
              <div className="px-5 py-6">
                {/* 알림 설정 (학생만) */}
                {!isProfessor && (
                  <div className="mb-8">
                    <h3 className="text-lg font-bold text-white mb-4">
                      Notifications
                    </h3>
                    <div className="space-y-4">
                      {NOTIFICATION_ITEMS.map((item) => (
                        <div key={item.key} className="flex items-center justify-between">
                          <div>
                            <span className="text-base text-white/80">
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
                <div className="mb-8">
                  <h3 className="text-lg font-bold text-white mb-4">
                    Account
                  </h3>
                  <div className="space-y-3">
                    {/* 복구 이메일 (학생만) */}
                    {!isProfessor && (
                      <button
                        onClick={() => {
                          setRecoveryEmail('');
                          setRecoveryPassword('');
                          setRecoveryMessage('');
                          setPasswordVerified(!profile.recoveryEmail);
                          setVerificationSent(false);
                          setVerificationCode('');
                          setShowRecoveryModal(true);
                        }}
                        className="w-full flex items-center justify-between py-2.5"
                      >
                        <div className="text-left">
                          <span className="text-base text-white/80">복구 이메일</span>
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
                      onClick={() => {
                        setCurrentPassword('');
                        setNewPassword('');
                        setConfirmPassword('');
                        setPasswordError('');
                        setResetMessage('');
                        setShowPasswordModal(true);
                      }}
                      className="w-full flex items-center justify-between py-2.5"
                    >
                      <span className="text-base text-white/80">비밀번호 변경</span>
                      <svg className="w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Support 섹션 */}
                <div className="mb-8">
                  <h3 className="text-lg font-bold text-white mb-4">
                    Support
                  </h3>
                  <div className="space-y-3">
                    {/* 캐시 초기화 */}
                    <button
                      onClick={() => setShowCacheConfirm(true)}
                      className="w-full flex items-center justify-between py-2.5"
                    >
                      <div className="text-left">
                        <span className="text-base text-white/80">캐시 초기화</span>
                        <p className="text-xs text-white/40">앱 데이터 초기화</p>
                      </div>
                      <svg className="w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>

                    {/* 문의하기 / 문의 확인 */}
                    {isAdmin ? (
                      <button
                        onClick={() => setShowInquiryList(prev => !prev)}
                        className="w-full flex items-center justify-between py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base text-white/80">문의 확인</span>
                          {unreadCount > 0 && (
                            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-500 text-white rounded-full min-w-[18px] text-center">
                              {unreadCount}
                            </span>
                          )}
                        </div>
                        <svg
                          className={`w-4 h-4 text-white/30 transition-transform ${showInquiryList ? 'rotate-90' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setInquiryMessage('');
                          setInquirySent(false);
                          setShowInquiryModal(true);
                        }}
                        className="w-full flex items-center justify-between py-2.5"
                      >
                        <span className="text-base text-white/80">문의하기</span>
                        <svg className="w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    )}

                    {/* 관리자 문의 목록 (인라인 Accordion) */}
                    <AnimatePresence>
                      {isAdmin && showInquiryList && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="max-h-[180px] overflow-y-auto rounded-xl bg-black/20 border border-white/10">
                            {inquiries.length === 0 ? (
                              <p className="text-center text-sm text-white/40 py-6">문의가 없습니다</p>
                            ) : (
                              inquiries.map((inq, idx) => (
                                <div
                                  key={inq.id}
                                  onClick={() => !inq.isRead && handleMarkRead(inq.id)}
                                  className={`w-full text-left px-3 py-2.5 border-b border-white/5 last:border-b-0 transition-colors cursor-pointer ${
                                    !inq.isRead ? 'bg-white/5' : ''
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    {!inq.isRead && (
                                      <span className="w-1.5 h-1.5 bg-red-400 rounded-full flex-shrink-0" />
                                    )}
                                    <span className="text-xs font-medium text-white/70">
                                      익명 #{(idx + 1).toString().padStart(2, '0')}
                                    </span>
                                    <span className="ml-auto text-[10px] text-white/20">
                                      {inq.createdAt
                                        ? new Date(inq.createdAt.toDate()).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                        : ''
                                      }
                                    </span>
                                  </div>
                                  <div className="flex items-end justify-between gap-2">
                                    <p className="text-sm text-white/60 line-clamp-2 flex-1">
                                      {inq.message}
                                    </p>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteDoc(doc(db, 'inquiries', inq.id));
                                      }}
                                      className="flex-shrink-0 p-1 text-white/20 hover:text-red-400 transition-colors"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* 관리자 비밀번호 초기화 */}
                    {isAdmin && (
                      <>
                        <div className="border-t border-white/5 my-1" />
                        <button
                          onClick={() => setShowPasswordReset(prev => !prev)}
                          className="w-full flex items-center justify-between py-2.5"
                        >
                          <span className="text-base text-white/80">비밀번호 초기화</span>
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
                  className="w-full py-3 rounded-xl text-center font-medium transition-colors bg-red-500/20 border border-red-400/30 text-red-300 hover:bg-red-500/30 disabled:opacity-50"
                >
                  {loggingOut ? '로그아웃 중...' : '로그아웃'}
                </button>

                {/* 계정 삭제 (학생만) */}
                {!isProfessor && (
                  <button
                    onClick={() => {
                      setDeleteInput('');
                      setShowDeleteConfirm(true);
                    }}
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
            </div>
          </motion.div>

          {/* 프로필 사진 선택 드로어 (좌측 슬라이드) */}
          <AnimatePresence>
            {showProfilePicker && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[60] bg-black/50"
                  onClick={() => setShowProfilePicker(false)}
                />
                <motion.div
                  initial={{ x: '-100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '-100%' }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  className="fixed left-0 bottom-0 z-[60] w-72 rounded-tr-2xl overflow-hidden"
                  style={{ height: pickerHeight > 0 ? pickerHeight : '85vh' }}
                >
                  {/* 글래스 배경 */}
                  <div className="absolute inset-0 overflow-hidden">
                    <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />

                  <div className="relative z-10 h-full flex flex-col">
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
                    <div className="flex-1 overflow-y-auto p-3">
                      {!pickerReady ? (
                        <div className="flex items-center justify-center py-12">
                          <div className="w-6 h-6 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
                        </div>
                      ) : isProfessor ? (
                        <div className="grid grid-cols-3 gap-2">
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
                        <div className="grid grid-cols-3 gap-2">
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
                  placeholder="새 닉네임 (2-6자)"
                  maxLength={6}
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
                    disabled={savingNickname || newNickname.length < 2 || newNickname.length > 6 || nicknameCooldownDays > 0}
                    className="flex-1 py-3 rounded-xl font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
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
                    <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />
                  <div className="relative z-10">
                    <h3 className="text-lg font-bold text-white mb-4">반 변경</h3>
                    <div className="grid grid-cols-4 gap-2">
                      {CLASS_OPTIONS.map((cls) => (
                        <button
                          key={cls}
                          onClick={() => setSelectedClass(cls)}
                          className={`py-3 rounded-xl font-bold text-white transition-colors ${
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
          <AnimatePresence>
            {showRecoveryModal && (
              <GlassModal onClose={() => {
                setShowRecoveryModal(false);
                setPasswordVerified(false);
                setVerificationSent(false);
                setVerificationCode('');
                setRecoveryPassword('');
                setRecoveryMessage('');
              }}>
                <h3 className="text-lg font-bold text-white mb-1">복구 이메일</h3>
                <p className="text-xs text-white/40 mb-4">비밀번호 찾기에 사용됩니다</p>

                {!passwordVerified ? (
                  <>
                    <p className="text-sm text-white/50 mb-3">
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
                      className="w-full px-4 py-3 rounded-xl outline-none bg-white/10 text-white placeholder:text-white/40 border border-white/15"
                    />
                  </>
                ) : (
                  <>
                    {maskedRecovery && !verificationSent && (
                      <p className="text-sm text-white/50 mb-3">
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
                      className="w-full px-4 py-3 rounded-xl outline-none bg-white/10 text-white placeholder:text-white/40 border border-white/15 disabled:opacity-50"
                    />

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
                          className="w-full px-4 py-3 rounded-xl outline-none bg-white/10 text-white placeholder:text-white/40 border border-white/15 text-center tracking-[0.3em] text-lg"
                        />
                      </div>
                    )}
                  </>
                )}

                {recoveryMessage && (
                  <p className={`text-xs mt-2 ${recoveryMessage.includes('등록') ? 'text-green-300' : 'text-red-300'}`}>
                    {recoveryMessage}
                  </p>
                )}

                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => {
                      setShowRecoveryModal(false);
                      setPasswordVerified(false);
                      setVerificationSent(false);
                      setVerificationCode('');
                      setRecoveryPassword('');
                      setRecoveryMessage('');
                    }}
                    className="flex-1 py-3 rounded-xl font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
                  >
                    취소
                  </button>
                  {!passwordVerified ? (
                    <button
                      onClick={handleRecoveryPasswordCheck}
                      disabled={savingRecovery || !recoveryPassword}
                      className="flex-1 py-3 rounded-xl font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
                    >
                      {savingRecovery ? '확인 중...' : '확인'}
                    </button>
                  ) : verificationSent ? (
                    <button
                      onClick={handleVerifyCode}
                      disabled={verifyingCode || verificationCode.length !== 6}
                      className="flex-1 py-3 rounded-xl font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
                    >
                      {verifyingCode ? '확인 중...' : '인증 완료'}
                    </button>
                  ) : (
                    <button
                      onClick={handleSendVerification}
                      disabled={savingRecovery || !recoveryEmail}
                      className="flex-1 py-3 rounded-xl font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
                    >
                      {savingRecovery ? '전송 중...' : '인증 코드 전송'}
                    </button>
                  )}
                </div>
              </GlassModal>
            )}
          </AnimatePresence>

          {/* 비밀번호 변경 모달 */}
          <AnimatePresence>
            {showPasswordModal && (
              <GlassModal onClose={() => setShowPasswordModal(false)}>
                <h3 className="text-lg font-bold text-white mb-4">비밀번호 변경</h3>

                <div className="space-y-3">
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => {
                      setCurrentPassword(e.target.value);
                      setPasswordError('');
                    }}
                    placeholder="현재 비밀번호"
                    className="w-full px-4 py-3 rounded-xl outline-none bg-white/10 text-white placeholder:text-white/40 border border-white/15"
                  />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setPasswordError('');
                    }}
                    placeholder="새 비밀번호 (6자 이상)"
                    className="w-full px-4 py-3 rounded-xl outline-none bg-white/10 text-white placeholder:text-white/40 border border-white/15"
                  />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setPasswordError('');
                    }}
                    placeholder="새 비밀번호 확인"
                    className="w-full px-4 py-3 rounded-xl outline-none bg-white/10 text-white placeholder:text-white/40 border border-white/15"
                  />
                </div>
                {passwordError && (
                  <p className="text-xs mt-2 text-red-300">{passwordError}</p>
                )}
                {!isProfessor && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={handleOpenResetModal}
                      className="text-xs text-white/40 hover:text-white/60 transition-colors"
                    >
                      비밀번호를 잊으셨나요?
                    </button>
                  </div>
                )}
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => setShowPasswordModal(false)}
                    className="flex-1 py-3 rounded-xl font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handlePasswordChange}
                    disabled={savingPassword || !currentPassword || newPassword.length < 6}
                    className="flex-1 py-3 rounded-xl font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
                  >
                    {savingPassword ? '변경 중...' : '변경'}
                  </button>
                </div>
              </GlassModal>
            )}
          </AnimatePresence>

          {/* 비밀번호 재설정 모달 (인증코드 → 새 비밀번호) */}
          <AnimatePresence>
            {showResetModal && (
              <GlassModal onClose={() => setShowResetModal(false)}>
                <h3 className="text-lg font-bold text-white mb-1">비밀번호 재설정</h3>

                {resetLoading && !resetCodeSent && (
                  <div className="flex items-center gap-2 py-6 justify-center">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
                    <span className="text-sm text-white/50">인증 코드 전송 중...</span>
                  </div>
                )}

                {!resetCodeSent && !resetLoading && (
                  <p className="text-sm text-white/50 py-4">{resetMessage || '복구 이메일이 필요합니다.'}</p>
                )}

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
                      className="w-full px-4 py-3 rounded-xl outline-none bg-white/10 text-white placeholder:text-white/40 border border-white/15 text-center tracking-[0.3em] text-lg"
                    />
                  </>
                )}

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
                        className="w-full px-4 py-3 rounded-xl outline-none bg-white/10 text-white placeholder:text-white/40 border border-white/15"
                      />
                      <input
                        type="password"
                        value={resetConfirmPassword}
                        onChange={(e) => {
                          setResetConfirmPassword(e.target.value);
                          setResetMessage('');
                        }}
                        placeholder="새 비밀번호 확인"
                        className="w-full px-4 py-3 rounded-xl outline-none bg-white/10 text-white placeholder:text-white/40 border border-white/15"
                      />
                    </div>
                  </>
                )}

                {resetMessage && (
                  <p className={`text-xs mt-2 ${resetMessage.includes('변경되었') ? 'text-green-300' : 'text-red-300'}`}>
                    {resetMessage}
                  </p>
                )}

                {(resetCodeSent || (!resetLoading && !resetCodeSent)) && (
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={() => setShowResetModal(false)}
                      className="flex-1 py-3 rounded-xl font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
                    >
                      취소
                    </button>
                    {resetCodeSent && !resetCodeVerified && (
                      <button
                        onClick={handleVerifyResetCode}
                        disabled={resetCode.length !== 6}
                        className="flex-1 py-3 rounded-xl font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
                      >
                        확인
                      </button>
                    )}
                    {resetCodeVerified && (
                      <button
                        onClick={handleResetNewPassword}
                        disabled={resetLoading || resetNewPassword.length < 6}
                        className="flex-1 py-3 rounded-xl font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
                      >
                        {resetLoading ? '변경 중...' : '변경'}
                      </button>
                    )}
                  </div>
                )}
              </GlassModal>
            )}
          </AnimatePresence>

          {/* 캐시 초기화 확인 모달 */}
          <AnimatePresence>
            {showCacheConfirm && (
              <GlassModal onClose={() => setShowCacheConfirm(false)}>
                <h3 className="text-lg font-bold text-white mb-2">캐시 초기화</h3>
                <p className="text-sm text-white/60 mb-2">
                  앱 데이터를 초기화합니다. 로그인은 유지됩니다.
                </p>
                <p className="text-xs text-white/40 mb-4">
                  작성 중인 임시저장, 추출한 이미지, 복습 폴더 분류/순서가 초기화됩니다.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowCacheConfirm(false)}
                    className="flex-1 py-3 rounded-xl font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleClearCache}
                    className="flex-1 py-3 rounded-xl font-medium bg-red-500/30 border border-red-400/30 text-red-200 hover:bg-red-500/40 transition-colors"
                  >
                    초기화
                  </button>
                </div>
              </GlassModal>
            )}
          </AnimatePresence>

          {/* 문의하기 모달 */}
          <AnimatePresence>
            {showInquiryModal && (
              <GlassModal onClose={() => setShowInquiryModal(false)}>
                {inquirySent ? (
                  <div className="text-center py-4">
                    <p className="text-lg font-bold text-white mb-1">전송 완료</p>
                    <p className="text-sm text-white/50">문의가 접수되었습니다.</p>
                  </div>
                ) : (
                  <>
                    <h3 className="text-lg font-bold text-white mb-1">문의하기</h3>
                    <p className="text-xs text-white/40 mb-4">개발자에게 익명으로 전달됩니다</p>
                    <textarea
                      value={inquiryMessage}
                      onChange={(e) => setInquiryMessage(e.target.value)}
                      placeholder="문의 내용을 입력하세요"
                      rows={4}
                      maxLength={500}
                      className="w-full px-4 py-3 rounded-xl outline-none bg-white/10 text-white placeholder:text-white/40 border border-white/15 resize-none"
                    />
                    <div className="flex gap-3 mt-4">
                      <button
                        onClick={() => setShowInquiryModal(false)}
                        className="flex-1 py-3 rounded-xl font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
                      >
                        취소
                      </button>
                      <button
                        onClick={handleSendInquiry}
                        disabled={sendingInquiry || !inquiryMessage.trim()}
                        className="flex-1 py-3 rounded-xl font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
                      >
                        {sendingInquiry ? '전송 중...' : '전송'}
                      </button>
                    </div>
                  </>
                )}
              </GlassModal>
            )}
          </AnimatePresence>

          {/* 계정 삭제 확인 모달 */}
          <AnimatePresence>
            {showDeleteConfirm && (
              <GlassModal onClose={() => setShowDeleteConfirm(false)}>
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
                    className="w-full px-4 py-3 rounded-xl outline-none bg-white/10 text-white placeholder:text-white/40 border border-red-400/30"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-3 rounded-xl font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deletingAccount || deleteInput !== '삭제'}
                    className="flex-1 py-3 rounded-xl font-medium bg-red-500/30 border border-red-400/30 text-red-200 hover:bg-red-500/40 transition-colors disabled:opacity-50"
                  >
                    {deletingAccount ? '삭제 중...' : '계정 삭제'}
                  </button>
                </div>
              </GlassModal>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
}
