/**
 * 퀴즈 통계 모달
 *
 * 학생이 만든 퀴즈의 참여자 통계를 표시합니다.
 * - 참여자 수, 평균 점수
 * - 문제별 정답률 바 차트
 * - 객관식 오답 선지 분포
 * - 점수 분포 히스토그램
 * - 반별 필터링 (전체/A/B/C/D)
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
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

interface QuestionStats {
  questionId: string;
  questionText: string;
  questionType: string;
  correctRate: number;
  totalAttempts: number;
  correctCount: number;
  // 객관식: 선지별 선택 횟수
  optionDistribution?: { option: string; count: number; isCorrect: boolean }[];
}

interface QuizStats {
  participantCount: number;
  averageScore: number;
  scoreDistribution: { range: string; count: number }[];
  questionStats: QuestionStats[];
}

interface ResultWithClass {
  userId: string;
  classType: 'A' | 'B' | 'C' | 'D' | null;
  score: number;
  questionScores: Record<string, any>;
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

  // 원본 데이터
  const [questions, setQuestions] = useState<any[]>([]);
  const [resultsWithClass, setResultsWithClass] = useState<ResultWithClass[]>([]);

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
        setQuestions(quizData.questions || []);

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

        // 사용자 정보를 병렬로 가져오기
        await Promise.all(
          userIds.map(async (userId) => {
            try {
              const userDoc = await getDoc(doc(db, 'users', userId));
              if (userDoc.exists()) {
                userClassMap.set(userId, userDoc.data().classId || null); // Firestore 필드명은 classId
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
        scoreDistribution: [],
        questionStats: questions.map((q: any) => ({
          questionId: q.id,
          questionText: q.text || '',
          questionType: q.type || 'multiple',
          correctRate: 0,
          totalAttempts: 0,
          correctCount: 0,
        })),
      };
    }

    // 통계 계산
    const scores: number[] = [];
    const questionCorrectCounts: Record<string, number> = {};
    const questionAttemptCounts: Record<string, number> = {};
    const optionSelections: Record<string, Record<string, number>> = {};

    filteredResults.forEach((result) => {
      scores.push(result.score);

      // 문제별 점수 분석
      Object.entries(result.questionScores).forEach(
        ([questionId, scoreData]: [string, any]) => {
          if (!questionCorrectCounts[questionId]) {
            questionCorrectCounts[questionId] = 0;
            questionAttemptCounts[questionId] = 0;
          }
          questionAttemptCounts[questionId]++;
          if (scoreData.isCorrect) {
            questionCorrectCounts[questionId]++;
          }

          // 객관식 선지 분포
          const question = questions.find((q: any) => q.id === questionId);
          if (question?.type === 'multiple' && scoreData.userAnswer) {
            if (!optionSelections[questionId]) {
              optionSelections[questionId] = {};
            }
            const userAnswer = scoreData.userAnswer.toString();
            optionSelections[questionId][userAnswer] =
              (optionSelections[questionId][userAnswer] || 0) + 1;
          }
        }
      );
    });

    // 평균 점수
    const averageScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;

    // 점수 분포 (10점 단위)
    const scoreRanges = [
      '0-9',
      '10-19',
      '20-29',
      '30-39',
      '40-49',
      '50-59',
      '60-69',
      '70-79',
      '80-89',
      '90-100',
    ];
    const scoreDistribution = scoreRanges.map((range) => {
      const [min, max] = range.split('-').map(Number);
      const count = scores.filter((s) => s >= min && s <= max).length;
      return { range, count };
    });

    // 문제별 통계
    const questionStats: QuestionStats[] = questions.map((q: any) => {
      const attempts = questionAttemptCounts[q.id] || 0;
      const correct = questionCorrectCounts[q.id] || 0;
      const correctRate =
        attempts > 0 ? Math.round((correct / attempts) * 100) : 0;

      // 객관식 선지 분포
      let optionDistribution: QuestionStats['optionDistribution'];
      if (q.type === 'multiple' && q.choices) {
        const selections = optionSelections[q.id] || {};
        const correctAnswer = q.answer?.toString() || '';

        optionDistribution = q.choices.map((choice: string, idx: number) => {
          const optionNum = (idx + 1).toString();
          const isCorrect =
            correctAnswer.includes(optionNum) || correctAnswer === optionNum;
          return {
            option: `${idx + 1}. ${choice}`,
            count: selections[optionNum] || 0,
            isCorrect,
          };
        });
      }

      return {
        questionId: q.id,
        questionText: q.text || '',
        questionType: q.type || 'multiple',
        correctRate,
        totalAttempts: attempts,
        correctCount: correct,
        optionDistribution,
      };
    });

    return {
      participantCount: scores.length,
      averageScore,
      scoreDistribution,
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

  if (!isOpen) return null;

  return (
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
        <div className="p-4 border-b border-[#1A1A1A] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#1A1A1A]">퀴즈 통계</h2>
            <p className="text-xs text-[#5C5C5C]">{quizTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center border border-[#1A1A1A] hover:bg-[#EDEAE4]"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 반별 필터 탭 */}
        <div className="flex border-b border-[#1A1A1A]">
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
            <div className="space-y-6">
              {/* 요약 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 border border-[#1A1A1A] bg-[#EDEAE4] text-center">
                  <p className="text-xs text-[#5C5C5C]">참여자</p>
                  <p className="text-2xl font-bold text-[#1A1A1A]">
                    {stats.participantCount}명
                  </p>
                </div>
                <div className="p-3 border border-[#1A1A1A] bg-[#EDEAE4] text-center">
                  <p className="text-xs text-[#5C5C5C]">평균 점수</p>
                  <p className="text-2xl font-bold text-[#1A1A1A]">
                    {stats.averageScore}점
                  </p>
                </div>
              </div>

              {/* 점수 분포 */}
              {stats.participantCount > 0 && (
                <div>
                  <h3 className="font-bold text-sm text-[#1A1A1A] mb-2">
                    점수 분포
                  </h3>
                  <div className="flex items-end gap-1 h-24 border border-[#1A1A1A] bg-[#EDEAE4] p-2">
                    {stats.scoreDistribution.map((item, idx) => {
                      const maxCount = Math.max(
                        ...stats.scoreDistribution.map((d) => d.count)
                      );
                      const height =
                        maxCount > 0 ? (item.count / maxCount) * 100 : 0;
                      return (
                        <div
                          key={idx}
                          className="flex-1 flex flex-col items-center justify-end"
                        >
                          <div
                            className="w-full bg-[#1A1A1A]"
                            style={{
                              height: `${height}%`,
                              minHeight: item.count > 0 ? 4 : 0,
                            }}
                          />
                          <span className="text-[8px] text-[#5C5C5C] mt-1">
                            {item.range.split('-')[0]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 문제별 정답률 */}
              <div>
                <h3 className="font-bold text-sm text-[#1A1A1A] mb-2">
                  문제별 정답률
                </h3>
                <div className="space-y-2">
                  {stats.questionStats.map((q, idx) => (
                    <div key={q.questionId} className="border border-[#1A1A1A] p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-[#1A1A1A]">
                          Q{idx + 1}
                        </span>
                        <span
                          className={`text-xs font-bold ${
                            q.correctRate >= 70
                              ? 'text-[#1A6B1A]'
                              : q.correctRate >= 40
                                ? 'text-[#8B6914]'
                                : 'text-[#8B1A1A]'
                          }`}
                        >
                          {q.correctRate}%
                        </span>
                      </div>
                      <p className="text-xs text-[#5C5C5C] line-clamp-1 mb-1">
                        {q.questionText}
                      </p>
                      <div className="h-2 bg-[#EDEAE4] border border-[#1A1A1A]">
                        <div
                          className={`h-full ${
                            q.correctRate >= 70
                              ? 'bg-[#1A6B1A]'
                              : q.correctRate >= 40
                                ? 'bg-[#8B6914]'
                                : 'bg-[#8B1A1A]'
                          }`}
                          style={{ width: `${q.correctRate}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-[#5C5C5C] mt-1">
                        {q.correctCount}/{q.totalAttempts} 정답
                      </p>

                      {/* 객관식 선지 분포 */}
                      {q.optionDistribution && q.totalAttempts > 0 && (
                        <div className="mt-2 space-y-1">
                          {q.optionDistribution.map((opt, optIdx) => {
                            const percentage =
                              q.totalAttempts > 0
                                ? Math.round(
                                    (opt.count / q.totalAttempts) * 100
                                  )
                                : 0;
                            return (
                              <div
                                key={optIdx}
                                className="flex items-center gap-2"
                              >
                                <span
                                  className={`text-[10px] w-4 ${
                                    opt.isCorrect
                                      ? 'text-[#1A6B1A] font-bold'
                                      : 'text-[#5C5C5C]'
                                  }`}
                                >
                                  {optIdx + 1}
                                </span>
                                <div className="flex-1 h-1.5 bg-[#EDEAE4] border border-[#1A1A1A]">
                                  <div
                                    className={`h-full ${
                                      opt.isCorrect
                                        ? 'bg-[#1A6B1A]'
                                        : 'bg-[#8B1A1A]'
                                    }`}
                                    style={{ width: `${percentage}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-[#5C5C5C] w-8 text-right">
                                  {percentage}%
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
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
  );
}
