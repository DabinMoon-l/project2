'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  arrayUnion,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { useUpload } from '@/lib/hooks/useStorage';

// ─── 타입 ───────────────────────────────────────────────

interface FileAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
}

interface Announcement {
  id: string;
  content: string;
  imageUrl?: string;
  imageUrls?: string[];
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  files?: FileAttachment[];
  poll?: {
    question: string;
    options: string[];
    votes: Record<string, string[]>;
    allowMultiple: boolean;
  };
  reactions: Record<string, string[]>;
  readBy?: string[];
  createdAt: Timestamp;
  createdBy: string;
  courseId: string;
}

// ─── 상수 ───────────────────────────────────────────────

const REACTION_EMOJIS = ['❤️', '👍', '🔥', '😂', '😮', '😢'];
const BUBBLE_C = 20;

// ─── 유틸 ───────────────────────────────────────────────

/** 이미지 URL 배열 추출 (하위 호환) */
function getImageUrls(a: Announcement): string[] {
  return a.imageUrls ?? (a.imageUrl ? [a.imageUrl] : []);
}

/** 파일 배열 추출 (하위 호환) */
function getFiles(a: Announcement): FileAttachment[] {
  return a.files ?? (a.fileUrl ? [{ url: a.fileUrl, name: a.fileName || '파일', type: a.fileType || '', size: a.fileSize || 0 }] : []);
}

function fmtDate(ts: Timestamp): string {
  if (!ts) return '';
  return ts.toDate().toLocaleDateString('ko-KR', {
    month: 'long', day: 'numeric', weekday: 'long',
  });
}

function dateKey(ts: Timestamp): string {
  if (!ts) return '';
  return ts.toDate().toDateString();
}

function fmtTime(ts: Timestamp): string {
  if (!ts) return '';
  return ts.toDate().toLocaleTimeString('ko-KR', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function lastReadKey(cid: string) {
  return `announcement_lastRead_${cid}`;
}

// ─── 9-slice 말풍선 ─────────────────────────────────────

function Bubble({ children }: { children: React.ReactNode }) {
  const c = BUBBLE_C;
  const bg = (name: string, size = '100% 100%') => ({
    backgroundImage: `url(/notice/bubble_professor_${name}.png)`,
    backgroundSize: size,
    backgroundRepeat: 'no-repeat' as const,
  });
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `${c}px 1fr ${c}px`,
        gridTemplateRows: `${c}px 1fr ${c}px`,
      }}
    >
      <div style={bg('tl', 'cover')} />
      <div style={bg('top')} />
      <div style={bg('tr', 'cover')} />
      <div style={bg('left')} />
      <div style={bg('center')}>
        <div className="px-3 py-2">{children}</div>
      </div>
      <div style={bg('right')} />
      <div style={bg('bl', 'cover')} />
      <div style={bg('bottom')} />
      <div style={bg('br', 'cover')} />
    </div>
  );
}

// ─── 이미지 캐러셀 ─────────────────────────────────────

