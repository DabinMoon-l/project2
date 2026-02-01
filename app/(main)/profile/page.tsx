'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 프로필 페이지
 * 이제 홈에서 드로어로 접근하므로 리다이렉트
 */
export default function ProfilePage() {
  const router = useRouter();

  useEffect(() => {
    // 홈으로 리다이렉트 (드로어는 홈에서 접근)
    router.replace('/');
  }, [router]);

  return null;
}
