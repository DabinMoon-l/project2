'use client';

/**
 * enrolledStudents 실시간 구독 훅
 *
 * 교수님 관리 시트에서 사용: 등록 학생 목록, 가입률, 미가입 학생 등
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
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
}

export function useEnrolledStudents(courseId: string | null): UseEnrolledStudentsReturn {
  const [enrolledStudents, setEnrolledStudents] = useState<EnrolledStudent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!courseId) {
      setEnrolledStudents([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, 'enrolledStudents', courseId, 'students')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
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
      setEnrolledStudents(students);
      setLoading(false);
    }, (error) => {
      console.error('enrolledStudents 구독 실패:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [courseId]);

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
  };
}
