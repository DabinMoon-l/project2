'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  collection,
  query,
  where,
  getDocs,
  limit,
  db,
} from '@/lib/repositories';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';

/**
 * 랜덤 복습 배너 컴포넌트
 * - 오답 문제 5개 랜덤 추출
 * - Click here! 버튼으로 복습 시작
 */
export default function RandomReviewBanner() {
  const router = useRouter();
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);

  // 랜덤 복습 시작
  const handleStartRandomReview = async () => {
    if (!profile || loading) return;

    setLoading(true);

    try {
      // 오답 문제 가져오기
      const reviewsQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', profile.uid),
        where('reviewType', '==', 'wrong')
      );
      const snapshot = await getDocs(reviewsQuery);

      if (snapshot.empty) {
        alert('아직 오답 문제가 없습니다!');
        setLoading(false);
        return;
      }

      // 랜덤으로 5개 선택
      const allWrongQuestions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      const shuffled = [...allWrongQuestions].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, Math.min(5, shuffled.length));

      // 선택된 문제 ID들을 세션 스토리지에 저장
      sessionStorage.setItem('randomReviewQuestions', JSON.stringify(selected.map(q => q.id)));

      // 복습 페이지로 이동
      router.push('/review/random');
    } catch (error) {
      console.error('오답 문제 로드 실패:', error);
      alert('문제를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      className="relative overflow-hidden border-2 border-[#1A1A1A]"
      style={{
        background: 'linear-gradient(135deg, #1A1A1A 0%, #3A3A3A 100%)',
      }}
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.2 }}
    >
      {/* 배경 패턴 */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-2 left-4 text-4xl">📝</div>
        <div className="absolute bottom-2 right-4 text-4xl">✏️</div>
        <div className="absolute top-1/2 left-1/4 text-2xl">❓</div>
        <div className="absolute top-1/3 right-1/4 text-2xl">💡</div>
      </div>

      <div className="relative flex items-center justify-between p-4">
        {/* 텍스트 */}
        <div className="flex items-center gap-3">
          <span className="text-3xl">🎯</span>
          <div>
            <p className="font-bold text-white text-lg">오답으로 빠르게 복습!</p>
            <p className="text-sm text-gray-300">랜덤 5문제로 실력 점검</p>
          </div>
        </div>

        {/* 버튼 */}
        <button
          onClick={handleStartRandomReview}
          disabled={loading}
          className="px-4 py-2 bg-[#F5F0E8] text-[#1A1A1A] font-bold border-2 border-[#F5F0E8] hover:bg-transparent hover:text-[#F5F0E8] transition-colors disabled:opacity-50"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              로딩...
            </span>
          ) : (
            'Click here!'
          )}
        </button>
      </div>
    </motion.div>
  );
}
