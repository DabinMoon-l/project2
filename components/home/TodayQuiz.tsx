'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useTheme } from '@/styles/themes/useTheme';

/**
 * 퀴즈 아이템 타입
 */
export interface QuizItem {
  // 퀴즈 ID
  id: string;
  // 퀴즈 제목
  title: string;
  // 문제 수
  questionCount: number;
  // 마감 시간 (옵션)
  deadline?: Date;
  // 참여 여부
  completed: boolean;
  // 맞힌 문제 수 (참여한 경우)
  correctCount?: number;
}

/**
 * TodayQuiz Props
 */
interface TodayQuizProps {
  // 오늘의 퀴즈 목록
  quizzes: QuizItem[];
  // 로딩 상태
  loading?: boolean;
}

/**
 * 남은 시간 포맷팅
 */
function formatTimeRemaining(deadline: Date): string {
  const now = new Date();
  const diff = deadline.getTime() - now.getTime();

  if (diff <= 0) return '마감됨';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}일 남음`;
  }

  if (hours > 0) {
    return `${hours}시간 ${minutes}분 남음`;
  }

  return `${minutes}분 남음`;
}

/**
 * 오늘의 퀴즈 카드 컴포넌트
 * 오늘 출제된 퀴즈 미리보기 및 참여 여부 표시
 */
export default function TodayQuiz({ quizzes, loading = false }: TodayQuizProps) {
  const { theme } = useTheme();

  // 로딩 스켈레톤
  if (loading) {
    return (
      <div className="w-full">
        <h3
          className="text-sm font-medium mb-3 px-1"
          style={{ color: theme.colors.textSecondary }}
        >
          오늘의 퀴즈
        </h3>
        <div
          className="rounded-2xl p-4 animate-pulse"
          style={{ backgroundColor: theme.colors.backgroundSecondary }}
        >
          <div
            className="h-6 w-3/4 rounded mb-3"
            style={{ backgroundColor: `${theme.colors.text}10` }}
          />
          <div
            className="h-4 w-1/2 rounded"
            style={{ backgroundColor: `${theme.colors.text}10` }}
          />
        </div>
      </div>
    );
  }

  // 퀴즈가 없는 경우
  if (quizzes.length === 0) {
    return (
      <div className="w-full">
        <h3
          className="text-sm font-medium mb-3 px-1"
          style={{ color: theme.colors.textSecondary }}
        >
          오늘의 퀴즈
        </h3>
        <motion.div
          className="rounded-2xl p-6 text-center"
          style={{
            backgroundColor: theme.colors.backgroundSecondary,
            border: `1px dashed ${theme.colors.border}`,
          }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span className="text-4xl mb-3 block">📭</span>
          <p
            className="text-sm"
            style={{ color: theme.colors.textSecondary }}
          >
            오늘은 새로운 퀴즈가 없어요
          </p>
          <p
            className="text-xs mt-1"
            style={{ color: theme.colors.textSecondary }}
          >
            잠시 쉬면서 복습해보는 건 어때요?
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* 섹션 타이틀 */}
      <div className="flex items-center justify-between mb-3 px-1">
        <h3
          className="text-sm font-medium"
          style={{ color: theme.colors.textSecondary }}
        >
          오늘의 퀴즈
        </h3>
        <Link href="/quiz">
          <span
            className="text-xs"
            style={{ color: theme.colors.accent }}
          >
            전체 보기 &rarr;
          </span>
        </Link>
      </div>

      {/* 퀴즈 리스트 */}
      <div className="space-y-3">
        {quizzes.map((quiz, index) => (
          <motion.div
            key={quiz.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Link href={quiz.completed ? `/quiz/${quiz.id}/result` : `/quiz/${quiz.id}`}>
              <motion.div
                className="rounded-2xl p-4 relative overflow-hidden"
                style={{
                  backgroundColor: theme.colors.backgroundSecondary,
                  border: `1px solid ${theme.colors.border}`,
                }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {/* 완료 표시 배경 */}
                {quiz.completed && (
                  <div
                    className="absolute inset-0 opacity-10"
                    style={{ backgroundColor: theme.colors.accent }}
                  />
                )}

                <div className="flex items-start justify-between relative z-10">
                  {/* 퀴즈 정보 */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {/* 상태 아이콘 */}
                      <span className="text-lg">
                        {quiz.completed ? '✅' : '📋'}
                      </span>
                      {/* 제목 */}
                      <h4
                        className="font-medium"
                        style={{ color: theme.colors.text }}
                      >
                        {quiz.title}
                      </h4>
                    </div>

                    {/* 메타 정보 */}
                    <div className="flex items-center gap-3 mt-2">
                      {/* 문제 수 */}
                      <span
                        className="text-xs"
                        style={{ color: theme.colors.textSecondary }}
                      >
                        {quiz.questionCount}문제
                      </span>

                      {/* 마감 시간 */}
                      {quiz.deadline && !quiz.completed && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: `${theme.colors.accent}20`,
                            color: theme.colors.accent,
                          }}
                        >
                          {formatTimeRemaining(quiz.deadline)}
                        </span>
                      )}

                      {/* 결과 (완료한 경우) */}
                      {quiz.completed && quiz.correctCount !== undefined && (
                        <span
                          className="text-xs font-medium"
                          style={{ color: theme.colors.accent }}
                        >
                          {quiz.correctCount}/{quiz.questionCount} 정답
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 참여 버튼/상태 */}
                  <div className="ml-3">
                    {quiz.completed ? (
                      <span
                        className="text-xs px-3 py-1.5 rounded-full font-medium"
                        style={{
                          backgroundColor: theme.colors.accent,
                          color: theme.colors.background,
                        }}
                      >
                        완료
                      </span>
                    ) : (
                      <motion.span
                        className="text-xs px-3 py-1.5 rounded-full font-medium"
                        style={{
                          backgroundColor: `${theme.colors.accent}20`,
                          color: theme.colors.accent,
                        }}
                        animate={{
                          scale: [1, 1.05, 1],
                        }}
                        transition={{
                          duration: 1.5,
                          repeat: Infinity,
                        }}
                      >
                        참여하기
                      </motion.span>
                    )}
                  </div>
                </div>
              </motion.div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
