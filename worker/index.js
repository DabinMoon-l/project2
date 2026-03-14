/**
 * FCM 백그라운드 메시지 핸들러
 *
 * next-pwa의 customWorkerDir를 통해 sw.js에 자동 병합됩니다.
 * 별도의 firebase-messaging-sw.js 등록 없이 FCM 백그라운드 알림을 처리합니다.
 */

// Firebase SDK (CDN compat 버전)
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

var _messagingInitialized = false;

/**
 * Firebase Messaging 초기화 (지연 초기화)
 * /firebase-messaging-sw.js route handler에서 Firebase config를 가져와서 초기화
 */
function initFirebaseMessaging() {
  if (_messagingInitialized) return Promise.resolve();

  return fetch('/firebase-messaging-sw.js')
    .then(function(response) { return response.text(); })
    .then(function(text) {
      // "var firebaseConfig = {...};" 패턴에서 JSON 추출
      var match = text.match(/var firebaseConfig\s*=\s*(\{[^}]+\})/);
      if (!match) {
        console.error('[SW] Firebase config parse failed');
        return;
      }

      var firebaseConfig = JSON.parse(match[1]);

      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }

      var messaging = firebase.messaging();

      // 백그라운드 메시지 핸들러
      // data-only 메시지에서 알림 정보를 추출하여 표시
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

      _messagingInitialized = true;
    })
    .catch(function(err) {
      console.error('[SW] Firebase Messaging init error:', err);
    });
}

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

// SW 활성화 시 Firebase Messaging 초기화
self.addEventListener('activate', function(event) {
  event.waitUntil(initFirebaseMessaging());
});

// push 이벤트 수신 시에도 초기화 보장
self.addEventListener('push', function(event) {
  if (!_messagingInitialized) {
    event.waitUntil(initFirebaseMessaging());
  }
});
