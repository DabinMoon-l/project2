'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useHomeOverlay } from '@/lib/contexts';

/**
 * `/professor` 직접 접근 시 → 오버레이 열기 + 통계 탭으로 리다이렉트
 */
export default function ProfessorHomePage() {
  const { open, isOpen } = useHomeOverlay();
  const router = useRouter();

  useEffect(() => {
    if (!isOpen) open();
    router.replace('/professor/stats', { scroll: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
