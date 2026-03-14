'use client';

import { useState, useRef } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import Image from 'next/image';
import {
  FEEDBACK_TYPE_OPTIONS,
  SWIPE_THRESHOLD,
} from './feedbackTypes';
import type {
  FeedbackType,
  QuestionResult,
  CombinedGroup,
  SingleQuestionCardProps,
} from './feedbackTypes';

/**
 * 일반 문제 카드 컴포넌트
 */
export function SingleQuestionCard({
  question,
  feedbackTypes,
  feedbacks,
  onFeedbackTypeChange,
  onFeedbackChange,
}: SingleQuestionCardProps) {
  return (
    <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-2.5">
      {/* 정답/오답 표시 */}
      <div className={`inline-block px-2 py-0.5 text-[10px] font-bold mb-2 ${
        question.isCorrect
          ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
          : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
      }`}>
        {question.isCorrect ? '정답' : '오답'}
      </div>

      {/* 문제 */}
      <div className="mb-3">
        <p className="text-[10px] text-[#5C5C5C] mb-0.5">Q{question.number}</p>
        <p className="text-xs font-bold text-[#1A1A1A] leading-relaxed">
          {question.question}
          {/* 제시문 발문 또는 보기 발문 표시 */}
          {(question.passagePrompt || question.bogiQuestionText) && (
            <span className="ml-1 font-normal text-[#5C5C5C]">
              {question.passagePrompt || question.bogiQuestionText}
            </span>
          )}
        </p>
      </div>

      {/* 1. 지문 - 혼합 형식 (grouped 먼저, 나머지는 생성 순서대로) */}
      {question.mixedExamples && question.mixedExamples.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-bold text-[#5C5C5C]">지문</p>
          {/* 1-1. 묶음 블록 (grouped) 먼저 */}
          {question.mixedExamples.filter((b: any) => b.type === 'grouped').map((block: any) => (
            <div key={block.id} className="p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A] space-y-1">
              {(block.children || []).map((child: any) => (
                <div key={child.id}>
                  {child.type === 'text' && child.content?.trim() && (
                    <p className="text-[#5C5C5C] text-xs whitespace-pre-wrap">{child.content}</p>
                  )}
                  {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                    <p key={item.id} className="text-[#1A1A1A] text-xs">
                      <span className="font-bold mr-1">{item.label}.</span>
                      {item.content}
                    </p>
                  ))}
                  {child.type === 'gana' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                    <p key={item.id} className="text-[#1A1A1A] text-xs">
                      <span className="font-bold mr-1">({item.label})</span>
                      {item.content}
                    </p>
                  ))}
                  {child.type === 'image' && child.imageUrl && (
                    <Image src={child.imageUrl} alt="지문 이미지" width={800} height={400} className="max-w-full h-auto border border-[#1A1A1A]" unoptimized />
                  )}
                </div>
              ))}
            </div>
          ))}
          {/* 1-2. 나머지 블록 (생성 순서대로) */}
          {question.mixedExamples.filter((b: any) => b.type !== 'grouped').map((block: any) => (
            <div key={block.id}>
              {/* 텍스트 블록 */}
              {block.type === 'text' && block.content?.trim() && (
                <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                  <p className="text-[#1A1A1A] text-xs whitespace-pre-wrap">{block.content}</p>
                </div>
              )}
              {/* ㄱㄴㄷ 블록 */}
              {block.type === 'labeled' && (block.items || []).length > 0 && (
                <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1">
                  {(block.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                    <p key={item.id} className="text-[#1A1A1A] text-xs">
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
                    <p key={item.id} className="text-[#1A1A1A] text-xs">
                      <span className="font-bold mr-1">({item.label})</span>
                      {item.content}
                    </p>
                  ))}
                </div>
              )}
              {/* 이미지 블록 */}
              {block.type === 'image' && block.imageUrl && (
                <div className="border border-[#1A1A1A] overflow-hidden">
                  <Image src={block.imageUrl} alt="지문 이미지" width={800} height={400} className="max-w-full h-auto" unoptimized />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 2. 지문 - 텍스트 형식 */}
      {!question.mixedExamples && question.subQuestionOptions && question.subQuestionOptions.length > 0 && question.subQuestionOptionsType === 'text' && (
        <div className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
          <p className="text-xs font-bold text-[#5C5C5C] mb-2">지문</p>
          <p className="text-[#1A1A1A] text-xs">
            {question.subQuestionOptions.join(', ')}
          </p>
        </div>
      )}

      {/* 3. 지문 - ㄱㄴㄷ 형식 */}
      {!question.mixedExamples && question.subQuestionOptions && question.subQuestionOptions.length > 0 && question.subQuestionOptionsType === 'labeled' && (
        <div className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1">
          <p className="text-xs font-bold text-[#5C5C5C] mb-2">지문</p>
          {question.subQuestionOptions.map((itm, idx) => (
            <p key={idx} className="text-[#1A1A1A] text-xs">
              <span className="font-bold mr-1">{['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'][idx]}.</span>
              {itm}
            </p>
          ))}
        </div>
      )}

      {/* 4. 문제 이미지 - 지문 다음에 표시 */}
      {question.image && (
        <div className="mb-4 border border-[#1A1A1A] overflow-hidden">
          <Image src={question.image} alt="문제 이미지" width={800} height={400} className="max-w-full h-auto" unoptimized />
        </div>
      )}

      {/* 5. 보기 (<보기> 박스) - 이미지 다음, 발문 전에 표시 */}
      {question.bogi && question.bogi.items && question.bogi.items.some(i => i.content?.trim()) && (
        <div className="mb-4 p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
          <p className="text-xs text-center text-[#5C5C5C] mb-2 font-bold">&lt;보 기&gt;</p>
          <div className="space-y-1">
            {question.bogi.items.filter(i => i.content?.trim()).map((item, idx) => (
              <p key={idx} className="text-xs text-[#1A1A1A]">
                <span className="font-bold mr-1">{item.label}.</span>
                {item.content}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* 6. 발문 (제시문 발문 + 보기 발문 합침, 선지 전에 표시) */}
      {(question.passagePrompt || question.bogiQuestionText) && (
        <div className="mb-4 p-2 border border-[#1A1A1A] bg-[#F5F0E8]">
          <p className="text-xs text-[#1A1A1A]">
            {question.passagePrompt && question.bogiQuestionText
              ? `${question.passagePrompt} ${question.bogiQuestionText}`
              : question.passagePrompt || question.bogiQuestionText}
          </p>
        </div>
      )}

      {/* 7. 선지 (객관식) */}
      {question.type === 'multiple' && question.options && question.options.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-bold text-[#5C5C5C]">선지</p>
          {question.options.map((option, idx) => {
            const optionNum = idx.toString();
            const correctAnswerStr = question.correctAnswer?.toString() || '';
            const userAnswerStr = question.userAnswer?.toString() || '';

            const correctAnswers = correctAnswerStr.includes(',')
              ? correctAnswerStr.split(',').map(s => s.trim())
              : [correctAnswerStr];
            const isCorrect = correctAnswers.includes(optionNum);
            const isMultipleAnswer = correctAnswers.length > 1;

            const isUserAnswer = userAnswerStr.includes(',')
              ? userAnswerStr.split(',').map(s => s.trim()).includes(optionNum)
              : userAnswerStr === optionNum;

            return (
              <div
                key={idx}
                className={`p-2 text-xs border ${
                  isCorrect
                    ? 'bg-[#E8F5E9] border-[#1A6B1A] text-[#1A6B1A]'
                    : isUserAnswer
                    ? 'bg-[#FFEBEE] border-[#8B1A1A] text-[#8B1A1A]'
                    : 'bg-[#EDEAE4] border-[#EDEAE4] text-[#5C5C5C]'
                }`}
              >
                <span className="font-bold mr-2">{idx + 1}.</span>
                {option}
                {isMultipleAnswer && isCorrect && <span className="ml-2 font-bold">(정답)</span>}
                {isMultipleAnswer && isUserAnswer && <span className="ml-2 font-bold">(내 답)</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* OX 선지 - 버튼 스타일 */}
      {question.type === 'ox' && (() => {
        const correctAnswerNormalized = (() => {
          const ca = question.correctAnswer?.toString();
          if (ca === '0' || ca?.toUpperCase() === 'O') return 'O';
          return 'X';
        })();
        const userAnswerNormalized = question.userAnswer?.toString().toUpperCase() || '';

        return (
          <div className="mb-4">
            <p className="text-xs font-bold text-[#5C5C5C] mb-2">선지</p>
            <div className="flex gap-4 justify-center py-2">
              {['O', 'X'].map((option) => {
                const isCorrect = option === correctAnswerNormalized;
                const isUserAnswer = option === userAnswerNormalized;

                // 스타일 결정: 정답=녹색, 오답(내답)=빨강, 기본=회색
                let bgColor = '#EDEAE4';
                let textColor = '#5C5C5C';
                let borderColor = '#1A1A1A';

                if (isCorrect) {
                  bgColor = '#1A6B1A';
                  textColor = '#F5F0E8';
                  borderColor = '#1A6B1A';
                } else if (isUserAnswer) {
                  bgColor = '#8B1A1A';
                  textColor = '#F5F0E8';
                  borderColor = '#8B1A1A';
                }

                return (
                  <div
                    key={option}
                    className="w-20 h-20 text-3xl font-bold border-2 flex flex-col items-center justify-center"
                    style={{ backgroundColor: bgColor, color: textColor, borderColor }}
                  >
                    <span>{option}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 주관식 답변 */}
      {question.type === 'short' && (
        <div className="mb-4 space-y-2">
          {question.correctAnswer?.includes('|||') ? (
            <div className="space-y-2 text-xs">
              <div className="p-2 bg-[#E8F5E9] border border-[#1A6B1A]">
                <span className="text-[#5C5C5C]">정답: </span>
                <span className="font-bold text-[#1A6B1A]">
                  {question.correctAnswer.split('|||').map((a: string) => a.trim()).join(', ')}
                </span>
              </div>
              <div className={`p-2 ${
                question.isCorrect
                  ? 'bg-[#E8F5E9] border border-[#1A6B1A]'
                  : 'bg-[#FFEBEE] border border-[#8B1A1A]'
              }`}>
                <span className="text-[#5C5C5C]">내 답: </span>
                <span className={`font-bold ${
                  question.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                }`}>
                  {question.userAnswer || '(미입력)'}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex gap-4 text-xs">
              <div className="flex-1 p-2 bg-[#E8F5E9] border border-[#1A6B1A]">
                <span className="text-[#5C5C5C]">정답: </span>
                <span className="font-bold text-[#1A6B1A]">{question.correctAnswer}</span>
              </div>
              <div className={`flex-1 p-2 ${
                question.isCorrect
                  ? 'bg-[#E8F5E9] border border-[#1A6B1A]'
                  : 'bg-[#FFEBEE] border border-[#8B1A1A]'
              }`}>
                <span className="text-[#5C5C5C]">내 답: </span>
                <span className={`font-bold ${
                  question.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                }`}>
                  {question.userAnswer || '(미입력)'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 해설 */}
      {question.explanation && (
        <div className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
          <p className="text-xs font-bold text-[#1A1A1A] mb-1">해설</p>
          <p className="text-xs text-[#5C5C5C] leading-relaxed">
            {question.explanation}
          </p>
        </div>
      )}

      {/* 피드백 타입 선택 */}
      <div className="mt-4">
        <label className="text-xs font-bold text-[#1A1A1A] mb-2 block">
          이 문제에 대한 피드백 (선택)
        </label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {FEEDBACK_TYPE_OPTIONS.map(({ type, label, positive }) => (
            <button
              key={type}
              type="button"
              onClick={() => onFeedbackTypeChange(question.id, type)}
              className={`p-2 text-xs font-bold border-2 transition-colors ${
                feedbackTypes[question.id] === type
                  ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                  : 'border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] hover:bg-[#EDEAE4]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {feedbackTypes[question.id] && (
          <div className="mt-2">
            <label className="text-xs text-[#5C5C5C] mb-1 block">
              추가 의견 (선택)
            </label>
            <textarea
              value={feedbacks[question.id] || ''}
              onChange={(e) => onFeedbackChange(question.id, e.target.value)}
              placeholder="자세한 내용을 적어주세요..."
              className="w-full px-3 py-2 text-sm bg-white border-2 border-[#1A1A1A] placeholder:text-[#AAAAAA] focus:outline-none resize-none"
              rows={2}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 결합형 문제 그룹 카드 props
 */
interface CombinedQuestionCardProps {
  group: CombinedGroup;
  feedbackTypes: Record<string, FeedbackType | null>;
  feedbacks: Record<string, string>;
  onFeedbackTypeChange: (questionId: string, type: FeedbackType) => void;
  onFeedbackChange: (questionId: string, value: string) => void;
}

/**
 * 결합형 문제 그룹 카드 컴포넌트
 */
export function CombinedQuestionCard({
  group,
  feedbackTypes,
  feedbacks,
  onFeedbackTypeChange,
  onFeedbackChange,
}: CombinedQuestionCardProps) {
  // 정답/오답 카운트
  const correctCount = group.subQuestions.filter(q => q.isCorrect).length;
  const totalCount = group.subQuestions.length;

  return (
    <div className="space-y-3">
      {/* 결합형 문제 헤더 */}
      <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-2.5">
        {/* 문제 번호 및 유형 */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-bold text-[#1A1A1A]">
            Q{group.groupNumber}.
          </span>
          <span className="px-1.5 py-0.5 bg-[#8B6914] text-[#F5F0E8] text-[10px] font-bold">
            결합형
          </span>
          <span className="text-[10px] text-[#5C5C5C]">
            ({totalCount}문제 중 {correctCount}개 정답)
          </span>
        </div>

        {/* 공통 문제 */}
        {group.commonQuestion && (
          <p className="text-[#1A1A1A] text-xs leading-relaxed whitespace-pre-wrap mb-3">
            {group.commonQuestion}
          </p>
        )}

        {/* 공통 지문 - 텍스트 형식 */}
        {group.passage && (!group.passageType || group.passageType === 'text') && (
          <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A] mb-4">
            <p className="text-[#1A1A1A] text-xs leading-relaxed whitespace-pre-wrap">
              {group.passage}
            </p>
          </div>
        )}

        {/* 공통 지문 - ㄱㄴㄷ 형식 */}
        {group.passageType === 'korean_abc' && group.koreanAbcItems && group.koreanAbcItems.length > 0 && (
          <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A] mb-4 space-y-1">
            <p className="text-xs text-[#5C5C5C] mb-2 font-bold">지문</p>
            {group.koreanAbcItems.filter((i: string) => i.trim()).map((item: string, idx: number) => (
              <p key={idx} className="text-[#1A1A1A] text-xs">
                <span className="font-bold text-[#1A1A1A] mr-1">
                  {['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'][idx]}.
                </span>
                {item}
              </p>
            ))}
          </div>
        )}

        {/* 공통 지문 - 혼합 형식 */}
        {group.passageMixedExamples && group.passageMixedExamples.length > 0 && (
          <div className="mb-4 space-y-2">
            {group.passageMixedExamples.map((block: any) => (
              <div key={block.id}>
                {/* 묶음 블록 */}
                {block.type === 'grouped' && (
                  <div className="p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A] space-y-1">
                    {(block.children || []).map((child: any) => (
                      <div key={child.id}>
                        {child.type === 'text' && child.content?.trim() && (
                          <p className="text-[#5C5C5C] text-xs whitespace-pre-wrap">{child.content}</p>
                        )}
                        {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                          <p key={item.id} className="text-[#1A1A1A] text-xs">
                            <span className="font-bold mr-1">{item.label}.</span>
                            {item.content}
                          </p>
                        ))}
                        {child.type === 'gana' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                          <p key={item.id} className="text-[#1A1A1A] text-xs">
                            <span className="font-bold mr-1">({item.label})</span>
                            {item.content}
                          </p>
                        ))}
                        {child.type === 'image' && child.imageUrl && (
                          <Image src={child.imageUrl} alt="지문 이미지" width={800} height={400} className="max-w-full h-auto border border-[#1A1A1A]" unoptimized />
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {/* 텍스트 블록 */}
                {block.type === 'text' && block.content?.trim() && (
                  <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                    <p className="text-[#1A1A1A] text-xs whitespace-pre-wrap">{block.content}</p>
                  </div>
                )}
                {/* ㄱㄴㄷ 블록 */}
                {block.type === 'labeled' && (block.items || []).length > 0 && (
                  <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1">
                    {(block.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                      <p key={item.id} className="text-[#1A1A1A] text-xs">
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
                      <p key={item.id} className="text-[#1A1A1A] text-xs">
                        <span className="font-bold mr-1">({item.label})</span>
                        {item.content}
                      </p>
                    ))}
                  </div>
                )}
                {/* 이미지 블록 */}
                {block.type === 'image' && block.imageUrl && (
                  <div className="border border-[#1A1A1A] overflow-hidden">
                    <Image src={block.imageUrl} alt="지문 이미지" width={800} height={400} className="max-w-full h-auto" unoptimized />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 공통 이미지 */}
        {group.passageImage && (
          <div className="relative w-full aspect-video overflow-hidden bg-[#EDEAE4] border border-[#1A1A1A]">
            <p className="absolute top-2 left-2 text-xs text-[#5C5C5C] font-bold bg-[#EDEAE4]/80 px-2 py-0.5 z-10">
              공통 이미지
            </p>
            <Image
              src={group.passageImage}
              alt="공통 이미지"
              fill
              className="object-contain"
              unoptimized
            />
          </div>
        )}
      </div>

      {/* 하위 문제들 */}
      {group.subQuestions.map((question, idx) => {
        const subNumber = `${group.groupNumber}-${idx + 1}`;

        return (
          <div
            key={question.id}
            className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-3"
          >
            {/* 정답/오답 및 문제 번호 */}
            <div className="flex items-center gap-2 mb-3">
              <div className={`px-2 py-0.5 text-xs font-bold ${
                question.isCorrect
                  ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
                  : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
              }`}>
                {question.isCorrect ? '정답' : '오답'}
              </div>
              <span className="text-sm font-bold text-[#1A1A1A]">
                Q{subNumber}.
              </span>
              <span className="px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold">
                {question.type === 'ox' ? 'OX' :
                 question.type === 'multiple' ? '객관식' :
                 question.type === 'short' ? '주관식' :
                 question.type}
              </span>
            </div>

            {/* 하위 문제 텍스트 */}
            <p className="text-[#1A1A1A] text-sm leading-relaxed whitespace-pre-wrap mb-4">
              {question.question}
              {/* 제시문 발문 또는 보기 발문 표시 */}
              {(question.passagePrompt || question.bogiQuestionText) && (
                <span className="ml-1 text-[#5C5C5C]">
                  {question.passagePrompt || question.bogiQuestionText}
                </span>
              )}
            </p>

            {/* 하위 문제 이미지 */}
            {question.image && (
              <div className="mb-4 border border-[#1A1A1A] overflow-hidden">
                <Image src={question.image} alt="문제 이미지" width={800} height={400} className="max-w-full h-auto" unoptimized />
              </div>
            )}

            {/* 하위 문제 지문 - 혼합 형식 (grouped 먼저, 나머지 생성 순서대로) */}
            {question.mixedExamples && question.mixedExamples.length > 0 && (
              <div className="mb-4 space-y-2">
                <p className="text-xs font-bold text-[#5C5C5C]">지문</p>
                {/* 묶음 블록 먼저 */}
                {question.mixedExamples.filter((b: any) => b.type === 'grouped').map((block: any) => (
                  <div key={block.id} className="p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A] space-y-1">
                    {(block.children || []).map((child: any) => (
                      <div key={child.id}>
                        {child.type === 'text' && child.content?.trim() && (
                          <p className="text-[#5C5C5C] text-xs whitespace-pre-wrap">{child.content}</p>
                        )}
                        {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                          <p key={item.id} className="text-[#1A1A1A] text-xs">
                            <span className="font-bold mr-1">{item.label}.</span>
                            {item.content}
                          </p>
                        ))}
                        {child.type === 'gana' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                          <p key={item.id} className="text-[#1A1A1A] text-xs">
                            <span className="font-bold mr-1">({item.label})</span>
                            {item.content}
                          </p>
                        ))}
                        {child.type === 'image' && child.imageUrl && (
                          <Image src={child.imageUrl} alt="지문 이미지" width={800} height={400} className="max-w-full h-auto border border-[#1A1A1A]" unoptimized />
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {/* 나머지 블록 (생성 순서대로) */}
                {question.mixedExamples.filter((b: any) => b.type !== 'grouped').map((block: any) => (
                  <div key={block.id}>
                    {/* 텍스트 블록 */}
                    {block.type === 'text' && block.content?.trim() && (
                      <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                        <p className="text-[#1A1A1A] text-xs whitespace-pre-wrap">{block.content}</p>
                      </div>
                    )}
                    {/* ㄱㄴㄷ 블록 */}
                    {block.type === 'labeled' && (block.items || []).length > 0 && (
                      <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1">
                        {(block.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                          <p key={item.id} className="text-[#1A1A1A] text-xs">
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
                          <p key={item.id} className="text-[#1A1A1A] text-xs">
                            <span className="font-bold mr-1">({item.label})</span>
                            {item.content}
                          </p>
                        ))}
                      </div>
                    )}
                    {/* 이미지 블록 */}
                    {block.type === 'image' && block.imageUrl && (
                      <div className="border border-[#1A1A1A] overflow-hidden">
                        <Image src={block.imageUrl} alt="지문 이미지" width={800} height={400} className="max-w-full h-auto" unoptimized />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 하위 문제 지문 - 텍스트 형식 */}
            {!question.mixedExamples && question.subQuestionOptions && question.subQuestionOptions.length > 0 && question.subQuestionOptionsType === 'text' && (
              <div className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                <p className="text-xs font-bold text-[#5C5C5C] mb-2">지문</p>
                <p className="text-[#1A1A1A] text-xs">
                  {question.subQuestionOptions.join(', ')}
                </p>
              </div>
            )}

            {/* 하위 문제 지문 - ㄱㄴㄷ 형식 */}
            {!question.mixedExamples && question.subQuestionOptions && question.subQuestionOptions.length > 0 && question.subQuestionOptionsType === 'labeled' && (
              <div className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1">
                <p className="text-xs font-bold text-[#5C5C5C] mb-2">지문</p>
                {question.subQuestionOptions.map((itm, idx) => (
                  <p key={idx} className="text-[#1A1A1A] text-xs">
                    <span className="font-bold mr-1">{['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'][idx]}.</span>
                    {itm}
                  </p>
                ))}
              </div>
            )}

            {/* 선지 (객관식) */}
            {question.type === 'multiple' && question.options && question.options.length > 0 && (
              <div className="mb-4 space-y-2">
                <p className="text-xs font-bold text-[#5C5C5C]">선지</p>
                {question.options.map((option, optIdx) => {
                  const optionNum = optIdx.toString();
                  const correctAnswerStr = question.correctAnswer?.toString() || '';
                  const userAnswerStr = question.userAnswer?.toString() || '';

                  const correctAnswers = correctAnswerStr.includes(',')
                    ? correctAnswerStr.split(',').map(s => s.trim())
                    : [correctAnswerStr];
                  const isCorrect = correctAnswers.includes(optionNum);
                  const isMultipleAnswer = correctAnswers.length > 1;

                  const isUserAnswer = userAnswerStr.includes(',')
                    ? userAnswerStr.split(',').map(s => s.trim()).includes(optionNum)
                    : userAnswerStr === optionNum;

                  return (
                    <div
                      key={optIdx}
                      className={`p-2 text-xs border ${
                        isCorrect
                          ? 'bg-[#E8F5E9] border-[#1A6B1A] text-[#1A6B1A]'
                          : isUserAnswer
                          ? 'bg-[#FFEBEE] border-[#8B1A1A] text-[#8B1A1A]'
                          : 'bg-[#EDEAE4] border-[#EDEAE4] text-[#5C5C5C]'
                      }`}
                    >
                      <span className="font-bold mr-2">{optIdx + 1}.</span>
                      {option}
                      {isMultipleAnswer && isCorrect && <span className="ml-2 font-bold">(정답)</span>}
                      {isMultipleAnswer && isUserAnswer && <span className="ml-2 font-bold">(내 답)</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* OX 선지 - 버튼 스타일 */}
            {question.type === 'ox' && (() => {
              const correctAnswerNormalized = (() => {
                const ca = question.correctAnswer?.toString();
                if (ca === '0' || ca?.toUpperCase() === 'O') return 'O';
                return 'X';
              })();
              const userAnswerNormalized = question.userAnswer?.toString().toUpperCase() || '';

              return (
                <div className="mb-4">
                  <p className="text-xs font-bold text-[#5C5C5C] mb-2">선지</p>
                  <div className="flex gap-4 justify-center py-2">
                    {['O', 'X'].map((option) => {
                      const isCorrect = option === correctAnswerNormalized;
                      const isUserAnswer = option === userAnswerNormalized;

                      // 스타일 결정: 정답=녹색, 오답(내답)=빨강, 기본=회색
                      let bgColor = '#EDEAE4';
                      let textColor = '#5C5C5C';
                      let borderColor = '#1A1A1A';

                      if (isCorrect) {
                        bgColor = '#1A6B1A';
                        textColor = '#F5F0E8';
                        borderColor = '#1A6B1A';
                      } else if (isUserAnswer) {
                        bgColor = '#8B1A1A';
                        textColor = '#F5F0E8';
                        borderColor = '#8B1A1A';
                      }

                      return (
                        <div
                          key={option}
                          className="w-20 h-20 text-3xl font-bold border-2 flex flex-col items-center justify-center"
                          style={{ backgroundColor: bgColor, color: textColor, borderColor }}
                        >
                          <span>{option}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* 주관식 답변 */}
            {question.type === 'short' && (
              <div className="mb-4 space-y-2">
                {question.correctAnswer?.includes('|||') ? (
                  <div className="space-y-2 text-xs">
                    <div className="p-2 bg-[#E8F5E9] border border-[#1A6B1A]">
                      <span className="text-[#5C5C5C]">정답: </span>
                      <span className="font-bold text-[#1A6B1A]">
                        {question.correctAnswer.split('|||').map((a: string) => a.trim()).join(', ')}
                      </span>
                    </div>
                    <div className={`p-2 ${
                      question.isCorrect
                        ? 'bg-[#E8F5E9] border border-[#1A6B1A]'
                        : 'bg-[#FFEBEE] border border-[#8B1A1A]'
                    }`}>
                      <span className="text-[#5C5C5C]">내 답: </span>
                      <span className={`font-bold ${
                        question.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                      }`}>
                        {question.userAnswer || '(미입력)'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-4 text-xs">
                    <div className="flex-1 p-2 bg-[#E8F5E9] border border-[#1A6B1A]">
                      <span className="text-[#5C5C5C]">정답: </span>
                      <span className="font-bold text-[#1A6B1A]">{question.correctAnswer}</span>
                    </div>
                    <div className={`flex-1 p-2 ${
                      question.isCorrect
                        ? 'bg-[#E8F5E9] border border-[#1A6B1A]'
                        : 'bg-[#FFEBEE] border border-[#8B1A1A]'
                    }`}>
                      <span className="text-[#5C5C5C]">내 답: </span>
                      <span className={`font-bold ${
                        question.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                      }`}>
                        {question.userAnswer || '(미입력)'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 해설 */}
            {question.explanation && (
              <div className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                <p className="text-xs font-bold text-[#1A1A1A] mb-1">해설</p>
                <p className="text-xs text-[#5C5C5C] leading-relaxed">
                  {question.explanation}
                </p>
              </div>
            )}

            {/* 피드백 타입 선택 */}
            <div className="mt-4">
              <label className="text-xs font-bold text-[#1A1A1A] mb-2 block">
                Q{subNumber}에 대한 피드백 (선택)
              </label>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {FEEDBACK_TYPE_OPTIONS.map(({ type, label, positive }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onFeedbackTypeChange(question.id, type)}
                    className={`p-2 text-xs font-bold border-2 transition-colors ${
                      feedbackTypes[question.id] === type
                        ? positive
                          ? 'border-[#1A6B1A] bg-[#1A6B1A] text-[#F5F0E8]'
                          : 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                        : positive
                          ? 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A] hover:bg-[#D0EBD0]'
                          : 'border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] hover:bg-[#EDEAE4]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {feedbackTypes[question.id] && (
                <div className="mt-2">
                  <label className="text-xs text-[#5C5C5C] mb-1 block">
                    추가 의견 (선택)
                  </label>
                  <textarea
                    value={feedbacks[question.id] || ''}
                    onChange={(e) => onFeedbackChange(question.id, e.target.value)}
                    placeholder="자세한 내용을 적어주세요..."
                    className="w-full px-3 py-2 text-sm bg-white border-2 border-[#1A1A1A] placeholder:text-[#AAAAAA] focus:outline-none resize-none"
                    rows={2}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 피드백 페이지
 *
 * 퀴즈의 각 문제에 대해 스와이프로 넘기며 피드백을 입력합니다.
 */