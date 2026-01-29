/**
 * 푸시 알림 관리 커스텀 훅
 *
 * FCM 푸시 알림 권한 요청, 토큰 관리, 알림 구독을 처리합니다.
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  getNotificationPermission,
  requestNotificationPermission,
  registerServiceWorker,
  getFCMToken,
  onForegroundMessage,
  NotificationMessage,
  NOTIFICATION_TOPICS,
} from '../fcm';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 알림 권한 상태
 */
export type PermissionStatus = 'granted' | 'denied' | 'default' | 'unsupported' | 'loading';

/**
 * 토큰 저장 데이터
 */
interface TokenData {
  token: string;
  uid: string;
  createdAt: ReturnType<typeof serverTimestamp>;
  updatedAt: ReturnType<typeof serverTimestamp>;
  deviceInfo: {
    userAgent: string;
    platform: string;
    language: string;
  };
  topics: string[];
}

/**
 * useNotification 반환 타입
 */
interface UseNotificationReturn {
  // 상태
  permissionStatus: PermissionStatus;
  fcmToken: string | null;
  isSubscribed: boolean;
  loading: boolean;
  error: string | null;
  // 최근 알림
  lastNotification: NotificationMessage | null;
  // 액션
  requestPermission: () => Promise<boolean>;
  subscribeToNotifications: (uid: string) => Promise<boolean>;
  unsubscribeFromNotifications: (uid: string) => Promise<void>;
  subscribeToTopic: (uid: string, topic: string) => Promise<void>;
  unsubscribeFromTopic: (uid: string, topic: string) => Promise<void>;
  clearError: () => void;
  clearLastNotification: () => void;
}

// ============================================================
// useNotification 훅
// ============================================================

/**
 * 푸시 알림 관리 커스텀 훅
 *
 * @example
 * ```tsx
 * const { permissionStatus, requestPermission, subscribeToNotifications } = useNotification();
 *
 * // 알림 권한 요청
 * const granted = await requestPermission();
 *
 * // 알림 구독
 * if (granted && user) {
 *   await subscribeToNotifications(user.uid);
 * }
 * ```
 */
