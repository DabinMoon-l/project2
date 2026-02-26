'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { ImageViewer } from '@/components/common';
import type { Comment } from '@/lib/hooks/useBoard';

interface CommentItemProps {
  comment: Comment;
  currentUserId?: string;
  onDelete?: (commentId: string) => void;
  onEdit?: (commentId: string, content: string) => void;
  onReply?: () => void;
  onLike?: (commentId: string) => void;
  isLiked?: boolean;
  isDeleting?: boolean;
  isEditing?: boolean;
  isReply?: boolean;
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
 * 댓글 아이템 컴포넌트 (대댓글 지원, 수정 기능 포함)
 */
export default function CommentItem({
  comment,
  currentUserId,
  onDelete,
  onEdit,
  onReply,
  onLike,
  isLiked = false,
  isDeleting = false,
  isEditing: isEditingProp = false,
  isReply = false,
}: CommentItemProps) {
  const { theme } = useTheme();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [isExpanded, setIsExpanded] = useState(false);
  const [viewerInfo, setViewerInfo] = useState<{ index: number } | null>(null);
  const [imageCurrentPage, setImageCurrentPage] = useState(0);

  // 댓글이 3줄 이상인지 확인 (약 57자 이상 또는 줄바꿈 3개 이상)
  const isLongContent = comment.content.length > 57 || (comment.content.match(/\n/g) || []).length >= 3;
  const images = comment.imageUrls || [];

  const isOwner = currentUserId === comment.authorId;

  // 작성자 표시: 반 정보 있으면 닉네임·반, 없으면(교수님) 닉네임만
  const authorDisplay = comment.authorClassType
    ? `${comment.authorNickname}·${comment.authorClassType}반`
    : comment.authorNickname;

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
    setIsEditMode(true);
  };

  const handleSaveEdit = () => {
    if (editContent.trim() && onEdit) {
      onEdit(comment.id, editContent.trim());
      setIsEditMode(false);
    }
  };

  const handleCancelEdit = () => {
    setEditContent(comment.content);
    setIsEditMode(false);
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
            className="text-[16px] font-semibold"
            style={{ color: theme.colors.text }}
          >
            {isReply && <span className="text-[13px] font-bold text-[#999] mr-1">ㄴ</span>}
            {authorDisplay}
          </span>
          <span className="text-[#AAAAAA] text-[13px]">·</span>
          <span className="text-[14px] text-[#999999]">
            {formatDate(comment.createdAt)}
          </span>
        </div>

        {!isEditMode && (
          <div className="flex items-center gap-2.5">
            {!isReply && onReply && (
              <button
                type="button"
                onClick={onReply}
                className="text-[14px] text-[#999999] hover:text-[#1A1A1A] transition-colors"
              >
                답글
              </button>
            )}
            {onLike && (
              <button
                type="button"
                onClick={() => onLike(comment.id)}
                className="flex items-center gap-1 text-[14px] transition-colors"
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
            className="w-full px-3 py-2 text-sm outline-none resize-none leading-relaxed"
            style={{
              border: '1px solid #1A1A1A',
              backgroundColor: theme.colors.background,
              color: theme.colors.text,
            }}
            rows={3}
            maxLength={500}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={!editContent.trim() || isEditingProp}
              className="px-3 py-1 text-xs disabled:opacity-50"
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
              className="px-3 py-1 text-xs"
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
      ) : (
        <div className="overflow-hidden max-w-full">
          <p
            className={`text-[18px] whitespace-pre-wrap leading-relaxed ${
              !isExpanded && isLongContent ? 'line-clamp-3' : ''
            }`}
            style={{
              color: theme.colors.text,
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
            }}
          >
            {comment.content}
          </p>
          {/* 더보기/접기 버튼 */}
          {isLongContent && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs mt-1 transition-colors"
              style={{ color: '#5C5C5C' }}
            >
              {isExpanded ? '접기' : '...더보기'}
            </button>
          )}
        </div>
      )}

      {/* 이미지 갤러리 */}
      {images.length > 0 && !isEditMode && (() => {
        // 2장씩 페이지 분할
        const pages: string[][] = [];
        for (let i = 0; i < images.length; i += 2) {
          pages.push(images.slice(i, i + 2));
        }
        const totalPages = pages.length;

        return (
          <div className="mt-2">
            <div className="grid grid-cols-2 gap-2">
              {pages[imageCurrentPage]?.map((url, index) => {
                const globalIndex = imageCurrentPage * 2 + index;
                return (
                  <div
                    key={`${imageCurrentPage}-${index}`}
                    className="relative aspect-square bg-gray-100 cursor-pointer"
                    onClick={() => setViewerInfo({ index: globalIndex })}
                  >
                    <img src={url} alt={`이미지 ${globalIndex + 1}`} className="w-full h-full object-cover" draggable={false} />
                  </div>
                );
              })}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-2">
                <button onClick={() => setImageCurrentPage(p => Math.max(0, p - 1))} disabled={imageCurrentPage === 0} className="px-2 py-0.5 text-xs disabled:opacity-30" style={{ border: '1px solid #1A1A1A' }}>←</button>
                <span className="text-xs text-[#3A3A3A]">{imageCurrentPage + 1} / {totalPages}</span>
                <button onClick={() => setImageCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={imageCurrentPage === totalPages - 1} className="px-2 py-0.5 text-xs disabled:opacity-30" style={{ border: '1px solid #1A1A1A' }}>→</button>
              </div>
            )}
          </div>
        );
      })()}

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
