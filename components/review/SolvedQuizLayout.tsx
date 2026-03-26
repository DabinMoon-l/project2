'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, getDoc, collection, query, where, onSnapshot, db } from '@/lib/repositories';
import { getPastExamOptions, type PastExamOption } from '@/lib/types/course';
import { generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';
import type { CompletedQuizData } from './types';
import type { QuizAttempt } from '@/lib/hooks/useReview';
import ReviewNewsCarousel from './ReviewNewsCarousel';
import CustomReviewQuizCard from './CustomReviewQuizCard';

/**
 * 문제 탭 레이아웃 (뉴스 스타일 캐러셀)
 */
export default function SolvedQuizLayout({
  userId,
  courseId,
  onQuizClick,
  onQuizClickWrongOnly,
  onShowDetails,
  onQuizCardClick,
  isQuizBookmarked,
  onToggleBookmark,
  isSelectMode = false,
  selectedFolderIds,
  onSelectToggle,
  quizAttempts = [],
}: {
  userId: string;
  courseId: string | null;
  onQuizClick: (quizId: string) => void;
  onQuizClickWrongOnly?: (quizId: string) => void;
  onShowDetails: (quiz: CompletedQuizData) => void;
  onQuizCardClick: (quizId: string) => void;
  isQuizBookmarked: (quizId: string) => boolean;
  onToggleBookmark: (quizId: string) => void;
  isSelectMode?: boolean;
  selectedFolderIds?: Set<string>;
  onSelectToggle?: (quizId: string) => void;
  quizAttempts?: QuizAttempt[];
}) {
  // 각 타입별 퀴즈 상태
  const [midtermQuizzes, setMidtermQuizzes] = useState<CompletedQuizData[]>([]);
  const [finalQuizzes, setFinalQuizzes] = useState<CompletedQuizData[]>([]);
  const [pastQuizzes, setPastQuizzes] = useState<CompletedQuizData[]>([]);
  const [customQuizzes, setCustomQuizzes] = useState<CompletedQuizData[]>([]);

  const [isLoading, setIsLoading] = useState({
    midterm: true,
    final: true,
    past: true,
    custom: true,
  });

  // 기출 드롭다운 상태
  const pastExamOptions = useMemo(() => getPastExamOptions(courseId), [courseId]);
  const [selectedPastExam, setSelectedPastExam] = useState<string>(() => {
    return pastExamOptions.length > 0 ? pastExamOptions[0].value : '2025-midterm';
  });

  // 자작 퀴즈 태그 필터 상태
  const [selectedCustomTags, setSelectedCustomTags] = useState<string[]>([]);
  const [showTagFilter, setShowTagFilter] = useState(false);

  // 모든 완료된 퀴즈 통합 로드 (quiz_completions 기반 - hotspot 제거)
  useEffect(() => {
    if (!userId) {
      setIsLoading({ midterm: false, final: false, past: false, custom: false });
      return;
    }

    // quiz_completions 구독 → 완료된 퀴즈 ID 목록 → 퀴즈 문서 조회
    const q = query(
      collection(db, 'quiz_completions'),
      where('userId', '==', userId)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const completions = new Map<string, number>();
      snapshot.forEach(d => {
        const data = d.data();
        completions.set(data.quizId, data.score ?? 0);
      });

      const quizIds = Array.from(completions.keys());

      if (quizIds.length === 0) {
        setMidtermQuizzes([]);
        setFinalQuizzes([]);
        setPastQuizzes([]);
        setCustomQuizzes([]);
        setIsLoading({ midterm: false, final: false, past: false, custom: false });
        return;
      }

      // 퀴즈 문서 배치 조회 (10개씩 병렬)
      const midterm: CompletedQuizData[] = [];
      const final: CompletedQuizData[] = [];
      const past: CompletedQuizData[] = [];
      const custom: CompletedQuizData[] = [];

      for (let i = 0; i < quizIds.length; i += 10) {
        const batch = quizIds.slice(i, i + 10);
        const docs = await Promise.all(
          batch.map(id => getDoc(doc(db, 'quizzes', id)))
        );

        for (const quizDoc of docs) {
          if (!quizDoc.exists()) continue;
          const data = quizDoc.data();
          const completionScore = completions.get(quizDoc.id);

          const quizData: CompletedQuizData = {
            id: quizDoc.id,
            title: data.title || '제목 없음',
            type: data.type || 'custom',
            questionCount: data.questionCount || 0,
            participantCount: data.participantCount || 0,
            tags: data.tags || [],
            creatorNickname: data.creatorNickname,
            attachmentUrl: data.attachmentUrl,
            oneLineSummary: data.oneLineSummary,
            difficultyImageUrl: data.difficultyImageUrl,
            multipleChoiceCount: data.multipleChoiceCount || 0,
            subjectiveCount: data.subjectiveCount || 0,
            oxCount: data.oxCount || 0,
            difficulty: data.difficulty || 'normal',
            pastYear: data.pastYear,
            pastExamType: data.pastExamType,
            myScore: completionScore ?? data.userScores?.[userId],
            myFirstReviewScore: data.userFirstReviewScores?.[userId],
            isAiGenerated: data.isAiGenerated || data.type === 'ai-generated',
            averageScore: (data.averageScore && data.averageScore <= 100) ? data.averageScore : (() => {
              if (data.userScores) {
                const scores = Object.values(data.userScores) as number[];
                return scores.length > 0 ? Math.min(Math.round((scores.reduce((s: number, v: number) => s + v, 0) / scores.length) * 10) / 10, 100) : 0;
              }
              return 0;
            })(),
          };

          switch (data.type) {
            case 'midterm':
              if (data.courseId === courseId) midterm.push(quizData);
              break;
            case 'final':
              if (data.courseId === courseId) final.push(quizData);
              break;
            case 'past':
              if (data.courseId === courseId) past.push(quizData);
              break;
            case 'custom':
              custom.push(quizData);
              break;
          }
        }
      }

      setMidtermQuizzes(midterm);
      setFinalQuizzes(final);
      setPastQuizzes(past);
      setCustomQuizzes(custom);
      setIsLoading({ midterm: false, final: false, past: false, custom: false });
    }, (err) => {
      console.error('풀었던 퀴즈 구독 에러:', err);
      setIsLoading({ midterm: false, final: false, past: false, custom: false });
    });

    return () => unsubscribe();
  }, [userId, courseId]);

  // 기출 퀴즈 필터링 (selectedPastExam 변경 시 클라이언트에서 필터)
  const filteredPastQuizzes = useMemo(() => {
    const [yearStr, examType] = selectedPastExam.split('-');
    const year = parseInt(yearStr, 10);
    return pastQuizzes.filter(q => q.pastYear === year && q.pastExamType === examType);
  }, [pastQuizzes, selectedPastExam]);

  // 자작 퀴즈를 최근 푼 순서로 정렬
  const sortedCustomQuizzes = useMemo(() => {
    if (!quizAttempts || quizAttempts.length === 0) return customQuizzes;

    // 퀴즈별 가장 최근 완료 시간 맵 생성
    const latestCompletionMap = new Map<string, number>();
    quizAttempts.forEach(attempt => {
      const time = attempt.completedAt?.toMillis?.() || 0;
      const existing = latestCompletionMap.get(attempt.quizId) || 0;
      if (time > existing) {
        latestCompletionMap.set(attempt.quizId, time);
      }
    });

    // 최근 푼 순서로 정렬 (최신이 먼저)
    return [...customQuizzes].sort((a, b) => {
      const aTime = latestCompletionMap.get(a.id) || 0;
      const bTime = latestCompletionMap.get(b.id) || 0;
      return bTime - aTime;
    });
  }, [customQuizzes, quizAttempts]);

  // 과목별 동적 태그 목록 (공통 태그 + 챕터 태그)
  const fixedTagOptions = useMemo(() => {
    const courseTags = generateCourseTags(courseId);
    // 태그 값만 추출 (label이 아닌 value 사용)
    return [...COMMON_TAGS.map(t => t.value), ...courseTags.map(t => t.value)];
  }, [courseId]);

  // 태그 필터링된 자작 퀴즈
  const filteredCustomQuizzes = useMemo(() => {
    if (selectedCustomTags.length === 0) return sortedCustomQuizzes;
    // 선택된 모든 태그를 포함하는 퀴즈만 필터링 (AND 조건)
    return sortedCustomQuizzes.filter(quiz =>
      selectedCustomTags.every(tag => quiz.tags?.includes(tag))
    );
  }, [sortedCustomQuizzes, selectedCustomTags]);

  return (
    <div className="flex flex-col">
      {/* 뉴스 캐러셀 (중간/기말/기출) */}
      <section className="mb-8">
        <ReviewNewsCarousel
          midtermQuizzes={midtermQuizzes}
          finalQuizzes={finalQuizzes}
          pastQuiz={filteredPastQuizzes.length > 0 ? filteredPastQuizzes[0] : null}
          pastExamOptions={pastExamOptions}
          selectedPastExam={selectedPastExam}
          onSelectPastExam={setSelectedPastExam}
          isLoading={isLoading}
          onReview={onQuizClick}
          onShowDetails={onShowDetails}
          isQuizBookmarked={isQuizBookmarked}
          onToggleBookmark={onToggleBookmark}
        />
      </section>

      {/* 자작 섹션 */}
      <section className="px-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif-display text-xl font-black text-[#1A1A1A] shrink-0">자작</h2>

          {/* 선택된 태그들 + 태그 아이콘 (우측) */}
          <div className="flex items-center gap-2">
            {/* 선택된 태그들 (태그 아이콘 왼쪽에 배치) */}
            {selectedCustomTags.map((tag) => (
              <div
                key={tag}
                className="flex items-center gap-1 px-2 py-1 bg-[#F5F0E8] text-[#1A1A1A] text-sm font-bold border border-[#1A1A1A]"
              >
                #{tag}
                <button
                  onClick={() => setSelectedCustomTags(prev => prev.filter(t => t !== tag))}
                  className="ml-0.5 hover:text-[#5C5C5C]"
                >
                  ✕
                </button>
              </div>
            ))}

            {/* 태그 검색 버튼 */}
            <button
              onClick={() => setShowTagFilter(!showTagFilter)}
              className={`flex items-center justify-center w-9 h-9 border transition-colors shrink-0 rounded-lg ${
                showTagFilter
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A]'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </button>
          </div>
        </div>

        {/* 태그 필터 목록 */}
        <AnimatePresence>
          {showTagFilter && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-4"
            >
              <div className="flex flex-wrap gap-1.5 p-2 bg-[#EDEAE4] border border-[#D4CFC4]">
                {/* 태그 버튼들 (이미 선택된 태그 제외) */}
                {fixedTagOptions
                  .filter(tag => !selectedCustomTags.includes(tag))
                  .map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        setSelectedCustomTags(prev => [...prev, tag]);
                        setShowTagFilter(false);
                      }}
                      className="px-2 py-1 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#E5E0D8] transition-colors"
                    >
                      #{tag}
                    </button>
                  ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 전체 퀴즈가 없을 때 */}
        {!isLoading.custom && sortedCustomQuizzes.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center text-center py-12"
          >
            <h3 className="font-serif-display text-lg font-black mb-2 text-[#1A1A1A]">
              완료한 자작 퀴즈가 없습니다
            </h3>
            <p className="text-sm text-[#5C5C5C]">
              퀴즈를 풀면 여기서 복습할 수 있습니다
            </p>
          </motion.div>
        )}

        {/* 필터링 결과가 없을 때 */}
        {!isLoading.custom && sortedCustomQuizzes.length > 0 && filteredCustomQuizzes.length === 0 && selectedCustomTags.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center text-center py-8"
          >
            <p className="text-sm text-[#5C5C5C]">
              {selectedCustomTags.map(t => `#${t}`).join(' ')} 태그가 있는 퀴즈가 없습니다
            </p>
            <button
              onClick={() => setSelectedCustomTags([])}
              className="mt-2 px-4 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              필터 해제
            </button>
          </motion.div>
        )}

        {/* 퀴즈 목록 */}
        {!isLoading.custom && filteredCustomQuizzes.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {filteredCustomQuizzes.map((quiz, index) => (
              <motion.div
                key={quiz.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
              >
                <CustomReviewQuizCard
                  quiz={quiz}
                  onCardClick={() => {
                    if (isSelectMode && onSelectToggle) {
                      onSelectToggle(quiz.id);
                    } else {
                      onQuizCardClick(quiz.id);
                    }
                  }}
                  onDetails={() => onShowDetails(quiz)}
                  onReview={() => onQuizClick(quiz.id)}
                  onReviewWrongOnly={onQuizClickWrongOnly && quiz.myScore !== 100 ? () => onQuizClickWrongOnly(quiz.id) : undefined}
                  isBookmarked={isQuizBookmarked(quiz.id)}
                  onToggleBookmark={() => onToggleBookmark(quiz.id)}
                  isSelectMode={isSelectMode}
                  isSelected={selectedFolderIds?.has(`solved-${quiz.id}`) || false}
                />
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
