'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';

/**
 * 캐릭터 커스터마이징 옵션 타입
 */
export interface CharacterOptions {
  // 머리스타일 (0-9)
  hairStyle: number;
  // 피부색 (0-9)
  skinColor: number;
}

/**
 * 머리스타일 목록 (5종)
 */
export const HAIR_STYLES = [
  { id: 0, name: '기본' },
  { id: 1, name: '짧은머리' },
  { id: 2, name: '긴머리' },
  { id: 3, name: '묶음머리' },
  { id: 4, name: '웨이브' },
];

/**
 * 피부색 목록 (5종)
 */
export const SKIN_COLORS = [
  { id: 0, name: '기본', color: '#FFDBAC' },
  { id: 1, name: '밝은피부', color: '#FFE4C4' },
  { id: 2, name: '어두운피부', color: '#8D5524' },
  { id: 3, name: '노란색', color: '#F5DEB3' },
  { id: 4, name: '분홍색', color: '#FFB6C1' },
];

/**
 * CharacterPreview Props
 */
interface CharacterPreviewProps {
  // 캐릭터 옵션
  options: CharacterOptions;
  // 크기 (기본: md)
  size?: 'sm' | 'md' | 'lg' | 'xl';
  // 애니메이션 활성화
  animated?: boolean;
  // 배경 표시 여부
  showBackground?: boolean;
}

// 크기별 스타일
const sizeStyles = {
  sm: 'w-24 h-24',
  md: 'w-40 h-40',
  lg: 'w-56 h-56',
  xl: 'w-72 h-72',
};

/**
 * 캐릭터 미리보기 컴포넌트
 * 선택한 옵션에 따라 캐릭터 이미지를 표시합니다.
 */
export default function CharacterPreview({
  options,
  size = 'md',
  animated = true,
  showBackground = false,
}: CharacterPreviewProps) {
  // 캐릭터 이미지 경로 생성
  const characterImagePath = `/images/characters/skin_${options.skinColor}_hair_${options.hairStyle}.png`;

  return (
    <motion.div
      className={`${sizeStyles[size]} relative flex items-center justify-center`}
      initial={animated ? { scale: 0.8, opacity: 0 } : undefined}
      animate={animated ? { scale: 1, opacity: 1 } : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      {/* 캐릭터 이미지 */}
      <Image
        src={characterImagePath}
        alt={`캐릭터: ${HAIR_STYLES[options.hairStyle]?.name} 머리, ${SKIN_COLORS[options.skinColor]?.name} 피부`}
        fill
        sizes="(max-width: 768px) 50vw, 300px"
        className="object-contain"
        priority
        onError={(e) => {
          // 이미지 로드 실패 시 기본 이미지로 대체
          const target = e.target as HTMLImageElement;
          target.src = '/images/characters/default.png';
        }}
      />
    </motion.div>
  );
}

/**
 * 기본 캐릭터 옵션
 */
export const DEFAULT_CHARACTER_OPTIONS: CharacterOptions = {
  hairStyle: 0,
  skinColor: 0,
};
