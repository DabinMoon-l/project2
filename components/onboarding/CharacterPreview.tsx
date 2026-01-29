'use client';

import { motion } from 'framer-motion';

/**
 * 캐릭터 커스터마이징 옵션 타입
 */
export interface CharacterOptions {
  // 머리스타일 (0-16)
  hairStyle: number;
  // 피부색 (0-14)
  skinColor: number;
  // 수염 (0-3)
  beard: number;
}

/**
 * 머리스타일 목록
 */
export const HAIR_STYLES = [
  '짧은',
  '중간',
  '긴',
  '묶음',
  '대머리',
  '닭머리',
  '아프로',
  '모히칸',
  '투블럭',
  '웨이브',
  '포니테일',
  '트윈테일',
  '삭발',
  '스포츠',
  '가르마',
  '덮은머리',
  '상투',
];

/**
 * 피부색 목록 (이모지와 실제 색상값)
 */
export const SKIN_COLORS = [
  { emoji: '🟫', color: '#8B4513', name: '갈색' },
  { emoji: '🟨', color: '#FFD93D', name: '노란색' },
  { emoji: '🟧', color: '#FF9F43', name: '주황색' },
  { emoji: '⬜', color: '#FFEAA7', name: '밝은피부' },
  { emoji: '🟤', color: '#6B4423', name: '진갈색' },
  { emoji: '🔵', color: '#74B9FF', name: '파란색' },
  { emoji: '🟢', color: '#00D2D3', name: '청록색' },
  { emoji: '🟣', color: '#A29BFE', name: '보라색' },
  { emoji: '🔴', color: '#FF6B6B', name: '빨간색' },
  { emoji: '⚫', color: '#2D3436', name: '검은색' },
  { emoji: '💚', color: '#55EFC4', name: '민트색' },
  { emoji: '💙', color: '#0984E3', name: '진파랑' },
  { emoji: '🩷', color: '#FD79A8', name: '분홍색' },
  { emoji: '🧟', color: '#81ECEC', name: '좀비' },
  { emoji: '👽', color: '#00CEC9', name: '외계인' },
];

/**
 * 수염 목록
 */
export const BEARD_STYLES = ['없음', '콧수염', '턱수염', '풀수염'];

/**
 * CharacterPreview Props
 */
interface CharacterPreviewProps {
  // 캐릭터 옵션
  options: CharacterOptions;
  // 크기 (기본: md)
  size?: 'sm' | 'md' | 'lg';
  // 애니메이션 활성화
  animated?: boolean;
}

// 크기별 스타일
const sizeStyles = {
  sm: 'w-24 h-24',
  md: 'w-40 h-40',
  lg: 'w-56 h-56',
};

/**
 * 캐릭터 미리보기 컴포넌트
 * 선택한 옵션에 따라 토끼 캐릭터를 렌더링합니다.
 *
 * @example
 * <CharacterPreview
 *   options={{ hairStyle: 0, skinColor: 3, beard: 0 }}
 *   size="lg"
 *   animated
 * />
 */
