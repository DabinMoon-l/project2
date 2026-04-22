'use client';

import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, db } from '@/lib/repositories';
import { rankingRepo, userRepo } from '@/lib/repositories';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { readHomeCache, writeHomeCache } from '@/lib/utils/rankingCache';
import { computeRankScore, computeTeamScore } from '@/lib/utils/ranking';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { useDetailPanel } from '@/lib/contexts/DetailPanelContext';
import { useHomeScale } from './useHomeScale';
import { useLogOverlayView } from '@/lib/hooks/usePageViewLogger';
import RankingBottomSheet from './RankingBottomSheet';

/** rankings/{courseId} 문서의 rankedUsers 배열 항목 */
interface RankedUserEntry {
  id: string;
  rank: number;
  totalExp?: number;
  [key: string]: unknown;
}

/** rankings/{courseId} 문서의 teamRanks 배열 항목 */
interface TeamRankEntry {
  classId: string;
  rank: number;
}

/** users 컬렉션 문서 (폴백 계산용) */
interface UserDoc {
  id: string;
  role?: string;
  classId?: string;
  totalExp?: number;
  professorQuizzesCompleted?: number;
  [key: string]: unknown;
}

// 순위 접미사
const ordinalSuffix = (n: number) => {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
};

/**
 * 랭킹 섹션 컴포넌트 (홈 하단, 흰색 텍스트)
 * rankings/{courseId} 문서 1개만 읽어서 표시
 */
