'use client';

/**
 * 홈 화면 캐릭터 long press 힌트
 *
 * 미세한 펄스 애니메이션으로 꾹 누르기를 유도
 */

import { motion } from 'framer-motion';

export default function TekkenEntryHint() {
  return (
    <motion.div
      className="flex items-center gap-1.5 px-3 py-1 bg-black/30 border border-white/10 rounded-full backdrop-blur-xl"
      animate={{ opacity: [0.5, 1, 0.5] }}
      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
    >
      <svg className="w-4 h-4 text-white/80" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
      </svg>
      <span className="text-xs font-bold text-white/80">꾹 눌러서 배틀</span>
    </motion.div>
  );
}
