'use client';

import { motion, AnimatePresence } from 'framer-motion';
import LibraryQuizCard from '@/components/review/LibraryQuizCard';
import EmptyState from '@/components/review/EmptyState';
import type { LearningQuiz } from '@/lib/hooks/useLearningQuizzes';

/** 서재 탭 props */
export interface LibraryTabProps {
  /** 태그 필터 적용 전 전체 서재 퀴즈 (태그 표시 조건 판별용) */
  allLibraryQuizzes: LearningQuiz[];
  /** 태그 필터 적용된 서재 퀴즈 목록 */
  libraryQuizzes: LearningQuiz[];
  /** 선택된 태그 목록 */
  librarySelectedTags: string[];
  /** 태그 목록 설정 */
  setLibrarySelectedTags: React.Dispatch<React.SetStateAction<string[]>>;
  /** 태그 필터 UI 표시 여부 */
  showLibraryTagFilter: boolean;
  /** 태그 필터 UI 표시 토글 */
  setShowLibraryTagFilter: React.Dispatch<React.SetStateAction<boolean>>;
  /** 과목별 태그 옵션 목록 */
  libraryTagOptions: string[];
  /** 서재 삭제 선택 모드 여부 */
  isLibrarySelectMode: boolean;
  /** 서재 삭제 선택된 ID 집합 */
  librarySelectedIds: Set<string>;
  /** 서재 삭제 선택된 ID 변경 */
  setLibrarySelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** 복습 선택 모드 여부 */
  isReviewSelectMode: boolean;
  /** 복습 선택된 ID 집합 */
  reviewSelectedIds: Set<string>;
  /** 복습 선택된 ID 변경 */
  setReviewSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** 카드 ref 등록 (expand 애니메이션용) */
  registerLibraryRef: (id: string, el: HTMLElement | null) => void;
  /** 카드 클릭 시 라우터 이동 */
  onCardNavigate: (quizId: string) => void;
  /** 상세 모달 열기 */
  onOpenDetailModal: (quiz: LearningQuiz) => void;
  /** 복습 시작 (전체) */
  onReview: (quizId: string) => void;
  /** 복습 시작 (오답만) */
  onReviewWrongOnly: (quizId: string) => void;
  /** 공개 전환 모달 열기 */
  onPublish: (quizId: string) => void;
  /** 현재 로그인 사용자 uid */
  currentUserId?: string;
}

/**
 * 서재 탭 — AI 학습 퀴즈 + 완료 퀴즈 목록
 *
 * 태그 필터 + 2열 그리드 + 선택 모드 (삭제/복습) 지원
 */
