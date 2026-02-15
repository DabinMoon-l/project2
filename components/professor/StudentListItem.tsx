'use client';

import { motion } from 'framer-motion';
import {
  type StudentData,
  type ClassType,
  CLASS_COLORS,
} from '@/lib/hooks/useProfessorStudents';

// ============================================================
// 타입 정의
// ============================================================

interface StudentListItemProps {
  /** 학생 데이터 */
  student: StudentData;
  /** 클릭 핸들러 */
  onClick?: () => void;
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 마지막 활동 시간을 상대 시간으로 변환
 */
const getRelativeTime = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '방금 전';
  if (diffMins < 60) return `${diffMins}분 전`;
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffDays < 7) return `${diffDays}일 전`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전`;
  return `${Math.floor(diffDays / 30)}개월 전`;
};

/**
 * 정확도 계산
 */
const getAccuracy = (correct: number, total: number): number => {
  if (total === 0) return 0;
  return Math.round((correct / total) * 100);
};

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 학생 목록 아이템 컴포넌트
 *
 * 학생의 기본 정보, 퀴즈 통계, 활동 상태를 표시합니다.
 */
export default function StudentListItem({ student, onClick }: StudentListItemProps) {
  const accuracy = getAccuracy(
    student.quizStats.totalCorrect,
    student.quizStats.totalAttempts
  );

  const classColor = CLASS_COLORS[student.classId];

  // 활동 상태 판단 (최근 7일)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const isActive = student.lastActiveAt >= weekAgo;

  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className="bg-white rounded-2xl p-4 shadow-sm cursor-pointer transition-shadow hover:shadow-md"
    >
      {/* 상단: 프로필 + 기본 정보 */}
      <div className="flex items-start gap-3 mb-3">
        {/* 아바타 */}
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg"
          style={{ backgroundColor: classColor }}
        >
          {student.nickname.charAt(0)}
        </div>

        {/* 정보 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-gray-800 truncate">
              {student.nickname}
            </h3>
            {/* 활동 상태 표시 */}
            <span
              className={`w-2 h-2 rounded-full ${
                isActive ? 'bg-green-500' : 'bg-gray-300'
              }`}
            />
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            {/* 반 뱃지 */}
            <span
              className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: classColor }}
            >
              {student.classId}반
            </span>

            {/* 레벨 */}
            <span className="text-xs text-gray-400">
              Lv.{student.level}
            </span>
          </div>
        </div>

        {/* 마지막 활동 */}
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {getRelativeTime(student.lastActiveAt)}
        </span>
      </div>

      {/* 하단: 통계 */}
      <div className="grid grid-cols-4 gap-2">
        {/* 퀴즈 시도 */}
        <div className="text-center p-2 bg-gray-50 rounded-xl">
          <p className="text-lg font-bold text-indigo-600">
            {student.quizStats.totalAttempts}
          </p>
          <p className="text-xs text-gray-500">퀴즈</p>
        </div>

        {/* 정확도 */}
        <div className="text-center p-2 bg-gray-50 rounded-xl">
          <p className="text-lg font-bold text-green-600">{accuracy}%</p>
          <p className="text-xs text-gray-500">정확도</p>
        </div>

        {/* 평균 점수 */}
        <div className="text-center p-2 bg-gray-50 rounded-xl">
          <p className="text-lg font-bold text-amber-600">
            {Math.round(student.quizStats.averageScore)}
          </p>
          <p className="text-xs text-gray-500">평균</p>
        </div>

        {/* 피드백 수 */}
        <div className="text-center p-2 bg-gray-50 rounded-xl">
          <p className="text-lg font-bold text-purple-600">
            {student.feedbackCount}
          </p>
          <p className="text-xs text-gray-500">피드백</p>
        </div>
      </div>
    </motion.div>
  );
}
