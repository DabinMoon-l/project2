'use client';

import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from './ThemeProvider';

/**
 * 테마 훅
 * 현재 테마 정보와 테마 변경 함수를 반환
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { theme, classType, setClassType, isDarkMode } = useTheme();
 *
 *   return (
 *     <div style={{ background: theme.colors.background }}>
 *       <p>현재 반: {classType}</p>
 *       <button onClick={() => setClassType('B')}>B반으로 변경</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error(
      'useTheme must be used within a ThemeProvider. ' +
      'Wrap your app with <ThemeProvider> in your root layout.'
    );
  }

  return context;
}

/**
 * 테마 색상만 가져오는 훅 (편의용)
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const colors = useThemeColors();
 *   return <div style={{ color: colors.accent }}>강조 텍스트</div>;
 * }
 * ```
 */
export function useThemeColors() {
  const { theme } = useTheme();
  return theme.colors;
}

/**
 * 현재 반 타입만 가져오는 훅 (편의용)
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const classType = useClassType();
 *   return <p>현재 반: {classType}반</p>;
 * }
 * ```
 */
export function useClassType() {
  const { classType } = useTheme();
  return classType;
}

/**
 * 다크 모드 여부만 가져오는 훅 (편의용)
 * B반(크림 배경)만 라이트 모드
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isDarkMode = useIsDarkMode();
 *   return <p>{isDarkMode ? '다크 모드' : '라이트 모드'}</p>;
 * }
 * ```
 */
export function useIsDarkMode() {
  const { isDarkMode } = useTheme();
  return isDarkMode;
}
