/**
 * Firebase Cloud Messaging 서비스 워커
 *
 * 백그라운드 푸시 알림을 처리합니다.
 * 앱이 닫혀있거나 백그라운드에 있을 때 알림을 표시합니다.
 */

// Firebase SDK 가져오기 (CDN 버전 사용)
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

// Firebase 설정 (환경변수 대신 직접 설정)
// 주의: 이 값들은 빌드 시점에 환경변수로 대체되거나 직접 입력해야 합니다
const firebaseConfig = {
  apiKey: self.__FIREBASE_API_KEY__ || '',
  authDomain: self.__FIREBASE_AUTH_DOMAIN__ || '',
  projectId: self.__FIREBASE_PROJECT_ID__ || '',
  storageBucket: self.__FIREBASE_STORAGE_BUCKET__ || '',
  messagingSenderId: self.__FIREBASE_MESSAGING_SENDER_ID__ || '',
  appId: self.__FIREBASE_APP_ID__ || '',
};

// Firebase 초기화
firebase.initializeApp(firebaseConfig);

// Messaging 인스턴스 가져오기
const messaging = firebase.messaging();

/**
 * 백그라운드 메시지 핸들러
 *
 * 앱이 백그라운드에 있을 때 푸시 알림을 처리합니다.
 */
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] 백그라운드 메시지 수신:', payload);

  // 알림 데이터 추출
  const notificationTitle = payload.notification?.title || 'RabbiTory';
  const notificationOptions = {
    body: payload.notification?.body || '새로운 알림이 있습니다.',
    icon: payload.notification?.icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    tag: payload.data?.type || 'default',
    data: payload.data || {},
    // 알림 클릭 시 이동할 URL
    actions: getNotificationActions(payload.data?.type),
    // 진동 패턴 (밀리초)
    vibrate: [200, 100, 200],
    // 알림 자동 닫힘 시간 (밀리초)
    requireInteraction: true,
  };

  // 알림 표시
  self.registration.showNotification(notificationTitle, notificationOptions);
});

/**
 * 알림 타입에 따른 액션 버튼 설정
 *
 * @param {string} type - 알림 타입
 * @returns {Array} 액션 버튼 배열
 */
function getNotificationActions(type) {
  switch (type) {
    case 'new_quiz':
      return [
        { action: 'open', title: '퀴즈 풀기' },
        { action: 'dismiss', title: '나중에' },
      ];
    case 'feedback_reply':
      return [
        { action: 'open', title: '답변 보기' },
        { action: 'dismiss', title: '닫기' },
      ];
    case 'board_comment':
    case 'board_reply':
      return [
        { action: 'open', title: '댓글 보기' },
        { action: 'dismiss', title: '닫기' },
      ];
    case 'ranking_change':
      return [
        { action: 'open', title: '랭킹 확인' },
        { action: 'dismiss', title: '닫기' },
      ];
    default:
      return [
        { action: 'open', title: '확인' },
        { action: 'dismiss', title: '닫기' },
      ];
  }
}

/**
 * 알림 클릭 이벤트 핸들러
 */
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] 알림 클릭:', event);

  // 알림 닫기
  event.notification.close();

  // 액션에 따른 처리
  if (event.action === 'dismiss') {
    return;
  }

  // 클릭 시 이동할 URL 결정
  const urlToOpen = getUrlFromNotification(event.notification.data);

  // 앱 열기 또는 포커스
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 이미 열린 창이 있으면 포커스
      for (const client of windowClients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          client.focus();
          if (urlToOpen) {
            client.navigate(urlToOpen);
          }
          return;
        }
      }
      // 열린 창이 없으면 새 창 열기
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen || '/');
      }
    })
  );
});

/**
 * 알림 데이터에서 이동할 URL 추출
 *
 * @param {Object} data - 알림 데이터
 * @returns {string} 이동할 URL
 */
function getUrlFromNotification(data) {
  if (!data) return '/';

  switch (data.type) {
    case 'new_quiz':
    case 'quiz_reminder':
    case 'quiz_deadline':
      return data.quizId ? `/quiz/${data.quizId}` : '/quiz';
    case 'feedback_reply':
      return data.quizId ? `/quiz/${data.quizId}/feedback` : '/quiz';
    case 'board_comment':
    case 'board_reply':
      return data.postId ? `/board/post/${data.postId}` : '/board';
    case 'ranking_change':
      return '/';
    case 'season_start':
    case 'season_end':
      return '/';
    default:
      return data.url || '/';
  }
}

/**
 * 서비스 워커 설치 이벤트
 */
self.addEventListener('install', (event) => {
  console.log('[firebase-messaging-sw.js] 서비스 워커 설치');
  // 즉시 활성화
  self.skipWaiting();
});

/**
 * 서비스 워커 활성화 이벤트
 */
self.addEventListener('activate', (event) => {
  console.log('[firebase-messaging-sw.js] 서비스 워커 활성화');
  // 모든 클라이언트 제어
  event.waitUntil(clients.claim());
});
