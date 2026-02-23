'use client';

import { getRabbitImageSrc, getRabbitThumbSrc } from '@/lib/utils/rabbitImage';

interface RabbitImageProps {
  /** 토끼 ID (0~79) */
  rabbitId: number;
  /** 이미지 표시 크기 (px) */
  size: number;
  /** 추가 className */
  className?: string;
  /** 우선 로딩 (홈 히어로 등 LCP 요소) */
  priority?: boolean;
  /** 인라인 스타일 */
  style?: React.CSSProperties;
  /** 사전 생성 WebP 썸네일 사용 (도감 그리드용) */
  thumbnail?: boolean;
}

/**
 * 토끼 이미지 공통 컴포넌트
 *
 * thumbnail=true: 사전 생성 128px WebP (도감 그리드용)
 * thumbnail=false: 원본 PNG (상세보기용)
 * 모두 <img> 태그 사용 — Next.js Image 캐싱 문제 방지
 */
export default function RabbitImage({ rabbitId, size, className = '', priority = false, style, thumbnail = false }: RabbitImageProps) {
  const src = thumbnail ? getRabbitThumbSrc(rabbitId) : getRabbitImageSrc(rabbitId);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`토끼 #${rabbitId + 1}`}
      width={size}
      height={Math.round(size * (969 / 520))}
      className={className}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      style={style}
    />
  );
}
