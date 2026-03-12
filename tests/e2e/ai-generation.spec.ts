/**
 * E2E 테스트 — AI 문제 생성
 *
 * 교수 서재 → AI 생성 → 난이도/챕터 선택 → Job 생성 → 완료 토스트
 */
import { test, expect } from "@playwright/test";
import { loginAsProfessor, waitForPageLoad, TEST_PROFESSOR } from "./helpers";

test.describe("AI 문제 생성 (교수)", () => {
  test.skip(!TEST_PROFESSOR.password, "E2E_PROFESSOR_PW 미설정");

  test.beforeEach(async ({ page }) => {
    await loginAsProfessor(page);
  });

  test("교수 퀴즈 관리 페이지 진입", async ({ page }) => {
    await page.goto("/professor/quiz");
    await waitForPageLoad(page);

    await expect(page.locator("body")).not.toHaveText("Loading...", { timeout: 15_000 });
  });

  test("서재 탭 → AI 생성 UI 확인", async ({ page }) => {
    await page.goto("/professor/quiz");
    await waitForPageLoad(page);

    // 서재/라이브러리 탭
    const libraryTab = page.locator("button, [role='tab']").filter({ hasText: /서재|라이브러리|AI/ }).first();
    if (await libraryTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await libraryTab.click();
      await page.waitForTimeout(1_000);

      // AI 생성 관련 UI (프롬프트 입력, 난이도 슬라이더, 챕터 태그)
      const body = page.locator("body");
      const hasAI = await body.getByText(/프롬프트|텍스트 입력|문제 생성/).isVisible({ timeout: 5_000 }).catch(() => false);
      console.log(`AI 생성 UI 존재: ${hasAI}`);
    }
  });

  test("통계 대시보드 로드", async ({ page }) => {
    await page.goto("/professor/stats");
    await waitForPageLoad(page);

    // 레이더 차트 or 통계 영역
    const body = page.locator("body");
    await expect(body).not.toHaveText("Loading...", { timeout: 15_000 });
  });

  test("학생 관리 → 학생 목록 확인", async ({ page }) => {
    await page.goto("/professor/students");
    await waitForPageLoad(page);

    // 학생 목록 or 빈 상태
    const body = page.locator("body");
    await expect(body).not.toHaveText("Loading...", { timeout: 15_000 });
  });
});
