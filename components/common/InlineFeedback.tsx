'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, addDoc, doc, getDoc, serverTimestamp, db } from '@/lib/repositories';
import { FEEDBACK_TYPES, type FeedbackType } from '@/components/review/types';

interface InlineFeedbackProps {
  /** 문제 ID (questionId) */
  questionId: string;
  /** 퀴즈 ID */
  quizId: string;
  /** 퀴즈 생성자 ID (없으면 Firestore에서 조회) */
  quizCreatorId?: string | null;
  /** 현재 사용자 ID */
  userId: string;
  /** 문제 번호 (1-indexed, 표시용) */
  questionNumber: number;
  /** 이미 피드백 제출했는지 */
  isSubmitted: boolean;
  /** 피드백 제출 후 콜백 */
  onSubmitted: (questionId: string) => void;
}

/**
 * 문제 풀이 중 인라인 피드백 컴포넌트
 * - 느낌표 아이콘 버튼 (문항번호 줄 우측)
 * - 클릭 시 선지 아래에 6가지 피드백 펼침
 */
export function FeedbackIcon({
  isOpen,
  isSubmitted,
  onClick,
}: {
  isOpen: boolean;
  isSubmitted: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={isSubmitted}
      className={`ml-auto flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-xs font-bold transition-colors ${
        isSubmitted
          ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A] cursor-default'
          : isOpen
            ? 'bg-[#1A1A1A] text-[#FFF8E1] border border-[#1A1A1A]'
            : 'bg-[#FFF8E1] text-[#8B6914] border border-[#8B6914]'
      }`}
      aria-label={isSubmitted ? '피드백 완료' : '피드백'}
    >
      {isSubmitted ? '✓' : '!'}
    </button>
  );
}

/**
 * 선지 아래에 표시되는 인라인 피드백 패널
 */
export function InlineFeedbackPanel({
  questionId,
  quizId,
  quizCreatorId,
  userId,
  questionNumber,
  onSubmitted,
  onClose,
}: InlineFeedbackProps & { onClose: () => void }) {
  const [selectedTypes, setSelectedTypes] = useState<Set<FeedbackType>>(new Set());
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const toggleType = (type: FeedbackType) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedTypes.size === 0) return;
    setIsSubmitting(true);
    try {
      // quizCreatorId가 없으면 Firestore에서 조회
      let creatorId = quizCreatorId || null;
      if (!creatorId) {
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (quizDoc.exists()) {
          creatorId = quizDoc.data()?.creatorId || null;
        }
      }

      // 선택된 타입마다 피드백 문서 생성
      const types = Array.from(selectedTypes);
      await Promise.all(types.map(type =>
        addDoc(collection(db, 'questionFeedbacks'), {
          questionId,
          quizId,
          quizCreatorId: creatorId,
          userId,
          questionNumber,
          type,
          content,
          createdAt: serverTimestamp(),
        })
      ));

      setIsDone(true);
      // 잠시 체크 표시 후 닫기
      setTimeout(() => onSubmitted(questionId), 800);
    } catch (err) {
      console.error('피드백 제출 실패:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <div className="mt-3 p-3 border-2 border-[#1A1A1A] bg-[#EDEAE4]">
        {/* 피드백 타입 선택 (2×3 그리드, 중복 선택 가능) */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="grid grid-cols-2 gap-2 w-fit">
            {FEEDBACK_TYPES.map(({ type, label }) => (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`py-2 px-5 text-xs font-bold border transition-all rounded whitespace-nowrap ${
                  selectedTypes.has(type)
                    ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                    : 'border-[#8B6914] bg-[#FFF8E1] text-[#8B6914]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 추가 의견 + 보내기 */}
        <AnimatePresence>
          {selectedTypes.size > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="추가 의견 (선택)"
                rows={2}
                maxLength={200}
                className="w-full mt-2 p-2 border border-[#8B6914] bg-white/60 focus:outline-none resize-none text-xs rounded"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={onClose}
                  className="flex-1 py-1.5 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] rounded"
                >
                  취소
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || isDone}
                  className={`flex-1 py-1.5 text-xs font-bold border border-[#1A1A1A] rounded transition-colors ${
                    isDone
                      ? 'bg-[#1A6B1A] text-[#F5F0E8] border-[#1A6B1A]'
                      : 'bg-[#1A1A1A] text-[#F5F0E8]'
                  }`}
                >
                  {isDone ? '✓' : isSubmitting ? '전송 중...' : '보내기'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
