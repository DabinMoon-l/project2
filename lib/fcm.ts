/**
 * Firebase Cloud Messaging 설정 및 유틸리티
 *
 * 푸시 알림을 위한 FCM 초기화, 권한 요청, 토큰 관리 기능을 제공합니다.
 */

import { getMessaging, getToken, onMessage, Messaging, MessagePayload } from 'firebase/messaging';
import { app } from './firebase';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 알림 메시지 타입
 */
export interface NotificationMessage {
  title: string;
  body: string;
  icon?: string;
  image?: string;
  data?: Record<string, string>;
}

/**
 * 알림 핸들러 타입
 */
export type NotificationHandler = (message: NotificationMessage) => void;

// ============================================================
// 상수
// ============================================================

/**
 * VAPID 공개 키 (Firebase Console에서 발급)
 * 웹 푸시 인증에 사용됩니다.
 */
const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

/**
 * 서비스 워커 경로
 * next-pwa가 생성하는 sw.js를 사용 (FCM 핸들러가 worker/index.js에서 병합됨)
 */
const SERVICE_WORKER_PATH = '/sw.js';

// ============================================================
// 변수
// ============================================================

let messaging: Messaging | null = null;
let foregroundHandler: NotificationHandler | null = null;

// ============================================================
// 초기화 함수
// ============================================================

/**
 * FCM Messaging 인스턴스 가져오기
 *
 * 브라우저 환경에서만 작동하며, 서버 사이드에서는 null을 반환합니다.
 */
export function getMessagingInstance(): Messaging | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!messaging) {
    try {
      messaging = getMessaging(app);
    } catch (error) {
      // Firebase Installations 오류 등은 조용히 무시
      // FCM이 필수가 아니므로 앱 작동에 영향 없음
      if (process.env.NODE_ENV === 'development') {
        console.warn('[FCM] 초기화 스킵:', (error as Error).message);
      }
      return null;
    }
  }

  return messaging;
}

/**
 * 서비스 워커 등록
 *
 * next-pwa가 이미 등록한 sw.js를 재사용합니다.
 * FCM 핸들러는 worker/index.js를 통해 sw.js에 병합되어 있습니다.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    console.warn('서비스 워커를 지원하지 않는 환경입니다.');
    return null;
  }

  try {
    // next-pwa가 이미 등록한 SW가 있으면 그것을 재사용
    const existingRegistration = await navigator.serviceWorker.getRegistration('/');
    if (existingRegistration) {
      // SW가 아직 활성화 대기 중일 수 있으므로 ready 대기
      await navigator.serviceWorker.ready;
      return existingRegistration;
    }

    // next-pwa가 아직 등록하지 않은 경우 (개발모드 등) 직접 등록
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
    return registration;
  } catch (error) {
    console.error('서비스 워커 등록 실패:', error);
    return null;
  }
}

// ============================================================
// 권한 관리
// ============================================================

/**
 * 알림 권한 확인
 */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * 알림 권한 요청
 *
 * @returns 권한이 부여되면 true, 그렇지 않으면 false
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    console.warn('알림을 지원하지 않는 환경입니다.');
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch (error) {
    console.error('알림 권한 요청 에러:', error);
    return false;
  }
}

// ============================================================
// 토큰 관리
// ============================================================

/**
 * FCM 토큰 가져오기
 *
 * 알림 권한이 있어야 토큰을 받을 수 있습니다.
 * 서비스 워커가 등록되어 있어야 합니다.
 *
 * @param serviceWorkerRegistration - 서비스 워커 등록 객체
 * @returns FCM 토큰 또는 null
 */
export async function getFCMToken(
  serviceWorkerRegistration?: ServiceWorkerRegistration
): Promise<string | null> {
  const messagingInstance = getMessagingInstance();
  if (!messagingInstance) {
    return null;
  }

  // 알림 권한 확인
  const permission = getNotificationPermission();
  if (permission !== 'granted') {
    console.warn('알림 권한이 없습니다.');
    return null;
  }

  // VAPID 키 확인
  if (!VAPID_KEY) {
    console.error('VAPID 키가 설정되지 않았습니다.');
    return null;
  }

  try {
    const token = await getToken(messagingInstance, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration,
    });

    if (token) {
      return token;
    } else {
      console.warn('FCM 토큰을 가져올 수 없습니다.');
      return null;
    }
  } catch (error) {
    console.error('FCM 토큰 가져오기 에러:', error);
    return null;
  }
}

// ============================================================
// 메시지 핸들링
// ============================================================

/**
 * 포그라운드 메시지 핸들러 등록
 *
 * 앱이 열려있을 때 받는 알림을 처리합니다.
 *
 * @param handler - 알림 핸들러 함수
 * @returns 구독 해제 함수
 */
export function onForegroundMessage(handler: NotificationHandler): () => void {
  const messagingInstance = getMessagingInstance();
  if (!messagingInstance) {
    return () => {};
  }

  foregroundHandler = handler;

  const unsubscribe = onMessage(messagingInstance, (payload: MessagePayload) => {
    const data = payload.data as Record<string, string> | undefined;
    // data-only 메시지에서 알림 정보 추출 (notification 키 fallback)
    const message: NotificationMessage = {
      title: data?.notificationTitle || payload.notification?.title || '알림',
      body: data?.notificationBody || payload.notification?.body || '',
      icon: data?.notificationIcon || payload.notification?.icon,
      image: data?.notificationImage || payload.notification?.image,
      data: data,
    };

    if (foregroundHandler) {
      foregroundHandler(message);
    }
  });

  return () => {
    foregroundHandler = null;
    unsubscribe();
  };
}

// ============================================================
// 알림 토픽 (서버 측에서 사용)
// ============================================================

/**
 * 알림 토픽 상수
 *
 * FCM 토픽 기반 알림을 위한 상수입니다.
 * 서버(Cloud Functions)에서 토픽별로 알림을 전송할 때 사용합니다.
 */
export const NOTIFICATION_TOPICS = {
  // 전체 알림
  ALL: 'all',
  // 새 퀴즈 알림
  NEW_QUIZ: 'new-quiz',
  // 시즌 알림
  SEASON: 'season',
  // 반별 알림
  CLASS_A: 'class-a',
  CLASS_B: 'class-b',
  CLASS_C: 'class-c',
  CLASS_D: 'class-d',
} as const;

/**
 * 알림 타입
 */
export const NOTIFICATION_TYPES = {
  // 퀴즈 관련
  QUIZ_REMINDER: 'quiz_reminder',
  NEW_QUIZ: 'new_quiz',
  QUIZ_DEADLINE: 'quiz_deadline',
  // 피드백 관련
  FEEDBACK_REPLY: 'feedback_reply',
  // 게시판 관련
  BOARD_COMMENT: 'board_comment',
  BOARD_REPLY: 'board_reply',
  // 랭킹 관련
  RANKING_CHANGE: 'ranking_change',
  // 시즌 관련
  SEASON_START: 'season_start',
  SEASON_END: 'season_end',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];
