import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * isSupabaseDualWriteEnabled — Kill switch / 환경변수 분기 검증
 *
 * 운영 안전 불변식:
 *   1. URL 또는 SERVICE_ROLE_KEY 누락 시 false → 듀얼 라이트 자동 skip
 *   2. SUPABASE_DUAL_WRITE=false 명시 시 false → 장애 즉시 차단 (kill switch)
 *   3. 모두 정상이면 true
 *
 * 모듈 수준 캐시(getSupabaseAdmin._client)에 의존하지 않도록
 * 각 테스트마다 vi.resetModules() 로 상태 초기화.
 */

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // 깨끗한 환경변수에서 시작 (테스트 간 누수 방지)
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_DUAL_WRITE;
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function loadIsEnabled() {
  // 모듈 재로드 (process.env 변경 반영 + 내부 캐시 초기화)
  const mod = await import("./supabase");
  return mod.isSupabaseDualWriteEnabled;
}

describe("isSupabaseDualWriteEnabled — 환경변수 분기", () => {
  it("URL/KEY 모두 없으면 false", async () => {
    const fn = await loadIsEnabled();
    expect(fn()).toBe(false);
  });

  it("URL만 있으면 false (KEY 누락)", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    const fn = await loadIsEnabled();
    expect(fn()).toBe(false);
  });

  it("KEY만 있으면 false (URL 누락)", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sk-test";
    const fn = await loadIsEnabled();
    expect(fn()).toBe(false);
  });

  it("URL + KEY 모두 있으면 true", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sk-test";
    const fn = await loadIsEnabled();
    expect(fn()).toBe(true);
  });

  it("Kill switch: SUPABASE_DUAL_WRITE=false 면 URL/KEY 있어도 false", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sk-test";
    process.env.SUPABASE_DUAL_WRITE = "false";
    const fn = await loadIsEnabled();
    expect(fn()).toBe(false);
  });

  it("Kill switch는 정확히 'false' 문자열만 인식 (오타 안전)", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sk-test";
    process.env.SUPABASE_DUAL_WRITE = "FALSE"; // 대문자
    const fn = await loadIsEnabled();
    expect(fn()).toBe(true); // 'false' (lowercase) 만 차단
  });

  it("SUPABASE_DUAL_WRITE=true 는 명시적 활성 의도지만 URL/KEY 없으면 여전히 false", async () => {
    process.env.SUPABASE_DUAL_WRITE = "true";
    const fn = await loadIsEnabled();
    expect(fn()).toBe(false);
  });

  it("빈 문자열 URL은 누락과 동일 처리", async () => {
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sk-test";
    const fn = await loadIsEnabled();
    expect(fn()).toBe(false);
  });
});

describe("getSupabaseAdmin — 환경변수 누락 시 안전 폴백", () => {
  it("URL/KEY 없으면 null 반환 (throw 안 함)", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    expect(getSupabaseAdmin()).toBeNull();
  });

  it("같은 인스턴스 내에서 두 번 호출해도 일관된 null (캐시 동작)", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const a = getSupabaseAdmin();
    const b = getSupabaseAdmin();
    expect(a).toBe(b);
    expect(a).toBeNull();
  });
});
