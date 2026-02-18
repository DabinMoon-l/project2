'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { collection, query, where, getDocs, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Header, Skeleton } from '@/components/common';
import { useAuth } from '@/lib/hooks/useAuth';

// 동적 import로 코드 스플리팅 적용 (교수님 전용 컴포넌트)
const DashboardStats = dynamic(() => import('@/components/professor/DashboardStats'), {
  loading: () => <div className="grid grid-cols-2 gap-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>,
});

const RecentFeedback = dynamic(() => import('@/components/professor/RecentFeedback'), {
  loading: () => <Skeleton className="h-64 rounded-2xl" />,
});

const ClassParticipation = dynamic(() => import('@/components/professor/ClassParticipation'), {
  loading: () => <Skeleton className="h-48 rounded-2xl" />,
});

const QuickActions = dynamic(() => import('@/components/professor/QuickActions'), {
  loading: () => <Skeleton className="h-32 rounded-2xl" />,
});

const StyleProfileModal = dynamic(() => import('@/components/professor/StyleProfileModal'), {
  ssr: false,
});

// 피드백 타입 라벨
const FEEDBACK_TYPE_LABELS: Record<string, string> = {
  praise: '문제가 좋아요!',
  wantmore: '더 풀고 싶어요',
  unclear: '문제가 이해가 안 돼요',
  wrong: '정답이 틀린 것 같아요',
  typo: '오타가 있어요',
  other: '기타 의견',
};

// 피드백 인터페이스
interface FeedbackItem {
  id: string;
  quizTitle: string;
  questionNumber: number;
  content: string;
  studentNickname: string;
  createdAt: Date;
  isRead: boolean;
  type?: string;
}

const mockClasses = [
  { classId: 'A', className: 'A', participationRate: 87, studentCount: 32, color: '#D4AF37' },
  { classId: 'B', className: 'B', participationRate: 72, studentCount: 28, color: '#3D2B1F' },
  { classId: 'C', className: 'C', participationRate: 95, studentCount: 30, color: '#0D3D2E' },
  { classId: 'D', className: 'D', participationRate: 68, studentCount: 35, color: '#1A2744' },
];

/**
 * 교수님 대시보드 페이지
 */
