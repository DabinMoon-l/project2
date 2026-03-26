import { useState, useEffect } from 'react';

/** 뷰포트 높이 기반 홈 화면 스케일 계산 (축소+확대) */
function getHomeScale(): number {
  if (typeof window === 'undefined') return 1;
  const vh = window.innerHeight;
  // 기준: 700px → 1.0, 작은 화면은 축소, 큰 화면은 확대
  const scale = vh / 700;
  return Math.max(0.65, Math.min(scale, 1.5));
}

/**
 * 뷰포트 높이 기반 홈 화면 스케일 훅
 * resize 시 자동 갱신
 */
export function useHomeScale(): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const update = () => setScale(getHomeScale());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return scale;
}
