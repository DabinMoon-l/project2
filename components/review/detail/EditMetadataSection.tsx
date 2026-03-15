'use client';

import { motion, AnimatePresence } from 'framer-motion';

/** 수정 모드 메타 편집 영역 (난이도 + 태그) */
export interface EditMetadataSectionProps {
  /** 현재 난이도 */
  editDifficulty: 'easy' | 'normal' | 'hard';
  /** 난이도 변경 핸들러 */
  onDifficultyChange: (value: 'easy' | 'normal' | 'hard') => void;
  /** 현재 태그 목록 */
  editedTags: string[];
  /** 태그 제거 핸들러 */
  onRemoveTag: (tag: string) => void;
  /** 태그 추가 핸들러 */
  onAddTag: (tag: string) => void;
  /** 태그 피커 표시 여부 */
  showEditTagPicker: boolean;
  /** 태그 피커 토글 핸들러 */
  onToggleTagPicker: () => void;
  /** 태그 선택 옵션 */
  editTagOptions: { value: string; label: string }[];
}

/**
 * 수정 모드에서 난이도/태그를 편집하는 메타 영역
 */
export default function EditMetadataSection({
  editDifficulty,
  onDifficultyChange,
  editedTags,
  onRemoveTag,
  onAddTag,
  showEditTagPicker,
  onToggleTagPicker,
  editTagOptions,
}: EditMetadataSectionProps) {
  return (
    <div className="space-y-4 mb-4">
      {/* 난이도 */}
      <div>
        <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">난이도</label>
        <div className="flex gap-2">
          {([
            { value: 'easy' as const, label: '쉬움' },
            { value: 'normal' as const, label: '보통' },
            { value: 'hard' as const, label: '어려움' },
          ]).map(({ value, label }) => (
            <motion.button
              key={value}
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onDifficultyChange(value)}
              className={`flex-1 py-2 px-3 font-bold text-xs border-2 transition-all duration-200 ${
                editDifficulty === value
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
              }`}
            >
              {label}
            </motion.button>
          ))}
        </div>
      </div>
      {/* 태그 */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <label className="text-xs font-bold text-[#1A1A1A]">태그</label>
          <button
            type="button"
            onClick={onToggleTagPicker}
            className={`px-2.5 py-0.5 text-xs font-bold border-2 transition-colors ${
              showEditTagPicker
                ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                : 'bg-transparent text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
            }`}
          >
            {showEditTagPicker ? '닫기' : '+ 추가'}
          </button>
        </div>
        {editedTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {editedTags.map((tag) => (
              <div
                key={tag}
                className="flex items-center gap-1 px-2.5 py-1 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold"
              >
                #{tag}
                <button
                  type="button"
                  onClick={() => onRemoveTag(tag)}
                  className="ml-0.5 hover:text-[#D4CFC4]"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <AnimatePresence>
          {showEditTagPicker && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap gap-1.5 p-2.5 border-2 border-[#1A1A1A] bg-[#F5F0E8]">
                {editTagOptions
                  .filter(opt => !editedTags.includes(opt.value))
                  .map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onAddTag(opt.value)}
                      className="px-2.5 py-1 text-xs font-bold bg-transparent text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
