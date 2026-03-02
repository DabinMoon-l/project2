'use client';

/**
 * enrolledStudents 훅 (폴링 기반)
 *
 * 교수님 관리 시트에서 사용: 등록 학생 목록, 가입률, 미가입 학생 등
 * 변경 빈도가 낮으므로 getDocs + 수동 refresh로 전환 (onSnapshot 제거)
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface EnrolledStudent {
  studentId: string;
  name: string;
  classId?: string;
  isRegistered: boolean;
  registeredUid?: string;
  enrolledAt: Date;
}

export interface UseEnrolledStudentsReturn {
  enrolledStudents: EnrolledStudent[];
  loading: boolean;
  enrolledCount: number;
  registeredCount: number;
  unregisteredStudents: EnrolledStudent[];
  /** 수동 새로고침 */
  refresh: () => void;
}

/** 캐시 TTL: 10분 */
const CACHE_TTL = 10 * 60 * 1000;

/** 모듈 레벨 캐시 */
const cache = new Map<string, { data: EnrolledStudent[]; fetchedAt: number }>();

export function useEnrolledStudents(courseId: string | null): UseEnrolledStudentsReturn {
  const [enrolledStudents, setEnrolledStudents] = useState<EnrolledStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshTrigger = useRef(0);
  const [, forceUpdate] = useState(0);

  const fetchStudents = useCallback(async (cid: string, force: boolean) => {
    // 캐시 확인 (강제 새로고침이 아닌 경우)
    if (!force) {
      const cached = cache.get(cid);
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
        setEnrolledStudents(cached.data);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    try {
      const q = query(collection(db, 'enrolledStudents', cid, 'students'));
      const snapshot = await getDocs(q);

      const students: EnrolledStudent[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          studentId: doc.id,
          name: data.name || '',
          classId: data.classId,
          isRegistered: !!data.isRegistered,
          registeredUid: data.registeredUid,
          enrolledAt: data.enrolledAt?.toDate?.() || new Date(),
        };
      });

      // 학번순 정렬
      students.sort((a, b) => a.studentId.localeCompare(b.studentId));

      // 캐시 저장
      cache.set(cid, { data: students, fetchedAt: Date.now() });

      setEnrolledStudents(students);
    } catch (error) {
      console.error('enrolledStudents 조회 실패:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!courseId) {
      setEnrolledStudents([]);
      setLoading(false);
      return;
    }

    fetchStudents(courseId, false);
  }, [courseId, fetchStudents, refreshTrigger.current]);

  const refresh = useCallback(() => {
    if (!courseId) return;
    refreshTrigger.current += 1;
    // 캐시 무효화
    cache.delete(courseId);
    fetchStudents(courseId, true);
    forceUpdate(v => v + 1);
  }, [courseId, fetchStudents]);

  const enrolledCount = enrolledStudents.length;

  const registeredCount = useMemo(
    () => enrolledStudents.filter(s => s.isRegistered).length,
    [enrolledStudents]
  );

  const unregisteredStudents = useMemo(
    () => enrolledStudents.filter(s => !s.isRegistered),
    [enrolledStudents]
  );

  return {
    enrolledStudents,
    loading,
    enrolledCount,
    registeredCount,
    unregisteredStudents,
    refresh,
  };
}
