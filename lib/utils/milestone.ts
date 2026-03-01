/**
 * 마일스톤 계산 유틸 (클라이언트)
 */

/** 미사용 마일스톤 수 계산 */
export function getPendingMilestones(totalExp: number, lastGachaExp: number): number {
  if (totalExp < 50) return 0;
  return Math.max(0, Math.floor(totalExp / 50) - Math.floor(lastGachaExp / 50));
}

/** EXP 바 표시 데이터 */
export function getExpBarDisplay(totalExp: number, lastGachaExp: number) {
  const pending = getPendingMilestones(totalExp, lastGachaExp);
  if (pending > 0) {
    // 오버플로우: 마일스톤 미사용 시 바 100% + "50/50 XP" 표시
    return { current: 50, max: 50, overflow: true, pendingCount: pending };
  }
  return { current: totalExp % 50, max: 50, overflow: false, pendingCount: 0 };
}
