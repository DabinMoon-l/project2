'use client';

import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import SettingsItem from './SettingsItem';
import {
  type NotificationSettings,
  type DisplaySettings,
  type PrivacySettings,
} from '@/lib/hooks/useSettings';

// ============================================================
// 타입 정의
// ============================================================

interface SettingsListProps {
  /** 알림 설정 */
  notifications: NotificationSettings;
  /** 표시 설정 */
  display: DisplaySettings;
  /** 개인정보 설정 */
  privacy: PrivacySettings;
  /** 알림 설정 변경 핸들러 */
  onNotificationChange: (key: keyof NotificationSettings, value: boolean) => void;
  /** 표시 설정 변경 핸들러 */
  onDisplayChange: (key: keyof DisplaySettings, value: boolean) => void;
  /** 개인정보 설정 변경 핸들러 */
  onPrivacyChange: (key: keyof PrivacySettings, value: boolean) => void;
  /** 로그아웃 핸들러 */
  onLogout: () => void;
  /** 설정 초기화 핸들러 */
  onResetSettings: () => void;
  /** 로딩 상태 */
  loading?: boolean;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 설정 목록 컴포넌트
 *
 * 알림, 표시, 개인정보 설정을 그룹별로 표시합니다.
 */
export default function SettingsList({
  notifications,
  display,
  privacy,
  onNotificationChange,
  onDisplayChange,
  onPrivacyChange,
  onLogout,
  onResetSettings,
  loading = false,
}: SettingsListProps) {
  const { theme } = useTheme();

  // 알림 설정 항목
  const notificationItems = [
    {
      key: 'quizReminder' as const,
      icon: '⏰',
      label: '퀴즈 알림',
      description: '마감 전 퀴즈 알림을 받습니다',
    },
    {
      key: 'newQuiz' as const,
      icon: '📝',
      label: '새 퀴즈 알림',
      description: '새로운 퀴즈가 등록되면 알림을 받습니다',
    },
    {
      key: 'feedbackReply' as const,
      icon: '💬',
      label: '피드백 답변 알림',
      description: '피드백에 답변이 달리면 알림을 받습니다',
    },
    {
      key: 'boardComment' as const,
      icon: '📢',
      label: '게시판 알림',
      description: '내 글에 댓글이 달리면 알림을 받습니다',
    },
    {
      key: 'rankingChange' as const,
      icon: '📈',
      label: '랭킹 변동 알림',
      description: '순위가 변동되면 알림을 받습니다',
    },
    {
      key: 'seasonNotice' as const,
      icon: '🗓️',
      label: '시즌 알림',
      description: '시즌 종료 및 초기화 알림을 받습니다',
    },
  ];

  // 표시 설정 항목
  const displayItems = [
    {
      key: 'animations' as const,
      icon: '✨',
      label: '애니메이션',
      description: 'UI 애니메이션을 표시합니다',
    },
    {
      key: 'hapticFeedback' as const,
      icon: '📳',
      label: '진동 피드백',
      description: '터치 시 진동 피드백을 제공합니다',
    },
    {
      key: 'soundEffects' as const,
      icon: '🔊',
      label: '사운드 효과',
      description: '효과음을 재생합니다',
    },
  ];

  // 개인정보 설정 항목
  const privacyItems = [
    {
      key: 'profilePublic' as const,
      icon: '👤',
      label: '프로필 공개',
      description: '다른 사용자에게 프로필을 공개합니다',
    },
    {
      key: 'showInRanking' as const,
      icon: '🏆',
      label: '랭킹 표시',
      description: '랭킹에 내 정보를 표시합니다',
    },
    {
      key: 'activityPublic' as const,
      icon: '📋',
      label: '활동 내역 공개',
      description: '퀴즈 참여 기록을 공개합니다',
    },
  ];

  return (
    <div className="space-y-4">
      {/* 알림 설정 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl overflow-hidden"
        style={{
          backgroundColor: theme.colors.backgroundSecondary,
          border: `1px solid ${theme.colors.border}`,
        }}
      >
        <div
          className="px-4 py-3 border-b"
          style={{ borderColor: theme.colors.border }}
        >
          <h3
            className="font-bold"
            style={{ color: theme.colors.text }}
          >
            알림 설정
          </h3>
        </div>
        <div className="divide-y" style={{ borderColor: theme.colors.border }}>
          {notificationItems.map((item) => (
            <SettingsItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              description={item.description}
              type="toggle"
              value={notifications[item.key]}
              onChange={(value) => onNotificationChange(item.key, value)}
              disabled={loading}
            />
          ))}
        </div>
      </motion.div>

      {/* 표시 설정 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-2xl overflow-hidden"
        style={{
          backgroundColor: theme.colors.backgroundSecondary,
          border: `1px solid ${theme.colors.border}`,
        }}
      >
        <div
          className="px-4 py-3 border-b"
          style={{ borderColor: theme.colors.border }}
        >
          <h3
            className="font-bold"
            style={{ color: theme.colors.text }}
          >
            표시 설정
          </h3>
        </div>
        <div className="divide-y" style={{ borderColor: theme.colors.border }}>
          {displayItems.map((item) => (
            <SettingsItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              description={item.description}
              type="toggle"
              value={display[item.key]}
              onChange={(value) => onDisplayChange(item.key, value)}
              disabled={loading}
            />
          ))}
        </div>
      </motion.div>

      {/* 개인정보 설정 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl overflow-hidden"
        style={{
          backgroundColor: theme.colors.backgroundSecondary,
          border: `1px solid ${theme.colors.border}`,
        }}
      >
        <div
          className="px-4 py-3 border-b"
          style={{ borderColor: theme.colors.border }}
        >
          <h3
            className="font-bold"
            style={{ color: theme.colors.text }}
          >
            개인정보 설정
          </h3>
        </div>
        <div className="divide-y" style={{ borderColor: theme.colors.border }}>
          {privacyItems.map((item) => (
            <SettingsItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              description={item.description}
              type="toggle"
              value={privacy[item.key]}
              onChange={(value) => onPrivacyChange(item.key, value)}
              disabled={loading}
            />
          ))}
        </div>
      </motion.div>

      {/* 기타 설정 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl overflow-hidden"
        style={{
          backgroundColor: theme.colors.backgroundSecondary,
          border: `1px solid ${theme.colors.border}`,
        }}
      >
        <div
          className="px-4 py-3 border-b"
          style={{ borderColor: theme.colors.border }}
        >
          <h3
            className="font-bold"
            style={{ color: theme.colors.text }}
          >
            기타
          </h3>
        </div>
        <div className="divide-y" style={{ borderColor: theme.colors.border }}>
          <SettingsItem
            icon="🔄"
            label="설정 초기화"
            description="모든 설정을 기본값으로 되돌립니다"
            type="button"
            onClick={onResetSettings}
            disabled={loading}
          />
          <SettingsItem
            icon="🚪"
            label="로그아웃"
            type="button"
            onClick={onLogout}
            danger
          />
        </div>
      </motion.div>

      {/* 앱 정보 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="text-center py-4"
      >
        <p
          className="text-sm"
          style={{ color: theme.colors.textSecondary }}
        >
          QuizBunny v1.0.0
        </p>
        <p
          className="text-xs mt-1"
          style={{ color: theme.colors.textSecondary }}
        >
          Made with ❤️ for students
        </p>
      </motion.div>
    </div>
  );
}
