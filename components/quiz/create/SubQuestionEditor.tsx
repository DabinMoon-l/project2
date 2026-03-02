'use client';

import type { QuestionType } from '@/lib/ocr';
import type { SubQuestion } from './questionTypes';
import { KOREAN_LABELS, BOGI_QUESTION_PRESETS } from './questionTypes';
import { subQuestionTypeLabels } from './questionUtils';
import ChapterSelector from './ChapterSelector';
import SubQuestionMixedExamplesEditor from './SubQuestionMixedExamplesEditor';

/**
 * 하위 문제 편집기 (결합형용)
 */
export default function SubQuestionEditor({
  subQuestion,
  index,
  onChange,
  onRemove,
  canRemove,
  courseId,
}: {
  subQuestion: SubQuestion;
  index: number;
  onChange: (subQuestion: SubQuestion) => void;
  onRemove: () => void;
  canRemove: boolean;
  courseId?: string;
}) {
  const handleTypeChange = (type: Exclude<QuestionType, 'combined' | 'essay' | 'subjective'>) => {
    onChange({
      ...subQuestion,
      type,
      choices: type === 'multiple' ? ['', ''] : undefined,
      answerIndex: type === 'ox' ? -1 : type === 'multiple' ? -1 : undefined,
      answerIndices: type === 'multiple' ? [] : undefined,
      answerText: type === 'short_answer' ? '' : undefined,
      answerTexts: type === 'short_answer' ? [''] : undefined,
    });
  };

  const handleChoiceChange = (choiceIndex: number, value: string) => {
    const newChoices = [...(subQuestion.choices || [])];
    newChoices[choiceIndex] = value;
    onChange({ ...subQuestion, choices: newChoices });
  };

  const handleAddChoice = () => {
    const currentChoices = subQuestion.choices || [];
    if (currentChoices.length >= 8) return;
    onChange({ ...subQuestion, choices: [...currentChoices, ''] });
  };

  const handleRemoveChoice = (choiceIndex: number) => {
    const currentChoices = subQuestion.choices || [];
    if (currentChoices.length <= 2) return;
    const newChoices = currentChoices.filter((_, i) => i !== choiceIndex);
    // 정답 인덱스 조정
    let newAnswerIndex = subQuestion.answerIndex;
    let newAnswerIndices = subQuestion.answerIndices || [];
    if (newAnswerIndex !== undefined && newAnswerIndex >= choiceIndex) {
      newAnswerIndex = newAnswerIndex > choiceIndex ? newAnswerIndex - 1 : -1;
    }
    newAnswerIndices = newAnswerIndices
      .filter(i => i !== choiceIndex)
      .map(i => i > choiceIndex ? i - 1 : i);
    onChange({
      ...subQuestion,
      choices: newChoices,
      answerIndex: newAnswerIndex,
      answerIndices: newAnswerIndices,
    });
  };

  // 복수정답 모드 여부
  const isMultipleAnswerMode = (subQuestion.answerIndices?.length || 0) > 1 ||
    (subQuestion as any).isMultipleAnswer === true;

  const handleToggleMultipleAnswer = () => {
    const newIsMultiple = !isMultipleAnswerMode;
    if (newIsMultiple) {
      // 복수정답 모드로 전환
      onChange({
        ...subQuestion,
        answerIndices: subQuestion.answerIndex !== undefined && subQuestion.answerIndex >= 0
          ? [subQuestion.answerIndex]
          : [],
        isMultipleAnswer: true,
      } as SubQuestion);
    } else {
      // 단일정답 모드로 전환
      const firstAnswer = (subQuestion.answerIndices || [])[0];
      onChange({
        ...subQuestion,
        answerIndex: firstAnswer ?? -1,
        answerIndices: firstAnswer !== undefined ? [firstAnswer] : [],
        isMultipleAnswer: false,
      } as SubQuestion);
    }
  };

  const handleAnswerSelect = (answerIndex: number) => {
    if (isMultipleAnswerMode) {
      const currentIndices = subQuestion.answerIndices || [];
      let newIndices: number[];
      if (currentIndices.includes(answerIndex)) {
        newIndices = currentIndices.filter(i => i !== answerIndex);
      } else {
        newIndices = [...currentIndices, answerIndex].sort((a, b) => a - b);
      }
      onChange({
        ...subQuestion,
        answerIndices: newIndices,
        answerIndex: newIndices.length > 0 ? newIndices[0] : -1,
      });
    } else {
      onChange({
        ...subQuestion,
        answerIndex,
        answerIndices: [answerIndex],
      });
    }
  };

  return (
    <div className="p-4 border-2 border-[#1A1A1A] bg-[#EDEAE4]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#1A1A1A]">
            하위 문제 {index + 1}
          </span>
          {courseId && (
            <ChapterSelector
              courseId={courseId}
              chapterId={subQuestion.chapterId}
              detailId={subQuestion.chapterDetailId}
              onChange={(chapterId, detailId) => {
                onChange({
                  ...subQuestion,
                  chapterId,
                  chapterDetailId: detailId,
                });
              }}
              compact
            />
          )}
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="w-6 h-6 flex items-center justify-center text-[#8B1A1A] hover:bg-[#F5F0E8] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* 유형 선택 */}
      <div className="flex gap-1 mb-3">
        {(Object.keys(subQuestionTypeLabels) as Exclude<QuestionType, 'combined' | 'essay' | 'subjective'>[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => handleTypeChange(type)}
            className={`
              flex-1 py-1.5 text-xs font-bold border-2 transition-colors
              ${subQuestion.type === type
                ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
              }
            `}
          >
            {subQuestionTypeLabels[type]}
          </button>
        ))}
      </div>

      {/* 문제 텍스트 */}
      <textarea
        value={subQuestion.text}
        onChange={(e) => onChange({ ...subQuestion, text: e.target.value })}
        placeholder="문제를 입력하세요"
        rows={2}
        className="w-full px-3 py-2 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm resize-none focus:outline-none mb-3"
      />

      {/* OX 정답 */}
      {subQuestion.type === 'ox' && (
        <div className="flex gap-2">
          {['O', 'X'].map((option, idx) => (
            <button
              key={option}
              type="button"
              onClick={() => handleAnswerSelect(idx)}
              className={`
                flex-1 py-2 font-bold text-lg border-2 transition-colors
                ${subQuestion.answerIndex === idx
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#F5F0E8] text-[#5C5C5C] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                }
              `}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {/* 객관식 선지 */}
      {subQuestion.type === 'multiple' && (
        <div className="space-y-2">
          {/* 복수정답 토글 */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#5C5C5C]">선지 (정답 클릭)</span>
            <button
              type="button"
              onClick={handleToggleMultipleAnswer}
              className={`
                px-2 py-1 text-xs font-bold border transition-colors
                ${isMultipleAnswerMode
                  ? 'bg-[#1A6B1A] text-[#F5F0E8] border-[#1A6B1A]'
                  : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                }
              `}
            >
              복수정답 {isMultipleAnswerMode ? 'ON' : 'OFF'}
            </button>
          </div>
          {isMultipleAnswerMode && (
            <p className="text-xs text-[#1A6B1A] mb-1">복수정답 모드: 2개 이상의 정답을 선택하세요</p>
          )}
          {(subQuestion.choices || []).map((choice, idx) => {
            const isSelected = isMultipleAnswerMode
              ? (subQuestion.answerIndices || []).includes(idx)
              : subQuestion.answerIndex === idx;
            return (
            <div key={idx} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleAnswerSelect(idx)}
                className={`
                  w-7 h-7 flex items-center justify-center text-xs font-bold border-2 transition-colors
                  ${isSelected
                    ? isMultipleAnswerMode
                      ? 'bg-[#1A6B1A] text-[#F5F0E8] border-[#1A6B1A]'
                      : 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-[#F5F0E8] text-[#5C5C5C] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                  }
                `}
              >
                {idx + 1}
              </button>
              <input
                type="text"
                value={choice}
                onChange={(e) => handleChoiceChange(idx, e.target.value)}
                placeholder={`선지 ${idx + 1}`}
                className="flex-1 px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none"
              />
              {(subQuestion.choices || []).length > 2 && (
                <button
                  type="button"
                  onClick={() => handleRemoveChoice(idx)}
                  className="w-7 h-7 flex items-center justify-center text-[#8B1A1A] hover:bg-[#F5F0E8] transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            );
          })}
          {(subQuestion.choices || []).length < 8 && (
            <button
              type="button"
              onClick={handleAddChoice}
              className="w-full py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#F5F0E8] hover:text-[#1A1A1A] transition-colors"
            >
              + 선지 추가
            </button>
          )}
        </div>
      )}

      {/* 단답형 정답 */}
      {subQuestion.type === 'short_answer' && (
        <div className="space-y-2">
          {(subQuestion.answerTexts || ['']).map((text, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={text}
                onChange={(e) => {
                  const newTexts = [...(subQuestion.answerTexts || [''])];
                  newTexts[idx] = e.target.value;
                  onChange({
                    ...subQuestion,
                    answerTexts: newTexts,
                    answerText: newTexts[0] || '',
                  });
                }}
                placeholder={`정답 ${idx + 1}`}
                className="flex-1 px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none"
              />
              {(subQuestion.answerTexts || []).length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const newTexts = (subQuestion.answerTexts || []).filter((_, i) => i !== idx);
                    onChange({
                      ...subQuestion,
                      answerTexts: newTexts,
                      answerText: newTexts[0] || '',
                    });
                  }}
                  className="w-7 h-7 flex items-center justify-center text-[#8B1A1A] hover:bg-[#F5F0E8] transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          {(subQuestion.answerTexts || []).length < 5 && (
            <button
              type="button"
              onClick={() => {
                onChange({
                  ...subQuestion,
                  answerTexts: [...(subQuestion.answerTexts || ['']), ''],
                });
              }}
              className="w-full py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#F5F0E8] hover:text-[#1A1A1A] transition-colors"
            >
              + 정답 추가
            </button>
          )}
        </div>
      )}

      {/* 하위 문제 제시문 (passage) - 일반 문제와 동일한 UI */}
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-[#1A1A1A]">
            제시문 <span className="text-[#5C5C5C] font-normal">(선택)</span>
          </label>
          <button
            type="button"
            onClick={() => {
              if (subQuestion.mixedExamples !== undefined) {
                // 제시문 삭제
                onChange({ ...subQuestion, mixedExamples: undefined, examplesType: undefined, examples: undefined, koreanAbcExamples: undefined });
              } else {
                // 제시문 추가
                onChange({ ...subQuestion, mixedExamples: [], examplesType: 'mixed' });
              }
            }}
            className={`
              px-2 py-0.5 text-xs font-bold border-2 border-[#1A1A1A] transition-colors
              ${subQuestion.mixedExamples !== undefined
                ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                : 'bg-[#EDEAE4] text-[#5C5C5C] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
              }
            `}
          >
            {subQuestion.mixedExamples !== undefined ? '제시문 삭제' : '제시문 추가'}
          </button>
        </div>

        {/* 제시문 편집 UI */}
        {subQuestion.mixedExamples !== undefined && (
          <>
            <SubQuestionMixedExamplesEditor
              mixedExamples={subQuestion.mixedExamples || []}
              onChange={(newMixed) => onChange({ ...subQuestion, mixedExamples: newMixed })}
              onDelete={() => onChange({ ...subQuestion, mixedExamples: undefined, examplesType: undefined })}
            />
            {/* 제시문 발문 입력 */}
            <div className="mt-2 pt-2 border-t border-dashed border-[#D4CFC4]">
              <label className="block text-[10px] font-bold text-[#5C5C5C] mb-1">
                제시문 발문 <span className="font-normal">(선택)</span>
              </label>
              <input
                type="text"
                value={subQuestion.passagePrompt || ''}
                onChange={(e) => onChange({ ...subQuestion, passagePrompt: e.target.value })}
                placeholder="예: 다음 자료에 대한 설명으로 적절한 것은?"
                className="w-full px-2 py-1 text-xs border border-[#1A1A1A] bg-white focus:outline-none"
              />
            </div>
          </>
        )}
      </div>

      {/* 하위 문제 이미지 */}
      <div className="mt-3 space-y-2">
        <label className="text-xs font-bold text-[#1A1A1A]">
          이미지 <span className="text-[#5C5C5C] font-normal">(선택)</span>
        </label>
        {subQuestion.image ? (
          <div className="relative border-2 border-[#1A1A1A] bg-[#EDEAE4] p-1">
            <img
              src={subQuestion.image}
              alt="하위 문제 이미지"
              className="w-full max-h-32 object-contain"
            />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange({ ...subQuestion, image: undefined });
              }}
              className="absolute top-0.5 right-0.5 z-10 w-6 h-6 bg-[#8B1A1A] text-[#F5F0E8] flex items-center justify-center hover:bg-[#6B1414] transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <label className="flex items-center justify-center gap-1 w-full py-2 border-2 border-dashed border-[#1A1A1A] text-[#5C5C5C] cursor-pointer hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    onChange({ ...subQuestion, image: event.target?.result as string });
                  };
                  reader.readAsDataURL(file);
                }
              }}
            />
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-xs">이미지 업로드</span>
          </label>
        )}
      </div>

      {/* 하위 문제 보기 (<보기> 박스) - 객관식/주관식에서만 사용, OX는 사용 안함 */}
      {(subQuestion.type === 'multiple' || subQuestion.type === 'short_answer') && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-[#1A1A1A]">
              보기 <span className="text-[#5C5C5C] font-normal">(선택)</span>
            </label>
            <button
              type="button"
              onClick={() => {
                if (subQuestion.bogi) {
                  onChange({ ...subQuestion, bogi: undefined });
                } else {
                  onChange({
                    ...subQuestion,
                    bogi: {
                      questionText: BOGI_QUESTION_PRESETS[0],
                      items: [
                        { id: `bogi_${Date.now()}_0`, label: 'ㄱ', content: '' },
                        { id: `bogi_${Date.now()}_1`, label: 'ㄴ', content: '' },
                      ],
                    },
                  });
                }
              }}
              className={`
                px-2 py-0.5 text-xs font-bold border-2 border-[#1A1A1A] transition-colors
                ${subQuestion.bogi
                  ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                  : 'bg-[#EDEAE4] text-[#5C5C5C] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                }
              `}
            >
              {subQuestion.bogi ? '보기 삭제' : '보기 추가'}
            </button>
          </div>

          {/* 보기 편집 UI */}
          {subQuestion.bogi && (
            <div className="space-y-2 border border-[#1A1A1A] p-2 bg-[#FAFAFA]">
              {/* 보기 발문 프리셋 */}
              <div className="flex flex-wrap gap-1">
                {BOGI_QUESTION_PRESETS.slice(0, 2).map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onChange({
                      ...subQuestion,
                      bogi: subQuestion.bogi ? { ...subQuestion.bogi, questionText: preset } : undefined,
                    })}
                    className={`
                      px-1.5 py-0.5 text-[10px] border transition-colors
                      ${subQuestion.bogi?.questionText === preset
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                        : 'bg-white text-[#5C5C5C] border-[#D4CFC4]'
                      }
                    `}
                  >
                    프리셋{idx + 1}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onChange({
                    ...subQuestion,
                    bogi: subQuestion.bogi ? { ...subQuestion.bogi, questionText: '' } : undefined,
                  })}
                  className={`
                    px-1.5 py-0.5 text-[10px] border transition-colors
                    ${!subQuestion.bogi?.questionText || !BOGI_QUESTION_PRESETS.includes(subQuestion.bogi.questionText)
                      ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                      : 'bg-white text-[#5C5C5C] border-[#D4CFC4]'
                    }
                  `}
                >
                  직접입력
                </button>
              </div>
              <input
                type="text"
                value={subQuestion.bogi?.questionText || ''}
                onChange={(e) => onChange({
                  ...subQuestion,
                  bogi: subQuestion.bogi ? { ...subQuestion.bogi, questionText: e.target.value } : undefined,
                })}
                placeholder="발문 입력"
                className="w-full px-2 py-1 text-xs border border-[#1A1A1A] bg-white focus:outline-none"
              />

              {/* ㄱㄴㄷ 항목들 */}
              <div className="space-y-1">
                {(subQuestion.bogi?.items || []).map((item, idx) => (
                  <div key={item.id} className="flex gap-1 items-center">
                    <span className="w-5 text-xs font-bold text-[#1A1A1A]">{item.label}.</span>
                    <input
                      type="text"
                      value={item.content}
                      onChange={(e) => {
                        const items = [...(subQuestion.bogi?.items || [])];
                        items[idx] = { ...items[idx], content: e.target.value };
                        onChange({
                          ...subQuestion,
                          bogi: subQuestion.bogi ? { ...subQuestion.bogi, items } : undefined,
                        });
                      }}
                      placeholder={`${item.label} 내용`}
                      className="flex-1 px-2 py-1 text-xs border border-[#1A1A1A] bg-white focus:outline-none"
                    />
                    {(subQuestion.bogi?.items?.length || 0) > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const filteredItems = (subQuestion.bogi?.items || []).filter((_, i) => i !== idx);
                          const reorderedItems = filteredItems.map((it, i) => ({
                            ...it,
                            label: KOREAN_LABELS[i] || `${i + 1}`,
                          }));
                          onChange({
                            ...subQuestion,
                            bogi: subQuestion.bogi ? { ...subQuestion.bogi, items: reorderedItems } : undefined,
                          });
                        }}
                        className="w-5 h-5 text-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-white text-xs"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {(subQuestion.bogi?.items?.length || 0) < 6 && (
                  <button
                    type="button"
                    onClick={() => {
                      const items = subQuestion.bogi?.items || [];
                      const nextLabel = KOREAN_LABELS[items.length] || `${items.length + 1}`;
                      onChange({
                        ...subQuestion,
                        bogi: subQuestion.bogi ? {
                          ...subQuestion.bogi,
                          items: [...items, { id: `bogi_${Date.now()}`, label: nextLabel, content: '' }],
                        } : undefined,
                      });
                    }}
                    className="w-full py-1 text-xs text-[#5C5C5C] border border-dashed border-[#1A1A1A] hover:bg-[#EDEAE4]"
                  >
                    + 항목 추가
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 해설 */}
      <input
        type="text"
        value={subQuestion.explanation || ''}
        onChange={(e) => onChange({ ...subQuestion, explanation: e.target.value })}
        placeholder="해설 (선택)"
        className="w-full mt-3 px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none"
      />
    </div>
  );
}
