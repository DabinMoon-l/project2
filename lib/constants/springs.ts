// 공용 스프링 애니메이션 상수

// 확장 스프링 (열기)
export const SPRING_EXPAND = { type: 'spring' as const, stiffness: 350, damping: 32 };
// 축소 스프링 (닫기 — 약간 더 빠름)
export const SPRING_COLLAPSE = { type: 'spring' as const, stiffness: 400, damping: 35 };
// 카드/버튼 탭 스프링
export const SPRING_TAP = { type: 'spring' as const, stiffness: 500, damping: 30 };
// 바텀시트 스프링
export const SPRING_SHEET = { type: 'spring' as const, stiffness: 300, damping: 28 };
// 탭 스케일 값
export const TAP_SCALE = { scale: 0.97 };
