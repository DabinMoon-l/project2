'use client';

/**
 * 과목 Context
 * 현재 학기 설정과 사용자의 과목 정보를 전역으로 관리
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import {
  type CourseId,
  type ClassId,
  type Semester,
  type SemesterSettings,
  type Course,
  COURSES,
  determineCourse,
  getAvailableGrades,
  getCurrentSemesterByDate,
} from '../types/course';

/**
 * Context 타입
 */
interface CourseContextType {
  /** 현재 학기 설정 */
  semesterSettings: SemesterSettings | null;
  /** 현재 사용자의 과목 ID */
  userCourseId: CourseId | null;
  /** 현재 사용자의 반 ID */
  userClassId: ClassId | null;
  /** 현재 사용자의 과목 정보 */
  userCourse: Course | null;
  /** 로딩 상태 */
  loading: boolean;
  /** 에러 */
  error: string | null;
  /** 선택 가능한 학년 목록 */
  availableGrades: number[];
  /** 학년으로 과목 결정 */
  getCourseForGrade: (grade: number) => ReturnType<typeof determineCourse>;
  /** 학기 설정 업데이트 (교수님 전용) */
  updateSemesterSettings: (settings: Partial<SemesterSettings>) => Promise<void>;
  /** 설정 새로고침 */
  refresh: () => void;
}

const CourseContext = createContext<CourseContextType | null>(null);

/**
 * 기본 학기 설정
 * - 1학기 (spring): 2월 22일 ~ 8월 22일
 * - 2학기 (fall): 8월 22일 ~ 다음해 2월 22일
 */
const DEFAULT_SEMESTER_SETTINGS: SemesterSettings = {
  currentYear: new Date().getFullYear(),
  currentSemester: new Date().getMonth() < 8 ? 1 : 2, // 8월 이전이면 1학기
  semesterDates: {
    spring: {
      start: `${new Date().getFullYear()}-02-22`,
      end: `${new Date().getFullYear()}-08-22`,
    },
    fall: {
      start: `${new Date().getFullYear()}-08-22`,
      end: `${new Date().getFullYear() + 1}-02-22`,
    },
  },
};

/**
 * CourseProvider
 */
export function CourseProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [semesterSettings, setSemesterSettings] = useState<SemesterSettings | null>(null);
  const [userCourseId, setUserCourseId] = useState<CourseId | null>(null);
  const [userClassId, setUserClassId] = useState<ClassId | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // 학기 설정 구독
  useEffect(() => {
    setLoading(true);

    const settingsRef = doc(db, 'settings', 'semester');

    const unsubscribe = onSnapshot(
      settingsRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as SemesterSettings;
          setSemesterSettings(data);
        } else {
          // 설정이 없으면 기본값 사용 (문서 생성은 교수님이 설정 페이지에서 함)
          console.log('학기 설정 문서가 없습니다. 기본값을 사용합니다.');
          setSemesterSettings(DEFAULT_SEMESTER_SETTINGS);
        }
        setLoading(false);
      },
      (err) => {
        // 권한 오류 등 발생 시 기본값 사용
        console.warn('학기 설정 로드 실패, 기본값 사용:', err.code);
        setSemesterSettings(DEFAULT_SEMESTER_SETTINGS);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [refreshKey]);

  // 교수님 courseId 미설정 여부 (학기 기반 기본값 적용용)
  const [isProfessorNoCourse, setIsProfessorNoCourse] = useState(false);

  // 사용자 과목 정보 구독
  useEffect(() => {
    if (!user) {
      setUserCourseId(null);
      setUserClassId(null);
      setIsProfessorNoCourse(false);
      return;
    }

    const userRef = doc(db, 'users', user.uid);

    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();

          if (data.courseId) {
            setUserCourseId(data.courseId);
            setIsProfessorNoCourse(false);
          } else if (data.role === 'professor') {
            setIsProfessorNoCourse(true);
            // 즉시 폴백: semesterSettings 로딩 전이면 날짜 기반 판별
            const semester = semesterSettings?.currentSemester ?? getCurrentSemesterByDate();
            setUserCourseId(semester === 1 ? 'microbiology' : 'pathophysiology');
          } else {
            setUserCourseId(null);
            setIsProfessorNoCourse(false);
          }
          setUserClassId(data.classId || null);
        }
      },
      (err) => {
        console.error('사용자 과목 정보 로드 실패:', err);
      }
    );

    return () => unsubscribe();
  }, [user, refreshKey]); // semesterSettings는 의도적으로 제외 (아래 별도 effect에서 보정)

  // 교수님 기본 과목: Firestore 학기 설정이 로드되면 보정
  useEffect(() => {
    if (isProfessorNoCourse && semesterSettings) {
      const semester = semesterSettings.currentSemester;
      setUserCourseId(semester === 1 ? 'microbiology' : 'pathophysiology');
    }
  }, [isProfessorNoCourse, semesterSettings]);

  // 현재 사용자의 과목 정보
  const userCourse = userCourseId ? COURSES[userCourseId] : null;

  // 선택 가능한 학년 목록
  const availableGrades = semesterSettings
    ? getAvailableGrades(semesterSettings.currentSemester)
    : [1, 2];

  // 학년으로 과목 결정
  const getCourseForGrade = useCallback(
    (grade: number) => {
      if (!semesterSettings) return null;
      return determineCourse(grade, semesterSettings.currentSemester);
    },
    [semesterSettings]
  );

  // 학기 설정 업데이트 (교수님 전용)
  const updateSemesterSettings = useCallback(
    async (settings: Partial<SemesterSettings>) => {
      try {
        const settingsRef = doc(db, 'settings', 'semester');
        await setDoc(settingsRef, settings, { merge: true });
      } catch (err) {
        console.error('학기 설정 업데이트 실패:', err);
        throw new Error('학기 설정 업데이트에 실패했습니다.');
      }
    },
    []
  );

  // 새로고침
  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return (
    <CourseContext.Provider
      value={{
        semesterSettings,
        userCourseId,
        userClassId,
        userCourse,
        loading,
        error,
        availableGrades,
        getCourseForGrade,
        updateSemesterSettings,
        refresh,
      }}
    >
      {children}
    </CourseContext.Provider>
  );
}

/**
 * useCourse 훅
 */
export function useCourse() {
  const context = useContext(CourseContext);
  if (!context) {
    throw new Error('useCourse must be used within CourseProvider');
  }
  return context;
}

export default CourseProvider;
