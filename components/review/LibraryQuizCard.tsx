'use client';

import { memo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TAP_SCALE } from '@/lib/constants/springs';
import { NEWSPAPER_BG_TEXT } from './types';

// 교수 퀴즈 타입 판별
const PROFESSOR_TYPES = ['professor', 'professor-ai', 'midterm', 'final', 'past'];

/**
 * 서재 퀴즈 카드 (CustomReviewQuizCard와 동일한 스타일)
 * - 카드 클릭: 상세 페이지로 이동
 * - Details 버튼: 상세 페이지로 이동
 * - Review 버튼: 복습 시작
 *
 * 아이콘 (학생 서재):
 * - 사람: 교수 문제 (캐러셀)
 * - 노란 지구: 공개 문제
 * - 자물쇠: 비공개 (본인 AI/커스텀) → 클릭 시 공개 전환
 */
function LibraryQuizCard({
  quiz,
  onCardClick,
  onDetails,
  onReview,
  onReviewWrongOnly,
  onPublish,
  isSelectMode = false,
  isSelected = false,
  isProfessorView = false,
  currentUserId,
}: {
  quiz: {
    id: string;
    title: string;
    questionCount: number;
    score: number;
    totalQuestions: number;
    tags?: string[];
    myScore?: number;
    myFirstReviewScore?: number;
    isPublic?: boolean;
    creatorId?: string;
    quizType?: string;
  };
  onCardClick: () => void;
  onDetails: () => void;
  onReview: () => void;
  onReviewWrongOnly?: () => void;
  onPublish?: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  /** 교수 화면인지 (교수는 자물쇠/지구만 표시, 사람 아이콘 없음) */
  isProfessorView?: boolean;
  /** 현재 로그인한 사용자 ID (교수 문제 판별용) */
  currentUserId?: string;
}) {
  const [showReviewMenu, setShowReviewMenu] = useState(false);
  const reviewMenuRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (reviewMenuRef.current && !reviewMenuRef.current.contains(event.target as Node)) {
        setShowReviewMenu(false);
      }
    };
    if (showReviewMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showReviewMenu]);

  const tags = quiz.tags || [];

  // 아이콘 타입 결정: 학생 서재에서 교수 문제인지 판별
  const isProfessorQuiz = !isProfessorView && (
    PROFESSOR_TYPES.includes(quiz.quizType || '') ||
    // quizType이 없어도 creatorId가 본인이 아니면 교수 문제로 추정
    (!quiz.quizType && quiz.creatorId && currentUserId && quiz.creatorId !== currentUserId)
  );

  // 아이콘 렌더링
  const renderStatusIcon = () => {
    if (isSelectMode) return null;

    // 교수 문제 (학생에게만 사람 아이콘 표시)
    if (isProfessorQuiz) {
      return (
        <div
          className="absolute top-2 right-2 z-20 w-7 h-7 flex items-center justify-center text-[#5C5C5C]"
          title="교수 출제 문제"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
      );
    }

    // 공개 문제 (노란 지구)
    if (quiz.isPublic) {
      return (
        <div
          className="absolute top-2 right-2 z-20 w-7 h-7 flex items-center justify-center text-[#B8860B]"
          title="공개 문제"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      );
    }

    // 비공개 (자물쇠) — 본인 문제만 공개 전환 가능
    if (!quiz.isPublic && onPublish) {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPublish();
          }}
          className="absolute top-2 right-2 z-20 w-7 h-7 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] hover:scale-110 transition-all"
          title="공개로 전환"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </button>
      );
    }

    return null;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, boxShadow: '0 8px 20px rgba(0, 0, 0, 0.08)' }}
      whileTap={TAP_SCALE}
      transition={{ duration: 0.2 }}
      onClick={onCardClick}
      className={`relative border bg-[#F5F0E8]/70 backdrop-blur-sm overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.06)] cursor-pointer rounded-xl ${
        isSelectMode
          ? isSelected
            ? 'border-2 border-[#8B1A1A] bg-[#FDEAEA]'
            : 'border border-[#999] hover:bg-[#EDEAE4]'
          : 'border-[#999]'
      }`}
    >
      {/* 신문 배경 텍스트 */}
      <div className="absolute inset-0 p-2 overflow-hidden pointer-events-none">
        <p className="text-[5px] text-[#E8E8E8] leading-tight break-words">
          {NEWSPAPER_BG_TEXT.slice(0, 300)}
        </p>
      </div>

      {/* 선택 모드 체크 아이콘 */}
      {isSelectMode && (
        <div className={`absolute top-2 right-2 w-6 h-6 border-2 flex items-center justify-center z-20 ${
          isSelected
            ? 'border-[#8B1A1A] bg-[#8B1A1A]'
            : 'border-[#5C5C5C] bg-white'
        }`}>
          {isSelected && (
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      )}

      {/* 상태 아이콘 */}
      {renderStatusIcon()}

      {/* 카드 내용 */}
      <div className="relative z-10 p-3 bg-[#F5F0E8]/60">
        {/* 제목 (2줄 고정 높이) */}
        <div className="h-[36px] mb-1.5">
          <h3 className="font-bold text-sm line-clamp-2 text-[#1A1A1A] leading-snug pr-8">
            {quiz.title}
          </h3>
        </div>

        {/* 메타 정보 */}
        <p className="text-xs text-[#5C5C5C] mb-1">
          {quiz.questionCount}문제
        </p>

        {/* 태그 (2줄 고정 높이) */}
        <div className="h-[38px] mb-1.5 overflow-hidden">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-0.5">
              {tags.slice(0, 8).map((tag) => (
                <span
                  key={tag}
                  className="px-1 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-[10px] font-normal"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 버튼 (선택 모드가 아닐 때만 표시) */}
        {!isSelectMode && (
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDetails();
              }}
              className="flex-1 py-1.5 text-[11px] font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
            >
              Details
            </button>
            {/* Review 버튼 with 드롭다운 */}
            <div className="relative flex-1" ref={reviewMenuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onReviewWrongOnly) {
                    setShowReviewMenu(!showReviewMenu);
                  } else {
                    onReview();
                  }
                }}
                className="w-full py-1.5 text-[11px] font-semibold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors flex items-center justify-center gap-0.5 rounded-lg"
              >
                Review
                {onReviewWrongOnly && (
                  <svg className={`w-3 h-3 transition-transform ${showReviewMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              {/* 드롭다운 메뉴 */}
              <AnimatePresence>
                {showReviewMenu && onReviewWrongOnly && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="absolute bottom-full left-0 right-0 mb-1 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg z-50 rounded-lg overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(false);
                        onReview();
                      }}
                      className="w-full px-2 py-1.5 text-xs font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] text-center border-b border-[#EDEAE4]"
                    >
                      모두
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(false);
                        onReviewWrongOnly();
                      }}
                      className="w-full px-2 py-1.5 text-xs font-bold text-[#8B1A1A] hover:bg-[#FDEAEA] text-center"
                    >
                      오답만
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default memo(LibraryQuizCard);
