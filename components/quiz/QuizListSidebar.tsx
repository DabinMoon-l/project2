'use client';

/**
 * 퀴즈 리스트 사이드바 (가로모드 전용)
 *
 * 가로모드에서 퀴즈 상세(풀이, 결과, 피드백, EXP) 페이지 진입 시
 * 좌측에 퀴즈 목록을 표시하는 간소화된 사이드바.
 *
 * 현재 퀴즈 하이라이트, 타입별 그룹핑, 완료 상태 표시.
 */

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts';

interface SidebarQuiz {
  id: string;
  title: string;
  type: string;
  questionCount: number;
  isCompleted: boolean;
  createdAt: number;
}

const TYPE_ORDER: Record<string, number> = {
  midterm: 0,
  final: 1,
  past: 2,
  custom: 3,
};

const TYPE_LABELS: Record<string, string> = {
  midterm: '중간고사',
  final: '기말고사',
  past: '기출문제',
  custom: '자작 퀴즈',
};

export default function QuizListSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { userCourseId } = useCourse();
  const [quizzes, setQuizzes] = useState<SidebarQuiz[]>([]);
  const [loading, setLoading] = useState(true);

  // URL에서 현재 퀴즈 ID 추출
  const currentQuizId = pathname?.match(/^\/quiz\/([^/]+)/)?.[1] || null;

  // 퀴즈 목록 로드 (one-time fetch, 실시간 구독 불필요)
  useEffect(() => {
    if (!user || !userCourseId) return;

    const loadQuizzes = async () => {
      try {
        // 교수 출제 퀴즈 (midterm, final, past)
        const q1 = query(
          collection(db, 'quizzes'),
          where('type', 'in', ['midterm', 'final', 'past']),
          where('courseId', '==', userCourseId)
        );
        // 자작 퀴즈 (custom)
        const q2 = query(
          collection(db, 'quizzes'),
          where('type', '==', 'custom'),
          where('courseId', '==', userCourseId)
        );

        const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        const items: SidebarQuiz[] = [];

        const parseDoc = (d: any) => {
          const data = d.data();
          items.push({
            id: d.id,
            title: data.title || '제목 없음',
            type: data.type,
            questionCount: data.questionCount || 0,
            isCompleted: data.completedUsers?.includes(user.uid) || false,
            createdAt: data.createdAt?.toMillis?.() || 0,
          });
        };

        snap1.forEach(parseDoc);
        snap2.forEach(parseDoc);

        // 타입별 정렬 → 같은 타입 내 최신순
        items.sort((a, b) => {
          const ta = TYPE_ORDER[a.type] ?? 99;
          const tb = TYPE_ORDER[b.type] ?? 99;
          if (ta !== tb) return ta - tb;
          return b.createdAt - a.createdAt;
        });

        setQuizzes(items);
      } catch (err) {
        console.error('사이드바 퀴즈 로드 오류:', err);
      } finally {
        setLoading(false);
      }
    };

    loadQuizzes();
  }, [user, userCourseId]);

  // 타입별 그룹화
  const grouped: Record<string, SidebarQuiz[]> = {};
  quizzes.forEach(q => {
    if (!grouped[q.type]) grouped[q.type] = [];
    grouped[q.type].push(q);
  });

  return (
    <div className="h-screen overflow-y-auto scrollbar-hide" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <div
        className="sticky top-0 z-10 px-4 py-3 flex items-center gap-2"
        style={{
          backgroundColor: '#F5F0E8',
          borderBottom: '1px solid #D4CFC4',
          paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))',
        }}
      >
        <button
          onClick={() => router.push('/quiz')}
          className="flex items-center gap-1.5 text-sm font-bold text-[#1A1A1A] hover:text-[#5C5C5C] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          퀴즈 목록
        </button>
      </div>

      {/* 퀴즈 리스트 */}
      {loading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 bg-[#EBE5D9] animate-pulse rounded-lg" />
          ))}
        </div>
      ) : quizzes.length === 0 ? (
        <div className="p-8 text-center text-sm text-[#5C5C5C]">퀴즈가 없습니다</div>
      ) : (
        <div className="px-3 py-3">
          {['midterm', 'final', 'past', 'custom'].map(type => {
            const items = grouped[type];
            if (!items?.length) return null;
            return (
              <div key={type} className="mb-5">
                <p className="text-[10px] font-bold text-[#5C5C5C] uppercase tracking-widest px-2 mb-1.5">
                  {TYPE_LABELS[type]}
                </p>
                {items.map(quiz => {
                  const isActive = currentQuizId === quiz.id;
                  return (
                    <button
                      key={quiz.id}
                      onClick={() => router.push(`/quiz/${quiz.id}`)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg mb-0.5 transition-all duration-200 ${
                        isActive
                          ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                          : 'hover:bg-[#EBE5D9] text-[#1A1A1A]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {quiz.isCompleted && (
                          <svg
                            className="w-3.5 h-3.5 flex-shrink-0"
                            fill={isActive ? '#F5F0E8' : '#1A6B1A'}
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                        <span
                          className={`text-sm font-medium truncate ${
                            isActive ? '' : quiz.isCompleted ? 'text-[#5C5C5C]' : ''
                          }`}
                        >
                          {quiz.title}
                        </span>
                      </div>
                      <p
                        className={`text-xs mt-0.5 ${quiz.isCompleted ? 'pl-[22px]' : ''} ${
                          isActive ? 'text-[#F5F0E8]/60' : 'text-[#5C5C5C]'
                        }`}
                      >
                        {quiz.questionCount}문제
                      </p>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
