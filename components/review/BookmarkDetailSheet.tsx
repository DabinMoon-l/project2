'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { PROFESSOR_QUIZ_TYPES } from '@/app/(main)/quiz/quizPageParts';
import { formatQuestionTypes } from '@/components/review/utils';
import type { BookmarkedQuiz } from '@/lib/hooks/useQuizBookmark';

interface Props {
  quiz: BookmarkedQuiz | null;
  isWide: boolean;
  onClose: () => void;
  onAction: () => void;
}

export default function BookmarkDetailSheet({ quiz, isWide, onClose, onAction }: Props) {
  if (!quiz) return null;

  const content = (
    <div className="p-3">
      <h2 className="text-xs font-bold text-[#1A1A1A] mb-2">{quiz.title}</h2>
      {!quiz.hasCompleted && (
        <div className="text-center py-1.5 mb-1.5 border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]">
          <p className="text-[9px] text-[#5C5C5C] mb-0.5">평균 점수</p>
          <p className="text-xl font-black text-[#1A1A1A]">
            {quiz.participantCount > 0 ? <>{(quiz.averageScore ?? 0).toFixed(0)}<span className="text-[10px] font-bold">점</span></> : '-'}
          </p>
        </div>
      )}
      <div className="space-y-1 mb-3">
        <div className="flex justify-between text-[11px]"><span className="text-[#5C5C5C]">문제 수</span><span className="font-bold text-[#1A1A1A]">{quiz.questionCount}문제</span></div>
        <div className="flex justify-between text-[11px]"><span className="text-[#5C5C5C]">참여자</span><span className="font-bold text-[#1A1A1A]">{quiz.participantCount}명</span></div>
        <div className="flex justify-between text-[11px]"><span className="text-[#5C5C5C]">난이도</span><span className="font-bold text-[#1A1A1A]">{quiz.difficulty === 'easy' ? '쉬움' : quiz.difficulty === 'hard' ? '어려움' : '보통'}</span></div>
        <div className="flex justify-between text-[11px]"><span className="text-[#5C5C5C]">문제 유형</span><span className="font-bold text-[#1A1A1A]">{formatQuestionTypes(quiz.oxCount || 0, quiz.multipleChoiceCount || 0, quiz.subjectiveCount || 0)}</span></div>
        <div className="flex justify-between text-[11px]"><span className="text-[#5C5C5C]">제작자</span><span className="font-bold text-[#1A1A1A]">{quiz.type && PROFESSOR_QUIZ_TYPES.has(quiz.type) ? '교수님' : (quiz.creatorNickname || '익명')}</span></div>
        {quiz.hasCompleted && (
          <>
            <div className="flex justify-between text-[11px]"><span className="text-[#5C5C5C]">평균 점수</span><span className="font-bold text-[#1A1A1A]">{quiz.participantCount > 0 ? `${(quiz.averageScore ?? 0).toFixed(0)}점` : '-'}</span></div>
            <div className="py-1.5 border-t border-[#A0A0A0]">
              <div className="flex items-center justify-center gap-2">
                <span className="text-xl font-black text-[#1A1A1A]">{quiz.myScore !== undefined ? quiz.myScore : '-'}</span>
                <span className="text-xs text-[#5C5C5C]">/</span>
                <span className="text-2xl font-black text-[#1A1A1A]">{quiz.myFirstReviewScore !== undefined ? quiz.myFirstReviewScore : '-'}</span>
              </div>
              <div className="flex items-center justify-center gap-6 mt-0.5">
                <span className="text-[9px] text-[#5C5C5C]">퀴즈</span>
                <span className="text-[9px] text-[#5C5C5C]">복습</span>
              </div>
            </div>
          </>
        )}
        {quiz.tags && quiz.tags.length > 0 && (
          <div className="pt-1.5 border-t border-[#A0A0A0]">
            <div className="flex flex-wrap gap-1">
              {quiz.tags.map((tag) => (<span key={tag} className="px-1 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-[10px] font-medium">#{tag}</span>))}
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 py-1.5 text-[11px] font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg">닫기</button>
        <button onClick={onAction} className="flex-1 py-1.5 text-[11px] font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg">{quiz.hasCompleted ? '복습하기' : '시작하기'}</button>
      </div>
    </div>
  );

  // 가로모드: 2쪽 바텀시트
  if (isWide) {
    return (
      <AnimatePresence>
        <div key="backdrop" className="fixed inset-0 z-[60]" style={{ left: 'var(--modal-left, 240px)', right: 'var(--modal-right, 0px)' }} onClick={onClose} />
        <motion.div
          key="sheet"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          className="fixed z-[61] bg-[#F5F0E8] rounded-t-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.15)] border-t-2 border-x-2 border-[#1A1A1A]"
          style={{ left: 'var(--modal-left, 240px)', right: 'var(--modal-right, 0px)', bottom: 'var(--kb-offset, 0px)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center pt-2 pb-1"><div className="w-8 h-1 rounded-full bg-[#D4CFC4]" /></div>
          {content}
        </motion.div>
      </AnimatePresence>
    );
  }

  // 모바일: 센터 모달
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.88 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.88 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] rounded-2xl"
      >
        {content}
      </motion.div>
    </div>
  );
}
