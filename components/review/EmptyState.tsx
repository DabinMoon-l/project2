'use client';

import { motion } from 'framer-motion';
import type { ReviewFilter } from './types';

/**
 * 빈 상태 컴포넌트
 */
export default function EmptyState({ filter, type, fullHeight = false }: { filter: ReviewFilter | 'solved'; type?: 'quiz' | 'question'; fullHeight?: boolean }) {
  const messages: Record<ReviewFilter | 'solved', { title: string; desc: string }> = {
    library: { title: '서재가 비어있습니다', desc: 'AI 퀴즈로 학습하면 여기에 저장돼요.' },
    wrong: { title: '오답이 없습니다', desc: '퀴즈를 풀면 틀린 문제가 자동으로 저장됩니다.' },
    bookmark: { title: '찜한 항목이 없습니다', desc: '퀴즈나 문제를 찜해보세요.' },
    custom: { title: '폴더가 없습니다', desc: '나만의 폴더를 만들어보세요.' },
    solved: { title: '푼 문제가 없습니다', desc: '퀴즈를 풀면 여기에 표시됩니다.' },
  };

  // 찜 탭에서 퀴즈/문제 구분
  if (filter === 'bookmark' && type) {
    if (type === 'quiz') {
      return (
        <div className="py-6 text-center">
          <p className="text-sm text-[#5C5C5C]">찜한 퀴즈가 없습니다</p>
        </div>
      );
    } else {
      return (
        <div className="py-6 text-center">
          <p className="text-sm text-[#5C5C5C]">찜한 문제가 없습니다</p>
        </div>
      );
    }
  }

  const { title, desc } = messages[filter];

  // 전체 높이 모드: 헤더와 네비게이션을 제외한 공간의 정중앙
  if (fullHeight) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-center text-center"
        style={{ height: 'calc(100vh - 340px - 100px)' }}
      >
        <div>
          <h3 className="font-serif-display text-xl font-black mb-2 text-[#1A1A1A]">
            {title}
          </h3>
          <p className="text-sm text-[#3A3A3A]">
            {desc}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="py-16 text-center"
    >
      <h3 className="font-serif-display text-xl font-black mb-2 text-[#1A1A1A]">
        {title}
      </h3>
      <p className="text-sm text-[#3A3A3A]">
        {desc}
      </p>
    </motion.div>
  );
}
