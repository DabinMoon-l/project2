'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/common';
import ReviewPractice from '@/components/review/ReviewPractice';
import { useReview, type ReviewItem, type GroupedReviewItems } from '@/lib/hooks/useReview';

/** 필터 타입 */
type ReviewFilter = 'solved' | 'wrong' | 'bookmark' | 'custom';

/** 필터 옵션 */
const FILTER_OPTIONS: { value: ReviewFilter; line1: string; line2?: string }[] = [
  { value: 'solved', line1: '푼 문제' },
  { value: 'wrong', line1: '틀린', line2: '문제' },
  { value: 'bookmark', line1: '찜한', line2: '문제' },
  { value: 'custom', line1: '내맘대로' },
];

/**
 * 슬라이드 필터 컴포넌트
 */
function SlideFilter({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: ReviewFilter;
  onFilterChange: (filter: ReviewFilter) => void;
}) {
  const activeIndex = FILTER_OPTIONS.findIndex((opt) => opt.value === activeFilter);

  return (
    <div className="relative flex items-stretch bg-[#EDEAE4] border border-[#1A1A1A] overflow-hidden min-w-[320px]">
      {/* 슬라이드 배경 */}
      <motion.div
        className="absolute h-full bg-[#1A1A1A]"
        initial={false}
        animate={{
          left: `${activeIndex * 25}%`,
        }}
        style={{
          width: '25%',
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      />

      {/* 필터 옵션들 */}
      {FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onFilterChange(option.value)}
          className={`relative z-10 w-1/4 px-3 py-2 text-xs font-bold transition-colors text-center flex flex-col items-center justify-center ${
            activeFilter === option.value ? 'text-[#F5F0E8]' : 'text-[#1A1A1A]'
          }`}
        >
          {option.line2 ? (
            <>
              <span className="leading-tight">{option.line1}</span>
              <span className="leading-tight">{option.line2}</span>
            </>
          ) : (
            <span className="whitespace-nowrap">{option.line1}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * 폴더 카드 컴포넌트
 */
function FolderCard({
  title,
  count,
  onClick,
  onDelete,
  isSelectMode = false,
  isSelected = false,
  showDelete = false,
}: {
  title: string;
  count: number;
  onClick: () => void;
  onDelete?: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  showDelete?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`
        relative border bg-[#F5F0E8] p-3 cursor-pointer transition-all
        ${isSelectMode
          ? isSelected
            ? 'border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]'
            : 'border border-dashed border-[#5C5C5C] hover:border-[#1A1A1A]'
          : 'border-[#1A1A1A] hover:bg-[#EDEAE4]'
        }
      `}
    >
      {/* 삭제 버튼 */}
      {showDelete && onDelete && !isSelectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-1 right-1 w-6 h-6 border border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] flex items-center justify-center transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </button>
      )}

      {/* 선택 표시 */}
      {isSelectMode && isSelected && (
        <div className="flex justify-end mb-1">
          <div className="w-5 h-5 bg-[#1A1A1A] flex items-center justify-center">
            <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      )}

      {/* 폴더 아이콘 */}
      <div className="flex justify-center mb-2">
        <svg className={`w-12 h-12 ${isSelectMode && !isSelected ? 'text-[#5C5C5C]' : 'text-[#1A1A1A]'}`} fill="currentColor" viewBox="0 0 24 24">
          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
        </svg>
      </div>

      {/* 제목 */}
      <h3 className={`font-bold text-xs text-center line-clamp-2 mb-1 ${isSelectMode && !isSelected ? 'text-[#5C5C5C]' : 'text-[#1A1A1A]'}`}>
        {title}
      </h3>

      {/* 문제 수 */}
      <p className="text-xs text-center text-[#5C5C5C]">
        {count}문제
      </p>
    </motion.div>
  );
}

/**
 * 스켈레톤 폴더 카드
 */
function SkeletonFolderCard() {
  return (
    <div className="border border-[#1A1A1A] bg-[#F5F0E8] p-3">
      <div className="flex justify-center mb-2">
        <Skeleton className="w-12 h-12 rounded-none" />
      </div>
      <Skeleton className="w-full h-4 mb-1 rounded-none" />
      <Skeleton className="w-1/2 h-3 mx-auto rounded-none" />
    </div>
  );
}

/**
 * 빈 상태 컴포넌트
 */
function EmptyState({ filter }: { filter: ReviewFilter }) {
  const messages: Record<ReviewFilter, { title: string; desc: string }> = {
    solved: { title: '풀었던 퀴즈가 없습니다', desc: '퀴즈를 풀면 여기에 저장됩니다.' },
    wrong: { title: '틀린 문제가 없습니다', desc: '퀴즈를 풀면 틀린 문제가 자동으로 저장됩니다.' },
    bookmark: { title: '찜한 문제가 없습니다', desc: '퀴즈에서 문제를 찜해보세요.' },
    custom: { title: '폴더가 없습니다', desc: '나만의 폴더를 만들어보세요.' },
  };

  const { title, desc } = messages[filter];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="py-16 text-center"
    >
      <h3 className="font-serif-display text-xl font-black mb-2 text-[#1A1A1A]">
        {title}
      </h3>
      <p className="text-sm text-[#3A3A3A]">
        {desc}
      </p>
    </motion.div>
  );
}

/**
 * 새 폴더 생성 모달
 */
function CreateFolderModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [folderName, setFolderName] = useState('');

  if (!isOpen) return null;

  const handleCreate = () => {
    if (folderName.trim()) {
      onCreate(folderName.trim());
      setFolderName('');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 mx-4 max-w-sm w-full"
      >
        <h3 className="font-bold text-lg text-[#1A1A1A] mb-4">새 폴더 만들기</h3>

        <input
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          placeholder="폴더 이름"
          className="w-full px-3 py-2 border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] mb-4 outline-none focus:border-2"
          autoFocus
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!folderName.trim()}
            className="flex-1 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors disabled:opacity-50"
          >
            만들기
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function ReviewPage() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<ReviewFilter>('solved');
  const [practiceItems, setPracticeItems] = useState<ReviewItem[] | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);

  // 선택 모드 상태
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());

  const {
    wrongItems,
    bookmarkedItems,
    solvedItems,
    groupedWrongItems,
    groupedBookmarkedItems,
    groupedSolvedItems,
    quizAttempts,
    customFolders: customFoldersData,
    loading,
    createCustomFolder,
    deleteCustomFolder,
    deleteSolvedQuiz,
    refresh,
  } = useReview();

  // 푼 문제 (solved 타입의 리뷰)
  const solvedQuizzes = groupedSolvedItems.map(g => ({
    id: g.quizId,
    title: g.quizTitle,
    count: g.items.length,
    type: 'solved' as const,
  }));

  // 커스텀 폴더
  const customFolders = customFoldersData.map(f => ({
    id: f.id,
    title: f.name,
    count: f.questions.length,
    type: 'custom' as const,
  }));

  // 현재 필터에 따른 데이터
  const getCurrentFolders = () => {
    switch (activeFilter) {
      case 'solved':
        return solvedQuizzes.map(f => ({ ...f, filterType: 'solved' as const }));
      case 'wrong':
        return groupedWrongItems.map(g => ({
          id: g.quizId,
          title: g.quizTitle,
          count: g.items.length,
          filterType: 'wrong' as const,
        }));
      case 'bookmark':
        return groupedBookmarkedItems.map(g => ({
          id: g.quizId,
          title: g.quizTitle,
          count: g.items.length,
          filterType: 'bookmark' as const,
        }));
      case 'custom':
        return customFolders.map(f => ({ ...f, filterType: 'custom' as const }));
      default:
        return [];
    }
  };

  const currentFolders = getCurrentFolders();

  // 선택된 폴더 수
  const selectedCount = selectedFolderIds.size;

  // 필터 변경 시 선택 초기화
  useEffect(() => {
    setSelectedFolderIds(new Set());
  }, [activeFilter]);

  // 선택 모드 종료 시 선택 초기화
  useEffect(() => {
    if (!isSelectMode) {
      setSelectedFolderIds(new Set());
    }
  }, [isSelectMode]);

  const handleFolderClick = (folder: { id: string; title: string; count: number; filterType: string }) => {
    if (isSelectMode) {
      // 선택 모드에서는 선택/해제
      const newSelected = new Set(selectedFolderIds);
      const folderId = `${folder.filterType}-${folder.id}`;

      if (newSelected.has(folderId)) {
        newSelected.delete(folderId);
      } else {
        newSelected.add(folderId);
      }
      setSelectedFolderIds(newSelected);
    } else {
      // 일반 모드에서는 폴더 상세로 이동
      router.push(`/review/${folder.filterType}/${folder.id}`);
    }
  };

  // 폴더 삭제 핸들러
  const handleDeleteFolder = async (folder: { id: string; filterType: string }) => {
    const confirmed = window.confirm('이 폴더를 삭제하시겠습니까?\n삭제 시 퀴즈 목록에서 다시 풀 수 있습니다.');
    if (!confirmed) return;

    try {
      if (folder.filterType === 'solved') {
        await deleteSolvedQuiz(folder.id);
      } else if (folder.filterType === 'custom') {
        await deleteCustomFolder(folder.id);
      }
    } catch (err) {
      console.error('폴더 삭제 실패:', err);
      alert('삭제에 실패했습니다.');
    }
  };

  // 복습하기 버튼 클릭
  const handleReviewButtonClick = () => {
    if (isSelectMode) {
      // 선택 모드에서 클릭하면 선택 모드 종료
      setIsSelectMode(false);
    } else {
      // 일반 모드에서 클릭하면 선택 모드 시작
      setIsSelectMode(true);
    }
  };

  // 재생 버튼 클릭 (선택된 폴더로 복습 시작)
  const handlePlayClick = () => {
    if (selectedFolderIds.size === 0) return;

    // 선택된 폴더의 문제들 가져오기
    let items: ReviewItem[] = [];

    selectedFolderIds.forEach(folderId => {
      if (folderId.startsWith('wrong-')) {
        const quizId = folderId.replace('wrong-', '');
        const group = groupedWrongItems.find(g => g.quizId === quizId);
        if (group) items = [...items, ...group.items];
      } else if (folderId.startsWith('bookmark-')) {
        const quizId = folderId.replace('bookmark-', '');
        const group = groupedBookmarkedItems.find(g => g.quizId === quizId);
        if (group) items = [...items, ...group.items];
      }
      // TODO: custom, solved 폴더도 처리
    });

    if (items.length > 0) {
      setPracticeItems(items);
      setIsSelectMode(false);
      setSelectedFolderIds(new Set());
    } else {
      alert('선택된 폴더에 복습할 문제가 없습니다.');
    }
  };

  const handleCreateFolder = async (name: string) => {
    const folderId = await createCustomFolder(name);
    if (folderId) {
      // 폴더 생성 성공 - onSnapshot이 자동으로 업데이트
      console.log('폴더 생성 성공:', folderId);
    } else {
      alert('폴더 생성에 실패했습니다.');
    }
  };

  const handleEndPractice = useCallback(() => {
    setPracticeItems(null);
  }, []);

  // 연습 모드
  if (practiceItems) {
    return (
      <ReviewPractice
        items={practiceItems}
        onComplete={() => handleEndPractice()}
        onClose={handleEndPractice}
      />
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 - 리본 이미지 */}
      <header className="pt-6 pb-4 flex flex-col items-center">
        {/* 리본 이미지 (퀴즈창과 동일) */}
        <div className="relative w-full px-4 h-32 sm:h-44 md:h-56 mb-4">
          <Image
            src="/images/review-ribbon.png"
            alt="Review"
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 80vw, 60vw"
            className="object-contain"
            priority
          />
        </div>

        {/* 필터 + 버튼 영역 */}
        <div className="w-full px-4 flex items-center justify-between gap-4">
          {/* 슬라이드 필터 - 좌측 */}
          <SlideFilter
            activeFilter={activeFilter}
            onFilterChange={(filter) => {
              setActiveFilter(filter);
              // 필터 변경 시 선택 모드 유지하되 선택 초기화
            }}
          />

          {/* 복습하기/재생 버튼 - 우측 */}
          <AnimatePresence mode="wait">
            {isSelectMode && selectedCount > 0 ? (
              // 재생 버튼 (선택된 항목이 있을 때)
              <motion.button
                key="play"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                onClick={handlePlayClick}
                className="px-4 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#3A3A3A] transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span>{selectedCount}개 시작</span>
              </motion.button>
            ) : (
              // 복습하기 버튼
              <motion.button
                key="review"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                onClick={handleReviewButtonClick}
                className={`px-6 py-3 text-sm font-bold whitespace-nowrap transition-colors ${
                  isSelectMode
                    ? 'bg-[#EDEAE4] text-[#1A1A1A] border border-[#1A1A1A]'
                    : 'bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A]'
                }`}
              >
                {isSelectMode ? '취소' : '복습하기'}
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* 선택 모드 안내 */}
        <AnimatePresence>
          {isSelectMode && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full px-4 mt-3"
            >
              <div className="p-2 bg-[#EDEAE4] border border-dashed border-[#1A1A1A] text-center">
                <p className="text-xs text-[#5C5C5C]">
                  복습할 폴더를 선택하세요 (여러 개 선택 가능)
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 내맘대로 탭일 때 폴더 만들기 버튼 */}
        {activeFilter === 'custom' && !isSelectMode && (
          <div className="w-full px-4 mt-3">
            <button
              onClick={() => setShowCreateFolder(true)}
              className="w-full py-2 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              + 새 폴더 만들기
            </button>
          </div>
        )}
      </header>

      <main className="px-4">
        {/* 로딩 스켈레톤 */}
        {loading && (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <SkeletonFolderCard key={i} />
            ))}
          </div>
        )}

        {/* 빈 상태 */}
        {!loading && currentFolders.length === 0 && (
          <EmptyState filter={activeFilter} />
        )}

        {/* 폴더 그리드 (3열) */}
        {!loading && currentFolders.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {currentFolders.map((folder) => (
              <FolderCard
                key={`${folder.filterType}-${folder.id}`}
                title={folder.title}
                count={folder.count}
                onClick={() => handleFolderClick(folder)}
                onDelete={() => handleDeleteFolder(folder)}
                isSelectMode={isSelectMode}
                isSelected={selectedFolderIds.has(`${folder.filterType}-${folder.id}`)}
                showDelete={folder.filterType === 'solved' || folder.filterType === 'custom'}
              />
            ))}
          </div>
        )}
      </main>

      {/* 새 폴더 생성 모달 */}
      <CreateFolderModal
        isOpen={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        onCreate={handleCreateFolder}
      />
    </div>
  );
}
