'use client';

import FolderSlider from '@/components/common/FolderSlider';
import FolderCard from '@/components/review/FolderCard';
import type { QuizUpdateInfo } from '@/lib/hooks/useReview';
import type { FolderCategory } from '@/lib/hooks/useReview';

/** 폴더 아이템 타입 (currentFolders 요소) */
export interface CustomFolderItem {
  id: string;
  title: string;
  count: number;
  type?: 'custom';
  filterType: 'custom';
}

/** 커스텀(내맘대로) 탭 props */
export interface CustomTabProps {
  /** 현재 폴더 목록 */
  currentFolders: CustomFolderItem[];
  /** 폴더 카테고리 목록 */
  folderCategories: FolderCategory[];
  /** 폴더-카테고리 매핑 */
  folderCategoryMap: Record<string, string>;
  /** 폴더 순서 매핑 */
  folderOrderMap: Record<string, number>;
  /** 퀴즈 업데이트 정보 맵 */
  updatedQuizzes: Map<string, QuizUpdateInfo>;
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
  /** PDF 폴더 선택 모드 여부 */
  isPdfSelectMode: boolean;
  /** PDF 선택된 폴더 ID 집합 */
  selectedPdfFolders: Set<string>;
  /** PDF 선택된 폴더 ID 변경 */
  setSelectedPdfFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** 카테고리 배정 모드 여부 */
  isAssignMode: boolean;
  /** 배정 대상 폴더 ID */
  selectedFolderForAssign: string | null;
  /** 카테고리에 폴더 배정 */
  handleAssignFolderToCategory: (folderId: string, categoryId: string | null) => void;
  /** 배정 모드에서 폴더 클릭 */
  handleFolderClickInAssignMode: (folderId: string) => void;
  /** 일반 모드 폴더 클릭 */
  handleFolderClick: (folder: { id: string; title: string; count: number; filterType: string }) => void;
  /** 업데이트 모달 열기 */
  onUpdateClick: (quizId: string, quizTitle: string, filterType: string) => void;
}

/**
 * 내맘대로(커스텀) 탭 — 폴더 카테고리 기반 레이아웃
 *
 * 카테고리 유무에 따라:
 * - 카테고리 있음 + 2개 이하: 수직 리스트 (고정 높이)
 * - 카테고리 있음 + 3개 이상: 가로 스크롤 슬라이더
 * - 카테고리 없음: 기본 그리드
 */
