'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import SettingsItem from './SettingsItem';
import { useNotificationContext } from '@/components/common/NotificationProvider';
import {
  type NotificationSettings,
  type DisplaySettings,
  type PrivacySettings,
} from '@/lib/hooks/useSettings';

// ============================================================
// 타입 정의
// ============================================================

interface SettingsListProps {
  notifications: NotificationSettings;
  display: DisplaySettings;
  privacy: PrivacySettings;
  onNotificationChange: (key: keyof NotificationSettings, value: boolean) => void;
  onDisplayChange: (key: keyof DisplaySettings, value: boolean) => void;
  onPrivacyChange: (key: keyof PrivacySettings, value: boolean) => void;
  onLogout: () => void;
  onResetSettings: () => void;
  loading?: boolean;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 설정 목록 컴포넌트 (글래스모피즘)
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
  const {
    permissionStatus,
    isSubscribed,
    subscribe,
    unsubscribe,
    requestPermission,
    loading: fcmLoading,
  } = useNotificationContext();

  // 푸시 알림 마스터 토글 상태
  const pushEnabled = permissionStatus === 'granted' && isSubscribed;
  const [pushToggling, setPushToggling] = useState(false);

  const handlePushToggle = useCallback(async (value: boolean) => {
    setPushToggling(true);
    try {
      if (value) {
        // 권한이 없으면 요청, 있으면 구독
        if (permissionStatus !== 'granted') {
          await requestPermission();
        } else {
          await subscribe();
        }
      } else {
        await unsubscribe();
      }
    } catch {
      // 에러는 NotificationProvider에서 처리
    } finally {
      setPushToggling(false);
    }
  }, [permissionStatus, requestPermission, subscribe, unsubscribe]);

  const notificationItems = [
    { key: 'announcement' as const, icon: '📢', label: '공지 알림', description: '교수님이 공지를 올리면 알림을 받습니다' },
    { key: 'newQuiz' as const, icon: '📝', label: '퀴즈 알림', description: '새로운 퀴즈가 등록되면 알림을 받습니다' },
    { key: 'boardComment' as const, icon: '💬', label: '댓글 알림', description: '내 글에 댓글/답글이 달리면 알림을 받습니다' },
  ];

  const displayItems = [
    { key: 'animations' as const, icon: '✨', label: '애니메이션', description: 'UI 애니메이션을 표시합니다' },
    { key: 'hapticFeedback' as const, icon: '📳', label: '진동 피드백', description: '터치 시 진동 피드백을 제공합니다' },
    { key: 'soundEffects' as const, icon: '🔊', label: '사운드 효과', description: '효과음을 재생합니다' },
  ];

  const privacyItems = [
    { key: 'profilePublic' as const, icon: '👤', label: '프로필 공개', description: '다른 사용자에게 프로필을 공개합니다' },
    { key: 'showInRanking' as const, icon: '🏆', label: '랭킹 표시', description: '랭킹에 내 정보를 표시합니다' },
    { key: 'activityPublic' as const, icon: '📋', label: '활동 내역 공개', description: '퀴즈 참여 기록을 공개합니다' },
    { key: 'allowBattleInvites' as const, icon: '⚔️', label: '배틀 신청 받기', description: '친구의 실시간 배틀 신청 도전장을 받습니다' },
  ];

  return (
    <div className="space-y-4">
      {/* 알림 설정 */}
      <GlassSection title="알림 설정" delay={0}>
        {/* 푸시 알림 마스터 토글 */}
        <SettingsItem
          icon="🔔"
          label="푸시 알림"
          description={
            permissionStatus === 'denied'
              ? '브라우저 설정에서 알림을 허용해주세요'
              : pushEnabled
                ? '푸시 알림이 활성화되어 있습니다'
                : '푸시 알림을 켜면 새 소식을 바로 받을 수 있어요'
          }
          type="toggle"
          value={pushEnabled}
          onChange={handlePushToggle}
          disabled={loading || pushToggling || fcmLoading || permissionStatus === 'denied'}
        />
        {/* 개별 알림 유형 토글 (푸시 활성화 시에만 의미 있음) */}
        {notificationItems.map((item) => (
          <SettingsItem
            key={item.key}
            icon={item.icon}
            label={item.label}
            description={item.description}
            type="toggle"
            value={notifications[item.key]}
            onChange={(value) => onNotificationChange(item.key, value)}
            disabled={loading || !pushEnabled}
          />
        ))}
      </GlassSection>

      {/* 표시 설정 */}
      <GlassSection title="표시 설정" delay={0.1}>
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
      </GlassSection>

      {/* 개인정보 설정 */}
      <GlassSection title="개인정보 설정" delay={0.2}>
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
      </GlassSection>

      {/* 기타 설정 */}
      <GlassSection title="기타" delay={0.3}>
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
      </GlassSection>

      {/* 앱 정보 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="text-center py-4"
      >
        <p className="text-sm text-white/40">RabbiTory v1.0.0</p>
      </motion.div>
    </div>
  );
}

/**
 * 글래스 섹션 카드
 */
function GlassSection({ title, delay, children }: { title: string; delay: number; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="rounded-2xl overflow-hidden bg-white/10 border border-white/15 backdrop-blur-sm"
    >
      <div className="px-4 py-3 border-b border-white/10">
        <h3 className="font-bold text-white">{title}</h3>
      </div>
      <div className="divide-y divide-white/10">
        {children}
      </div>
    </motion.div>
  );
}
