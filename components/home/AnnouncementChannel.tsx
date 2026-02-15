'use client';

import { useState, useEffect } from 'react';
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
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';

/**
 * 공지 타입
 */
interface Announcement {
  id: string;
  content: string;
  imageUrl?: string;
  poll?: {
    question: string;
    options: string[];
    votes: Record<string, string[]>; // optionIndex -> userIds
    allowMultiple: boolean;
  };
  reactions: Record<string, string[]>; // emoji -> userIds
  createdAt: Timestamp;
  createdBy: string;
  courseId: string;
}

/**
 * 이모지 반응 선택 팝업
 */
const REACTION_EMOJIS = ['❤️', '👍', '🔥', '😂', '😮', '😢'];

/**
 * 공지 채널 컴포넌트
 * - 홈에서 미리보기 표시
 * - 터치 시 큰 모달로 전체 공지 표시
 * - 교수님은 작성 가능, 학생은 이모지 반응 가능
 */
export default function AnnouncementChannel() {
  const { profile, isProfessor } = useUser();
  const { userCourseId } = useCourse();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 모달 열림 시 네비게이션 숨김
  useEffect(() => {
    if (showModal) {
      document.body.setAttribute('data-hide-nav', '');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => document.body.removeAttribute('data-hide-nav');
  }, [showModal]);

  // 공지 구독
  useEffect(() => {
    if (!userCourseId) return;

    const q = query(
      collection(db, 'announcements'),
      where('courseId', '==', userCourseId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Announcement[];
      setAnnouncements(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userCourseId]);

  // 공지 작성 (교수님 전용)
  const handlePost = async () => {
    if (!profile || !userCourseId || !newContent.trim()) return;

    try {
      const announcementData: any = {
        content: newContent.trim(),
        reactions: {},
        createdAt: serverTimestamp(),
        createdBy: profile.uid,
        courseId: userCourseId,
      };

      // 투표가 있는 경우
      if (showPollCreator && pollQuestion.trim() && pollOptions.filter(o => o.trim()).length >= 2) {
        announcementData.poll = {
          question: pollQuestion.trim(),
          options: pollOptions.filter(o => o.trim()),
          votes: {},
          allowMultiple: false,
        };
      }

      await addDoc(collection(db, 'announcements'), announcementData);

      // 초기화
      setNewContent('');
      setShowPollCreator(false);
      setPollQuestion('');
      setPollOptions(['', '']);
      setShowComposer(false);
    } catch (error) {
      console.error('공지 작성 실패:', error);
    }
  };

  // 이모지 반응 토글
  const handleReaction = async (announcementId: string, emoji: string) => {
    if (!profile) return;

    const announcement = announcements.find(a => a.id === announcementId);
    if (!announcement) return;

    const currentReactions = announcement.reactions || {};
    const emojiReactions = currentReactions[emoji] || [];
    const hasReacted = emojiReactions.includes(profile.uid);

    const updatedReactions = { ...currentReactions };
    if (hasReacted) {
      updatedReactions[emoji] = emojiReactions.filter(id => id !== profile.uid);
      if (updatedReactions[emoji].length === 0) {
        delete updatedReactions[emoji];
      }
    } else {
      updatedReactions[emoji] = [...emojiReactions, profile.uid];
    }

    try {
      await updateDoc(doc(db, 'announcements', announcementId), {
        reactions: updatedReactions,
      });
    } catch (error) {
      console.error('반응 실패:', error);
    }

    setShowEmojiPicker(null);
  };

  // 투표하기
  const handleVote = async (announcementId: string, optionIndex: number) => {
    if (!profile) return;

    const announcement = announcements.find(a => a.id === announcementId);
    if (!announcement?.poll) return;

    const currentVotes = announcement.poll.votes || {};
    const updatedVotes: Record<string, string[]> = {};

    // 기존 투표 제거 (단일 선택인 경우)
    Object.keys(currentVotes).forEach(key => {
      updatedVotes[key] = currentVotes[key].filter(id => id !== profile.uid);
    });

    // 새 투표 추가
    const optionKey = optionIndex.toString();
    if (!updatedVotes[optionKey]) {
      updatedVotes[optionKey] = [];
    }
    updatedVotes[optionKey].push(profile.uid);

    try {
      await updateDoc(doc(db, 'announcements', announcementId), {
        'poll.votes': updatedVotes,
      });
    } catch (error) {
      console.error('투표 실패:', error);
    }
  };

  // 날짜 포맷팅
  const formatDate = (timestamp: Timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate();
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  };

  // 미리보기용 최신 공지
  const latestAnnouncement = announcements[0];
  const unreadCount = announcements.length;

  return (
    <>
      {/* 홈 미리보기 */}
      <button
        onClick={() => setShowModal(true)}
        className="w-full p-4 border-2 border-[#1A1A1A] bg-[#EDEAE4] text-left hover:bg-[#E5E0D8] transition-colors"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">📢</span>
            <span className="font-bold text-[#1A1A1A]">공지 채널</span>
          </div>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 bg-[#8B1A1A] text-white text-xs font-bold">
              {unreadCount}
            </span>
          )}
        </div>
        {latestAnnouncement ? (
          <p className="text-sm text-[#5C5C5C] truncate">
            {latestAnnouncement.content}
          </p>
        ) : (
          <p className="text-sm text-[#5C5C5C]">
            {loading ? '불러오는 중...' : '공지가 없습니다'}
          </p>
        )}
      </button>

      {/* 모달 — Portal로 body에 렌더링 (부모 z-10 stacking context 탈출) */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
              onClick={() => setShowModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-lg max-h-[85vh] bg-[#F5F0E8] border-2 border-[#1A1A1A] flex flex-col"
              >
                {/* 헤더 */}
                <div className="flex items-center justify-between p-4 border-b-2 border-[#1A1A1A]">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowModal(false)}
                      className="p-1 hover:bg-[#EDEAE4]"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="font-bold text-lg text-[#1A1A1A]">공지 채널</span>
                  </div>
                  <span className="text-sm text-[#5C5C5C]">멤버 {announcements.length > 0 ? '160' : '0'}명</span>
                </div>

                {/* 공지 목록 */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {announcements.length === 0 ? (
                    <div className="text-center py-12 text-[#5C5C5C]">
                      {loading ? '불러오는 중...' : '아직 공지가 없습니다'}
                    </div>
                  ) : (
                    announcements.map((announcement, index) => {
                      // 날짜 구분선
                      const showDateSeparator = index === 0 ||
                        formatDate(announcements[index - 1]?.createdAt) !== formatDate(announcement.createdAt);

                      return (
                        <div key={announcement.id}>
                          {showDateSeparator && (
                            <div className="text-center text-xs text-[#5C5C5C] my-4">
                              {formatDate(announcement.createdAt)}
                            </div>
                          )}

                          {/* 공지 버블 */}
                          <div className="bg-[#EDEAE4] border border-[#D4CFC4] p-3">
                            <p className="text-[#1A1A1A] whitespace-pre-wrap">{announcement.content}</p>

                            {/* 이미지 */}
                            {announcement.imageUrl && (
                              <img
                                src={announcement.imageUrl}
                                alt="공지 이미지"
                                className="mt-2 w-full max-h-48 object-cover border border-[#D4CFC4]"
                              />
                            )}

                            {/* 투표 */}
                            {announcement.poll && (
                              <div className="mt-3 p-3 bg-[#F5F0E8] border border-[#1A1A1A]">
                                <p className="font-bold text-sm mb-2">{announcement.poll.question}</p>
                                <div className="space-y-2">
                                  {announcement.poll.options.map((option, optIdx) => {
                                    const votes = announcement.poll!.votes[optIdx.toString()] || [];
                                    const totalVotes = Object.values(announcement.poll!.votes).flat().length;
                                    const percentage = totalVotes > 0 ? Math.round((votes.length / totalVotes) * 100) : 0;
                                    const hasVoted = profile && votes.includes(profile.uid);

                                    return (
                                      <button
                                        key={optIdx}
                                        onClick={() => handleVote(announcement.id, optIdx)}
                                        className="w-full text-left"
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className={`w-4 h-4 border-2 border-[#1A1A1A] flex items-center justify-center ${hasVoted ? 'bg-[#1A1A1A]' : ''}`}>
                                            {hasVoted && <span className="text-white text-xs">✓</span>}
                                          </span>
                                          <span className="flex-1 text-sm">{option}</span>
                                          <span className="text-xs text-[#5C5C5C]">{percentage}%</span>
                                        </div>
                                        <div className="mt-1 h-2 bg-[#D4CFC4]">
                                          <div
                                            className="h-full bg-[#1A1A1A] transition-all"
                                            style={{ width: `${percentage}%` }}
                                          />
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* 반응 */}
                          <div className="flex items-center gap-2 mt-1 relative">
                            {/* 기존 반응들 */}
                            {Object.entries(announcement.reactions || {}).map(([emoji, userIds]) => (
                              <button
                                key={emoji}
                                onClick={() => handleReaction(announcement.id, emoji)}
                                className={`flex items-center gap-1 px-2 py-0.5 text-sm border ${
                                  profile && userIds.includes(profile.uid)
                                    ? 'border-[#1A1A1A] bg-[#EDEAE4]'
                                    : 'border-[#D4CFC4]'
                                }`}
                              >
                                <span>{emoji}</span>
                                <span className="text-xs">{userIds.length}</span>
                              </button>
                            ))}

                            {/* 반응 추가 버튼 */}
                            <button
                              onClick={() => setShowEmojiPicker(
                                showEmojiPicker === announcement.id ? null : announcement.id
                              )}
                              className="p-1 text-[#5C5C5C] hover:text-[#1A1A1A]"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </button>

                            {/* 이모지 피커 */}
                            {showEmojiPicker === announcement.id && (
                              <div className="absolute left-0 bottom-full mb-1 bg-white border-2 border-[#1A1A1A] p-2 flex gap-1 z-10">
                                {REACTION_EMOJIS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    onClick={() => handleReaction(announcement.id, emoji)}
                                    className="text-xl hover:scale-125 transition-transform"
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* 시간 */}
                            <span className="ml-auto text-xs text-[#5C5C5C]">
                              {announcement.createdAt?.toDate().toLocaleTimeString('ko-KR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 교수님 입력창 */}
                {isProfessor && (
                  <div className="border-t-2 border-[#1A1A1A] p-4">
                    {showComposer ? (
                      <div className="space-y-3">
                        <textarea
                          value={newContent}
                          onChange={(e) => setNewContent(e.target.value)}
                          placeholder="공지를 입력하세요..."
                          className="w-full p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] resize-none focus:outline-none"
                          rows={3}
                        />

                        {/* 투표 생성 */}
                        {showPollCreator && (
                          <div className="p-3 border border-[#D4CFC4] bg-[#EDEAE4]">
                            <input
                              type="text"
                              value={pollQuestion}
                              onChange={(e) => setPollQuestion(e.target.value)}
                              placeholder="투표 질문"
                              className="w-full p-2 mb-2 border border-[#D4CFC4] bg-[#F5F0E8]"
                            />
                            {pollOptions.map((option, idx) => (
                              <input
                                key={idx}
                                type="text"
                                value={option}
                                onChange={(e) => {
                                  const newOptions = [...pollOptions];
                                  newOptions[idx] = e.target.value;
                                  setPollOptions(newOptions);
                                }}
                                placeholder={`선택지 ${idx + 1}`}
                                className="w-full p-2 mb-1 border border-[#D4CFC4] bg-[#F5F0E8]"
                              />
                            ))}
                            <button
                              onClick={() => setPollOptions([...pollOptions, ''])}
                              className="text-sm text-[#5C5C5C] hover:text-[#1A1A1A]"
                            >
                              + 선택지 추가
                            </button>
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => setShowPollCreator(!showPollCreator)}
                            className={`px-3 py-1 text-sm border ${showPollCreator ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white' : 'border-[#D4CFC4]'}`}
                          >
                            📊 투표
                          </button>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setShowComposer(false);
                                setNewContent('');
                                setShowPollCreator(false);
                              }}
                              className="px-4 py-2 border border-[#D4CFC4] text-sm"
                            >
                              취소
                            </button>
                            <button
                              onClick={handlePost}
                              disabled={!newContent.trim()}
                              className="px-4 py-2 bg-[#1A1A1A] text-white text-sm disabled:opacity-50"
                            >
                              보내기
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowComposer(true)}
                        className="w-full p-3 border-2 border-dashed border-[#D4CFC4] text-[#5C5C5C] hover:border-[#1A1A1A] hover:text-[#1A1A1A] transition-colors"
                      >
                        공지 작성하기...
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
