/**
 * 토끼 표시 이름 계산
 *
 * - generationIndex === 1 → `${currentName}` (집사)
 * - generationIndex >= 2 → `${currentName}${generationIndex}세`
 * - currentName 없으면 `토끼 #${rabbitId}`
 */
export function computeRabbitDisplayName(
  currentName: string | null | undefined,
  generationIndex: number,
  rabbitId?: number
): string {
  const baseName = currentName || (rabbitId !== undefined ? `토끼 #${rabbitId}` : '이름없는 토끼');

  if (generationIndex === 1) {
    return baseName;
  }

  return `${baseName} ${generationIndex}세`;
}
