'use client';

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  type ClassType,
  type Theme,
  type BiologyTheme,
  defaultTheme,
  getTheme,
  themeToCssVariables,
  biologyTheme,
} from './index';
import type { CourseId } from '@/lib/types/course';

/**
 * 테마 컨텍스트 값 타입
 */
export interface ThemeContextValue {
  // 현재 테마 (반별 테마 또는 생물학 테마)
  theme: Theme | BiologyTheme;
  // 현재 반 타입
  classType: ClassType;
  // 테마 변경 함수
  setClassType: (classType: ClassType) => void;
  // 다크 모드 여부
  isDarkMode: boolean;
  // 현재 과목 ID
  courseId: CourseId | null;
  // 생물학 단일 테마 사용 여부
  isBiologyCourse: boolean;
}

// 테마 컨텍스트 생성
export const ThemeContext = createContext<ThemeContextValue | null>(null);

// 로컬 스토리지 키
const STORAGE_KEY = 'hero-quiz-class-type';

/**
 * ThemeProvider Props
 */
interface ThemeProviderProps {
  children: ReactNode;
  // 초기 반 타입 (서버에서 전달 가능)
  initialClassType?: ClassType;
  // 현재 과목 ID (생물학이면 단일 테마 사용)
  courseId?: CourseId | null;
}

/**
 * 테마 제공자 컴포넌트
 * React Context를 통해 전역 테마 상태 관리
 */
export function ThemeProvider({
  children,
  initialClassType,
  courseId = null,
}: ThemeProviderProps) {
  // 반 타입 상태 (초기값: A반)
  const [classType, setClassTypeState] = useState<ClassType>(
    initialClassType || 'A'
  );
  // 클라이언트 마운트 여부
  const [mounted, setMounted] = useState(false);

  // 생물학 과목 여부
  const isBiologyCourse = courseId === 'biology';

  // 클라이언트에서 로컬 스토리지 값 로드
  useEffect(() => {
    setMounted(true);

    if (!initialClassType) {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && ['A', 'B', 'C', 'D'].includes(stored)) {
        setClassTypeState(stored as ClassType);
      }
    }
  }, [initialClassType]);

  // initialClassType prop 변경 시 상태 업데이트
  useEffect(() => {
    if (initialClassType) {
      setClassTypeState(initialClassType);
    }
  }, [initialClassType]);

  // 반 타입 변경 핸들러
  const setClassType = useCallback((newClassType: ClassType) => {
    setClassTypeState(newClassType);
    localStorage.setItem(STORAGE_KEY, newClassType);
  }, []);

  // 현재 테마 계산
  // 생물학: 단일 테마 (biologyTheme)
  // 병태생리학/미생물학: 반별 테마
  const theme = useMemo(() => {
    if (isBiologyCourse) {
      return biologyTheme;
    }
    return getTheme(classType);
  }, [classType, isBiologyCourse]);

  // 모든 반이 밝은 배경이므로 라이트 모드
  const isDarkMode = false;

  // CSS 변수를 document에 적용
  useEffect(() => {
    if (!mounted) return;

    const cssVariables = themeToCssVariables(theme);
    const root = document.documentElement;

    // CSS 변수 설정
    Object.entries(cssVariables).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    // 다크/라이트 모드 클래스 설정
    if (isDarkMode) {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }

    // 반 타입 data attribute 설정 (CSS 선택자용)
    root.setAttribute('data-class-type', classType);

    // 과목 data attribute 설정 (CSS 선택자용)
    if (courseId) {
      root.setAttribute('data-course', courseId);
    }
  }, [theme, isDarkMode, classType, courseId, mounted]);

  // 컨텍스트 값 메모이제이션
  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme,
      classType,
      setClassType,
      isDarkMode,
      courseId,
      isBiologyCourse,
    }),
    [theme, classType, setClassType, isDarkMode, courseId, isBiologyCourse]
  );

  // 서버 사이드 렌더링 시 기본 테마 스타일 적용
  // hydration mismatch 방지를 위해 mounted 전에는 기본값 사용
  const currentTheme = mounted ? theme : (isBiologyCourse ? biologyTheme : defaultTheme);

  return (
    <ThemeContext.Provider value={contextValue}>
      {/*
        인라인 스타일로 CSS 변수 초기값 설정
        서버 렌더링 시에도 스타일이 적용되도록 함
      */}
      <div
        style={{
          // CSS 변수 초기값
          ['--theme-background' as string]: currentTheme.colors.background,
          ['--theme-background-secondary' as string]: currentTheme.colors.backgroundSecondary,
          ['--theme-accent' as string]: currentTheme.colors.accent,
          ['--theme-accent-light' as string]: currentTheme.colors.accentLight,
          ['--theme-text' as string]: currentTheme.colors.text,
          ['--theme-text-secondary' as string]: currentTheme.colors.textSecondary,
          ['--theme-border' as string]: currentTheme.colors.border,
        }}
        className="min-h-screen bg-theme-background text-theme-text"
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
