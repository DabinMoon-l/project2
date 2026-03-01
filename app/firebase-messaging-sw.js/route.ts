/**
 * Firebase Cloud Messaging 서비스 워커 Route Handler
 *
 * NEXT_PUBLIC_ 환경변수를 빌드 시 서비스 워커에 자동 주입합니다.
 * public/ 폴더의 정적 파일 대신 이 Route Handler가 /firebase-messaging-sw.js 를 제공합니다.
 */

// 빌드 시 정적으로 생성 (NEXT_PUBLIC_ 환경변수는 빌드 타임에 인라인됨)
export const dynamic = "force-static";

export async function GET() {
  const firebaseConfig = JSON.stringify({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
  });

  const sw = `/**
 * Firebase Cloud Messaging 서비스 워커
 * 빌드 시 환경변수가 자동으로 주입됩니다.
 */

// Firebase SDK (CDN compat 버전)
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

// Firebase 설정 (빌드 시 주입)
var firebaseConfig = ${firebaseConfig};
firebase.initializeApp(firebaseConfig);

var messaging = firebase.messaging();

/**
 * 백그라운드 메시지 핸들러
 * data-only 메시지에서 알림 정보를 추출하여 표시
 */
messaging.onBackgroundMessage(function(payload) {
  var data = payload.data || {};
  var notificationTitle = data.notificationTitle || (payload.notification && payload.notification.title) || 'RabbiTory';
  var notificationBody = data.notificationBody || (payload.notification && payload.notification.body) || '';
  var notificationIcon = data.notificationIcon || (payload.notification && payload.notification.icon) || '/icons/icon-192x192.png';

  var notificationOptions = {
    body: notificationBody,
    icon: notificationIcon,
    badge: '/icons/icon-72x72.png',
    tag: data.type || 'default',
    data: data,
    actions: getNotificationActions(data.type),
    vibrate: [200, 100, 200],
    requireInteraction: true,
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

/**
 * 알림 타입별 액션 버튼
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
    case 'announcement':
      return [
        { action: 'open', title: '공지 보기' },
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
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  var urlToOpen = getUrlFromNotification(event.notification.data);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url.indexOf(self.registration.scope) !== -1 && 'focus' in client) {
          client.focus();
          if (urlToOpen) {
            client.navigate(urlToOpen);
          }
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen || '/');
      }
    })
  );
});

/**
 * 알림 데이터에서 이동 URL 추출
 */
function getUrlFromNotification(data) {
  if (!data) return '/';

  switch (data.type) {
    case 'new_quiz':
    case 'quiz_reminder':
    case 'quiz_deadline':
      return data.quizId ? '/quiz/' + data.quizId : '/quiz';
    case 'feedback_reply':
      return data.quizId ? '/quiz/' + data.quizId + '/feedback' : '/quiz';
    case 'board_comment':
    case 'board_reply':
      return data.postId ? '/board/post/' + data.postId : '/board';
    case 'announcement':
      return '/';
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
 * 서비스 워커 설치
 */
self.addEventListener('install', function() {
  self.skipWaiting();
});

/**
 * 서비스 워커 활성화
 */
self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});
`;

  return new Response(sw, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
