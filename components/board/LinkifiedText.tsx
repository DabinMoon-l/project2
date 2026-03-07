'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { ImageViewer } from '@/components/common';

// URL 감지 정규식
const URL_REGEX = /https?:\/\/[^\s<]+/g;

// 이미지 URL 감지 (CommentSection/WriteForm의 패턴과 동일)
const IMAGE_EXT_PATTERN = /\.(?:jpg|jpeg|png|gif|webp|bmp|svg|tiff|ico|avif)(?:[?#]|$)/i;
const KNOWN_IMAGE_HOST_PATTERN = /^https?:\/\/(?:i\.imgur\.com|pbs\.twimg\.com|images\.unsplash\.com|lh[0-9]*\.googleusercontent\.com|firebasestorage\.googleapis\.com|encrypted-tbn[0-9]*\.gstatic\.com|blogfiles\.naver\.net|postfiles\.naver\.net|[a-z0-9-]+\.googleusercontent\.com|cdn\.discordapp\.com|media\.discordapp\.net|i\.namu\.wiki|upload\.wikimedia\.org|img\.icons8\.com)\//i;

function isImageUrl(url: string): boolean {
  return IMAGE_EXT_PATTERN.test(url) || KNOWN_IMAGE_HOST_PATTERN.test(url);
}

// 유튜브 URL에서 videoId 추출
function getYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if ((u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com' || u.hostname === 'm.youtube.com') && u.pathname === '/watch') {
      return u.searchParams.get('v');
    }
    if ((u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') && u.pathname.startsWith('/shorts/')) {
      return u.pathname.split('/shorts/')[1]?.split(/[/?]/)[0] || null;
    }
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1).split(/[/?]/)[0] || null;
    }
  } catch {}
  return null;
}

/** 인라인 이미지 (업로드 이미지와 동일하게 표시) */
function InlineImage({ url }: { url: string }) {
  const [error, setError] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  if (error) return null;

  return (
    <>
      <span
        className="block mt-2 mb-1 cursor-pointer"
        onClick={(e) => { e.stopPropagation(); setViewerOpen(true); }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          className="rounded-lg max-w-full max-h-[320px] object-contain"
          onError={() => setError(true)}
        />
      </span>
      {viewerOpen && (
        <ImageViewer
          urls={[url]}
          initialIndex={0}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </>
  );
}

/** 유튜브 미리보기 */
function YouTubePreview({ url, videoId }: { url: string; videoId: string }) {
  const [error, setError] = useState(false);

  if (error) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block mt-2 mb-1 rounded-lg overflow-hidden border border-[#D4CFC4] max-w-[400px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <Image
          src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
          alt="YouTube 미리보기"
          fill
          className="object-cover"
          onError={() => setError(true)}
          unoptimized
        />
        {/* 재생 버튼 오버레이 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-14 h-10 bg-red-600 rounded-xl flex items-center justify-center opacity-90">
            <svg className="w-6 h-6 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>
    </a>
  );
}

/** 일반 링크 미리보기 */
function LinkPreview({ url }: { url: string }) {
  let hostname = '';
  try { hostname = new URL(url).hostname.replace('www.', ''); } catch {}

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 mt-1.5 mb-1 px-3 py-2 rounded-lg border border-[#D4CFC4] bg-[#FDFBF7] max-w-[400px] hover:bg-[#F5F0E8] transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      <svg className="w-4 h-4 text-[#5C5C5C] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span className="text-sm text-[#2563EB] truncate">{hostname}</span>
    </a>
  );
}

type Part = string | { type: 'link'; url: string; key: number } | { type: 'image'; url: string; key: number };
type Preview = { type: 'youtube' | 'link'; url: string; videoId?: string; key: number };

interface LinkifiedTextProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 텍스트 내 URL 처리:
 * - 이미지 URL → 이미지로 렌더링 (업로드 이미지와 동일)
 * - 유튜브 URL → 하이퍼링크 + 썸네일 미리보기
 * - 일반 URL → 하이퍼링크 + 도메인 미리보기
 */
export default function LinkifiedText({ text, className, style }: LinkifiedTextProps) {
  const { parts, previews } = useMemo(() => {
    const parts: Part[] = [];
    const previews: Preview[] = [];
    const seenUrls = new Set<string>();

    let lastIndex = 0;
    let key = 0;
    let match: RegExpExecArray | null;
    const regex = new RegExp(URL_REGEX.source, 'g');

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      // 끝에 붙은 구두점 제거
      let url = match[0].replace(/[)}\].,;:!?]+$/, '');

      if (isImageUrl(url)) {
        // 이미지 URL → 텍스트에 URL 표시하지 않고 이미지로만 렌더링
        parts.push({ type: 'image', url, key: key++ });
      } else {
        // 일반/유튜브 링크 → 하이퍼링크 텍스트
        parts.push({ type: 'link', url, key: key++ });

        // 미리보기 (같은 URL 중복 방지)
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          const ytId = getYouTubeId(url);
          if (ytId) {
            previews.push({ type: 'youtube', url, videoId: ytId, key: key++ });
          } else {
            previews.push({ type: 'link', url, key: key++ });
          }
        }
      }

      lastIndex = match.index + match[0].length;
      const trimmed = match[0].length - url.length;
      if (trimmed > 0) {
        lastIndex -= trimmed;
      }
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return { parts, previews };
  }, [text]);

  return (
    <>
      <span className={className} style={style}>
        {parts.map((part, i) =>
          typeof part === 'string' ? (
            part
          ) : part.type === 'image' ? (
            <InlineImage key={part.key} url={part.url} />
          ) : (
            <a
              key={part.key}
              href={part.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#2563EB] underline underline-offset-2 break-all"
              onClick={(e) => e.stopPropagation()}
            >
              {part.url}
            </a>
          )
        )}
      </span>
      {previews.map((preview) =>
        preview.type === 'youtube' && preview.videoId ? (
          <YouTubePreview key={preview.key} url={preview.url} videoId={preview.videoId} />
        ) : (
          <LinkPreview key={preview.key} url={preview.url} />
        )
      )}
    </>
  );
}