export default function CustomTab({
  currentFolders,
  folderCategories,
  folderCategoryMap,
  folderOrderMap,
  updatedQuizzes,
  isFolderDeleteMode,
  deleteFolderIds,
  setDeleteFolderIds,
  isReviewSelectMode,
  reviewSelectedIds,
  setReviewSelectedIds,
  isPdfSelectMode,
  selectedPdfFolders,
  setSelectedPdfFolders,
  isAssignMode,
  selectedFolderForAssign,
  handleAssignFolderToCategory,
  handleFolderClickInAssignMode,
  handleFolderClick,
  onUpdateClick,
}: CustomTabProps) {
  // 카테고리 분류가 있을 때
  if (folderCategories.length > 0) {
    // 총 카테고리 수 = 사용자 카테고리 + 미분류(1)
    const totalCategories = folderCategories.length + 1;
    const uncategorizedFolders = currentFolders.filter(
      (f) => !folderCategoryMap[f.id]
    );

    // 카테고리가 2개 이하일 때: 수직 리스트
    if (totalCategories <= 2) {
      const firstCategoryFolders = folderCategories[0]
        ? [...currentFolders.filter(f => folderCategoryMap[f.id] === folderCategories[0].id)]
            .sort((a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0))
        : [...uncategorizedFolders].sort((a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0));
      const sortedUncategorized = [...uncategorizedFolders].sort((a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0));
      const hasUncategorized = sortedUncategorized.length > 0;

      return (
        <div
          className="flex flex-col"
          style={{ height: 'calc(100vh - 340px - 100px)' }}
        >
          {/* 첫 번째 카테고리 */}
          <section className={`flex flex-col min-h-0 ${hasUncategorized ? 'flex-1 border-b border-[#D4CFC4]' : 'flex-1'}`}>
            {/* 헤더 */}
            <CategoryHeader
              label={folderCategories[0]?.name || '미분류'}
              folderKeys={firstCategoryFolders.map(f => `${f.filterType}-${f.id}`)}
              count={firstCategoryFolders.length}
              isFolderDeleteMode={isFolderDeleteMode}
              deleteFolderIds={deleteFolderIds}
              setDeleteFolderIds={setDeleteFolderIds}
              isReviewSelectMode={isReviewSelectMode}
              reviewSelectedIds={reviewSelectedIds}
              setReviewSelectedIds={setReviewSelectedIds}
              isAssignMode={isAssignMode}
              selectedFolderForAssign={selectedFolderForAssign}
              onAssign={() => {
                if (isAssignMode && selectedFolderForAssign && folderCategories[0]) {
                  handleAssignFolderToCategory(selectedFolderForAssign, folderCategories[0].id);
                }
              }}
              variant="large"
            />
            <div className="flex-1 overflow-y-auto min-h-0">
              {firstCategoryFolders.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm text-[#5C5C5C]">폴더가 없습니다</p>
                </div>
              ) : (
                <FolderGrid
                  folders={firstCategoryFolders}
                  updatedQuizzes={updatedQuizzes}
                  isFolderDeleteMode={isFolderDeleteMode}
                  deleteFolderIds={deleteFolderIds}
                  setDeleteFolderIds={setDeleteFolderIds}
                  isReviewSelectMode={isReviewSelectMode}
                  reviewSelectedIds={reviewSelectedIds}
                  setReviewSelectedIds={setReviewSelectedIds}
                  isPdfSelectMode={isPdfSelectMode}
                  selectedPdfFolders={selectedPdfFolders}
                  setSelectedPdfFolders={setSelectedPdfFolders}
                  isAssignMode={isAssignMode}
                  selectedFolderForAssign={selectedFolderForAssign}
                  handleFolderClickInAssignMode={handleFolderClickInAssignMode}
                  handleFolderClick={handleFolderClick}
                  onUpdateClick={onUpdateClick}
                  activeFilter="custom"
                />
              )}
            </div>
          </section>

          {/* 미분류 섹션 - 폴더가 있을 때만 표시 */}
          {hasUncategorized && (
            <section className="flex-1 flex flex-col min-h-0">
              <CategoryHeader
                label="미분류"
                folderKeys={sortedUncategorized.map(f => `${f.filterType}-${f.id}`)}
                count={sortedUncategorized.length}
                isFolderDeleteMode={isFolderDeleteMode}
                deleteFolderIds={deleteFolderIds}
                setDeleteFolderIds={setDeleteFolderIds}
                isReviewSelectMode={isReviewSelectMode}
                reviewSelectedIds={reviewSelectedIds}
                setReviewSelectedIds={setReviewSelectedIds}
                isAssignMode={isAssignMode}
                selectedFolderForAssign={selectedFolderForAssign}
                onAssign={() => {
                  if (isAssignMode && selectedFolderForAssign) {
                    handleAssignFolderToCategory(selectedFolderForAssign, null);
                  }
                }}
                variant="large"
              />
              <div className="flex-1 overflow-y-auto min-h-0">
                <FolderGrid
                  folders={sortedUncategorized}
                  updatedQuizzes={updatedQuizzes}
                  isFolderDeleteMode={isFolderDeleteMode}
                  deleteFolderIds={deleteFolderIds}
                  setDeleteFolderIds={setDeleteFolderIds}
                  isReviewSelectMode={isReviewSelectMode}
                  reviewSelectedIds={reviewSelectedIds}
                  setReviewSelectedIds={setReviewSelectedIds}
                  isPdfSelectMode={isPdfSelectMode}
                  selectedPdfFolders={selectedPdfFolders}
                  setSelectedPdfFolders={setSelectedPdfFolders}
                  isAssignMode={isAssignMode}
                  selectedFolderForAssign={selectedFolderForAssign}
                  handleFolderClickInAssignMode={handleFolderClickInAssignMode}
                  handleFolderClick={handleFolderClick}
                  onUpdateClick={onUpdateClick}
                  activeFilter="custom"
                />
              </div>
            </section>
          )}
        </div>
      );
    }

    // 카테고리가 3개 이상일 때: 가로 스크롤
    const sortedUncategorizedForMany = [...uncategorizedFolders].sort(
      (a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0)
    );

    return (
      <div className="space-y-3">
        {/* 사용자 카테고리들 */}
        {folderCategories.map((cat) => {
          const categoryFolders = currentFolders
            .filter((f) => folderCategoryMap[f.id] === cat.id)
            .sort((a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0));

          return (
            <div
              key={cat.id}
              data-category-id={cat.id}
              className="border-b border-dashed border-[#EDEAE4] pb-3"
            >
              {/* 카테고리 헤더 */}
              <CategoryHeader
                label={cat.name}
                folderKeys={categoryFolders.map(f => `${f.filterType}-${f.id}`)}
                count={categoryFolders.length}
                isFolderDeleteMode={isFolderDeleteMode}
                deleteFolderIds={deleteFolderIds}
                setDeleteFolderIds={setDeleteFolderIds}
                isReviewSelectMode={isReviewSelectMode}
                reviewSelectedIds={reviewSelectedIds}
                setReviewSelectedIds={setReviewSelectedIds}
                isAssignMode={isAssignMode}
                selectedFolderForAssign={selectedFolderForAssign}
                onAssign={() => {
                  if (isAssignMode && selectedFolderForAssign) {
                    handleAssignFolderToCategory(selectedFolderForAssign, cat.id);
                  }
                }}
                variant="compact"
              />

              {/* 폴더들 */}
              {categoryFolders.length === 0 ? (
                <div className="py-4 text-center text-[#5C5C5C] text-sm border border-dashed border-[#EDEAE4]">
                  폴더가 없습니다
                </div>
              ) : (
                <FolderGrid
                  folders={categoryFolders}
                  updatedQuizzes={updatedQuizzes}
                  isFolderDeleteMode={isFolderDeleteMode}
                  deleteFolderIds={deleteFolderIds}
                  setDeleteFolderIds={setDeleteFolderIds}
                  isReviewSelectMode={isReviewSelectMode}
                  reviewSelectedIds={reviewSelectedIds}
                  setReviewSelectedIds={setReviewSelectedIds}
                  isPdfSelectMode={isPdfSelectMode}
                  selectedPdfFolders={selectedPdfFolders}
                  setSelectedPdfFolders={setSelectedPdfFolders}
                  isAssignMode={isAssignMode}
                  selectedFolderForAssign={selectedFolderForAssign}
                  handleFolderClickInAssignMode={handleFolderClickInAssignMode}
                  handleFolderClick={handleFolderClick}
                  onUpdateClick={onUpdateClick}
                  activeFilter="custom"
                />
              )}
            </div>
          );
        })}

        {/* 미분류 폴더 - 폴더가 있을 때만 표시 */}
        {sortedUncategorizedForMany.length > 0 && (
          <div data-category-id="uncategorized">
            {/* 미분류 헤더 */}
            <UncategorizedHeader
              folderKeys={sortedUncategorizedForMany.map(f => `${f.filterType}-${f.id}`)}
              count={sortedUncategorizedForMany.length}
              isFolderDeleteMode={isFolderDeleteMode}
              deleteFolderIds={deleteFolderIds}
              setDeleteFolderIds={setDeleteFolderIds}
              isReviewSelectMode={isReviewSelectMode}
              reviewSelectedIds={reviewSelectedIds}
              setReviewSelectedIds={setReviewSelectedIds}
              isAssignMode={isAssignMode}
              selectedFolderForAssign={selectedFolderForAssign}
              onAssign={() => {
                if (isAssignMode && selectedFolderForAssign) {
                  handleAssignFolderToCategory(selectedFolderForAssign, null);
                }
              }}
            />

            {/* 미분류 폴더들 */}
            <FolderGrid
              folders={sortedUncategorizedForMany}
              updatedQuizzes={updatedQuizzes}
              isFolderDeleteMode={isFolderDeleteMode}
              deleteFolderIds={deleteFolderIds}
              setDeleteFolderIds={setDeleteFolderIds}
              isReviewSelectMode={isReviewSelectMode}
              reviewSelectedIds={reviewSelectedIds}
              setReviewSelectedIds={setReviewSelectedIds}
              isPdfSelectMode={isPdfSelectMode}
              selectedPdfFolders={selectedPdfFolders}
              setSelectedPdfFolders={setSelectedPdfFolders}
              isAssignMode={isAssignMode}
              selectedFolderForAssign={selectedFolderForAssign}
              handleFolderClickInAssignMode={handleFolderClickInAssignMode}
              handleFolderClick={handleFolderClick}
              onUpdateClick={onUpdateClick}
              activeFilter="custom"
            />
          </div>
        )}
      </div>
    );
  }

  // 기본 그리드 (카테고리 없을 때)
  return (
    <FolderGrid
      folders={currentFolders}
      updatedQuizzes={updatedQuizzes}
      isFolderDeleteMode={isFolderDeleteMode}
      deleteFolderIds={deleteFolderIds}
      setDeleteFolderIds={setDeleteFolderIds}
      isReviewSelectMode={isReviewSelectMode}
      reviewSelectedIds={reviewSelectedIds}
      setReviewSelectedIds={setReviewSelectedIds}
      isPdfSelectMode={isPdfSelectMode}
      selectedPdfFolders={selectedPdfFolders}
      setSelectedPdfFolders={setSelectedPdfFolders}
      isAssignMode={isAssignMode}
      selectedFolderForAssign={selectedFolderForAssign}
      handleFolderClickInAssignMode={handleFolderClickInAssignMode}
      handleFolderClick={handleFolderClick}
      onUpdateClick={onUpdateClick}
      activeFilter="custom"
    />
  );
}

