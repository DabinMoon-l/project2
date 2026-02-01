'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useCourse } from '@/lib/contexts';
import { COURSES } from '@/lib/types/course';
import type { Semester } from '@/lib/types/course';

/**
 * 학기 설정 카드
 * 교수님이 현재 연도와 학기를 설정할 수 있는 컴포넌트
 */
export function SemesterSettingsCard() {
  const { semesterSettings, updateSemesterSettings, loading } = useCourse();
  const [isSaving, setIsSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // 편집용 임시 상태
  const [tempYear, setTempYear] = useState(semesterSettings?.currentYear || new Date().getFullYear());
  const [tempSemester, setTempSemester] = useState<Semester>(semesterSettings?.currentSemester || 1);

  // 현재 학기에 맞는 과목 목록
  const currentCourses = Object.values(COURSES).filter(
    (course) => course.semester === (semesterSettings?.currentSemester || 1)
  );

  /**
   * 설정 저장
   */
  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateSemesterSettings({
        currentYear: tempYear,
        currentSemester: tempSemester,
      });
      setEditMode(false);
    } catch (error) {
      console.error('학기 설정 저장 실패:', error);
      alert('설정 저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * 편집 취소
   */
  const handleCancel = () => {
    setTempYear(semesterSettings?.currentYear || new Date().getFullYear());
    setTempSemester(semesterSettings?.currentSemester || 1);
    setEditMode(false);
  };

  if (loading) {
    return (
      <div className="rounded-2xl p-5 bg-[#FDFBF7] border-2 border-[#1A1A1A]">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[#EBE5D9] rounded w-1/3" />
          <div className="h-10 bg-[#EBE5D9] rounded" />
          <div className="h-10 bg-[#EBE5D9] rounded" />
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-5 bg-[#FDFBF7] border-2 border-[#1A1A1A] shadow-[4px_4px_0_#1A1A1A]"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-serif-display font-bold text-lg text-[#1A1A1A]">
          학기 설정
        </h3>
        {!editMode && (
          <button
            onClick={() => setEditMode(true)}
            className="text-sm text-[#1E3A5F] hover:underline"
          >
            수정
          </button>
        )}
      </div>

      {/* 현재 설정 표시 */}
      {!editMode ? (
        <div className="space-y-4">
          {/* 현재 학기 */}
          <div className="flex items-center justify-between p-3 bg-[#EBE5D9] rounded-lg">
            <span className="text-[#5C5C5C]">현재 학기</span>
            <span className="font-serif-display font-bold text-[#1A1A1A]">
              {semesterSettings?.currentYear}년 {semesterSettings?.currentSemester}학기
            </span>
          </div>

          {/* 수강 가능 과목 */}
          <div className="p-3 bg-[#EBE5D9] rounded-lg">
            <span className="text-[#5C5C5C] text-sm block mb-2">수강 가능 과목</span>
            <div className="flex flex-wrap gap-2">
              {currentCourses.map((course) => (
                <span
                  key={course.id}
                  className="px-2 py-1 bg-[#FDFBF7] border border-[#D4CFC4] rounded text-sm"
                >
                  {course.name} ({course.grade}학년)
                </span>
              ))}
            </div>
          </div>

          {/* 안내 메시지 */}
          <p className="text-xs text-[#5C5C5C]">
            * 학기 변경 시 학생들의 과목이 자동으로 재배정됩니다
          </p>
        </div>
      ) : (
        // 편집 모드
        <div className="space-y-4">
          {/* 연도 선택 */}
          <div>
            <label className="block text-sm text-[#5C5C5C] mb-1">연도</label>
            <select
              value={tempYear}
              onChange={(e) => setTempYear(Number(e.target.value))}
              className="w-full p-2 border-2 border-[#1A1A1A] bg-white rounded-lg"
            >
              {[2024, 2025, 2026, 2027, 2028].map((year) => (
                <option key={year} value={year}>
                  {year}년
                </option>
              ))}
            </select>
          </div>

          {/* 학기 선택 */}
          <div>
            <label className="block text-sm text-[#5C5C5C] mb-1">학기</label>
            <div className="flex gap-2">
              <button
                onClick={() => setTempSemester(1)}
                className={`
                  flex-1 p-2 border-2 rounded-lg font-medium transition-colors
                  ${tempSemester === 1
                    ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white'
                    : 'border-[#D4CFC4] bg-white text-[#1A1A1A] hover:border-[#1A1A1A]'
                  }
                `}
              >
                1학기
              </button>
              <button
                onClick={() => setTempSemester(2)}
                className={`
                  flex-1 p-2 border-2 rounded-lg font-medium transition-colors
                  ${tempSemester === 2
                    ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white'
                    : 'border-[#D4CFC4] bg-white text-[#1A1A1A] hover:border-[#1A1A1A]'
                  }
                `}
              >
                2학기
              </button>
            </div>
          </div>

          {/* 변경될 과목 미리보기 */}
          <div className="p-3 bg-[#EBE5D9] rounded-lg">
            <span className="text-[#5C5C5C] text-sm block mb-2">변경 시 수강 가능 과목</span>
            <div className="flex flex-wrap gap-2">
              {Object.values(COURSES)
                .filter((course) => course.semester === tempSemester)
                .map((course) => (
                  <span
                    key={course.id}
                    className="px-2 py-1 bg-[#FDFBF7] border border-[#D4CFC4] rounded text-sm"
                  >
                    {course.name} ({course.grade}학년)
                  </span>
                ))}
            </div>
          </div>

          {/* 버튼 */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleCancel}
              className="flex-1 py-2 border-2 border-[#D4CFC4] text-[#5C5C5C] rounded-lg hover:bg-[#EBE5D9] transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 py-2 border-2 border-[#1A1A1A] bg-[#1A1A1A] text-white rounded-lg hover:bg-[#333] transition-colors disabled:opacity-50"
            >
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default SemesterSettingsCard;
