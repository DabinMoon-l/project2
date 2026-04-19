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

  // 외부 원인(iOS Safari 메인 스레드 혼잡, 다른 canvas 작업 등)으로 일시 정지되면
  // 다시 자동 재생 시도. muted autoplay 영상이라 사용자 의도 pause 케이스 없음.
  const handlePause = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // 다음 프레임에서 재시도 — 즉시 play() 호출이 같은 이벤트 루프에서 다시 pause될 수 있음
    requestAnimationFrame(() => el.play().catch(() => {}));
  }, []);

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
      onPause={handlePause}
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}

// React.memo — src가 동일하면 리렌더 차단
const AutoVideo = memo(AutoVideoInner);
AutoVideo.displayName = 'AutoVideo';

export default AutoVideo;