function ImageCarousel({
  urls,
  onImageClick,
}: {
  urls: string[];
  onImageClick: (url: string) => void;
}) {
  const [idx, setIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  if (urls.length === 0) return null;

  if (urls.length === 1) {
    return (
      <button onClick={() => onImageClick(urls[0])} className="mt-2 block w-full">
        <img src={urls[0]} alt="이미지" className="w-full aspect-[4/3] object-cover border border-[#D4CFC4]" />
      </button>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1">
        {/* 좌측 화살표 */}
        <button
          onClick={() => { if (idx > 0) containerRef.current?.scrollTo({ left: (idx - 1) * (containerRef.current?.clientWidth || 0), behavior: 'smooth' }); }}
          className={`w-5 h-5 shrink-0 flex items-center justify-center text-[#5C5C5C] ${idx > 0 ? '' : 'invisible'}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        {/* 이미지 영역 */}
        <div
          ref={containerRef}
          className="flex-1 overflow-x-auto snap-x snap-mandatory flex scrollbar-hide"
          onScroll={() => {
            const el = containerRef.current;
            if (!el) return;
            const newIdx = Math.round(el.scrollLeft / el.clientWidth);
            setIdx(newIdx);
          }}
        >
          {urls.map((url, i) => (
            <button key={i} onClick={() => onImageClick(url)} className="w-full shrink-0 snap-center">
              <img src={url} alt={`이미지 ${i + 1}`} className="w-full aspect-[4/3] object-cover border border-[#D4CFC4]" />
            </button>
          ))}
        </div>
        {/* 우측 화살표 */}
        <button
          onClick={() => { if (idx < urls.length - 1) containerRef.current?.scrollTo({ left: (idx + 1) * (containerRef.current?.clientWidth || 0), behavior: 'smooth' }); }}
          className={`w-5 h-5 shrink-0 flex items-center justify-center text-[#5C5C5C] ${idx < urls.length - 1 ? '' : 'invisible'}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      {/* 점 인디케이터 */}
      <div className="flex justify-center gap-1 mt-1.5">
        {urls.map((_, i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === idx ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'}`} />
        ))}
      </div>
    </div>
  );
}

// ─── 파일 캐러셀 ────────────────────────────────────────

function FileCarousel({ files }: { files: FileAttachment[] }) {
  const [idx, setIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  if (files.length === 0) return null;

  const FileCard = ({ f }: { f: FileAttachment }) => (
    <a href={f.url} target="_blank" rel="noopener noreferrer" download={f.name}
      className="flex items-center gap-2 p-2 border border-[#D4CFC4] bg-[#F5F0E8]/60 hover:bg-[#F5F0E8] transition-colors"
    >
      <svg className="w-5 h-5 text-[#5C5C5C] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1A1A1A] truncate">{f.name}</p>
        {f.size > 0 && <p className="text-xs text-[#8C8478]">{fmtSize(f.size)}</p>}
      </div>
      <svg className="w-4 h-4 text-[#8C8478] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </a>
  );

  if (files.length === 1) {
    return <div className="mt-2"><FileCard f={files[0]} /></div>;
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1">
        {/* 좌측 화살표 */}
        <button
          onClick={() => { if (idx > 0) containerRef.current?.scrollTo({ left: (idx - 1) * (containerRef.current?.clientWidth || 0), behavior: 'smooth' }); }}
          className={`w-5 h-5 shrink-0 flex items-center justify-center text-[#5C5C5C] ${idx > 0 ? '' : 'invisible'}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        {/* 파일 영역 */}
        <div
          ref={containerRef}
          className="flex-1 overflow-x-auto snap-x snap-mandatory flex scrollbar-hide"
          onScroll={() => {
            const el = containerRef.current;
            if (!el) return;
            const newIdx = Math.round(el.scrollLeft / el.clientWidth);
            setIdx(newIdx);
          }}
        >
          {files.map((f, i) => (
            <div key={i} className="w-full shrink-0 snap-center">
              <FileCard f={f} />
            </div>
          ))}
        </div>
        {/* 우측 화살표 */}
        <button
          onClick={() => { if (idx < files.length - 1) containerRef.current?.scrollTo({ left: (idx + 1) * (containerRef.current?.clientWidth || 0), behavior: 'smooth' }); }}
          className={`w-5 h-5 shrink-0 flex items-center justify-center text-[#5C5C5C] ${idx < files.length - 1 ? '' : 'invisible'}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      {/* 점 인디케이터 */}
      <div className="flex justify-center gap-1 mt-1.5">
        {files.map((_, i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === idx ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'}`} />
        ))}
      </div>
    </div>
  );
}

// ─── 이미지 전체화면 뷰어 ──────────────────────────────

function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ delay: 0.15 }}
        onClick={onClose} className="absolute top-4 right-4 text-white p-2 z-10"
      >
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </motion.button>
      <motion.a
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ delay: 0.15 }}
        href={src} target="_blank" rel="noopener noreferrer" download
        onClick={(e) => e.stopPropagation()}
        className="absolute top-4 left-4 text-white p-2 z-10"
      >
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </motion.a>
      <motion.img
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        src={src} alt="" className="max-w-[90vw] max-h-[85vh] object-contain" onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── 펼치기/접기 메시지 본문 ────────────────────────────

function MessageContent({
  content,
  expanded,
  onToggle,
}: {
  content: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [isClamped, setIsClamped] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    // scrollHeight > clientHeight → 2줄 초과
    setIsClamped(el.scrollHeight > el.clientHeight + 1);
  }, [content]);

  if (!content) return null;

  return (
    <div className="relative">
      <p
        ref={textRef}
        className={`text-lg text-[#1A1A1A] whitespace-pre-wrap break-words leading-relaxed ${!expanded ? 'line-clamp-2' : ''}`}
      >
        {content}
      </p>
      {isClamped && !expanded && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="absolute right-0 bottom-0 bg-gradient-to-l from-[#FDFBF7] via-[#FDFBF7] to-transparent pl-6 pr-0.5 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 13l-7 7-7-7" />
          </svg>
        </button>
      )}
      {expanded && isClamped && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="mt-1 text-xs text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors"
        >
          접기
        </button>
      )}
    </div>
  );
}

// ─── 미디어/파일 드로어 (좌측 슬라이드) ─────────────────

