'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { MixedExampleBlock } from '../questionTypes';
import { KOREAN_LABELS, GANA_LABELS } from '../questionTypes';

/** 제시문(혼합 보기) 에디터 Props */
interface MixedExamplesEditorProps {
  /** 혼합 보기 블록 배열 */
  mixedExamples: MixedExampleBlock[];
  /** 제시문 에디터 표시 여부 */
  showExamplesEditor: boolean;
  /** 제시문 에디터 활성화/비활성화 핸들러 */
  onToggleExamples: (enabled: boolean) => void;
  /** 제시문 발문 */
  passagePrompt?: string;
  /** 제시문 발문 변경 핸들러 */
  onPassagePromptChange: (value: string) => void;
  /** 텍스트박스 블록 추가 핸들러 */
  onAddTextExample: () => void;
  /** (가)(나)(다) 블록 추가 핸들러 */
  onAddGanaExample: () => void;
  /** ◦ 항목 블록 추가 핸들러 */
  onAddBulletExample: () => void;
  /** 블록 삭제 핸들러 */
  onRemoveMixedExample: (blockId: string) => void;
  /** 텍스트박스 블록 내용 변경 핸들러 */
  onTextBlockChange: (blockId: string, content: string) => void;
  /** labeled/gana/bullet 블록 내 항목 추가 핸들러 */
  onAddLabeledItem: (blockId: string) => void;
  /** labeled/gana/bullet 블록 내 항목 내용 변경 핸들러 */
  onLabeledItemChange: (blockId: string, itemId: string, content: string) => void;
  /** labeled/gana/bullet 블록 내 항목 삭제 핸들러 */
  onRemoveLabeledItem: (blockId: string, itemId: string) => void;
  /** grouped 블록 해체 핸들러 */
  onUngroupBlock: (groupedBlockId: string) => void;
  /** 묶기 모드 여부 */
  isGroupingMode: boolean;
  /** 묶기 선택 항목 (블록 ID -> 선택 순서) */
  groupingSelection: Map<string, number>;
  /** 묶기 모드 토글 핸들러 */
  onToggleGroupingMode: () => void;
  /** 묶기 완료 핸들러 */
  onCompleteGrouping: () => void;
  /** 묶기 항목 선택/해제 핸들러 */
  onGroupingSelect: (blockId: string) => void;
  /** 묶기 취소 핸들러 */
  onCancelGrouping: () => void;
}

/**
 * 제시문(혼합 보기) 에디터
 *
 * 텍스트박스, (가)(나)(다), ◦항목, 이미지, 묶음 등
 * 다양한 블록 타입의 제시문을 편집합니다.
 */
