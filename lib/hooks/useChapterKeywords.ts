'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, getDocs, db } from '@/lib/repositories';
import { getCourseIndex } from '@/lib/courseIndex';
import CHAPTER_KEYWORDS from '@/lib/data/chapterKeywords';

/** 챕터별 키워드 맵 (챕터번호 → 키워드 Set) */
type ChapterKeywordMap = Map<string, Set<string>>;

/** 챕터 정보 (번호 + 이름) */
export interface ChapterInfo {
  number: string;
  name: string;
  /** 태그 형식: "2_숙주면역반응" */
  tag: string;
}

/** 모듈 레벨 캐시 (과목별) */
const cache = new Map<string, {
  keywords: ChapterKeywordMap;
  chapters: ChapterInfo[];
  loadedAt: number;
}>();
const CACHE_TTL = 10 * 60 * 1000; // 10분

/**
 * 내장 키워드에서 ChapterKeywordMap 생성 (Firestore 폴백)
 */
function getBuiltinKeywords(courseId: string): ChapterKeywordMap {
  const kwMap: ChapterKeywordMap = new Map();
  const courseData = CHAPTER_KEYWORDS[courseId];
  if (!courseData) return kwMap;

  for (const [chNum, keywords] of Object.entries(courseData)) {
    kwMap.set(chNum, new Set(keywords.map(k => k.toLowerCase())));
  }
  return kwMap;
}

/**
 * 과목 scope 키워드를 로드하고 텍스트에서 챕터를 자동 추천하는 훅
 */
export function useChapterKeywords(courseId?: string | null) {
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const keywordsRef = useRef<ChapterKeywordMap>(new Map());

  // 키워드 로드
  useEffect(() => {
    if (!courseId) {
      setChapters([]);
      return;
    }

    // 캐시 확인
    const cached = cache.get(courseId);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL) {
      keywordsRef.current = cached.keywords;
      setChapters(cached.chapters);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        // courseChapters.json에서 챕터 정보
        const courseIndex = getCourseIndex(courseId);
        const chapterInfos: ChapterInfo[] = courseIndex
          ? courseIndex.chapters.map(ch => {
              const num = ch.name.split('.')[0].trim();
              return { number: num, name: ch.shortName, tag: `${num}_${ch.shortName}` };
            })
          : [];

        // Firestore에서 키워드 로드 시도
        let kwMap: ChapterKeywordMap = new Map();
        try {
          const chaptersRef = collection(db, 'courseScopes', courseId, 'chapters');
          const snap = await getDocs(chaptersRef);

          snap.docs.forEach(d => {
            const data = d.data();
            const chNum = data.chapterNumber as string;
            const kws = data.keywords as string[] | undefined;
            if (chNum && kws && kws.length > 0) {
              kwMap.set(chNum, new Set(kws.map(k => k.toLowerCase())));
            }
          });
        } catch {
          // Firestore 실패 → 무시
        }

        // Firestore 데이터 부족 시 내장 키워드 사용
        if (kwMap.size === 0) {
          kwMap = getBuiltinKeywords(courseId);
        } else {
          // Firestore 데이터가 있어도 내장 키워드 보충 (합집합)
          const builtin = getBuiltinKeywords(courseId);
          builtin.forEach((keywords, chNum) => {
            const existing = kwMap.get(chNum);
            if (existing) {
              keywords.forEach(kw => existing.add(kw));
            } else {
              kwMap.set(chNum, keywords);
            }
          });
        }

        if (cancelled) return;

        keywordsRef.current = kwMap;
        setChapters(chapterInfos);

        cache.set(courseId, {
          keywords: kwMap,
          chapters: chapterInfos,
          loadedAt: Date.now(),
        });
      } catch (err) {
        console.error('챕터 키워드 로드 실패:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [courseId]);

  /**
   * 텍스트에서 챕터 자동 추천
   * 키워드 매칭 점수 상위 2개 챕터 반환
   */
  const detectChapters = useCallback((text: string): string[] => {
    const kwMap = keywordsRef.current;
    if (!text.trim() || kwMap.size === 0) return [];

    const lowerText = text.toLowerCase();
    const scores = new Map<string, number>();

    kwMap.forEach((keywords, chNum) => {
      let score = 0;
      keywords.forEach(kw => {
        // 2자 이상 키워드 매칭 (기존 3자 → 2자로 완화)
        if (kw.length >= 2 && lowerText.includes(kw)) {
          score++;
        }
      });
      if (score > 0) scores.set(chNum, score);
    });

    if (scores.size === 0) return [];

    // 점수 내림차순, 상위 2개
    const sorted = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);

    // 1개 이상 매칭이면 추천 (기존 2 → 1로 완화)
    const matched = sorted.filter(([, s]) => s >= 1);

    return matched.map(([chNum]) => {
      const info = chapters.find(c => c.number === chNum);
      return info ? info.tag : chNum;
    });
  }, [chapters]);

  return { chapters, loading, detectChapters };
}
