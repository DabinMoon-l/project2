'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { type CharacterOptions } from '@/lib/hooks/useProfile';
import CharacterPreview, {
  HAIR_STYLES,
  SKIN_COLORS,
} from '@/components/onboarding/CharacterPreview';
import { Button, BottomSheet } from '@/components/common';

// ============================================================
// 타입 정의
// ============================================================

interface CharacterEditorProps {
  /** 현재 캐릭터 옵션 */
  initialOptions: CharacterOptions;
  /** 저장 핸들러 */
  onSave: (options: CharacterOptions) => Promise<void>;
  /** 취소 핸들러 */
  onCancel: () => void;
  /** 저장 중 상태 */
  saving?: boolean;
}

type EditCategory = 'hair' | 'skin';

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 캐릭터 편집기 컴포넌트
 *
 * 머리스타일, 피부색, 수염을 선택할 수 있습니다.
 */
export default function CharacterEditor({
  initialOptions,
  onSave,
  onCancel,
  saving = false,
}: CharacterEditorProps) {
  const { theme } = useTheme();

  // 편집 중인 옵션
  const [options, setOptions] = useState<CharacterOptions>(initialOptions);
  // 선택된 카테고리
  const [category, setCategory] = useState<EditCategory>('hair');
  // 카테고리 시트 열림 상태
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  /**
   * 옵션 변경 핸들러
   */
  const handleOptionChange = useCallback(
    (key: keyof CharacterOptions, value: number) => {
      setOptions((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  /**
   * 저장 핸들러
   */
  const handleSave = useCallback(async () => {
    await onSave(options);
  }, [options, onSave]);

  /**
   * 카테고리 선택 핸들러
   */
  const handleCategorySelect = useCallback((cat: EditCategory) => {
    setCategory(cat);
    setIsSheetOpen(true);
  }, []);

  // 카테고리별 옵션
  const categoryOptions: Record<
    EditCategory,
    { label: string; options: string[]; key: keyof CharacterOptions }
  > = {
    hair: {
      label: '머리스타일',
      options: HAIR_STYLES.map((h) => h.name),
      key: 'hairStyle',
    },
    skin: {
      label: '피부색',
      options: SKIN_COLORS.map((s) => s.name),
      key: 'skinColor',
    },
  };

  const currentCategory = categoryOptions[category];

  return (
    <div className="flex flex-col h-full">
      {/* 캐릭터 미리보기 */}
      <motion.div
        className="flex-1 flex items-center justify-center py-6"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <CharacterPreview options={options} size="lg" animated />
      </motion.div>

      {/* 카테고리 선택 버튼 */}
      <div className="px-4 pb-4">
        <div
          className="grid grid-cols-2 gap-2 p-2 rounded-xl"
          style={{ backgroundColor: theme.colors.backgroundSecondary }}
        >
          {(Object.keys(categoryOptions) as EditCategory[]).map((cat) => (
            <motion.button
              key={cat}
              type="button"
              onClick={() => handleCategorySelect(cat)}
              className="py-3 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor:
                  category === cat ? theme.colors.accent : 'transparent',
                color:
                  category === cat
                    ? theme.colors.background
                    : theme.colors.textSecondary,
              }}
              whileTap={{ scale: 0.95 }}
            >
              {cat === 'hair' && '💇'}
              {cat === 'skin' && '🎨'}
              <br />
              <span className="text-xs">{categoryOptions[cat].label}</span>
            </motion.button>
          ))}
        </div>

        {/* 현재 선택 표시 */}
        <div
          className="mt-3 p-3 rounded-xl flex items-center justify-between"
          style={{
            backgroundColor: `${theme.colors.accent}10`,
            border: `1px solid ${theme.colors.accent}30`,
          }}
        >
          <span
            className="text-sm"
            style={{ color: theme.colors.textSecondary }}
          >
            {currentCategory.label}
          </span>
          <span
            className="text-sm font-medium"
            style={{ color: theme.colors.accent }}
          >
            {currentCategory.options[options[currentCategory.key]]}
          </span>
        </div>

        {/* 저장/취소 버튼 */}
        <div className="flex gap-3 mt-4">
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={saving}
            className="flex-1"
          >
            취소
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saving}
            disabled={saving}
            className="flex-1"
          >
            저장
          </Button>
        </div>
      </div>

      {/* 옵션 선택 바텀시트 */}
      <BottomSheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        title={currentCategory.label}
      >
        <div className="p-4">
          {category === 'skin' ? (
            // 피부색은 그리드로 표시
            <div className="grid grid-cols-5 gap-3">
              {SKIN_COLORS.map((skin, index) => (
                <motion.button
                  key={skin.name}
                  type="button"
                  onClick={() => {
                    handleOptionChange('skinColor', index);
                    setIsSheetOpen(false);
                  }}
                  className={`
                    aspect-square rounded-xl flex items-center justify-center text-2xl
                    ${
                      options.skinColor === index
                        ? 'ring-2 ring-offset-2'
                        : ''
                    }
                  `}
                  style={{
                    backgroundColor: skin.color,
                    '--tw-ring-color': theme.colors.accent,
                  } as React.CSSProperties}
                  whileTap={{ scale: 0.9 }}
                >
                  {options.skinColor === index && '✓'}
                </motion.button>
              ))}
            </div>
          ) : (
            // 머리/수염은 리스트로 표시
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {currentCategory.options.map((opt, index) => (
                <motion.button
                  key={opt}
                  type="button"
                  onClick={() => {
                    handleOptionChange(currentCategory.key, index);
                    setIsSheetOpen(false);
                  }}
                  className={`
                    w-full px-4 py-3 rounded-xl text-left transition-colors
                    ${
                      options[currentCategory.key] === index
                        ? ''
                        : 'hover:bg-gray-100'
                    }
                  `}
                  style={{
                    backgroundColor:
                      options[currentCategory.key] === index
                        ? `${theme.colors.accent}20`
                        : 'transparent',
                    color:
                      options[currentCategory.key] === index
                        ? theme.colors.accent
                        : theme.colors.text,
                    border:
                      options[currentCategory.key] === index
                        ? `1px solid ${theme.colors.accent}`
                        : '1px solid transparent',
                  }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="font-medium">{opt}</span>
                  {options[currentCategory.key] === index && (
                    <span className="float-right">✓</span>
                  )}
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
