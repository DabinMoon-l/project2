'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { readHomeCache, writeHomeCache } from '@/lib/utils/rankingCache';
import { computeRankScore, computeTeamScore } from '@/lib/utils/ranking';

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
  const router = useRouter();
  const { profile } = useUser();
  const { userCourseId: contextCourseId } = useCourse();
  const userCourseId = overrideCourseId ?? contextCourseId;
  const { classType } = useTheme();

  const [teamRank, setTeamRank] = useState<number>(0);
  const [personalRank, setPersonalRank] = useState<number>(0);
  const [totalStudents, setTotalStudents] = useState<number>(0);
  const [loading, setLoading] = useState(true);

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

    // 2. Firestore rankings/{courseId} 문서 1개 읽기
    const loadRankings = async () => {
      try {
        const rankDoc = await getDoc(doc(db, 'rankings', userCourseId));

        if (rankDoc.exists()) {
          const data = rankDoc.data();
          const rankedUsers = data.rankedUsers || [];
          const teamRanksArr = data.teamRanks || [];

          // 팀 랭킹
          const myTeam = teamRanksArr.find((t: any) => t.classId === classType);
          if (myTeam) setTeamRank(myTeam.rank);

          // 개인 랭킹
          const me = rankedUsers.find((u: any) => u.id === profile.uid);
          if (me) setPersonalRank(me.rank);
          setTotalStudents(data.totalStudents || rankedUsers.length);

          // sessionStorage 캐시 갱신
          const teamRanksMap: Record<string, number> = {};
          teamRanksArr.forEach((t: any) => { teamRanksMap[t.classId] = t.rank; });

          writeHomeCache(userCourseId, {
            teamRanks: teamRanksMap,
            personalRank: me?.rank || 0,
            totalStudents: data.totalStudents || rankedUsers.length,
          });
        } else {
          // rankings 문서 없음 → 클라이언트 폴백
          await computeHomeFallback(userCourseId, profile.uid, classType, setTeamRank, setPersonalRank, setTotalStudents);
        }

        setLoading(false);
      } catch (error) {
        console.error('랭킹 로드 실패:', error);
        setLoading(false);
      }
    };

    loadRankings();
  }, [userCourseId, profile, classType]);

  const teamRankLabel = loading ? '-' : teamRank > 0 ? `${teamRank}${ordinalSuffix(teamRank)}` : '-';

  return (
    <button
      onClick={() => !loading && router.push('/ranking')}
      className="w-full active:scale-[0.98] transition-transform"
    >
      <div className="flex items-center justify-center gap-7">
        {/* TEAM */}
        <div className="text-center">
          <span className="text-base font-bold text-white/50 tracking-widest">TEAM</span>
          <div className="text-6xl font-black text-white mt-1">{classType}</div>
        </div>

        {/* 구분선 */}
        <div className="w-px h-14 bg-white/20" />

        {/* TEAM RANK */}
        <div className="text-center">
          <span className="text-base font-bold text-white/50 tracking-widest">TEAM RANK</span>
          <div className={`text-6xl font-black text-white mt-1 ${loading ? 'animate-pulse' : ''}`}>{teamRankLabel}</div>
        </div>

        {/* 구분선 */}
        <div className="w-px h-14 bg-white/20" />

        {/* MY RANK */}
        <div className="text-center">
          <span className="text-base font-bold text-white/50 tracking-widest">MY RANK</span>
          <div className="flex items-baseline justify-center mt-1">
            <span className={`text-6xl font-black text-white ${loading ? 'animate-pulse' : ''}`}>
              {loading ? '-' : (personalRank || '-')}
            </span>
            {!loading && (
              <span className="text-xl font-bold text-white/50 ml-1">
                /{totalStudents}
              </span>
            )}
          </div>
        </div>

        {/* 화살표 */}
        <svg className="w-6 h-6 text-white/50 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
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
  const usersSnap = await getDocs(query(collection(db, 'users'), where('courseId', '==', courseId)));
  const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  const students = allUsers.filter((u: any) => u.role !== 'professor');
  const professorUids = allUsers.filter((u: any) => u.role === 'professor').map((u: any) => u.id);

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
  const ranked = students.map((u: any) => {
    const exp = u.totalExp || 0;
    const profStat = studentProfStats[u.id] || { correct: 0, attempted: 0 };
    return { id: u.id, classId: u.classId || 'A', rankScore: computeRankScore(profStat.correct, exp), rank: 0 };
  });
  ranked.sort((a, b) => b.rankScore - a.rankScore);
  ranked.forEach((u, i) => { u.rank = i + 1; });

  const me = ranked.find(u => u.id === myUid);
  if (me) setPersonalRank(me.rank);
  setTotalStudents(students.length);

  // 팀 랭킹
  const classes = ['A', 'B', 'C', 'D'];
  const allExps = students.map((u: any) => u.totalExp || 0);
  const maxExp = Math.max(...allExps, 1);
  const teamEntries = classes.map(cls => {
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
