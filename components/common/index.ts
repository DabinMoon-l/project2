// 공통 UI 컴포넌트 모음
// 용사 퀴즈 앱의 공통 UI 컴포넌트들을 한 곳에서 export합니다.

// Button 컴포넌트
export { default as Button } from './Button';

// Header 컴포넌트
export { default as Header } from './Header';

// Input 컴포넌트
export { default as Input } from './Input';

// Card 컴포넌트 및 하위 컴포넌트
export { default as Card } from './Card';
export { CardHeader, CardTitle, CardContent, CardFooter } from './Card';

// Modal 컴포넌트
export { default as Modal } from './Modal';

// BottomSheet 컴포넌트
export { default as BottomSheet } from './BottomSheet';

// Skeleton 컴포넌트 및 프리셋
export { default as Skeleton } from './Skeleton';
export {
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonList,
  SkeletonQuizCard,
} from './Skeleton';

// Navigation 컴포넌트
export { default as Navigation } from './Navigation';
export type { UserRole } from './Navigation';

// ProfileDrawer 컴포넌트
export { default as ProfileDrawer } from './ProfileDrawer';

// NotificationProvider 컴포넌트
export { default as NotificationProvider, useNotificationContext } from './NotificationProvider';

// NotificationPrompt 컴포넌트
export { default as NotificationPrompt } from './NotificationPrompt';

// ErrorBoundary 컴포넌트
export { ErrorBoundary, ErrorFallback, SectionErrorBoundary } from './ErrorBoundary';

// WebVitalsReporter 컴포넌트
export { default as WebVitalsReporter } from './WebVitalsReporter';

// RibbonBanner 컴포넌트 (빈티지 리본 스타일)
export { default as RibbonBanner, SubRibbon } from './RibbonBanner';
