/**
 * 퀴즈 통계 모달
 *
 * 학생이 만든 퀴즈의 참여자 통계를 표시합니다.
 * - 참여자 수, 평균 점수
 * - 문제별 정답률 (아코디언 형태)
 * - OX/객관식 선지별 선택률
 * - 주관식 오답 목록
 * - 반별 필터링 (전체/A/B/C/D)
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ============================================================
// 타입 정의
// ============================================================

interface QuizStatsModalProps {
  quizId: string;
  quizTitle: string;
  isOpen: boolean;
  onClose: () => void;
}

interface FlattenedQuestion {
  id: string;
  text: string;
  type: 'ox' | 'multiple' | 'short_answer' | 'short' | 'essay';
  choices?: string[];
  answer?: string;
  // 결합형 그룹 정보
  combinedGroupId?: string;
  combinedIndex?: number;
  combinedTotal?: number;
  // 공통 지문 정보 (첫 번째 하위 문제에만)
  passage?: string;
  passageType?: string;
}

interface QuestionStats {
  questionId: string;
  questionText: string;
  questionType: string;
  correctRate: number;
  totalAttempts: number;
  correctCount: number;
  correctAnswer?: string;
  // OX 선택 분포
  oxDistribution?: { o: number; x: number };
  // 객관식 선지별 선택 분포
  optionDistribution?: { option: string; count: number; isCorrect: boolean; percentage: number }[];
  // 주관식 오답 목록
  wrongAnswers?: { answer: string; count: number }[];
  // 결합형 그룹 정보
  combinedGroupId?: string;
  combinedIndex?: number;
  combinedTotal?: number;
}

interface QuizStats {
  participantCount: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  questionStats: QuestionStats[];
}

interface ResultWithClass {
  userId: string;
  classType: 'A' | 'B' | 'C' | 'D' | null;
  score: number;
  questionScores: Record<string, { isCorrect: boolean; userAnswer: string }>;
}

type ClassFilter = 'all' | 'A' | 'B' | 'C' | 'D';

const CLASS_FILTERS: { value: ClassFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'A', label: 'A반' },
  { value: 'B', label: 'B반' },
  { value: 'C', label: 'C반' },
  { value: 'D', label: 'D반' },
];

// ============================================================
// 헬퍼 함수
// ============================================================

/**
 * questions 배열을 펼쳐서 결합형 하위 문제들을 개별 문제로 변환
 */
function flattenQuestions(questions: any[]): FlattenedQuestion[] {
  const result: FlattenedQuestion[] = [];

  questions.forEach((q) => {
    // 이미 펼쳐진 결합형 문제 (combinedGroupId가 있는 경우)
    if (q.combinedGroupId) {
      result.push({
        id: q.id,
        text: q.text || '',
        type: q.type,
        choices: q.choices,
        answer: q.answer?.toString(),
        combinedGroupId: q.combinedGroupId,
        combinedIndex: q.combinedIndex,
        combinedTotal: q.combinedTotal,
        passage: q.combinedIndex === 0 ? q.passage : undefined,
        passageType: q.combinedIndex === 0 ? q.passageType : undefined,
      });
    }
    // 레거시 결합형 문제 (type === 'combined' + subQuestions)
    else if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
      const groupId = `legacy_${q.id}`;
      q.subQuestions.forEach((sq: any, idx: number) => {
        result.push({
          id: sq.id || `${q.id}_sub${idx}`,
          text: sq.text || '',
          type: sq.type || 'short_answer',
          choices: sq.choices,
          answer: sq.answerIndices?.length > 0
            ? sq.answerIndices.map((i: number) => i + 1).join(',')
            : sq.answerIndex !== undefined
              ? (sq.answerIndex + 1).toString()
              : sq.answerText,
          combinedGroupId: groupId,
          combinedIndex: idx,
          combinedTotal: q.subQuestions.length,
          passage: idx === 0 ? q.passage : undefined,
          passageType: idx === 0 ? q.passageType : undefined,
        });
      });
    }
    // 일반 문제
    else {
      result.push({
        id: q.id,
        text: q.text || '',
        type: q.type,
        choices: q.choices,
        answer: q.answer?.toString(),
      });
    }
  });

  return result;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 퀴즈 통계 모달
 */
