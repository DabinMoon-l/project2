'use client';

import { useRef, useCallback } from 'react';
import FolderCard from '@/components/review/FolderCard';
import type { ChapterGroupedWrongItems, QuizUpdateInfo } from '@/lib/hooks/useReview';

/** 마우스 드래그로 가로 스크롤 가능하게 하는 핸들러 */
function useDragScroll() {
  const dragState = useRef<{ startX: number; scrollLeft: number; el: HTMLDivElement } | null>(null);
  const hasDragged = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return; // 터치는 네이티브 스크롤 사용
    const el = e.currentTarget;
    dragState.current = { startX: e.clientX, scrollLeft: el.scrollLeft, el };
    hasDragged.current = false;
    el.style.cursor = 'grabbing';

    // setPointerCapture 대신 document 리스너 사용 (capture가 click을 삼키는 버그 방지)
    const onMove = (ev: PointerEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      if (Math.abs(dx) > 3) hasDragged.current = true;
      dragState.current.el.scrollLeft = dragState.current.scrollLeft - dx;
    };
    const onUp = () => {
      if (dragState.current) {
        dragState.current.el.style.cursor = '';
        dragState.current = null;
      }
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, []);

  /** 드래그 중이었으면 클릭 전파 차단 (capture phase) */
  const onClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (hasDragged.current) {
      e.stopPropagation();
      e.preventDefault();
      hasDragged.current = false;
    }
  }, []);

  return { onPointerDown, onClickCapture };
}

/** 오답 탭 props */
export interface WrongTabProps {
  /** 챕터별 그룹화된 오답 목록 */
  chapterGroupedWrongItems: ChapterGroupedWrongItems[];
  /** 폴더 삭제 선택 모드 여부 */
  isFolderDeleteMode: boolean;
  /** 삭제 선택된 폴더 ID 집합 */
  deleteFolderIds: Set<string>;
  /** 삭제 선택된 폴더 ID 변경 */
  setDeleteFolderIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** 복습 선택 모드 여부 */
  isReviewSelectMode: boolean;
  /** 복습 선택된 ID 집합 */
  reviewSelectedIds: Set<string>;
  /** 복습 선택된 ID 변경 */
  setReviewSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** 퀴즈 업데이트 정보 맵 */
  updatedQuizzes: Map<string, QuizUpdateInfo>;
  /** 폴더 클릭 시 라우터 이동 */
  onFolderNavigate: (url: string) => void;
  /** 업데이트 모달 열기 */
  onUpdateClick: (quizId: string, quizTitle: string) => void;
}

/**
 * 오답 탭 — 챕터별 그룹화된 오답 폴더 목록
 *
 * 챕터 헤더 + 폴더 그리드/슬라이더 구조
 * 4개 이상 폴더: 가로 스크롤 슬라이더
 * 3개 이하: 3열 그리드
 */
