/**
 * Settings Repository — Firestore 구현체
 *
 * settings/* 문서 접근을 추상화
 */

import {
  doc,
  collection,
  onSnapshot,
  setDoc,
  getDoc,
  db,
} from './firestoreBase';
import type { Unsubscribe, ErrorCallback } from '../types';
import type { SemesterSettings, Course } from '@/lib/types/course';

// ============================================================
// 학기 설정
// ============================================================

/** 학기 설정 실시간 구독 */
export function subscribeSemester(
  callback: (data: SemesterSettings | null) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const ref = doc(db, 'settings', 'semester');
  return onSnapshot(
    ref,
    (docSnap) => {
      if (docSnap.exists()) {
        callback(docSnap.data() as SemesterSettings);
      } else {
        callback(null);
      }
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

/** 학기 설정 업데이트 */
export async function updateSemester(settings: Partial<SemesterSettings>): Promise<void> {
  const ref = doc(db, 'settings', 'semester');
  await setDoc(ref, settings, { merge: true });
}

// ============================================================
// 과목 레지스트리
// ============================================================

/** 과목 레지스트리 실시간 구독 */
export function subscribeCourses(
  callback: (registry: Record<string, Course>) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const ref = collection(db, 'courses');
  return onSnapshot(
    ref,
    (snapshot) => {
      if (snapshot.empty) {
        callback({});
        return;
      }
      const registry: Record<string, Course> = {};
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() as Course;
        registry[docSnap.id] = { ...data, id: docSnap.id };
      });
      callback(registry);
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

// ============================================================
// 철권 챕터 설정
// ============================================================

/** 과목별 철권 챕터 설정 조회 */
export async function getTekkenChapters(courseId: string): Promise<string[] | null> {
  const docSnap = await getDoc(doc(db, 'settings', 'tekken', 'courses', courseId));
  if (!docSnap.exists()) return null;
  return (docSnap.data().chapters as string[]) || null;
}

/** 과목별 철권 챕터 설정 저장 */
export async function setTekkenChapters(courseId: string, chapters: string[]): Promise<void> {
  await setDoc(doc(db, 'settings', 'tekken', 'courses', courseId), { chapters });
}
