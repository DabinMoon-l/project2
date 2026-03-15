'use client';

/**
 * 복습 결과 화면 — ReviewPractice에서 분리된 결과 단계 컴포넌트
 * 모든 상태는 부모(ReviewPractice)에서 관리하며, props로만 받습니다.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { BottomSheet } from '@/components/common';
import { formatChapterLabel } from '@/lib/courseIndex';
import { FEEDBACK_TYPES } from '@/components/review/types';
import { KOREAN_LABELS } from '../reviewPracticeTypes';
import type { ResultStageProps } from '../reviewPracticeTypes';
import MixedExamplesRenderer from '@/components/common/MixedExamplesRenderer';

export default function ResultStage({
  // 데이터
  groupedItems,
  resultsMap,
  combinedResultsMap,
  correctCount,
  totalQuestionCount,
  headerTitle,
  showFeedback,
  userCourseId,
  currentUserId,
  // expand 상태
  expandedIds,
  toggleExpand,
  expandedSubIds,
  toggleSubExpand,
  expandedChoiceExplanations,
  setExpandedChoiceExplanations,
  // 피드백 바텀시트
  submittedFeedbackIds,
  openFeedbackSheet,
  feedbackTargetItem,
  closeFeedbackSheet,
  selectedFeedbackTypes,
  toggleFeedbackType,
  feedbackContent,
  setFeedbackContent,
  isFeedbackSubmitting,
  isFeedbackDone,
  handleFeedbackSubmit,
  // 액션
  onGoToFeedback,
  onBackToPractice,
}: ResultStageProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain"
      style={{ backgroundColor: '#F5F0E8' }}
    >
      {/* 헤더 */}
      <header className="sticky top-0 z-50 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]">
        <div className="flex items-center justify-between h-12 px-4" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
          <div className="w-10" />
          <h1 className="text-sm font-bold text-[#1A1A1A]">{headerTitle} 결과</h1>
          <div className="w-10" />
        </div>
      </header>

      <main className="px-4 py-5 pb-24">
        {/* 점수 */}
        <div className="text-center mb-5">
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="text-5xl font-black text-[#1A1A1A]">{correctCount}</span>
            <span className="text-2xl text-[#5C5C5C]">/</span>
            <span className="text-2xl text-[#5C5C5C]">{totalQuestionCount}</span>
          </div>
          <p className="text-base text-[#5C5C5C]">
            정답률 {Math.round((correctCount / totalQuestionCount) * 100)}%
          </p>
        </div>

        {/* 문제 목록 */}
        <div className="space-y-2">
          {groupedItems.map((group, groupIdx) => {
            if (group.isCombined) {
              // 결합형 문제 그룹
              const firstItem = group.items[0];
              const groupResults = combinedResultsMap[groupIdx] || {};
              const groupCorrectCount = group.items.filter((_, subIdx) => groupResults[subIdx]?.isCorrect).length;
              const isGroupExpanded = expandedIds.has(group.groupId || `group-${groupIdx}`);

              return (
                <div key={group.groupId || `group-${groupIdx}`} className="border border-[#1A1A1A] bg-[#F5F0E8]">
                  {/* 결합형 그룹 헤더 */}
                  <div
                    onClick={() => toggleExpand(group.groupId || `group-${groupIdx}`)}
                    className="p-2.5 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {/* 문항 번호 + 결합형 표시 + 정답 수 */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold bg-[#1A1A1A] text-[#F5F0E8]">
                            Q{groupIdx + 1}
                          </span>
                          <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]">
                            결합형 문제
                          </span>
                          <span className={`inline-block px-1.5 py-0.5 text-[10px] font-bold ${
                            groupCorrectCount === group.items.length
                              ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
                              : groupCorrectCount > 0
                              ? 'bg-[#FFF8E1] text-[#8B6914] border border-[#8B6914]'
                              : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
                          }`}>
                            {groupCorrectCount}/{group.items.length} 정답
                          </span>
                        </div>
                        {/* 공통 문제 내용 표시 */}
                        {firstItem.commonQuestion && (
                          <p className="text-xs font-medium text-[#1A1A1A] line-clamp-2 pl-1">
                            {firstItem.commonQuestion}
                          </p>
                        )}
                      </div>

                      {/* 화살표 */}
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <svg
                          className={`w-4 h-4 text-[#5C5C5C] transition-transform mt-1 ${isGroupExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* 결합형 그룹 상세 */}
                  <AnimatePresence>
                    {isGroupExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-[#1A1A1A] p-3 bg-[#EDEAE4] space-y-3">
                          {/* 공통 지문/이미지 (노란색 박스) */}
                          {(firstItem.passage || firstItem.passageImage || (firstItem.koreanAbcItems && firstItem.koreanAbcItems.length > 0) || (firstItem.passageMixedExamples && firstItem.passageMixedExamples.length > 0)) && (
                            <div className="p-2 border border-[#8B6914] bg-[#FFF8E1]">
                              {firstItem.passage && firstItem.passageType !== 'korean_abc' && firstItem.passageType !== 'mixed' && (
                                <p className="text-xs text-[#1A1A1A]">{firstItem.passage}</p>
                              )}
                              {firstItem.passageType === 'korean_abc' && firstItem.koreanAbcItems && firstItem.koreanAbcItems.length > 0 && (
                                <div className="space-y-1">
                                  {/* 정적 ㄱㄴㄷ 보기 — 순서 고정 */}
                                  {firstItem.koreanAbcItems.map((itm, i) => (
                                    <p key={`kabc-${i}`} className="text-xs text-[#1A1A1A]">
                                      <span className="font-bold">{KOREAN_LABELS[i]}.</span> {itm}
                                    </p>
                                  ))}
                                </div>
                              )}
                              {firstItem.passageType === 'mixed' && firstItem.passageMixedExamples && firstItem.passageMixedExamples.length > 0 && (
                                <MixedExamplesRenderer blocks={firstItem.passageMixedExamples} spacing="loose" textSize="xs" />
                              )}
                              {firstItem.passageImage && (
                                <img src={firstItem.passageImage} alt="공통 이미지" className="mt-2 max-w-full max-h-[200px] object-contain border border-[#1A1A1A]" />
                              )}
                            </div>
                          )}

                          {/* 하위 문제들 */}
                          <div className="space-y-2">
                            {group.items.map((subItem, subIdx) => {
                              const subResult = groupResults[subIdx];
                              const isSubCorrect = subResult?.isCorrect;
                              const isSubExpanded = expandedSubIds.has(subItem.id);
                              const isOwnQuestion = currentUserId && subItem.quizCreatorId === currentUserId;
                              const isMultipleAnswer = subItem.correctAnswer?.toString().includes(',');

                              return (
                                <div key={subItem.id} className="border border-[#D4CFC4] bg-[#F5F0E8]">
                                  {/* 하위 문제 헤더 */}
                                  <div
                                    onClick={() => toggleSubExpand(subItem.id)}
                                    className="p-2 cursor-pointer flex items-center justify-between"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className={`w-5 h-5 flex items-center justify-center text-xs font-bold ${
                                          isSubCorrect ? 'bg-[#1A6B1A] text-white' : 'bg-[#8B1A1A] text-white'
                                        }`}>
                                          {isSubCorrect ? 'O' : 'X'}
                                        </span>
                                        <span className="text-xs font-bold text-[#1A1A1A]">
                                          Q{groupIdx + 1}-{subIdx + 1}
                                        </span>
                                      </div>
                                      <p className="text-xs font-medium text-[#1A1A1A] line-clamp-1 mt-1 pl-7">
                                        {subItem.question}
                                      </p>
                                    </div>
                                    <svg
                                      className={`w-4 h-4 text-[#5C5C5C] transition-transform flex-shrink-0 ${isSubExpanded ? 'rotate-180' : ''}`}
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>

                                  {/* 하위 문제 상세 */}
                                  <AnimatePresence>
                                    {isSubExpanded && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                      >
                                        <div className="border-t border-[#D4CFC4] p-2 bg-[#EDEAE4] space-y-2">
                                          {/* 문제 이미지 */}
                                          {subItem.image && (
                                            <img src={subItem.image} alt="문제 이미지" className="max-w-full max-h-[150px] object-contain border border-[#1A1A1A]" />
                                          )}

                                          {/* 지문 - 혼합 형식 (mixedExamples) */}
                                          {subItem.mixedExamples && subItem.mixedExamples.length > 0 && (
                                            <div className="space-y-2">
                                              <p className="text-xs font-bold text-[#8B6914]">지문</p>
                                              <MixedExamplesRenderer blocks={subItem.mixedExamples} spacing="loose" textSize="xs" blockWrapper="passage-accent" groupedBorderThick />
                                            </div>
                                          )}

                                          {/* 지문 - 레거시 형식 (subQuestionOptions) */}
                                          {!subItem.mixedExamples && subItem.subQuestionOptions && subItem.subQuestionOptions.length > 0 && (
                                            <div className="p-3 border border-[#8B6914] bg-[#FFF8E1]">
                                              <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                                              {subItem.subQuestionOptionsType === 'text' ? (
                                                <p className="text-xs text-[#1A1A1A]">
                                                  {subItem.subQuestionOptions.join(', ')}
                                                </p>
                                              ) : (
                                                <div className="space-y-1">
                                                  {/* 정적 보기 항목 — 순서 고정 */}
                                                  {subItem.subQuestionOptions.map((opt, i) => (
                                                    <p key={`opt-${i}`} className="text-xs text-[#1A1A1A]">
                                                      <span className="font-bold">{KOREAN_LABELS[i]}.</span> {opt}
                                                    </p>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          )}

                                          {/* 객관식 선지 */}
                                          {subItem.options && subItem.options.length > 0 && (
                                            <div className="space-y-1">
                                              {subItem.options.map((opt, optIdx) => {
                                                const optionNum = optIdx.toString();
                                                const correctAnswerStr = subItem.correctAnswer?.toString() || '';
                                                const correctAnswers = correctAnswerStr.includes(',')
                                                  ? correctAnswerStr.split(',').map(a => a.trim())
                                                  : [correctAnswerStr];
                                                const isCorrectOption = correctAnswers.includes(optionNum);

                                                const userAnswerStr = subResult?.userAnswer || '';
                                                const userAnswers = userAnswerStr.includes(',')
                                                  ? userAnswerStr.split(',').map(a => a.trim())
                                                  : userAnswerStr ? [userAnswerStr] : [];
                                                const isUserAnswer = userAnswers.includes(optionNum);

                                                let className = 'border-[#D4CFC4] text-[#5C5C5C] bg-[#F5F0E8]';
                                                if (isCorrectOption) {
                                                  className = 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]';
                                                } else if (isUserAnswer) {
                                                  className = 'border-[#8B1A1A] bg-[#FDEAEA] text-[#8B1A1A]';
                                                }

                                                const choiceExp = subItem.choiceExplanations?.[optIdx];
                                                const choiceKey = `result-${subItem.id}-${optIdx}`;
                                                const isChoiceExpanded = expandedChoiceExplanations.has(choiceKey);

                                                return (
                                                  <div key={`choice-${optIdx}`}>
                                                    <div
                                                      className={`px-2 py-1 text-xs border ${className} ${choiceExp ? 'cursor-pointer' : ''}`}
                                                      onClick={choiceExp ? () => {
                                                        setExpandedChoiceExplanations(prev => {
                                                          const next = new Set(prev);
                                                          if (next.has(choiceKey)) next.delete(choiceKey);
                                                          else next.add(choiceKey);
                                                          return next;
                                                        });
                                                      } : undefined}
                                                    >
                                                      <div className="flex items-center justify-between">
                                                        <span className="flex-1">
                                                          {optIdx + 1}. {opt}
                                                          {isMultipleAnswer && isCorrectOption && ' (정답)'}
                                                          {isMultipleAnswer && isUserAnswer && ' (내 선택)'}
                                                        </span>
                                                        {choiceExp && (
                                                          <svg
                                                            className={`w-3 h-3 text-[#5C5C5C] transition-transform flex-shrink-0 ml-1 ${isChoiceExpanded ? 'rotate-180' : ''}`}
                                                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                                          >
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                          </svg>
                                                        )}
                                                      </div>
                                                    </div>
                                                    <AnimatePresence>
                                                      {isChoiceExpanded && choiceExp && (
                                                        <motion.div
                                                          initial={{ height: 0, opacity: 0 }}
                                                          animate={{ height: 'auto', opacity: 1 }}
                                                          exit={{ height: 0, opacity: 0 }}
                                                          className="overflow-hidden"
                                                        >
                                                          <div className="px-3 py-2 bg-[#EDEAE4] border-l-2 border-[#8B6914]">
                                                            <p className="text-xs text-[#5C5C5C]">
                                                              {choiceExp.replace(/^선지\s*\d+\s*해설\s*[:：]\s*/i, '')}
                                                            </p>
                                                          </div>
                                                        </motion.div>
                                                      )}
                                                    </AnimatePresence>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}

                                          {/* OX/주관식 답 (하위 문제용) */}
                                          {(!subItem.options || subItem.options.length === 0) && (
                                            <div className="text-xs space-y-1">
                                              <p>
                                                <span className="text-[#5C5C5C]">내 답: </span>
                                                <span className={`font-bold ${isSubCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                                                  {subResult?.userAnswer || '(미응답)'}
                                                </span>
                                              </p>
                                              {!isSubCorrect && (
                                                <p>
                                                  <span className="text-[#5C5C5C]">정답: </span>
                                                  <span className="font-bold text-[#1A6B1A]">
                                                    {subItem.type === 'ox'
                                                      ? (subItem.correctAnswer?.toString() === '0' || subItem.correctAnswer?.toString().toUpperCase() === 'O' ? 'O' : 'X')
                                                      : (subItem.correctAnswer?.toString().replace(/\|\|\|/g, ', ') || '')}
                                                  </span>
                                                </p>
                                              )}
                                            </div>
                                          )}

                                          {/* 해설 */}
                                          <div className="p-2 bg-[#F5F0E8] border border-[#1A1A1A]">
                                            <p className="text-xs font-bold text-[#5C5C5C]">해설</p>
                                            <p className="text-xs text-[#1A1A1A]">
                                              {subItem.explanation || '해설이 없습니다.'}
                                            </p>
                                          </div>

                                          {/* 피드백 버튼 - AI 생성 문제가 아니고 본인 문제가 아닌 경우에만 표시 */}
                                          {showFeedback && !isOwnQuestion && subItem.quizType !== 'ai-generated' && (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openFeedbackSheet(subItem);
                                              }}
                                              disabled={submittedFeedbackIds.has(subItem.questionId)}
                                              className="w-full py-1 text-xs border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] hover:bg-[#EDEAE4] disabled:opacity-50"
                                            >
                                              {submittedFeedbackIds.has(subItem.questionId) ? '피드백 완료' : '피드백 남기기'}
                                            </button>
                                          )}
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            } else {
              // 단일 문제
              const item = group.items[0];
              const result = resultsMap[groupIdx];
              const isItemCorrect = result?.isCorrect;
              const isExpanded = expandedIds.has(item.id);
              const isOwnQuestion = currentUserId && item.quizCreatorId === currentUserId;
              const isMultipleAnswer = item.correctAnswer?.toString().includes(',');

              return (
                <div key={item.id} className="border border-[#1A1A1A] bg-[#F5F0E8]">
                  {/* 문제 헤더 */}
                  <div
                    onClick={() => toggleExpand(item.id)}
                    className="p-2.5 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {/* 첫 줄: 정답/오답 + 문항번호 + 챕터 + 문제유형 */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className={`w-5 h-5 flex items-center justify-center text-[10px] font-bold ${
                            item.type === 'essay'
                              ? 'bg-[#8B6914] text-white'
                              : isItemCorrect ? 'bg-[#1A6B1A] text-white' : 'bg-[#8B1A1A] text-white'
                          }`}>
                            {item.type === 'essay' ? '✎' : isItemCorrect ? 'O' : 'X'}
                          </span>
                          <span className="text-xs font-bold text-[#1A1A1A]">
                            Q{groupIdx + 1}
                          </span>
                          {userCourseId && item.chapterId && (
                            <span className="px-1 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-[10px] font-medium">
                              {formatChapterLabel(userCourseId, item.chapterId, item.chapterDetailId)}
                            </span>
                          )}
                          <span className="px-1 py-0.5 text-[10px] border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]">
                            {item.type === 'ox' ? 'OX문제' : item.type === 'multiple' ? '객관식문제' : item.type === 'essay' ? '서술형문제' : '주관식문제'}
                          </span>
                        </div>
                        {/* 둘째 줄: 문제 내용 + 발문 */}
                        <p className="text-xs font-medium text-[#1A1A1A] line-clamp-2 pl-7">
                          {item.question}
                          {/* 제시문 발문 또는 보기 발문 표시 */}
                          {(item.passagePrompt || item.bogiQuestionText) && (
                            <span className="ml-1 text-[#5C5C5C] font-normal">
                              {item.passagePrompt || item.bogiQuestionText}
                            </span>
                          )}
                        </p>
                      </div>
                      <svg
                        className={`w-4 h-4 text-[#5C5C5C] transition-transform flex-shrink-0 mt-1 ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                {/* 문제 상세 */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-[#1A1A1A] p-3 bg-[#EDEAE4] space-y-3">
                        {/* 결합형 공통 정보 */}
                        {item.combinedGroupId && (item.passage || item.passageImage || item.koreanAbcItems || item.passageMixedExamples) && (
                          <div className="space-y-2">
                            {(item.passage || item.passageImage || item.koreanAbcItems || item.passageMixedExamples) && (
                              <div className="p-2 border border-[#8B6914] bg-[#FFF8E1]">
                                {item.passage && item.passageType !== 'korean_abc' && item.passageType !== 'mixed' && (
                                  <p className="text-xs text-[#1A1A1A]">{item.passage}</p>
                                )}
                                {item.passageType === 'korean_abc' && item.koreanAbcItems && item.koreanAbcItems.length > 0 && (
                                  <div className="space-y-1">
                                    {/* 정적 ㄱㄴㄷ 보기 — 순서 고정 */}
                                    {item.koreanAbcItems.map((itm, i) => (
                                      <p key={`kabc-${i}`} className="text-xs text-[#1A1A1A]">
                                        <span className="font-bold">{KOREAN_LABELS[i]}.</span> {itm}
                                      </p>
                                    ))}
                                  </div>
                                )}
                                {item.passageType === 'mixed' && item.passageMixedExamples && item.passageMixedExamples.length > 0 && (
                                  <MixedExamplesRenderer blocks={item.passageMixedExamples} spacing="loose" textSize="xs" />
                                )}
                                {item.passageImage && (
                                  <img src={item.passageImage} alt="공통 이미지" className="mt-2 max-w-full max-h-[200px] object-contain border border-[#1A1A1A]" />
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* 1. 지문 - 혼합 형식 (mixedExamples) - 이미지보다 먼저 */}
                        {item.mixedExamples && item.mixedExamples.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-bold text-[#8B6914]">지문</p>
                            <MixedExamplesRenderer blocks={item.mixedExamples} spacing="loose" textSize="xs" blockWrapper="passage-accent" groupedBorderThick />
                          </div>
                        )}

                        {/* 2. 지문 - 레거시 형식 (subQuestionOptions) */}
                        {!item.mixedExamples && item.subQuestionOptions && item.subQuestionOptions.length > 0 && (
                          <div className="p-3 border border-[#8B6914] bg-[#FFF8E1]">
                            <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                            {item.subQuestionOptionsType === 'text' ? (
                              <p className="text-xs text-[#1A1A1A]">
                                {item.subQuestionOptions.join(', ')}
                              </p>
                            ) : (
                              <div className="space-y-1">
                                {/* 정적 보기 항목 — 순서 고정 */}
                                {item.subQuestionOptions.map((opt, i) => (
                                  <p key={`opt-${i}`} className="text-xs text-[#1A1A1A]">
                                    <span className="font-bold">{KOREAN_LABELS[i]}.</span> {opt}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* 3. 문제 이미지 - 지문 다음에 표시 */}
                        {item.image && (
                          <img src={item.image} alt="문제 이미지" className="max-w-full max-h-[200px] object-contain border border-[#1A1A1A]" />
                        )}
                        {/* AI 크롭 이미지 (HARD 난이도 문제) */}
                        {item.imageUrl && (
                          <img src={item.imageUrl} alt="문제 관련 자료" className="max-w-full max-h-[200px] object-contain border border-[#1A1A1A]" />
                        )}

                        {/* 하위 문제 이미지 */}
                        {item.subQuestionImage && (
                          <img src={item.subQuestionImage} alt="지문 이미지" className="max-w-full max-h-[200px] object-contain border border-[#1A1A1A]" />
                        )}

                        {/* 4. 보기 (<보기> 박스) - 이미지 다음, 발문 전에 표시 */}
                        {item.bogi && item.bogi.items && item.bogi.items.some(i => i.content?.trim()) && (
                          <div className="p-2 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
                            <p className="text-[10px] text-center text-[#5C5C5C] mb-1.5 font-bold">&lt;보 기&gt;</p>
                            <div className="space-y-1">
                              {item.bogi.items.filter(i => i.content?.trim()).map((bogiItem) => (
                                <p key={`bogi-${bogiItem.label}`} className="text-xs text-[#1A1A1A]">
                                  <span className="font-bold mr-1">{bogiItem.label}.</span>
                                  {bogiItem.content}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 5. 발문 (제시문 발문 + 보기 발문 합침, 선지 전에 표시) */}
                        {(item.passagePrompt || item.bogiQuestionText) && (
                          <div className="p-2 border border-[#1A1A1A] bg-[#F5F0E8]">
                            <p className="text-xs text-[#1A1A1A]">
                              {item.passagePrompt && item.bogiQuestionText
                                ? `${item.passagePrompt} ${item.bogiQuestionText}`
                                : item.passagePrompt || item.bogiQuestionText}
                            </p>
                          </div>
                        )}

                        {/* 6. 객관식 선지 */}
                        {item.options && item.options.length > 0 && (
                          <div className="space-y-1">
                            {item.options.map((opt, optIdx) => {
                              const optionNum = optIdx.toString();
                              const correctAnswerStr = item.correctAnswer?.toString() || '';
                              const correctAnswers = correctAnswerStr.includes(',')
                                ? correctAnswerStr.split(',').map(a => a.trim())
                                : [correctAnswerStr];
                              const isCorrectOption = correctAnswers.includes(optionNum);

                              const userAnswerStr = result?.userAnswer || '';
                              const userAnswers = userAnswerStr.includes(',')
                                ? userAnswerStr.split(',').map(a => a.trim())
                                : userAnswerStr ? [userAnswerStr] : [];
                              const isUserAnswer = userAnswers.includes(optionNum);

                              let className = 'border-[#D4CFC4] text-[#5C5C5C] bg-[#F5F0E8]';
                              if (isCorrectOption) {
                                className = 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]';
                              } else if (isUserAnswer) {
                                className = 'border-[#8B1A1A] bg-[#FDEAEA] text-[#8B1A1A]';
                              }

                              const choiceExp = item.choiceExplanations?.[optIdx];
                              const choiceKey = `result-${item.id}-${optIdx}`;
                              const isChoiceExpanded = expandedChoiceExplanations.has(choiceKey);

                              return (
                                <div key={`choice-${optIdx}`}>
                                  <div
                                    className={`text-xs p-2 border ${className} ${choiceExp ? 'cursor-pointer' : ''}`}
                                    onClick={choiceExp ? () => {
                                      setExpandedChoiceExplanations(prev => {
                                        const next = new Set(prev);
                                        if (next.has(choiceKey)) next.delete(choiceKey);
                                        else next.add(choiceKey);
                                        return next;
                                      });
                                    } : undefined}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="flex-1">
                                        {optIdx + 1}. {opt}
                                        {isMultipleAnswer && isCorrectOption && ' (정답)'}
                                        {isMultipleAnswer && isUserAnswer && ' (내 선택)'}
                                      </span>
                                      {choiceExp && (
                                        <svg
                                          className={`w-3 h-3 text-[#5C5C5C] transition-transform flex-shrink-0 ml-1 ${isChoiceExpanded ? 'rotate-180' : ''}`}
                                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                        >
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                      )}
                                    </div>
                                  </div>
                                  <AnimatePresence>
                                    {isChoiceExpanded && choiceExp && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                      >
                                        <div className="px-3 py-2 bg-[#EDEAE4] border-l-2 border-[#8B6914]">
                                          <p className="text-xs text-[#5C5C5C]">
                                            {choiceExp.replace(/^선지\s*\d+\s*해설\s*[:：]\s*/i, '')}
                                          </p>
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* OX/주관식/서술형 답 */}
                        {(!item.options || item.options.length === 0) && (
                          item.type === 'essay' ? (
                            <div className="text-xs space-y-1">
                              <p>
                                <span className="text-[#5C5C5C]">내 답: </span>
                                <span className="font-bold text-[#1A1A1A]">
                                  {result?.userAnswer || '(미응답)'}
                                </span>
                              </p>
                            </div>
                          ) : (
                          <div className="text-xs space-y-1">
                            <p>
                              <span className="text-[#5C5C5C]">내 답: </span>
                              <span className={`font-bold ${isItemCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                                {result?.userAnswer || '(미응답)'}
                              </span>
                            </p>
                            {!isItemCorrect && (
                              <p>
                                <span className="text-[#5C5C5C]">정답: </span>
                                <span className="font-bold text-[#1A6B1A]">
                                  {item.type === 'ox'
                                    ? (item.correctAnswer?.toString() === '0' || item.correctAnswer?.toString().toUpperCase() === 'O' ? 'O' : 'X')
                                    : (item.correctAnswer?.toString().replace(/\|\|\|/g, ', ') || '')}
                                </span>
                              </p>
                            )}
                          </div>
                          )
                        )}

                        {/* 해설 */}
                        {item.explanation && (
                          <div className="p-2 bg-[#F5F0E8] border border-[#1A1A1A]">
                            <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                            <p className="text-xs text-[#1A1A1A]">{item.explanation}</p>
                          </div>
                        )}

                        {/* 피드백 버튼 - AI 생성 문제가 아니고 본인 문제가 아닌 경우에만 표시 */}
                        {showFeedback && !isOwnQuestion && item.quizType !== 'ai-generated' && (
                          <div className="pt-2 border-t border-[#D4CFC4]">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openFeedbackSheet(item);
                              }}
                              disabled={submittedFeedbackIds.has(item.questionId)}
                              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold border transition-colors rounded-md ${
                                submittedFeedbackIds.has(item.questionId)
                                  ? 'bg-[#E8F5E9] border-[#1A6B1A] text-[#1A6B1A] cursor-default'
                                  : 'bg-[#FFF8E1] border-[#8B6914] text-[#8B6914] hover:bg-[#FFECB3]'
                              }`}
                            >
                              {submittedFeedbackIds.has(item.questionId) ? (
                                <>
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  피드백 완료
                                </>
                              ) : (
                                <>
                                  <span className="w-4 h-4 flex items-center justify-center bg-[#8B6914] text-[#FFF8E1] text-[10px] font-bold rounded-sm">!</span>
                                  문제 피드백
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
            }
          })}
        </div>
      </main>

      {/* 하단 버튼 */}
      <div className="fixed bottom-0 right-0 p-3 border-t-2 border-[#1A1A1A] bg-[#F5F0E8]" style={{ left: 'var(--detail-panel-left, 0)' }}>
        <div className="flex gap-2.5">
          <button
            onClick={onBackToPractice}
            className="flex-1 py-3 text-sm bg-[#F5F0E8] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
          >
            이전
          </button>
          <button
            onClick={onGoToFeedback}
            className="flex-[2] py-3 text-sm bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg"
          >
            다음
          </button>
        </div>
      </div>

      {/* 피드백 바텀시트 */}
      <BottomSheet
        isOpen={!!feedbackTargetItem}
        onClose={closeFeedbackSheet}
        title="문제 피드백"
        height="auto"
        zIndex="z-[70]"
      >
        <div className="space-y-3">
          {/* 피드백 유형 선택 */}
          <div>
            <p className="text-xs text-[#5C5C5C] mb-2">이 문제에 대한 의견을 선택해주세요</p>
            <div className="grid grid-cols-2 gap-1.5">
              {FEEDBACK_TYPES.map(({ type, label }) => (
                <button
                  key={type}
                  onClick={() => toggleFeedbackType(type)}
                  className={`p-2 border-2 text-xs font-bold transition-all rounded-lg ${
                    selectedFeedbackTypes.has(type)
                      ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                      : 'border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 추가 내용 입력 */}
          <AnimatePresence>
            {selectedFeedbackTypes.size > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <label className="block text-xs text-[#5C5C5C] mb-1.5">추가 의견 (선택)</label>
                <textarea
                  value={feedbackContent}
                  onChange={(e) => setFeedbackContent(e.target.value)}
                  placeholder="자세한 내용을 적어주세요"
                  rows={3}
                  maxLength={200}
                  className="w-full p-2 border-2 border-[#1A1A1A] bg-[#F5F0E8] focus:outline-none resize-none text-xs"
                />
                <p className="text-[10px] text-[#5C5C5C] text-right mt-0.5">{feedbackContent.length}/200</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 제출 버튼 */}
          <button
            onClick={handleFeedbackSubmit}
            disabled={selectedFeedbackTypes.size === 0 || isFeedbackSubmitting || isFeedbackDone}
            className={`w-full py-2.5 text-sm font-bold border-2 transition-colors rounded-lg ${
              isFeedbackDone
                ? 'bg-[#1A6B1A] text-[#F5F0E8] border-[#1A6B1A]'
                : selectedFeedbackTypes.size > 0
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C] cursor-not-allowed'
            }`}
          >
            {isFeedbackDone ? '✓' : isFeedbackSubmitting ? '제출 중...' : '피드백 보내기'}
          </button>
          <p className="text-[10px] text-[#5C5C5C] text-center">피드백은 익명으로 전달됩니다.</p>
        </div>
      </BottomSheet>
    </motion.div>
  );
}
