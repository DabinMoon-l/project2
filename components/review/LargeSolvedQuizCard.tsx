'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/common';
import { SPRING_TAP, TAP_SCALE } from '@/lib/constants/springs';
import { DIFFICULTY_IMAGES, DIFFICULTY_LABELS, type QuizDetails } from './types';
import { getChapterById } from '@/lib/courseIndex';

/**
 * 큰 푼 문제지 카드 컴포넌트 (전체 너비, 강조 표시)
 */
export function LargeSolvedQuizCard({
  quizId,
  title,
  count,
  onClick,
  courseId,
}: {
  quizId: string;
  title: string;
  count: number;
  onClick: () => void;
  courseId?: string;
}) {
  const [quizDetails, setQuizDetails] = useState<QuizDetails>({});
  const [loading, setLoading] = useState(true);

  // 퀴즈 상세 정보 가져오기
  useEffect(() => {
    const fetchQuizDetails = async () => {
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (quizDoc.exists()) {
          const data = quizDoc.data();
          setQuizDetails({
            difficulty: data.difficulty || 'normal',
            chapterId: data.chapterId,
            creatorNickname: data.creatorNickname || '익명',
          });
        }
      } catch (err) {
        console.error('퀴즈 상세 정보 로드 실패:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchQuizDetails();
  }, [quizId]);

  const difficulty = quizDetails.difficulty || 'normal';
  const chapterName = quizDetails.chapterId && courseId
    ? getChapterById(courseId, quizDetails.chapterId)?.name
    : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={TAP_SCALE}
      transition={SPRING_TAP}
      onClick={onClick}
      className="relative border-2 border-[#1A1A1A] bg-[#F5F0E8] cursor-pointer hover:bg-[#EDEAE4] transition-all"
    >
      {/* 상단: 검정색 박스 + 제목 */}
      <div className="bg-[#1A1A1A] px-4 py-3">
        <h3 className="font-serif-display text-lg font-bold text-[#F5F0E8] line-clamp-1">
          {title}
        </h3>
      </div>

      {/* 중앙: 난이도 이미지 (반응형, 빈틈없이 채움) */}
      <div className="relative w-full aspect-[2/1]">
        {loading ? (
          <div className="w-full h-full bg-[#EDEAE4] flex items-center justify-center">
            <Skeleton className="w-full h-full rounded-none" />
          </div>
        ) : (
          <Image
            src={DIFFICULTY_IMAGES[difficulty]}
            alt={DIFFICULTY_LABELS[difficulty]}
            fill
            className="object-fill"
          />
        )}
      </div>

      {/* 하단: 문제 정보 (한 줄, 가운데 정렬) */}
      <div className="px-4 pb-4 pt-2">
        <div className="flex items-center justify-center gap-2 text-sm text-[#5C5C5C]">
          {chapterName && (
            <>
              <span>{chapterName}</span>
              <span>•</span>
            </>
          )}
          <span className="font-bold text-[#1A1A1A]">{count}문제</span>
          <span>•</span>
          <span>{DIFFICULTY_LABELS[difficulty]}</span>
          <span>•</span>
          <span>{quizDetails.creatorNickname || '익명'}</span>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * 큰 푼 문제지 플레이스홀더 (빈 상태)
 */
export function LargeSolvedQuizPlaceholder() {
  return (
    <div className="border-2 border-dashed border-[#D4CFC4] bg-[#EDEAE4] rounded-xl overflow-hidden">
      {/* 상단: 검정색 박스 플레이스홀더 */}
      <div className="bg-[#D4CFC4] px-4 py-3">
        <div className="h-6 w-3/4 bg-[#C4BFB4]" />
      </div>

      {/* 중앙: 이미지 플레이스홀더 */}
      <div className="relative w-full aspect-[2/1] flex items-center justify-center border-y border-dashed border-[#C4BFB4]">
        <svg className="w-12 h-12 text-[#C4BFB4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>

      {/* 하단: 정보 플레이스홀더 */}
      <div className="px-4 py-3 flex justify-center">
        <div className="h-4 w-2/3 bg-[#C4BFB4]" />
      </div>
    </div>
  );
}
