'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/common';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts';
import { useProfessorQuiz, type ProfessorQuiz, type QuizTypeFilter } from '@/lib/hooks/useProfessorQuiz';
import { calcFeedbackScore, getFeedbackLabel } from '@/lib/utils/feedbackScore';
import type { FeedbackType } from '@/components/quiz/InstantFeedbackButton';

// ============================================================
// 타입
// ============================================================

type ProfessorFilterTab = 'midterm' | 'final' | 'past';

interface QuizFeedbackInfo {
  quizId: string;
  score: number;
  count: number;
}

interface BestQuestion {
  quizId: string;
  quizTitle: string;
  questionId: string;
  questionIndex: number;
  score: number;
  feedbackCount: number;
}

// ============================================================
// 상수
// ============================================================

const FILTER_TABS: { value: ProfessorFilterTab; label: string }[] = [
  { value: 'midterm', label: '중간' },
  { value: 'final', label: '기말' },
  { value: 'past', label: '기출' },
];

/** 시즌별 기본 탭 */
function getDefaultProfessorFilter(): ProfessorFilterTab {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return 'midterm';
  if ((month >= 6 && month <= 7) || (month >= 11 && month <= 12)) return 'final';
  return 'midterm';
}

// ============================================================
// 신문 스타일 퀴즈 카드
// ============================================================

function ProfessorQuizCard({
  quiz,
  feedbackInfo,
  onClick,
}: {
  quiz: ProfessorQuiz;
  feedbackInfo?: QuizFeedbackInfo;
  onClick: () => void;
}) {
  const fbLabel = feedbackInfo ? getFeedbackLabel(feedbackInfo.score) : null;

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="border border-[#1A1A1A] bg-[#FDFBF7] p-4 cursor-pointer hover:shadow-md transition-shadow"
    >
      {/* 상단: 타입 뱃지 + 날짜 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#5C5C5C]">
          {quiz.type === 'midterm' ? '중간' : quiz.type === 'final' ? '기말' : quiz.type === 'past' ? '기출' : '교수'}
          {' '}
          {quiz.targetClass !== 'all' && `· ${quiz.targetClass}반`}
        </span>
        <span className="text-[10px] text-[#5C5C5C]">
          {quiz.createdAt.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
        </span>
      </div>

      {/* 제목 */}
      <h3 className="font-serif-display text-base font-bold text-[#1A1A1A] leading-tight mb-2 line-clamp-2">
        {quiz.title}
      </h3>

      {/* 통계 행 */}
      <div className="flex items-center gap-3 text-[11px] text-[#5C5C5C]">
        <span>{quiz.questionCount}문제</span>
        <span className="w-px h-3 bg-[#D4CFC4]" />
        <span>{quiz.participantCount}명 참여</span>
        {quiz.participantCount > 0 && (
          <>
            <span className="w-px h-3 bg-[#D4CFC4]" />
            <span>평균 {quiz.averageScore}점</span>
          </>
        )}
      </div>

      {/* 피드백 점수 */}
      {fbLabel && feedbackInfo && feedbackInfo.count > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 border"
            style={{ color: fbLabel.color, borderColor: fbLabel.color }}
          >
            {fbLabel.label}
          </span>
          <span className="text-[10px] text-[#5C5C5C]">
            피드백 {feedbackInfo.count}건 · {feedbackInfo.score > 0 ? '+' : ''}{feedbackInfo.score.toFixed(1)}
          </span>
        </div>
      )}

      {/* 비공개 표시 */}
      {!quiz.isPublished && (
        <div className="mt-2">
          <span className="text-[10px] text-[#8B1A1A] border border-[#8B1A1A] px-1.5 py-0.5">
            비공개
          </span>
        </div>
      )}
    </motion.article>
  );
}

// ============================================================
// BEST Q 모달
// ============================================================

