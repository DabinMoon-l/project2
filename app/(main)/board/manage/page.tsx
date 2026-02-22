'use client';

import { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useTheme } from '@/styles/themes/useTheme';
import { Skeleton } from '@/components/common';
import { useUser, useCourse } from '@/lib/contexts';
import {
  useMyPosts,
  useDeletePost,
  useMyComments,
  useDeleteComment,
  useMyLikedPosts,
  useAllPostsForCourse,
  type Post,
  type Comment,
} from '@/lib/hooks/useBoard';
import { type CourseId, getCourseList } from '@/lib/types/course';
import { extractKeywords } from '@/lib/utils/koreanStopwords';

// react-d3-cloud는 canvas 측정 사용 → SSR 불가
const WordCloud = dynamic(() => import('react-d3-cloud'), { ssr: false });

// ============================================================
// 반별 테마 색상
// ============================================================
const CLASS_COLORS: Record<string, string> = {
  A: '#8B1A1A',
  B: '#B8860B',
  C: '#1D5D4A',
  D: '#1E3A5F',
};

// 워드클라우드 색상 순환
const CLOUD_COLORS = ['#1A1A1A', '#3A3A3A', '#5C5C5C', '#8B1A1A'];

// ============================================================
// 학생용 컴포넌트
// ============================================================

