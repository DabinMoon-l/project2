'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/styles/themes/useTheme';
import WriteForm from '@/components/board/WriteForm';
import { useCreatePost, type CreatePostData } from '@/lib/hooks/useBoard';
import { useExpToast } from '@/components/common';
import { useUser } from '@/lib/contexts';

/**
 * 글 작성 페이지 - 신문 스타일
 */
export default function WritePage() {
  const router = useRouter();
  const { theme } = useTheme();
  const { createPost, loading, error } = useCreatePost();
  const { profile } = useUser();
  const { showExpToast } = useExpToast();

  /**
   * 글 작성 제출
   */
  const handleSubmit = useCallback(async (data: CreatePostData) => {
    // courseId 추가하여 과목별 분리
    const postData: CreatePostData = {
      ...data,
      courseId: profile?.courseId || undefined,
    };

    const postId = await createPost(postData);
    if (postId) {
      // EXP 토스트 표시 (게시글 작성 5 XP)
      // Cloud Functions에서 자동으로 EXP가 지급됨
      const earnedExp = 5;
      showExpToast(earnedExp, '게시글 작성');
      // 토스트 표시 후 이동
      setTimeout(() => {
        router.replace(`/board/${postId}`);
      }, 300);
    }
  }, [createPost, router, profile, showExpToast]);

  /**
   * 뒤로가기
   */
  const handleBack = useCallback(() => {
    if (window.confirm('작성 중인 내용이 사라집니다. 나가시겠습니까?')) {
      router.back();
    }
  }, [router]);

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
          <span>Back to Headlines</span>
        </button>

        {/* 신문 제목 */}
        <div className="text-center">
          <h1 className="font-serif-display text-3xl font-black tracking-tight text-[#1A1A1A]">
            JIBDAN JISUNG
          </h1>
          <p className="text-sm text-[#3A3A3A] mt-1  italic">
            "Submit Your Question"
          </p>
        </div>
      </header>

      {/* 페이지 제목 */}
      <div className="px-4 pt-6 pb-4">
        <div className="flex items-center justify-center gap-4">
          <div className="flex-1 h-px bg-[#1A1A1A]" />
          <h2 className="font-serif-display text-xl font-bold text-[#1A1A1A]">
            COMPOSE ARTICLE
          </h2>
          <div className="flex-1 h-px bg-[#1A1A1A]" />
        </div>
        <p className="text-center text-sm  italic mt-2" style={{ color: theme.colors.textSecondary }}>
          궁금한 점을 질문해보세요
        </p>
      </div>

      {/* 메인 컨텐츠 */}
      <main className="px-4">
        <WriteForm
          onSubmit={handleSubmit}
          isSubmitting={loading}
          error={error}
        />
      </main>

      {/* 하단 장식 */}
      <div className="mt-8 mx-4">
        <div className="border-t-4 border-double border-[#1A1A1A] pt-2">
          <p className="text-center text-sm text-[#3A3A3A]  italic">
            © {new Date().getFullYear()} Jibdan Jisung. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
