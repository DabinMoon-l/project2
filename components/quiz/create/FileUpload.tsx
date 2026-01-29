'use client';

/**
 * FileUpload 컴포넌트
 *
 * 드래그앤드롭 + 파일 선택 기능을 제공하는 파일 업로드 컴포넌트입니다.
 * ImageUploader의 래퍼 컴포넌트로, 동일한 기능을 제공합니다.
 */

import ImageUploader from './ImageUploader';

// ImageUploader를 FileUpload로 re-export
export default ImageUploader;

// 타입도 함께 export
export type { default as FileUploadProps } from './ImageUploader';
