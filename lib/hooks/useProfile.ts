/**
 * 프로필 관리 커스텀 훅
 *
 * Firestore에서 사용자 프로필을 조회/수정합니다.
 */

'use client';

import { useState, useCallback } from 'react';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 캐릭터 옵션 타입
 */
export interface CharacterOptions {
  hairStyle: number;
  skinColor: number;
  beard: number;
}

/**
 * 장비 타입
 */
export interface Equipment {
  armor?: string;
  weapon?: string;
  hat?: string;
  glasses?: string;
}

/**
 * 계급 타입 (5단계)
 * 중간→기말 시즌 전환 시 초기화됨
 */
export type RankType =
  | '견습생'
  | '용사'
  | '기사'
  | '장군'
  | '전설의 용사';

/**
 * 사용자 프로필 타입
 */
export interface UserProfile {
  // 기본 정보
  uid: string;
  email: string;
  nickname: string;
  classType: 'A' | 'B' | 'C' | 'D';
  studentId?: string;
  department?: string;
  courseId?: string;

  // 캐릭터
  characterOptions: CharacterOptions;
  equipment: Equipment;

  // 스탯
  totalExp: number;
  level: number;
  rank: RankType;

  // 퀴즈 통계
  totalQuizzes: number;
  correctAnswers: number;
  wrongAnswers: number;
  averageScore: number;
  participationRate: number;

  // 피드백 통계
  totalFeedbacks: number;
  helpfulFeedbacks: number;

  // 뱃지
  badges: string[];

  // 역할
  role: 'student' | 'professor';

  // 타임스탬프
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastNicknameChangeAt?: Timestamp;
}

/**
 * 프로필 수정 데이터 타입
 */
export interface ProfileUpdateData {
  nickname?: string;
  characterOptions?: CharacterOptions;
  equipment?: Equipment;
  classType?: 'A' | 'B' | 'C' | 'D';
}

/**
 * useProfile 반환 타입
 */
interface UseProfileReturn {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  fetchProfile: (uid: string) => Promise<void>;
  updateProfile: (uid: string, data: ProfileUpdateData) => Promise<void>;
  updateCharacter: (uid: string, options: CharacterOptions) => Promise<void>;
  updateNickname: (uid: string, nickname: string) => Promise<void>;
  clearError: () => void;
}

// ============================================================
// 계급 계산 헬퍼
// ============================================================

/**
 * 경험치로 계급 계산
 * 시즌 내 달성 가능하도록 완화된 기준
 */
export function calculateRank(totalExp: number): RankType {
  if (totalExp >= 125) return '전설의 용사';
  if (totalExp >= 100) return '장군';
  if (totalExp >= 75) return '기사';
  if (totalExp >= 50) return '용사';
  return '견습생';
}

/**
 * 경험치로 레벨 계산
 */
export function calculateLevel(totalExp: number): number {
  return Math.floor(totalExp / 100) + 1;
}

// ============================================================
// useProfile 훅
// ============================================================

/**
 * 프로필 관리 커스텀 훅
 *
 * @example
 * ```tsx
 * const { profile, loading, fetchProfile, updateProfile } = useProfile();
 *
 * useEffect(() => {
 *   if (user?.uid) fetchProfile(user.uid);
 * }, [user?.uid]);
 * ```
 */
export function useProfile(): UseProfileReturn {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 프로필 조회
   */
  const fetchProfile = useCallback(async (uid: string): Promise<void> => {
    try {
      setLoading(true);
      setError(null);

      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();

        // 계급과 레벨 계산
        const totalExp = data.totalExp || 0;
        const rank = calculateRank(totalExp);
        const level = calculateLevel(totalExp);

        setProfile({
          uid,
          email: data.email || '',
          nickname: data.nickname || '용사',
          classType: data.classId || 'A', // Firestore 필드명은 classId
          studentId: data.studentId,
          department: data.department,
          characterOptions: data.characterOptions || {
            hairStyle: 0,
            skinColor: 3,
            beard: 0,
          },
          equipment: data.equipment || {},
          totalExp,
          level,
          rank,
          totalQuizzes: data.totalQuizzes || 0,
          correctAnswers: data.correctAnswers || 0,
          wrongAnswers: data.wrongAnswers || 0,
          averageScore: data.averageScore || 0,
          participationRate: data.participationRate || 0,
          totalFeedbacks: data.totalFeedbacks || 0,
          helpfulFeedbacks: data.helpfulFeedbacks || 0,
          badges: data.badges || [],
          role: data.role || 'student',
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
      } else {
        setError('프로필을 찾을 수 없습니다.');
      }
    } catch (err) {
      console.error('프로필 조회 에러:', err);
      setError('프로필을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 프로필 수정
   */
  const updateProfile = useCallback(
    async (uid: string, data: ProfileUpdateData): Promise<void> => {
      try {
        setLoading(true);
        setError(null);

        const docRef = doc(db, 'users', uid);
        await updateDoc(docRef, {
          ...data,
          updatedAt: serverTimestamp(),
        });

        // 로컬 상태 업데이트
        setProfile((prev) => (prev ? { ...prev, ...data } : null));
      } catch (err) {
        console.error('프로필 수정 에러:', err);
        setError('프로필 수정에 실패했습니다.');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * 캐릭터 옵션 수정
   */
  const updateCharacter = useCallback(
    async (uid: string, options: CharacterOptions): Promise<void> => {
      await updateProfile(uid, { characterOptions: options });
    },
    [updateProfile]
  );

  /**
   * 닉네임 수정
   */
  const updateNickname = useCallback(
    async (uid: string, nickname: string): Promise<void> => {
      // 닉네임 유효성 검사
      if (nickname.length < 2 || nickname.length > 10) {
        throw new Error('닉네임은 2-10자 사이여야 합니다.');
      }

      await updateProfile(uid, { nickname });
    },
    [updateProfile]
  );

  /**
   * 에러 초기화
   */
  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  return {
    profile,
    loading,
    error,
    fetchProfile,
    updateProfile,
    updateCharacter,
    updateNickname,
    clearError,
  };
}

export default useProfile;
