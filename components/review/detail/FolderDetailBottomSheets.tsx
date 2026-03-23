'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { BottomSheet } from '@/components/common';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import type { FolderCategory, CustomFolderQuestion } from '@/lib/hooks/useReview';

/** 커스텀 폴더 데이터 (카테고리 관리용) */
export interface CustomFolderData {
  categories?: FolderCategory[];
  questions: CustomFolderQuestion[];
}

/** 카테고리 관리 + 배정 + 삭제 모달 모음 Props */
export interface FolderDetailBottomSheetsProps {
  // ─── 카테고리 관리 바텀시트 ───
  /** 카테고리 관리 모드 열림 */
  isCategoryMode: boolean;
  /** 카테고리 관리 닫기 */
  onCloseCategoryMode: () => void;
  /** 새 카테고리 이름 */
  newCategoryName: string;
  /** 카테고리 이름 변경 */
  onNewCategoryNameChange: (name: string) => void;
  /** 카테고리 추가 핸들러 */
  onAddCategory: () => void;
  /** 카테고리 삭제 핸들러 */
  onRemoveCategory: (categoryId: string) => void;
  /** 커스텀 폴더 데이터 */
  customFolder: CustomFolderData | null;
  /** 문제 분류 모드 진입 핸들러 */
  onEnterAssignMode: () => void;

  // ─── 배정 바텀시트 ───
  /** 배정 모드 + 선택 모드 + 선택 있음 여부 (시트 열림 조건) */
  isAssignSheetOpen: boolean;
  /** 배정 바텀시트 닫기 */
  onCloseAssignSheet: () => void;
  /** 선택된 문제 수 */
  selectedCount: number;
  /** 선택된 카테고리 */
  selectedCategoryForAssign: string | null;
  /** 카테고리 선택 핸들러 */
  onSelectCategoryForAssign: (categoryId: string) => void;
  /** 배정 실행 핸들러 */
  onAssign: () => void;

  // ─── 삭제 모달 ───
  /** 삭제 모달 열림 */
  showDeleteModal: boolean;
  /** 삭제 모달 닫기 */
  onCloseDeleteModal: () => void;
  /** 폴더 타입 (custom / library) */
  folderType: string;
  /** 삭제 실행 핸들러 */
  onDelete: () => void;
}

/**
 * 폴더 상세 페이지의 모든 바텀시트 + 삭제 모달 모음
 */
