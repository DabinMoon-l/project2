/**
 * 알림 프로바이더 컴포넌트
 *
 * 앱 전체에서 푸시 알림을 관리하는 Context Provider입니다.
 * 포그라운드 알림을 토스트 형태로 표시하고,
 * 알림 권한 요청 모달을 제공합니다.
 */

'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useNotification, PermissionStatus } from '@/lib/hooks/useNotification';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUser } from '@/lib/contexts';
import { NotificationMessage } from '@/lib/fcm';
import { useTheme } from '@/styles/themes/useTheme';

// ============================================================
// 타입 정의
// ============================================================

interface NotificationContextType {
  // 상태
  permissionStatus: PermissionStatus;
  isSubscribed: boolean;
  loading: boolean;
  // 액션
  requestPermission: () => Promise<boolean>;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<void>;
}

// ============================================================
// Context
// ============================================================

const NotificationContext = createContext<NotificationContextType | null>(null);

/**
 * NotificationContext 사용 훅
 */
export function useNotificationContext(): NotificationContextType {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotificationContext는 NotificationProvider 내에서 사용해야 합니다.');
  }
  return context;
}

// ============================================================
// 알림 토스트 컴포넌트
// ============================================================

interface NotificationToastProps {
  notification: NotificationMessage;
  onClose: () => void;
  onClick: () => void;
}

function NotificationToast({ notification, onClose, onClick }: NotificationToastProps) {
  const { theme } = useTheme();

  // 5초 후 자동 닫힘
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -50, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      className="fixed top-4 left-4 right-4 z-50 mx-auto max-w-sm"
    >
      <div
        className="rounded-2xl p-4 shadow-lg cursor-pointer"
        style={{
          backgroundColor: theme.colors.backgroundSecondary,
          border: `1px solid ${theme.colors.border}`,
        }}
        onClick={onClick}
        role="alert"
      >
        <div className="flex items-start gap-3">
          {/* 아이콘 */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${theme.colors.accent}20` }}
          >
            <span className="text-xl">🔔</span>
          </div>

          {/* 내용 */}
          <div className="flex-1 min-w-0">
            <h4
              className="font-bold text-sm truncate"
              style={{ color: theme.colors.text }}
            >
              {notification.title}
            </h4>
            <p
              className="text-xs mt-0.5 line-clamp-2"
              style={{ color: theme.colors.textSecondary }}
            >
              {notification.body}
            </p>
          </div>

          {/* 닫기 버튼 */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="p-1 rounded-full hover:bg-black/5"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke={theme.colors.textSecondary}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================
// Provider 컴포넌트
// ============================================================

interface NotificationProviderProps {
  children: ReactNode;
}

/**
 * 알림 프로바이더 컴포넌트
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * <NotificationProvider>
 *   {children}
 * </NotificationProvider>
 *
 * // 컴포넌트에서 사용
 * const { subscribe, permissionStatus } = useNotificationContext();
 * ```
 */
export function NotificationProvider({ children }: NotificationProviderProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useUser();
  const {
    permissionStatus,
    isSubscribed,
    loading,
    lastNotification,
    requestPermission,
    subscribeToNotifications,
    unsubscribeFromNotifications,
    clearLastNotification,
  } = useNotification();

  // 토스트 표시 상태
  const [showToast, setShowToast] = useState(false);

  // 학생 자동 알림 활성화: 권한이 default(미요청)이면 브라우저 권한 자동 요청
  useEffect(() => {
    if (
      permissionStatus === 'default' &&
      user?.uid &&
      profile?.role !== 'professor' &&
      !loading
    ) {
      requestPermission().then(granted => {
        if (granted) {
          subscribeToNotifications(user.uid).catch(() => {});
        }
      });
    }
  }, [permissionStatus, user?.uid, profile?.role, loading, requestPermission, subscribeToNotifications]);

  // 자동 구독: 이미 알림 권한이 granted인 상태에서 앱 시작 시 자동 FCM 토큰 발급 + Firestore 저장
  useEffect(() => {
    if (permissionStatus === 'granted' && user?.uid && !isSubscribed && !loading) {
      subscribeToNotifications(user.uid).catch(() => {
        // 자동 구독 실패 시 무시 (필수 아님)
      });
    }
  }, [permissionStatus, user?.uid, isSubscribed, loading, subscribeToNotifications]);

  /**
   * 알림 권한 요청 및 구독
   */
  const handleRequestPermission = useCallback(async (): Promise<boolean> => {
    const granted = await requestPermission();
    if (granted && user?.uid) {
      await subscribeToNotifications(user.uid);
    }
    return granted;
  }, [requestPermission, subscribeToNotifications, user?.uid]);

  /**
   * 알림 구독
   */
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!user?.uid) {
      return false;
    }
    return subscribeToNotifications(user.uid);
  }, [subscribeToNotifications, user?.uid]);

  /**
   * 알림 구독 해제
   */
  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!user?.uid) {
      return;
    }
    await unsubscribeFromNotifications(user.uid);
  }, [unsubscribeFromNotifications, user?.uid]);

  /**
   * 새 알림 수신 시 토스트 표시
   */
  useEffect(() => {
    if (lastNotification) {
      setShowToast(true);
    }
  }, [lastNotification]);

  /**
   * 알림 토스트 클릭 핸들러
   */
  const handleToastClick = useCallback(() => {
    if (lastNotification?.data) {
      const data = lastNotification.data;

      // 알림 타입에 따라 라우팅
      switch (data.type) {
        case 'new_quiz':
        case 'quiz_reminder':
          if (data.quizId) {
            router.push(`/quiz/${data.quizId}`);
          } else {
            router.push('/quiz');
          }
          break;
        case 'feedback_reply':
          if (data.quizId) {
            router.push(`/quiz/${data.quizId}/feedback`);
          }
          break;
        case 'board_comment':
        case 'board_reply':
          if (data.postId) {
            router.push(`/board/post/${data.postId}`);
          } else {
            router.push('/board');
          }
          break;
        case 'announcement':
          router.push('/');
          break;
        default:
          break;
      }
    }

    setShowToast(false);
    clearLastNotification();
  }, [lastNotification, router, clearLastNotification]);

  /**
   * 토스트 닫기
   */
  const handleToastClose = useCallback(() => {
    setShowToast(false);
    clearLastNotification();
  }, [clearLastNotification]);

  // Context 값 메모이제이션 (불필요한 소비자 리렌더 방지)
  const contextValue = useMemo<NotificationContextType>(() => ({
    permissionStatus,
    isSubscribed,
    loading,
    requestPermission: handleRequestPermission,
    subscribe,
    unsubscribe,
  }), [permissionStatus, isSubscribed, loading, handleRequestPermission, subscribe, unsubscribe]);

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}

      {/* 알림 토스트 */}
      <AnimatePresence>
        {showToast && lastNotification && (
          <NotificationToast
            notification={lastNotification}
            onClose={handleToastClose}
            onClick={handleToastClick}
          />
        )}
      </AnimatePresence>
    </NotificationContext.Provider>
  );
}

export default NotificationProvider;
