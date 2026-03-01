'use client';

/**
 * 철권퀴즈 챕터 설정 바텀시트
 *
 * 교수님이 과목별로 배틀 퀴즈 출제 챕터를 복수 선택할 수 있는 UI.
 * Firestore settings/tekken/courses/{courseId} → { chapters: string[] }
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { COURSE_INDEXES } from '@/lib/courseIndex';
import { useCourse } from '@/lib/contexts';
import MobileBottomSheet from '@/components/common/MobileBottomSheet';

interface TekkenChapterSettingsProps {
  open: boolean;
  onClose: () => void;
}

type CourseTab = 'biology' | 'pathophysiology' | 'microbiology';

const COURSE_LABELS: Record<CourseTab, string> = {
  biology: '생물학',
  pathophysiology: '병태생리학',
  microbiology: '미생물학',
};

const DEFAULT_CHAPTERS = ['1', '2', '3'];

export default function TekkenChapterSettings({ open, onClose }: TekkenChapterSettingsProps) {
  const { userCourseId } = useCourse();
  const [activeCourse, setActiveCourse] = useState<CourseTab>(
    (userCourseId as CourseTab) || 'microbiology'
  );
  const [selectedChapters, setSelectedChapters] = useState<Record<CourseTab, string[]>>({
    biology: DEFAULT_CHAPTERS,
    pathophysiology: DEFAULT_CHAPTERS,
    microbiology: DEFAULT_CHAPTERS,
  });
  const [loading, setLoading] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef<Set<string>>(new Set());

  // Firestore에서 챕터 설정 로드
  const loadChapters = useCallback(async (courseId: CourseTab) => {
    if (loadedRef.current.has(courseId)) return;
    try {
      const docRef = doc(db, 'settings', 'tekken', 'courses', courseId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data?.chapters && Array.isArray(data.chapters) && data.chapters.length > 0) {
          setSelectedChapters(prev => ({ ...prev, [courseId]: data.chapters }));
        }
      }
      loadedRef.current.add(courseId);
    } catch (err) {
      console.error('챕터 설정 로드 실패:', err);
    }
  }, []);

  // 열릴 때 현재 과목 로드
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadChapters(activeCourse).finally(() => setLoading(false));
  }, [open, activeCourse, loadChapters]);

  // 문제 풀 초기화 (백그라운드)
  const refillPoolRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerPoolRefill = useCallback((courseId: CourseTab) => {
    // 마지막 저장 후 2초 대기 → 한 번만 호출
    if (refillPoolRef.current) clearTimeout(refillPoolRef.current);
    refillPoolRef.current = setTimeout(async () => {
      try {
        const refillFn = httpsCallable(functions, 'tekkenPoolRefill');
        refillFn({ courseId }).catch(() => {});
      } catch {
        // 백그라운드 처리 — 에러 무시
      }
    }, 2000);
  }, []);

  // Firestore에 저장 (debounce 300ms)
  const saveChapters = useCallback((courseId: CourseTab, chapters: string[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const docRef = doc(db, 'settings', 'tekken', 'courses', courseId);
        await setDoc(docRef, { chapters }, { merge: true });
        // 챕터 변경 시 문제 풀 초기화 트리거
        triggerPoolRefill(courseId);
      } catch (err) {
        console.error('챕터 설정 저장 실패:', err);
      }
    }, 300);
  }, [triggerPoolRefill]);

  // 챕터 토글
  const toggleChapter = useCallback((chapterNum: string) => {
    setSelectedChapters(prev => {
      const current = prev[activeCourse];
      const isSelected = current.includes(chapterNum);

      // 최소 1개는 선택해야 함
      if (isSelected && current.length <= 1) return prev;

      const next = isSelected
        ? current.filter(c => c !== chapterNum)
        : [...current, chapterNum];

      saveChapters(activeCourse, next);
      return { ...prev, [activeCourse]: next };
    });
  }, [activeCourse, saveChapters]);

  // 전체 선택/해제
  const toggleAll = useCallback(() => {
    const courseIndex = COURSE_INDEXES[activeCourse];
    if (!courseIndex) return;

    const allNums = courseIndex.chapters.map(c => c.name.split('.')[0].trim());
    const current = selectedChapters[activeCourse];
    const isAllSelected = allNums.every(n => current.includes(n));

    const next = isAllSelected ? [allNums[0]] : allNums;
    setSelectedChapters(prev => ({ ...prev, [activeCourse]: next }));
    saveChapters(activeCourse, next);
  }, [activeCourse, selectedChapters, saveChapters]);

  const courseIndex = COURSE_INDEXES[activeCourse];
  const chapters = courseIndex?.chapters || [];

  return (
    <MobileBottomSheet open={open} onClose={onClose} maxHeight="75vh">
      <div className="px-5 pb-6">
        {/* 헤더 */}
        <div className="text-center mb-4">
          <h3 className="text-lg font-bold text-[#1A1A1A]">
            배틀 퀴즈 범위
          </h3>
          <p className="text-xs text-[#5C5C5C] mt-0.5">
            선택한 챕터에서 배틀 문제가 출제됩니다
          </p>
        </div>

        {/* 과목 탭 */}
        <div className="flex gap-2 mb-4 justify-center">
          {(Object.keys(COURSE_LABELS) as CourseTab[]).map(courseId => (
            <button
              key={courseId}
              onClick={() => setActiveCourse(courseId)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                activeCourse === courseId
                  ? 'bg-[#1A1A1A] text-white'
                  : 'bg-[#EBE5D9] text-[#5C5C5C]'
              }`}
            >
              {COURSE_LABELS[courseId]}
            </button>
          ))}
        </div>

        {/* 전체 선택 버튼 */}
        <div className="flex justify-end mb-2">
          <button
            onClick={toggleAll}
            className="text-xs text-[#5C5C5C] underline underline-offset-2"
          >
            {chapters.length > 0 &&
             chapters.every(c => selectedChapters[activeCourse].includes(c.name.split('.')[0].trim()))
              ? '전체 해제'
              : '전체 선택'}
          </button>
        </div>

        {/* 챕터 목록 */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[45vh] overflow-y-auto">
            {chapters.map(chapter => {
              const chapterNum = chapter.name.split('.')[0].trim();
              const isChecked = selectedChapters[activeCourse].includes(chapterNum);

              return (
                <button
                  key={chapter.id}
                  onClick={() => toggleChapter(chapterNum)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    isChecked
                      ? 'bg-[#1A1A1A] text-white'
                      : 'bg-[#EBE5D9] text-[#1A1A1A]'
                  }`}
                >
                  {/* 체크박스 */}
                  <div className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border-2 ${
                    isChecked
                      ? 'bg-white border-white'
                      : 'border-[#D4CFC4]'
                  }`}>
                    {isChecked && (
                      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm font-medium truncate">
                    {chapter.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </MobileBottomSheet>
  );
}
