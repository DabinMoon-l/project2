'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ReviewItem } from '@/lib/hooks/useReview';
import { sortByQuestionId } from '@/lib/utils/reviewQuestionUtils';
import type { CustomFolderQuestion } from '@/lib/hooks/useReview';

interface AddQuestionsViewProps {
  groupedSolvedItems: { quizId: string; quizTitle: string; items: ReviewItem[]; questionCount: number }[];
  solvedItems: ReviewItem[];
  customFolderQuestions: CustomFolderQuestion[];
  onClose: () => void;
  onAddQuestions: (selectedKeys: string[]) => Promise<void>;
}

/**
 * 커스텀 폴더에 문제 추가하는 뷰 (전체 화면 대체)
 */
export default function AddQuestionsView({
  groupedSolvedItems,
  solvedItems,
  customFolderQuestions,
  onClose,
  onAddQuestions,
}: AddQuestionsViewProps) {
  const [selectedQuizForAdd, setSelectedQuizForAdd] = useState<{ quizId: string; quizTitle: string } | null>(null);
  const [addSelectedIds, setAddSelectedIds] = useState<Set<string>>(new Set());
  const [expandedCombinedGroups, setExpandedCombinedGroups] = useState<Set<string>>(new Set());

  // 이미 폴더에 추가된 문제 키 목록
  const alreadyAddedQuestionKeys = useMemo(() => {
    return new Set(customFolderQuestions.map(q => `${q.quizId}:${q.questionId}`));
  }, [customFolderQuestions]);

  // 선택된 퀴즈의 문제 목록
  const quizItems = useMemo(() => {
    if (!selectedQuizForAdd) return [];
    return sortByQuestionId(solvedItems.filter(item => item.quizId === selectedQuizForAdd.quizId));
  }, [selectedQuizForAdd, solvedItems]);

  // 문제 선택/해제 (결합형은 그룹 전체)
  const handleAddSelect = useCallback((item: ReviewItem) => {
    const key = `${item.quizId}:${item.questionId}`;
    if (alreadyAddedQuestionKeys.has(key)) return;

    setAddSelectedIds(prev => {
      const newSelected = new Set(prev);
      if (item.combinedGroupId) {
        const groupItems = solvedItems.filter(
          i => i.combinedGroupId === item.combinedGroupId && i.quizId === item.quizId
        );
        const groupKeys = groupItems.map(i => `${i.quizId}:${i.questionId}`);
        const anySelected = groupKeys.some(k => newSelected.has(k));
        if (anySelected) {
          groupKeys.forEach(k => newSelected.delete(k));
        } else {
          groupKeys.forEach(k => {
            if (!alreadyAddedQuestionKeys.has(k)) newSelected.add(k);
          });
        }
      } else {
        if (newSelected.has(key)) newSelected.delete(key);
        else newSelected.add(key);
      }
      return newSelected;
    });
  }, [solvedItems, alreadyAddedQuestionKeys]);

  // 선택 가능한 모든 키 (이미 추가된 문제 제외)
  const selectableKeys = useMemo(() => {
    return quizItems
      .map(item => `${item.quizId}:${item.questionId}`)
      .filter(key => !alreadyAddedQuestionKeys.has(key));
  }, [quizItems, alreadyAddedQuestionKeys]);

  // 전체 선택 여부
  const isAllSelected = selectableKeys.length > 0 && selectableKeys.every(key => addSelectedIds.has(key));

  // 전체 선택/해제
  const handleSelectAll = useCallback(() => {
    setAddSelectedIds(prev => {
      const newSelected = new Set(prev);
      if (isAllSelected) {
        selectableKeys.forEach(k => newSelected.delete(k));
      } else {
        selectableKeys.forEach(k => newSelected.add(k));
      }
      return newSelected;
    });
  }, [isAllSelected, selectableKeys]);

  // 선택된 문제 수 (결합형은 1문제)
  const actualSelectedCount = useMemo(() => {
    if (addSelectedIds.size === 0) return 0;
    const seenCombinedGroups = new Set<string>();
    let count = 0;
    for (const key of addSelectedIds) {
      const colonIndex = key.indexOf(':');
      if (colonIndex === -1) continue;
      const quizId = key.substring(0, colonIndex);
      const questionId = key.substring(colonIndex + 1);
      const item = solvedItems.find(i => i.questionId === questionId && i.quizId === quizId);
      if (item) {
        if (item.combinedGroupId) {
          if (!seenCombinedGroups.has(item.combinedGroupId)) {
            seenCombinedGroups.add(item.combinedGroupId);
            count++;
          }
        } else {
          count++;
        }
      }
    }
    return count;
  }, [addSelectedIds, solvedItems]);

  const handleConfirmAdd = async () => {
    await onAddQuestions(Array.from(addSelectedIds));
    onClose();
  };

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="sticky top-0 z-50 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]" style={{ marginTop: 'calc(-1 * env(safe-area-inset-top, 0px))', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="flex items-center justify-between h-14 px-4">
          <button onClick={onClose} className="text-[#1A1A1A] font-bold">
            닫기
          </button>
          <h1 className="text-base font-bold text-[#1A1A1A]">문제 추가</h1>
          <div className="w-10" />
        </div>
      </header>

      {/* 안내 문구 */}
      <div className="px-4 py-3 border-b border-[#EDEAE4]">
        <p className="text-sm text-[#5C5C5C]">추가할 문제가 있는 문제지를 선택하세요</p>
      </div>

      {/* 퀴즈 폴더 목록 */}
      <main className="px-4 py-4">
        {groupedSolvedItems.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[#5C5C5C]">풀었던 문제지가 없습니다.</p>
            <p className="text-xs text-[#5C5C5C] mt-2">퀴즈를 풀면 여기에 표시됩니다.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {groupedSolvedItems.map((group) => {
              const totalCount = group.questionCount;
              const addedItems = group.items.filter(item =>
                alreadyAddedQuestionKeys.has(`${item.quizId}:${item.questionId}`)
              );
              const seenCombinedGroups = new Set<string>();
              let addedCount = 0;
              for (const item of addedItems) {
                if (item.combinedGroupId) {
                  if (!seenCombinedGroups.has(item.combinedGroupId)) {
                    seenCombinedGroups.add(item.combinedGroupId);
                    addedCount++;
                  }
                } else {
                  addedCount++;
                }
              }
              const remainingCount = totalCount - addedCount;

              return (
                <button
                  key={group.quizId}
                  onClick={() => setSelectedQuizForAdd({ quizId: group.quizId, quizTitle: group.quizTitle })}
                  className="p-3 border border-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors text-left"
                >
                  <div className="flex justify-center mb-2">
                    <svg className="w-10 h-10 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </div>
                  <h3 className="font-bold text-xs text-center line-clamp-2 mb-1 text-[#1A1A1A]">
                    {group.quizTitle}
                  </h3>
                  <p className="text-[10px] text-center text-[#5C5C5C]">
                    {remainingCount > 0 ? (
                      <>{remainingCount}문제 추가 가능</>
                    ) : (
                      <span className="text-[#8B1A1A]">모두 추가됨</span>
                    )}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </main>

      {/* 바텀시트 - 퀴즈 선택 시 문제 목록 표시 */}
      <AnimatePresence>
        {selectedQuizForAdd && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setSelectedQuizForAdd(null);
                setAddSelectedIds(new Set());
              }}
              className="fixed inset-0 bg-black/50 z-50"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 right-0 z-50 bg-[#F5F0E8] border-t-2 border-[#1A1A1A] max-h-[70vh] flex flex-col"
              style={{ left: 'var(--detail-panel-left, 0)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
              {/* 바텀시트 헤더 */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#EDEAE4] flex-shrink-0">
                <button
                  onClick={() => {
                    setSelectedQuizForAdd(null);
                    setAddSelectedIds(new Set());
                  }}
                  className="text-sm text-[#5C5C5C]"
                >
                  취소
                </button>
                <h2 className="font-bold text-sm text-[#1A1A1A] line-clamp-1 max-w-[200px]">
                  {selectedQuizForAdd.quizTitle}
                </h2>
                <button
                  onClick={handleConfirmAdd}
                  disabled={actualSelectedCount === 0}
                  className="text-sm font-bold text-[#1A1A1A] disabled:opacity-30"
                >
                  추가 ({actualSelectedCount})
                </button>
              </div>

              {/* 전체 선택 바 */}
              {selectableKeys.length > 0 && (
                <div className="flex items-center justify-between px-4 py-2 border-b border-[#EDEAE4] flex-shrink-0">
                  <button
                    onClick={handleSelectAll}
                    className="text-xs font-bold text-[#1A1A1A]"
                  >
                    {isAllSelected ? '전체 해제' : '전체 선택'}
                  </button>
                  <span className="text-[10px] text-[#5C5C5C]">
                    {selectableKeys.length > 0 && `선택 가능 ${selectableKeys.length}문제`}
                  </span>
                </div>
              )}

              {/* 문제 목록 */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                {quizItems.length === 0 ? (
                  <p className="py-8 text-center text-[#5C5C5C]">문제가 없습니다.</p>
                ) : (
                  (() => {
                    const displayItems: Array<{ type: 'single'; item: ReviewItem } | { type: 'combined'; groupId: string; items: ReviewItem[] }> = [];
                    const seenCombinedGroups = new Set<string>();

                    for (const item of quizItems) {
                      if (item.combinedGroupId) {
                        if (!seenCombinedGroups.has(item.combinedGroupId)) {
                          seenCombinedGroups.add(item.combinedGroupId);
                          const groupItems = quizItems.filter(i => i.combinedGroupId === item.combinedGroupId);
                          displayItems.push({ type: 'combined', groupId: item.combinedGroupId, items: groupItems });
                        }
                      } else {
                        displayItems.push({ type: 'single', item });
                      }
                    }

                    return displayItems.map((displayItem) => {
                      if (displayItem.type === 'single') {
                        const item = displayItem.item;
                        const itemKey = `${item.quizId}:${item.questionId}`;
                        const isAlreadyAdded = alreadyAddedQuestionKeys.has(itemKey);
                        const isSelected = addSelectedIds.has(itemKey);

                        return (
                          <div
                            key={`single-${item.id}-${item.questionId}`}
                            onClick={() => !isAlreadyAdded && handleAddSelect(item)}
                            className={`p-3 border transition-all ${
                              isAlreadyAdded
                                ? 'border-[#5C5C5C] bg-[#EDEAE4] cursor-not-allowed opacity-60'
                                : isSelected
                                  ? 'border-2 border-[#1A1A1A] bg-[#EDEAE4] cursor-pointer'
                                  : 'border-[#1A1A1A] bg-white cursor-pointer'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                isAlreadyAdded ? 'bg-[#5C5C5C]' : isSelected ? 'bg-[#1A1A1A]' : 'border border-[#5C5C5C]'
                              }`}>
                                {(isSelected || isAlreadyAdded) && (
                                  <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                {isAlreadyAdded && (
                                  <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold bg-[#5C5C5C] text-[#F5F0E8] mb-1">
                                    이미 추가됨
                                  </span>
                                )}
                                <p className={`text-sm line-clamp-2 ${isAlreadyAdded ? 'text-[#5C5C5C]' : 'text-[#1A1A1A]'}`}>
                                  {item.question}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      } else {
                        const { groupId, items: groupItems } = displayItem;
                        const firstItem = groupItems[0];
                        const isExpanded = expandedCombinedGroups.has(groupId);
                        const allAdded = groupItems.every(i => alreadyAddedQuestionKeys.has(`${i.quizId}:${i.questionId}`));
                        const isSelected = groupItems.some(i => addSelectedIds.has(`${i.quizId}:${i.questionId}`));
                        const passage = firstItem.passage || firstItem.commonQuestion || '';

                        return (
                          <div
                            key={`combined-${groupId}`}
                            className={`border transition-all ${
                              allAdded
                                ? 'border-[#5C5C5C] bg-[#EDEAE4] opacity-60'
                                : isSelected
                                  ? 'border-2 border-[#1A1A1A] bg-[#EDEAE4]'
                                  : 'border-[#1A1A1A] bg-white'
                            }`}
                          >
                            <div
                              onClick={() => !allAdded && handleAddSelect(firstItem)}
                              className={`p-3 ${allAdded ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                            >
                              <div className="flex items-start gap-3">
                                <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                  allAdded ? 'bg-[#5C5C5C]' : isSelected ? 'bg-[#1A1A1A]' : 'border border-[#5C5C5C]'
                                }`}>
                                  {(isSelected || allAdded) && (
                                    <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  {allAdded && (
                                    <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold bg-[#5C5C5C] text-[#F5F0E8] mb-1">
                                      이미 추가됨
                                    </span>
                                  )}
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold bg-[#1A1A1A] text-[#F5F0E8]">
                                      결합형
                                    </span>
                                    <span className="text-[10px] text-[#5C5C5C]">
                                      하위 {groupItems.length}문제
                                    </span>
                                  </div>
                                  <p className={`text-sm line-clamp-2 ${allAdded ? 'text-[#5C5C5C]' : 'text-[#1A1A1A]'}`}>
                                    {passage || '(공통 지문 없음)'}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedCombinedGroups(prev => {
                                  const newSet = new Set(prev);
                                  if (newSet.has(groupId)) newSet.delete(groupId);
                                  else newSet.add(groupId);
                                  return newSet;
                                });
                              }}
                              className="w-full py-2 border-t border-[#E8D9A8] text-xs text-[#5C5C5C] hover:bg-[#EDEAE4] flex items-center justify-center gap-1"
                            >
                              {isExpanded ? '접기' : `하위 문제 보기 (${groupItems.length})`}
                              <svg
                                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            {isExpanded && (
                              <div className="border-t border-[#E8D9A8] bg-[#FFFDF7] px-3 py-2 space-y-1">
                                {groupItems.map((subItem, subIdx) => (
                                  <div key={subItem.questionId} className="text-xs text-[#5C5C5C] py-1">
                                    <span className="font-bold mr-1">{subIdx + 1}.</span>
                                    <span className="line-clamp-1">{subItem.question}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }
                    });
                  })()
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
