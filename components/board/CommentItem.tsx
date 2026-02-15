'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
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
  return date.toLocaleDateString('ko-KR');
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

  // 댓글이 3줄 이상인지 확인 (약 57자 이상 또는 줄바꿈 3개 이상)
  const isLongContent = comment.content.length > 57 || (comment.content.match(/\n/g) || []).length >= 3;

  const isOwner = currentUserId === comment.authorId;

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
      className={`py-3 ${!isReply ? 'border-b border-dashed border-[#D4CFC4]' : ''}`}
    >
      {/* 댓글 헤더 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {/* ㄴ 표시 */}
          <span className="text-base font-bold text-[#3A3A3A]">ㄴ</span>

          {/* 작성자 이름: 닉네임·반·계급 형식 */}
          <span
            className="text-sm font-semibold"
            style={{ color: theme.colors.text }}
          >
            {comment.authorNickname}·{comment.authorClassType || '?'}반
          </span>

          {/* 구분선 */}
          <span className="text-[#3A3A3A]">·</span>

          {/* 시간 */}
          <span className="text-sm text-[#3A3A3A]">
            {formatDate(comment.createdAt)}
          </span>
        </div>

        {/* 버튼들 */}
        <div className="flex items-center gap-2">
          {/* 좋아요 버튼 */}
          {onLike && !isEditMode && (
            <button
              type="button"
              onClick={() => onLike(comment.id)}
              className="flex items-center gap-1 text-xs transition-colors"
              style={{ color: isLiked ? '#8B1A1A' : '#3A3A3A' }}
            >
              <span>{isLiked ? '♥' : '♡'}</span>
              {(comment.likes || 0) > 0 && <span>{comment.likes}</span>}
            </button>
          )}

          {/* 답글 버튼 (대댓글이 아닌 경우만) */}
          {!isReply && onReply && !isEditMode && (
            <button
              type="button"
              onClick={onReply}
              className="text-xs text-[#3A3A3A] hover:text-[#1A1A1A] transition-colors"
            >
              답글
            </button>
          )}

          {/* 수정 버튼 (내 댓글인 경우만) */}
          {isOwner && onEdit && !isEditMode && (
            <button
              type="button"
              onClick={handleEditClick}
              className="text-xs text-[#3A3A3A] hover:text-[#1A1A1A] transition-colors"
            >
              수정
            </button>
          )}

          {/* 삭제 버튼 */}
          {isOwner && onDelete && !isEditMode && (
            <button
              type="button"
              onClick={handleDeleteClick}
              disabled={isDeleting}
              className="text-xs transition-colors disabled:opacity-50"
              style={{ color: '#8B1A1A' }}
            >
              {isDeleting ? '삭제 중...' : '삭제'}
            </button>
          )}
        </div>
      </div>

      {/* 댓글 내용 (수정 모드 / 일반 모드) */}
      {isEditMode ? (
        <div className="pl-5 space-y-2">
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
        <div className="pl-5 overflow-hidden max-w-full">
          <p
            className={`text-sm whitespace-pre-wrap leading-relaxed ${
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

      {/* 삭제 확인 */}
      {showDeleteConfirm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-3 ml-5 p-3"
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
