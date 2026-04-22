/**
 * 프로필 관리 커스텀 훅
 *
 * Firestore에서 사용자 프로필을 조회/수정합니다.
 */

'use client';

import { useState, useCallback } from 'react';
import { Timestamp, userRepo } from '@/lib/repositories';

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

  // 교수 전용: 담당 과목 목록 (allowedProfessors에서 동기화)
  assignedCourses?: string[];

  // 캐릭터/뽑기 시스템 (레거시)
  currentCharacterIndex?: number;
  currentCharacterName?: string;
  lastGachaExp?: number;

  // 토끼 시스템 (발견 + 장착)
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>;

  // 프로필 사진 (토끼 ID, 미설정 시 null/undefined)
  profileRabbitId?: number | null;

  // 복구 이메일 (비밀번호 찾기용)
  recoveryEmail?: string;

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
  profileRabbitId?: number | null;
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

      const data = await userRepo.getProfile(uid);

      if (data) {
        // 레벨 계산
        const totalExp = (data.totalExp as number) || 0;
        const level = calculateLevel(totalExp);

        setProfile({
          uid,
          email: (data.email as string) || '',
          nickname: (data.nickname as string) || '용사',
          classType: (data.classId as 'A' | 'B' | 'C' | 'D') || 'A', // Firestore 필드명은 classId
          studentId: data.studentId as string | undefined,
          department: data.department as string | undefined,
          characterOptions: (data.characterOptions as CharacterOptions) || {
            hairStyle: 0,
            skinColor: 3,
            beard: 0,
          },
          equipment: (data.equipment as Equipment) || {},
          totalExp,
          level,
          totalQuizzes: (data.totalQuizzes as number) || 0,
          correctAnswers: (data.correctAnswers as number) || 0,
          wrongAnswers: (data.wrongAnswers as number) || 0,
          averageScore: (data.averageScore as number) || 0,
          participationRate: (data.participationRate as number) || 0,
          totalFeedbacks: (data.totalFeedbacks as number) || 0,
          helpfulFeedbacks: (data.helpfulFeedbacks as number) || 0,
          badges: (data.badges as string[]) || [],
          role: (data.role as 'student' | 'professor') || 'student',
          equippedRabbits:
            (data.equippedRabbits as Array<{ rabbitId: number; courseId: string }>) || [],
          createdAt: data.createdAt as Timestamp,
          updatedAt: data.updatedAt as Timestamp,
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

        await userRepo.updateProfile(uid, data as Record<string, unknown>);

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
