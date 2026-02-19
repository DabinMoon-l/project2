'use client';

import { motion } from 'framer-motion';
import type { DispersionMode } from '@/lib/hooks/useProfessorStats';

const OPTIONS: { value: DispersionMode; label: string; desc: string }[] = [
  { value: 'sd', label: 'SD', desc: '표준편차' },
  { value: 'cv', label: 'CV', desc: '변동계수' },
  { value: 'ci', label: 'CI', desc: '신뢰구간' },
];

interface Props {
  value: DispersionMode;
  onChange: (v: DispersionMode) => void;
}

export default function DispersionToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex bg-[#EBE5D9] border border-[#D4CFC4] p-0.5">
      {OPTIONS.map(o => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="relative px-3 py-1.5 text-xs font-bold transition-colors z-10"
            style={{ color: active ? '#F5F0E8' : '#5C5C5C' }}
            title={o.desc}
          >
            {active && (
              <motion.div
                layoutId="dispersion-bg"
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