export default function FolderDetailBottomSheets({
  // 카테고리 관리
  isCategoryMode,
  onCloseCategoryMode,
  newCategoryName,
  onNewCategoryNameChange,
  onAddCategory,
  onRemoveCategory,
  customFolder,
  onEnterAssignMode,
  // 배정
  isAssignSheetOpen,
  onCloseAssignSheet,
  selectedCount,
  selectedCategoryForAssign,
  onSelectCategoryForAssign,
  onAssign,
  // 삭제
  showDeleteModal,
  onCloseDeleteModal,
  folderType,
  onDelete,
}: FolderDetailBottomSheetsProps) {
  const isWide = useWideMode();

  return (
    <>
      {/* 카테고리 관리 바텀시트 */}
      <BottomSheet
        isOpen={isCategoryMode}
        onClose={onCloseCategoryMode}
        title="정렬 기준 관리"
        height="auto"
      >
        <div className="space-y-4">
          {/* 카테고리 추가 */}
          <div>
            <label className="block text-sm text-[#5C5C5C] mb-2">새 분류 추가</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => onNewCategoryNameChange(e.target.value)}
                placeholder="분류 이름 입력"
                className="flex-1 px-3 py-2 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none"
                maxLength={20}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newCategoryName.trim()) {
                    onAddCategory();
                  }
                }}
              />
              <button
                onClick={onAddCategory}
                disabled={!newCategoryName.trim()}
                className="px-4 py-2 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-sm disabled:opacity-30"
              >
                추가
              </button>
            </div>
          </div>

          {/* 현재 카테고리 목록 */}
          <div>
            <label className="block text-sm text-[#5C5C5C] mb-2">
              현재 분류 ({customFolder?.categories?.length || 0}개)
            </label>
            {!customFolder?.categories?.length ? (
              <p className="text-xs text-[#5C5C5C] py-4 text-center border border-dashed border-[#5C5C5C]">
                아직 분류가 없습니다. 위에서 추가해주세요.
              </p>
            ) : (
              <div className="space-y-2">
                {customFolder.categories.map((cat) => {
                  const questionCount = customFolder.questions.filter(
                    (q: CustomFolderQuestion) => q.categoryId === cat.id
                  ).length;

                  return (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between p-3 border border-[#1A1A1A] bg-[#EDEAE4]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#1A1A1A]">{cat.name}</span>
                        <span className="text-xs text-[#5C5C5C]">({questionCount}문제)</span>
                      </div>
                      <button
                        onClick={() => onRemoveCategory(cat.id)}
                        className="px-2 py-1 text-xs text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
                      >
                        삭제
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 문제 배정 모드 진입 버튼 */}
          {customFolder?.categories?.length ? (
            <div className="pt-2 border-t border-[#EDEAE4]">
              <button
                onClick={onEnterAssignMode}
                className="w-full py-3 font-bold text-sm bg-[#F5F0E8] text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
              >
                문제 분류하기
              </button>
              <p className="text-xs text-[#5C5C5C] text-center mt-2">
                문제를 선택한 후 원하는 분류에 배정할 수 있습니다.
              </p>
            </div>
          ) : null}
        </div>
      </BottomSheet>

      {/* 문제 배정 바텀시트 (문제 선택 후 카테고리 선택) */}
      <BottomSheet
        isOpen={isAssignSheetOpen}
        onClose={onCloseAssignSheet}
        title={`${selectedCount}개 문제 분류`}
        height="auto"
      >
        <div className="space-y-3">
          <p className="text-sm text-[#5C5C5C]">분류를 선택하세요</p>

          {/* 카테고리 선택 버튼들 */}
          <div className="space-y-2">
            {customFolder?.categories?.map((cat) => (
              <button
                key={cat.id}
                onClick={() => onSelectCategoryForAssign(cat.id)}
                className={`w-full p-3 text-left font-bold text-sm border-2 transition-colors ${
                  selectedCategoryForAssign === cat.id
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#EDEAE4]'
                }`}
              >
                {cat.name}
              </button>
            ))}
            {/* 미분류 옵션 */}
            <button
              onClick={() => onSelectCategoryForAssign('uncategorized')}
              className={`w-full p-3 text-left font-bold text-sm border-2 transition-colors ${
                selectedCategoryForAssign === 'uncategorized'
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#F5F0E8] text-[#5C5C5C] border-[#5C5C5C] border-dashed hover:bg-[#EDEAE4]'
              }`}
            >
              미분류
            </button>
          </div>

          {/* 배정 버튼 */}
          <button
            onClick={onAssign}
            disabled={!selectedCategoryForAssign}
            className="w-full py-3 font-bold text-sm bg-[#1A1A1A] text-[#F5F0E8] disabled:opacity-30 transition-colors"
          >
            배정하기
          </button>
        </div>
      </BottomSheet>

      {/* 폴더/서재 삭제 확인 모달 */}
      {showDeleteModal && (isWide ? (
        <AnimatePresence>
          <div className="fixed inset-0 z-[9998]" style={{ left: 'var(--detail-panel-left, calc(50% + 120px))' }} onClick={onCloseDeleteModal} />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="fixed bottom-0 right-0 z-[9999] bg-[#F5F0E8] rounded-t-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.15)] border-t-2 border-x-2 border-[#1A1A1A] p-4"
            style={{ left: 'var(--detail-panel-left, calc(50% + 120px))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center -mt-2 mb-2"><div className="w-8 h-1 rounded-full bg-[#D4CFC4]" /></div>
            <div className="flex justify-center mb-3">
              <div className="w-10 h-10 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4] rounded-lg">
                <svg className="w-5 h-5 text-[#8B1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </div>
            </div>
            <h3 className="text-center font-bold text-base text-[#1A1A1A] mb-2">{folderType === 'custom' ? '폴더를 삭제할까요?' : '퀴즈를 삭제할까요?'}</h3>
            <p className="text-xs text-[#5C5C5C] mb-1">{folderType === 'custom' ? '- 삭제된 폴더는 복구할 수 없습니다.' : '- 삭제된 퀴즈는 복구할 수 없습니다.'}</p>
            <p className="text-xs text-[#5C5C5C] mb-5">{folderType === 'custom' ? '- 폴더 안의 문제는 원본에 남아있습니다.' : '- 이미 푼 사람은 복습 가능합니다.'}</p>
            <div className="flex gap-3">
              <button onClick={onCloseDeleteModal} className="flex-1 py-2.5 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] rounded-lg">취소</button>
              <button onClick={onDelete} className="flex-1 py-2.5 font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] rounded-lg">삭제</button>
            </div>
          </motion.div>
        </AnimatePresence>
      ) : (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
          onClick={onCloseDeleteModal}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[85%] max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-2xl"
          >
            <div className="flex justify-center mb-3">
              <div className="w-10 h-10 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4] rounded-lg">
                <svg className="w-5 h-5 text-[#8B1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
            </div>
            <h3 className="text-center font-bold text-base text-[#1A1A1A] mb-2">
              {folderType === 'custom' ? '폴더를 삭제할까요?' : '퀴즈를 삭제할까요?'}
            </h3>
            <p className="text-xs text-[#5C5C5C] mb-1">
              {folderType === 'custom'
                ? '- 삭제된 폴더는 복구할 수 없습니다.'
                : '- 삭제된 퀴즈는 복구할 수 없습니다.'
              }
            </p>
            <p className="text-xs text-[#5C5C5C] mb-5">
              {folderType === 'custom'
                ? '- 폴더 안의 문제는 원본에 남아있습니다.'
                : '- 이미 푼 사람은 복습 가능합니다.'
              }
            </p>
            <div className="flex gap-3">
              <button
                onClick={onCloseDeleteModal}
                className="flex-1 py-2.5 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                취소
              </button>
              <button
                onClick={onDelete}
                className="flex-1 py-2.5 font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] transition-colors rounded-lg"
              >
                삭제
              </button>
            </div>
          </motion.div>
        </div>
      ))}
    </>
  );
}
