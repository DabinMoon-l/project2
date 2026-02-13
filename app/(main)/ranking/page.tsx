'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { classColors, type ClassType } from '@/styles/themes';

/**
 * 랭킹 유저 데이터
 */
interface RankedUser {
  id: string;
  nickname: string;
  classType: ClassType;
  characterName: string;
  totalExp: number;
  averageQuizScore: number;
  rank: number;
}

/**
 * 개인 랭킹 페이지
 *
 * - 상단: 성적/참여도 필터 탭
 * - Top 5: 어벤져스 스타일 (캐릭터 + 배경)
 * - 목록: 프로필, 닉네임, 반, 캐릭터이름
 * - 하단 고정: 내 순위
 * - 네비게이션 숨김
 */
export default function RankingPage() {
  const router = useRouter();
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const { theme } = useTheme();

  const [rankType, setRankType] = useState<'grade' | 'participation'>('participation');
  const [rankedUsers, setRankedUsers] = useState<RankedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRank, setMyRank] = useState<RankedUser | null>(null);

  // 네비게이션 숨김
  useEffect(() => {
    document.body.setAttribute('data-hide-nav', 'true');
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, []);

  // 랭킹 데이터 로드
  useEffect(() => {
    if (!userCourseId || !profile) return;

    const loadRankings = async () => {
      setLoading(true);

      try {
        const usersQuery = query(
          collection(db, 'users'),
          where('courseId', '==', userCourseId)
        );
        const snapshot = await getDocs(usersQuery);

        let users = snapshot.docs.map(doc => ({
          id: doc.id,
          nickname: doc.data().nickname || '익명',
          classType: doc.data().classType || 'A',
          characterName: doc.data().currentCharacterName || '기본토끼',
          totalExp: doc.data().totalExp || 0,
          averageQuizScore: doc.data().averageQuizScore || 0,
          rank: 0,
        })) as RankedUser[];

        // 정렬
        if (rankType === 'participation') {
          users.sort((a, b) => b.totalExp - a.totalExp);
        } else {
          users.sort((a, b) => b.averageQuizScore - a.averageQuizScore);
        }

        // 순위 부여
        users.forEach((user, idx) => {
          user.rank = idx + 1;
        });

        setRankedUsers(users);

        // 내 순위 찾기
        const me = users.find(u => u.id === profile.uid);
        if (me) {
          setMyRank(me);
        }

        setLoading(false);
      } catch (error) {
        console.error('랭킹 로드 실패:', error);
        setLoading(false);
      }
    };

    loadRankings();
  }, [userCourseId, profile, rankType]);

  // Top 5 유저
  const top5 = rankedUsers.slice(0, 5);
  // 나머지 유저
  const restUsers = rankedUsers.slice(5);

  // 순위 메달
  const getMedal = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `${rank}`;
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* 헤더 */}
      <header className="flex items-center gap-3 px-4 py-3 border-b-2 border-[#1A1A1A]">
        <button
          onClick={() => router.back()}
          className="p-1"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold">개인 랭킹</h1>
      </header>

      {/* 필터 탭 */}
      <div className="flex border-b border-[#D4CFC4]">
        <button
          onClick={() => setRankType('participation')}
          className={`flex-1 py-3 text-center font-bold transition-colors ${
            rankType === 'participation'
              ? 'text-[#1A1A1A] border-b-2 border-[#1A1A1A]'
              : 'text-[#5C5C5C]'
          }`}
        >
          참여도
        </button>
        <button
          onClick={() => setRankType('grade')}
          className={`flex-1 py-3 text-center font-bold transition-colors ${
            rankType === 'grade'
              ? 'text-[#1A1A1A] border-b-2 border-[#1A1A1A]'
              : 'text-[#5C5C5C]'
          }`}
        >
          성적
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pb-24">
          {/* Top 5 어벤져스 스타일 */}
          <div
            className="relative h-48 mb-4"
            style={{
              background: 'linear-gradient(180deg, #1A1A1A 0%, #3A3A3A 100%)',
            }}
          >
            {/* 배경 placeholder */}
            <div className="absolute inset-0 flex items-end justify-center gap-2 pb-4">
              {top5.map((user, idx) => {
                // 순위별 높이 및 위치
                const heights = [120, 100, 80, 70, 60];
                const orders = [2, 1, 0, 3, 4]; // 중앙 정렬을 위한 순서

                return (
                  <motion.div
                    key={user.id}
                    initial={{ y: 50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: idx * 0.1 }}
                    className="flex flex-col items-center"
                    style={{
                      order: orders[idx],
                      height: heights[idx],
                    }}
                  >
                    {/* 순위 */}
                    <span className="text-2xl mb-1">{getMedal(user.rank)}</span>

                    {/* 캐릭터 placeholder */}
                    <div
                      className="w-12 h-12 flex items-center justify-center text-3xl border-2"
                      style={{
                        borderColor: classColors[user.classType],
                        backgroundColor: '#F5F0E8',
                      }}
                    >
                      🐰
                    </div>

                    {/* 이름 */}
                    <p className="text-xs text-white mt-1 truncate max-w-[60px] text-center">
                      {user.nickname}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* 나머지 유저 목록 */}
          <div className="px-4">
            {restUsers.map((user) => (
              <div
                key={user.id}
                className={`flex items-center gap-3 py-3 border-b border-[#D4CFC4] ${
                  user.id === profile?.uid ? 'bg-[#EDEAE4]' : ''
                }`}
              >
                {/* 순위 */}
                <div className="w-8 text-center font-bold text-[#5C5C5C]">
                  {user.rank}
                </div>

                {/* 프로필 */}
                <div
                  className="w-10 h-10 flex items-center justify-center text-xl border"
                  style={{ borderColor: classColors[user.classType] }}
                >
                  🐰
                </div>

                {/* 정보 */}
                <div className="flex-1">
                  <p className="font-bold text-[#1A1A1A]">{user.nickname}</p>
                  <p className="text-xs text-[#5C5C5C]">
                    {user.classType}반 · {user.characterName}
                  </p>
                </div>

                {/* 점수 */}
                <div className="text-right">
                  <p className="font-bold text-[#1A1A1A]">
                    {rankType === 'participation'
                      ? `${user.totalExp.toLocaleString()} XP`
                      : `${user.averageQuizScore}점`}
                  </p>
                </div>
              </div>
            ))}

            {rankedUsers.length === 0 && (
              <div className="text-center py-12 text-[#5C5C5C]">
                아직 랭킹 데이터가 없습니다.
              </div>
            )}
          </div>
        </div>
      )}

      {/* 하단 고정: 내 순위 */}
      {myRank && (
        <div
          className="fixed bottom-0 left-0 right-0 border-t-2 border-[#1A1A1A] bg-[#F5F0E8] p-4"
          style={{ boxShadow: '0 -4px 6px rgba(0,0,0,0.1)' }}
        >
          <div className="flex items-center gap-3">
            {/* 순위 */}
            <div
              className="w-12 h-12 flex items-center justify-center font-black text-xl"
              style={{
                backgroundColor: theme.colors.accent,
                color: '#F5F0E8',
              }}
            >
              {myRank.rank}
            </div>

            {/* 프로필 */}
            <div
              className="w-10 h-10 flex items-center justify-center text-xl border-2 border-[#1A1A1A]"
            >
              🐰
            </div>

            {/* 정보 */}
            <div className="flex-1">
              <p className="font-bold text-[#1A1A1A]">{myRank.nickname}</p>
              <p className="text-xs text-[#5C5C5C]">
                {myRank.classType}반 · {myRank.characterName}
              </p>
            </div>

            {/* 점수 */}
            <div className="text-right">
              <p className="font-bold text-[#1A1A1A]">
                {rankType === 'participation'
                  ? `${myRank.totalExp.toLocaleString()} XP`
                  : `${myRank.averageQuizScore}점`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
