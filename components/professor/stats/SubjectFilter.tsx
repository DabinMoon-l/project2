'use client';

import { motion } from 'framer-motion';
import type { CourseId } from '@/lib/types/course';

const SUBJECTS: { id: CourseId; label: string; emoji: string }[] = [
  { id: 'biology', label: '생물학', emoji: '🧬' },
  { id: 'pathophysiology', label: '병태생리학', emoji: '🫀' },
  { id: 'microbiology', label: '미생물학', emoji: '🦠' },
];

interface Props {
  value: CourseId;
  onChange: (v: CourseId) => void;
}

export default function SubjectFilter({ value, onChange }: Props) {
  return (
    <div className="flex gap-2">
      {SUBJECTS.map(s => {
        const active = value === s.id;
        return (
          <motion.button
            key={s.id}
            onClick={() => onChange(s.id)}
            whileTap={{ scale: 0.96 }}
            className={`relative flex-1 px-3 py-2.5 text-sm font-bold transition-all duration-200 ${
              active
                ? 'bg-[#1A1A1A] text-[#F5F0E8] shadow-[3px_3px_0px_#1A1A1A]'
                : 'bg-[#FDFBF7] text-[#5C5C5C] border-2 border-[#D4CFC4] hover:border-[#1A1A1A] hover:text-[#1A1A1A]'
            }`}
          >
            <span className="block text-base mb-0.5">{s.emoji}</span>
            <span className="block text-[11px] leading-tight">{s.label}</span>
            {active && (
              <motion.div
                layoutId="subject-indicator"
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#1A1A1A] rotate-45"
              />
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
