'use client';

/**
 * 철권퀴즈 배틀 범위 키워드 설정 카드
 *
 * 교수님이 키워드를 입력하면 Firestore에 저장
 * 배틀 문제 생성 시 해당 키워드 범위에서 우선 출제
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';

export default function TekkenKeywordsCard() {
  const { userCourseId } = useCourse();
  const { theme } = useTheme();

  const [keywords, setKeywords] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 키워드 로드
  useEffect(() => {
    if (!userCourseId) return;
    setLoading(true);

    const loadKeywords = async () => {
      try {
        const docRef = doc(db, 'settings', 'tekken', 'courses', userCourseId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          setKeywords(snap.data()?.keywords || []);
        }
      } catch (err) {
        console.error('키워드 로드 실패:', err);
      } finally {
        setLoading(false);
      }
    };

    loadKeywords();
  }, [userCourseId]);

  // 키워드 저장
  const saveKeywords = useCallback(async (newKeywords: string[]) => {
    if (!userCourseId) return;
    setSaving(true);
    try {
      const docRef = doc(db, 'settings', 'tekken', 'courses', userCourseId);
      await setDoc(docRef, { keywords: newKeywords }, { merge: true });
      setKeywords(newKeywords);
      showToast('저장되었습니다');
    } catch (err) {
      console.error('키워드 저장 실패:', err);
      showToast('저장에 실패했습니다');
    } finally {
      setSaving(false);
    }
  }, [userCourseId]);

  // 키워드 추가
  const addKeyword = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (keywords.includes(trimmed)) {
      showToast('이미 있는 키워드입니다');
      return;
    }
    if (keywords.length >= 20) {
      showToast('키워드는 최대 20개까지 가능합니다');
      return;
    }
    const newKeywords = [...keywords, trimmed];
    setInputValue('');
    saveKeywords(newKeywords);
  }, [inputValue, keywords, saveKeywords]);

  // 키워드 삭제
  const removeKeyword = useCallback((keyword: string) => {
    const newKeywords = keywords.filter((k) => k !== keyword);
    saveKeywords(newKeywords);
  }, [keywords, saveKeywords]);

  // 전체 삭제
  const clearAll = useCallback(() => {
    saveKeywords([]);
  }, [saveKeywords]);

  // 토스트
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  // Enter 키 처리
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="rounded-2xl p-5"
      style={{
        backgroundColor: theme.colors.backgroundSecondary,
        border: `1px solid ${theme.colors.border}`,
      }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚔️</span>
          <h3 className="font-bold" style={{ color: theme.colors.text }}>
            배틀 퀴즈 범위
          </h3>
        </div>
        {keywords.length > 0 && (
          <button
            onClick={clearAll}
            disabled={saving}
            className="text-xs px-2 py-1 rounded-lg transition-colors"
            style={{ color: theme.colors.textSecondary }}
          >
            전체 삭제
          </button>
        )}
      </div>

      {/* 설명 */}
      <p
        className="text-xs mb-3 leading-relaxed"
        style={{ color: theme.colors.textSecondary }}
      >
        키워드를 입력하면 배틀 문제가 해당 범위에서 우선 출제됩니다.
        비어 있으면 기존 퀴즈 전체에서 변형 출제합니다.
      </p>

      {/* 입력 */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="예: 세포 분열, DNA 복제"
          className="flex-1 px-3 py-2 text-sm rounded-xl outline-none transition-colors"
          style={{
            backgroundColor: `${theme.colors.accent}10`,
            border: `1px solid ${theme.colors.border}`,
            color: theme.colors.text,
          }}
          disabled={saving || loading}
          maxLength={30}
        />
        <button
          onClick={addKeyword}
          disabled={!inputValue.trim() || saving || loading}
          className="px-4 py-2 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-40"
          style={{ backgroundColor: theme.colors.accent }}
        >
          추가
        </button>
      </div>

      {/* 키워드 칩 목록 */}
      {loading ? (
        <div className="flex gap-2 flex-wrap">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-8 w-20 rounded-full animate-pulse"
              style={{ backgroundColor: `${theme.colors.accent}15` }}
            />
          ))}
        </div>
      ) : keywords.length > 0 ? (
        <div className="flex gap-2 flex-wrap">
          <AnimatePresence>
            {keywords.map((keyword) => (
              <motion.div
                key={keyword}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium"
                style={{
                  backgroundColor: `${theme.colors.accent}15`,
                  color: theme.colors.accent,
                  border: `1px solid ${theme.colors.accent}30`,
                }}
              >
                <span>{keyword}</span>
                <button
                  onClick={() => removeKeyword(keyword)}
                  disabled={saving}
                  className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full hover:bg-black/10 transition-colors"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <p
          className="text-xs text-center py-3"
          style={{ color: theme.colors.textSecondary }}
        >
          설정된 키워드가 없습니다
        </p>
      )}

      {/* 키워드 개수 */}
      {keywords.length > 0 && (
        <p
          className="text-xs mt-2 text-right"
          style={{ color: theme.colors.textSecondary }}
        >
          {keywords.length}/20
        </p>
      )}

      {/* 토스트 */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mt-3 px-3 py-2 rounded-xl text-xs text-center font-medium"
            style={{
              backgroundColor: `${theme.colors.accent}15`,
              color: theme.colors.accent,
            }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
