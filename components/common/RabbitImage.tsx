'use client';

import Image from 'next/image';
import { getRabbitImageSrc } from '@/lib/utils/rabbitImage';

interface RabbitImageProps {
  /** 토끼 ID (0~99) */
  rabbitId: number;
  /** 이미지 표시 크기 (px) */
  size: number;
  /** 추가 className */
  className?: string;
  /** 우선 로딩 (홈 히어로 등 LCP 요소) */
  priority?: boolean;
}

/**
 * 토끼 이미지 공통 컴포넌트
 *
 * Next.js Image로 자동 WebP/AVIF 변환 + 리사이즈 + lazy loading
 */
export default function RabbitImage({ rabbitId, size, className = '', priority = false }: RabbitImageProps) {
  return (
    <Image
      src={getRabbitImageSrc(rabbitId)}
      alt={`토끼 #${rabbitId + 1}`}
      width={size}
      height={Math.round(size * (969 / 520))}
      className={className}
      priority={priority}
      draggable={false}
    />
  );
}
