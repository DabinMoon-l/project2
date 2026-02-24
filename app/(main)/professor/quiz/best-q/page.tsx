'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/common';
import { useCourse } from '@/lib/contexts';
import { calcFeedbackScore, getFeedbackLabel } from '@/lib/utils/feedbackScore';
import type { FeedbackType } from '@/components/quiz/InstantFeedbackButton';
import { useProfessorQuiz, type QuizQuestion, type QuestionStats, type ChoiceStats } from '@/lib/hooks/useProfessorQuiz';

// ============================================================
// 타입
// ============================================================

interface BestQuestionData {
  quizId: string;
  quizTitle: string;
  questionId: string;
  questionIndex: number; // 문제 번호 (0-indexed)
  score: number;
  feedbackCount: number;
  // 문제 내용
  question: QuizQuestion | null;
  // 통계
  stats: QuestionStats | null;
}

// ============================================================
// 선지별 응답 분포 바
// ============================================================

function ChoiceDistribution({
  stats,
  question,
}: {
  stats: QuestionStats;
  question: QuizQuestion;
}) {
  if (!stats.choiceStats || stats.choiceStats.length === 0) return null;

  const isOX = question.type === 'ox';
  const correctAnswer = question.answer;

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-[#1A1A1A]">선지별 응답 분포</p>
      {stats.choiceStats.map((cs: ChoiceStats, idx: number) => {
        // 정답 여부 판별
        let isCorrect = false;
        if (isOX) {
          isCorrect = Number(cs.choice) === Number(correctAnswer);
        } else {
          isCorrect = Number(cs.choice) === Number(correctAnswer);
        }

        // 선지 라벨
        let label: string;
        if (isOX) {
          label = idx === 0 ? 'O' : 'X';
        } else if (question.choices && question.choices[idx]) {
          label = `${idx + 1}. ${question.choices[idx]}`;
        } else {
          label = `${idx + 1}번`;
        }

        return (
          <div key={idx}>
            <div className="flex items-center justify-between mb-0.5">
              <span className={`text-[11px] truncate max-w-[200px] ${isCorrect ? 'font-bold text-[#16a34a]' : 'text-[#5C5C5C]'}`}>
                {isCorrect && '✓ '}{label}
              </span>
              <span className="text-[10px] text-[#5C5C5C]">
                {cs.count}명 ({cs.percentage}%)
              </span>
            </div>
            <div className="h-2 bg-[#EDEAE4] w-full">
              <div
                className={`h-full transition-all ${isCorrect ? 'bg-[#16a34a]' : 'bg-[#D4CFC4]'}`}
                style={{ width: `${cs.percentage}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// 오답 목록 (주관식)
// ============================================================

function WrongAnswerList({ wrongAnswers }: { wrongAnswers: string[] }) {
  if (!wrongAnswers || wrongAnswers.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-bold text-[#1A1A1A] mb-1">오답 목록</p>
      <div className="flex flex-wrap gap-1">
        {wrongAnswers.slice(0, 10).map((ans, idx) => (
          <span key={idx} className="text-[11px] px-2 py-0.5 border border-[#dc2626] text-[#dc2626] bg-[#FDFBF7]">
            {ans}
          </span>
        ))}
        {wrongAnswers.length > 10 && (
          <span className="text-[10px] text-[#5C5C5C]">+{wrongAnswers.length - 10}개</span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 한 문제 카드
// ============================================================

function BestQuestionCard({
  data,
  rank,
}: {
  data: BestQuestionData;
  rank: number;
}) {
  const fbLabel = getFeedbackLabel(data.score);
  const { question, stats } = data;

  return (
    <div className="w-full h-full overflow-y-auto px-1">
      <div className="border-2 border-[#1A1A1A] bg-[#FDFBF7]">
        {/* 상단 헤더 */}
        <div className="bg-[#1A1A1A] text-[#F5F0E8] px-4 py-3">
          <div className="flex items-center gap-3">
            {/* 순위 뱃지 */}
            <div className="w-10 h-10 border-2 border-[#F5F0E8] flex items-center justify-center flex-shrink-0">
              <span className="font-serif text-xl font-black">{rank}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] tracking-wider mb-0.5 truncate">{data.quizTitle}</p>
              <p className="text-sm font-bold">{data.questionIndex + 1}번 문제</p>
            </div>
          </div>
        </div>

        {/* 피드백 점수 */}
        <div className="px-4 py-2 border-b border-[#D4CFC4] flex items-center gap-3">
          <span
            className="text-xs font-bold px-2 py-0.5 border"
            style={{ color: fbLabel.color, borderColor: fbLabel.color }}
          >
            {fbLabel.label}
          </span>
          <span className="text-xs text-[#5C5C5C]">
            점수 {data.score > 0 ? '+' : ''}{data.score.toFixed(1)} · 피드백 {data.feedbackCount}건
          </span>
        </div>

        {/* 문제 내용 */}
        <div className="px-4 py-3 space-y-3">
          {question ? (
            <>
              {/* 문제 유형 뱃지 */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8]">
                  {question.type === 'ox' ? 'OX' :
                   question.type === 'multiple' ? '객관식' :
                   question.type === 'short_answer' ? '주관식' :
                   question.type === 'essay' ? '서술형' :
                   question.type === 'combined' ? '결합형' : '주관식'}
                </span>
              </div>

              {/* 문제 텍스트 */}
              <p className="text-sm text-[#1A1A1A] leading-relaxed whitespace-pre-wrap">
                {question.text}
              </p>

              {/* 선지 (객관식) */}
              {question.type === 'multiple' && question.choices && (
                <div className="space-y-1 pl-2">
                  {question.choices.map((choice, idx) => {
                    const isAnswer = Number(question.answer) === idx;
                    return (
                      <p
                        key={idx}
                        className={`text-sm ${isAnswer ? 'font-bold text-[#16a34a]' : 'text-[#5C5C5C]'}`}
                      >
                        {idx + 1}. {choice} {isAnswer && '✓'}
                      </p>
                    );
                  })}
                </div>
              )}

              {/* OX 정답 */}
              {question.type === 'ox' && (
                <p className="text-sm font-bold text-[#16a34a]">
                  정답: {question.answer === 0 ? 'O' : 'X'}
                </p>
              )}

              {/* 단답형/주관식 정답 */}
              {(question.type === 'short_answer' || question.type === 'subjective') && (
                <p className="text-sm">
                  <span className="font-bold text-[#16a34a]">정답:</span>{' '}
                  <span className="text-[#1A1A1A]">{String(question.answer)}</span>
                </p>
              )}

              {/* 해설 */}
              {question.explanation && (
                <div className="border-l-2 border-[#1A1A1A] pl-3 py-1">
                  <p className="text-xs font-bold text-[#5C5C5C] mb-0.5">해설</p>
                  <p className="text-xs text-[#5C5C5C] leading-relaxed whitespace-pre-wrap">
                    {question.explanation}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-[#5C5C5C]">문제 내용을 불러올 수 없습니다</p>
          )}
        </div>

        {/* 통계 섹션 */}
        {stats && stats.totalResponses > 0 && (
          <div className="px-4 py-3 border-t border-[#D4CFC4] space-y-3">
            <p className="text-xs font-bold text-[#1A1A1A] uppercase tracking-wider">STATISTICS</p>

            {/* 기본 통계 */}
            <div className="flex items-center gap-4 text-xs text-[#5C5C5C]">
              <span>응답 {stats.totalResponses}명</span>
              <span className="w-px h-3 bg-[#D4CFC4]" />
              <span className="text-[#16a34a] font-bold">정답률 {stats.correctRate}%</span>
              <span className="w-px h-3 bg-[#D4CFC4]" />
              <span className="text-[#dc2626]">오답률 {stats.wrongRate}%</span>
            </div>

            {/* 정답률 바 */}
            <div className="h-3 bg-[#EDEAE4] w-full flex overflow-hidden">
              <div className="h-full bg-[#16a34a]" style={{ width: `${stats.correctRate}%` }} />
              <div className="h-full bg-[#dc2626]" style={{ width: `${stats.wrongRate}%` }} />
            </div>

            {/* 선지별 분포 (OX/객관식) */}
            {question && (question.type === 'ox' || question.type === 'multiple') && (
              <ChoiceDistribution stats={stats} question={question} />
            )}

            {/* 오답 목록 (주관식) */}
            {stats.wrongAnswers && stats.wrongAnswers.length > 0 && (
              <WrongAnswerList wrongAnswers={stats.wrongAnswers} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 메인 페이지
// ============================================================

export default function BestQPage() {
  const router = useRouter();
  const { userCourseId } = useCourse();
  const { fetchQuiz, fetchQuizStatistics } = useProfessorQuiz();

  const [bestQuestions, setBestQuestions] = useState<BestQuestionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  // BEST Q 로드
  useEffect(() => {
    if (!userCourseId) return;

    const load = async () => {
      setLoading(true);
      try {
        // 1. 해당 과목의 퀴즈 ID + 제목 먼저 가져오기
        const quizQ = query(
          collection(db, 'quizzes'),
          where('courseId', '==', userCourseId)
        );
        const quizSnap = await getDocs(quizQ);
        const quizIds: string[] = [];
        const quizTitleMap: Record<string, string> = {};
        quizSnap.docs.forEach(d => {
          quizIds.push(d.id);
          quizTitleMap[d.id] = d.data().title || '퀴즈';
        });

        if (quizIds.length === 0) {
          setBestQuestions([]);
          setLoading(false);
          return;
        }

        // 2. 해당 퀴즈들의 피드백 가져오기 (quizId in 쿼리, 30개씩 청크)
        const byQuestion: Record<string, {
          quizId: string;
          questionId: string;
          questionNumber: number;
          feedbacks: { type: FeedbackType }[];
        }> = {};

        for (let i = 0; i < quizIds.length; i += 30) {
          const chunk = quizIds.slice(i, i + 30);
          const fbQ = query(
            collection(db, 'questionFeedbacks'),
            where('quizId', 'in', chunk)
          );
          const fbSnap = await getDocs(fbQ);
          fbSnap.docs.forEach(d => {
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
        }

        // 3. 점수 계산 후 Top 20
        const ranked = Object.values(byQuestion)
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

        // 4. 각 문제 내용 + 통계 로드
        const results: BestQuestionData[] = [];
        // 퀴즈별 데이터 캐시 (같은 퀴즈의 여러 문제 최적화)
        const quizCache: Record<string, { questions: QuizQuestion[] } | null> = {};

        for (const item of ranked) {
          // 퀴즈 데이터 로드 (캐시 우선)
          if (!(item.quizId in quizCache)) {
            const quizData = await fetchQuiz(item.quizId);
            quizCache[item.quizId] = quizData ? { questions: quizData.questions } : null;
          }

          const cached = quizCache[item.quizId];
          let question: QuizQuestion | null = null;

          if (cached) {
            // questionId로 찾기
            question = cached.questions.find(q => q.id === item.questionId) || null;
            // 못 찾으면 인덱스로 시도
            if (!question && cached.questions[item.questionIndex]) {
              question = cached.questions[item.questionIndex];
            }
          }

          // 통계 로드
          let stats: QuestionStats | null = null;
          if (cached) {
            const fullStats = await fetchQuizStatistics(item.quizId, cached.questions);
            if (fullStats) {
              stats = fullStats.questionStats[item.questionIndex] || null;
            }
          }

          results.push({
            ...item,
            question,
            stats,
          });
        }

        setBestQuestions(results);
        setCurrentIndex(0);
      } catch (err) {
        console.error('BEST Q 로드 실패:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCourseId]);

  // 순환 네비게이션
  const total = bestQuestions.length;

  const goToPrev = useCallback(() => {
    if (total === 0) return;
    setCurrentIndex(prev => (prev - 1 + total) % total);
  }, [total]);

  const goToNext = useCallback(() => {
    if (total === 0) return;
    setCurrentIndex(prev => (prev + 1) % total);
  }, [total]);

  const handleDragEnd = useCallback((_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x > 60) goToPrev();
    else if (info.offset.x < -60) goToNext();
  }, [goToPrev, goToNext]);

  // 스와이프 방향 추적
  const [direction, setDirection] = useState(0);

  const navigate = useCallback((newIndex: number) => {
    setDirection(newIndex > currentIndex ? 1 : -1);
    setCurrentIndex(newIndex);
  }, [currentIndex]);

  const navigatePrev = useCallback(() => {
    if (total === 0) return;
    setDirection(-1);
    setCurrentIndex(prev => (prev - 1 + total) % total);
  }, [total]);

  const navigateNext = useCallback(() => {
    if (total === 0) return;
    setDirection(1);
    setCurrentIndex(prev => (prev + 1) % total);
  }, [total]);

  const handleSwipeEnd = useCallback((_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x > 60) navigatePrev();
    else if (info.offset.x < -60) navigateNext();
  }, [navigatePrev, navigateNext]);

  return (
    <div className="min-h-screen bg-[#F5F0E8] flex flex-col">
      {/* 헤더 */}
      <header className="px-4 pt-4 pb-2 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="w-10 h-10 flex items-center justify-center border border-[#1A1A1A] bg-[#FDFBF7] hover:bg-[#EDEAE4] transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="font-serif-display text-2xl font-black text-[#1A1A1A]">BEST Q</h1>
          <p className="text-[10px] text-[#5C5C5C] tracking-wider">피드백 점수 높은 문제 Top 20</p>
        </div>
        {total > 0 && (
          <span className="ml-auto text-xs text-[#5C5C5C] font-mono">
            {currentIndex + 1} / {total}
          </span>
        )}
      </header>

      {/* 메인 영역 */}
      <div className="flex-1 relative overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-4">
            <Skeleton className="h-12 rounded-none" />
            <Skeleton className="h-32 rounded-none" />
            <Skeleton className="h-24 rounded-none" />
            <Skeleton className="h-20 rounded-none" />
          </div>
        ) : bestQuestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <p className="text-lg font-bold text-[#1A1A1A] mb-2">피드백이 있는 문제가 없습니다</p>
            <p className="text-sm text-[#5C5C5C]">학생들의 피드백이 쌓이면 여기에 표시됩니다</p>
          </div>
        ) : (
          <>
            {/* 좌측 화살표 */}
            <button
              onClick={navigatePrev}
              className="absolute left-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 flex items-center justify-center rounded-full border border-[#1A1A1A] bg-[#F5F0E8]/80 shadow-sm"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </button>

            {/* 우측 화살표 */}
            <button
              onClick={navigateNext}
              className="absolute right-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 flex items-center justify-center rounded-full border border-[#1A1A1A] bg-[#F5F0E8]/80 shadow-sm"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </button>

            {/* 카드 스와이프 영역 */}
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={currentIndex}
                custom={direction}
                initial={{ x: direction >= 0 ? 300 : -300, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: direction >= 0 ? -300 : 300, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                onDragEnd={handleSwipeEnd}
                className="h-full px-10 py-2"
              >
                <BestQuestionCard
                  data={bestQuestions[currentIndex]}
                  rank={currentIndex + 1}
                />
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </div>

      {/* 하단 인디케이터 */}
      {total > 0 && (
        <div className="flex justify-center gap-1 py-3 pb-6">
          {bestQuestions.map((_, idx) => (
            <button
              key={idx}
              onClick={() => navigate(idx)}
              className={`h-1.5 rounded-full transition-all ${
                idx === currentIndex ? 'bg-[#1A1A1A] w-4' : 'bg-[#CCCCCC] w-1.5'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
