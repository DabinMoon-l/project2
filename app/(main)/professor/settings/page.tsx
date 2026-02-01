/**
 * 교수님 설정 페이지
 *
 * 시즌 관리 및 기타 설정을 관리합니다.
 */

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Header, Skeleton } from '@/components/common';
import { useSeasonReset, type SeasonType } from '@/lib/hooks/useSeasonReset';
import { useTheme } from '@/styles/themes/useTheme';

// 동적 import로 코드 스플리팅 적용 (교수님 전용 컴포넌트)
const SemesterSettingsCard = dynamic(() => import('@/components/professor/SemesterSettingsCard'), {
  loading: () => <Skeleton className="h-48 rounded-2xl" />,
});

const SeasonResetCard = dynamic(() => import('@/components/professor/SeasonResetCard'), {
  loading: () => <Skeleton className="h-80 rounded-2xl" />,
});

const SeasonResetModal = dynamic(() => import('@/components/professor/SeasonResetModal'), {
  ssr: false, // 모달은 SSR 불필요
});

const SeasonHistoryList = dynamic(() => import('@/components/professor/SeasonHistoryList'), {
  loading: () => <Skeleton className="h-60 rounded-2xl" />,
});

// ============================================================
// 타입
// ============================================================

interface ResetModalState {
  isOpen: boolean;
  targetClass: string | null;
  newSeason: SeasonType;
  studentCount: number;
}

// ============================================================
// 컴포넌트
// ============================================================

