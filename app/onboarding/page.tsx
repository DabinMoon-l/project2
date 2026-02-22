'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 온보딩 메인 페이지 (더 이상 사용 안 함)
 * 회원가입 시 닉네임까지 입력받으므로 온보딩 불필요.
 */
export default function OnboardingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return null;
}
