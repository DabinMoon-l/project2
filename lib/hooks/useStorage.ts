/**
 * Firebase Storage 파일 업로드 훅
 *
 * 이미지와 파일을 Firebase Storage에 업로드하고 URL을 반환합니다.
 * iOS와 Android 모두 지원합니다.
 */

'use client';

import { useState, useCallback } from 'react';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { storage } from '../firebase';
import { useAuth } from './useAuth';

/** 파일 정보 타입 */
export interface FileInfo {
  name: string;
  url: string;
  type: string;
  size: number;
}

/** useUpload 훅 반환 타입 */
interface UseUploadReturn {
  uploadImage: (file: File) => Promise<string | null>;
  uploadFile: (file: File) => Promise<FileInfo | null>;
  uploadMultipleImages: (files: File[]) => Promise<string[]>;
  uploadMultipleFiles: (files: File[]) => Promise<FileInfo[]>;
  deleteFile: (url: string) => Promise<boolean>;
  loading: boolean;
  progress: number;
  error: string | null;
}

/** 허용된 이미지 타입 */
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** 허용된 파일 타입 */
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'application/zip',
];

/** 확장자 기반 폴백 허용 목록 (브라우저가 MIME을 octet-stream으로 보고하는 경우 대비) */
const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip'];

/** 최대 파일 크기 (500MB) */
const MAX_FILE_SIZE = 500 * 1024 * 1024;

/** 최대 이미지 크기 (50MB) */
const MAX_IMAGE_SIZE = 50 * 1024 * 1024;

/**
 * 파일 업로드 훅
 */
export const useUpload = (): UseUploadReturn => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /**
   * 이미지 업로드
   */
  const uploadImage = useCallback(
    async (file: File): Promise<string | null> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return null;
      }

      // 이미지 타입 검증
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        setError('지원하지 않는 이미지 형식입니다. (JPG, PNG, GIF, WEBP만 가능)');
        return null;
      }

      // 파일 크기 검증
      if (file.size > MAX_IMAGE_SIZE) {
        setError('이미지 크기는 5MB 이하만 가능합니다.');
        return null;
      }

      try {
        setLoading(true);
        setError(null);
        setProgress(0);

        // 고유한 파일 경로 생성
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 8);
        const extension = file.name.split('.').pop() || 'jpg';
        const filePath = `posts/${user.uid}/${timestamp}_${randomStr}.${extension}`;

        const storageRef = ref(storage, filePath);

        // 업로드
        await uploadBytes(storageRef, file);
        setProgress(100);

        // URL 가져오기
        const downloadUrl = await getDownloadURL(storageRef);
        return downloadUrl;
      } catch (err) {
        console.error('이미지 업로드 실패:', err);
        setError('이미지 업로드에 실패했습니다.');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  /**
   * 파일 업로드
   */
  const uploadFile = useCallback(
    async (file: File): Promise<FileInfo | null> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return null;
      }

      // 파일 타입 검증 (이미지도 허용)
      let isAllowedType = [...ALLOWED_FILE_TYPES, ...ALLOWED_IMAGE_TYPES].includes(file.type);
      // MIME 타입 매치 안 되면 확장자로 재검증 (일부 브라우저/OS에서 PPT 등이 octet-stream으로 보고됨)
      if (!isAllowedType) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext && ALLOWED_EXTENSIONS.includes(ext)) {
          isAllowedType = true;
        }
      }
      if (!isAllowedType) {
        setError('지원하지 않는 파일 형식입니다.');
        return null;
      }

      // 파일 크기 검증
      if (file.size > MAX_FILE_SIZE) {
        setError('파일 크기는 10MB 이하만 가능합니다.');
        return null;
      }

      try {
        setLoading(true);
        setError(null);
        setProgress(0);

        // 고유한 파일 경로 생성
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 8);
        const safeName = file.name.replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
        const filePath = `files/${user.uid}/${timestamp}_${randomStr}_${safeName}`;

        const storageRef = ref(storage, filePath);

        // 업로드
        await uploadBytes(storageRef, file);
        setProgress(100);

        // URL 가져오기
        const downloadUrl = await getDownloadURL(storageRef);

        return {
          name: file.name,
          url: downloadUrl,
          type: file.type,
          size: file.size,
        };
      } catch (err) {
        console.error('파일 업로드 실패:', err);
        setError('파일 업로드에 실패했습니다.');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  /**
   * 여러 이미지 병렬 업로드
   */
  const uploadMultipleImages = useCallback(
    async (files: File[]): Promise<string[]> => {
      const results = await Promise.all(files.map((f) => uploadImage(f)));
      return results.filter((url): url is string => url !== null);
    },
    [uploadImage]
  );

  /**
   * 여러 파일 병렬 업로드
   */
  const uploadMultipleFiles = useCallback(
    async (files: File[]): Promise<FileInfo[]> => {
      const results = await Promise.all(files.map((f) => uploadFile(f)));
      return results.filter((info): info is FileInfo => info !== null);
    },
    [uploadFile]
  );

  /**
   * 파일 삭제
   */
  const deleteFile = useCallback(
    async (url: string): Promise<boolean> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return false;
      }

      try {
        // URL에서 storage 경로 추출
        const storageRef = ref(storage, url);
        await deleteObject(storageRef);
        return true;
      } catch (err) {
        console.error('파일 삭제 실패:', err);
        // 파일이 이미 없는 경우는 성공으로 처리
        return true;
      }
    },
    [user]
  );

  return {
    uploadImage,
    uploadFile,
    uploadMultipleImages,
    uploadMultipleFiles,
    deleteFile,
    loading,
    progress,
    error,
  };
};

export default useUpload;
