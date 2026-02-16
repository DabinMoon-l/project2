'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';
import Image from 'next/image';
import { db } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { type ClassType } from '@/styles/themes';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';

/**
 * 백분위 계산 (0~100)
 */
function computePercentile(value: number, allValues: number[]): number {
  if (allValues.length <= 1) return 100;
  const below = allValues.filter(v => v < value).length;
  return (below / (allValues.length - 1)) * 100;
}

/**
 * 랭킹 유저 데이터
 */
interface RankedUser {
  id: string;
  nickname: string;
  classType: ClassType;
  totalExp: number;
  avgScore: number;
  rankScore: number;
  profileRabbitId?: number;
  equippedRabbitNames: string;
  rank: number;
}

/**
 * 개인 랭킹 페이지 — 빈티지 신문 스타일
 *
 * 통합 랭킹: scorePercentile * 0.4 + expPercentile * 0.6
 */
export default function RankingPage() {
  const router = useRouter();
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const { theme } = useTheme();

  const [rankedUsers, setRankedUsers] = useState<RankedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRank, setMyRank] = useState<RankedUser | null>(null);

  // 스크롤 업 버튼
  const topSectionRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // 네비게이션 숨김
  useEffect(() => {
    document.body.setAttribute('data-hide-nav', 'true');
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, []);

  // Top 5 가시성 감지
  useEffect(() => {
    const el = topSectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowScrollTop(!entry.isIntersecting);
      },
      { threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // 랭킹 데이터 로드
  useEffect(() => {
    if (!userCourseId || !profile) return;

    const loadRankings = async () => {
      setLoading(true);

      try {
        const snapshot = await getDocs(
          query(collection(db, 'users'), where('courseId', '==', userCourseId))
        );

        const allUsers = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        const students = allUsers.filter(u => (u as any).role !== 'professor');

        const allExps = students.map(u => (u as any).totalExp || 0);
        const allAvgScores = students.map(u => {
          const total = (u as any).totalAttemptedQuestions || 0;
          return total > 0 ? (((u as any).totalCorrect || 0) / total) * 100 : 0;
        });

        // 장착 토끼 ID 수집
        const rabbitDocIds = new Set<string>();
        students.forEach(u => {
          const equipped = (u as any).equippedRabbits || [];
          equipped.forEach((r: any) => {
            if (r.rabbitId > 0 && r.courseId) {
              rabbitDocIds.add(`${r.courseId}_${r.rabbitId}`);
            }
          });
        });

        // 토끼 이름 일괄 조회
        const rabbitNames: Record<string, string> = {};
        const rabbitFetches = Array.from(rabbitDocIds).map(async (docId) => {
          const snap = await getDoc(doc(db, 'rabbits', docId));
          if (snap.exists()) {
            rabbitNames[docId] = snap.data().name || `토끼 #${docId.split('_')[1]}`;
          }
        });
        await Promise.all(rabbitFetches);

        const users: RankedUser[] = students.map(u => {
          const d = u as any;
          const exp = d.totalExp || 0;
          const total = d.totalAttemptedQuestions || 0;
          const avgScore = total > 0 ? ((d.totalCorrect || 0) / total) * 100 : 0;

          const expPercentile = computePercentile(exp, allExps);
          const scorePercentile = computePercentile(avgScore, allAvgScores);
          const rankScore = scorePercentile * 0.4 + expPercentile * 0.6;

          // 장착 토끼 이름
          const equipped = (d.equippedRabbits || []).filter((r: any) => r.rabbitId > 0);
          const names = equipped.map((r: any) => {
            const key = `${r.courseId}_${r.rabbitId}`;
            return rabbitNames[key] || `토끼 #${r.rabbitId}`;
          });
          const equippedRabbitNames = names.length > 0 ? names.join(' & ') : '';

          return {
            id: u.id,
            nickname: d.nickname || '익명',
            classType: d.classId || 'A',
            totalExp: exp,
            avgScore: Math.round(avgScore),
            rankScore,
            profileRabbitId: d.profileRabbitId,
            equippedRabbitNames,
            rank: 0,
          };
        });

        users.sort((a, b) => b.rankScore - a.rankScore);
        users.forEach((user, idx) => {
          user.rank = idx + 1;
        });

        setRankedUsers(users);

        const me = users.find(u => u.id === profile.uid);
        if (me) setMyRank(me);

        setLoading(false);
      } catch (error) {
        console.error('랭킹 로드 실패:', error);
        setLoading(false);
      }
    };

    loadRankings();
  }, [userCourseId, profile]);

  const top3 = rankedUsers.slice(0, 3);
  const restUsers = rankedUsers.slice(3);

  // 순위별 스타일
  const getRankStyle = (rank: number) => {
    if (rank === 1) return { bg: '#1A1A1A', text: '#F5F0E8', label: '1ST' };
    if (rank === 2) return { bg: '#3A3A3A', text: '#F5F0E8', label: '2ND' };
    if (rank === 3) return { bg: '#5C5C5C', text: '#F5F0E8', label: '3RD' };
    return { bg: '#EDEAE4', text: '#1A1A1A', label: `${rank}TH` };
  };

  return (
    <div
      className="min-h-screen pb-28 scrollbar-hide overflow-x-hidden"
      style={{ backgroundColor: '#F5F0E8', overscrollBehavior: 'none' }}
    >
      {/* 헤더 */}
      <header className="mx-4 mt-4 pb-4 border-b-4 border-double border-[#1A1A1A]">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => router.back()}
            className="p-1"
          >
            <svg className="w-6 h-6" fill="none" stroke="#1A1A1A" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* 상단 장식선 */}
        <div className="border-t-2 border-[#1A1A1A] mb-2" />

        <h1 className="font-serif-display text-5xl font-black tracking-tight text-[#1A1A1A] text-center py-4 border-y-4 border-[#1A1A1A]">
          HALL OF FAME
        </h1>

        <p className="text-xs text-[#5C5C5C] text-center mt-3 italic">
          "종합 랭킹 · 성적 40% + 참여도 60%"
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Top 3 섹션 */}
          <div ref={topSectionRef} className="mx-4 mt-4">
            {/* 1위 — 풀 와이드 */}
            {top3[0] && (() => {
              const user = top3[0];
              const style = getRankStyle(1);
              return (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="border-2 border-[#1A1A1A] mb-4"
                  style={{ backgroundColor: style.bg }}
                >
                  <div className="flex items-center gap-4 p-4">
                    {/* 순위 */}
                    <div className="text-center flex-shrink-0">
                      <span className="text-4xl font-black" style={{ color: style.text }}>
                        {style.label}
                      </span>
                    </div>

                    {/* 프로필 */}
                    <div
                      className="w-16 h-16 flex-shrink-0 flex items-center justify-center border-2 overflow-hidden"
                      style={{ borderColor: '#1A1A1A', backgroundColor: '#F5F0E8' }}
                    >
                      {user.profileRabbitId != null ? (
                        <Image src={getRabbitProfileUrl(user.profileRabbitId)} alt="" width={64} height={64} className="w-full h-full object-cover" />
                      ) : (
                        <svg width={32} height={32} viewBox="0 0 24 24" fill="#1A1A1A">
                          <circle cx="12" cy="8" r="4" />
                          <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
                        </svg>
                      )}
                    </div>

                    {/* 정보 */}
                    <div className="flex-1 min-w-0">
                      <p className="text-2xl font-black truncate" style={{ color: style.text }}>
                        {user.nickname} · {user.classType}반
                      </p>
                      {user.equippedRabbitNames && (
                        <p className="text-sm truncate" style={{ color: style.text, opacity: 0.7 }}>
                          {user.equippedRabbitNames}
                        </p>
                      )}
                    </div>

                    {/* 점수 */}
                    <div className="text-right flex-shrink-0">
                      <span className="text-3xl font-black" style={{ color: style.text }}>
                        {Math.round(user.rankScore)}
                      </span>
                      <p className="text-xs" style={{ color: style.text, opacity: 0.7 }}>점</p>
                    </div>
                  </div>
                </motion.div>
              );
            })()}

            {/* 2~3위 — 2열 그리드 */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {top3.slice(1).map((user, idx) => {
                const style = getRankStyle(user.rank);
                return (
                  <motion.div
                    key={user.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: (idx + 1) * 0.1 }}
                    className="border-2 border-[#1A1A1A] p-3"
                    style={{ backgroundColor: style.bg }}
                  >
                    {/* 순위 */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-lg font-black" style={{ color: style.text }}>
                        {style.label}
                      </span>
                      <span className="text-xl font-black" style={{ color: style.text }}>
                        {Math.round(user.rankScore)}점
                      </span>
                    </div>

                    {/* 프로필 + 이름 */}
                    <div className="flex items-center gap-2">
                      <div
                        className="w-10 h-10 flex-shrink-0 flex items-center justify-center border-2 overflow-hidden"
                        style={{ borderColor: '#1A1A1A', backgroundColor: '#F5F0E8' }}
                      >
                        {user.profileRabbitId != null ? (
                          <Image src={getRabbitProfileUrl(user.profileRabbitId)} alt="" width={40} height={40} className="w-full h-full object-cover" />
                        ) : (
                          <svg width={20} height={20} viewBox="0 0 24 24" fill="#1A1A1A">
                            <circle cx="12" cy="8" r="4" />
                            <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate" style={{ color: style.text }}>
                          {user.nickname} · {user.classType}반
                        </p>
                        {user.equippedRabbitNames && (
                          <p className="text-xs truncate" style={{ color: style.text, opacity: 0.7 }}>
                            {user.equippedRabbitNames}
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* 구분선 */}
          <div className="mx-4 border-t-2 border-[#1A1A1A] mb-1" />
          <div className="mx-4 border-t border-[#1A1A1A] mb-4" />

          {/* 나머지 유저 목록 */}
          <div className="mx-4">
            {restUsers.map((user, idx) => (
              <motion.div
                key={user.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.02 }}
                className={`flex items-center gap-3 py-3 border-b border-[#D4CFC4] ${
                  user.id === profile?.uid ? 'bg-[#EDEAE4] -mx-2 px-2' : ''
                }`}
              >
                {/* 순위 */}
                <div className="w-8 text-center font-black text-[#5C5C5C]">
                  {user.rank}
                </div>

                {/* 프로필 */}
                <div
                  className="w-10 h-10 flex items-center justify-center border-2 overflow-hidden flex-shrink-0"
                  style={{ borderColor: '#1A1A1A', backgroundColor: '#F5F0E8' }}
                >
                  {user.profileRabbitId != null ? (
                    <Image src={getRabbitProfileUrl(user.profileRabbitId)} alt="" width={40} height={40} className="w-full h-full object-cover" />
                  ) : (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="#1A1A1A">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
                    </svg>
                  )}
                </div>

                {/* 정보 */}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[#1A1A1A] truncate">
                    {user.nickname} · {user.classType}반
                  </p>
                  {user.equippedRabbitNames ? (
                    <p className="text-xs text-[#5C5C5C] truncate">{user.equippedRabbitNames}</p>
                  ) : (
                    <p className="text-xs text-[#5C5C5C]">{user.totalExp.toLocaleString()} XP</p>
                  )}
                </div>

                {/* 종합 점수 */}
                <div className="text-right flex-shrink-0">
                  <p className="font-black text-[#1A1A1A]">
                    {Math.round(user.rankScore)}점
                  </p>
                </div>
              </motion.div>
            ))}

            {rankedUsers.length === 0 && (
              <div className="text-center py-12">
                <h3 className="font-serif-display text-2xl font-black mb-2 text-[#1A1A1A]">
                  NO DATA YET
                </h3>
                <p className="text-sm text-[#5C5C5C]">아직 랭킹 데이터가 없습니다.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* 하단 고정: 내 순위 */}
      {myRank && (
        <div
          className="fixed bottom-0 left-0 right-0 border-t-2 border-[#1A1A1A] p-4 z-30"
          style={{ backgroundColor: '#F5F0E8', boxShadow: '0 -4px 6px rgba(0,0,0,0.1)' }}
        >
          <div className="flex items-center gap-3">
            {/* 순위 */}
            <div
              className="w-12 h-12 flex items-center justify-center font-black text-xl"
              style={{
                backgroundColor: '#1A1A1A',
                color: '#F5F0E8',
              }}
            >
              {myRank.rank}
            </div>

            {/* 프로필 */}
            <div
              className="w-10 h-10 flex items-center justify-center border-2 border-[#1A1A1A] overflow-hidden flex-shrink-0"
              style={{ backgroundColor: '#F5F0E8' }}
            >
              {myRank.profileRabbitId != null ? (
                <Image src={getRabbitProfileUrl(myRank.profileRabbitId)} alt="" width={40} height={40} className="w-full h-full object-cover" />
              ) : (
                <svg width={20} height={20} viewBox="0 0 24 24" fill="#1A1A1A">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
                </svg>
              )}
            </div>

            {/* 정보 */}
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[#1A1A1A] truncate">
                {myRank.nickname} · {myRank.classType}반
              </p>
              {myRank.equippedRabbitNames ? (
                <p className="text-xs text-[#5C5C5C] truncate">{myRank.equippedRabbitNames}</p>
              ) : (
                <p className="text-xs text-[#5C5C5C]">{myRank.totalExp.toLocaleString()} XP</p>
              )}
            </div>

            {/* 종합 점수 */}
            <div className="text-right flex-shrink-0">
              <p className="text-xl font-black text-[#1A1A1A]">
                {Math.round(myRank.rankScore)}점
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 스크롤 맨 위로 버튼 */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={scrollToTop}
            className="fixed bottom-24 right-4 z-40 w-12 h-12 bg-[#1A1A1A] text-[#F5F0E8] flex items-center justify-center shadow-lg hover:bg-[#3A3A3A] transition-colors"
            aria-label="맨 위로"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 10l7-7m0 0l7 7m-7-7v18"
              />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
