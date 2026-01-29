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
  defaultTheme,
  getTheme,
  themeToCssVariables,
} from './index';

/**
 * 테마 컨텍스트 값 타입
 */
export interface ThemeContextValue {
  // 현재 테마
  theme: Theme;
  // 현재 반 타입
  classType: ClassType;
  // 테마 변경 함수
  setClassType: (classType: ClassType) => void;
  // 다크 모드 여부 (B반은 라이트 모드)
  isDarkMode: boolean;
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
}

/**
 * 테마 제공자 컴포넌트
 * React Context를 통해 전역 테마 상태 관리
 */
export function ThemeProvider({
  children,
  initialClassType,
}: ThemeProviderProps) {
  // 반 타입 상태 (초기값: A반)
  const [classType, setClassTypeState] = useState<ClassType>(
    initialClassType || 'A'
  );
  // 클라이언트 마운트 여부
  const [mounted, setMounted] = useState(false);

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

  // 반 타입 변경 핸들러
  const setClassType = useCallback((newClassType: ClassType) => {
    setClassTypeState(newClassType);
    localStorage.setItem(STORAGE_KEY, newClassType);
  }, []);

  // 현재 테마 계산
  const theme = useMemo(() => getTheme(classType), [classType]);

  // B반은 밝은 배경이므로 라이트 모드
  const isDarkMode = classType !== 'B';

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
  }, [theme, isDarkMode, classType, mounted]);

  // 컨텍스트 값 메모이제이션
  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme,
      classType,
      setClassType,
      isDarkMode,
    }),
    [theme, classType, setClassType, isDarkMode]
  );

  // 서버 사이드 렌더링 시 기본 테마 스타일 적용
  // hydration mismatch 방지를 위해 mounted 전에는 기본값 사용
  const currentTheme = mounted ? theme : defaultTheme;

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
