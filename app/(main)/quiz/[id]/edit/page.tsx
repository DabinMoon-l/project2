'use client';

import { useCallback } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import EditQuizSheet from '@/components/quiz/EditQuizSheet';

/**
 * 퀴즈 수정 페이지 (직접 URL 접근용)
 * 관리 모드에서는 EditQuizSheet를 직접 오버레이로 사용합니다.
 */
export default function EditQuizPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const quizId = params.id as string;
  const fromManage = searchParams.get('from') === 'manage';

  const handleClose = useCallback(() => {
    if (fromManage) {
      router.push('/quiz?manage=true');
    } else {
      router.push('/quiz');
    }
  }, [router, fromManage]);

  return (
    <AnimatePresence>
      <EditQuizSheet
        quizId={quizId}
        onClose={handleClose}
      />
    </AnimatePresence>
  );
}
