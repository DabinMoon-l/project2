'use client';

import { useState, useCallback } from 'react';
import {
  collection, query, where, getDocs, Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { CourseId } from '@/lib/types/course';
import {
  mean, sd, cv, ci95, stabilityIndex, quartiles, getISOWeek,
} from '@/lib/utils/statistics';

// === 타입 ===

export type QuestionSource = 'all' | 'professor' | 'custom' | 'ai-generated';
export type DispersionMode = 'sd' | 'cv' | 'ci';
export type ClassType = 'A' | 'B' | 'C' | 'D';

export interface ClassStats {
  classId: ClassType;
  scores: number[];    // 학생별 평균 점수
  mean: number;
  sd: number;
  cv: number;
  ci: [number, number];
  stability: number;
  studentCount: number;
  boxplot: ReturnType<typeof quartiles>;
}

export interface WeeklyDataPoint {
  week: string;       // "W12"
  weekNum: number;
  byClass: Record<ClassType, { mean: number; sd: number; ci: [number, number]; scores: number[] }>;
}

export interface ChapterStats {
  chapterId: string;
  chapterName: string;
  details: SubsectionStats[];
  mean: number;
  sd: number;
  cv: number;
  ci: [number, number];
}

export interface SubsectionStats {
  detailId: string;
  detailName: string;
  mean: number;
  sd: number;
  cv: number;
  ci: [number, number];
  scores: number[];
}

export interface AIDifficultyStats {
  difficulty: string;
  mean: number;
  sd: number;
  count: number;
}

export interface StatsData {
  classStats: ClassStats[];
  weeklyTrend: WeeklyDataPoint[];
  chapterStats: ChapterStats[];
  aiDifficultyStats: AIDifficultyStats[];
  professorMean: number;
  totalStudents: number;
  totalAttempts: number;
}

// 내부 타입
interface QuizDoc {
  id: string;
  type: string;
  courseId: string;
  difficulty?: string;
  createdAt: Date;
  questions: Array<{
    id: string;
    chapterId?: string;
    chapterDetailId?: string;
    subQuestions?: Array<{ id: string; chapterId?: string; chapterDetailId?: string }>;
  }>;
}

interface ResultDoc {
  userId: string;
  quizId: string;
  score: number;
  correctCount: number;
  totalCount: number;
  questionScores: Record<string, { isCorrect: boolean }>;
  createdAt: Date;
}

// === 모듈 레벨 캐시 (과목 전환·페이지 이동 시에도 유지) ===

const PROF_TYPES = ['midterm', 'final', 'past', 'professor', 'professor-ai'];

/** 학생 기본 데이터 (통계 페이지 부가 데이터 계산용) */
export interface RawStudentData {
  classId: string;
  totalExp: number;
  profCorrectCount: number;
  profAttemptCount: number;
  equippedRabbits: any[];
  lastGachaExp: number;
}

interface RawCache {
  quizzes: QuizDoc[];
  userClassMap: Record<string, ClassType>;
  rawStudents: RawStudentData[];
  results: ResultDoc[];
  ts: number;
}

const _rawCacheMap = new Map<string, RawCache>();
const RAW_CACHE_TTL = 5 * 60 * 1000; // 5분

const _statsCacheMap = new Map<string, { data: StatsData; ts: number }>();
const STATS_CACHE_TTL = 5 * 60 * 1000; // 5분 (raw 캐시와 통일)

/** raw 캐시에서 학생 classMap 조회 (중복 쿼리 방지) */
export function getRawUserClassMap(courseId: string): Record<string, ClassType> | null {
  const raw = _rawCacheMap.get(courseId);
  if (!raw || Date.now() - raw.ts > RAW_CACHE_TTL) return null;
  return raw.userClassMap;
}

/** raw 캐시에서 학생 데이터 조회 (통계 부가 데이터 중복 쿼리 방지) */
export function getRawStudents(courseId: string): RawStudentData[] | null {
  const raw = _rawCacheMap.get(courseId);
  if (!raw || Date.now() - raw.ts > RAW_CACHE_TTL) return null;
  return raw.rawStudents;
}

// === 훅 ===

export function useProfessorStats() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async (
    courseId: CourseId,
    source: QuestionSource = 'professor',
  ) => {
    // 1. 완성 캐시 확인
    const cacheKey = `${courseId}_${source}`;
    const cached = _statsCacheMap.get(cacheKey);
    if (cached && Date.now() - cached.ts < STATS_CACHE_TTL) {
      setData(cached.data);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 2. 원시 데이터 캐시 확인 → 없거나 만료 시 Firestore 조회
      let raw = _rawCacheMap.get(courseId);
      if (!raw || Date.now() - raw.ts > RAW_CACHE_TTL) {
        // 전체 퀴즈 + 학생 병렬 조회 (source 무관하게 전부)
        const [quizSnap, usersSnap] = await Promise.all([
          getDocs(query(collection(db, 'quizzes'), where('courseId', '==', courseId))),
          getDocs(query(collection(db, 'users'), where('role', '==', 'student'), where('courseId', '==', courseId))),
        ]);

        const quizzes: QuizDoc[] = [];
        const quizIds: string[] = [];
        quizSnap.forEach(d => {
          const data = d.data();
          quizzes.push({
            id: d.id,
            type: data.type,
            courseId: data.courseId,
            difficulty: data.difficulty,
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(data.createdAt),
            questions: data.questions || [],
          });
          quizIds.push(d.id);
        });

        const userClassMap: Record<string, ClassType> = {};
        const rawStudents: RawStudentData[] = [];
        usersSnap.forEach(d => {
          const u = d.data();
          const cls = u.classId || u.classType;
          if (cls) {
            userClassMap[d.id] = cls as ClassType;
          }
          rawStudents.push({
            classId: (cls || 'A') as string,
            totalExp: u.totalExp || 0,
            profCorrectCount: u.profCorrectCount || 0,
            profAttemptCount: u.profAttemptCount || 0,
            equippedRabbits: Array.isArray(u.equippedRabbits) ? u.equippedRabbits : [],
            lastGachaExp: u.lastGachaExp || 0,
          });
        });

        // quizResults 배치 조회
        const results: ResultDoc[] = [];
        if (quizIds.length > 0) {
          const batchPromises = [];
          for (let i = 0; i < quizIds.length; i += 30) {
            const batch = quizIds.slice(i, i + 30);
            batchPromises.push(getDocs(query(collection(db, 'quizResults'), where('quizId', 'in', batch))));
          }
          const batchResults = await Promise.all(batchPromises);
          batchResults.forEach(resSnap => {
            resSnap.forEach(d => {
              const r = d.data();
              if (!userClassMap[r.userId]) return;
              results.push({
                userId: r.userId,
                quizId: r.quizId,
                score: r.score ?? 0,
                correctCount: r.correctCount ?? 0,
                totalCount: r.totalCount ?? 0,
                questionScores: r.questionScores || {},
                createdAt: r.createdAt instanceof Timestamp ? r.createdAt.toDate() : new Date(r.createdAt),
              });
            });
          });
        }

        raw = { quizzes, userClassMap, rawStudents, results, ts: Date.now() };
        _rawCacheMap.set(courseId, raw);
      }

      // 3. source 필터링 (메모리에서 즉시)
      const filteredQuizIds = new Set<string>();
      const quizMap = new Map<string, QuizDoc>();

      for (const q of raw.quizzes) {
        quizMap.set(q.id, q);
        if (source === 'all') {
          filteredQuizIds.add(q.id);
        } else if (source === 'professor') {
          if (PROF_TYPES.includes(q.type)) filteredQuizIds.add(q.id);
        } else if (source === 'ai-generated') {
          if (q.type === 'professor-ai') filteredQuizIds.add(q.id);
        } else if (source === 'custom') {
          if (q.type === 'custom') filteredQuizIds.add(q.id);
        }
      }

      if (filteredQuizIds.size === 0) {
        const emptyData: StatsData = { classStats: emptyClassStats(), weeklyTrend: [], chapterStats: [], aiDifficultyStats: [], professorMean: 0, totalStudents: 0, totalAttempts: 0 };
        setData(emptyData);
        _statsCacheMap.set(cacheKey, { data: emptyData, ts: Date.now() });
        setLoading(false);
        return;
      }

      const results = raw.results.filter(r => filteredQuizIds.has(r.quizId));
      const userClassMap = raw.userClassMap;

      // 4. 반별 점수 집계 (항상 A/B/C/D 포함)
      const classBucket: Record<ClassType, Record<string, number[]>> = {
        A: {}, B: {}, C: {}, D: {},
      };

      for (const r of results) {
        const cls = userClassMap[r.userId];
        if (!cls) continue;
        if (!classBucket[cls]) continue;
        if (!classBucket[cls][r.userId]) classBucket[cls][r.userId] = [];
        classBucket[cls][r.userId].push(r.score);
      }

      const classStats: ClassStats[] = (['A', 'B', 'C', 'D'] as ClassType[]).map(classId => {
        const userScores = Object.values(classBucket[classId]).map(arr => mean(arr));
        return {
          classId,
          scores: userScores,
          mean: mean(userScores),
          sd: sd(userScores),
          cv: cv(userScores),
          ci: ci95(userScores),
          stability: stabilityIndex(userScores),
          studentCount: userScores.length,
          boxplot: quartiles(userScores),
        };
      });

      // 5. 주간 트렌드
      const weekBucket: Record<string, Record<ClassType, Record<string, number[]>>> = {};

      for (const r of results) {
        const cls = userClassMap[r.userId];
        if (!cls) continue;
        const wNum = getISOWeek(r.createdAt);
        const wKey = `W${wNum}`;
        if (!weekBucket[wKey]) weekBucket[wKey] = { A: {}, B: {}, C: {}, D: {} };
        if (!weekBucket[wKey][cls][r.userId]) weekBucket[wKey][cls][r.userId] = [];
        weekBucket[wKey][cls][r.userId].push(r.score);
      }

      const weeklyTrend: WeeklyDataPoint[] = Object.entries(weekBucket)
        .map(([week, byClass]) => {
          const weekNum = parseInt(week.slice(1));
          const classData = {} as WeeklyDataPoint['byClass'];
          for (const cls of ['A', 'B', 'C', 'D'] as ClassType[]) {
            const userScores = Object.values(byClass[cls]).map(arr => mean(arr));
            classData[cls] = {
              mean: mean(userScores),
              sd: sd(userScores),
              ci: ci95(userScores),
              scores: userScores,
            };
          }
          return { week, weekNum, byClass: classData };
        })
        .sort((a, b) => a.weekNum - b.weekNum);

      // 6. 챕터별 통계
      const chapterBucket: Record<string, Record<string, number[]>> = {};

      for (const r of results) {
        const quiz = quizMap.get(r.quizId);
        if (!quiz) continue;

        for (const q of quiz.questions) {
          const subQs = q.subQuestions && q.subQuestions.length > 0 ? q.subQuestions : [q];
          for (const sq of subQs) {
            const chId = sq.chapterId || q.chapterId || '';
            const detId = sq.chapterDetailId || q.chapterDetailId || '';
            const key = detId || chId;
            if (!key) continue;

            const scoreEntry = r.questionScores[sq.id];
            if (scoreEntry === undefined) continue;

            if (!chapterBucket[key]) chapterBucket[key] = {};
            if (!chapterBucket[key][r.userId]) chapterBucket[key][r.userId] = [];
            chapterBucket[key][r.userId].push(scoreEntry.isCorrect ? 100 : 0);
          }
        }
      }

      const { getCourseIndex } = await import('@/lib/courseIndex');
      const courseIndex = getCourseIndex(courseId);
      const chapterStats: ChapterStats[] = [];

      if (courseIndex) {
        for (const chapter of courseIndex.chapters) {
          const details: SubsectionStats[] = [];

          if (chapter.details.length > 0) {
            for (const detail of chapter.details) {
              const bucket = chapterBucket[detail.id];
              const scores = bucket ? Object.values(bucket).map(arr => mean(arr)) : [];
              details.push({
                detailId: detail.id,
                detailName: detail.name,
                mean: mean(scores),
                sd: sd(scores),
                cv: cv(scores),
                ci: ci95(scores),
                scores,
              });
            }
          }

          const chapterScores = chapterBucket[chapter.id]
            ? Object.values(chapterBucket[chapter.id]).map(arr => mean(arr))
            : [];
          const allScores = details.length > 0
            ? details.flatMap(d => d.scores)
            : chapterScores;

          chapterStats.push({
            chapterId: chapter.id,
            chapterName: chapter.shortName,
            details,
            mean: mean(allScores),
            sd: sd(allScores),
            cv: cv(allScores),
            ci: ci95(allScores),
          });
        }
      }

      // 7. AI 난이도 분석
      const aiDiffBucket: Record<string, number[]> = { easy: [], normal: [], hard: [] };
      const profScores: number[] = [];

      for (const r of results) {
        const quiz = quizMap.get(r.quizId);
        if (!quiz) continue;
        if (quiz.type === 'professor-ai' && quiz.difficulty) {
          aiDiffBucket[quiz.difficulty]?.push(r.score);
        }
        if (PROF_TYPES.includes(quiz.type)) {
          profScores.push(r.score);
        }
      }

      const aiDifficultyStats: AIDifficultyStats[] = [
        { difficulty: '쉬움', ...calcDiffStats(aiDiffBucket.easy) },
        { difficulty: '보통', ...calcDiffStats(aiDiffBucket.normal) },
        { difficulty: '어려움', ...calcDiffStats(aiDiffBucket.hard) },
      ];

      const uniqueStudents = new Set(results.map(r => r.userId)).size;

      const statsData: StatsData = {
        classStats,
        weeklyTrend,
        chapterStats,
        aiDifficultyStats,
        professorMean: mean(profScores),
        totalStudents: uniqueStudents,
        totalAttempts: results.length,
      };

      setData(statsData);
      _statsCacheMap.set(cacheKey, { data: statsData, ts: Date.now() });
    } catch (err) {
      console.error('통계 데이터 조회 실패:', err);
      setError('통계 데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, fetchStats };
}

function emptyClassStats(): ClassStats[] {
  return (['A', 'B', 'C', 'D'] as ClassType[]).map(classId => ({
    classId,
    scores: [],
    mean: 0,
    sd: 0,
    cv: 0,
    ci: [0, 0] as [number, number],
    stability: 0,
    studentCount: 0,
    boxplot: quartiles([]),
  }));
}

function calcDiffStats(scores: number[]) {
  return {
    mean: mean(scores),
    sd: sd(scores),
    count: scores.length,
  };
}