export default function CharacterPreview({
  options,
  size = 'md',
  animated = true,
}: CharacterPreviewProps) {
  const skinColor = SKIN_COLORS[options.skinColor]?.color || '#FFEAA7';
  const hairStyle = HAIR_STYLES[options.hairStyle] || '짧은';
  const beardStyle = BEARD_STYLES[options.beard] || '없음';

  // 머리스타일에 따른 SVG 경로 결정
  const getHairPath = () => {
    // 머리스타일별로 다른 모양을 그릴 수 있습니다
    // 여기서는 기본적인 형태로 구현
    const styles: Record<string, string> = {
      대머리: '',
      삭발: 'M35,20 Q50,10 65,20',
      짧은: 'M30,25 Q50,5 70,25 Q65,20 50,18 Q35,20 30,25',
      중간: 'M25,30 Q50,0 75,30 Q65,15 50,12 Q35,15 25,30',
      긴: 'M20,35 Q50,-5 80,35 Q70,10 50,5 Q30,10 20,35',
      묶음: 'M25,30 Q50,0 75,30 M50,5 L50,-10 Q55,-15 60,-10 Q55,-5 50,5',
      닭머리: 'M40,25 Q50,-5 60,25 L50,30 Z',
      아프로: 'M15,40 Q20,5 50,-5 Q80,5 85,40 Q80,15 50,10 Q20,15 15,40',
      모히칸: 'M45,30 L50,-10 L55,30 Z',
      투블럭: 'M30,30 Q50,10 70,30 M30,25 L30,35 M70,25 L70,35',
      웨이브: 'M25,30 Q35,20 45,30 Q55,20 65,30 Q75,20 75,30',
      포니테일: 'M25,30 Q50,5 75,30 M75,30 Q90,35 95,50',
      트윈테일: 'M25,30 Q50,5 75,30 M25,30 Q10,35 5,50 M75,30 Q90,35 95,50',
      스포츠: 'M30,28 Q50,12 70,28',
      가르마: 'M30,30 Q40,15 50,25 Q60,15 70,30',
      덮은머리: 'M25,35 Q50,5 75,35 M25,35 Q30,35 35,50',
      상투: 'M30,30 Q50,10 70,30 M50,10 Q55,0 50,-5 Q45,0 50,10',
    };
    return styles[hairStyle] || styles['짧은'];
  };

  // 수염 SVG 렌더링
  const renderBeard = () => {
    switch (beardStyle) {
      case '콧수염':
        return (
          <path
            d="M42,60 Q45,65 50,63 Q55,65 58,60"
            fill="none"
            stroke="#6B4423"
            strokeWidth="2"
            strokeLinecap="round"
          />
        );
      case '턱수염':
        return (
          <path
            d="M35,70 Q50,85 65,70"
            fill="none"
            stroke="#6B4423"
            strokeWidth="3"
            strokeLinecap="round"
          />
        );
      case '풀수염':
        return (
          <>
            <path
              d="M42,60 Q45,65 50,63 Q55,65 58,60"
              fill="none"
              stroke="#6B4423"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M32,65 Q50,90 68,65"
              fill="#6B4423"
              opacity="0.7"
            />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <motion.div
      className={`${sizeStyles[size]} relative`}
      initial={animated ? { scale: 0.8, opacity: 0 } : undefined}
      animate={animated ? { scale: 1, opacity: 1 } : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <svg
        viewBox="0 0 100 120"
        className="w-full h-full"
        aria-label={`토끼 캐릭터: ${hairStyle} 머리, ${SKIN_COLORS[options.skinColor]?.name} 피부, ${beardStyle}`}
      >
        {/* 배경 원 (후광 효과) */}
        <motion.circle
          cx="50"
          cy="60"
          r="45"
          fill="var(--theme-accent)"
          opacity="0.1"
          animate={animated ? { scale: [1, 1.05, 1] } : undefined}
          transition={{ duration: 2, repeat: Infinity }}
        />

        {/* 귀 - 왼쪽 */}
        <motion.ellipse
          cx="30"
          cy="20"
          rx="10"
          ry="25"
          fill={skinColor}
          stroke="#E2C6A0"
          strokeWidth="2"
          animate={animated ? { rotate: [-5, 5, -5] } : undefined}
          transition={{ duration: 2, repeat: Infinity }}
          style={{ transformOrigin: '30px 45px' }}
        />
        <ellipse
          cx="30"
          cy="20"
          rx="5"
          ry="15"
          fill="#FFB6C1"
          opacity="0.6"
        />

        {/* 귀 - 오른쪽 */}
        <motion.ellipse
          cx="70"
          cy="20"
          rx="10"
          ry="25"
          fill={skinColor}
          stroke="#E2C6A0"
          strokeWidth="2"
          animate={animated ? { rotate: [5, -5, 5] } : undefined}
          transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
          style={{ transformOrigin: '70px 45px' }}
        />
        <ellipse
          cx="70"
          cy="20"
          rx="5"
          ry="15"
          fill="#FFB6C1"
          opacity="0.6"
        />

        {/* 얼굴 */}
        <ellipse
          cx="50"
          cy="60"
          rx="35"
          ry="38"
          fill={skinColor}
          stroke="#E2C6A0"
          strokeWidth="2"
        />

        {/* 머리카락 */}
        <motion.path
          d={getHairPath()}
          fill="#6B4423"
          stroke="#5D3A1A"
          strokeWidth="1"
          initial={animated ? { pathLength: 0 } : undefined}
          animate={animated ? { pathLength: 1 } : undefined}
          transition={{ duration: 0.5 }}
        />

        {/* 눈 - 왼쪽 */}
        <motion.g
          animate={animated ? { scaleY: [1, 0.1, 1] } : undefined}
          transition={{ duration: 0.2, repeat: Infinity, repeatDelay: 3 }}
          style={{ transformOrigin: '38px 52px' }}
        >
          <ellipse cx="38" cy="52" rx="6" ry="8" fill="white" />
          <circle cx="38" cy="52" r="4" fill="#2D3436" />
          <circle cx="36" cy="50" r="1.5" fill="white" />
        </motion.g>

        {/* 눈 - 오른쪽 */}
        <motion.g
          animate={animated ? { scaleY: [1, 0.1, 1] } : undefined}
          transition={{ duration: 0.2, repeat: Infinity, repeatDelay: 3 }}
          style={{ transformOrigin: '62px 52px' }}
        >
          <ellipse cx="62" cy="52" rx="6" ry="8" fill="white" />
          <circle cx="62" cy="52" r="4" fill="#2D3436" />
          <circle cx="60" cy="50" r="1.5" fill="white" />
        </motion.g>

        {/* 볼 (홍조) */}
        <ellipse cx="25" cy="62" rx="6" ry="4" fill="#FFB6C1" opacity="0.5" />
        <ellipse cx="75" cy="62" rx="6" ry="4" fill="#FFB6C1" opacity="0.5" />

        {/* 코 */}
        <ellipse cx="50" cy="62" rx="4" ry="3" fill="#FFB6C1" />

        {/* 입 */}
        <motion.path
          d="M45,68 Q50,74 55,68"
          fill="none"
          stroke="#2D3436"
          strokeWidth="2"
          strokeLinecap="round"
          animate={animated ? { d: ['M45,68 Q50,74 55,68', 'M45,68 Q50,72 55,68'] } : undefined}
          transition={{ duration: 1, repeat: Infinity }}
        />

        {/* 수염 */}
        {renderBeard()}

        {/* 앞발 (선택적) */}
        <ellipse cx="30" cy="95" rx="12" ry="8" fill={skinColor} />
        <ellipse cx="70" cy="95" rx="12" ry="8" fill={skinColor} />
      </svg>

      {/* 캐릭터 정보 툴팁 */}
      <div className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 text-xs text-center whitespace-nowrap">
        <span className="text-[var(--theme-text-secondary)]">
          {hairStyle} | {SKIN_COLORS[options.skinColor]?.name} | {beardStyle}
        </span>
      </div>
    </motion.div>
  );
}

/**
 * 기본 캐릭터 옵션
 */
export const DEFAULT_CHARACTER_OPTIONS: CharacterOptions = {
  hairStyle: 0,
  skinColor: 3,
  beard: 0,
};
