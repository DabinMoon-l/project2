'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Header, Skeleton, Modal } from '@/components/common';
import {
  ProfileCard,
  CharacterEditor,
  StatsSummary,
} from '@/components/profile';
import { useAuth } from '@/lib/hooks/useAuth';
import { useProfile, type CharacterOptions, type UserProfile } from '@/lib/hooks/useProfile';
import { useTheme } from '@/styles/themes/useTheme';

// ============================================================
// 타입 정의
// ============================================================

type ViewMode = 'profile' | 'stats' | 'edit';

// ============================================================
// 더미 데이터 (개발용)
// ============================================================

const DUMMY_PROFILE: UserProfile = {
  uid: 'dummy-uid',
  email: 'student@example.com',
  nickname: '용감한 토끼',
  classType: 'A',
  studentId: '2024001234',
  department: '컴퓨터공학과',
  characterOptions: {
    hairStyle: 2,
    skinColor: 3,
    beard: 0,
  },
  equipment: {
    armor: 'basic',
    weapon: 'sword',
  },
  gold: 1250,
  totalExp: 450,
  level: 5,
  rank: '용사',
  totalQuizzes: 23,
  correctAnswers: 85,
  wrongAnswers: 32,
  averageScore: 73,
  participationRate: 75,
  totalFeedbacks: 12,
  helpfulFeedbacks: 8,
  badges: ['첫 퀴즈 완료', '피드백 마스터', '연속 출석 7일'],
  role: 'student',
  createdAt: null as any,
  updatedAt: null as any,
};

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 로딩 스켈레톤
 */
function ProfileSkeleton() {
  return (
    <div className="space-y-4 px-4">
      <Skeleton className="h-72 rounded-2xl" />
      <Skeleton className="h-40 rounded-2xl" />
      <Skeleton className="h-40 rounded-2xl" />
    </div>
  );
}

/**
 * 프로필 페이지
 *
 * 사용자 프로필, 통계, 캐릭터 편집 기능을 제공합니다.
 */
