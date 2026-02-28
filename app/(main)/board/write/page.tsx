'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useTheme } from '@/styles/themes/useTheme';
import WriteForm from '@/components/board/WriteForm';
import { useCreatePost, type CreatePostData } from '@/lib/hooks/useBoard';
import { useExpToast } from '@/components/common';
import { useUser } from '@/lib/contexts';

// localStorage 키
const DRAFT_KEY = 'board-write-draft';

interface Draft {
  title: string;
  content: string;
  savedAt: number;
}

// ============================================================
// 나가기 확인 모달 (ExitConfirmModal과 동일한 디자인)
// ============================================================

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: {
    opacity: 1, scale: 1, y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 25 },
  },
  exit: {
    opacity: 0, scale: 0.95, y: 10,
    transition: { duration: 0.15 },
  },
};

function WriteExitModal({
  isOpen,
  onClose,
  onSaveAndExit,
  onExitWithoutSave,
  hasContent,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaveAndExit: () => void;
  onExitWithoutSave: () => void;
  hasContent: boolean;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      modalRef.current?.focus();
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            variants={backdropVariants}
            initial="hidden" animate="visible" exit="exit"
            onClick={handleBackdropClick}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            aria-hidden="true"
          />

          <motion.div
            ref={modalRef}
            variants={modalVariants}
            initial="hidden" animate="visible" exit="exit"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="write-exit-title"
            aria-describedby="write-exit-desc"
            tabIndex={-1}
            className="relative w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] shadow-xl overflow-hidden focus:outline-none"
          >
            {/* 경고 아이콘 */}
            <div className="flex justify-center pt-4">
              <div className="w-12 h-12 border-2 border-[#8B6914] bg-[#FFF8E1] flex items-center justify-center">
                <svg className="w-6 h-6 text-[#8B6914]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>

            {/* 본문 */}
            <div className="px-5 py-3 text-center">
              <h2 id="write-exit-title" className="text-sm font-bold text-[#1A1A1A] mb-2">
                작성을 중단하시겠습니까?
              </h2>
              <p id="write-exit-desc" className="text-xs text-[#5C5C5C] leading-relaxed">
                {hasContent
                  ? <>임시 저장하면 나중에<br />이어서 작성할 수 있습니다.</>
                  : '작성된 내용이 없습니다.'
                }
              </p>
            </div>

            {/* 버튼 영역 */}
            <div className="flex flex-col gap-2 px-5 py-3 border-t-2 border-[#1A1A1A] bg-[#EDEAE4]">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                className="w-full py-2 font-bold text-[#F5F0E8] bg-[#1A1A1A] border-2 border-[#1A1A1A] transition-all duration-200 hover:bg-[#2A2A2A]"
              >
                계속 작성하기
              </motion.button>

              {hasContent && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onSaveAndExit}
                  className="w-full py-2 font-bold bg-[#F5F0E8] text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#E5E0D8] transition-all duration-200"
                >
                  임시저장하고 나가기
                </motion.button>
              )}

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onExitWithoutSave}
                className="w-full py-2 font-bold bg-[#F5F0E8] text-[#8B1A1A] border-2 border-[#8B1A1A] hover:bg-[#FDEAEA] transition-all duration-200"
              >
                저장하지 않고 나가기
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ============================================================
// 글 작성 페이지
// ============================================================

