/**
 * 토끼 프로필 이미지 URL 생성
 *
 * @param rabbitId 토끼 ID (1~100)
 * @returns /rabbit_profile/rabbit-XXX-pf.png 경로
 */
export function getRabbitProfileUrl(rabbitId: number): string {
  const padded = String(rabbitId).padStart(3, '0');
  return `/rabbit_profile/rabbit-${padded}-pf.png`;
}
