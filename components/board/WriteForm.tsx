'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useTheme } from '@/styles/themes/useTheme';
import { useUpload, type FileInfo } from '@/lib/hooks/useStorage';
import type { CreatePostData, AttachedFile, BoardTag } from '@/lib/hooks/useBoard';
import { BOARD_TAGS } from '@/lib/hooks/useBoard';
import { useChapterKeywords } from '@/lib/hooks/useChapterKeywords';
import { useCourse } from '@/lib/contexts/CourseContext';
import { useHomeScale } from '@/components/home/useHomeScale';
import { useUser } from '@/lib/contexts/UserContext';

interface WriteFormProps {
  /** 제출 핸들러 */
  onSubmit: (data: CreatePostData) => Promise<void>;
  /** 제출 중 여부 */
  isSubmitting?: boolean;
  /** 에러 메시지 */
  error?: string | null;
  /** 초기 제목 (임시저장 복원용) */
  initialTitle?: string;
  /** 초기 본문 (임시저장 복원용) */
  initialContent?: string;
  /** 초기 태그 (임시저장 복원용) */
  initialTag?: BoardTag;
  /** 제목/본문 변경 시 콜백 (임시저장용) */
  onDraftChange?: (title: string, content: string, tag?: BoardTag) => void;
  /** 비공개 글 존재 여부 (외부에서 전달) */
  hasPrivatePost?: boolean;
}

/**
 * 글 작성 폼 컴포넌트 - 이미지/파일 첨부 지원
 */
