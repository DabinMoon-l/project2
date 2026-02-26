'use client';

import { memo, useRef, useEffect } from 'react';

// 난이도별 비디오 경로
export function getDifficultyVideo(difficulty: string): string {
  switch (difficulty) {
    case 'easy': return '/videos/difficulty-easy.mp4';
    case 'hard': return '/videos/difficulty-hard.mp4';
    default: return '/videos/difficulty-normal.mp4';
  }
}

// 자동재생 비디오 — 탭 전환 시에도 안정적으로 재생
function AutoVideoInner({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.play().catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === 'visible') el.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [src]);

  return (
    <video
      ref={ref}
      autoPlay
      loop
      muted
      playsInline
      className={className}
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}

// React.memo — src가 동일하면 리렌더 차단
const AutoVideo = memo(AutoVideoInner);
AutoVideo.displayName = 'AutoVideo';

export default AutoVideo;
