'use client';

import { motion } from 'framer-motion';

/** OX 정답 선택 에디터 Props */
interface OXAnswerEditorProps {
  /** 현재 선택된 정답 인덱스 (0=O, 1=X, -1=미선택) */
  answerIndex: number | null;
  /** 정답 변경 핸들러 */
  onChange: (index: number) => void;
  /** 에러 메시지 */
  error?: string;
}

/**
 * OX 정답 선택 에디터
 *
 * O / X 두 버튼 중 하나를 클릭하여 정답을 선택합니다.
 */
export default function OXAnswerEditor({ answerIndex, onChange, error }: OXAnswerEditorProps) {
  return (
    <div>
      <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
        정답 선택
      </label>
      <div className="flex gap-4">
        {['O', 'X'].map((option, index) => (
          <motion.button
            key={option}
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onChange(index)}
            className={`
              flex-1 py-4 font-bold text-3xl border-2
              transition-all duration-200
              ${
                answerIndex === index
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
              }
            `}
          >
            {option}
          </motion.button>
        ))}
      </div>
      {error && (
        <p className="mt-2 text-sm text-[#8B1A1A]">{error}</p>
      )}
    </div>
  );
}
