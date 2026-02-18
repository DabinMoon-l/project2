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

interface Announcement {
  id: string;
  content: string;
  imageUrl?: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
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

// ─── 이미지 전체화면 뷰어 ──────────────────────────────

function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <button onClick={onClose} className="absolute top-4 right-4 text-white p-2 z-10">
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <a
        href={src} target="_blank" rel="noopener noreferrer" download
        onClick={(e) => e.stopPropagation()}
        className="absolute top-4 left-4 text-white p-2 z-10"
      >
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </a>
      <img src={src} alt="" className="max-w-[90vw] max-h-[85vh] object-contain" onClick={(e) => e.stopPropagation()} />
    </motion.div>
  );
}

// ─── 미디어/파일 드로어 (좌측 슬라이드) ─────────────────

function MediaDrawer({
  announcements, onClose, onImageClick,
}: {
  announcements: Announcement[];
  onClose: () => void;
  onImageClick: (url: string) => void;
}) {
  const images = announcements.filter((a) => a.imageUrl).map((a) => a.imageUrl!);
  const files = announcements
    .filter((a) => a.fileUrl && a.fileName)
    .map((a) => ({ url: a.fileUrl!, name: a.fileName!, size: a.fileSize }));

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
                      {f.size != null && <p className="text-[10px] text-white/40">{fmtSize(f.size)}</p>}
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

export default function AnnouncementChannel() {
  const { profile, isProfessor } = useUser();
  const { userCourseId } = useCourse();
  const { theme } = useTheme();
  const { uploadImage, uploadFile, loading: uploadLoading } = useUpload();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [showToolbar, setShowToolbar] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  const [sheetTop, setSheetTop] = useState(0);

  const previewRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  // ─── 파일 선택
  const onImgSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setPendingImage(f);
    setPendingImagePreview(URL.createObjectURL(f));
    e.target.value = '';
  };
  const clearImg = () => {
    if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview);
    setPendingImage(null); setPendingImagePreview(null);
  };
  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setPendingFile(f); e.target.value = '';
  };

  // ─── 공지 작성
  const handlePost = async () => {
    if (!profile || !userCourseId || (!newContent.trim() && !pendingImage && !pendingFile)) return;
    try {
      const data: Record<string, unknown> = {
        content: newContent.trim(), reactions: {}, readBy: [],
        createdAt: serverTimestamp(), createdBy: profile.uid, courseId: userCourseId,
      };
      if (pendingImage) { const url = await uploadImage(pendingImage); if (url) data.imageUrl = url; }
      if (pendingFile) {
        const fi = await uploadFile(pendingFile);
        if (fi) { data.fileUrl = fi.url; data.fileName = fi.name; data.fileType = fi.type; data.fileSize = fi.size; }
      }
      if (showPollCreator && pollQuestion.trim() && pollOptions.filter((o) => o.trim()).length >= 2) {
        data.poll = { question: pollQuestion.trim(), options: pollOptions.filter((o) => o.trim()), votes: {}, allowMultiple: false };
      }
      await addDoc(collection(db, 'announcements'), data);
      setNewContent(''); setShowPollCreator(false); setPollQuestion(''); setPollOptions(['', '']);
      clearImg(); setPendingFile(null); setShowToolbar(false);
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
    try { await updateDoc(doc(db, 'announcements', aid), { 'poll.votes': upd }); } catch {}
  };

  // ─── 파생
  const latest = announcements[0];
  const chrono = useMemo(() => [...announcements].reverse(), [announcements]);
  const closeModal = () => { setShowModal(false); setShowEmojiPicker(null); setShowMedia(false); };

  // ═══════════════════════════════════════════════════════
  // 렌더링
  // ═══════════════════════════════════════════════════════

  return (
    <>
      {/* ═══ 홈 미리보기 (2줄: 첫 단어 / 나머지) ═══ */}
      {(() => {
        const raw = loading ? '불러오는 중...' : latest ? latest.content : '아직 공지가 없습니다.';
        const spaceIdx = raw.indexOf(' ');
        const firstWord = spaceIdx > 0 ? raw.slice(0, spaceIdx) : raw;
        const rest = spaceIdx > 0 ? raw.slice(spaceIdx + 1) : '';
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
              {hasUnread ? (
                <div className="w-3 h-3" style={{ backgroundColor: theme.colors.accent }} />
              ) : (
                <svg className="w-6 h-6 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
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
                  {/* 메뉴 + 닫기 */}
                  <div className="flex items-center justify-between">
                    <button onClick={() => setShowMedia(true)} className="w-9 h-9 flex items-center justify-center">
                      {/* 햄버거 SVG */}
                      <svg className="w-6 h-6 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    </button>
                    <button onClick={closeModal} className="w-9 h-9 flex items-center justify-center">
                      {/* X SVG */}
                      <svg className="w-6 h-6 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* ── 메시지 영역 ── */}
                <div
                  className="relative z-10 flex-1 overflow-y-auto overscroll-contain px-3 py-4"
                  onClick={() => setShowEmojiPicker(null)}
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
                        const readCount = a.readBy?.length || 0;
                        const reactions = Object.entries(a.reactions || {});

                        return (
                          <div key={a.id}>
                            {/* 날짜 구분선 */}
                            {showDate && a.createdAt && (
                              <div className="flex items-center gap-3 my-3">
                                <div className="flex-1 border-t border-dashed border-white/20" />
                                <span className="text-[10px] text-white/60 whitespace-nowrap">
                                  {fmtDate(a.createdAt)}
                                </span>
                                <div className="flex-1 border-t border-dashed border-white/20" />
                              </div>
                            )}

                            {/* 메시지 */}
                            <div className="flex gap-2">
                              {/* 아바타 */}
                              <img
                                src="/notice/avatar_professor.png" alt="교수님"
                                className="w-9 h-9 shrink-0 object-contain mt-0.5"
                              />

                              <div className="flex-1 min-w-0">
                                {/* 이름 */}
                                <p className="text-[11px] font-bold text-white/70 mb-1">Prof. Kim</p>

                                {/* 9-slice 말풍선 */}
                                <Bubble>
                                  {a.content && (
                                    <p className="text-[13px] text-[#1A1A1A] whitespace-pre-wrap break-words leading-relaxed">
                                      {a.content}
                                    </p>
                                  )}

                                  {/* 이미지 */}
                                  {a.imageUrl && (
                                    <button onClick={() => setViewerImage(a.imageUrl!)} className="mt-2 block w-full">
                                      <img src={a.imageUrl} alt="이미지" className="w-full max-h-44 object-cover border border-[#D4CFC4]" />
                                    </button>
                                  )}

                                  {/* 파일 카드 */}
                                  {a.fileUrl && a.fileName && (
                                    <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" download={a.fileName}
                                      className="mt-2 flex items-center gap-2 p-2 border border-[#D4CFC4] bg-[#F5F0E8]/60 hover:bg-[#F5F0E8] transition-colors"
                                    >
                                      <svg className="w-4 h-4 text-[#5C5C5C] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                      </svg>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-[11px] font-medium text-[#1A1A1A] truncate">{a.fileName}</p>
                                        {a.fileSize != null && <p className="text-[10px] text-[#8C8478]">{fmtSize(a.fileSize)}</p>}
                                      </div>
                                      <svg className="w-3.5 h-3.5 text-[#8C8478] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                                      </svg>
                                    </a>
                                  )}

                                  {/* 투표 */}
                                  {a.poll && (
                                    <div className="mt-2 p-2 border border-[#D4CFC4]">
                                      <p className="font-bold text-[11px] mb-1.5 text-[#1A1A1A]">{a.poll.question}</p>
                                      <div className="space-y-1.5">
                                        {a.poll.options.map((opt, oi) => {
                                          const v = a.poll!.votes[oi.toString()] || [];
                                          const total = Object.values(a.poll!.votes).flat().length;
                                          const pct = total > 0 ? Math.round((v.length / total) * 100) : 0;
                                          const voted = profile && v.includes(profile.uid);
                                          return (
                                            <button key={oi} onClick={() => handleVote(a.id, oi)} className="w-full text-left">
                                              <div className="flex items-center gap-1.5">
                                                <span className={`w-3 h-3 border border-[#1A1A1A] flex items-center justify-center ${voted ? 'bg-[#1A1A1A]' : ''}`}>
                                                  {voted && <span className="text-white text-[7px]">✓</span>}
                                                </span>
                                                <span className="flex-1 text-[11px]">{opt}</span>
                                                <span className="text-[10px] text-[#8C8478]">{pct}%</span>
                                              </div>
                                              <div className="mt-0.5 h-1 bg-[#D4CFC4]">
                                                <div className="h-full bg-[#1A1A1A] transition-all" style={{ width: `${pct}%` }} />
                                              </div>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </Bubble>

                                {/* 시각 + 읽음 + 이모지 */}
                                <div className="flex items-center gap-1.5 mt-1 relative flex-wrap">
                                  {a.createdAt && <span className="text-[10px] text-white/50">{fmtTime(a.createdAt)}</span>}
                                  {readCount > 0 && <span className="text-[10px] text-white/50">· {readCount}명 읽음</span>}
                                  <div className="flex-1" />
                                  {reactions.map(([emoji, uids]) => (
                                    <button key={emoji} onClick={() => handleReaction(a.id, emoji)}
                                      className={`text-xs px-1 py-0.5 rounded border ${profile && uids.includes(profile.uid) ? 'border-white/40 bg-white/20' : 'border-white/20 bg-white/10'}`}
                                    >
                                      {emoji} <span className="text-[10px] text-white/60">{uids.length}</span>
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
                                      className="absolute right-0 bottom-full mb-1 bg-black/60 backdrop-blur-md border border-white/20 rounded-lg p-1.5 flex gap-1 z-20 shadow-lg"
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

                {/* ── 하단 입력 (교수님 전용) ── */}
                {isProfessor && (
                  <div className="relative z-10 shrink-0 border-t border-white/10 bg-black/20 backdrop-blur-sm px-3 py-2">
                    {/* 첨부 미리보기 */}
                    {(pendingImagePreview || pendingFile || showPollCreator) && (
                      <div className="mb-2 space-y-1.5">
                        {pendingImagePreview && (
                          <div className="relative inline-block">
                            <img src={pendingImagePreview} alt="" className="h-14 object-cover rounded-lg border border-white/15" />
                            <button onClick={clearImg} className="absolute -top-1 -right-1 w-4 h-4 bg-white/80 text-black flex items-center justify-center text-[8px] rounded-full">✕</button>
                          </div>
                        )}
                        {pendingFile && (
                          <div className="flex items-center gap-2 p-1.5 bg-white/5 border border-white/15 rounded-lg text-[11px]">
                            <span className="truncate flex-1 text-white/80">{pendingFile.name}</span>
                            <span className="text-white/40 shrink-0">{fmtSize(pendingFile.size)}</span>
                            <button onClick={() => setPendingFile(null)} className="text-white/60 font-bold shrink-0">✕</button>
                          </div>
                        )}
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
                    <div className="flex items-end gap-2">
                      <button onClick={() => setShowToolbar(!showToolbar)}
                        className="w-8 h-8 flex items-center justify-center shrink-0 mb-px text-white/50 hover:text-white/80 transition-colors"
                      >
                        <motion.svg animate={{ rotate: showToolbar ? 45 : 0 }} className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </motion.svg>
                      </button>

                      <div className="flex-1 min-h-[36px]">
                        <textarea
                          value={newContent}
                          onChange={(e) => setNewContent(e.target.value)}
                          placeholder="공지를 입력하세요..."
                          className="w-full bg-white/10 border border-white/15 rounded-xl resize-none focus:outline-none text-[13px] text-white placeholder:text-white/40 px-3 py-2 min-h-[36px] max-h-[80px]"
                          rows={1}
                          onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 80) + 'px'; }}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
                        />
                      </div>

                      <button onClick={handlePost}
                        disabled={(!newContent.trim() && !pendingImage && !pendingFile) || uploadLoading}
                        className="w-8 h-8 flex items-center justify-center shrink-0 mb-px text-white/70 disabled:text-white/20 transition-colors"
                      >
                        {uploadLoading ? (
                          <div className="w-4 h-4 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
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

                    <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={onImgSelect} />
                    <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" className="hidden" onChange={onFileSelect} />
                  </div>
                )}

                {/* ── 미디어 드로어 ── */}
                <AnimatePresence>
                  {showMedia && (
                    <MediaDrawer
                      announcements={announcements}
                      onClose={() => setShowMedia(false)}
                      onImageClick={(url) => { setViewerImage(url); setShowMedia(false); }}
                    />
                  )}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

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
