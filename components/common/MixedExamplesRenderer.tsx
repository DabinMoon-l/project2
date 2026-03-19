'use client';

/**
 * 혼합 보기 블록 렌더러 — passageMixedExamples / mixedExamples 공통 컴포넌트
 *
 * 20+ 파일에서 중복되던 블록 렌더링 로직을 단일 컴포넌트로 통합.
 * 블록 타입: text, labeled, gana, bullet, image, grouped (재귀)
 */

import Image from 'next/image';
import type { MixedExampleBlock, LabeledItem } from '@/components/quiz/create/questionTypes';
import { renderInlineMarkdown } from '@/lib/utils/renderInlineMarkdown';

// ─── 블록 호환 타입 (다양한 파일에서 사용하는 타입 통합) ───
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = MixedExampleBlock | (Record<string, any> & { id: string; type: string });

/** 블록 래퍼 스타일 프리셋 */
export type BlockWrapperStyle =
  | 'none'           // 래퍼 없음 (기본)
  | 'passage'        // p-3 bg-[#EDEAE4] border border-[#1A1A1A]
  | 'passage-accent'; // p-3 bg-[#FFF8E1] border border-[#8B6914]

export interface MixedExamplesRendererProps {
  blocks: AnyBlock[];
  /** 블록 간 간격 (기본: 'normal') */
  spacing?: 'tight' | 'normal' | 'loose';
  /** 빈 content 아이템 필터링 (기본: true) */
  filterEmpty?: boolean;
  /** 텍스트 크기 (기본: 'sm') */
  textSize?: 'xs' | 'sm' | 'base';
  /** 이미지 렌더링 방식 (기본: 'img') */
  imageRenderer?: 'img' | 'next-image';
  /** 개별 블록 래퍼 스타일 (기본: 'none') */
  blockWrapper?: BlockWrapperStyle;
  /** grouped 블록의 래퍼 스타일 (기본: blockWrapper 값 상속, 'grouped-thick'이면 border-2) */
  groupedBorderThick?: boolean;
}

// ─── 유틸리티 ───

/** spacing prop → Tailwind 클래스 */
const SPACING_MAP = {
  tight: 'space-y-1',
  normal: 'space-y-1.5',
  loose: 'space-y-2',
} as const;

/** textSize prop → Tailwind 클래스 */
const TEXT_SIZE_MAP = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
} as const;

/** 블록 래퍼 스타일 → Tailwind 클래스 */
function getBlockWrapperClass(style: BlockWrapperStyle, isGrouped: boolean, thick: boolean): string {
  if (style === 'none') return '';
  if (style === 'passage') {
    return isGrouped
      ? `p-3 bg-[#EDEAE4] ${thick ? 'border-2' : 'border'} border-[#1A1A1A] space-y-1`
      : 'p-3 bg-[#EDEAE4] border border-[#1A1A1A] space-y-1';
  }
  if (style === 'passage-accent') {
    return isGrouped
      ? `p-3 bg-[#FFF8E1] ${thick ? 'border-2' : 'border'} border-[#8B6914] space-y-1`
      : 'p-3 bg-[#FFF8E1] border border-[#8B6914] space-y-1';
  }
  return '';
}

// ─── 내부 블록 렌더러 ───

/** 이미지 블록 렌더링 */
function RenderImage({
  src,
  renderer,
  blockWrapper,
}: {
  src: string;
  renderer: 'img' | 'next-image';
  blockWrapper: BlockWrapperStyle;
}) {
  if (renderer === 'next-image') {
    return (
      <Image
        src={src}
        alt=""
        width={800}
        height={400}
        className="max-w-full h-auto"
        unoptimized
      />
    );
  }
  // img 태그
  const hasBorder = blockWrapper === 'none';
  return (
    <img
      src={src}
      alt=""
      className={`max-w-full h-auto ${hasBorder ? 'border border-[#1A1A1A]' : ''}`}
    />
  );
}

