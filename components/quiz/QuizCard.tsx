'use client';

import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';

/**
 * 퀴즈 난이도 타입
 */
export type QuizDifficulty = 'easy' | 'normal' | 'hard';

/**
 * 퀴즈 카드 데이터 타입
 */
export interface QuizCardData {
  /** 퀴즈 ID */
  id: string;
  /** 퀴즈 제목 */
  title: string;
  /** 퀴즈 유형 */
  type: 'midterm' | 'final' | 'past' | 'custom';
  /** 문제 수 */
  questionCount: number;
  /** 난이도 */
  difficulty: QuizDifficulty;
  /** 참여자 수 */
  participantCount: number;
  /** 평균 점수 */
  averageScore: number;
  /** 완료 여부 */
  isCompleted: boolean;
  /** 내 점수 (완료 시) */
  myScore?: number;
  /** 썸네일 이미지 URL (선택) */
  thumbnailUrl?: string;
  /** 생성자 닉네임 (자체제작 퀴즈) */
  creatorNickname?: string;
}

interface QuizCardProps {
  /** 퀴즈 데이터 */
  quiz: QuizCardData;
  /** 클릭 핸들러 (기본: 퀴즈 상세 페이지 이동) */
  onClick?: () => void;
  /** 추가 클래스명 */
  className?: string;
}

// 난이도별 스타일
const difficultyStyles: Record<
  QuizDifficulty,
  { label: string; bg: string; text: string }
> = {
  easy: { label: '쉬움', bg: 'bg-green-100', text: 'text-green-700' },
  normal: { label: '보통', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  hard: { label: '어려움', bg: 'bg-red-100', text: 'text-red-700' },
};

// 퀴즈 유형별 라벨
const typeLabels: Record<'midterm' | 'final' | 'past' | 'custom', string> = {
  midterm: '중간',
  final: '기말',
  past: '족보',
  custom: '자체제작',
};

/**
 * 퀴즈 카드 컴포넌트
 *
 * 퀴즈 목록에서 개별 퀴즈를 표시하는 카드입니다.
 * 제목, 문제 수, 난이도, 참여자 수, 평균 점수, 완료 여부를 표시합니다.
 *
 * @example
 * ```tsx
 * <QuizCard
 *   quiz={{
 *     id: '1',
 *     title: '1주차 복습 퀴즈',
 *     type: 'midterm',
 *     questionCount: 10,
 *     difficulty: 'normal',
 *     participantCount: 25,
 *     averageScore: 78,
 *     isCompleted: true,
 *     myScore: 85,
 *   }}
 * />
 * ```
 */
export default function QuizCard({ quiz, onClick, className = '' }: QuizCardProps) {
  const router = useRouter();
  const difficultyStyle = difficultyStyles[quiz.difficulty];

  // 카드 클릭 핸들러
  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      // 기본 동작: 퀴즈 상세 페이지로 이동
      router.push(`/quiz/${quiz.id}`);
    }
  };

  return (
    <motion.div
      onClick={handleClick}
      whileHover={{ y: -4, boxShadow: '0 8px 30px rgba(0, 0, 0, 0.12)' }}
      whileTap={{ scale: 0.98 }}
      className={`
        relative bg-white rounded-2xl shadow-sm p-4 cursor-pointer
        transition-all duration-200 overflow-hidden
        ${className}
      `}
    >
      {/* 완료 체크마크 뱃지 */}
      {quiz.isCompleted && (
        <div className="absolute top-3 right-3 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
          <svg
            className="w-4 h-4 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
      )}

      {/* 썸네일 영역 */}
      <div className="relative w-full h-24 bg-gradient-to-br from-theme-accent/20 to-theme-accent/5 rounded-xl mb-3 overflow-hidden">
        {quiz.thumbnailUrl ? (
          <img
            src={quiz.thumbnailUrl}
            alt={quiz.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-4xl opacity-50">📝</span>
          </div>
        )}

        {/* 퀴즈 유형 뱃지 */}
        <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/50 text-white text-xs font-medium rounded-full">
          {typeLabels[quiz.type]}
        </div>
      </div>

      {/* 퀴즈 제목 */}
      <h3 className="text-sm font-bold text-gray-900 mb-2 line-clamp-2 min-h-[2.5rem]">
        {quiz.title}
      </h3>

      {/* 자체제작 퀴즈 생성자 */}
      {quiz.type === 'custom' && quiz.creatorNickname && (
        <p className="text-xs text-gray-500 mb-2">
          by {quiz.creatorNickname}
        </p>
      )}

      {/* 문제 수 & 난이도 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-600">
          {quiz.questionCount}문제
        </span>
        <span className="w-1 h-1 bg-gray-300 rounded-full" />
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${difficultyStyle.bg} ${difficultyStyle.text}`}
        >
          {difficultyStyle.label}
        </span>
      </div>

      {/* 참여자 & 평균 점수 */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <span>{quiz.participantCount}명</span>
        </div>

        <div className="flex items-center gap-1">
          <span>평균</span>
          <span className="font-semibold text-gray-700">
            {quiz.averageScore}점
          </span>
        </div>
      </div>

      {/* 내 점수 (완료 시) */}
      {quiz.isCompleted && quiz.myScore !== undefined && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">내 점수</span>
            <span
              className={`
                text-sm font-bold
                ${quiz.myScore >= quiz.averageScore ? 'text-green-600' : 'text-orange-600'}
              `}
            >
              {quiz.myScore}점
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}
