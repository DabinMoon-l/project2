'use client';

/** 단답형 정답 에디터 Props */
interface ShortAnswerEditorProps {
  /** 정답 텍스트 배열 */
  answerTexts: string[];
  /** 정답 변경 핸들러 */
  onAnswerChange: (idx: number, value: string) => void;
  /** 정답 추가 핸들러 */
  onAddAnswer: () => void;
  /** 정답 삭제 핸들러 */
  onRemoveAnswer: (idx: number) => void;
  /** 에러 메시지 */
  error?: string;
}

/**
 * 단답형 정답 에디터
 *
 * 여러 정답을 입력할 수 있으며, 어느 하나만 맞춰도 정답으로 처리됩니다.
 */
export default function ShortAnswerEditor({
  answerTexts,
  onAnswerChange,
  onAddAnswer,
  onRemoveAnswer,
  error,
}: ShortAnswerEditorProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-bold text-[#1A1A1A]">
          정답
        </label>
        <span className="text-xs text-[#5C5C5C]">
          여러 정답 입력 가능 (어느 하나만 맞춰도 정답)
        </span>
      </div>

      {/* 정답 입력 목록 */}
      <div className="space-y-2">
        {answerTexts.map((text, index) => (
          <div key={`answer-${index}`} className="flex items-center gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => onAnswerChange(index, e.target.value)}
              placeholder={`정답 ${index + 1}`}
              className="flex-1 px-3 py-2 text-sm border-2 border-[#1A1A1A] bg-[#F5F0E8] focus:outline-none"
            />
            {/* 삭제 버튼 (2개 이상일 때만) */}
            {answerTexts.length > 1 && (
              <button
                type="button"
                onClick={() => onRemoveAnswer(index)}
                className="w-10 h-10 flex items-center justify-center text-[#8B1A1A] hover:bg-[#FDEAEA] border border-[#8B1A1A] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 정답 추가 버튼 */}
      {answerTexts.length < 5 && (
        <button
          type="button"
          onClick={onAddAnswer}
          className="mt-2 w-full py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
        >
          + 정답 추가 (최대 5개)
        </button>
      )}

      {error && (
        <p className="mt-2 text-sm text-[#8B1A1A]">{error}</p>
      )}
    </div>
  );
}
