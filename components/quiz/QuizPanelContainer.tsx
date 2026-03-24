'use client';

/**
 * 퀴즈 패널 컨테이너 (가로모드 3쪽 잠금용)
 *
 * 퀴즈 4단계(quiz → result → feedback → exp)를 router.push 없이
 * 내부 state로 관리. mount 시 패널 잠금, unmount 시 해제.
 */

import { useState, useCallback, useEffect } from 'react';
import { useDetailPanel } from '@/lib/contexts/DetailPanelContext';
import QuizPage from '@/app/(main)/quiz/[id]/page';
import QuizResultPage from '@/app/(main)/quiz/[id]/result/page';
import FeedbackPage from '@/app/(main)/quiz/[id]/feedback/page';
import ExpPage from '@/app/(main)/quiz/[id]/exp/page';

type QuizStage = 'quiz' | 'result' | 'feedback' | 'exp';

interface QuizPanelContainerProps {
  quizId: string;
}

export default function QuizPanelContainer({ quizId }: QuizPanelContainerProps) {
  const [stage, setStage] = useState<QuizStage>('quiz');
  const { lockDetail, unlockDetail } = useDetailPanel();

  // mount 시 잠금, unmount 시 해제
  useEffect(() => {
    lockDetail();
    return () => unlockDetail();
  }, [lockDetail, unlockDetail]);

  // 단계 전환 콜백 (각 stage 페이지의 router.push 대체)
  const handleNavigate = useCallback((path: string) => {
    if (path.includes('/result')) {
      setStage('result');
    } else if (path.includes('/feedback')) {
      setStage('feedback');
    } else if (path.includes('/exp')) {
      setStage('exp');
    } else {
      // /quiz (목록) → 완료, 잠금 해제 (대기 있으면 3쪽 승격, 없으면 닫기)
      unlockDetail(true);
    }
  }, [unlockDetail]);

  switch (stage) {
    case 'quiz':
      return <QuizPage panelQuizId={quizId} onPanelNavigate={handleNavigate} />;
    case 'result':
      return <QuizResultPage panelQuizId={quizId} onPanelNavigate={handleNavigate} />;
    case 'feedback':
      return <FeedbackPage panelQuizId={quizId} onPanelNavigate={handleNavigate} />;
    case 'exp':
      return <ExpPage panelQuizId={quizId} onPanelNavigate={handleNavigate} />;
  }
}
