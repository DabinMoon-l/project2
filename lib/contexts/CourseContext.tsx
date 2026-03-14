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
  useMemo,
  type ReactNode,
} from 'react';
import { settingsRepo } from '@/lib/repositories';
import { useAuth } from '../hooks/useAuth';
import { useUser } from './UserContext';
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

const PROFESSOR_COURSE_KEY = 'professor-selected-course'; // localStorage key

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
  /** 교수님 과목 선택 (localStorage 저장) */
  setProfessorCourse: (courseId: CourseId) => void;
  /** 교수님 담당 과목 목록 (assignedCourses) */
  assignedCourses: string[];
  /** 과목 레지스트리 (Firestore courses 컬렉션 → COURSES 폴백) */
  courseRegistry: Record<string, Course>;
  /** 과목 ID로 과목 정보 조회 */
  getCourseById: (courseId: string) => Course | null;
  /** 정렬된 과목 목록 */
  courseList: Course[];
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
  currentSemester: getCurrentSemesterByDate(),
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
  const { profile } = useUser(); // UserContext에서 이미 구독 중인 프로필 재사용
  const [semesterSettings, setSemesterSettings] = useState<SemesterSettings | null>(null);
  const [userCourseId, setUserCourseId] = useState<CourseId | null>(null);
  const [userClassId, setUserClassId] = useState<ClassId | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [courseRegistry, setCourseRegistry] = useState<Record<string, Course>>({ ...COURSES });

  // Firestore courses 컬렉션 구독 → 동적 과목 레지스트리
  useEffect(() => {
    const unsubscribe = settingsRepo.subscribeCourses(
      (registry) => {
        if (Object.keys(registry).length === 0) {
          setCourseRegistry({ ...COURSES });
          return;
        }
        setCourseRegistry(registry);
      },
      (err) => {
        console.warn('과목 레지스트리 로드 실패, 기본값 사용:', (err as any).code);
        setCourseRegistry({ ...COURSES });
      },
    );
    return () => unsubscribe();
  }, []);

  // 과목 ID로 조회 헬퍼
  const getCourseById = useCallback((courseId: string): Course | null => {
    return courseRegistry[courseId] || null;
  }, [courseRegistry]);

  // 정렬된 과목 목록
  const courseList = useMemo(() => {
    return Object.values(courseRegistry).sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [courseRegistry]);

  // 학기 설정 구독
  useEffect(() => {
    setLoading(true);

    const unsubscribe = settingsRepo.subscribeSemester(
      (data) => {
        if (data) {
          setSemesterSettings(data);
        } else {
          console.log('학기 설정 문서가 없습니다. 기본값을 사용합니다.');
          setSemesterSettings(DEFAULT_SEMESTER_SETTINGS);
        }
        setLoading(false);
      },
      (err) => {
        console.warn('학기 설정 로드 실패, 기본값 사용:', (err as any).code);
        setSemesterSettings(DEFAULT_SEMESTER_SETTINGS);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [refreshKey]);

  // 교수님 courseId 미설정 여부 (학기 기반 기본값 적용용)
  const [isProfessorNoCourse, setIsProfessorNoCourse] = useState(false);

  // 교수 담당 과목 목록 (profile에서 읽기)
  const assignedCourses = useMemo<string[]>(() => {
    if (profile?.role !== 'professor') return [];
    return profile.assignedCourses || [];
  }, [profile]);

  // 교수님 localStorage에서 저장된 과목 읽기
  const getSavedProfessorCourse = useCallback((): CourseId | null => {
    if (typeof window === 'undefined') return null;
    const saved = localStorage.getItem(PROFESSOR_COURSE_KEY);
    if (saved && courseRegistry[saved]) {
      // 담당 과목에 포함된 경우만 허용 (assignedCourses가 비어있으면 모두 허용 — 하위호환)
      if (assignedCourses.length === 0 || assignedCourses.includes(saved)) {
        return saved as CourseId;
      }
    }
    return null;
  }, [assignedCourses, courseRegistry]);

  // 교수님 학기 기반 기본 과목
  const getProfessorDefaultCourse = useCallback((semester?: number): CourseId => {
    const saved = getSavedProfessorCourse();
    if (saved) return saved;
    // 담당 과목이 있으면 첫 번째 과목을 기본값으로
    if (assignedCourses.length > 0) return assignedCourses[0] as CourseId;
    const sem = semester ?? getCurrentSemesterByDate();
    return sem === 1 ? 'microbiology' : 'pathophysiology';
  }, [getSavedProfessorCourse, assignedCourses]);

  // 교수님 과목 선택 (localStorage 저장 + state 업데이트)
  const setProfessorCourse = useCallback((courseId: CourseId) => {
    setUserCourseId(courseId);
    if (typeof window !== 'undefined') {
      localStorage.setItem(PROFESSOR_COURSE_KEY, courseId);
    }
  }, []);

  // 사용자 과목 정보 — UserContext의 profile에서 파생 (중복 onSnapshot 제거)
  useEffect(() => {
    if (!user || !profile) {
      setUserCourseId(null);
      setUserClassId(null);
      setIsProfessorNoCourse(false);
      return;
    }

    if (profile.courseId) {
      setUserCourseId(profile.courseId as CourseId);
      setIsProfessorNoCourse(false);
    } else if (profile.role === 'professor') {
      setIsProfessorNoCourse(true);
      setUserCourseId(getProfessorDefaultCourse(
        semesterSettings?.currentSemester
      ));
    } else {
      setUserCourseId(null);
      setIsProfessorNoCourse(false);
    }
    // classType은 UserContext에서 변환된 값 (교수='' , 학생=classId)
    setUserClassId(profile.role === 'professor' ? null : (profile.classType as ClassId || null));
  }, [user, profile, refreshKey, getProfessorDefaultCourse]); // semesterSettings는 의도적으로 제외 (아래 별도 effect에서 보정)

  // 교수님 기본 과목: Firestore 학기 설정이 로드되면 보정
  useEffect(() => {
    if (isProfessorNoCourse && semesterSettings) {
      setUserCourseId(getProfessorDefaultCourse(semesterSettings.currentSemester));
    }
  }, [isProfessorNoCourse, semesterSettings, getProfessorDefaultCourse]);

  // 현재 사용자의 과목 정보 (레지스트리 기반)
  const userCourse = userCourseId ? (courseRegistry[userCourseId] || null) : null;

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
        await settingsRepo.updateSemester(settings);
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

  // Context 값 메모이제이션 (불필요한 소비자 리렌더 방지)
  const value = useMemo<CourseContextType>(() => ({
    semesterSettings,
    userCourseId,
    userClassId,
    userCourse,
    loading,
    error,
    availableGrades,
    getCourseForGrade,
    updateSemesterSettings,
    setProfessorCourse,
    assignedCourses,
    courseRegistry,
    getCourseById,
    courseList,
    refresh,
  }), [
    semesterSettings, userCourseId, userClassId, userCourse,
    loading, error, availableGrades,
    getCourseForGrade, updateSemesterSettings, setProfessorCourse, assignedCourses,
    courseRegistry, getCourseById, courseList, refresh,
  ]);

  return (
    <CourseContext.Provider value={value}>
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
