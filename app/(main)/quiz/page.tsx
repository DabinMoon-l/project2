'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { Header, Button } from '@/components/common';
import {
  QuizFilterTabs,
  QuizType,
  getDefaultFilter,
  Top3Race,
  RaceRanker,
  ClassRankingBar,
  ClassRanking,
  QuizGrid,
  QuizCardData,
} from '@/components/quiz';

// 한 페이지에 불러올 퀴즈 수
const QUIZZES_PER_PAGE = 10;

/**
 * 퀴즈 목록 페이지
 *
 * 필터 탭, TOP3 레이스, 반 참여도 순위, 퀴즈 카드 그리드로 구성됩니다.
 * 무한 스크롤을 통해 추가 퀴즈를 로드합니다.
 */
export default function QuizListPage() {
  const router = useRouter();
  const { user } = useAuth();

  // 필터 상태 (시즌 기반 기본값)
  const [activeFilter, setActiveFilter] = useState<QuizType>(getDefaultFilter());

  // 퀴즈 데이터 상태
  const [quizzes, setQuizzes] = useState<QuizCardData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  // TOP3 레이스 데이터
  const [rankers, setRankers] = useState<RaceRanker[]>([]);
  const [rankersLoading, setRankersLoading] = useState(true);

  // 반 참여도 데이터
  const [classRankings, setClassRankings] = useState<ClassRanking[]>([]);
  const [classRankingsLoading, setClassRankingsLoading] = useState(true);

  // 현재 사용자 정보 (예시: 반 정보)
  const [userClass, setUserClass] = useState<'A' | 'B' | 'C' | 'D' | undefined>();

  /**
   * 퀴즈 데이터 fetch
   * @param isInitial 초기 로딩 여부
   */
  const fetchQuizzes = useCallback(
    async (isInitial: boolean = false) => {
      if (!user) return;

      try {
        if (isInitial) {
          setIsLoading(true);
          setLastDoc(null);
          setHasMore(true);
        } else {
          setIsFetchingMore(true);
        }

        // Firestore 쿼리 구성
        const quizzesRef = collection(db, 'quizzes');
        let q;

        // 필터에 따른 쿼리 조건
        if (activeFilter === 'all') {
          q = query(
            quizzesRef,
            orderBy('createdAt', 'desc'),
            limit(QUIZZES_PER_PAGE)
          );
        } else {
          q = query(
            quizzesRef,
            where('type', '==', activeFilter),
            orderBy('createdAt', 'desc'),
            limit(QUIZZES_PER_PAGE)
          );
        }

        // 페이지네이션 (이어서 불러오기)
        if (!isInitial && lastDoc) {
          if (activeFilter === 'all') {
            q = query(
              quizzesRef,
              orderBy('createdAt', 'desc'),
              startAfter(lastDoc),
              limit(QUIZZES_PER_PAGE)
            );
          } else {
            q = query(
              quizzesRef,
              where('type', '==', activeFilter),
              orderBy('createdAt', 'desc'),
              startAfter(lastDoc),
              limit(QUIZZES_PER_PAGE)
            );
          }
        }

        const snapshot = await getDocs(q);
        const newQuizzes: QuizCardData[] = [];

        snapshot.forEach((doc) => {
          const data = doc.data();
          newQuizzes.push({
            id: doc.id,
            title: data.title || '제목 없음',
            type: data.type || 'midterm',
            questionCount: data.questionCount || 0,
            difficulty: data.difficulty || 'normal',
            participantCount: data.participantCount || 0,
            averageScore: data.averageScore || 0,
            isCompleted: data.completedUsers?.includes(user.uid) || false,
            myScore: data.userScores?.[user.uid],
            thumbnailUrl: data.thumbnailUrl,
            creatorNickname: data.creatorNickname,
          });
        });

        // 마지막 문서 저장 (페이지네이션용)
        if (snapshot.docs.length > 0) {
          setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
        }

        // 더 불러올 데이터가 있는지 확인
        if (snapshot.docs.length < QUIZZES_PER_PAGE) {
          setHasMore(false);
        }

        // 상태 업데이트
        if (isInitial) {
          setQuizzes(newQuizzes);
        } else {
          setQuizzes((prev) => [...prev, ...newQuizzes]);
        }
      } catch (error) {
        console.error('퀴즈 목록 불러오기 실패:', error);
      } finally {
        setIsLoading(false);
        setIsFetchingMore(false);
      }
    },
    [user, activeFilter, lastDoc]
  );

  /**
   * TOP3 랭커 데이터 fetch
   */
  const fetchRankers = useCallback(async () => {
    try {
      setRankersLoading(true);

      // Firestore에서 상위 3명 조회
      const usersRef = collection(db, 'users');
      const q = query(usersRef, orderBy('totalScore', 'desc'), limit(3));
      const snapshot = await getDocs(q);

      const newRankers: RaceRanker[] = [];
      let rankIndex = 0;
      snapshot.forEach((doc) => {
        const data = doc.data();
        newRankers.push({
          userId: doc.id,
          nickname: data.nickname || '익명 용사',
          rank: (rankIndex + 1) as 1 | 2 | 3,
          score: data.totalScore || 0,
          characterImageUrl: data.characterImageUrl,
        });
        rankIndex++;
      });

      setRankers(newRankers);
    } catch (error) {
      console.error('TOP3 랭커 불러오기 실패:', error);
      // 에러 시 더미 데이터 (오프라인 모드 대응)
      setRankers([]);
    } finally {
      setRankersLoading(false);
    }
  }, []);

  /**
   * 반 참여도 데이터 fetch
   */
  const fetchClassRankings = useCallback(async () => {
    try {
      setClassRankingsLoading(true);

      // Firestore에서 반별 통계 조회
      const statsRef = collection(db, 'classStats');
      const snapshot = await getDocs(statsRef);

      const newRankings: ClassRanking[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        const className = doc.id as 'A' | 'B' | 'C' | 'D';
        if (['A', 'B', 'C', 'D'].includes(className)) {
          newRankings.push({
            className,
            participationRate: data.participationRate || 0,
            totalStudents: data.totalStudents || 0,
            participatedStudents: data.participatedStudents || 0,
          });
        }
      });

      // 데이터가 없으면 기본값 설정
      if (newRankings.length === 0) {
        setClassRankings([
          { className: 'A', participationRate: 0, totalStudents: 0, participatedStudents: 0 },
          { className: 'B', participationRate: 0, totalStudents: 0, participatedStudents: 0 },
          { className: 'C', participationRate: 0, totalStudents: 0, participatedStudents: 0 },
          { className: 'D', participationRate: 0, totalStudents: 0, participatedStudents: 0 },
        ]);
      } else {
        setClassRankings(newRankings);
      }
    } catch (error) {
      console.error('반 참여도 불러오기 실패:', error);
      // 에러 시 기본값 설정
      setClassRankings([
        { className: 'A', participationRate: 0, totalStudents: 0, participatedStudents: 0 },
        { className: 'B', participationRate: 0, totalStudents: 0, participatedStudents: 0 },
        { className: 'C', participationRate: 0, totalStudents: 0, participatedStudents: 0 },
        { className: 'D', participationRate: 0, totalStudents: 0, participatedStudents: 0 },
      ]);
    } finally {
      setClassRankingsLoading(false);
    }
  }, []);

  /**
   * 사용자 정보 fetch (반 정보)
   */
  const fetchUserInfo = useCallback(async () => {
    if (!user) return;

    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('uid', '==', user.uid), limit(1));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const data = snapshot.docs[0].data();
        if (data.class && ['A', 'B', 'C', 'D'].includes(data.class)) {
          setUserClass(data.class);
        }
      }
    } catch (error) {
      console.error('사용자 정보 불러오기 실패:', error);
    }
  }, [user]);

  // 필터 변경 시 퀴즈 목록 새로고침
  useEffect(() => {
    if (user) {
      fetchQuizzes(true);
    }
  }, [activeFilter, user]);

  // 초기 데이터 로드
  useEffect(() => {
    if (user) {
      fetchRankers();
      fetchClassRankings();
      fetchUserInfo();
    }
  }, [user, fetchRankers, fetchClassRankings, fetchUserInfo]);

  // 더 불러오기 핸들러
  const handleLoadMore = () => {
    if (hasMore && !isFetchingMore) {
      fetchQuizzes(false);
    }
  };

  // 퀴즈 카드 클릭 핸들러
  const handleQuizClick = (quizId: string) => {
    router.push(`/quiz/${quizId}`);
  };

  // 페이지 애니메이션 variants
  const pageVariants = {
    initial: { opacity: 0, y: 20 },
    animate: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.4,
        ease: 'easeOut',
      },
    },
    exit: { opacity: 0, y: -20 },
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-navigation">
      {/* 헤더 */}
      <Header title="퀴즈" showBack={false} />

      <motion.main
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="px-4 pt-4 space-y-4"
      >
        {/* 필터 탭 */}
        <QuizFilterTabs
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
        />

        {/* TOP3 레이스 */}
        <Top3Race
          rankers={rankers}
          isLoading={rankersLoading}
        />

        {/* 반 참여도 순위 */}
        <ClassRankingBar
          rankings={classRankings}
          userClass={userClass}
          isLoading={classRankingsLoading}
        />

        {/* 자체제작 퀴즈 버튼 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-4 shadow-lg"
        >
          <div className="flex items-center justify-between">
            <div className="text-white">
              <h3 className="font-bold text-lg mb-1">나만의 퀴즈 만들기</h3>
              <p className="text-sm text-white/80">
                시험지 사진으로 문제를 추출하세요!
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push('/quiz/create')}
              className="!bg-white !text-indigo-600 hover:!bg-gray-100"
            >
              만들기
            </Button>
          </div>
        </motion.div>

        {/* 퀴즈 그리드 */}
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <span className="text-xl">📝</span>
            퀴즈 목록
          </h2>
          <QuizGrid
            quizzes={quizzes}
            isLoading={isLoading}
            isFetchingMore={isFetchingMore}
            hasMore={hasMore}
            onLoadMore={handleLoadMore}
            onQuizClick={handleQuizClick}
          />
        </section>
      </motion.main>
    </div>
  );
}
