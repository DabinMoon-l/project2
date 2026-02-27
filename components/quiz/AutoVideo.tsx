'use client';

import { memo, useRef, useEffect, useCallback } from 'react';

// 난이도별 비디오 경로
export function getDifficultyVideo(difficulty: string): string {
  switch (difficulty) {
    case 'easy': return '/videos/difficulty-easy.mp4';
    case 'hard': return '/videos/difficulty-hard.mp4';
    default: return '/videos/difficulty-normal.mp4';
  }
}

// 자동재생 비디오 — 에러 복구 + 탭 전환 대응
function AutoVideoInner({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const retryCountRef = useRef(0);

  const tryPlay = useCallback(() => {
    const el = ref.current;
    if (!el || document.visibilityState !== 'visible') return;
    el.play().catch(() => {});
  }, []);

  // 에러 시 소스 리로드 (캐시 에러 복구)
  const handleError = useCallback(() => {
    const el = ref.current;
    if (!el || retryCountRef.current >= 3) return;
    retryCountRef.current++;
    // 캐시 우회를 위해 쿼리 파라미터 추가
    el.src = src + '?t=' + Date.now();
    el.load();
    el.play().catch(() => {});
  }, [src]);

  useEffect(() => {
    retryCountRef.current = 0;
  }, [src]);

  useEffect(() => {
    // 탭 복귀 시 재생 복구
    const onVisible = () => {
      if (document.visibilityState === 'visible') tryPlay();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [tryPlay]);

  return (
    <video
      ref={ref}
      autoPlay
      loop
      muted
      playsInline
      className={className}
      style={{ backgroundColor: '#000' }}
      onError={handleError}
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}

// React.memo — src가 동일하면 리렌더 차단
const AutoVideo = memo(AutoVideoInner);
AutoVideo.displayName = 'AutoVideo';

export default AutoVideo;
