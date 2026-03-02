'use client';

/**
 * 복습 리스트 사이드바 (가로모드 전용)
 *
 * 가로모드에서 복습 상세(/review/[type]/[id]) 진입 시
 * 좌측에 복습 퀴즈 목록을 표시하는 간소화된 사이드바.
 */

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts';

interface SidebarReview {
  id: string;
  quizTitle: string;
  type: 'wrong' | 'bookmark' | 'solved';
  questionCount: number;
}

const TYPE_LABELS: Record<string, string> = {
  wrong: '오답 노트',
  bookmark: '찜한 문제',
  solved: '풀었던 문제',
};

const TYPE_ORDER: Record<string, number> = {
  wrong: 0,
  bookmark: 1,
  solved: 2,
};

export default function ReviewListSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { userCourseId } = useCourse();
  const [reviews, setReviews] = useState<SidebarReview[]>([]);
  const [loading, setLoading] = useState(true);

  // URL에서 현재 리뷰 type/id 추출
  const pathMatch = pathname?.match(/^\/review\/([^/]+)\/([^/]+)/);
  const currentType = pathMatch?.[1] || null;
  const currentId = pathMatch?.[2] || null;

  // 복습 데이터 로드
  useEffect(() => {
    if (!user || !userCourseId) return;

    const loadReviews = async () => {
      try {
        const q = query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('courseId', '==', userCourseId)
        );
        const snap = await getDocs(q);

        // quizId별 + type별 그룹화
        const reviewMap = new Map<string, SidebarReview>();
        snap.forEach(d => {
          const data = d.data();
          const quizId = data.quizId || d.id;
          const type = data.filterType || data.type || 'wrong';
          const key = `${type}_${quizId}`;

          if (!reviewMap.has(key)) {
            reviewMap.set(key, {
              id: quizId,
              quizTitle: data.quizTitle || '제목 없음',
              type,
              questionCount: 1,
            });
          } else {
            const existing = reviewMap.get(key)!;
            existing.questionCount++;
          }
        });

        const items = Array.from(reviewMap.values());
        items.sort((a, b) => {
          const ta = TYPE_ORDER[a.type] ?? 99;
          const tb = TYPE_ORDER[b.type] ?? 99;
          if (ta !== tb) return ta - tb;
          return a.quizTitle.localeCompare(b.quizTitle);
        });

        setReviews(items);
      } catch (err) {
        console.error('사이드바 복습 로드 오류:', err);
      } finally {
        setLoading(false);
      }
    };

    loadReviews();
  }, [user, userCourseId]);

  // 타입별 그룹화
  const grouped: Record<string, SidebarReview[]> = {};
  reviews.forEach(r => {
    if (!grouped[r.type]) grouped[r.type] = [];
    grouped[r.type].push(r);
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
          onClick={() => router.push('/review')}
          className="flex items-center gap-1.5 text-sm font-bold text-[#1A1A1A] hover:text-[#5C5C5C] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          복습
        </button>
      </div>

      {/* 리뷰 리스트 */}
      {loading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 bg-[#EBE5D9] animate-pulse rounded-lg" />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="p-8 text-center text-sm text-[#5C5C5C]">복습 항목이 없습니다</div>
      ) : (
        <div className="px-3 py-3">
          {['wrong', 'bookmark', 'solved'].map(type => {
            const items = grouped[type];
            if (!items?.length) return null;
            return (
              <div key={type} className="mb-5">
                <p className="text-[10px] font-bold text-[#5C5C5C] uppercase tracking-widest px-2 mb-1.5">
                  {TYPE_LABELS[type]} ({items.reduce((s, r) => s + r.questionCount, 0)})
                </p>
                {items.map(review => {
                  const isActive = currentType === type && currentId === review.id;
                  return (
                    <button
                      key={`${type}_${review.id}`}
                      onClick={() => router.push(`/review/${type}/${review.id}`)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg mb-0.5 transition-all duration-200 ${
                        isActive
                          ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                          : 'hover:bg-[#EBE5D9] text-[#1A1A1A]'
                      }`}
                    >
                      <span className="text-sm font-medium truncate block">
                        {review.quizTitle}
                      </span>
                      <p className={`text-xs mt-0.5 ${
                        isActive ? 'text-[#F5F0E8]/60' : 'text-[#5C5C5C]'
                      }`}>
                        {review.questionCount}문제
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
