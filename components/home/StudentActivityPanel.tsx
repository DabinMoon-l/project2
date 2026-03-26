'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { collection, query, where, orderBy, limit, getDocs, getDoc, doc, db, Timestamp } from '@/lib/repositories';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';

// ── 활동 타입 라벨 ──

const EXP_LABELS: Record<string, string> = {
  quiz_complete: '퀴즈 풀기',
  quiz_create: '퀴즈 만들기',
  quiz_make_public: '퀴즈 공개',
  review_practice: '복습 완료',
  feedback_submit: '피드백 제출',
  post_create: '게시글 작성',
  comment_create: '댓글 작성',
  comment_accepted: '댓글 채택',
  tekken_battle: '배틀',
  rabbit_levelup: '토끼 레벨업',
  other: '기타 활동',
};

const VISIT_LABELS: Record<string, string> = {
  home: '홈',
  quiz_list: '퀴즈 목록',
  quiz_create: '퀴즈 만들기',
  quiz_solve: '퀴즈 풀기',
  quiz_result: '퀴즈 결과',
  quiz_feedback: '퀴즈 피드백',
  review_list: '복습 목록',
  review_practice: '복습 연습',
  review_detail: '복습 상세',
  board_list: '게시판 목록',
  board_detail: '게시글',
  ranking: '랭킹',
  profile: '프로필',
  settings: '설정',
  prof_stats: '통계',
  prof_students: '학생 관리',
  prof_quiz_preview: '퀴즈 미리보기',
  announcement_open: '공지',
  opinion_open: '의견게시판',
  ranking_open: '랭킹',
  other: '기타',
};

// ── 타입 ──

interface ActivityItem {
  id: string;
  timestamp: Date;
  type: 'exp' | 'visit';
  label: string;
  detail?: string;
  exp?: number;
  durationMs?: number;
}

interface StudentActivityPanelProps {
  userId: string;
  nickname: string;
  name?: string;
  classType: string;
  profileRabbitId?: number;
  courseId?: string;
  onBack: () => void;
}

// ── 스크롤 숫자 선택기 (도넛 차트와 동일) ──