function BestQModal({
  isOpen,
  onClose,
  bestQuestions,
  loading: bestLoading,
}: {
  isOpen: boolean;
  onClose: () => void;
  bestQuestions: BestQuestion[];
  loading: boolean;
}) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center"
      >
        {/* 백드롭 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/50"
        />

        {/* 바텀시트 */}
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-lg bg-[#FDFBF7] border-t-2 border-[#1A1A1A] max-h-[70vh] flex flex-col"
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#D4CFC4]">
            <h2 className="font-serif-display text-lg font-bold text-[#1A1A1A]">BEST Q</h2>
            <button type="button" onClick={onClose} className="text-[#5C5C5C] p-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 내용 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {bestLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-none" />)}
              </div>
            ) : bestQuestions.length === 0 ? (
              <p className="text-sm text-[#5C5C5C] text-center py-8">
                피드백이 있는 문제가 아직 없습니다
              </p>
            ) : (
              bestQuestions.map((bq, idx) => {
                const fbLabel = getFeedbackLabel(bq.score);
                return (
                  <div
                    key={`${bq.quizId}-${bq.questionId}`}
                    className="border border-[#D4CFC4] bg-white p-3"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-lg font-black text-[#1A1A1A] w-6 flex-shrink-0">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[#5C5C5C] mb-1 truncate">
                          {bq.quizTitle} · {bq.questionIndex + 1}번
                        </p>
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 border"
                            style={{ color: fbLabel.color, borderColor: fbLabel.color }}
                          >
                            {fbLabel.label}
                          </span>
                          <span className="text-[11px] text-[#5C5C5C]">
                            점수 {bq.score > 0 ? '+' : ''}{bq.score.toFixed(1)} · {bq.feedbackCount}건
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ============================================================
// 메인 페이지
// ============================================================

export default function ProfessorQuizListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { userCourseId } = useCourse();
  const {
    quizzes,
    loading,
    error,
    fetchQuizzes,
    clearError,
  } = useProfessorQuiz();

  // 필터 상태
  const [activeFilter, setActiveFilter] = useState<ProfessorFilterTab>(getDefaultProfessorFilter);

  // 피드백 점수 데이터
  const [feedbackMap, setFeedbackMap] = useState<Record<string, QuizFeedbackInfo>>({});

  // BEST Q 상태
  const [showBestQ, setShowBestQ] = useState(false);
  const [bestQuestions, setBestQuestions] = useState<BestQuestion[]>([]);
  const [bestLoading, setBestLoading] = useState(false);

  // 퀴즈 목록 로드
  useEffect(() => {
    if (user?.uid) {
      fetchQuizzes(user.uid, { quizType: activeFilter });
    }
  }, [user?.uid, activeFilter, fetchQuizzes]);

  // 피드백 점수 로드
  useEffect(() => {
    if (quizzes.length === 0) return;

    const loadFeedbacks = async () => {
      const quizIds = quizzes.map(q => q.id);
      const newMap: Record<string, QuizFeedbackInfo> = {};

      // 30개씩 chunk 쿼리
      for (let i = 0; i < quizIds.length; i += 30) {
        const chunk = quizIds.slice(i, i + 30);
        const q = query(
          collection(db, 'questionFeedbacks'),
          where('quizId', 'in', chunk)
        );
        const snap = await getDocs(q);

        // 퀴즈별 피드백 집계
        const byQuiz: Record<string, { type: FeedbackType }[]> = {};
        snap.docs.forEach(d => {
          const data = d.data();
          const qid = data.quizId as string;
          if (!byQuiz[qid]) byQuiz[qid] = [];
          byQuiz[qid].push({ type: data.type as FeedbackType });
        });

        Object.entries(byQuiz).forEach(([qid, feedbacks]) => {
          newMap[qid] = {
            quizId: qid,
            score: calcFeedbackScore(feedbacks),
            count: feedbacks.length,
          };
        });
      }

      setFeedbackMap(newMap);
    };

    loadFeedbacks();
  }, [quizzes]);

  // BEST Q 로드
  const loadBestQuestions = useCallback(async () => {
    if (!userCourseId) return;

    setBestLoading(true);
    try {
      const q = query(
        collection(db, 'questionFeedbacks'),
        where('courseId', '==', userCourseId)
      );
      const snap = await getDocs(q);

      // 문제별 피드백 집계
      const byQuestion: Record<string, {
        quizId: string;
        questionId: string;
        questionNumber: number;
        feedbacks: { type: FeedbackType }[];
      }> = {};

      snap.docs.forEach(d => {
        const data = d.data();
        const key = `${data.quizId}_${data.questionId}`;
        if (!byQuestion[key]) {
          byQuestion[key] = {
            quizId: data.quizId,
            questionId: data.questionId,
            questionNumber: data.questionNumber || 0,
            feedbacks: [],
          };
        }
        byQuestion[key].feedbacks.push({ type: data.type as FeedbackType });
      });

      // 퀴즈 제목 조회 (고유 quizId 목록)
      const uniqueQuizIds = [...new Set(Object.values(byQuestion).map(q => q.quizId))];
      const quizTitleMap: Record<string, string> = {};
      for (let i = 0; i < uniqueQuizIds.length; i += 30) {
        const chunk = uniqueQuizIds.slice(i, i + 30);
        const quizQ = query(
          collection(db, 'quizzes'),
          where('__name__', 'in', chunk)
        );
        const quizSnap = await getDocs(quizQ);
        quizSnap.docs.forEach(d => {
          quizTitleMap[d.id] = d.data().title || '퀴즈';
        });
      }

      // 점수 계산 후 정렬
      const results: BestQuestion[] = Object.values(byQuestion)
        .map(item => ({
          quizId: item.quizId,
          quizTitle: quizTitleMap[item.quizId] || '퀴즈',
          questionId: item.questionId,
          questionIndex: item.questionNumber,
          score: calcFeedbackScore(item.feedbacks),
          feedbackCount: item.feedbacks.length,
        }))
        .filter(item => item.feedbackCount >= 1)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

      setBestQuestions(results);
    } catch (err) {
      console.error('BEST Q 로드 실패:', err);
    } finally {
      setBestLoading(false);
    }
  }, [userCourseId]);

  const handleBestQ = useCallback(() => {
    setShowBestQ(true);
    loadBestQuestions();
  }, [loadBestQuestions]);

  const handleQuizClick = useCallback(
    (quiz: ProfessorQuiz) => {
      router.push(`/professor/quiz/${quiz.id}`);
    },
    [router]
  );

  const handleCreateQuiz = useCallback(() => {
    router.push('/professor/quiz/create');
  }, [router]);

  return (
    <div className="min-h-screen bg-[#F5F0E8] pb-24">
      {/* 타이틀 */}
      <div className="px-4 pt-6 pb-4">
        <div className="border-y-4 border-[#1A1A1A] py-4">
          <h1 className="font-serif-display text-4xl font-black text-center text-[#1A1A1A] tracking-tight">
            QUIZ
          </h1>
        </div>
      </div>

      {/* 필터 탭 + BEST Q 버튼 */}
      <div className="px-4 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {FILTER_TABS.map(tab => {
            const isActive = activeFilter === tab.value;
            return (
              <motion.button
                key={tab.value}
                onClick={() => setActiveFilter(tab.value)}
                whileTap={{ scale: 0.95 }}
                className={`
                  relative px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap
                  transition-colors duration-200
                  ${isActive ? 'text-white' : 'text-[#5C5C5C] bg-[#EDEAE4]'}
                `}
              >
                {isActive && (
                  <motion.div
                    layoutId="profQuizFilterTab"
                    className="absolute inset-0 bg-[#1A1A1A] rounded-full"
                    initial={false}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </motion.button>
            );
          })}
        </div>

        <motion.button
          type="button"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleBestQ}
          className="px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#FDFBF7] text-[#1A1A1A] text-xs font-bold"
        >
          BEST Q
        </motion.button>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div className="mx-4 mb-4 p-3 border border-[#1A1A1A] bg-[#FDFBF7]">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#8B1A1A]">{error}</p>
            <button type="button" onClick={clearError} className="text-[#5C5C5C]">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 퀴즈 목록 */}
      <main className="px-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-28 rounded-none" />
            ))}
          </div>
        ) : quizzes.length === 0 ? (
          <div className="border border-[#D4CFC4] bg-[#FDFBF7] p-8 text-center">
            <p className="text-sm text-[#5C5C5C] mb-4">
              아직 출제한 퀴즈가 없습니다
            </p>
            <button
              type="button"
              onClick={handleCreateQuiz}
              className="text-sm font-bold text-[#1A1A1A] underline"
            >
              첫 퀴즈 출제하기
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {quizzes.map(quiz => (
              <ProfessorQuizCard
                key={quiz.id}
                quiz={quiz}
                feedbackInfo={feedbackMap[quiz.id]}
                onClick={() => handleQuizClick(quiz)}
              />
            ))}
          </div>
        )}
      </main>

      {/* 하단 고정 FAB */}
      <motion.button
        type="button"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleCreateQuiz}
        className="fixed bottom-24 right-4 w-14 h-14 bg-[#1A1A1A] text-white flex items-center justify-center shadow-lg z-30"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6v12m6-6H6" />
        </svg>
      </motion.button>

      {/* BEST Q 모달 */}
      <BestQModal
        isOpen={showBestQ}
        onClose={() => setShowBestQ(false)}
        bestQuestions={bestQuestions}
        loading={bestLoading}
      />
    </div>
  );
}
