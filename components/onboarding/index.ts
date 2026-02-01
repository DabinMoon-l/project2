// 온보딩 관련 컴포넌트 모음
// 온보딩 플로우에서 사용되는 컴포넌트들을 한 곳에서 export합니다.

// 단계 표시기 컴포넌트
export { default as StepIndicator, StepLabel, ONBOARDING_STEPS } from './StepIndicator';
export type { OnboardingStep } from './StepIndicator';

// 캐릭터 미리보기 컴포넌트
export { default as CharacterPreview } from './CharacterPreview';
export {
  HAIR_STYLES,
  SKIN_COLORS,
  DEFAULT_CHARACTER_OPTIONS,
} from './CharacterPreview';
export type { CharacterOptions } from './CharacterPreview';
