'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, getDoc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { type ClassType } from '@/styles/themes';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import { useHideNav } from '@/lib/hooks/useHideNav';
import { getRabbitImageSrc } from '@/lib/utils/rabbitImage';
import { readFullCache, writeFullCache } from '@/lib/utils/rankingCache';
import { computeRankScore } from '@/lib/utils/ranking';

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

interface RankingBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 랭킹 바텀시트 — 홈 오버레이에서 열리는 전체 랭킹
 */
export default function RankingBottomSheet({ isOpen, onClose }: RankingBottomSheetProps) {
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  useTheme();

  const [rankedUsers, setRankedUsers] = useState<RankedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRank, setMyRank] = useState<RankedUser | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [displayCount, setDisplayCount] = useState(30);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const top3Ref = useRef<HTMLDivElement>(null);
  const rankedUsersRef = useRef<RankedUser[]>(rankedUsers);

  // 네비게이션 숨김
  useHideNav(isOpen);

  // 열릴 때 초기화
  useEffect(() => {
    if (isOpen) {
      setDisplayCount(30);
      setShowScrollTop(false);
      scrollRef.current?.scrollTo(0, 0);
    }
  }, [isOpen]);

  // 스크롤 위치로 버튼 표시 여부 결정
  useEffect(() => {
    if (!isOpen) return;
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      setShowScrollTop(el.scrollTop > 300);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [isOpen]);

  // 랭킹 데이터를 현재 유저 프로필로 보정
  const applyRankings = useCallback((users: RankedUser[]) => {
    // rank를 인덱스 기반으로 강제 할당 (서버 데이터 rank가 부정확할 수 있음)
    users.forEach((u, i) => { u.rank = i + 1; });

    if (profile?.uid) {
      const me = users.find(u => u.id === profile.uid);
      if (me) {
        me.profileRabbitId = profile.profileRabbitId ?? undefined;
        me.nickname = profile.nickname || me.nickname;
        const equipped: Array<{ rabbitId: number }> = profile.equippedRabbits || [];
        if (equipped.length > 0) {
          me.firstEquippedRabbitId = equipped[0]?.rabbitId;
        }
      }
    }
    setRankedUsers(users);
    const me = profile?.uid ? users.find(u => u.id === profile.uid) : null;
    if (me) setMyRank(me);
    else setMyRank(null);
  }, [profile?.uid, profile?.profileRabbitId, profile?.nickname, profile?.equippedRabbits]);

  // 랭킹 데이터 로드
  useEffect(() => {
    if (!isOpen || !userCourseId || !profile) return;

    const { data: cached } = readFullCache(userCourseId);
    if (cached) {
      applyRankings(cached.rankedUsers as RankedUser[]);
      setLoading(false);
    }

    let fallbackAttempted = false;
    const unsubscribe = onSnapshot(
      doc(db, 'rankings', userCourseId),
      async (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          const users = (data.rankedUsers || []) as RankedUser[];
          applyRankings(users);
          writeFullCache(userCourseId, { rankedUsers: users });
          setLoading(false);
        } else if (!fallbackAttempted) {
          fallbackAttempted = true;
          if (!cached) setLoading(true);

          let generated = false;
          try {
            const refresh = httpsCallable(functions, 'refreshRankings');
            await refresh({ courseId: userCourseId });
            generated = true;
          } catch { /* CF 미배포 */ }

          if (!generated) {
            const users = await computeRankingsClientSide(userCourseId);
            applyRankings(users);
            if (users.length > 0) writeFullCache(userCourseId, { rankedUsers: users });
            setLoading(false);
          }
        }
      },
      (error) => {
        console.error('랭킹 구독 실패:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, userCourseId, profile?.uid]);

  // rankedUsers가 변경될 때 ref 동기화
  useEffect(() => {
    rankedUsersRef.current = rankedUsers;
  }, [rankedUsers]);

  // 프로필 변경 시 즉시 반영
  const equippedJSON = JSON.stringify(profile?.equippedRabbits || []);
  useEffect(() => {
    const currentRanked = rankedUsersRef.current;
    if (!profile?.uid || currentRanked.length === 0) return;
    const me = currentRanked.find(u => u.id === profile.uid);
    if (!me) return;

    const equipped: Array<{ rabbitId: number; courseId?: string }> = profile.equippedRabbits || [];
    const firstSlot = equipped[0];

    const updateMe = async () => {
      const names: string[] = [];
      for (const r of equipped) {
        if (r.rabbitId === 0) { names.push('토끼'); continue; }
        const key = r.courseId ? `${r.courseId}_${r.rabbitId}` : null;
        if (key) {
          try {
            const snap = await getDoc(doc(db, 'rabbits', key));
            names.push(snap.exists() ? (snap.data()?.name || `토끼 #${r.rabbitId + 1}`) : `토끼 #${r.rabbitId + 1}`);
          } catch { names.push(`토끼 #${r.rabbitId + 1}`); }
        } else { names.push(`토끼 #${r.rabbitId + 1}`); }
      }

      me.profileRabbitId = profile.profileRabbitId ?? undefined;
      me.nickname = profile.nickname || me.nickname;
      me.equippedRabbitNames = names.length > 0 ? names.join(' & ') : '';
      me.firstEquippedRabbitId = firstSlot?.rabbitId;
      me.firstEquippedRabbitName = names[0] || undefined;
      setRankedUsers([...rankedUsersRef.current]);
      setMyRank({ ...me });
    };

    updateMe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.profileRabbitId, profile?.nickname, equippedJSON]);

  const top3 = useMemo(() => rankedUsers.slice(0, 3), [rankedUsers]);
  const restUsers = useMemo(() => rankedUsers.slice(3), [rankedUsers]);
  const visibleUsers = useMemo(() => restUsers.slice(0, displayCount), [restUsers, displayCount]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="w-full relative overflow-hidden rounded-t-2xl"
            style={{ height: '92vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 배경 이미지 + 글래스 오버레이 */}
            <div className="absolute inset-0 pointer-events-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
            </div>
            <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl pointer-events-none" />

            {/* 스크롤 가능한 컨텐츠 */}
            <div ref={scrollRef} className="relative z-10 h-full overflow-y-auto scrollbar-hide" style={{ paddingBottom: myRank ? 72 : 16 }}>
              {/* 핸들 바 */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 bg-white/30 rounded-full" />
              </div>

              {/* 헤더 */}
              <div className="px-4 mb-0 flex items-center justify-between">
                <button
                  onClick={() => setShowInfo(true)}
                  className="w-8 h-8 flex items-center justify-center border-2 border-white/30 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                  aria-label="랭킹 안내"
                >
                  <span className="text-sm font-black text-white leading-none">i</span>
                </button>
                <button
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center"
                  aria-label="닫기"
                >
                  <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 배너 */}
              <div className="relative leading-[0] mt-1" style={{ transform: 'scaleY(1.05)', transformOrigin: 'top' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/rank_banner.png" alt="랭킹 배너" className="w-full block" />
                {!loading && rankedUsers[0] && (
                  <div
                    className="absolute inset-0 flex items-center justify-center pointer-events-none px-[20%]"
                    style={{ zIndex: 10, paddingTop: '8px' }}
                  >
                    <span className="text-2xl leading-normal font-sans text-[#1A1A1A] truncate" style={{ fontWeight: 900 }}>
                      {rankedUsers[0].nickname}
                    </span>
                  </div>
                )}
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {/* Top 3 단상 */}
                  <div ref={top3Ref} className="mx-4 mt-36 mb-3">
                    <div>
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/images/rank.png" alt="단상" className="w-full block" />

                        {top3[1] && (
                          <div className="absolute z-10 flex justify-center" style={{ left: '5%', width: '30%', bottom: '62%' }}>
                            <PodiumRabbit rabbitId={top3[1].firstEquippedRabbitId} size={52} />
                          </div>
                        )}
                        {top3[0] && (
                          <div className="absolute z-10 flex justify-center" style={{ left: '33%', width: '34%', bottom: '95%' }}>
                            <PodiumRabbit rabbitId={top3[0].firstEquippedRabbitId} size={60} />
                          </div>
                        )}
                        {top3[2] && (
                          <div className="absolute z-10 flex justify-center" style={{ left: '65%', width: '30%', bottom: '58%' }}>
                            <PodiumRabbit rabbitId={top3[2].firstEquippedRabbitId} size={52} />
                          </div>
                        )}
                      </div>

                      {/* Top3 정보 */}
                      <div className="grid grid-cols-3 gap-1 mt-2">
                        <div className="text-center">
                          {top3[1] && (
                            <>
                              <p className="text-sm font-black text-white truncate">{top3[1].nickname}</p>
                              <p className="text-xs text-white/60">{top3[1].classType}반 · {Math.round(top3[1].rankScore)}점</p>
                              {top3[1].equippedRabbitNames && <p className="text-xs text-white/60 truncate">{top3[1].equippedRabbitNames}</p>}
                            </>
                          )}
                        </div>
                        <div className="text-center">
                          {top3[0] && (
                            <>
                              <p className="text-base font-black text-white truncate">{top3[0].nickname}</p>
                              <p className="text-xs text-white/60">{top3[0].classType}반 · {Math.round(top3[0].rankScore)}점</p>
                              {top3[0].equippedRabbitNames && <p className="text-xs text-white/60 truncate">{top3[0].equippedRabbitNames}</p>}
                            </>
                          )}
                        </div>
                        <div className="text-center">
                          {top3[2] && (
                            <>
                              <p className="text-sm font-black text-white truncate">{top3[2].nickname}</p>
                              <p className="text-xs text-white/60">{top3[2].classType}반 · {Math.round(top3[2].rankScore)}점</p>
                              {top3[2].equippedRabbitNames && <p className="text-xs text-white/60 truncate">{top3[2].equippedRabbitNames}</p>}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 구분선 */}
                  <div className="mx-4 border-t-2 border-white/30 mb-1" />
                  <div className="mx-4 border-t border-white/20 mb-4" />

                  {/* 나머지 유저 목록 */}
                  <div className="mx-4">
                    {visibleUsers.map((user) => (
                      <div
                        key={user.id}
                        className={`flex items-center gap-3 py-3 border-b border-white/15 ${
                          user.id === profile?.uid ? 'bg-white/10 -mx-2 px-2 rounded-lg' : ''
                        }`}
                      >
                        <div className="w-8 text-center font-black text-white/60">{user.rank}</div>
                        <div className="w-10 h-10 flex items-center justify-center border-2 border-white/30 rounded-lg overflow-hidden flex-shrink-0 bg-white/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={getRabbitProfileUrl(user.profileRabbitId ?? 0)} alt="" width={40} height={40} className="w-full h-full object-cover" loading="lazy" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-white truncate">{user.nickname} · {user.classType}반</p>
                          {user.equippedRabbitNames ? (
                            <p className="text-xs text-white/50 truncate">{user.equippedRabbitNames}</p>
                          ) : (
                            <p className="text-xs text-white/50">{user.totalExp.toLocaleString()} XP</p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-black text-white">{Math.round(user.rankScore)}점</p>
                        </div>
                      </div>
                    ))}

                    {displayCount < restUsers.length && (
                      <button
                        onClick={() => setDisplayCount(prev => prev + 30)}
                        className="w-full py-4 text-center text-sm font-medium text-white/50 hover:text-white/70 transition-colors"
                      >
                        더보기 ({visibleUsers.length}/{restUsers.length})
                      </button>
                    )}

                    {rankedUsers.length === 0 && (
                      <div className="text-center py-12">
                        <h3 className="font-serif-display text-2xl font-black mb-2 text-white">NO DATA YET</h3>
                        <p className="text-sm text-white/50">아직 랭킹 데이터가 없습니다.</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 스크롤 맨 위로 버튼 */}
            <AnimatePresence>
              {showScrollTop && (
                <motion.button
                  key="scroll-top"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  whileTap={{ scale: 0.95, opacity: 0.7 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="absolute right-4 z-40 w-10 h-10 bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 rounded-full shadow-lg flex items-center justify-center transition-colors"
                  style={{ bottom: myRank ? 80 : 20 }}
                  aria-label="맨 위로"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                </motion.button>
              )}
            </AnimatePresence>

            {/* 하단 고정: 내 순위 */}
            {myRank && (
              <div className="absolute bottom-0 left-0 right-0 border-t border-white/15 p-3 z-30 bg-black/40 backdrop-blur-xl">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 flex items-center justify-center font-black text-lg bg-white/20 text-white rounded-lg">
                    {myRank.rank}
                  </div>
                  <div className="w-10 h-10 flex items-center justify-center border-2 border-white/30 rounded-lg overflow-hidden flex-shrink-0 bg-white/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={getRabbitProfileUrl(myRank.profileRabbitId ?? 0)} alt="" width={40} height={40} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-white truncate">{myRank.nickname} · {myRank.classType}반</p>
                    {myRank.equippedRabbitNames ? (
                      <p className="text-xs text-white/50 truncate">{myRank.equippedRabbitNames}</p>
                    ) : (
                      <p className="text-xs text-white/50">{myRank.totalExp.toLocaleString()} XP</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-black text-white">{Math.round(myRank.rankScore)}점</p>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* 랭킹 안내 모달 — 바텀시트 위에 표시 */}
          <AnimatePresence>
            {showInfo && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-black/50"
                onClick={() => setShowInfo(false)}
              >
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0.9 }}
                  onClick={(e) => e.stopPropagation()}
                  className="relative w-full max-w-[240px] rounded-2xl overflow-hidden p-3"
                >
                  <div className="absolute inset-0 rounded-2xl overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />
                  <div className="relative z-10">
                    <div className="flex justify-center mb-2">
                      <div className="w-7 h-7 border-2 border-white/30 rounded-lg flex items-center justify-center bg-white/10">
                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                    </div>
                    <h3 className="text-sm font-black text-white text-center mb-2">랭킹은 이렇게 매겨져요!</h3>
                    <div className="text-[10px] text-white/60 space-y-0.5 mb-3">
                      <p className="font-bold text-white text-xs">개인 랭킹</p>
                      <p>- 교수님 퀴즈 정답 수 + EXP로 계산됩니다.</p>
                      <p>- 퀴즈를 많이 맞히고, 활동을 많이 할수록 점수가 올라요.</p>
                      <div className="pt-2" />
                      <p className="font-bold text-white text-xs">팀 랭킹</p>
                      <p>- 평균 참여도(40%) + 평균 성적(40%) + 퀴즈 응시율(20%).</p>
                      <p>- 응시율 = 교수님 퀴즈 중 반 평균 풀이 비율.</p>
                      {profile?.role === 'professor' && (
                        <>
                          <div className="pt-2" />
                          <p className="font-bold text-white text-xs">홈 화면 OVERVIEW %</p>
                          <p>- 이번 주(월~일) 퀴즈에 참여한 학생 비율입니다.</p>
                          <p>- 5분마다 자동 갱신됩니다.</p>
                        </>
                      )}
                    </div>
                    <button
                      onClick={() => setShowInfo(false)}
                      className="w-full py-1.5 bg-white/20 backdrop-blur-sm text-white font-bold text-xs rounded-xl hover:bg-white/30 transition-colors"
                    >
                      확인
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/**
 * 단상 위 토끼 이미지
 */
function PodiumRabbit({ rabbitId, size }: { rabbitId?: number; size: number }) {
  // 장착 토끼가 없으면 기본 토끼(#0) 표시 (모든 유저는 온보딩 시 기본 토끼 지급)
  const displayId = rabbitId ?? 0;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={getRabbitImageSrc(displayId)}
      alt=""
      width={size}
      height={Math.round(size * (969 / 520))}
      className="object-contain"
    />
  );
}

/**
 * 클라이언트 폴백: Cloud Function 미배포 시 직접 계산
 */
async function computeRankingsClientSide(courseId: string): Promise<RankedUser[]> {
  const usersSnap = await getDocs(query(collection(db, 'users'), where('courseId', '==', courseId)));
  const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  const students = allUsers.filter((u: any) => u.role !== 'professor');
  const professorUids = allUsers.filter((u: any) => u.role === 'professor').map((u: any) => u.id);

  if (students.length === 0) return [];

  const [quizSnap, resultsSnap] = await Promise.all([
    professorUids.length > 0
      ? getDocs(query(collection(db, 'quizzes'), where('courseId', '==', courseId)))
      : Promise.resolve(null),
    getDocs(query(collection(db, 'quizResults'), where('courseId', '==', courseId))),
  ]);

  const profQuizIds = new Set<string>();
  if (quizSnap) {
    quizSnap.docs.forEach(d => {
      const data = d.data();
      if (professorUids.includes(data.creatorId) || professorUids.includes(data.creatorUid)) profQuizIds.add(d.id);
    });
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

  const ranked: RankedUser[] = students.map((u: any) => {
    const exp = u.totalExp || 0;
    const profStat = studentProfStats[u.id] || { correct: 0, attempted: 0 };
    const rankScore = computeRankScore(profStat.correct, exp);
    const allEquipped = u.equippedRabbits || [];
    const names = allEquipped.map((r: any) => {
      if (r.rabbitId === 0) return '토끼';
      const key = r.courseId ? `${r.courseId}_${r.rabbitId}` : null;
      return (key && rabbitNames[key]) ? rabbitNames[key] : `토끼 #${r.rabbitId}`;
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
        ? firstSlot.rabbitId === 0 ? '토끼' : (firstSlot.courseId ? rabbitNames[`${firstSlot.courseId}_${firstSlot.rabbitId}`] : null) || `토끼 #${firstSlot.rabbitId}`
        : undefined,
      rank: 0,
    };
  });

  ranked.sort((a, b) => b.rankScore - a.rankScore);
  ranked.forEach((user, idx) => { user.rank = idx + 1; });
  return ranked;
}