// ============================================================
// 내부 서브 컴포넌트
// ============================================================

/** 카테고리 헤더 공통 props */
interface CategoryHeaderProps {
  label: string;
  folderKeys: string[];
  count: number;
  isFolderDeleteMode: boolean;
  deleteFolderIds: Set<string>;
  setDeleteFolderIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  isReviewSelectMode: boolean;
  reviewSelectedIds: Set<string>;
  setReviewSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  isAssignMode: boolean;
  selectedFolderForAssign: string | null;
  onAssign: () => void;
  /** large: 수직 리스트용 / compact: 가로 스크롤용 */
  variant: 'large' | 'compact';
}

/** 카테고리 섹션 헤더 (사용자 카테고리) */
function CategoryHeader({
  label,
  folderKeys,
  count,
  isFolderDeleteMode,
  deleteFolderIds,
  setDeleteFolderIds,
  isReviewSelectMode,
  reviewSelectedIds,
  setReviewSelectedIds,
  isAssignMode,
  selectedFolderForAssign,
  onAssign,
  variant,
}: CategoryHeaderProps) {
  const handleClick = () => {
    if (isFolderDeleteMode || isReviewSelectMode) {
      const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
      const setSelectedIds = isFolderDeleteMode ? setDeleteFolderIds : setReviewSelectedIds;
      const allSelected = folderKeys.length > 0 && folderKeys.every(key => currentSelectedIds.has(key));
      const newSelected = new Set(currentSelectedIds);
      if (allSelected) {
        folderKeys.forEach(key => newSelected.delete(key));
      } else {
        folderKeys.forEach(key => newSelected.add(key));
      }
      setSelectedIds(newSelected);
    } else if (isAssignMode && selectedFolderForAssign) {
      onAssign();
    }
  };

  const isInteractive = isFolderDeleteMode || isReviewSelectMode || (isAssignMode && !!selectedFolderForAssign);

  if (variant === 'large') {
    return (
      <div
        onClick={handleClick}
        className={`flex items-center gap-2 py-2 flex-shrink-0 transition-all ${
          (isFolderDeleteMode || isReviewSelectMode)
            ? 'cursor-pointer'
            : isAssignMode && selectedFolderForAssign
              ? 'cursor-pointer px-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
              : ''
        }`}
      >
        {(isFolderDeleteMode || isReviewSelectMode) && (
          <SelectCheckbox
            folderKeys={folderKeys}
            selectedIds={isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds}
          />
        )}
        <h3 className={`font-bold text-xl ${
          isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#1A1A1A]'
        }`}>
          {label}
        </h3>
        <span className={`text-xl ml-1.5 ${
          isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
        }`}>
          ({count})
        </span>
      </div>
    );
  }

  // compact variant (3개 이상 카테고리)
  return (
    <div
      onClick={handleClick}
      className={`flex items-center mb-2 transition-all ${
        (isFolderDeleteMode || isReviewSelectMode)
          ? 'cursor-pointer'
          : isAssignMode && selectedFolderForAssign
            ? 'cursor-pointer p-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
            : ''
      }`}
    >
      {(isFolderDeleteMode || isReviewSelectMode) && (
        <SelectCheckbox
          folderKeys={folderKeys}
          selectedIds={isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds}
          className="mr-2"
        />
      )}
      <span className={`font-bold text-xl ${
        isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#1A1A1A]'
      }`}>{label}</span>
      <span className={`text-xl ml-1.5 ${
        isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
      }`}>({count})</span>
    </div>
  );
}

