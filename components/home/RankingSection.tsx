'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { type ClassType } from '@/styles/themes';

// 순위 접미사
const ordinalSuffix = (n: number) => {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
};

interface UserData {
  id: string;
  classId?: string;
  role?: string;
  totalExp?: number;
  totalCorrect?: number;
  totalAttemptedQuestions?: number;
  professorQuizzesCompleted?: number;
}

/**
 * 백분위 계산 (0~100)
 */
function computePercentile(value: number, allValues: number[]): number {
  if (allValues.length <= 1) return 100;
  const below = allValues.filter(v => v < value).length;
  return (below / (allValues.length - 1)) * 100;
}

/**
 * 랭킹 섹션 컴포넌트 (홈 하단, 흰색 텍스트)
 * TEAM | TEAM RANK | MY RANK | >
 */
export default function RankingSection() {
  const router = useRouter();
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const { classType } = useTheme();

  const [teamRank, setTeamRank] = useState<number>(0);
  const [personalRank, setPersonalRank] = useState<number>(0);
  const [totalStudents, setTotalStudents] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userCourseId || !profile) return;

    const loadRankings = async () => {
      try {
        const usersSnapshot = await getDocs(
          query(collection(db, 'users'), where('courseId', '==', userCourseId))
        );
        const allUsers: UserData[] = usersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        const students = allUsers.filter(u => u.role !== 'professor');

        // 반별 랭킹
        const classes = ['A', 'B', 'C', 'D'];
        const classScores = classes.map(cls => {
          const members = students.filter(u => u.classId === cls);
          if (members.length === 0) return { classId: cls, score: 0 };

          const avgExp = members.reduce((s, u) => s + (u.totalExp || 0), 0) / members.length;
          const maxExp = Math.max(...students.map(u => u.totalExp || 0), 1);
          const normalizedAvgExp = (avgExp / maxExp) * 100;

          const participated = members.filter(u => (u.professorQuizzesCompleted || 0) > 0).length;
          const participationRate = members.length > 0 ? (participated / members.length) * 100 : 0;

          return {
            classId: cls,
            score: normalizedAvgExp * 0.6 + participationRate * 0.4,
          };
        });

        classScores.sort((a, b) => b.score - a.score);
        const myClassRank = classScores.findIndex(c => c.classId === classType) + 1;
        setTeamRank(myClassRank);

        // 개인 랭킹
        const allExps = students.map(u => u.totalExp || 0);
        const allAvgScores = students.map(u => {
          const total = u.totalAttemptedQuestions || 0;
          return total > 0 ? ((u.totalCorrect || 0) / total) * 100 : 0;
        });

        const studentRankScores = students.map(u => {
          const exp = u.totalExp || 0;
          const total = u.totalAttemptedQuestions || 0;
          const avgScore = total > 0 ? ((u.totalCorrect || 0) / total) * 100 : 0;
          const expPercentile = computePercentile(exp, allExps);
          const scorePercentile = computePercentile(avgScore, allAvgScores);
          return { id: u.id, rankScore: scorePercentile * 0.4 + expPercentile * 0.6 };
        });

        studentRankScores.sort((a, b) => b.rankScore - a.rankScore);
        const myRank = studentRankScores.findIndex(s => s.id === profile.uid) + 1;

        setPersonalRank(myRank || students.length);
        setTotalStudents(students.length);
        setLoading(false);
      } catch (error) {
        console.error('랭킹 로드 실패:', error);
        setLoading(false);
      }
    };

    loadRankings();
  }, [userCourseId, profile, classType]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="w-6 h-6 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const teamRankLabel = teamRank > 0 ? `${teamRank}${ordinalSuffix(teamRank)}` : '-';

  return (
    <button
      onClick={() => router.push('/ranking')}
      className="w-full active:scale-[0.98] transition-transform"
    >
      <div className="flex items-center justify-center gap-10">
        {/* TEAM */}
        <div className="text-center">
          <span className="text-xs font-bold text-white/50 tracking-widest">TEAM</span>
          <div className="text-5xl font-black text-white mt-1">{classType}</div>
        </div>

        {/* 구분선 */}
        <div className="w-px h-12 bg-white/20" />

        {/* TEAM RANK */}
        <div className="text-center">
          <span className="text-xs font-bold text-white/50 tracking-widest">TEAM RANK</span>
          <div className="text-5xl font-black text-white mt-1">{teamRankLabel}</div>
        </div>

        {/* 구분선 */}
        <div className="w-px h-12 bg-white/20" />

        {/* MY RANK */}
        <div className="text-center">
          <span className="text-xs font-bold text-white/50 tracking-widest">MY RANK</span>
          <div className="flex items-baseline justify-center mt-1">
            <span className="text-5xl font-black text-white">
              {personalRank || '-'}
            </span>
            <span className="text-lg font-bold text-white/50 ml-1">
              /{totalStudents}
            </span>
          </div>
        </div>

        {/* 화살표 */}
        <svg className="w-5 h-5 text-white/50 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}
