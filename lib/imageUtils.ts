/**
 * 이미지 압축 및 리사이즈 유틸리티
 *
 * 클라이언트 측에서 이미지를 압축하여 업로드 속도와 저장 비용을 최적화합니다.
 */

export interface ImageCompressionOptions {
  /** 최대 너비 (px) - 기본값: 1920 */
  maxWidth?: number;
  /** 최대 높이 (px) - 기본값: 1080 */
  maxHeight?: number;
  /** JPEG 품질 (0-1) - 기본값: 0.8 */
  quality?: number;
  /** 최대 파일 크기 (bytes) - 기본값: 1MB */
  maxSizeBytes?: number;
  /** 출력 형식 - 기본값: 'image/jpeg' */
  outputType?: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface CompressionResult {
  /** 압축된 Blob */
  blob: Blob;
  /** 압축된 이미지의 Data URL */
  dataUrl: string;
  /** 원본 파일 크기 (bytes) */
  originalSize: number;
  /** 압축 후 파일 크기 (bytes) */
  compressedSize: number;
  /** 압축률 (%) */
  compressionRatio: number;
  /** 최종 너비 */
  width: number;
  /** 최종 높이 */
  height: number;
}

/**
 * 파일에서 이미지 로드
 */
function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 로드할 수 없습니다.'));

    if (file instanceof File) {
      img.src = URL.createObjectURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
      reader.readAsDataURL(file);
    }
  });
}

/**
 * Canvas를 Blob으로 변환
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('이미지 변환에 실패했습니다.'));
        }
      },
      type,
      quality
    );
  });
}

/**
 * 이미지 압축 및 리사이즈
 *
 * @param file - 압축할 이미지 파일
 * @param options - 압축 옵션
 * @returns 압축 결과
 *
 * @example
 * ```ts
 * const result = await compressImage(file, {
 *   maxWidth: 1920,
 *   maxHeight: 1080,
 *   quality: 0.8,
 *   maxSizeBytes: 1024 * 1024 // 1MB
 * });
 * console.log(`압축률: ${result.compressionRatio}%`);
 * ```
 */
export async function compressImage(
  file: File | Blob,
  options: ImageCompressionOptions = {}
): Promise<CompressionResult> {
  const {
    maxWidth = 1920,
    maxHeight = 1080,
    quality = 0.8,
    maxSizeBytes = 1024 * 1024, // 1MB
    outputType = 'image/jpeg',
  } = options;

  const originalSize = file.size;

  // 이미지 로드
  const img = await loadImage(file);
  const originalWidth = img.width;
  const originalHeight = img.height;

  // 리사이즈 비율 계산
  let width = originalWidth;
  let height = originalHeight;

  if (width > maxWidth || height > maxHeight) {
    const widthRatio = maxWidth / width;
    const heightRatio = maxHeight / height;
    const ratio = Math.min(widthRatio, heightRatio);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  // Canvas에 이미지 그리기
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context를 생성할 수 없습니다.');
  }

  // 배경을 흰색으로 채우기 (투명 PNG -> JPEG 변환 시 필요)
  if (outputType === 'image/jpeg') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
  }

  ctx.drawImage(img, 0, 0, width, height);

  // 첫 번째 압축 시도
  let currentQuality = quality;
  let blob = await canvasToBlob(canvas, outputType, currentQuality);

  // 파일 크기가 목표보다 크면 품질을 낮춰서 재압축
  let attempts = 0;
  const maxAttempts = 5;

  while (blob.size > maxSizeBytes && attempts < maxAttempts) {
    attempts++;
    currentQuality *= 0.7; // 품질 30% 감소

    // 품질이 너무 낮아지면 크기도 줄임
    if (currentQuality < 0.3 && width > 800) {
      width = Math.round(width * 0.8);
      height = Math.round(height * 0.8);
      canvas.width = width;
      canvas.height = height;

      if (outputType === 'image/jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(img, 0, 0, width, height);
      currentQuality = 0.6; // 크기 줄인 후 품질 복원
    }

    blob = await canvasToBlob(canvas, outputType, Math.max(currentQuality, 0.1));
    console.log(`[이미지 압축] 시도 ${attempts}: ${(blob.size / 1024).toFixed(1)}KB (품질: ${(currentQuality * 100).toFixed(0)}%)`);
  }

  // Data URL 생성
  const dataUrl = canvas.toDataURL(outputType, currentQuality);

  // 메모리 정리
  URL.revokeObjectURL(img.src);

  const compressionRatio = Math.round((1 - blob.size / originalSize) * 100);

  console.log(`[이미지 압축 완료]`, {
    원본크기: `${(originalSize / 1024).toFixed(1)}KB`,
    압축크기: `${(blob.size / 1024).toFixed(1)}KB`,
    압축률: `${compressionRatio}%`,
    해상도: `${width}x${height}`,
  });

  return {
    blob,
    dataUrl,
    originalSize,
    compressedSize: blob.size,
    compressionRatio,
    width,
    height,
  };
}

/**
 * 이미지 파일인지 확인
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * 파일 크기를 읽기 쉬운 형식으로 변환
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 퀴즈 문제 이미지 압축 (기본 설정)
 *
 * 퀴즈 문제에 최적화된 설정으로 이미지를 압축합니다.
 * - 최대 해상도: 1920x1080
 * - 최대 파일 크기: 500KB
 * - JPEG 품질: 85%
 */
export async function compressQuizImage(file: File | Blob): Promise<CompressionResult> {
  return compressImage(file, {
    maxWidth: 1920,
    maxHeight: 1080,
    quality: 0.85,
    maxSizeBytes: 500 * 1024, // 500KB
    outputType: 'image/jpeg',
  });
}
