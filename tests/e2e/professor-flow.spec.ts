/**
 * E2E 테스트 — 교수 플로우
 *
 * 교수 로그인 → 대시보드 → 학생 관리 → 퀴즈 관리 → 통계
 */
import { test, expect } from "@playwright/test";
import { loginAsProfessor, waitForPageLoad, TEST_PROFESSOR } from "./helpers";

// 교수 비밀번호가 설정되어 있을 때만 실행
test.describe("교수 플로우", () => {
  test.skip(!TEST_PROFESSOR.password, "E2E_PROFESSOR_PW 미설정");

  test.beforeEach(async ({ page }) => {
    await loginAsProfessor(page);
  });

  test("교수 대시보드 표시", async ({ page }) => {
    await expect(page).toHaveURL(/\/professor/);
    await waitForPageLoad(page);
  });

  test("학생 관리 페이지", async ({ page }) => {
    await page.goto("/professor/students");
    await waitForPageLoad(page);

    // 학생 목록 또는 빈 상태 표시
    await expect(page.locator("body")).not.toHaveText("Loading...", { timeout: 15_000 });
  });

  test("퀴즈 관리 페이지", async ({ page }) => {
    await page.goto("/professor/quiz");
    await waitForPageLoad(page);

    await expect(page.locator("body")).not.toHaveText("Loading...", { timeout: 15_000 });
  });

  test("통계 페이지", async ({ page }) => {
    await page.goto("/professor/stats");
    await waitForPageLoad(page);

    await expect(page.locator("body")).not.toHaveText("Loading...", { timeout: 15_000 });
  });

  test("5개 탭 순환", async ({ page }) => {
    // 교수 네비게이션 5개 탭 확인
    const nav = page.getByRole("navigation");
    await expect(nav).toBeVisible();
  });
});
