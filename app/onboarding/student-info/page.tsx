'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 학적정보 입력 페이지 (더 이상 사용 안 함)
 * 회원가입 시 모든 정보를 입력받으므로 온보딩 불필요.
 */
export default function StudentInfoPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return null;
}
