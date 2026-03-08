'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, addDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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
  const [selectedType, setSelectedType] = useState<FeedbackType | null>(null);
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedType) return;
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

      await addDoc(collection(db, 'questionFeedbacks'), {
        questionId,
        quizId,
        quizCreatorId: creatorId,
        userId,
        questionNumber,
        type: selectedType,
        content,
        createdAt: serverTimestamp(),
      });

      onSubmitted(questionId);
      onClose();
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
      <div className="mt-3 p-3 border-2 border-[#8B6914] bg-[#FFF8E1]">
        {/* 피드백 타입 선택 (3×2 그리드) */}
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {FEEDBACK_TYPES.map(({ type, label }) => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              className={`py-1.5 px-1 text-[10px] font-bold border transition-all rounded ${
                selectedType === type
                  ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                  : 'border-[#8B6914] bg-[#FFF8E1] text-[#8B6914]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 추가 의견 + 보내기 */}
        <AnimatePresence>
          {selectedType && (
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
                className="w-full p-2 border border-[#8B6914] bg-white/60 focus:outline-none resize-none text-xs rounded mb-2"
              />
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 py-1.5 text-xs font-bold border border-[#8B6914] text-[#8B6914] rounded"
                >
                  취소
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="flex-1 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] border border-[#1A1A1A] rounded"
                >
                  {isSubmitting ? '전송 중...' : '보내기'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
