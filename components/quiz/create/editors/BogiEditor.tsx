'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { BogiData } from '../questionTypes';
import { BOGI_QUESTION_PRESETS, KOREAN_LABELS } from '../questionTypes';

/** 보기 에디터 Props */
interface BogiEditorProps {
  /** 보기 데이터 (null이면 비활성) */
  bogi: BogiData | null;
  /** 보기 데이터 변경 핸들러 (null 전달 시 보기 삭제) */
  onBogiChange: (bogi: BogiData | null) => void;
}

/**
 * 보기(<보기>) 에디터
 *
 * 객관식/주관식 문제에서 사용하는 <보기> 박스를 편집합니다.
 * 프리셋 발문, 직접 입력, ㄱ.ㄴ.ㄷ. 항목 추가/삭제를 지원합니다.
 */
export default function BogiEditor({ bogi, onBogiChange }: BogiEditorProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-bold text-[#1A1A1A]">
          보기 <span className="text-[#5C5C5C] font-normal">(선택)</span>
        </label>
        <button
          type="button"
          onClick={() => {
            if (bogi) {
              onBogiChange(null);
            } else {
              onBogiChange({
                questionText: BOGI_QUESTION_PRESETS[0],
                items: [
                  { id: `bogi_${Date.now()}_0`, label: 'ㄱ', content: '' },
                  { id: `bogi_${Date.now()}_1`, label: 'ㄴ', content: '' },
                ],
              });
            }
          }}
          className={`
            px-3 py-1 text-xs font-bold border border-[#1A1A1A]
            transition-colors
            ${bogi
              ? 'bg-[#1A1A1A] text-[#F5F0E8]'
              : 'bg-[#EDEAE4] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
            }
          `}
        >
          {bogi ? '보기 삭제' : '보기 추가'}
        </button>
      </div>

      <AnimatePresence>
        {bogi && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3 border-2 border-[#1A1A1A] p-4 bg-[#FAFAFA]"
          >
            {/* 발문 */}
            <div>
              <label className="block text-xs font-bold text-[#5C5C5C] mb-1">
                발문
              </label>
              <div className="space-y-2">
                {/* 프리셋 버튼들 */}
                <div className="flex flex-wrap gap-1">
                  {BOGI_QUESTION_PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onBogiChange({ ...bogi, questionText: preset })}
                      className={`
                        px-2 py-1 text-xs border transition-colors
                        ${bogi.questionText === preset
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-white text-[#5C5C5C] border-[#D4CFC4] hover:border-[#1A1A1A]'
                        }
                      `}
                    >
                      프리셋 {idx + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onBogiChange({ ...bogi, questionText: '' })}
                    className={`
                      px-2 py-1 text-xs border transition-colors
                      ${bogi.questionText === '' || (bogi.questionText && !BOGI_QUESTION_PRESETS.includes(bogi.questionText))
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                        : 'bg-white text-[#5C5C5C] border-[#D4CFC4] hover:border-[#1A1A1A]'
                      }
                    `}
                  >
                    직접 입력
                  </button>
                </div>
                {/* 텍스트 입력 */}
                <textarea
                  value={bogi.questionText || ''}
                  onChange={(e) => onBogiChange({ ...bogi, questionText: e.target.value })}
                  placeholder="예: 이에 대한 설명으로 옳은 것만을 <보기>에서 있는 대로 고른 것은?"
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-[#1A1A1A] bg-white resize-none focus:outline-none"
                />
              </div>
            </div>

            {/* ㄱㄴㄷ 항목들 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-[#5C5C5C]">
                  &lt;보기&gt; 항목 (ㄱ.ㄴ.ㄷ.)
                </label>
                {(bogi.items?.length || 0) < 8 && (
                  <button
                    type="button"
                    onClick={() => {
                      const items = bogi.items || [];
                      const nextLabel = KOREAN_LABELS[items.length] || `${items.length + 1}`;
                      onBogiChange({
                        ...bogi,
                        items: [...items, { id: `bogi_${Date.now()}`, label: nextLabel, content: '' }],
                      });
                    }}
                    className="px-2 py-1 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4]"
                  >
                    + 항목 추가
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {(bogi.items || []).map((item, idx) => (
                  <div key={item.id} className="flex gap-2 items-start">
                    <span className="w-6 h-9 flex items-center justify-center text-sm font-bold text-[#1A1A1A] border border-[#1A1A1A] bg-white">
                      {item.label}.
                    </span>
                    <textarea
                      value={item.content}
                      onChange={(e) => {
                        const items = [...(bogi.items || [])];
                        items[idx] = { ...items[idx], content: e.target.value };
                        onBogiChange({ ...bogi, items });
                      }}
                      placeholder={`${item.label} 내용 입력`}
                      rows={1}
                      className="flex-1 px-2 py-1.5 text-sm border border-[#1A1A1A] bg-white resize-none focus:outline-none"
                    />
                    {(bogi.items?.length || 0) > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const filteredItems = (bogi.items || []).filter((_, i) => i !== idx);
                          // 라벨 재정렬
                          const reorderedItems = filteredItems.map((it, i) => ({
                            ...it,
                            label: KOREAN_LABELS[i] || `${i + 1}`,
                          }));
                          onBogiChange({ ...bogi, items: reorderedItems });
                        }}
                        className="w-7 h-9 flex items-center justify-center text-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-white border border-[#8B1A1A] transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 미리보기 */}
            {bogi.items?.some(i => i.content?.trim()) && (
              <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                <p className="text-xs text-[#5C5C5C] mb-2">미리보기</p>
                {bogi.questionText && (
                  <p className="text-sm text-[#1A1A1A] mb-2">{bogi.questionText}</p>
                )}
                <div className="border border-[#1A1A1A] bg-white p-2">
                  <p className="text-xs text-center text-[#5C5C5C] mb-1">&lt;보 기&gt;</p>
                  {(bogi.items || []).filter(i => i.content?.trim()).map((item) => (
                    <p key={item.id} className="text-sm text-[#1A1A1A]">
                      <span className="font-bold">{item.label}.</span> {item.content}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
