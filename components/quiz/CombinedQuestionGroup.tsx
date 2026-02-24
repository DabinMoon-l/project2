'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import OXChoice, { OXAnswer } from './OXChoice';
import MultipleChoice from './MultipleChoice';
import ShortAnswer from './ShortAnswer';
import { Question } from './QuestionCard';
import { formatChapterLabel } from '@/lib/courseIndex';

/**
 * 답안 타입
 */
type Answer = OXAnswer | number | number[] | string | null;

interface CombinedQuestionGroupProps {
  /** 결합형 그룹 내 모든 문제들 */
  questions: Question[];
  /** 각 문제별 답안 */
  answers: Record<string, Answer>;
  /** 답안 변경 핸들러 */
  onAnswerChange: (questionId: string, answer: Answer) => void;
  /** 결합형 그룹의 원본 번호 (예: 4) */
  groupNumber: number;
  /** 과목 ID (챕터 라벨 표시용) */
  courseId?: string;
}

/**
 * 결합형 문제 그룹 컴포넌트
 *
 * 결합형 문제의 공통 지문/이미지와 모든 하위 문제를 하나의 스크롤 가능한 화면에 표시합니다.
 */
export default function CombinedQuestionGroup({
  questions,
  answers,
  onAnswerChange,
  groupNumber,
  courseId,
}: CombinedQuestionGroupProps) {
  // 첫 번째 문제에서 공통 정보 가져오기
  const firstQuestion = questions[0];
  const {
    passage,
    passageType,
    passageImage,
    koreanAbcItems,
    commonQuestion,
    passageMixedExamples,
  } = firstQuestion as Question & { commonQuestion?: string; passageMixedExamples?: any[] };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* 결합형 문제 헤더 */}
      <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-5">
        {/* 문제 번호 및 유형 */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg font-bold text-[#1A1A1A]">
            Q{groupNumber}.
          </span>
          <span className="px-2 py-0.5 bg-[#8B6914] text-[#F5F0E8] text-xs font-bold">
            결합형
          </span>
          <span className="text-xs text-[#5C5C5C]">
            ({questions.length}문제)
          </span>
        </div>

        {/* 공통 문제 (있는 경우) */}
        {commonQuestion && (
          <p className="text-[#1A1A1A] text-base leading-relaxed whitespace-pre-wrap mb-4">
            {commonQuestion}
          </p>
        )}

        {/* 공통 지문 - 텍스트 형식 */}
        {passage && (!passageType || passageType === 'text') && (
          <div className="p-4 bg-[#EDEAE4] border border-[#1A1A1A] mb-4">
            <p className="text-[#1A1A1A] text-sm leading-relaxed whitespace-pre-wrap">
              {passage}
            </p>
          </div>
        )}

        {/* 공통 지문 - ㄱㄴㄷ 형식 */}
        {passageType === 'korean_abc' && koreanAbcItems && koreanAbcItems.length > 0 && (
          <div className="p-4 bg-[#EDEAE4] border border-[#1A1A1A] mb-4 space-y-2">
            <p className="text-xs text-[#5C5C5C] mb-2 font-bold">지문</p>
            {koreanAbcItems.filter((i: string) => i.trim()).map((item: string, idx: number) => (
              <p key={idx} className="text-[#1A1A1A] text-sm">
                <span className="font-bold text-[#1A1A1A] mr-1">
                  {['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'][idx]}.
                </span>
                {item}
              </p>
            ))}
          </div>
        )}

        {/* 공통 지문 - 혼합 형식 */}
        {passageMixedExamples && passageMixedExamples.length > 0 && (
          <div className="mb-4 space-y-2">
            {passageMixedExamples.map((block: any) => (
              <div key={block.id}>
                {/* 묶음 블록 */}
                {block.type === 'grouped' && (
                  <div className="p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A] space-y-1">
                    {(block.children || []).map((child: any) => (
                      <div key={child.id}>
                        {child.type === 'text' && child.content?.trim() && (
                          <p className="text-[#5C5C5C] text-sm whitespace-pre-wrap">{child.content}</p>
                        )}
                        {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                          <p key={item.id} className="text-[#1A1A1A] text-sm">
                            <span className="font-bold mr-1">{item.label}.</span>
                            {item.content}
                          </p>
                        ))}
                        {child.type === 'gana' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                          <p key={item.id} className="text-[#1A1A1A] text-sm">
                            <span className="font-bold mr-1">({item.label})</span>
                            {item.content}
                          </p>
                        ))}
                        {child.type === 'image' && child.imageUrl && (
                          <img src={child.imageUrl} alt="보기 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {/* 텍스트 블록 */}
                {block.type === 'text' && block.content?.trim() && (
                  <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                    <p className="text-[#1A1A1A] text-sm whitespace-pre-wrap">{block.content}</p>
                  </div>
                )}
                {/* ㄱㄴㄷ 블록 */}
                {block.type === 'labeled' && (block.items || []).length > 0 && (
                  <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1">
                    {(block.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                      <p key={item.id} className="text-[#1A1A1A] text-sm">
                        <span className="font-bold mr-1">{item.label}.</span>
                        {item.content}
                      </p>
                    ))}
                  </div>
                )}
                {/* (가)(나)(다) 블록 */}
                {block.type === 'gana' && (block.items || []).length > 0 && (
                  <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1">
                    {(block.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                      <p key={item.id} className="text-[#1A1A1A] text-sm">
                        <span className="font-bold mr-1">({item.label})</span>
                        {item.content}
                      </p>
                    ))}
                  </div>
                )}
                {/* 이미지 블록 */}
                {block.type === 'image' && block.imageUrl && (
                  <div className="border border-[#1A1A1A] overflow-hidden">
                    <img src={block.imageUrl} alt="보기 이미지" className="max-w-full h-auto" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 공통 이미지 */}
        {passageImage && (
          <div className="relative w-full aspect-video overflow-hidden bg-[#EDEAE4] border border-[#1A1A1A]">
            <p className="absolute top-2 left-2 text-xs text-[#5C5C5C] font-bold bg-[#EDEAE4]/80 px-2 py-0.5 z-10">
              공통 이미지
            </p>
            {passageImage.startsWith('data:') ? (
              <img
                src={passageImage}
                alt="공통 이미지"
                className="w-full h-full object-contain"
              />
            ) : (
              <Image
                src={passageImage}
                alt="공통 이미지"
                fill
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 50vw"
              />
            )}
          </div>
        )}
      </div>

      {/* 하위 문제들 */}
      {questions.map((question, idx) => {
        const currentAnswer = answers[question.id];
        const subNumber = `${groupNumber}-${idx + 1}`;

        return (
          <div
            key={question.id}
            className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-5"
          >
            {/* 하위 문제 번호 */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base font-bold text-[#1A1A1A]">
                Q{subNumber}.
              </span>
              <span className="px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold">
                {question.type === 'ox' ? 'OX' :
                 question.type === 'multiple' ? '객관식' :
                 question.type === 'short' || question.type === 'short_answer' ? '주관식' :
                 question.type}
              </span>
              {question.hasMultipleAnswers && (
                <span className="px-2 py-0.5 bg-[#1A6B1A] text-[#F5F0E8] text-xs font-bold">
                  복수정답
                </span>
              )}
              {/* 챕터 표시 */}
              {courseId && question.chapterId && (
                <span className="px-2 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-xs font-medium">
                  {formatChapterLabel(courseId, question.chapterId, question.chapterDetailId)}
                </span>
              )}
            </div>

            {/* 하위 문제 텍스트 */}
            <p className="text-[#1A1A1A] text-base leading-relaxed whitespace-pre-wrap mb-4">
              {question.text}
            </p>

            {/* 보기 표시 순서: 묶은 보기 → 텍스트박스 단독 → ㄱ.ㄴ.ㄷ.형식 → (가)(나)(다)형식 → 이미지 */}
            {(() => {
              type MixedBlock = { id: string; type: string; content?: string; items?: { id: string; label: string; content: string }[]; imageUrl?: string; children?: MixedBlock[] };
              const mixedExamples = question.mixedExamples as MixedBlock[] | undefined;
              const hasMixed = mixedExamples && mixedExamples.length > 0;
              const groupedBlocks = mixedExamples?.filter(b => b.type === 'grouped') || [];

              return (
                <>
                  {/* 1. 묶은 보기 (grouped) */}
                  {groupedBlocks.map((block) => (
                    <div key={block.id} className="mb-4 p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A] space-y-1">
                      {block.children?.map((child) => (
                        <div key={child.id}>
                          {child.type === 'text' && child.content?.trim() && (
                            <p className="text-[#5C5C5C] text-sm whitespace-pre-wrap">{child.content}</p>
                          )}
                          {child.type === 'labeled' && (child.items || []).filter(i => i.content.trim()).map((item) => (
                            <p key={item.id} className="text-[#1A1A1A] text-sm">
                              <span className="font-bold mr-1">{item.label}.</span>
                              {item.content}
                            </p>
                          ))}
                          {child.type === 'gana' && (child.items || []).filter(i => i.content.trim()).map((item) => (
                            <p key={item.id} className="text-[#1A1A1A] text-sm">
                              <span className="font-bold mr-1">({item.label})</span>
                              {item.content}
                            </p>
                          ))}
                          {child.type === 'image' && child.imageUrl && (
                            <img src={child.imageUrl} alt="보기 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                          )}
                        </div>
                      ))}
                    </div>
                  ))}

                  {/* 2. 나머지 제시문 (grouped 제외) - 생성 순서대로 표시 */}
                  {(mixedExamples || []).filter(b => b.type !== 'grouped').map((block) => {
                    if (block.type === 'text' && block.content?.trim()) {
                      return (
                        <div key={block.id} className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                          <p className="text-[#1A1A1A] text-sm whitespace-pre-wrap">{block.content}</p>
                        </div>
                      );
                    }
                    if (block.type === 'labeled') {
                      return (
                        <div key={block.id} className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1">
                          {(block.items || []).filter(i => i.content.trim()).map((item) => (
                            <p key={item.id} className="text-[#1A1A1A] text-sm">
                              <span className="font-bold mr-1">{item.label}.</span>
                              {item.content}
                            </p>
                          ))}
                        </div>
                      );
                    }
                    if (block.type === 'gana') {
                      return (
                        <div key={block.id} className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1">
                          {(block.items || []).filter(i => i.content.trim()).map((item) => (
                            <p key={item.id} className="text-[#1A1A1A] text-sm">
                              <span className="font-bold mr-1">({item.label})</span>
                              {item.content}
                            </p>
                          ))}
                        </div>
                      );
                    }
                    return null;
                  })}

                  {/* 레거시 보기 - 텍스트 형식 */}
                  {!hasMixed && question.examples && question.examples.items && question.examples.type === 'text' && question.examples.items.some(item => item.trim()) && (
                    <div className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                      <p className="text-[#1A1A1A] text-xs leading-relaxed">
                        {question.examples.items.filter(i => i.trim()).join(', ')}
                      </p>
                    </div>
                  )}

                  {/* 레거시 보기 - ㄱㄴㄷ 형식 */}
                  {!hasMixed && question.examples && question.examples.items && question.examples.type === 'labeled' && question.examples.items.some(item => item.trim()) && (
                    <div className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1">
                      {question.examples.items.filter(i => i.trim()).map((item, i) => (
                        <p key={i} className="text-[#1A1A1A] text-xs">
                          <span className="font-bold mr-1">
                            {['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ'][i]}.
                          </span>
                          {item}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* 4. 하위 문제 이미지 - 보기 다음에 표시 */}
                  {question.imageUrl && (
                    <div className="mb-4 relative w-full aspect-video overflow-hidden bg-[#EDEAE4] border border-[#1A1A1A]">
                      {question.imageUrl.startsWith('data:') ? (
                        <img
                          src={question.imageUrl}
                          alt={`문제 ${subNumber} 이미지`}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <Image
                          src={question.imageUrl}
                          alt={`문제 ${subNumber} 이미지`}
                          fill
                          className="object-contain"
                          sizes="(max-width: 768px) 100vw, 50vw"
                        />
                      )}
                    </div>
                  )}

                  {/* 5. 보기 (<보기> 박스) - 이미지 다음, 발문 전에 표시 */}
                  {question.bogi && question.bogi.items && question.bogi.items.some((i: any) => i.content?.trim()) && (
                    <div className="mb-4 p-4 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
                      <p className="text-xs text-center text-[#5C5C5C] mb-2 font-bold">&lt;보 기&gt;</p>
                      <div className="space-y-1">
                        {question.bogi.items.filter((i: any) => i.content?.trim()).map((item: any) => (
                          <p key={item.label} className="text-[#1A1A1A] text-sm">
                            <span className="font-bold mr-1">{item.label}.</span>
                            {item.content}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 6. 발문 (제시문 발문 + 보기 발문 합침, 선지 전에 표시) */}
                  {(question.passagePrompt || question.bogi?.questionText) && (
                    <p className="mb-4 text-[#1A1A1A] text-sm leading-relaxed">
                      {question.passagePrompt && question.bogi?.questionText
                        ? `${question.passagePrompt} ${question.bogi.questionText}`
                        : question.passagePrompt || question.bogi?.questionText}
                    </p>
                  )}
                </>
              );
            })()}

            {/* 선지 영역 */}
            <div className="mt-2">
              {/* OX 선지 */}
              {question.type === 'ox' && (
                <OXChoice
                  selected={currentAnswer as OXAnswer}
                  onSelect={(answer) => onAnswerChange(question.id, answer)}
                />
              )}

              {/* 객관식 선지 */}
              {question.type === 'multiple' && question.choices && (
                question.hasMultipleAnswers ? (
                  <MultipleChoice
                    choices={question.choices}
                    multiSelect
                    selectedIndices={Array.isArray(currentAnswer) ? currentAnswer : []}
                    onMultiSelect={(indices) => onAnswerChange(question.id, indices)}
                  />
                ) : (
                  <MultipleChoice
                    choices={question.choices}
                    selected={currentAnswer as number | null}
                    onSelect={(index) => onAnswerChange(question.id, index)}
                  />
                )
              )}

              {/* 주관식/단답형 입력 */}
              {(question.type === 'short' || question.type === 'short_answer') && (
                <ShortAnswer
                  value={(currentAnswer as string) || ''}
                  onChange={(value) => onAnswerChange(question.id, value)}
                />
              )}
            </div>
          </div>
        );
      })}
    </motion.div>
  );
}
