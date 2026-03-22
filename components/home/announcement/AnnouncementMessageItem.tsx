'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { deleteDoc, doc, db } from '@/lib/repositories';
import type { Announcement, FileAttachment, Poll, EditSubmitData } from './types';
import { REACTION_EMOJIS, BUBBLE_SIDE_MULTI, getImageUrls, getFiles, getPolls, fmtDate, fmtTime, URL_RE } from './types';
import { Bubble, ImageCarousel, FileCarousel, PollCarousel, MessageContent } from './BubbleComponents';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';

// ─── 메시지 아이템 (memo로 불필요한 리렌더 방지) ────────

const AnnouncementMessageItem = memo(function AnnouncementMessageItem({
  announcement: a,
  showDate,
  isOwnProfessor,
  isProfessor,
  isHighlighted,
  showEmojiPickerForThis,
  profileUid,
  onReaction,
  onToggleEmojiPicker,
  onVote,
  onImageClick,
  onEditSubmit,
}: {
  announcement: Announcement;
  showDate: boolean;
  isOwnProfessor: boolean;
  isProfessor?: boolean;
  isHighlighted: boolean;
  showEmojiPickerForThis: boolean;
  profileUid?: string;
  onReaction: (aid: string, emoji: string) => void;
  onToggleEmojiPicker: (aid: string | null) => void;
  onVote: (aid: string, pollIdx: number, optIndices: number[]) => void;
  onImageClick: (urls: string[], index: number) => void;
  onEditSubmit?: (id: string, data: EditSubmitData) => Promise<void>;
}) {
  const readCount = useMemo(() => (a.readBy?.filter((uid) => uid !== a.createdBy) || []).length, [a.readBy, a.createdBy]);
  const reactions = useMemo(() => Object.entries(a.reactions || {}), [a.reactions]);
  const imgUrls = useMemo(() => getImageUrls(a), [a.imageUrls, a.imageUrl]);
  const fileList = useMemo(() => getFiles(a), [a.files, a.fileUrl, a.fileName, a.fileType, a.fileSize]);
  const pollList = useMemo(() => getPolls(a), [a.polls, a.poll]);

  const hasMedia = imgUrls.length > 0 || fileList.length > 0 || pollList.length > 0;
  const hasMultiItems = imgUrls.length > 1 || fileList.length > 1 || pollList.length > 1;

  const textNeedsFullWidth = useMemo(() => {
    if (!a.content) return false;
    // URL_RE는 글로벌 정규식이므로 test() 전 lastIndex 초기화 필수
    // (다른 메시지의 test()/exec()와 lastIndex 공유 → 오감지 방지)
    URL_RE.lastIndex = 0;
    if (URL_RE.test(a.content)) return true;
    if (a.content.includes('\n')) return true;
    return a.content.length > 15;
  }, [a.content]);

  const useFullWidth = hasMedia || textNeedsFullWidth;

  // ── 롱프레스 수정/삭제 (교수님 본인 메시지만)
  const [showActions, setShowActions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const editImgRef = useRef<HTMLInputElement>(null);
  const editFileRef = useRef<HTMLInputElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);

  // 수정 상태
  const [editText, setEditText] = useState('');
  const [editKeepImages, setEditKeepImages] = useState<string[]>([]);
  const [editNewImages, setEditNewImages] = useState<File[]>([]);
  const [editNewImagePreviews, setEditNewImagePreviews] = useState<string[]>([]);
  const [editKeepFiles, setEditKeepFiles] = useState<FileAttachment[]>([]);
  const [editNewFiles, setEditNewFiles] = useState<File[]>([]);
  const [editPolls, setEditPolls] = useState<Poll[]>([]);
  const [editResetPolls, setEditResetPolls] = useState<Set<number>>(new Set());

  // 수정 모드 이미지 프리뷰 URL 메모리 누수 방지 (언마운트 시 해제)
  useEffect(() => {
    return () => { editNewImagePreviews.forEach(u => URL.revokeObjectURL(u)); };
  }, [editNewImagePreviews]);

  const onLongPressStart = useCallback(() => {
    if (!isOwnProfessor) return;
    longPressTimer.current = setTimeout(() => setShowActions(v => !v), 500);
  }, [isOwnProfessor]);

  const onLongPressEnd = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  const handleDelete = useCallback(async () => {
    try { await deleteDoc(doc(db, 'announcements', a.id)); } catch {}
    setShowActions(false);
  }, [a.id]);

  const handleEditStart = useCallback(() => {
    setEditText(a.content || '');
    setEditKeepImages([...imgUrls]);
    setEditNewImages([]);
    setEditNewImagePreviews([]);
    setEditKeepFiles([...fileList]);
    setEditNewFiles([]);
    setEditPolls(pollList.map(p => ({ ...p, votes: { ...p.votes } })));
    setEditResetPolls(new Set());
    setEditing(true);
    setShowActions(false);
    setTimeout(() => {
      const el = editRef.current;
      if (el) { el.focus(); el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
    }, 50);
  }, [a.content, imgUrls, fileList, pollList]);

  const handleEditCancel = useCallback(() => {
    setEditing(false);
    // 미리보기 URL 해제
    editNewImagePreviews.forEach(u => URL.revokeObjectURL(u));
    setEditNewImagePreviews([]);
    setEditNewImages([]);
    setEditNewFiles([]);
  }, [editNewImagePreviews]);

  const handleEditSubmit = useCallback(async () => {
    if (!onEditSubmit || editSubmitting) return;
    const hasContent = editText.trim() || editKeepImages.length || editNewImages.length || editKeepFiles.length || editNewFiles.length || editPolls.length || editResetPolls.size;
    if (!hasContent) return;
    setEditSubmitting(true);
    try {
      await onEditSubmit(a.id, {
        content: editText.trim(),
        keepImageUrls: editKeepImages,
        newImageFiles: editNewImages,
        keepFiles: editKeepFiles,
        newFiles: editNewFiles,
        polls: editPolls,
        resetPollIndices: Array.from(editResetPolls),
        originalPolls: pollList,
      });
      editNewImagePreviews.forEach(u => URL.revokeObjectURL(u));
      setEditing(false);
    } catch {} finally { setEditSubmitting(false); }
  }, [a.id, onEditSubmit, editSubmitting, editText, editKeepImages, editNewImages, editKeepFiles, editNewFiles, editPolls, editResetPolls, editNewImagePreviews, pollList]);

  // 이미지/파일 추가 핸들러
  const onEditImgSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setEditNewImages(prev => [...prev, ...files]);
    setEditNewImagePreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))]);
    e.target.value = '';
  }, []);

  const onEditFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setEditNewFiles(prev => [...prev, ...files]);
    e.target.value = '';
  }, []);

  const bubbleWidth = editing ? 'w-full' : (useFullWidth ? 'w-full' : 'w-fit');

  return (
    <div data-msg-id={a.id}>
      {showDate && a.createdAt && (
        <div className="flex items-center gap-3 my-1.5">
          <div className="flex-1 border-t border-dashed border-white/20" />
          <span className="text-xs text-white/60 whitespace-nowrap">{fmtDate(a.createdAt)}</span>
          <div className="flex-1 border-t border-dashed border-white/20" />
        </div>
      )}
      <div className={`flex gap-2 ${isOwnProfessor ? 'flex-row-reverse' : ''} ${isHighlighted ? 'bg-black/15 rounded-xl p-1 -m-1' : ''}`}>
        {a.profileRabbitId != null ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={getRabbitProfileUrl(a.profileRabbitId)} alt="교수님" className="w-10 h-10 shrink-0 object-cover rounded-full mt-0.5" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/notice/avatar_professor.png" alt="교수님" className="w-10 h-10 shrink-0 object-cover rounded-full mt-0.5" />
        )}
        <div className={`min-w-0 ${editing ? 'w-[65%]' : (useFullWidth ? 'w-[65%]' : 'max-w-[65%]')} ${isOwnProfessor ? 'flex flex-col items-end' : ''}`}>
          <p className={`text-xs font-bold text-white/70 mb-0.5 ${isOwnProfessor ? 'text-right' : ''}`}>Prof. Kim</p>
          <div className={`flex items-center gap-1.5 ${useFullWidth || editing ? 'self-stretch' : ''}`}
            style={{ flexDirection: isOwnProfessor ? 'row' : 'row-reverse' }}
          >
            {/* 수정·삭제 (버블 왼쪽 중앙) */}
            <AnimatePresence>
              {showActions && !editing && (
                <motion.div
                  initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 3 }}
                  transition={{ duration: 0.15 }}
                  className="flex flex-col items-center gap-1 shrink-0"
                >
                  <button onClick={handleEditStart} className="text-base text-white/70 hover:text-white transition-colors">수정</button>
                  <button onClick={handleDelete} className="text-base text-red-400 hover:text-red-300 transition-colors">삭제</button>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="min-w-0 flex-1"
              onTouchStart={onLongPressStart}
              onTouchEnd={onLongPressEnd}
              onTouchCancel={onLongPressEnd}
              onMouseDown={onLongPressStart}
              onMouseUp={onLongPressEnd}
              onMouseLeave={onLongPressEnd}
            >
            <Bubble className={bubbleWidth} sidePadding={(!editing && hasMultiItems) ? BUBBLE_SIDE_MULTI : undefined}>
              {editing ? (
                <div className="space-y-2">
                  {/* 텍스트 편집 */}
                  <div className="flex items-end gap-1">
                    <textarea
                      ref={editRef}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSubmit(); } if (e.key === 'Escape') handleEditCancel(); }}
                      className="flex-1 bg-transparent text-base text-[#1A1A1A] resize-none outline-none leading-snug"
                      style={{ overflowWrap: 'anywhere' }}
                      onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
                      placeholder="내용을 입력하세요"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                    />
                  </div>

                  {/* 이미지 편집: 그리드 + 추가 플레이스홀더 */}
                  <div className="grid grid-cols-3 gap-1">
                    {editKeepImages.map((url, i) => (
                      <div key={`keep-${i}`} className="relative aspect-square">
                        <img src={url} alt="" className="w-full h-full object-cover border border-[#D4CFC4]" />
                        <button onClick={() => setEditKeepImages(prev => prev.filter((_, j) => j !== i))}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center text-white text-xs">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                    {editNewImagePreviews.map((url, i) => (
                      <div key={`new-${i}`} className="relative aspect-square">
                        <img src={url} alt="" className="w-full h-full object-cover border border-[#D4CFC4] opacity-80" />
                        <button onClick={() => { URL.revokeObjectURL(url); setEditNewImages(prev => prev.filter((_, j) => j !== i)); setEditNewImagePreviews(prev => prev.filter((_, j) => j !== i)); }}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center text-white text-xs">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                    {/* + 이미지 추가 플레이스홀더 */}
                    <button onClick={() => editImgRef.current?.click()}
                      className="aspect-square border border-dashed border-[#D4CFC4] flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] hover:border-[#1A1A1A] transition-colors">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
                    </button>
                  </div>

                  {/* 파일 편집: 리스트 + 추가 플레이스홀더 */}
                  <div className="space-y-1">
                    {editKeepFiles.map((f, i) => (
                      <div key={`keep-${i}`} className="flex items-center gap-2 text-xs text-[#1A1A1A]">
                        <svg className="w-3.5 h-3.5 text-[#5C5C5C] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                        <span className="truncate flex-1">{f.name}</span>
                        <button onClick={() => setEditKeepFiles(prev => prev.filter((_, j) => j !== i))}
                          className="shrink-0 text-red-400 hover:text-red-600">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                    {editNewFiles.map((f, i) => (
                      <div key={`new-${i}`} className="flex items-center gap-2 text-xs text-[#5C5C5C]">
                        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                        <span className="truncate flex-1">{f.name}</span>
                        <button onClick={() => setEditNewFiles(prev => prev.filter((_, j) => j !== i))}
                          className="shrink-0 text-red-400 hover:text-red-600">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                    {/* + 파일 추가 플레이스홀더 */}
                    <button onClick={() => editFileRef.current?.click()}
                      className="w-full flex items-center justify-center gap-1 py-1.5 border border-dashed border-[#D4CFC4] text-[#5C5C5C] hover:text-[#1A1A1A] hover:border-[#1A1A1A] text-xs transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
                      파일 추가
                    </button>
                  </div>

                  {/* 투표 편집 */}
                  {editPolls.map((poll, pi) => (
                    <div key={pi} className="border border-[#D4CFC4] p-2 space-y-1">
                      <div className="flex items-center gap-1">
                        <input value={poll.question} onChange={(e) => setEditPolls(prev => prev.map((p, i) => i === pi ? { ...p, question: e.target.value } : p))}
                          className="flex-1 bg-transparent text-sm text-[#1A1A1A] font-bold outline-none border-b border-[#D4CFC4] pb-0.5" placeholder="투표 질문" />
                        <button onClick={() => { setEditPolls(prev => prev.filter((_, i) => i !== pi)); setEditResetPolls(prev => { const s = new Set(prev); s.delete(pi); return s; }); }}
                          className="text-red-400 hover:text-red-600 shrink-0">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                      {poll.options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-1 pl-2">
                          <span className="text-xs text-[#5C5C5C] shrink-0">{oi + 1}.</span>
                          <input value={opt} onChange={(e) => setEditPolls(prev => prev.map((p, i) => i === pi ? { ...p, options: p.options.map((o, j) => j === oi ? e.target.value : o) } : p))}
                            className="flex-1 bg-transparent text-xs text-[#1A1A1A] outline-none border-b border-[#D4CFC4]/50 pb-0.5" placeholder={`선지 ${oi + 1}`} />
                          {poll.options.length > 2 && (
                            <button onClick={() => setEditPolls(prev => prev.map((p, i) => i === pi ? { ...p, options: p.options.filter((_, j) => j !== oi) } : p))}
                              className="text-[#5C5C5C] hover:text-red-400 shrink-0">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="flex items-center justify-between">
                        <button onClick={() => setEditPolls(prev => prev.map((p, i) => i === pi ? { ...p, options: [...p.options, ''] } : p))}
                          className="text-[10px] text-[#5C5C5C] hover:text-[#1A1A1A] pl-2">+ 선지 추가</button>
                        <label className="flex items-center gap-1 cursor-pointer select-none">
                          <input type="checkbox" checked={editResetPolls.has(pi)}
                            onChange={(e) => setEditResetPolls(prev => { const s = new Set(prev); if (e.target.checked) s.add(pi); else s.delete(pi); return s; })}
                            className="w-3 h-3 accent-[#1A1A1A]" />
                          <span className="text-[10px] text-[#5C5C5C]">결과 초기화</span>
                        </label>
                      </div>
                    </div>
                  ))}

                  {/* 하단: 전송 */}
                  <div className="flex items-center justify-end pt-1 border-t border-[#D4CFC4]/50">
                    <button onClick={handleEditSubmit} disabled={editSubmitting}
                      className="text-[#5C5C5C] hover:text-[#1A1A1A] disabled:text-[#D4CFC4] transition-colors">
                      {editSubmitting ? (
                        <div className="w-5 h-5 border-2 border-[#D4CFC4] border-t-[#5C5C5C] rounded-full animate-spin" />
                      ) : (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <input ref={editImgRef} type="file" accept="image/*" multiple className="hidden" onChange={onEditImgSelect} />
                  <input ref={editFileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" multiple className="hidden" onChange={onEditFileSelect} />
                </div>
              ) : (
                <>
                  <MessageContent content={a.content} />
                  <ImageCarousel urls={imgUrls} onImageClick={onImageClick} />
                  <FileCarousel files={fileList} />
                  <PollCarousel polls={pollList} announcementId={a.id} profileUid={profileUid} onVote={onVote} isProfessor={isProfessor} />
                </>
              )}
            </Bubble>
            </div>
          </div>
          <p className={`text-xs text-white/50 mt-1 ${isOwnProfessor ? 'text-right' : ''}`}>
            {readCount > 0 && <>{readCount}명 읽음</>}
            {readCount > 0 && a.createdAt && ' · '}
            {a.createdAt && fmtTime(a.createdAt)}
          </p>
          <div className={`flex items-center gap-1 mt-1 relative flex-wrap ${isOwnProfessor ? 'flex-row-reverse' : ''}`}>
            {reactions.map(([emoji, uids]) => (
              <button key={emoji} onClick={() => onReaction(a.id, emoji)}
                className={`text-xs px-1 py-px rounded border ${profileUid && uids.includes(profileUid) ? 'border-white/40 bg-white/20' : 'border-white/20 bg-white/10'}`}
              >
                {emoji} <span className="text-[10px] text-white/60">{uids.length}</span>
              </button>
            ))}
            <button
              ref={emojiBtnRef}
              onClick={(e) => { e.stopPropagation(); onToggleEmojiPicker(showEmojiPickerForThis ? null : a.id); }}
              className="text-white/30 hover:text-white/60 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {showEmojiPickerForThis && emojiBtnRef.current && (() => {
              const rect = emojiBtnRef.current!.getBoundingClientRect();
              return createPortal(
                <>
                  <div className="fixed inset-0 z-[120]" style={{ left: 'var(--modal-left, 0px)' }} onClick={(e) => { e.stopPropagation(); onToggleEmojiPicker(null); }} />
                  <div
                    className="fixed z-[121] bg-black/60 backdrop-blur-md border border-white/20 rounded-lg p-1.5 flex gap-1 shadow-lg"
                    style={{
                      bottom: window.innerHeight - rect.top + 4,
                      ...(isOwnProfessor ? { right: window.innerWidth - rect.right } : { left: rect.left }),
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {REACTION_EMOJIS.map((em) => (
                      <button key={em} onClick={() => onReaction(a.id, em)} className="text-sm hover:scale-110 transition-transform">{em}</button>
                    ))}
                  </div>
                </>,
                document.body,
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
});

export default AnnouncementMessageItem;