export function useNotification(): UseNotificationReturn {
  // 상태
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('loading');
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastNotification, setLastNotification] = useState<NotificationMessage | null>(null);

  // 서비스 워커 등록 참조
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  // 메시지 구독 해제 함수
  const unsubscribeMessageRef = useRef<(() => void) | null>(null);

  /**
   * 초기 권한 상태 확인
   */
  useEffect(() => {
    const status = getNotificationPermission();
    setPermissionStatus(status);
  }, []);

  /**
   * 포그라운드 메시지 핸들러 등록
   */
  useEffect(() => {
    if (permissionStatus === 'granted' && fcmToken) {
      unsubscribeMessageRef.current = onForegroundMessage((message) => {
        console.log('포그라운드 알림 수신:', message);
        setLastNotification(message);

        // 브라우저 알림 표시 (선택적)
        if (typeof window !== 'undefined' && 'Notification' in window) {
          new Notification(message.title, {
            body: message.body,
            icon: message.icon || '/icons/icon-192x192.png',
          });
        }
      });
    }

    return () => {
      if (unsubscribeMessageRef.current) {
        unsubscribeMessageRef.current();
      }
    };
  }, [permissionStatus, fcmToken]);

  /**
   * 알림 권한 요청
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      setLoading(true);
      setError(null);

      // 권한 요청
      const granted = await requestNotificationPermission();

      if (granted) {
        setPermissionStatus('granted');

        // 서비스 워커 등록
        const swRegistration = await registerServiceWorker();
        swRegistrationRef.current = swRegistration;

        // FCM 토큰 가져오기
        const token = await getFCMToken(swRegistration || undefined);
        if (token) {
          setFcmToken(token);
        }

        return true;
      } else {
        setPermissionStatus('denied');
        return false;
      }
    } catch (err) {
      console.error('알림 권한 요청 에러:', err);
      setError('알림 권한을 요청하는데 실패했습니다.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 알림 구독 (토큰 저장)
   */
  const subscribeToNotifications = useCallback(
    async (uid: string): Promise<boolean> => {
      if (!fcmToken) {
        // 토큰이 없으면 권한 요청부터
        const granted = await requestPermission();
        if (!granted) {
          return false;
        }
      }

      const token = fcmToken || (await getFCMToken(swRegistrationRef.current || undefined));
      if (!token) {
        setError('FCM 토큰을 가져올 수 없습니다.');
        return false;
      }

      try {
        setLoading(true);
        setError(null);

        // 토큰 정보 저장
        const tokenData: TokenData = {
          token,
          uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          deviceInfo: {
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
            platform: typeof navigator !== 'undefined' ? navigator.platform : '',
            language: typeof navigator !== 'undefined' ? navigator.language : '',
          },
          topics: [NOTIFICATION_TOPICS.ALL],
        };

        // Firestore에 토큰 저장
        const tokenRef = doc(db, 'fcmTokens', token);
        await setDoc(tokenRef, tokenData);

        // 사용자 문서에 토큰 참조 추가
        const userRef = doc(db, 'users', uid);
        const userDoc = await getDoc(userRef);
        if (userDoc.exists()) {
          await updateDoc(userRef, {
            fcmTokens: arrayUnion(token),
            updatedAt: serverTimestamp(),
          });
        }

        setFcmToken(token);
        setIsSubscribed(true);
        console.log('알림 구독 완료');
        return true;
      } catch (err) {
        console.error('알림 구독 에러:', err);
        setError('알림 구독에 실패했습니다.');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [fcmToken, requestPermission]
  );

  /**
   * 알림 구독 해제 (토큰 삭제)
   */
  const unsubscribeFromNotifications = useCallback(
    async (uid: string): Promise<void> => {
      if (!fcmToken) {
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Firestore에서 토큰 삭제
        const tokenRef = doc(db, 'fcmTokens', fcmToken);
        await deleteDoc(tokenRef);

        // 사용자 문서에서 토큰 참조 제거
        const userRef = doc(db, 'users', uid);
        const userDoc = await getDoc(userRef);
        if (userDoc.exists()) {
          await updateDoc(userRef, {
            fcmTokens: arrayRemove(fcmToken),
            updatedAt: serverTimestamp(),
          });
        }

        setFcmToken(null);
        setIsSubscribed(false);
        console.log('알림 구독 해제 완료');
      } catch (err) {
        console.error('알림 구독 해제 에러:', err);
        setError('알림 구독 해제에 실패했습니다.');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fcmToken]
  );

  /**
   * 토픽 구독
   */
  const subscribeToTopic = useCallback(
    async (uid: string, topic: string): Promise<void> => {
      if (!fcmToken) {
        setError('FCM 토큰이 없습니다. 먼저 알림을 활성화해주세요.');
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Firestore에 토픽 추가
        const tokenRef = doc(db, 'fcmTokens', fcmToken);
        await updateDoc(tokenRef, {
          topics: arrayUnion(topic),
          updatedAt: serverTimestamp(),
        });

        console.log(`토픽 구독 완료: ${topic}`);
      } catch (err) {
        console.error('토픽 구독 에러:', err);
        setError('토픽 구독에 실패했습니다.');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fcmToken]
  );

  /**
   * 토픽 구독 해제
   */
  const unsubscribeFromTopic = useCallback(
    async (uid: string, topic: string): Promise<void> => {
      if (!fcmToken) {
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Firestore에서 토픽 제거
        const tokenRef = doc(db, 'fcmTokens', fcmToken);
        await updateDoc(tokenRef, {
          topics: arrayRemove(topic),
          updatedAt: serverTimestamp(),
        });

        console.log(`토픽 구독 해제: ${topic}`);
      } catch (err) {
        console.error('토픽 구독 해제 에러:', err);
        setError('토픽 구독 해제에 실패했습니다.');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fcmToken]
  );

  /**
   * 에러 초기화
   */
  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  /**
   * 마지막 알림 초기화
   */
  const clearLastNotification = useCallback((): void => {
    setLastNotification(null);
  }, []);

  return {
    permissionStatus,
    fcmToken,
    isSubscribed,
    loading,
    error,
    lastNotification,
    requestPermission,
    subscribeToNotifications,
    unsubscribeFromNotifications,
    subscribeToTopic,
    unsubscribeFromTopic,
    clearError,
    clearLastNotification,
  };
}

export default useNotification;
