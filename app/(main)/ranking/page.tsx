'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 랭킹 페이지 → 홈으로 리다이렉트
 * 랭킹은 이제 홈 바텀시트로 표시됩니다.
 */
export default function RankingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return null;
}
