/**
 * 구독 키 생성 함수
 *
 * 고유한 키로 구독을 식별합니다.
 */

/** 사용자 프로필 구독 */
export function userProfile(uid: string): string {
  return `user:${uid}`;
}

/** 학기 설정 구독 */
export function semesterSettings(): string {
  return 'settings:semester';
}

/** 과목 레지스트리 구독 */
export function courseRegistry(): string {
  return 'courses:registry';
}

/** 랭킹 구독 */
export function ranking(courseId: string): string {
  return `ranking:${courseId}`;
}

/** 레이더 정규화 구독 */
export function radarNorm(courseId: string): string {
  return `radar:${courseId}`;
}

/** 리뷰 목록 구독 */
export function reviews(userId: string, courseId: string): string {
  return `reviews:${userId}:${courseId}`;
}

/** 게시글 목록 구독 */
export function posts(courseId: string): string {
  return `posts:${courseId}`;
}

/** 공지사항 구독 */
export function announcements(courseId: string): string {
  return `announcements:${courseId}`;
}

/** 토끼 보유 구독 */
export function rabbitHoldings(uid: string): string {
  return `rabbit:holdings:${uid}`;
}

/** 토끼 도감 구독 */
export function rabbitDogam(courseId: string): string {
  return `rabbit:dogam:${courseId}`;
}

/** 퀴즈 단건 구독 */
export function quiz(quizId: string): string {
  return `quiz:${quizId}`;
}

/** 배틀 구독 */
export function battle(battleId: string): string {
  return `battle:${battleId}`;
}

/** Job 구독 */
export function job(jobId: string): string {
  return `job:${jobId}`;
}