export default function WritePage() {
  const router = useRouter();
  const { theme } = useTheme();
  const { createPost, loading, error } = useCreatePost();
  const { profile } = useUser();
  const { showExpToast } = useExpToast();

  // 모달 상태
  const [showExitModal, setShowExitModal] = useState(false);

  // 현재 드래프트 상태 (ref + state)
  const draftRef = useRef<{ title: string; content: string }>({ title: '', content: '' });
  const [hasContent, setHasContent] = useState(false);

  // 드래프트 복원
  const [initialTitle, setInitialTitle] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [draftRestored, setDraftRestored] = useState(false);

  // 마운트 시 임시저장 복원
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft: Draft = JSON.parse(saved);
        // 24시간 이내의 드래프트만 복원
        if (Date.now() - draft.savedAt < 24 * 60 * 60 * 1000) {
          setInitialTitle(draft.title);
          setInitialContent(draft.content);
          draftRef.current = { title: draft.title, content: draft.content };
          setHasContent(draft.title.trim().length > 0 || draft.content.trim().length > 0);
          setDraftRestored(true);
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      }
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  // 드래프트 복원 토스트
  useEffect(() => {
    if (draftRestored) {
      const timer = setTimeout(() => setDraftRestored(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [draftRestored]);

  // WriteForm에서 변경 콜백
  const handleDraftChange = useCallback((title: string, content: string) => {
    draftRef.current = { title, content };
    setHasContent(title.trim().length > 0 || content.trim().length > 0);
  }, []);

  // 뒤로가기 → 모달 표시
  const handleBack = useCallback(() => {
    if (hasContent) {
      setShowExitModal(true);
    } else {
      router.back();
    }
  }, [hasContent, router]);

  // 임시저장하고 나가기
  const handleSaveAndExit = useCallback(() => {
    const draft: Draft = {
      title: draftRef.current.title,
      content: draftRef.current.content,
      savedAt: Date.now(),
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    setShowExitModal(false);
    router.back();
  }, [router]);

  // 저장하지 않고 나가기
  const handleExitWithoutSave = useCallback(() => {
    localStorage.removeItem(DRAFT_KEY);
    setShowExitModal(false);
    router.back();
  }, [router]);

  // 글 게시 성공 시 드래프트 삭제
  const handleSubmit = useCallback(async (data: CreatePostData) => {
    const postData: CreatePostData = {
      ...data,
      courseId: profile?.courseId || undefined,
    };

    const postId = await createPost(postData);
    if (postId) {
      // 게시 성공 → 드래프트 삭제
      localStorage.removeItem(DRAFT_KEY);

      if (profile?.role !== 'professor') {
        showExpToast(15, '게시글 작성');
      }
      setTimeout(() => {
        router.replace(`/board/${postId}`);
      }, 300);
    }
  }, [createPost, router, profile, showExpToast]);

  return (
    <div
      className="min-h-screen pb-6 overflow-x-hidden"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* 뒤로가기 */}
      <header className="mx-4 mt-3 pb-2">
        <button
          onClick={handleBack}
          className="flex items-center py-1 text-[#3A3A3A]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </header>

      <div className="mx-4 border-b-2 border-[#1A1A1A] mb-3" />

      {/* 페이지 제목 */}
      <div className="px-4 pb-3">
        <div className="flex items-center justify-center gap-4">
          <div className="flex-1 h-px bg-[#1A1A1A]" />
          <h2 className="font-serif-display text-xl font-bold text-[#1A1A1A]">
            WRITE ARTICLE
          </h2>
          <div className="flex-1 h-px bg-[#1A1A1A]" />
        </div>
        <p className="text-center text-xs mt-1" style={{ color: theme.colors.textSecondary }}>
          궁금한 점을 질문해보세요
        </p>
      </div>

      {/* 메인 컨텐츠 */}
      <main className="px-4">
        <WriteForm
          onSubmit={handleSubmit}
          isSubmitting={loading}
          error={error}
          initialTitle={initialTitle}
          initialContent={initialContent}
          onDraftChange={handleDraftChange}
        />
      </main>

      {/* 임시저장 복원 토스트 */}
      <AnimatePresence>
        {draftRestored && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-12 inset-x-0 z-50 mx-auto w-fit px-5 py-2.5 bg-[#1A1A1A] text-[#F5F0E8] text-sm font-bold shadow-lg rounded-lg"
          >
            임시저장된 글을 불러왔습니다
          </motion.div>
        )}
      </AnimatePresence>

      {/* 나가기 확인 모달 */}
      <WriteExitModal
        isOpen={showExitModal}
        onClose={() => setShowExitModal(false)}
        onSaveAndExit={handleSaveAndExit}
        onExitWithoutSave={handleExitWithoutSave}
        hasContent={hasContent}
      />
    </div>
  );
}
