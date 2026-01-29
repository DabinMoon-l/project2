'use client';

import { useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header, Skeleton } from '@/components/common';
import WriteForm from '@/components/board/WriteForm';
import { useCreatePost, type BoardCategory, type CreatePostData } from '@/lib/hooks/useBoard';

/**
 * 글 작성 페이지 내부 컴포넌트
 */
function WritePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const category = (searchParams.get('category') as BoardCategory) || 'toProfessor';

  const { createPost, loading, error } = useCreatePost();

  /**
   * 글 작성 제출
   */
  const handleSubmit = useCallback(async (data: CreatePostData) => {
    const postId = await createPost(data);
    if (postId) {
      router.replace(`/board/${postId}`);
    }
  }, [createPost, router]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <Header
        title="글 작성"
        showBack
        onBack={() => {
          if (window.confirm('작성 중인 내용이 사라집니다. 나가시겠습니까?')) {
            router.back();
          }
        }}
      />

      {/* 메인 컨텐츠 */}
      <main className="px-4 py-6 max-w-lg mx-auto">
        <WriteForm
          category={category}
          onSubmit={handleSubmit}
          isSubmitting={loading}
          error={error}
        />
      </main>
    </div>
  );
}

/**
 * 글 작성 페이지
 */
export default function WritePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50">
        <Header title="글 작성" showBack />
        <div className="px-4 py-6 space-y-4">
          <Skeleton className="w-24 h-8" />
          <Skeleton className="w-full h-12" />
          <Skeleton className="w-full h-48" />
        </div>
      </div>
    }>
      <WritePageContent />
    </Suspense>
  );
}
