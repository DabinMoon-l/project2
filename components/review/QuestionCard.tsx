'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import type { ReviewItem } from '@/lib/hooks/useReview';
import { BottomSheet } from '@/components/common';
import { type FeedbackType, FEEDBACK_TYPES } from '@/components/review/types';
import { choiceLabels, KOREAN_LABELS } from '@/lib/utils/reviewQuestionUtils';
import { formatChapterLabel } from '@/lib/courseIndex';

export interface QuestionCardProps {
  item: ReviewItem;
  questionNumber: number;
  /** 결합형 하위문제 번호 (있으면 Q{main}-{sub} 형식으로 표시) */
  subQuestionNumber?: number;
  isSelectMode: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onFeedbackSubmit?: (questionId: string, type: FeedbackType, content: string) => void;
  /** 피드백 제출 완료 후 콜백 (EXP 토스트 표시용, 제출한 피드백 수 전달) */
  onFeedbackDone?: (count: number) => void;
  /** 현재 로그인한 사용자 ID (자기 문제 피드백 방지용) */
  currentUserId?: string;
  /** 해당 퀴즈의 생성자 ID (자기 문제 피드백 방지용) */
  quizCreatorId?: string;
  /** AI 생성 퀴즈 여부 (피드백 방지용) */
  isAiGenerated?: boolean;
  /** 과목 ID (챕터 라벨 표시용) */
  courseId?: string;
  /** 폴더 타입 (공통 문제 표시 여부 결정용) */
  folderType?: string;
  /** 수정된 문제 여부 */
  hasUpdate?: boolean;
  /** 수정 모드 여부 */
  isEditMode?: boolean;
  /** 수정 내용 변경 콜백 */
  onEditChange?: (field: string, value: any) => void;
  /** 현재 수정 중인 데이터 */
  editData?: { question?: string; options?: string[]; explanation?: string; choiceExplanations?: string[] };
}

/**
 * 복습 문제 카드 컴포넌트
 */
