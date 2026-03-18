'use client';

import { motion } from 'framer-motion';

/** 객관식 선지 에디터 Props */
interface MultipleChoiceEditorProps {
  /** 선지 목록 */
  choices: string[];
  /** 단일 정답 인덱스 */
  answerIndex: number | null;
  /** 복수 정답 인덱스 배열 */
  answerIndices: number[];
  /** 복수정답 모드 여부 */
  isMultipleAnswerMode: boolean;
  /** 선지 내용 변경 핸들러 */
  onChoiceChange: (idx: number, value: string) => void;
  /** 선지 추가 핸들러 */
  onAddChoice: () => void;
  /** 선지 삭제 핸들러 */
  onRemoveChoice: (idx: number) => void;
  /** 정답 선택 핸들러 */
  onAnswerSelect: (idx: number) => void;
  /** 복수정답 모드 토글 핸들러 */
  onToggleMultipleMode: () => void;
  /** 에러 메시지 */
  error?: string;
  /** 선지 에러 메시지 */
  choicesError?: string;
}

/**
 * 객관식 선지 에디터
 *
 * 선지 입력, 정답 선택, 추가/삭제, 복수정답 모드 토글을 지원합니다.
 */
export default function MultipleChoiceEditor({
  choices,
  answerIndex,
  answerIndices,
  isMultipleAnswerMode,
  onChoiceChange,
  onAddChoice,
  onRemoveChoice,
  onAnswerSelect,
  onToggleMultipleMode,
  error,
  choicesError,
}: MultipleChoiceEditorProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-bold text-[#1A1A1A]">
          선지 (정답 클릭) - {choices.length}개
          <span className="ml-1 font-normal text-[#8A8578]">· *기울임*</span>
        </label>
        {/* 복수정답 토글 */}
        <button
          type="button"
          onClick={onToggleMultipleMode}
          className={`
            px-3 py-1 text-xs font-bold border transition-colors
            ${isMultipleAnswerMode
              ? 'bg-[#1A6B1A] text-[#F5F0E8] border-[#1A6B1A]'
              : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
            }
          `}
        >
          복수정답 {isMultipleAnswerMode ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* 복수정답 안내 */}
      {isMultipleAnswerMode && (
        <p className="text-xs text-[#1A6B1A] mb-2">
          복수정답 모드: 2개 이상의 정답을 선택하세요
        </p>
      )}

      <div className="space-y-2">
        {choices.map((choice, index) => {
          // 복수정답 모드에서는 answerIndices로, 아니면 answerIndex로 체크
          const isSelected = isMultipleAnswerMode
            ? answerIndices.includes(index)
            : answerIndex === index;

          return (
            <div key={`choice-${index}`} className="flex items-center gap-2">
              {/* 정답 체크 버튼 */}
              <motion.button
                type="button"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => onAnswerSelect(index)}
                className={`
                  w-8 h-8 flex items-center justify-center
                  text-sm font-bold border-2
                  transition-all duration-200
                  ${
                    isSelected
                      ? isMultipleAnswerMode
                        ? 'bg-[#1A6B1A] text-[#F5F0E8] border-[#1A6B1A]'
                        : 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                      : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                  }
                `}
              >
                {index + 1}
              </motion.button>

              {/* 선지 입력 */}
              <input
                type="text"
                value={choice}
                onChange={(e) => onChoiceChange(index, e.target.value)}
                placeholder={`선지 ${index + 1}`}
                className={`
                  flex-1 px-3 py-2 text-sm border-2 bg-[#F5F0E8]
                  transition-colors duration-200
                  focus:outline-none
                  ${
                    isSelected
                      ? isMultipleAnswerMode
                        ? 'border-[#1A6B1A] bg-[#E8F5E9]'
                        : 'border-[#1A1A1A] bg-[#EDEAE4]'
                      : 'border-[#1A1A1A]'
                  }
                `}
              />

              {/* 선지 삭제 버튼 (2개 초과일 때만) */}
              {choices.length > 2 && (
                <button
                  type="button"
                  onClick={() => onRemoveChoice(index)}
                  className="w-8 h-8 flex items-center justify-center text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* 선지 추가 버튼 (8개 미만일 때만) */}
      {choices.length < 8 && (
        <button
          type="button"
          onClick={onAddChoice}
          className="mt-2 w-full py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
        >
          + 선지 추가 (최대 8개)
        </button>
      )}

      {choicesError && (
        <p className="mt-2 text-sm text-[#8B1A1A]">{choicesError}</p>
      )}
      {error && (
        <p className="mt-2 text-sm text-[#8B1A1A]">{error}</p>
      )}
    </div>
  );
}
