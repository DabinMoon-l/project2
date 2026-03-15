'use client';

import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import type { ReviewItem, FolderCategory } from '@/lib/hooks/useReview';
import type { DisplayItem, FeedbackType } from '@/components/review/types';
import { KOREAN_LABELS } from '@/lib/utils/reviewQuestionUtils';
import QuestionCard from '@/components/review/QuestionCard';
import MixedExamplesRenderer from '@/components/common/MixedExamplesRenderer';

/** 카테고리별 그룹 */
export interface CategoryGroup {
  category: FolderCategory | null;
  items: ReviewItem[];
}

/** 문제 목록 섹션 Props */
export interface QuestionListSectionProps {
  /** 전체 문제 목록 */
  questions: ReviewItem[];
  /** 화면 표시용 아이템 목록 (단일 + 결합형 그룹) */
  displayItems: DisplayItem[];
  /** 카테고리별 그룹 (커스텀 폴더일 때) */
  groupedByCategory: CategoryGroup[] | null;
  /** 선택 모드 여부 */
  isSelectMode: boolean;
  /** 선택된 ID 집합 */
  selectedIds: Set<string>;
  /** 문제 선택 핸들러 */
  onSelectQuestion: (questionId: string) => void;
  /** 선택 ID 일괄 업데이트 (결합형 그룹 전체 선택용) */
  onSetSelectedIds: (ids: Set<string>) => void;
  /** 결합형 그룹 펼침 상태 */
  expandedGroupIds: Set<string>;
  /** 결합형 그룹 펼침/접힘 토글 */
  onToggleGroupExpand: (groupId: string) => void;
  /** 피드백 제출 핸들러 */
  onFeedbackSubmit: (questionId: string, type: FeedbackType, content: string) => Promise<void>;
  /** 피드백 완료 핸들러 */
  onFeedbackDone: (count: number) => void;
  /** 현재 사용자 ID */
  currentUserId?: string;
  /** 퀴즈별 생성자 ID 맵 */
  quizCreatorsMap: Map<string, string>;
  /** 퀴즈별 AI 생성 여부 맵 */
  quizAiMap: Map<string, boolean>;
  /** 폴더 타입 */
  folderType: string;
  /** 과목 ID */
  courseId?: string;
  /** 수정된 문제 ID 집합 */
  updatedQuestionIds: Set<string>;
}

/**
 * 문제 목록 렌더링 섹션 (카테고리 그룹 / 일반 목록 + 결합형 그룹)
 */
