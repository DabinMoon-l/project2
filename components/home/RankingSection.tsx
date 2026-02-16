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

// Team PNG 매핑
const teamImages: Record<ClassType, string> = {
  A: '/images/team_a.png',
  B: '/images/team_b.png',
  C: '/images/team_c.png',
  D: '/images/team_d.png',
};

// 순위 PNG 매핑
const rankImages: Record<number, string> = {
  1: '/images/1st.png',
  2: '/images/2nd.png',
  3: '/images/3rd.png',
  4: '/images/4th.png',
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
 * 자신보다 낮은 값을 가진 사람 수 / (전체-1) * 100
 */
function computePercentile(value: number, allValues: number[]): number {
  if (allValues.length <= 1) return 100;
  const below = allValues.filter(v => v < value).length;
  return (below / (allValues.length - 1)) * 100;
}

/**
 * 랭킹 섹션 컴포넌트 (리디자인)
 *
 * - 반 대항 랭킹: normalizedAvgExp * 0.6 + participationRate * 0.4
 *   참여율 = 교수 출제 퀴즈 기준 응시율
 * - 개인 랭킹: scorePercentile * 0.4 + expPercentile * 0.6
 * - PNG 에셋으로 팀/순위 표시
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
        // 1. 같은 과목의 모든 사용자 가져오기
        const usersSnapshot = await getDocs(
          query(collection(db, 'users'), where('courseId', '==', userCourseId))
        );
        const allUsers: UserData[] = usersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        const professorIds = new Set(
          allUsers.filter(u => u.role === 'professor').map(p => p.id)
        );
        const students = allUsers.filter(u => u.role !== 'professor');

        // 2. 교수 출제 퀴즈 수 가져오기
        const quizzesSnapshot = await getDocs(
          query(collection(db, 'quizzes'), where('courseId', '==', userCourseId))
        );
        const totalProfQuizzes = quizzesSnapshot.docs.filter(doc =>
          professorIds.has(doc.data().creatorId)
        ).length;

        // ── 반 대항 랭킹 ──
        // classScore = normalizedAvgExp * 0.6 + participationRate * 0.4
        const classStats: Record<string, { totalExp: number; count: number; profQuizSum: number }> = {};
        for (const cls of ['A', 'B', 'C', 'D']) {
          classStats[cls] = { totalExp: 0, count: 0, profQuizSum: 0 };
        }

        students.forEach(user => {
          const cls = user.classId;
          if (cls && classStats[cls]) {
            classStats[cls].totalExp += user.totalExp || 0;
            classStats[cls].count += 1;
            classStats[cls].profQuizSum += user.professorQuizzesCompleted || 0;
          }
        });

        // 반별 평균 EXP
        const classAvgExp: Record<string, number> = {};
        let maxAvgExp = 0;
        for (const cls of ['A', 'B', 'C', 'D']) {
          const s = classStats[cls];
          classAvgExp[cls] = s.count > 0 ? s.totalExp / s.count : 0;
          maxAvgExp = Math.max(maxAvgExp, classAvgExp[cls]);
        }

        // 반별 종합 점수 + 순위
        const classScores: { cls: string; score: number }[] = [];
        for (const cls of ['A', 'B', 'C', 'D']) {
          const s = classStats[cls];
          const normalizedExp = maxAvgExp > 0 ? classAvgExp[cls] / maxAvgExp : 0;
          const participationRate = (totalProfQuizzes > 0 && s.count > 0)
            ? s.profQuizSum / (totalProfQuizzes * s.count)
            : 0;
          const score = normalizedExp * 0.6 + participationRate * 0.4;
          classScores.push({ cls, score });
        }

        classScores.sort((a, b) => b.score - a.score);
        const myTeamRank = classScores.findIndex(c => c.cls === classType) + 1;
        setTeamRank(myTeamRank || 4);

        // ── 개인 랭킹 ──
        // rankScore = scorePercentile * 0.4 + expPercentile * 0.6
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

          return {
            id: u.id,
            rankScore: scorePercentile * 0.4 + expPercentile * 0.6,
          };
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
      <div className="flex items-center justify-center py-8 px-8">
        <div className="w-6 h-6 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-8">
      {/* 라벨 행 */}
      <div className="flex items-center mb-2">
        <div className="flex-1 text-center">
          <span className="text-sm font-bold text-[#5C5C5C] tracking-widest">TEAM</span>
        </div>
        <div className="w-px h-4" />
        <div className="flex-1 text-center">
          <span className="text-sm font-bold text-[#5C5C5C] tracking-widest">TEAM RANK</span>
        </div>
        <div className="w-px h-4" />
        <div className="flex-1 text-center">
          <span className="text-sm font-bold text-[#5C5C5C] tracking-widest">MY RANK</span>
        </div>
      </div>

      {/* 콘텐츠 행 */}
      <div className="flex items-center">
        {/* Team 이미지 */}
        <div className="flex-1 flex justify-center">
          <img
            src={teamImages[classType]}
            alt={`Team ${classType}`}
            className="w-36 h-36 object-contain"
          />
        </div>

        {/* 구분선 */}
        <div className="w-px h-36 bg-[#D4CFC4]" />

        {/* 순위 이미지 */}
        <div className="flex-1 flex justify-center">
          {teamRank >= 1 && teamRank <= 4 ? (
            <img
              src={rankImages[teamRank]}
              alt={`${teamRank}위`}
              className="w-36 h-36 object-contain"
            />
          ) : (
            <span className="text-5xl font-black text-[#1A1A1A]">-</span>
          )}
        </div>

        {/* 구분선 */}
        <div className="w-px h-36 bg-[#D4CFC4]" />

        {/* 개인 랭킹 — 클릭 가능 버튼 */}
        <button
          onClick={() => router.push('/ranking')}
          className="flex-1 h-36 flex flex-col items-center justify-center active:scale-95 transition-transform"
        >
          <div className="flex items-baseline text-[#1A1A1A]">
            <span className="text-6xl font-black">{personalRank || '-'}</span>
            <span className="text-lg font-bold text-[#5C5C5C] ml-1">
              /{totalStudents}
            </span>
          </div>
          <span className="text-base text-[#5C5C5C] mt-3">- 더보기 -</span>
        </button>
      </div>
    </div>
  );
}
