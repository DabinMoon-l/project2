'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import Image from 'next/image';
import { db, functions } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { type ClassType } from '@/styles/themes';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import { getRabbitImageSrc } from '@/lib/utils/rabbitImage';
import { readFullCache, writeFullCache } from '@/lib/utils/rankingCache';
import { computeRankScore } from '@/lib/utils/ranking';

/**
 * 랭킹 유저 데이터
 */
interface RankedUser {
  id: string;
  nickname: string;
  classType: ClassType;
  totalExp: number;
  profCorrectCount: number;
  rankScore: number;
  profileRabbitId?: number;
  equippedRabbitNames: string;
  firstEquippedRabbitId?: number;
  firstEquippedRabbitName?: string;
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
  const [showInfo, setShowInfo] = useState(false);

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

  // Top 3 가시성 감지 — 로딩 완료 후 observer 연결
  useEffect(() => {
    if (loading) return;
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
  }, [loading]);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // 랭킹 데이터 로드 — rankings/{courseId} 문서 1개만 읽기
  useEffect(() => {
    if (!userCourseId || !profile) return;

    // 1. sessionStorage 캐시에서 즉시 표시
    const { data: cached, isFresh } = readFullCache(userCourseId);
    if (cached) {
      const users = cached.rankedUsers as RankedUser[];
      setRankedUsers(users);
      const me = users.find(u => u.id === profile.uid);
      if (me) setMyRank(me);
      setLoading(false);
      if (isFresh) return;
    }

    // 2. Firestore rankings/{courseId} 문서 읽기
    const loadRankings = async () => {
      if (!cached) setLoading(true);

      try {
        const rankDoc = await getDoc(doc(db, 'rankings', userCourseId));

        if (rankDoc.exists()) {
          const data = rankDoc.data();
          const users = (data.rankedUsers || []) as RankedUser[];

          setRankedUsers(users);
          const me = users.find(u => u.id === profile.uid);
          if (me) setMyRank(me);

          // sessionStorage 캐시 갱신
          writeFullCache(userCourseId, { rankedUsers: users });
        } else {
          // 문서 없으면 Cloud Function 호출 시도 → 실패 시 클라이언트 폴백
          let generated = false;
          try {
            const refresh = httpsCallable(functions, 'refreshRankings');
            await refresh({ courseId: userCourseId });
            const retryDoc = await getDoc(doc(db, 'rankings', userCourseId));
            if (retryDoc.exists()) {
              const users = (retryDoc.data().rankedUsers || []) as RankedUser[];
              setRankedUsers(users);
              const me = users.find(u => u.id === profile.uid);
              if (me) setMyRank(me);
              writeFullCache(userCourseId, { rankedUsers: users });
              generated = true;
            }
          } catch {
            // Cloud Function 미배포 — 클라이언트 폴백
          }

          if (!generated) {
            const users = await computeRankingsClientSide(userCourseId);
            setRankedUsers(users);
            const me = users.find(u => u.id === profile.uid);
            if (me) setMyRank(me);
            if (users.length > 0) {
              writeFullCache(userCourseId, { rankedUsers: users });
            }
          }
        }

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

  return (
    <div className="relative min-h-screen pb-28 scrollbar-hide overflow-x-hidden" style={{ overscrollBehavior: 'none' }}>
      {/* 배경 이미지 + 글래스 오버레이 */}
      <div className="fixed inset-0">
        <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
      </div>
      <div className="fixed inset-0 bg-white/10 backdrop-blur-2xl" />

      {/* 헤더 */}
      <header className="relative z-10 pt-4">
        <div className="px-4 mb-0 flex items-center justify-between">
          <button
            onClick={() => setShowInfo(true)}
            className="w-10 h-10 flex items-center justify-center border-2 border-white/30 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            aria-label="랭킹 안내"
          >
            <span className="text-lg font-black text-white leading-none">i</span>
          </button>
          <button
            onClick={() => router.back()}
            className="w-10 h-10 flex items-center justify-center"
            aria-label="닫기"
          >
            <svg className="w-7 h-7 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* 배너 — 좌우 꽉 채움 */}
        <div className="relative leading-[0] mt-1" style={{ transform: 'scaleY(1.2)', transformOrigin: 'top' }}>
          <img
            src="/images/rank_banner.png"
            alt="랭킹 배너"
            className="w-full block"
          />
          {/* 1위 닉네임 — 축/하 사이 중앙 */}
          {!loading && rankedUsers[0] && (
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none px-[20%]"
              style={{ zIndex: 10, paddingTop: '8px' }}
            >
              <span className="text-[2.1rem] leading-normal font-sans text-[#1A1A1A] truncate" style={{ fontWeight: 900 }}>
                {rankedUsers[0].nickname}
              </span>
            </div>
          )}
        </div>
      </header>

      {loading ? (
        <div className="relative z-10 flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Top 3 단상 섹션 — 토끼 오버플로우 공간 확보 */}
          <div ref={topSectionRef} className="relative z-10 mx-4 mt-[220px] mb-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {/* 단상 + 토끼 (텍스트는 단상 아래) */}
              <div className="relative">
                <img
                  src="/images/rank.png"
                  alt="단상"
                  className="w-full block"
                />

                {/* 2위 토끼 — 왼쪽 스텝 */}
                {top3[1] && (
                  <div className="absolute z-10 flex justify-center" style={{ left: '5%', width: '30%', bottom: '63%' }}>
                    <PodiumRabbit rabbitId={top3[1].firstEquippedRabbitId} size={80} />
                  </div>
                )}

                {/* 1위 토끼 — 가운데 스텝 */}
                {top3[0] && (
                  <div className="absolute z-10 flex justify-center" style={{ left: '33%', width: '34%', bottom: '96%' }}>
                    <PodiumRabbit rabbitId={top3[0].firstEquippedRabbitId} size={100} />
                  </div>
                )}

                {/* 3위 토끼 — 오른쪽 스텝 */}
                {top3[2] && (
                  <div className="absolute z-10 flex justify-center" style={{ left: '65%', width: '30%', bottom: '61%' }}>
                    <PodiumRabbit rabbitId={top3[2].firstEquippedRabbitId} size={80} />
                  </div>
                )}
              </div>

              {/* Top3 유저 정보 — 단상 아래 3열 */}
              <div className="grid grid-cols-3 gap-1 mt-3">
                {/* 2위 */}
                <div className="text-center">
                  {top3[1] && (
                    <>
                      <p className="text-base font-black text-white truncate">{top3[1].nickname}</p>
                      <p className="text-sm text-white/60">{top3[1].classType}반 · {Math.round(top3[1].rankScore)}점</p>
                      {top3[1].equippedRabbitNames && (
                        <p className="text-sm text-white/60 truncate">{top3[1].equippedRabbitNames}</p>
                      )}
                    </>
                  )}
                </div>
                {/* 1위 */}
                <div className="text-center">
                  {top3[0] && (
                    <>
                      <p className="text-lg font-black text-white truncate">{top3[0].nickname}</p>
                      <p className="text-sm text-white/60">{top3[0].classType}반 · {Math.round(top3[0].rankScore)}점</p>
                      {top3[0].equippedRabbitNames && (
                        <p className="text-sm text-white/60 truncate">{top3[0].equippedRabbitNames}</p>
                      )}
                    </>
                  )}
                </div>
                {/* 3위 */}
                <div className="text-center">
                  {top3[2] && (
                    <>
                      <p className="text-base font-black text-white truncate">{top3[2].nickname}</p>
                      <p className="text-sm text-white/60">{top3[2].classType}반 · {Math.round(top3[2].rankScore)}점</p>
                      {top3[2].equippedRabbitNames && (
                        <p className="text-sm text-white/60 truncate">{top3[2].equippedRabbitNames}</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </div>

          {/* 구분선 */}
          <div className="relative z-10 mx-4 border-t-2 border-white/30 mb-1" />
          <div className="relative z-10 mx-4 border-t border-white/20 mb-4" />

          {/* 나머지 유저 목록 */}
          <div className="relative z-10 mx-4">
            {restUsers.map((user, idx) => (
              <motion.div
                key={user.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.02 }}
                className={`flex items-center gap-3 py-3 border-b border-white/15 ${
                  user.id === profile?.uid ? 'bg-white/10 -mx-2 px-2 rounded-lg' : ''
                }`}
              >
                {/* 순위 */}
                <div className="w-8 text-center font-black text-white/60">
                  {user.rank}
                </div>

                {/* 프로필 */}
                <div className="w-10 h-10 flex items-center justify-center border-2 border-white/30 rounded-lg overflow-hidden flex-shrink-0 bg-white/10">
                  {user.profileRabbitId != null ? (
                    <Image src={getRabbitProfileUrl(user.profileRabbitId)} alt="" width={40} height={40} className="w-full h-full object-cover" />
                  ) : (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="rgba(255,255,255,0.5)">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
                    </svg>
                  )}
                </div>

                {/* 정보 */}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white truncate">
                    {user.nickname} · {user.classType}반
                  </p>
                  {user.equippedRabbitNames ? (
                    <p className="text-xs text-white/50 truncate">{user.equippedRabbitNames}</p>
                  ) : (
                    <p className="text-xs text-white/50">{user.totalExp.toLocaleString()} XP</p>
                  )}
                </div>

                {/* 종합 점수 */}
                <div className="text-right flex-shrink-0">
                  <p className="font-black text-white">
                    {Math.round(user.rankScore)}점
                  </p>
                </div>
              </motion.div>
            ))}

            {rankedUsers.length === 0 && (
              <div className="text-center py-12">
                <h3 className="font-serif-display text-2xl font-black mb-2 text-white">
                  NO DATA YET
                </h3>
                <p className="text-sm text-white/50">아직 랭킹 데이터가 없습니다.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* 하단 고정: 내 순위 */}
      {myRank && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-white/15 p-4 z-30 bg-black/40 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            {/* 순위 */}
            <div className="w-12 h-12 flex items-center justify-center font-black text-xl bg-white/20 text-white rounded-lg">
              {myRank.rank}
            </div>

            {/* 프로필 */}
            <div className="w-10 h-10 flex items-center justify-center border-2 border-white/30 rounded-lg overflow-hidden flex-shrink-0 bg-white/10">
              {myRank.profileRabbitId != null ? (
                <Image src={getRabbitProfileUrl(myRank.profileRabbitId)} alt="" width={40} height={40} className="w-full h-full object-cover" />
              ) : (
                <svg width={20} height={20} viewBox="0 0 24 24" fill="rgba(255,255,255,0.5)">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
                </svg>
              )}
            </div>

            {/* 정보 */}
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white truncate">
                {myRank.nickname} · {myRank.classType}반
              </p>
              {myRank.equippedRabbitNames ? (
                <p className="text-xs text-white/50 truncate">{myRank.equippedRabbitNames}</p>
              ) : (
                <p className="text-xs text-white/50">{myRank.totalExp.toLocaleString()} XP</p>
              )}
            </div>

            {/* 종합 점수 */}
            <div className="text-right flex-shrink-0">
              <p className="text-xl font-black text-white">
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
            className="fixed bottom-24 right-4 z-40 w-12 h-12 bg-white/20 backdrop-blur-sm text-white rounded-full shadow-lg flex items-center justify-center hover:bg-white/30 transition-colors"
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

      {/* 랭킹 안내 모달 */}
      <AnimatePresence>
        {showInfo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-sm rounded-2xl overflow-hidden p-6"
            >
              {/* 글래스 배경 */}
              <div className="absolute inset-0 rounded-2xl overflow-hidden">
                <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
              </div>
              <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />

              <div className="relative z-10">
                {/* 아이콘 */}
                <div className="flex justify-center mb-4">
                  <div className="w-12 h-12 border-2 border-white/30 rounded-lg flex items-center justify-center bg-white/10">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>

                {/* 제목 */}
                <h3 className="text-2xl font-black text-white text-center mb-4">랭킹은 이렇게 매겨져요!</h3>

                {/* 안내 */}
                <div className="text-sm text-white/60 space-y-1.5 mb-6">
                  <p className="font-bold text-white">개인 랭킹</p>
                  <p>- 교수님 퀴즈 정답 수 + EXP로 계산됩니다.</p>
                  <p>- 퀴즈를 많이 맞히고, 활동을 많이 할수록 점수가 올라요.</p>
                  <div className="pt-2" />
                  <p className="font-bold text-white">팀 랭킹</p>
                  <p>- 평균 참여도(40%) + 평균 성적(40%) + 퀴즈 응시율(20%).</p>
                  <p>- 응시율 = 교수님 퀴즈 중 반 평균 풀이 비율.</p>
                </div>

                {/* 버튼 */}
                <button
                  onClick={() => setShowInfo(false)}
                  className="w-full py-3 bg-white/20 backdrop-blur-sm text-white font-bold text-base rounded-xl hover:bg-white/30 transition-colors"
                >
                  확인
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * 클라이언트 폴백: Cloud Function 미배포 시 직접 계산
 */
async function computeRankingsClientSide(courseId: string): Promise<RankedUser[]> {
  // 1. users 쿼리
  const usersSnap = await getDocs(query(collection(db, 'users'), where('courseId', '==', courseId)));
  const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  const students = allUsers.filter((u: any) => u.role !== 'professor');
  const professorUids = allUsers.filter((u: any) => u.role === 'professor').map((u: any) => u.id);

  if (students.length === 0) return [];

  // 2. quizzes + quizResults 병렬 조회
  const [quizSnap, resultsSnap] = await Promise.all([
    professorUids.length > 0
      ? getDocs(query(collection(db, 'quizzes'), where('courseId', '==', courseId)))
      : Promise.resolve(null),
    getDocs(query(collection(db, 'quizResults'), where('courseId', '==', courseId))),
  ]);

  // 교수 퀴즈 ID 수집
  const profQuizIds = new Set<string>();
  if (quizSnap) {
    quizSnap.docs.forEach(d => {
      const data = d.data();
      if (professorUids.includes(data.creatorId) || professorUids.includes(data.creatorUid)) {
        profQuizIds.add(d.id);
      }
    });
  }

  // quizResults 집계
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

  // 3. 장착 토끼 이름 조회
  const rabbitDocIds = new Set<string>();
  students.forEach((u: any) => {
    (u.equippedRabbits || []).forEach((r: any) => {
      if (r.rabbitId > 0 && r.courseId) rabbitDocIds.add(`${r.courseId}_${r.rabbitId}`);
    });
  });
  const rabbitNames: Record<string, string> = {};
  const ids = Array.from(rabbitDocIds);
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const snaps = await Promise.all(batch.map(docId => getDoc(doc(db, 'rabbits', docId))));
    snaps.forEach((snap, idx) => {
      if (snap.exists()) rabbitNames[batch[idx]] = snap.data()?.name || `토끼 #${batch[idx].split('_')[1]}`;
    });
  }

  // 4. 개인 랭킹 계산

  const ranked: RankedUser[] = students.map((u: any) => {
    const exp = u.totalExp || 0;
    const profStat = studentProfStats[u.id] || { correct: 0, attempted: 0 };
    const rankScore = computeRankScore(profStat.correct, exp);

    const allEquipped = u.equippedRabbits || [];
    const names = allEquipped.map((r: any) => {
      if (r.rabbitId === 0) return '토끼';
      const key = `${r.courseId}_${r.rabbitId}`;
      return rabbitNames[key] || `토끼 #${r.rabbitId}`;
    });

    const firstSlot = allEquipped[0];

    return {
      id: u.id,
      nickname: u.nickname || '익명',
      classType: (u.classId || 'A') as ClassType,
      totalExp: exp,
      profCorrectCount: profStat.correct,
      rankScore,
      profileRabbitId: u.profileRabbitId,
      equippedRabbitNames: names.length > 0 ? names.join(' & ') : '',
      firstEquippedRabbitId: firstSlot?.rabbitId,
      firstEquippedRabbitName: firstSlot
        ? firstSlot.rabbitId === 0 ? '토끼' : rabbitNames[`${firstSlot.courseId}_${firstSlot.rabbitId}`] || `토끼 #${firstSlot.rabbitId}`
        : undefined,
      rank: 0,
    };
  });

  ranked.sort((a, b) => b.rankScore - a.rankScore);
  ranked.forEach((user, idx) => { user.rank = idx + 1; });

  return ranked;
}

/**
 * 단상 위 토끼 이미지만 렌더링 (텍스트는 단상 아래에 별도 배치)
 */
function PodiumRabbit({ rabbitId, size }: { rabbitId?: number; size: number }) {
  if (rabbitId != null) {
    return (
      <Image
        src={getRabbitImageSrc(rabbitId)}
        alt=""
        width={size}
        height={Math.round(size * (969 / 520))}
        className="object-contain"
      />
    );
  }
  return (
    <div className="flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="#9A9A9A">
        <circle cx="12" cy="8" r="4" />
        <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
      </svg>
    </div>
  );
}