/** 미분류 헤더 (3개 이상 카테고리 전용, dashed line 스타일) */
function UncategorizedHeader({
  folderKeys,
  count,
  isFolderDeleteMode,
  deleteFolderIds,
  setDeleteFolderIds,
  isReviewSelectMode,
  reviewSelectedIds,
  setReviewSelectedIds,
  isAssignMode,
  selectedFolderForAssign,
  onAssign,
}: Omit<CategoryHeaderProps, 'label' | 'variant'>) {
  return (
    <div
      onClick={() => {
        if (isFolderDeleteMode || isReviewSelectMode) {
          const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
          const setSelectedIds = isFolderDeleteMode ? setDeleteFolderIds : setReviewSelectedIds;
          const allSelected = folderKeys.every(key => currentSelectedIds.has(key));
          const newSelected = new Set(currentSelectedIds);
          if (allSelected) {
            folderKeys.forEach(key => newSelected.delete(key));
          } else {
            folderKeys.forEach(key => newSelected.add(key));
          }
          setSelectedIds(newSelected);
        } else if (isAssignMode && selectedFolderForAssign) {
          onAssign();
        }
      }}
      className={`flex items-center mb-2 transition-all ${
        (isFolderDeleteMode || isReviewSelectMode)
          ? 'cursor-pointer'
          : isAssignMode && selectedFolderForAssign
            ? 'cursor-pointer p-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
            : ''
      }`}
    >
      {(isFolderDeleteMode || isReviewSelectMode) && (
        <SelectCheckbox
          folderKeys={folderKeys}
          selectedIds={isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds}
          className="mr-2"
        />
      )}
      <span className={`font-bold text-sm min-w-[60px] ${
        isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#1A1A1A]'
      }`}>미분류</span>
      <div className={`flex-1 border-t border-dashed mx-2 ${
        isAssignMode && selectedFolderForAssign ? 'border-[#1A6B1A]' : 'border-[#5C5C5C]'
      }`} />
      <span className={`text-xs min-w-[30px] text-right ${
        isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
      }`}>{count}개</span>
    </div>
  );
}