export default function QuestionCard({
  item,
  questionNumber,
  subQuestionNumber,
  isSelectMode,
  isSelected,
  onSelect,
  onFeedbackSubmit,
  onFeedbackDone,
  currentUserId,
  quizCreatorId,
  isAiGenerated,
  courseId,
  folderType,
  hasUpdate,
  isEditMode,
  onEditChange,
  editData,
}: QuestionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [selectedFeedbackTypes, setSelectedFeedbackTypes] = useState<Set<FeedbackType>>(new Set());
  const [feedbackContent, setFeedbackContent] = useState('');
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState(false);
  const [isFeedbackSubmitted, setIsFeedbackSubmitted] = useState(false);
  const [isFeedbackDone, setIsFeedbackDone] = useState(false);
  const [expandedChoices, setExpandedChoices] = useState<Set<number>>(new Set());

  const toggleFeedbackType = (type: FeedbackType) => {
    setSelectedFeedbackTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // 피드백 제출
  const handleFeedbackSubmit = async () => {
    if (selectedFeedbackTypes.size === 0 || !onFeedbackSubmit) return;
    setIsFeedbackSubmitting(true);
    try {
      const types = Array.from(selectedFeedbackTypes);
      for (const type of types) {
        await onFeedbackSubmit(item.questionId, type, feedbackContent);
      }
      // 피드백 제출 완료 콜백 (EXP 토스트 표시용)
      onFeedbackDone?.(types.length);
      setIsFeedbackDone(true);
      setTimeout(() => {
        setIsFeedbackSubmitted(true);
        setIsFeedbackOpen(false);
        setSelectedFeedbackTypes(new Set());
        setFeedbackContent('');
        setIsFeedbackDone(false);
      }, 800);
    } catch (err) {
      console.error('피드백 제출 실패:', err);
    } finally {
      setIsFeedbackSubmitting(false);
    }
  };

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border bg-[#F5F0E8] transition-all ${
        isSelectMode
          ? isSelected
            ? 'border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]'
            : 'border border-dashed border-[#5C5C5C]'
          : 'border-[#1A1A1A]'
      }`}
    >
      {/* 헤더 */}
      <div
        onClick={() => {
          if (isSelectMode) {
            onSelect();
          } else {
            setIsExpanded(!isExpanded);
          }
        }}
        className="p-2.5 cursor-pointer"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* 문항 번호 + 정답/오답 표시 + 챕터 */}
            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
              <span className="inline-block px-1.5 py-0.5 text-[11px] font-bold bg-[#1A1A1A] text-[#F5F0E8]">
                Q{questionNumber}{subQuestionNumber ? `-${subQuestionNumber}` : (item.combinedGroupId && item.combinedIndex !== undefined ? `-${item.combinedIndex + 1}` : '')}
              </span>
              {/* 결합형 표시 */}
              {item.combinedGroupId && !subQuestionNumber && (
                <span className="inline-block px-1.5 py-0.5 text-[11px] font-bold border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]">
                  결합형 문제
                </span>
              )}
              {item.isCorrect !== undefined && (
                <span className={`inline-block px-1.5 py-0.5 text-[11px] font-bold ${
                  item.isCorrect
                    ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
                    : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
                }`}>
                  {item.isCorrect ? '정답' : '오답'}
                </span>
              )}
              {/* 챕터 표시 */}
              {courseId && item.chapterId && (
                <span className="inline-block px-1.5 py-0.5 text-[11px] font-medium bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7]">
                  {formatChapterLabel(courseId, item.chapterId, item.chapterDetailId)}
                </span>
              )}
            </div>
            <p className="text-xs text-[#1A1A1A]">
              {item.question}
              {/* 제시문 발문 또는 보기 발문 표시 */}
              {(item.passagePrompt || item.bogiQuestionText) && (
                <span className="ml-1 text-[#5C5C5C]">
                  {item.passagePrompt || item.bogiQuestionText}
                </span>
              )}
            </p>
          </div>

          {/* 오른쪽 영역: 아이콘 + 찜 뱃지 */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {/* 선택 체크박스 */}
            {isSelectMode && (
              <div className={`w-5 h-5 flex items-center justify-center ${
                isSelected ? 'bg-[#1A1A1A]' : 'border border-[#5C5C5C]'
              }`}>
                {isSelected && (
                  <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            )}

            {/* 수정 뱃지 + 확장 아이콘 */}
            {!isSelectMode && (
              <div className="flex items-center gap-1">
                {hasUpdate && (
                  <div className="w-4 h-4 bg-[#F5C518] rounded-full border border-[#1A1A1A] flex items-center justify-center">
                    <span className="text-[#1A1A1A] font-bold text-[9px] leading-none">!</span>
                  </div>
                )}
                <svg
                  className={`w-5 h-5 text-[#5C5C5C] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 상세 정보 */}
      <AnimatePresence>
        {isExpanded && !isSelectMode && (
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
                    value={editData?.question ?? item.question}
                    onChange={(e) => onEditChange('question', e.target.value)}
                    className="w-full p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm text-[#1A1A1A] focus:outline-none resize-none"
                    rows={3}
                    style={{ minHeight: '60px' }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = target.scrollHeight + 'px';
                    }}
                  />
                </div>
              )}

              {/* 결합형 공통 정보 (단일 문제로 표시될 때) - 공통 문제는 아코디언 헤더에 표시되므로 생략 */}
              {item.combinedGroupId && !subQuestionNumber && (
                <div className="space-y-3 mb-4">
                  {/* 공통 지문 */}
                  {(item.passage || item.passageImage || (item.koreanAbcItems && item.koreanAbcItems.length > 0) || ((item as any).passageMixedExamples && (item as any).passageMixedExamples.length > 0)) && (() => {
                    // 지문과 이미지가 둘 다 있는지 확인
                    const hasText = item.passage || (item.koreanAbcItems && item.koreanAbcItems.length > 0) || ((item as any).passageMixedExamples && (item as any).passageMixedExamples.length > 0);
                    const hasImage = !!item.passageImage;
                    const needsInnerBox = hasText && hasImage;

                    return (
                      <div className="p-3 border-2 border-[#8B6914] bg-[#FFF8E1]">
                        {/* 텍스트 */}
                        {item.passage && item.passageType !== 'korean_abc' && (
                          needsInnerBox ? (
                            <div className="p-3 bg-[#FFFDF7] border border-[#E8D9A8]">
                              <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{item.passage}</p>
                            </div>
                          ) : (
                            <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{item.passage}</p>
                          )
                        )}
                        {/* ㄱㄴㄷ 형식 */}
                        {item.passageType === 'korean_abc' && item.koreanAbcItems && item.koreanAbcItems.length > 0 && (
                          needsInnerBox ? (
                            <div className="p-3 bg-[#FFFDF7] border border-[#E8D9A8]">
                              <div className="space-y-1">
                                {item.koreanAbcItems.map((itm, idx) => (
                                  <p key={idx} className="text-sm text-[#1A1A1A]">
                                    <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {itm}
                                  </p>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {item.koreanAbcItems.map((itm, idx) => (
                                <p key={idx} className="text-sm text-[#1A1A1A]">
                                  <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {itm}
                                </p>
                              ))}
                            </div>
                          )
                        )}
                        {/* 혼합 형식 */}
                        {(item as any).passageMixedExamples && (item as any).passageMixedExamples.length > 0 && (
                          <div className="space-y-2">
                            {(item as any).passageMixedExamples.map((block: any) => (
                              <div key={block.id}>
                                {block.type === 'grouped' && (
                                  <div className="space-y-1">
                                    {(block.children || []).map((child: any) => (
                                      <div key={child.id}>
                                        {child.type === 'text' && <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>}
                                        {child.type === 'labeled' && (child.items || []).map((i: any) => (
                                          <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
                                        ))}
                                        {child.type === 'gana' && (child.items || []).map((i: any) => (
                                          <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
                                        ))}
                                        {child.type === 'image' && child.imageUrl && <Image src={child.imageUrl} alt="" width={800} height={400} className="max-w-full h-auto" unoptimized />}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {block.type === 'text' && <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>}
                                {block.type === 'labeled' && (
                                  <div className="space-y-1">
                                    {(block.items || []).map((i: any) => (
                                      <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
                                    ))}
                                  </div>
                                )}
                                {block.type === 'gana' && (
                                  <div className="space-y-1">
                                    {(block.items || []).map((i: any) => (
                                      <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
                                    ))}
                                  </div>
                                )}
                                {block.type === 'image' && block.imageUrl && <Image src={block.imageUrl} alt="" width={800} height={400} className="max-w-full h-auto" unoptimized />}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* 이미지 */}
                        {item.passageImage && (
                          <Image src={item.passageImage} alt="공통 이미지" width={800} height={400} className={`max-w-full max-h-[300px] object-contain border border-[#1A1A1A] ${hasText ? 'mt-3' : ''}`} unoptimized />
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* 보기 (혼합 보기 또는 레거시 형식) - 이미지보다 먼저 표시 */}
              {item.mixedExamples && item.mixedExamples.length > 0 ? (
                // 혼합 보기가 있는 경우 (grouped 먼저, 나머지 생성 순서대로)
                <>
                  {/* 1. 묶은 보기 (grouped) 먼저 */}
                  {item.mixedExamples.filter(b => b.type === 'grouped').map((block) => (
                    <div key={block.id} className="p-3 border-2 border-[#8B6914] bg-[#FFF8E1] mb-3">
                      <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                      <div className="space-y-1">
                        {block.children?.map((child) => (
                          <div key={child.id}>
                            {child.type === 'text' && child.content?.trim() && (
                              <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>
                            )}
                            {child.type === 'labeled' && (child.items || []).filter(i => i.content.trim()).map((labeledItem) => (
                              <p key={labeledItem.id} className="text-sm text-[#1A1A1A]">
                                <span className="font-bold">{labeledItem.label}.</span> {labeledItem.content}
                              </p>
                            ))}
                            {child.type === 'gana' && (child.items || []).filter(i => i.content.trim()).map((labeledItem) => (
                              <p key={labeledItem.id} className="text-sm text-[#1A1A1A]">
                                <span className="font-bold">({labeledItem.label})</span> {labeledItem.content}
                              </p>
                            ))}
                            {child.type === 'image' && child.imageUrl && (
                              <Image src={child.imageUrl} alt="보기 이미지" width={800} height={400} className="max-w-full h-auto border border-[#1A1A1A]" unoptimized />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {/* 2. 나머지 블록 (생성 순서대로) */}
                  {item.mixedExamples.filter(b => b.type !== 'grouped').map((block) => {
                    if (block.type === 'text' && block.content?.trim()) {
                      return (
                        <div key={block.id} className="p-3 border border-[#8B6914] bg-[#FFF8E1] mb-3">
                          <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                          <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>
                        </div>
                      );
                    }
                    if (block.type === 'labeled') {
                      return (
                        <div key={block.id} className="p-3 border border-[#8B6914] bg-[#FFF8E1] mb-3">
                          <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                          <div className="space-y-1">
                            {(block.items || []).filter(i => i.content.trim()).map((labeledItem) => (
                              <p key={labeledItem.id} className="text-sm text-[#1A1A1A]">
                                <span className="font-bold">{labeledItem.label}.</span> {labeledItem.content}
                              </p>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    if (block.type === 'gana') {
                      return (
                        <div key={block.id} className="p-3 border border-[#8B6914] bg-[#FFF8E1] mb-3">
                          <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                          <div className="space-y-1">
                            {(block.items || []).filter(i => i.content.trim()).map((labeledItem) => (
                              <p key={labeledItem.id} className="text-sm text-[#1A1A1A]">
                                <span className="font-bold">({labeledItem.label})</span> {labeledItem.content}
                              </p>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })}
                </>
              ) : (
                // 레거시 보기 (텍스트 또는 ㄱㄴㄷ 형식)
                item.subQuestionOptions && item.subQuestionOptions.length > 0 && (
                  <div className="p-3 border border-[#8B6914] bg-[#FFF8E1] mb-3">
                    <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                    {item.subQuestionOptionsType === 'text' ? (
                      <p className="text-sm text-[#1A1A1A]">
                        {item.subQuestionOptions.join(', ')}
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {item.subQuestionOptions.map((opt, idx) => (
                          <p key={idx} className="text-sm text-[#1A1A1A]">
                            <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {opt}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )
              )}

              {/* 문제 이미지 - 보기 다음에 표시 */}
              {item.image && (
                <div className="mb-3">
                  <Image
                    src={item.image}
                    alt="문제 이미지"
                    width={800}
                    height={400}
                    className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A]"
                    unoptimized
                  />
                </div>
              )}

              {/* 하위 문제 이미지 */}
              {item.subQuestionImage && (
                <div className="mb-3">
                  <Image
                    src={item.subQuestionImage}
                    alt="보기 이미지"
                    width={800}
                    height={400}
                    className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A]"
                    unoptimized
                  />
                </div>
              )}

              {/* 보기 (<보기> 박스) - 이미지 다음, 발문 전에 표시 */}
              {item.bogi && item.bogi.items && item.bogi.items.some(i => i.content?.trim()) && (
                <div className="mb-3 p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
                  <p className="text-xs text-center text-[#5C5C5C] mb-2 font-bold">&lt;보 기&gt;</p>
                  <div className="space-y-1">
                    {item.bogi.items.filter(i => i.content?.trim()).map((bogiItem, idx) => (
                      <p key={idx} className="text-sm text-[#1A1A1A]">
                        <span className="font-bold mr-1">{bogiItem.label}.</span>
                        {bogiItem.content}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* 발문 (제시문 발문 + 보기 발문 합침, 선지 전에 표시) */}
              {(item.passagePrompt || item.bogiQuestionText) && (
                <div className="mb-3 p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
                  <p className="text-sm text-[#1A1A1A]">
                    {item.passagePrompt && item.bogiQuestionText
                      ? `${item.passagePrompt} ${item.bogiQuestionText}`
                      : item.passagePrompt || item.bogiQuestionText}
                  </p>
                </div>
              )}

              {/* OX 문제 - 시각적 O/X 버튼 */}
              {item.type === 'ox' && (() => {
                // OX 값 정규화 함수 (다양한 형식 지원)
                const normalizeOX = (value: unknown): 'O' | 'X' | null => {
                  if (value === null || value === undefined || value === '') return null;
                  const str = String(value).toLowerCase().trim();
                  // O로 인식: 'o', 'O', '0', 0, true, 'true', 'yes', '참'
                  if (str === 'o' || str === '0' || str === 'true' || str === 'yes' || str === '참' || value === 0 || value === true) {
                    return 'O';
                  }
                  // X로 인식: 'x', 'X', '1', 1, false, 'false', 'no', '거짓'
                  if (str === 'x' || str === '1' || str === 'false' || str === 'no' || str === '거짓' || value === 1 || value === false) {
                    return 'X';
                  }
                  return null;
                };

                const normalizedCorrect = normalizeOX(item.correctAnswer);
                const normalizedUser = normalizeOX(item.userAnswer);
                const isOCorrect = normalizedCorrect === 'O';
                const isXCorrect = normalizedCorrect === 'X';
                const userSelectedO = normalizedUser === 'O';
                const userSelectedX = normalizedUser === 'X';

                return (
                  <div className="space-y-2">
                    <div className="flex gap-3 justify-center py-1">
                      {/* O 버튼 */}
                      <div
                        className={`w-12 h-12 text-2xl font-bold border-2 flex items-center justify-center transition-colors ${
                          isOCorrect
                            ? 'bg-[#1A6B1A] border-[#1A6B1A] text-[#F5F0E8]'
                            : userSelectedO
                              ? 'bg-[#8B1A1A] border-[#8B1A1A] text-[#F5F0E8]'
                              : 'bg-[#F5F0E8] border-[#1A1A1A] text-[#5C5C5C]'
                        }`}
                      >
                        O
                      </div>
                      {/* X 버튼 */}
                      <div
                        className={`w-12 h-12 text-2xl font-bold border-2 flex items-center justify-center transition-colors ${
                          isXCorrect
                            ? 'bg-[#1A6B1A] border-[#1A6B1A] text-[#F5F0E8]'
                            : userSelectedX
                              ? 'bg-[#8B1A1A] border-[#8B1A1A] text-[#F5F0E8]'
                              : 'bg-[#F5F0E8] border-[#1A1A1A] text-[#5C5C5C]'
                        }`}
                      >
                        X
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 객관식 문제 - 시각적 선지 버튼 */}
              {item.type === 'multiple' && item.options && item.options.length > 0 && (
                <div className="space-y-2">
                  {/* 복수 정답 표시 */}
                  {(() => {
                    const correctAnswerStr = item.correctAnswer?.toString() || '';
                    const correctAnswers = correctAnswerStr.includes(',')
                      ? correctAnswerStr.split(',').map(a => a.trim())
                      : [correctAnswerStr];
                    const isMultipleAnswer = correctAnswers.length > 1;
                    return isMultipleAnswer && (
                      <p className="text-[10px] text-[#8B6914] font-bold flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        복수 정답 ({correctAnswers.length}개)
                      </p>
                    );
                  })()}
                  <div className="space-y-1.5">
                    {(editData?.options ?? item.options).map((opt, idx) => {
                      const optionNum = (idx + 1).toString();
                      // 복수 정답 지원 - 1-indexed 번호만 사용 (optionIdx 제거)
                      const correctAnswerStr = item.correctAnswer?.toString() || '';
                      const correctAnswers = correctAnswerStr.includes(',')
                        ? correctAnswerStr.split(',').map(a => a.trim())
                        : [correctAnswerStr];
                      // 정답 비교: 1-indexed 번호만 사용
                      const isCorrectOption = correctAnswers.some(ca => ca === optionNum);
                      // 사용자 답 비교 - 1-indexed 번호만 사용
                      const userAnswerStr = item.userAnswer?.toString() || '';
                      const userAnswers = userAnswerStr.includes(',')
                        ? userAnswerStr.split(',').map(a => a.trim())
                        : [userAnswerStr];
                      const isUserAnswer = userAnswers.some(ua => ua === optionNum);
                      const isWrongAnswer = isUserAnswer && !isCorrectOption;

                      // 스타일 결정
                      let bgColor = '#F5F0E8';
                      let borderColor = '#1A1A1A';
                      let textColor = '#1A1A1A';

                      if (!isEditMode) {
                        if (isCorrectOption) {
                          bgColor = '#1A6B1A';
                          borderColor = '#1A6B1A';
                          textColor = '#F5F0E8';
                        } else if (isWrongAnswer) {
                          bgColor = '#8B1A1A';
                          borderColor = '#8B1A1A';
                          textColor = '#F5F0E8';
                        }
                      }

                      // 복수정답 여부 확인
                      const isMultipleAnswerQuestion = correctAnswers.length > 1;
                      // 선지별 해설
                      const currentChoiceExps = editData?.choiceExplanations ?? item.choiceExplanations;
                      const choiceExp = currentChoiceExps?.[idx];
                      const isChoiceExpanded = expandedChoices.has(idx);

                      return (
                        <div key={idx}>
                          <div
                            style={isEditMode ? {} : { backgroundColor: bgColor, borderColor, color: textColor }}
                            className={`w-full p-2 border-2 flex items-start gap-2 text-left ${
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
                              className={`flex-shrink-0 w-5 h-5 flex items-center justify-center text-xs font-bold ${
                                isEditMode
                                  ? 'bg-[#EDEAE4] text-[#1A1A1A]'
                                  : isCorrectOption || isWrongAnswer
                                    ? 'bg-[#F5F0E8]/20 text-[#F5F0E8]'
                                    : 'bg-[#EDEAE4] text-[#1A1A1A]'
                              }`}
                            >
                              {choiceLabels[idx] || `${idx + 1}`}
                            </span>
                            {/* 선지 텍스트 - 수정 모드면 input */}
                            {isEditMode && onEditChange ? (
                              <input
                                type="text"
                                value={opt}
                                onChange={(e) => {
                                  const newOptions = [...(editData?.options ?? item.options ?? [])];
                                  newOptions[idx] = e.target.value;
                                  onEditChange('options', newOptions);
                                }}
                                className="flex-1 text-xs bg-transparent border-b border-[#5C5C5C] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
                              />
                            ) : (
                              <span className="flex-1 text-xs leading-relaxed break-words">
                                {opt}
                                {isMultipleAnswerQuestion && isCorrectOption && <span className="ml-1 font-bold">(정답)</span>}
                                {isMultipleAnswerQuestion && isUserAnswer && <span className="ml-1 font-bold">(내 답)</span>}
                              </span>
                            )}
                            {/* 체크 아이콘 또는 아코디언 화살표 (수정 모드에서는 숨김) */}
                            {!isEditMode && (
                              (isCorrectOption || isUserAnswer) ? (
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d={isCorrectOption ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"} />
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
                          {/* 선지별 해설 - 수정 모드면 전부 펼침 + textarea */}
                          {isEditMode && onEditChange ? (
                            <div className="px-3 py-2 border-x-2 border-b-2 border-[#1A1A1A] bg-[#EDEAE4]">
                              <label className="block text-[10px] text-[#5C5C5C] mb-1">선지 {idx + 1} 해설</label>
                              <textarea
                                value={(editData?.choiceExplanations ?? item.choiceExplanations ?? [])[idx] || ''}
                                onChange={(e) => {
                                  const newExps = [...(editData?.choiceExplanations ?? item.choiceExplanations ?? [])];
                                  // 배열 길이가 부족하면 확장
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
                              className="px-3 py-2 border-x-2 border-b-2 bg-[#EDEAE4]"
                            >
                              <p className={`text-xs whitespace-pre-wrap ${
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

              {/* 단답형/서술형 답 */}
              {(item.type === 'short' || item.type === 'short_answer' || item.type === 'subjective' || item.type === 'essay') && (
                <div className="space-y-2">
                  {/* 내 답 */}
                  <div className="p-2 border-2 border-[#1A1A1A] bg-[#F5F0E8]">
                    <p className="text-[10px] text-[#5C5C5C] mb-0.5">내 답</p>
                    <p className={`text-xs font-medium whitespace-pre-wrap ${item.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                      {item.userAnswer || '(미응답)'}
                    </p>
                  </div>
                  {/* 정답 */}
                  {item.correctAnswer && (
                    <div className="p-2 border-2 border-[#1A6B1A] bg-[#E8F5E9]">
                      <p className="text-[10px] text-[#1A6B1A] mb-0.5">정답</p>
                      <p className="text-xs font-medium text-[#1A6B1A] whitespace-pre-wrap">
                        {/* 복수 정답 표시 (||| -> , 로 변환) */}
                        {item.correctAnswer?.includes('|||')
                          ? item.correctAnswer.split('|||').map((a: string) => a.trim()).join(', ')
                          : item.correctAnswer
                        }
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 기타 타입 (위 조건에 해당하지 않는 경우) - 답 표시 */}
              {item.type !== 'ox' &&
               item.type !== 'multiple' &&
               item.type !== 'short' &&
               item.type !== 'short_answer' &&
               item.type !== 'subjective' &&
               item.type !== 'essay' &&
               (item.userAnswer || item.correctAnswer) && (
                <div className="space-y-2">
                  {item.userAnswer && (
                    <div className="p-2 border-2 border-[#1A1A1A] bg-[#F5F0E8]">
                      <p className="text-[10px] text-[#5C5C5C] mb-0.5">내 답</p>
                      <p className={`text-xs font-medium whitespace-pre-wrap ${item.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                        {item.userAnswer}
                      </p>
                    </div>
                  )}
                  {item.correctAnswer && (
                    <div className="p-2 border-2 border-[#1A6B1A] bg-[#E8F5E9]">
                      <p className="text-[10px] text-[#1A6B1A] mb-0.5">정답</p>
                      <p className="text-xs font-medium text-[#1A6B1A] whitespace-pre-wrap">
                        {item.correctAnswer}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 해설 */}
              {isEditMode && onEditChange ? (
                <div className="p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
                  <label className="block text-xs font-bold text-[#5C5C5C] mb-1">해설</label>
                  <textarea
                    value={editData?.explanation ?? item.explanation ?? ''}
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
              ) : item.explanation ? (
                <div className="p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
                  <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                  <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">
                    {item.explanation}
                  </p>
                </div>
              ) : null}


              {/* 피드백 버튼 - 자기 문제가 아닌 경우에만 표시 */}
              {onFeedbackSubmit && !(currentUserId && (quizCreatorId === currentUserId || item.quizCreatorId === currentUserId)) && (
                <div className="pt-3 border-t border-[#EDEAE4] flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isFeedbackSubmitted) {
                        setIsFeedbackOpen(true);
                      }
                    }}
                    disabled={isFeedbackSubmitted}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold border transition-colors rounded-md ${
                      isFeedbackSubmitted
                        ? 'bg-[#E8F5E9] border-[#1A6B1A] text-[#1A6B1A] cursor-default'
                        : 'bg-[#FFF8E1] border-[#8B6914] text-[#8B6914] hover:bg-[#FFECB3]'
                    }`}
                  >
                    {isFeedbackSubmitted ? (
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
    </motion.div>

      {/* 피드백 바텀시트 */}
      <BottomSheet
        isOpen={isFeedbackOpen}
        onClose={() => {
          setIsFeedbackOpen(false);
          setSelectedFeedbackTypes(new Set());
          setFeedbackContent('');
        }}
        title="문제 피드백"
        height="auto"
      >
        <div className="space-y-4">
          {/* 피드백 유형 선택 */}
          <div>
            <p className="text-xs text-[#5C5C5C] mb-3">이 문제에 대한 의견을 선택해주세요</p>
            <div className="grid grid-cols-2 gap-2">
              {FEEDBACK_TYPES.map(({ type, label, positive }) => (
                <button
                  key={type}
                  onClick={() => toggleFeedbackType(type)}
                  className={`p-2.5 border-2 text-sm font-bold transition-all rounded-lg ${
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
                <label className="block text-sm text-[#5C5C5C] mb-2">추가 의견 (선택)</label>
                <textarea
                  value={feedbackContent}
                  onChange={(e) => setFeedbackContent(e.target.value)}
                  placeholder="자세한 내용을 적어주세요"
                  rows={3}
                  maxLength={200}
                  className="w-full p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] focus:outline-none resize-none text-sm rounded-lg"
                />
                <p className="text-xs text-[#5C5C5C] text-right mt-1">{feedbackContent.length}/200</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 제출 버튼 */}
          <button
            onClick={handleFeedbackSubmit}
            disabled={selectedFeedbackTypes.size === 0 || isFeedbackSubmitting || isFeedbackDone}
            className={`w-full py-2.5 font-bold border-2 transition-colors rounded-lg ${
              isFeedbackDone
                ? 'bg-[#1A6B1A] text-[#F5F0E8] border-[#1A6B1A]'
                : selectedFeedbackTypes.size > 0
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C] cursor-not-allowed'
            }`}
          >
            {isFeedbackDone ? '✓' : isFeedbackSubmitting ? '제출 중...' : '피드백 보내기'}
          </button>
          <p className="text-xs text-[#5C5C5C] text-center">피드백은 익명으로 전달됩니다.</p>
        </div>
      </BottomSheet>
    </>
  );
}
