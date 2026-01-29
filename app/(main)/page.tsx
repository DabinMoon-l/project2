'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { useAuth } from '@/lib/hooks/useAuth';
import Header from '@/components/common/Header';
import {
  HomeCharacter,
  StatsCard,
  QuickMenu,
  TodayQuiz,
  calculateRankInfo,
  type CharacterOptions,
  type Equipment,
  type QuizItem,
} from '@/components/home';

/**
 * 사용자 데이터 타입
 */
interface UserData {
  // 닉네임
  nickname: string;
  // 골드
  gold: number;
  // 총 경험치
  totalExp: number;
  // 캐릭터 옵션
  characterOptions: CharacterOptions;
  // 장비
  equipment: Equipment;
  // 참여도 (0-100)
  participationRate: number;
  // 반
  classType: string;
}

/**
 * 더미 사용자 데이터 (개발용)
 */
const DUMMY_USER_DATA: UserData = {
  nickname: '용감한 토끼',
  gold: 1250,
  totalExp: 450,
  characterOptions: {
    hairStyle: 2,
    skinColor: 3,
    beard: 0,
  },
  equipment: {
    armor: 'basic',
    weapon: 'sword',
  },
  participationRate: 75,
  classType: 'A',
};

/**
 * 더미 퀴즈 데이터 (개발용)
 */
const DUMMY_QUIZZES: QuizItem[] = [
  {
    id: 'quiz-1',
    title: '데이터베이스 기초',
    questionCount: 10,
    deadline: new Date(Date.now() + 1000 * 60 * 60 * 3), // 3시간 후
    completed: false,
  },
  {
    id: 'quiz-2',
    title: '알고리즘 복습',
    questionCount: 5,
    deadline: new Date(Date.now() + 1000 * 60 * 60 * 24), // 24시간 후
    completed: true,
    correctCount: 4,
  },
];

/**
 * 홈 화면 메인 페이지
 * 캐릭터, 스탯, 빠른 메뉴, 오늘의 퀴즈 표시
 */
export default function HomePage() {
  const router = useRouter();
  const { theme } = useTheme();
  const { user } = useAuth();

  // 상태 관리
  const [userData, setUserData] = useState<UserData | null>(null);
  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 데이터 로드
  useEffect(() => {
    const loadData = async () => {
      try {
        // TODO: Firestore에서 실제 데이터 가져오기
        // 현재는 더미 데이터 사용
        await new Promise((resolve) => setTimeout(resolve, 500)); // 로딩 시뮬레이션

        setUserData(DUMMY_USER_DATA);
        setQuizzes(DUMMY_QUIZZES);
      } catch (error) {
        console.error('데이터 로드 실패:', error);
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      loadData();
    }
  }, [user]);

  // 로딩 상태
  if (loading || !userData) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: theme.colors.background }}
      >
        <motion.div
          className="flex flex-col items-center gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <motion.div
            className="w-10 h-10 border-4 rounded-full"
            style={{
              borderColor: theme.colors.accent,
              borderTopColor: 'transparent',
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p style={{ color: theme.colors.textSecondary }}>불러오는 중...</p>
        </motion.div>
      </div>
    );
  }

  // 계급 정보 계산
  const rankInfo = calculateRankInfo(userData.totalExp);

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* 헤더 */}
      <Header
        title={`${userData.nickname}님`}
        showBack={false}
        rightAction={
          <button
            className="p-2 rounded-full"
            style={{ backgroundColor: `${theme.colors.accent}20` }}
            onClick={() => router.push('/profile')}
          >
            <span className="text-lg">👤</span>
          </button>
        }
      />

      {/* 메인 컨텐츠 */}
      <main className="px-4 pt-4 pb-8">
        {/* 캐릭터 섹션 */}
        <motion.section
          className="flex justify-center mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <HomeCharacter
            options={userData.characterOptions}
            equipment={userData.equipment}
            participationRate={userData.participationRate}
            rank={rankInfo.name}
          />
        </motion.section>

        {/* 스탯 카드 */}
        <motion.section
          className="mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <StatsCard
            gold={userData.gold}
            totalExp={userData.totalExp}
            rankInfo={rankInfo}
          />
        </motion.section>

        {/* 빠른 메뉴 */}
        <motion.section
          className="mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <QuickMenu
            unreadQuizCount={quizzes.filter((q) => !q.completed).length}
            reviewCount={3} // TODO: 실제 오답 수
            newPostCount={2} // TODO: 새 게시글 수
          />
        </motion.section>

        {/* 오늘의 퀴즈 */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <TodayQuiz quizzes={quizzes} loading={false} />
        </motion.section>

        {/* 참여도 섹션 */}
        <motion.section
          className="mt-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <div
            className="rounded-2xl p-4"
            style={{
              backgroundColor: theme.colors.backgroundSecondary,
              border: `1px solid ${theme.colors.border}`,
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3
                className="text-sm font-medium"
                style={{ color: theme.colors.textSecondary }}
              >
                이번 주 참여도
              </h3>
              <span
                className="text-lg font-bold"
                style={{ color: theme.colors.accent }}
              >
                {userData.participationRate}%
              </span>
            </div>

            {/* 참여도 바 */}
            <div
              className="h-3 rounded-full overflow-hidden"
              style={{ backgroundColor: `${theme.colors.accent}20` }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{
                  backgroundColor:
                    userData.participationRate >= 60
                      ? theme.colors.accent
                      : '#FF6B6B',
                }}
                initial={{ width: 0 }}
                animate={{ width: `${userData.participationRate}%` }}
                transition={{ duration: 0.8, ease: 'easeOut', delay: 0.6 }}
              />
            </div>

            {/* 참여도 메시지 */}
            <p
              className="text-xs mt-2"
              style={{ color: theme.colors.textSecondary }}
            >
              {userData.participationRate >= 90
                ? '정말 대단해요! 최고의 용사예요!'
                : userData.participationRate >= 60
                ? '잘하고 있어요! 조금만 더 힘내요!'
                : userData.participationRate >= 30
                ? '아직 기회가 있어요! 퀴즈에 참여해보세요!'
                : '퀴즈에 참여하면 경험치를 얻을 수 있어요!'}
            </p>
          </div>
        </motion.section>
      </main>
    </div>
  );
}
