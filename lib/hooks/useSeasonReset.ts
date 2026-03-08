/**
 * 시즌 리셋 관리 커스텀 훅
 *
 * 교수님 전용 시즌 리셋 기능을 제공합니다.
 * - 시즌 리셋 실행
 * - 시즌 히스토리 조회
 * - 현재 시즌 정보 조회
 */

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  Timestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuth } from './useAuth';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 시즌 타입
 */
export type SeasonType = 'midterm' | 'final';

/**
 * 시즌 로그 타입
 */
export interface SeasonLog {
  id: string;
  classId: string;
  previousSeason: SeasonType;
  newSeason: SeasonType;
  resetBy: string;
  resetByName?: string;
  studentCount: number;
  createdAt: Date;
}

/**
 * 반별 시즌 정보
 */
export interface ClassSeasonInfo {
  classId: string;
  currentSeason: SeasonType;
  lastResetAt: Date | null;
  studentCount: number;
  canReset: boolean;
}

/**
 * 시즌 리셋 결과
 */
export interface ResetResult {
  success: boolean;
  message: string;
  resetCount: number;
}

// ============================================================
// 훅
// ============================================================

/**
 * 시즌 리셋 훅
 */
export function useSeasonReset() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seasonLogs, setSeasonLogs] = useState<SeasonLog[]>([]);
  const [classSeasons, setClassSeasons] = useState<ClassSeasonInfo[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  /**
   * 반별 시즌 정보 조회
   */
  const fetchClassSeasons = useCallback(async () => {
    if (!user) return;

    try {
      setLogsLoading(true);

      const classIds = ['A', 'B', 'C', 'D'];

      // 4개 반 병렬 조회
      const classSnapshots = await Promise.all(
        classIds.map(classId =>
          getDocs(query(
            collection(db, 'users'),
            where('classId', '==', classId),
            where('role', '==', 'student')
          ))
        )
      );

      const classInfos: ClassSeasonInfo[] = classIds.map((classId, idx) => {
        const studentsSnapshot = classSnapshots[idx];
        const studentCount = studentsSnapshot.size;

        let currentSeason: SeasonType = 'midterm';
        let lastResetAt: Date | null = null;

        if (studentsSnapshot.docs.length > 0) {
          const firstStudent = studentsSnapshot.docs[0].data();
          currentSeason = firstStudent.currentSeason || 'midterm';
          if (firstStudent.seasonResetAt) {
            lastResetAt = (firstStudent.seasonResetAt as Timestamp).toDate();
          }
        }

        return {
          classId,
          currentSeason,
          lastResetAt,
          studentCount,
          canReset: studentCount > 0,
        };
      });

      setClassSeasons(classInfos);
    } catch (err) {
      console.error('반별 시즌 정보 조회 실패:', err);
      setError('시즌 정보를 불러오는데 실패했습니다.');
    } finally {
      setLogsLoading(false);
    }
  }, [user]);

  /**
   * 시즌 히스토리 조회
   */
  const fetchSeasonLogs = useCallback(async (classId?: string, logLimit = 10) => {
    if (!user) return;

    try {
      setLogsLoading(true);

      let logsQuery;
      if (classId) {
        logsQuery = query(
          collection(db, 'seasonLogs'),
          where('classId', '==', classId),
          orderBy('createdAt', 'desc'),
          limit(logLimit)
        );
      } else {
        logsQuery = query(
          collection(db, 'seasonLogs'),
          orderBy('createdAt', 'desc'),
          limit(logLimit)
        );
      }

      const snapshot = await getDocs(logsQuery);

      // 고유 교수 ID 추출 후 병렬 조회
      const professorIds = [...new Set(
        snapshot.docs.map(d => d.data().resetBy).filter(Boolean) as string[]
      )];
      const professorDocs = await Promise.all(
        professorIds.map(id => getDoc(doc(db, 'users', id)))
      );
      const professorNameMap = new Map<string, string>();
      professorDocs.forEach(d => {
        if (d.exists()) {
          professorNameMap.set(d.id, d.data().nickname || '교수님');
        }
      });

      const logs: SeasonLog[] = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          classId: data.classId,
          previousSeason: data.previousSeason,
          newSeason: data.newSeason,
          resetBy: data.resetBy,
          resetByName: (data.resetBy && professorNameMap.get(data.resetBy)) || '교수님',
          studentCount: data.studentCount,
          createdAt: (data.createdAt as Timestamp).toDate(),
        };
      });

      setSeasonLogs(logs);
    } catch (err) {
      console.error('시즌 히스토리 조회 실패:', err);
      setError('히스토리를 불러오는데 실패했습니다.');
    } finally {
      setLogsLoading(false);
    }
  }, [user]);

  /**
   * 시즌 리셋 실행
   */
  const resetSeason = useCallback(async (
    classId: string,
    newSeason: SeasonType
  ): Promise<ResetResult> => {
    if (!user) {
      return { success: false, message: '로그인이 필요합니다.', resetCount: 0 };
    }

    try {
      setLoading(true);
      setError(null);

      const resetSeasonFn = httpsCallable<
        { classId: string; newSeason: SeasonType },
        ResetResult
      >(functions, 'resetSeason');

      const result = await resetSeasonFn({ classId, newSeason });

      // 리셋 후 데이터 새로고침
      await Promise.all([
        fetchClassSeasons(),
        fetchSeasonLogs(),
      ]);

      return result.data;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '시즌 리셋에 실패했습니다.';
      setError(errorMessage);
      return { success: false, message: errorMessage, resetCount: 0 };
    } finally {
      setLoading(false);
    }
  }, [user, fetchClassSeasons, fetchSeasonLogs]);

  /**
   * 전체 반 일괄 리셋
   */
  const resetAllClasses = useCallback(async (
    newSeason: SeasonType
  ): Promise<{ success: boolean; results: { classId: string; result: ResetResult }[] }> => {
    if (!user) {
      return { success: false, results: [] };
    }

    try {
      setLoading(true);
      setError(null);

      const classIds = ['A', 'B', 'C', 'D'];
      const results: { classId: string; result: ResetResult }[] = [];

      for (const classId of classIds) {
        const result = await resetSeason(classId, newSeason);
        results.push({ classId, result });
      }

      const allSuccess = results.every(r => r.result.success);

      return { success: allSuccess, results };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '전체 리셋에 실패했습니다.';
      setError(errorMessage);
      return { success: false, results: [] };
    } finally {
      setLoading(false);
    }
  }, [user, resetSeason]);

  // 초기 데이터 로드
  useEffect(() => {
    if (user) {
      fetchClassSeasons();
      fetchSeasonLogs();
    }
  }, [user, fetchClassSeasons, fetchSeasonLogs]);

  return {
    // 상태
    loading,
    error,
    logsLoading,
    seasonLogs,
    classSeasons,

    // 액션
    resetSeason,
    resetAllClasses,
    fetchClassSeasons,
    fetchSeasonLogs,
  };
}

// ============================================================
// 유틸리티 함수
// ============================================================

/**
 * 시즌 이름 반환
 */
export function getSeasonName(season: SeasonType): string {
  return season === 'midterm' ? '중간고사' : '기말고사';
}

/**
 * 다음 시즌 반환
 */
export function getNextSeason(currentSeason: SeasonType): SeasonType {
  return currentSeason === 'midterm' ? 'final' : 'midterm';
}

/**
 * 시즌 전환 시 초기화되는 항목
 */
export const RESET_ITEMS = [
  { name: '경험치', icon: '⭐' },
  { name: '계급', icon: '🎖️' },
  { name: '갑옷', icon: '🛡️' },
  { name: '무기', icon: '⚔️' },
  { name: 'Shop 아이템', icon: '🛒' },
];

/**
 * 시즌 전환 시 유지되는 항목
 */
export const PRESERVED_ITEMS = [
  { name: '골드', icon: '💰' },
  { name: '캐릭터 외형', icon: '🐰' },
  { name: '뱃지', icon: '🏅' },
];

export default useSeasonReset;
