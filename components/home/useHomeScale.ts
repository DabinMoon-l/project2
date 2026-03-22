import { useState, useEffect } from 'react';

/** 뷰포트 높이 기반 홈 화면 스케일 계산 */
function getHomeScale(): number {
  if (typeof window === 'undefined') return 1;
  const vh = window.innerHeight;
  if (vh >= 750) return 1;
  if (vh <= 550) return 0.75;
  return 0.75 + (vh - 550) / (750 - 550) * 0.25;
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
