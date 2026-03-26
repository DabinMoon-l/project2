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
  board_list: '게시판',
  board_detail: '게시글',
  ranking: '랭킹',
  profile: '프로필',
  settings: '설정',
  prof_stats: '통계',
  prof_students: '학생 관리',
  prof_quiz_preview: '퀴즈 미리보기',
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
  userId, nickname, name, classType, profileRabbitId, onBack,
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

  // 데이터 로드 (7일치 한 번에 가져와서 클라이언트 필터링)
  useEffect(() => {
    if (!userId) return;
    setLoading(true);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const tsFrom = Timestamp.fromDate(sevenDaysAgo);

    Promise.all([
      // 학생 프로필 (학번)
      getDoc(doc(db, 'users', userId)),
      // expHistory 7일
      getDocs(query(
        collection(db, 'users', userId, 'expHistory'),
        where('createdAt', '>=', tsFrom),
        orderBy('createdAt', 'desc'),
        limit(200),
      )),
      // pageViews 7일
      getDocs(query(
        collection(db, 'pageViews'),
        where('userId', '==', userId),
        where('timestamp', '>=', tsFrom),
        orderBy('timestamp', 'desc'),
        limit(200),
      )),
    ]).then(async ([userSnap, expSnap, pvSnap]) => {
      // 학번
      if (userSnap.exists()) {
        setStudentId(userSnap.data()?.studentId || '');
      }

      // 퀴즈 제목 배치 조회 (quiz_complete의 sourceId)
      const quizIds = new Set<string>();
      expSnap.docs.forEach(d => {
        const data = d.data();
        if (data.type === 'quiz_complete' && data.sourceId) quizIds.add(data.sourceId as string);
      });
      const quizTitles: Record<string, string> = {};
      const qArr = Array.from(quizIds);
      for (let i = 0; i < qArr.length; i += 10) {
        const batch = qArr.slice(i, i + 10);
        const snaps = await Promise.all(batch.map(id => getDoc(doc(db, 'quizzes', id))));
        snaps.forEach((snap, idx) => {
          if (snap.exists()) quizTitles[batch[idx]] = snap.data()?.title || '';
        });
      }

      const items: ActivityItem[] = [];

      // expHistory → ActivityItem
      expSnap.docs.forEach(d => {
        const data = d.data();
        const ts = data.createdAt?.toDate?.() || new Date(0);

        // quiz_complete: "퀴즈 완료" 대신 퀴즈 이름 + 점수 표시
        let detail: string | undefined = data.reason || undefined;
        if (data.type === 'quiz_complete' && data.sourceId) {
          const title = quizTitles[data.sourceId as string];
          const scoreMatch = (data.reason || '').match(/점수[:\s]*(\d+)점/);
          const scorePart = scoreMatch ? ` (점수: ${scoreMatch[1]}점)` : '';
          if (title) detail = `${title}${scorePart}`;
        }

        items.push({
          id: `exp-${d.id}`,
          timestamp: ts,
          type: 'exp',
          label: EXP_LABELS[data.type] || data.type || '활동',
          detail,
          exp: data.amount || 0,
        });
      });

      // pageViews → ActivityItem (expHistory와 중복되는 카테고리 제외)
      pvSnap.docs.forEach(d => {
        const data = d.data();
        const ts = data.timestamp?.toDate?.() || new Date(0);
        items.push({
          id: `pv-${d.id}`,
          timestamp: ts,
          type: 'visit',
          label: VISIT_LABELS[data.category] || '페이지 방문',
          detail: data.path || undefined,
          durationMs: data.durationMs || undefined,
        });
      });

      // 시간순 정렬 (오래된 순)
      items.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      setActivities(items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [userId]);

  // 선택된 날짜로 필터링
  const filteredActivities = useMemo(() => {
    return activities.filter(a => {
      return a.timestamp.getFullYear() === todayDate.year
        && a.timestamp.getMonth() + 1 === selectedMonth
        && a.timestamp.getDate() === Math.min(selectedDay, maxDayInMonth);
    });
  }, [activities, selectedMonth, selectedDay, maxDayInMonth, todayDate.year]);

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
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-white/15">
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-white">
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
            {name && <span className="text-white/50 font-normal ml-1.5">({nickname})</span>}
          </p>
          <p className="text-xs text-white/50">{studentId} · {classType}반</p>
        </div>
      </div>

      {/* 날짜 선택 */}
      <div className="flex items-center justify-center gap-2 px-4 py-3 border-b border-white/10">
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
            <div className="w-6 h-6 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredActivities.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-white/40">이 날의 활동 기록이 없습니다</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredActivities.map(item => (
              <div key={item.id} className="flex items-start gap-3 py-2 border-b border-white/8">
                {/* 시간 */}
                <span className="text-xs text-white/40 font-mono w-11 flex-shrink-0 pt-0.5">
                  {formatTime(item.timestamp)}
                </span>
                {/* 아이콘 */}
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  item.type === 'exp' ? 'bg-white/20' : 'bg-white/10'
                }`}>
                  {item.type === 'exp' ? (
                    <span className="text-[10px]">+</span>
                  ) : (
                    <svg className="w-2.5 h-2.5 text-white/50" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                {/* 내용 */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium">{item.label}</p>
                  {item.detail && (
                    <p className="text-xs text-white/40 truncate">{item.detail}</p>
                  )}
                </div>
                {/* EXP 또는 체류시간 */}
                <div className="flex-shrink-0 text-right">
                  {item.exp != null && item.exp > 0 && (
                    <span className="text-xs font-bold text-white/60">+{item.exp} XP</span>
                  )}
                  {item.durationMs != null && item.durationMs > 0 && (
                    <span className="text-xs text-white/40">{formatDuration(item.durationMs)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 하단 요약 */}
      <div className="px-4 py-3 border-t border-white/15 flex items-center justify-between">
        <span className="text-xs text-white/40">
          활동 {filteredActivities.filter(a => a.type === 'exp').length}건
          · 방문 {filteredActivities.filter(a => a.type === 'visit').length}회
        </span>
        <span className="text-xs font-bold text-white/60">
          +{filteredActivities.reduce((s, a) => s + (a.exp || 0), 0)} XP
        </span>
      </div>
    </div>
  );
}
