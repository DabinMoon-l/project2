'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';

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
 * 장비 타입
 */
export interface Equipment {
  // 갑옷 (계급에 따라 결정)
  armor?: string;
  // 무기
  weapon?: string;
  // 모자
  hat?: string;
  // 안경
  glasses?: string;
}

/**
 * HomeCharacter Props
 */
interface HomeCharacterProps {
  // 캐릭터 옵션
  options: CharacterOptions;
  // 장비
  equipment?: Equipment;
  // 참여도 (0-100)
  participationRate: number;
}

/**
 * 피부색 목록
 */
const SKIN_COLORS = [
  { color: '#8B4513' },  // 갈색
  { color: '#FFD93D' },  // 노란색
  { color: '#FF9F43' },  // 주황색
  { color: '#FFEAA7' },  // 밝은피부
  { color: '#6B4423' },  // 진갈색
  { color: '#74B9FF' },  // 파란색
  { color: '#00D2D3' },  // 청록색
  { color: '#A29BFE' },  // 보라색
  { color: '#FF6B6B' },  // 빨간색
  { color: '#2D3436' },  // 검은색
  { color: '#55EFC4' },  // 민트색
  { color: '#0984E3' },  // 진파랑
  { color: '#FD79A8' },  // 분홍색
  { color: '#81ECEC' },  // 좀비
  { color: '#00CEC9' },  // 외계인
];

/**
 * 머리스타일 SVG 경로
 */
const HAIR_PATHS: Record<number, string> = {
  0: 'M30,25 Q50,5 70,25 Q65,20 50,18 Q35,20 30,25', // 짧은
  1: 'M25,30 Q50,0 75,30 Q65,15 50,12 Q35,15 25,30', // 중간
  2: 'M20,35 Q50,-5 80,35 Q70,10 50,5 Q30,10 20,35', // 긴
  3: 'M25,30 Q50,0 75,30 M50,5 L50,-10 Q55,-15 60,-10 Q55,-5 50,5', // 묶음
  4: '', // 대머리
  5: 'M40,25 Q50,-5 60,25 L50,30 Z', // 닭머리
  6: 'M15,40 Q20,5 50,-5 Q80,5 85,40 Q80,15 50,10 Q20,15 15,40', // 아프로
  7: 'M45,30 L50,-10 L55,30 Z', // 모히칸
  8: 'M30,30 Q50,10 70,30 M30,25 L30,35 M70,25 L70,35', // 투블럭
  9: 'M25,30 Q35,20 45,30 Q55,20 65,30 Q75,20 75,30', // 웨이브
  10: 'M25,30 Q50,5 75,30 M75,30 Q90,35 95,50', // 포니테일
  11: 'M25,30 Q50,5 75,30 M25,30 Q10,35 5,50 M75,30 Q90,35 95,50', // 트윈테일
  12: 'M35,20 Q50,10 65,20', // 삭발
  13: 'M30,28 Q50,12 70,28', // 스포츠
  14: 'M30,30 Q40,15 50,25 Q60,15 70,30', // 가르마
  15: 'M25,35 Q50,5 75,35 M25,35 Q30,35 35,50', // 덮은머리
  16: 'M30,30 Q50,10 70,30 M50,10 Q55,0 50,-5 Q45,0 50,10', // 상투
};

/**
 * 참여도에 따른 표정 반환
 * @param rate 참여도 (0-100)
 */