/** 단일 블록 렌더링 (재귀 — grouped에서 children 렌더용) */
function RenderBlock({
  block,
  textSizeCls,
  filterEmpty,
  imageRenderer,
  blockWrapper,
  groupedBorderThick,
  isChild,
}: {
  block: AnyBlock;
  textSizeCls: string;
  filterEmpty: boolean;
  imageRenderer: 'img' | 'next-image';
  blockWrapper: BlockWrapperStyle;
  groupedBorderThick: boolean;
  isChild?: boolean;
}) {
  const items = (block.items || []) as LabeledItem[];
  const filteredItems = filterEmpty ? items.filter((i) => i.content?.trim()) : items;

  // ── grouped: 재귀 렌더 ──
  if (block.type === 'grouped') {
    const children = (block.children || []) as AnyBlock[];
    if (children.length === 0) return null;

    const wrapperCls = blockWrapper !== 'none'
      ? getBlockWrapperClass(blockWrapper, true, groupedBorderThick)
      : 'space-y-1';

    return (
      <div className={wrapperCls}>
        {children.map((child) => (
          <RenderBlock
            key={child.id}
            block={child}
            textSizeCls={textSizeCls}
            filterEmpty={filterEmpty}
            imageRenderer={imageRenderer}
            blockWrapper="none"
            groupedBorderThick={false}
            isChild
          />
        ))}
      </div>
    );
  }

  // ── text ──
  if (block.type === 'text') {
    const content = block.content as string | undefined;
    if (filterEmpty && !content?.trim()) return null;

    const textColor = isChild ? 'text-[#5C5C5C]' : 'text-[#1A1A1A]';
    const inner = (
      <p className={`${textSizeCls} ${textColor} whitespace-pre-wrap`}>{renderInlineMarkdown(content || '')}</p>
    );

    if (blockWrapper !== 'none' && !isChild) {
      return <div className={getBlockWrapperClass(blockWrapper, false, false)}>{inner}</div>;
    }
    return inner;
  }

  // ── labeled (ㄱ.ㄴ.ㄷ.) ──
  if (block.type === 'labeled' && filteredItems.length > 0) {
    const inner = filteredItems.map((item) => (
      <p key={item.id} className={`${textSizeCls} text-[#1A1A1A]`}>
        <span className="font-bold mr-1">{item.label}.</span>
        {renderInlineMarkdown(item.content)}
      </p>
    ));

    if (blockWrapper !== 'none' && !isChild) {
      return <div className={getBlockWrapperClass(blockWrapper, false, false)}>{inner}</div>;
    }
    return <div className="space-y-1">{inner}</div>;
  }

  // ── gana ((가)(나)(다)) ──
  if (block.type === 'gana' && filteredItems.length > 0) {
    const inner = filteredItems.map((item) => (
      <p key={item.id} className={`${textSizeCls} text-[#1A1A1A]`}>
        <span className="font-bold mr-1">({item.label})</span>
        {renderInlineMarkdown(item.content)}
      </p>
    ));

    if (blockWrapper !== 'none' && !isChild) {
      return <div className={getBlockWrapperClass(blockWrapper, false, false)}>{inner}</div>;
    }
    return <div className="space-y-1">{inner}</div>;
  }

  // ── bullet (◦ 항목) ──
  if (block.type === 'bullet' && filteredItems.length > 0) {
    const inner = filteredItems.map((item) => (
      <p key={item.id} className={`${textSizeCls} text-[#1A1A1A]`}>
        <span className="mr-1">&bull;</span>
        {renderInlineMarkdown(item.content)}
      </p>
    ));

    if (blockWrapper !== 'none' && !isChild) {
      return <div className={getBlockWrapperClass(blockWrapper, false, false)}>{inner}</div>;
    }
    return <div className="space-y-1">{inner}</div>;
  }

  // ── image ──
  if (block.type === 'image' && block.imageUrl) {
    if (blockWrapper !== 'none' && !isChild) {
      return (
        <div className="border border-[#1A1A1A] overflow-hidden">
          <RenderImage src={block.imageUrl} renderer={imageRenderer} blockWrapper={blockWrapper} />
        </div>
      );
    }
    return <RenderImage src={block.imageUrl} renderer={imageRenderer} blockWrapper={blockWrapper} />;
  }

  return null;
}

// ─── 메인 컴포넌트 ───

export default function MixedExamplesRenderer({
  blocks,
  spacing = 'normal',
  filterEmpty = true,
  textSize = 'sm',
  imageRenderer = 'img',
  blockWrapper = 'none',
  groupedBorderThick = false,
}: MixedExamplesRendererProps) {
  if (!blocks || blocks.length === 0) return null;

  const spacingCls = SPACING_MAP[spacing];
  const textSizeCls = TEXT_SIZE_MAP[textSize];

  return (
    <div className={spacingCls}>
      {blocks.map((block) => (
        <div key={block.id}>
          <RenderBlock
            block={block}
            textSizeCls={textSizeCls}
            filterEmpty={filterEmpty}
            imageRenderer={imageRenderer}
            blockWrapper={blockWrapper}
            groupedBorderThick={groupedBorderThick}
          />
        </div>
      ))}
    </div>
  );
}
