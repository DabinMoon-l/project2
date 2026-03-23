'use client';

/**
 * 복습 문제 풀이 화면 — ReviewPractice에서 분리된 풀이 단계 컴포넌트
 * 모든 상태는 부모(ReviewPractice)에서 관리하며, props로만 받습니다.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { formatChapterLabel } from '@/lib/courseIndex';
import OXChoice, { type OXAnswer } from '@/components/quiz/OXChoice';
import MultipleChoice from '@/components/quiz/MultipleChoice';
import ShortAnswer from '@/components/quiz/ShortAnswer';
import { FeedbackIcon, InlineFeedbackPanel } from '@/components/common/InlineFeedback';
import { KOREAN_LABELS } from '../reviewPracticeTypes';
import type { PracticeStageProps } from '../reviewPracticeTypes';
import { renderInlineMarkdown } from '@/lib/utils/renderInlineMarkdown';
import MixedExamplesRenderer from '@/components/common/MixedExamplesRenderer';

export default function PracticeStage({
  // 데이터
  groupedItems,
  currentIndex,
  totalCount,
  currentGroup,
  currentItem,
  progress,
  headerTitle,
  quizTitle,
  userCourseId,
  typeLabels,
  // 답안 상태
  answers,
  combinedAnswers,
  answer,
  isSubmitted,
  isCorrect,
  isLastQuestion,
  resultsMap,
  combinedResultsMap,
  // 답안 설정
  setAnswer,
  setCombinedAnswer,
  // 복수정답 여부
  isMultipleAnswerQuestion,
  // 액션
  handleSubmit,
  handleNext,
  handlePrev,
  onClose,
  // 선지별 해설 펼침
  expandedChoiceExplanations,
  setExpandedChoiceExplanations,
  // 인라인 피드백
  inlineFeedbackOpen,
  setInlineFeedbackOpen,
  submittedFeedbackIds,
  setSubmittedFeedbackIds,
  feedbackSubmitCount,
  setFeedbackSubmitCount,
  user,
  isPanelMode,
}: PracticeStageProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={isPanelMode
        ? "h-full flex flex-col overflow-y-auto"
        : "fixed inset-0 z-[60] flex flex-col"
      }
      style={{ backgroundColor: '#F5F0E8' }}
    >
      {/* 헤더 */}
      <header
        className="sticky top-0 z-[60] w-full border-b-2 border-[#1A1A1A]"
        style={{ backgroundColor: '#F5F0E8', ...(!isPanelMode ? { paddingTop: 'env(safe-area-inset-top, 0px)' } : {}) }}
      >
        <div className="flex items-center justify-between h-14 px-4">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onClose()}
            className="p-2 -ml-2 transition-colors duration-200 text-[#1A1A1A] hover:bg-[#EDEAE4]"
            aria-label="나가기"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </motion.button>

          <div className="text-center">
            <h1 className="text-base font-bold text-[#1A1A1A]">{headerTitle}</h1>
            {(quizTitle || currentItem?.quizTitle || currentGroup?.items[0]?.quizTitle) && (
              <p className="text-xs text-[#5C5C5C] mt-0.5 truncate max-w-[200px]">
                {quizTitle || currentItem?.quizTitle || currentGroup?.items[0]?.quizTitle}
              </p>
            )}
          </div>

          <div className="text-sm font-bold min-w-[3rem] text-right text-[#1A1A1A]">
            {currentIndex + 1}/{totalCount}
          </div>
        </div>

        <div className="h-1.5 w-full bg-[#EDEAE4]">
          <motion.div
            className="h-full bg-[#1A1A1A]"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </div>
      </header>

      {/* 문제 영역 */}
      <main className="px-4 py-6 pb-40 overflow-y-auto overscroll-contain flex-1 min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentGroup?.groupId || currentItem?.id || `group-${currentIndex}`}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.3 }}
          >
            {/* 결합형 문제 */}
            {currentGroup?.isCombined ? (
              <div className="space-y-4">
                {/* 결합형 헤더 카드 */}
                <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-base font-bold text-[#1A1A1A]">Q{currentIndex + 1}.</span>
                    <span className="px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold">
                      결합형
                    </span>
                    <span className="px-2 py-0.5 bg-[#5C5C5C] text-[#F5F0E8] text-xs font-bold">
                      {currentGroup.items.length}문제
                    </span>
                  </div>

                  {/* 공통 문제 */}
                  {currentGroup.items[0]?.commonQuestion && (
                    <p className="text-[#1A1A1A] text-sm leading-relaxed whitespace-pre-wrap">
                      {renderInlineMarkdown(currentGroup.items[0].commonQuestion || '')}
                    </p>
                  )}

                  {/* 공통 지문 */}
                  {(currentGroup.items[0]?.passage || currentGroup.items[0]?.koreanAbcItems || currentGroup.items[0]?.passageMixedExamples) && (
                    <div className={`p-3 border border-[#8B6914] bg-[#FFF8E1] ${currentGroup.items[0]?.commonQuestion ? 'mt-3' : ''}`}>
                      {currentGroup.items[0].passage && currentGroup.items[0].passageType !== 'korean_abc' && currentGroup.items[0].passageType !== 'mixed' && (
                        <p className="text-xs text-[#1A1A1A]">{renderInlineMarkdown(currentGroup.items[0].passage || '')}</p>
                      )}
                      {currentGroup.items[0].passageType === 'korean_abc' && currentGroup.items[0].koreanAbcItems && (
                        <div className="space-y-1">
                          {/* 정적 ㄱㄴㄷ 보기 — 순서 고정 */}
                          {currentGroup.items[0].koreanAbcItems.map((itm, i) => (
                            <p key={`kabc-${i}`} className="text-xs text-[#1A1A1A]">
                              <span className="font-bold">{KOREAN_LABELS[i]}.</span> {itm}
                            </p>
                          ))}
                        </div>
                      )}
                      {currentGroup.items[0].passageType === 'mixed' && currentGroup.items[0].passageMixedExamples && currentGroup.items[0].passageMixedExamples.length > 0 && (
                        <MixedExamplesRenderer blocks={currentGroup.items[0].passageMixedExamples} spacing="loose" textSize="xs" />
                      )}
                    </div>
                  )}

                  {/* 공통 이미지 */}
                  {currentGroup.items[0]?.passageImage && (
                    <div className="mt-3">
                      <img
                        src={currentGroup.items[0].passageImage}
                        alt="공통 이미지"
                        className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A]"
                      />
                    </div>
                  )}
                </div>

                {/* 하위 문제들 */}
                {currentGroup.items.map((subItem, subIdx) => {
                  const subAnswer = combinedAnswers[currentIndex]?.[subIdx] ?? null;
                  const subResult = combinedResultsMap[currentIndex]?.[subIdx];
                  const isSubCorrect = subResult?.isCorrect;
                  const isSubMultipleAnswer = subItem.correctAnswer?.toString().includes(',');

                  return (
                    <div key={subItem.id} className="bg-[#EDEAE4] border border-[#D4CFC4] p-3">
                      {/* 하위 문제 헤더 */}
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <span className="text-sm font-bold text-[#1A1A1A]">Q{currentIndex + 1}-{subIdx + 1}.</span>
                        <span className="px-2 py-0.5 bg-[#5C5C5C] text-[#F5F0E8] text-xs font-bold">
                          {typeLabels[subItem.type] || '문제'}
                        </span>
                        {isSubMultipleAnswer && (
                          <span className="px-2 py-0.5 bg-[#1A6B1A] text-[#F5F0E8] text-xs font-bold">
                            복수정답
                          </span>
                        )}
                        {isSubmitted && (
                          <span className={`px-2 py-0.5 text-xs font-bold ${
                            isSubCorrect ? 'bg-[#1A6B1A] text-white' : 'bg-[#8B1A1A] text-white'
                          }`}>
                            {isSubCorrect ? '정답' : '오답'}
                          </span>
                        )}
                        {userCourseId && subItem.chapterId && (
                          <span className="px-2 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-xs font-medium">
                            {formatChapterLabel(userCourseId, subItem.chapterId, subItem.chapterDetailId)}
                          </span>
                        )}
                        <FeedbackIcon
                          isOpen={inlineFeedbackOpen === subItem.questionId}
                          isSubmitted={submittedFeedbackIds.has(subItem.questionId)}
                          onClick={() => setInlineFeedbackOpen(
                            inlineFeedbackOpen === subItem.questionId ? null : subItem.questionId
                          )}
                        />
                      </div>

                      {/* 하위 문제 텍스트 */}
                      <p className="text-[#1A1A1A] text-sm leading-relaxed whitespace-pre-wrap mb-3">
                        {renderInlineMarkdown(subItem.question || '')}
                      </p>

                      {/* 하위 문제 이미지 */}
                      {subItem.image && (
                        <div className="mb-3">
                          <img
                            src={subItem.image}
                            alt="문제 이미지"
                            className="max-w-full max-h-[200px] object-contain border border-[#1A1A1A]"
                          />
                        </div>
                      )}

                      {/* 지문 - 혼합 형식 (mixedExamples) */}
                      {subItem.mixedExamples && subItem.mixedExamples.length > 0 && (
                        <div className="space-y-2 mb-3">
                          <MixedExamplesRenderer blocks={subItem.mixedExamples} spacing="loose" textSize="xs" blockWrapper="passage-accent" groupedBorderThick />
                        </div>
                      )}

                      {/* 지문 - 레거시 형식 (subQuestionOptions) */}
                      {!subItem.mixedExamples && subItem.subQuestionOptions && subItem.subQuestionOptions.length > 0 && (
                        <div className="p-3 border border-[#8B6914] bg-[#FFF8E1] mb-3">
                          {subItem.subQuestionOptionsType === 'text' ? (
                            <p className="text-xs text-[#1A1A1A]">
                              {subItem.subQuestionOptions.join(', ')}
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {/* 정적 보기 항목 — 순서 고정 */}
                              {subItem.subQuestionOptions.map((opt, i) => (
                                <p key={`opt-${i}`} className="text-xs text-[#1A1A1A]">
                                  <span className="font-bold">{KOREAN_LABELS[i]}.</span> {renderInlineMarkdown(opt)}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 선지 영역 */}
                      <div>
                        {subItem.type === 'ox' && (
                          <OXChoice
                            selected={subAnswer as OXAnswer}
                            onSelect={(value) => !isSubmitted && setCombinedAnswer(subIdx, value)}
                            disabled={isSubmitted}
                          />
                        )}

                        {subItem.type === 'multiple' && subItem.options && (
                          isSubMultipleAnswer ? (
                            <MultipleChoice
                              choices={subItem.options}
                              multiSelect
                              selectedIndices={Array.isArray(subAnswer) ? subAnswer : []}
                              onMultiSelect={(indices) => !isSubmitted && setCombinedAnswer(subIdx, indices)}
                              disabled={isSubmitted}
                              correctIndices={
                                isSubmitted
                                  ? subItem.correctAnswer.toString().split(',').map(s => parseInt(s.trim(), 10))
                                  : undefined
                              }
                            />
                          ) : (
                            <MultipleChoice
                              choices={subItem.options}
                              selected={typeof subAnswer === 'number' ? subAnswer : null}
                              onSelect={(index) => !isSubmitted && setCombinedAnswer(subIdx, index)}
                              disabled={isSubmitted}
                              correctIndex={
                                isSubmitted
                                  ? parseInt(subItem.correctAnswer.toString(), 10)
                                  : undefined
                              }
                            />
                          )
                        )}

                        {(subItem.type === 'short' || subItem.type === 'short_answer' || subItem.type === 'subjective') && (
                          <ShortAnswer
                            value={(subAnswer as string) || ''}
                            onChange={(value) => !isSubmitted && setCombinedAnswer(subIdx, value)}
                            disabled={isSubmitted}
                          />
                        )}
                      </div>

                      {/* 인라인 피드백 패널 (하위 문제) */}
                      <AnimatePresence>
                        {inlineFeedbackOpen === subItem.questionId && user && (
                          <InlineFeedbackPanel
                            questionId={subItem.questionId}
                            quizId={subItem.quizId}
                            quizCreatorId={subItem.quizCreatorId}
                            userId={user.uid}
                            questionNumber={currentIndex + 1}
                            isSubmitted={submittedFeedbackIds.has(subItem.questionId)}
                            onSubmitted={(qId) => {
                              setSubmittedFeedbackIds(prev => new Set(prev).add(qId));
                              setFeedbackSubmitCount(prev => prev + 1);
                            }}
                            onClose={() => setInlineFeedbackOpen(null)}
                          />
                        )}
                      </AnimatePresence>

                      {/* 제출 후 피드백 */}
                      {isSubmitted && (
                        <div className="mt-2 space-y-2">
                          {/* 정답/오답 상태 */}
                          <div className={`p-3 border-2 ${
                            isSubCorrect
                              ? 'border-[#1A6B1A] bg-[#E8F5E9]'
                              : 'border-[#8B1A1A] bg-[#FDEAEA]'
                          }`}>
                            <p className={`text-base font-bold text-center ${
                              isSubCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                            }`}>
                              {isSubCorrect ? '정답입니다!' : '오답입니다'}
                            </p>
                            {!isSubCorrect && (
                              <p className="text-sm text-center text-[#8B1A1A] mt-1">
                                <span>정답: </span>
                                <span className="font-bold">
                                  {subItem.type === 'ox'
                                    ? (subItem.correctAnswer?.toString() === '0' || subItem.correctAnswer?.toString().toUpperCase() === 'O' ? 'O' : 'X')
                                    : subItem.type === 'multiple'
                                    ? subItem.correctAnswer?.toString().split(',').map(a => `${parseInt(a.trim(), 10) + 1}번`).join(', ')
                                    : subItem.correctAnswer?.toString()}
                                </span>
                              </p>
                            )}
                          </div>

                          {/* 해설 */}
                          <div className="p-2 bg-[#F5F0E8] border border-[#1A1A1A]">
                            <p className="text-xs font-bold text-[#5C5C5C]">해설</p>
                            <p className="text-xs text-[#1A1A1A]">
                              {subItem.explanation || '해설이 없습니다.'}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : currentItem && (
              /* 단일 문제 */
              <>
                {/* 문제 카드 */}
                <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4">
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="text-base font-bold text-[#1A1A1A]">Q{currentIndex + 1}.</span>
                    <span className="px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold">
                      {typeLabels[currentItem.type] || '문제'}
                    </span>
                    {isMultipleAnswerQuestion() && (
                      <span className="px-2 py-0.5 bg-[#1A6B1A] text-[#F5F0E8] text-xs font-bold">
                        복수정답
                      </span>
                    )}
                    {userCourseId && currentItem.chapterId && (
                      <span className="px-2 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-xs font-medium">
                        {formatChapterLabel(userCourseId, currentItem.chapterId, currentItem.chapterDetailId)}
                      </span>
                    )}
                    <FeedbackIcon
                      isOpen={inlineFeedbackOpen === currentItem.questionId}
                      isSubmitted={submittedFeedbackIds.has(currentItem.questionId)}
                      onClick={() => setInlineFeedbackOpen(
                        inlineFeedbackOpen === currentItem.questionId ? null : currentItem.questionId
                      )}
                    />
                  </div>
                  <p className="text-[#1A1A1A] text-sm leading-relaxed whitespace-pre-wrap">
                    {currentItem.question}
                  </p>
                  {/* 문제 이미지 */}
                  {currentItem.image && (
                    <div className="mt-4">
                      <img
                        src={currentItem.image}
                        alt="문제 이미지"
                        className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A]"
                      />
                    </div>
                  )}
                  {/* AI 크롭 이미지 (HARD 난이도 문제) */}
                  {currentItem.imageUrl && (
                    <div className="mt-4">
                      <img
                        src={currentItem.imageUrl}
                        alt="문제 관련 자료"
                        className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A]"
                      />
                    </div>
                  )}

                  {/* 지문 - 혼합 형식 (mixedExamples) */}
                  {currentItem.mixedExamples && currentItem.mixedExamples.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <MixedExamplesRenderer blocks={currentItem.mixedExamples} spacing="loose" textSize="xs" blockWrapper="passage-accent" groupedBorderThick />
                    </div>
                  )}

                  {/* 지문 - 레거시 형식 (subQuestionOptions) */}
                  {!currentItem.mixedExamples && currentItem.subQuestionOptions && currentItem.subQuestionOptions.length > 0 && (
                    <div className="mt-4 p-3 border border-[#8B6914] bg-[#FFF8E1]">
                      {currentItem.subQuestionOptionsType === 'text' ? (
                        <p className="text-xs text-[#1A1A1A]">
                          {currentItem.subQuestionOptions.join(', ')}
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {/* 정적 보기 항목 — 순서 고정 */}
                          {currentItem.subQuestionOptions.map((opt, i) => (
                            <p key={`opt-${i}`} className="text-xs text-[#1A1A1A]">
                              <span className="font-bold">{KOREAN_LABELS[i]}.</span> {renderInlineMarkdown(opt)}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 선지 영역 */}
                <div className="mt-4">
                  {currentItem.type === 'ox' && (
                    <OXChoice
                      selected={answer as OXAnswer}
                      onSelect={(value) => !isSubmitted && setAnswer(value)}
                      disabled={isSubmitted}
                    />
                  )}

                  {currentItem.type === 'multiple' && currentItem.options && (
                    isMultipleAnswerQuestion() ? (
                      <MultipleChoice
                        choices={currentItem.options}
                        multiSelect
                        selectedIndices={Array.isArray(answer) ? answer : []}
                        onMultiSelect={(indices) => !isSubmitted && setAnswer(indices)}
                        disabled={isSubmitted}
                        correctIndices={
                          isSubmitted
                            ? currentItem.correctAnswer.toString().split(',').map(s => parseInt(s.trim(), 10))
                            : undefined
                        }
                      />
                    ) : (
                      <MultipleChoice
                        choices={currentItem.options}
                        selected={typeof answer === 'number' ? answer : null}
                        onSelect={(index) => !isSubmitted && setAnswer(index)}
                        disabled={isSubmitted}
                        correctIndex={
                          isSubmitted
                            ? parseInt(currentItem.correctAnswer.toString(), 10)
                            : undefined
                        }
                      />
                    )
                  )}

                  {(currentItem.type === 'short' || currentItem.type === 'short_answer' || currentItem.type === 'subjective') && (
                    <ShortAnswer
                      value={(answer as string) || ''}
                      onChange={(value) => !isSubmitted && setAnswer(value)}
                      disabled={isSubmitted}
                    />
                  )}

                  {/* 서술형 입력 */}
                  {currentItem.type === 'essay' && (
                    <ShortAnswer
                      value={(answer as string) || ''}
                      onChange={(value) => !isSubmitted && setAnswer(value)}
                      disabled={isSubmitted}
                      maxLength={200}
                      placeholder="아는 것을 200자 내로 적어주세요."
                    />
              )}
            </div>

            {/* 인라인 피드백 패널 */}
            <AnimatePresence>
              {inlineFeedbackOpen === currentItem?.questionId && user && currentItem && (
                <InlineFeedbackPanel
                  questionId={currentItem.questionId}
                  quizId={currentItem.quizId}
                  quizCreatorId={currentItem.quizCreatorId}
                  userId={user.uid}
                  questionNumber={currentIndex + 1}
                  isSubmitted={submittedFeedbackIds.has(currentItem.questionId)}
                  onSubmitted={(qId) => {
                    setSubmittedFeedbackIds(prev => new Set(prev).add(qId));
                    setFeedbackSubmitCount(prev => prev + 1);
                  }}
                  onClose={() => setInlineFeedbackOpen(null)}
                />
              )}
            </AnimatePresence>

            {/* 제출 후 결과 표시 */}
            <AnimatePresence>
              {isSubmitted && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="mt-6"
                >
                  {currentItem?.type === 'essay' ? (
                    // 서술형: 채점 없이 수고하셨습니다 표시
                    <div className="p-3 text-center border-2 border-[#1A1A1A] bg-[#F5F0E8]">
                      <p className="text-lg font-bold text-[#1A1A1A]">
                        수고하셨습니다.
                      </p>
                    </div>
                  ) : (
                  <div
                    className={`p-3 text-center border-2 ${
                      isCorrect
                        ? 'bg-[#E8F5E9] border-[#1A6B1A]'
                        : 'bg-[#FDEAEA] border-[#8B1A1A]'
                    }`}
                  >
                    <p className={`text-lg font-bold ${isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                      {isCorrect ? '정답입니다!' : '오답입니다'}
                    </p>

                    {!isCorrect && (
                      <div className="mt-2 text-xs text-[#5C5C5C]">
                        {currentItem.type === 'multiple' && currentItem.options && currentItem.correctAnswer.toString().includes(',') ? (
                          <>
                            <div className="mb-1">
                              <span>내 답: </span>
                              <span className="font-bold text-[#8B1A1A]">
                                {(() => {
                                  const userAnswerStr = resultsMap[currentIndex]?.userAnswer || '';
                                  if (!userAnswerStr) return '(미응답)';
                                  const userIndices = userAnswerStr.split(',').map(s => parseInt(s.trim(), 10) + 1);
                                  return userIndices.map(n => `${n}번`).join(', ');
                                })()}
                              </span>
                            </div>
                            <div>
                              <span>정답: </span>
                              <span className="font-bold text-[#1A6B1A]">
                                {currentItem.correctAnswer
                                  ? currentItem.correctAnswer.toString().split(',').map((ans: string) => `${parseInt(ans.trim(), 10) + 1}번`).join(', ')
                                  : '(정답 정보 없음)'}
                              </span>
                            </div>
                          </>
                        ) : currentItem.type === 'multiple' && currentItem.options ? (
                          <>
                            <div className="mb-1">
                              <span>내 답: </span>
                              <span className="font-bold text-[#8B1A1A]">
                                {(() => {
                                  const userAnswerStr = resultsMap[currentIndex]?.userAnswer || '';
                                  if (!userAnswerStr) return '(미응답)';
                                  const userIdx = parseInt(userAnswerStr, 10) + 1;
                                  return `${userIdx}번`;
                                })()}
                              </span>
                            </div>
                            <div>
                              <span>정답: </span>
                              <span className="font-bold text-[#1A6B1A]">
                                {currentItem.correctAnswer && currentItem.correctAnswer.toString().trim() !== ''
                                  ? `${parseInt(currentItem.correctAnswer.toString(), 10) + 1}번`
                                  : '(정답 정보 없음)'}
                              </span>
                            </div>
                          </>
                        ) : currentItem.correctAnswer && currentItem.correctAnswer.toString().includes('|||') ? (
                          <>
                            <span>정답 (다음 중 하나): </span>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {currentItem.correctAnswer.toString().split('|||').map((ans: string) => (
                                <span key={`ans-${ans.trim()}`} className="px-2 py-0.5 bg-[#E8F5E9] border border-[#1A6B1A] text-[#1A6B1A] font-bold">
                                  {ans.trim()}
                                </span>
                              ))}
                            </div>
                          </>
                        ) : currentItem.type === 'ox' ? (
                          <>
                            <span>정답: </span>
                            <span className="font-bold text-[#1A6B1A]">
                              {currentItem.correctAnswer !== undefined && currentItem.correctAnswer !== null
                                ? (currentItem.correctAnswer.toString() === '0' || currentItem.correctAnswer.toString().toUpperCase() === 'O' ? 'O' : 'X')
                                : '(정답 정보 없음)'}
                            </span>
                          </>
                        ) : (
                          <>
                            <span>정답: </span>
                            <span className="font-bold text-[#1A6B1A]">
                              {currentItem.correctAnswer && currentItem.correctAnswer.toString().trim() !== ''
                                ? currentItem.correctAnswer.toString()
                                : '(정답 정보 없음)'}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  )}

                  {currentItem.type !== 'essay' && currentItem.explanation && (
                    <div className="mt-4 p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
                      <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                      <p className="text-xs text-[#1A1A1A] whitespace-pre-wrap">{currentItem.explanation}</p>
                    </div>
                  )}

                  {/* AI 생성 문제 - 선지별 해설 아코디언 */}
                  {currentItem.choiceExplanations && currentItem.type === 'multiple' && currentItem.options && currentItem.options.length > 0 && (
                    <div className="mt-3 border border-[#D4CFC4] bg-[#FAFAF8]">
                      <p className="px-3 py-2 text-xs font-bold text-[#5C5C5C] border-b border-[#D4CFC4]">
                        선지별 해설
                      </p>
                      <div className="divide-y divide-[#EDEAE4]">
                        {currentItem.options.map((opt, idx) => {
                          const choiceExp = currentItem.choiceExplanations?.[idx];
                          if (!choiceExp) return null;
                          const choiceKey = `${currentIndex}-${idx}`;
                          const isChoiceExpanded = expandedChoiceExplanations.has(choiceKey);
                          const correctAnswerStr = currentItem.correctAnswer?.toString() || '';
                          const correctAnswers = correctAnswerStr.includes(',')
                            ? correctAnswerStr.split(',').map(a => a.trim())
                            : [correctAnswerStr];
                          const isCorrectChoice = correctAnswers.includes(idx.toString());

                          return (
                            <button
                              key={`choiceExp-${idx}`}
                              onClick={() => {
                                setExpandedChoiceExplanations(prev => {
                                  const next = new Set(prev);
                                  if (next.has(choiceKey)) {
                                    next.delete(choiceKey);
                                  } else {
                                    next.add(choiceKey);
                                  }
                                  return next;
                                });
                              }}
                              className="w-full text-left"
                            >
                              <div className="px-3 py-2 flex items-center gap-2">
                                <span className={`flex-shrink-0 w-5 h-5 flex items-center justify-center text-xs font-bold ${
                                  isCorrectChoice
                                    ? 'bg-[#1A6B1A] text-white'
                                    : 'bg-[#EDEAE4] text-[#5C5C5C]'
                                }`}>
                                  {idx + 1}
                                </span>
                                <span className="flex-1 text-sm text-[#1A1A1A] truncate">{renderInlineMarkdown(opt)}</span>
                                <svg
                                  className={`w-4 h-4 text-[#5C5C5C] transition-transform ${isChoiceExpanded ? 'rotate-180' : ''}`}
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </div>
                              <AnimatePresence>
                                {isChoiceExpanded && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="px-3 pb-3 pt-1">
                                      <p className="text-sm text-[#5C5C5C] bg-[#EDEAE4] p-2 border-l-2 border-[#8B6914]">
                                        {choiceExp.replace(/^선지\s*\d+\s*해설\s*[:：]\s*/i, '')}
                                      </p>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* 하단 버튼 */}
      <div
        className={isPanelMode
          ? 'sticky bottom-0 z-10 p-4 border-t-2 border-[#1A1A1A]'
          : 'fixed bottom-0 right-0 p-4 border-t-2 border-[#1A1A1A]'
        }
        style={isPanelMode
          ? { backgroundColor: '#F5F0E8', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }
          : { backgroundColor: '#F5F0E8', left: 'var(--detail-panel-left, 0)', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }
        }
      >
        <div className="flex gap-3">
          {currentIndex > 0 && (
            <button
              onClick={handlePrev}
              className="flex-1 py-3 bg-[#F5F0E8] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
            >
              이전
            </button>
          )}

          {!isSubmitted ? (
            <button
              onClick={handleSubmit}
              className={`${currentIndex > 0 ? 'flex-[2]' : 'w-full'} py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg`}
            >
              제출하기
            </button>
          ) : (
            <button
              onClick={handleNext}
              className={`${currentIndex > 0 ? 'flex-[2]' : 'w-full'} py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg`}
            >
              {isLastQuestion ? '결과 보기' : '다음 문제'}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