export default function QuestionListSection({
  questions,
  displayItems,
  groupedByCategory,
  isSelectMode,
  selectedIds,
  onSelectQuestion,
  onSetSelectedIds,
  expandedGroupIds,
  onToggleGroupExpand,
  onFeedbackSubmit,
  onFeedbackDone,
  currentUserId,
  quizCreatorsMap,
  quizAiMap,
  folderType,
  courseId,
  updatedQuestionIds,
}: QuestionListSectionProps) {
  if (questions.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-[#5C5C5C]">문제가 없습니다.</p>
      </div>
    );
  }

  // 카테고리별로 그룹화된 표시
  if (groupedByCategory) {
    return (
      <div className="space-y-4">
        {groupedByCategory.map((group, groupIndex) => (
          <div key={group.category?.id || 'uncategorized'}>
            {/* 카테고리 헤더 */}
            <div className="flex items-center gap-2 mb-2 mt-4">
              <span className="font-bold text-[#1A1A1A] text-sm">
                {group.category?.name || '미분류'}
              </span>
              <div className="flex-1 border-t border-dashed border-[#5C5C5C]" />
              <span className="text-xs text-[#5C5C5C]">
                {group.items.length}문제
              </span>
            </div>
            {/* 해당 카테고리의 문제들 */}
            <div className="space-y-2">
              {group.items.length === 0 ? (
                <p className="text-xs text-[#5C5C5C] py-2 text-center">문제가 없습니다</p>
              ) : (
                group.items.map((item, index) => {
                  // 전체 문제 목록에서의 인덱스 계산
                  let globalIndex = 0;
                  for (let i = 0; i < groupIndex; i++) {
                    globalIndex += groupedByCategory[i].items.length;
                  }
                  globalIndex += index;

                  return (
                    <QuestionCard
                      key={item.id}
                      item={item}
                      questionNumber={globalIndex + 1}
                      isSelectMode={isSelectMode}
                      isSelected={selectedIds.has(item.id)}
                      onSelect={() => onSelectQuestion(item.id)}
                      onFeedbackSubmit={onFeedbackSubmit}
                      onFeedbackDone={onFeedbackDone}
                      currentUserId={currentUserId}
                      quizCreatorId={quizCreatorsMap.get(item.quizId)}
                      isAiGenerated={quizAiMap.get(item.quizId)}
                      folderType={folderType}
                      courseId={courseId}
                      hasUpdate={updatedQuestionIds.has(item.questionId)}
                    />
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // 일반 목록 표시 (결합형 그룹 포함)
  return (
    <>
      {displayItems.map((displayItem) => {
        // 단일 문제
        if (displayItem.type === 'single' && displayItem.item) {
          const item = displayItem.item;
          return (
            <QuestionCard
              key={item.id}
              item={item}
              questionNumber={displayItem.displayNumber}
              isSelectMode={isSelectMode}
              isSelected={selectedIds.has(item.id)}
              onSelect={() => onSelectQuestion(item.id)}
              onFeedbackSubmit={onFeedbackSubmit}
              onFeedbackDone={onFeedbackDone}
              currentUserId={currentUserId}
              quizCreatorId={quizCreatorsMap.get(item.quizId)}
              isAiGenerated={quizAiMap.get(item.quizId)}
              courseId={courseId}
              folderType={folderType}
              hasUpdate={updatedQuestionIds.has(item.questionId)}
            />
          );
        }

        // 결합형 그룹
        if (displayItem.type === 'combined_group' && displayItem.items && displayItem.combinedGroupId) {
          return (
            <CombinedGroupCard
              key={displayItem.combinedGroupId}
              displayItem={displayItem}
              isSelectMode={isSelectMode}
              selectedIds={selectedIds}
              onSetSelectedIds={onSetSelectedIds}
              isGroupExpanded={expandedGroupIds.has(displayItem.combinedGroupId)}
              onToggleGroupExpand={onToggleGroupExpand}
              onFeedbackSubmit={onFeedbackSubmit}
              onFeedbackDone={onFeedbackDone}
              currentUserId={currentUserId}
              quizCreatorsMap={quizCreatorsMap}
              quizAiMap={quizAiMap}
              folderType={folderType}
              courseId={courseId}
              updatedQuestionIds={updatedQuestionIds}
            />
          );
        }

        return null;
      })}
    </>
  );
}

// ─── 결합형 그룹 카드 (내부 컴포넌트) ───────────────────────────

interface CombinedGroupCardProps {
  displayItem: DisplayItem;
  isSelectMode: boolean;
  selectedIds: Set<string>;
  onSetSelectedIds: (ids: Set<string>) => void;
  isGroupExpanded: boolean;
  onToggleGroupExpand: (groupId: string) => void;
  onFeedbackSubmit: (questionId: string, type: FeedbackType, content: string) => Promise<void>;
  onFeedbackDone: (count: number) => void;
  currentUserId?: string;
  quizCreatorsMap: Map<string, string>;
  quizAiMap: Map<string, boolean>;
  folderType: string;
  courseId?: string;
  updatedQuestionIds: Set<string>;
}

function CombinedGroupCard({
  displayItem,
  isSelectMode,
  selectedIds,
  onSetSelectedIds,
  isGroupExpanded,
  onToggleGroupExpand,
  onFeedbackSubmit,
  onFeedbackDone,
  currentUserId,
  quizCreatorsMap,
  quizAiMap,
  folderType,
  courseId,
  updatedQuestionIds,
}: CombinedGroupCardProps) {
  const groupId = displayItem.combinedGroupId!;
  const groupItems = displayItem.items!;
  const correctInGroup = groupItems.filter(r => r.isCorrect).length;
  const totalInGroup = groupItems.length;
  const firstItem = groupItems[0];

  // 그룹 내 선택된 문제 수
  const selectedInGroup = groupItems.filter(r => selectedIds.has(r.id)).length;
  const isGroupSelected = selectedInGroup > 0;

  return (
    <div>
      {/* 그룹 헤더 */}
      <div
        onClick={() => {
          if (isSelectMode) {
            // 선택 모드: 그룹 전체 선택/해제
            const newSelected = new Set(selectedIds);
            if (selectedInGroup === totalInGroup) {
              groupItems.forEach(r => newSelected.delete(r.id));
            } else {
              groupItems.forEach(r => newSelected.add(r.id));
            }
            onSetSelectedIds(newSelected);
          } else {
            onToggleGroupExpand(groupId);
          }
        }}
        className={`border p-3 cursor-pointer transition-all ${
          isSelectMode
            ? isGroupSelected
              ? 'border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]'
              : 'border border-dashed border-[#5C5C5C] bg-[#F5F0E8]'
            : 'border-[#1A1A1A] bg-[#F5F0E8]'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* 문항 번호 + 결합형 표시 + 정답 수 */}
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="inline-block px-2 py-0.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8]">
                Q{displayItem.displayNumber}
              </span>
              <span className="inline-block px-2 py-0.5 text-xs font-bold border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]">
                결합형 문제
              </span>
              <span className={`inline-block px-2 py-0.5 text-xs font-bold ${
                correctInGroup === totalInGroup
                  ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
                  : correctInGroup > 0
                  ? 'bg-[#FFF8E1] text-[#8B6914] border border-[#8B6914]'
                  : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
              }`}>
                {correctInGroup}/{totalInGroup} 정답
              </span>
            </div>
            {/* 공통 지문/문제 미리보기 */}
            <p className="text-sm text-[#1A1A1A]">
              {firstItem.commonQuestion || firstItem.passage || '결합형 문제'}
              {/* 제시문 발문 표시 */}
              {firstItem.passagePrompt && (
                <span className="ml-1 text-[#5C5C5C]">
                  {firstItem.passagePrompt}
                </span>
              )}
            </p>
          </div>

          {/* 오른쪽 영역: 체크박스/화살표 */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {isSelectMode ? (
              <div className={`w-5 h-5 flex items-center justify-center ${
                selectedInGroup === totalInGroup ? 'bg-[#1A1A1A]' : selectedInGroup > 0 ? 'bg-[#5C5C5C]' : 'border border-[#5C5C5C]'
              }`}>
                {selectedInGroup > 0 && (
                  <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            ) : (
              <svg
                className={`w-5 h-5 text-[#5C5C5C] transition-transform ${isGroupExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </div>
        </div>
      </div>

      {/* 그룹 펼침 (공통 지문 + 하위 문제들) */}
      <AnimatePresence>
        {isGroupExpanded && !isSelectMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border border-t-0 border-[#1A1A1A] bg-[#F5F0E8] p-4 space-y-4">
              {/* 공통 지문 */}
              {(firstItem.passage || firstItem.passageImage || firstItem.koreanAbcItems || (firstItem.passageMixedExamples && firstItem.passageMixedExamples.length > 0)) && (() => {
                // 지문과 이미지가 둘 다 있는지 확인
                const hasText = firstItem.passage || (firstItem.koreanAbcItems && firstItem.koreanAbcItems.length > 0) || (firstItem.passageMixedExamples && firstItem.passageMixedExamples.length > 0);
                const hasImage = !!firstItem.passageImage;
                const needsInnerBox = hasText && hasImage;

                return (
                  <div className="p-3 border border-[#8B6914] bg-[#FFF8E1]">
                    {/* 텍스트 */}
                    {firstItem.passage && firstItem.passageType !== 'korean_abc' && (
                      needsInnerBox ? (
                        <div className="p-3 bg-[#FFFDF7] border border-[#E8D9A8]">
                          <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{firstItem.passage}</p>
                        </div>
                      ) : (
                        <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{firstItem.passage}</p>
                      )
                    )}
                    {/* ㄱㄴㄷ 형식 */}
                    {firstItem.passageType === 'korean_abc' && firstItem.koreanAbcItems && firstItem.koreanAbcItems.length > 0 && (
                      needsInnerBox ? (
                        <div className="p-3 bg-[#FFFDF7] border border-[#E8D9A8]">
                          <div className="space-y-1">
                            {firstItem.koreanAbcItems.map((itm, idx) => (
                              <p key={idx} className="text-sm text-[#1A1A1A]">
                                <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {itm}
                              </p>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {firstItem.koreanAbcItems.map((itm, idx) => (
                            <p key={idx} className="text-sm text-[#1A1A1A]">
                              <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {itm}
                            </p>
                          ))}
                        </div>
                      )
                    )}
                    {/* 혼합 형식 */}
                    {firstItem.passageMixedExamples && firstItem.passageMixedExamples.length > 0 && (
                      <MixedExamplesRenderer blocks={firstItem.passageMixedExamples} spacing="loose" textSize="sm" filterEmpty={false} imageRenderer="next-image" />
                    )}
                    {/* 이미지 */}
                    {firstItem.passageImage && (
                      <Image src={firstItem.passageImage} alt="공통 이미지" width={800} height={400} className={`max-w-full max-h-[300px] object-contain border border-[#1A1A1A] ${hasText ? 'mt-3' : ''}`} unoptimized />
                    )}
                  </div>
                );
              })()}

              {/* 하위 문제들 */}
              <div className="space-y-2 p-3 bg-[#EDEAE4] border border-[#D4CFC4]">
                {groupItems.map((subItem, subIdx) => (
                  <QuestionCard
                    key={subItem.id}
                    item={subItem}
                    questionNumber={displayItem.displayNumber}
                    subQuestionNumber={subIdx + 1}
                    isSelectMode={false}
                    isSelected={false}
                    onSelect={() => {}}
                    onFeedbackSubmit={onFeedbackSubmit}
                    onFeedbackDone={onFeedbackDone}
                    currentUserId={currentUserId}
                    quizCreatorId={quizCreatorsMap.get(subItem.quizId)}
                    isAiGenerated={quizAiMap.get(subItem.quizId)}
                    courseId={courseId}
                    folderType={folderType}
                    hasUpdate={updatedQuestionIds.has(subItem.questionId)}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
