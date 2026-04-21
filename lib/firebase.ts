/**
 * Firebase 초기화 및 서비스 설정
 *
 * 이 파일은 Firebase의 핵심 서비스들을 초기화하고 내보냅니다.
 * - Authentication: 사용자 인증 관리
 * - Firestore: NoSQL 데이터베이스
 * - Functions: 서버리스 함수 호출
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, getFirestore, Firestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, Functions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, FirebaseStorage, connectStorageEmulator } from 'firebase/storage';
import { getDatabase, Database, connectDatabaseEmulator } from 'firebase/database';

// Firebase 설정 객체
// 환경 변수에서 Firebase 프로젝트 설정값을 가져옵니다
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || '',
};

/**
 * Firebase 앱 초기화
 *
 * 이미 초기화된 앱이 있으면 해당 앱을 반환하고,
 * 없으면 새로운 앱을 초기화합니다.
 * 이를 통해 Next.js의 핫 리로드 시 중복 초기화를 방지합니다.
 */
const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

/**
 * Firebase Authentication 인스턴스
 * 사용자 로그인, 회원가입, 로그아웃 등의 인증 기능을 제공합니다.
 */
const auth: Auth = getAuth(app);

/**
 * Firestore 데이터베이스 인스턴스
 * IndexedDB 기반 오프라인 캐시 활성화 (재방문 시 즉시 표시 + 멀티탭 지원)
 * 핫 리로드 시 initializeFirestore 중복 호출 방지: 앱이 이미 초기화되었으면 getFirestore로 fallback
 */
const db: Firestore = getApps().length > 1
  ? getFirestore(app)
  : (() => {
    try {
      return initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch {
      return getFirestore(app);
    }
  })();

/**
 * Firebase Functions 인스턴스
 * 서버리스 백엔드 함수를 호출할 수 있습니다.
 * 한국 리전(asia-northeast3)을 사용합니다.
 */
const functions: Functions = getFunctions(app, 'asia-northeast3');

/**
 * Firebase Storage 인스턴스
 * 이미지, 파일 등을 저장하고 관리할 수 있습니다.
 */
const storage: FirebaseStorage = getStorage(app);

/**
 * Firebase Realtime Database (지연 초기화)
 * 철권퀴즈 등 RTDB가 필요한 곳에서만 getRtdb()로 호출
 * databaseURL이 없으면 에러 방지
 */
let _rtdb: Database | null = null;
export function getRtdb(): Database {
  if (!_rtdb) {
    _rtdb = getDatabase(app);
    maybeConnectRtdbEmulator(_rtdb);
  }
  return _rtdb;
}

/**
 * 로컬 에뮬레이터 연결
 *
 * NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true 일 때만 연결.
 * 브라우저 HMR로 중복 연결되지 않도록 window 플래그 가드.
 * `firebase emulators:start` 실행 후 `npm run dev`로 띄우면 됨.
 */
if (
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true'
) {
  const w = window as unknown as { __rabbitory_emulator_connected?: boolean };
  if (!w.__rabbitory_emulator_connected) {
    w.__rabbitory_emulator_connected = true;
    try {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
      connectFunctionsEmulator(functions, '127.0.0.1', 5001);
      connectStorageEmulator(storage, '127.0.0.1', 9199);
      // eslint-disable-next-line no-console
      console.info('[Firebase] 에뮬레이터 연결됨 (auth:9099, firestore:8080, functions:5001, storage:9199)');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[Firebase] 에뮬레이터 연결 실패:', err);
    }
  }
}

/** RTDB 에뮬레이터 연결 (지연 초기화라서 getRtdb 내부에서 처리) */
function maybeConnectRtdbEmulator(database: Database) {
  if (
    typeof window !== 'undefined' &&
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true'
  ) {
    const w = window as unknown as { __rabbitory_rtdb_emulator_connected?: boolean };
    if (!w.__rabbitory_rtdb_emulator_connected) {
      w.__rabbitory_rtdb_emulator_connected = true;
      try {
        connectDatabaseEmulator(database, '127.0.0.1', 9000);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[Firebase] RTDB 에뮬레이터 연결 실패:', err);
      }
    }
  }
}

// 각 서비스 인스턴스를 내보냅니다
export { app, auth, db, functions, storage };