export default function MixedExamplesEditor({
  mixedExamples,
  showExamplesEditor,
  onToggleExamples,
  passagePrompt,
  onPassagePromptChange,
  onAddTextExample,
  onAddGanaExample,
  onAddBulletExample,
  onRemoveMixedExample,
  onTextBlockChange,
  onAddLabeledItem,
  onLabeledItemChange,
  onRemoveLabeledItem,
  onUngroupBlock,
  isGroupingMode,
  groupingSelection,
  onToggleGroupingMode,
  onCompleteGrouping,
  onGroupingSelect,
  onCancelGrouping,
}: MixedExamplesEditorProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-bold text-[#1A1A1A]">
          제시문 <span className="text-[#5C5C5C] font-normal">(선택)</span>
        </label>
        <div className="flex gap-2">
          {/* 묶기 버튼 - 보기가 2개 이상일 때만 표시 */}
          {showExamplesEditor && mixedExamples.length >= 2 && (
            <button
              type="button"
              onClick={isGroupingMode ? onCompleteGrouping : onToggleGroupingMode}
              className={`
                px-3 py-1 text-xs font-bold border border-[#1A1A1A]
                transition-colors
                ${isGroupingMode
                  ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                  : 'bg-[#EDEAE4] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                }
              `}
            >
              {isGroupingMode ? `묶기 완료 (${groupingSelection.size}개)` : '묶기'}
            </button>
          )}
          {/* 묶기 취소 버튼 */}
          {isGroupingMode && (
            <button
              type="button"
              onClick={onCancelGrouping}
              className="px-3 py-1 text-xs font-bold border border-[#8B1A1A] bg-[#EDEAE4] text-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-[#F5F0E8] transition-colors"
            >
              취소
            </button>
          )}
          <button
            type="button"
            onClick={() => onToggleExamples(!showExamplesEditor)}
            disabled={isGroupingMode}
            className={`
              px-3 py-1 text-xs font-bold border border-[#1A1A1A]
              transition-colors disabled:opacity-50
              ${showExamplesEditor
                ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                : 'bg-[#EDEAE4] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
              }
            `}
          >
            {showExamplesEditor ? '제시문 삭제' : '제시문 추가'}
          </button>
        </div>
      </div>

      {/* 묶기 모드 안내 */}
      {isGroupingMode && (
        <div className="mb-3 p-2 bg-[#EDEAE4] border border-[#1A1A1A] text-sm text-[#1A1A1A]">
          묶을 블록들을 순서대로 클릭하세요. 숫자는 배열 순서입니다.
        </div>
      )}

      <AnimatePresence>
        {showExamplesEditor && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3"
          >
            {/* 혼합 보기 블록 입력 */}
            <div className="space-y-4">
              {mixedExamples.map((block, blockIdx) => (
                <div
                  key={block.id}
                  className={`border-2 p-4 bg-[#FAFAFA] relative transition-all ${
                    isGroupingMode
                      ? groupingSelection.has(block.id)
                        ? 'border-[#1A1A1A] ring-2 ring-[#1A1A1A] cursor-pointer bg-[#EDEAE4]'
                        : 'border-[#D4CFC4] cursor-pointer hover:border-[#1A1A1A]'
                      : 'border-[#1A1A1A]'
                  }`}
                  onClick={isGroupingMode ? () => onGroupingSelect(block.id) : undefined}
                >
                  {/* 묶기 모드: 선택 체크박스 + 순서 번호 */}
                  {isGroupingMode && (
                    <div className={`absolute -top-3 -left-3 w-7 h-7 flex items-center justify-center border-2 font-bold text-sm z-10 ${
                      groupingSelection.has(block.id)
                        ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                        : 'bg-white border-[#1A1A1A] text-[#1A1A1A]'
                    }`}>
                      {groupingSelection.has(block.id) ? groupingSelection.get(block.id) : ''}
                    </div>
                  )}
                  {/* 블록 번호 표시 */}
                  <div className={`absolute -top-3 bg-[#1A1A1A] text-[#F5F0E8] px-2 py-0.5 text-xs font-bold ${isGroupingMode ? 'left-8' : 'left-3'}`}>
                    보기 {blockIdx + 1}
                  </div>

                  {/* 텍스트박스 블록 */}
                  {block.type === 'text' && (
                    <div className="space-y-2" onClick={(e) => isGroupingMode && e.stopPropagation()}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#5C5C5C]">텍스트박스</span>
                        {!isGroupingMode && (
                          <button
                            type="button"
                            onClick={() => onRemoveMixedExample(block.id)}
                            className="text-xs text-[#8B1A1A] hover:underline"
                          >
                            블록 삭제
                          </button>
                        )}
                      </div>
                      <textarea
                        value={block.content || ''}
                        onChange={(e) => onTextBlockChange(block.id, e.target.value)}
                        placeholder="텍스트 내용 입력 (줄바꿈 가능)"
                        rows={2}
                        disabled={isGroupingMode}
                        className="w-full px-3 py-2 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none resize-none disabled:opacity-70"
                      />
                    </div>
                  )}

                  {/* ㄱ.ㄴ.ㄷ. 블록 */}
                  {block.type === 'labeled' && (
                    <div className="space-y-2" onClick={(e) => isGroupingMode && e.stopPropagation()}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#5C5C5C]">ㄱ.ㄴ.ㄷ.형식</span>
                        {!isGroupingMode && (
                          <button
                            type="button"
                            onClick={() => onRemoveMixedExample(block.id)}
                            className="text-xs text-[#8B1A1A] hover:underline"
                          >
                            블록 삭제
                          </button>
                        )}
                      </div>
                      {/* 항목들 */}
                      <div className="space-y-2">
                        {(block.items || []).map((item) => (
                          <div key={item.id} className="flex items-center gap-2">
                            <span className="w-7 h-7 bg-[#1A1A1A] text-[#F5F0E8] flex items-center justify-center text-sm font-bold flex-shrink-0">
                              {item.label}
                            </span>
                            <input
                              type="text"
                              value={item.content}
                              onChange={(e) => onLabeledItemChange(block.id, item.id, e.target.value)}
                              placeholder={`${item.label}. 내용 입력`}
                              disabled={isGroupingMode}
                              className="flex-1 px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none disabled:opacity-70"
                            />
                            {!isGroupingMode && (
                              <button
                                type="button"
                                onClick={() => onRemoveLabeledItem(block.id, item.id)}
                                className="w-7 h-7 flex items-center justify-center text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {/* 항목 추가 버튼 */}
                      {!isGroupingMode && (block.items || []).length < KOREAN_LABELS.length && (
                        <button
                          type="button"
                          onClick={() => onAddLabeledItem(block.id)}
                          className="w-full py-1.5 text-xs font-bold border border-dashed border-[#5C5C5C] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                        >
                          + {KOREAN_LABELS[(block.items || []).length]} 추가
                        </button>
                      )}
                    </div>
                  )}

                  {/* (가)(나)(다) 블록 */}
                  {block.type === 'gana' && (
                    <div className="space-y-2" onClick={(e) => isGroupingMode && e.stopPropagation()}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#5C5C5C]">(가)(나)(다)형식</span>
                        {!isGroupingMode && (
                          <button
                            type="button"
                            onClick={() => onRemoveMixedExample(block.id)}
                            className="text-xs text-[#8B1A1A] hover:underline"
                          >
                            블록 삭제
                          </button>
                        )}
                      </div>
                      {/* 항목들 */}
                      <div className="space-y-2">
                        {(block.items || []).map((item) => (
                          <div key={item.id} className="flex items-center gap-2">
                            <span className="w-8 h-7 bg-[#1A1A1A] text-[#F5F0E8] flex items-center justify-center text-sm font-bold flex-shrink-0">
                              ({item.label})
                            </span>
                            <input
                              type="text"
                              value={item.content}
                              onChange={(e) => onLabeledItemChange(block.id, item.id, e.target.value)}
                              placeholder={`(${item.label}) 내용 입력`}
                              disabled={isGroupingMode}
                              className="flex-1 px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none disabled:opacity-70"
                            />
                            {!isGroupingMode && (
                              <button
                                type="button"
                                onClick={() => onRemoveLabeledItem(block.id, item.id)}
                                className="w-7 h-7 flex items-center justify-center text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {/* 항목 추가 버튼 */}
                      {!isGroupingMode && (block.items || []).length < GANA_LABELS.length && (
                        <button
                          type="button"
                          onClick={() => onAddLabeledItem(block.id)}
                          className="w-full py-1.5 text-xs font-bold border border-dashed border-[#5C5C5C] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                        >
                          + ({GANA_LABELS[(block.items || []).length]}) 추가
                        </button>
                      )}
                    </div>
                  )}

                  {/* ◦ 항목 블록 */}
                  {block.type === 'bullet' && (
                    <div className="space-y-2" onClick={(e) => isGroupingMode && e.stopPropagation()}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#5C5C5C]">◦ 항목 형식</span>
                        {!isGroupingMode && (
                          <button
                            type="button"
                            onClick={() => onRemoveMixedExample(block.id)}
                            className="text-xs text-[#8B1A1A] hover:underline"
                          >
                            블록 삭제
                          </button>
                        )}
                      </div>
                      {/* 항목들 */}
                      <div className="space-y-2">
                        {(block.items || []).map((item, itemIdx) => (
                          <div key={item.id} className="flex items-center gap-2">
                            <span className="w-7 h-7 bg-[#1A1A1A] text-[#F5F0E8] flex items-center justify-center text-sm font-bold flex-shrink-0 rounded-full">
                              ◦
                            </span>
                            <input
                              type="text"
                              value={item.content}
                              onChange={(e) => onLabeledItemChange(block.id, item.id, e.target.value)}
                              placeholder={`항목 ${itemIdx + 1} 입력`}
                              disabled={isGroupingMode}
                              className="flex-1 px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none disabled:opacity-70"
                            />
                            {!isGroupingMode && (
                              <button
                                type="button"
                                onClick={() => onRemoveLabeledItem(block.id, item.id)}
                                className="w-7 h-7 flex items-center justify-center text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {/* 항목 추가 버튼 */}
                      {!isGroupingMode && (block.items || []).length < 20 && (
                        <button
                          type="button"
                          onClick={() => onAddLabeledItem(block.id)}
                          className="w-full py-1.5 text-xs font-bold border border-dashed border-[#5C5C5C] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                        >
                          + ◦ 항목 추가
                        </button>
                      )}
                    </div>
                  )}

                  {/* 이미지 블록 */}
                  {block.type === 'image' && block.imageUrl && (
                    <div className="space-y-2" onClick={(e) => isGroupingMode && e.stopPropagation()}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#5C5C5C]">이미지</span>
                        {!isGroupingMode && (
                          <button
                            type="button"
                            onClick={() => onRemoveMixedExample(block.id)}
                            className="text-xs text-[#8B1A1A] hover:underline"
                          >
                            블록 삭제
                          </button>
                        )}
                      </div>
                      <img
                        src={block.imageUrl}
                        alt=""
                        className="max-h-32 object-contain border border-[#D4CFC4]"
                      />
                    </div>
                  )}

                  {/* 묶음(grouped) 블록 */}
                  {block.type === 'grouped' && block.children && (
                    <div className="space-y-2" onClick={(e) => isGroupingMode && e.stopPropagation()}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#1A1A1A]">묶음 ({block.children.length}개)</span>
                        {!isGroupingMode && (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => onUngroupBlock(block.id)}
                              className="text-xs text-[#5C5C5C] hover:underline"
                            >
                              묶음 해체
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveMixedExample(block.id)}
                              className="text-xs text-[#8B1A1A] hover:underline"
                            >
                              블록 삭제
                            </button>
                          </div>
                        )}
                      </div>
                      {/* 묶음 내 자식 블록들 표시 */}
                      <div className="border-l-4 border-[#1A1A1A] pl-3 space-y-2">
                        {block.children.map((child, childIdx) => (
                          <div key={child.id || childIdx} className="text-sm">
                            {child.type === 'text' && child.content && (
                              <p className="whitespace-pre-wrap text-[#5C5C5C]">{child.content}</p>
                            )}
                            {child.type === 'labeled' && (child.items || []).map((item) => (
                              <p key={item.id} className="text-[#1A1A1A]">
                                <span className="font-bold">{item.label}.</span> {item.content}
                              </p>
                            ))}
                            {child.type === 'gana' && (child.items || []).map((item) => (
                              <p key={item.id} className="text-[#1A1A1A]">
                                <span className="font-bold">({item.label})</span> {item.content}
                              </p>
                            ))}
                            {child.type === 'image' && child.imageUrl && (
                              <img
                                src={child.imageUrl}
                                alt="묶음 이미지"
                                className="max-h-24 object-contain border border-[#D4CFC4]"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 제시문 블록 추가 버튼들 - 묶기 모드가 아닐 때만 */}
            {!isGroupingMode && mixedExamples.length < 10 && (
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={onAddTextExample}
                  className="py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                >
                  + 텍스트박스
                </button>
                <button
                  type="button"
                  onClick={onAddGanaExample}
                  className="py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                >
                  + (가)(나)(다)
                </button>
                <button
                  type="button"
                  onClick={onAddBulletExample}
                  className="py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                >
                  + ◦ 항목
                </button>
              </div>
            )}

            {/* 미리보기 */}
            {mixedExamples.some(block => {
              if (block.type === 'text') return block.content?.trim();
              if (block.type === 'labeled' || block.type === 'gana' || block.type === 'bullet') return (block.items || []).some(i => i.content?.trim());
              if (block.type === 'image') return !!block.imageUrl;
              if (block.type === 'grouped') return block.children && block.children.length > 0;
              return false;
            }) && (
              <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                <p className="text-xs text-[#5C5C5C] mb-2">미리보기</p>
                <div className="space-y-2">
                  {mixedExamples.map((block, blockIdx) => {
                    const hasContent = (() => {
                      if (block.type === 'text') return block.content?.trim();
                      if (block.type === 'labeled' || block.type === 'gana' || block.type === 'bullet') return (block.items || []).some(i => i.content?.trim());
                      if (block.type === 'image') return !!block.imageUrl;
                      if (block.type === 'grouped') return block.children && block.children.length > 0;
                      return false;
                    })();
                    if (!hasContent) return null;

                    return (
                      <div key={block.id} className={`p-2 border bg-white ${block.type === 'grouped' ? 'border-[#1A1A1A] border-2' : 'border-dashed border-[#5C5C5C]'}`}>
                        <p className="text-[10px] text-[#5C5C5C] mb-1">
                          제시문 {blockIdx + 1}
                          {block.type === 'grouped' && <span className="text-[#5C5C5C] ml-1">(묶음)</span>}
                        </p>
                        {block.type === 'text' && block.content?.trim() && (
                          <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{block.content}</p>
                        )}
                        {block.type === 'labeled' && (block.items || []).filter(i => i.content?.trim()).map((item) => (
                          <p key={item.id} className="text-sm text-[#1A1A1A]">
                            <span className="font-bold">{item.label}.</span> {item.content}
                          </p>
                        ))}
                        {block.type === 'gana' && (block.items || []).filter(i => i.content?.trim()).map((item) => (
                          <p key={item.id} className="text-sm text-[#1A1A1A]">
                            <span className="font-bold">({item.label})</span> {item.content}
                          </p>
                        ))}
                        {block.type === 'bullet' && (block.items || []).filter(i => i.content?.trim()).map((item) => (
                          <p key={item.id} className="text-sm text-[#1A1A1A]">
                            <span className="font-bold">◦</span> {item.content}
                          </p>
                        ))}
                        {block.type === 'image' && block.imageUrl && (
                          <img src={block.imageUrl} alt="제시문 이미지" className="max-h-24 object-contain" />
                        )}
                        {block.type === 'grouped' && block.children && (
                          <div className="space-y-1">
                            {block.children.map((child, childIdx) => (
                              <div key={child.id || childIdx}>
                                {child.type === 'text' && child.content?.trim() && (
                                  <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>
                                )}
                                {child.type === 'labeled' && (child.items || []).filter(i => i.content?.trim()).map((item) => (
                                  <p key={item.id} className="text-sm text-[#1A1A1A]">
                                    <span className="font-bold">{item.label}.</span> {item.content}
                                  </p>
                                ))}
                                {child.type === 'gana' && (child.items || []).filter(i => i.content?.trim()).map((item) => (
                                  <p key={item.id} className="text-sm text-[#1A1A1A]">
                                    <span className="font-bold">({item.label})</span> {item.content}
                                  </p>
                                ))}
                                {child.type === 'bullet' && (child.items || []).filter(i => i.content?.trim()).map((item) => (
                                  <p key={item.id} className="text-sm text-[#1A1A1A]">
                                    <span className="font-bold">◦</span> {item.content}
                                  </p>
                                ))}
                                {child.type === 'image' && child.imageUrl && (
                                  <img src={child.imageUrl} alt="묶음 이미지" className="max-h-20 object-contain" />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 제시문 발문 입력 */}
            <div className="mt-4 pt-4 border-t border-dashed border-[#D4CFC4]">
              <label className="block text-xs font-bold text-[#5C5C5C] mb-1">
                제시문 발문 <span className="font-normal">(선택)</span>
              </label>
              <input
                type="text"
                value={passagePrompt || ''}
                onChange={(e) => onPassagePromptChange(e.target.value)}
                placeholder="예: 다음 자료에 대한 설명으로 적절한 것은?"
                className="w-full px-3 py-2 text-sm border border-[#1A1A1A] bg-white focus:outline-none"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
