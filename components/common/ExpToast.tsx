'use client';

import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { getExpBarDisplay } from '@/lib/utils/milestone';

/** 토스트 데이터 타입 */
interface ExpToastData {
  id: string;
  amount: number;
  reason?: string;
}

/** Context 타입 */
interface ExpToastContextType {
  showExpToast: (amount: number, reason?: string) => void;
}

const ExpToastContext = createContext<ExpToastContextType | null>(null);

/** 실시간 totalExp + lastGachaExp context (토스트 아이템에서 사용) */
interface RealtimeExpData {
  totalExp: number;
  lastGachaExp: number;
}
const RealtimeExpContext = createContext<RealtimeExpData>({ totalExp: 0, lastGachaExp: 0 });

/** ExpToast Provider */
export function ExpToastProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [toasts, setToasts] = useState<ExpToastData[]>([]);
  const [realtimeExp, setRealtimeExp] = useState<RealtimeExpData>({ totalExp: 0, lastGachaExp: 0 });

  // Firestore 실시간 구독으로 최신 totalExp + lastGachaExp 추적
  useEffect(() => {
    if (!user?.uid) {
      setRealtimeExp({ totalExp: 0, lastGachaExp: 0 });
      return;
    }

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setRealtimeExp({
          totalExp: data.totalExp || 0,
          lastGachaExp: data.lastGachaExp || 0,
        });
      }
    });

    return () => unsubscribe();
  }, [user?.uid]);

  const showExpToast = useCallback((
    amount: number,
    reason?: string,
  ) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, amount, reason }]);

    // 자동 제거 (3초 후)
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  return (
    <ExpToastContext.Provider value={{ showExpToast }}>
      <RealtimeExpContext.Provider value={realtimeExp}>
        {children}
        <ExpToastContainer toasts={toasts} />
      </RealtimeExpContext.Provider>
    </ExpToastContext.Provider>
  );
}

/** useExpToast 훅 */
export function useExpToast() {
  const context = useContext(ExpToastContext);
  if (!context) {
    throw new Error('useExpToast must be used within ExpToastProvider');
  }
  return context;
}

/** 토스트 컨테이너 */
function ExpToastContainer({ toasts }: { toasts: ExpToastData[] }) {
  return (
    <div className="fixed top-20 left-0 right-0 z-[100] pointer-events-none flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((toast) => (
          <ExpToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  );
}

/** 개별 토스트 아이템 — realtimeTotalExp를 실시간으로 반영 */
function ExpToastItem({ toast }: { toast: ExpToastData }) {
  const { theme } = useTheme();
  const { totalExp, lastGachaExp } = useContext(RealtimeExpContext);
  const expBar = getExpBarDisplay(totalExp, lastGachaExp);

  // 토스트 마운트 시점의 "이전 값" 저장 (얻기 전 위치에서 애니메이션)
  const prevProgressRef = useRef<number | null>(null);
  if (prevProgressRef.current === null) {
    // 마운트 시점: 획득 전 위치 = 현재 위치 - 획득량 (0 미만이면 0)
    const prevCurrent = Math.max(expBar.current - toast.amount, 0);
    prevProgressRef.current = (prevCurrent / expBar.max) * 100;
  }

  const currentProgress = expBar.overflow
    ? 100
    : (expBar.current / expBar.max) * 100;
  const [showParticles, setShowParticles] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowParticles(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: -50, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className="relative pointer-events-auto"
    >
      {/* 파티클 효과 */}
      <AnimatePresence>
        {showParticles && (
          <>
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 1, scale: 0, x: 0, y: 0 }}
                animate={{
                  opacity: 0,
                  scale: 1,
                  x: Math.cos((i * Math.PI * 2) / 6) * 50,
                  y: Math.sin((i * Math.PI * 2) / 6) * 50 - 10,
                }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="absolute top-1/2 left-1/2 -ml-1 -mt-1 text-xs font-bold"
                style={{ color: theme.colors.accent }}
              >
                ✦
              </motion.div>
            ))}
          </>
        )}
      </AnimatePresence>

      {/* 일반 EXP 토스트 - 빈티지 신문 스타일 */}
        <div
          className="relative px-4 py-2 shadow-lg min-w-[180px]"
          style={{
            backgroundColor: theme.colors.background,
            border: '2px solid #1A1A1A',
          }}
        >
          {/* 장식 코너 */}
          <div className="absolute top-1 left-1 w-2 h-2 border-t border-l border-[#1A1A1A]" />
          <div className="absolute top-1 right-1 w-2 h-2 border-t border-r border-[#1A1A1A]" />
          <div className="absolute bottom-1 left-1 w-2 h-2 border-b border-l border-[#1A1A1A]" />
          <div className="absolute bottom-1 right-1 w-2 h-2 border-b border-r border-[#1A1A1A]" />

          {/* EXP 획득 텍스트 */}
          <div className="flex items-center justify-center gap-2 mb-2">
            <motion.span
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
              style={{ color: theme.colors.accent }}
            >
              ✦
            </motion.span>
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="font-serif-display text-base font-bold"
              style={{ color: theme.colors.accent }}
            >
              +{toast.amount} XP
            </motion.span>
            <motion.span
              initial={{ scale: 0, rotate: 180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.1 }}
              style={{ color: theme.colors.accent }}
            >
              ✦
            </motion.span>
          </div>

          {/* 사유 */}
          {toast.reason && (
            <p
              className="text-xs text-center mb-2  italic"
              style={{ color: theme.colors.textSecondary }}
            >
              {toast.reason}
            </p>
          )}

          {/* 뽑기 마일스톤 바 — Firestore 실시간 값 사용 */}
          <div className="mt-2">
            <div className="flex justify-between text-xs mb-1">
              <span
                className="font-serif-display"
                style={{ color: theme.colors.accent }}
              >
                다음 뽑기
              </span>
              <span style={{ color: theme.colors.textSecondary }}>
                {expBar.current} / {expBar.max} XP
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden"
              style={{
                backgroundColor: theme.colors.backgroundSecondary,
                border: '1px solid #1A1A1A',
              }}
            >
              <motion.div
                initial={{ width: `${prevProgressRef.current}%` }}
                animate={{ width: `${currentProgress}%` }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="h-full"
                style={{ backgroundColor: theme.colors.accent }}
              />
            </div>
          </div>
        </div>
    </motion.div>
  );
}

export default ExpToastProvider;
