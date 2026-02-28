'use client';

import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import type { StudentDetail, ClassType } from '@/lib/hooks/useProfessorStudents';
import { mean, sd, zScore, percentile } from '@/lib/utils/statistics';
import StudentRadar from './StudentRadar';

const CLASS_COLORS: Record<ClassType, string> = {
  A: '#8B1A1A', B: '#B8860B', C: '#1D5D4A', D: '#1E3A5F',
};

interface Props {
  student: StudentDetail | null;
  allStudents: { uid: string; classId: ClassType; averageScore: number }[];
  isOpen: boolean;
  onClose: () => void;
}

export default function StudentDetailModal({ student, allStudents, isOpen, onClose }: Props) {
  // PullToHome 차단 + 네비게이션 숨김
  useEffect(() => {
    if (isOpen) {
      document.body.setAttribute('data-hide-nav', '');
    }
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, [isOpen]);

  // 드래그로 닫기
  const handleDragEnd = useCallback((_: any, info: PanInfo) => {
    if (info.offset.y > 80 || info.velocity.y > 300) {
      onClose();
    }
  }, [onClose]);

  if (!student || !isOpen) return null;

  // 학업 성취도 — 가중 석차 점수 기반 (교수 퀴즈 ×6, 학생 퀴즈 ×4)
  const studentAvg = student.weightedScore ?? 0;
  const classMates = (student.classWeightedScores ?? []).filter(s => s.classId === student.classId);
  const classScores = classMates.map(s => s.score);
  const classMean = mean(classScores);
  const classSd = sd(classScores);
  const studentZ = zScore(studentAvg, classMean, classSd);
  const studentPercentile = percentile(studentZ);

  // 표시 이름
  const displayName = student.name || student.nickname;

  // 경고
  const warnings: string[] = [];
  if (studentZ < -2.0) warnings.push('Z-score < -2.0 — 위험');
  else if (studentZ < -1.5) warnings.push('Z-score < -1.5 — 주의');

  // 최근 퀴즈 5개 (recentQuizzes에서)
  const recentFive = student.recentQuizzes.slice(0, 5).reverse();

  return (
    <AnimatePresence>
      <motion.div
        key="student-detail-overlay"
        className="fixed inset-0 z-[100] bg-black/30 flex items-end"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-full bg-[#F5F0E8] rounded-t-2xl shadow-[0_-8px_32px_rgba(0,0,0,0.12)] border border-[#D4CFC4]/60 border-b-0 overflow-hidden flex flex-col"
          style={{ height: '60vh' }}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          drag="y"
          dragConstraints={{ top: 0 }}
          dragElastic={0.2}
          onDragEnd={handleDragEnd}
          onClick={e => e.stopPropagation()}
        >
          {/* 핸들 */}
          <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing">
            <div className="w-10 h-1 bg-[#D4CFC4]/80 rounded-full" />
          </div>

          {/* 헤더 — 이름 · 반 · 닉네임 / 학번 */}
          <div className="px-5 pb-3 border-b border-[#D4CFC4]">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-xl font-bold text-[#1A1A1A]">{displayName}</h2>
                  <p className="text-sm text-[#5C5C5C]">{student.classId}반 · {student.nickname}</p>
                </div>
                {student.studentId && (
                  <p className="text-sm text-[#5C5C5C]">{student.studentId}</p>
                )}
              </div>
              <button onClick={onClose} className="p-1 text-[#5C5C5C] flex-shrink-0">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 경고 */}
            {warnings.length > 0 && (
              <div className="mt-2 space-y-1">
                {warnings.map((w, i) => (
                  <div key={i} className="text-xs px-2 py-1 bg-red-50 border border-[#8B1A1A] text-[#8B1A1A] font-bold">
                    {w}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 콘텐츠 — 스크롤 가능 */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* 종합 역량 레이더 */}
            <div>
              {student.radarMetrics ? (
                <StudentRadar
                  data={student.radarMetrics}
                  classColor={CLASS_COLORS[student.classId]}
                />
              ) : (
                <div className="text-center py-8">
                  <p className="text-base text-[#5C5C5C]">레이더 데이터를 불러오는 중...</p>
                </div>
              )}
            </div>

            {/* 구분선 */}
            <div className="border-t border-[#D4CFC4]" />

            {/* 학업 성취도 */}
            <div className="space-y-6">
              {student.weightedScore === undefined ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i}>
                      <div className="h-4 w-16 bg-[#D4CFC4]/50 rounded animate-pulse mb-1" />
                      <div className="h-6 w-20 bg-[#D4CFC4]/50 rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <div>
                  <p className="text-sm text-[#5C5C5C]">성취 지수</p>
                  <p className="text-xl font-bold text-[#1A1A1A]">{studentAvg.toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-sm text-[#5C5C5C]">반 평균</p>
                  <p className="text-xl font-bold text-[#1A1A1A]">{classMean.toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-sm text-[#5C5C5C]">Z-score</p>
                  <p className={`text-xl font-bold ${studentZ < -1.5 ? 'text-[#8B1A1A]' : 'text-[#1A1A1A]'}`}>
                    {studentZ.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-[#5C5C5C]">반 내 백분위</p>
                  <p className="text-xl font-bold text-[#1A1A1A]">상위 {100 - studentPercentile}%</p>
                </div>
              </div>
              )}

              {/* 최근 퀴즈 5개 차트 */}
              {recentFive.length > 0 && (
                <div>
                  <p className="text-base font-bold text-[#1A1A1A] mb-3">최근 퀴즈 성적</p>
                  <svg viewBox="0 0 300 140" className="w-full">
                    {/* Y축 가이드라인 */}
                    <line x1={20} y1={30} x2={280} y2={30} stroke="#D4CFC4" strokeWidth={0.3} strokeDasharray="3,3" />
                    <line x1={20} y1={62.5} x2={280} y2={62.5} stroke="#D4CFC4" strokeWidth={0.3} strokeDasharray="3,3" />
                    <line x1={20} y1={95} x2={280} y2={95} stroke="#D4CFC4" strokeWidth={0.5} />
                    {/* Y축 레이블 */}
                    <text x={14} y={33} textAnchor="end" fontSize={7} fill="#5C5C5C">100</text>
                    <text x={14} y={66} textAnchor="end" fontSize={7} fill="#5C5C5C">50</text>
                    <text x={14} y={98} textAnchor="end" fontSize={7} fill="#5C5C5C">0</text>
                    {recentFive.map((q, i, arr) => {
                      const x = arr.length === 1 ? 150 : 30 + (i / (arr.length - 1)) * 240;
                      const y = 95 - (q.score / 100) * 65;
                      const prevX = i > 0 ? (30 + ((i - 1) / (arr.length - 1)) * 240) : x;
                      const prevY = i > 0 ? (95 - (arr[i - 1].score / 100) * 65) : y;
                      return (
                        <g key={i}>
                          {i > 0 && (
                            <line x1={prevX} y1={prevY} x2={x} y2={y}
                              stroke="#1A1A1A" strokeWidth={1.5} />
                          )}
                          <circle cx={x} cy={y} r={4.5} fill="#F5F0E8" stroke="#1A1A1A" strokeWidth={2} />
                          <text x={x} y={y - 10} textAnchor="middle" fontSize={10}
                            fontWeight="bold" fill="#1A1A1A">
                            {q.score}
                          </text>
                        </g>
                      );
                    })}
                    {recentFive.map((q, i, arr) => {
                      const x = arr.length === 1 ? 150 : 30 + (i / (arr.length - 1)) * 240;
                      const name = q.quizTitle.length > 6 ? q.quizTitle.slice(0, 6) + '..' : q.quizTitle;
                      return (
                        <text key={`label-${i}`} x={x} y={112} textAnchor="middle" fontSize={9}
                          fill="#1A1A1A" fontWeight="600">
                          {name}
                        </text>
                      );
                    })}
                  </svg>
                </div>
              )}
            </div>

            {/* 최근 피드백 */}
            {student.recentFeedbacks.length > 0 && (
              <>
                <div className="border-t border-[#D4CFC4]" />
                <div>
                  <p className="text-base font-bold text-[#1A1A1A] mb-2">피드백 ({student.feedbackCount}건)</p>
                  {student.recentFeedbacks.map(fb => (
                    <div key={fb.feedbackId} className="py-2 border-b border-[#D4CFC4]">
                      <p className="text-xs text-[#5C5C5C]">{fb.quizTitle}</p>
                      <p className="text-base text-[#1A1A1A]">{fb.content}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
