'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { doc, getDoc, setDoc, db } from '@/lib/repositories';
import { COURSE_INDEXES } from '@/lib/courseIndex';
import { GlassModal } from '../profileDrawerParts';

// 과목 탭 타입
type TekkenCourseTab = 'biology' | 'pathophysiology' | 'microbiology';

// 과목 표시명 매핑
const COURSE_LABELS: Record<TekkenCourseTab, string> = {
  biology: '생물학',
  pathophysiology: '병태생리학',
  microbiology: '미생물학',
};

// 전체 과목 목록
const ALL_COURSES: TekkenCourseTab[] = ['biology', 'pathophysiology', 'microbiology'];

// 기본 챕터 (Firestore에 데이터가 없을 때 사용)
const DEFAULT_CHAPTERS: Record<TekkenCourseTab, string[]> = {
  biology: ['1', '2', '3', '4', '5', '6'],
  pathophysiology: ['3', '4', '5', '7', '8', '9', '10', '11'],
  microbiology: ['1', '2', '3', '4', '5'],
};

interface TekkenSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 배틀 퀴즈(철권퀴즈) 챕터 범위 설정 모달 (교수 전용)
 * 과목별로 배틀 문제 출제 범위를 선택하고 Firestore에 저장한다.
 */
export default function TekkenSettingsModal({ isOpen, onClose }: TekkenSettingsModalProps) {
  // 현재 선택 과목 탭
  const [tekkenCourse, setTekkenCourse] = useState<TekkenCourseTab>('microbiology');
  // 과목별 선택된 챕터 번호 목록
  const [tekkenChapters, setTekkenChapters] = useState<Record<TekkenCourseTab, string[]>>({
    ...DEFAULT_CHAPTERS,
  });
  // 로딩/저장 상태
  const [tekkenLoading, setTekkenLoading] = useState(false);
  const [tekkenSaving, setTekkenSaving] = useState(false);
  // 이미 Firestore에서 로드한 과목 추적 (중복 로드 방지)
  const tekkenLoadedRef = useRef<Set<string>>(new Set());

  // 현재 과목의 챕터 인덱스
  const tekkenCourseIndex = COURSE_INDEXES[tekkenCourse];
  const tekkenChapterList = useMemo(
    () => tekkenCourseIndex?.chapters || [],
    [tekkenCourseIndex]
  );

  // Firestore에서 과목별 챕터 설정 로드
  const loadTekkenChapters = useCallback(async (courseId: string) => {
    if (tekkenLoadedRef.current.has(courseId)) return;
    try {
      const snap = await getDoc(doc(db, 'settings', 'tekken', 'courses', courseId));
      if (snap.exists()) {
        const data = snap.data();
        if (data?.chapters && Array.isArray(data.chapters) && data.chapters.length > 0) {
          setTekkenChapters(prev => ({ ...prev, [courseId]: data.chapters }));
        }
      }
      tekkenLoadedRef.current.add(courseId);
    } catch (err) {
      console.error('챕터 로드 실패:', err);
    }
  }, []);

  // 전체 과목 챕터 Firestore 저장
  const saveTekkenChapters = useCallback(async () => {
    setTekkenSaving(true);
    try {
      await Promise.all(ALL_COURSES.map(cid =>
        setDoc(doc(db, 'settings', 'tekken', 'courses', cid), { chapters: tekkenChapters[cid] }, { merge: true })
      ));
      alert('저장 완료! 다음 새벽부터 적용됩니다.');
      onClose();
    } catch (err) {
      console.error('챕터 저장 실패:', err);
      alert('저장 실패');
    } finally {
      setTekkenSaving(false);
    }
  }, [tekkenChapters, onClose]);

  // 모달이 열리거나 과목 탭 전환 시 Firestore에서 로드
  useEffect(() => {
    if (!isOpen) return;
    setTekkenLoading(true);
    loadTekkenChapters(tekkenCourse).finally(() => setTekkenLoading(false));
  }, [isOpen, tekkenCourse, loadTekkenChapters]);

  // 전체 선택/해제 핸들러
  const handleToggleAll = useCallback(() => {
    const allNums = tekkenChapterList.map(c => c.name.split('.')[0].trim());
    const current = tekkenChapters[tekkenCourse];
    const isAll = allNums.every(n => current.includes(n));
    // 전체 해제 시 최소 1개(첫 번째) 유지
    const next = isAll ? [allNums[0]] : allNums;
    setTekkenChapters(prev => ({ ...prev, [tekkenCourse]: next }));
  }, [tekkenChapterList, tekkenChapters, tekkenCourse]);

  // 개별 챕터 토글 핸들러
  const handleToggleChapter = useCallback((num: string, checked: boolean) => {
    const current = tekkenChapters[tekkenCourse];
    // 최소 1개 챕터는 항상 선택 상태 유지
    if (checked && current.length <= 1) return;
    const next = checked
      ? current.filter(c => c !== num)
      : [...current, num];
    setTekkenChapters(prev => ({ ...prev, [tekkenCourse]: next }));
  }, [tekkenChapters, tekkenCourse]);

  // 취소 핸들러 — 로드 캐시 초기화 후 닫기 (다시 열면 Firestore에서 재로드)
  const handleCancel = useCallback(() => {
    tekkenLoadedRef.current.clear();
    onClose();
  }, [onClose]);

  // 전체 선택 여부
  const isAllSelected = tekkenChapterList.length > 0 &&
    tekkenChapterList.every(c => tekkenChapters[tekkenCourse].includes(c.name.split('.')[0].trim()));

  return (
    <AnimatePresence>
      {isOpen && (
        <GlassModal onClose={handleCancel}>
          <h3 className="text-base font-bold text-white mb-1">배틀 퀴즈 범위</h3>
          <p className="text-xs text-white/40 mb-3">선택한 챕터에서 배틀 문제가 출제됩니다</p>

          {/* 과목 탭 */}
          <div className="flex gap-1.5 mb-3 justify-center">
            {ALL_COURSES.map(cid => (
              <button
                key={cid}
                onClick={() => setTekkenCourse(cid)}
                className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors ${
                  tekkenCourse === cid
                    ? 'bg-white/30 text-white'
                    : 'bg-white/10 text-white/50'
                }`}
              >
                {COURSE_LABELS[cid]}
              </button>
            ))}
          </div>

          {/* 전체 선택 토글 */}
          <div className="flex justify-end mb-1.5">
            <button
              onClick={handleToggleAll}
              className="text-xs text-white/50 underline underline-offset-2"
            >
              {isAllSelected ? '전체 해제' : '전체 선택'}
            </button>
          </div>

          {/* 챕터 목록 */}
          {tekkenLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-4 h-4 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-1 max-h-[35vh] overflow-y-auto">
              {tekkenChapterList.map(chapter => {
                const num = chapter.name.split('.')[0].trim();
                const checked = tekkenChapters[tekkenCourse].includes(num);
                return (
                  <button
                    key={chapter.id}
                    onClick={() => handleToggleChapter(num, checked)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium transition-colors ${
                      checked
                        ? 'bg-white/25 text-white'
                        : 'bg-white/8 text-white/50'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border ${
                      checked ? 'bg-white/80 border-white/80' : 'border-white/30'
                    }`}>
                      {checked && (
                        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </div>
                    <span className="truncate">{chapter.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 저장 / 취소 버튼 */}
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleCancel}
              className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/15 text-white hover:bg-white/20 transition-colors"
            >
              취소
            </button>
            <button
              disabled={tekkenSaving}
              onClick={saveTekkenChapters}
              className="flex-1 py-2 rounded-xl text-sm font-medium bg-white/30 text-white hover:bg-white/40 transition-colors disabled:opacity-50"
            >
              {tekkenSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </GlassModal>
      )}
    </AnimatePresence>
  );
}