function getExpression(rate: number): {
  eyeShape: string;
  mouthPath: string;
  eyebrowPath: string;
  label: string;
} {
  if (rate >= 90) {
    // 활짝 웃음
    return {
      eyeShape: 'happy',
      mouthPath: 'M40,68 Q50,78 60,68', // 활짝 웃는 입
      eyebrowPath: 'M32,42 Q38,40 42,42 M58,42 Q62,40 68,42', // 올라간 눈썹
      label: '최고예요!',
    };
  } else if (rate >= 60) {
    // 살짝 웃음
    return {
      eyeShape: 'normal',
      mouthPath: 'M45,68 Q50,74 55,68', // 살짝 웃는 입
      eyebrowPath: 'M32,44 Q38,43 42,44 M58,44 Q62,43 68,44', // 평범한 눈썹
      label: '좋아요!',
    };
  } else if (rate >= 30) {
    // 무표정
    return {
      eyeShape: 'normal',
      mouthPath: 'M43,70 L57,70', // 일자 입
      eyebrowPath: 'M32,44 L42,44 M58,44 L68,44', // 일자 눈썹
      label: '조금 더 힘내요',
    };
  } else {
    // 똥씹은 표정
    return {
      eyeShape: 'sad',
      mouthPath: 'M42,74 Q50,68 58,74', // 삐쭉 입
      eyebrowPath: 'M32,42 Q38,46 42,44 M58,44 Q62,46 68,42', // 찌푸린 눈썹
      label: '힘내세요!',
    };
  }
}

/** 기본 갑옷 색상 */
const DEFAULT_ARMOR_COLORS = { primary: '#A0522D', secondary: '#8B4513' };

/**
 * 홈 화면 캐릭터 컴포넌트
 * 참여도에 따라 표정이 변하고, 터치 시 반응 애니메이션 적용
 */
