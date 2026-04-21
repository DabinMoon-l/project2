'use client';

import { useState, useEffect } from 'react';
import { postRepo } from '@/lib/repositories';
import LinkifiedText from '@/components/board/LinkifiedText';

function formatDate(date: Date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}. ${m}. ${d}. ${h}:${min}`;
}

interface SharedPost {
  title: string;
  content: string;
  authorNickname: string;
  authorClassType?: string;
  tag?: string;
  imageUrl?: string;
  imageUrls?: string[];
  likes: number;
  commentCount: number;
  viewCount: number;
  createdAt: Date;
}

interface SharedComment {
  id: string;
  parentId?: string;
  authorNickname: string;
  authorClassType?: string;
  authorId: string;
  content: string;
  imageUrls?: string[];
  isAIReply?: boolean;
  createdAt: Date;
}

export default function SharedPostClient({ postId }: { postId: string }) {
  const [post, setPost] = useState<SharedPost | null>(null);
  const [comments, setComments] = useState<SharedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const postDoc = await postRepo.getPost(postId);
        if (!postDoc) {
          setError('삭제되었거나 존재하지 않는 글입니다.');
          setLoading(false);
          return;
        }

        const data = postDoc as Record<string, unknown>;
        // 비공개 글도 공유 링크로는 열람 가능 (본인이 의도적으로 공유하는 것)
        setPost({
          title: (data.title as string) || '',
          content: (data.content as string) || '',
          authorNickname: (data.authorNickname as string) || '알 수 없음',
          authorClassType: data.authorClassType as string | undefined,
          tag: data.tag as string | undefined,
          imageUrl: data.imageUrl as string | undefined,
          imageUrls: data.imageUrls as string[] | undefined,
          likes: (data.likes as number) || 0,
          commentCount: (data.commentCount as number) || 0,
          viewCount: (data.viewCount as number) || 0,
          createdAt: (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.() || new Date(),
        });

        const commentDocs = await postRepo.fetchCommentsByPost(postId);
        setComments(commentDocs.map((d) => {
          const c = d as Record<string, unknown>;
          return {
            id: d.id,
            parentId: c.parentId as string | undefined,
            authorNickname: (c.authorNickname as string) || '알 수 없음',
            authorClassType: c.authorClassType as string | undefined,
            authorId: (c.authorId as string) || '',
            content: (c.content as string) || '',
            imageUrls: c.imageUrls as string[] | undefined,
            isAIReply: c.isAIReply as boolean | undefined,
            createdAt: (c.createdAt as { toDate?: () => Date } | undefined)?.toDate?.() || new Date(),
          };
        }));
      } catch (err) {
        console.error('공유 게시글 로드 실패:', err);
        setError('게시글을 불러올 수 없습니다.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [postId]);

  const allImages: string[] = [];
  if (post?.imageUrl) allImages.push(post.imageUrl);
  if (post?.imageUrls) {
    post.imageUrls.forEach(url => {
      if (!allImages.includes(url)) allImages.push(url);
    });
  }

  const rootComments = comments.filter(c => !c.parentId);
  const repliesMap = new Map<string, SharedComment[]>();
  comments.filter(c => c.parentId).forEach(c => {
    const arr = repliesMap.get(c.parentId!) || [];
    arr.push(c);
    repliesMap.set(c.parentId!, arr);
  });

  function authorLabel(c: { authorNickname: string; authorClassType?: string; authorId: string; isAIReply?: boolean }) {
    if (c.authorId === 'gemini-ai' || c.isAIReply) return c.authorNickname;
    if (c.authorClassType) return `${c.authorNickname}·${c.authorClassType}반`;
    return c.authorNickname.includes('교수') ? c.authorNickname : `${c.authorNickname} 교수님`;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#5C5C5C]">게시글을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ backgroundColor: '#F5F0E8' }}>
        <h3 className="text-xl font-bold mb-2 text-[#1A1A1A]">글을 찾을 수 없습니다</h3>
        <p className="text-sm mb-6 text-[#5C5C5C]">{error || '삭제되었거나 존재하지 않는 글입니다.'}</p>
        <a href="/" className="px-6 py-2 text-sm font-bold text-[#F5F0E8] bg-[#1A1A1A]">
          RabbiTory 홈으로
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 상단 바 */}
      <header className="px-4 py-3 border-b-2 border-[#1A1A1A] flex items-center justify-between">
        <span className="font-serif-display text-base font-black text-[#1A1A1A] tracking-wide">
          RABBITORY
        </span>
        <a href="/" className="text-[11px] font-bold text-[#F5F0E8] bg-[#1A1A1A] px-3 py-1.5">
          앱에서 보기
        </a>
      </header>

      <main className="px-4 py-5 max-w-2xl mx-auto">
        <article>
          {post.tag && (
            <span
              className="inline-block px-2 py-0.5 text-xs font-bold mb-2"
              style={{ border: '1px solid #1A1A1A', color: '#1A1A1A' }}
            >
              #{post.tag}
            </span>
          )}

          <h1 className="font-serif-display text-2xl md:text-3xl font-black leading-tight mb-3 text-[#1A1A1A]">
            {post.title}
          </h1>

          <div className="flex items-center justify-between text-xs text-[#5C5C5C] mb-4 pb-4 border-b border-dashed border-[#1A1A1A]">
            <span>
              {post.authorClassType
                ? `${post.authorNickname}·${post.authorClassType}반`
                : post.authorNickname.includes('교수') ? post.authorNickname : `${post.authorNickname} 교수님`
              }
            </span>
            <span>{formatDate(post.createdAt)}</span>
          </div>

          <div className="text-base leading-relaxed whitespace-pre-wrap text-[#1A1A1A] mb-4">
            <LinkifiedText text={post.content} />
          </div>

          {allImages.length > 0 && (
            <div className="space-y-2 mb-4">
              {allImages.map((url, i) => (
                <img key={i} src={url} alt={`이미지 ${i + 1}`} className="w-full h-auto max-h-[480px] object-contain bg-[#EBE5D9] rounded-sm" />
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 py-2 mt-2 border-t border-dashed border-[#1A1A1A] text-xs text-[#5C5C5C]">
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
              {post.likes}
            </span>
            <span>조회 {post.viewCount}</span>
            <span>댓글 {post.commentCount}</span>
          </div>
        </article>

        {rootComments.length > 0 && (
          <section className="pt-4 mt-4 border-t-2 border-[#1A1A1A]">
            <h3 className="font-bold text-base mb-3 text-[#1A1A1A]">댓글</h3>
            <div className="space-y-3">
              {rootComments.map(comment => (
                <div key={comment.id}>
                  <div className="pb-2">
                    <div className="flex items-center gap-2 mb-1">
                      {comment.isAIReply && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8]">AI</span>
                      )}
                      <span className="text-xs font-bold text-[#1A1A1A]">{authorLabel(comment)}</span>
                      <span className="text-[10px] text-[#999]">{formatDate(comment.createdAt)}</span>
                    </div>
                    <p className="text-sm text-[#1A1A1A] leading-relaxed whitespace-pre-wrap">{comment.content}</p>
                    {comment.imageUrls && comment.imageUrls.length > 0 && (
                      <div className="mt-2 flex gap-2">
                        {comment.imageUrls.map((url, i) => (
                          <img key={i} src={url} alt="" className="max-h-40 rounded-sm object-contain bg-[#EBE5D9]" />
                        ))}
                      </div>
                    )}
                  </div>
                  {(repliesMap.get(comment.id) || []).map(reply => (
                    <div key={reply.id} className="pl-4 pb-2 border-l-2 border-[#D4CFC4] ml-2">
                      <div className="flex items-center gap-2 mb-1">
                        {reply.isAIReply && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8]">AI</span>
                        )}
                        <span className="text-xs font-bold text-[#1A1A1A]">{authorLabel(reply)}</span>
                        <span className="text-[10px] text-[#999]">{formatDate(reply.createdAt)}</span>
                      </div>
                      <p className="text-sm text-[#1A1A1A] leading-relaxed whitespace-pre-wrap">{reply.content}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 mb-4 p-4 border-2 border-[#1A1A1A] text-center">
          <p className="text-sm font-bold text-[#1A1A1A] mb-1">RabbiTory에서 더 많은 글을 확인하세요</p>
          <p className="text-xs text-[#5C5C5C] mb-3">퀴즈, 토끼 키우기, 게시판까지</p>
          <a href="/" className="inline-block px-6 py-2 text-sm font-bold text-[#F5F0E8] bg-[#1A1A1A]">
            RabbiTory 바로가기
          </a>
        </div>
      </main>
    </div>
  );
}