function formatDate(date: Date) {
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function MyPostCard({
  post,
  onClick,
  onDelete,
}: {
  post: Post;
  onClick: () => void;
  onDelete: () => void;
}) {
  const { theme } = useTheme();

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-b border-[#D4CFC4] pb-3 mb-3"
    >
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left group"
      >
        <h3
          className="text-base font-bold leading-tight mb-1 group-hover:underline line-clamp-1"
          style={{ color: theme.colors.text }}
        >
          {post.title}
        </h3>
        <p
          className="text-xs leading-relaxed line-clamp-2 mb-2"
          style={{ color: theme.colors.textSecondary }}
        >
          {post.content}
        </p>
      </button>

      <div className="flex items-center justify-between">
        <div
          className="flex items-center gap-3 text-xs"
          style={{ color: theme.colors.textSecondary }}
        >
          <span>{formatDate(post.createdAt)}</span>
          <span>♥ {post.likes}</span>
          <span>댓글 {post.commentCount}</span>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-xs transition-colors"
          style={{ color: '#8B1A1A' }}
        >
          삭제
        </button>
      </div>
    </motion.article>
  );
}

function MyCommentCard({
  comment,
  onDelete,
  onGoToPost,
}: {
  comment: Comment & { postTitle?: string };
  onDelete: (commentId: string, postId: string) => void;
  onGoToPost: (postId: string) => void;
}) {
  const { theme } = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-b border-[#D4CFC4] pb-3 mb-3"
    >
      <button
        type="button"
        onClick={() => onGoToPost(comment.postId)}
        className="text-xs mb-1 hover:underline truncate block w-full text-left"
        style={{ color: theme.colors.accent }}
      >
        {comment.postTitle || '삭제된 게시글'}
      </button>

      <button
        type="button"
        onClick={() => onGoToPost(comment.postId)}
        className="w-full text-left"
      >
        <p
          className="text-sm leading-relaxed line-clamp-2 break-all mb-2"
          style={{ color: theme.colors.text }}
        >
          {comment.content}
        </p>
      </button>

      <div className="flex items-center justify-between">
        <span
          className="text-xs"
          style={{ color: theme.colors.textSecondary }}
        >
          {formatDate(comment.createdAt)}
        </span>

        <button
          type="button"
          onClick={() => onDelete(comment.id, comment.postId)}
          className="text-xs transition-colors"
          style={{ color: '#8B1A1A' }}
        >
          삭제
        </button>
      </div>
    </motion.div>
  );
}

function LikedPostCard({
  post,
  onClick,
}: {
  post: Post;
  onClick: () => void;
}) {
  const { theme } = useTheme();

  return (
    <motion.article
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={onClick}
      className="flex-shrink-0 w-48 p-3 cursor-pointer"
      style={{
        border: '1px solid #1A1A1A',
        backgroundColor: theme.colors.backgroundCard,
      }}
    >
      <h3
        className="text-sm font-bold leading-tight mb-1 line-clamp-2"
        style={{ color: theme.colors.text }}
      >
        {post.title}
      </h3>
      <p
        className="text-xs leading-relaxed line-clamp-2 mb-2"
        style={{ color: theme.colors.textSecondary }}
      >
        {post.content}
      </p>
      <div
        className="flex items-center gap-2 text-xs"
        style={{ color: theme.colors.textSecondary }}
      >
        <span>♥ {post.likes}</span>
        <span>댓글 {post.commentCount}</span>
      </div>
    </motion.article>
  );
}

// ============================================================
// 교수님 대시보드 — 인기글 캐러셀
// ============================================================

// ============================================================
// 교수님 대시보드 — 활동 요약
// ============================================================

/** 댓글 데이터 (ActivitySection 내부용) */
interface ActivityComment {
  authorId: string;
  authorClassType?: string;
  postId: string;
  createdAt: Date;
}

/** 반별 학생 수 */
type ClassStudentCounts = Record<string, number>;

const ACTIVITY_TABS = ['참여도', '트렌드', '조회'] as const;
type ActivityTab = typeof ACTIVITY_TABS[number];

function ActivitySection({ posts, courseId }: { posts: Post[]; courseId: string }) {
  const [activeTab, setActiveTab] = useState<ActivityTab>('참여도');
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [classStudents, setClassStudents] = useState<ClassStudentCounts>({ A: 0, B: 0, C: 0, D: 0 });
  const [dataLoading, setDataLoading] = useState(true);
  const touchStartX = useRef(0);

  // 댓글 + 반별 학생 수 로드
  useEffect(() => {
    if (!courseId || posts.length === 0) {
      setDataLoading(false);
      return;
    }

    const loadData = async () => {
      setDataLoading(true);

      // 댓글 로드 — postId들로 30개씩 chunk 쿼리
      const postIds = posts.map(p => p.id);
      const allComments: ActivityComment[] = [];
      for (let i = 0; i < postIds.length; i += 30) {
        const chunk = postIds.slice(i, i + 30);
        const q = query(
          collection(db, 'comments'),
          where('postId', 'in', chunk)
        );
        const snap = await getDocs(q);
        snap.docs.forEach(d => {
          const data = d.data();
          allComments.push({
            authorId: data.authorId || '',
            authorClassType: data.authorClassType,
            postId: data.postId || '',
            createdAt: data.createdAt?.toDate() || new Date(),
          });
        });
      }
      setComments(allComments);

      // 반별 학생 수 로드
      const usersQ = query(
        collection(db, 'users'),
        where('courseId', '==', courseId),
        where('role', '==', 'student')
      );
      const usersSnap = await getDocs(usersQ);
      const counts: ClassStudentCounts = { A: 0, B: 0, C: 0, D: 0 };
      usersSnap.docs.forEach(d => {
        const cls = d.data().classId;
        if (cls && counts[cls] !== undefined) counts[cls]++;
      });
      setClassStudents(counts);

      setDataLoading(false);
    };

    loadData();
  }, [courseId, posts]);

  const totalPosts = posts.length;
  const totalStudents = Object.values(classStudents).reduce((a, b) => a + b, 0);

  // 참여 학생 수 (글 또는 댓글 작성자 unique)
  const uniqueParticipants = useMemo(() => {
    const ids = new Set<string>();
    posts.forEach(p => ids.add(p.authorId));
    comments.forEach(c => ids.add(c.authorId));
    return ids.size;
  }, [posts, comments]);

  // 글당 상호작용 = (좋아요 + 댓글수 합) / 총 게시글
  const avgInteraction = useMemo(() => {
    if (totalPosts === 0) return '0';
    const total = posts.reduce((s, p) => s + p.likes + Math.max(0, p.commentCount), 0);
    return (total / totalPosts).toFixed(1);
  }, [posts, totalPosts]);

  // 읽기→반응 전환율 = (좋아요+댓글수 합) / 조회수 합 × 100
  const conversionRate = useMemo(() => {
    const totalViews = posts.reduce((s, p) => s + p.viewCount, 0);
    if (totalViews === 0) return '0';
    const totalReactions = posts.reduce((s, p) => s + p.likes + Math.max(0, p.commentCount), 0);
    return Math.round((totalReactions / totalViews) * 100).toString();
  }, [posts]);

  // ── 탭 1: 참여도 데이터 ──
  const classScores = useMemo(() => {
    // 반별 글 수
    const postsByClass: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    posts.forEach(p => {
      if (p.authorClassType && postsByClass[p.authorClassType] !== undefined)
        postsByClass[p.authorClassType]++;
    });
    // 반별 댓글 수
    const commentsByClass: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    comments.forEach(c => {
      if (c.authorClassType && commentsByClass[c.authorClassType] !== undefined)
        commentsByClass[c.authorClassType]++;
    });
    // 반별 좋아요 수
    const likesByClass: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    posts.forEach(p => {
      if (p.authorClassType && likesByClass[p.authorClassType] !== undefined)
        likesByClass[p.authorClassType] += p.likes;
    });

    return (['A', 'B', 'C', 'D'] as const).map(cls => {
      const raw = postsByClass[cls] * 3 + commentsByClass[cls] * 2 + likesByClass[cls];
      const students = classStudents[cls] || 1;
      return { cls, score: parseFloat((raw / students).toFixed(1)), raw };
    });
  }, [posts, comments, classStudents]);

  const maxScore = Math.max(...classScores.map(c => c.score), 1);

  // 반응 없는 글 비율
  const noReactionRate = useMemo(() => {
    if (totalPosts === 0) return 0;
    const noReaction = posts.filter(p => p.likes === 0 && p.commentCount === 0).length;
    return Math.round((noReaction / totalPosts) * 100);
  }, [posts, totalPosts]);

  // ── 탭 2: 트렌드 데이터 ──
  const last7Days = useMemo(() => {
    const today = new Date();
    const days: { label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(dayStart.getTime() + 86400000);

      const postCount = posts.filter(p => p.createdAt >= dayStart && p.createdAt < dayEnd).length;
      const commentCount = comments.filter(c => c.createdAt >= dayStart && c.createdAt < dayEnd).length;
      days.push({ label, count: postCount + commentCount });
    }
    return days;
  }, [posts, comments]);

  const maxDayCount = Math.max(...last7Days.map(d => d.count), 1);

  // 월별 참여 추이
  const monthlyPattern = useMemo(() => {
    const monthCounts: Record<string, number> = {};
    const addToMonth = (date: Date) => {
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthCounts[key] = (monthCounts[key] || 0) + 1;
    };
    posts.forEach(p => addToMonth(p.createdAt));
    comments.forEach(c => addToMonth(c.createdAt));

    return Object.entries(monthCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => ({
        label: `${parseInt(key.split('-')[1])}월`,
        count,
      }));
  }, [posts, comments]);

  const maxMonthly = Math.max(...monthlyPattern.map(d => d.count), 1);

  // ── 탭 3: 조회 데이터 ──
  const avgViews = useMemo(() => {
    if (totalPosts === 0) return '0';
    const total = posts.reduce((s, p) => s + p.viewCount, 0);
    return (total / totalPosts).toFixed(1);
  }, [posts, totalPosts]);

  // 잠수 비율: 조회만 하고 반응 안 한 글 비율
  const lurkerRate = useMemo(() => {
    const viewedPosts = posts.filter(p => p.viewCount > 0);
    if (viewedPosts.length === 0) return 0;
    const reactedPosts = viewedPosts.filter(p => p.likes > 0 || p.commentCount > 0);
    return Math.round((1 - reactedPosts.length / viewedPosts.length) * 100);
  }, [posts]);

  // 조회 TOP 3
  const topViewed = useMemo(() => {
    return [...posts]
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 3)
      .map(p => ({
        title: p.title,
        views: p.viewCount,
        conversion: p.viewCount > 0
          ? Math.round(((p.likes + Math.max(0, p.commentCount)) / p.viewCount) * 100)
          : 0,
      }));
  }, [posts]);

  // 탭 스와이프 핸들러
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    const idx = ACTIVITY_TABS.indexOf(activeTab);
    if (diff > 50 && idx < ACTIVITY_TABS.length - 1) {
      setActiveTab(ACTIVITY_TABS[idx + 1]);
    } else if (diff < -50 && idx > 0) {
      setActiveTab(ACTIVITY_TABS[idx - 1]);
    }
  };

  if (dataLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-none" />)}
        </div>
        <Skeleton className="h-48 rounded-none" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 상단 요약 카드 3개 */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: '참여 학생',
            value: `${uniqueParticipants}명`,
            sub: totalStudents > 0 ? `(${Math.round((uniqueParticipants / totalStudents) * 100)}%)` : '',
          },
          { label: '상호작용', value: avgInteraction, sub: '글당' },
          { label: '전환율', value: `${conversionRate}%`, sub: '읽기→반응' },
        ].map(item => (
          <div key={item.label} className="p-3 border border-[#1A1A1A] bg-[#FDFBF7] text-center">
            <p className="text-xl font-black text-[#1A1A1A] leading-tight">
              {item.value}
            </p>
            {item.sub && (
              <p className="text-[9px] text-[#5C5C5C]">{item.sub}</p>
            )}
            <p className="text-[10px] text-[#5C5C5C] mt-1">{item.label}</p>
          </div>
        ))}
      </div>

      {/* 탭 버튼 */}
      <div className="flex border-b border-[#1A1A1A]">
        {ACTIVITY_TABS.map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-bold transition-colors ${
              activeTab === tab
                ? 'text-[#1A1A1A] border-b-2 border-[#1A1A1A]'
                : 'text-[#9A9A9A]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="min-h-[200px]"
      >
        <AnimatePresence mode="wait">
          {activeTab === '참여도' && (
            <motion.div
              key="participation"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {/* 반별 참여 점수 */}
              <div className="border border-[#1A1A1A] bg-[#FDFBF7] p-3">
                <p className="text-xs font-bold text-[#1A1A1A] mb-3">반별 참여 점수</p>
                <p className="text-[9px] text-[#5C5C5C] mb-2">
                  (글×3 + 댓글×2 + 좋아요×1) / 학생 수
                </p>
                <div className="space-y-2">
                  {classScores.map(({ cls, score }) => {
                    const pct = (score / maxScore) * 100;
                    return (
                      <div key={cls} className="flex items-center gap-2">
                        <span className="text-xs font-bold w-6 text-[#1A1A1A]">{cls}반</span>
                        <div className="flex-1 h-5 bg-[#EDEAE4] relative">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.6, ease: 'easeOut' }}
                            className="h-full"
                            style={{ backgroundColor: CLASS_COLORS[cls] }}
                          />
                        </div>
                        <span className="text-xs text-[#5C5C5C] w-10 text-right">{score}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 반응 없는 글 비율 */}
              <div className="border border-[#1A1A1A] bg-[#FDFBF7] p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-[#1A1A1A]">반응 없는 글</p>
                  <p className="text-[9px] text-[#5C5C5C]">좋아요·댓글 0인 글</p>
                </div>
                <p className="text-2xl font-black text-[#1A1A1A]">{noReactionRate}%</p>
              </div>
            </motion.div>
          )}

          {activeTab === '트렌드' && (
            <motion.div
              key="trend"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {/* 7일 참여 추이 */}
              <div className="border border-[#1A1A1A] bg-[#FDFBF7] p-3">
                <p className="text-xs font-bold text-[#1A1A1A] mb-3">7일 참여 추이</p>
                <p className="text-[9px] text-[#5C5C5C] mb-2">글 + 댓글 수</p>
                <svg viewBox="0 0 280 100" className="w-full">
                  {last7Days.map((day, i) => {
                    const barW = 24;
                    const gap = (280 - barW * 7) / 8;
                    const x = gap + i * (barW + gap);
                    const barH = (day.count / maxDayCount) * 65;
                    const y = 75 - barH;
                    return (
                      <g key={i}>
                        <rect x={x} y={y} width={barW} height={barH} fill="#1A1A1A" />
                        {day.count > 0 && (
                          <text x={x + barW / 2} y={y - 4} textAnchor="middle" className="text-[8px] fill-[#1A1A1A]">
                            {day.count}
                          </text>
                        )}
                        <text x={x + barW / 2} y={92} textAnchor="middle" className="text-[8px] fill-[#5C5C5C]">
                          {day.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* 월별 참여 추이 */}
              <div className="border border-[#1A1A1A] bg-[#FDFBF7] p-3">
                <p className="text-xs font-bold text-[#1A1A1A] mb-3">월별 참여 추이</p>
                <p className="text-[9px] text-[#5C5C5C] mb-2">글 + 댓글 수</p>
                {monthlyPattern.length === 0 ? (
                  <p className="text-sm text-[#5C5C5C] text-center py-4">데이터가 부족합니다</p>
                ) : (
                  <div className="space-y-1.5">
                    {monthlyPattern.map(({ label, count }) => {
                      const pct = (count / maxMonthly) * 100;
                      return (
                        <div key={label} className="flex items-center gap-2">
                          <span className="text-xs font-bold w-8 text-[#1A1A1A]">{label}</span>
                          <div className="flex-1 h-5 bg-[#EDEAE4] relative">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.6, ease: 'easeOut' }}
                              className="h-full bg-[#1A1A1A]"
                            />
                          </div>
                          <span className="text-[10px] text-[#5C5C5C] w-8 text-right">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === '조회' && (
            <motion.div
              key="views"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {/* 조회 요약 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-[#1A1A1A] bg-[#FDFBF7] p-3 text-center">
                  <p className="text-2xl font-black text-[#1A1A1A]">{avgViews}</p>
                  <p className="text-[10px] text-[#5C5C5C] mt-1">평균 조회수</p>
                </div>
                <div className="border border-[#1A1A1A] bg-[#FDFBF7] p-3 text-center">
                  <p className="text-2xl font-black text-[#1A1A1A]">{lurkerRate}%</p>
                  <p className="text-[10px] text-[#5C5C5C] mt-1">잠수 비율</p>
                </div>
              </div>

              {/* 조회 TOP 3 */}
              <div className="border border-[#1A1A1A] bg-[#FDFBF7] p-3">
                <p className="text-xs font-bold text-[#1A1A1A] mb-3">조회 TOP 3</p>
                {topViewed.length === 0 ? (
                  <p className="text-sm text-[#5C5C5C] text-center py-4">데이터가 부족합니다</p>
                ) : (
                  <div className="space-y-2">
                    {topViewed.map((item, i) => (
                      <div key={i} className="flex items-center gap-2 py-1.5 border-b border-[#EDEAE4] last:border-0">
                        <span className="text-xs font-black text-[#1A1A1A] w-5">{i + 1}</span>
                        <span className="text-xs text-[#1A1A1A] flex-1 truncate">{item.title}</span>
                        <span className="text-[10px] text-[#5C5C5C] whitespace-nowrap">
                          {item.views}회 · {item.conversion}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ============================================================
// 메인 페이지
// ============================================================

export default function ManagePostsPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const { profile } = useUser();
  const isProfessor = profile?.role === 'professor';
  const searchParams = useSearchParams();
  const { userCourseId } = useCourse();

  // 교수님 — 과목 선택 (URL 파라미터 > 학기별 기본값)
  const courseList = useMemo(() => getCourseList(), []);
  const courseFromUrl = searchParams.get('course') as CourseId | null;
  const [selectedCourseId, setSelectedCourseId] = useState<CourseId>(
    courseFromUrl || (userCourseId as CourseId) || 'microbiology'
  );
  const courseTouchStartX = useRef(0);
  const courseTouchEndX = useRef(0);

  // 교수님 — 전체 게시글 로드
  const { posts: allPosts, loading: allLoading, error: allError } = useAllPostsForCourse(
    isProfessor ? selectedCourseId : undefined
  );

  // 워드클라우드 데이터
  const keywords = useMemo(() => {
    if (!allPosts.length) return [];
    const texts = allPosts.flatMap(p => [p.title, p.content]);
    return extractKeywords(texts);
  }, [allPosts]);

  // 학생 훅
  const { posts, loading: postsLoading, error: postsError, hasMore, loadMore, refresh: refreshPosts } = useMyPosts();
  const { deletePost } = useDeletePost();
  const { comments, loading: commentsLoading, error: commentsError, refresh: refreshComments } = useMyComments();
  const { deleteComment } = useDeleteComment();
  const { posts: likedPosts, loading: likedLoading, error: likedError } = useMyLikedPosts();
  const likesScrollRef = useRef<HTMLDivElement>(null);

  const handlePostClick = useCallback((postId: string) => {
    router.push(`/board/${postId}`);
  }, [router]);

  const handleDeletePost = useCallback(async (postId: string) => {
    if (window.confirm('이 기사를 삭제하시겠습니까?')) {
      const success = await deletePost(postId);
      if (success) refreshPosts();
    }
  }, [deletePost, refreshPosts]);

  const handleDeleteComment = useCallback(async (commentId: string, postId: string) => {
    if (window.confirm('이 댓글을 삭제하시겠습니까?')) {
      const success = await deleteComment(commentId, postId);
      if (success) refreshComments();
    }
  }, [deleteComment, refreshComments]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <div
      className="min-h-screen pb-6 overflow-x-hidden"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* 헤더 */}
      <header className="mx-4 mt-4 pb-4">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-sm py-2 text-[#3A3A3A]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          뒤로가기
        </button>
      </header>

      {isProfessor ? (
        /* ============================================================
         * 교수님 대시보드
         * ============================================================ */
        <div className="px-4 space-y-6 pb-navigation">
          {/* 과목 캐러셀 */}
          <div
            className="border-y-4 border-[#1A1A1A] py-5 flex items-center justify-center gap-2 select-none overflow-hidden"
            onTouchStart={(e) => { courseTouchStartX.current = e.touches[0].clientX; }}
            onTouchMove={(e) => { courseTouchEndX.current = e.touches[0].clientX; }}
            onTouchEnd={() => {
              const diff = courseTouchStartX.current - courseTouchEndX.current;
              const idx = courseList.findIndex(c => c.id === selectedCourseId);
              if (diff > 50) {
                const next = idx >= courseList.length - 1 ? 0 : idx + 1;
                setSelectedCourseId(courseList[next].id);
              } else if (diff < -50) {
                const prev = idx <= 0 ? courseList.length - 1 : idx - 1;
                setSelectedCourseId(courseList[prev].id);
              }
            }}
          >
            <button
              type="button"
              onClick={() => {
                const idx = courseList.findIndex(c => c.id === selectedCourseId);
                const prev = idx <= 0 ? courseList.length - 1 : idx - 1;
                setSelectedCourseId(courseList[prev].id);
              }}
              className="p-1 opacity-60 hover:opacity-100 transition-opacity"
            >
              <svg className="w-6 h-6" fill="none" stroke="#1A1A1A" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <AnimatePresence mode="wait">
              <motion.h1
                key={selectedCourseId}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.2 }}
                className="font-serif-display text-4xl md:text-5xl font-black tracking-tight text-[#1A1A1A] text-center whitespace-nowrap"
              >
                {(() => {
                  const name = courseList.find(c => c.id === selectedCourseId)?.nameEn.toUpperCase() || '';
                  const isLong = name.length > 10;
                  return <span className={isLong ? 'text-[2rem] md:text-4xl' : ''}>{name}</span>;
                })()}
              </motion.h1>
            </AnimatePresence>

            <button
              type="button"
              onClick={() => {
                const idx = courseList.findIndex(c => c.id === selectedCourseId);
                const next = idx >= courseList.length - 1 ? 0 : idx + 1;
                setSelectedCourseId(courseList[next].id);
              }}
              className="p-1 opacity-60 hover:opacity-100 transition-opacity"
            >
              <svg className="w-6 h-6" fill="none" stroke="#1A1A1A" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {allError && (
            <div className="p-3 text-sm text-center border border-[#1A1A1A] text-[#8B1A1A]">
              {allError}
            </div>
          )}

          {allLoading ? (
            <div className="space-y-4">
              <Skeleton className="w-full h-[350px] rounded-none" />
              <Skeleton className="w-full h-[180px] rounded-none" />
              <Skeleton className="w-full h-[200px] rounded-none" />
            </div>
          ) : (
            <>
              {/* ── KEYWORD CLOUD ── */}
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                  <h2 className="font-serif-display text-lg font-bold text-[#1A1A1A]">KEYWORD CLOUD</h2>
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                </div>

                <div className="border border-[#1A1A1A] bg-[#FDFBF7] min-h-[350px] flex items-center justify-center overflow-hidden">
                  {keywords.length === 0 ? (
                    <p className="text-sm text-[#5C5C5C]">데이터가 부족합니다</p>
                  ) : (
                    <WordCloud
                      data={keywords}
                      width={360}
                      height={340}
                      font="Playfair Display"
                      fontWeight="bold"
                      fontSize={(word) => Math.max(14, Math.min(60, word.value * 8))}
                      rotate={0}
                      padding={3}
                      fill={(_: unknown, i: number) => CLOUD_COLORS[i % CLOUD_COLORS.length]}
                    />
                  )}
                </div>
              </section>

              {/* ── ACTIVITY ── */}
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                  <h2 className="font-serif-display text-lg font-bold text-[#1A1A1A]">ACTIVITY</h2>
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                </div>

                <ActivitySection posts={allPosts} courseId={selectedCourseId} />
              </section>
            </>
          )}
        </div>
      ) : (
        /* ============================================================
         * 학생 뷰 (기존 그대로)
         * ============================================================ */
        <>
          <div className="mx-4 border-b-2 border-[#1A1A1A] mb-4" />

          <div className="px-4 pb-4">
            <div className="flex items-center justify-center gap-4">
              <div className="flex-1 h-px bg-[#1A1A1A]" />
              <h2 className="font-serif-display text-2xl font-bold text-[#1A1A1A]">
                MANAGE
              </h2>
              <div className="flex-1 h-px bg-[#1A1A1A]" />
            </div>
            <p className="text-center text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
              내가 작성한 기사와 댓글, 좋아요한 글 관리
            </p>
          </div>

          <main className="px-4 space-y-4">
            {/* 기사 + 댓글 */}
            <div className="grid grid-cols-2 gap-4">
              {/* 내 기사 */}
              <div
                className="p-4 h-[45vh] flex flex-col"
                style={{ border: '1px solid #1A1A1A', backgroundColor: theme.colors.backgroundCard }}
              >
                <div className="flex items-center gap-2 mb-4 pb-2 border-b-2 border-[#1A1A1A] flex-shrink-0">
                  <h3 className="text-sm font-bold text-[#1A1A1A]">MY ARTICLES</h3>
                  <span className="text-xs" style={{ color: theme.colors.textSecondary }}>({posts.length})</span>
                </div>

                {postsError && (
                  <div className="p-3 text-xs text-center border border-[#1A1A1A] mb-3 flex-shrink-0">
                    <span style={{ color: '#8B1A1A' }}>{postsError}</span>
                    <button type="button" onClick={refreshPosts} className="ml-2 underline">다시 시도</button>
                  </div>
                )}

                {postsLoading && posts.length === 0 && (
                  <div className="space-y-3 flex-shrink-0">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="border-b border-[#D4CFC4] pb-3">
                        <Skeleton className="w-3/4 h-5 mb-2 rounded-none" />
                        <Skeleton className="w-full h-8 mb-2 rounded-none" />
                      </div>
                    ))}
                  </div>
                )}

                {!postsLoading && posts.length === 0 && !postsError && (
                  <div className="py-8 text-center flex-1 flex items-center justify-center">
                    <p className="text-sm" style={{ color: theme.colors.textSecondary }}>작성한 기사가 없습니다</p>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto">
                  {posts.map(post => (
                    <MyPostCard key={post.id} post={post} onClick={() => handlePostClick(post.id)} onDelete={() => handleDeletePost(post.id)} />
                  ))}
                  {hasMore && (
                    <div className="text-center pt-3">
                      <button type="button" onClick={loadMore} disabled={postsLoading} className="text-xs text-[#1A1A1A] hover:underline disabled:opacity-50">
                        {postsLoading ? '로딩...' : '더보기 →'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 내 댓글 */}
              <div
                className="p-4 h-[45vh] flex flex-col"
                style={{ border: '1px solid #1A1A1A', backgroundColor: theme.colors.backgroundCard }}
              >
                <div className="flex items-center gap-2 mb-4 pb-2 border-b-2 border-[#1A1A1A] flex-shrink-0">
                  <h3 className="text-sm font-bold text-[#1A1A1A]">MY COMMENTS</h3>
                  <span className="text-xs" style={{ color: theme.colors.textSecondary }}>({comments.length})</span>
                </div>

                {commentsError && (
                  <div className="p-3 text-xs text-center border border-[#1A1A1A] mb-3 flex-shrink-0">
                    <span style={{ color: '#8B1A1A' }}>{commentsError}</span>
                    <button type="button" onClick={refreshComments} className="ml-2 underline">다시 시도</button>
                  </div>
                )}

                {commentsLoading && comments.length === 0 && (
                  <div className="space-y-3 flex-shrink-0">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="border-b border-[#D4CFC4] pb-3">
                        <Skeleton className="w-1/2 h-3 mb-2 rounded-none" />
                        <Skeleton className="w-full h-8 mb-2 rounded-none" />
                      </div>
                    ))}
                  </div>
                )}

                {!commentsLoading && comments.length === 0 && !commentsError && (
                  <div className="py-8 text-center flex-1 flex items-center justify-center">
                    <p className="text-sm" style={{ color: theme.colors.textSecondary }}>작성한 댓글이 없습니다</p>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto">
                  {comments.map(comment => (
                    <MyCommentCard key={comment.id} comment={comment} onDelete={handleDeleteComment} onGoToPost={handlePostClick} />
                  ))}
                </div>
              </div>
            </div>

            {/* 좋아요한 글 */}
            <div className="p-4" style={{ border: '1px solid #1A1A1A', backgroundColor: theme.colors.backgroundCard }}>
              <div className="flex items-center gap-2 mb-4 pb-2 border-b-2 border-[#1A1A1A]">
                <h3 className="text-sm font-bold text-[#1A1A1A]">MY LIKES</h3>
                <span className="text-xs" style={{ color: theme.colors.textSecondary }}>({likedPosts.length})</span>
              </div>

              {likedError && (
                <div className="p-3 text-xs text-center border border-[#1A1A1A] mb-3">
                  <span style={{ color: '#8B1A1A' }}>{likedError}</span>
                </div>
              )}

              {likedLoading && likedPosts.length === 0 && (
                <div className="flex gap-3 overflow-hidden">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex-shrink-0 w-48 p-3 border border-[#D4CFC4]">
                      <Skeleton className="w-full h-10 mb-2 rounded-none" />
                      <Skeleton className="w-3/4 h-8 mb-2 rounded-none" />
                    </div>
                  ))}
                </div>
              )}

              {!likedLoading && likedPosts.length === 0 && !likedError && (
                <div className="py-6 text-center">
                  <p className="text-sm" style={{ color: theme.colors.textSecondary }}>좋아요한 기사가 없습니다</p>
                </div>
              )}

              {likedPosts.length > 0 && (
                <div ref={likesScrollRef} className="flex gap-3 overflow-x-auto pb-2" style={{ scrollSnapType: 'x mandatory' }}>
                  {likedPosts.map(post => (
                    <div key={post.id} style={{ scrollSnapAlign: 'start' }}>
                      <LikedPostCard post={post} onClick={() => handlePostClick(post.id)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </main>
        </>
      )}
    </div>
  );
}
