/**
 * 설정 관리 커스텀 훅
 *
 * 앱 설정 (알림, 테마, 언어 등)을 관리합니다.
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 알림 설정 타입
 */
export interface NotificationSettings {
  // 퀴즈 알림
  quizReminder: boolean;
  // 새 퀴즈 알림
  newQuiz: boolean;
  // 피드백 답변 알림
  feedbackReply: boolean;
  // 게시판 댓글 알림
  boardComment: boolean;
  // 랭킹 변동 알림
  rankingChange: boolean;
  // 시즌 알림
  seasonNotice: boolean;
}

/**
 * 표시 설정 타입
 */
export interface DisplaySettings {
  // 애니메이션 활성화
  animations: boolean;
  // 진동 피드백
  hapticFeedback: boolean;
  // 사운드 효과
  soundEffects: boolean;
}

/**
 * 개인정보 설정 타입
 */
export interface PrivacySettings {
  // 프로필 공개
  profilePublic: boolean;
  // 랭킹 표시
  showInRanking: boolean;
  // 활동 내역 공개
  activityPublic: boolean;
}

/**
 * 전체 설정 타입
 */
export interface AppSettings {
  notifications: NotificationSettings;
  display: DisplaySettings;
  privacy: PrivacySettings;
}

/**
 * useSettings 반환 타입
 */
interface UseSettingsReturn {
  settings: AppSettings | null;
  loading: boolean;
  error: string | null;
  fetchSettings: (uid: string) => Promise<void>;
  updateNotifications: (
    uid: string,
    data: Partial<NotificationSettings>
  ) => Promise<void>;
  updateDisplay: (uid: string, data: Partial<DisplaySettings>) => Promise<void>;
  updatePrivacy: (uid: string, data: Partial<PrivacySettings>) => Promise<void>;
  resetSettings: (uid: string) => Promise<void>;
  clearError: () => void;
}

// ============================================================
// 기본값
// ============================================================

/**
 * 기본 설정값
 */
export const DEFAULT_SETTINGS: AppSettings = {
  notifications: {
    quizReminder: true,
    newQuiz: true,
    feedbackReply: true,
    boardComment: true,
    rankingChange: false,
    seasonNotice: true,
  },
  display: {
    animations: true,
    hapticFeedback: true,
    soundEffects: false,
  },
  privacy: {
    profilePublic: true,
    showInRanking: true,
    activityPublic: false,
  },
};

// ============================================================
// useSettings 훅
// ============================================================

/**
 * 설정 관리 커스텀 훅
 *
 * @example
 * ```tsx
 * const { settings, loading, updateNotifications } = useSettings();
 *
 * // 알림 설정 변경
 * await updateNotifications(uid, { quizReminder: false });
 * ```
 */
export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 설정 조회
   * 사용자 문서(users/{uid})의 appSettings 필드에서 조회
   */
  const fetchSettings = useCallback(async (uid: string): Promise<void> => {
    try {
      setLoading(true);
      setError(null);

      // users/{uid} 문서에서 appSettings 필드 조회
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const userData = userSnap.data();
        const appSettings = userData.appSettings;

        if (appSettings) {
          setSettings({
            notifications: {
              ...DEFAULT_SETTINGS.notifications,
              ...appSettings.notifications,
            },
            display: {
              ...DEFAULT_SETTINGS.display,
              ...appSettings.display,
            },
            privacy: {
              ...DEFAULT_SETTINGS.privacy,
              ...appSettings.privacy,
            },
          });
        } else {
          // appSettings가 없으면 기본값 사용 (저장은 나중에 변경 시)
          setSettings(DEFAULT_SETTINGS);
        }
      } else {
        // 사용자 문서가 없으면 기본값 사용
        setSettings(DEFAULT_SETTINGS);
      }
    } catch (err) {
      console.error('설정 조회 에러:', err);
      setError('설정을 불러오는데 실패했습니다.');
      // 에러 시 기본값 사용
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 알림 설정 업데이트
   * users/{uid} 문서의 appSettings.notifications 필드 업데이트
   */
  const updateNotifications = useCallback(
    async (uid: string, data: Partial<NotificationSettings>): Promise<void> => {
      try {
        setLoading(true);
        setError(null);

        const userRef = doc(db, 'users', uid);
        const newNotifications = {
          ...(settings?.notifications || DEFAULT_SETTINGS.notifications),
          ...data,
        };

        await updateDoc(userRef, {
          'appSettings.notifications': newNotifications,
          updatedAt: serverTimestamp(),
        });

        setSettings((prev) =>
          prev
            ? { ...prev, notifications: newNotifications }
            : { ...DEFAULT_SETTINGS, notifications: newNotifications }
        );
      } catch (err) {
        console.error('알림 설정 업데이트 에러:', err);
        setError('알림 설정을 저장하는데 실패했습니다.');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [settings]
  );

  /**
   * 표시 설정 업데이트
   * users/{uid} 문서의 appSettings.display 필드 업데이트
   */
  const updateDisplay = useCallback(
    async (uid: string, data: Partial<DisplaySettings>): Promise<void> => {
      try {
        setLoading(true);
        setError(null);

        const userRef = doc(db, 'users', uid);
        const newDisplay = {
          ...(settings?.display || DEFAULT_SETTINGS.display),
          ...data,
        };

        await updateDoc(userRef, {
          'appSettings.display': newDisplay,
          updatedAt: serverTimestamp(),
        });

        setSettings((prev) =>
          prev
            ? { ...prev, display: newDisplay }
            : { ...DEFAULT_SETTINGS, display: newDisplay }
        );
      } catch (err) {
        console.error('표시 설정 업데이트 에러:', err);
        setError('표시 설정을 저장하는데 실패했습니다.');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [settings]
  );

  /**
   * 개인정보 설정 업데이트
   * users/{uid} 문서의 appSettings.privacy 필드 업데이트
   */
  const updatePrivacy = useCallback(
    async (uid: string, data: Partial<PrivacySettings>): Promise<void> => {
      try {
        setLoading(true);
        setError(null);

        const userRef = doc(db, 'users', uid);
        const newPrivacy = {
          ...(settings?.privacy || DEFAULT_SETTINGS.privacy),
          ...data,
        };

        await updateDoc(userRef, {
          'appSettings.privacy': newPrivacy,
          updatedAt: serverTimestamp(),
        });

        setSettings((prev) =>
          prev
            ? { ...prev, privacy: newPrivacy }
            : { ...DEFAULT_SETTINGS, privacy: newPrivacy }
        );
      } catch (err) {
        console.error('개인정보 설정 업데이트 에러:', err);
        setError('개인정보 설정을 저장하는데 실패했습니다.');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [settings]
  );

  /**
   * 설정 초기화
   * users/{uid} 문서의 appSettings 필드 초기화
   */
  const resetSettings = useCallback(async (uid: string): Promise<void> => {
    try {
      setLoading(true);
      setError(null);

      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        appSettings: DEFAULT_SETTINGS,
        updatedAt: serverTimestamp(),
      });

      setSettings(DEFAULT_SETTINGS);
    } catch (err) {
      console.error('설정 초기화 에러:', err);
      setError('설정을 초기화하는데 실패했습니다.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 에러 초기화
   */
  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  return {
    settings,
    loading,
    error,
    fetchSettings,
    updateNotifications,
    updateDisplay,
    updatePrivacy,
    resetSettings,
    clearError,
  };
}

export default useSettings;
