'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { Timestamp } from '@/lib/repositories';
import type { NotificationSettings } from '@/lib/hooks/useSettings';

// ============================================================
// 상수
// ============================================================

export const ADMIN_STUDENT_ID = '25010423';

export const NOTIFICATION_ITEMS: { key: keyof NotificationSettings; label: string; desc: string }[] = [
  { key: 'announcement', label: '공지 알림', desc: '교수님 공지사항' },
  { key: 'boardComment', label: '댓글 알림', desc: '내 게시글 댓글' },
  { key: 'newQuiz', label: '퀴즈 알림', desc: '새 퀴즈 등록' },
];

export const CLASS_OPTIONS = ['A', 'B', 'C', 'D'] as const;

// ============================================================
// 유틸리티
// ============================================================

/** 이메일 마스킹 (예: "ab***@domain.com") */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${local[1]}***@${domain}`;
}

// ============================================================
// 타입
// ============================================================

export interface Inquiry {
  id: string;
  authorUid: string;
  message: string;
  createdAt: Timestamp | null;
  courseId: string;
  isRead: boolean;
}

export interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** 3쪽 패널 모드 — 포탈 없이 h-full 렌더 */
  isPanelMode?: boolean;
}

// ============================================================
// 서브 컴포넌트
// ============================================================

/** 문의 메시지 아이템 (line-clamp 감지 + 더보기/접기) */
export function InquiryMessageItem({ message }: { message: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el && !isExpanded) {
      setIsClamped(el.scrollHeight > el.clientHeight + 1);
    }
  }, [message, isExpanded]);

  return (
    <div className="flex-1 min-w-0">
      <p
        ref={ref}
        className={`text-sm text-white/60 whitespace-pre-wrap break-words ${
          !isExpanded ? 'line-clamp-2' : ''
        }`}
      >
        {message}
      </p>
      {(isClamped || isExpanded) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className="text-[11px] text-white/40 hover:text-white/60 mt-0.5 transition-colors"
        >
          {isExpanded ? '접기' : '...더보기'}
        </button>
      )}
    </div>
  );
}

/** 글래스 토글 스위치 */
export function ToggleSwitch({
  checked,
  onChange,
  animated,
}: {
  checked: boolean;
  onChange: () => void;
  animated: boolean;
}) {
  return (
    <button
      onClick={onChange}
      className={`w-12 h-7 relative rounded-full transition-colors ${
        checked ? 'bg-white/40' : 'bg-white/15'
      }`}
    >
      <motion.div
        className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm"
        initial={false}
        animate={{ left: checked ? 24 : 4 }}
        transition={animated ? { type: 'spring', stiffness: 500, damping: 30 } : { duration: 0 }}
      />
    </button>
  );
}

/** 글래스 바텀시트 래퍼 (부모 컨테이너 기준 — 2쪽/3쪽 자동 대응) */
export function GlassModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      {/* 투명 오버레이 (닫기용) — 부모 기준 absolute */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-[60]"
        onClick={onClose}
      />
      {/* 바텀시트 — 부모 기준 absolute */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 z-[60] rounded-t-2xl overflow-hidden"
      >
        <div className="absolute inset-0 rounded-t-2xl overflow-hidden">
          <Image src="/images/home-bg.jpg" alt="" fill className="object-cover" />
        </div>
        <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />
        <div className="relative z-10">
          {/* 드래그 핸들 */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-white/40 rounded-full" />
          </div>
          <div className="px-4 pb-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}>
            {children}
          </div>
        </div>
      </motion.div>
    </>
  );
}
