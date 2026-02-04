'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

// ============================================================
// 타입 정의
// ============================================================

/** 업로드된 파일 */
export interface UploadedFile {
  id: string;
  file: File;
  preview: string; // base64 또는 object URL
  type: 'image' | 'pdf';
  name: string;
}

/** 추출된 이미지 */
export interface ExtractedImage {
  id: string;
  dataUrl: string; // base64
  sourceFileName?: string;
  createdAt: Date;
}

/** Context 타입 */
interface ExtractedImagesContextType {
  /** 업로드된 파일 목록 */
  uploadedFiles: UploadedFile[];
  /** 추출된 이미지 목록 */
  extractedImages: ExtractedImage[];
  /** 파일 추가 */
  addUploadedFile: (file: File) => Promise<string>;
  /** 파일 제거 */
  removeUploadedFile: (id: string) => void;
  /** 추출 이미지 추가 */
  addExtractedImage: (dataUrl: string, sourceFileName?: string) => string;
  /** 추출 이미지 제거 */
  removeExtractedImage: (id: string) => void;
  /** 모두 초기화 */
  clearAll: () => void;
}

// ============================================================
// Context
// ============================================================

const ExtractedImagesContext = createContext<ExtractedImagesContextType | null>(null);

// ============================================================
// Provider
// ============================================================

interface ProviderProps {
  children: ReactNode;
}

export function ExtractedImagesProvider({ children }: ProviderProps) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [extractedImages, setExtractedImages] = useState<ExtractedImage[]>([]);

  /**
   * 파일을 base64로 변환
   */
  const fileToBase64 = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  /**
   * 파일 추가
   */
  const addUploadedFile = useCallback(async (file: File): Promise<string> => {
    const id = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';

    if (!isImage && !isPdf) {
      throw new Error('이미지 또는 PDF 파일만 업로드할 수 있습니다.');
    }

    let preview = '';
    if (isImage) {
      preview = await fileToBase64(file);
    } else {
      // PDF는 아이콘으로 표시
      preview = 'pdf';
    }

    const uploadedFile: UploadedFile = {
      id,
      file,
      preview,
      type: isImage ? 'image' : 'pdf',
      name: file.name,
    };

    setUploadedFiles((prev) => [...prev, uploadedFile]);
    return id;
  }, [fileToBase64]);

  /**
   * 파일 제거
   */
  const removeUploadedFile = useCallback((id: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  /**
   * 추출 이미지 추가
   */
  const addExtractedImage = useCallback((dataUrl: string, sourceFileName?: string): string => {
    const id = `extract_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const extractedImage: ExtractedImage = {
      id,
      dataUrl,
      sourceFileName,
      createdAt: new Date(),
    };

    setExtractedImages((prev) => [...prev, extractedImage]);
    return id;
  }, []);

  /**
   * 추출 이미지 제거
   */
  const removeExtractedImage = useCallback((id: string) => {
    setExtractedImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  /**
   * 모두 초기화
   */
  const clearAll = useCallback(() => {
    setUploadedFiles([]);
    setExtractedImages([]);
  }, []);

  return (
    <ExtractedImagesContext.Provider
      value={{
        uploadedFiles,
        extractedImages,
        addUploadedFile,
        removeUploadedFile,
        addExtractedImage,
        removeExtractedImage,
        clearAll,
      }}
    >
      {children}
    </ExtractedImagesContext.Provider>
  );
}

// ============================================================
// Hook
// ============================================================

export function useExtractedImages() {
  const context = useContext(ExtractedImagesContext);
  if (!context) {
    throw new Error('useExtractedImages must be used within ExtractedImagesProvider');
  }
  return context;
}