function ScrollableDigit({ value, min, max, onChange }: {
  value: number; min: number; max: number;
  onChange: (v: number) => void;
}) {
  const startY = useRef<number | null>(null);
  const accum = useRef(0);
  return (
    <span
      className="inline-block cursor-ns-resize select-none touch-none font-black text-xl text-white tabular-nums leading-none"
      style={{ minWidth: value >= 10 ? '1.5ch' : '0.8ch', textAlign: 'center' }}
      onPointerDown={(e) => { startY.current = e.clientY; accum.current = 0; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => {
        if (startY.current === null) return;
        accum.current += startY.current - e.clientY;
        startY.current = e.clientY;
        if (Math.abs(accum.current) >= 25) {
          const dir = accum.current > 0 ? 1 : -1;
          accum.current = 0;
          const next = value + dir;
          if (next >= min && next <= max) onChange(next);
        }
      }}
      onPointerUp={() => { startY.current = null; }}
      onPointerCancel={() => { startY.current = null; }}
    >
      {value}
    </span>
  );
}

// ── 메인 컴포넌트 ──

export default function StudentActivityPanel({
  userId, nickname, name, classType, profileRabbitId, courseId, onBack,
}: StudentActivityPanelProps) {
  const [studentId, setStudentId] = useState<string>('');
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 날짜 선택
  const todayDate = useMemo(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }, []);
  const [selectedMonth, setSelectedMonth] = useState(todayDate.month);
  const [selectedDay, setSelectedDay] = useState(todayDate.day);

  const maxDayInMonth = useMemo(
    () => new Date(todayDate.year, selectedMonth, 0).getDate(),
    [todayDate.year, selectedMonth],
  );

  const handleMonthChange = useCallback((m: number) => {
    setSelectedMonth(m);
    const maxDay = new Date(todayDate.year, m, 0).getDate();
    setSelectedDay(prev => Math.min(prev, maxDay));
  }, [todayDate.year]);

  const handlePrevDay = useCallback(() => {
    setSelectedDay(prev => {
      if (prev > 1) return prev - 1;
      const newMonth = selectedMonth > 1 ? selectedMonth - 1 : 12;
      setSelectedMonth(newMonth);
      return new Date(todayDate.year, newMonth, 0).getDate();
    });
  }, [selectedMonth, todayDate.year]);

  const handleNextDay = useCallback(() => {
    setSelectedDay(prev => {
      if (prev < maxDayInMonth) return prev + 1;
      const newMonth = selectedMonth < 12 ? selectedMonth + 1 : 1;
      setSelectedMonth(newMonth);
      return 1;
    });
  }, [selectedMonth, maxDayInMonth]);

  // 학생 프로필 (학번) — userId 변경 시 1회만
  useEffect(() => {
    if (!userId) return;
    getDoc(doc(db, 'users', userId)).then(snap => {
      if (snap.exists()) setStudentId(snap.data()?.studentId || '');
    });
  }, [userId]);

  // 날짜별 활동 캐시 (학생 전환 시 초기화)
  const dayCacheRef = useRef(new Map<string, ActivityItem[]>());
  useEffect(() => { dayCacheRef.current.clear(); }, [userId]);

  // 선택된 날짜의 활동 데이터 로드 (하루 단위 동적 쿼리)
  const effectiveDay = Math.min(selectedDay, maxDayInMonth);
  useEffect(() => {
    if (!userId) return;

    const dateKey = `${todayDate.year}-${selectedMonth}-${effectiveDay}`;
    const cached = dayCacheRef.current.get(dateKey);
    if (cached) {
      setActivities(cached);
      setLoading(false);
      return;
    }

    setLoading(true);

    const dayStart = new Date(todayDate.year, selectedMonth - 1, effectiveDay, 0, 0, 0, 0);
    const dayEnd = new Date(todayDate.year, selectedMonth - 1, effectiveDay, 23, 59, 59, 999);
    const tsFrom = Timestamp.fromDate(dayStart);
    const tsTo = Timestamp.fromDate(dayEnd);

    Promise.all([
      // expHistory (선택 날짜)
      getDocs(query(
        collection(db, 'users', userId, 'expHistory'),
        where('createdAt', '>=', tsFrom),
        where('createdAt', '<=', tsTo),
        orderBy('createdAt', 'desc'),
        limit(200),
      )),
      // pageViews (선택 날짜)
      getDocs(query(
        collection(db, 'pageViews'),
        where('userId', '==', userId),
        where('timestamp', '>=', tsFrom),
        where('timestamp', '<=', tsTo),
        orderBy('timestamp', 'desc'),
        limit(200),
      )),
      // rabbitHoldings (선택 날짜 — 토끼 뽑기)
      getDocs(query(
        collection(db, 'users', userId, 'rabbitHoldings'),
        where('createdAt', '>=', tsFrom),
        where('createdAt', '<=', tsTo),
      )),
    ]).then(async ([expSnap, pvSnap, rabbitSnap]) => {

      // expHistory에서 퀴즈 ID + 게시글 ID 수집
      const quizIds = new Set<string>();
      const expPostIds = new Set<string>();
      expSnap.docs.forEach(d => {
        const data = d.data();
        const t = data.type as string;
        const sid = data.sourceId as string | undefined;
        const meta = data.metadata as Record<string, unknown> | undefined;
        if ((t === 'quiz_complete' || t === 'quiz_create' || t === 'quiz_make_public' || t === 'review_practice') && sid) quizIds.add(sid);
        if (t === 'post_create' && sid) expPostIds.add(sid);
        if (t === 'comment_create' && meta?.postId) expPostIds.add(meta.postId as string);
        if (t === 'comment_accepted' && meta?.postId) expPostIds.add(meta.postId as string);
      });

      // 퀴즈 제목 배치 조회
      const quizTitles: Record<string, string> = {};
      const qArr = Array.from(quizIds);
      for (let i = 0; i < qArr.length; i += 10) {
        const batch = qArr.slice(i, i + 10);
        const snaps = await Promise.all(batch.map(id => getDoc(doc(db, 'quizzes', id))));
        snaps.forEach((snap, idx) => {
          if (snap.exists()) quizTitles[batch[idx]] = snap.data()?.title || '';
        });
      }

      // 게시글 제목 배치 조회 (expHistory용)
      const expPostTitles: Record<string, string> = {};
      const epArr = Array.from(expPostIds);
      for (let i = 0; i < epArr.length; i += 10) {
        const batch = epArr.slice(i, i + 10);
        const snaps = await Promise.all(batch.map(id => getDoc(doc(db, 'posts', id))));
        snaps.forEach((snap, idx) => {
          if (snap.exists()) expPostTitles[batch[idx]] = snap.data()?.title || '';
        });
      }

      const items: ActivityItem[] = [];

      // expHistory → ActivityItem
      expSnap.docs.forEach(d => {
        const data = d.data();
        const ts = data.createdAt?.toDate?.() || new Date(0);
        const t = data.type as string;
        const sid = data.sourceId as string | undefined;
        const meta = data.metadata as Record<string, unknown> | undefined;

        let detail: string | undefined = data.reason || undefined;

        // 퀴즈 풀기: 퀴즈 이름 + 점수
        if (t === 'quiz_complete' && sid) {
          const title = quizTitles[sid];
          const scoreMatch = (data.reason || '').match(/점수[:\s]*(\d+)점/);
          const scorePart = scoreMatch ? ` (점수: ${scoreMatch[1]}점)` : '';
          if (title) detail = `${title}${scorePart}`;
        }
        // 복습 완료: 퀴즈 이름
        else if (t === 'review_practice' && sid) {
          const title = quizTitles[sid];
          if (title) detail = title;
        }
        // 퀴즈 만들기/공개: 퀴즈 이름
        else if ((t === 'quiz_create' || t === 'quiz_make_public') && sid) {
          const title = quizTitles[sid];
          if (title) detail = title;
        }
        // 게시글 작성: 글 제목
        else if (t === 'post_create' && sid) {
          const title = expPostTitles[sid];
          if (title) detail = title;
        }
        // 댓글 작성/채택: 게시글 제목
        else if ((t === 'comment_create' || t === 'comment_accepted') && meta?.postId) {
          const title = expPostTitles[meta.postId as string];
          if (title) detail = title;
        }

        // AI 문제 생성 vs 커스텀 퀴즈 만들기 구분
        const label = (t === 'quiz_create' && meta?.isAiSave)
          ? 'AI 문제 생성'
          : EXP_LABELS[t] || t || '활동';

        items.push({
          id: `exp-${d.id}`,
          timestamp: ts,
          type: 'exp',
          label,
          detail,
          exp: data.amount || 0,
        });
      });

      // pageViews → 현재 과목만 필터링 + 상세 페이지 제목 배치 조회
      const pvDocs = courseId
        ? pvSnap.docs.filter(d => {
            const c = d.data().courseId;
            return !c || c === courseId; // courseId 없는 항목도 포함 (오버레이 등)
          })
        : pvSnap.docs;
      const postIds = new Set<string>();
      const pvQuizIds = new Set<string>();
      pvDocs.forEach(d => {
        const data = d.data();
        const path = data.path as string || '';
        if (data.category === 'board_detail') {
          const m = path.match(/^\/board\/([^/]+)/);
          if (m) postIds.add(m[1]);
        }
        if (data.category === 'quiz_solve' || data.category === 'quiz_result' || data.category === 'quiz_feedback') {
          const m = path.match(/^\/quiz\/([^/]+)/);
          if (m && !quizTitles[m[1]]) pvQuizIds.add(m[1]);
        }
        if (data.category === 'review_detail') {
          const m = path.match(/^\/review\/[^/]+\/([^/]+)/);
          if (m && !quizTitles[m[1]]) pvQuizIds.add(m[1]);
        }
      });

      // 게시글 제목 배치 조회
      const postTitles: Record<string, string> = {};
      const pArr = Array.from(postIds);
      for (let i = 0; i < pArr.length; i += 10) {
        const batch = pArr.slice(i, i + 10);
        const snaps = await Promise.all(batch.map(id => getDoc(doc(db, 'posts', id))));
        snaps.forEach((snap, idx) => {
          if (snap.exists()) postTitles[batch[idx]] = snap.data()?.title || '';
        });
      }
      // 추가 퀴즈 제목 조회 (expHistory에서 못 가져온 것)
      const pvqArr = Array.from(pvQuizIds);
      for (let i = 0; i < pvqArr.length; i += 10) {
        const batch = pvqArr.slice(i, i + 10);
        const snaps = await Promise.all(batch.map(id => getDoc(doc(db, 'quizzes', id))));
        snaps.forEach((snap, idx) => {
          if (snap.exists()) quizTitles[batch[idx]] = snap.data()?.title || '';
        });
      }

      // pageViews → ActivityItem
      pvDocs.forEach(d => {
        const data = d.data();
        const ts = data.timestamp?.toDate?.() || new Date(0);
        const path = data.path as string || '';
        const cat = data.category as string || 'other';

        // 상세 페이지: 제목 표시 / 목록 페이지: detail 없음
        let pvDetail: string | undefined;
        if (cat === 'board_detail') {
          const m = path.match(/^\/board\/([^/]+)/);
          pvDetail = m ? (postTitles[m[1]] || undefined) : undefined;
        } else if (cat === 'quiz_solve' || cat === 'quiz_result' || cat === 'quiz_feedback') {
          const m = path.match(/^\/quiz\/([^/]+)/);
          pvDetail = m ? (quizTitles[m[1]] || undefined) : undefined;
        } else if (cat === 'review_detail') {
          const m = path.match(/^\/review\/[^/]+\/([^/]+)/);
          pvDetail = m ? (quizTitles[m[1]] || undefined) : undefined;
        }
        // 목록/홈 등은 detail 없음 (raw path 숨김)

        items.push({
          id: `pv-${d.id}`,
          timestamp: ts,
          type: 'visit',
          label: VISIT_LABELS[cat] || '페이지 방문',
          detail: pvDetail,
          durationMs: data.durationMs || undefined,
        });
      });

      // rabbitHoldings → 토끼 뽑기 ActivityItem
      // 토끼 이름 배치 조회
      const rabbitDocIds = new Set<string>();
      rabbitSnap.docs.forEach(d => {
        const rid = d.data().rabbitDocId as string | undefined;
        if (rid) rabbitDocIds.add(rid);
      });
      const rabbitNames: Record<string, string> = {};
      const rArr = Array.from(rabbitDocIds);
      for (let i = 0; i < rArr.length; i += 10) {
        const batch = rArr.slice(i, i + 10);
        const snaps = await Promise.all(batch.map(id => getDoc(doc(db, 'rabbits', id))));
        snaps.forEach((snap, idx) => {
          if (snap.exists()) rabbitNames[batch[idx]] = snap.data()?.name || '';
        });
      }
      rabbitSnap.docs.forEach(d => {
        const data = d.data();
        const ts = data.createdAt?.toDate?.() || new Date(0);
        const rid = data.rabbitDocId as string || '';
        const rName = rabbitNames[rid] || `토끼 #${(data.rabbitId || 0) + 1}`;
        items.push({
          id: `rabbit-${d.id}`,
          timestamp: ts,
          type: 'exp',
          label: '토끼 뽑기',
          detail: rName,
        });
      });

      // 시간순 정렬 + 캐시 저장
      items.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      dayCacheRef.current.set(dateKey, items);
      setActivities(items);
      setLoading(false);
    }).catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, courseId, selectedMonth, effectiveDay, todayDate.year]);

  // 이미 선택 날짜 기준으로 조회하므로 추가 필터링 불필요
  const filteredActivities = activities;

  // 시간 포맷 (HH:MM)
  const formatTime = (d: Date) => {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // 체류시간 포맷
  const formatDuration = (ms: number) => {
    if (ms < 60000) return `${Math.round(ms / 1000)}초`;
    return `${Math.round(ms / 60000)}분`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* 헤더: 뒤로가기 + 학생 정보 */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3" style={{ borderBottom: '1px solid #B0A898' }}>
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center text-white/60 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="w-10 h-10 rounded-lg overflow-hidden border-2 border-white/30 bg-white/10 flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getRabbitProfileUrl(profileRabbitId ?? 0)} alt="" width={40} height={40} className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white truncate">
            {name || nickname}
            {name && <span className="text-white/60 font-normal ml-1.5">({nickname})</span>}
          </p>
          <p className="text-xs text-white/60">{studentId} · {classType}반</p>
        </div>
      </div>

      {/* 날짜 선택 */}
      <div className="flex items-center justify-center gap-2 px-4 py-3">
        <button onClick={handlePrevDay} className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-baseline gap-0.5">
          <ScrollableDigit value={selectedMonth} min={1} max={12} onChange={handleMonthChange} />
          <span className="text-sm font-bold text-white/50">月</span>
          <span className="w-1" />
          <ScrollableDigit value={Math.min(selectedDay, maxDayInMonth)} min={1} max={maxDayInMonth} onChange={setSelectedDay} />
          <span className="text-sm font-bold text-white/50">日</span>
        </div>
        <button onClick={handleNextDay} className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* 활동 목록 */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredActivities.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-white/50">이 날의 활동 기록이 없습니다</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredActivities.map(item => (
              <div key={item.id} className="flex items-start gap-3 py-2">
                {/* 시간 */}
                <span className="text-xs text-white/50 font-mono w-11 flex-shrink-0 pt-0.5">
                  {formatTime(item.timestamp)}
                </span>
                {/* 아이콘 */}
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  item.type === 'exp' ? 'bg-white/20' : 'bg-white/10'
                }`}>
                  {item.type === 'exp' ? (
                    <span className="text-[10px] text-white">+</span>
                  ) : (
                    <svg className="w-2.5 h-2.5 text-white/60" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                {/* 내용 */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium">{item.label}</p>
                  {item.detail && (
                    <p className="text-xs text-white/50 truncate">{item.detail}</p>
                  )}
                </div>
                {/* EXP 또는 체류시간 */}
                <div className="flex-shrink-0 text-right">
                  {item.exp != null && item.exp > 0 && (
                    <span className="text-xs font-bold text-white">+{item.exp} XP</span>
                  )}
                  {item.durationMs != null && item.durationMs > 0 && (
                    <span className="text-xs text-white/50">{formatDuration(item.durationMs)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 하단 요약 */}
      <div className="flex-shrink-0 px-4 py-3 pb-4 flex items-center justify-between" style={{ borderTop: '1px solid #B0A898' }}>
        <span className="text-xs text-white/50">
          활동 {filteredActivities.filter(a => a.type === 'exp').length}건
          · 방문 {filteredActivities.filter(a => a.type === 'visit').length}회
        </span>
        <span className="text-xs font-bold text-white">
          +{filteredActivities.reduce((s, a) => s + (a.exp || 0), 0)} XP
        </span>
      </div>
    </div>
  );
}
