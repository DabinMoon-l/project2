'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import type { QuestionData } from './QuestionEditor';
import { calculateTotalQuestionCount } from './QuestionEditor';
import { formatChapterLabel } from '@/lib/courseIndex';

// 결합형 문제 펼침 상태 관리용

// ============================================================
// 타입 정의
// ============================================================

interface QuestionListProps {
  /** 문제 목록 */
  questions: QuestionData[];
  /** 문제 목록 변경 시 콜백 */
  onQuestionsChange: (questions: QuestionData[]) => void;
  /** 문제 편집 시 콜백 */
  onEditQuestion: (index: number) => void;
  /** 사용자 역할 (학생/교수) */
  userRole?: 'student' | 'professor';
  /** 과목 ID (챕터 라벨 표시용) */
  courseId?: string;
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 문제 유형 라벨
 */
const typeLabels: Record<string, string> = {
  ox: 'OX',
  multiple: '객관식',
  subjective: '주관식',
  short_answer: '주관식',
  essay: '서술형',
  combined: '결합형',
};

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 문제 목록 컴포넌트
 *
 * 추가된 문제들을 리스트로 표시하고,
 * 드래그로 순서 변경, 편집, 삭제 기능을 제공합니다.
 */
export default function QuestionList({
  questions,
  onQuestionsChange,
  onEditQuestion,
  userRole = 'student',
  courseId,
  className = '',
}: QuestionListProps) {
  // 역할에 따른 라벨 반환
  const getTypeLabel = (type: string) => {
    if (userRole === 'student' && type === 'short_answer') {
      return '주관식';
    }
    return typeLabels[type] || type;
  };
  // 삭제 확인 모달 상태
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  // 결합형 문제 하위문제 펼침 상태 (문제 ID -> 펼침 여부)
  const [expandedCombined, setExpandedCombined] = useState<Set<string>>(new Set());

  // 결합형 문제 펼침 토글
  const toggleCombinedExpand = useCallback((questionId: string) => {
    setExpandedCombined(prev => {
      const newSet = new Set(prev);
      if (newSet.has(questionId)) {
        newSet.delete(questionId);
      } else {
        newSet.add(questionId);
      }
      return newSet;
    });
  }, []);

  /**
   * 문제 삭제
   */
  const handleDelete = useCallback(
    (index: number) => {
      const newQuestions = questions.filter((_, i) => i !== index);
      onQuestionsChange(newQuestions);
      setDeleteIndex(null);
    },
    [questions, onQuestionsChange]
  );

  /**
   * 문제 순서 변경 (드래그 앤 드롭)
   */
  const handleReorder = useCallback(
    (newOrder: QuestionData[]) => {
      onQuestionsChange(newOrder);
    },
    [onQuestionsChange]
  );

  // 문제가 없는 경우
  if (questions.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={`
          flex flex-col items-center justify-center
          py-8 px-4
          bg-[#F5F0E8] border-2 border-dashed border-[#1A1A1A]
          ${className}
        `}
      >
        <div className="w-12 h-12 bg-[#EDEAE4] border-2 border-[#1A1A1A] flex items-center justify-center mb-3">
          <svg
            className="w-6 h-6 text-[#5C5C5C]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
        </div>
        <p className="text-[#5C5C5C] text-center text-xs">
          아직 추가된 문제가 없습니다.
          <br />
          직접 문제를 추가해주세요.
        </p>
      </motion.div>
    );
  }

  // 실제 문제 수 계산 (결합형 하위문제 포함)
  const totalQuestionCount = calculateTotalQuestionCount(questions);

