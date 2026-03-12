'use client';

import { useState, useEffect, useRef } from 'react';

// ============================================================
// 타입
// ============================================================

interface WordPos { x: number; y: number; size: number; text: string; color: string }

export interface ArchiveComment {
  id: string;
  content: string;
  authorNickname: string;
  isAIReply?: boolean;
  isAccepted?: boolean;
  createdAt: Date;
}

export interface ArchivePost {
  id: string;
  title: string;
  content: string;
  authorNickname: string;
  imageUrls?: string[];
  createdAt: Date;
  commentCount: number;
  acceptedCommentId?: string;
  aiReply?: string;
  comments: ArchiveComment[];
  hasAccepted: boolean;
}

// ============================================================
// 상수
// ============================================================

/** 반별 테마 색상 */
export const CLASS_COLORS: Record<string, string> = {
  A: '#8B1A1A',
  B: '#B8860B',
  C: '#1D5D4A',
  D: '#1E3A5F',
};

/** 워드클라우드 색상 순환 */
export const CLOUD_COLORS = ['#1A1A1A', '#3A3A3A', '#5C5C5C', '#8B1A1A'];

// ============================================================
// 나선형 배치 워드클라우드
// ============================================================

export function SpiralWordCloud({ data, colors }: { data: { text: string; value: number }[]; colors: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<WordPos[]>([]);
  const [size, setSize] = useState(0);

  // 컨테이너 너비 관찰 → 1:1 정사각형
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width || 0;
      if (w > 0) setSize(w);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (size === 0 || data.length === 0) { setPositions([]); return; }

    const W = size;
    const H = size; // 1:1
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const sorted = [...data].sort((a, b) => b.value - a.value);

    // canvas로 텍스트 너비 측정 (시스템 폰트 — 확실한 측정)
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) { setPositions([]); return; }

    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const result: WordPos[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const word = sorted[i];
      const normalized = word.value / maxVal;
      const fontSize = Math.round(14 + normalized * 38); // 14~52px
      ctx.font = `bold ${fontSize}px sans-serif`;
      const wordW = ctx.measureText(word.text).width + 6;
      const wordH = fontSize * 1.3;

      let found = false;
      // 아르키메데스 나선 탐색
      for (let t = 0; t < 2000; t++) {
        const angle = t * 0.15;
        const radius = t * 0.25;
        const x = W / 2 + radius * Math.cos(angle) - wordW / 2;
        const y = H / 2 + radius * Math.sin(angle) - wordH / 2;

        if (x < 4 || y < 4 || x + wordW > W - 4 || y + wordH > H - 4) continue;

        const collides = placed.some(p =>
          x < p.x + p.w + 3 && x + wordW + 3 > p.x &&
          y < p.y + p.h + 3 && y + wordH + 3 > p.y
        );

        if (!collides) {
          placed.push({ x, y, w: wordW, h: wordH });
          result.push({
            x, y, size: fontSize, text: word.text,
            color: colors[i % colors.length],
          });
          found = true;
          break;
        }
      }
      if (!found && result.length >= 8) break;
    }

    setPositions(result);
  }, [data, colors, size]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      {positions.map((pos) => (
        <span
          key={pos.text}
          className="absolute font-bold whitespace-nowrap"
          style={{
            left: pos.x,
            top: pos.y,
            fontSize: pos.size,
            color: pos.color,
            fontFamily: '"Noto Sans KR", sans-serif',
          }}
        >
          {pos.text}
        </span>
      ))}
    </div>
  );
}
