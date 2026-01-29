'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

/**
 * TOP3 사용자 정보 타입
 */
export interface RaceRanker {
  /** 사용자 ID */
  userId: string;
  /** 사용자 닉네임 */
  nickname: string;
  /** 순위 (1, 2, 3) */
  rank: 1 | 2 | 3;
  /** 점수 또는 경험치 */
  score: number;
  /** 캐릭터 이미지 URL (선택) */
  characterImageUrl?: string;
}

interface Top3RaceProps {
  /** TOP3 랭커 데이터 */
  rankers: RaceRanker[];
  /** 로딩 상태 */
  isLoading?: boolean;
  /** 추가 클래스명 */
  className?: string;
}

// 순위별 색상 및 메달 이모지
const rankStyles: Record<1 | 2 | 3, { color: string; medal: string; trackWidth: string }> = {
  1: { color: '#FFD700', medal: '1', trackWidth: '100%' },
  2: { color: '#C0C0C0', medal: '2', trackWidth: '85%' },
  3: { color: '#CD7F32', medal: '3', trackWidth: '70%' },
};

/**
 * TOP3 레이스 컴포넌트
 *
 * 토끼가 말 타고 달리는 Lottie 애니메이션을 표시하고,
 * 1, 2, 3위 순위를 시각적으로 보여줍니다.
 *
 * @example
 * ```tsx
 * <Top3Race
 *   rankers={[
 *     { userId: '1', nickname: '용사1', rank: 1, score: 1000 },
 *     { userId: '2', nickname: '용사2', rank: 2, score: 850 },
 *     { userId: '3', nickname: '용사3', rank: 3, score: 700 },
 *   ]}
 * />
 * ```
 */
export default function Top3Race({
  rankers,
  isLoading = false,
  className = '',
}: Top3RaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 순위별로 정렬
  const sortedRankers = [...rankers].sort((a, b) => a.rank - b.rank);

  // 로딩 상태
  if (isLoading) {
    return (
      <div className={`bg-white rounded-2xl p-4 shadow-sm ${className}`}>
        <div className="h-6 w-32 bg-gray-200 rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((rank) => (
            <div key={rank} className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse" />
              <div className="flex-1 h-8 bg-gray-200 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 데이터가 없는 경우
  if (rankers.length === 0) {
    return (
      <div className={`bg-white rounded-2xl p-4 shadow-sm ${className}`}>
        <h3 className="text-lg font-bold text-gray-900 mb-4">TOP3 레이스</h3>
        <p className="text-center text-gray-500 py-4">
          아직 참여자가 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`bg-white rounded-2xl p-4 shadow-sm overflow-hidden ${className}`}
    >
      {/* 섹션 타이틀 */}
      <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
        <span className="text-xl">🏇</span>
        TOP3 레이스
      </h3>

      {/* 레이스 트랙 */}
      <div className="space-y-3">
        {sortedRankers.map((ranker, index) => {
          const style = rankStyles[ranker.rank];

          return (
            <motion.div
              key={ranker.userId}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="flex items-center gap-3"
            >
              {/* 순위 메달 */}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                style={{ backgroundColor: style.color }}
              >
                {style.medal}
              </div>

              {/* 레이스 트랙 바 */}
              <div className="flex-1 relative h-10 bg-gray-100 rounded-full overflow-hidden">
                {/* 진행 바 */}
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: style.trackWidth }}
                  transition={{
                    duration: 1,
                    delay: index * 0.15,
                    ease: 'easeOut',
                  }}
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${style.color}40, ${style.color})`,
                  }}
                />

                {/* 캐릭터 및 닉네임 */}
                <motion.div
                  initial={{ x: 0 }}
                  animate={{ x: `calc(${style.trackWidth} - 100%)` }}
                  transition={{
                    duration: 1,
                    delay: index * 0.15,
                    ease: 'easeOut',
                  }}
                  className="absolute inset-y-0 right-0 flex items-center px-3"
                  style={{ width: style.trackWidth }}
                >
                  {/* 토끼 캐릭터 (Lottie 대체용 이미지) */}
                  <motion.div
                    animate={{
                      y: [0, -2, 0],
                    }}
                    transition={{
                      duration: 0.3,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                    className="w-6 h-6 mr-2 flex items-center justify-center"
                  >
                    {/* 캐릭터 이미지가 있으면 표시, 없으면 기본 토끼 아이콘 */}
                    {ranker.characterImageUrl ? (
                      <img
                        src={ranker.characterImageUrl}
                        alt={ranker.nickname}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="text-lg">🐰</span>
                    )}
                  </motion.div>

                  {/* 닉네임 */}
                  <span className="text-sm font-medium text-gray-800 truncate">
                    {ranker.nickname}
                  </span>
                </motion.div>

                {/* 점수 표시 */}
                <div className="absolute right-3 inset-y-0 flex items-center">
                  <span className="text-xs font-semibold text-gray-600 bg-white/80 px-2 py-0.5 rounded-full">
                    {ranker.score.toLocaleString()}점
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Lottie 애니메이션 힌트 (추후 구현) */}
      {/*
        TODO: Lottie 파일 추가 시 아래 코드 활성화
        import Lottie from 'lottie-react';
        import horseRaceAnimation from '@/public/animations/horse-race.json';

        <Lottie
          animationData={horseRaceAnimation}
          loop={true}
          className="w-full h-32"
        />
      */}
    </div>
  );
}
