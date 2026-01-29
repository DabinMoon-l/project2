'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ProfessorQuiz } from '@/lib/hooks/useProfessorQuiz';

// ============================================================
// 타입 정의
// ============================================================

interface QuizListItemProps {
  /** 퀴즈 데이터 */
  quiz: ProfessorQuiz;
  /** 클릭 시 콜백 */
  onClick: () => void;
  /** 수정 클릭 시 콜백 */
  onEdit: () => void;
  /** 삭제 클릭 시 콜백 */
  onDelete: () => void;
  /** 공개 상태 토글 시 콜백 */
  onTogglePublish: () => void;
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 상수
// ============================================================

/** 반별 색상 */
const CLASS_COLORS: Record<string, string> = {
  A: 'bg-red-100 text-red-700',
  B: 'bg-amber-100 text-amber-700',
  C: 'bg-emerald-100 text-emerald-700',
  D: 'bg-blue-100 text-blue-700',
  all: 'bg-purple-100 text-purple-700',
};

/** 난이도 라벨 및 색상 */
const DIFFICULTY_CONFIG: Record<string, { label: string; color: string }> = {
  easy: { label: '쉬움', color: 'bg-green-100 text-green-700' },
  normal: { label: '보통', color: 'bg-yellow-100 text-yellow-700' },
  hard: { label: '어려움', color: 'bg-red-100 text-red-700' },
};

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 퀴즈 목록 아이템 컴포넌트
 *
 * 개별 퀴즈의 정보를 카드 형태로 표시합니다.
 * 제목, 문제 수, 대상 반, 난이도, 통계, 공개 상태를 보여줍니다.
 *
 * @example
 * ```tsx
 * <QuizListItem
 *   quiz={quiz}
 *   onClick={() => router.push(`/professor/quiz/${quiz.id}`)}
 *   onEdit={() => router.push(`/professor/quiz/${quiz.id}/edit`)}
 *   onDelete={() => setDeleteTarget(quiz)}
 *   onTogglePublish={() => togglePublish(quiz.id, !quiz.isPublished)}
 * />
 * ```
 */
export default function QuizListItem({
  quiz,
  onClick,
  onEdit,
  onDelete,
  onTogglePublish,
  className = '',
}: QuizListItemProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  const classColor = CLASS_COLORS[quiz.targetClass] || CLASS_COLORS.all;
  const difficultyConfig = DIFFICULTY_CONFIG[quiz.difficulty] || DIFFICULTY_CONFIG.normal;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className={`
        relative bg-white rounded-2xl p-4 shadow-sm border border-gray-100
        cursor-pointer transition-shadow hover:shadow-md
        ${className}
      `}
      onClick={onClick}
    >
      {/* 상단: 제목 및 메뉴 */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-800 truncate">
            {quiz.title}
          </h3>
          {quiz.description && (
            <p className="text-sm text-gray-500 truncate mt-0.5">
              {quiz.description}
            </p>
          )}
        </div>

        {/* 더보기 메뉴 버튼 */}
        <div className="relative ml-2">
          <motion.button
            ref={buttonRef}
            type="button"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="더보기 메뉴"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </motion.button>

          {/* 드롭다운 메뉴 */}
          <AnimatePresence>
            {showMenu && (
              <motion.div
                ref={menuRef}
                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-1 w-40 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-20"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    onEdit();
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  수정
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    onTogglePublish();
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  {quiz.isPublished ? (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                      비공개로 전환
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      공개로 전환
                    </>
                  )}
                </button>
                <div className="border-t border-gray-100 my-1" />
                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    onDelete();
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  삭제
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 중간: 뱃지들 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* 대상 반 */}
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${classColor}`}>
          {quiz.targetClass === 'all' ? '전체' : `${quiz.targetClass}반`}
        </span>

        {/* 문제 수 */}
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          {quiz.questionCount}문제
        </span>

        {/* 난이도 */}
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${difficultyConfig.color}`}>
          {difficultyConfig.label}
        </span>

        {/* 공개 상태 */}
        <span
          className={`
            ml-auto px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1
            ${quiz.isPublished ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}
          `}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${quiz.isPublished ? 'bg-green-500' : 'bg-gray-400'}`}
          />
          {quiz.isPublished ? '공개중' : '비공개'}
        </span>
      </div>

      {/* 하단: 통계 */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        {/* 참여자 수 */}
        <div className="flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <span>참여 {quiz.participantCount}명</span>
        </div>

        {/* 평균 점수 */}
        {quiz.participantCount > 0 && (
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span>평균 {Math.round(quiz.averageScore)}점</span>
          </div>
        )}

        {/* 피드백 수 */}
        {quiz.feedbackCount > 0 && (
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            <span>피드백 {quiz.feedbackCount}개</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