export default function LibraryTab({
  allLibraryQuizzes,
  libraryQuizzes,
  librarySelectedTags,
  setLibrarySelectedTags,
  showLibraryTagFilter,
  setShowLibraryTagFilter,
  libraryTagOptions,
  isLibrarySelectMode,
  librarySelectedIds,
  setLibrarySelectedIds,
  isReviewSelectMode,
  reviewSelectedIds,
  setReviewSelectedIds,
  registerLibraryRef,
  onCardNavigate,
  onOpenDetailModal,
  onReview,
  onReviewWrongOnly,
  onPublish,
  currentUserId,
}: LibraryTabProps) {
  return (
    <div className="space-y-4">
      {/* 태그 검색 헤더 (3개 이상일 때만 표시) */}
      {allLibraryQuizzes.length >= 3 && (
        <div className="mb-4">
          <div className="flex items-center justify-end mb-2">
            {/* 선택된 태그들 + 태그 아이콘 */}
            <div className="flex items-center gap-2">
              {/* 선택된 태그들 (태그 아이콘 왼쪽에 배치) */}
              {librarySelectedTags.map((tag) => (
                <div
                  key={tag}
                  className="flex items-center gap-1 px-2 py-1 bg-[#F5F0E8] text-[#1A1A1A] text-sm font-bold border border-[#1A1A1A]"
                >
                  #{tag}
                  <button
                    onClick={() => setLibrarySelectedTags(prev => prev.filter(t => t !== tag))}
                    className="ml-0.5 hover:text-[#5C5C5C]"
                  >
                    ✕
                  </button>
                </div>
              ))}

              {/* 태그 검색 버튼 */}
              <button
                onClick={() => setShowLibraryTagFilter(!showLibraryTagFilter)}
                className={`flex items-center justify-center w-9 h-9 border transition-colors shrink-0 rounded-lg ${
                  showLibraryTagFilter
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
            {showLibraryTagFilter && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-1.5 p-2 bg-[#EDEAE4] border border-[#D4CFC4]">
                  {/* 태그 버튼들 (이미 선택된 태그 제외) */}
                  {libraryTagOptions
                    .filter(tag => !librarySelectedTags.includes(tag))
                    .map((tag) => (
                      <button
                        key={tag}
                        onClick={() => {
                          setLibrarySelectedTags(prev => [...prev, tag]);
                          setShowLibraryTagFilter(false);
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

      {/* 필터링 결과가 없을 때 (원본에는 퀴즈가 있지만 필터링 결과가 없을 때) */}
      {allLibraryQuizzes.length > 0 && libraryQuizzes.length === 0 && librarySelectedTags.length > 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center text-center py-8"
        >
          <p className="text-sm text-[#5C5C5C]">
            {librarySelectedTags.map(t => `#${t}`).join(' ')} 태그가 있는 퀴즈가 없습니다
          </p>
          <button
            onClick={() => setLibrarySelectedTags([])}
            className="mt-2 px-4 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
          >
            필터 해제
          </button>
        </motion.div>
      ) : libraryQuizzes.length === 0 ? (
        <EmptyState filter="library" fullHeight />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {libraryQuizzes.map((quiz, index) => {
            const libraryKey = `library-${quiz.id}`;
            const isSelected = isLibrarySelectMode
              ? librarySelectedIds.has(quiz.id)
              : isReviewSelectMode
                ? reviewSelectedIds.has(libraryKey)
                : false;
            return (
              <motion.div
                key={quiz.id}
                ref={(el) => registerLibraryRef(quiz.id, el)}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
              >
                <LibraryQuizCard
                  quiz={quiz}
                  onCardClick={() => {
                    if (isLibrarySelectMode) {
                      // 삭제 선택 모드일 때는 체크박스 토글
                      const newSelected = new Set(librarySelectedIds);
                      if (newSelected.has(quiz.id)) {
                        newSelected.delete(quiz.id);
                      } else {
                        newSelected.add(quiz.id);
                      }
                      setLibrarySelectedIds(newSelected);
                    } else if (isReviewSelectMode) {
                      // 복습 선택 모드일 때는 reviewSelectedIds 토글
                      const newSelected = new Set(reviewSelectedIds);
                      if (newSelected.has(libraryKey)) {
                        newSelected.delete(libraryKey);
                      } else {
                        newSelected.add(libraryKey);
                      }
                      setReviewSelectedIds(newSelected);
                    } else {
                      // 일반 모드일 때는 상세 페이지로 이동
                      onCardNavigate(quiz.id);
                    }
                  }}
                  onDetails={() => {
                    onOpenDetailModal(quiz);
                  }}
                  onReview={() => {
                    // 서재 퀴즈는 항상 ReviewPractice로 열기
                    onReview(quiz.id);
                  }}
                  onReviewWrongOnly={quiz.myScore === 100 ? undefined : () => {
                    // 서재 퀴즈 오답만 복습
                    onReviewWrongOnly(quiz.id);
                  }}
                  onPublish={!quiz.isPublic && quiz.creatorId === currentUserId ? () => {
                    onPublish(quiz.id);
                  } : undefined}
                  isSelectMode={isLibrarySelectMode || isReviewSelectMode}
                  isSelected={isSelected}
                  currentUserId={currentUserId}
                />
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
