/**
 * Material Cache 유틸리티
 *
 * 같은 학습 자료(텍스트 + 이미지)에 대해 중간 처리 결과를 캐시합니다.
 *
 * 캐시 대상:
 * - scopeData: loadScopeForQuiz 결과 (Firestore 다중 읽기 + 챕터 추론)
 * - croppedImages: processImagesForQuiz 결과 (Gemini Vision API 비용)
 *
 * 캐시하지 않는 것:
 * - styleProfile, keywords: 교수가 새 퀴즈 추가할 때마다 변경 → 항상 최신 조회
 *
 * 컬렉션: materials/{fingerprint}
 * TTL: 24시간
 */

import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as crypto from "crypto";
import type { CroppedImage } from "../imageCropping";

// ============================================================
// 타입 정의
// ============================================================

export interface CachedScopeData {
  content: string;
  keywords: string[];
  chaptersLoaded: string[];
}

export interface MaterialCacheDoc {
  fingerprint: string;
  courseId: string;
  textLength: number;

  // 캐시된 중간 결과
  scopeData: CachedScopeData | null;
  croppedImages: CroppedImage[];

  // 메타
  hitCount: number;
  createdAt: FieldValue | Timestamp;
  expiresAt: Timestamp;
}

// ============================================================
// Fingerprint 생성
// ============================================================

/**
 * 학습 자료의 고유 fingerprint 생성
 *
 * 사용자/난이도/문제수와 무관하게, 같은 텍스트+과목+이미지면 같은 키 반환.
 * → Scope와 이미지 크롭 결과를 사용자 간 공유 캐시 가능.
 *
 * @param text - 학습 자료 텍스트
 * @param courseId - 과목 ID (scope 결정에 영향)
 * @param images - Base64 이미지 배열 (크롭 결과 캐시용)
 * @param difficulty - 난이도 (scope 범위에 영향 — HARD는 인접 챕터 확장)
 */
export function buildMaterialFingerprint(
  text: string,
  courseId: string,
  images: string[] = [],
  difficulty: string = "medium"
): string {
  const hash = crypto.createHash("sha256");

  // 텍스트 앞 5000자 (주요 내용 커버 + 성능)
  hash.update(text.slice(0, 5000));
  hash.update(courseId);
  // 난이도별 scope 범위가 다름 (HARD는 인접 챕터 확장)
  hash.update(difficulty);

  // 이미지: 앞 200바이트씩 (서로 다른 이미지 구분 충분)
  for (const img of images.slice(0, 10)) {
    hash.update(img.slice(0, 200));
  }

  return hash.digest("hex").slice(0, 40);
}

// ============================================================
// 캐시 조회
// ============================================================

/**
 * 캐시에서 중간 결과 조회
 *
 * @returns 캐시 히트 시 { scopeData, croppedImages }, 미스 시 null
 */
export async function getMaterialCache(
  fingerprint: string
): Promise<{ scopeData: CachedScopeData | null; croppedImages: CroppedImage[] } | null> {
  const db = getFirestore();
  const cacheRef = db.collection("materials").doc(fingerprint);
  const doc = await cacheRef.get();

  if (!doc.exists) return null;

  const data = doc.data()!;

  // 만료 확인
  const expiresAt = data.expiresAt?.toDate?.();
  if (expiresAt && expiresAt < new Date()) {
    // 만료됨 → 비동기 삭제, null 반환
    cacheRef.delete().catch(() => {});
    return null;
  }

  // hitCount 증가 (비동기, 실패해도 무시)
  cacheRef.update({
    hitCount: FieldValue.increment(1),
  }).catch(() => {});

  return {
    scopeData: data.scopeData || null,
    croppedImages: data.croppedImages || [],
  };
}

// ============================================================
// 캐시 저장
// ============================================================

/**
 * 중간 결과를 캐시에 저장
 *
 * @param fingerprint - material fingerprint
 * @param courseId - 과목 ID
 * @param textLength - 텍스트 길이
 * @param scopeData - Scope 로드 결과 (null이면 캐시 안함)
 * @param croppedImages - 이미지 크롭 결과
 */
export async function setMaterialCache(
  fingerprint: string,
  courseId: string,
  textLength: number,
  scopeData: CachedScopeData | null,
  croppedImages: CroppedImage[]
): Promise<void> {
  // scope도 없고 이미지도 없으면 캐시할 가치 없음
  if (!scopeData && croppedImages.length === 0) return;

  const db = getFirestore();
  const cacheRef = db.collection("materials").doc(fingerprint);

  // TTL: 4시간 (교수가 새 퀴즈 추가하면 styleProfile/keywords 변경 → stale 방지)
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);

  // scope content가 너무 크면 잘라서 저장 (Firestore 1MB 제한)
  let trimmedScopeData = scopeData;
  if (scopeData && scopeData.content.length > 500_000) {
    trimmedScopeData = {
      ...scopeData,
      content: scopeData.content.slice(0, 500_000),
    };
  }

  const cacheDoc: MaterialCacheDoc = {
    fingerprint,
    courseId,
    textLength,
    scopeData: trimmedScopeData,
    croppedImages,
    hitCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
  };

  await cacheRef.set(cacheDoc);
}

// ============================================================
// 만료 캐시 정리
// ============================================================

/**
 * 만료된 materials 문서 삭제
 * @returns 삭제된 문서 수
 */
export async function cleanupExpiredMaterials(): Promise<number> {
  const db = getFirestore();
  const now = new Date();

  const expired = await db
    .collection("materials")
    .where("expiresAt", "<", now)
    .limit(500)
    .get();

  if (expired.empty) return 0;

  const batch = db.batch();
  for (const doc of expired.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();

  return expired.size;
}
