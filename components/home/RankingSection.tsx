'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { classColors, type ClassType } from '@/styles/themes';

/**
 * 반별 랭킹 데이터
 */
interface ClassRanking {
  classType: ClassType;
  gradeRank: number; // 성적 순위
  participationRank: number; // 참여도 순위
  averageScore: number;
  totalExp: number;
}

/**
 * 개인 랭킹 데이터
 */
interface PersonalRanking {
  rank: number;
  totalCount: number;
  rankType: 'grade' | 'participation';
}

/**
 * 랭킹 섹션 컴포넌트
 * - 반별 순위 (성적/참여도)
 * - 개인 순위 (터치 시 랭킹 페이지로 이동)
 */
export default function RankingSection() {
  const router = useRouter();
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const { theme, classType } = useTheme();

  const [classRankings, setClassRankings] = useState<ClassRanking[]>([]);
  const [personalRanking, setPersonalRanking] = useState<PersonalRanking | null>(null);
  const [loading, setLoading] = useState(true);
  const [rankType, setRankType] = useState<'grade' | 'participation'>('participation');

  // 랭킹 데이터 로드
  useEffect(() => {
    if (!userCourseId || !profile) return;

    const loadRankings = async () => {
      try {
        // 1. 모든 사용자 데이터 가져오기 (같은 과목)
        const usersQuery = query(
          collection(db, 'users'),
          where('courseId', '==', userCourseId)
        );
        const usersSnapshot = await getDocs(usersQuery);
        const users = usersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as any[];

        // 2. 반별 통계 계산
        const classStats: Record<ClassType, { totalExp: number; count: number; totalScore: number }> = {
          A: { totalExp: 0, count: 0, totalScore: 0 },
          B: { totalExp: 0, count: 0, totalScore: 0 },
          C: { totalExp: 0, count: 0, totalScore: 0 },
          D: { totalExp: 0, count: 0, totalScore: 0 },
        };

        users.forEach(user => {
          if (user.classType && classStats[user.classType as ClassType]) {
            classStats[user.classType as ClassType].totalExp += user.totalExp || 0;
            classStats[user.classType as ClassType].count += 1;
            classStats[user.classType as ClassType].totalScore += user.averageQuizScore || 0;
          }
        });

        // 3. 반별 평균 계산 및 순위 정렬
        const classRankingData: ClassRanking[] = (['A', 'B', 'C', 'D'] as ClassType[]).map(cls => ({
          classType: cls,
          gradeRank: 0,
          participationRank: 0,
          averageScore: classStats[cls].count > 0
            ? Math.round(classStats[cls].totalScore / classStats[cls].count)
            : 0,
          totalExp: classStats[cls].totalExp,
        }));

        // 성적 순위 계산
        const byGrade = [...classRankingData].sort((a, b) => b.averageScore - a.averageScore);
        byGrade.forEach((cls, idx) => {
          const found = classRankingData.find(c => c.classType === cls.classType);
          if (found) found.gradeRank = idx + 1;
        });

        // 참여도 순위 계산
        const byParticipation = [...classRankingData].sort((a, b) => b.totalExp - a.totalExp);
        byParticipation.forEach((cls, idx) => {
          const found = classRankingData.find(c => c.classType === cls.classType);
          if (found) found.participationRank = idx + 1;
        });

        setClassRankings(classRankingData);

        // 4. 개인 순위 계산 (참여도 기준)
        const sortedByExp = [...users].sort((a, b) => (b.totalExp || 0) - (a.totalExp || 0));
        const myRank = sortedByExp.findIndex(u => u.id === profile.uid) + 1;

        setPersonalRanking({
          rank: myRank || users.length,
          totalCount: users.length,
          rankType: 'participation',
        });

        setLoading(false);
      } catch (error) {
        console.error('랭킹 로드 실패:', error);
        setLoading(false);
      }
    };

    loadRankings();
  }, [userCourseId, profile]);

  // 현재 반의 순위 가져오기
  const myClassRanking = classRankings.find(c => c.classType === classType);

  // 순위 서픽스
  const getOrdinalSuffix = (n: number) => {
    if (n === 1) return 'st';
    if (n === 2) return 'nd';
    if (n === 3) return 'rd';
    return 'th';
  };

  if (loading) {
    return (
      <div className="p-4 border-2 border-[#1A1A1A] bg-[#EDEAE4]">
        <div className="flex items-center justify-center py-4">
          <div className="w-6 h-6 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 border-2 border-[#1A1A1A] bg-[#EDEAE4]">
      <div className="flex items-center gap-4">
        {/* 반별 랭킹 */}
        <div className="flex-1 flex items-center gap-3">
          {/* 트로피 아이콘 */}
          <span className="text-2xl">🏆</span>

          {/* 반별 순위 */}
          <div className="flex items-center gap-2">
            {/* 성적 순위 */}
            <div className="text-center">
              <p className="text-[10px] text-[#5C5C5C] mb-0.5">성적</p>
              <div className="flex items-baseline" style={{ color: classColors[classType] }}>
                <span className="text-2xl font-black">{myClassRanking?.gradeRank || '-'}</span>
                <span className="text-xs font-bold">
                  {myClassRanking ? getOrdinalSuffix(myClassRanking.gradeRank) : ''}
                </span>
              </div>
            </div>

            <div className="w-px h-8 bg-[#D4CFC4]" />

            {/* 참여도 순위 */}
            <div className="text-center">
              <p className="text-[10px] text-[#5C5C5C] mb-0.5">참여도</p>
              <div className="flex items-baseline" style={{ color: classColors[classType] }}>
                <span className="text-2xl font-black">{myClassRanking?.participationRank || '-'}</span>
                <span className="text-xs font-bold">
                  {myClassRanking ? getOrdinalSuffix(myClassRanking.participationRank) : ''}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 구분선 */}
        <div className="w-px h-12 bg-[#1A1A1A]" />

        {/* 개인 랭킹 */}
        <button
          onClick={() => router.push('/ranking')}
          className="flex items-center gap-3 px-3 py-2 hover:bg-[#E5E0D8] transition-colors"
        >
          {/* 개인 아이콘 */}
          <span className="text-2xl">👤</span>

          {/* 개인 순위 */}
          <div className="text-center">
            <p className="text-[10px] text-[#5C5C5C] mb-0.5">내 순위</p>
            <div className="flex items-baseline text-[#1A1A1A]">
              <span className="text-2xl font-black">{personalRanking?.rank || '-'}</span>
              <span className="text-xs font-bold">
                {personalRanking ? getOrdinalSuffix(personalRanking.rank) : ''}
              </span>
              <span className="text-xs text-[#5C5C5C] ml-1">
                /{personalRanking?.totalCount || 0}명
              </span>
            </div>
          </div>

          {/* 화살표 */}
          <svg className="w-5 h-5 text-[#5C5C5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