export default function RankingSection({ overrideCourseId }: { overrideCourseId?: string } = {}) {
  const { profile } = useUser();
  const { userCourseId: contextCourseId } = useCourse();
  const userCourseId = overrideCourseId ?? contextCourseId;
  const { classType } = useTheme();

  const [teamRank, setTeamRank] = useState<number>(0);
  const [personalRank, setPersonalRank] = useState<number>(0);
  const [totalStudents, setTotalStudents] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [showRanking, setShowRanking] = useState(false);
  const isWide = useWideMode();
  const { openDetail, closeDetail } = useDetailPanel();
  const scale = useHomeScale();
  const logOverlay = useLogOverlayView();

  useEffect(() => {
    if (!userCourseId || !profile) return;

    // 1. sessionStorage 캐시에서 즉시 표시
    const { data: cached, isFresh } = readHomeCache(userCourseId);
    if (cached) {
      if (cached.teamRanks[classType]) setTeamRank(cached.teamRanks[classType]);
      if (cached.personalRank) setPersonalRank(cached.personalRank);
      setTotalStudents(cached.totalStudents);
      setLoading(false);
      if (isFresh) return;
    }

    // 2. rankings/{courseId} 문서 1개 읽기 (Feature flag에 따라 Firestore/Supabase)
    const loadRankings = async () => {
      try {
        const data = await rankingRepo.getRanking(userCourseId) as {
          rankedUsers?: RankedUserEntry[];
          teamRanks?: TeamRankEntry[];
        } | null;

        if (data) {
          const rankedUsers = data.rankedUsers || [];
          const teamRanksArr = data.teamRanks || [];

          // 팀 랭킹
          const myTeam = teamRanksArr.find((t: TeamRankEntry) => t.classId === classType);
          if (myTeam) setTeamRank(myTeam.rank);

          // 개인 랭킹
          const me = rankedUsers.find((u: RankedUserEntry) => u.id === profile.uid);
          if (me) setPersonalRank(me.rank);
          setTotalStudents(rankedUsers.length);

          // sessionStorage 캐시 갱신
          const teamRanksMap: Record<string, number> = {};
          teamRanksArr.forEach((t: TeamRankEntry) => { teamRanksMap[t.classId] = t.rank; });

          writeHomeCache(userCourseId, {
            teamRanks: teamRanksMap,
            personalRank: me?.rank || 0,
            totalStudents: rankedUsers.length,
          });
        } else {
          // rankings 문서 없음 → CF에 갱신 요청
          try {
            const { callFunction: callFn } = await import('@/lib/api');
            await callFn('refreshRankings', { courseId: userCourseId });
            // 재시도
            const retryData = await rankingRepo.getRanking(userCourseId) as {
              rankedUsers?: RankedUserEntry[];
              teamRanks?: TeamRankEntry[];
            } | null;
            if (retryData) {
              const rankedUsers = retryData.rankedUsers || [];
              const teamRanksArr = retryData.teamRanks || [];
              const myTeam = teamRanksArr.find((t: TeamRankEntry) => t.classId === classType);
              if (myTeam) setTeamRank(myTeam.rank);
              const me = rankedUsers.find((u: RankedUserEntry) => u.id === profile.uid);
              if (me) setPersonalRank(me.rank);
              setTotalStudents(rankedUsers.length);
            }
          } catch {
            // CF 호출 실패해도 무방
          }
        }

        setLoading(false);
      } catch (error) {
        console.error('랭킹 로드 실패:', error);
        setLoading(false);
      }
    };

    loadRankings();
  }, [userCourseId, profile, classType]);

  // 테스트 계정은 랭킹에서 제외 (기능은 정상 사용, 랭킹만 "-")
  const testAccountNicknames: Record<string, string[]> = {
    biology: ['빠샤'],
    microbiology: ['test', '콩콩이'],
  };
  const isTestAccount = userCourseId
    ? (testAccountNicknames[userCourseId] || []).includes(profile?.nickname || '')
    : false;
  // classId가 없는 계정 (빈 문자열 또는 undefined)
  const hasNoClass = !profile?.classType;

  const teamRankLabel = loading ? '-' : (hasNoClass || isTestAccount) ? '-' : teamRank > 0 ? `${teamRank}${ordinalSuffix(teamRank)}` : '-';

  return (
    <>
      <button
        onClick={() => {
          if (!loading) {
            if (isWide) {
              // 가로모드: 3쪽 디테일 패널에 랭킹 표시
              openDetail(<RankingBottomSheet isPanelMode isOpen onClose={closeDetail} />);
            } else {
              logOverlay('ranking_open');
              setShowRanking(true);
            }
          }
        }}
        className="w-full px-8 -mt-0.5 active:scale-[0.98] transition-transform"
      >
        <div className="flex items-center justify-center" style={{ gap: Math.round(16 * scale) }}>
          {/* TEAM */}
          <div className="text-center">
            <span className="font-bold text-white/50 tracking-widest" style={{ fontSize: Math.round(10 * scale) }}>TEAM</span>
            <div className="font-black text-white leading-tight" style={{ fontSize: Math.round(36 * scale) }}>{hasNoClass ? '-' : classType}</div>
          </div>

          {/* 구분선 */}
          <div className="w-px bg-white/20" style={{ height: Math.round(32 * scale) }} />

          {/* TEAM RANK */}
          <div className="text-center">
            <span className="font-bold text-white/50 tracking-widest" style={{ fontSize: Math.round(10 * scale) }}>TEAM RANK</span>
            <div className={`font-black text-white leading-tight ${loading ? 'animate-pulse' : ''}`} style={{ fontSize: Math.round(36 * scale) }}>{teamRankLabel}</div>
          </div>

          {/* 구분선 */}
          <div className="w-px bg-white/20" style={{ height: Math.round(32 * scale) }} />

          {/* MY RANK */}
          <div className="text-center">
            <span className="font-bold text-white/50 tracking-widest" style={{ fontSize: Math.round(10 * scale) }}>MY RANK</span>
            <div className="flex items-baseline justify-center">
              <span className={`font-black text-white leading-tight ${loading ? 'animate-pulse' : ''}`} style={{ fontSize: Math.round(36 * scale) }}>
                {loading ? '-' : isTestAccount ? '-' : (personalRank || '-')}
              </span>
              {!loading && !isTestAccount && (
                <span className="font-bold text-white/50 ml-0.5" style={{ fontSize: Math.round(16 * scale) }}>
                  /{totalStudents}
                </span>
              )}
            </div>
          </div>

          {/* 화살표 */}
          <svg className="text-white/50 flex-shrink-0" style={{ width: Math.round(16 * scale), height: Math.round(16 * scale) }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>

      {/* 랭킹 바텀시트 */}
      <RankingBottomSheet
        isOpen={showRanking}
        onClose={() => setShowRanking(false)}
      />
    </>
  );
}

/**
 * 클라이언트 폴백: rankings 문서가 없을 때 직접 계산
 */
async function computeHomeFallback(
  courseId: string,
  myUid: string,
  classType: string,
  setTeamRank: (v: number) => void,
  setPersonalRank: (v: number) => void,
  setTotalStudents: (v: number) => void,
) {
  const users = await userRepo.fetchUsersByCourse(courseId);
  const allUsers: UserDoc[] = users as unknown as UserDoc[];
  const students = allUsers.filter((u) => u.role !== 'professor');
  const professorUids = allUsers.filter((u) => u.role === 'professor').map((u) => u.id);

  if (students.length === 0) return;

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

  // 개인 랭킹
  const ranked = students.map((u) => {
    const exp = u.totalExp || 0;
    const profStat = studentProfStats[u.id] || { correct: 0, attempted: 0 };
    const correctRate = profStat.attempted > 0 ? (profStat.correct / profStat.attempted) * 100 : 0;
    return { id: u.id, classId: u.classId || 'A', rankScore: computeRankScore(correctRate, 0, exp), rank: 0 };
  });
  ranked.sort((a, b) => b.rankScore - a.rankScore);
  ranked.forEach((u, i) => { u.rank = i + 1; });

  const me = ranked.find(u => u.id === myUid);
  if (me) setPersonalRank(me.rank);
  setTotalStudents(students.length);

  // 팀 랭킹
  const classes = ['A', 'B', 'C', 'D'];
  const allExps = students.map((u) => u.totalExp || 0);
  const maxExp = Math.max(...allExps, 1);
  const teamEntries = classes.map(cls => {
    const members = students.filter((u) => u.classId === cls);
    if (members.length === 0) return { classId: cls, score: 0, rank: 0 };

    const avgExp = members.reduce((s: number, u: UserDoc) => s + (u.totalExp || 0), 0) / members.length;
    const normalizedAvgExp = (avgExp / maxExp) * 100;
    const correctRates = members.map((u) => {
      const stat = studentProfStats[u.id];
      if (!stat || stat.attempted === 0) return 0;
      return (stat.correct / stat.attempted) * 100;
    });
    const avgCorrectRate = correctRates.reduce((s, r) => s + r, 0) / correctRates.length;
    let avgCompletionRate = 0;
    if (totalProfQuizzes > 0) {
      const rates = members.map((u) => Math.min(((u.professorQuizzesCompleted || 0) / totalProfQuizzes) * 100, 100));
      avgCompletionRate = rates.reduce((s, r) => s + r, 0) / rates.length;
    }
    return { classId: cls, score: computeTeamScore(normalizedAvgExp, avgCorrectRate, avgCompletionRate), rank: 0 };
  });
  teamEntries.sort((a, b) => b.score - a.score);
  teamEntries.forEach((t, i) => { t.rank = i + 1; });

  const myTeam = teamEntries.find(t => t.classId === classType);
  if (myTeam) setTeamRank(myTeam.rank);

  // 캐시 저장
  const teamRanksMap: Record<string, number> = {};
  teamEntries.forEach(t => { teamRanksMap[t.classId] = t.rank; });
  writeHomeCache(courseId, {
    teamRanks: teamRanksMap,
    personalRank: me?.rank || 0,
    totalStudents: students.length,
  });
}
