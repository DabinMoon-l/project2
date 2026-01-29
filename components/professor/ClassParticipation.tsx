'use client';

import { motion } from 'framer-motion';

interface ClassData {
  classId: string;
  className: string;
  participationRate: number;
  studentCount: number;
  color: string;
}

interface ClassParticipationProps {
  /** 반별 데이터 */
  classes: ClassData[];
}

/**
 * 반별 참여율 컴포넌트
 */
export default function ClassParticipation({ classes }: ClassParticipationProps) {
  // 참여율 순으로 정렬
  const sortedClasses = [...classes].sort(
    (a, b) => b.participationRate - a.participationRate
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-sm p-4"
    >
      {/* 헤더 */}
      <h3 className="font-bold text-gray-800 mb-4">반별 참여율</h3>

      {/* 참여율 바 */}
      <div className="space-y-4">
        {sortedClasses.map((classData, index) => (
          <div key={classData.classId}>
            {/* 반 정보 */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                {/* 순위 뱃지 */}
                <span
                  className={`
                    w-5 h-5 flex items-center justify-center
                    text-xs font-bold rounded-full
                    ${index === 0 ? 'bg-yellow-400 text-yellow-900' : 'bg-gray-100 text-gray-500'}
                  `}
                >
                  {index + 1}
                </span>
                <span className="font-medium text-gray-700">
                  {classData.className}반
                </span>
                <span className="text-xs text-gray-400">
                  ({classData.studentCount}명)
                </span>
              </div>
              <span className="font-bold text-gray-800">
                {classData.participationRate}%
              </span>
            </div>

            {/* 진행률 바 */}
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${classData.participationRate}%` }}
                transition={{ duration: 0.8, delay: index * 0.1 }}
                className="h-full rounded-full"
                style={{ backgroundColor: classData.color }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 빈 상태 */}
      {classes.length === 0 && (
        <div className="py-8 text-center text-gray-400 text-sm">
          데이터가 없습니다
        </div>
      )}
    </motion.div>
  );
}
