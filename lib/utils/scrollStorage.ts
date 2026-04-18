/**
 * 스크롤 위치 localStorage 저장 유틸
 *
 * iOS PWA eviction 후 cold reload에도 스크롤 위치가 유지되도록
 * sessionStorage 대신 localStorage 사용. 24시간 TTL.
 */

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface ScrollEntry {
  y: number;
  ts: number;
}

export function saveScroll(key: string, y: number): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: ScrollEntry = { y: Math.max(0, Math.round(y)), ts: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* quota / disabled */
  }
}

export function loadScroll(key: string, maxAgeMs: number = DEFAULT_MAX_AGE_MS): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    // 숫자만 저장된 legacy(sessionStorage 포맷) 폴백
    if (/^\d+$/.test(raw)) {
      return parseInt(raw, 10);
    }
    const entry = JSON.parse(raw) as ScrollEntry;
    if (!entry || typeof entry.y !== 'number') return null;
    if (Date.now() - (entry.ts || 0) > maxAgeMs) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.y;
  } catch {
    return null;
  }
}

export function clearScroll(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}
