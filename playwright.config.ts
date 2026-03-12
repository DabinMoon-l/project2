import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E 테스트 설정
 *
 * 실행:
 *   npx playwright test                    # 모든 테스트
 *   npx playwright test tests/e2e/login    # 로그인만
 *   npx playwright test --ui               # UI 모드
 *   npx playwright test --headed           # 브라우저 표시
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  // 병렬 실행 비활성화 (Firebase 상태 공유 방지)
  fullyParallel: false,
  workers: 1,

  // 리포터
  reporter: [
    ["html", { outputFolder: "tests/e2e/report", open: "never" }],
    ["list"],
  ],

  // 기본 설정
  use: {
    // 기본 URL (dev 서버 또는 Vercel 프리뷰)
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  // 프로젝트: 모바일 뷰포트 (PWA)
  projects: [
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
      },
    },
    // 가로모드 (3패널 테스트용)
    {
      name: "desktop-landscape",
      use: {
        viewport: { width: 1280, height: 800 },
        isMobile: false,
      },
    },
  ],

  // dev 서버 자동 시작 (로컬 테스트 시)
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
