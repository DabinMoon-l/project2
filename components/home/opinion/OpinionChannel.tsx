'use client';

import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  collection, query, orderBy, limit, onSnapshot,
  addDoc, deleteDoc, doc, serverTimestamp, db,
  type Timestamp,
} from '@/lib/repositories';
import { useUser } from '@/lib/contexts';
import { useUpload } from '@/lib/hooks/useStorage';
import { ImageViewer } from '@/components/common';
import { useKeyboardAware } from '@/lib/hooks/useKeyboardAware';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import { useHideNav } from '@/lib/hooks/useHideNav';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';

// ─── 타입 ────────────────────────────────────────────
interface OpinionMessage {
  id: string;
  content: string;
  imageUrls?: string[];
  createdAt: Timestamp | null;
  createdBy: string;
  authorName: string;
  authorRole: 'student' | 'professor';
  studentId?: string;
  profileRabbitId?: number;
}

// ─── 유틸 ────────────────────────────────────────────
const fmtTime = (ts: Timestamp | null) => {
  if (!ts) return '';
  const d = ts.toDate();
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h >= 12 ? '오후' : '오전'} ${h % 12 || 12}:${m}`;
};
const fmtDate = (ts: Timestamp | null) => {
  if (!ts) return '';
  const d = ts.toDate();
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};
const dateKey = (ts: Timestamp | null) => {
  if (!ts) return '';
  const d = ts.toDate();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
const getYear = (studentId?: string) => {
  if (!studentId || studentId.length < 2) return '';
  return studentId.slice(0, 2) + '학번';
};

// ─── 모듈 캐시 ──────────────────────────────────────
const opinionCache: OpinionMessage[] = [];

// ─── 메시지 아이템 ──────────────────────────────────
const OpinionItem = memo(function OpinionItem({
  msg, showDate, isOwn, onDelete, onImageClick,
}: {
  msg: OpinionMessage;
  showDate: boolean;
  isOwn: boolean;
  onDelete: (id: string) => void;
  onImageClick: (url: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const isDev = msg.studentId === '25010423';

  // 표시명: 개발자 "개발자", 교수 "실명", 학생 "닉네임"
  const displayName = isDev
    ? '개발자'
    : msg.authorRole === 'professor'
      ? msg.authorName
      : msg.authorName;

  return (
    <>
      {showDate && (
        <div className="flex justify-center my-3">
          <span className="text-[11px] text-white/40 bg-white/10 px-3 py-0.5 rounded-full">
            {fmtDate(msg.createdAt)}
          </span>
        </div>
      )}
      <div className="px-4 py-1.5 group">
        <div className="flex items-start gap-2">
          {/* 아바타 — 프로필 토끼 */}
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden ${isDev ? 'bg-emerald-500/30' : 'bg-white/15'}`}>
            {isDev ? (
              <span className="text-xs">⚙</span>
            ) : msg.profileRabbitId != null ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={getRabbitProfileUrl(msg.profileRabbitId)} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs font-bold text-white/80">{msg.authorName[0] || '?'}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {/* 이름 + 시간 */}
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className={`text-xs font-bold ${isDev ? 'text-emerald-300' : 'text-white/80'}`}>
                {displayName}
              </span>
              <span className="text-[10px] text-white/30">{fmtTime(msg.createdAt)}</span>
            </div>
            {/* 내용 */}
            {msg.content && (
              <p
                className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap break-words"
                onContextMenu={(e) => { if (isOwn) { e.preventDefault(); setShowMenu(true); } }}
              >
                {msg.content}
              </p>
            )}
            {/* 이미지 */}
            {msg.imageUrls && msg.imageUrls.length > 0 && (
              <div className="mt-1.5 flex gap-1.5 flex-wrap">
                {msg.imageUrls.map((url, i) => (
                  <button key={i} onClick={() => onImageClick(url)} className="rounded-lg overflow-hidden border border-white/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="max-w-[200px] max-h-[200px] object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* 삭제 메뉴 */}
        <AnimatePresence>
          {showMenu && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              className="mt-1 ml-10"
            >
              <button
                onClick={() => { onDelete(msg.id); setShowMenu(false); }}
                className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1 rounded-lg"
              >
                삭제
              </button>
              <button onClick={() => setShowMenu(false)} className="text-xs text-white/40 ml-2">취소</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
});

// ─── 메인 컴포넌트 ──────────────────────────────────
export default function OpinionChannel() {
  const { profile, isProfessor } = useUser();
  const { uploadImage, loading: uploadLoading } = useUpload();
  const { bottomOffset } = useKeyboardAware();

  const [messages, setMessages] = useState<OpinionMessage[]>(opinionCache.length > 0 ? [...opinionCache] : []);
  const [loading, setLoading] = useState(opinionCache.length === 0);
  const [showModal, setShowModal] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string>('');
  const [linkedImageUrls, setLinkedImageUrls] = useState<string[]>([]);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInputValue, setUrlInputValue] = useState('');
  const [sending, setSending] = useState(false);

  const msgAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [sheetTop, setSheetTop] = useState(0);

  useHideNav(showModal);

  // 스크롤 잠금
  useEffect(() => {
    if (showModal) { lockScroll(); return () => unlockScroll(); }
  }, [showModal]);

  // Firestore 구독 — 전체 글로벌 (과목 무관)
  useEffect(() => {
    const q = query(collection(db, 'opinions'), orderBy('createdAt', 'desc'), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OpinionMessage));
      setMessages(data);
      opinionCache.length = 0;
      opinionCache.push(...data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // 모달 열릴 때 맨 아래로 스크롤
  useEffect(() => {
    if (showModal) {
      setTimeout(() => {
        msgAreaRef.current?.scrollTo(0, msgAreaRef.current.scrollHeight);
      }, 300);
    }
  }, [showModal]);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setPendingImage(null);
    setPendingPreview('');
  }, []);

  // 이미지 선택
  const handleImagePick = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        setPendingImage(file);
        setPendingPreview(URL.createObjectURL(file));
      }
    };
    input.click();
  }, []);

  // 이미지 URL 패턴
  const IMAGE_URL_PATTERN = /^https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|bmp|svg|avif)(?:[?#]\S*)?$/i;
  const KNOWN_IMAGE_HOST = /^https?:\/\/(?:i\.imgur\.com|firebasestorage\.googleapis\.com|lh[0-9]*\.googleusercontent\.com|cdn\.discordapp\.com|postfiles\.naver\.net|blogfiles\.naver\.net|upload\.wikimedia\.org)\//i;

  // 텍스트 붙여넣기 시 이미지 URL 감지
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text').trim();
    if (!text) return;
    if (IMAGE_URL_PATTERN.test(text) || KNOWN_IMAGE_HOST.test(text)) {
      if (linkedImageUrls.length + (pendingImage ? 1 : 0) >= 5) return;
      if (linkedImageUrls.includes(text)) return;
      e.preventDefault();
      setLinkedImageUrls(prev => [...prev, text]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedImageUrls, pendingImage]);

  // URL 입력으로 이미지 추가
  const handleAddImageUrl = useCallback(() => {
    const url = urlInputValue.trim();
    if (!url) return;
    if (linkedImageUrls.length + (pendingImage ? 1 : 0) >= 5) return;
    if (linkedImageUrls.includes(url)) return;
    setLinkedImageUrls(prev => [...prev, url]);
    setUrlInputValue('');
    setTimeout(() => urlInputRef.current?.focus(), 50);
  }, [urlInputValue, linkedImageUrls, pendingImage]);

  // 전송
  const handleSend = useCallback(async () => {
    const text = textareaRef.current?.value.trim() || '';
    if (!text && !pendingImage && linkedImageUrls.length === 0) return;
    if (!profile) return;
    setSending(true);

    try {
      let imageUrls: string[] = [...linkedImageUrls];
      if (pendingImage) {
        const url = await uploadImage(pendingImage);
        if (url) imageUrls = [url, ...imageUrls];
      }

      await addDoc(collection(db, 'opinions'), {
        content: text,
        imageUrls,
        createdAt: serverTimestamp(),
        createdBy: profile.uid,
        authorName: profile.nickname || '익명',
        authorRole: isProfessor ? 'professor' : 'student',
        studentId: (profile as unknown as Record<string, string>).studentId || '',
        profileRabbitId: profile.profileRabbitId ?? null,
      });

      if (textareaRef.current) textareaRef.current.value = '';
      setPendingImage(null);
      setPendingPreview('');
      setLinkedImageUrls([]);
      setShowUrlInput(false);
      // 전송 후 맨 아래로 스크롤
      setTimeout(() => {
        msgAreaRef.current?.scrollTo({ top: msgAreaRef.current.scrollHeight, behavior: 'smooth' });
      }, 300);
    } catch (err) {
      console.error('의견 전송 실패:', err);
    } finally {
      setSending(false);
    }
  }, [pendingImage, linkedImageUrls, profile, isProfessor, uploadImage]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteDoc(doc(db, 'opinions', id));
    } catch (err) {
      console.error('의견 삭제 실패:', err);
    }
  }, []);

  // 시간순 정렬 (오래된 순 → 최신이 아래)
  const chrono = [...messages].reverse();

  // 최신 메시지 미리보기
  const latest = messages[0];
  const previewText = loading
    ? '불러오는 중...'
    : latest
      ? `${latest.authorName}: ${latest.content || '사진을 보냈습니다.'}`
      : '여러분의 의견을 보내주세요!';

  return (
    <>
      {/* ═══ 미리보기 ═══ */}
      <div ref={previewRef} onTouchStart={(e) => e.stopPropagation()}>
        <button
          onClick={() => {
            if (previewRef.current) setSheetTop(previewRef.current.getBoundingClientRect().bottom);
            setShowModal(true);
          }}
          className="w-full text-left flex items-center"
        >
          <div className="flex-1 min-w-0">
            <p className="text-base text-white/60 truncate leading-tight">
              {previewText}
            </p>
          </div>
          <svg className="w-4 h-4 text-white/30 shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* ═══ 바텀시트 ═══ */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showModal && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[110] flex items-end bg-black/40"
              style={{ left: 'var(--modal-left, 0px)' }}
              onClick={closeModal}
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full flex flex-col overflow-hidden rounded-t-2xl will-change-transform"
                style={{ height: sheetTop > 0 ? `calc(100dvh - ${sheetTop + 16 + bottomOffset}px)` : bottomOffset > 0 ? `calc(92dvh - ${bottomOffset}px)` : '92dvh' }}
              >
                {/* 배경 */}
                <div className="absolute inset-0 rounded-t-2xl overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover blur-2xl scale-110" />
                </div>
                <div className="absolute inset-0 bg-white/10" />

                {/* 상단 바 */}
                <div className="relative z-10 shrink-0 pt-3 pb-2 px-4">
                  <div className="flex justify-center mb-3">
                    <div className="w-10 h-1 bg-white/40 rounded-full" />
                  </div>
                  <div className="flex items-center">
                    <h2 className="text-base font-bold text-white flex-1">의견 게시판</h2>
                    <button onClick={closeModal} className="w-9 h-9 flex items-center justify-center">
                      <svg className="w-6 h-6 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* 메시지 영역 */}
                <div
                  ref={msgAreaRef}
                  className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide overscroll-contain px-0 py-2"
                >
                  {loading ? (
                    <div className="flex items-center justify-center py-20">
                      <div className="w-6 h-6 border-2 border-white/40 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : chrono.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-white/40">
                      <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <p className="text-sm">아직 의견이 없습니다</p>
                      <p className="text-xs mt-1">첫 번째 의견을 남겨보세요!</p>
                    </div>
                  ) : (
                    chrono.map((msg, idx) => {
                      const prev = idx > 0 ? chrono[idx - 1] : null;
                      const showDate = !prev || dateKey(msg.createdAt) !== dateKey(prev.createdAt);
                      return (
                        <OpinionItem
                          key={msg.id}
                          msg={msg}
                          showDate={showDate}
                          isOwn={msg.createdBy === profile?.uid}
                          onDelete={handleDelete}
                          onImageClick={(url) => setViewerUrl(url)}
                        />
                      );
                    })
                  )}
                </div>

                {/* 입력 바 */}
                <div className="relative z-10 shrink-0 border-t border-white/10 bg-black/20 backdrop-blur-xl">
                  {/* 이미지 미리보기 (파일 + URL) */}
                  {(pendingPreview || linkedImageUrls.length > 0) && (
                    <div className="px-4 pt-2 flex items-center gap-2 flex-wrap">
                      {pendingPreview && (
                        <div className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={pendingPreview} alt="" className="w-14 h-14 object-cover rounded-lg border border-white/20" />
                          <button onClick={() => { setPendingImage(null); setPendingPreview(''); }} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[8px] flex items-center justify-center">✕</button>
                        </div>
                      )}
                      {linkedImageUrls.map((url, i) => (
                        <div key={i} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="" className="w-14 h-14 object-cover rounded-lg border border-white/20" />
                          <button onClick={() => setLinkedImageUrls(prev => prev.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[8px] flex items-center justify-center">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* URL 입력 패널 */}
                  {showUrlInput && (
                    <div className="px-4 pt-2 flex items-center gap-2">
                      <input
                        ref={urlInputRef}
                        type="text"
                        value={urlInputValue}
                        onChange={(e) => setUrlInputValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddImageUrl(); } }}
                        placeholder="이미지 URL 붙여넣기"
                        className="flex-1 bg-white/10 border border-white/15 rounded-lg text-xs text-white placeholder:text-white/30 px-2.5 py-1.5 focus:outline-none"
                      />
                      <button onClick={handleAddImageUrl} className="text-xs font-bold text-white/60 shrink-0">추가</button>
                    </div>
                  )}
                  <div className="flex items-end gap-2 px-3 py-2" style={{ paddingBottom: `max(0.5rem, env(safe-area-inset-bottom, 0px))` }}>
                    {/* 이미지 버튼 */}
                    <button onClick={handleImagePick} disabled={uploadLoading} className="w-8 h-9 flex items-center justify-center shrink-0 text-white/50">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </button>
                    {/* URL 이미지 버튼 */}
                    <button onClick={() => setShowUrlInput(v => !v)} className={`w-8 h-9 flex items-center justify-center shrink-0 transition-colors ${showUrlInput ? 'text-white' : 'text-white/50'}`}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                    </button>
                    {/* 텍스트 입력 */}
                    <textarea
                      ref={textareaRef}
                      placeholder="의견을 입력하세요..."
                      rows={1}
                      className="flex-1 bg-white/10 border border-white/15 rounded-xl text-sm text-white placeholder:text-white/30 px-3 py-2 resize-none focus:outline-none focus:border-white/30 max-h-24 overflow-y-auto"
                      onPaste={handlePaste}
                      onInput={(e) => {
                        const t = e.currentTarget;
                        t.style.height = 'auto';
                        t.style.height = Math.min(t.scrollHeight, 96) + 'px';
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                    />
                    {/* 전송 */}
                    <button
                      onClick={handleSend}
                      disabled={sending || uploadLoading}
                      className="w-9 h-9 flex items-center justify-center shrink-0 bg-white/20 rounded-full text-white disabled:opacity-40"
                    >
                      {sending || uploadLoading ? (
                        <div className="w-4 h-4 border-2 border-white/40 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* 이미지 뷰어 */}
      {viewerUrl && (
        <ImageViewer
          urls={[viewerUrl]}
          initialIndex={0}
          onClose={() => setViewerUrl(null)}
        />
      )}
    </>
  );
}
