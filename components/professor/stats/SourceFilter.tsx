'use client';

import { motion } from 'framer-motion';
import type { QuestionSource } from '@/lib/hooks/useProfessorStats';

const OPTIONS: { value: QuestionSource; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'professor', label: '교수' },
  { value: 'custom', label: '학생' },
  { value: 'ai-generated', label: 'AI' },
];

interface Props {
  value: QuestionSource;
  onChange: (v: QuestionSource) => void;
}

export default function SourceFilter({ value, onChange }: Props) {
  return (
    <div className="inline-flex bg-[#EBE5D9] border border-[#D4CFC4] p-0.5">
      {OPTIONS.map(o => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="relative px-3.5 py-1.5 text-xs font-bold transition-colors z-10"
            style={{ color: active ? '#F5F0E8' : '#5C5C5C' }}
          >
            {active && (
              <motion.div
                layoutId="source-bg"
                className="absolute inset-0 bg-[#1A1A1A]"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
