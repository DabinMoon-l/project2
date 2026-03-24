'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ExpandModal } from '@/components/common';
import { formatQuestionTypes } from '@/components/review/utils';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { useDetailPanel } from '@/lib/contexts';
import FolderDetailPage from '@/app/(main)/review/[type]/[id]/page';
import type { LearningQuiz } from '@/lib/hooks/useLearningQuizzes';
import type { SourceRect } from '@/lib/hooks/useExpandSource';

interface Props {
  quiz: LearningQuiz | null;
  sourceRect: SourceRect | null;
  onClose: () => void;
}

export default function ReviewLibraryDetailModal({ quiz, sourceRect, onClose }: Props) {
  const router = useRouter();
  const isWide = useWideMode();
  const { openDetail, replaceDetail, isDetailOpen, isLocked } = useDetailPanel();

  const openLibraryReview = useCallback((quizId: string, autoStart?: string) => {
    if (isWide) {
      const action = isDetailOpen ? replaceDetail : openDetail;
      action(<FolderDetailPage panelType="library" panelId={quizId} panelAutoStart={autoStart} />);
    } else {
      const qs = autoStart ? `?autoStart=${autoStart}` : '';
      router.push(`/review/library/${quizId}${qs}`);
    }
  }, [isWide, isLocked, isDetailOpen, openDetail, replaceDetail, router]);

  return (
    <ExpandModal
      isOpen={!!quiz}
      onClose={onClose}
      sourceRect={sourceRect}
      className="w-full max-w-[300px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-2xl"
      zIndex={60}
    >
      {quiz && (
        <>
          <h2 className="text-sm font-bold text-[#1A1A1A] mb-3">
            {quiz.title}
          </h2>

          <div className="space-y-1.5 mb-4">
            <div className="flex justify-between text-xs">
              <span className="text-[#5C5C5C]">문제 수</span>
              <span className="font-bold text-[#1A1A1A]">{quiz.questionCount}문제</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#5C5C5C]">난이도</span>
              <span className="font-bold text-[#1A1A1A]">
                {quiz.difficulty === 'easy' ? '쉬움' :
                 quiz.difficulty === 'hard' ? '어려움' : '보통'}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#5C5C5C]">문제 유형</span>
              <span className="font-bold text-[#1A1A1A]">
                {formatQuestionTypes(
                  quiz.oxCount || 0,
                  quiz.multipleChoiceCount || 0,
                  quiz.subjectiveCount || 0
                )}
              </span>
            </div>
            {/* 점수 표시: 퀴즈 점수 / 첫번째 복습 점수 */}
            <div className="py-2 border-t border-[#A0A0A0]">
              <div className="flex items-center justify-center gap-2">
                <span className="text-3xl font-black text-[#1A1A1A]">
                  {quiz.myScore !== undefined ? quiz.myScore : quiz.score}
                </span>
                <span className="text-sm text-[#5C5C5C]">/</span>
                <span className="text-3xl font-black text-[#1A1A1A]">
                  {quiz.myFirstReviewScore !== undefined ? quiz.myFirstReviewScore : '-'}
                </span>
              </div>
              <div className="flex items-center justify-center gap-6 mt-0.5">
                <span className="text-[10px] text-[#5C5C5C]">퀴즈</span>
                <span className="text-[10px] text-[#5C5C5C]">복습</span>
              </div>
            </div>
            {quiz.tags && quiz.tags.length > 0 && (
              <div className="pt-2 border-t border-[#A0A0A0]">
                <div className="flex flex-wrap gap-1.5">
                  {quiz.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-medium"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
            >
              닫기
            </button>
            <button
              onClick={() => {
                const quizId = quiz.id;
                onClose();
                openLibraryReview(quizId, 'all');
              }}
              className="flex-1 py-2 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg"
            >
              복습하기
            </button>
          </div>
        </>
      )}
    </ExpandModal>
  );
}
