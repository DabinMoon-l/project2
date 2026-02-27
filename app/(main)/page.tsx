'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useHomeOverlay } from '@/lib/contexts';

/**
 * `/` 직접 접근 시 → 오버레이 열기 + 퀴즈 탭으로 리다이렉트
 * (로그인 후 리다이렉트 등)
 */
export default function HomePage() {
  const { isProfessor } = useUser();
  const { open, isOpen } = useHomeOverlay();
  const router = useRouter();

  useEffect(() => {
    if (isProfessor) {
      router.replace('/professor');
      return;
    }
    if (!isOpen) open();
    router.replace('/quiz', { scroll: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