function MediaDrawer({
  announcements, onClose, onImageClick, headerContent,
}: {
  announcements: Announcement[];
  onClose: () => void;
  onImageClick: (url: string) => void;
  headerContent?: React.ReactNode;
}) {
  // 다중 이미지/파일 지원 (하위 호환)
  const images = announcements.flatMap(getImageUrls);
  const files = announcements.flatMap(getFiles);

  return (
    <>
      {/* 백드롭 */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 z-20 bg-black/30"
        onClick={onClose}
      />
      {/* 좌측 드로어 */}
      <motion.div
        initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="absolute left-0 top-0 bottom-0 w-[280px] z-30 flex flex-col bg-black/60 backdrop-blur-2xl"
      >
        <div className="flex items-center gap-3 px-4 h-[52px] shrink-0 border-b border-white/10">
          <button onClick={onClose} className="p-1">
            <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="font-bold text-white/90 text-sm">미디어 · 파일</span>
        </div>
        {headerContent && (
          <div className="shrink-0 px-4 py-2 border-b border-white/10">{headerContent}</div>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-5">
          {images.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-white/50 mb-2 tracking-wider">이미지</p>
              <div className="grid grid-cols-3 gap-1.5">
                {images.map((url, i) => (
                  <button key={i} onClick={() => onImageClick(url)} className="aspect-square overflow-hidden rounded-md border border-white/10">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {files.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-white/50 mb-2 tracking-wider">파일</p>
              <div className="space-y-2">
                {files.map((f, i) => (
                  <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" download={f.name}
                    className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-5 h-5 text-white/50 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white/90 truncate">{f.name}</p>
                      {f.size > 0 && <p className="text-[10px] text-white/40">{fmtSize(f.size)}</p>}
                    </div>
                    <svg className="w-4 h-4 text-white/40 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </a>
                ))}
              </div>
            </div>
          )}
          {images.length === 0 && files.length === 0 && (
            <div className="flex items-center justify-center text-sm text-white/40 py-20">
              아직 올린 미디어가 없습니다.
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────

export default function AnnouncementChannel({
  overrideCourseId,
  headerContent,
}: {
  overrideCourseId?: string;
  headerContent?: React.ReactNode;
} = {}) {
  const { profile, isProfessor } = useUser();
  const { userCourseId: contextCourseId } = useCourse();
  const userCourseId = overrideCourseId ?? contextCourseId;
  const { theme } = useTheme();
  const { uploadImage, uploadFile, uploadMultipleImages, uploadMultipleFiles, loading: uploadLoading } = useUpload();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [showToolbar, setShowToolbar] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [pendingImagePreviews, setPendingImagePreviews] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  const [sheetTop, setSheetTop] = useState(0);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [showScrollFab, setShowScrollFab] = useState(false);
  // 검색
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [searchIdx, setSearchIdx] = useState(0);
  // 캘린더
  const [showCalendar, setShowCalendar] = useState(false);
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  // 입력창 확장 (2줄 이상일 때 max-height 해제)
  const [inputExpanded, setInputExpanded] = useState(false);
  const [inputOverflows, setInputOverflows] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const previewRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const msgAreaRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ─── 네비게이션 숨김
  useEffect(() => {
    if (showModal) document.body.setAttribute('data-hide-nav', '');
    else document.body.removeAttribute('data-hide-nav');
    return () => document.body.removeAttribute('data-hide-nav');
  }, [showModal]);

  // ─── 모달 열림 시 body 스크롤 방지
  useEffect(() => {
    if (!showModal) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [showModal]);

  // ─── 공지 구독
  useEffect(() => {
    if (!userCourseId) return;
    const q = query(
      collection(db, 'announcements'),
      where('courseId', '==', userCourseId),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setAnnouncements(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Announcement[]);
      setLoading(false);
    });
    return () => unsub();
  }, [userCourseId]);

  // ─── 미읽음
  useEffect(() => {
    if (!userCourseId || !announcements.length) { setHasUnread(false); return; }
    const lr = localStorage.getItem(lastReadKey(userCourseId));
    if (!lr) { setHasUnread(true); return; }
    const latest = announcements[0];
    if (!latest?.createdAt) { setHasUnread(false); return; }
    setHasUnread(latest.createdAt.toDate().getTime() > new Date(lr).getTime());
  }, [announcements, userCourseId, showModal]);

  // ─── 읽음 처리
  useEffect(() => {
    if (!showModal || !userCourseId || !profile) return;
    localStorage.setItem(lastReadKey(userCourseId), new Date().toISOString());
    setHasUnread(false);
    announcements.forEach((a) => {
      if (a.readBy?.includes(profile.uid)) return;
      updateDoc(doc(db, 'announcements', a.id), { readBy: arrayUnion(profile.uid) }).catch(() => {});
    });
  }, [showModal, userCourseId, profile, announcements]);

  // ─── 스크롤
  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (showModal && !showMedia) {
      const t = setTimeout(scrollToBottom, 100);
      return () => clearTimeout(t);
    }
  }, [showModal, showMedia, announcements.length, scrollToBottom]);

  // ─── 시간순 정렬 (검색/렌더링에서 사용)
  const chrono = useMemo(() => [...announcements].reverse(), [announcements]);

  // ─── 이미지 선택 (다중)
  const onImgSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPendingImages((prev) => [...prev, ...files]);
    setPendingImagePreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))]);
    e.target.value = '';
  };
  const clearImg = (idx: number) => {
    URL.revokeObjectURL(pendingImagePreviews[idx]);
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
    setPendingImagePreviews((prev) => prev.filter((_, i) => i !== idx));
  };
  const clearAllImgs = () => {
    pendingImagePreviews.forEach((url) => URL.revokeObjectURL(url));
    setPendingImages([]);
    setPendingImagePreviews([]);
  };

  // ─── 파일 선택 (다중)
  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  };
  const clearFile = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // ─── 검색 로직
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); setSearchIdx(0); return; }
    const q = searchQuery.toLowerCase();
    const ids = chrono.filter((a) => a.content?.toLowerCase().includes(q)).map((a) => a.id);
    setSearchResults(ids);
    setSearchIdx(ids.length > 0 ? ids.length - 1 : 0);
  }, [searchQuery, chrono]);

  const scrollToMessage = useCallback((msgId: string) => {
    const el = msgAreaRef.current?.querySelector(`[data-msg-id="${msgId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const navigateSearch = useCallback((dir: 'up' | 'down') => {
    if (!searchResults.length) return;
    const next = dir === 'up'
      ? (searchIdx - 1 + searchResults.length) % searchResults.length
      : (searchIdx + 1) % searchResults.length;
    setSearchIdx(next);
    scrollToMessage(searchResults[next]);
  }, [searchResults, searchIdx, scrollToMessage]);

  // ─── 입력창 확장 토글
  const toggleInputExpand = useCallback(() => {
    setInputExpanded((prev) => {
      const next = !prev;
      requestAnimationFrame(() => {
        const t = textareaRef.current;
        if (!t) return;
        t.style.height = 'auto';
        t.style.height = (next ? t.scrollHeight : 36) + 'px';
        if (!next) t.scrollTop = t.scrollHeight;
      });
      return next;
    });
  }, []);

  // ─── 펼치기/접기 토글
  const toggleExpand = useCallback((id: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── 공지 작성
  const handlePost = async () => {
    const hasPoll = showPollCreator && pollQuestion.trim() && pollOptions.filter((o) => o.trim()).length >= 2;
    if (!profile || !userCourseId || (!newContent.trim() && !pendingImages.length && !pendingFiles.length && !hasPoll)) return;
    try {
      const data: Record<string, unknown> = {
        content: newContent.trim(), reactions: {}, readBy: [],
        createdAt: serverTimestamp(), createdBy: profile.uid, courseId: userCourseId,
      };
      // 다중 이미지 업로드
      if (pendingImages.length > 0) {
        const urls = await uploadMultipleImages(pendingImages);
        if (urls.length > 0) data.imageUrls = urls;
      }
      // 다중 파일 업로드
      if (pendingFiles.length > 0) {
        const fileInfos = await uploadMultipleFiles(pendingFiles);
        if (fileInfos.length > 0) {
          data.files = fileInfos.map((fi) => ({ url: fi.url, name: fi.name, type: fi.type, size: fi.size }));
        }
      }
      if (showPollCreator && pollQuestion.trim() && pollOptions.filter((o) => o.trim()).length >= 2) {
        data.poll = { question: pollQuestion.trim(), options: pollOptions.filter((o) => o.trim()), votes: {}, allowMultiple: false };
      }
      await addDoc(collection(db, 'announcements'), data);
      setNewContent(''); setShowPollCreator(false); setPollQuestion(''); setPollOptions(['', '']);
      clearAllImgs(); setPendingFiles([]); setShowToolbar(false);
      setInputExpanded(false); setInputOverflows(false);
      requestAnimationFrame(() => { const t = textareaRef.current; if (t) t.style.height = '36px'; });
    } catch (err) { console.error('공지 작성 실패:', err); }
  };

  // ─── 이모지 반응
  const handleReaction = async (aid: string, emoji: string) => {
    if (!profile) return;
    const a = announcements.find((x) => x.id === aid); if (!a) return;
    const cur = a.reactions || {}; const arr = cur[emoji] || [];
    const has = arr.includes(profile.uid);
    const upd = { ...cur };
    if (has) { upd[emoji] = arr.filter((id) => id !== profile.uid); if (!upd[emoji].length) delete upd[emoji]; }
    else { upd[emoji] = [...arr, profile.uid]; }
    try { await updateDoc(doc(db, 'announcements', aid), { reactions: upd }); } catch {}
    setShowEmojiPicker(null);
  };

  // ─── 투표
  const handleVote = async (aid: string, optIdx: number) => {
    if (!profile) return;
    const a = announcements.find((x) => x.id === aid); if (!a?.poll) return;
    const cur = a.poll.votes || {};
    const upd: Record<string, string[]> = {};
    Object.keys(cur).forEach((k) => { upd[k] = cur[k].filter((id) => id !== profile.uid); });
    const key = optIdx.toString(); if (!upd[key]) upd[key] = [];
    upd[key].push(profile.uid);
    try { await updateDoc(doc(db, 'announcements', aid), { 'poll.votes': upd }); } catch (err) { console.error('투표 실패:', err); }
  };

  // ─── 파생
  const latest = announcements[0];
  const closeModal = () => { setShowModal(false); setShowEmojiPicker(null); setShowMedia(false); setSearchOpen(false); setSearchQuery(''); setShowCalendar(false); };

  // ═══════════════════════════════════════════════════════
  // 렌더링
  // ═══════════════════════════════════════════════════════

  return (
    <>
      {/* ═══ 홈 미리보기 (2줄: 첫 단어 / 나머지) ═══ */}
      {(() => {
        let raw = '아직 공지가 없습니다.';
        if (loading) {
          raw = '불러오는 중...';
        } else if (latest) {
          // 마지막 메시지가 사진/파일만인 경우 대체 텍스트
          const hasImages = getImageUrls(latest).length > 0;
          const hasFiles = getFiles(latest).length > 0;
          if (latest.content) {
            raw = latest.content;
          } else if (hasImages) {
            raw = '사진을 보냈습니다.';
          } else if (hasFiles) {
            raw = '파일을 보냈습니다.';
          } else if (latest.poll) {
            raw = '투표를 보냈습니다.';
          }
        }
        const spaceIdx = raw.indexOf(' ');
        // 띄어쓰기가 없으면 첫 글자 / 나머지로 분리
        const firstWord = spaceIdx > 0 ? raw.slice(0, spaceIdx) : raw.slice(0, 1);
        const rest = spaceIdx > 0 ? raw.slice(spaceIdx + 1) : (raw.length > 1 ? raw.slice(1) : '');
        return (
          <div ref={previewRef}>
          <button onClick={() => {
            if (previewRef.current) {
              setSheetTop(previewRef.current.getBoundingClientRect().bottom);
            }
            setShowModal(true);
          }} className="w-full text-left flex items-center">
            <div className="flex-1 min-w-0">
              <p className="text-4xl font-bold text-white">{firstWord}</p>
              <p className="text-4xl font-bold text-white truncate">{rest || '\u00A0'}</p>
            </div>
            <div className="flex-shrink-0 ml-3 self-center">
              <svg className="w-6 h-6 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
          </div>
        );
      })()}

      {/* ═══ 바텀시트 ═══ */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showModal && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end bg-black/40"
              onClick={closeModal}
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full flex flex-col overflow-hidden rounded-t-2xl"
                style={{ height: sheetTop > 0 ? `calc(100vh - ${sheetTop + 16}px)` : '92vh' }}
              >
                {/* ── 배경 이미지 ── */}
                <div className="absolute inset-0 rounded-t-2xl overflow-hidden">
                  <img
                    src="/images/home-bg.jpg" alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
                {/* ── 글래스 오버레이 ── */}
                <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />

                {/* ── 상단 바 ── */}
                <div className="relative z-10 shrink-0 pt-3 pb-2 px-4">
                  {/* 드래그 핸들 */}
                  <div className="flex justify-center mb-3">
                    <div className="w-10 h-1 bg-white/40 rounded-full" />
                  </div>
                  {/* 메뉴 + 아이콘 + 닫기 */}
                  <div className="flex items-center gap-1">
                    {/* 메뉴 (미디어) */}
                    <button onClick={() => setShowMedia(true)} className="w-9 h-9 flex items-center justify-center">
                      <svg className="w-6 h-6 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    </button>
                    {/* 학생: 캘린더 + 검색 */}
                    {!isProfessor && (
                      <>
                        <button onClick={() => { setShowCalendar(!showCalendar); setSearchOpen(false); }} className="w-9 h-9 flex items-center justify-center">
                          <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </button>
                        {searchOpen ? (
                          <div className="flex-1 flex items-center gap-1 ml-1">
                            <input
                              ref={searchInputRef}
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder="검색..."
                              autoFocus
                              className="flex-1 bg-white/10 border border-white/20 rounded-lg text-sm text-white placeholder:text-white/40 px-2 py-1 focus:outline-none"
                            />
                            <span className="text-xs text-white/50 shrink-0">{searchResults.length > 0 ? `${searchIdx + 1}/${searchResults.length}` : '0'}</span>
                            <button onClick={() => { setSearchOpen(false); setSearchQuery(''); }} className="w-7 h-7 flex items-center justify-center text-white/60">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => { setSearchOpen(true); setShowCalendar(false); }} className="w-9 h-9 flex items-center justify-center">
                            <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                          </button>
                        )}
                      </>
                    )}
                    {!searchOpen && <div className="flex-1" />}
                    <button onClick={closeModal} className="w-9 h-9 flex items-center justify-center shrink-0">
                      <svg className="w-6 h-6 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* 교수님 전용: 과목 행 + 캘린더/검색 */}
                {isProfessor && (
                  <div className="relative z-10 shrink-0 px-4 pb-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setShowCalendar(!showCalendar); setSearchOpen(false); }} className="w-9 h-9 flex items-center justify-center shrink-0">
                        <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </button>
                      <div className="flex-1">{headerContent}</div>
                      {searchOpen ? (
                        <div className="flex items-center gap-1">
                          <input
                            ref={searchInputRef}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="검색..."
                            autoFocus
                            className="w-32 bg-white/10 border border-white/20 rounded-lg text-sm text-white placeholder:text-white/40 px-2 py-1 focus:outline-none"
                          />
                          <span className="text-xs text-white/50">{searchResults.length > 0 ? `${searchIdx + 1}/${searchResults.length}` : '0'}</span>
                          <button onClick={() => { setSearchOpen(false); setSearchQuery(''); }} className="w-7 h-7 flex items-center justify-center text-white/60">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setSearchOpen(true); setShowCalendar(false); }} className="w-9 h-9 flex items-center justify-center shrink-0">
                          <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* 학생 전용: 커스텀 헤더 (과목 전환 없음 - 학생은 자기 과목만) */}
                {!isProfessor && headerContent && (
                  <div className="relative z-10 shrink-0 px-4 pb-2">{headerContent}</div>
                )}

                {/* ── 캘린더 패널 ── */}
                <AnimatePresence>
                  {showCalendar && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="relative z-10 shrink-0 overflow-hidden"
                    >
                      <div className="px-4 pb-3">
                        {/* 연도 선택 (교수님만) */}
                        {isProfessor && (
                          <div className="flex items-center justify-center gap-3 mb-2">
                            <button onClick={() => setCalYear((y) => y - 1)} className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                            </button>
                            <span className="text-sm font-bold text-white/90 min-w-[48px] text-center">{calYear}</span>
                            <button onClick={() => setCalYear((y) => y + 1)} className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                            </button>
                          </div>
                        )}
                        {/* 월 선택 */}
                        <div className="flex items-center justify-center gap-3 mb-2">
                          <button onClick={() => setCalMonth((m) => m === 0 ? 11 : m - 1)} className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                          </button>
                          <span className="text-sm font-bold text-white/90 min-w-[48px] text-center">{calMonth + 1}월</span>
                          <button onClick={() => setCalMonth((m) => m === 11 ? 0 : m + 1)} className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          </button>
                        </div>
                        {/* 달력 그리드 */}
                        {(() => {
                          const year = isProfessor ? calYear : new Date().getFullYear();
                          const firstDay = new Date(year, calMonth, 1).getDay();
                          const daysInMonth = new Date(year, calMonth + 1, 0).getDate();
                          // 메시지가 있는 날짜 집합
                          const msgDays = new Set<number>();
                          chrono.forEach((a) => {
                            if (!a.createdAt) return;
                            const d = a.createdAt.toDate();
                            if (d.getFullYear() === year && d.getMonth() === calMonth) {
                              msgDays.add(d.getDate());
                            }
                          });
                          const cells: React.ReactNode[] = [];
                          // 요일 헤더
                          const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
                          return (
                            <div>
                              <div className="grid grid-cols-7 gap-0.5 mb-1">
                                {dayLabels.map((d) => (
                                  <div key={d} className="text-center text-[10px] text-white/40 py-0.5">{d}</div>
                                ))}
                              </div>
                              <div className="grid grid-cols-7 gap-0.5">
                                {Array.from({ length: firstDay }).map((_, i) => (
                                  <div key={`e-${i}`} />
                                ))}
                                {Array.from({ length: daysInMonth }).map((_, i) => {
                                  const day = i + 1;
                                  const hasMsg = msgDays.has(day);
                                  return (
                                    <button
                                      key={day}
                                      onClick={() => {
                                        if (!hasMsg) return;
                                        // 해당 날짜의 첫 메시지로 스크롤
                                        const target = chrono.find((a) => {
                                          if (!a.createdAt) return false;
                                          const d = a.createdAt.toDate();
                                          return d.getFullYear() === year && d.getMonth() === calMonth && d.getDate() === day;
                                        });
                                        if (target) {
                                          setShowCalendar(false);
                                          setTimeout(() => scrollToMessage(target.id), 100);
                                        }
                                      }}
                                      className={`aspect-square flex items-center justify-center text-xs rounded-full ${hasMsg ? 'bg-white/20 text-white font-bold ring-1 ring-white/40' : 'text-white/40'}`}
                                    >
                                      {day}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* ── 메시지 영역 ── */}
                <div
                  ref={msgAreaRef}
                  className="relative z-10 flex-1 overflow-y-auto overscroll-contain px-3 py-4"
                  onClick={() => setShowEmojiPicker(null)}
                  onScroll={() => {
                    const el = msgAreaRef.current;
                    if (!el) return;
                    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
                    setShowScrollFab(distFromBottom > 200);
                  }}
                >
                  {!announcements.length ? (
                    <div className="h-full flex items-center justify-center text-white/50 text-sm">
                      {loading ? '불러오는 중...' : '아직 공지가 없습니다.'}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {chrono.map((a, i) => {
                        const prev = chrono[i - 1];
                        const showDate = i === 0 || !prev?.createdAt || dateKey(prev.createdAt) !== dateKey(a.createdAt);
                        const readCount = (a.readBy?.filter((uid) => uid !== a.createdBy) || []).length;
                        const reactions = Object.entries(a.reactions || {});
                        const imgUrls = getImageUrls(a);
                        const fileList = getFiles(a);

                        // 교수님 본인 메시지 → 우측 정렬
                        const isOwnProfessor = isProfessor && profile && a.createdBy === profile.uid;

                        return (
                          <div key={a.id} data-msg-id={a.id}>
                            {/* 날짜 구분선 */}
                            {showDate && a.createdAt && (
                              <div className="flex items-center gap-3 my-3">
                                <div className="flex-1 border-t border-dashed border-white/20" />
                                <span className="text-xs text-white/60 whitespace-nowrap">
                                  {fmtDate(a.createdAt)}
                                </span>
                                <div className="flex-1 border-t border-dashed border-white/20" />
                              </div>
                            )}

                            {/* 메시지 */}
                            <div className={`flex gap-2 ${isOwnProfessor ? 'flex-row-reverse' : ''} ${searchResults.length > 0 && searchResults[searchIdx] === a.id ? 'bg-black/15 rounded-xl p-1 -m-1' : ''}`}>
                              {/* 아바타 */}
                              <img
                                src="/notice/avatar_professor.png" alt="교수님"
                                className="w-14 h-14 shrink-0 object-cover rounded-full mt-0.5"
                              />

                              <div className={`min-w-0 max-w-[60%] ${isOwnProfessor ? 'flex flex-col items-end' : ''}`}>
                                {/* 이름 */}
                                <p className={`text-sm font-bold text-white/70 mb-1 ${isOwnProfessor ? 'text-right' : ''}`}>Prof. Kim</p>

                                {/* 9-slice 말풍선 */}
                                <Bubble>
                                  {/* 텍스트 본문 — 펼치기/접기 */}
                                  <MessageContent
                                    content={a.content}
                                    expanded={expandedMessages.has(a.id)}
                                    onToggle={() => toggleExpand(a.id)}
                                  />

                                  {/* 이미지 캐러셀 */}
                                  <ImageCarousel urls={imgUrls} onImageClick={setViewerImage} />

                                  {/* 파일 캐러셀 */}
                                  <FileCarousel files={fileList} />

                                  {/* 투표 */}
                                  {a.poll && (
                                    <div className="mt-2 p-3 border border-[#D4CFC4]">
                                      <p className="font-bold text-base mb-2 text-[#1A1A1A]">{a.poll.question}</p>
                                      <div className="space-y-2">
                                        {a.poll.options.map((opt, oi) => {
                                          const v = a.poll!.votes[oi.toString()] || [];
                                          const total = Object.values(a.poll!.votes).flat().length;
                                          const pct = total > 0 ? Math.round((v.length / total) * 100) : 0;
                                          const voted = profile && v.includes(profile.uid);
                                          return (
                                            <button key={oi} onClick={(e) => { e.stopPropagation(); handleVote(a.id, oi); }} className="w-full text-left">
                                              <div className="flex items-center gap-2">
                                                <span className={`w-4 h-4 border-2 border-[#1A1A1A] flex items-center justify-center ${voted ? 'bg-[#1A1A1A]' : ''}`}>
                                                  {voted && <span className="text-white text-[9px]">✓</span>}
                                                </span>
                                                <span className="flex-1 text-base">{opt}</span>
                                                <span className="text-sm text-[#8C8478]">{pct}%</span>
                                              </div>
                                              <div className="mt-1 h-1.5 bg-[#D4CFC4] rounded-full">
                                                <div className="h-full bg-[#1A1A1A] rounded-full transition-all" style={{ width: `${pct}%` }} />
                                              </div>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </Bubble>

                                {/* 시각 + 읽음 */}
                                <div className={`flex items-center gap-1.5 mt-1 ${isOwnProfessor ? 'flex-row-reverse' : ''}`}>
                                  {a.createdAt && <span className="text-xs text-white/50">{fmtTime(a.createdAt)}</span>}
                                  {readCount > 0 && <span className="text-xs text-white/50">· {readCount}명 읽음</span>}
                                </div>

                                {/* 이모지 리액션 */}
                                <div className={`flex items-center gap-1 mt-1 relative flex-wrap ${isOwnProfessor ? 'flex-row-reverse' : ''}`}>
                                  {reactions.map(([emoji, uids]) => (
                                    <button key={emoji} onClick={() => handleReaction(a.id, emoji)}
                                      className={`text-sm px-1 py-0.5 rounded border ${profile && uids.includes(profile.uid) ? 'border-white/40 bg-white/20' : 'border-white/20 bg-white/10'}`}
                                    >
                                      {emoji} <span className="text-xs text-white/60">{uids.length}</span>
                                    </button>
                                  ))}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(showEmojiPicker === a.id ? null : a.id); }}
                                    className="text-white/30 hover:text-white/60 transition-colors"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </button>
                                  {showEmojiPicker === a.id && (
                                    <div
                                      className={`absolute ${isOwnProfessor ? 'left-0' : 'right-0'} bottom-full mb-1 bg-black/60 backdrop-blur-md border border-white/20 rounded-lg p-1.5 flex gap-1 z-20 shadow-lg`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {REACTION_EMOJIS.map((em) => (
                                        <button key={em} onClick={() => handleReaction(a.id, em)} className="text-lg hover:scale-110 transition-transform">{em}</button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={endRef} />
                    </div>
                  )}
                </div>

                {/* ── 좌측 하단 FAB 영역 ── */}
                <div className="absolute left-4 bottom-20 z-20 flex flex-col gap-2">
                  {/* 검색 네비게이션 (검색 중일 때만) */}
                  <AnimatePresence>
                    {searchResults.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex flex-col gap-1"
                      >
                        <button
                          onClick={() => navigateSearch('up')}
                          className="w-10 h-10 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white/70 hover:text-white shadow-lg"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                          </svg>
                        </button>
                        <button
                          onClick={() => navigateSearch('down')}
                          className="w-10 h-10 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white/70 hover:text-white shadow-lg"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                          </svg>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {/* 스크롤 초기화 */}
                  <AnimatePresence>
                    {showScrollFab && !searchQuery && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        onClick={scrollToBottom}
                        className="w-10 h-10 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white/70 hover:text-white shadow-lg"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>

                {/* ── 하단 입력 (교수님 전용) ── */}
                {isProfessor && (
                  <div className="relative z-10 shrink-0 border-t border-white/10 bg-black/20 backdrop-blur-sm px-3 py-3">
                    {/* 첨부 미리보기 */}
                    {(pendingImagePreviews.length > 0 || pendingFiles.length > 0 || showPollCreator) && (
                      <div className="mb-2 space-y-1.5">
                        {/* 다중 이미지 미리보기 */}
                        {pendingImagePreviews.length > 0 && (
                          <div className="flex gap-1.5 overflow-x-auto">
                            {pendingImagePreviews.map((url, idx) => (
                              <div key={idx} className="relative shrink-0">
                                <img src={url} alt="" className="h-14 object-cover rounded-lg border border-white/15" />
                                <button onClick={() => clearImg(idx)} className="absolute -top-1 -right-1 w-4 h-4 bg-white/80 text-black flex items-center justify-center text-[8px] rounded-full">✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* 다중 파일 미리보기 */}
                        {pendingFiles.map((f, idx) => (
                          <div key={idx} className="flex items-center gap-2 p-1.5 bg-white/5 border border-white/15 rounded-lg text-[11px]">
                            <span className="truncate flex-1 text-white/80">{f.name}</span>
                            <span className="text-white/40 shrink-0">{fmtSize(f.size)}</span>
                            <button onClick={() => clearFile(idx)} className="text-white/60 font-bold shrink-0">✕</button>
                          </div>
                        ))}
                        {showPollCreator && (
                          <div className="p-2 border border-white/15 bg-white/5 rounded-lg space-y-1">
                            <input value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)} placeholder="투표 질문"
                              className="w-full p-1.5 border border-white/15 bg-white/10 rounded-lg text-[11px] text-white placeholder:text-white/40 focus:outline-none" />
                            {pollOptions.map((o, idx) => (
                              <input key={idx} value={o}
                                onChange={(e) => { const opts = [...pollOptions]; opts[idx] = e.target.value; setPollOptions(opts); }}
                                placeholder={`선택지 ${idx + 1}`}
                                className="w-full p-1.5 border border-white/15 bg-white/10 rounded-lg text-[11px] text-white placeholder:text-white/40 focus:outline-none" />
                            ))}
                            <button onClick={() => setPollOptions([...pollOptions, ''])} className="text-[11px] text-white/40 hover:text-white/70">+ 선택지 추가</button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 입력 행 */}
                    <div className="flex items-center gap-2">
                      <button onClick={() => setShowToolbar(!showToolbar)}
                        className="w-9 h-9 flex items-center justify-center shrink-0 text-white/50 hover:text-white/80 transition-colors -mt-1"
                      >
                        <motion.svg animate={{ rotate: showToolbar ? 45 : 0 }} className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </motion.svg>
                      </button>

                      <div className="flex-1 relative">
                        <textarea
                          ref={textareaRef}
                          value={newContent}
                          onChange={(e) => {
                            setNewContent(e.target.value);
                            const t = e.target;
                            t.style.height = 'auto';
                            // 1줄 높이 ≈ 36px, 2줄부터 오버플로우 감지
                            const oneLineH = 36;
                            const isMultiLine = t.scrollHeight > oneLineH + 4;
                            setInputOverflows(isMultiLine);
                            if (inputExpanded) {
                              t.style.height = t.scrollHeight + 'px';
                            } else {
                              // 확장 안 됐으면 1줄 고정, 스크롤은 맨 아래(입력 중인 줄)로
                              t.style.height = oneLineH + 'px';
                              t.scrollTop = t.scrollHeight;
                            }
                          }}
                          placeholder="공지를 입력하세요..."
                          className={`w-full bg-white/10 border border-white/15 rounded-xl resize-none focus:outline-none text-sm text-white placeholder:text-white/40 px-3 py-2 pr-8 min-h-[36px] ${inputExpanded ? '' : 'max-h-[36px] overflow-hidden'}`}
                          rows={1}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
                        />
                        {/* 입력창 확장/축소 버튼 (2줄 이상일 때만) */}
                        {inputOverflows && (
                          <button
                            onClick={toggleInputExpand}
                            className="absolute right-1.5 top-1.5 w-6 h-6 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors"
                            title={inputExpanded ? '입력창 줄이기' : '입력창 펼치기'}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {inputExpanded ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              )}
                            </svg>
                          </button>
                        )}
                      </div>

                      <button onClick={handlePost}
                        disabled={(!newContent.trim() && !pendingImages.length && !pendingFiles.length && !(showPollCreator && pollQuestion.trim())) || uploadLoading}
                        className="w-9 h-9 flex items-center justify-center shrink-0 text-white/70 disabled:text-white/20 transition-colors -mt-1"
                      >
                        {uploadLoading ? (
                          <div className="w-5 h-5 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
                        ) : (
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                          </svg>
                        )}
                      </button>
                    </div>

                    {/* 도구 바 */}
                    <AnimatePresence>
                      {showToolbar && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="flex items-center gap-1.5 pt-2">
                            <button onClick={() => imgRef.current?.click()} className="p-1.5 text-white/50 hover:text-white/80 transition-colors" title="이미지">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </button>
                            <button onClick={() => fileRef.current?.click()} className="p-1.5 text-white/50 hover:text-white/80 transition-colors" title="파일">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                              </svg>
                            </button>
                            <button onClick={() => setShowPollCreator(!showPollCreator)}
                              className={`p-1.5 transition-colors ${showPollCreator ? 'text-white/80' : 'text-white/50'} hover:text-white/80`} title="투표"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                              </svg>
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={onImgSelect} />
                    <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" multiple className="hidden" onChange={onFileSelect} />
                  </div>
                )}

                {/* ── 미디어 드로어 ── */}
                <AnimatePresence>
                  {showMedia && (
                    <MediaDrawer
                      announcements={announcements}
                      onClose={() => setShowMedia(false)}
                      onImageClick={(url) => { setViewerImage(url); setShowMedia(false); }}
                      headerContent={headerContent}
                    />
                  )}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* 전체화면 편집 모달 제거됨 — 입력창 인라인 확장으로 대체 */}

      {/* ═══ 이미지 뷰어 ═══ */}
      {typeof document !== 'undefined' && viewerImage && createPortal(
        <AnimatePresence>
          <ImageViewer src={viewerImage} onClose={() => setViewerImage(null)} />
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
