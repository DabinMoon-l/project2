/**
 * 시즌 리셋 확인 모달 컴포넌트
 *
 * 시즌 전환 전 최종 확인을 받는 모달입니다.
 * 영향받는 학생 수와 초기화 항목을 표시합니다.
 */

'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import {
  type SeasonType,
  getSeasonName,
  RESET_ITEMS,
  PRESERVED_ITEMS,
} from '@/lib/hooks/useSeasonReset';

// ============================================================
// Props
// ============================================================

interface SeasonResetModalProps {
  /**
   * 모달 표시 여부
   */
  isOpen: boolean;
  /**
   * 대상 반 ID (null이면 전체)
   */
  targetClass: string | null;
  /**
   * 새로운 시즌
   */
  newSeason: SeasonType;
  /**
   * 영향받는 학생 수
   */
  studentCount: number;
  /**
   * 로딩 상태
   */
  loading?: boolean;
  /**
   * 닫기 핸들러
   */
  onClose: () => void;
  /**
   * 확인 핸들러
   */
  onConfirm: () => void;
}

// ============================================================
// 컴포넌트
// ============================================================

export function SeasonResetModal({
  isOpen,
  targetClass,
  newSeason,
  studentCount,
  loading = false,
  onClose,
  onConfirm,
}: SeasonResetModalProps) {
  const { theme } = useTheme();
  const [confirmText, setConfirmText] = useState('');

  // 모달 열림 시 body 스크롤 방지
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // 확인용 텍스트
  const requiredText = targetClass ? `${targetClass}반 리셋` : '전체 리셋';
  const isConfirmEnabled = confirmText === requiredText && !loading;

  // 모달 닫힐 때 입력 초기화
  const handleClose = () => {
    setConfirmText('');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 백드롭 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/50 z-50"
          />

          {/* 모달 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-md mx-auto z-50 rounded-2xl p-5 max-h-[85vh] overflow-y-auto overscroll-contain"
            style={{ backgroundColor: theme.colors.background }}
          >
            {/* 경고 아이콘 */}
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                <span className="text-3xl">⚠️</span>
              </div>
            </div>

            {/* 제목 */}
            <h2
              className="text-xl font-bold text-center mb-2"
              style={{ color: theme.colors.text }}
            >
              시즌 전환 확인
            </h2>

            {/* 설명 */}
            <p
              className="text-sm text-center mb-4"
              style={{ color: theme.colors.textSecondary }}
            >
              {targetClass ? `${targetClass}반의` : '전체 반의'} 시즌을{' '}
              <strong style={{ color: theme.colors.accent }}>
                {getSeasonName(newSeason)}
              </strong>
              (으)로 전환합니다.
            </p>

            {/* 영향 범위 */}
            <div
              className="rounded-xl p-4 mb-4"
              style={{
                backgroundColor: theme.colors.backgroundSecondary,
                border: `1px solid ${theme.colors.border}`,
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-sm"
                  style={{ color: theme.colors.textSecondary }}
                >
                  영향받는 학생
                </span>
                <span
                  className="text-lg font-bold"
                  style={{ color: theme.colors.accent }}
                >
                  {studentCount}명
                </span>
              </div>
            </div>

            {/* 초기화/유지 항목 */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* 초기화 항목 */}
              <div className="rounded-xl p-3 bg-red-50">
                <p className="text-xs font-medium text-red-700 mb-2">
                  삭제됨
                </p>
                <div className="space-y-1">
                  {RESET_ITEMS.map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center gap-1.5 text-xs text-red-600"
                    >
                      <span>{item.icon}</span>
                      <span>{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 유지 항목 */}
              <div className="rounded-xl p-3 bg-green-50">
                <p className="text-xs font-medium text-green-700 mb-2">
                  유지됨
                </p>
                <div className="space-y-1">
                  {PRESERVED_ITEMS.map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center gap-1.5 text-xs text-green-600"
                    >
                      <span>{item.icon}</span>
                      <span>{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 확인 입력 */}
            <div className="mb-4">
              <p
                className="text-xs mb-2"
                style={{ color: theme.colors.textSecondary }}
              >
                계속하려면 &quot;<strong className="text-red-600">{requiredText}</strong>&quot;를
                입력하세요:
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={requiredText}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                style={{
                  backgroundColor: theme.colors.backgroundSecondary,
                  border: `1px solid ${
                    confirmText === requiredText
                      ? '#10B981'
                      : theme.colors.border
                  }`,
                  color: theme.colors.text,
                }}
              />
            </div>

            {/* 버튼 */}
            <div className="flex gap-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleClose}
                disabled={loading}
                className="flex-1 py-3 rounded-xl font-medium"
                style={{
                  backgroundColor: theme.colors.backgroundSecondary,
                  color: theme.colors.text,
                }}
              >
                취소
              </motion.button>

              <motion.button
                whileHover={isConfirmEnabled ? { scale: 1.02 } : {}}
                whileTap={isConfirmEnabled ? { scale: 0.98 } : {}}
                onClick={onConfirm}
                disabled={!isConfirmEnabled}
                className="flex-1 py-3 rounded-xl font-medium text-white transition-opacity disabled:opacity-50"
                style={{ backgroundColor: '#DC2626' }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{
                        duration: 1,
                        repeat: Infinity,
                        ease: 'linear',
                      }}
                      className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                    />
                    처리 중...
                  </span>
                ) : (
                  '시즌 전환'
                )}
              </motion.button>
            </div>

            {/* 되돌릴 수 없음 경고 */}
            <p className="text-xs text-center text-red-500 mt-3">
              이 작업은 되돌릴 수 없습니다.
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default SeasonResetModal;
