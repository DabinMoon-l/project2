/**
 * 토끼 이미지 경로 유틸리티
 *
 * rabbitId (0~99) → public/rabbit/ 내 PNG 파일 경로 매핑
 * 수정중인 파일(-붙은 이름)은 별도 파일명 패턴 처리
 */

/** 수정중인 토끼 rabbitId 목록 (파일명에 - 추가된 것들, 파일번호 = rabbitId + 1) */
const EDITING_RABBIT_IDS = new Set<number>([]);

/**
 * rabbitId로 이미지 경로를 반환
 *
 * @param rabbitId 0~99
 * @returns `/rabbit/rabbit-001.png` 형식 경로, 수정중이면 `-` 포함 파일명
 */
export function getRabbitImageSrc(rabbitId: number): string {
  const paddedId = String(rabbitId + 1).padStart(3, '0');

  if (EDITING_RABBIT_IDS.has(rabbitId)) {
    return `/rabbit/rabbit-${paddedId}-.png`;
  }

  return `/rabbit/rabbit-${paddedId}.png`;
}

/**
 * 해당 토끼 이미지가 확정(수정 완료)된 상태인지 확인
 */
export function isRabbitImageFinalized(rabbitId: number): boolean {
  return !EDITING_RABBIT_IDS.has(rabbitId);
}
