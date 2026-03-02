'use client';

import { useState } from 'react';
import type { MixedExampleBlock } from './questionTypes';
import { KOREAN_LABELS, GANA_LABELS } from './questionTypes';

/**
 * 하위 문제용 혼합 보기 편집기 (일반 문제와 동일한 UI)
 */
export default function SubQuestionMixedExamplesEditor({
  mixedExamples,
  onChange,
  onDelete,
}: {
  mixedExamples: MixedExampleBlock[];
  onChange: (blocks: MixedExampleBlock[]) => void;
  onDelete: () => void;
}) {
  const [isGroupingMode, setIsGroupingMode] = useState(false);
  const [groupingSelection, setGroupingSelection] = useState<Map<string, number>>(new Map());

  // 텍스트 블록 추가
  const handleAddTextBlock = () => {
    if (mixedExamples.length >= 10) return;
    const newBlock: MixedExampleBlock = {
      id: `text_${Date.now()}`,
      type: 'text',
      content: '',
    };
    onChange([...mixedExamples, newBlock]);
  };

  // ㄱㄴㄷ 블록 추가
  const handleAddLabeledBlock = () => {
    if (mixedExamples.length >= 10) return;
    const newBlock: MixedExampleBlock = {
      id: `labeled_${Date.now()}`,
      type: 'labeled',
      items: [
        { id: `item_${Date.now()}_0`, label: 'ㄱ', content: '' },
        { id: `item_${Date.now()}_1`, label: 'ㄴ', content: '' },
      ],
    };
    onChange([...mixedExamples, newBlock]);
  };

  // (가)(나)(다) 블록 추가
  const handleAddGanaBlock = () => {
    if (mixedExamples.length >= 10) return;
    const newBlock: MixedExampleBlock = {
      id: `gana_${Date.now()}`,
      type: 'gana',
      items: [
        { id: `item_${Date.now()}_0`, label: '가', content: '' },
        { id: `item_${Date.now()}_1`, label: '나', content: '' },
      ],
    };
    onChange([...mixedExamples, newBlock]);
  };

  // ◦ 항목 블록 추가
  const handleAddBulletBlock = () => {
    if (mixedExamples.length >= 10) return;
    const newBlock: MixedExampleBlock = {
      id: `bullet_${Date.now()}`,
      type: 'bullet',
      items: [
        { id: `item_${Date.now()}_0`, label: '◦', content: '' },
        { id: `item_${Date.now()}_1`, label: '◦', content: '' },
      ],
    };
    onChange([...mixedExamples, newBlock]);
  };

  // 블록 내용 변경
  const handleBlockChange = (blockId: string, updates: Partial<MixedExampleBlock>) => {
    onChange(
      mixedExamples.map((block) =>
        block.id === blockId ? { ...block, ...updates } : block
      )
    );
  };

  // 블록 삭제
  const handleRemoveBlock = (blockId: string) => {
    onChange(mixedExamples.filter((block) => block.id !== blockId));
  };

  // ㄱㄴㄷ/(가)(나)(다)/◦ 항목 추가
  const handleAddLabeledItem = (blockId: string) => {
    onChange(
      mixedExamples.map((block) => {
        if (block.id === blockId && (block.type === 'labeled' || block.type === 'gana' || block.type === 'bullet')) {
          const items = block.items || [];
          let nextLabel: string;
          if (block.type === 'gana') {
            nextLabel = GANA_LABELS[items.length] || `${items.length + 1}`;
          } else if (block.type === 'bullet') {
            nextLabel = '◦';
          } else {
            nextLabel = KOREAN_LABELS[items.length] || `${items.length + 1}`;
          }
          return {
            ...block,
            items: [...items, { id: `item_${Date.now()}`, label: nextLabel, content: '' }],
          };
        }
        return block;
      })
    );
  };

  // ㄱㄴㄷ/(가)(나)(다)/◦ 항목 삭제
  const handleRemoveLabeledItem = (blockId: string, itemId: string) => {
    onChange(
      mixedExamples.map((block) => {
        if (block.id === blockId && (block.type === 'labeled' || block.type === 'gana' || block.type === 'bullet')) {
          const filteredItems = (block.items || []).filter((item) => item.id !== itemId);
          // 라벨 재정렬 (bullet은 항상 ◦)
          let reorderedItems;
          if (block.type === 'bullet') {
            reorderedItems = filteredItems.map((item) => ({
              ...item,
              label: '◦',
            }));
          } else {
            const labels = block.type === 'gana' ? GANA_LABELS : KOREAN_LABELS;
            reorderedItems = filteredItems.map((item, idx) => ({
              ...item,
              label: labels[idx] || `${idx + 1}`,
            }));
          }
          return {
            ...block,
            items: reorderedItems,
          };
        }
        return block;
      })
    );
  };

  // 묶기 모드 토글
  const handleToggleGroupingMode = () => {
    setIsGroupingMode(true);
    setGroupingSelection(new Map());
  };

  // 묶기 선택 토글
  const handleToggleGroupingSelection = (blockId: string) => {
    const newSelection = new Map(groupingSelection);
    if (newSelection.has(blockId)) {
      newSelection.delete(blockId);
    } else {
      newSelection.set(blockId, newSelection.size + 1);
    }
    setGroupingSelection(newSelection);
  };

  // 묶기 완료
  const handleCompleteGrouping = () => {
    if (groupingSelection.size >= 2) {
      const selectedBlocks: { id: string; order: number; block: MixedExampleBlock }[] = [];
      groupingSelection.forEach((order, id) => {
        const block = mixedExamples.find(b => b.id === id);
        if (block) selectedBlocks.push({ id, order, block });
      });
      selectedBlocks.sort((a, b) => a.order - b.order);

      const remainingBlocks = mixedExamples.filter(b => !groupingSelection.has(b.id));
      const groupedBlock: MixedExampleBlock = {
        id: `grouped_${Date.now()}`,
        type: 'grouped',
        children: selectedBlocks.map(s => s.block),
      };

      const firstSelectedIdx = mixedExamples.findIndex(b => groupingSelection.has(b.id));
      remainingBlocks.splice(firstSelectedIdx, 0, groupedBlock);
      onChange(remainingBlocks);
    }
    setIsGroupingMode(false);
    setGroupingSelection(new Map());
  };

  // 묶음 해제
  const handleUngroupBlock = (groupId: string) => {
    const groupBlock = mixedExamples.find((b) => b.id === groupId);
    if (groupBlock?.type === 'grouped' && groupBlock.children) {
      const idx = mixedExamples.findIndex((b) => b.id === groupId);
      const newBlocks = [...mixedExamples];
      newBlocks.splice(idx, 1, ...groupBlock.children.map(child => ({
        ...child,
        id: child.id || `child_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      })));
      onChange(newBlocks);
    }
  };

  return (
    <div className="space-y-3">
      {/* 묶기 모드 안내 */}
      {isGroupingMode && (
        <div className="p-2 bg-[#EDEAE4] border border-[#1A1A1A] text-sm text-[#1A1A1A]">
          묶을 블록들을 순서대로 클릭하세요. 숫자는 배열 순서입니다.
        </div>
      )}

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
            onClick={isGroupingMode && block.type !== 'grouped' ? () => handleToggleGroupingSelection(block.id) : undefined}
          >
            {/* 묶기 모드: 선택 체크박스 + 순서 번호 */}
            {isGroupingMode && block.type !== 'grouped' && (
              <div className={`absolute -top-3 -left-3 w-7 h-7 flex items-center justify-center border-2 font-bold text-sm z-10 ${
                groupingSelection.has(block.id)
                  ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                  : 'bg-white border-[#1A1A1A] text-[#1A1A1A]'
              }`}>
                {groupingSelection.has(block.id) ? groupingSelection.get(block.id) : ''}
              </div>
            )}
            {/* 블록 번호 표시 */}
            <div className={`absolute -top-3 bg-[#1A1A1A] text-[#F5F0E8] px-2 py-0.5 text-xs font-bold ${isGroupingMode && block.type !== 'grouped' ? 'left-8' : 'left-3'}`}>
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
                      onClick={() => handleRemoveBlock(block.id)}
                      className="text-xs text-[#8B1A1A] hover:underline"
                    >
                      블록 삭제
                    </button>
                  )}
                </div>
                <textarea
                  value={block.content || ''}
                  onChange={(e) => handleBlockChange(block.id, { content: e.target.value })}
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
                      onClick={() => handleRemoveBlock(block.id)}
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
                        onChange={(e) => {
                          const newItems = [...(block.items || [])];
                          const itemIdx = newItems.findIndex(i => i.id === item.id);
                          if (itemIdx !== -1) {
                            newItems[itemIdx] = { ...newItems[itemIdx], content: e.target.value };
                            handleBlockChange(block.id, { items: newItems });
                          }
                        }}
                        placeholder={`${item.label}. 내용 입력`}
                        disabled={isGroupingMode}
                        className="flex-1 px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none disabled:opacity-70"
                      />
                      {!isGroupingMode && (
                        <button
                          type="button"
                          onClick={() => handleRemoveLabeledItem(block.id, item.id)}
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
                    onClick={() => handleAddLabeledItem(block.id)}
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
                      onClick={() => handleRemoveBlock(block.id)}
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
                      <span className="w-8 h-7 bg-[#1A1A1A] text-[#F5F0E8] flex items-center justify-center text-xs font-bold flex-shrink-0">
                        ({item.label})
                      </span>
                      <input
                        type="text"
                        value={item.content}
                        onChange={(e) => {
                          const newItems = [...(block.items || [])];
                          const itemIdx = newItems.findIndex(i => i.id === item.id);
                          if (itemIdx !== -1) {
                            newItems[itemIdx] = { ...newItems[itemIdx], content: e.target.value };
                            handleBlockChange(block.id, { items: newItems });
                          }
                        }}
                        placeholder={`(${item.label}) 내용 입력`}
                        disabled={isGroupingMode}
                        className="flex-1 px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none disabled:opacity-70"
                      />
                      {!isGroupingMode && (
                        <button
                          type="button"
                          onClick={() => handleRemoveLabeledItem(block.id, item.id)}
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
                    onClick={() => handleAddLabeledItem(block.id)}
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
                      onClick={() => handleRemoveBlock(block.id)}
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
                        onChange={(e) => {
                          const newItems = [...(block.items || [])];
                          const idx = newItems.findIndex(i => i.id === item.id);
                          if (idx !== -1) {
                            newItems[idx] = { ...newItems[idx], content: e.target.value };
                            handleBlockChange(block.id, { items: newItems });
                          }
                        }}
                        placeholder={`항목 ${itemIdx + 1} 입력`}
                        disabled={isGroupingMode}
                        className="flex-1 px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none disabled:opacity-70"
                      />
                      {!isGroupingMode && (
                        <button
                          type="button"
                          onClick={() => handleRemoveLabeledItem(block.id, item.id)}
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
                    onClick={() => handleAddLabeledItem(block.id)}
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
                      onClick={() => handleRemoveBlock(block.id)}
                      className="text-xs text-[#8B1A1A] hover:underline"
                    >
                      블록 삭제
                    </button>
                  )}
                </div>
                <img
                  src={block.imageUrl}
                  alt="보기 이미지"
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
                        onClick={() => handleUngroupBlock(block.id)}
                        className="text-xs text-[#5C5C5C] hover:underline"
                      >
                        묶음 해체
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveBlock(block.id)}
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
      {/* 주의: ㄱㄴㄷ 형식은 제시문이 아닌 보기에서만 사용 */}
      {!isGroupingMode && mixedExamples.length < 10 && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleAddTextBlock}
            className="flex-1 py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
          >
            + 텍스트박스
          </button>
          <button
            type="button"
            onClick={handleAddGanaBlock}
            className="flex-1 py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
          >
            + (가)(나)(다)
          </button>
          <button
            type="button"
            onClick={handleAddBulletBlock}
            className="flex-1 py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
          >
            + ◦ 항목
          </button>
        </div>
      )}

      {/* 묶기/삭제 버튼 영역 */}
      <div className="flex gap-2">
        {/* 묶기 버튼 */}
        {mixedExamples.length >= 2 && !isGroupingMode && (
          <button
            type="button"
            onClick={handleToggleGroupingMode}
            className="flex-1 py-2 text-sm font-bold border border-[#1A1A1A] bg-[#EDEAE4] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
          >
            묶기
          </button>
        )}
        {isGroupingMode && (
          <>
            <button
              type="button"
              onClick={handleCompleteGrouping}
              disabled={groupingSelection.size < 2}
              className="flex-1 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] disabled:opacity-50"
            >
              묶기 완료 ({groupingSelection.size}개)
            </button>
            <button
              type="button"
              onClick={() => {
                setIsGroupingMode(false);
                setGroupingSelection(new Map());
              }}
              className="px-4 py-2 text-sm font-bold border border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-[#F5F0E8] transition-colors"
            >
              취소
            </button>
          </>
        )}
        {/* 제시문 삭제 버튼 */}
        {!isGroupingMode && (
          <button
            type="button"
            onClick={onDelete}
            className={`${mixedExamples.length >= 2 ? 'flex-1' : 'w-full'} py-2 text-sm font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-[#F5F0E8] transition-colors`}
          >
            제시문 삭제
          </button>
        )}
      </div>

      {/* 미리보기 */}
      {mixedExamples.some(block => {
        if (block.type === 'text') return block.content?.trim();
        if (block.type === 'labeled') return (block.items || []).some(i => i.content?.trim());
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
                if (block.type === 'labeled') return (block.items || []).some(i => i.content?.trim());
                if (block.type === 'image') return !!block.imageUrl;
                if (block.type === 'grouped') return block.children && block.children.length > 0;
                return false;
              })();
              if (!hasContent) return null;

              return (
                <div key={block.id} className={`p-2 border bg-white ${block.type === 'grouped' ? 'border-[#1A1A1A] border-2' : 'border-dashed border-[#5C5C5C]'}`}>
                  <p className="text-[10px] text-[#5C5C5C] mb-1">
                    보기 {blockIdx + 1}
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
                  {block.type === 'image' && block.imageUrl && (
                    <img src={block.imageUrl} alt="보기 이미지" className="max-h-24 object-contain" />
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
    </div>
  );
}
