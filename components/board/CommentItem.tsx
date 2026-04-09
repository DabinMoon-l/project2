'use client';

import { memo, useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { ImageViewer } from '@/components/common';
import LinkifiedText from '@/components/board/LinkifiedText';
import type { Comment } from '@/lib/hooks/useBoard';

interface CommentItemProps {
  comment: Comment;
  currentUserId?: string;
  onDelete?: (commentId: string) => void;
  onEdit?: (commentId: string, content: string, imageUrls?: string[]) => void;
  onReply?: () => void;
  onLike?: (commentId: string) => void;
  onAccept?: (commentId: string) => void;
  isLiked?: boolean;
  isDeleting?: boolean;
  isEditing?: boolean;
  isReply?: boolean;
  /** 비공개 글(나만의 콩콩이) 여부 — true면 본문 전체 표시 (더보기 없음) */
  isPrivatePost?: boolean;
  /** 채택 버튼 표시 여부 */
  canAccept?: boolean;
  /** 채택 처리 중 */
  isAccepting?: boolean;
  /** 교수님 여부 (이름 표시용) */
  isProfessor?: boolean;
  /** 작성자 실명 맵 (uid → name) */
  authorNameMap?: Map<string, string>;
  /** 교수 계정 최신 닉네임 맵 (uid → nickname) */
  authorNicknameMap?: Map<string, string>;
  /** 게시글 작성자 uid (글쓴이 표시용) */
  postAuthorId?: string;
  /** 이미지 업로드 함수 (수정 시 새 이미지 업로드용) */
  onUploadImages?: (files: File[]) => Promise<string[]>;
}

/**
 * 날짜 포맷
 */
function formatDate(date: Date) {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (days < 7) return `${days}일 전`;
  // 년도 제외, 월.일.시:분 형식
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${m}. ${d}. ${h}:${min}`;
}

/**
 * 스마트 페이지 분할: 세로 이미지 단독, 가로/정방 2장씩
 */
function buildCommentImagePages(images: string[], tallFlags: Record<number, boolean>) {
  const pages: { urls: string[]; indices: number[] }[] = [];
  let i = 0;
  while (i < images.length) {
    if (tallFlags[i]) {
      pages.push({ urls: [images[i]], indices: [i] });
      i++;
    } else if (i + 1 < images.length && !tallFlags[i + 1]) {
      pages.push({ urls: [images[i], images[i + 1]], indices: [i, i + 1] });
      i += 2;
    } else {
      pages.push({ urls: [images[i]], indices: [i] });
      i++;
    }
  }
  return pages;
}

/**
 * 댓글 이미지 갤러리 — 세로 이미지는 단독, 가로/정방은 2장씩
 */
function CommentImageGallery({
  images,
  isEditMode,
  imageCurrentPage,
  setImageCurrentPage,
  onViewImage,
}: {
  images: string[];
  isEditMode: boolean;
  imageCurrentPage: number;
  setImageCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  onViewImage: (index: number) => void;
}) {
  const [tallFlags, setTallFlags] = useState<Record<number, boolean>>({});

  const handleImgLoad = (index: number, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const isTall = img.naturalHeight > img.naturalWidth * 1.3;
    setTallFlags(prev => {
      if (prev[index] === isTall) return prev;
      return { ...prev, [index]: isTall };
    });
  };

  const allDetected = Object.keys(tallFlags).length === images.length;
  const pages = allDetected
    ? buildCommentImagePages(images, tallFlags)
    : images.map((url, i) => ({ urls: [url], indices: [i] }));

  const totalPages = pages.length;
  const safePage = Math.min(imageCurrentPage, totalPages - 1);

  useEffect(() => {
    if (imageCurrentPage >= totalPages && totalPages > 0) {
      setImageCurrentPage(totalPages - 1);
    }
  }, [totalPages, imageCurrentPage, setImageCurrentPage]);

  if (images.length === 0 || isEditMode) return null;

  const currentPageData = pages[safePage] || pages[0];
  const isSingle = currentPageData?.urls.length === 1;

  return (
    <div className="mt-2">
      <div className={isSingle ? '' : 'grid grid-cols-2 gap-2'}>
        {currentPageData?.urls.map((url, index) => {
          const globalIndex = currentPageData.indices[index];
          return (
            <div
              key={`img-${globalIndex}`}
              className="relative bg-[#EBE5D9] cursor-pointer overflow-hidden rounded-sm"
              onClick={() => onViewImage(globalIndex)}
            >
              <img
                src={url}
                alt={`이미지 ${globalIndex + 1}`}
                className={`w-full h-auto object-contain ${isSingle ? 'max-h-[360px]' : 'max-h-[240px]'}`}
                draggable={false}
                onLoad={(e) => handleImgLoad(globalIndex, e)}
              />
            </div>
          );
        })}
      </div>

      {/* 미렌더 이미지 프리로드 + 비율 감지 */}
      <div className="hidden">
        {images.map((url, i) =>
          tallFlags[i] === undefined ? (
            <img key={`preload-${i}`} src={url} alt="" onLoad={(e) => handleImgLoad(i, e)} />
          ) : null
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-2">
          <button onClick={() => setImageCurrentPage(p => Math.max(0, p - 1))} disabled={safePage === 0} className="px-2 py-0.5 text-xs disabled:opacity-30" style={{ border: '1px solid #1A1A1A' }}>←</button>
          <span className="text-xs text-[#3A3A3A]">{safePage + 1} / {totalPages}</span>
          <button onClick={() => setImageCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage === totalPages - 1} className="px-2 py-0.5 text-xs disabled:opacity-30" style={{ border: '1px solid #1A1A1A' }}>→</button>
        </div>
      )}
    </div>
  );
}

/**
 * 댓글 아이템 컴포넌트 (대댓글 지원, 수정 기능 포함)
 */
function CommentItem({
  comment,
  currentUserId,
  onDelete,
  onEdit,
  onReply,
  onLike,
  onAccept,
  isLiked = false,
  isDeleting = false,
  isEditing: isEditingProp = false,
  isReply = false,
  isPrivatePost = false,
  canAccept = false,
  isAccepting = false,
  isProfessor = false,
  authorNameMap,
  authorNicknameMap,
  postAuthorId,
  onUploadImages,
}: CommentItemProps) {
  const { theme } = useTheme();
  const isPostAuthor = !!(postAuthorId && comment.authorId === postAuthorId);
  const isProfessorComment = !comment.authorClassType && comment.authorId !== 'gemini-ai';
  const isAIComment = comment.authorId === 'gemini-ai';
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  // 교수님 댓글, 비공개 글(나만의 콩콩이)은 기본 펼침
  const [isExpanded, setIsExpanded] = useState(isProfessorComment || isPrivatePost);
  const [isClamped, setIsClamped] = useState(false);
  const contentRef = useRef<HTMLParagraphElement>(null);
  const [viewerInfo, setViewerInfo] = useState<{ index: number } | null>(null);
  const [imageCurrentPage, setImageCurrentPage] = useState(0);

  // 수정 모드 이미지 상태
  const [editExistingImages, setEditExistingImages] = useState<string[]>([]);
  const [editNewFiles, setEditNewFiles] = useState<File[]>([]);
  const [editNewPreviews, setEditNewPreviews] = useState<string[]>([]);
  const [editLinkedUrls, setEditLinkedUrls] = useState<string[]>([]);
  const [showEditUrlInput, setShowEditUrlInput] = useState(false);
  const [editUrlInputValue, setEditUrlInputValue] = useState('');
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const editUrlInputRef = useRef<HTMLInputElement>(null);

  // 실제 DOM에서 line-clamp에 의해 잘리는지 감지
  // 비공개 글은 line-clamp 자체가 없으므로 감지 스킵
  useEffect(() => {
    if (isPrivatePost) return;
    const el = contentRef.current;
    if (el && !isExpanded) {
      setIsClamped(el.scrollHeight > el.clientHeight + 1);
    }
  }, [comment.content, isExpanded, isPrivatePost]);
  const images = comment.imageUrls || [];

  const isOwner = currentUserId === comment.authorId;

  // 작성자 표시: 교수님에겐 이름 닉네임·반, 학생에겐 닉네임·반
  const realName = isProfessor && authorNameMap ? authorNameMap.get(comment.authorId) : undefined;
  // 교수 계정 댓글: 최신 닉네임 사용 (닉네임 변경 반영)
  const professorNickname = (!comment.authorClassType && comment.authorId !== 'gemini-ai')
    ? (authorNicknameMap?.get(comment.authorId) || comment.authorNickname)
    : comment.authorNickname;
  const authorDisplay = comment.authorClassType
    ? `${realName ? `${realName} ` : ''}${comment.authorNickname}·${comment.authorClassType}반`
    : comment.authorId === 'gemini-ai'
      ? comment.authorNickname
      : professorNickname.includes('교수')
        ? professorNickname
        : `${professorNickname} 교수님`;

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    onDelete?.(comment.id);
    setShowDeleteConfirm(false);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  const handleEditClick = () => {
    setEditContent(comment.content);
    setEditExistingImages(comment.imageUrls || []);
    setEditNewFiles([]);
    editNewPreviews.forEach(u => URL.revokeObjectURL(u));
    setEditNewPreviews([]);
    setEditLinkedUrls([]);
    setShowEditUrlInput(false);
    setEditUrlInputValue('');
    setIsEditMode(true);
  };

  const handleSaveEdit = async () => {
    if ((!editContent.trim() && editExistingImages.length === 0 && editNewFiles.length === 0 && editLinkedUrls.length === 0) || !onEdit) return;

    // 새 이미지 업로드
    let newUploadedUrls: string[] = [];
    if (editNewFiles.length > 0 && onUploadImages) {
      newUploadedUrls = await onUploadImages(editNewFiles);
    }

    const finalImageUrls = [...editExistingImages, ...newUploadedUrls, ...editLinkedUrls];
    onEdit(comment.id, editContent.trim(), finalImageUrls);
    editNewPreviews.forEach(u => URL.revokeObjectURL(u));
    setEditNewFiles([]);
    setEditNewPreviews([]);
    setEditLinkedUrls([]);
    setShowEditUrlInput(false);
    setEditUrlInputValue('');
    setIsEditMode(false);
  };

  const handleCancelEdit = () => {
    setEditContent(comment.content);
    setEditExistingImages([]);
    editNewPreviews.forEach(u => URL.revokeObjectURL(u));
    setEditNewFiles([]);
    setEditNewPreviews([]);
    setEditLinkedUrls([]);
    setShowEditUrlInput(false);
    setEditUrlInputValue('');
    setIsEditMode(false);
  };

  // 이미지 URL 검증 패턴
  const IMAGE_URL_PATTERN = /^https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|bmp|svg|tiff|ico|avif)(?:[?#]\S*)?$/i;
  const KNOWN_IMAGE_HOST_PATTERN = /^https?:\/\/(?:i\.imgur\.com|pbs\.twimg\.com|images\.unsplash\.com|lh[0-9]*\.googleusercontent\.com|firebasestorage\.googleapis\.com|encrypted-tbn[0-9]*\.gstatic\.com|blogfiles\.naver\.net|postfiles\.naver\.net|[a-z0-9-]+\.googleusercontent\.com|cdn\.discordapp\.com|media\.discordapp\.net|i\.namu\.wiki|upload\.wikimedia\.org|img\.icons8\.com)\//i;

  // 수정 모드: URL로 이미지 추가
  const handleAddEditImageUrl = () => {
    const url = editUrlInputValue.trim();
    if (!url) return;
    const total = editExistingImages.length + editNewFiles.length + editLinkedUrls.length;
    if (total >= 5) return;
    if (editLinkedUrls.includes(url) || editExistingImages.includes(url)) return;
    if (!IMAGE_URL_PATTERN.test(url) && !KNOWN_IMAGE_HOST_PATTERN.test(url)) {
      alert('이미지 URL만 추가할 수 있습니다.\n(jpg, png, gif, webp 등)');
      return;
    }
    setEditLinkedUrls(prev => [...prev, url]);
    setEditUrlInputValue('');
    setTimeout(() => editUrlInputRef.current?.focus(), 50);
  };

  // 수정 모드: 링크 이미지 삭제
  const removeEditLinkedImage = (index: number) => {
    setEditLinkedUrls(prev => prev.filter((_, i) => i !== index));
  };

  // 수정 모드: 새 이미지 선택
  const handleEditImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const total = editExistingImages.length + editNewFiles.length + files.length;
    const allowed = files.slice(0, Math.max(0, 5 - editExistingImages.length - editNewFiles.length));
    if (allowed.length === 0) return;
    setEditNewFiles(prev => [...prev, ...allowed]);
    setEditNewPreviews(prev => [...prev, ...allowed.map(f => URL.createObjectURL(f))]);
    if (editFileInputRef.current) editFileInputRef.current.value = '';
  };

  // 수정 모드: 기존 이미지 삭제
  const removeExistingImage = (index: number) => {
    setEditExistingImages(prev => prev.filter((_, i) => i !== index));
  };

  // 수정 모드: 새 이미지 삭제
  const removeNewImage = (index: number) => {
    URL.revokeObjectURL(editNewPreviews[index]);
    setEditNewFiles(prev => prev.filter((_, i) => i !== index));
    setEditNewPreviews(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`py-3 ${isReply ? 'pl-4 bg-[#EDE8DF]' : 'border-b border-dashed border-[#D4CFC4]'}`}
    >
      {/* 댓글 헤더 — 좌: 작성자·시간 / 우: 답글·좋아요 */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[13px] font-semibold"
            style={{ color: isPostAuthor ? theme.colors.accent : theme.colors.text }}
          >
            {isReply && <span className="text-[13px] font-bold text-[#999] mr-1">ㄴ</span>}
            {authorDisplay}
          </span>
          {isPostAuthor && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 border"
              style={{ color: theme.colors.accent, borderColor: theme.colors.accent }}
            >
              글쓴이
            </span>
          )}
          {comment.isAccepted && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 bg-[#2E7D32] text-white">
              채택됨
            </span>
          )}
          <span className="text-[#AAAAAA] text-[13px]">·</span>
          <span className="text-[11px] text-[#999999]">
            {formatDate(comment.createdAt)}
          </span>
        </div>

        {!isEditMode && (
          <div className="flex items-center gap-2.5">
            {canAccept && onAccept && (
              <button
                type="button"
                onClick={() => onAccept(comment.id)}
                disabled={isAccepting}
                className="text-[11px] font-bold transition-colors disabled:opacity-50"
                style={{ color: '#2E7D32' }}
              >
                {isAccepting ? '채택 중...' : '채택'}
              </button>
            )}
            {/* 답글 버튼은 내용 하단으로 이동 */}
            {onLike && (
              <button
                type="button"
                onClick={() => onLike(comment.id)}
                className="flex items-center gap-1 text-[11px] transition-colors"
                style={{ color: isLiked ? '#8B1A1A' : '#999999' }}
              >
                <span>{isLiked ? '♥' : '♡'}</span>
                {(comment.likes || 0) > 0 && <span>{comment.likes}</span>}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 댓글 내용 (수정 모드 / 일반 모드) */}
      {isEditMode ? (
        <div className="space-y-2">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full px-3 py-2 text-sm outline-none resize-none leading-relaxed rounded-lg"
            style={{
              border: '1px solid #1A1A1A',
              backgroundColor: theme.colors.background,
              color: theme.colors.text,
            }}
            rows={3}
            maxLength={500}
          />

          {/* 수정 모드 이미지 관리 */}
          {(editExistingImages.length > 0 || editNewPreviews.length > 0 || editLinkedUrls.length > 0) && (
            <div className="flex gap-2 flex-wrap">
              {editExistingImages.map((url, index) => (
                <div key={`existing-${index}`} className="relative w-16 h-16 flex-shrink-0">
                  <img src={url} alt="" className="w-full h-full object-cover border border-[#D4CFC4]" />
                  <button
                    type="button"
                    onClick={() => removeExistingImage(index)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#1A1A1A] text-[#F5F0E8] rounded-full flex items-center justify-center text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
              {editNewPreviews.map((url, index) => (
                <div key={`new-${index}`} className="relative w-16 h-16 flex-shrink-0">
                  <img src={url} alt="" className="w-full h-full object-cover border border-dashed border-[#1A1A1A]" />
                  <button
                    type="button"
                    onClick={() => removeNewImage(index)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#1A1A1A] text-[#F5F0E8] rounded-full flex items-center justify-center text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
              {editLinkedUrls.map((url, index) => (
                <div key={`linked-${index}`} className="relative h-16 flex-shrink-0">
                  <img src={url} alt="" className="h-full w-auto object-contain rounded-sm border border-dashed border-[#1A1A1A]" />
                  <button
                    type="button"
                    onClick={() => removeEditLinkedImage(index)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#1A1A1A] text-[#F5F0E8] rounded-full flex items-center justify-center text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* URL 입력 패널 */}
          {showEditUrlInput && (
            <div className="flex items-center gap-2">
              <input
                ref={editUrlInputRef}
                type="url"
                value={editUrlInputValue}
                onChange={(e) => setEditUrlInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddEditImageUrl(); } }}
                placeholder="이미지 URL 붙여넣기"
                className="flex-1 px-2.5 py-1.5 text-xs outline-none rounded-md"
                style={{ border: '1px solid #D4CFC4', backgroundColor: theme.colors.background, color: theme.colors.text }}
              />
              <button
                type="button"
                onClick={handleAddEditImageUrl}
                disabled={!editUrlInputValue.trim()}
                className="flex-shrink-0 px-2 py-1.5 text-xs font-bold disabled:opacity-30 rounded-md"
                style={{ backgroundColor: '#1A1A1A', color: '#F5F0E8' }}
              >
                추가
              </button>
              <button
                type="button"
                onClick={() => { setShowEditUrlInput(false); setEditUrlInputValue(''); }}
                className="text-[#999] p-0.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            {/* 이미지 추가 버튼 */}
            {editExistingImages.length + editNewFiles.length + editLinkedUrls.length < 5 && (
              <button
                type="button"
                onClick={() => editFileInputRef.current?.click()}
                className="flex items-center gap-1 px-2 py-1 text-xs text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors rounded-md"
                style={{ border: '1px solid #D4CFC4' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                사진 추가
              </button>
            )}
            {/* URL로 이미지 추가 버튼 */}
            {editExistingImages.length + editNewFiles.length + editLinkedUrls.length < 5 && (
              <button
                type="button"
                onClick={() => { setShowEditUrlInput(v => !v); setTimeout(() => editUrlInputRef.current?.focus(), 100); }}
                className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors rounded-md ${showEditUrlInput ? 'text-[#F5F0E8]' : 'text-[#5C5C5C] hover:text-[#1A1A1A]'}`}
                style={{ border: '1px solid #D4CFC4', backgroundColor: showEditUrlInput ? '#1A1A1A' : 'transparent' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                URL
              </button>
            )}
            <input
              ref={editFileInputRef}
              type="file"
              accept="image/*"
              multiple
              tabIndex={-1}
              className="hidden"
              onChange={handleEditImageSelect}
            />

            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={(!editContent.trim() && editExistingImages.length === 0 && editNewFiles.length === 0 && editLinkedUrls.length === 0) || isEditingProp}
                className="px-3 py-1 text-xs disabled:opacity-50 rounded-md"
                style={{
                  backgroundColor: '#1A1A1A',
                  color: '#F5F0E8',
                }}
              >
                {isEditingProp ? '저장 중...' : '저장'}
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-3 py-1 text-xs rounded-md"
                style={{
                  border: '1px solid #1A1A1A',
                  backgroundColor: 'transparent',
                  color: '#1A1A1A',
                }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden max-w-full">
          <div
            ref={contentRef}
            className={`text-[15px] whitespace-pre-wrap leading-relaxed ${
              isPrivatePost || isExpanded ? '' : (isAIComment ? 'line-clamp-[8]' : 'line-clamp-3')
            }`}
            style={{
              color: theme.colors.text,
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
            }}
          >
            <LinkifiedText text={comment.content} />
          </div>
          {/* 더보기/접기 + 답글 버튼 (비공개 글은 더보기 없음) */}
          <div className="flex items-center gap-3 mt-1">
            {!isPrivatePost && (isClamped || isExpanded) && (
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-xs transition-colors"
                style={{ color: '#5C5C5C' }}
              >
                {isExpanded ? '접기' : '...더보기'}
              </button>
            )}
            {!isEditMode && onReply && (
              <button
                type="button"
                onClick={onReply}
                className="flex items-center gap-1 text-xs transition-colors"
                style={{ color: '#999999' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                답글
              </button>
            )}
          </div>
        </div>
      )}

      {/* 이미지 갤러리 */}
      <CommentImageGallery
        images={images}
        isEditMode={isEditMode}
        imageCurrentPage={imageCurrentPage}
        setImageCurrentPage={setImageCurrentPage}
        onViewImage={(index) => setViewerInfo({ index })}
      />

      {/* 수정·삭제 (작성자만, 우측 하단) */}
      {!isEditMode && isOwner && (onEdit || onDelete) && (
        <div className="flex items-center justify-end gap-3 mt-1">
          {onEdit && (
            <button
              type="button"
              onClick={handleEditClick}
              className="text-[13px] text-[#999999] hover:text-[#1A1A1A] transition-colors"
            >
              수정
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={handleDeleteClick}
              disabled={isDeleting}
              className="text-[13px] transition-colors disabled:opacity-50"
              style={{ color: '#CC3333' }}
            >
              {isDeleting ? '삭제 중...' : '삭제'}
            </button>
          )}
        </div>
      )}

      {/* 전체화면 이미지 뷰어 */}
      {viewerInfo && (
        <ImageViewer
          urls={images}
          initialIndex={viewerInfo.index}
          onClose={() => setViewerInfo(null)}
        />
      )}

      {/* 삭제 확인 */}
      {showDeleteConfirm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-3 p-3"
          style={{
            border: '1px solid #8B1A1A',
            backgroundColor: '#FEE2E2',
          }}
        >
          <p className="text-xs mb-2" style={{ color: '#8B1A1A' }}>
            댓글을 삭제하시겠습니까?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirmDelete}
              className="px-3 py-1 text-xs transition-colors"
              style={{
                backgroundColor: '#8B1A1A',
                color: '#F5F0E8',
              }}
            >
              삭제
            </button>
            <button
              type="button"
              onClick={handleCancelDelete}
              className="px-3 py-1 text-xs transition-colors"
              style={{
                border: '1px solid #1A1A1A',
                backgroundColor: 'transparent',
                color: '#1A1A1A',
              }}
            >
              취소
            </button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

export default memo(CommentItem);
