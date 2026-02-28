'use client';

/**
 * 교수 문제 미리보기 카드 (확장형)
 *
 * 서재 Preview, 커스텀 폴더 상세 등에서 공통 사용.
 * isEditMode=false로 넘기면 읽기 전용.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// 선지 번호 라벨 (최대 8개 지원)
const choiceLabels = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

export default function PreviewQuestionCard({
  question,
  questionNumber,
  isEditMode,
  editData,
  onEditChange,
}: {
  question: any;
  questionNumber: number;
  isEditMode?: boolean;
  editData?: { text?: string; choices?: string[]; explanation?: string; choiceExplanations?: string[] };
  onEditChange?: (field: string, value: any) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedChoices, setExpandedChoices] = useState<Set<number>>(new Set());

  // 수정 모드 진입 시 자동 펼침
  useEffect(() => {
    if (isEditMode) setIsExpanded(true);
  }, [isEditMode]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-[#1A1A1A] bg-[#F5F0E8] transition-all"
    >
      {/* 헤더 */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="p-2.5 cursor-pointer"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* 문항 번호 + 타입 뱃지 */}
            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
              <span className="inline-block px-1.5 py-0.5 text-[11px] font-bold bg-[#1A1A1A] text-[#F5F0E8]">
                Q{questionNumber}
              </span>
              {question.type && question.type !== 'multiple' && (
                <span className="inline-block px-1.5 py-0.5 text-[11px] font-bold border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]">
                  {question.type === 'ox' ? 'OX' : question.type === 'short_answer' ? '주관식' : question.type}
                </span>
              )}
            </div>
            <p className="text-xs text-[#1A1A1A]">{editData?.text ?? question.text}</p>
          </div>

          {/* 확장 아이콘 */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <svg
              className={`w-5 h-5 text-[#5C5C5C] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      {/* 상세 정보 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-[#1A1A1A] p-3 space-y-3 bg-[#EDEAE4]">
              {/* 수정 모드: 문제 텍스트 수정 */}
              {isEditMode && onEditChange && (
                <div>
                  <label className="block text-xs font-bold text-[#5C5C5C] mb-1">문제</label>
                  <textarea
                    value={editData?.text ?? question.text}
                    onChange={(e) => onEditChange('text', e.target.value)}
                    className="w-full p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm text-[#1A1A1A] focus:outline-none resize-none"
                    rows={3}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = target.scrollHeight + 'px';
                    }}
                  />
                </div>
              )}

              {/* 문제 이미지 */}
              {question.imageUrl && (
                <div className="mb-3">
                  <img
                    src={question.imageUrl}
                    alt="문제 이미지"
                    className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A]"
                  />
                  {question.imageDescription && (
                    <p className="text-xs text-[#5C5C5C] mt-1">{question.imageDescription}</p>
                  )}
                </div>
              )}

              {/* OX 문제 */}
              {question.type === 'ox' && (() => {
                const answer = question.answer;
                const isOCorrect = answer === 0 || answer === 'O' || answer === 'o' || answer === true;
                const isXCorrect = answer === 1 || answer === 'X' || answer === 'x' || answer === false;

                return (
                  <div className="space-y-3">
                    <div className="flex gap-4 justify-center py-2">
                      <div
                        className={`w-20 h-20 text-4xl font-bold border-2 flex items-center justify-center ${
                          isOCorrect
                            ? 'bg-[#1A6B1A] border-[#1A6B1A] text-[#F5F0E8]'
                            : 'bg-[#F5F0E8] border-[#1A1A1A] text-[#5C5C5C]'
                        }`}
                      >
                        O
                      </div>
                      <div
                        className={`w-20 h-20 text-4xl font-bold border-2 flex items-center justify-center ${
                          isXCorrect
                            ? 'bg-[#1A6B1A] border-[#1A6B1A] text-[#F5F0E8]'
                            : 'bg-[#F5F0E8] border-[#1A1A1A] text-[#5C5C5C]'
                        }`}
                      >
                        X
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 객관식 문제 */}
              {(question.type === 'multiple' || (!question.type && question.choices)) && question.choices && question.choices.length > 0 && (
                <div className="space-y-3">
                  {/* 복수 정답 표시 */}
                  {Array.isArray(question.answer) && question.answer.length > 1 && (
                    <p className="text-xs text-[#8B6914] font-bold flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      복수 정답 ({question.answer.length}개)
                    </p>
                  )}
                  <div className="space-y-2">
                    {(editData?.choices ?? question.choices).map((choice: string, idx: number) => {
                      // 정답 판별 (answer가 0-indexed 숫자 또는 배열)
                      const correctAnswers: number[] = Array.isArray(question.answer)
                        ? question.answer
                        : typeof question.answer === 'number'
                          ? [question.answer]
                          : [];
                      const isCorrectOption = correctAnswers.includes(idx);

                      let bgColor = '#F5F0E8';
                      let borderColor = '#1A1A1A';
                      let textColor = '#1A1A1A';

                      if (!isEditMode && isCorrectOption) {
                        bgColor = '#1A6B1A';
                        borderColor = '#1A6B1A';
                        textColor = '#F5F0E8';
                      }

                      // 선지별 해설
                      const currentChoiceExps = editData?.choiceExplanations ?? question.choiceExplanations;
                      const choiceExp = currentChoiceExps?.[idx];
                      const isChoiceExpanded = expandedChoices.has(idx);

                      return (
                        <div key={idx}>
                          <div
                            style={isEditMode ? {} : { backgroundColor: bgColor, borderColor, color: textColor }}
                            className={`w-full p-3 border-2 flex items-start gap-3 text-left ${
                              isEditMode
                                ? 'border-[#1A1A1A] bg-[#F5F0E8]'
                                : choiceExp ? 'cursor-pointer' : ''
                            }`}
                            onClick={!isEditMode && choiceExp ? () => {
                              setExpandedChoices(prev => {
                                const next = new Set(prev);
                                if (next.has(idx)) next.delete(idx);
                                else next.add(idx);
                                return next;
                              });
                            } : undefined}
                          >
                            {/* 선지 번호 */}
                            <span
                              className={`flex-shrink-0 w-6 h-6 flex items-center justify-center text-sm font-bold ${
                                isEditMode
                                  ? 'bg-[#EDEAE4] text-[#1A1A1A]'
                                  : isCorrectOption
                                    ? 'bg-[#F5F0E8]/20 text-[#F5F0E8]'
                                    : 'bg-[#EDEAE4] text-[#1A1A1A]'
                              }`}
                            >
                              {choiceLabels[idx] || `${idx + 1}`}
                            </span>
                            {/* 선지 텍스트 */}
                            {isEditMode && onEditChange ? (
                              <input
                                type="text"
                                value={choice}
                                onChange={(e) => {
                                  const newChoices = [...(editData?.choices ?? question.choices ?? [])];
                                  newChoices[idx] = e.target.value;
                                  onEditChange('choices', newChoices);
                                }}
                                className="flex-1 text-sm bg-transparent border-b border-[#5C5C5C] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
                              />
                            ) : (
                              <span className="flex-1 text-sm leading-relaxed break-words">
                                {choice}
                                {Array.isArray(question.answer) && question.answer.length > 1 && isCorrectOption && (
                                  <span className="ml-1 font-bold">(정답)</span>
                                )}
                              </span>
                            )}
                            {/* 체크 아이콘 또는 아코디언 화살표 (수정 모드에서는 숨김) */}
                            {!isEditMode && (
                              isCorrectOption ? (
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  {choiceExp && (
                                    <svg className={`w-4 h-4 transition-transform ${isChoiceExpanded ? 'rotate-180' : ''}`}
                                      fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  )}
                                </div>
                              ) : choiceExp ? (
                                <svg className={`w-4 h-4 flex-shrink-0 transition-transform ${isChoiceExpanded ? 'rotate-180' : ''}`}
                                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              ) : null
                            )}
                          </div>
                          {/* 선지별 해설 — 수정 모드면 전부 펼침 + textarea */}
                          {isEditMode && onEditChange ? (
                            <div className="px-4 py-3 border-x-2 border-b-2 border-[#1A1A1A] bg-[#EDEAE4]">
                              <label className="block text-xs text-[#5C5C5C] mb-1">선지 {idx + 1} 해설</label>
                              <textarea
                                value={(editData?.choiceExplanations ?? question.choiceExplanations ?? [])[idx] || ''}
                                onChange={(e) => {
                                  const newExps = [...(editData?.choiceExplanations ?? question.choiceExplanations ?? [])];
                                  while (newExps.length <= idx) newExps.push('');
                                  newExps[idx] = e.target.value;
                                  onEditChange('choiceExplanations', newExps);
                                }}
                                className="w-full p-2 border border-[#5C5C5C] bg-[#F5F0E8] text-sm text-[#5C5C5C] focus:outline-none resize-none"
                                rows={2}
                              />
                            </div>
                          ) : choiceExp && isChoiceExpanded ? (
                            <div
                              style={{ borderColor }}
                              className="px-4 py-3 border-x-2 border-b-2 bg-[#EDEAE4]"
                            >
                              <p className={`text-sm whitespace-pre-wrap ${
                                isCorrectOption ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
                              }`}>
                                {choiceExp.replace(/^선지\d+\s*해설\s*[:：]\s*/i, '')}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 단답형 답 */}
              {(question.type === 'short_answer' || question.type === 'short') && (
                <div className="space-y-3">
                  <div className="p-3 border-2 border-[#1A6B1A] bg-[#E8F5E9]">
                    <p className="text-xs text-[#1A6B1A] mb-1">정답</p>
                    <p className="text-sm font-medium text-[#1A6B1A] whitespace-pre-wrap">
                      {typeof question.answer === 'string'
                        ? question.answer.includes('|||')
                          ? question.answer.split('|||').map((a: string) => a.trim()).join(', ')
                          : question.answer
                        : String(question.answer ?? '')}
                    </p>
                  </div>
                </div>
              )}

              {/* 해설 */}
              {isEditMode && onEditChange ? (
                <div className="p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
                  <label className="block text-xs font-bold text-[#5C5C5C] mb-1">해설</label>
                  <textarea
                    value={editData?.explanation ?? question.explanation ?? ''}
                    onChange={(e) => onEditChange('explanation', e.target.value)}
                    className="w-full p-2 border border-[#5C5C5C] bg-[#EDEAE4] text-sm text-[#5C5C5C] focus:outline-none resize-none"
                    rows={3}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = target.scrollHeight + 'px';
                    }}
                  />
                </div>
              ) : question.explanation ? (
                <div className="p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
                  <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                  <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">
                    {question.explanation}
                  </p>
                </div>
              ) : (
                <div className="p-3 border border-[#D4CFC4] bg-[#F5F0E8]">
                  <p className="text-xs font-bold text-[#5C5C5C]">해설 없음</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