export default function ProfilePage() {
  const router = useRouter();
  const { theme } = useTheme();
  const { user, logout } = useAuth();
  const {
    profile,
    loading,
    error,
    fetchProfile,
    updateCharacter,
    clearError,
  } = useProfile();

  // 뷰 모드
  const [viewMode, setViewMode] = useState<ViewMode>('profile');
  // 저장 중 상태
  const [saving, setSaving] = useState(false);
  // 닉네임 수정 모달
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [newNickname, setNewNickname] = useState('');

  // 프로필 로드
  useEffect(() => {
    if (user?.uid) {
      fetchProfile(user.uid);
    }
  }, [user?.uid, fetchProfile]);

  // 실제 프로필 또는 더미 데이터 사용
  const displayProfile = profile || DUMMY_PROFILE;

  /**
   * 캐릭터 저장 핸들러
   */
  const handleSaveCharacter = useCallback(
    async (options: CharacterOptions) => {
      if (!user?.uid) return;

      try {
        setSaving(true);
        await updateCharacter(user.uid, options);
        setViewMode('profile');
      } catch (err) {
        console.error('캐릭터 저장 에러:', err);
      } finally {
        setSaving(false);
      }
    },
    [user?.uid, updateCharacter]
  );

  /**
   * 설정 페이지로 이동
   */
  const handleGoToSettings = useCallback(() => {
    router.push('/settings');
  }, [router]);

  return (
    <div
      className="min-h-screen pb-24"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* 헤더 */}
      <Header
        title={viewMode === 'edit' ? '캐릭터 수정' : '내 프로필'}
        showBack
        rightAction={
          viewMode !== 'edit' && (
            <button
              type="button"
              onClick={handleGoToSettings}
              className="p-2 rounded-full"
              style={{ backgroundColor: `${theme.colors.accent}20` }}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke={theme.colors.accent}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          )
        }
      />

      {/* 에러 메시지 */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-4 mb-4 p-3 bg-red-50 border border-red-200 rounded-xl"
        >
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={clearError}
            className="text-xs text-red-500 underline mt-1"
          >
            닫기
          </button>
        </motion.div>
      )}

      {/* 메인 컨텐츠 */}
      <main className="pt-4">
        {loading ? (
          <ProfileSkeleton />
        ) : (
          <AnimatePresence mode="wait">
            {viewMode === 'edit' ? (
              // 캐릭터 편집 모드
              <motion.div
                key="edit"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-[calc(100vh-150px)]"
              >
                <CharacterEditor
                  initialOptions={displayProfile.characterOptions}
                  onSave={handleSaveCharacter}
                  onCancel={() => setViewMode('profile')}
                  saving={saving}
                />
              </motion.div>
            ) : (
              // 프로필 뷰 모드
              <motion.div
                key="view"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="px-4 space-y-4"
              >
                {/* 탭 선택 */}
                <div
                  className="flex bg-white rounded-xl p-1 shadow-sm"
                  style={{ backgroundColor: theme.colors.backgroundSecondary }}
                >
                  {[
                    { value: 'profile', label: '프로필' },
                    { value: 'stats', label: '통계' },
                  ].map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setViewMode(tab.value as ViewMode)}
                      className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
                      style={{
                        backgroundColor:
                          viewMode === tab.value
                            ? theme.colors.accent
                            : 'transparent',
                        color:
                          viewMode === tab.value
                            ? theme.colors.background
                            : theme.colors.textSecondary,
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* 프로필 탭 */}
                {viewMode === 'profile' && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <ProfileCard
                      profile={displayProfile}
                      onEdit={() => setViewMode('edit')}
                    />

                    {/* 빠른 액션 */}
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <motion.button
                        type="button"
                        onClick={() => setViewMode('edit')}
                        className="p-4 rounded-xl text-center"
                        style={{
                          backgroundColor: theme.colors.backgroundSecondary,
                          border: `1px solid ${theme.colors.border}`,
                        }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <span className="text-2xl block mb-1">🎨</span>
                        <span
                          className="text-sm font-medium"
                          style={{ color: theme.colors.text }}
                        >
                          캐릭터 수정
                        </span>
                      </motion.button>

                      <motion.button
                        type="button"
                        onClick={() => setShowNicknameModal(true)}
                        className="p-4 rounded-xl text-center"
                        style={{
                          backgroundColor: theme.colors.backgroundSecondary,
                          border: `1px solid ${theme.colors.border}`,
                        }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <span className="text-2xl block mb-1">✏️</span>
                        <span
                          className="text-sm font-medium"
                          style={{ color: theme.colors.text }}
                        >
                          닉네임 변경
                        </span>
                      </motion.button>
                    </div>

                    {/* 학적 정보 */}
                    <div
                      className="mt-4 rounded-2xl p-4"
                      style={{
                        backgroundColor: theme.colors.backgroundSecondary,
                        border: `1px solid ${theme.colors.border}`,
                      }}
                    >
                      <h3
                        className="font-bold mb-3"
                        style={{ color: theme.colors.text }}
                      >
                        학적 정보
                      </h3>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span style={{ color: theme.colors.textSecondary }}>
                            학번
                          </span>
                          <span style={{ color: theme.colors.text }}>
                            {displayProfile.studentId || '-'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: theme.colors.textSecondary }}>
                            학과
                          </span>
                          <span style={{ color: theme.colors.text }}>
                            {displayProfile.department || '-'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: theme.colors.textSecondary }}>
                            반
                          </span>
                          <span style={{ color: theme.colors.text }}>
                            {displayProfile.classType}반
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* 통계 탭 */}
                {viewMode === 'stats' && (
                  <StatsSummary profile={displayProfile} />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>

      {/* 닉네임 수정 모달 */}
      <Modal
        isOpen={showNicknameModal}
        onClose={() => setShowNicknameModal(false)}
        title="닉네임 변경"
      >
        <div className="p-4">
          <input
            type="text"
            value={newNickname}
            onChange={(e) => setNewNickname(e.target.value)}
            placeholder="새 닉네임 (2-10자)"
            maxLength={10}
            className="w-full px-4 py-3 rounded-xl border focus:ring-2 focus:ring-offset-2 outline-none"
            style={{
              borderColor: theme.colors.border,
              color: theme.colors.text,
            }}
          />
          <p
            className="text-xs mt-2"
            style={{ color: theme.colors.textSecondary }}
          >
            닉네임은 2-10자 사이여야 합니다.
          </p>
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={() => setShowNicknameModal(false)}
              className="flex-1 py-3 rounded-xl font-medium"
              style={{
                backgroundColor: theme.colors.backgroundSecondary,
                color: theme.colors.text,
              }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => {
                // TODO: 닉네임 저장 로직 구현 필요
                setShowNicknameModal(false);
              }}
              className="flex-1 py-3 rounded-xl font-medium"
              style={{
                backgroundColor: theme.colors.accent,
                color: theme.colors.background,
              }}
              disabled={newNickname.length < 2 || newNickname.length > 10}
            >
              변경
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
