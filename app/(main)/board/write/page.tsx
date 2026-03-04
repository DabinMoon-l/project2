'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import WriteForm from '@/components/board/WriteForm';
import { useCreatePost, type CreatePostData, type BoardTag } from '@/lib/hooks/useBoard';
import { useExpToast, Modal } from '@/components/common';
import { useUser, useCourse } from '@/lib/contexts';

// localStorage 키
const DRAFT_KEY = 'board-write-draft';

interface Draft {
  title: string;
  content: string;
  tag?: BoardTag;
  savedAt: number;
}

// ============================================================
// 글 작성 페이지
// ============================================================

export default function WritePage() {
  const router = useRouter();
  const { theme } = useTheme();
  const { createPost, loading, error } = useCreatePost();
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const { showExpToast } = useExpToast();

  // 모달 상태
  const [showExitModal, setShowExitModal] = useState(false);

  // 현재 드래프트 상태 (ref + state)
  const draftRef = useRef<{ title: string; content: string; tag?: BoardTag }>({ title: '', content: '' });
  const [hasContent, setHasContent] = useState(false);

  // 드래프트 복원
  const [initialTitle, setInitialTitle] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [initialTag, setInitialTag] = useState<BoardTag | undefined>();
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
          setInitialTag(draft.tag);
          draftRef.current = { title: draft.title, content: draft.content, tag: draft.tag };
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
  const handleDraftChange = useCallback((title: string, content: string, tag?: BoardTag) => {
    draftRef.current = { title, content, tag };
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
      tag: draftRef.current.tag,
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
      courseId: userCourseId || profile?.courseId || undefined,
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
  }, [createPost, router, profile, userCourseId, showExpToast]);

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
          initialTag={initialTag}
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
      <Modal
        isOpen={showExitModal}
        onClose={() => setShowExitModal(false)}
        size="sm"
        showCloseButton={false}
      >
        <div className="text-center">
          <p className="text-sm font-bold text-gray-900 mb-1">
            작성을 중단하시겠습니까?
          </p>
          <p className="text-xs text-gray-500 leading-relaxed">
            {hasContent
              ? '임시 저장하면 나중에 이어서 작성할 수 있습니다.'
              : '작성된 내용이 없습니다.'
            }
          </p>
        </div>
        <div className="flex flex-col gap-2 mt-4">
          <button
            onClick={() => setShowExitModal(false)}
            className="w-full py-2.5 text-sm font-bold text-white bg-[#1A1A1A] rounded-xl hover:bg-[#2A2A2A] transition-colors"
          >
            계속 작성하기
          </button>
          {hasContent && (
            <button
              onClick={handleSaveAndExit}
              className="w-full py-2.5 text-sm font-bold text-[#1A1A1A] bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
            >
              임시저장하고 나가기
            </button>
          )}
          <button
            onClick={handleExitWithoutSave}
            className="w-full py-2.5 text-sm font-bold text-[#8B1A1A] bg-gray-100 rounded-xl hover:bg-red-50 transition-colors"
          >
            저장하지 않고 나가기
          </button>
        </div>
      </Modal>
    </div>
  );
}
