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

// SwipeBack 컴포넌트 (왼쪽 가장자리 스와이프 → 뒤로가기)
export { default as SwipeBack } from './SwipeBack';

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

// ExpToast 컴포넌트 (EXP 획득 토스트)
export { default as ExpToastProvider, useExpToast } from './ExpToast';

// SplashScreen 컴포넌트 (앱 진입 스플래시)
export { default as SplashScreen } from './SplashScreen';

// ImageViewer 컴포넌트 (이미지 전체화면 뷰어)
export { default as ImageViewer } from './ImageViewer';
