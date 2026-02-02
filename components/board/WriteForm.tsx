'use client';

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useTheme } from '@/styles/themes/useTheme';
import { useUpload, type FileInfo } from '@/lib/hooks/useStorage';
import type { CreatePostData, AttachedFile } from '@/lib/hooks/useBoard';

interface WriteFormProps {
  /** 제출 핸들러 */
  onSubmit: (data: CreatePostData) => Promise<void>;
  /** 제출 중 여부 */
  isSubmitting?: boolean;
  /** 에러 메시지 */
  error?: string | null;
  /** 교수님께 체크박스 표시 여부 */
  showToProfessorOption?: boolean;
}

/**
 * 글 작성 폼 컴포넌트 - 이미지/파일 첨부 지원
 */
export default function WriteForm({
  onSubmit,
  isSubmitting = false,
  error,
  showToProfessorOption = true,
}: WriteFormProps) {
  const { theme } = useTheme();
  const { uploadImage, uploadFile, loading: uploading, error: uploadError } = useUpload();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [toProfessor, setToProfessor] = useState(false);

  // 첨부 파일 상태
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const [files, setFiles] = useState<{ file: File; name: string }[]>([]);

  // 파일 input refs
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 유효성 검사
  const isValid = title.trim().length >= 2 && content.trim().length >= 10;

  /**
   * 이미지 선택 핸들러
   */
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    const newImages: { file: File; preview: string }[] = [];

    Array.from(selectedFiles).forEach((file) => {
      // 최대 5장까지
      if (images.length + newImages.length >= 5) return;

      // 이미지 타입 확인
      if (!file.type.startsWith('image/')) return;

      // 미리보기 URL 생성
      const preview = URL.createObjectURL(file);
      newImages.push({ file, preview });
    });

    setImages((prev) => [...prev, ...newImages]);

    // input 초기화
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  }, [images.length]);

  /**
   * 파일 선택 핸들러
   */
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    const newFiles: { file: File; name: string }[] = [];

    Array.from(selectedFiles).forEach((file) => {
      // 최대 3개까지
      if (files.length + newFiles.length >= 3) return;

      newFiles.push({ file, name: file.name });
    });

    setFiles((prev) => [...prev, ...newFiles]);

    // input 초기화
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [files.length]);

  /**
   * 이미지 제거
   */
  const removeImage = useCallback((index: number) => {
    setImages((prev) => {
      const newImages = [...prev];
      // 미리보기 URL 해제
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
  }, []);

  /**
   * 파일 제거
   */
  const removeFile = useCallback((index: number) => {
    setFiles((prev) => {
      const newFiles = [...prev];
      newFiles.splice(index, 1);
      return newFiles;
    });
  }, []);

  /**
   * 파일 크기 포맷
   */
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /**
   * 폼 제출
   */
  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting || uploading) return;

    try {
      // 이미지 업로드
      const uploadedImageUrls: string[] = [];
      for (const img of images) {
        const url = await uploadImage(img.file);
        if (url) {
          uploadedImageUrls.push(url);
        }
      }

      // 파일 업로드
      const uploadedFiles: AttachedFile[] = [];
      for (const f of files) {
        const fileInfo = await uploadFile(f.file);
        if (fileInfo) {
          uploadedFiles.push(fileInfo);
        }
      }

      await onSubmit({
        title: title.trim(),
        content: content.trim(),
        isAnonymous: false,
        category: 'community',
        imageUrl: uploadedImageUrls[0] || undefined, // 대표 이미지
        imageUrls: uploadedImageUrls,
        fileUrls: uploadedFiles,
        toProfessor,
      });
    } catch (err) {
      console.error('글 작성 실패:', err);
    }
  }, [isValid, isSubmitting, uploading, images, files, title, content, uploadImage, uploadFile, onSubmit]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4"
      style={{
        border: '1px solid #1A1A1A',
        backgroundColor: theme.colors.backgroundCard,
      }}
    >
      {/* 제목 입력 */}
      <div className="mb-4">
        <label
          className="block text-sm font-bold mb-2"
          style={{ color: theme.colors.text }}
        >
          HEADLINE <span style={{ color: '#8B1A1A' }}>*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="기사 제목을 입력하세요 (2자 이상)"
          maxLength={100}
          className="w-full px-4 py-3 outline-none transition-colors text-lg"
          style={{
            border: '1px solid #1A1A1A',
            backgroundColor: theme.colors.background,
            color: theme.colors.text,
          }}
        />
        <div
          className="mt-1 text-xs text-right"
          style={{ color: theme.colors.textSecondary }}
        >
          {title.length}/100
        </div>
      </div>

      {/* 내용 입력 */}
      <div className="mb-4">
        <label
          className="block text-sm font-bold mb-2"
          style={{ color: theme.colors.text }}
        >
          ARTICLE BODY <span style={{ color: '#8B1A1A' }}>*</span>
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="기사 내용을 입력하세요 (10자 이상)"
          rows={8}
          maxLength={2000}
          className="w-full px-4 py-3 resize-none outline-none transition-colors leading-relaxed"
          style={{
            border: '1px solid #1A1A1A',
            backgroundColor: theme.colors.background,
            color: theme.colors.text,
          }}
        />
        <div
          className="mt-1 text-xs text-right"
          style={{ color: theme.colors.textSecondary }}
        >
          {content.length}/2000
        </div>
      </div>

      {/* 교수님께 체크박스 */}
      {showToProfessorOption && (
        <div className="mb-4">
          <label
            className="flex items-center gap-3 cursor-pointer py-3 px-4"
            style={{
              border: toProfessor ? '2px solid #1A6B1A' : '1px solid #D4CFC4',
              backgroundColor: toProfessor ? '#E8F5E8' : 'transparent',
            }}
          >
            <input
              type="checkbox"
              checked={toProfessor}
              onChange={(e) => setToProfessor(e.target.checked)}
              className="w-5 h-5 accent-[#1A6B1A]"
            />
            <div>
              <span
                className="font-bold text-sm"
                style={{ color: toProfessor ? '#1A6B1A' : theme.colors.text }}
              >
                📬 교수님께 전달
              </span>
              <p
                className="text-xs mt-0.5"
                style={{ color: theme.colors.textSecondary }}
              >
                체크하면 교수님께 알림이 전송되고, 교수님 관리 목록에 표시됩니다
              </p>
            </div>
          </label>
        </div>
      )}

      {/* 이미지 첨부 */}
      <div className="mb-4">
        <label
          className="block text-sm font-bold mb-2"
          style={{ color: theme.colors.text }}
        >
          PHOTOS
          <span className="font-normal text-xs ml-2" style={{ color: theme.colors.textSecondary }}>
            (최대 5장)
          </span>
        </label>

        {/* 이미지 미리보기 */}
        <AnimatePresence>
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {images.map((img, index) => (
                <motion.div
                  key={img.preview}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="relative w-20 h-20"
                >
                  <Image
                    src={img.preview}
                    alt={`첨부 이미지 ${index + 1}`}
                    fill
                    sizes="80px"
                    className="object-cover"
                    style={{ border: '1px solid #1A1A1A' }}
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center text-xs"
                    style={{
                      backgroundColor: '#8B1A1A',
                      color: '#F5F0E8',
                    }}
                  >
                    ×
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </AnimatePresence>

        {/* 이미지 추가 버튼 */}
        {images.length < 5 && (
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 text-sm transition-colors"
            style={{
              border: '1px dashed #1A1A1A',
              backgroundColor: 'transparent',
              color: theme.colors.text,
            }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            사진 첨부
          </button>
        )}

        {/* 숨겨진 이미지 input */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          onChange={handleImageSelect}
          className="hidden"
        />
      </div>

      {/* 파일 첨부 */}
      <div className="mb-4">
        <label
          className="block text-sm font-bold mb-2"
          style={{ color: theme.colors.text }}
        >
          FILES
          <span className="font-normal text-xs ml-2" style={{ color: theme.colors.textSecondary }}>
            (최대 3개, 10MB 이하)
          </span>
        </label>

        {/* 파일 목록 */}
        <AnimatePresence>
          {files.length > 0 && (
            <div className="space-y-2 mb-3">
              {files.map((f, index) => (
                <motion.div
                  key={`${f.name}-${index}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="flex items-center justify-between px-3 py-2"
                  style={{
                    border: '1px solid #D4CFC4',
                    backgroundColor: theme.colors.background,
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    <span className="text-sm truncate" style={{ color: theme.colors.text }}>
                      {f.name}
                    </span>
                    <span className="text-xs flex-shrink-0" style={{ color: theme.colors.textSecondary }}>
                      ({formatFileSize(f.file.size)})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="text-sm px-2"
                    style={{ color: '#8B1A1A' }}
                  >
                    삭제
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </AnimatePresence>

        {/* 파일 추가 버튼 */}
        {files.length < 3 && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 text-sm transition-colors"
            style={{
              border: '1px dashed #1A1A1A',
              backgroundColor: 'transparent',
              color: theme.colors.text,
            }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            파일 첨부
          </button>
        )}

        {/* 숨겨진 파일 input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* 상태 안내 */}
      <div
        className="flex items-center justify-end py-3 border-t border-b mb-4"
        style={{ borderColor: '#D4CFC4' }}
      >
        <span
          className="text-xs italic"
          style={{ color: theme.colors.textSecondary }}
        >
          {uploading && 'Uploading...'}
          {!uploading && !title.trim() && '제목을 입력해주세요'}
          {!uploading && title.trim() && title.trim().length < 2 && '제목은 2자 이상'}
          {!uploading && title.trim().length >= 2 && content.trim().length < 10 && '내용은 10자 이상'}
          {!uploading && isValid && 'Ready to publish!'}
        </span>
      </div>

      {/* 에러 메시지 */}
      {(error || uploadError) && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 mb-4 text-sm text-center"
          style={{
            border: '1px solid #8B1A1A',
            backgroundColor: '#FEE2E2',
            color: '#8B1A1A',
          }}
        >
          {error || uploadError}
        </motion.div>
      )}

      {/* 작성 버튼 */}
      <motion.button
        type="button"
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={handleSubmit}
        disabled={!isValid || isSubmitting || uploading}
        className="w-full py-3 font-serif-display font-bold text-center transition-colors disabled:opacity-50"
        style={{
          backgroundColor: '#1A1A1A',
          color: '#F5F0E8',
        }}
      >
        {uploading ? 'Uploading...' : isSubmitting ? 'Publishing...' : 'PUBLISH ARTICLE'}
      </motion.button>
    </motion.div>
  );
}
