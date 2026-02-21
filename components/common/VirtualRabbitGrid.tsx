'use client';

import { useRef, useState, useEffect, useCallback, type ReactNode, type CSSProperties, type ReactElement } from 'react';
import { List, type RowComponentProps } from 'react-window';

const TOTAL = 80;
const COLS = 4;
const ROWS = Math.ceil(TOTAL / COLS);
const GAP = 8; // gap-2

interface VirtualRabbitGridProps {
  /** 각 셀 렌더링 콜백 (index 0~79) */
  renderCell: (index: number) => ReactNode;
}

/**
 * 가상화된 4열 토끼 그리드 — react-window List (v2)
 * 보이는 행 + overscan만 렌더링하여 80개 동시 마운트 방지
 */
export default function VirtualRabbitGrid({ renderCell }: VirtualRabbitGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const cellW = containerWidth > 0 ? (containerWidth - GAP * (COLS - 1)) / COLS : 0;
  const rowH = cellW + GAP;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const RowComponent = useCallback((props: RowComponentProps<any>): ReactElement => {
    const { index: rowIndex, style } = props;
    return (
      <div style={style}>
        <div className="flex gap-2">
          {Array.from({ length: COLS }).map((_, col) => {
            const idx = rowIndex * COLS + col;
            if (idx >= TOTAL) return <div key={col} className="flex-1" />;
            return <div key={col} className="flex-1">{renderCell(idx)}</div>;
          })}
        </div>
      </div>
    );
  }, [renderCell]);

  return (
    <div ref={containerRef} className="w-full h-full">
      {containerWidth > 0 && rowH > 0 && (
        <List
          rowComponent={RowComponent}
          rowCount={ROWS}
          rowHeight={rowH}
          rowProps={{}}
          overscanCount={3}
          style={{ height: '100%', width: '100%' }}
        />
      )}
    </div>
  );
}
