/**
 * Firebase 초기화 및 서비스 설정
 *
 * 이 파일은 Firebase의 핵심 서비스들을 초기화하고 내보냅니다.
 * - Authentication: 사용자 인증 관리
 * - Firestore: NoSQL 데이터베이스
 * - Functions: 서버리스 함수 호출
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getFunctions, Functions } from 'firebase/functions';
import { getStorage, FirebaseStorage } from 'firebase/storage';

// Firebase 설정 객체
// 환경 변수에서 Firebase 프로젝트 설정값을 가져옵니다
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
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
 * 실시간 데이터 동기화를 지원하는 NoSQL 클라우드 데이터베이스입니다.
 */
const db: Firestore = getFirestore(app);

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

// 각 서비스 인스턴스를 내보냅니다
export { app, auth, db, functions, storage };
