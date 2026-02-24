'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Header, Button, Skeleton } from '@/components/common';
import { PublishToggle, QuizDeleteModal } from '@/components/professor';
import {
  useProfessorQuiz,
  type ProfessorQuiz,
  type QuizStatistics,
  type QuestionStats,
  type QuizQuestion,
} from '@/lib/hooks/useProfessorQuiz';
import { useCourse } from '@/lib/contexts';
import { formatChapterLabel } from '@/lib/courseIndex';

// ============================================================
// 타입 정의
// ============================================================

/** 반별 색상 */
const CLASS_COLORS: Record<string, string> = {
  A: 'bg-red-100 text-red-700',
  B: 'bg-amber-100 text-amber-700',
  C: 'bg-emerald-100 text-emerald-700',
  D: 'bg-blue-100 text-blue-700',
  all: 'bg-purple-100 text-purple-700',
};

/** 난이도 설정 */
const DIFFICULTY_CONFIG: Record<string, { label: string; color: string }> = {
  easy: { label: '쉬움', color: 'bg-green-100 text-green-700' },
  normal: { label: '보통', color: 'bg-yellow-100 text-yellow-700' },
  hard: { label: '어려움', color: 'bg-red-100 text-red-700' },
};

/** 선지 라벨 */
const CHOICE_LABELS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

// ============================================================
// 문제별 분석 컴포넌트
// ============================================================

interface QuestionAnalysisProps {
  question: QuizQuestion;
  questionIndex: number;
  stats: QuestionStats | undefined;
  totalQuestions: number;
  courseId?: string;
  onPrev: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
}