export default function WriteForm({
  onSubmit,
  isSubmitting = false,
  error,
  initialTitle = '',
  initialContent = '',
  initialTag,
  onDraftChange,
  hasPrivatePost = false,
}: WriteFormProps) {
  const { theme } = useTheme();
  const { profile } = useUser();
  const { uploadImage, uploadFile, loading: uploading, error: uploadError } = useUpload();
  const { userCourseId } = useCourse();
  const formScale = useHomeScale();
  const { chapters, detectChapters } = useChapterKeywords(userCourseId);

  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [tag, setTag] = useState<BoardTag | undefined>(initialTag);
  const [aiDetailedAnswer, setAiDetailedAnswer] = useState(true);
  const [chapterTags, setChapterTags] = useState<string[]>([]);
  const [showChapterPicker, setShowChapterPicker] = useState(false);
  const autoDetectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 제목+본문 변경 시 챕터 자동 추천 (디바운스 1초)
  useEffect(() => {
    if (autoDetectTimer.current) clearTimeout(autoDetectTimer.current);
    autoDetectTimer.current = setTimeout(() => {
      const text = `${title} ${content}`;
      if (text.trim().length >= 10) {
        const detected = detectChapters(text);
        if (detected.length > 0) {
          setChapterTags(prev => {
            // 이미 수동 선택한 태그는 유지, 자동 추천만 추가
            const manual = prev.filter(t => !detected.includes(t));
            return [...new Set([...manual, ...detected])];
          });
        }
      }
    }, 1000);
    return () => { if (autoDetectTimer.current) clearTimeout(autoDetectTimer.current); };
  }, [title, content, detectChapters]);

  // 부모에서 임시저장 복원 시 반영 (useState는 초기값만 사용하므로 동기화 필요)
  useEffect(() => {
    if (initialTitle) setTitle(initialTitle);
  }, [initialTitle]);

  useEffect(() => {
    if (initialContent) setContent(initialContent);
  }, [initialContent]);

  useEffect(() => {
    if (initialTag) setTag(initialTag);
  }, [initialTag]);

  // 제목/본문 변경 시 부모에 알림
  const handleTitleChange = useCallback((value: string) => {
    setTitle(value);
    onDraftChange?.(value, content, tag);
  }, [content, tag, onDraftChange]);

  const handleContentChange = useCallback((value: string) => {
    setContent(value);
    onDraftChange?.(title, value, tag);
  }, [title, tag, onDraftChange]);

  const handleTagSelect = useCallback((selectedTag: BoardTag) => {
    const newTag = tag === selectedTag ? undefined : selectedTag;
    setTag(newTag);
    // 학술이 아닌 태그로 변경 시 체크박스 초기화
    if (newTag !== '학술') setAiDetailedAnswer(false);
    // 비공개에서 다른 태그로 전환 시 고정 제목 해제
    const newTitle = tag === '비공개' ? '' : title;
    if (tag === '비공개') setTitle('');
    onDraftChange?.(newTitle, content, newTag);
  }, [tag, title, content, onDraftChange]);

  // 비공개(나만의 콩콩이) 허용 계정 — 교수님 허락 후 전체 오픈 예정
  const PRIVATE_POST_ALLOWED_IDS = ['25010423', '11111111', '26030001'];
  const canUsePrivatePost = profile?.role === 'professor'
    || PRIVATE_POST_ALLOWED_IDS.includes(profile?.studentId || '');

  // 비공개 태그 선택 시 이미 비공개 글이 있으면 차단
  const privateTitle = `${profile?.nickname || '나'}의 콩콩이`;
  const handlePrivateToggle = useCallback(() => {
    if (tag === '비공개') {
      setTag(undefined);
      setTitle('');
      onDraftChange?.('', content, undefined);
    } else {
      if (hasPrivatePost) return;
      setTag('비공개');
      setTitle(privateTitle);
      setAiDetailedAnswer(false);
      onDraftChange?.(privateTitle, content, '비공개');
    }
  }, [tag, content, onDraftChange, hasPrivatePost, privateTitle]);

  // 첨부 파일 상태
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const [files, setFiles] = useState<{ file: File; name: string }[]>([]);
  const [linkedImageUrls, setLinkedImageUrls] = useState<string[]>([]);

  // URL 입력 상태
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInputValue, setUrlInputValue] = useState('');
  const urlInputRef = useRef<HTMLInputElement>(null);

  // 파일 input refs
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 유효성 검사
  const isValid = title.trim().length >= 2 && content.trim().length >= 5 && !!tag;

  /**
   * 이미지 선택 핸들러
   */
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    const newImages: { file: File; preview: string }[] = [];

    Array.from(selectedFiles).forEach((file) => {
      // 최대 5장까지 (파일 + 링크 합산)
      if (images.length + linkedImageUrls.length + newImages.length >= 5) return;

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
  }, [images.length, linkedImageUrls.length]);

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

  // 링크 이미지 제거
  const removeLinkedImage = useCallback((index: number) => {
    setLinkedImageUrls(prev => prev.filter((_, i) => i !== index));
  }, []);

  // 이미지 URL 감지 패턴
  const IMAGE_URL_PATTERN = /^https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|bmp|svg|tiff|ico|avif)(?:[?#]\S*)?$/i;
  const KNOWN_IMAGE_HOST_PATTERN = /^https?:\/\/(?:i\.imgur\.com|pbs\.twimg\.com|images\.unsplash\.com|lh[0-9]*\.googleusercontent\.com|firebasestorage\.googleapis\.com|encrypted-tbn[0-9]*\.gstatic\.com|blogfiles\.naver\.net|postfiles\.naver\.net|[a-z0-9-]+\.googleusercontent\.com|cdn\.discordapp\.com|media\.discordapp\.net|i\.namu\.wiki|upload\.wikimedia\.org|img\.icons8\.com)\//i;

  // 본문에 이미지 URL 붙여넣기 감지
  const handleContentPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text').trim();
    if (!text) return;

    if (IMAGE_URL_PATTERN.test(text) || KNOWN_IMAGE_HOST_PATTERN.test(text)) {
      const totalImages = images.length + linkedImageUrls.length;
      if (totalImages >= 5) return;
      if (linkedImageUrls.includes(text)) return;
      e.preventDefault();
      setLinkedImageUrls(prev => [...prev, text]);
    }
  }, [images.length, linkedImageUrls]);

  // URL 입력으로 이미지 추가
  const handleAddImageUrl = useCallback(() => {
    const url = urlInputValue.trim();
    if (!url) return;
    if (images.length + linkedImageUrls.length >= 5) return;
    if (linkedImageUrls.includes(url)) return;
    setLinkedImageUrls(prev => [...prev, url]);
    setUrlInputValue('');
    setTimeout(() => urlInputRef.current?.focus(), 50);
  }, [urlInputValue, images.length, linkedImageUrls]);

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

      // 업로드 URL + 링크 URL 합치기
      const allImageUrls = [...uploadedImageUrls, ...linkedImageUrls];

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
        imageUrl: allImageUrls[0] || undefined,
        imageUrls: allImageUrls,
        fileUrls: uploadedFiles,
        tag,
        ...(chapterTags.length > 0 ? { chapterTags } : {}),
        ...(tag === '학술' && aiDetailedAnswer ? { aiDetailedAnswer: true } : {}),
        ...(tag === '비공개' ? { isPrivate: true, aiDetailedAnswer: true } : {}),
      });
    } catch (err) {
      console.error('글 작성 실패:', err);
    }
  }, [isValid, isSubmitting, uploading, images, files, linkedImageUrls, title, content, tag, aiDetailedAnswer, uploadImage, uploadFile, onSubmit]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        border: '1px solid #1A1A1A',
        backgroundColor: theme.colors.backgroundCard,
        padding: Math.round(12 * formScale),
        fontSize: Math.round(12 * formScale),
      }}
    >
      {/* 제목 입력 */}
      <div className="mb-3">
        <label
          className="block text-xs font-bold mb-1.5"
          style={{ color: theme.colors.text }}
        >
          제목 <span style={{ color: '#8B1A1A' }}>*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="기사 제목을 입력하세요 (2자 이상)"
          maxLength={100}
          disabled={tag === '비공개'}
          className="w-full px-3 py-2 outline-none transition-colors text-sm"
          style={{
            border: '1px solid #1A1A1A',
            backgroundColor: tag === '비공개' ? '#EDEAE4' : theme.colors.background,
            color: theme.colors.text,
            fontWeight: tag === '비공개' ? 700 : 400,
          }}
        />
        {tag !== '비공개' && (
          <div
            className="mt-1 text-xs text-right"
            style={{ color: theme.colors.textSecondary }}
          >
            {title.length}/100
          </div>
        )}
      </div>

      {/* 태그 선택 (필수) — 제목과 본문 사이 */}
      <div className="mb-3">
        <label
          className="block text-xs font-bold mb-1.5"
          style={{ color: theme.colors.text }}
        >
          태그 <span style={{ color: '#8B1A1A' }}>*</span>
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          {BOARD_TAGS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => handleTagSelect(t)}
              className="px-3 py-1.5 text-xs font-bold transition-colors"
              style={tag === t ? {
                backgroundColor: '#1A1A1A',
                color: '#F5F0E8',
                border: '1px solid #1A1A1A',
              } : {
                backgroundColor: 'transparent',
                color: '#1A1A1A',
                border: '1px solid #1A1A1A',
              }}
            >
              {t}
            </button>
          ))}

          {/* 비공개 (나만의 콩콩이) 태그 — 허용 계정만 표시 */}
          {canUsePrivatePost && (
            <button
              type="button"
              onClick={handlePrivateToggle}
              disabled={hasPrivatePost && tag !== '비공개'}
              className="px-3 py-1.5 text-xs font-bold transition-colors"
              style={tag === '비공개' ? {
                backgroundColor: '#1A1A1A',
                color: '#F5F0E8',
                border: '1px solid #1A1A1A',
              } : hasPrivatePost ? {
                backgroundColor: 'transparent',
                color: '#999',
                border: '1px solid #D4CFC4',
                cursor: 'not-allowed',
              } : {
                backgroundColor: 'transparent',
                color: '#1A1A1A',
                border: '1px solid #1A1A1A',
              }}
            >
              비공개
            </button>
          )}

          {/* 학술 태그 선택 시 AI 상세 답변 체크박스 */}
          <AnimatePresence>
            {tag === '학술' && (
              <motion.label
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2 ml-auto cursor-pointer select-none"
              >
                <span
                  className="flex items-center justify-center border border-[#1A1A1A]"
                  style={{ width: 28, height: 28 }}
                >
                  {aiDetailedAnswer && (
                    <svg className="w-4 h-4 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                <input
                  type="checkbox"
                  checked={aiDetailedAnswer}
                  onChange={(e) => setAiDetailedAnswer(e.target.checked)}
                  className="sr-only"
                />
                <span className="text-xs font-bold text-[#1A1A1A]">
                  AI 상세 답변
                </span>
              </motion.label>
            )}
          </AnimatePresence>
        </div>

        {/* 비공개 태그 설명 */}
        <AnimatePresence>
          {tag === '비공개' && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="text-[11px] mt-1.5"
              style={{ color: '#5C5C5C' }}
            >
              나만 볼 수 있는 글이에요. 콩콩이가 모든 대화를 기억하며 답변해줘요!
            </motion.p>
          )}
          {hasPrivatePost && tag !== '비공개' && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="text-[11px] mt-1.5"
              style={{ color: '#999' }}
            >
              이미 비공개 글이 있어요. 삭제 후 새로 작성할 수 있어요.
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* 내용 입력 */}
      <div className="mb-3">
        <label
          className="block text-xs font-bold mb-1.5"
          style={{ color: theme.colors.text }}
        >
          본문 <span style={{ color: '#8B1A1A' }}>*</span>
        </label>
        <textarea
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          onPaste={handleContentPaste}
          placeholder="기사 내용을 입력하세요 (5자 이상)"
          rows={5}
          maxLength={2000}
          className="w-full px-3 py-2 resize-none outline-none transition-colors leading-relaxed"
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


      {/* 이미지 첨부 */}
      <div className="mb-3">
        <label
          className="block text-xs font-bold mb-1.5"
          style={{ color: theme.colors.text }}
        >
          사진
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
                  className="relative w-16 h-16"
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

        {/* 링크 이미지 미리보기 */}
        {linkedImageUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {linkedImageUrls.map((url, index) => (
              <motion.div
                key={url}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="relative h-16"
              >
                <img
                  src={url}
                  alt={`링크 이미지 ${index + 1}`}
                  className="h-full w-auto object-contain rounded-sm"
                  style={{ border: '1px dashed #1A1A1A' }}
                />
                <button
                  type="button"
                  onClick={() => removeLinkedImage(index)}
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

        {/* URL 입력 패널 */}
        <AnimatePresence>
          {showUrlInput && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-2"
            >
              <div
                className="flex items-center gap-2 p-2"
                style={{ border: '1px solid #D4CFC4', backgroundColor: theme.colors.background }}
              >
                <input
                  ref={urlInputRef}
                  type="url"
                  value={urlInputValue}
                  onChange={(e) => setUrlInputValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddImageUrl(); } }}
                  placeholder="이미지 URL을 붙여넣으세요"
                  className="flex-1 px-2.5 py-1.5 text-xs outline-none"
                  style={{
                    border: '1px solid #D4CFC4',
                    backgroundColor: theme.colors.backgroundCard,
                    color: theme.colors.text,
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddImageUrl}
                  disabled={!urlInputValue.trim() || images.length + linkedImageUrls.length >= 5}
                  className="flex-shrink-0 px-2.5 py-1.5 text-xs font-bold disabled:opacity-30"
                  style={{ backgroundColor: '#1A1A1A', color: '#F5F0E8' }}
                >
                  추가
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 이미지 추가 버튼 */}
        <div className="flex gap-2">
          {images.length + linkedImageUrls.length < 5 && (
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
              style={{
                border: '1px dashed #1A1A1A',
                backgroundColor: 'transparent',
                color: theme.colors.text,
              }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              사진 첨부
            </button>
          )}
          {images.length + linkedImageUrls.length < 5 && (
            <button
              type="button"
              onClick={() => { setShowUrlInput(v => !v); setTimeout(() => urlInputRef.current?.focus(), 100); }}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${showUrlInput ? 'font-bold' : ''}`}
              style={{
                border: showUrlInput ? '1px solid #1A1A1A' : '1px dashed #1A1A1A',
                backgroundColor: showUrlInput ? '#1A1A1A' : 'transparent',
                color: showUrlInput ? '#F5F0E8' : theme.colors.text,
              }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              URL 이미지
            </button>
          )}
        </div>

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
      <div className="mb-3">
        <label
          className="block text-xs font-bold mb-1.5"
          style={{ color: theme.colors.text }}
        >
          파일
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
            className="flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
            style={{
              border: '1px dashed #1A1A1A',
              backgroundColor: 'transparent',
              color: theme.colors.text,
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      {/* 구분선 */}
      <div
        className="py-2 border-t border-b mb-3"
        style={{ borderColor: '#D4CFC4' }}
      />

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

      {/* 유효성 안내 */}
      {!isValid && (title.trim().length > 0 || content.trim().length > 0) && (
        <p className="text-xs text-[#8B1A1A] text-center">
          {!tag ? '태그를 선택해주세요' : title.trim().length < 2 ? '제목을 2자 이상 입력해주세요' : '본문을 5자 이상 입력해주세요'}
        </p>
      )}

      {/* 작성 버튼 */}
      <motion.button
        type="button"
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={handleSubmit}
        disabled={!isValid || isSubmitting || uploading}
        className="w-full font-serif-display font-bold text-center transition-colors disabled:opacity-50"
        style={{
          backgroundColor: '#1A1A1A',
          color: '#F5F0E8',
          padding: `${Math.round(10 * formScale)}px 0`,
          fontSize: Math.round(14 * formScale),
        }}
      >
        {uploading ? '업로드 중...' : isSubmitting ? '게시 중...' : '게시하기'}
      </motion.button>
    </motion.div>
  );
}
