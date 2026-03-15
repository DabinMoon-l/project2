'use client';

import { motion, AnimatePresence } from 'framer-motion';
import BookmarkGridView from '@/components/review/BookmarkGridView';
import type { BookmarkedQuiz } from '@/lib/hooks/useQuizBookmark';
import type { QuizUpdateInfo } from '@/lib/hooks/useReview';

/** 찜 탭 props */
export interface BookmarkTabProps {
  /** 전체 찜 퀴즈 목록 (필터 전, 태그 필터 표시 판별용) */
  bookmarkedQuizzes: BookmarkedQuiz[];
  /** 태그 필터 적용된 찜 퀴즈 목록 */
  filteredBookmarkedQuizzes: BookmarkedQuiz[];
  /** 선택된 태그 목록 */
  bookmarkSelectedTags: string[];
  /** 태그 목록 설정 */
  setBookmarkSelectedTags: React.Dispatch<React.SetStateAction<string[]>>;
  /** 태그 필터 UI 표시 여부 */
  showBookmarkTagFilter: boolean;
  /** 태그 필터 UI 표시 토글 */
  setShowBookmarkTagFilter: React.Dispatch<React.SetStateAction<boolean>>;
  /** 과목별 태그 옵션 목록 */
  bookmarkTagOptions: string[];
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
  /** 퀴즈 카드 클릭 (라우터 이동) */
  onQuizCardClick: (quizId: string) => void;
  /** 퀴즈 상세 모달 열기 */
  onQuizDetails: (quiz: BookmarkedQuiz) => void;
  /** 퀴즈 시작 (풀기) */
  onStartQuiz: (quizId: string) => void;
  /** 복습 시작 (전체) */
  onStartReview: (quizId: string) => void;
  /** 복습 시작 (오답만) */
  onStartReviewWrongOnly: (quizId: string) => void;
  /** 찜 해제 */
  onUnbookmark: (quizId: string) => void;
  /** 업데이트 모달 열기 */
  onUpdateClick: (quizId: string, quizTitle: string, filterType: string) => void;
}

/**
 * 찜 탭 — 2열 그리드 + 태그 필터
 */
export default function BookmarkTab({
  bookmarkedQuizzes,
  filteredBookmarkedQuizzes,
  bookmarkSelectedTags,
  setBookmarkSelectedTags,
  showBookmarkTagFilter,
  setShowBookmarkTagFilter,
  bookmarkTagOptions,
  isFolderDeleteMode,
  deleteFolderIds,
  setDeleteFolderIds,
  isReviewSelectMode,
  reviewSelectedIds,
  setReviewSelectedIds,
  updatedQuizzes,
  onQuizCardClick,
  onQuizDetails,
  onStartQuiz,
  onStartReview,
  onStartReviewWrongOnly,
  onUnbookmark,
  onUpdateClick,
}: BookmarkTabProps) {
  return (
    <div className="space-y-4">
      {/* 태그 검색 헤더 (3개 이상일 때만 표시) */}
      {bookmarkedQuizzes.length >= 3 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-serif-display text-lg font-black text-[#1A1A1A]">찜</h2>

            {/* 선택된 태그들 + 태그 아이콘 (우측) */}
            <div className="flex items-center gap-2">
              {/* 선택된 태그들 */}
              {bookmarkSelectedTags.map((tag) => (
                <div
                  key={tag}
                  className="flex items-center gap-1 px-2 py-1 bg-[#F5F0E8] text-[#1A1A1A] text-sm font-bold border border-[#1A1A1A]"
                >
                  #{tag}
                  <button
                    onClick={() => setBookmarkSelectedTags(prev => prev.filter(t => t !== tag))}
                    className="ml-0.5 hover:text-[#5C5C5C]"
                  >
                    ✕
                  </button>
                </div>
              ))}

              {/* 태그 검색 버튼 */}
              <button
                onClick={() => setShowBookmarkTagFilter(!showBookmarkTagFilter)}
                className={`flex items-center justify-center w-9 h-9 border transition-colors shrink-0 rounded-lg ${
                  showBookmarkTagFilter
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A]'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
              </button>
            </div>
          </div>

          {/* 태그 필터 목록 */}
          <AnimatePresence>
            {showBookmarkTagFilter && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-1.5 p-2 bg-[#EDEAE4] border border-[#D4CFC4]">
                  {bookmarkTagOptions
                    .filter(tag => !bookmarkSelectedTags.includes(tag))
                    .map((tag) => (
                      <button
                        key={tag}
                        onClick={() => {
                          setBookmarkSelectedTags(prev => [...prev, tag]);
                          setShowBookmarkTagFilter(false);
                        }}
                        className="px-2 py-1 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#E5E0D8] transition-colors"
                      >
                        #{tag}
                      </button>
                    ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* 필터링 결과가 없을 때 */}
      {bookmarkedQuizzes.length > 0 && filteredBookmarkedQuizzes.length === 0 && bookmarkSelectedTags.length > 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center text-center py-8"
        >
          <p className="text-sm text-[#5C5C5C]">
            {bookmarkSelectedTags.map(t => `#${t}`).join(' ')} 태그가 있는 퀴즈가 없습니다
          </p>
          <button
            onClick={() => setBookmarkSelectedTags([])}
            className="mt-2 px-4 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
          >
            필터 해제
          </button>
        </motion.div>
      ) : (
        <BookmarkGridView
          bookmarkedQuizzes={filteredBookmarkedQuizzes}
          onQuizCardClick={onQuizCardClick}
          onQuizDetails={onQuizDetails}
          onStartQuiz={onStartQuiz}
          onStartReview={onStartReview}
          onStartReviewWrongOnly={onStartReviewWrongOnly}
          onUnbookmark={onUnbookmark}
          isSelectMode={isFolderDeleteMode || isReviewSelectMode}
          selectedFolderIds={isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds}
          onSelectToggle={(quizId) => {
            const key = `bookmark-${quizId}`;
            if (isFolderDeleteMode) {
              const newSelected = new Set(deleteFolderIds);
              if (newSelected.has(key)) {
                newSelected.delete(key);
              } else {
                newSelected.add(key);
              }
              setDeleteFolderIds(newSelected);
            } else if (isReviewSelectMode) {
              const newSelected = new Set(reviewSelectedIds);
              if (newSelected.has(key)) {
                newSelected.delete(key);
              } else {
                newSelected.add(key);
              }
              setReviewSelectedIds(newSelected);
            }
          }}
          getQuizUpdateInfo={(quizId) => {
            const updateKey = `quiz-${quizId}`;
            const info = updatedQuizzes.get(updateKey);
            if (info && info.hasUpdate) {
              return { hasUpdate: true, updatedCount: 0 };
            }
            return null;
          }}
          onUpdateClick={(quizId) => {
            const updateKey = `quiz-${quizId}`;
            const info = updatedQuizzes.get(updateKey);
            if (info) {
              onUpdateClick(quizId, info.quizTitle, 'bookmark');
            }
          }}
        />
      )}
    </div>
  );
}
