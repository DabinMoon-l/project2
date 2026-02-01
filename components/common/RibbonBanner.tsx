'use client';

import { motion } from 'framer-motion';

interface RibbonBannerProps {
  /** 메인 텍스트 */
  title: string;
  /** 리본 색상 (기본: 검정) */
  color?: string;
  /** 크기 */
  size?: 'sm' | 'md' | 'lg';
  /** 클래스명 */
  className?: string;
}

/**
 * 우아한 곡선 리본 배너 컴포넌트
 * Image 20 스타일 - 곡선 끝과 장식적 디자인
 */
export default function RibbonBanner({
  title,
  color = '#1A1A1A',
  size = 'md',
  className = '',
}: RibbonBannerProps) {
  const sizeConfig = {
    sm: { width: 200, height: 60, fontSize: 16, ribbonHeight: 32 },
    md: { width: 280, height: 80, fontSize: 22, ribbonHeight: 44 },
    lg: { width: 340, height: 100, fontSize: 28, ribbonHeight: 56 },
  };

  const config = sizeConfig[size];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: config.width, height: config.height }}
    >
      <svg
        width={config.width}
        height={config.height}
        viewBox={`0 0 ${config.width} ${config.height}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* 왼쪽 곡선 꼬리 */}
        <path
          d={`M0 ${config.height * 0.7}
              Q${config.width * 0.05} ${config.height * 0.5} ${config.width * 0.12} ${config.height * 0.35}
              L${config.width * 0.12} ${config.height * 0.65}
              Q${config.width * 0.05} ${config.height * 0.5} 0 ${config.height * 0.3}
              Z`}
          fill={color}
        />

        {/* 오른쪽 곡선 꼬리 */}
        <path
          d={`M${config.width} ${config.height * 0.7}
              Q${config.width * 0.95} ${config.height * 0.5} ${config.width * 0.88} ${config.height * 0.35}
              L${config.width * 0.88} ${config.height * 0.65}
              Q${config.width * 0.95} ${config.height * 0.5} ${config.width} ${config.height * 0.3}
              Z`}
          fill={color}
        />

        {/* 메인 리본 본체 - 상단 곡선 */}
        <path
          d={`M${config.width * 0.1} ${config.height * 0.65}
              Q${config.width * 0.5} ${config.height * 0.2} ${config.width * 0.9} ${config.height * 0.65}
              L${config.width * 0.9} ${config.height * 0.35}
              Q${config.width * 0.5} ${config.height * 0.0} ${config.width * 0.1} ${config.height * 0.35}
              Z`}
          fill={color}
        />

        {/* 텍스트 */}
        <text
          x={config.width / 2}
          y={config.height * 0.52}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#F5F0E8"
          fontSize={config.fontSize}
          fontWeight="bold"
          fontFamily="serif"
          letterSpacing="0.1em"
        >
          {title}
        </text>
      </svg>
    </motion.div>
  );
}

interface SubRibbonProps {
  /** 텍스트 */
  text: string;
  /** 색상 */
  color?: string;
  /** 클릭 핸들러 */
  onClick?: () => void;
}

/**
 * 작은 서브 리본 (버튼용) - 우아한 스타일
 */
export function SubRibbon({ text, color = '#1A1A1A', onClick }: SubRibbonProps) {
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="relative inline-flex items-center justify-center"
    >
      <svg
        width="140"
        height="36"
        viewBox="0 0 140 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* 왼쪽 꼬리 */}
        <path
          d="M0 24 Q7 18 14 12 L14 24 Q7 18 0 12 Z"
          fill={color}
        />

        {/* 오른쪽 꼬리 */}
        <path
          d="M140 24 Q133 18 126 12 L126 24 Q133 18 140 12 Z"
          fill={color}
        />

        {/* 메인 리본 */}
        <path
          d="M12 24 Q70 8 128 24 L128 12 Q70 -4 12 12 Z"
          fill={color}
        />

        {/* 텍스트 */}
        <text
          x="70"
          y="19"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#F5F0E8"
          fontSize="11"
          fontWeight="600"
          fontFamily="serif"
          letterSpacing="0.05em"
        >
          {text}
        </text>
      </svg>
    </motion.button>
  );
}
