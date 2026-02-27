'use client';

import { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
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
import { scaleCoord } from '@/lib/hooks/useViewportScale';

// ============================================================
// 나선형 배치 워드클라우드
// ============================================================
interface WordPos { x: number; y: number; size: number; text: string; color: string }

function SpiralWordCloud({ data, colors }: { data: { text: string; value: number }[]; colors: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<WordPos[]>([]);
  const [size, setSize] = useState(0);

  // 컨테이너 너비 관찰 → 1:1 정사각형
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width || 0;
      if (w > 0) setSize(w);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (size === 0 || data.length === 0) { setPositions([]); return; }

    const W = size;
    const H = size; // 1:1
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const sorted = [...data].sort((a, b) => b.value - a.value);

    // canvas로 텍스트 너비 측정 (시스템 폰트 — 확실한 측정)
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) { setPositions([]); return; }

    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const result: WordPos[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const word = sorted[i];
      const normalized = word.value / maxVal;
      const fontSize = Math.round(14 + normalized * 38); // 14~52px
      ctx.font = `bold ${fontSize}px sans-serif`;
      const wordW = ctx.measureText(word.text).width + 6;
      const wordH = fontSize * 1.3;

      let found = false;
      // 아르키메데스 나선 탐색
      for (let t = 0; t < 2000; t++) {
        const angle = t * 0.15;
        const radius = t * 0.25;
        const x = W / 2 + radius * Math.cos(angle) - wordW / 2;
        const y = H / 2 + radius * Math.sin(angle) - wordH / 2;

        if (x < 4 || y < 4 || x + wordW > W - 4 || y + wordH > H - 4) continue;

        const collides = placed.some(p =>
          x < p.x + p.w + 3 && x + wordW + 3 > p.x &&
          y < p.y + p.h + 3 && y + wordH + 3 > p.y
        );

        if (!collides) {
          placed.push({ x, y, w: wordW, h: wordH });
          result.push({
            x, y, size: fontSize, text: word.text,
            color: colors[i % colors.length],
          });
          found = true;
          break;
        }
      }
      if (!found && result.length >= 8) break;
    }

    setPositions(result);
  }, [data, colors, size]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      {positions.map((pos) => (
        <span
          key={pos.text}
          className="absolute font-bold whitespace-nowrap"
          style={{
            left: pos.x,
            top: pos.y,
            fontSize: pos.size,
            color: pos.color,
            fontFamily: '"Noto Sans KR", sans-serif',
          }}
        >
          {pos.text}
        </span>
      ))}
    </div>
  );
}

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
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ActivityTab>(() => {
    // 뒤로가기 시 이전 탭 복원
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('manage_activity_tab');
      if (saved && ACTIVITY_TABS.includes(saved as ActivityTab)) return saved as ActivityTab;
    }
    return '참여도';
  });
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [classStudents, setClassStudents] = useState<ClassStudentCounts>({ A: 0, B: 0, C: 0, D: 0 });
  const [studentIds, setStudentIds] = useState<Set<string>>(new Set());
  const [dataLoading, setDataLoading] = useState(true);
  const touchStartX = useRef(0);

  // postId 목록이 실제로 변할 때만 의존 (조회수/좋아요 변화에는 무반응)
  const postIdKey = useMemo(() => posts.map(p => p.id).sort().join(','), [posts]);

  // 댓글 일괄 조회 (getDocs — 대시보드에서 실시간 불필요, 7개 onSnapshot → 병렬 getDocs)
  useEffect(() => {
    if (!courseId || !postIdKey) {
      setComments([]);
      return;
    }

    const postIds = postIdKey.split(',').filter(Boolean);
    if (postIds.length === 0) { setComments([]); return; }

    let cancelled = false;
    const loadComments = async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < postIds.length; i += 30) {
        chunks.push(postIds.slice(i, i + 30));
      }

      const results = await Promise.all(
        chunks.map(chunk =>
          getDocs(query(collection(db, 'comments'), where('postId', 'in', chunk)))
        )
      );

      if (cancelled) return;

      const allComments: ActivityComment[] = [];
      results.forEach(snap => {
        snap.docs.forEach(d => {
          const data = d.data();
          allComments.push({
            authorId: data.authorId || '',
            authorClassType: data.authorClassType,
            postId: data.postId || '',
            createdAt: data.createdAt?.toDate() || new Date(),
          });
        });
      });
      setComments(allComments);
    };

    loadComments();
    return () => { cancelled = true; };
  }, [courseId, postIdKey]);

  // 반별 학생 수 실시간 구독
  useEffect(() => {
    if (!courseId) {
      setDataLoading(false);
      return;
    }

    setDataLoading(true);
    const usersQ = query(
      collection(db, 'users'),
      where('courseId', '==', courseId),
      where('role', '==', 'student')
    );
    const unsub = onSnapshot(usersQ, (snap) => {
      const counts: ClassStudentCounts = { A: 0, B: 0, C: 0, D: 0 };
      const ids = new Set<string>();
      snap.docs.forEach(d => {
        ids.add(d.id);
        const cls = d.data().classId;
        if (cls && counts[cls] !== undefined) counts[cls]++;
      });
      setClassStudents(counts);
      setStudentIds(ids);
      setDataLoading(false);
    });

    return () => unsub();
  }, [courseId]);

  const totalPosts = posts.length;
  const totalStudents = Object.values(classStudents).reduce((a, b) => a + b, 0);

  // 참여 학생 수 (학생만, 교수 제외)
  const uniqueParticipants = useMemo(() => {
    const ids = new Set<string>();
    posts.forEach(p => { if (studentIds.has(p.authorId)) ids.add(p.authorId); });
    comments.forEach(c => { if (studentIds.has(c.authorId)) ids.add(c.authorId); });
    return ids.size;
  }, [posts, comments, studentIds]);

  // 참여율 (%)
  const participationRate = totalStudents > 0 ? Math.min(100, Math.round((uniqueParticipants / totalStudents) * 100)) : 0;

  // 총 활동 (글 + 댓글)
  const totalComments = comments.length;
  const totalActivity = totalPosts + totalComments;

  // 반응률 (반응 있는 글 비율)
  const responseRate = useMemo(() => {
    if (totalPosts === 0) return 0;
    const withReaction = posts.filter(p => p.likes > 0 || p.commentCount > 0).length;
    return Math.round((withReaction / totalPosts) * 100);
  }, [posts, totalPosts]);

  // 읽기→반응 전환율 (조회 탭용)
  const conversionRate = useMemo(() => {
    const totalViews = posts.reduce((s, p) => s + p.viewCount, 0);
    if (totalViews === 0) return '0';
    const totalReactions = posts.reduce((s, p) => s + p.likes + Math.max(0, p.commentCount), 0);
    return Math.min(100, Math.round((totalReactions / totalViews) * 100)).toString();
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

  // 참여 TOP 3 학생 (글×3 + 댓글×2 + 받은 좋아요×1)
  const topParticipants = useMemo(() => {
    const scores: Record<string, { nickname: string; classType?: string; posts: number; comments: number; likes: number }> = {};

    // 닉네임 매핑 (posts에서 추출)
    const nicknameMap: Record<string, string> = {};
    const classMap: Record<string, string | undefined> = {};
    posts.forEach(p => {
      nicknameMap[p.authorId] = p.authorNickname;
      classMap[p.authorId] = p.authorClassType;
    });

    // 글 수
    posts.forEach(p => {
      if (!scores[p.authorId]) scores[p.authorId] = { nickname: p.authorNickname, classType: p.authorClassType, posts: 0, comments: 0, likes: 0 };
      scores[p.authorId].posts++;
      scores[p.authorId].likes += p.likes;
    });

    // 댓글 수
    comments.forEach(c => {
      if (!scores[c.authorId]) scores[c.authorId] = { nickname: nicknameMap[c.authorId] || '알 수 없음', classType: c.authorClassType || classMap[c.authorId], posts: 0, comments: 0, likes: 0 };
      scores[c.authorId].comments++;
    });

    return Object.entries(scores)
      .map(([id, s]) => ({
        id,
        nickname: s.nickname,
        classType: s.classType,
        score: s.posts * 3 + s.comments * 2 + s.likes,
        posts: s.posts,
        comments: s.comments,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [posts, comments]);

  // ── 탭 2: 트렌드 데이터 ──
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  // 요일별 참여 추이 (최근 7일)
  const last7Days = useMemo(() => {
    const today = new Date();
    const days: { date: string; day: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const date = `${d.getMonth() + 1}/${d.getDate()}`;
      const day = DAY_NAMES[d.getDay()];
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(dayStart.getTime() + 86400000);

      const postCount = posts.filter(p => p.createdAt >= dayStart && p.createdAt < dayEnd).length;
      const commentCount = comments.filter(c => c.createdAt >= dayStart && c.createdAt < dayEnd).length;
      days.push({ date, day, count: postCount + commentCount });
    }
    return days;
  }, [posts, comments]);

  const maxDayCount = Math.max(...last7Days.map(d => d.count), 1);

  // 최근 7일이 속한 월·주차 라벨 (월요일 기준)
  const weekRangeLabel = useMemo(() => {
    const today = new Date();
    const dow = today.getDay(); // 0=일
    // 이번 주 월요일
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    const m = monday.getMonth();
    const y = monday.getFullYear();
    // 해당 월 1일의 요일
    const first = new Date(y, m, 1);
    const firstDow = first.getDay();
    // 1일이 속한 주의 월요일 (이전 달일 수 있음)
    let firstMonday: Date;
    if (firstDow === 1) firstMonday = new Date(first);
    else if (firstDow === 0) firstMonday = new Date(y, m, 2); // 일요일이면 다음날 월요일
    else firstMonday = new Date(y, m, 1 + (8 - firstDow));
    // 1일이 화~토면 1일부터가 1주차
    const weekNum = firstDow >= 2
      ? Math.ceil((monday.getDate() - 1) / 7) + 1
      : Math.floor((monday.getDate() - firstMonday.getDate()) / 7) + 1;
    return `${m + 1}월 ${weekNum}주차`;
  }, []);

  // 주간별 참여 추이 (이번 달, 월~일 기준 주차)
  const weeklyPattern = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const lastDay = new Date(year, month + 1, 0);

    // 이번 달 1일 이후 첫 번째 월요일 찾기
    const first = new Date(year, month, 1);
    const firstDow = first.getDay(); // 0=일, 1=월, ...
    // 1일이 월요일(1)이면 그대로, 아니면 다음 월요일
    let firstMonday: Date;
    if (firstDow === 1) {
      firstMonday = new Date(first);
    } else {
      const daysToMon = firstDow === 0 ? 1 : 8 - firstDow;
      firstMonday = new Date(year, month, 1 + daysToMon);
    }

    const weeks: { label: string; sub: string; start: Date; end: Date }[] = [];

    // 1일이 월요일이 아니면 → 1일~첫 월요일 전날을 "0주차"(이전 달 마지막 주)로 표시하지 않고 건너뜀
    // 대신 그 날들은 1주차에 포함
    // → 더 직관적: 1일 포함 첫 월~일 블록을 1주차로
    let weekStart = new Date(firstMonday);
    let weekNum = 1;

    // 1일이 월~토가 아닌 경우(일요일), 1일은 이전 주에 속하므로 건너뜀
    // 1일이 화~일인 경우, 1일~첫 일요일을 1주차 앞부분으로 포함
    if (firstDow !== 1 && firstDow !== 0) {
      // 1일(화~토) ~ 가장 가까운 일요일
      const firstSunday = new Date(year, month, 1 + (7 - firstDow));
      const clampedSun = firstSunday > lastDay ? lastDay : firstSunday;
      weeks.push({
        label: `${weekNum}주차`,
        sub: `${first.getDate()}~${clampedSun.getDate()}일`,
        start: new Date(first),
        end: new Date(clampedSun.getFullYear(), clampedSun.getMonth(), clampedSun.getDate() + 1),
      });
      weekNum++;
      weekStart = new Date(clampedSun);
      weekStart.setDate(weekStart.getDate() + 1); // 다음 월요일
    }

    // 남은 월~일 블록 생성
    while (weekStart <= lastDay) {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6); // 일요일
      const clampedEnd = weekEnd > lastDay ? lastDay : weekEnd;
      weeks.push({
        label: `${weekNum}주차`,
        sub: `${weekStart.getDate()}~${clampedEnd.getDate()}일`,
        start: new Date(weekStart),
        end: new Date(clampedEnd.getFullYear(), clampedEnd.getMonth(), clampedEnd.getDate() + 1),
      });
      weekNum++;
      weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() + 1);
    }

    return weeks.map(w => {
      const postCount = posts.filter(p => p.createdAt >= w.start && p.createdAt < w.end).length;
      const commentCount = comments.filter(c => c.createdAt >= w.start && c.createdAt < w.end).length;
      return { label: w.label, sub: w.sub, count: postCount + commentCount };
    });
  }, [posts, comments]);

  const maxWeekly = Math.max(...weeklyPattern.map(d => d.count), 1);

  // 월별 참여 추이 (학기 단위 ~4개월)
  const monthlyPattern = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth(); // 0-indexed

    // 학기: 1학기 3~6월, 2학기 9~12월, 그 외 최근 4개월
    let semesterStart: Date;
    const year = now.getFullYear();
    if (currentMonth >= 2 && currentMonth <= 5) {
      semesterStart = new Date(year, 2, 1); // 3월
    } else if (currentMonth >= 8 && currentMonth <= 11) {
      semesterStart = new Date(year, 8, 1); // 9월
    } else {
      // 학기 외 — 현재 월 포함 최근 4개월 역산
      const d = new Date(year, currentMonth - 3, 1);
      semesterStart = d;
    }

    const months: { label: string; start: Date; end: Date }[] = [];
    const cursor = new Date(semesterStart);
    for (let i = 0; i < 6; i++) {
      const mStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const mEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      if (mStart > now) break;
      months.push({ label: `${cursor.getMonth() + 1}월`, start: mStart, end: mEnd });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return months.map(m => {
      const postCount = posts.filter(p => p.createdAt >= m.start && p.createdAt < m.end).length;
      const commentCount = comments.filter(c => c.createdAt >= m.start && c.createdAt < m.end).length;
      return { label: m.label, count: postCount + commentCount };
    });
  }, [posts, comments]);

  const maxMonthly = Math.max(...monthlyPattern.map(d => d.count), 1);

  // ── 탭 3: 조회 데이터 ──
  const avgViews = useMemo(() => {
    if (totalPosts === 0) return { value: '0', reachRate: 0 };
    const total = posts.reduce((s, p) => s + p.viewCount, 0);
    const avg = total / totalPosts;
    const reachRate = totalStudents > 0 ? Math.min(100, Math.round((avg / totalStudents) * 100)) : 0;
    return { value: avg.toFixed(1), reachRate };
  }, [posts, totalPosts, totalStudents]);

  // 조회 TOP 3
  const topViewed = useMemo(() => {
    return [...posts]
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 3)
      .map(p => ({
        id: p.id,
        title: p.title,
        views: p.viewCount,
        conversion: p.viewCount > 0
          ? Math.min(100, Math.round(((p.likes + Math.max(0, p.commentCount)) / p.viewCount) * 100))
          : 0,
      }));
  }, [posts]);

  // 탭 스와이프 핸들러
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = scaleCoord(e.touches[0].clientX);
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - scaleCoord(e.changedTouches[0].clientX);
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
      <div className="grid grid-cols-3 gap-2.5">
        {[
          {
            label: '참여율',
            value: `${participationRate}%`,
            sub: `${uniqueParticipants}/${totalStudents}명`,
          },
          {
            label: '총 활동',
            value: `${totalActivity}건`,
            sub: `글 ${totalPosts}·댓글 ${totalComments}`,
          },
          {
            label: '반응률',
            value: `${responseRate}%`,
            sub: '반응 있는 글',
          },
        ].map(item => (
          <div key={item.label} className="min-w-0 px-1.5 py-3.5 border border-[#1A1A1A] bg-[#FDFBF7] text-center overflow-hidden">
            <p className="text-[22px] font-black text-[#1A1A1A] leading-none truncate">
              {item.value}
            </p>
            <p className="text-[11px] text-[#8A8A8A] mt-0.5 truncate">{item.sub}</p>
            <p className="text-xs text-[#5C5C5C] font-medium mt-1.5 truncate">{item.label}</p>
          </div>
        ))}
      </div>

      {/* 탭 버튼 */}
      <div className="flex border-b border-[#1A1A1A]">
        {ACTIVITY_TABS.map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => { setActiveTab(tab); sessionStorage.setItem('manage_activity_tab', tab); }}
            className={`flex-1 py-2.5 text-[13px] font-bold tracking-wide transition-colors ${
              activeTab === tab
                ? 'text-[#1A1A1A] border-b-2 border-[#1A1A1A]'
                : 'text-[#ACACAC]'
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
              <div className="border border-[#1A1A1A] bg-[#FDFBF7] p-4">
                <p className="text-sm font-bold text-[#1A1A1A]">반별 참여 점수</p>
                <p className="text-[11px] text-[#8A8A8A] mt-0.5 mb-4">
                  (글×3 + 댓글×2 + 좋아요×1) / 학생 수
                </p>
                <div className="space-y-3">
                  {classScores.map(({ cls, score }) => {
                    const pct = Math.max((score / maxScore) * 100, score > 0 ? 3 : 0);
                    return (
                      <div key={cls} className="flex items-center gap-2.5">
                        <span className="text-[13px] font-black w-7 text-[#1A1A1A]">{cls}반</span>
                        <div className="flex-1 h-7 bg-[#EDEAE4] relative rounded-sm overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.6, ease: 'easeOut' }}
                            className="h-full rounded-sm"
                            style={{ backgroundColor: CLASS_COLORS[cls] }}
                          />
                        </div>
                        <span className="text-sm font-bold text-[#1A1A1A] w-10 text-right tabular-nums">{score}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 참여 TOP 3 */}
              <div className="border border-[#1A1A1A] bg-[#FDFBF7] p-4">
                <p className="text-sm font-bold text-[#1A1A1A] mb-3">참여 TOP 3</p>
                {topParticipants.length === 0 ? (
                  <p className="text-sm text-[#8A8A8A] text-center py-4">데이터가 부족합니다</p>
                ) : (
                  <div className="space-y-0">
                    {topParticipants.map((s, i) => (
                      <div key={s.id} className="flex items-center gap-2.5 py-2.5 border-b border-[#EDEAE4] last:border-0">
                        <span className="text-base font-black text-[#1A1A1A] w-5">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[13px] font-bold text-[#1A1A1A] truncate block">
                            {s.nickname}{s.classType ? ` · ${s.classType}반` : ''}
                          </span>
                          <span className="text-[10px] text-[#8A8A8A]">
                            글 {s.posts} · 댓글 {s.comments}
                          </span>
                        </div>
                        <span className="text-sm font-black text-[#1A1A1A] tabular-nums">{s.score}점</span>
                      </div>
                    ))}
                  </div>
                )}
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
              {/* 요일별 참여 추이 */}
              <div className="border border-[#1A1A1A] bg-[#FDFBF7] p-4">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-bold text-[#1A1A1A]">요일별 참여 추이</p>
                  <p className="text-sm font-bold text-[#1A1A1A]">{weekRangeLabel}</p>
                </div>
                <p className="text-[11px] text-[#8A8A8A] mt-0.5 mb-3">글 + 댓글 수</p>
                <svg viewBox="0 0 280 125" className="w-full">
                  {last7Days.map((day, i) => {
                    const barW = 26;
                    const gap = (280 - barW * 7) / 8;
                    const x = gap + i * (barW + gap);
                    const barH = (day.count / maxDayCount) * 68;
                    const y = 82 - barH;
                    const isWeekend = day.day === '토' || day.day === '일';
                    return (
                      <g key={i}>
                        <rect x={x} y={y} width={barW} height={Math.max(barH, day.count > 0 ? 2 : 0)} fill="#1A1A1A" rx="1" />
                        {day.count > 0 && (
                          <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1A1A1A">
                            {day.count}
                          </text>
                        )}
                        <text x={x + barW / 2} y={98} textAnchor="middle" fontSize="10" fill="#8A8A8A">
                          {day.date}
                        </text>
                        <text x={x + barW / 2} y={113} textAnchor="middle" fontSize="10" fontWeight="600" fill={isWeekend ? '#C47A7A' : '#5C5C5C'}>
                          {day.day}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* 주간별 참여 추이 */}
              <div className="border border-[#1A1A1A] bg-[#FDFBF7] p-4">
                <p className="text-sm font-bold text-[#1A1A1A]">주간별 참여 추이</p>
                <p className="text-[11px] text-[#8A8A8A] mt-0.5 mb-4">{new Date().getMonth() + 1}월 주차별 · 글 + 댓글 수</p>
                {weeklyPattern.length === 0 ? (
                  <p className="text-sm text-[#8A8A8A] text-center py-4">데이터가 부족합니다</p>
                ) : (
                  <div className="space-y-3">
                    {weeklyPattern.map(({ label, sub, count }) => {
                      const pct = Math.max((count / maxWeekly) * 100, count > 0 ? 3 : 0);
                      return (
                        <div key={label} className="flex items-center gap-2.5">
                          <div className="w-16 shrink-0">
                            <span className="text-[13px] font-bold text-[#1A1A1A] block leading-tight">{label}</span>
                            <span className="text-[10px] text-[#8A8A8A] block leading-tight">{sub}</span>
                          </div>
                          <div className="flex-1 h-7 bg-[#EDEAE4] relative rounded-sm overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.6, ease: 'easeOut' }}
                              className="h-full bg-[#1A1A1A] rounded-sm"
                            />
                          </div>
                          <span className="text-sm font-bold text-[#1A1A1A] w-8 text-right tabular-nums">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 월별 참여 추이 */}
              <div className="border border-[#1A1A1A] bg-[#FDFBF7] p-4">
                <p className="text-sm font-bold text-[#1A1A1A]">월별 참여 추이</p>
                <p className="text-[11px] text-[#8A8A8A] mt-0.5 mb-3">학기 단위 · 글 + 댓글 수</p>
                {monthlyPattern.length === 0 ? (
                  <p className="text-sm text-[#8A8A8A] text-center py-4">데이터가 부족합니다</p>
                ) : (
                  <svg viewBox="0 0 280 130" className="w-full">
                    {monthlyPattern.map((m, i) => {
                      const total = monthlyPattern.length;
                      const barW = Math.min(50, (280 - (total + 1) * 20) / total);
                      const gap = (280 - barW * total) / (total + 1);
                      const x = gap + i * (barW + gap);
                      const barH = (m.count / maxMonthly) * 70;
                      const y = 95 - barH;
                      return (
                        <g key={i}>
                          <rect x={x} y={y} width={barW} height={Math.max(barH, m.count > 0 ? 2 : 0)} fill="#1A1A1A" rx="1" />
                          <text x={x + barW / 2} y={y - 7} textAnchor="middle" fontSize="12" fontWeight="700" fill="#1A1A1A">
                            {m.count}
                          </text>
                          <text x={x + barW / 2} y={115} textAnchor="middle" fontSize="11" fontWeight="600" fill="#5C5C5C">
                            {m.label}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
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
              <div className="grid grid-cols-3 gap-2.5">
                <div className="min-w-0 border border-[#1A1A1A] bg-[#FDFBF7] px-1.5 py-3.5 text-center overflow-hidden">
                  <p className="text-[22px] font-black text-[#1A1A1A] leading-none truncate">{avgViews.value}</p>
                  <p className="text-[11px] text-[#8A8A8A] mt-0.5 truncate">글당 평균</p>
                  <p className="text-xs text-[#5C5C5C] font-medium mt-1 truncate">조회수</p>
                </div>
                <div className="min-w-0 border border-[#1A1A1A] bg-[#FDFBF7] px-1.5 py-3.5 text-center overflow-hidden">
                  <p className="text-[22px] font-black text-[#1A1A1A] leading-none truncate">{avgViews.reachRate}%</p>
                  <p className="text-[11px] text-[#8A8A8A] mt-0.5 truncate">글당 학생</p>
                  <p className="text-xs text-[#5C5C5C] font-medium mt-1 truncate">열람률</p>
                </div>
                <div className="min-w-0 border border-[#1A1A1A] bg-[#FDFBF7] px-1.5 py-3.5 text-center overflow-hidden">
                  <p className="text-[22px] font-black text-[#1A1A1A] leading-none truncate">{conversionRate}%</p>
                  <p className="text-[11px] text-[#8A8A8A] mt-0.5 truncate">읽기→반응</p>
                  <p className="text-xs text-[#5C5C5C] font-medium mt-1 truncate">전환율</p>
                </div>
              </div>

              {/* 조회 TOP 3 */}
              <div className="border border-[#1A1A1A] bg-[#FDFBF7] p-4">
                <p className="text-sm font-bold text-[#1A1A1A] mb-3">조회 TOP 3</p>
                {topViewed.length === 0 ? (
                  <p className="text-sm text-[#8A8A8A] text-center py-4">데이터가 부족합니다</p>
                ) : (
                  <div className="space-y-0">
                    {topViewed.map((item, i) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => router.push(`/board/${item.id}`)}
                        className="w-full flex items-center gap-2.5 py-2.5 border-b border-[#EDEAE4] last:border-0 text-left"
                      >
                        <span className="text-base font-black text-[#1A1A1A] w-5">{i + 1}</span>
                        <span className="text-[13px] text-[#1A1A1A] flex-1 truncate">{item.title}</span>
                        <span className="text-xs text-[#5C5C5C] font-medium whitespace-nowrap">
                          {item.views}회 · {item.conversion}%
                        </span>
                      </button>
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

  // 과목 scope 키워드 로드 (courseScopes/{courseId}/chapters/* 의 keywords)
  // Map<소문자, 원문> 으로 저장 — 매칭은 소문자로, 표시는 원문으로
  const [scopeTerms, setScopeTerms] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!isProfessor || !selectedCourseId) return;
    setScopeTerms(new Map()); // 과목 전환 시 이전 데이터 초기화

    const loadScopeKeywords = async () => {
      try {
        const chaptersRef = collection(db, 'courseScopes', selectedCourseId, 'chapters');
        const snap = await getDocs(chaptersRef);
        const terms = new Map<string, string>();
        snap.docs.forEach(d => {
          const kws = d.data()?.keywords;
          if (Array.isArray(kws)) {
            kws.forEach((kw: string) => {
              if (kw && kw.length >= 2) {
                const lower = kw.toLowerCase();
                // 더 짧은 원문 우선 (중복 시)
                if (!terms.has(lower)) terms.set(lower, kw);
              }
            });
          }
        });
        setScopeTerms(terms);
      } catch (err) {
        console.error('scope 키워드 로드 실패:', err);
      }
    };

    loadScopeKeywords();
  }, [isProfessor, selectedCourseId]);

  // 워드클라우드 데이터 — 게시글에서 과목 scope 키워드만 추출 (indexOf로 빠른 매칭)
  const keywords = useMemo(() => {
    if (!allPosts.length || scopeTerms.size === 0) return [];

    // 게시글 전체 텍스트 (소문자)
    const allText = allPosts.map(p => `${p.title} ${p.content}`).join(' ').toLowerCase();

    // indexOf 기반 카운트 (정규식 대비 10배+ 빠름)
    const freq = new Map<string, number>();
    scopeTerms.forEach((original, lower) => {
      let count = 0;
      let pos = 0;
      while ((pos = allText.indexOf(lower, pos)) !== -1) {
        count++;
        pos += lower.length;
      }
      if (count > 0) freq.set(original, count);
    });

    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([text, value]) => ({ text, value }));
  }, [allPosts, scopeTerms]);

  // 학생 훅 (교수님은 skip — 불필요한 Firestore 쿼리 방지)
  const { posts, loading: postsLoading, error: postsError, hasMore, loadMore, refresh: refreshPosts } = useMyPosts(isProfessor);
  const { deletePost } = useDeletePost();
  const { comments, loading: commentsLoading, error: commentsError, refresh: refreshComments } = useMyComments(isProfessor);
  const { deleteComment } = useDeleteComment();
  const { posts: likedPosts, loading: likedLoading, error: likedError } = useMyLikedPosts(isProfessor);
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
            onTouchStart={(e) => { courseTouchStartX.current = scaleCoord(e.touches[0].clientX); }}
            onTouchMove={(e) => { courseTouchEndX.current = scaleCoord(e.touches[0].clientX); }}
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
              {/* ── ACTIVITY ── */}
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                  <h2 className="font-serif-display text-lg font-bold text-[#1A1A1A]">ACTIVITY</h2>
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                </div>

                <ActivitySection posts={allPosts} courseId={selectedCourseId} />
              </section>

              {/* ── KEYWORD CLOUD ── */}
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                  <h2 className="font-serif-display text-lg font-bold text-[#1A1A1A]">KEYWORD CLOUD</h2>
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                </div>

                <div className="border border-[#1A1A1A] bg-[#FDFBF7] overflow-hidden" style={{ aspectRatio: '1 / 1' }}>
                  {keywords.length === 0 ? (
                    <div className="w-full h-full flex items-center justify-center">
                      <p className="text-sm text-[#5C5C5C]">
                        {scopeTerms.size === 0 ? '과목 범위(scope)가 업로드되지 않았습니다' : '매칭되는 키워드가 없습니다'}
                      </p>
                    </div>
                  ) : (
                    <SpiralWordCloud data={keywords} colors={CLOUD_COLORS} />
                  )}
                </div>
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
