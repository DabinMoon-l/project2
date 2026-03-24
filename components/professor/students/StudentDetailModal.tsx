'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, useDragControls, type PanInfo } from 'framer-motion';
import type { StudentDetail, ClassType } from '@/lib/hooks/useProfessorStudents';
import { mean, sd, zScore, rankPercentile } from '@/lib/utils/statistics';
import StudentRadar from './StudentRadar';
import { useHideNav } from '@/lib/hooks/useHideNav';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import { useDetailPanel } from '@/lib/contexts';

const CLASS_COLORS: Record<ClassType, string> = {
  A: '#8B1A1A', B: '#B8860B', C: '#1D5D4A', D: '#1E3A5F',
};

interface Props {
  student: StudentDetail | null;
  allStudents: { uid: string; classId: ClassType; averageScore: number }[];
  isOpen: boolean;
  onClose: () => void;
  isPanelMode?: boolean;
}

export default function StudentDetailModal({ student, allStudents, isOpen, onClose, isPanelMode }: Props) {
  // 네비게이션 숨김 (패널 모드에서는 불필요)
  useHideNav(isOpen && !isPanelMode);

  // 배경 스크롤 방지 (패널 모드에서는 불필요)
  useEffect(() => {
    if (isOpen && !isPanelMode) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isOpen]);

  // 드래그 컨트롤 (핸들 영역에서만 드래그 시작)
  const dragControls = useDragControls();

  // 드래그로 닫기
  const handleDragEnd = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.y > 80 || info.velocity.y > 300) {
      onClose();
    }
  }, [onClose]);

  if (!student || !isOpen) return null;

  // 학업 성취도 — 교수 퀴즈 평균 점수 기반 (원점수 0~100)
  const studentAvg = student.weightedScore ?? 0;
  const allScoresInCourse = (student.classWeightedScores ?? []);
  const classMates = allScoresInCourse.filter(s => s.classId === student.classId);
  // B: 반 평균/SD도 참여자만 (score > 0)
  const classScoresActive = classMates.map(s => s.score).filter(s => s > 0);
  const classMean = mean(classScoresActive);
  const classSd = sd(classScoresActive);
  // D: SD=0이면 Z-score 무의미 → null
  const studentZ = classSd > 0 ? zScore(studentAvg, classMean, classSd) : null;

  // 전체 과목 기준 백분위 + 전체 평균
  // B: 미참여자(0점) 제외 — 참여만 해도 "상위 0%"되는 왜곡 방지
  const activeScoresInCourse = allScoresInCourse.filter(s => s.score > 0);
  const allCourseScores = activeScoresInCourse.map(s => s.score);
  const overallMean = mean(allCourseScores);
  // 순위 기반 백분위 (Z-score CDF 대신 — 비정규 분포에서도 정확)
  const sortedCourseScores = [...allCourseScores].sort((a, b) => a - b);
  const overallPercentile = studentAvg > 0
    ? rankPercentile(studentAvg, sortedCourseScores)
    : 0;

  // 표시 이름
  const displayName = student.name || student.nickname;

  // 경고 — D: Z-score가 null이면 경고 스킵
  const warnings: string[] = [];
  if (studentZ !== null && studentZ < -2.0) warnings.push('Z-score < -2.0 — 위험');
  else if (studentZ !== null && studentZ < -1.5) warnings.push('Z-score < -1.5 — 주의');

  // 모든 퀴즈 (시간순 정렬 — recentQuizzes는 최신순이므로 reverse)
  const allQuizzes = [...student.recentQuizzes].reverse();

  // 패널 모드: 오버레이 없이 일반 div로 렌더
  if (isPanelMode) {
    return (
      <div className="h-full flex flex-col bg-[#F5F0E8] overflow-hidden">
        {/* 헤더 */}
        <div className="px-5 pt-4 pb-3 border-b border-[#D4CFC4]">
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
          {warnings.length > 0 && (
            <div className="mt-2 space-y-1">
              {warnings.map((w, i) => (
                <div key={`warning-${i}`} className="text-xs px-2 py-1 bg-red-50 border border-[#8B1A1A] text-[#8B1A1A] font-bold">
                  {w}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* 콘텐츠 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <div>
            <StudentRadar
              data={student.radarMetrics ?? { quizScore: 0, battle: 0, quizCreation: 0, community: 0, activity: 0 }}
              classColor={CLASS_COLORS[student.classId]}
            />
          </div>
          <div className="border-t border-[#D4CFC4]" />
          <div className="space-y-6">
            <AchievementGrid studentAvg={studentAvg} classMean={classMean} overallMean={overallMean} studentZ={studentZ} overallPercentile={overallPercentile} />
            <QuizLineChart quizzes={allQuizzes} />
          </div>
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
      </div>
    );
  }

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
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0 }}
          dragElastic={0.2}
          onDragEnd={handleDragEnd}
          onClick={e => e.stopPropagation()}
        >
          {/* 핸들 — 이 영역에서만 드래그로 닫기 가능 */}
          <div
            className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={e => dragControls.start(e)}
          >
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
                  <div key={`warning-${i}`} className="text-xs px-2 py-1 bg-red-50 border border-[#8B1A1A] text-[#8B1A1A] font-bold">
                    {w}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 콘텐츠 — 스크롤 가능 (safe area 패딩은 내부에 적용) */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-6" style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}>
            {/* 종합 역량 레이더 */}
            <div>
              <StudentRadar
                data={student.radarMetrics ?? {
                  quizScore: 0, battle: 0, quizCreation: 0,
                  community: 0, activity: 0,
                }}
                classColor={CLASS_COLORS[student.classId]}
              />
            </div>

            {/* 구분선 */}
            <div className="border-t border-[#D4CFC4]" />

            {/* 학업 성취도 */}
            <div className="space-y-6">
              <AchievementGrid
                studentAvg={studentAvg}
                classMean={classMean}
                overallMean={overallMean}
                studentZ={studentZ}
                overallPercentile={overallPercentile}
              />

              <QuizLineChart quizzes={allQuizzes} />
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

// ============================================================
// 퀴즈 성적 라인차트 (가로 스크롤, 2줄 이름)
// ============================================================

function splitQuizName(title: string): string[] {
  if (title.length <= 6) return [title];
  const line1 = title.slice(0, 6);
  const rest = title.slice(6);
  if (rest.length <= 6) return [line1, rest];
  return [line1, rest.slice(0, 5) + '…'];
}

function QuizLineChart({ quizzes }: { quizzes: { quizId: string; quizTitle: string; score: number }[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ isDragging: false, startX: 0, scrollLeft: 0 });

  // PC: 마우스 드래그로 가로 스크롤
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onDown = (e: MouseEvent) => {
      dragState.current = { isDragging: true, startX: e.clientX, scrollLeft: el.scrollLeft };
      el.style.cursor = 'grabbing';
      el.style.userSelect = 'none';
    };
    const onMove = (e: MouseEvent) => {
      if (!dragState.current.isDragging) return;
      const dx = e.clientX - dragState.current.startX;
      el.scrollLeft = dragState.current.scrollLeft - dx;
    };
    const onUp = () => {
      dragState.current.isDragging = false;
      el.style.cursor = 'grab';
      el.style.userSelect = '';
    };
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const spacing = 60;
  const paddingLeft = 30;
  const paddingRight = 30;
  const chartWidth = Math.max(300, paddingLeft + paddingRight + (quizzes.length - 1) * spacing);

  return (
    <div>
      <p className="text-base font-bold text-[#1A1A1A] mb-3">최근 퀴즈 성적</p>
      {quizzes.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-sm text-[#999]">퀴즈 기록 없음</div>
      ) : (
        <div ref={scrollRef} className="overflow-x-auto scrollbar-hide -mx-5 px-5" style={{ cursor: 'grab', WebkitOverflowScrolling: 'touch' }}>
          <svg viewBox={`0 0 ${chartWidth} 145`} width={chartWidth} height={145} className="min-w-full">
            <line x1={20} y1={30} x2={chartWidth - 20} y2={30} stroke="#D4CFC4" strokeWidth={0.3} strokeDasharray="3,3" />
            <line x1={20} y1={62.5} x2={chartWidth - 20} y2={62.5} stroke="#D4CFC4" strokeWidth={0.3} strokeDasharray="3,3" />
            <line x1={20} y1={95} x2={chartWidth - 20} y2={95} stroke="#D4CFC4" strokeWidth={0.5} />
            <text x={14} y={33} textAnchor="end" fontSize={7} fill="#5C5C5C">100</text>
            <text x={14} y={66} textAnchor="end" fontSize={7} fill="#5C5C5C">50</text>
            <text x={14} y={98} textAnchor="end" fontSize={7} fill="#5C5C5C">0</text>
            {quizzes.map((q, i, arr) => {
              const x = arr.length === 1 ? chartWidth / 2 : paddingLeft + i * spacing;
              const y = 95 - (q.score / 100) * 65;
              const prevX = i > 0 ? (paddingLeft + (i - 1) * spacing) : x;
              const prevY = i > 0 ? (95 - (arr[i - 1].score / 100) * 65) : y;
              return (
                <g key={`point-${q.quizId}`}>
                  {i > 0 && <line x1={prevX} y1={prevY} x2={x} y2={y} stroke="#1A1A1A" strokeWidth={1.5} />}
                  <circle cx={x} cy={y} r={4.5} fill="#F5F0E8" stroke="#1A1A1A" strokeWidth={2} />
                  <text x={x} y={y - 10} textAnchor="middle" fontSize={10} fontWeight="bold" fill="#1A1A1A">{q.score}</text>
                </g>
              );
            })}
            {quizzes.map((q, i, arr) => {
              const x = arr.length === 1 ? chartWidth / 2 : paddingLeft + i * spacing;
              const lines = splitQuizName(q.quizTitle);
              return (
                <text key={`label-${q.quizId}`} textAnchor="middle" fontSize={10} fill="#1A1A1A" fontWeight="600">
                  <tspan x={x} y={110}>{lines[0]}</tspan>
                  {lines[1] && <tspan x={x} dy={13}>{lines[1]}</tspan>}
                </text>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 학업 성취도 그리드 (ⓘ 툴팁 포함)
// ============================================================

const ACHIEVEMENT_ROWS: { key: string; label: string; info: string }[][] = [
  [
    { key: 'avg', label: '성취 지수', info: '교수 퀴즈 ×6 + 학생 퀴즈 ×4 가중 석차 점수' },
    { key: 'classMean', label: '반 평균', info: '같은 반 학생들의 성취 지수 평균' },
  ],
  [
    { key: 'overallMean', label: '전체 평균', info: '과목 전체 학생의 성취 지수 평균 (A~D반)' },
    { key: 'pct', label: '전체 백분위', info: '과목 전체 학생 중 성취 지수 순위 기반 상위 %' },
  ],
  [
    { key: 'zscore', label: 'Z-score', info: '반 평균 대비 표준편차 위치 (-1.5 이하 주의)' },
  ],
];

function AchievementGrid({
  studentAvg,
  classMean,
  overallMean,
  studentZ,
  overallPercentile,
}: {
  studentAvg: number;
  classMean: number;
  overallMean: number;
  studentZ: number | null;
  overallPercentile: number;
}) {
  const [activeInfo, setActiveInfo] = useState<string | null>(null);

  const values: Record<string, React.ReactNode> = {
    avg: studentAvg.toFixed(1),
    classMean: classMean.toFixed(1),
    overallMean: overallMean.toFixed(1),
    zscore: studentZ !== null
      ? <span className={studentZ < -1.5 ? 'text-[#8B1A1A]' : ''}>{studentZ.toFixed(2)}</span>
      : <span className="text-[#5C5C5C]">N/A</span>,
    pct: studentAvg > 0 ? `상위 ${100 - overallPercentile}%` : <span className="text-[#5C5C5C]">N/A</span>,
  };

  return (
    <div onClick={() => setActiveInfo(null)} className="space-y-4">
      {ACHIEVEMENT_ROWS.map((row, ri) => (
        <div key={`row-${ri}`} className="grid grid-cols-2 gap-x-4">
          {row.map((item, ci) => (
            <AchievementItem key={item.key} item={item} value={values[item.key]} activeInfo={activeInfo} setActiveInfo={setActiveInfo} alignRight={ci === 1} />
          ))}
        </div>
      ))}
    </div>
  );
}

function AchievementItem({
  item,
  value,
  activeInfo,
  setActiveInfo,
  alignRight,
}: {
  item: { key: string; label: string; info: string };
  value: React.ReactNode;
  activeInfo: string | null;
  setActiveInfo: (v: string | null) => void;
  alignRight?: boolean;
}) {
  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <p className="text-sm text-[#5C5C5C]">{item.label}</p>
        <button
          onClick={(e) => { e.stopPropagation(); setActiveInfo(activeInfo === item.key ? null : item.key); }}
          className={`w-4 h-4 rounded-full border text-[9px] font-semibold leading-none flex items-center justify-center transition-colors ${
            activeInfo === item.key
              ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
              : 'bg-transparent text-[#999] border-[#999]'
          }`}
        >
          i
        </button>
      </div>
      <p className="text-xl font-bold text-[#1A1A1A] mt-0.5">{value}</p>
      {/* 툴팁 — 오른쪽 열은 right-0으로 배치 (잘림 방지) */}
      <AnimatePresence>
        {activeInfo === item.key && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className={`absolute top-full mt-1 z-10 bg-[#1A1A1A] text-white text-[11px] leading-relaxed px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap ${alignRight ? 'right-0' : 'left-0'}`}
            onClick={() => setActiveInfo(null)}
          >
            {item.info}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
