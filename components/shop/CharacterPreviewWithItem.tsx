'use client';

import { motion } from 'framer-motion';
import { useThemeColors } from '@/styles/themes/useTheme';
import { ShopItem, RARITY_COLORS } from '@/lib/data/shopItems';
import CharacterPreview, {
  CharacterOptions,
  SKIN_COLORS,
  HAIR_STYLES,
} from '@/components/onboarding/CharacterPreview';

/**
 * CharacterPreviewWithItem Props 타입
 */
interface CharacterPreviewWithItemProps {
  /** 캐릭터 옵션 */
  characterOptions: CharacterOptions;
  /** 선택한 아이템 (미리보기) */
  selectedItem: ShopItem | null;
}

/**
 * 아이템 착용 미리보기 컴포넌트
 * 선택한 아이템을 캐릭터에 착용한 모습을 미리 보여줍니다.
 *
 * @example
 * <CharacterPreviewWithItem
 *   characterOptions={{ hairStyle: 0, skinColor: 3, beard: 0 }}
 *   selectedItem={selectedItem}
 * />
 */
export default function CharacterPreviewWithItem({
  characterOptions,
  selectedItem,
}: CharacterPreviewWithItemProps) {
  const colors = useThemeColors();

  // 희귀도 색상
  const rarityColor = selectedItem?.rarity
    ? RARITY_COLORS[selectedItem.rarity]
    : colors.accent;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative flex flex-col items-center py-4"
    >
      {/* 캐릭터 배경 효과 */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full opacity-20 blur-xl"
        style={{ backgroundColor: rarityColor }}
      />

      {/* 캐릭터 미리보기 */}
      <div className="relative z-10">
        <CharacterPreview
          options={characterOptions}
          size="lg"
          animated={true}
        />

        {/* 선택한 아이템 오버레이 */}
        {selectedItem && (
          <ItemOverlay item={selectedItem} />
        )}
      </div>

      {/* 아이템 정보 태그 */}
      {selectedItem && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-4 px-4 py-2 rounded-full"
          style={{
            backgroundColor: `${rarityColor}20`,
            border: `2px solid ${rarityColor}`,
          }}
        >
          <span
            className="text-sm font-medium"
            style={{ color: rarityColor }}
          >
            {selectedItem.name} 착용 미리보기
          </span>
        </motion.div>
      )}
    </motion.div>
  );
}

/**
 * 아이템 오버레이 컴포넌트
 * 캐릭터 위에 아이템을 표시합니다.
 */
interface ItemOverlayProps {
  item: ShopItem;
}

function ItemOverlay({ item }: ItemOverlayProps) {
  const colors = useThemeColors();
  const rarityColor = item.rarity ? RARITY_COLORS[item.rarity] : colors.accent;

  // 카테고리별 아이템 위치 및 스타일
  const getItemPosition = () => {
    switch (item.category) {
      case 'hat':
        // 모자는 머리 위에
        return {
          top: '-20px',
          left: '50%',
          transform: 'translateX(-50%)',
        };
      case 'glasses':
        // 안경은 눈 위치에
        return {
          top: '35%',
          left: '50%',
          transform: 'translateX(-50%)',
        };
      case 'mask':
        // 마스크는 얼굴에
        return {
          top: '30%',
          left: '50%',
          transform: 'translateX(-50%)',
        };
      case 'weapon':
        // 무기는 오른쪽에
        return {
          top: '50%',
          right: '-30px',
          transform: 'translateY(-50%) rotate(30deg)',
        };
      case 'cape':
        // 망토는 뒤에 (zIndex 조정 필요)
        return {
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: -1,
        };
      case 'pet':
        // 펫은 옆에
        return {
          bottom: '0',
          right: '-40px',
        };
      case 'effect':
        // 이펙트는 주변에
        return {
          top: '0',
          left: '0',
          right: '0',
          bottom: '0',
        };
      case 'accessory':
        // 악세서리는 카테고리에 따라 다양
        return {
          top: '45%',
          left: '50%',
          transform: 'translateX(-50%)',
        };
      default:
        return {
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        };
    }
  };

  const position = getItemPosition();

  // 이펙트 카테고리는 특별 처리
  if (item.category === 'effect') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 pointer-events-none"
        style={position}
      >
        <EffectAnimation effectId={item.id} color={rarityColor} />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className="absolute w-12 h-12 flex items-center justify-center text-2xl"
      style={position as React.CSSProperties}
    >
      {/* 아이템 이모지 (실제 구현 시 이미지로 대체) */}
      {getCategoryEmoji(item.category)}

      {/* 희귀도 글로우 효과 */}
      {(item.rarity === 'epic' || item.rarity === 'legendary') && (
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            backgroundColor: rarityColor,
            filter: 'blur(8px)',
            opacity: 0.3,
          }}
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}
    </motion.div>
  );
}

/**
 * 이펙트 애니메이션 컴포넌트
 */
interface EffectAnimationProps {
  effectId: string;
  color: string;
}

function EffectAnimation({ effectId, color }: EffectAnimationProps) {
  switch (effectId) {
    case 'effect_fire':
      return (
        <motion.div
          className="absolute inset-0"
          animate={{
            opacity: [0.5, 0.8, 0.5],
          }}
          transition={{ duration: 1, repeat: Infinity }}
        >
          {/* 불꽃 이펙트 */}
          {[...Array(5)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute bottom-0 w-3 h-6 rounded-full bg-gradient-to-t from-orange-600 to-yellow-400"
              style={{
                left: `${20 + i * 15}%`,
              }}
              animate={{
                height: ['20px', '30px', '20px'],
                opacity: [0.8, 1, 0.8],
              }}
              transition={{
                duration: 0.5 + i * 0.1,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          ))}
        </motion.div>
      );

    case 'effect_lightning':
      return (
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          animate={{
            opacity: [0, 1, 0],
          }}
          transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 1.5 }}
        >
          <span className="text-4xl">⚡</span>
        </motion.div>
      );

    case 'effect_aura':
      return (
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            border: `3px solid ${color}`,
            opacity: 0.5,
          }}
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.5, 0.2, 0.5],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      );

    case 'effect_sparkle':
      return (
        <motion.div className="absolute inset-0">
          {[...Array(8)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute text-xl"
              style={{
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
              }}
              animate={{
                opacity: [0, 1, 0],
                scale: [0.5, 1, 0.5],
              }}
              transition={{
                duration: 1,
                repeat: Infinity,
                delay: i * 0.2,
              }}
            >
              ✨
            </motion.div>
          ))}
        </motion.div>
      );

    default:
      return null;
  }
}

/**
 * 카테고리별 이모지 반환
 */
function getCategoryEmoji(category: string): string {
  const emojis: Record<string, string> = {
    weapon: '⚔️',
    hat: '🎩',
    mask: '🎭',
    glasses: '👓',
    cape: '🧥',
    pet: '🐕',
    effect: '✨',
    accessory: '💎',
  };
  return emojis[category] || '📦';
}
