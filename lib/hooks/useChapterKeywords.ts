'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, getDocs, db } from '@/lib/repositories';
import { getCourseIndex } from '@/lib/courseIndex';

/** 챕터별 키워드 맵 (챕터번호 → 키워드 Set) */
type ChapterKeywordMap = Map<string, Set<string>>;

/** 챕터 정보 (번호 + 이름) */
export interface ChapterInfo {
  number: string;
  name: string;
  /** 태그 형식: "1_미생물과 미생물학" */
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
        // courseChapters.json에서 챕터 정보 가져오기
        const courseIndex = getCourseIndex(courseId);
        const chapterInfos: ChapterInfo[] = courseIndex
          ? courseIndex.chapters.map(ch => {
              const num = ch.name.split('.')[0].trim();
              return { number: num, name: ch.shortName, tag: `${num}_${ch.shortName}` };
            })
          : [];

        // Firestore에서 키워드 로드
        const chaptersRef = collection(db, 'courseScopes', courseId, 'chapters');
        const snap = await getDocs(chaptersRef);

        const kwMap: ChapterKeywordMap = new Map();
        snap.docs.forEach(d => {
          const data = d.data();
          const chNum = data.chapterNumber as string;
          const kws = data.keywords as string[] | undefined;
          if (chNum && kws && kws.length > 0) {
            kwMap.set(chNum, new Set(kws.map(k => k.toLowerCase())));
          }
        });

        if (cancelled) return;

        keywordsRef.current = kwMap;
        setChapters(chapterInfos);

        // 캐시 저장
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
   * @returns 매칭 점수 상위 챕터 태그 배열
   */
  const detectChapters = useCallback((text: string): string[] => {
    const kwMap = keywordsRef.current;
    if (!text.trim() || kwMap.size === 0) return [];

    const lowerText = text.toLowerCase();
    const scores = new Map<string, number>();

    // 각 챕터 키워드와 매칭
    kwMap.forEach((keywords, chNum) => {
      let score = 0;
      keywords.forEach(kw => {
        if (kw.length >= 3 && lowerText.includes(kw)) {
          score++;
        }
      });
      if (score > 0) scores.set(chNum, score);
    });

    if (scores.size === 0) return [];

    // 점수 내림차순 정렬, 상위 2개까지
    const sorted = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);

    // 최소 매칭 수 2개 이상인 챕터만
    const minScore = 2;
    const matched = sorted.filter(([, s]) => s >= minScore);

    // 챕터 번호 → 태그 변환
    return matched.map(([chNum]) => {
      const info = chapters.find(c => c.number === chNum);
      return info ? info.tag : chNum;
    });
  }, [chapters]);

  return { chapters, loading, detectChapters };
}
