'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BottomSheet } from '@/components/common';
import { useThemeColors } from '@/styles/themes/useTheme';

/**
 * 피드백 타입
 */
export type FeedbackType = 'unclear' | 'wrong' | 'typo' | 'other';

/**
 * 피드백 데이터 타입
 */
export interface QuestionFeedback {
  /** 문제 ID */
  questionId: string;
  /** 피드백 유형 */
  type: FeedbackType;
  /** 피드백 내용 */
  content: string;
}

/**
 * InstantFeedbackButton Props 타입
 */
interface InstantFeedbackButtonProps {
  /** 문제 ID */
  questionId: string;
  /** 피드백 제출 핸들러 */
  onSubmit: (feedback: QuestionFeedback) => void;
}

// 피드백 유형 옵션
const feedbackTypes: { type: FeedbackType; label: string }[] = [
  { type: 'unclear', label: '문제가 이해가 안 돼요' },
  { type: 'wrong', label: '정답이 틀린 것 같아요' },
  { type: 'typo', label: '오타가 있어요' },
  { type: 'other', label: '기타 의견' },
];

/**
 * 즉시 피드백 버튼 컴포넌트
 *
 * 문제에 대한 피드백을 바로 남길 수 있는 버튼입니다.
 * 클릭 시 바텀시트가 열리고 피드백 유형과 내용을 입력할 수 있습니다.
 *
 * @example
 * ```tsx
 * <InstantFeedbackButton
 *   questionId="q1"
 *   onSubmit={(feedback) => handleFeedback(feedback)}
 * />
 * ```
 */
export default function InstantFeedbackButton({
  questionId,
  onSubmit,
}: InstantFeedbackButtonProps) {
  const colors = useThemeColors();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<FeedbackType | null>(null);
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // 바텀시트 열기
  const handleOpen = () => {
    if (isSubmitted) return; // 이미 제출한 경우
    setIsOpen(true);
  };

  // 바텀시트 닫기
  const handleClose = () => {
    setIsOpen(false);
    // 상태 초기화
    setTimeout(() => {
      setSelectedType(null);
      setContent('');
    }, 300);
  };

  // 피드백 제출
  const handleSubmit = async () => {
    if (!selectedType) return;

    setIsSubmitting(true);

    try {
      await onSubmit({
        questionId,
        type: selectedType,
        content,
      });

      setIsSubmitted(true);
      handleClose();
    } catch (error) {
      console.error('피드백 제출 실패:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* 피드백 버튼 */}
      <motion.button
        whileHover={!isSubmitted ? { scale: 1.1 } : undefined}
        whileTap={!isSubmitted ? { scale: 0.9 } : undefined}
        onClick={handleOpen}
        disabled={isSubmitted}
        className={`
          w-10 h-10
          flex items-center justify-center
          border-2 transition-all duration-200
          ${isSubmitted
            ? 'bg-[#E8F5E9] border-[#1A6B1A] cursor-default'
            : 'bg-[#FFF8E1] border-[#8B6914] hover:bg-[#FFECB3]'
          }
        `}
        aria-label={isSubmitted ? '피드백 완료' : '문제에 대한 피드백 남기기'}
      >
        {isSubmitted ? (
          <motion.svg
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-5 h-5 text-[#1A6B1A]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </motion.svg>
        ) : (
          <span className="text-lg font-bold text-[#8B6914]" role="img" aria-hidden="true">
            !
          </span>
        )}
      </motion.button>

      {/* 피드백 바텀시트 */}
      <BottomSheet
        isOpen={isOpen}
        onClose={handleClose}
        title="문제 피드백"
        height="auto"
      >
        <div className="space-y-4">
          {/* 피드백 유형 선택 */}
          <div>
            <p className="text-sm text-[#5C5C5C] mb-3">
              문제에 어떤 문제가 있나요?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {feedbackTypes.map(({ type, label }) => (
                <motion.button
                  key={type}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedType(type)}
                  className={`
                    p-4 border-2 transition-all duration-200
                    flex items-center justify-center text-center
                    min-h-[60px]
                    ${selectedType === type
                      ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                      : 'border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]'
                    }
                  `}
                >
                  <span className="text-base font-bold">{label}</span>
                </motion.button>
              ))}
            </div>
          </div>

          {/* 추가 내용 입력 */}
          <AnimatePresence>
            {selectedType && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <label className="block text-sm text-[#5C5C5C] mb-2">
                  추가 의견 (선택)
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="자세한 내용을 적어주세요"
                  rows={3}
                  maxLength={200}
                  className="w-full p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] focus:outline-none resize-none text-sm text-[#1A1A1A] placeholder:text-[#5C5C5C]"
                />
                <p className="text-xs text-[#5C5C5C] text-right mt-1">
                  {content.length}/200
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 제출 버튼 */}
          <motion.button
            whileHover={selectedType ? { scale: 1.02 } : undefined}
            whileTap={selectedType ? { scale: 0.98 } : undefined}
            onClick={handleSubmit}
            disabled={!selectedType || isSubmitting}
            className={`
              w-full py-3.5 font-bold text-base border-2
              transition-all duration-200
              ${selectedType
                ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A] hover:bg-[#2A2A2A]'
                : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C] cursor-not-allowed'
              }
            `}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin w-5 h-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                제출 중...
              </span>
            ) : (
              '피드백 보내기'
            )}
          </motion.button>

          <p className="text-xs text-[#5C5C5C] text-center">
            피드백은 익명으로 전달됩니다.
          </p>
        </div>
      </BottomSheet>
    </>
  );
}