export default function HomeCharacter({
  options,
  equipment,
  participationRate,
}: HomeCharacterProps) {
  const { theme } = useTheme();
  const [isTouched, setIsTouched] = useState(false);
  const [touchCount, setTouchCount] = useState(0);

  // 피부색
  const skinColor = SKIN_COLORS[options.skinColor]?.color || '#FFEAA7';
  // 머리 경로
  const hairPath = HAIR_PATHS[options.hairStyle] || HAIR_PATHS[0];
  // 표정
  const expression = getExpression(participationRate);
  // 갑옷 색상
  const armorColors = DEFAULT_ARMOR_COLORS;

  /**
   * 터치/클릭 핸들러
   */
  const handleTouch = useCallback(() => {
    setIsTouched(true);
    setTouchCount((prev) => prev + 1);

    // 애니메이션 후 상태 리셋
    setTimeout(() => {
      setIsTouched(false);
    }, 600);
  }, []);

  /**
   * 눈 렌더링
   */
  const renderEyes = () => {
    if (expression.eyeShape === 'happy') {
      // 활짝 웃을 때 눈 (^ ^)
      return (
        <>
          <path
            d="M32,52 Q38,46 44,52"
            fill="none"
            stroke="#2D3436"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M56,52 Q62,46 68,52"
            fill="none"
            stroke="#2D3436"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      );
    } else if (expression.eyeShape === 'sad') {
      // 슬플 때 눈
      return (
        <>
          <ellipse cx="38" cy="52" rx="5" ry="7" fill="white" />
          <circle cx="38" cy="54" r="3" fill="#2D3436" />
          <circle cx="36" cy="52" r="1" fill="white" />
          <ellipse cx="62" cy="52" rx="5" ry="7" fill="white" />
          <circle cx="62" cy="54" r="3" fill="#2D3436" />
          <circle cx="60" cy="52" r="1" fill="white" />
        </>
      );
    }

    // 기본 눈
    return (
      <>
        <motion.g
          animate={isTouched ? { scaleY: [1, 0.1, 1] } : undefined}
          transition={{ duration: 0.15 }}
          style={{ transformOrigin: '38px 52px' }}
        >
          <ellipse cx="38" cy="52" rx="6" ry="8" fill="white" />
          <circle cx="38" cy="52" r="4" fill="#2D3436" />
          <circle cx="36" cy="50" r="1.5" fill="white" />
        </motion.g>
        <motion.g
          animate={isTouched ? { scaleY: [1, 0.1, 1] } : undefined}
          transition={{ duration: 0.15, delay: 0.05 }}
          style={{ transformOrigin: '62px 52px' }}
        >
          <ellipse cx="62" cy="52" rx="6" ry="8" fill="white" />
          <circle cx="62" cy="52" r="4" fill="#2D3436" />
          <circle cx="60" cy="50" r="1.5" fill="white" />
        </motion.g>
      </>
    );
  };

  /**
   * 수염 렌더링
   */
  const renderBeard = () => {
    switch (options.beard) {
      case 1: // 콧수염
        return (
          <path
            d="M42,60 Q45,65 50,63 Q55,65 58,60"
            fill="none"
            stroke="#6B4423"
            strokeWidth="2"
            strokeLinecap="round"
          />
        );
      case 2: // 턱수염
        return (
          <path
            d="M35,70 Q50,85 65,70"
            fill="none"
            stroke="#6B4423"
            strokeWidth="3"
            strokeLinecap="round"
          />
        );
      case 3: // 풀수염
        return (
          <>
            <path
              d="M42,60 Q45,65 50,63 Q55,65 58,60"
              fill="none"
              stroke="#6B4423"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path d="M32,65 Q50,90 68,65" fill="#6B4423" opacity="0.7" />
          </>
        );
      default:
        return null;
    }
  };

  /**
   * 갑옷 렌더링
   */
  const renderArmor = () => {
    return (
      <g>
        {/* 갑옷 몸통 */}
        <path
          d="M30,90 L30,115 Q50,125 70,115 L70,90 Q50,95 30,90"
          fill={armorColors.primary}
          stroke={armorColors.secondary}
          strokeWidth="2"
        />
        {/* 어깨 보호대 - 왼쪽 */}
        <ellipse
          cx="25"
          cy="92"
          rx="10"
          ry="6"
          fill={armorColors.primary}
          stroke={armorColors.secondary}
          strokeWidth="1"
        />
        {/* 어깨 보호대 - 오른쪽 */}
        <ellipse
          cx="75"
          cy="92"
          rx="10"
          ry="6"
          fill={armorColors.primary}
          stroke={armorColors.secondary}
          strokeWidth="1"
        />
        {/* 갑옷 장식 */}
        <circle cx="50" cy="100" r="4" fill={armorColors.secondary} />
      </g>
    );
  };

  /**
   * 무기 렌더링
   */
  const renderWeapon = () => {
    if (!equipment?.weapon) return null;

    return (
      <motion.g
        animate={isTouched ? { rotate: [0, -20, 0] } : undefined}
        transition={{ duration: 0.3 }}
        style={{ transformOrigin: '85px 95px' }}
      >
        {/* 검 손잡이 */}
        <rect x="80" y="90" width="6" height="20" fill="#8B4513" rx="1" />
        {/* 검날 */}
        <path
          d="M80,90 L83,40 L86,90 Z"
          fill="#C0C0C0"
          stroke="#A8A8A8"
          strokeWidth="1"
        />
        {/* 검 가드 */}
        <rect x="75" y="88" width="16" height="4" fill="#DAA520" rx="1" />
      </motion.g>
    );
  };

  /**
   * 모자 렌더링
   */
  const renderHat = () => {
    if (!equipment?.hat) return null;

    return (
      <g>
        {/* 용사 모자 */}
        <ellipse cx="50" cy="15" rx="25" ry="8" fill="#2D3436" />
        <path
          d="M30,15 Q50,-15 70,15"
          fill="#2D3436"
          stroke="#1A1A1A"
          strokeWidth="1"
        />
        {/* 깃털 장식 */}
        <path
          d="M65,5 Q75,-10 70,15"
          fill="none"
          stroke={theme.colors.accent}
          strokeWidth="2"
        />
      </g>
    );
  };

  /**
   * 안경 렌더링
   */
  const renderGlasses = () => {
    if (!equipment?.glasses) return null;

    return (
      <g>
        <circle
          cx="38"
          cy="52"
          r="10"
          fill="none"
          stroke="#2D3436"
          strokeWidth="2"
        />
        <circle
          cx="62"
          cy="52"
          r="10"
          fill="none"
          stroke="#2D3436"
          strokeWidth="2"
        />
        <path d="M48,52 L52,52" stroke="#2D3436" strokeWidth="2" />
        <path d="M28,52 L20,50" stroke="#2D3436" strokeWidth="2" />
        <path d="M72,52 L80,50" stroke="#2D3436" strokeWidth="2" />
      </g>
    );
  };

  return (
    <div className="relative flex flex-col items-center">
      {/* 터치 반응 이펙트 */}
      <AnimatePresence>
        {isTouched && (
          <>
            {/* 하트/별 이펙트 */}
            {[...Array(5)].map((_, i) => (
              <motion.span
                key={`effect-${touchCount}-${i}`}
                className="absolute text-2xl pointer-events-none"
                initial={{
                  opacity: 1,
                  scale: 0,
                  x: 0,
                  y: 0,
                }}
                animate={{
                  opacity: 0,
                  scale: 1.5,
                  x: (Math.random() - 0.5) * 100,
                  y: (Math.random() - 0.5) * 100 - 50,
                }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                style={{
                  top: '30%',
                  left: '50%',
                }}
              >
                {participationRate >= 60 ? ['*', '+', '*'][i % 3] : ['!', '?', '...'][i % 3]}
              </motion.span>
            ))}
          </>
        )}
      </AnimatePresence>

      {/* 캐릭터 SVG */}
      <motion.div
        className="relative cursor-pointer"
        style={{ width: '200px', height: '240px' }}
        onClick={handleTouch}
        whileHover={{ scale: 1.02 }}
        animate={
          isTouched
            ? {
                y: [0, -10, 0],
                rotate: [0, -3, 3, 0],
              }
            : {
                y: [0, -5, 0],
              }
        }
        transition={
          isTouched
            ? { duration: 0.4 }
            : {
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }
        }
      >
        <svg viewBox="0 0 100 130" className="w-full h-full">
          {/* 배경 후광 효과 */}
          <motion.circle
            cx="50"
            cy="60"
            r="48"
            fill={theme.colors.accent}
            opacity="0.15"
            animate={{ scale: [1, 1.05, 1] }}
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
            animate={{ rotate: [-3, 3, -3] }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{ transformOrigin: '30px 45px' }}
          />
          <ellipse cx="30" cy="20" rx="5" ry="15" fill="#FFB6C1" opacity="0.6" />

          {/* 귀 - 오른쪽 */}
          <motion.ellipse
            cx="70"
            cy="20"
            rx="10"
            ry="25"
            fill={skinColor}
            stroke="#E2C6A0"
            strokeWidth="2"
            animate={{ rotate: [3, -3, 3] }}
            transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
            style={{ transformOrigin: '70px 45px' }}
          />
          <ellipse cx="70" cy="20" rx="5" ry="15" fill="#FFB6C1" opacity="0.6" />

          {/* 모자 (장비 레이어 - 머리 위) */}
          {renderHat()}

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
          {hairPath && (
            <path d={hairPath} fill="#6B4423" stroke="#5D3A1A" strokeWidth="1" />
          )}

          {/* 눈썹 */}
          <path
            d={expression.eyebrowPath}
            fill="none"
            stroke="#5D3A1A"
            strokeWidth="1.5"
            strokeLinecap="round"
          />

          {/* 눈 */}
          {renderEyes()}

          {/* 볼 (홍조) */}
          <ellipse cx="25" cy="62" rx="6" ry="4" fill="#FFB6C1" opacity="0.5" />
          <ellipse cx="75" cy="62" rx="6" ry="4" fill="#FFB6C1" opacity="0.5" />

          {/* 코 */}
          <ellipse cx="50" cy="62" rx="4" ry="3" fill="#FFB6C1" />

          {/* 입 */}
          <motion.path
            d={expression.mouthPath}
            fill="none"
            stroke="#2D3436"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* 수염 */}
          {renderBeard()}

          {/* 갑옷 (장비 레이어) */}
          {renderArmor()}

          {/* 안경 (장비 레이어) */}
          {renderGlasses()}

          {/* 무기 (장비 레이어) */}
          {renderWeapon()}
        </svg>
      </motion.div>

      {/* 상태 말풍선 */}
      <motion.div
        className="absolute -top-2 right-0 px-3 py-1 rounded-full text-sm font-medium"
        style={{
          backgroundColor: theme.colors.accent,
          color: theme.colors.background,
        }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        {expression.label}
      </motion.div>
    </div>
  );
}
