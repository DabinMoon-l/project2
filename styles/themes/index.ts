/**
 * 반별 테마 시스템
 * 각 반(A, B, C, D)에 대한 색상 테마 정의
 */

// 반 타입 정의
export type ClassType = 'A' | 'B' | 'C' | 'D';

// 테마 색상 구조 정의
export interface ThemeColors {
  // 메인 배경색
  background: string;
  // 보조 배경색
  backgroundSecondary: string;
  // 강조색
  accent: string;
  // 연한 강조색
  accentLight: string;
  // 기본 텍스트 색상
  text: string;
  // 보조 텍스트 색상
  textSecondary: string;
  // 테두리 색상
  border: string;
}

// 테마 메타데이터 정의
export interface ThemeMeta {
  // 반 이름
  name: string;
  // 분위기 설명
  mood: string;
}

// 전체 테마 구조 정의
export interface Theme {
  id: ClassType;
  meta: ThemeMeta;
  colors: ThemeColors;
}

// A반 테마 - 버건디 & 골드 (따뜻하고 용맹함)
const themeA: Theme = {
  id: 'A',
  meta: {
    name: 'A반',
    mood: '따뜻하고 용맹함',
  },
  colors: {
    background: '#4A0E0E',
    backgroundSecondary: '#6B1A1A',
    accent: '#D4AF37',
    accentLight: '#E8D08A',
    text: '#FFFFFF',
    textSecondary: '#F5E6E6',
    border: '#8B2D2D',
  },
};

// B반 테마 - 다크 브라운 & 머스타드 (후플푸프 스타일, 따뜻하고 충성스러움)
const themeB: Theme = {
  id: 'B',
  meta: {
    name: 'B반',
    mood: '따뜻하고 충성스러움',
  },
  colors: {
    background: '#3D2B1F',
    backgroundSecondary: '#4A3528',
    accent: '#D4A520',
    accentLight: '#E5B830',
    text: '#F5F5F5',
    textSecondary: '#D4C4B0',
    border: '#5A4030',
  },
};

// C반 테마 - 에메랄드 & 그레이 실버 (고급스럽고 차분함)
const themeC: Theme = {
  id: 'C',
  meta: {
    name: 'C반',
    mood: '고급스럽고 차분함',
  },
  colors: {
    background: '#0D3D2E',
    backgroundSecondary: '#165A45',
    accent: '#8A8D93',
    accentLight: '#A5A8AD',
    text: '#FFFFFF',
    textSecondary: '#B8D4CA',
    border: '#2E7A63',
  },
};

// D반 테마 - 다크 네이비 & 브론즈 (지적이고 우아함)
const themeD: Theme = {
  id: 'D',
  meta: {
    name: 'D반',
    mood: '지적이고 우아함',
  },
  colors: {
    background: '#0E1927',
    backgroundSecondary: '#1A2A3D',
    accent: '#907355',
    accentLight: '#A68A70',
    text: '#FFFFFF',
    textSecondary: '#B8C4D9',
    border: '#2A3D52',
  },
};

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
  // camelCase를 kebab-case로 변환
  return `--theme-${colorKey.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
}

// 테마를 CSS 변수 객체로 변환
export function themeToCssVariables(theme: Theme): Record<string, string> {
  const variables: Record<string, string> = {};

  (Object.keys(theme.colors) as Array<keyof ThemeColors>).forEach((key) => {
    variables[getCssVariableName(key)] = theme.colors[key];
  });

  return variables;
}

// 모든 테마 목록 (선택 UI용)
export const themeList: Theme[] = [themeA, themeB, themeC, themeD];
