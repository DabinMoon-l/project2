'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
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
import { Skeleton } from '@/components/common';

const QUIZZES_PER_PAGE = 12;

/** 필터 타입 */
type QuizFilter = 'all' | 'midterm' | 'final' | 'past' | 'custom';

/** 필터 옵션 */
const FILTER_OPTIONS: { value: QuizFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'midterm', label: '중간대비' },
  { value: 'final', label: '기말대비' },
  { value: 'past', label: '족보' },
  { value: 'custom', label: '제작' },
];

interface QuizCardData {
  id: string;
  title: string;
  type: string;
  questionCount: number;
  difficulty: string;
  participantCount: number;
  averageScore: number;
  isCompleted: boolean;
  myScore?: number;
  creatorNickname?: string;
}

/**
 * 슬라이드 필터 컴포넌트
 */
function SlideFilter({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: QuizFilter;
  onFilterChange: (filter: QuizFilter) => void;
}) {
  const activeIndex = FILTER_OPTIONS.findIndex((opt) => opt.value === activeFilter);

  return (
    <div className="relative flex items-center bg-[#EDEAE4] border border-[#1A1A1A]">
      {/* 슬라이드 배경 */}
      <motion.div
        className="absolute h-full bg-[#1A1A1A]"
        initial={false}
        animate={{
          left: `${activeIndex * 20}%`,
        }}
        style={{
          width: '20%',
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      />

      {/* 필터 옵션들 */}
      {FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onFilterChange(option.value)}
          className={`relative z-10 flex-1 px-4 py-2 text-xs font-bold transition-colors ${
            activeFilter === option.value ? 'text-[#F5F0E8]' : 'text-[#1A1A1A]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 퀴즈 카드 컴포넌트 - 미니멀 스타일
 */
function QuizCard({
  quiz,
  onStart,
  onDetails,
}: {
  quiz: QuizCardData;
  onStart: () => void;
  onDetails: () => void;
}) {
  return (
    <div className="border border-[#1A1A1A] bg-[#F5F0E8] p-4">
      {/* 제목 */}
      <h3 className="font-serif-display font-bold text-sm mb-2 line-clamp-2 text-[#1A1A1A]">
        {quiz.title}
      </h3>

      {/* 메타 정보 */}
      <p className="text-xs text-[#5C5C5C] mb-1">
        {quiz.questionCount}문제 · {quiz.participantCount}명 참여
      </p>

      {/* 내 점수 */}
      {quiz.myScore !== undefined && (
        <p className="text-xs text-[#1A1A1A] mb-3">
          내 점수: {quiz.myScore}점
        </p>
      )}

      {/* 버튼 영역 */}
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDetails();
          }}
          className="flex-1 py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
        >
          Details
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStart();
          }}
          className="flex-1 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
        >
          Start
        </button>
      </div>
    </div>
  );
}

/**
 * 스켈레톤 카드
 */
function SkeletonCard() {
  return (
    <div className="border border-[#1A1A1A] bg-[#F5F0E8] p-4">
      <Skeleton className="w-3/4 h-4 mb-2 rounded-none" />
      <Skeleton className="w-1/2 h-3 mb-3 rounded-none" />
      <div className="flex gap-2">
        <Skeleton className="flex-1 h-8 rounded-none" />
        <Skeleton className="flex-1 h-8 rounded-none" />
      </div>
    </div>
  );
}

export default function QuizListPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [activeFilter, setActiveFilter] = useState<QuizFilter>('all');
  const [quizzes, setQuizzes] = useState<QuizCardData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [selectedQuiz, setSelectedQuiz] = useState<QuizCardData | null>(null);

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

        const quizzesRef = collection(db, 'quizzes');
        let q;

        if (activeFilter === 'all') {
          q = query(quizzesRef, orderBy('createdAt', 'desc'), limit(QUIZZES_PER_PAGE));
        } else {
          q = query(
            quizzesRef,
            where('type', '==', activeFilter),
            orderBy('createdAt', 'desc'),
            limit(QUIZZES_PER_PAGE)
          );
        }

        if (!isInitial && lastDoc) {
          if (activeFilter === 'all') {
            q = query(quizzesRef, orderBy('createdAt', 'desc'), startAfter(lastDoc), limit(QUIZZES_PER_PAGE));
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
          // 이미 푼 퀴즈는 목록에서 제외 (리뷰창에서만 볼 수 있음)
          const isCompleted = data.completedUsers?.includes(user.uid) || false;
          if (isCompleted) return;

          newQuizzes.push({
            id: doc.id,
            title: data.title || '제목 없음',
            type: data.type || 'midterm',
            questionCount: data.questionCount || 0,
            difficulty: data.difficulty || 'normal',
            participantCount: data.participantCount || 0,
            averageScore: data.averageScore || 0,
            isCompleted: false,
            myScore: data.userScores?.[user.uid],
            creatorNickname: data.creatorNickname,
          });
        });

        if (snapshot.docs.length > 0) {
          setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
        }

        if (snapshot.docs.length < QUIZZES_PER_PAGE) {
          setHasMore(false);
        }

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

  useEffect(() => {
    if (user) {
      fetchQuizzes(true);
    }
  }, [activeFilter, user]);

  const handleLoadMore = () => {
    if (hasMore && !isFetchingMore) {
      fetchQuizzes(false);
    }
  };

  const handleStartQuiz = (quizId: string) => {
    router.push(`/quiz/${quizId}`);
  };

  const handleShowDetails = (quiz: QuizCardData) => {
    setSelectedQuiz(quiz);
  };

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 - 리본 이미지 */}
      <header className="pt-6 pb-4 flex flex-col items-center">
        {/* 리본 이미지 */}
        <div className="relative w-full px-4 h-32 sm:h-44 md:h-56 mb-4">
          <Image
            src="/images/quiz-ribbon.png"
            alt="Quiz"
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 80vw, 60vw"
            className="object-contain"
            priority
          />
        </div>

        {/* 필터 + 버튼 영역 */}
        <div className="w-full px-4 flex items-center justify-between gap-4">
          {/* 슬라이드 필터 - 좌측 */}
          <SlideFilter
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
          />

          {/* 퀴즈 만들기 버튼 - 우측 */}
          <button
            onClick={() => router.push('/quiz/create')}
            className="px-6 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#3A3A3A] transition-colors"
          >
            퀴즈 만들기
          </button>
        </div>
      </header>

      <main className="px-4">
        {/* 로딩 스켈레톤 */}
        {isLoading && (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* 빈 상태 */}
        {!isLoading && quizzes.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="py-16 text-center"
          >
            <h3 className="font-serif-display text-xl font-black mb-2 text-[#1A1A1A]">
              아직 퀴즈가 없습니다
            </h3>
            <p className="text-sm text-[#3A3A3A]">
              첫 번째 퀴즈를 만들어보세요!
            </p>
          </motion.div>
        )}

        {/* 퀴즈 그리드 (3열) */}
        {!isLoading && quizzes.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-3">
              {quizzes.map((quiz, index) => (
                <motion.div
                  key={quiz.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                >
                  <QuizCard
                    quiz={quiz}
                    onStart={() => handleStartQuiz(quiz.id)}
                    onDetails={() => handleShowDetails(quiz)}
                  />
                </motion.div>
              ))}
            </div>

            {/* See More 버튼 */}
            {hasMore && (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isFetchingMore}
                  className="px-6 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50"
                >
                  {isFetchingMore ? 'Loading...' : 'See More →'}
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* 퀴즈 상세 모달 */}
      {selectedQuiz && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setSelectedQuiz(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            <h2 className="text-lg font-bold text-[#1A1A1A] mb-4">{selectedQuiz.title}</h2>

            <div className="space-y-2 mb-6">
              <p className="text-sm text-[#5C5C5C]">
                문제 수: <span className="font-bold text-[#1A1A1A]">{selectedQuiz.questionCount}문제</span>
              </p>
              <p className="text-sm text-[#5C5C5C]">
                참여자: <span className="font-bold text-[#1A1A1A]">{selectedQuiz.participantCount}명</span>
              </p>
              {selectedQuiz.myScore !== undefined && (
                <p className="text-sm text-[#5C5C5C]">
                  내 점수: <span className="font-bold text-[#1A1A1A]">{selectedQuiz.myScore}점</span>
                </p>
              )}
              {selectedQuiz.creatorNickname && (
                <p className="text-sm text-[#5C5C5C]">
                  제작자: <span className="font-bold text-[#1A1A1A]">{selectedQuiz.creatorNickname}</span>
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setSelectedQuiz(null)}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  setSelectedQuiz(null);
                  handleStartQuiz(selectedQuiz.id);
                }}
                className="flex-1 py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
              >
                시작하기
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
