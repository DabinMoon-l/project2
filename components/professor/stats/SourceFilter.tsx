'use client';

import { motion } from 'framer-motion';
import type { QuestionSource } from '@/lib/hooks/useProfessorStats';

const OPTIONS: { value: QuestionSource; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'professor', label: '교수님 퀴즈' },
  { value: 'custom', label: '학생 퀴즈' },
];

interface Props {
  value: QuestionSource;
  onChange: (v: QuestionSource) => void;
}

export default function SourceFilter({ value, onChange }: Props) {
  return (
    <div className="flex gap-4">
      {OPTIONS.map(o => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="relative pb-1.5 text-lg font-bold transition-colors"
            style={{ color: active ? '#1A1A1A' : '#5C5C5C' }}
          >
            {o.label}
            {active && (
              <motion.div
                layoutId="source-underline"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1A1A1A]"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
