'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  usePinnedPosts,
  useToProfessorPosts,
  usePostsByClass,
  type Post,
} from '@/lib/hooks/useBoard';

interface BoardManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId?: string;
}

type TabType = 'pinned' | 'toProfessor' | 'byClass';
type ClassFilter = 'all' | 'A' | 'B' | 'C' | 'D';

/**
 * 교수님 뉴스창 관리 모달
 * - 고정 게시글
 * - 교수님께 전달된 글
 * - 반별 게시글
 */
export default function BoardManagementModal({
  isOpen,
  onClose,
  courseId,
}: BoardManagementModalProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('pinned');
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');

  // 데이터 로드
  const { pinnedPosts, loading: pinnedLoading, unpinPost } = usePinnedPosts(courseId);
  const { posts: toProfessorPosts, loading: toProfLoading } = useToProfessorPosts(courseId);
  const { posts: classPosts, loading: classLoading } = usePostsByClass(
    courseId,
    classFilter === 'all' ? undefined : classFilter
  );

  // 모달 열림 시 body 스크롤 방지
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // 고정글 가로 스크롤 ref
  const pinnedScrollRef = useRef<HTMLDivElement>(null);

  // 게시글 클릭 핸들러
  const handlePostClick = (postId: string) => {
    onClose();
    router.push(`/board/${postId}`);
  };

  // 현재 탭의 로딩 상태
  const isLoading = useMemo(() => {
    switch (activeTab) {
      case 'pinned':
        return pinnedLoading;
      case 'toProfessor':
        return toProfLoading;
      case 'byClass':
        return classLoading;
      default:
        return false;
    }
  }, [activeTab, pinnedLoading, toProfLoading, classLoading]);

  // 모달 닫기 시 탭 초기화
  const handleClose = () => {
    setActiveTab('pinned');
    setClassFilter('all');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
        onClick={handleClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-full max-w-lg bg-[#F5F0E8] max-h-[85vh] overflow-hidden flex flex-col"
          style={{ border: '2px solid #1A1A1A' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="p-4 border-b-2 border-[#1A1A1A] flex items-center justify-between">
            <h2 className="font-serif-display text-xl font-bold text-[#1A1A1A]">
              📋 뉴스창 관리
            </h2>
            <button
              onClick={handleClose}
              className="w-8 h-8 flex items-center justify-center text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
            >
              ✕
            </button>
          </div>

          {/* 탭 네비게이션 */}
          <div className="flex border-b border-[#D4CFC4]">
            <button
              onClick={() => setActiveTab('pinned')}
              className={`flex-1 py-3 text-sm font-bold transition-colors ${
                activeTab === 'pinned'
                  ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                  : 'text-[#1A1A1A] hover:bg-[#EDEAE4]'
              }`}
            >
              📌 고정글 ({pinnedPosts.length})
            </button>
            <button
              onClick={() => setActiveTab('toProfessor')}
              className={`flex-1 py-3 text-sm font-bold transition-colors ${
                activeTab === 'toProfessor'
                  ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                  : 'text-[#1A1A1A] hover:bg-[#EDEAE4]'
              }`}
            >
              📬 교수님께 ({toProfessorPosts.length})
            </button>
            <button
              onClick={() => setActiveTab('byClass')}
              className={`flex-1 py-3 text-sm font-bold transition-colors ${
                activeTab === 'byClass'
                  ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                  : 'text-[#1A1A1A] hover:bg-[#EDEAE4]'
              }`}
            >
              👥 반별
            </button>
          </div>

          {/* 컨텐츠 영역 */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-[#5C5C5C]">로딩 중...</div>
              </div>
            ) : (
              <>
                {/* 고정글 탭 - 가로 스크롤 */}
                {activeTab === 'pinned' && (
                  <div>
                    {pinnedPosts.length === 0 ? (
                      <div className="text-center py-12 text-[#5C5C5C]">
                        고정된 게시글이 없습니다
                      </div>
                    ) : (
                      <div
                        ref={pinnedScrollRef}
                        className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory"
                        style={{ scrollbarWidth: 'thin' }}
                      >
                        {pinnedPosts.map((post) => (
                          <PinnedPostCard
                            key={post.id}
                            post={post}
                            onClick={() => handlePostClick(post.id)}
                            onUnpin={() => unpinPost(post.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 교수님께 탭 */}
                {activeTab === 'toProfessor' && (
                  <div className="space-y-3">
                    {toProfessorPosts.length === 0 ? (
                      <div className="text-center py-12 text-[#5C5C5C]">
                        교수님께 전달된 글이 없습니다
                      </div>
                    ) : (
                      toProfessorPosts.map((post) => (
                        <PostListItem
                          key={post.id}
                          post={post}
                          onClick={() => handlePostClick(post.id)}
                        />
                      ))
                    )}
                  </div>
                )}

                {/* 반별 탭 */}
                {activeTab === 'byClass' && (
                  <div>
                    {/* 반 필터 */}
                    <div className="flex gap-2 mb-4">
                      {(['all', 'A', 'B', 'C', 'D'] as ClassFilter[]).map((cls) => (
                        <button
                          key={cls}
                          onClick={() => setClassFilter(cls)}
                          className={`px-3 py-1.5 text-sm font-bold transition-colors ${
                            classFilter === cls
                              ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                              : 'border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4]'
                          }`}
                        >
                          {cls === 'all' ? '전체' : `${cls}반`}
                        </button>
                      ))}
                    </div>

                    {/* 게시글 목록 */}
                    <div className="space-y-3">
                      {classPosts.length === 0 ? (
                        <div className="text-center py-12 text-[#5C5C5C]">
                          {classFilter === 'all'
                            ? '게시글이 없습니다'
                            : `${classFilter}반 게시글이 없습니다`}
                        </div>
                      ) : (
                        classPosts.map((post) => (
                          <PostListItem
                            key={post.id}
                            post={post}
                            onClick={() => handlePostClick(post.id)}
                            showClass
                          />
                        ))
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * 고정글 카드 (가로 스크롤용)
 */
function PinnedPostCard({
  post,
  onClick,
  onUnpin,
}: {
  post: Post;
  onClick: () => void;
  onUnpin: () => void;
}) {
  const imageUrl = post.imageUrl || post.imageUrls?.[0];

  return (
    <div
      className="flex-shrink-0 w-64 snap-start cursor-pointer group"
      style={{ border: '1px solid #1A1A1A' }}
    >
      {/* 이미지 영역 */}
      {imageUrl && (
        <div className="relative h-32 bg-[#EDEAE4]" onClick={onClick}>
          <Image
            src={imageUrl}
            alt={post.title}
            fill
            sizes="256px"
            className="object-cover"
          />
        </div>
      )}

      {/* 내용 영역 */}
      <div className="p-3" onClick={onClick}>
        <h3 className="font-bold text-sm text-[#1A1A1A] line-clamp-2 mb-1">
          {post.title}
        </h3>
        <p className="text-xs text-[#5C5C5C] line-clamp-2">{post.content}</p>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-[#5C5C5C]">
            {post.authorNickname}·{post.authorClassType || '?'}반
          </span>
          <span className="text-xs text-[#5C5C5C]">
            ❤️ {post.likes} 💬 {post.commentCount}
          </span>
        </div>
      </div>

      {/* 고정 해제 버튼 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onUnpin();
        }}
        className="w-full py-2 text-xs font-bold bg-[#8B1A1A] text-[#F5F0E8] hover:bg-[#6B1414] transition-colors"
      >
        고정 해제
      </button>
    </div>
  );
}

/**
 * 게시글 목록 아이템 (세로 목록용)
 */
function PostListItem({
  post,
  onClick,
  showClass = false,
}: {
  post: Post;
  onClick: () => void;
  showClass?: boolean;
}) {
  const imageUrl = post.imageUrl || post.imageUrls?.[0];

  return (
    <div
      onClick={onClick}
      className="flex gap-3 p-3 cursor-pointer hover:bg-[#EDEAE4] transition-colors"
      style={{ border: '1px solid #D4CFC4' }}
    >
      {/* 썸네일 */}
      {imageUrl && (
        <div className="relative w-16 h-16 flex-shrink-0 bg-[#EDEAE4]">
          <Image
            src={imageUrl}
            alt={post.title}
            fill
            sizes="64px"
            className="object-cover"
          />
        </div>
      )}

      {/* 내용 */}
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-sm text-[#1A1A1A] line-clamp-1">{post.title}</h3>
        <p className="text-xs text-[#5C5C5C] line-clamp-2 mt-0.5">{post.content}</p>
        <div className="flex items-center gap-2 mt-1 text-xs text-[#5C5C5C]">
          <span>
            {post.authorNickname}
            {showClass && `·${post.authorClassType || '?'}반`}
          </span>
          <span>·</span>
          <span>❤️ {post.likes}</span>
          <span>💬 {post.commentCount}</span>
          {post.toProfessor && (
            <span className="text-[#1A6B1A] font-bold">📬</span>
          )}
        </div>
      </div>
    </div>
  );
}
