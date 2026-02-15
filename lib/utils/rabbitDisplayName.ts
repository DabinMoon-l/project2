/**
 * 토끼 표시 이름 계산
 *
 * - discoveryOrder === 1 → `${name}` (최초 발견)
 * - discoveryOrder >= 2 → `${name} ${discoveryOrder}세`
 * - name 없으면 `토끼 #${rabbitId}`
 */
export function computeRabbitDisplayName(
  name: string | null | undefined,
  discoveryOrder: number,
  rabbitId?: number
): string {
  const baseName = name || '토끼';

  if (discoveryOrder === 1) {
    return baseName;
  }

  return `${baseName} ${discoveryOrder}세`;
}