export default function ProfessorSettingsPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const {
    loading,
    logsLoading,
    classSeasons,
    seasonLogs,
    resetSeason,
    resetAllClasses,
    fetchSeasonLogs,
  } = useSeasonReset();

  // 모달 상태
  const [modalState, setModalState] = useState<ResetModalState>({
    isOpen: false,
    targetClass: null,
    newSeason: 'final',
    studentCount: 0,
  });

  // 히스토리 필터
  const [historyFilter, setHistoryFilter] = useState<string | null>(null);

  // 리셋 결과 토스트
  const [toast, setToast] = useState<{
    show: boolean;
    message: string;
    type: 'success' | 'error';
  }>({ show: false, message: '', type: 'success' });

  /**
   * 개별 반 리셋 클릭
   */
  const handleResetClass = useCallback(
    (classId: string, newSeason: SeasonType) => {
      const classInfo = classSeasons.find((c) => c.classId === classId);
      setModalState({
        isOpen: true,
        targetClass: classId,
        newSeason,
        studentCount: classInfo?.studentCount || 0,
      });
    },
    [classSeasons]
  );

  /**
   * 전체 리셋 클릭
   */
  const handleResetAll = useCallback(
    (newSeason: SeasonType) => {
      const totalStudents = classSeasons.reduce(
        (sum, c) => sum + c.studentCount,
        0
      );
      setModalState({
        isOpen: true,
        targetClass: null,
        newSeason,
        studentCount: totalStudents,
      });
    },
    [classSeasons]
  );

  /**
   * 리셋 확인
   */
  const handleConfirmReset = useCallback(async () => {
    const { targetClass, newSeason } = modalState;

    let result;
    if (targetClass) {
      result = await resetSeason(targetClass, newSeason);
    } else {
      const allResult = await resetAllClasses(newSeason);
      const totalReset = allResult.results.reduce(
        (sum, r) => sum + r.result.resetCount,
        0
      );
      result = {
        success: allResult.success,
        message: allResult.success
          ? `전체 ${totalReset}명의 학생이 초기화되었습니다.`
          : '일부 반 리셋에 실패했습니다.',
        resetCount: totalReset,
      };
    }

    // 모달 닫기
    setModalState((prev) => ({ ...prev, isOpen: false }));

    // 토스트 표시
    setToast({
      show: true,
      message: result.message,
      type: result.success ? 'success' : 'error',
    });

    // 3초 후 토스트 숨김
    setTimeout(() => {
      setToast((prev) => ({ ...prev, show: false }));
    }, 3000);
  }, [modalState, resetSeason, resetAllClasses]);

  /**
   * 히스토리 필터 변경
   */
  const handleHistoryFilterChange = useCallback(
    (classId: string | null) => {
      setHistoryFilter(classId);
      fetchSeasonLogs(classId || undefined);
    },
    [fetchSeasonLogs]
  );

  // 로딩 상태
  if (logsLoading && classSeasons.length === 0) {
    return (
      <div
        className="min-h-screen pb-20"
        style={{ backgroundColor: theme.colors.background }}
      >
        <Header title="설정" />
        <div className="p-4 space-y-4">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-60 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen pb-20"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* 헤더 */}
      <Header title="설정" />

      {/* 메인 컨텐츠 */}
      <main className="p-4 space-y-4">
        {/* 학기 설정 카드 */}
        <SemesterSettingsCard />

        {/* 시즌 리셋 카드 */}
        <SeasonResetCard
          classSeasons={classSeasons}
          loading={loading}
          onResetClass={handleResetClass}
          onResetAll={handleResetAll}
        />

        {/* 시즌 히스토리 */}
        <SeasonHistoryList
          logs={seasonLogs}
          loading={logsLoading}
          classFilter={historyFilter}
          onClassFilterChange={handleHistoryFilterChange}
        />

        {/* 기타 설정 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl p-5"
          style={{
            backgroundColor: theme.colors.backgroundSecondary,
            border: `1px solid ${theme.colors.border}`,
          }}
        >
          <h3
            className="font-bold mb-4"
            style={{ color: theme.colors.text }}
          >
            기타 설정
          </h3>

          <div className="space-y-3">
            {/* 프로필 설정 */}
            <button
              onClick={() => router.push('/profile')}
              className="w-full flex items-center justify-between p-3 rounded-xl transition-colors"
              style={{
                backgroundColor: `${theme.colors.accent}10`,
              }}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">👤</span>
                <span
                  className="text-sm font-medium"
                  style={{ color: theme.colors.text }}
                >
                  프로필 설정
                </span>
              </div>
              <span style={{ color: theme.colors.textSecondary }}>→</span>
            </button>

            {/* 알림 설정 */}
            <button
              onClick={() => router.push('/settings')}
              className="w-full flex items-center justify-between p-3 rounded-xl transition-colors"
              style={{
                backgroundColor: `${theme.colors.accent}10`,
              }}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">🔔</span>
                <span
                  className="text-sm font-medium"
                  style={{ color: theme.colors.text }}
                >
                  알림 설정
                </span>
              </div>
              <span style={{ color: theme.colors.textSecondary }}>→</span>
            </button>

            {/* 앱 정보 */}
            <div
              className="p-3 rounded-xl"
              style={{
                backgroundColor: `${theme.colors.accent}10`,
              }}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">📱</span>
                <div>
                  <span
                    className="text-sm font-medium"
                    style={{ color: theme.colors.text }}
                  >
                    앱 버전
                  </span>
                  <p
                    className="text-xs"
                    style={{ color: theme.colors.textSecondary }}
                  >
                    v1.0.0
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </main>

      {/* 시즌 리셋 모달 */}
      <SeasonResetModal
        isOpen={modalState.isOpen}
        targetClass={modalState.targetClass}
        newSeason={modalState.newSeason}
        studentCount={modalState.studentCount}
        loading={loading}
        onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmReset}
      />

      {/* 토스트 */}
      {toast.show && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed bottom-24 left-4 right-4 p-4 rounded-xl shadow-lg z-50"
          style={{
            backgroundColor:
              toast.type === 'success' ? '#10B981' : '#EF4444',
          }}
        >
          <p className="text-white text-sm font-medium text-center">
            {toast.message}
          </p>
        </motion.div>
      )}
    </div>
  );
}