/** 선택/삭제 모드 체크박스 */
function SelectCheckbox({
  folderKeys,
  selectedIds,
  className = '',
}: {
  folderKeys: string[];
  selectedIds: Set<string>;
  className?: string;
}) {
  const allSelected = folderKeys.length > 0 && folderKeys.every(key => selectedIds.has(key));
  const someSelected = folderKeys.some(key => selectedIds.has(key));
  return (
    <div className={`w-4 h-4 border-2 flex items-center justify-center ${className} ${
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
}

/** 폴더 그리드/슬라이더 공통 렌더 (4개 이상 슬라이더, 3개 이하 그리드) */
interface FolderGridProps {
  folders: CustomFolderItem[];
  updatedQuizzes: Map<string, QuizUpdateInfo>;
  isFolderDeleteMode: boolean;
  deleteFolderIds: Set<string>;
  setDeleteFolderIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  isReviewSelectMode: boolean;
  reviewSelectedIds: Set<string>;
  setReviewSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  isPdfSelectMode: boolean;
  selectedPdfFolders: Set<string>;
  setSelectedPdfFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  isAssignMode: boolean;
  selectedFolderForAssign: string | null;
  handleFolderClickInAssignMode: (folderId: string) => void;
  handleFolderClick: (folder: { id: string; title: string; count: number; filterType: string }) => void;
  onUpdateClick: (quizId: string, quizTitle: string, filterType: string) => void;
  activeFilter: string;
}

function FolderGrid({
  folders,
  updatedQuizzes,
  isFolderDeleteMode,
  deleteFolderIds,
  setDeleteFolderIds,
  isReviewSelectMode,
  reviewSelectedIds,
  setReviewSelectedIds,
  isPdfSelectMode,
  selectedPdfFolders,
  setSelectedPdfFolders,
  isAssignMode,
  selectedFolderForAssign,
  handleFolderClickInAssignMode,
  handleFolderClick,
  onUpdateClick,
  activeFilter,
}: FolderGridProps) {
  const renderFolder = (folder: CustomFolderItem) => {
    const canDelete = true;
    const updateKey = `${folder.filterType}-${folder.id}`;
    const hasUpdate = updatedQuizzes.has(updateKey);
    const isPdfMode = isPdfSelectMode && activeFilter === 'custom';

    return (
      <FolderCard
        key={updateKey}
        title={folder.title}
        count={folder.count}
        onClick={() => {
          if (isPdfMode) {
            const newSelected = new Set(selectedPdfFolders);
            if (newSelected.has(folder.id)) newSelected.delete(folder.id);
            else newSelected.add(folder.id);
            setSelectedPdfFolders(newSelected);
          } else if (isFolderDeleteMode) {
            const newSelected = new Set(deleteFolderIds);
            if (newSelected.has(updateKey)) {
              newSelected.delete(updateKey);
            } else {
              newSelected.add(updateKey);
            }
            setDeleteFolderIds(newSelected);
          } else if (isReviewSelectMode) {
            const newSelected = new Set(reviewSelectedIds);
            if (newSelected.has(updateKey)) {
              newSelected.delete(updateKey);
            } else {
              newSelected.add(updateKey);
            }
            setReviewSelectedIds(newSelected);
          } else if (isAssignMode) {
            handleFolderClickInAssignMode(folder.id);
          } else {
            handleFolderClick(folder);
          }
        }}
        isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
        isSelected={
          isPdfMode
            ? selectedPdfFolders.has(folder.id)
            : isAssignMode
              ? selectedFolderForAssign === folder.id
              : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
        }
        showDelete={false}
        hasUpdate={hasUpdate}
        onUpdateClick={() => {
          onUpdateClick(folder.id, folder.title, folder.filterType);
        }}
        variant="folder"
      />
    );
  };

  if (folders.length >= 4) {
    return (
      <FolderSlider>
        {folders.map(renderFolder)}
      </FolderSlider>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3 pb-2">
      {folders.map(renderFolder)}
    </div>
  );
}
