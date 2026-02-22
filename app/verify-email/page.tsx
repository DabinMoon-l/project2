/**
 * 이메일 인증 페이지 (더 이상 사용 안 함)
 * 학번 기반 인증으로 전환되어 로그인 페이지로 리다이렉트
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function VerifyEmailPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/login');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-gray-500">리다이렉트 중...</p>
    </div>
  );
}