function QuestionAnalysis({
  question,
  questionIndex,
  stats,
  totalQuestions,
  courseId,
  onPrev,
  onNext,
  onSelect,
}: QuestionAnalysisProps) {
  const [showAllWrongAnswers, setShowAllWrongAnswers] = useState(false);

  // 결합형 문제의 하위 문제들 가져오기
  const subQuestions = (question as any).subQuestions as QuizQuestion[] | undefined;
  const commonPassage = (question as any).commonPassage as string | undefined;
  const commonImage = (question as any).commonImage as string | undefined;
  const passageFormat = (question as any).passageFormat as string | undefined;
  const passageMixedExamples = (question as any).passageMixedExamples as any[] | undefined;

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      {/* 헤더: 문제 번호 선택 + 이전/다음 버튼 */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onPrev}
          disabled={questionIndex === 0}
          className={`p-2 rounded-lg transition-colors ${
            questionIndex === 0
              ? 'text-gray-300 cursor-not-allowed'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* 문제 번호 드롭다운 */}
        <div className="relative">
          <select
            value={questionIndex}
            onChange={(e) => onSelect(Number(e.target.value))}
            className="appearance-none bg-indigo-50 text-indigo-700 font-bold px-4 py-2 pr-8 rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            {Array.from({ length: totalQuestions }, (_, i) => (
              <option key={i} value={i}>
                Q{i + 1}
              </option>
            ))}
          </select>
          <svg
            className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-500 pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        <button
          type="button"
          onClick={onNext}
          disabled={questionIndex === totalQuestions - 1}
          className={`p-2 rounded-lg transition-colors ${
            questionIndex === totalQuestions - 1
              ? 'text-gray-300 cursor-not-allowed'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* 문제 유형 뱃지 */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`
            px-2.5 py-1 rounded-full text-xs font-medium
            ${
              question.type === 'ox'
                ? 'bg-blue-100 text-blue-700'
                : question.type === 'multiple'
                  ? 'bg-purple-100 text-purple-700'
                  : question.type === 'combined'
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-green-100 text-green-700'
            }
          `}
        >
          {question.type === 'ox'
            ? 'OX'
            : question.type === 'multiple'
              ? '객관식'
              : question.type === 'combined'
                ? '결합형'
                : question.type === 'essay'
                  ? '서술형'
                  : '주관식'}
        </span>
        {courseId && question.chapterId && (
          <span className="px-1.5 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-xs font-medium rounded">
            {formatChapterLabel(courseId, question.chapterId, question.chapterDetailId)}
          </span>
        )}
        {stats && stats.totalResponses > 0 && (
          <span className="text-xs text-gray-500">
            응답 {stats.totalResponses}명
          </span>
        )}
      </div>

      {/* 결합형 문제 */}
      {question.type === 'combined' && subQuestions ? (
        <div className="space-y-4">
          {/* 공통 문제 */}
          <div className="text-gray-800 font-medium">{question.text}</div>

          {/* 공통 지문 */}
          {commonPassage && (
            <div className={`p-3 rounded-lg ${passageFormat === 'labeled' ? 'bg-amber-50' : 'bg-gray-50'}`}>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{commonPassage}</p>
            </div>
          )}

          {/* 공통 이미지 */}
          {commonImage && (
            <div className="rounded-lg overflow-hidden">
              <img src={commonImage} alt="공통 이미지" className="w-full object-contain max-h-48" />
            </div>
          )}

          {/* 공통 지문 - 혼합 형식 */}
          {passageFormat === 'mixed' && passageMixedExamples && passageMixedExamples.length > 0 && (
            <div className="space-y-2">
              {passageMixedExamples.map((block: any) => (
                <div key={block.id}>
                  {/* 묶음 블록 */}
                  {block.type === 'grouped' && (
                    <div className="p-3 bg-amber-50 rounded-lg border-2 border-amber-200 space-y-1">
                      {(block.children || []).map((child: any) => (
                        <div key={child.id}>
                          {child.type === 'text' && child.content?.trim() && (
                            <p className="text-gray-600 text-sm whitespace-pre-wrap">{child.content}</p>
                          )}
                          {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                            <p key={item.id} className="text-gray-700 text-sm">
                              <span className="font-bold mr-1">{item.label}.</span>
                              {item.content}
                            </p>
                          ))}
                          {child.type === 'image' && child.imageUrl && (
                            <img src={child.imageUrl} alt="보기 이미지" className="max-w-full h-auto rounded" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 텍스트 블록 */}
                  {block.type === 'text' && block.content?.trim() && (
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-gray-700 text-sm whitespace-pre-wrap">{block.content}</p>
                    </div>
                  )}
                  {/* ㄱㄴㄷ 블록 */}
                  {block.type === 'labeled' && (block.items || []).length > 0 && (
                    <div className="p-3 bg-amber-50 rounded-lg space-y-1">
                      {(block.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                        <p key={item.id} className="text-gray-700 text-sm">
                          <span className="font-bold mr-1">{item.label}.</span>
                          {item.content}
                        </p>
                      ))}
                    </div>
                  )}
                  {/* 이미지 블록 */}
                  {block.type === 'image' && block.imageUrl && (
                    <div className="rounded-lg overflow-hidden">
                      <img src={block.imageUrl} alt="보기 이미지" className="max-w-full h-auto" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 하위 문제들 */}
          <div className="space-y-4 mt-4">
            {subQuestions.map((sub, subIdx) => (
              <div key={subIdx} className="p-4 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-bold text-gray-600">Q{questionIndex + 1}-{subIdx + 1}</span>
                  <span
                    className={`
                      px-2 py-0.5 rounded-full text-xs font-medium
                      ${
                        sub.type === 'ox'
                          ? 'bg-blue-100 text-blue-700'
                          : sub.type === 'multiple'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-green-100 text-green-700'
                      }
                    `}
                  >
                    {sub.type === 'ox' ? 'OX' : sub.type === 'multiple' ? '객관식' : '주관식'}
                  </span>
                  {courseId && sub.chapterId && (
                    <span className="px-1.5 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-[10px] font-medium rounded">
                      {formatChapterLabel(courseId, sub.chapterId, sub.chapterDetailId)}
                    </span>
                  )}
                </div>
                <p className="text-gray-800 text-sm mb-2">{sub.text}</p>

                {/* 하위 문제 선지 */}
                {sub.type === 'multiple' && sub.choices && (
                  <div className="space-y-1">
                    {sub.choices.map((choice, i) => (
                      <div
                        key={i}
                        className={`
                          text-xs px-2 py-1 rounded
                          ${
                            sub.answer === i || (Array.isArray(sub.answer) && sub.answer.includes(i))
                              ? 'bg-green-100 text-green-700 font-medium'
                              : 'text-gray-600'
                          }
                        `}
                      >
                        {CHOICE_LABELS[i]} {choice}
                        {(sub.answer === i || (Array.isArray(sub.answer) && sub.answer.includes(i))) && ' ✓'}
                      </div>
                    ))}
                  </div>
                )}

                {/* 하위 문제 정답 (OX/단답형) */}
                {sub.type === 'ox' && (
                  <p className="text-xs text-green-600 font-medium">
                    정답: {sub.answer === 0 ? 'O' : 'X'}
                  </p>
                )}
                {(sub.type === 'short_answer' || sub.type === 'subjective') && (
                  <p className="text-xs text-green-600 font-medium">
                    정답: {String(sub.answer).replace(/\|\|\|/g, ', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* 일반 문제 텍스트 */}
          <p className="text-gray-800 font-medium mb-4">{question.text}</p>

          {/* 삽입된 이미지 */}
          {(question as any).image && (
            <div className="mb-4 rounded-lg overflow-hidden">
              <img src={(question as any).image} alt="문제 이미지" className="w-full object-contain max-h-48" />
            </div>
          )}

          {/* OX 문제 통계 */}
          {question.type === 'ox' && stats?.choiceStats && (
            <div className="space-y-2 mb-4">
              {[
                { label: 'O', index: 0 },
                { label: 'X', index: 1 },
              ].map(({ label, index }) => {
                const choiceStat = stats.choiceStats?.find(c => c.choice === index);
                const percentage = choiceStat?.percentage || 0;
                const isCorrect = question.answer === index;

                return (
                  <div key={label} className="flex items-center gap-3">
                    <span className={`w-8 text-center font-bold ${isCorrect ? 'text-green-600' : 'text-gray-600'}`}>
                      {label}
                    </span>
                    <div className="flex-1 h-8 bg-gray-100 rounded-lg overflow-hidden relative">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${percentage}%` }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                        className={`h-full ${isCorrect ? 'bg-green-400' : 'bg-gray-300'}`}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-sm font-medium text-gray-700">
                        {percentage}%
                      </span>
                    </div>
                    {isCorrect && (
                      <span className="text-green-500 text-sm">✓ 정답</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 객관식 문제 통계 */}
          {question.type === 'multiple' && question.choices && (
            <div className="space-y-2 mb-4">
              {question.choices.map((choice, i) => {
                const choiceStat = stats?.choiceStats?.find(c => c.choice === i);
                const percentage = choiceStat?.percentage || 0;
                const correctAnswer = question.answer;
                const isCorrect = Array.isArray(correctAnswer)
                  ? correctAnswer.includes(i)
                  : correctAnswer === i;

                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className={`w-6 text-center font-bold text-sm ${isCorrect ? 'text-green-600' : 'text-gray-500'}`}>
                      {CHOICE_LABELS[i]}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-sm ${isCorrect ? 'text-green-700 font-medium' : 'text-gray-700'}`}>
                          {choice}
                        </span>
                        {isCorrect && <span className="text-green-500 text-xs">✓</span>}
                      </div>
                      <div className="h-6 bg-gray-100 rounded-lg overflow-hidden relative">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${percentage}%` }}
                          transition={{ duration: 0.5, ease: 'easeOut' }}
                          className={`h-full ${isCorrect ? 'bg-green-400' : 'bg-gray-300'}`}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700">
                          {percentage}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 주관식/단답형 문제 */}
          {(question.type === 'short_answer' || question.type === 'subjective') && (
            <div className="space-y-3">
              {/* 정답 */}
              <div className="p-3 bg-green-50 rounded-lg">
                <p className="text-xs text-green-600 font-medium mb-1">정답</p>
                <p className="text-green-800">
                  {String(question.answer).replace(/\|\|\|/g, ', ')}
                </p>
              </div>

              {/* 오답 목록 */}
              {stats?.wrongAnswers && stats.wrongAnswers.length > 0 && (
                <div className="p-3 bg-red-50 rounded-lg">
                  <p className="text-xs text-red-600 font-medium mb-1">
                    오답 ({stats.wrongAnswers.length}개)
                  </p>
                  <div className="text-red-800 text-sm">
                    {(() => {
                      const answers = stats.wrongAnswers || [];
                      const displayAnswers = showAllWrongAnswers ? answers : answers.slice(0, 5);
                      const hasMore = answers.length > 5;

                      return (
                        <>
                          <p>{displayAnswers.join(', ')}</p>
                          {hasMore && !showAllWrongAnswers && (
                            <button
                              type="button"
                              onClick={() => setShowAllWrongAnswers(true)}
                              className="text-red-500 text-xs mt-1 hover:underline"
                            >
                              ...더보기 ({answers.length - 5}개 더)
                            </button>
                          )}
                          {showAllWrongAnswers && hasMore && (
                            <button
                              type="button"
                              onClick={() => setShowAllWrongAnswers(false)}
                              className="text-red-500 text-xs mt-1 hover:underline"
                            >
                              접기
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 서술형 문제 — 정답 없음, 루브릭/해설만 표시 */}
          {question.type === 'essay' && (
            <div className="space-y-3">
              {/* 루브릭 */}
              {question.rubric && question.rubric.length > 0 && question.rubric.some((r: any) => r.criteria?.trim()) && (
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-xs text-blue-600 font-medium mb-1">평가 기준</p>
                  <ul className="space-y-1 text-sm text-blue-800">
                    {question.rubric.filter((r: any) => r.criteria?.trim()).map((r: any, idx: number) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="font-bold shrink-0">·</span>
                        <span>
                          {r.criteria}
                          {r.percentage > 0 && <span className="opacity-70 font-bold"> ({r.percentage}%)</span>}
                          {r.description && <span className="opacity-70"> — {r.description}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {/* 해설 */}
              {question.explanation && (
                <div className="p-3 bg-yellow-50 rounded-lg">
                  <p className="text-xs text-yellow-700 font-medium mb-1">해설</p>
                  <p className="text-sm text-yellow-800">{question.explanation}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 정답률/오답률 표시 */}
      {stats && stats.totalResponses > 0 && question.type !== 'combined' && (
        <div className="mt-4 pt-4 border-t border-gray-100 flex justify-center gap-8">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1">
              {stats.isModified && (
                <span
                  className="w-6 h-6 flex items-center justify-center bg-amber-500 text-white text-sm font-bold rounded-full"
                  title="수정된 문제 (수정 이후 데이터만 표시)"
                >
                  !
                </span>
              )}
              <p className="text-2xl font-bold text-green-600">{stats.correctRate}%</p>
            </div>
            <p className="text-xs text-gray-500">정답률</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-500">{stats.wrongRate}%</p>
            <p className="text-xs text-gray-500">오답률</p>
          </div>
        </div>
      )}

      {/* 해설 */}
      {question.explanation && (
        <div className="mt-4 p-3 bg-amber-50 rounded-lg">
          <p className="text-xs text-amber-600 font-medium mb-1">해설</p>
          <p className="text-amber-800 text-sm">{question.explanation}</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 메인 컴포넌트
// ============================================================

/**
 * 퀴즈 상세/미리보기 페이지
 *
 * 퀴즈의 상세 정보와 문제 목록을 미리볼 수 있습니다.
 * 통계 정보, 공개 상태 토글, 수정/삭제 기능을 제공합니다.
 */
export default function QuizDetailPage() {
  const router = useRouter();
  const params = useParams();
  const quizId = params.id as string;

  const { fetchQuiz, fetchQuizStatistics, togglePublish, deleteQuiz } = useProfessorQuiz();
  const { userCourseId } = useCourse();

  const [quiz, setQuiz] = useState<ProfessorQuiz | null>(null);
  const [statistics, setStatistics] = useState<QuizStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 삭제 모달 상태
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // 문제별 분석 상태
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [showAnalysis, setShowAnalysis] = useState(false);

  // 데이터 로드
  useEffect(() => {
    const loadQuiz = async () => {
      try {
        setLoading(true);
        const data = await fetchQuiz(quizId);
        if (data) {
          setQuiz(data);

          // 통계 로드
          setStatsLoading(true);
          const stats = await fetchQuizStatistics(quizId, data.questions);
          setStatistics(stats);
          setStatsLoading(false);
        } else {
          setError('퀴즈를 찾을 수 없습니다.');
        }
      } catch (err) {
        setError('퀴즈를 불러오는데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    };

    if (quizId) {
      loadQuiz();
    }
  }, [quizId, fetchQuiz, fetchQuizStatistics]);

  // 공개 상태 토글
  const handleTogglePublish = useCallback(
    async (isPublished: boolean) => {
      if (!quiz) return;

      try {
        await togglePublish(quiz.id, isPublished);
        setQuiz((prev) => (prev ? { ...prev, isPublished } : null));
      } catch (err) {
        console.error('공개 상태 변경 실패:', err);
      }
    },
    [quiz, togglePublish]
  );

  // 수정 페이지로 이동
  const handleEdit = useCallback(() => {
    router.push(`/professor/quiz/${quizId}/edit`);
  }, [router, quizId]);

  // 삭제 확인
  const handleDeleteConfirm = useCallback(async () => {
    if (!quiz) return;

    try {
      setDeleteLoading(true);
      await deleteQuiz(quiz.id);
      router.replace('/professor/quiz');
    } catch (err) {
      console.error('퀴즈 삭제 실패:', err);
    } finally {
      setDeleteLoading(false);
    }
  }, [quiz, deleteQuiz, router]);

  // 문제 탐색
  const handlePrevQuestion = useCallback(() => {
    setCurrentQuestionIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNextQuestion = useCallback(() => {
    if (!quiz) return;
    setCurrentQuestionIndex((prev) => Math.min(quiz.questions.length - 1, prev + 1));
  }, [quiz]);

  const handleSelectQuestion = useCallback((index: number) => {
    setCurrentQuestionIndex(index);
  }, []);

  // 로딩 상태
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="퀴즈 상세" showBack />
        <div className="p-4 space-y-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </div>
    );
  }

  // 에러 상태
  if (error || !quiz) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="퀴즈 상세" showBack />
        <div className="flex flex-col items-center justify-center h-[60vh] px-4">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-red-500"
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
          <h2 className="text-lg font-bold text-gray-800 mb-2">
            {error || '퀴즈를 찾을 수 없습니다'}
          </h2>
          <Button onClick={() => router.back()}>돌아가기</Button>
        </div>
      </div>
    );
  }

  const classColor = CLASS_COLORS[quiz.targetClass] || CLASS_COLORS.all;
  const difficultyConfig = DIFFICULTY_CONFIG[quiz.difficulty] || DIFFICULTY_CONFIG.normal;

  // 오답률 상위 3개
  const topWrongRates = statistics?.wrongRateRanking.slice(0, 3) || [];

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* 헤더 */}
      <Header
        title="퀴즈 상세"
        showBack
        rightAction={
          <button
            type="button"
            onClick={handleEdit}
            className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
        }
      />

      <main className="p-4 space-y-4">
        {/* 퀴즈 정보 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-5 shadow-sm"
        >
          <h1 className="text-xl font-bold text-gray-800 mb-2">{quiz.title}</h1>
          {quiz.description && (
            <p className="text-gray-600 text-sm mb-4">{quiz.description}</p>
          )}

          {/* 뱃지 */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${classColor}`}>
              {quiz.targetClass === 'all' ? '전체' : `${quiz.targetClass}반`}
            </span>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              {quiz.questionCount}문제
            </span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${difficultyConfig.color}`}>
              {difficultyConfig.label}
            </span>
          </div>

          {/* 공개 상태 토글 */}
          <PublishToggle
            isPublished={quiz.isPublished}
            onChange={handleTogglePublish}
            participantCount={quiz.participantCount}
          />
        </motion.div>

        {/* 통계 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-5 shadow-sm"
        >
          <h2 className="text-lg font-bold text-gray-800 mb-4">통계</h2>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-indigo-600">{quiz.participantCount}</p>
              <p className="text-xs text-gray-500">참여자</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">
                {quiz.participantCount > 0 ? Math.round(quiz.averageScore) : '-'}
              </p>
              <p className="text-xs text-gray-500">평균 점수</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600">{quiz.feedbackCount}</p>
              <p className="text-xs text-gray-500">피드백</p>
            </div>
          </div>

          {/* 오답률 상위 3개 */}
          {topWrongRates.length > 0 && (
            <div className="pt-4 border-t border-gray-100">
              <p className="text-sm font-medium text-gray-700 mb-3">오답률 TOP 3</p>
              <div className="flex gap-2">
                {topWrongRates.map((item, rank) => {
                  const medals = ['🥇', '🥈', '🥉'];
                  const bgColors = ['bg-yellow-50', 'bg-gray-50', 'bg-orange-50'];
                  const borderColors = ['border-yellow-300', 'border-gray-300', 'border-orange-300'];

                  return (
                    <button
                      key={item.questionIndex}
                      type="button"
                      onClick={() => {
                        setCurrentQuestionIndex(item.questionIndex);
                        setShowAnalysis(true);
                      }}
                      className={`flex-1 p-3 rounded-xl border ${bgColors[rank]} ${borderColors[rank]} hover:opacity-80 transition-opacity`}
                    >
                      <div className="text-center">
                        <span className="text-lg">{medals[rank]}</span>
                        <p className="text-sm font-bold text-gray-800 mt-1">Q{item.questionIndex + 1}</p>
                        <p className="text-xs text-red-500 font-medium">{item.wrongRate}%</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {statsLoading && (
            <div className="pt-4 border-t border-gray-100">
              <Skeleton className="h-20 rounded-xl" />
            </div>
          )}
        </motion.div>

        {/* 문제별 분석 토글 버튼 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <button
            type="button"
            onClick={() => setShowAnalysis(!showAnalysis)}
            className="w-full bg-white rounded-2xl p-4 shadow-sm flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <span className="font-bold text-gray-800">문제별 분석</span>
            <motion.svg
              animate={{ rotate: showAnalysis ? 180 : 0 }}
              className="w-5 h-5 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </motion.svg>
          </button>
        </motion.div>

        {/* 문제별 분석 섹션 */}
        <AnimatePresence>
          {showAnalysis && quiz.questions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
            >
              <QuestionAnalysis
                question={quiz.questions[currentQuestionIndex]}
                questionIndex={currentQuestionIndex}
                stats={statistics?.questionStats[currentQuestionIndex]}
                totalQuestions={quiz.questions.length}
                courseId={userCourseId || quiz.courseId}
                onPrev={handlePrevQuestion}
                onNext={handleNextQuestion}
                onSelect={handleSelectQuestion}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* 문제 미리보기 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl p-5 shadow-sm"
        >
          <h2 className="text-lg font-bold text-gray-800 mb-4">
            문제 미리보기
            <span className="ml-2 text-sm font-normal text-gray-500">
              ({quiz.questions.length}개)
            </span>
          </h2>

          <div className="space-y-3">
            {quiz.questions.map((question, index) => (
              <div
                key={question.id}
                className="p-4 bg-gray-50 rounded-xl"
              >
                {/* 문제 헤더 */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-bold">
                    {index + 1}
                  </span>
                  <span
                    className={`
                      px-2 py-0.5 rounded-full text-xs font-medium
                      ${
                        question.type === 'ox'
                          ? 'bg-blue-100 text-blue-700'
                          : question.type === 'multiple'
                            ? 'bg-purple-100 text-purple-700'
                            : question.type === 'combined'
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-green-100 text-green-700'
                      }
                    `}
                  >
                    {question.type === 'ox'
                      ? 'OX'
                      : question.type === 'multiple'
                        ? '객관식'
                        : question.type === 'combined'
                          ? '결합형'
                          : question.type === 'essay'
                            ? '서술형'
                            : '주관식'}
                  </span>

                  {/* 오답률 표시 */}
                  {statistics?.questionStats[index] && statistics.questionStats[index].totalResponses > 0 && (
                    <span className={`ml-auto text-xs font-medium flex items-center gap-1 ${
                      statistics.questionStats[index].wrongRate >= 50
                        ? 'text-red-500'
                        : statistics.questionStats[index].wrongRate >= 30
                          ? 'text-amber-500'
                          : 'text-green-500'
                    }`}>
                      {statistics.questionStats[index].isModified && (
                        <span
                          className="w-4 h-4 flex items-center justify-center bg-amber-500 text-white text-[10px] font-bold rounded-full"
                          title="수정된 문제"
                        >
                          !
                        </span>
                      )}
                      오답 {statistics.questionStats[index].wrongRate}%
                    </span>
                  )}
                </div>

                {/* 문제 텍스트 */}
                <p className="text-gray-800 text-sm">{question.text}</p>

                {/* 선지 (객관식) */}
                {question.type === 'multiple' && question.choices && (
                  <div className="mt-2 space-y-1">
                    {question.choices.map((choice, i) => {
                      const correctAnswer = question.answer;
                      const isCorrect = Array.isArray(correctAnswer)
                        ? correctAnswer.includes(i)
                        : correctAnswer === i;

                      return (
                        <div
                          key={i}
                          className={`
                            text-xs px-2 py-1 rounded
                            ${isCorrect ? 'bg-green-100 text-green-700 font-medium' : 'text-gray-600'}
                          `}
                        >
                          {CHOICE_LABELS[i]} {choice}
                          {isCorrect && ' ✓'}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 정답 (OX) */}
                {question.type === 'ox' && (
                  <p className="mt-2 text-xs text-green-600 font-medium">
                    정답: {question.answer === 0 ? 'O' : 'X'}
                  </p>
                )}

                {/* 정답 (주관식/단답형) */}
                {(question.type === 'subjective' || question.type === 'short_answer') && (
                  <p className="mt-2 text-xs text-green-600 font-medium">
                    정답: {String(question.answer).replace(/\|\|\|/g, ', ')}
                  </p>
                )}

                {/* 결합형 하위 문제 수 */}
                {question.type === 'combined' && (question as any).subQuestions && (
                  <p className="mt-2 text-xs text-orange-600 font-medium">
                    하위 문제 {(question as any).subQuestions.length}개
                  </p>
                )}

                {/* 해설 */}
                {question.explanation && (
                  <p className="mt-2 text-xs text-gray-500 bg-white p-2 rounded">
                    💡 {question.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </motion.div>

        {/* 삭제 버튼 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="w-full py-3 text-red-500 text-sm font-medium hover:bg-red-50 rounded-xl transition-colors"
          >
            퀴즈 삭제
          </button>
        </motion.div>
      </main>

      {/* 삭제 확인 모달 */}
      <QuizDeleteModal
        quiz={showDeleteModal ? quiz : null}
        loading={deleteLoading}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  );
}
