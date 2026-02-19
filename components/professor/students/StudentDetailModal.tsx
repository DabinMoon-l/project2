'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, getDocs, orderBy, limit, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { StudentDetail, ClassType } from '@/lib/hooks/useProfessorStudents';
import { mean, sd, zScore, percentile } from '@/lib/utils/statistics';

const CLASS_COLORS: Record<ClassType, string> = {
  A: '#8B1A1A', B: '#B8860B', C: '#1D5D4A', D: '#1E3A5F',
};

interface Props {
  student: StudentDetail | null;
  allStudents: { uid: string; classId: ClassType; averageScore: number }[];
  isOpen: boolean;
  onClose: () => void;
}

interface QuizLogEntry {
  quizId: string;
  quizTitle: string;
  source: string;
  chapterId?: string;
  score: number;
  completedAt: Date;
}

export default function StudentDetailModal({ student, allStudents, isOpen, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'academic' | 'activity' | 'log'>('academic');
  const [quizLog, setQuizLog] = useState<QuizLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  // 퀴즈 로그 로드
  const loadQuizLog = useCallback(async (uid: string) => {
    setLogLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'quizResults'), where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(20))
      );
      const entries: QuizLogEntry[] = snap.docs.map(d => {
        const data = d.data();
        return {
          quizId: data.quizId,
          quizTitle: data.quizTitle || '퀴즈',
          source: data.quizType || 'professor',
          chapterId: data.chapterId,
          score: data.score ?? 0,
          completedAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(),
        };
      });
      setQuizLog(entries);
    } catch {
      setQuizLog([]);
    } finally {
      setLogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (student && isOpen) {
      loadQuizLog(student.uid);
    }
  }, [student?.uid, isOpen, loadQuizLog]);

  if (!student || !isOpen) return null;

  // 학업 성취도 계산
  const classMates = allStudents.filter(s => s.classId === student.classId);
  const classScores = classMates.map(s => s.averageScore);
  const classMean = mean(classScores);
  const classSd = sd(classScores);
  const studentZ = zScore(student.quizStats.averageScore, classMean, classSd);
  const studentPercentile = percentile(studentZ);

  // 접속 상태
  const diff = Date.now() - student.lastActiveAt.getTime();
  const statusLabel = diff < 2 * 60000 ? '접속 중' : diff < 5 * 60000 ? '자리 비움' : '오프라인';
  const statusColor = diff < 2 * 60000 ? '#1D5D4A' : diff < 5 * 60000 ? '#B8860B' : '#5C5C5C';

  // 경고
  const warnings: string[] = [];
  if (studentZ < -2.0) warnings.push('Z-score < -2.0 — 위험');
  else if (studentZ < -1.5) warnings.push('Z-score < -1.5 — 주의');

  const TABS = [
    { key: 'academic' as const, label: '학업 성취' },
    { key: 'activity' as const, label: '활동 분포' },
    { key: 'log' as const, label: '퀴즈 로그' },
  ];

  const SOURCE_LABELS: Record<string, string> = {
    professor: '교수',
    custom: '학생',
    'ai-generated': 'AI',
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] bg-black/50 flex items-end"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-full max-h-[85vh] bg-[#F5F0E8] border-t-2 border-[#1A1A1A] overflow-y-auto"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
        >
          {/* 핸들 */}
          <div className="flex justify-center py-2">
            <div className="w-10 h-1 bg-[#D4CFC4] rounded-full" />
          </div>

          {/* 헤더 */}
          <div className="px-4 pb-3 border-b border-[#D4CFC4]">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-[#1A1A1A]">{student.nickname}</h2>
                  <span className="text-[10px] px-1.5 py-0.5 border border-current font-bold"
                    style={{ color: CLASS_COLORS[student.classId] }}>
                    {student.classId}반
                  </span>
                  <span className="text-[10px] font-bold" style={{ color: statusColor }}>
                    {statusLabel}
                  </span>
                </div>
                {student.studentId && (
                  <p className="text-xs text-[#5C5C5C]">{student.studentId}</p>
                )}
              </div>
              <button onClick={onClose} className="p-1 text-[#5C5C5C]">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 경고 */}
            {warnings.length > 0 && (
              <div className="mt-2 space-y-1">
                {warnings.map((w, i) => (
                  <div key={i} className="text-[10px] px-2 py-1 bg-red-50 border border-[#8B1A1A] text-[#8B1A1A] font-bold">
                    {w}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 탭 */}
          <div className="flex border-b border-[#D4CFC4]">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2 text-xs font-bold text-center transition-colors ${
                  activeTab === tab.key
                    ? 'text-[#1A1A1A] border-b-2 border-[#1A1A1A]'
                    : 'text-[#5C5C5C]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 탭 콘텐츠 */}
          <div className="p-4">
            {/* A) 학업 성취도 */}
            {activeTab === 'academic' && (
              <div className="space-y-4">
                {/* 핵심 지표 카드 */}
                <div className="grid grid-cols-2 gap-2">
                  <StatCard label="평균 점수" value={`${student.quizStats.averageScore.toFixed(1)}점`} />
                  <StatCard label="반 평균" value={`${classMean.toFixed(1)}점`} />
                  <StatCard label="Z-score" value={studentZ.toFixed(2)}
                    alert={studentZ < -1.5} />
                  <StatCard label="반 내 백분위" value={`상위 ${100 - studentPercentile}%`} />
                  <StatCard label="총 시도" value={`${student.quizStats.totalAttempts}회`} />
                  <StatCard label="총 정답" value={`${student.quizStats.totalCorrect}개`} />
                </div>

                {/* 최근 퀴즈 미니 차트 */}
                {student.recentQuizzes.length > 0 && (
                  <div className="border border-[#D4CFC4] bg-[#FDFBF7] p-3">
                    <p className="text-xs font-bold text-[#1A1A1A] mb-2">최근 퀴즈 성적</p>
                    <svg viewBox="0 0 300 80" className="w-full">
                      {student.recentQuizzes.slice(0, 10).reverse().map((q, i, arr) => {
                        const x = 20 + (i / Math.max(arr.length - 1, 1)) * 260;
                        const y = 70 - (q.score / 100) * 60;
                        return (
                          <g key={i}>
                            {i > 0 && (
                              <line
                                x1={20 + ((i - 1) / Math.max(arr.length - 1, 1)) * 260}
                                y1={70 - (arr[i - 1].score / 100) * 60}
                                x2={x} y2={y}
                                stroke="#1D5D4A" strokeWidth={1.5}
                              />
                            )}
                            <circle cx={x} cy={y} r={3} fill="#1D5D4A" />
                          </g>
                        );
                      })}
                      <line x1={20} y1={70} x2={280} y2={70} stroke="#D4CFC4" strokeWidth={0.5} />
                    </svg>
                  </div>
                )}
              </div>
            )}

            {/* B) 활동 분포 */}
            {activeTab === 'activity' && (
              <div className="space-y-4">
                {/* 퀴즈 소스별 분포 */}
                <div className="border border-[#D4CFC4] bg-[#FDFBF7] p-3">
                  <p className="text-xs font-bold text-[#1A1A1A] mb-3">시도 분포</p>
                  {quizLog.length === 0 ? (
                    <p className="text-xs text-[#5C5C5C] text-center py-4">데이터 없음</p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(
                        quizLog.reduce((acc, q) => {
                          const key = SOURCE_LABELS[q.source] || q.source;
                          acc[key] = (acc[key] || 0) + 1;
                          return acc;
                        }, {} as Record<string, number>)
                      ).map(([label, count]) => (
                        <div key={label} className="flex items-center gap-2">
                          <span className="w-12 text-[10px] font-bold text-[#5C5C5C]">{label}</span>
                          <div className="flex-1 h-4 bg-[#EBE5D9]">
                            <motion.div
                              className="h-full bg-[#1A1A1A]"
                              initial={{ width: 0 }}
                              animate={{ width: `${(count / quizLog.length) * 100}%` }}
                              transition={{ duration: 0.4 }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-[#1A1A1A] w-6 text-right">{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 최근 피드백 */}
                {student.recentFeedbacks.length > 0 && (
                  <div className="border border-[#D4CFC4] bg-[#FDFBF7] p-3">
                    <p className="text-xs font-bold text-[#1A1A1A] mb-2">최근 피드백 ({student.feedbackCount}건)</p>
                    {student.recentFeedbacks.map(fb => (
                      <div key={fb.feedbackId} className="py-1.5 border-b border-[#D4CFC4] last:border-0">
                        <p className="text-[10px] text-[#5C5C5C]">{fb.quizTitle}</p>
                        <p className="text-xs text-[#1A1A1A]">{fb.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* C) 퀴즈 로그 */}
            {activeTab === 'log' && (
              <div>
                {logLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-6 h-6 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : quizLog.length === 0 ? (
                  <p className="text-sm text-[#5C5C5C] text-center py-8">퀴즈 기록이 없습니다</p>
                ) : (
                  <div className="space-y-0">
                    {/* 테이블 헤더 */}
                    <div className="grid grid-cols-[60px_1fr_40px_45px] gap-1 py-1.5 border-b-2 border-[#1A1A1A] text-[10px] font-bold text-[#5C5C5C]">
                      <span>날짜</span>
                      <span>퀴즈</span>
                      <span className="text-center">출처</span>
                      <span className="text-right">점수</span>
                    </div>
                    {quizLog.map((entry, i) => (
                      <div key={i} className="grid grid-cols-[60px_1fr_40px_45px] gap-1 py-1.5 border-b border-[#D4CFC4] text-xs">
                        <span className="text-[10px] text-[#5C5C5C] font-mono">
                          {entry.completedAt.toLocaleDateString('ko', { month: '2-digit', day: '2-digit' })}
                        </span>
                        <span className="text-[#1A1A1A] truncate">{entry.quizTitle}</span>
                        <span className="text-[10px] text-center text-[#5C5C5C]">
                          {SOURCE_LABELS[entry.source] || entry.source}
                        </span>
                        <span className="text-right font-mono font-bold text-[#1A1A1A]">{entry.score}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function StatCard({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`border p-2.5 ${alert ? 'border-[#8B1A1A] bg-red-50' : 'border-[#D4CFC4] bg-[#FDFBF7]'}`}>
      <p className="text-[10px] text-[#5C5C5C]">{label}</p>
      <p className={`text-sm font-bold ${alert ? 'text-[#8B1A1A]' : 'text-[#1A1A1A]'}`}>{value}</p>
    </div>
  );
}
