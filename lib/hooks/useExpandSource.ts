'use client';

import { useRef, useState, useCallback } from 'react';

// 소스 요소의 위치/크기 정보
export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 카드 → 모달 확장 애니메이션을 위한 소스 rect 캡처 훅
 *
 * @example
 * ```tsx
 * const { sourceRect, registerRef, captureRect, clearRect } = useExpandSource();
 *
 * // 카드에 ref 연결
 * <div ref={(el) => registerRef(quiz.id, el)}>...</div>
 *
 * // 카드 클릭 시
 * const handleClick = (quiz) => {
 *   captureRect(quiz.id);
 *   setSelectedQuiz(quiz);
 * };
 *
 * // 모달에 전달
 * <ExpandModal sourceRect={sourceRect} onClose={() => { setSelectedQuiz(null); clearRect(); }}>
 * ```
 */
export function useExpandSource() {
  const refsMap = useRef<Map<string, HTMLElement>>(new Map());
  const [sourceRect, setSourceRect] = useState<SourceRect | null>(null);

  // 카드에 ref 연결: ref={(el) => registerRef(id, el)}
  const registerRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      refsMap.current.set(id, el);
    } else {
      refsMap.current.delete(id);
    }
  }, []);

  // 카드 클릭 시 호출: captureRect(id) → sourceRect 상태 업데이트
  const captureRect = useCallback((id: string) => {
    const el = refsMap.current.get(id);
    if (el) {
      const rect = el.getBoundingClientRect();
      setSourceRect({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    } else {
      setSourceRect(null);
    }
  }, []);

  // 모달 닫힐 때 호출
  const clearRect = useCallback(() => setSourceRect(null), []);

  return { sourceRect, registerRef, captureRect, clearRect };
}
