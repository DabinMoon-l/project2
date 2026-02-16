/**
 * UserContext - 사용자 프로필 전역 상태 관리
 *
 * N+1 쿼리 문제를 해결하기 위해 프로필 데이터를 중앙화합니다.
 * Firestore 실시간 구독으로 항상 최신 상태를 유지합니다.
 */

'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import type {
  UserProfile,
  CharacterOptions,
  Equipment,
  ProfileUpdateData,
} from '@/lib/hooks/useProfile';
import { calculateLevel } from '@/lib/hooks/useProfile';

// ============================================================
// 타입 정의
// ============================================================

interface UserContextValue {
  /** 사용자 프로필 (null이면 미로그인 또는 로딩 중) */
  profile: UserProfile | null;
  /** 프로필 로딩 상태 */
  loading: boolean;
  /** 에러 메시지 */
  error: string | null;
  /** 교수님 여부 */
  isProfessor: boolean;
  /** 프로필 수정 */
  updateProfile: (data: ProfileUpdateData) => Promise<void>;
  /** 캐릭터 옵션 수정 */
  updateCharacter: (options: CharacterOptions) => Promise<void>;
  /** 장비 수정 */
  updateEquipment: (equipment: Equipment) => Promise<void>;
  /** 닉네임 수정 */
  updateNickname: (nickname: string) => Promise<void>;
  /** 프로필 새로고침 (실시간 구독이므로 보통 불필요) */
  refresh: () => void;
}

// ============================================================
// Context 생성
// ============================================================

const UserContext = createContext<UserContextValue | null>(null);

// ============================================================
// Provider 컴포넌트
// ============================================================

interface UserProviderProps {
  children: ReactNode;
}

export function UserProvider({ children }: UserProviderProps) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Firestore 실시간 구독
  useEffect(() => {
    if (!user?.uid) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const userDocRef = doc(db, 'users', user.uid);

    // onSnapshot으로 실시간 구독
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();

          // 교수님이 아니고 온보딩이 완료되지 않았으면 profile을 null로 설정
          if (data.role !== 'professor' && !data.onboardingCompleted) {
            setProfile(null);
            setLoading(false);
            return;
          }

          const totalExp = data.totalExp || 0;

          setProfile({
            uid: user.uid,
            email: data.email || user.email || '',
            nickname: data.nickname || '용사',
            classType: data.classId || 'A', // Firestore 필드명은 classId
            studentId: data.studentId,
            department: data.department,
            // courseId에서 따옴표 제거 (Firestore 데이터 문제 대응)
            courseId: data.courseId?.replace?.(/"/g, '') || data.courseId,
            characterOptions: data.characterOptions || {
              hairStyle: 0,
              skinColor: 3,
              beard: 0,
            },
            equipment: data.equipment || {},
            totalExp,
            level: calculateLevel(totalExp),
            totalQuizzes: data.totalQuizzes || 0,
            correctAnswers: data.correctAnswers || 0,
            wrongAnswers: data.wrongAnswers || 0,
            averageScore: data.averageScore || 0,
            participationRate: data.participationRate || 0,
            totalFeedbacks: data.totalFeedbacks || 0,
            helpfulFeedbacks: data.helpfulFeedbacks || 0,
            badges: data.badges || [],
            role: data.role || 'student',
            // 토끼 시스템 (발견 + 장착)
            equippedRabbits: data.equippedRabbits || [],
            lastGachaExp: data.lastGachaExp || 0,
            profileRabbitId: data.profileRabbitId,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            lastNicknameChangeAt: data.lastNicknameChangeAt,
          });
          setError(null);
        } else {
          // 프로필이 없는 경우 (온보딩 필요)
          setProfile(null);
          setError(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error('프로필 구독 에러:', err);
        setError('프로필을 불러오는데 실패했습니다.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid, user?.email, refreshKey]);

  // 프로필 수정
  const updateProfile = useCallback(
    async (data: ProfileUpdateData): Promise<void> => {
      if (!user?.uid) {
        throw new Error('로그인이 필요합니다.');
      }

      try {
        const userDocRef = doc(db, 'users', user.uid);
        await updateDoc(userDocRef, {
          ...data,
          updatedAt: serverTimestamp(),
        });
        // onSnapshot이 자동으로 상태 업데이트
      } catch (err) {
        console.error('프로필 수정 에러:', err);
        throw new Error('프로필 수정에 실패했습니다.');
      }
    },
    [user?.uid]
  );

  // 캐릭터 옵션 수정
  const updateCharacter = useCallback(
    async (options: CharacterOptions): Promise<void> => {
      await updateProfile({ characterOptions: options });
    },
    [updateProfile]
  );

  // 장비 수정
  const updateEquipment = useCallback(
    async (equipment: Equipment): Promise<void> => {
      await updateProfile({ equipment });
    },
    [updateProfile]
  );

  // 닉네임 수정 (30일 쿨다운 적용)
  const updateNickname = useCallback(
    async (nickname: string): Promise<void> => {
      if (nickname.length < 2 || nickname.length > 10) {
        throw new Error('닉네임은 2-10자 사이여야 합니다.');
      }
      if (!user?.uid) {
        throw new Error('로그인이 필요합니다.');
      }

      try {
        const userDocRef = doc(db, 'users', user.uid);
        await updateDoc(userDocRef, {
          nickname,
          lastNicknameChangeAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error('닉네임 수정 에러:', err);
        throw new Error('닉네임 수정에 실패했습니다.');
      }
    },
    [user?.uid]
  );

  // 새로고침
  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  // 교수님 여부
  const isProfessor = profile?.role === 'professor';

  // Context 값 메모이제이션
  const value = useMemo<UserContextValue>(
    () => ({
      profile,
      loading,
      error,
      isProfessor,
      updateProfile,
      updateCharacter,
      updateEquipment,
      updateNickname,
      refresh,
    }),
    [
      profile,
      loading,
      error,
      isProfessor,
      updateProfile,
      updateCharacter,
      updateEquipment,
      updateNickname,
      refresh,
    ]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

// ============================================================
// 훅
// ============================================================

/**
 * UserContext 사용 훅
 *
 * @example
 * ```tsx
 * const { profile, loading, isProfessor } = useUser();
 *
 * if (loading) return <Spinner />;
 * if (!profile) return <OnboardingPrompt />;
 *
 * return <div>안녕하세요, {profile.nickname}님!</div>;
 * ```
 */
export function useUser(): UserContextValue {
  const context = useContext(UserContext);

  if (!context) {
    throw new Error('useUser는 UserProvider 내부에서 사용해야 합니다.');
  }

  return context;
}

export default UserContext;
