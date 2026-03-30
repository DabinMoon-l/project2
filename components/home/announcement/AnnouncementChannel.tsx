'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  db,
} from '@/lib/repositories';
import { callFunction } from '@/lib/api';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { useUpload } from '@/lib/hooks/useStorage';
import { ImageViewer } from '@/components/common';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import { useHideNav } from '@/lib/hooks/useHideNav';
import type { Announcement, EditingPoll, EditSubmitData } from './types';
import { getImageUrls, getPolls, getFiles, fmtSize, dateKey, lastReadKey } from './types';
import AnnouncementMessageItem from './AnnouncementMessageItem';
import MediaDrawer from './MediaDrawer';
import { useLogOverlayView } from '@/lib/hooks/usePageViewLogger';

// ─── 모듈 레벨 캐시 (재마운트 시 즉시 표시) ──────────────
const announcementCache = new Map<string, Announcement[]>();

// ─── 메인 컴포넌트 ──────────────────────────────────────

export default function AnnouncementChannel({
  overrideCourseId,
  headerContent,
  isPanelMode,
  onOpenPanel,
  onClosePanel,
}: {
  overrideCourseId?: string;
  headerContent?: React.ReactNode;
  isPanelMode?: boolean;
  onOpenPanel?: () => void;
  onClosePanel?: () => void;
} = {}) {
  const { profile, isProfessor } = useUser();
  const { userCourseId: contextCourseId } = useCourse();
  const userCourseId = overrideCourseId ?? contextCourseId;
  const { theme } = useTheme();
  const logOverlay = useLogOverlayView();
  const { uploadImage, uploadFile, uploadMultipleImages, uploadMultipleFiles, loading: uploadLoading } = useUpload();
  // 캐시된 데이터가 있으면 즉시 표시 (loading=false)
  const cached = userCourseId ? announcementCache.get(userCourseId) : undefined;
  const [announcements, setAnnouncements] = useState<Announcement[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [showModal, setShowModal] = useState(isPanelMode);
  const [showMedia, setShowMedia] = useState<false | 'all' | 'images' | 'files'>(false);
  const [hasText, setHasText] = useState(false);
  const prevOverflowRef = useRef(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  // 캐러셀 투표 편집기: 각 항목이 하나의 투표 폼
  const [editingPolls, setEditingPolls] = useState<EditingPoll[]>([{ question: '', options: ['', ''], allowMultiple: false, maxSelections: 2 }]);
  const [editingPollIdx, setEditingPollIdx] = useState(0);
  const [showMaxSelDropdown, setShowMaxSelDropdown] = useState(false);
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [pendingImagePreviews, setPendingImagePreviews] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [linkedImageUrls, setLinkedImageUrls] = useState<string[]>([]);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInputValue, setUrlInputValue] = useState('');
  const urlInputRef = useRef<HTMLInputElement>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const [viewerImages, setViewerImages] = useState<{ urls: string[]; index: number } | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  const [sheetTop, setSheetTop] = useState(0);
  const [showScrollFab, setShowScrollFab] = useState(false);
  // 모달 콘텐츠 지연 렌더링 (애니메이션 후 메시지 표시)
  const [modalReady, setModalReady] = useState(false);
  // 검색
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [searchIdx, setSearchIdx] = useState(0);
  // 캘린더
  const [showCalendar, setShowCalendar] = useState(false);
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  // 캘린더 닫힐 때 년도/월 초기화
  useEffect(() => {
    if (!showCalendar) {
      setCalYear(new Date().getFullYear());
      setCalMonth(new Date().getMonth());
    }
  }, [showCalendar]);
  // 입력창 확장 (2줄 이상일 때 max-height 해제)
  const [inputExpanded, setInputExpanded] = useState(false);
  const [inputOverflows, setInputOverflows] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 공지 작성 교수의 프로필 토끼 + 닉네임 조회
  const [professorRabbitId, setProfessorRabbitId] = useState<number | null>(null);
  const [professorNickname, setProfessorNickname] = useState<string | null>(null);
  useEffect(() => {
    if (announcements.length === 0) return;
    const creatorUid = announcements[0]?.createdBy;
    if (!creatorUid) return;
    // 이미 공지 데이터에 있으면 조회 불필요
    if (announcements[0]?.profileRabbitId != null) {
      setProfessorRabbitId(announcements[0].profileRabbitId);
    }
    // Firestore에서 교수 프로필 + 닉네임 조회
    import('@/lib/repositories').then(({ doc: docRef, getDoc, db: fireDb }) => {
      getDoc(docRef(fireDb, 'users', creatorUid)).then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setProfessorRabbitId(prev => prev ?? data.profileRabbitId ?? null);
          setProfessorNickname(data.nickname ?? null);
        }
      }).catch(() => {});
    });
  }, [announcements]);

  // courseId 변경 시 캐시에서 즉시 복원 (과목 전환)
  const prevCourseRef = useRef(userCourseId);
  useEffect(() => {
    if (userCourseId && userCourseId !== prevCourseRef.current) {
      prevCourseRef.current = userCourseId;
      const c = announcementCache.get(userCourseId);
      if (c) {
        setAnnouncements(c);
        setLoading(false);
      } else {
        setAnnouncements([]);
        setLoading(true);
      }
      // 과목 전환 시 transient 상태 초기화
      setShowEmojiPicker(null);
      setSearchOpen(false);
      setSearchQuery('');
      setShowCalendar(false);
      setShowMedia(false);
    }
  }, [userCourseId]);

  const scrollFabRef = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const msgAreaRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ─── 네비게이션 숨김 (패널 모드에서는 스킵)
  useHideNav(!!(!isPanelMode && showModal));

  // ─── 모달 열림 시 body 스크롤 방지 (패널 모드에서는 스킵)
  useEffect(() => {
    if (isPanelMode) return;
    if (!showModal) return;
    lockScroll();
    return () => { unlockScroll(); };
  }, [showModal, isPanelMode]);

  // ─── 모달 콘텐츠 지연 렌더링 (입장 애니메이션 후 표시, 닫힐 때 초기화)
  useEffect(() => {
    if (!showModal) {
      setModalReady(false);
      return;
    }
    // 입장 애니메이션 완료 후 메시지 표시 (spring damping:28, stiffness:300 ≈ 350ms)
    const timer = setTimeout(() => setModalReady(true), 350);
    return () => clearTimeout(timer);
  }, [showModal]);

  // ─── 공지 구독 (증분 업데이트: 변경된 문서만 새 객체 생성 → memo 유지)
  useEffect(() => {
    if (!userCourseId) return;
    const cid = userCourseId;
    let isFirst = true;
    const q = query(
      collection(db, 'announcements'),
      where('courseId', '==', cid),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(q, (snap) => {
      if (isFirst) {
        // 최초 로드: 전부 생성
        isFirst = false;
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Announcement[];
        setAnnouncements(data);
        announcementCache.set(cid, data);
        setLoading(false);
        return;
      }
      // 증분: 변경된 문서만 교체, 나머지는 기존 참조 유지
      const changes = snap.docChanges();
      if (changes.length === 0) return;
      setAnnouncements((prev) => {
        const map = new Map(prev.map((a) => [a.id, a]));
        changes.forEach((change) => {
          if (change.type === 'removed') {
            map.delete(change.doc.id);
          } else {
            map.set(change.doc.id, { id: change.doc.id, ...change.doc.data() } as Announcement);
          }
        });
        const sorted = Array.from(map.values()).sort((a, b) => {
          const ta = a.createdAt?.toMillis() ?? 0;
          const tb = b.createdAt?.toMillis() ?? 0;
          return tb - ta;
        });
        announcementCache.set(cid, sorted);
        return sorted;
      });
    }, (err) => {
      console.error('공지 구독 에러:', err);
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

  // ─── 읽음 처리 (모달 열려있는 동안 새 공지도 읽음 처리)
  useEffect(() => {
    if (!showModal || !userCourseId || !profile || !announcements.length) return;
    localStorage.setItem(lastReadKey(userCourseId), new Date().toISOString());
    setHasUnread(false);
    // 아직 읽지 않은 공지만 CF로 읽음 처리
    const unreadIds = announcements.filter((a) => !a.readBy?.includes(profile.uid)).map((a) => a.id);
    if (unreadIds.length > 0) {
      callFunction('markAnnouncementsRead', { announcementIds: unreadIds }).catch(() => {});
    }
  }, [showModal, userCourseId, profile, announcements]);

  // ─── 스크롤
  const scrollPendingRef = useRef(false);

  const scrollToBottom = useCallback((instant?: boolean) => {
    const el = msgAreaRef.current;
    if (!el) return;
    if (instant) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  // modalReady 또는 과목 전환 시 스크롤 예약 (paint 전)
  useLayoutEffect(() => {
    if (modalReady) scrollPendingRef.current = true;
  }, [modalReady, userCourseId]);

  // 예약된 스크롤 실행 (paint 전에 scrollTop 설정 → 깜빡임 방지)
  useLayoutEffect(() => {
    if (!scrollPendingRef.current || !modalReady || !announcements.length || showMedia) return;
    scrollPendingRef.current = false;
    scrollToBottom(true);
  }, [modalReady, announcements, showMedia, scrollToBottom]);

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

  // ─── 이미지 URL 관련
  const IMAGE_URL_PATTERN = /^https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|bmp|svg|avif)(?:[?#]\S*)?$/i;
  const KNOWN_IMAGE_HOST = /^https?:\/\/(?:i\.imgur\.com|firebasestorage\.googleapis\.com|lh[0-9]*\.googleusercontent\.com|cdn\.discordapp\.com|postfiles\.naver\.net|blogfiles\.naver\.net|upload\.wikimedia\.org)\//i;

  const handleAnnouncePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text').trim();
    if (!text) return;
    if (IMAGE_URL_PATTERN.test(text) || KNOWN_IMAGE_HOST.test(text)) {
      if (pendingImages.length + linkedImageUrls.length >= 10) return;
      if (linkedImageUrls.includes(text)) return;
      e.preventDefault();
      setLinkedImageUrls(prev => [...prev, text]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingImages.length, linkedImageUrls]);

  const handleAddAnnounceImageUrl = useCallback(() => {
    const url = urlInputValue.trim();
    if (!url) return;
    if (pendingImages.length + linkedImageUrls.length >= 10) return;
    if (linkedImageUrls.includes(url)) return;
    setLinkedImageUrls(prev => [...prev, url]);
    setUrlInputValue('');
    setTimeout(() => urlInputRef.current?.focus(), 50);
  }, [urlInputValue, pendingImages.length, linkedImageUrls]);

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

  // ─── 드래그 앤 드롭 (PC에서 파일/이미지 드래그로 첨부)
  const dragCountRef = useRef(0);
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCountRef.current++;
    if (dragCountRef.current === 1) setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current <= 0) { dragCountRef.current = 0; setIsDragOver(false); }
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCountRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    const others = files.filter((f) => !f.type.startsWith('image/'));
    if (images.length > 0) {
      setPendingImages((prev) => [...prev, ...images]);
      setPendingImagePreviews((prev) => [...prev, ...images.map((f) => URL.createObjectURL(f))]);
    }
    if (others.length > 0) {
      setPendingFiles((prev) => [...prev, ...others]);
    }
  }, []);

  // ─── 검색 로직
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); setSearchIdx(0); return; }
    const q = searchQuery.toLowerCase();
    const ids = chrono.filter((a) => a.content?.toLowerCase().includes(q)).map((a) => a.id);
    setSearchResults(ids);
    setSearchIdx(0);
  }, [searchQuery, chrono]);

  const scrollToMessage = useCallback((msgId: string) => {
    const el = msgAreaRef.current?.querySelector(`[data-msg-id="${msgId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const navigateSearch = useCallback((dir: 'up' | 'down') => {
    if (!searchResults.length) return;
    const next = dir === 'up' ? searchIdx - 1 : searchIdx + 1;
    if (next < 0 || next >= searchResults.length) return;
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

  // ─── 공지 작성
  const handlePost = async () => {
    const validPolls = showPollCreator ? editingPolls.filter((p) => p.question.trim() && p.options.filter((o) => o.trim()).length >= 2) : [];
    const hasPoll = validPolls.length > 0;
    const content = textareaRef.current?.value?.trim() || '';
    if (!profile || !userCourseId || (!content && !pendingImages.length && !pendingFiles.length && !hasPoll)) return;
    try {
      const data: Record<string, unknown> = {
        content, reactions: {}, readBy: [],
        createdAt: serverTimestamp(), createdBy: profile.uid, courseId: userCourseId,
        profileRabbitId: profile.profileRabbitId ?? null,
      };
      // 이미지 + 파일 동시 병렬 업로드
      const [imgUrls, fileInfos] = await Promise.all([
        pendingImages.length > 0 ? uploadMultipleImages(pendingImages) : Promise.resolve([]),
        pendingFiles.length > 0 ? uploadMultipleFiles(pendingFiles) : Promise.resolve([]),
      ]);
      const allImgUrls = [...imgUrls, ...linkedImageUrls];
      if (allImgUrls.length > 0) data.imageUrls = allImgUrls;
      if (fileInfos.length > 0) {
        data.files = fileInfos.map((fi) => ({ url: fi.url, name: fi.name, type: fi.type, size: fi.size }));
      }
      // 다중 투표 수집
      if (validPolls.length > 0) {
        data.polls = validPolls.map((p) => {
          const opts = p.options.filter((o) => o.trim());
          return {
            question: p.question.trim(), options: opts, votes: {}, allowMultiple: p.allowMultiple,
            ...(p.allowMultiple ? { maxSelections: Math.min(p.maxSelections, opts.length) } : {}),
          };
        });
      }
      await addDoc(collection(db, 'announcements'), data);
      if (textareaRef.current) textareaRef.current.value = '';
      setHasText(false); setShowPollCreator(false);
      setEditingPolls([{ question: '', options: ['', ''], allowMultiple: false, maxSelections: 2 }]);
      setEditingPollIdx(0); clearAllImgs(); setPendingFiles([]); setLinkedImageUrls([]); setShowUrlInput(false); setShowToolbar(false);
      setInputExpanded(false); setInputOverflows(false);
      requestAnimationFrame(() => { const t = textareaRef.current; if (t) t.style.height = '36px'; });
    } catch (err) { console.error('공지 작성 실패:', err); }
  };

  // ─── 메시지 수정 제출 (업로드 + Firestore 업데이트)
  const handleEditSubmitMsg = useCallback(async (id: string, data: EditSubmitData) => {
    const update: Record<string, unknown> = { content: data.content };
    // 이미지/파일 병렬 업로드
    const [newImgUrls, newFileInfos] = await Promise.all([
      data.newImageFiles.length > 0 ? uploadMultipleImages(data.newImageFiles) : Promise.resolve([]),
      data.newFiles.length > 0 ? uploadMultipleFiles(data.newFiles) : Promise.resolve([]),
    ]);
    update.imageUrls = [...data.keepImageUrls, ...newImgUrls];
    update.files = [
      ...data.keepFiles,
      ...newFileInfos.map(fi => ({ url: fi.url, name: fi.name, type: fi.type, size: fi.size })),
    ];
    // 투표: 빈 선지 제거, 빈 질문 투표 제거, 옵션 변경 시 자동 votes 리셋
    update.polls = data.polls
      .map((p, i) => {
        const cleaned = { ...p, options: p.options.filter(o => o.trim()) };
        // 명시적 초기화 대상이거나, 옵션이 변경된 경우 votes 리셋
        // (옵션 순서/내용 변경 시 인덱스 기반 votes 키가 꼬이므로)
        const origPoll = data.originalPolls?.[i];
        const optionsChanged = origPoll && (
          origPoll.options.length !== cleaned.options.length ||
          origPoll.options.some((o: string, j: number) => o !== cleaned.options[j])
        );
        if (data.resetPollIndices.includes(i) || optionsChanged) cleaned.votes = {};
        return cleaned;
      })
      .filter(p => p.question.trim() && p.options.length >= 2);
    await updateDoc(doc(db, 'announcements', id), update);
  }, [uploadMultipleImages, uploadMultipleFiles]);

  // ─── 이모지 반응 (CF에서 호출자 UID만 토글)
  const handleReaction = useCallback(async (aid: string, emoji: string) => {
    if (!profile) return;
    try {
      await callFunction('reactToAnnouncement', { announcementId: aid, emoji });
    } catch {}
    setShowEmojiPicker(null);
  }, [profile]);

  // ─── 투표 (단일/복수 공통, CF에서 호출자 UID만 처리)
  const handleVote = useCallback(async (aid: string, pollIdx: number, optIndices: number[]) => {
    if (!profile || optIndices.length === 0) return;
    try {
      await callFunction('voteOnPoll', { announcementId: aid, pollIdx, optIndices });
    } catch (err) { console.error('투표 실패:', err); }
  }, [profile]);

  // ─── 이모지 피커 토글
  const handleToggleEmojiPicker = useCallback((aid: string | null) => {
    setShowEmojiPicker(aid);
  }, []);

  // ─── 이미지 클릭 (배열 + 인덱스)
  const handleImageClick = useCallback((urls: string[], index: number) => {
    setViewerImages({ urls, index });
  }, []);

  // ─── 파생
  const latest = announcements[0];
  const closeModal = useCallback(() => { if (onClosePanel) { onClosePanel(); return; } setShowModal(false); setShowEmojiPicker(null); setShowMedia(false); setSearchOpen(false); setSearchQuery(''); setShowCalendar(false); }, [onClosePanel]);

  // ─── 캘린더 msgDays 메모이제이션
  const calendarYear = isProfessor ? calYear : new Date().getFullYear();
  const msgDays = useMemo(() => {
    const days = new Set<number>();
    chrono.forEach((a) => {
      if (!a.createdAt) return;
      const d = a.createdAt.toDate();
      if (d.getFullYear() === calendarYear && d.getMonth() === calMonth) {
        days.add(d.getDate());
      }
    });
    return days;
  }, [chrono, calendarYear, calMonth]);

  // ═══════════════════════════════════════════════════════
  // 렌더링
  // ═══════════════════════════════════════════════════════

  return (
    <>
      {/* ═══ 홈 미리보기 (패널 모드에서는 숨김) ═══ */}
      {!isPanelMode && (() => {
        let raw = '아직 공지가 없습니다.';
        if (loading) {
          raw = '불러오는 중...';
        } else if (latest) {
          // 마지막 메시지가 사진/파일만인 경우 대체 텍스트
          const hasImages = getImageUrls(latest).length > 0;
          const hasFiles = getFiles(latest).length > 0;
          if (latest.content) {
            // URL만으로 이루어진 텍스트인 경우
            if (/^\s*https?:\/\/\S+\s*$/.test(latest.content)) {
              raw = '링크를 보냈습니다.';
            } else {
              raw = latest.content;
            }
          } else if (hasImages) {
            raw = '사진을 보냈습니다.';
          } else if (hasFiles) {
            raw = '파일을 보냈습니다.';
          } else if (getPolls(latest).length > 0) {
            raw = '투표를 보냈습니다.';
          }
        }
        return (
          <div ref={previewRef} onTouchStart={e => e.stopPropagation()}>
          <button onClick={() => {
            if (onOpenPanel) { onOpenPanel(); return; }
            logOverlay('announcement_open');
            if (previewRef.current) {
              setSheetTop(previewRef.current.getBoundingClientRect().bottom);
            }
            setShowModal(true);
          }} className="w-full text-left flex items-center">
            <div className="flex-1 min-w-0">
              <p className="text-3xl font-bold text-white truncate leading-tight">{raw}</p>
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

      {/* ═══ 패널 모드: 인라인 렌더링 ═══ */}
      {isPanelMode && showModal && (
        <div className="relative overflow-hidden flex flex-col" style={{ height: 'calc(100% - var(--kb-offset, 0px))' }}>

          {/* 패널 모드 내부 콘텐츠 — 바텀시트와 동일 */}
          {(() => {
            // 아래 modalInner를 공유하기 위해 즉시 실행 함수로 감쌈
            return (<>
                {/* ── 상단 바 ── */}
                <div className="relative z-10 shrink-0 pt-3 pb-2 px-4">
                  {/* 메뉴 + 아이콘 + 닫기 */}
                  <div className="flex items-center gap-1">
                    {/* 메뉴 (미디어) */}
                    <button onClick={() => setShowMedia('all')} className="w-9 h-9 flex items-center justify-center">
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
                            <span className="text-xs text-white/50 shrink-0">{searchResults.length > 0 && `${searchIdx + 1}/${searchResults.length}`}</span>
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
                          <span className="text-xs text-white/50">{searchResults.length > 0 && `${searchIdx + 1}/${searchResults.length}`}</span>
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
                          const firstDay = new Date(calendarYear, calMonth, 1).getDay();
                          const daysInMonth = new Date(calendarYear, calMonth + 1, 0).getDate();
                          const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
                          return (
                            <div>
                              <div className="grid grid-cols-7 gap-0.5 mb-1">
                                {dayLabels.map((d) => (
                                  <div key={d} className="text-center text-[10px] text-white/40 py-0.5">{d}</div>
                                ))}
                              </div>
                              <div className="grid grid-cols-7 gap-1 px-1">
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
                                        const target = chrono.find((a) => {
                                          if (!a.createdAt) return false;
                                          const d = a.createdAt.toDate();
                                          return d.getFullYear() === calendarYear && d.getMonth() === calMonth && d.getDate() === day;
                                        });
                                        if (target) {
                                          setShowCalendar(false);
                                          setTimeout(() => scrollToMessage(target.id), 100);
                                        }
                                      }}
                                      className={`w-7 h-7 mx-auto flex items-center justify-center text-[11px] rounded-full ${hasMsg ? 'bg-white/20 text-white font-bold ring-1 ring-white/40' : 'text-white/40'}`}
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

                {/* ── 메시지 영역 (패널 모드: h-full) ── */}
                <div
                  ref={msgAreaRef}
                  className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-4"
                  onClick={() => setShowEmojiPicker(null)}
                  onScroll={() => {
                    const el = msgAreaRef.current;
                    if (!el) return;
                    const shouldShow = (el.scrollHeight - el.scrollTop - el.clientHeight) > 200;
                    if (shouldShow !== scrollFabRef.current) {
                      scrollFabRef.current = shouldShow;
                      setShowScrollFab(shouldShow);
                    }
                  }}
                >
                  {!modalReady || !announcements.length ? (
                    <div className="h-full flex items-center justify-center text-white/50 text-sm">
                      {loading || !modalReady ? '불러오는 중...' : '아직 공지가 없습니다.'}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {chrono.map((a, i) => {
                        const prev = chrono[i - 1];
                        const showDate = i === 0 || !prev?.createdAt || dateKey(prev.createdAt) !== dateKey(a.createdAt);
                        const isOwnProfessor = !!(isProfessor && profile && a.createdBy === profile.uid);
                        const isHighlighted = searchResults.length > 0 && searchResults[searchIdx] === a.id;

                        return (
                          <AnnouncementMessageItem
                            key={a.id}
                            announcement={a}
                            showDate={showDate}
                            isOwnProfessor={isOwnProfessor}
                            isProfessor={isProfessor}
                            isHighlighted={isHighlighted}
                            showEmojiPickerForThis={showEmojiPicker === a.id}
                            profileUid={profile?.uid}
                            onReaction={handleReaction}
                            onToggleEmojiPicker={handleToggleEmojiPicker}
                            onVote={handleVote}
                            onImageClick={handleImageClick}
                            onEditSubmit={isProfessor ? handleEditSubmitMsg : undefined}
                            professorRabbitId={professorRabbitId}
                            professorNickname={professorNickname ?? undefined}
                          />
                        );
                      })}
                      <div ref={endRef} />
                    </div>
                  )}
                </div>

                {/* ── 하단 FAB 영역 ── */}
                <div className={`absolute ${isProfessor ? 'left-4' : 'right-4'} bottom-20 z-20 flex flex-col gap-2`}>
                  <AnimatePresence>
                    {searchResults.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex flex-col gap-1"
                      >
                        {searchIdx > 0 && (
                          <button
                            onClick={() => navigateSearch('up')}
                            className="w-10 h-10 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white/70 hover:text-white shadow-lg"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                            </svg>
                          </button>
                        )}
                        {searchIdx < searchResults.length - 1 && (
                          <button
                            onClick={() => navigateSearch('down')}
                            className="w-10 h-10 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white/70 hover:text-white shadow-lg"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                            </svg>
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <AnimatePresence>
                    {showScrollFab && !searchQuery && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        onClick={() => scrollToBottom()}
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
                  <div
                    className="relative z-10 shrink-0 mx-3 mb-3 rounded-2xl bg-white/8 backdrop-blur-xl border border-white/15 shadow-[0_4px_24px_rgba(0,0,0,0.25)] px-3 py-3"
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                  >
                    {isDragOver && (
                      <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/10 backdrop-blur-sm border-2 border-dashed border-white/40 rounded-xl pointer-events-none">
                        <p className="text-sm font-bold text-white/70">파일을 여기에 놓으세요</p>
                      </div>
                    )}
                    {showUrlInput && (
                      <div className="mb-2 flex items-center gap-2">
                        <input
                          ref={urlInputRef}
                          type="text"
                          value={urlInputValue}
                          onChange={(e) => setUrlInputValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAnnounceImageUrl(); } }}
                          placeholder="이미지 URL 붙여넣기"
                          className="flex-1 bg-white/10 border border-white/15 rounded-lg text-xs text-white placeholder:text-white/30 px-2.5 py-1.5 focus:outline-none"
                        />
                        <button onClick={handleAddAnnounceImageUrl} className="text-xs font-bold text-white/60 shrink-0">추가</button>
                      </div>
                    )}
                    {linkedImageUrls.length > 0 && (
                      <div className="mb-2 flex gap-1.5 overflow-x-auto">
                        {linkedImageUrls.map((url, idx) => (
                          <div key={`link-${idx}`} className="relative shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt="" className="h-14 object-cover rounded-lg border border-white/15" />
                            <button onClick={() => setLinkedImageUrls(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-1 -right-1 w-4 h-4 bg-white/80 text-black flex items-center justify-center text-[8px] rounded-full">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {(pendingImagePreviews.length > 0 || pendingFiles.length > 0 || showPollCreator) && (
                      <div className="mb-2 space-y-1.5">
                        {pendingImagePreviews.length > 0 && (
                          <div className="flex gap-1.5 overflow-x-auto">
                            {pendingImagePreviews.map((url, idx) => (
                              <div key={`img-preview-${idx}`} className="relative shrink-0">
                                <img src={url} alt="" className="h-14 object-cover rounded-lg border border-white/15" />
                                <button onClick={() => clearImg(idx)} className="absolute -top-1 -right-1 w-4 h-4 bg-white/80 text-black flex items-center justify-center text-[8px] rounded-full">✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                        {pendingFiles.map((f, idx) => (
                          <div key={`file-${f.name}-${idx}`} className="flex items-center gap-2 p-1.5 bg-white/5 border border-white/15 rounded-lg text-[11px]">
                            <span className="truncate flex-1 text-white/80">{f.name}</span>
                            <span className="text-white/40 shrink-0">{fmtSize(f.size)}</span>
                            <button onClick={() => clearFile(idx)} className="text-white/60 font-bold shrink-0">✕</button>
                          </div>
                        ))}
                        {showPollCreator && (() => {
                          const cur = editingPolls[editingPollIdx] || editingPolls[0];
                          const pi = editingPollIdx;
                          const updateCur = (fn: (p: EditingPoll) => EditingPoll) => {
                            setEditingPolls((prev) => prev.map((p, i) => i === pi ? fn(p) : p));
                          };
                          return (
                            <div className="flex items-stretch gap-1.5">
                              <div className="flex-1 min-w-0 p-2 border border-white/15 bg-white/5 rounded-lg space-y-1">
                                {editingPolls.length > 1 && (
                                  <div className="flex items-center justify-between mb-1">
                                    <button
                                      onClick={() => setEditingPollIdx(Math.max(0, pi - 1))}
                                      disabled={pi === 0}
                                      className="p-0.5 text-white/40 hover:text-white/80 disabled:text-white/15 transition-colors"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                                      </svg>
                                    </button>
                                    <div className="flex items-center gap-1">
                                      {editingPolls.map((_, di) => (
                                        <button
                                          key={`poll-dot-${di}`}
                                          onClick={() => setEditingPollIdx(di)}
                                          className={`w-1.5 h-1.5 rounded-full transition-colors ${di === pi ? 'bg-white/80' : 'bg-white/25'}`}
                                        />
                                      ))}
                                    </div>
                                    <button
                                      onClick={() => setEditingPollIdx(Math.min(editingPolls.length - 1, pi + 1))}
                                      disabled={pi === editingPolls.length - 1}
                                      className="p-0.5 text-white/40 hover:text-white/80 disabled:text-white/15 transition-colors"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                      </svg>
                                    </button>
                                  </div>
                                )}
                                <input value={cur.question} onChange={(e) => updateCur((p) => ({ ...p, question: e.target.value }))} placeholder="투표 질문"
                                  className="w-full p-1.5 border border-white/15 bg-white/10 rounded-lg text-[11px] text-white placeholder:text-white/40 focus:outline-none" />
                                {cur.options.map((o, idx) => (
                                  <div key={`opt-${idx}`} className="flex items-center w-full border border-white/15 bg-white/10 rounded-lg">
                                    <input value={o}
                                      onChange={(e) => updateCur((p) => {
                                        const opts = [...p.options]; opts[idx] = e.target.value; return { ...p, options: opts };
                                      })}
                                      placeholder={`선택지 ${idx + 1}`}
                                      className="flex-1 min-w-0 p-1.5 bg-transparent text-[11px] text-white placeholder:text-white/40 focus:outline-none" />
                                    {cur.options.length > 2 && (
                                      <button
                                        onClick={() => updateCur((p) => ({ ...p, options: p.options.filter((_, i) => i !== idx) }))}
                                        className="px-1.5 shrink-0 text-white/30 hover:text-white/70 transition-colors"
                                      >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                ))}
                                <button onClick={() => updateCur((p) => ({ ...p, options: [...p.options, ''] }))} className="text-[11px] text-white/40 hover:text-white/70">+ 선택지 추가</button>
                                <div className="flex items-center gap-2 pt-1 border-t border-white/10">
                                  <label className="flex items-center gap-1.5 text-[11px] text-white/70 cursor-pointer select-none">
                                    <input
                                      type="checkbox" checked={cur.allowMultiple}
                                      onChange={(e) => { updateCur((p) => ({ ...p, allowMultiple: e.target.checked, maxSelections: 2 })); setShowMaxSelDropdown(false); }}
                                      className="w-3 h-3 accent-white"
                                    />
                                    복수선택
                                  </label>
                                  {cur.allowMultiple && (() => {
                                    const totalSlots = Math.max(cur.options.length, 1);
                                    const choices = Array.from({ length: totalSlots }, (_, i) => i + 1);
                                    return (
                                      <div className="flex items-center gap-1">
                                        <span className="text-[11px] text-white/50">최대</span>
                                        <div className="relative">
                                          <button
                                            onClick={() => setShowMaxSelDropdown((v) => !v)}
                                            className="flex items-center gap-0.5 px-2 py-0.5 border border-white/20 bg-white/10 rounded-md text-[11px] text-white hover:bg-white/20 transition-colors"
                                          >
                                            {cur.maxSelections}개
                                            <svg className={`w-2.5 h-2.5 text-white/50 transition-transform ${showMaxSelDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                                            </svg>
                                          </button>
                                          <AnimatePresence>
                                            {showMaxSelDropdown && (
                                              <>
                                                <div className="fixed inset-0 z-30" onClick={() => setShowMaxSelDropdown(false)} />
                                                <motion.div
                                                  initial={{ opacity: 0, y: 4 }}
                                                  animate={{ opacity: 1, y: 0 }}
                                                  exit={{ opacity: 0, y: 4 }}
                                                  transition={{ duration: 0.15 }}
                                                  className="absolute left-0 right-0 bottom-full mb-1 bg-black/70 backdrop-blur-md border border-white/20 rounded-lg overflow-hidden shadow-lg z-40"
                                                >
                                                  {choices.map((n) => (
                                                    <button
                                                      key={n}
                                                      onClick={() => { updateCur((p) => ({ ...p, maxSelections: n })); setShowMaxSelDropdown(false); }}
                                                      className={`w-full px-2 py-1.5 text-[11px] text-center hover:bg-white/15 transition-colors ${n === cur.maxSelections ? 'text-white font-bold bg-white/10' : 'text-white/70'}`}
                                                    >
                                                      {n}개
                                                    </button>
                                                  ))}
                                                </motion.div>
                                              </>
                                            )}
                                          </AnimatePresence>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                  <div className="flex-1" />
                                  {editingPolls.length > 1 && (
                                    <button
                                      onClick={() => {
                                        setEditingPolls((prev) => prev.filter((_, i) => i !== pi));
                                        setEditingPollIdx(Math.max(0, pi - 1));
                                      }}
                                      className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors"
                                    >
                                      삭제
                                    </button>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  setEditingPolls((prev) => [...prev, { question: '', options: ['', ''], allowMultiple: false, maxSelections: 2 }]);
                                  setEditingPollIdx(editingPolls.length);
                                }}
                                className="shrink-0 w-8 flex items-center justify-center border border-white/15 bg-white/5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                                title="투표 추가"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    )}

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
                          onInput={(e) => {
                            const t = e.currentTarget;
                            const hasNow = t.value.trim().length > 0;
                            if (hasNow !== hasText) setHasText(hasNow);
                            t.style.height = 'auto';
                            const oneLineH = 36;
                            const isMultiLine = t.scrollHeight > oneLineH + 4;
                            if (isMultiLine !== prevOverflowRef.current) {
                              prevOverflowRef.current = isMultiLine;
                              setInputOverflows(isMultiLine);
                              if (!isMultiLine) setInputExpanded(false);
                            }
                            if (inputExpanded) {
                              t.style.height = Math.max(t.scrollHeight, oneLineH) + 'px';
                            } else {
                              t.style.height = oneLineH + 'px';
                              t.scrollTop = t.scrollHeight;
                            }
                          }}
                          placeholder="공지를 입력하세요..."
                          className={`w-full bg-white/10 border border-white/15 rounded-2xl resize-none focus:outline-none text-sm text-white placeholder:text-white/40 px-3 py-2 pr-8 min-h-[36px] ${inputExpanded ? '' : 'max-h-[36px] overflow-hidden'}`}
                          rows={1}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          onPaste={handleAnnouncePaste}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
                        />
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
                        disabled={(!hasText && !pendingImages.length && !pendingFiles.length && !linkedImageUrls.length && !(showPollCreator && editingPolls.some((p) => p.question.trim() && p.options.filter((o) => o.trim()).length >= 2))) || uploadLoading}
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

                    <AnimatePresence>
                      {showToolbar && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="flex items-center gap-1.5 pt-2">
                            <button onClick={() => imgRef.current?.click()} className="p-1.5 text-white/50 hover:text-white/80 transition-colors" title="이미지">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </button>
                            <button onClick={() => setShowUrlInput(v => !v)} className={`p-1.5 transition-colors ${showUrlInput ? 'text-white/80' : 'text-white/50 hover:text-white/80'}`} title="URL 이미지">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                              </svg>
                            </button>
                            <button onClick={() => fileRef.current?.click()} className="p-1.5 text-white/50 hover:text-white/80 transition-colors" title="파일">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                              </svg>
                            </button>
                            <button onClick={() => {
                              if (showPollCreator) {
                                setShowPollCreator(false);
                                setEditingPolls([{ question: '', options: ['', ''], allowMultiple: false, maxSelections: 2 }]);
                                setEditingPollIdx(0);
                              } else {
                                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                                setShowPollCreator(true);
                              }
                            }}
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
                      onImageClick={(urls, index) => setViewerImages({ urls, index })}
                      filter={showMedia === 'all' ? undefined : showMedia}
                      onFilterChange={(f) => setShowMedia(f ?? 'all')}
                    />
                  )}
                </AnimatePresence>
            </>);
          })()}
        </div>
      )}

      {/* ═══ 바텀시트 (기본 모드) ═══ */}
      {!isPanelMode && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showModal && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[110] flex items-end bg-black/40"
              style={{ left: 'var(--modal-left, 0px)', right: 'var(--modal-right, 0px)', bottom: 'var(--kb-offset, 0px)' }}
              onClick={() => {
                // 키보드 열림 시 키보드만 닫고 모달 유지 (네이티브 앱 패턴)
                if (document.activeElement instanceof HTMLTextAreaElement ||
                    document.activeElement instanceof HTMLInputElement) {
                  (document.activeElement as HTMLElement).blur();
                  return;
                }
                closeModal();
              }}
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full flex flex-col overflow-hidden rounded-t-2xl will-change-transform"
                style={{ height: sheetTop > 0 ? `calc(100dvh - ${sheetTop + 16}px - var(--kb-offset, 0px))` : `calc(92dvh - var(--kb-offset, 0px))` }}
              >
                {/* ── 배경 이미지 (blur를 이미지에 직접 적용 — backdrop-blur보다 GPU 효율적) ── */}
                <div className="absolute inset-0 rounded-t-2xl overflow-hidden">
                  <img
                    src="/images/home-bg.jpg" alt=""
                    className="w-full h-full object-cover blur-2xl scale-110"
                  />
                </div>
                {/* ── 글래스 오버레이 ── */}
                <div className="absolute inset-0 bg-white/10" />

                {/* ── 상단 바 ── */}
                <div className="relative z-10 shrink-0 pt-3 pb-2 px-4">
                  {/* 드래그 핸들 */}
                  <div className="flex justify-center mb-3">
                    <div className="w-10 h-1 bg-white/40 rounded-full" />
                  </div>
                  {/* 메뉴 + 아이콘 + 닫기 */}
                  <div className="flex items-center gap-1">
                    {/* 메뉴 (미디어) */}
                    <button onClick={() => setShowMedia('all')} className="w-9 h-9 flex items-center justify-center">
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
                            <span className="text-xs text-white/50 shrink-0">{searchResults.length > 0 && `${searchIdx + 1}/${searchResults.length}`}</span>
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
                          <span className="text-xs text-white/50">{searchResults.length > 0 && `${searchIdx + 1}/${searchResults.length}`}</span>
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
                          const firstDay = new Date(calendarYear, calMonth, 1).getDay();
                          const daysInMonth = new Date(calendarYear, calMonth + 1, 0).getDate();
                          const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
                          return (
                            <div>
                              <div className="grid grid-cols-7 gap-0.5 mb-1">
                                {dayLabels.map((d) => (
                                  <div key={d} className="text-center text-[10px] text-white/40 py-0.5">{d}</div>
                                ))}
                              </div>
                              <div className="grid grid-cols-7 gap-1 px-1">
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
                                        const target = chrono.find((a) => {
                                          if (!a.createdAt) return false;
                                          const d = a.createdAt.toDate();
                                          return d.getFullYear() === calendarYear && d.getMonth() === calMonth && d.getDate() === day;
                                        });
                                        if (target) {
                                          setShowCalendar(false);
                                          setTimeout(() => scrollToMessage(target.id), 100);
                                        }
                                      }}
                                      className={`w-7 h-7 mx-auto flex items-center justify-center text-[11px] rounded-full ${hasMsg ? 'bg-white/20 text-white font-bold ring-1 ring-white/40' : 'text-white/40'}`}
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
                  className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-4"
                  onClick={() => setShowEmojiPicker(null)}
                  onScroll={() => {
                    const el = msgAreaRef.current;
                    if (!el) return;
                    const shouldShow = (el.scrollHeight - el.scrollTop - el.clientHeight) > 200;
                    if (shouldShow !== scrollFabRef.current) {
                      scrollFabRef.current = shouldShow;
                      setShowScrollFab(shouldShow);
                    }
                  }}
                >
                  {!modalReady || !announcements.length ? (
                    <div className="h-full flex items-center justify-center text-white/50 text-sm">
                      {loading || !modalReady ? '불러오는 중...' : '아직 공지가 없습니다.'}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {chrono.map((a, i) => {
                        const prev = chrono[i - 1];
                        const showDate = i === 0 || !prev?.createdAt || dateKey(prev.createdAt) !== dateKey(a.createdAt);
                        const isOwnProfessor = !!(isProfessor && profile && a.createdBy === profile.uid);
                        const isHighlighted = searchResults.length > 0 && searchResults[searchIdx] === a.id;

                        return (
                          <AnnouncementMessageItem
                            key={a.id}
                            announcement={a}
                            showDate={showDate}
                            isOwnProfessor={isOwnProfessor}
                            isProfessor={isProfessor}
                            isHighlighted={isHighlighted}
                            showEmojiPickerForThis={showEmojiPicker === a.id}
                            profileUid={profile?.uid}
                            onReaction={handleReaction}
                            onToggleEmojiPicker={handleToggleEmojiPicker}
                            onVote={handleVote}
                            onImageClick={handleImageClick}
                            onEditSubmit={isProfessor ? handleEditSubmitMsg : undefined}
                            professorRabbitId={professorRabbitId}
                            professorNickname={professorNickname ?? undefined}
                          />
                        );
                      })}
                      <div ref={endRef} />
                    </div>
                  )}
                </div>

                {/* ── 하단 FAB 영역 (교수: 좌측, 학생: 우측) ── */}
                <div className={`absolute ${isProfessor ? 'left-4' : 'right-4'} bottom-20 z-20 flex flex-col gap-2`}>
                  {/* 검색 네비게이션 (검색 중일 때만) */}
                  <AnimatePresence>
                    {searchResults.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex flex-col gap-1"
                      >
                        {searchIdx > 0 && (
                          <button
                            onClick={() => navigateSearch('up')}
                            className="w-10 h-10 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white/70 hover:text-white shadow-lg"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                            </svg>
                          </button>
                        )}
                        {searchIdx < searchResults.length - 1 && (
                          <button
                            onClick={() => navigateSearch('down')}
                            className="w-10 h-10 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white/70 hover:text-white shadow-lg"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                            </svg>
                          </button>
                        )}
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
                        onClick={() => scrollToBottom()}
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
                  <div
                    className="relative z-10 shrink-0 mx-3 mb-3 rounded-2xl bg-white/8 backdrop-blur-xl border border-white/15 shadow-[0_4px_24px_rgba(0,0,0,0.25)] px-3 py-3"
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                  >
                    {/* 드래그 오버레이 */}
                    {isDragOver && (
                      <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/10 backdrop-blur-sm border-2 border-dashed border-white/40 rounded-xl pointer-events-none">
                        <p className="text-sm font-bold text-white/70">파일을 여기에 놓으세요</p>
                      </div>
                    )}
                    {/* URL 입력 패널 */}
                    {showUrlInput && (
                      <div className="mb-2 flex items-center gap-2">
                        <input
                          ref={urlInputRef}
                          type="text"
                          value={urlInputValue}
                          onChange={(e) => setUrlInputValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAnnounceImageUrl(); } }}
                          placeholder="이미지 URL 붙여넣기"
                          className="flex-1 bg-white/10 border border-white/15 rounded-lg text-xs text-white placeholder:text-white/30 px-2.5 py-1.5 focus:outline-none"
                        />
                        <button onClick={handleAddAnnounceImageUrl} className="text-xs font-bold text-white/60 shrink-0">추가</button>
                      </div>
                    )}
                    {/* 링크 이미지 미리보기 */}
                    {linkedImageUrls.length > 0 && (
                      <div className="mb-2 flex gap-1.5 overflow-x-auto">
                        {linkedImageUrls.map((url, idx) => (
                          <div key={`link-${idx}`} className="relative shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt="" className="h-14 object-cover rounded-lg border border-white/15" />
                            <button onClick={() => setLinkedImageUrls(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-1 -right-1 w-4 h-4 bg-white/80 text-black flex items-center justify-center text-[8px] rounded-full">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* 첨부 미리보기 */}
                    {(pendingImagePreviews.length > 0 || pendingFiles.length > 0 || showPollCreator) && (
                      <div className="mb-2 space-y-1.5">
                        {/* 다중 이미지 미리보기 */}
                        {pendingImagePreviews.length > 0 && (
                          <div className="flex gap-1.5 overflow-x-auto">
                            {pendingImagePreviews.map((url, idx) => (
                              <div key={`img-preview-${idx}`} className="relative shrink-0">
                                <img src={url} alt="" className="h-14 object-cover rounded-lg border border-white/15" />
                                <button onClick={() => clearImg(idx)} className="absolute -top-1 -right-1 w-4 h-4 bg-white/80 text-black flex items-center justify-center text-[8px] rounded-full">✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* 다중 파일 미리보기 */}
                        {pendingFiles.map((f, idx) => (
                          <div key={`file-${f.name}-${idx}`} className="flex items-center gap-2 p-1.5 bg-white/5 border border-white/15 rounded-lg text-[11px]">
                            <span className="truncate flex-1 text-white/80">{f.name}</span>
                            <span className="text-white/40 shrink-0">{fmtSize(f.size)}</span>
                            <button onClick={() => clearFile(idx)} className="text-white/60 font-bold shrink-0">✕</button>
                          </div>
                        ))}
                        {/* 투표 캐러셀 편집기 */}
                        {showPollCreator && (() => {
                          const cur = editingPolls[editingPollIdx] || editingPolls[0];
                          const pi = editingPollIdx;
                          const updateCur = (fn: (p: EditingPoll) => EditingPoll) => {
                            setEditingPolls((prev) => prev.map((p, i) => i === pi ? fn(p) : p));
                          };
                          return (
                            <div className="flex items-stretch gap-1.5">
                              {/* 메인 투표 폼 */}
                              <div className="flex-1 min-w-0 p-2 border border-white/15 bg-white/5 rounded-lg space-y-1">
                                {/* 투표 인디케이터 (2개 이상일 때) */}
                                {editingPolls.length > 1 && (
                                  <div className="flex items-center justify-between mb-1">
                                    <button
                                      onClick={() => setEditingPollIdx(Math.max(0, pi - 1))}
                                      disabled={pi === 0}
                                      className="p-0.5 text-white/40 hover:text-white/80 disabled:text-white/15 transition-colors"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                                      </svg>
                                    </button>
                                    <div className="flex items-center gap-1">
                                      {editingPolls.map((_, di) => (
                                        <button
                                          key={`poll-dot-${di}`}
                                          onClick={() => setEditingPollIdx(di)}
                                          className={`w-1.5 h-1.5 rounded-full transition-colors ${di === pi ? 'bg-white/80' : 'bg-white/25'}`}
                                        />
                                      ))}
                                    </div>
                                    <button
                                      onClick={() => setEditingPollIdx(Math.min(editingPolls.length - 1, pi + 1))}
                                      disabled={pi === editingPolls.length - 1}
                                      className="p-0.5 text-white/40 hover:text-white/80 disabled:text-white/15 transition-colors"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                      </svg>
                                    </button>
                                  </div>
                                )}
                                <input value={cur.question} onChange={(e) => updateCur((p) => ({ ...p, question: e.target.value }))} placeholder="투표 질문"
                                  className="w-full p-1.5 border border-white/15 bg-white/10 rounded-lg text-[11px] text-white placeholder:text-white/40 focus:outline-none" />
                                {cur.options.map((o, idx) => (
                                  <div key={`opt-${idx}`} className="flex items-center w-full border border-white/15 bg-white/10 rounded-lg">
                                    <input value={o}
                                      onChange={(e) => updateCur((p) => {
                                        const opts = [...p.options]; opts[idx] = e.target.value; return { ...p, options: opts };
                                      })}
                                      placeholder={`선택지 ${idx + 1}`}
                                      className="flex-1 min-w-0 p-1.5 bg-transparent text-[11px] text-white placeholder:text-white/40 focus:outline-none" />
                                    {cur.options.length > 2 && (
                                      <button
                                        onClick={() => updateCur((p) => ({ ...p, options: p.options.filter((_, i) => i !== idx) }))}
                                        className="px-1.5 shrink-0 text-white/30 hover:text-white/70 transition-colors"
                                      >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                ))}
                                <button onClick={() => updateCur((p) => ({ ...p, options: [...p.options, ''] }))} className="text-[11px] text-white/40 hover:text-white/70">+ 선택지 추가</button>
                                {/* 복수선택 + 삭제 */}
                                <div className="flex items-center gap-2 pt-1 border-t border-white/10">
                                  <label className="flex items-center gap-1.5 text-[11px] text-white/70 cursor-pointer select-none">
                                    <input
                                      type="checkbox" checked={cur.allowMultiple}
                                      onChange={(e) => { updateCur((p) => ({ ...p, allowMultiple: e.target.checked, maxSelections: 2 })); setShowMaxSelDropdown(false); }}
                                      className="w-3 h-3 accent-white"
                                    />
                                    복수선택
                                  </label>
                                  {cur.allowMultiple && (() => {
                                    const totalSlots = Math.max(cur.options.length, 1);
                                    const choices = Array.from({ length: totalSlots }, (_, i) => i + 1);
                                    return (
                                      <div className="flex items-center gap-1">
                                        <span className="text-[11px] text-white/50">최대</span>
                                        <div className="relative">
                                          <button
                                            onClick={() => setShowMaxSelDropdown((v) => !v)}
                                            className="flex items-center gap-0.5 px-2 py-0.5 border border-white/20 bg-white/10 rounded-md text-[11px] text-white hover:bg-white/20 transition-colors"
                                          >
                                            {cur.maxSelections}개
                                            <svg className={`w-2.5 h-2.5 text-white/50 transition-transform ${showMaxSelDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                                            </svg>
                                          </button>
                                          <AnimatePresence>
                                            {showMaxSelDropdown && (
                                              <>
                                                <div className="fixed inset-0 z-30" onClick={() => setShowMaxSelDropdown(false)} />
                                                <motion.div
                                                  initial={{ opacity: 0, y: 4 }}
                                                  animate={{ opacity: 1, y: 0 }}
                                                  exit={{ opacity: 0, y: 4 }}
                                                  transition={{ duration: 0.15 }}
                                                  className="absolute left-0 right-0 bottom-full mb-1 bg-black/70 backdrop-blur-md border border-white/20 rounded-lg overflow-hidden shadow-lg z-40"
                                                >
                                                  {choices.map((n) => (
                                                    <button
                                                      key={n}
                                                      onClick={() => { updateCur((p) => ({ ...p, maxSelections: n })); setShowMaxSelDropdown(false); }}
                                                      className={`w-full px-2 py-1.5 text-[11px] text-center hover:bg-white/15 transition-colors ${n === cur.maxSelections ? 'text-white font-bold bg-white/10' : 'text-white/70'}`}
                                                    >
                                                      {n}개
                                                    </button>
                                                  ))}
                                                </motion.div>
                                              </>
                                            )}
                                          </AnimatePresence>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                  <div className="flex-1" />
                                  {/* 이 투표 삭제 (2개 이상일 때만) */}
                                  {editingPolls.length > 1 && (
                                    <button
                                      onClick={() => {
                                        setEditingPolls((prev) => prev.filter((_, i) => i !== pi));
                                        setEditingPollIdx(Math.max(0, pi - 1));
                                      }}
                                      className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors"
                                    >
                                      삭제
                                    </button>
                                  )}
                                </div>
                              </div>
                              {/* 우측 + 버튼 */}
                              <button
                                onClick={() => {
                                  setEditingPolls((prev) => [...prev, { question: '', options: ['', ''], allowMultiple: false, maxSelections: 2 }]);
                                  setEditingPollIdx(editingPolls.length);
                                }}
                                className="shrink-0 w-8 flex items-center justify-center border border-white/15 bg-white/5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                                title="투표 추가"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                            </div>
                          );
                        })()}
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
                          onInput={(e) => {
                            const t = e.currentTarget;
                            // 빈↔비어있지않음 경계에서만 상태 업데이트 (리렌더 최소화)
                            const hasNow = t.value.trim().length > 0;
                            if (hasNow !== hasText) setHasText(hasNow);
                            // 높이 조절 (직접 DOM, 상태 X)
                            t.style.height = 'auto';
                            const oneLineH = 36;
                            const isMultiLine = t.scrollHeight > oneLineH + 4;
                            if (isMultiLine !== prevOverflowRef.current) {
                              prevOverflowRef.current = isMultiLine;
                              setInputOverflows(isMultiLine);
                              if (!isMultiLine) setInputExpanded(false);
                            }
                            if (inputExpanded) {
                              t.style.height = Math.max(t.scrollHeight, oneLineH) + 'px';
                            } else {
                              t.style.height = oneLineH + 'px';
                              t.scrollTop = t.scrollHeight;
                            }
                          }}
                          placeholder="공지를 입력하세요..."
                          className={`w-full bg-white/10 border border-white/15 rounded-2xl resize-none focus:outline-none text-sm text-white placeholder:text-white/40 px-3 py-2 pr-8 min-h-[36px] ${inputExpanded ? '' : 'max-h-[36px] overflow-hidden'}`}
                          rows={1}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          onPaste={handleAnnouncePaste}
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
                        disabled={(!hasText && !pendingImages.length && !pendingFiles.length && !linkedImageUrls.length && !(showPollCreator && editingPolls.some((p) => p.question.trim() && p.options.filter((o) => o.trim()).length >= 2))) || uploadLoading}
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
                            <button onClick={() => setShowUrlInput(v => !v)} className={`p-1.5 transition-colors ${showUrlInput ? 'text-white/80' : 'text-white/50 hover:text-white/80'}`} title="URL 이미지">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                              </svg>
                            </button>
                            <button onClick={() => fileRef.current?.click()} className="p-1.5 text-white/50 hover:text-white/80 transition-colors" title="파일">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                              </svg>
                            </button>
                            <button onClick={() => {
                              if (showPollCreator) {
                                setShowPollCreator(false);
                                setEditingPolls([{ question: '', options: ['', ''], allowMultiple: false, maxSelections: 2 }]);
                                setEditingPollIdx(0);
                              } else {
                                // 키보드 닫고 투표 편집기 열기
                                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                                setShowPollCreator(true);
                              }
                            }}
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
                      onImageClick={(urls, index) => setViewerImages({ urls, index })}
                      filter={showMedia === 'all' ? undefined : showMedia}
                      onFilterChange={(f) => setShowMedia(f ?? 'all')}
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
      {viewerImages && (
        <ImageViewer urls={viewerImages.urls} initialIndex={viewerImages.index} onClose={() => setViewerImages(null)} />
      )}
    </>
  );
}