export default function QuizStatsModal({
  quizId,
  quizTitle,
  isOpen,
  onClose,
}: QuizStatsModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [wrongAnswersModal, setWrongAnswersModal] = useState<{ questionId: string; answers: { answer: string; count: number }[] } | null>(null);

  // 원본 데이터
  const [questions, setQuestions] = useState<FlattenedQuestion[]>([]);
  const [resultsWithClass, setResultsWithClass] = useState<ResultWithClass[]>([]);

  // 모달이 열릴 때 네비게이션 숨김
  useEffect(() => {
    if (isOpen) {
      document.body.setAttribute('data-hide-nav', 'true');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. 퀴즈 데이터 가져오기
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (!quizDoc.exists()) {
          setError('퀴즈를 찾을 수 없습니다.');
          return;
        }

        const quizData = quizDoc.data();
        const flatQuestions = flattenQuestions(quizData.questions || []);
        setQuestions(flatQuestions);

        // 2. 퀴즈 결과 가져오기
        const resultsQuery = query(
          collection(db, 'quizResults'),
          where('quizId', '==', quizId)
        );
        const resultsSnapshot = await getDocs(resultsQuery);

        // 첫 번째 결과만 필터링 (isUpdate가 아닌 것)
        const firstResults = resultsSnapshot.docs.filter(
          (doc) => !doc.data().isUpdate
        );

        if (firstResults.length === 0) {
          setResultsWithClass([]);
          setLoading(false);
          return;
        }

        // 3. 사용자별 classType 가져오기
        const userIds = [...new Set(firstResults.map((d) => d.data().userId))];
        const userClassMap = new Map<string, 'A' | 'B' | 'C' | 'D' | null>();

        await Promise.all(
          userIds.map(async (userId) => {
            try {
              const userDoc = await getDoc(doc(db, 'users', userId));
              if (userDoc.exists()) {
                userClassMap.set(userId, userDoc.data().classId || null);
              } else {
                userClassMap.set(userId, null);
              }
            } catch {
              userClassMap.set(userId, null);
            }
          })
        );

        // 4. 결과에 classType 추가
        const results: ResultWithClass[] = firstResults.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            userId: data.userId,
            classType: userClassMap.get(data.userId) || null,
            score: data.score || 0,
            questionScores: data.questionScores || {},
          };
        });

        setResultsWithClass(results);
      } catch (err) {
        console.error('통계 로드 실패:', err);
        setError('통계를 불러오는데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen, quizId]);

  // 필터링된 결과 기반으로 통계 계산
  const stats = useMemo<QuizStats | null>(() => {
    if (questions.length === 0) return null;

    // 반별 필터링
    const filteredResults =
      classFilter === 'all'
        ? resultsWithClass
        : resultsWithClass.filter((r) => r.classType === classFilter);

    if (filteredResults.length === 0) {
      return {
        participantCount: 0,
        averageScore: 0,
        highestScore: 0,
        lowestScore: 0,
        questionStats: questions.map((q, idx) => ({
          questionId: `${q.id}_${idx}`,
          questionText: q.text || '',
          questionType: q.type || 'multiple',
          correctRate: 0,
          totalAttempts: 0,
          correctCount: 0,
          correctAnswer: q.answer,
          combinedGroupId: q.combinedGroupId,
          combinedIndex: q.combinedIndex,
          combinedTotal: q.combinedTotal,
        })),
      };
    }

    // 통계 계산
    const scores: number[] = [];
    const questionCorrectCounts: Record<string, number> = {};
    const questionAttemptCounts: Record<string, number> = {};
    const oxSelections: Record<string, { o: number; x: number }> = {};
    const optionSelections: Record<string, Record<string, number>> = {};
    const shortAnswerResponses: Record<string, Record<string, number>> = {};

    filteredResults.forEach((result) => {
      scores.push(result.score);

      // 문제별 점수 분석
      Object.entries(result.questionScores).forEach(
        ([questionId, scoreData]) => {
          if (!questionCorrectCounts[questionId]) {
            questionCorrectCounts[questionId] = 0;
            questionAttemptCounts[questionId] = 0;
          }
          questionAttemptCounts[questionId]++;
          if (scoreData.isCorrect) {
            questionCorrectCounts[questionId]++;
          }

          const question = questions.find((q) => q.id === questionId);
          if (!question) return;

          // OX 선택 분포
          if (question.type === 'ox') {
            if (!oxSelections[questionId]) {
              oxSelections[questionId] = { o: 0, x: 0 };
            }
            const answer = scoreData.userAnswer?.toString().toUpperCase();
            if (answer === 'O' || answer === '0') {
              oxSelections[questionId].o++;
            } else if (answer === 'X' || answer === '1') {
              oxSelections[questionId].x++;
            }
          }

          // 객관식 선지 분포
          if (question.type === 'multiple' && scoreData.userAnswer) {
            if (!optionSelections[questionId]) {
              optionSelections[questionId] = {};
            }
            // 복수 선택 지원
            const answers = scoreData.userAnswer.toString().split(',').map((a: string) => a.trim());
            answers.forEach((ans: string) => {
              optionSelections[questionId][ans] = (optionSelections[questionId][ans] || 0) + 1;
            });
          }

          // 주관식 응답 수집 (오답만)
          if ((question.type === 'short_answer' || question.type === 'short') && !scoreData.isCorrect && scoreData.userAnswer) {
            if (!shortAnswerResponses[questionId]) {
              shortAnswerResponses[questionId] = {};
            }
            const userAnswer = scoreData.userAnswer.toString().trim() || '(미입력)';
            shortAnswerResponses[questionId][userAnswer] = (shortAnswerResponses[questionId][userAnswer] || 0) + 1;
          }
        }
      );
    });

    // 평균/최고/최저 점수
    const averageScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
    const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;

    // 문제별 통계
    const questionStats: QuestionStats[] = questions.map((q, idx) => {
      const attempts = questionAttemptCounts[q.id] || 0;
      const correct = questionCorrectCounts[q.id] || 0;
      const correctRate = attempts > 0 ? Math.round((correct / attempts) * 100) : 0;

      const stat: QuestionStats = {
        questionId: `${q.id}_${idx}`,
        questionText: q.text || '',
        questionType: q.type || 'multiple',
        correctRate,
        totalAttempts: attempts,
        correctCount: correct,
        correctAnswer: q.answer,
        combinedGroupId: q.combinedGroupId,
        combinedIndex: q.combinedIndex,
        combinedTotal: q.combinedTotal,
      };

      // OX 분포
      if (q.type === 'ox' && oxSelections[q.id]) {
        stat.oxDistribution = oxSelections[q.id];
      }

      // 객관식 선지 분포
      if (q.type === 'multiple' && q.choices) {
        const selections = optionSelections[q.id] || {};
        const correctAnswers = q.answer?.split(',').map((a) => a.trim()) || [];

        stat.optionDistribution = q.choices.map((choice, optIdx) => {
          const optionNum = (optIdx + 1).toString();
          const count = selections[optionNum] || 0;
          const percentage = attempts > 0 ? Math.round((count / attempts) * 100) : 0;
          const isCorrect = correctAnswers.includes(optionNum);
          return { option: choice, count, isCorrect, percentage };
        });
      }

      // 주관식 오답 목록
      if ((q.type === 'short_answer' || q.type === 'short') && shortAnswerResponses[q.id]) {
        stat.wrongAnswers = Object.entries(shortAnswerResponses[q.id])
          .map(([answer, count]) => ({ answer, count }))
          .sort((a, b) => b.count - a.count);
      }

      return stat;
    });

    return {
      participantCount: scores.length,
      averageScore,
      highestScore,
      lowestScore,
      questionStats,
    };
  }, [questions, resultsWithClass, classFilter]);

  // 반별 참여자 수 계산
  const classParticipantCounts = useMemo(() => {
    const counts: Record<ClassFilter, number> = {
      all: resultsWithClass.length,
      A: 0,
      B: 0,
      C: 0,
      D: 0,
    };

    resultsWithClass.forEach((r) => {
      if (r.classType && counts[r.classType] !== undefined) {
        counts[r.classType]++;
      }
    });

    return counts;
  }, [resultsWithClass]);

  // 문제 유형 라벨
  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'ox': return 'OX';
      case 'multiple': return '객관식';
      case 'short_answer':
      case 'short': return '단답형';
      case 'essay': return '서술형';
      default: return type;
    }
  };

  // 문제 펼침/접힘 토글
  const toggleQuestion = (questionId: string) => {
    setExpandedQuestionId(prev => prev === questionId ? null : questionId);
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg bg-[#F5F0E8] border-2 border-[#1A1A1A] max-h-[85vh] overflow-hidden flex flex-col"
        >
          {/* 헤더 */}
          <div className="p-4 border-b border-[#1A1A1A] flex items-center justify-between flex-shrink-0">
            <div>
              <h2 className="text-lg font-bold text-[#1A1A1A]">퀴즈 통계</h2>
              <p className="text-xs text-[#5C5C5C]">{quizTitle}</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center border border-[#1A1A1A] hover:bg-[#EDEAE4]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 반별 필터 탭 */}
          <div className="flex border-b border-[#1A1A1A] flex-shrink-0">
            {CLASS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                onClick={() => setClassFilter(filter.value)}
                className={`flex-1 py-2 text-xs font-bold transition-colors ${
                  classFilter === filter.value
                    ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                    : 'bg-[#EDEAE4] text-[#1A1A1A] hover:bg-[#E5E0D8]'
                }`}
              >
                {filter.label}
                <span className="ml-1 text-[10px] opacity-70">
                  ({classParticipantCounts[filter.value]})
                </span>
              </button>
            ))}
          </div>

          {/* 컨텐츠 */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent animate-spin" />
              </div>
            )}

            {error && (
              <div className="text-center py-12">
                <p className="text-[#8B1A1A]">{error}</p>
              </div>
            )}

            {!loading && !error && stats && (
              <div className="space-y-4">
                {/* 요약 카드 */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 border border-[#1A1A1A] bg-[#EDEAE4] text-center">
                    <p className="text-[10px] text-[#5C5C5C]">참여자</p>
                    <p className="text-xl font-bold text-[#1A1A1A]">{stats.participantCount}명</p>
                  </div>
                  <div className="p-3 border border-[#1A1A1A] bg-[#EDEAE4] text-center">
                    <p className="text-[10px] text-[#5C5C5C]">평균 점수</p>
                    <p className="text-xl font-bold text-[#1A1A1A]">{stats.averageScore}점</p>
                  </div>
                </div>

                {stats.participantCount > 0 && (
                  <div className="flex gap-2 text-xs text-[#5C5C5C]">
                    <span>최고: <strong className="text-[#1A6B1A]">{stats.highestScore}점</strong></span>
                    <span>·</span>
                    <span>최저: <strong className="text-[#8B1A1A]">{stats.lowestScore}점</strong></span>
                  </div>
                )}

                {/* 문제별 분석 */}
                <div>
                  <h3 className="font-bold text-sm text-[#1A1A1A] mb-2">문제별 분석</h3>
                  <div className="space-y-2">
                    {stats.questionStats.map((q, idx) => {
                      const isExpanded = expandedQuestionId === q.questionId;
                      const displayNum = q.combinedGroupId && q.combinedIndex !== undefined
                        ? `${idx + 1 - q.combinedIndex}-${q.combinedIndex + 1}`
                        : `${idx + 1}`;

                      return (
                        <div key={q.questionId} className="border border-[#1A1A1A]">
                          {/* 문제 헤더 */}
                          <button
                            onClick={() => toggleQuestion(q.questionId)}
                            className="w-full p-2 flex items-center gap-2 hover:bg-[#EDEAE4] transition-colors"
                          >
                            <span className="text-xs font-bold text-[#1A1A1A] w-8">Q{displayNum}</span>
                            <span className="text-[10px] px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8]">
                              {getTypeLabel(q.questionType)}
                            </span>
                            <div className="flex-1 h-2 bg-[#EDEAE4] border border-[#1A1A1A] mx-1">
                              <div
                                className={`h-full ${
                                  q.correctRate >= 70 ? 'bg-[#1A6B1A]' :
                                  q.correctRate >= 40 ? 'bg-[#8B6914]' : 'bg-[#8B1A1A]'
                                }`}
                                style={{ width: `${q.correctRate}%` }}
                              />
                            </div>
                            <span className={`text-xs font-bold w-10 text-right ${
                              q.correctRate >= 70 ? 'text-[#1A6B1A]' :
                              q.correctRate >= 40 ? 'text-[#8B6914]' : 'text-[#8B1A1A]'
                            }`}>
                              {q.correctRate}%
                            </span>
                            {/* 주관식 오답 버튼 */}
                            {(q.questionType === 'short_answer' || q.questionType === 'short') && q.wrongAnswers && q.wrongAnswers.length > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setWrongAnswersModal({ questionId: q.questionId, answers: q.wrongAnswers! });
                                }}
                                className="text-[10px] px-1.5 py-0.5 bg-[#8B1A1A] text-[#F5F0E8] hover:bg-[#6B1414]"
                              >
                                오답
                              </button>
                            )}
                            <svg
                              className={`w-4 h-4 text-[#5C5C5C] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>

                          {/* 펼쳐진 상세 정보 */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="p-3 bg-[#EDEAE4] border-t border-[#1A1A1A] space-y-2">
                                  {/* 문제 텍스트 */}
                                  <p className="text-xs text-[#1A1A1A] line-clamp-2">{q.questionText}</p>
                                  <p className="text-[10px] text-[#5C5C5C]">
                                    {q.correctCount}/{q.totalAttempts} 정답
                                  </p>

                                  {/* OX 분포 */}
                                  {q.questionType === 'ox' && q.oxDistribution && (
                                    <div className="space-y-1">
                                      {['O', 'X'].map((opt) => {
                                        const count = opt === 'O' ? q.oxDistribution!.o : q.oxDistribution!.x;
                                        const percentage = q.totalAttempts > 0 ? Math.round((count / q.totalAttempts) * 100) : 0;
                                        const isCorrect = q.correctAnswer?.toUpperCase() === opt ||
                                          (q.correctAnswer === '0' && opt === 'O') ||
                                          (q.correctAnswer === '1' && opt === 'X');
                                        return (
                                          <div key={opt} className="flex items-center gap-2">
                                            <span className={`text-xs w-4 font-bold ${isCorrect ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'}`}>
                                              {opt}
                                            </span>
                                            <div className="flex-1 h-3 bg-white border border-[#1A1A1A]">
                                              <div
                                                className={`h-full ${isCorrect ? 'bg-[#1A6B1A]' : 'bg-[#8B1A1A]'}`}
                                                style={{ width: `${percentage}%` }}
                                              />
                                            </div>
                                            <span className="text-[10px] text-[#5C5C5C] w-10 text-right">
                                              {percentage}%
                                            </span>
                                            {isCorrect && <span className="text-[10px] text-[#1A6B1A]">✓</span>}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {/* 객관식 선지 분포 */}
                                  {q.questionType === 'multiple' && q.optionDistribution && (
                                    <div className="space-y-1">
                                      {q.optionDistribution.map((opt, optIdx) => (
                                        <div key={optIdx} className="flex items-center gap-2">
                                          <span className={`text-[10px] w-4 font-bold ${opt.isCorrect ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'}`}>
                                            {optIdx + 1}
                                          </span>
                                          <div className="flex-1 h-3 bg-white border border-[#1A1A1A]">
                                            <div
                                              className={`h-full ${opt.isCorrect ? 'bg-[#1A6B1A]' : opt.percentage > 0 ? 'bg-[#8B1A1A]' : 'bg-transparent'}`}
                                              style={{ width: `${opt.percentage}%` }}
                                            />
                                          </div>
                                          <span className="text-[10px] text-[#5C5C5C] w-10 text-right">
                                            {opt.percentage}%
                                          </span>
                                          {opt.isCorrect && <span className="text-[10px] text-[#1A6B1A]">✓</span>}
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* 주관식 정답 표시 */}
                                  {(q.questionType === 'short_answer' || q.questionType === 'short') && q.correctAnswer && (
                                    <div className="text-xs">
                                      <span className="text-[#5C5C5C]">정답: </span>
                                      <span className="font-bold text-[#1A6B1A]">
                                        {q.correctAnswer.includes('|||')
                                          ? q.correctAnswer.split('|||').map((a: string) => a.trim()).join(', ')
                                          : q.correctAnswer}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 참여자 없음 */}
                {stats.participantCount === 0 && (
                  <div className="text-center py-8">
                    <p className="text-[#5C5C5C]">
                      {classFilter === 'all'
                        ? '아직 참여자가 없습니다.'
                        : `${classFilter}반 참여자가 없습니다.`}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* 주관식 오답 목록 모달 */}
      <AnimatePresence>
        {wrongAnswersModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-end justify-center bg-black/30"
            onClick={() => setWrongAnswersModal(null)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-[#F5F0E8] border-t-2 border-x-2 border-[#1A1A1A] max-h-[60vh] overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b border-[#1A1A1A] flex items-center justify-between">
                <h3 className="font-bold text-[#1A1A1A]">오답 목록</h3>
                <button
                  onClick={() => setWrongAnswersModal(null)}
                  className="text-xs text-[#5C5C5C] hover:text-[#1A1A1A]"
                >
                  닫기
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {wrongAnswersModal.answers.length === 0 ? (
                  <p className="text-[#5C5C5C] text-sm text-center py-4">오답이 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {wrongAnswersModal.answers.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 bg-[#EDEAE4] border border-[#1A1A1A]">
                        <span className="text-sm text-[#1A1A1A]">"{item.answer}"</span>
                        <span className="text-xs text-[#8B1A1A] font-bold">{item.count}명</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
