'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { readHomeCache, writeHomeCache } from '@/lib/utils/rankingCache';
import { computeRankScore, computeTeamScore } from '@/lib/utils/ranking';
import { AnimatePresence, motion } from 'framer-motion';
import { scaleCoord } from '@/lib/hooks/useViewportScale';
import RankingBottomSheet from './RankingBottomSheet';

// 순위 접미사
const ordinalSuffix = (n: number) => {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
};

const AUTO_INTERVAL = 2500; // 자동 롤링 간격
const PAUSE_DURATION = 5000; // 수동 조작 시 일시정지
const SWIPE_MIN = 30; // 스와이프 최소 거리

interface TeamRankEntry {
  classId: string;
  rank: number;
}

/**
 * 교수님 전용 랭킹 섹션 — 4개 팀 자동/수동 롤링
 */
export default function ProfessorRankingSection({ overrideCourseId }: { overrideCourseId?: string } = {}) {
  const { profile } = useUser();
  const { userCourseId: contextCourseId } = useCourse();
  const userCourseId = overrideCourseId ?? contextCourseId;

  // 4팀 랭킹 데이터 (랭크순 정렬)
  const [teamEntries, setTeamEntries] = useState<TeamRankEntry[]>([]);
  const [participationRate, setParticipationRate] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // 랭킹 바텀시트
  const [showRanking, setShowRanking] = useState(false);

  // 롤링 인덱스 (teamEntries 배열 인덱스)
  const [currentIdx, setCurrentIdx] = useState(0);
  const [direction, setDirection] = useState(1); // 1: 아래로, -1: 위로

  // 자동 롤링 제어
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPausedRef = useRef(false);

  // 스와이프 (터치 + 마우스)
  const pointerStartX = useRef(0);
  const pointerStartY = useRef(0);
  const isDragging = useRef(false);
  const swipeFired = useRef(false);

  // ── 데이터 로드 ──
  useEffect(() => {
    if (!userCourseId || !profile) return;

    // 1. sessionStorage 캐시에서 즉시 표시
    const { data: cached, isFresh } = readHomeCache(userCourseId);
    if (cached && Object.keys(cached.teamRanks).length > 0) {
      const entries = Object.entries(cached.teamRanks)
        .map(([classId, rank]) => ({ classId, rank }))
        .sort((a, b) => a.rank - b.rank);
      setTeamEntries(entries);
      if (cached.participationRate != null) setParticipationRate(cached.participationRate);
      setCurrentIdx(0);
      setLoading(false);
      if (isFresh) return;
    }

    // 2. Firestore rankings/{courseId} 문서 읽기
    const loadRankings = async () => {
      try {
        const rankDoc = await getDoc(doc(db, 'rankings', userCourseId));

        if (rankDoc.exists()) {
          const data = rankDoc.data();
          const teamRanksArr = data.teamRanks || [];
          const rankedUsers: any[] = data.rankedUsers || [];

          // 팀 엔트리 구성 (랭크순)
          const entries: TeamRankEntry[] = teamRanksArr
            .map((t: any) => ({ classId: t.classId, rank: t.rank }))
            .sort((a: TeamRankEntry, b: TeamRankEntry) => a.rank - b.rank);

          // 주간 참여율 (CF에서 계산, 없으면 누적 폴백)
          const rate = data.weeklyParticipationRate != null
            ? data.weeklyParticipationRate
            : rankedUsers.length > 0
              ? Math.round((rankedUsers.filter((u: any) => (u.totalExp || 0) > 0).length / rankedUsers.length) * 100)
              : 0;

          setTeamEntries(entries);
          setParticipationRate(rate);
          setCurrentIdx(0);

          // 캐시 갱신
          const teamRanksMap: Record<string, number> = {};
          teamRanksArr.forEach((t: any) => { teamRanksMap[t.classId] = t.rank; });

          writeHomeCache(userCourseId, {
            teamRanks: teamRanksMap,
            personalRank: 0,
            totalStudents: rankedUsers.length,
            participationRate: rate,
          });
        } else {
          // rankings 문서 없음 → 클라이언트 폴백
          await computeProfessorFallback(userCourseId, setTeamEntries, setParticipationRate);
          setCurrentIdx(0);
        }

        setLoading(false);
      } catch (error) {
        console.error('교수님 랭킹 로드 실패:', error);
        setLoading(false);
      }
    };

    loadRankings();
  }, [userCourseId, profile]);

  // ── 자동 롤링 ──
  const startAutoRolling = useCallback(() => {
    if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    autoTimerRef.current = setInterval(() => {
      if (isPausedRef.current) return;
      setDirection(1);
      setCurrentIdx(prev => (prev + 1) % Math.max(teamEntries.length, 1));
    }, AUTO_INTERVAL);
  }, [teamEntries.length]);

  useEffect(() => {
    if (teamEntries.length <= 1) return;
    startAutoRolling();
    return () => {
      if (autoTimerRef.current) clearInterval(autoTimerRef.current);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, [teamEntries.length, startAutoRolling]);

  // 수동 조작 시 일시정지
  const pauseAutoRolling = useCallback(() => {
    isPausedRef.current = true;
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      isPausedRef.current = false;
    }, PAUSE_DURATION);
  }, []);

  // ── 세로 스와이프 발동 ──
  const fireSwipe = useCallback((dy: number) => {
    if (teamEntries.length <= 1) return;
    pauseAutoRolling();
    if (dy < 0) {
      // 위로 → 다음 (1st→2nd→...)
      setDirection(1);
      setCurrentIdx(prev => (prev + 1) % teamEntries.length);
    } else {
      // 아래로 → 이전
      setDirection(-1);
      setCurrentIdx(prev => (prev - 1 + teamEntries.length) % teamEntries.length);
    }
  }, [teamEntries.length, pauseAutoRolling]);

  // ── 터치 스와이프 (touchMove에서 임계값 넘으면 즉시 발동) ──
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    pointerStartX.current = scaleCoord(e.touches[0].clientX);
    pointerStartY.current = scaleCoord(e.touches[0].clientY);
    swipeFired.current = false;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    if (swipeFired.current) return;
    const dx = scaleCoord(e.touches[0].clientX) - pointerStartX.current;
    const dy = scaleCoord(e.touches[0].clientY) - pointerStartY.current;
    if (Math.abs(dy) >= SWIPE_MIN && Math.abs(dy) > Math.abs(dx)) {
      swipeFired.current = true;
      fireSwipe(dy);
    }
  }, [fireSwipe]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
  }, []);

  // ── 마우스 드래그 스와이프 (PC) ──
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    pointerStartX.current = scaleCoord(e.clientX);
    pointerStartY.current = scaleCoord(e.clientY);
    isDragging.current = true;
    swipeFired.current = false;
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current || swipeFired.current) return;
    const dx = scaleCoord(e.clientX) - pointerStartX.current;
    const dy = scaleCoord(e.clientY) - pointerStartY.current;
    if (Math.abs(dy) >= SWIPE_MIN && Math.abs(dy) > Math.abs(dx)) {
      swipeFired.current = true;
      isDragging.current = false;
      fireSwipe(dy);
    }
  }, [fireSwipe]);

  const onMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const current = teamEntries[currentIdx];
  const teamLabel = loading ? '-' : (current?.classId ?? '-');
  const rankLabel = loading ? '-' : current ? `${current.rank}${ordinalSuffix(current.rank)}` : '-';

  return (
    <div className="w-full">
      <div className="flex items-center justify-center gap-4">
        {/* TEAM + TEAM RANK (스와이프 전용) */}
        <div
          className="flex items-center gap-4 select-none cursor-grab active:cursor-grabbing"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        >
          {/* TEAM */}
          <div className="text-center">
            <span className="text-[10px] font-bold text-white/50 tracking-widest">TEAM</span>
            <div className="h-[40px] relative overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.div
                  key={`team-${currentIdx}`}
                  custom={direction}
                  initial={{ y: direction > 0 ? 30 : -30, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: direction > 0 ? -30 : 30, opacity: 0 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className="text-4xl font-black text-white leading-tight"
                >
                  {teamLabel}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* 구분선 */}
          <div className="w-px h-8 bg-white/20" />

          {/* TEAM RANK */}
          <div className="text-center">
            <span className="text-[10px] font-bold text-white/50 tracking-widest">TEAM RANK</span>
            <div className="h-[40px] relative overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.div
                  key={`rank-${currentIdx}`}
                  custom={direction}
                  initial={{ y: direction > 0 ? 30 : -30, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: direction > 0 ? -30 : 30, opacity: 0 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className={`text-4xl font-black text-white leading-tight ${loading ? 'animate-pulse' : ''}`}
                >
                  {rankLabel}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* 구분선 */}
        <div className="w-px h-8 bg-white/20" />

        {/* OVERVIEW (클릭 시 랭킹 바텀시트) */}
        <button
          onClick={() => !loading && setShowRanking(true)}
          className="flex items-center gap-2 active:scale-95 transition-transform"
        >
          <div className="text-center">
            <span className="text-[10px] font-bold text-white/50 tracking-widest">OVERVIEW</span>
            <div className="flex items-baseline justify-center">
              <span className={`text-4xl font-black text-white leading-tight ${loading ? 'animate-pulse' : ''}`}>
                {loading ? '-' : `${participationRate}%`}
              </span>
            </div>
          </div>

          {/* 화살표 */}
          <svg className="w-4 h-4 text-white/50 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* 인디케이터 점 */}
      {teamEntries.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {teamEntries.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                i === currentIdx ? 'bg-white/80' : 'bg-white/25'
              }`}
            />
          ))}
        </div>
      )}

      {/* 랭킹 바텀시트 */}
      <RankingBottomSheet
        isOpen={showRanking}
        onClose={() => setShowRanking(false)}
      />
    </div>
  );
}

/**
 * 클라이언트 폴백: rankings 문서가 없을 때 직접 계산 (교수님용 — 4팀 전체)
 */
async function computeProfessorFallback(
  courseId: string,
  setTeamEntries: (v: TeamRankEntry[]) => void,
  setParticipationRate: (v: number) => void,
) {
  const usersSnap = await getDocs(query(collection(db, 'users'), where('courseId', '==', courseId)));
  const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  const students = allUsers.filter((u: any) => u.role !== 'professor');
  const professorUids = allUsers.filter((u: any) => u.role === 'professor').map((u: any) => u.id);

  if (students.length === 0) return;

  // 참여율: EXP > 0인 학생 비율
  const active = students.filter((u: any) => (u.totalExp || 0) > 0).length;
  const rate = Math.round((active / students.length) * 100);
  setParticipationRate(rate);

  // quizzes + quizResults 병렬
  const [quizSnap, resultsSnap] = await Promise.all([
    professorUids.length > 0
      ? getDocs(query(collection(db, 'quizzes'), where('courseId', '==', courseId)))
      : Promise.resolve(null),
    getDocs(query(collection(db, 'quizResults'), where('courseId', '==', courseId))),
  ]);

  const profQuizIds = new Set<string>();
  let totalProfQuizzes = 0;
  if (quizSnap) {
    quizSnap.docs.forEach(d => {
      const data = d.data();
      if (professorUids.includes(data.creatorId) || professorUids.includes(data.creatorUid)) profQuizIds.add(d.id);
    });
    totalProfQuizzes = profQuizIds.size;
  }

  const studentProfStats: Record<string, { correct: number; attempted: number }> = {};
  resultsSnap.docs.forEach(d => {
    const r = d.data();
    if (r.isUpdate) return;
    const isProfQuiz = professorUids.includes(r.quizCreatorId) || profQuizIds.has(r.quizId);
    if (!isProfQuiz) return;
    const uid = r.userId as string;
    if (!studentProfStats[uid]) studentProfStats[uid] = { correct: 0, attempted: 0 };
    studentProfStats[uid].correct += r.correctCount || 0;
    studentProfStats[uid].attempted += r.totalCount || 0;
  });

  // 팀 랭킹
  const classes = ['A', 'B', 'C', 'D'];
  const allExps = students.map((u: any) => u.totalExp || 0);
  const maxExp = Math.max(...allExps, 1);
  const teamCalc = classes.map(cls => {
    const members = students.filter((u: any) => u.classId === cls);
    if (members.length === 0) return { classId: cls, score: 0, rank: 0 };

    const avgExp = members.reduce((s: number, u: any) => s + (u.totalExp || 0), 0) / members.length;
    const normalizedAvgExp = (avgExp / maxExp) * 100;
    const correctRates = members.map((u: any) => {
      const stat = studentProfStats[u.id];
      if (!stat || stat.attempted === 0) return 0;
      return (stat.correct / stat.attempted) * 100;
    });
    const avgCorrectRate = correctRates.reduce((s, r) => s + r, 0) / correctRates.length;
    let avgCompletionRate = 0;
    if (totalProfQuizzes > 0) {
      const rates = members.map((u: any) => Math.min(((u.professorQuizzesCompleted || 0) / totalProfQuizzes) * 100, 100));
      avgCompletionRate = rates.reduce((s, r) => s + r, 0) / rates.length;
    }
    return { classId: cls, score: computeTeamScore(normalizedAvgExp, avgCorrectRate, avgCompletionRate), rank: 0 };
  });
  teamCalc.sort((a, b) => b.score - a.score);
  teamCalc.forEach((t, i) => { t.rank = i + 1; });

  const entries: TeamRankEntry[] = teamCalc.map(t => ({ classId: t.classId, rank: t.rank }));
  setTeamEntries(entries);

  // 캐시 저장
  const teamRanksMap: Record<string, number> = {};
  teamCalc.forEach(t => { teamRanksMap[t.classId] = t.rank; });
  writeHomeCache(courseId, {
    teamRanks: teamRanksMap,
    personalRank: 0,
    totalStudents: students.length,
    participationRate: rate,
  });
}
