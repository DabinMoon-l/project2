/** 스탯 배지 (HP/ATK/DEF) — 빈 슬롯은 '-' 표시 */
export function StatBadge({ icon, value, color }: { icon: string; value: number | string; color: string }) {
  return (
    <div className="flex items-center gap-1 px-2.5 py-0.5 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl">
      {icon === 'heart' && (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill={color}>
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      )}
      {icon === 'attack' && (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill={color}>
          <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
        </svg>
      )}
      {icon === 'shield' && (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill={color}>
          <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
        </svg>
      )}
      <span className="text-white font-bold text-sm">{value}</span>
    </div>
  );
}
