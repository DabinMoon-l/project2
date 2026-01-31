'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useTheme } from '@/styles/themes/useTheme';
import { usePost, useUpdatePost, type CreatePostData, type AttachedFile } from '@/lib/hooks/useBoard';
import { useUpload } from '@/lib/hooks/useStorage';
import { useAuth } from '@/lib/hooks/useAuth';
import { Skeleton } from '@/components/common';

/**
 * 글 수정 페이지
 */
export default function EditPostPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params.id as string;
  const { theme } = useTheme();

  const { user } = useAuth();
  const { post, loading: postLoading } = usePost(postId);
  const { updatePost, loading: updating, error: updateError } = useUpdatePost();
  const { uploadImage, uploadFile, loading: uploading, error: uploadError } = useUpload();

  // 폼 상태
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 기존 이미지/파일
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [existingFiles, setExistingFiles] = useState<AttachedFile[]>([]);

  // 새로 추가할 이미지/파일
  const [newImages, setNewImages] = useState<{ file: File; preview: string }[]>([]);
  const [newFiles, setNewFiles] = useState<{ file: File; name: string }[]>([]);

  // 파일 input refs
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 글 데이터 로드 시 폼 초기화
  useEffect(() => {
    if (post && !initialized) {
      setTitle(post.title);
      setContent(post.content);
      setIsAnonymous(post.isAnonymous);
      setExistingImages(post.imageUrls || (post.imageUrl ? [post.imageUrl] : []));
      setExistingFiles(post.fileUrls || []);
      setInitialized(true);
    }
  }, [post, initialized]);

  // 권한 체크
  const isOwner = user?.uid === post?.authorId;

  // 유효성 검사
  const isValid = title.trim().length >= 2 && content.trim().length >= 10;

  // 총 이미지 수
  const totalImages = existingImages.length + newImages.length;
  const totalFiles = existingFiles.length + newFiles.length;

  /**
   * 이미지 선택 핸들러
   */
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    const newImgs: { file: File; preview: string }[] = [];

    Array.from(selectedFiles).forEach((file) => {
      if (totalImages + newImgs.length >= 5) return;
      if (!file.type.startsWith('image/')) return;

      const preview = URL.createObjectURL(file);
      newImgs.push({ file, preview });
    });

    setNewImages((prev) => [...prev, ...newImgs]);

    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  }, [totalImages]);

  /**
   * 파일 선택 핸들러
   */
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    const newF: { file: File; name: string }[] = [];

    Array.from(selectedFiles).forEach((file) => {
      if (totalFiles + newF.length >= 3) return;
      newF.push({ file, name: file.name });
    });

    setNewFiles((prev) => [...prev, ...newF]);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [totalFiles]);

  /**
   * 기존 이미지 제거
   */
  const removeExistingImage = useCallback((index: number) => {
    setExistingImages((prev) => {
      const newArr = [...prev];
      newArr.splice(index, 1);
      return newArr;
    });
  }, []);

  /**
   * 새 이미지 제거
   */
  const removeNewImage = useCallback((index: number) => {
    setNewImages((prev) => {
      const newArr = [...prev];
      URL.revokeObjectURL(newArr[index].preview);
      newArr.splice(index, 1);
      return newArr;
    });
  }, []);

  /**
   * 기존 파일 제거
   */
  const removeExistingFile = useCallback((index: number) => {
    setExistingFiles((prev) => {
      const newArr = [...prev];
      newArr.splice(index, 1);
      return newArr;
    });
  }, []);

  /**
   * 새 파일 제거
   */
  const removeNewFile = useCallback((index: number) => {
    setNewFiles((prev) => {
      const newArr = [...prev];
      newArr.splice(index, 1);
      return newArr;
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
    if (!isValid || updating || uploading) return;

    try {
      // 새 이미지 업로드
      const uploadedImageUrls: string[] = [...existingImages];
      for (const img of newImages) {
        const url = await uploadImage(img.file);
        if (url) {
          uploadedImageUrls.push(url);
        }
      }

      // 새 파일 업로드
      const uploadedFiles: AttachedFile[] = [...existingFiles];
      for (const f of newFiles) {
        const fileInfo = await uploadFile(f.file);
        if (fileInfo) {
          uploadedFiles.push(fileInfo);
        }
      }

      // 업데이트할 데이터 준비 (undefined 대신 null 사용)
      const updateData: Record<string, unknown> = {
        title: title.trim(),
        content: content.trim(),
        isAnonymous,
        imageUrls: uploadedImageUrls.length > 0 ? uploadedImageUrls : [],
        fileUrls: uploadedFiles.length > 0 ? uploadedFiles : [],
      };

      // imageUrl은 첫 번째 이미지 또는 null
      if (uploadedImageUrls.length > 0) {
        updateData.imageUrl = uploadedImageUrls[0];
      } else {
        updateData.imageUrl = null;
      }

      const success = await updatePost(postId, updateData as Partial<CreatePostData>);

      if (success) {
        router.replace(`/board/${postId}`);
      }
    } catch (err) {
      console.error('글 수정 실패:', err);
    }
  }, [isValid, updating, uploading, existingImages, existingFiles, newImages, newFiles, title, content, isAnonymous, uploadImage, uploadFile, updatePost, postId, router]);

  /**
   * 뒤로가기
   */
  const handleBack = useCallback(() => {
    if (window.confirm('수정 중인 내용이 사라집니다. 나가시겠습니까?')) {
      router.back();
    }
  }, [router]);

  // 로딩 상태
  if (postLoading) {
    return (
      <div
        className="min-h-screen pb-28"
        style={{ backgroundColor: theme.colors.background }}
      >
        <header className="border-b-4 border-double border-[#1A1A1A] mx-4 mt-4 pb-4">
          <div className="text-center py-4">
            <h1 className="font-serif-display text-3xl font-black tracking-tight text-[#1A1A1A]">
              THE Q&A TIMES
            </h1>
          </div>
        </header>
        <div className="px-4 pt-6 space-y-4">
          <Skeleton className="w-full h-12 rounded-none" />
          <Skeleton className="w-full h-48 rounded-none" />
        </div>
      </div>
    );
  }

  // 권한 없음
  if (!isOwner) {
    return (
      <div
        className="min-h-screen pb-28 flex items-center justify-center"
        style={{ backgroundColor: theme.colors.background }}
      >
        <div className="text-center">
          <p className="text-lg font-serif-display mb-4" style={{ color: theme.colors.text }}>
            수정 권한이 없습니다.
          </p>
          <button
            onClick={() => router.back()}
            className="px-6 py-2 font-serif-display"
            style={{ border: '1px solid #1A1A1A' }}
          >
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen pb-28"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* 신문 헤더 */}
      <header className="border-b-4 border-double border-[#1A1A1A] mx-4 mt-4 pb-4">
        {/* 뒤로가기 */}
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-sm py-2 mb-4"
          style={{ color: theme.colors.textSecondary }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="font-serif-display">Cancel Edit</span>
        </button>

        {/* 신문 제목 */}
        <div className="text-center">
          <h1 className="font-serif-display text-3xl font-black tracking-tight text-[#1A1A1A]">
            THE Q&A TIMES
          </h1>
          <p className="text-sm text-[#3A3A3A] mt-1 font-serif-elegant italic">
            "Edit Your Story"
          </p>
        </div>
      </header>

      {/* 페이지 제목 */}
      <div className="px-4 pt-6 pb-4">
        <div className="flex items-center justify-center gap-4">
          <div className="flex-1 h-px bg-[#1A1A1A]" />
          <h2 className="font-serif-display text-xl font-bold text-[#1A1A1A]">
            EDIT ARTICLE
          </h2>
          <div className="flex-1 h-px bg-[#1A1A1A]" />
        </div>
      </div>

      {/* 메인 폼 */}
      <main className="px-4">
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
              className="block text-sm font-serif-display font-bold mb-2"
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
              className="w-full px-4 py-3 outline-none transition-colors font-serif-display text-lg"
              style={{
                border: '1px solid #1A1A1A',
                backgroundColor: theme.colors.background,
                color: theme.colors.text,
              }}
            />
            <div
              className="mt-1 text-xs text-right font-serif-elegant"
              style={{ color: theme.colors.textSecondary }}
            >
              {title.length}/100
            </div>
          </div>

          {/* 내용 입력 */}
          <div className="mb-4">
            <label
              className="block text-sm font-serif-display font-bold mb-2"
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
              className="mt-1 text-xs text-right font-serif-elegant"
              style={{ color: theme.colors.textSecondary }}
            >
              {content.length}/2000
            </div>
          </div>

          {/* 이미지 첨부 */}
          <div className="mb-4">
            <label
              className="block text-sm font-serif-display font-bold mb-2"
              style={{ color: theme.colors.text }}
            >
              PHOTOS
              <span className="font-normal text-xs ml-2" style={{ color: theme.colors.textSecondary }}>
                (최대 5장)
              </span>
            </label>

            {/* 이미지 미리보기 */}
            <AnimatePresence>
              {(existingImages.length > 0 || newImages.length > 0) && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {/* 기존 이미지 */}
                  {existingImages.map((url, index) => (
                    <motion.div
                      key={`existing-${url}`}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className="relative w-20 h-20"
                    >
                      <Image
                        src={url}
                        alt={`기존 이미지 ${index + 1}`}
                        fill
                        sizes="80px"
                        className="object-cover"
                        style={{ border: '1px solid #1A1A1A' }}
                      />
                      <button
                        type="button"
                        onClick={() => removeExistingImage(index)}
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
                  {/* 새 이미지 */}
                  {newImages.map((img, index) => (
                    <motion.div
                      key={img.preview}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className="relative w-20 h-20"
                    >
                      <Image
                        src={img.preview}
                        alt={`새 이미지 ${index + 1}`}
                        fill
                        sizes="80px"
                        className="object-cover"
                        style={{ border: '1px solid #1A1A1A' }}
                      />
                      <button
                        type="button"
                        onClick={() => removeNewImage(index)}
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
            {totalImages < 5 && (
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-serif-display transition-colors"
                style={{
                  border: '1px dashed #1A1A1A',
                  backgroundColor: 'transparent',
                  color: theme.colors.text,
                }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                사진 추가
              </button>
            )}

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
              className="block text-sm font-serif-display font-bold mb-2"
              style={{ color: theme.colors.text }}
            >
              FILES
              <span className="font-normal text-xs ml-2" style={{ color: theme.colors.textSecondary }}>
                (최대 3개, 10MB 이하)
              </span>
            </label>

            {/* 파일 목록 */}
            <AnimatePresence>
              {(existingFiles.length > 0 || newFiles.length > 0) && (
                <div className="space-y-2 mb-3">
                  {/* 기존 파일 */}
                  {existingFiles.map((f, index) => (
                    <motion.div
                      key={`existing-${f.url}`}
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
                      </div>
                      <button
                        type="button"
                        onClick={() => removeExistingFile(index)}
                        className="text-sm px-2"
                        style={{ color: '#8B1A1A' }}
                      >
                        삭제
                      </button>
                    </motion.div>
                  ))}
                  {/* 새 파일 */}
                  {newFiles.map((f, index) => (
                    <motion.div
                      key={`new-${f.name}-${index}`}
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
                        onClick={() => removeNewFile(index)}
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
            {totalFiles < 3 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-serif-display transition-colors"
                style={{
                  border: '1px dashed #1A1A1A',
                  backgroundColor: 'transparent',
                  color: theme.colors.text,
                }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                파일 추가
              </button>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* 옵션 */}
          <div
            className="flex items-center justify-between py-3 border-t border-b mb-4"
            style={{ borderColor: '#D4CFC4' }}
          >
            {/* 익명 옵션 */}
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                className="w-5 h-5 flex items-center justify-center transition-colors"
                style={{
                  border: '1px solid #1A1A1A',
                  backgroundColor: isAnonymous ? '#1A1A1A' : 'transparent',
                }}
                onClick={() => setIsAnonymous(!isAnonymous)}
              >
                {isAnonymous && (
                  <svg className="w-3 h-3" fill="#F5F0E8" viewBox="0 0 24 24">
                    <path d="M20.285 2l-11.285 11.567-5.286-5.011-3.714 3.716 9 8.728 15-15.285z" />
                  </svg>
                )}
              </div>
              <span
                className="text-sm font-serif-display"
                style={{ color: theme.colors.text }}
              >
                익명의 기자로 작성
              </span>
            </label>

            {/* 상태 안내 */}
            <span
              className="text-xs font-serif-elegant italic"
              style={{ color: theme.colors.textSecondary }}
            >
              {uploading && 'Uploading...'}
              {updating && 'Saving...'}
              {!uploading && !updating && isValid && 'Ready to save!'}
            </span>
          </div>

          {/* 에러 메시지 */}
          {(updateError || uploadError) && (
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
              {updateError || uploadError}
            </motion.div>
          )}

          {/* 저장 버튼 */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={handleSubmit}
            disabled={!isValid || updating || uploading}
            className="w-full py-3 font-serif-display font-bold text-center transition-colors disabled:opacity-50"
            style={{
              backgroundColor: '#1A1A1A',
              color: '#F5F0E8',
            }}
          >
            {uploading ? 'Uploading...' : updating ? 'Saving...' : 'SAVE CHANGES'}
          </motion.button>
        </motion.div>
      </main>

      {/* 하단 장식 */}
      <div className="mt-8 mx-4">
        <div className="border-t-4 border-double border-[#1A1A1A] pt-2">
          <p className="text-center text-sm text-[#3A3A3A] font-serif-elegant italic">
            © {new Date().getFullYear()} The Q&A Times. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
