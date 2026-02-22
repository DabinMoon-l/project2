'use client';

import Image from 'next/image';
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
 * thumbnail=true: 사전 생성 128px WebP (도감 그리드, <img> 태그로 가볍게)
 * thumbnail=false: Next.js Image로 자동 WebP/AVIF 변환 + 리사이즈 + lazy loading
 */
export default function RabbitImage({ rabbitId, size, className = '', priority = false, style, thumbnail = false }: RabbitImageProps) {
  if (thumbnail) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={getRabbitThumbSrc(rabbitId)}
        alt={`토끼 #${rabbitId + 1}`}
        width={size}
        height={Math.round(size * (969 / 520))}
        className={className}
        loading="lazy"
        decoding="async"
        draggable={false}
        style={style}
      />
    );
  }

  return (
    <Image
      src={getRabbitImageSrc(rabbitId)}
      alt={`토끼 #${rabbitId + 1}`}
      width={size}
      height={Math.round(size * (969 / 520))}
      className={className}
      priority={priority}
      draggable={false}
      style={{ width: 'auto', height: 'auto', ...style }}
    />
  );
}
