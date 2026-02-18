'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  type StudentData,
  type StudentDetail,
  CLASS_COLORS,
} from '@/lib/hooks/useProfessorStudents';

// ============================================================
// 타입 정의
// ============================================================

interface StudentDetailModalProps {
  /** 선택된 학생 (null이면 모달 닫힘) */
  student: StudentData | null;
  /** 상세 정보 로드 함수 */
  onLoadDetail: (uid: string) => Promise<StudentDetail | null>;
  /** 닫기 핸들러 */
  onClose: () => void;
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 날짜 포맷
 */
const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

/**
 * 짧은 날짜 포맷
 */
const formatShortDate = (date: Date): string => {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
  }).format(date);
};

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 학생 상세 정보 모달
 *
 * 학생의 상세 통계, 최근 퀴즈 기록, 피드백 내역을 표시합니다.
 */
export default function StudentDetailModal({
  student,
  onLoadDetail,
  onClose,
}: StudentDetailModalProps) {
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'quizzes' | 'feedbacks'>('quizzes');

  // 상세 정보 로드
  useEffect(() => {
    if (student) {
      setLoading(true);
      onLoadDetail(student.uid)
        .then(setDetail)
        .finally(() => setLoading(false));
    } else {
      setDetail(null);
    }
  }, [student, onLoadDetail]);

  const isOpen = student !== null;

  // 모달 열림 시 body 스크롤 방지
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);
  const classColor = student ? CLASS_COLORS[student.classId] : '#6366F1';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 배경 오버레이 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-50"
          />

          {/* 모달 컨텐츠 */}
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl max-h-[85vh] overflow-hidden flex flex-col"
          >
            {/* 핸들 바 */}
            <div className="flex justify-center py-3">
              <div className="w-10 h-1 bg-gray-300 rounded-full" />
            </div>

            {/* 헤더 */}
            <div className="px-5 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-4">
                {/* 아바타 */}
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl"
                  style={{ backgroundColor: classColor }}
                >
                  {student?.nickname.charAt(0)}
                </div>

                {/* 정보 */}
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-gray-800">
                    {student?.nickname}
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: classColor }}
                    >
                      {student?.classId}반
                    </span>
                    <span className="text-sm text-gray-400">
                      Lv.{student?.level}
                    </span>
                  </div>
                </div>

                {/* 닫기 버튼 */}
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                >
                  <svg
                    className="w-6 h-6 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* 스크롤 영역 */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              {loading ? (
                // 로딩
                <div className="flex items-center justify-center py-12">
                  <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                </div>
              ) : detail ? (
                <>
                  {/* 통계 카드 */}
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="bg-indigo-50 rounded-2xl p-4 text-center">
                      <p className="text-2xl font-bold text-indigo-600">
                        {detail.quizStats.totalAttempts}
                      </p>
                      <p className="text-sm text-indigo-600/70">총 퀴즈</p>
                    </div>
                    <div className="bg-green-50 rounded-2xl p-4 text-center">
                      <p className="text-2xl font-bold text-green-600">
                        {detail.quizStats.totalAttempts > 0
                          ? Math.round(
                              (detail.quizStats.totalCorrect /
                                detail.quizStats.totalAttempts) *
                                100
                            )
                          : 0}
                        %
                      </p>
                      <p className="text-sm text-green-600/70">정확도</p>
                    </div>
                    <div className="bg-amber-50 rounded-2xl p-4 text-center">
                      <p className="text-2xl font-bold text-amber-600">
                        {Math.round(detail.quizStats.averageScore)}
                      </p>
                      <p className="text-sm text-amber-600/70">평균 점수</p>
                    </div>
                    <div className="bg-purple-50 rounded-2xl p-4 text-center">
                      <p className="text-2xl font-bold text-purple-600">
                        {detail.feedbackCount}
                      </p>
                      <p className="text-sm text-purple-600/70">피드백</p>
                    </div>
                  </div>

                  {/* 탭 */}
                  <div className="flex gap-2 mb-4">
                    <button
                      type="button"
                      onClick={() => setActiveTab('quizzes')}
                      className={`
                        flex-1 py-2 rounded-xl text-sm font-medium transition-colors
                        ${
                          activeTab === 'quizzes'
                            ? 'bg-indigo-500 text-white'
                            : 'bg-gray-100 text-gray-600'
                        }
                      `}
                    >
                      최근 퀴즈
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('feedbacks')}
                      className={`
                        flex-1 py-2 rounded-xl text-sm font-medium transition-colors
                        ${
                          activeTab === 'feedbacks'
                            ? 'bg-indigo-500 text-white'
                            : 'bg-gray-100 text-gray-600'
                        }
                      `}
                    >
                      최근 피드백
                    </button>
                  </div>

                  {/* 탭 컨텐츠 */}
                  <AnimatePresence mode="wait">
                    {activeTab === 'quizzes' ? (
                      <motion.div
                        key="quizzes"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        className="space-y-2"
                      >
                        {detail.recentQuizzes.length > 0 ? (
                          detail.recentQuizzes.map((quiz) => (
                            <div
                              key={quiz.quizId}
                              className="bg-gray-50 rounded-xl p-3"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <h4 className="font-medium text-gray-800 truncate">
                                  {quiz.quizTitle}
                                </h4>
                                <span className="text-xs text-gray-400">
                                  {formatShortDate(quiz.completedAt)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-indigo-500 rounded-full"
                                    style={{
                                      width: `${
                                        (quiz.score / quiz.totalQuestions) * 100
                                      }%`,
                                    }}
                                  />
                                </div>
                                <span className="text-sm font-medium text-gray-600">
                                  {quiz.score}/{quiz.totalQuestions}
                                </span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-center text-gray-400 py-8">
                            퀴즈 기록이 없습니다
                          </p>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div
                        key="feedbacks"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-2"
                      >
                        {detail.recentFeedbacks.length > 0 ? (
                          detail.recentFeedbacks.map((feedback) => (
                            <div
                              key={feedback.feedbackId}
                              className="bg-gray-50 rounded-xl p-3"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-indigo-600 font-medium">
                                  {feedback.quizTitle}
                                </span>
                                <span className="text-xs text-gray-400">
                                  {formatShortDate(feedback.createdAt)}
                                </span>
                              </div>
                              <p className="text-sm text-gray-700 line-clamp-2">
                                {feedback.content}
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="text-center text-gray-400 py-8">
                            피드백 기록이 없습니다
                          </p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* 가입일 */}
                  <div className="mt-6 pt-4 border-t border-gray-100">
                    <p className="text-xs text-gray-400 text-center">
                      가입일: {formatDate(detail.createdAt)}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-center text-gray-400 py-8">
                  데이터를 불러올 수 없습니다
                </p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
