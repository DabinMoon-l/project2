/**
 * 빈티지 신문 스타일 테마 시스템
 *
 * 해리포터 느낌의 클래식한 디자인
 * - 크림/베이지 배경
 * - 세리프 폰트
 * - 각 반별 미묘한 강조색
 */

export type ClassType = 'A' | 'B' | 'C' | 'D';
export type CourseThemeType = 'biology' | ClassType;

export interface ThemeColors {
  // 배경
  background: string;
  backgroundSecondary: string;
  backgroundCard: string;
  // 텍스트
  text: string;
  textSecondary: string;
  // 테두리
  border: string;
  borderDark: string;
  // 강조색 (반별)
  accent: string;
  accentLight: string;
}

export interface ThemeMeta {
  name: string;
  mood: string;
}

export interface Theme {
  id: ClassType;
  meta: ThemeMeta;
  colors: ThemeColors;
}

// 빈티지 크림 배경 (공통)
const vintageBase = {
  background: '#F5F0E8',
  backgroundSecondary: '#EBE5D9',
  backgroundCard: '#FDFBF7',
  text: '#1A1A1A',
  textSecondary: '#5C5C5C',
  border: '#D4CFC4',
  borderDark: '#1A1A1A',
};

/**
 * A반 테마 - 버건디/레드 강조
 */
const themeA: Theme = {
  id: 'A',
  meta: {
    name: 'A반',
    mood: '열정적이고 용맹함',
  },
  colors: {
    ...vintageBase,
    accent: '#8B1A1A',
    accentLight: '#D4A5A5',
  },
};

/**
 * B반 테마 - 골드/옐로우 강조
 */
const themeB: Theme = {
  id: 'B',
  meta: {
    name: 'B반',
    mood: '따뜻하고 밝음',
  },
  colors: {
    ...vintageBase,
    accent: '#B8860B',
    accentLight: '#E8D5A3',
  },
};

/**
 * C반 테마 - 에메랄드/그린 강조
 */
const themeC: Theme = {
  id: 'C',
  meta: {
    name: 'C반',
    mood: '차분하고 안정적',
  },
  colors: {
    ...vintageBase,
    accent: '#1D5D4A',
    accentLight: '#A8D4C5',
  },
};

/**
 * D반 테마 - 네이비/블루 강조
 */
const themeD: Theme = {
  id: 'D',
  meta: {
    name: 'D반',
    mood: '지적이고 신뢰감',
  },
  colors: {
    ...vintageBase,
    accent: '#1E3A5F',
    accentLight: '#A8C4E0',
  },
};

/**
 * 생물학 테마 - 자연/생명의 초록색 (단일 테마)
 * 모든 반이 동일한 테마 사용
 */
export interface BiologyTheme {
  id: 'biology';
  meta: ThemeMeta;
  colors: ThemeColors;
}

const themeBiology: BiologyTheme = {
  id: 'biology',
  meta: {
    name: '생물학',
    mood: '생명의 신비',
  },
  colors: {
    ...vintageBase,
    accent: '#2E7D32', // 자연 녹색
    accentLight: '#A5D6A7',
  },
};

// 생물학 테마 export
export const biologyTheme = themeBiology;

// 모든 테마 객체
export const themes: Record<ClassType, Theme> = {
  A: themeA,
  B: themeB,
  C: themeC,
  D: themeD,
};

// 기본 테마 (A반)
export const defaultTheme: Theme = themeA;

// 테마 ID로 테마 가져오기
export function getTheme(classType: ClassType): Theme {
  return themes[classType] || defaultTheme;
}

// CSS 변수 이름 생성 헬퍼
export function getCssVariableName(colorKey: keyof ThemeColors): string {
  return `--theme-${colorKey.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
}

// 테마를 CSS 변수 객체로 변환
export function themeToCssVariables(theme: Theme | BiologyTheme): Record<string, string> {
  const variables: Record<string, string> = {};
  (Object.keys(theme.colors) as Array<keyof ThemeColors>).forEach((key) => {
    variables[getCssVariableName(key)] = theme.colors[key];
  });
  return variables;
}

// 모든 테마 목록
export const themeList: Theme[] = [themeA, themeB, themeC, themeD];

// 반별 강조 색상 (퀵 액세스)
export const classColors: Record<ClassType, string> = {
  A: '#8B1A1A',
  B: '#B8860B',
  C: '#1D5D4A',
  D: '#1E3A5F',
};

// 반별 이름
export const classNames: Record<ClassType, string> = {
  A: 'A반',
  B: 'B반',
  C: 'C반',
  D: 'D반',
};
