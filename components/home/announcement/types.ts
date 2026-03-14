import { Timestamp } from '@/lib/repositories';
import React from 'react';

// ─── 타입 ───────────────────────────────────────────────

export interface FileAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
}

export interface Poll {
  question: string;
  options: string[];
  votes: Record<string, string[]>;
  allowMultiple: boolean;
  maxSelections?: number;
}

export interface EditingPoll {
  question: string;
  options: string[];
  allowMultiple: boolean;
  maxSelections: number;
}

export interface Announcement {
  id: string;
  content: string;
  imageUrl?: string;
  imageUrls?: string[];
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  files?: FileAttachment[];
  poll?: Poll;
  polls?: Poll[];
  reactions: Record<string, string[]>;
  readBy?: string[];
  createdAt: Timestamp;
  createdBy: string;
  courseId: string;
}

/** 수정 제출 데이터 */
export interface EditSubmitData {
  content: string;
  keepImageUrls: string[];
  newImageFiles: File[];
  keepFiles: FileAttachment[];
  newFiles: File[];
  polls: Poll[];
  resetPollIndices: number[]; // 투표 결과 초기화할 인덱스
  originalPolls?: Poll[]; // 옵션 변경 감지용 원본
}

// ─── 상수 ───────────────────────────────────────────────

export const REACTION_EMOJIS = ['❤️', '👍', '🔥', '😂', '😮', '😢'];
export const BUBBLE_C = 14;
export const BUBBLE_SIDE_MULTI = 26; // 다중 아이템 버블 좌우 패딩 (화살표 공간)
export const ARROW_ZONE = 30; // BUBBLE_SIDE_MULTI + content px-1(4px) = 화살표 영역 너비

// ─── 9-slice 말풍선 ─────────────────────────────────────

// 9-slice 스타일 상수 (매 렌더마다 객체 재생성 방지)
// 가장자리를 코너와 1px 겹쳐서 서브픽셀 갭(절단선) 방지
const _bg = (name: string) => `url(/notice/bubble_professor_${name}.png)`;
const _C = BUBBLE_C;
const _O = 1; // overlap
export const BUBBLE_STYLES = {
  tl: { width: _C, height: _C, backgroundImage: _bg('tl'), backgroundSize: 'cover' } as React.CSSProperties,
  tr: { width: _C, height: _C, backgroundImage: _bg('tr'), backgroundSize: 'cover' } as React.CSSProperties,
  bl: { width: _C, height: _C, backgroundImage: _bg('bl'), backgroundSize: 'cover' } as React.CSSProperties,
  br: { width: _C, height: _C, backgroundImage: _bg('br'), backgroundSize: 'cover' } as React.CSSProperties,
  top: { top: 0, left: _C - _O, right: _C - _O, height: _C, backgroundImage: _bg('top'), backgroundSize: '100% 100%' } as React.CSSProperties,
  bottom: { bottom: 0, left: _C - _O, right: _C - _O, height: _C, backgroundImage: _bg('bottom'), backgroundSize: '100% 100%' } as React.CSSProperties,
  left: { top: _C - _O, left: 0, width: _C, bottom: _C - _O, backgroundImage: _bg('left'), backgroundSize: '100% 100%' } as React.CSSProperties,
  right: { top: _C - _O, right: 0, width: _C, bottom: _C - _O, backgroundImage: _bg('right'), backgroundSize: '100% 100%' } as React.CSSProperties,
  center: { top: _C - _O, left: _C - _O, right: _C - _O, bottom: _C - _O, backgroundImage: _bg('center'), backgroundSize: '100% 100%' } as React.CSSProperties,
  padDefault: { padding: `${_C}px` } as React.CSSProperties,
  padMulti: { padding: `${_C}px ${BUBBLE_SIDE_MULTI}px` } as React.CSSProperties,
};

// ─── 유틸 ───────────────────────────────────────────────

/** 이미지 URL 배열 추출 (하위 호환) */
export function getImageUrls(a: Announcement): string[] {
  return a.imageUrls ?? (a.imageUrl ? [a.imageUrl] : []);
}

/** 투표 배열 추출 (하위 호환 + 객체→배열 복구 + 유효성 필터) */
export function getPolls(a: Announcement): Poll[] {
  let polls: Poll[] = [];
  if (a.polls) {
    // Firestore가 배열을 객체로 변환한 경우 복구
    polls = Array.isArray(a.polls) ? a.polls : Object.values(a.polls as Record<string, Poll>);
  } else if (a.poll) {
    polls = [a.poll];
  }
  // options 없는 깨진 데이터 필터 + votes 타입 검증
  return polls.filter((p) => p && Array.isArray(p.options) && p.options.length > 0).map((p) => ({
    ...p,
    votes: (p.votes && typeof p.votes === 'object' && !Array.isArray(p.votes)) ? p.votes : {},
  }));
}

/** 파일 배열 추출 (하위 호환) */
export function getFiles(a: Announcement): FileAttachment[] {
  return a.files ?? (a.fileUrl ? [{ url: a.fileUrl, name: a.fileName || '파일', type: a.fileType || '', size: a.fileSize || 0 }] : []);
}

export function fmtDate(ts: Timestamp): string {
  if (!ts) return '';
  return ts.toDate().toLocaleDateString('ko-KR', {
    month: 'long', day: 'numeric', weekday: 'long',
  });
}

export function dateKey(ts: Timestamp): string {
  if (!ts) return '';
  return ts.toDate().toDateString();
}

export function fmtTime(ts: Timestamp): string {
  if (!ts) return '';
  return ts.toDate().toLocaleTimeString('ko-KR', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function lastReadKey(cid: string) {
  return `announcement_lastRead_${cid}`;
}

/** URL 정규식 */
export const URL_RE = /https?:\/\/[^\s<>"']+/g;
