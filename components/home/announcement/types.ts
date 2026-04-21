import { Timestamp } from '@/lib/repositories';
import React from 'react';

// ─── 타입 ───────────────────────────────────────────────

export interface FileAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
}

/** 투표 타입 — 객관식(선택지) 또는 주관식(자유 응답) */
export type PollType = 'choice' | 'text';

export interface Poll {
  question: string;
  type?: PollType;                      // 'text'면 주관식, 미지정/choice면 객관식 (레거시 호환)
  options: string[];                    // 주관식은 빈 배열로 저장
  /**
   * @deprecated 신규 데이터는 서브컬렉션 pollVotes에 저장됨.
   * 레거시 공지 호환용 — 읽기 전용으로만 참고.
   */
  votes?: Record<string, string[]>;
  /** 선택지별 집계 카운트 (학생/교수 공통 노출) */
  voteCounts?: Record<string, number>;
  /** 주관식 응답 수 (집계값만 노출) */
  responseCount?: number;
  allowMultiple: boolean;
  maxSelections?: number;
}

export interface EditingPoll {
  question: string;
  type: PollType;
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
  profileRabbitId?: number;
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
  // 타입별 필터 + 기본값 채우기
  return polls
    .filter((p) => {
      if (!p) return false;
      if (p.type === 'text') return typeof p.question === 'string';
      // 객관식: options 필요
      return Array.isArray(p.options) && p.options.length > 0;
    })
    .map((p) => ({
      ...p,
      type: p.type ?? 'choice',
      options: Array.isArray(p.options) ? p.options : [],
      votes: p.votes && typeof p.votes === 'object' && !Array.isArray(p.votes) ? p.votes : {},
      voteCounts: p.voteCounts && typeof p.voteCounts === 'object' && !Array.isArray(p.voteCounts) ? p.voteCounts : {},
    }));
}

/**
 * 선택지별 투표 수 계산 — voteCounts 우선, 없으면 레거시 votes 배열 길이
 * 신규 데이터는 voteCounts, 레거시 공지는 votes → 둘 다 처리
 */
export function getVoteCount(p: Poll, optIdx: number): number {
  const key = String(optIdx);
  if (p.voteCounts && typeof p.voteCounts[key] === 'number') {
    return p.voteCounts[key];
  }
  const arr = p.votes?.[key];
  return Array.isArray(arr) ? arr.length : 0;
}

/** 투표 총 참여자 수 — voteCounts 합산 or 레거시 votes 유니크 UID 수 */
export function getTotalVoters(p: Poll): number {
  if (p.responseCount !== undefined) return p.responseCount;
  if (p.voteCounts) {
    // 복수선택이면 중복 집계되지만 대략적 표시용
    return Object.values(p.voteCounts).reduce((a, b) => a + b, 0);
  }
  if (p.votes) {
    const all = new Set<string>();
    for (const arr of Object.values(p.votes)) {
      if (Array.isArray(arr)) arr.forEach((id) => all.add(id));
    }
    return all.size;
  }
  return 0;
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