export default function ProfessorDashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [showStyleProfile, setShowStyleProfile] = useState(false);

  // 통계 데이터 (실제로는 Firestore에서)
  const [stats, setStats] = useState({
    totalStudents: 125,
    weeklyParticipation: 78,
    averageScore: 82,
    newFeedbacks: 0,
  });

  // 피드백 데이터 로드
  useEffect(() => {
    const loadFeedbacks = async () => {
      if (!user) return;

      try {
        // 1. 교수가 만든 퀴즈 목록 가져오기 (제목 조회용)
        const quizzesQuery = query(
          collection(db, 'quizzes'),
          where('creatorId', '==', user.uid)
        );
        const quizzesSnapshot = await getDocs(quizzesQuery);
        const quizMap = new Map<string, { title: string; questions: any[] }>();

        quizzesSnapshot.docs.forEach(qDoc => {
          const data = qDoc.data();
          quizMap.set(qDoc.id, {
            title: data.title || '퀴즈',
            questions: data.questions || [],
          });
        });

        // 2. questionFeedbacks에서 피드백 가져오기
        // 방법 1: quizCreatorId로 직접 조회 (새로 저장된 피드백)
        // 방법 2: quizId로 조회 (기존 피드백)
        let feedbackItems: FeedbackItem[] = [];

        // quizCreatorId로 조회 시도
        try {
          const feedbacksByCreatorQuery = query(
            collection(db, 'questionFeedbacks'),
            where('quizCreatorId', '==', user.uid),
            orderBy('createdAt', 'desc'),
            limit(20)
          );
          const feedbacksSnapshot = await getDocs(feedbacksByCreatorQuery);

          for (const feedbackDoc of feedbacksSnapshot.docs) {
            const data = feedbackDoc.data();
            const quizInfo = quizMap.get(data.quizId);

            // 문제 번호 찾기 (questionNumber 필드가 있으면 우선 사용)
            let questionNumber = data.questionNumber || 1;
            if (!data.questionNumber && quizInfo && data.questionId) {
              const qIndex = quizInfo.questions.findIndex((q: any) => q.id === data.questionId);
              if (qIndex >= 0) questionNumber = qIndex + 1;
            }

            // 피드백 내용 생성
            const typeLabel = FEEDBACK_TYPE_LABELS[data.type] || '';
            const content = data.content
              ? `${typeLabel ? `[${typeLabel}] ` : ''}${data.content}`
              : typeLabel || '피드백';

            feedbackItems.push({
              id: feedbackDoc.id,
              quizTitle: quizInfo?.title || '퀴즈',
              questionNumber,
              content,
              studentNickname: '익명', // 피드백은 익명으로 처리
              createdAt: data.createdAt?.toDate() || new Date(),
              isRead: data.isRead || false,
              type: data.type,
            });
          }
        } catch (err) {
          // 인덱스가 없는 경우 quizId로 폴백 조회
          console.log('quizCreatorId 인덱스 없음, quizId로 폴백 조회');
          if (quizMap.size > 0) {
            const quizIds = Array.from(quizMap.keys()).slice(0, 10);
            const feedbacksByQuizQuery = query(
              collection(db, 'questionFeedbacks'),
              where('quizId', 'in', quizIds),
              orderBy('createdAt', 'desc'),
              limit(20)
            );
            const feedbacksSnapshot = await getDocs(feedbacksByQuizQuery);

            for (const feedbackDoc of feedbacksSnapshot.docs) {
              const data = feedbackDoc.data();
              const quizInfo = quizMap.get(data.quizId);

              // 문제 번호 찾기 (questionNumber 필드가 있으면 우선 사용)
              let questionNumber = data.questionNumber || 1;
              if (!data.questionNumber && quizInfo && data.questionId) {
                const qIndex = quizInfo.questions.findIndex((q: any) => q.id === data.questionId);
                if (qIndex >= 0) questionNumber = qIndex + 1;
              }

              const typeLabel = FEEDBACK_TYPE_LABELS[data.type] || '';
              const content = data.content
                ? `${typeLabel ? `[${typeLabel}] ` : ''}${data.content}`
                : typeLabel || '피드백';

              feedbackItems.push({
                id: feedbackDoc.id,
                quizTitle: quizInfo?.title || '퀴즈',
                questionNumber,
                content,
                studentNickname: '익명',
                createdAt: data.createdAt?.toDate() || new Date(),
                isRead: data.isRead || false,
                type: data.type,
              });
            }
          }
        }

        setFeedbacks(feedbackItems);
        setStats(prev => ({ ...prev, newFeedbacks: feedbackItems.filter(f => !f.isRead).length }));
      } catch (error) {
        console.error('피드백 로드 오류:', error);
      } finally {
        setLoading(false);
      }
    };

    loadFeedbacks();
  }, [user]);

  // 네비게이션 핸들러
  const handleCreateQuiz = useCallback(() => {
    router.push('/professor/quiz/create');
  }, [router]);

  const handleViewStudents = useCallback(() => {
    router.push('/professor/students');
  }, [router]);

  const handleAnalyze = useCallback(() => {
    router.push('/professor/analysis');
  }, [router]);

  const handleViewFeedback = useCallback(() => {
    router.push('/professor/feedback');
  }, [router]);

  const handleViewAllFeedback = useCallback(() => {
    router.push('/professor/feedback');
  }, [router]);

  const handleFeedbackClick = useCallback((feedbackId: string) => {
    router.push(`/professor/feedback/${feedbackId}`);
  }, [router]);

  const handleSettings = useCallback(() => {
    router.push('/professor/settings');
  }, [router]);

  const handleViewStyleProfile = useCallback(() => {
    setShowStyleProfile(true);
  }, []);

  // 로딩 상태
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="대시보드" />
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* 헤더 */}
      <Header title="대시보드" />

      {/* 환영 메시지 */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-4 py-4"
      >
        <h2 className="text-xl font-bold text-gray-800">
          안녕하세요, 교수님! 👋
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          오늘도 학생들의 성장을 함께해주세요
        </p>
      </motion.div>

      {/* 메인 컨텐츠 */}
      <main className="px-4 space-y-4">
        {/* 통계 카드 */}
        <DashboardStats
          totalStudents={stats.totalStudents}
          weeklyParticipation={stats.weeklyParticipation}
          averageScore={stats.averageScore}
          newFeedbacks={stats.newFeedbacks}
        />

        {/* 빠른 액션 */}
        <QuickActions
          onCreateQuiz={handleCreateQuiz}
          onViewStudents={handleViewStudents}
          onAnalyze={handleAnalyze}
          onViewFeedback={handleViewFeedback}
          onViewStyleProfile={handleViewStyleProfile}
          onSettings={handleSettings}
        />

        {/* 반별 참여율 */}
        <ClassParticipation classes={mockClasses} />

        {/* 최근 피드백 */}
        <RecentFeedback
          feedbacks={feedbacks}
          onViewAll={handleViewAllFeedback}
          onFeedbackClick={handleFeedbackClick}
        />
      </main>

      {/* 출제 스타일 분석 모달 */}
      <StyleProfileModal
        isOpen={showStyleProfile}
        onClose={() => setShowStyleProfile(false)}
        courseId="pathophysiology"
      />
    </div>
  );
}
