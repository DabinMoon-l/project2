'use client';

/**
 * 퀴즈 패널 컨테이너 (가로모드 3쪽 잠금용)
 *
 * 퀴즈 4단계(quiz → result → feedback → exp)를 router.push 없이
 * 내부 state로 관리. mount 시 패널 잠금, unmount 시 해제.
 */

import { useState, useCallback } from 'react';
import { useClosePanel, usePanelLock, usePanelStatePreservation } from '@/lib/contexts/DetailPanelContext';
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
  const closePanel = useClosePanel();
  usePanelLock();

  // 승격 시 stage 보존
  usePanelStatePreservation(
    'quiz-panel',
    () => ({ stage }),
    (saved) => { if (saved.stage) setStage(saved.stage as QuizStage); },
  );

  const handleNavigate = useCallback((path: string) => {
    if (path.includes('/result')) {
      setStage('result');
    } else if (path.includes('/feedback')) {
      setStage('feedback');
    } else if (path.includes('/exp')) {
      setStage('exp');
    } else {
      closePanel();
    }
  }, [closePanel]);

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
