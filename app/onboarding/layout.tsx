'use client';

import { ThemeProvider } from '@/styles/themes/ThemeProvider';

/**
 * 온보딩 레이아웃
 * 온보딩 플로우 전체에 적용되는 레이아웃입니다.
 * ThemeProvider를 통해 반별 테마가 적용됩니다.
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider>
      <div className="min-h-screen">
        {children}
      </div>
    </ThemeProvider>
  );
}