export default function WrongTab({
  chapterGroupedWrongItems,
  isFolderDeleteMode,
  deleteFolderIds,
  setDeleteFolderIds,
  isReviewSelectMode,
  reviewSelectedIds,
  setReviewSelectedIds,
  updatedQuizzes,
  onFolderNavigate,
  onUpdateClick,
}: WrongTabProps) {
  const dragScroll = useDragScroll();
  return (
    <div className="space-y-4">
      {chapterGroupedWrongItems.map((chapterGroup) => (
        <div key={chapterGroup.chapterId || 'uncategorized'} className="border-b border-dashed border-[#EDEAE4] pb-3">
          {/* 챕터 헤더 (내맘대로 스타일) */}
          <div
            onClick={() => {
              if (isFolderDeleteMode || isReviewSelectMode) {
                // 해당 챕터의 모든 폴더 키 가져오기 (챕터 ID 포함)
                const chapterFolderKeys = chapterGroup.folders.map(f =>
                  `wrong-${f.quizId}-chapter-${chapterGroup.chapterId || 'uncategorized'}`
                );
                const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                const setSelectedIds = isFolderDeleteMode ? setDeleteFolderIds : setReviewSelectedIds;
                // 모든 폴더가 선택되어 있는지 확인
                const allSelected = chapterFolderKeys.every(key => currentSelectedIds.has(key));
                const newSelected = new Set(currentSelectedIds);
                if (allSelected) {
                  // 모두 선택되어 있으면 모두 해제
                  chapterFolderKeys.forEach(key => newSelected.delete(key));
                } else {
                  // 하나라도 선택 안되어 있으면 모두 선택
                  chapterFolderKeys.forEach(key => newSelected.add(key));
                }
                setSelectedIds(newSelected);
              }
            }}
            className={`flex items-center mb-2 ${
              (isFolderDeleteMode || isReviewSelectMode) ? 'cursor-pointer' : ''
            }`}
          >
            <div className="flex items-center gap-2 min-w-[60px]">
              {/* 선택 모드일 때 체크박스 표시 */}
              {(isFolderDeleteMode || isReviewSelectMode) && (() => {
                const chapterKey = chapterGroup.chapterId || 'uncategorized';
                const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                const allSelected = chapterGroup.folders.every(f =>
                  currentSelectedIds.has(`wrong-${f.quizId}-chapter-${chapterKey}`)
                );
                const someSelected = chapterGroup.folders.some(f =>
                  currentSelectedIds.has(`wrong-${f.quizId}-chapter-${chapterKey}`)
                );
                return (
                  <div className={`w-4 h-4 border-2 flex items-center justify-center ${
                    allSelected
                      ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                      : someSelected
                        ? 'bg-[#5C5C5C] border-[#1A1A1A]'
                        : 'border-[#1A1A1A]'
                  }`}>
                    {allSelected && (
                      <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    {!allSelected && someSelected && (
                      <div className="w-2 h-0.5 bg-[#F5F0E8]" />
                    )}
                  </div>
                );
              })()}
              <span className="font-bold text-sm text-[#1A1A1A]">{chapterGroup.chapterName}</span>
            </div>
            <div className="flex-1 border-t border-dashed border-[#5C5C5C] mx-2" />
            <span className="text-xs text-[#5C5C5C] min-w-[30px] text-right">{chapterGroup.totalCount}문제</span>
          </div>
          {/* 챕터 내 퀴즈 폴더들 */}
          <div>
            {chapterGroup.folders.length >= 4 ? (
              /* 4개 이상: 가로 스크롤 */
              <div
                className="overflow-x-auto pb-2 -mx-4 px-4 cursor-grab select-none"
                {...dragScroll}
              >
                <div className="flex gap-3" style={{ minWidth: 'min-content' }}>
                  {chapterGroup.folders.map((folder) => {
                    const chapterKey = chapterGroup.chapterId || 'uncategorized';
                    const selectKey = `wrong-${folder.quizId}-chapter-${chapterKey}`;
                    const quizUpdateKey = `wrong-${folder.quizId}`;
                    const hasUpdate = updatedQuizzes.has(quizUpdateKey);
                    return (
                      <div key={selectKey} className="w-[100px] flex-shrink-0">
                        <FolderCard
                          title={folder.quizTitle}
                          count={folder.questionCount}
                          onClick={() => {
                            if (isFolderDeleteMode) {
                              const newSelected = new Set(deleteFolderIds);
                              if (newSelected.has(selectKey)) {
                                newSelected.delete(selectKey);
                              } else {
                                newSelected.add(selectKey);
                              }
                              setDeleteFolderIds(newSelected);
                            } else if (isReviewSelectMode) {
                              const newSelected = new Set(reviewSelectedIds);
                              if (newSelected.has(selectKey)) {
                                newSelected.delete(selectKey);
                              } else {
                                newSelected.add(selectKey);
                              }
                              setReviewSelectedIds(newSelected);
                            } else {
                              // 챕터별 필터링을 위해 chapterId 쿼리 파라미터 추가
                              const url = chapterGroup.chapterId
                                ? `/review/wrong/${folder.quizId}?chapter=${chapterGroup.chapterId}`
                                : `/review/wrong/${folder.quizId}`;
                              onFolderNavigate(url);
                            }
                          }}
                          isSelectMode={isFolderDeleteMode || isReviewSelectMode}
                          isSelected={(isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(selectKey)}
                          showDelete={false}
                          hasUpdate={hasUpdate}
                          onUpdateClick={() => {
                            onUpdateClick(folder.quizId, folder.quizTitle);
                          }}
                          variant="folder"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* 3개 이하: 그리드 */
              <div className="grid grid-cols-3 gap-3">
                {chapterGroup.folders.map((folder) => {
                  const chapterKey = chapterGroup.chapterId || 'uncategorized';
                  const selectKey = `wrong-${folder.quizId}-chapter-${chapterKey}`;
                  const quizUpdateKey = `wrong-${folder.quizId}`;
                  const hasUpdate = updatedQuizzes.has(quizUpdateKey);
                  return (
                    <FolderCard
                      key={selectKey}
                      title={folder.quizTitle}
                      count={folder.questionCount}
                      onClick={() => {
                        if (isFolderDeleteMode) {
                          const newSelected = new Set(deleteFolderIds);
                          if (newSelected.has(selectKey)) {
                            newSelected.delete(selectKey);
                          } else {
                            newSelected.add(selectKey);
                          }
                          setDeleteFolderIds(newSelected);
                        } else if (isReviewSelectMode) {
                          const newSelected = new Set(reviewSelectedIds);
                          if (newSelected.has(selectKey)) {
                            newSelected.delete(selectKey);
                          } else {
                            newSelected.add(selectKey);
                          }
                          setReviewSelectedIds(newSelected);
                        } else {
                          // 챕터별 필터링을 위해 chapterId 쿼리 파라미터 추가
                          const url = chapterGroup.chapterId
                            ? `/review/wrong/${folder.quizId}?chapter=${chapterGroup.chapterId}`
                            : `/review/wrong/${folder.quizId}`;
                          onFolderNavigate(url);
                        }
                      }}
                      isSelectMode={isFolderDeleteMode || isReviewSelectMode}
                      isSelected={(isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(selectKey)}
                      showDelete={false}
                      hasUpdate={hasUpdate}
                      onUpdateClick={() => {
                        onUpdateClick(folder.quizId, folder.quizTitle);
                      }}
                      variant="folder"
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
