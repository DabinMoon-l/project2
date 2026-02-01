'use client';

import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';

/** 계급 정보 */
const RANKS = [
  { name: '견습생', minExp: 0 },
  { name: '용사', minExp: 50 },
  { name: '기사', minExp: 75 },
  { name: '장군', minExp: 100 },
  { name: '전설의 용사', minExp: 125 },
];

/** 현재 계급과 다음 계급 정보 계산 */
function getRankInfo(totalExp: number) {
  let currentRank = RANKS[0];
  let nextRank = RANKS[1];

  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (totalExp >= RANKS[i].minExp) {
      currentRank = RANKS[i];
      nextRank = RANKS[i + 1] || null;
      break;
    }
  }

  const expInCurrentRank = nextRank
    ? totalExp - currentRank.minExp
    : totalExp - currentRank.minExp;
  const expNeededForNext = nextRank
    ? nextRank.minExp - currentRank.minExp
    : 0;
  const progress = nextRank
    ? (expInCurrentRank / expNeededForNext) * 100
    : 100;

  return {
    currentRank,
    nextRank,
    expInCurrentRank,
    expNeededForNext,
    expToNext: nextRank ? nextRank.minExp - totalExp : 0,
    progress: Math.min(progress, 100),
  };
}

/** 토스트 데이터 타입 */
interface ExpToastData {
  id: string;
  amount: number;
  reason?: string;
  totalExp: number;
  isRankUp?: boolean;
  newRank?: string;
}

/** Context 타입 */
interface ExpToastContextType {
  showExpToast: (amount: number, reason?: string, totalExp?: number, isRankUp?: boolean, newRank?: string) => void;
}

const ExpToastContext = createContext<ExpToastContextType | null>(null);

/** ExpToast Provider */
export function ExpToastProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [toasts, setToasts] = useState<ExpToastData[]>([]);
  const [realtimeTotalExp, setRealtimeTotalExp] = useState<number>(0);

  // Firestore 실시간 구독으로 최신 totalExp 추적
  useEffect(() => {
    if (!user?.uid) {
      setRealtimeTotalExp(0);
      return;
    }

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setRealtimeTotalExp(data.totalExp || 0);
      }
    });

    return () => unsubscribe();
  }, [user?.uid]);

  const showExpToast = useCallback((
    amount: number,
    reason?: string,
    totalExp?: number,
    isRankUp?: boolean,
    newRank?: string
  ) => {
    const id = `${Date.now()}-${Math.random()}`;
    // totalExp가 전달되지 않으면 실시간 값 + 획득량 사용
    const expToShow = totalExp !== undefined ? totalExp : realtimeTotalExp + amount;
    setToasts(prev => [...prev, { id, amount, reason, totalExp: expToShow, isRankUp, newRank }]);

    // 자동 제거 (3초 후)
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, [realtimeTotalExp]);

  return (
    <ExpToastContext.Provider value={{ showExpToast }}>
      {children}
      <ExpToastContainer toasts={toasts} />
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

/** 개별 토스트 아이템 */
function ExpToastItem({ toast }: { toast: ExpToastData }) {
  const { theme } = useTheme();
  const rankInfo = getRankInfo(toast.totalExp);
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

      {/* 계급 승급 토스트 */}
      {toast.isRankUp ? (
        <motion.div
          initial={{ scale: 0.5 }}
          animate={{ scale: 1 }}
          className="px-6 py-4 shadow-lg"
          style={{
            backgroundColor: theme.colors.accent,
            border: '2px solid #1A1A1A',
          }}
        >
          {/* 장식 코너 */}
          <div className="absolute top-1 left-1 w-3 h-3 border-t-2 border-l-2 border-[#1A1A1A] opacity-50" />
          <div className="absolute top-1 right-1 w-3 h-3 border-t-2 border-r-2 border-[#1A1A1A] opacity-50" />
          <div className="absolute bottom-1 left-1 w-3 h-3 border-b-2 border-l-2 border-[#1A1A1A] opacity-50" />
          <div className="absolute bottom-1 right-1 w-3 h-3 border-b-2 border-r-2 border-[#1A1A1A] opacity-50" />

          <div className="text-center relative">
            <motion.div
              initial={{ rotate: -10 }}
              animate={{ rotate: [0, -5, 5, 0] }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-2xl mb-1"
            >
              ✦
            </motion.div>
            <p className="font-serif-display text-lg font-bold text-[#F5F0E8]">RANK UP!</p>
            <p className="font-serif-display text-sm font-bold text-[#F5F0E8] opacity-90">{toast.newRank}</p>
          </div>
        </motion.div>
      ) : (
        /* 일반 EXP 토스트 - 빈티지 신문 스타일 */
        <div
          className="relative px-5 py-3 shadow-lg min-w-[220px]"
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
              className="font-serif-display text-xl font-bold"
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

          {/* 프로그레스 바 */}
          {rankInfo.nextRank && (
            <div className="mt-2">
              <div className="flex justify-between text-xs mb-1">
                <span
                  className="font-serif-display"
                  style={{ color: theme.colors.accent }}
                >
                  {rankInfo.currentRank.name}
                </span>
                <span style={{ color: theme.colors.textSecondary }}>
                  {rankInfo.expInCurrentRank} / {rankInfo.expNeededForNext} XP
                </span>
              </div>
              <div
                className="h-2 overflow-hidden"
                style={{
                  backgroundColor: theme.colors.backgroundSecondary,
                  border: '1px solid #1A1A1A',
                }}
              >
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${rankInfo.progress}%` }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                  className="h-full"
                  style={{ backgroundColor: theme.colors.accent }}
                />
              </div>
            </div>
          )}

          {/* 최고 계급 도달 시 */}
          {!rankInfo.nextRank && (
            <p
              className="text-xs text-center mt-1  italic"
              style={{ color: theme.colors.accent }}
            >
              ✦ 최고 계급 달성 ✦
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}

export default ExpToastProvider;