  return (
    <div className={className}>
      {/* 목록 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-[#1A1A1A]">
          문제 목록
          <span className="ml-1.5 text-xs font-normal text-[#5C5C5C]">
            ({totalQuestionCount}개)
          </span>
        </h3>
        <p className="text-[10px] text-[#5C5C5C]">드래그하여 순서 변경</p>
      </div>

      {/* 문제 목록 (드래그 가능) */}
      <Reorder.Group
        axis="y"
        values={questions}
        onReorder={handleReorder}
        className="space-y-3"
      >
        <AnimatePresence>
          {questions.map((question, index) => (
            <Reorder.Item
              key={question.id}
              value={question}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -100 }}
              whileDrag={{ scale: 1.02, boxShadow: '4px 4px 0px #1A1A1A' }}
              className="relative"
            >
              <div className="bg-[#F5F0E8] p-3 border-2 border-[#1A1A1A] cursor-grab active:cursor-grabbing">
                {/* 드래그 핸들 */}
                <div className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[#5C5C5C]">
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                  </svg>
                </div>

                {/* 문제 내용 */}
                <div className="ml-5">
                  {/* 상단: 번호, 유형, 액션 버튼 */}
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      {/* 문제 번호 */}
                      <span className="w-6 h-6 bg-[#1A1A1A] text-[#F5F0E8] flex items-center justify-center text-xs font-bold">
                        {index + 1}
                      </span>

                      {/* 문제 유형 뱃지 */}
                      <span className={`px-2 py-0.5 border text-xs font-bold ${
                        question.type === 'combined'
                          ? 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]'
                          : 'border-[#1A1A1A] text-[#1A1A1A]'
                      }`}>
                        {getTypeLabel(question.type)}
                        {question.type === 'combined' && question.subQuestions && (
                          <span className="ml-1">({question.subQuestions.length})</span>
                        )}
                      </span>

                      {/* 챕터 뱃지 */}
                      {courseId && question.chapterId && (
                        <span className="px-2 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-xs font-medium">
                          {formatChapterLabel(courseId, question.chapterId, question.chapterDetailId)}
                        </span>
                      )}
                    </div>

                    {/* 액션 버튼 */}
                    <div className="flex items-center gap-1">
                      {/* 편집 버튼 */}
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditQuestion(index);
                        }}
                        className="p-2 text-[#5C5C5C] hover:text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                        aria-label="문제 편집"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      </motion.button>

                      {/* 삭제 버튼 */}
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteIndex(index);
                        }}
                        className="p-2 text-[#5C5C5C] hover:text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
                        aria-label="문제 삭제"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </motion.button>
                    </div>
                  </div>

                  {/* 문제 텍스트 (결합형이 아닌 경우) */}
                  {question.type !== 'combined' && (
                    <>
                      <p className="text-[#1A1A1A] text-sm line-clamp-2 mb-2">
                        {question.text}
                      </p>

                      {/* 정답 미리보기 */}
                      <div className="text-xs text-[#5C5C5C] flex flex-wrap items-center gap-x-2">
                        <span>
                          정답:{' '}
                          <span className="text-[#1A6B1A] font-bold">
                            {question.type === 'ox'
                              ? question.answerIndex === 0
                                ? 'O'
                                : question.answerIndex === 1
                                  ? 'X'
                                  : '미선택'
                              : question.type === 'multiple'
                                ? question.answerIndex >= 0
                                  ? `${question.answerIndex + 1}번`
                                  : '미선택'
                                : (question.answerText || '').replace(/\|\|\|/g, ', ') || '미입력'}
                          </span>
                        </span>
                        {question.imageUrl && (
                          <span className="text-[#5C5C5C]">| 이미지</span>
                        )}
                        {/* 지문 (구 보기/mixedExamples → passageBlocks) */}
                        {(question.passageBlocks && question.passageBlocks.length > 0) ||
                          (question.examples && question.examples.items?.some(i => i.trim())) ||
                          (question.mixedExamples && question.mixedExamples.some(i => i.content?.trim())) ? (
                          <span className="text-[#5C5C5C]">| 지문</span>
                        ) : null}
                        {/* 보기 (새로운 bogi 필드) */}
                        {question.bogi && question.bogi.items && question.bogi.items.some(i => i.content?.trim()) && (
                          <span className="text-[#5C5C5C]">| 보기</span>
                        )}
                        {question.explanation && (
                          <span className="text-[#5C5C5C]">| 해설</span>
                        )}
                      </div>
                    </>
                  )}

                  {/* 결합형 문제: 공통 문제 + 하위 문제 아코디언 */}
                  {question.type === 'combined' && (
                    <>
                      {/* 공통 문제 (일반 문제처럼 표시) */}
                      <p className="text-[#1A1A1A] text-sm line-clamp-2 mb-2">
                        {question.commonQuestion || question.text || '(공통 문제 없음)'}
                      </p>

                      {/* 공통 지문/이미지/보기 있음 표시 */}
                      <div className="text-xs text-[#5C5C5C] flex flex-wrap items-center gap-x-2 mb-2">
                        {question.passage && <span>| 공통 지문</span>}
                        {question.passageImage && <span>| 공통 이미지</span>}
                        {question.passageBlocks && question.passageBlocks.length > 0 && <span>| 지문</span>}
                        {question.bogi && question.bogi.items && question.bogi.items.some(i => i.content?.trim()) && <span>| 보기</span>}
                        {/* 구 형식 호환 */}
                        {question.koreanAbcItems && question.koreanAbcItems.length > 0 && <span>| ㄱㄴㄷ 지문</span>}
                      </div>

                      {/* 하위 문제 아코디언 */}
                      {question.subQuestions && question.subQuestions.length > 0 ? (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleCombinedExpand(question.id);
                            }}
                            className="flex items-center gap-2 text-xs text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors"
                          >
                            <svg
                              className={`w-4 h-4 transition-transform ${expandedCombined.has(question.id) ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            <span>하위 문제 {question.subQuestions.length}개 {expandedCombined.has(question.id) ? '접기' : '보기'}</span>
                          </button>

                          {/* 펼쳐진 하위 문제 목록 */}
                          <AnimatePresence>
                            {expandedCombined.has(question.id) && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="mt-2 space-y-1.5 border-l-2 border-[#1A6B1A] pl-3">
                                  {question.subQuestions.map((sq, sqIdx) => (
                                    <div key={sq.id} className="text-xs bg-[#EDEAE4] p-2">
                                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                                        <span className="px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-[10px]">
                                          {sqIdx + 1}
                                        </span>
                                        <span className="px-1.5 py-0.5 border border-[#5C5C5C] text-[#5C5C5C] text-[10px]">
                                          {getTypeLabel(sq.type)}
                                        </span>
                                        {courseId && sq.chapterId && (
                                          <span className="px-1.5 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-[10px] font-medium">
                                            {formatChapterLabel(courseId, sq.chapterId, sq.chapterDetailId)}
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-[#1A1A1A] line-clamp-1">{sq.text || '(내용 없음)'}</p>
                                      <span className="text-[#5C5C5C]">
                                        정답:{' '}
                                        <span className="text-[#1A6B1A] font-bold">
                                          {sq.type === 'ox'
                                            ? sq.answerIndex === 0 ? 'O' : sq.answerIndex === 1 ? 'X' : '미선택'
                                            : sq.type === 'multiple'
                                              ? sq.answerIndex !== undefined && sq.answerIndex >= 0 ? `${sq.answerIndex + 1}번` : '미선택'
                                              : (sq.answerText || '').replace(/\|\|\|/g, ', ') || '미입력'}
                                        </span>
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ) : (
                        <p className="text-xs text-[#8B1A1A]">하위 문제가 없습니다</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Reorder.Item>
          ))}
        </AnimatePresence>
      </Reorder.Group>

      {/* 삭제 확인 모달 */}
      <AnimatePresence>
        {deleteIndex !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            {/* 백드롭 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeleteIndex(null)}
              className="absolute inset-0 bg-black/50"
            />

            {/* 모달 */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 max-w-[280px] w-full"
            >
              <div className="text-center">
                {/* 아이콘 */}
                <div className="w-9 h-9 bg-[#FDEAEA] border-2 border-[#8B1A1A] flex items-center justify-center mx-auto mb-3">
                  <svg
                    className="w-4 h-4 text-[#8B1A1A]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>

                {/* 제목 */}
                <h3 className="text-sm font-bold text-[#1A1A1A] mb-1.5">
                  문제를 삭제할까요?
                </h3>

                {/* 설명 */}
                <p className="text-xs text-[#5C5C5C] mb-4">
                  문제 {deleteIndex + 1}번이 삭제됩니다.
                  <br />이 작업은 되돌릴 수 없습니다.
                </p>

                {/* 버튼 */}
                <div className="flex gap-2">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setDeleteIndex(null)}
                    className="flex-1 py-1.5 px-3 text-xs bg-[#EDEAE4] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                  >
                    취소
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleDelete(deleteIndex)}
                    className="flex-1 py-1.5 px-3 text-xs bg-[#8B1A1A] text-[#F5F0E8] font-bold border-2 border-[#8B1A1A] hover:bg-[#6B1414] transition-colors"
                  >
                    삭제
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 최소 문제 수 안내 */}
      {totalQuestionCount < 3 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 p-3 bg-[#FFF8E7] border border-[#D4A84B] flex items-center gap-2"
        >
          <svg
            className="w-5 h-5 text-[#D4A84B] flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm text-[#8B6914]">
            최소 3문제 이상 필요합니다. (현재 {totalQuestionCount}개)
          </span>
        </motion.div>
      )}
    </div>
  );
}
