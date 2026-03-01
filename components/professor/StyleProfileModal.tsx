'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

interface StyleProfileSummary {
  analyzedQuizCount: number;
  analyzedQuestionCount: number;
  topTypes: string[];
  usesNegative: boolean;
  usesMultiSelect: boolean;
  hasClinicalCases: boolean;
}

interface KeywordsSummary {
  mainConceptsCount: number;
  caseTriggersCount: number;
  topMainConcepts: string[];
  topCaseTriggers: string[];
}

interface StyleProfileData {
  exists: boolean;
  courseId: string;
  summary?: StyleProfileSummary;
  keywordsSummary?: KeywordsSummary;
}

interface StyleProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId?: string;
}

// 문제 유형 한글 매핑
const TYPE_LABELS: Record<string, string> = {
  NEGATIVE: '부정형 (옳지 않은 것)',
  DEFINITION_MATCH: '정의 매칭',
  MECHANISM: '기전/원리',
  MULTI_SELECT: '복수 선택',
  CLASSIFICATION: '분류',
  CLINICAL_CASE: '임상 케이스',
  COMPARISON: '비교',
  FILL_IN_BLANK: '빈칸 채우기',
};

export default function StyleProfileModal({
  isOpen,
  onClose,
  courseId = 'pathophysiology',
}: StyleProfileModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StyleProfileData | null>(null);

  // 모달 열림 시 body 스크롤 방지
  useEffect(() => {
    if (!isOpen) return;
    lockScroll();
    return () => { unlockScroll(); };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const fetchStyleProfile = async () => {
      setLoading(true);
      setError(null);

      try {
        const functions = getFunctions(undefined, 'asia-northeast3');
        const getStyleProfile = httpsCallable<{ courseId: string }, StyleProfileData>(
          functions,
          'getStyleProfile'
        );

        const result = await getStyleProfile({ courseId });
        setData(result.data);
      } catch (err) {
        console.error('스타일 프로필 조회 오류:', err);
        setError('스타일 프로필을 불러오는 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };

    fetchStyleProfile();
  }, [isOpen, courseId]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto overscroll-contain"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">출제 스타일 분석</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 컨텐츠 */}
          <div className="p-4">
            {loading && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <p className="mt-3 text-sm text-gray-500">분석 데이터 불러오는 중...</p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 text-red-600 p-4 rounded-xl text-center">
                <p>{error}</p>
              </div>
            )}

            {!loading && !error && data && !data.exists && (
              <div className="bg-yellow-50 text-yellow-700 p-4 rounded-xl text-center">
                <p className="font-medium">아직 분석된 스타일이 없습니다</p>
                <p className="text-sm mt-1">퀴즈를 출제하시면 자동으로 스타일이 분석됩니다.</p>
              </div>
            )}

            {!loading && !error && data?.exists && data.summary && (
              <div className="space-y-4">
                {/* 분석 통계 */}
                <div className="bg-indigo-50 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-indigo-700 mb-2">분석 통계</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-indigo-600">
                        {data.summary.analyzedQuizCount}
                      </p>
                      <p className="text-xs text-gray-500">분석된 퀴즈</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-indigo-600">
                        {data.summary.analyzedQuestionCount}
                      </p>
                      <p className="text-xs text-gray-500">분석된 문제</p>
                    </div>
                  </div>
                </div>

                {/* 주요 문제 유형 */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">자주 출제하는 유형</h3>
                  <div className="flex flex-wrap gap-2">
                    {data.summary.topTypes.map((type, index) => (
                      <span
                        key={type}
                        className={`px-3 py-1 rounded-full text-sm font-medium ${
                          index === 0
                            ? 'bg-indigo-100 text-indigo-700'
                            : index === 1
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-gray-200 text-gray-700'
                        }`}
                      >
                        {TYPE_LABELS[type] || type}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 출제 특성 */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">출제 특성</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">&quot;옳지 않은 것&quot; 유형</span>
                      <span className={`text-sm font-medium ${
                        data.summary.usesNegative ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        {data.summary.usesNegative ? '자주 사용' : '드물게 사용'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">&quot;모두 고르기&quot; 유형</span>
                      <span className={`text-sm font-medium ${
                        data.summary.usesMultiSelect ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        {data.summary.usesMultiSelect ? '자주 사용' : '드물게 사용'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">임상 케이스 문제</span>
                      <span className={`text-sm font-medium ${
                        data.summary.hasClinicalCases ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        {data.summary.hasClinicalCases ? '포함' : '거의 없음'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 키워드 */}
                {data.keywordsSummary && (
                  <div className="bg-gray-50 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">
                      핵심 키워드 ({data.keywordsSummary.mainConceptsCount}개)
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {data.keywordsSummary.topMainConcepts.map((keyword) => (
                        <span
                          key={keyword}
                          className="px-2 py-0.5 bg-white border border-gray-200 rounded text-xs text-gray-600"
                        >
                          {keyword}
                        </span>
                      ))}
                    </div>

                    {data.keywordsSummary.topCaseTriggers.length > 0 && (
                      <>
                        <h3 className="text-sm font-semibold text-gray-700 mt-3 mb-2">
                          임상 단서 ({data.keywordsSummary.caseTriggersCount}개)
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {data.keywordsSummary.topCaseTriggers.map((keyword) => (
                            <span
                              key={keyword}
                              className="px-2 py-0.5 bg-orange-50 border border-orange-200 rounded text-xs text-orange-600"
                            >
                              {keyword}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* 안내 */}
                <p className="text-xs text-gray-400 text-center">
                  퀴즈를 더 출제할수록 분석이 정확해집니다
                </p>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
