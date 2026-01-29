'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ThemeProvider } from '@/styles/themes/ThemeProvider';
import { useRequireAuth } from '@/lib/hooks/useAuth';
import Navigation from '@/components/common/Navigation';
import { NotificationProvider } from '@/components/common';
import type { ClassType } from '@/styles/themes';

/**
 * 메인 레이아웃
 * - ThemeProvider 적용
 * - Navigation 바 포함
 * - 인증 체크 (미로그인 시 로그인 페이지로 리다이렉트)
 */
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, loading } = useRequireAuth();
  const [userClassType, setUserClassType] = useState<ClassType>('A');
  const [isProfessor, setIsProfessor] = useState(false);

  // 사용자 정보에서 반 타입과 역할 가져오기
  useEffect(() => {
    if (user) {
      // TODO: Firestore에서 사용자 정보 가져오기
      // 현재는 임시로 로컬 스토리지에서 가져옴
      const storedClassType = localStorage.getItem('hero-quiz-class-type');
      if (storedClassType && ['A', 'B', 'C', 'D'].includes(storedClassType)) {
        setUserClassType(storedClassType as ClassType);
      }

      // 교수님 이메일 체크 (특정 이메일은 교수님으로 설정)
      const professorEmails = ['professor@example.com', 'admin@example.com'];
      setIsProfessor(professorEmails.includes(user.email || ''));
    }
  }, [user]);

  // 로딩 중일 때 스피너 표시
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#4A0E0E]">
        <motion.div
          className="flex flex-col items-center gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {/* 로딩 스피너 */}
          <motion.div
            className="w-12 h-12 border-4 border-[#D4AF37] border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="text-[#D4AF37] text-sm">로딩 중...</p>
        </motion.div>
      </div>
    );
  }

  // 로그인되지 않은 경우 (리다이렉트 중)
  if (!user) {
    return null;
  }

  return (
    <ThemeProvider initialClassType={userClassType}>
      <NotificationProvider>
        <div className="min-h-screen pb-20">
          {/* 페이지 전환 애니메이션 */}
          <AnimatePresence mode="wait">
            <motion.main
              key="main-content"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {children}
            </motion.main>
          </AnimatePresence>

          {/* 하단 네비게이션 바 */}
          <Navigation role={isProfessor ? 'professor' : 'student'} />
        </div>
      </NotificationProvider>
    </ThemeProvider>
  );
}
