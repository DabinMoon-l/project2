'use client';

import { useState, useEffect } from 'react';
import { doc, getDoc, onSnapshot, db } from '@/lib/repositories';

/**
 * 일일 접속 기록 조회 훅
 * - 오늘: onSnapshot 실시간 구독
 * - 과거: getDoc 단발 읽기
 */
export function useDailyAttendance(courseId: string, date: string) {
  const [attendedUids, setAttendedUids] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!courseId || !date) {
      setAttendedUids([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const docRef = doc(db, 'dailyAttendance', `${courseId}_${date}`);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (date === today) {
      // 오늘: 실시간 구독 (새 학생 접속 시 즉시 반영)
      return onSnapshot(docRef, (snap) => {
        setAttendedUids(snap.exists() ? (snap.data()?.attendedUids || []) : []);
        setLoading(false);
      });
    } else {
      // 과거: 단발 읽기
      getDoc(docRef).then((snap) => {
        setAttendedUids(snap.exists() ? (snap.data()?.attendedUids || []) : []);
        setLoading(false);
      }).catch(() => {
        setAttendedUids([]);
        setLoading(false);
      });
    }
  }, [courseId, date]);

  return { attendedUids, loading };
}
