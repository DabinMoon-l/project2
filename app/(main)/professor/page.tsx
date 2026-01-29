'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Header, Skeleton } from '@/components/common';
import {
  DashboardStats,
  RecentFeedback,
  ClassParticipation,
  QuickActions,
} from '@/components/professor';
import { useAuth } from '@/lib/hooks/useAuth';

// 임시 목업 데이터 (실제로는 Firestore에서 가져옴)
const mockFeedbacks = [
  {
    id: '1',
    quizTitle: '중간고사 대비',
    questionNumber: 3,
    content: '이 문제의 해설이 좀 더 자세했으면 좋겠어요. 왜 2번이 답인지 이해가 안 됩니다.',
    studentNickname: '용감한토끼',
    createdAt: new Date(Date.now() - 1000 * 60 * 30), // 30분 전
    isRead: false,
  },
  {
    id: '2',
    quizTitle: '1주차 복습',
    questionNumber: 7,
    content: '문제가 모호한 것 같아요. 선지 1번과 3번이 둘 다 맞는 것 같습니다.',
    studentNickname: '익명',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2시간 전
    isRead: false,
  },
  {
    id: '3',
    quizTitle: '중간고사 대비',
    questionNumber: 15,
    content: '좋은 문제입니다! 덕분에 개념 정리가 됐어요.',
    studentNickname: '공부하는용사',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5), // 5시간 전
    isRead: true,
  },
];

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

  // 통계 데이터 (실제로는 Firestore에서)
  const [stats, setStats] = useState({
    totalStudents: 125,
    weeklyParticipation: 78,
    averageScore: 82,
    newFeedbacks: 5,
  });

  // 데이터 로드 시뮬레이션
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

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
        />

        {/* 반별 참여율 */}
        <ClassParticipation classes={mockClasses} />

        {/* 최근 피드백 */}
        <RecentFeedback
          feedbacks={mockFeedbacks}
          onViewAll={handleViewAllFeedback}
          onFeedbackClick={handleFeedbackClick}
        />
      </main>
    </div>
  );
}
