/**
 * 알림 권한 요청 배너 컴포넌트
 *
 * 사용자에게 알림을 활성화하라고 안내하는 배너입니다.
 * 홈 화면이나 설정 화면에서 사용할 수 있습니다.
 */

'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { useNotificationContext } from './NotificationProvider';

// ============================================================
// Props
// ============================================================

interface NotificationPromptProps {
  /**
   * 배너 스타일
   * - 'banner': 전체 너비 배너
   * - 'card': 카드 형태
   * - 'inline': 인라인 형태
   */
  variant?: 'banner' | 'card' | 'inline';
  /**
   * 닫기 버튼 표시 여부
   */
  dismissible?: boolean;
  /**
   * 닫았을 때 로컬 스토리지에 저장할지 여부
   */
  persistDismiss?: boolean;
  /**
   * 클래스명
   */
  className?: string;
}

// ============================================================
// 상수
// ============================================================

const STORAGE_KEY = 'notification-prompt-dismissed';

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 알림 권한 요청 배너
 *
 * @example
 * ```tsx
 * // 홈 화면에서 사용
 * <NotificationPrompt variant="card" dismissible />
 *
 * // 설정 화면에서 사용
 * <NotificationPrompt variant="inline" />
 * ```
 */
export function NotificationPrompt({
  variant = 'card',
  dismissible = true,
  persistDismiss = true,
  className = '',
}: NotificationPromptProps) {
  const { theme } = useTheme();
  const { permissionStatus, requestPermission, loading } = useNotificationContext();
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 클라이언트에서만 로컬 스토리지 체크
  useEffect(() => {
    setMounted(true);
    if (persistDismiss) {
      const isDismissed = localStorage.getItem(STORAGE_KEY) === 'true';
      setDismissed(isDismissed);
    }
  }, [persistDismiss]);

  // 이미 권한이 있거나 거부된 경우 표시하지 않음
  if (!mounted) return null;
  if (permissionStatus === 'granted') return null;
  if (permissionStatus === 'denied') return null;
  if (permissionStatus === 'unsupported') return null;
  if (dismissed) return null;

  /**
   * 권한 요청 핸들러
   */
  const handleEnable = async () => {
    await requestPermission();
  };

  /**
   * 닫기 핸들러
   */
  const handleDismiss = () => {
    setDismissed(true);
    if (persistDismiss) {
      localStorage.setItem(STORAGE_KEY, 'true');
    }
  };

  // 배너 스타일
  if (variant === 'banner') {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={`w-full p-4 ${className}`}
          style={{
            backgroundColor: theme.colors.accent,
          }}
        >
          <div className="flex items-center justify-between gap-4 max-w-lg mx-auto">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔔</span>
              <div>
                <p
                  className="font-medium text-sm"
                  style={{ color: theme.colors.background }}
                >
                  알림을 활성화하세요
                </p>
                <p
                  className="text-xs opacity-90"
                  style={{ color: theme.colors.background }}
                >
                  새 퀴즈, 피드백 답변 알림을 받아보세요
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleEnable}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg text-sm font-medium"
                style={{
                  backgroundColor: theme.colors.background,
                  color: theme.colors.accent,
                }}
              >
                {loading ? '...' : '활성화'}
              </button>

              {dismissible && (
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="p-1 rounded-full opacity-80 hover:opacity-100"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke={theme.colors.background}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // 카드 스타일
  if (variant === 'card') {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={`rounded-2xl p-4 ${className}`}
          style={{
            backgroundColor: `${theme.colors.accent}15`,
            border: `1px solid ${theme.colors.accent}30`,
          }}
        >
          <div className="flex items-start gap-3">
            {/* 아이콘 */}
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${theme.colors.accent}20` }}
            >
              <span className="text-xl">🔔</span>
            </div>

            {/* 내용 */}
            <div className="flex-1">
              <h4
                className="font-bold text-sm"
                style={{ color: theme.colors.text }}
              >
                알림을 켜보세요!
              </h4>
              <p
                className="text-xs mt-0.5"
                style={{ color: theme.colors.textSecondary }}
              >
                새 퀴즈, 피드백 답변, 댓글 알림을 받을 수 있어요.
              </p>

              {/* 버튼 */}
              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={handleEnable}
                  disabled={loading}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium"
                  style={{
                    backgroundColor: theme.colors.accent,
                    color: theme.colors.background,
                  }}
                >
                  {loading ? '처리 중...' : '알림 받기'}
                </button>

                {dismissible && (
                  <button
                    type="button"
                    onClick={handleDismiss}
                    className="px-3 py-1.5 rounded-lg text-xs"
                    style={{ color: theme.colors.textSecondary }}
                  >
                    나중에
                  </button>
                )}
              </div>
            </div>

            {/* 닫기 버튼 */}
            {dismissible && (
              <button
                type="button"
                onClick={handleDismiss}
                className="p-1 rounded-full hover:bg-black/5"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke={theme.colors.textSecondary}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // 인라인 스타일
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={`flex items-center justify-between ${className}`}
      >
        <div className="flex items-center gap-2">
          <span>🔔</span>
          <span
            className="text-sm"
            style={{ color: theme.colors.textSecondary }}
          >
            알림이 꺼져있어요
          </span>
        </div>

        <button
          type="button"
          onClick={handleEnable}
          disabled={loading}
          className="px-3 py-1 rounded-lg text-xs font-medium"
          style={{
            backgroundColor: theme.colors.accent,
            color: theme.colors.background,
          }}
        >
          {loading ? '...' : '켜기'}
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

export default NotificationPrompt;
