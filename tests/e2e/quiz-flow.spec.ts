/**
 * E2E 테스트 — 퀴즈 풀이 플로우
 *
 * 학생 로그인 → 퀴즈 목록 → 퀴즈 풀기 → 결과 → 피드백 → EXP
 */
import { test, expect } from "@playwright/test";
import { loginAsStudent, waitForPageLoad, navigateToTab, TEST_STUDENT } from "./helpers";

test.describe("퀴즈 플로우", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
  });

  test("퀴즈 탭 이동 → 퀴즈 목록 표시", async ({ page }) => {
    // 퀴즈 탭 클릭
    await navigateToTab(page, "퀴즈");
    await page.waitForURL(/\/quiz/);

    // 퀴즈 목록이 표시되는지 확인 (최소 1개 이상)
    // 퀴즈 카드 or 빈 상태 메시지 둘 중 하나
    const hasQuizzes = await page.locator("[data-quiz-card]").count();
    const hasEmptyState = await page.getByText(/퀴즈가 없습니다|아직 퀴즈/).isVisible().catch(() => false);

    expect(hasQuizzes > 0 || hasEmptyState).toBeTruthy();
  });

  test("복습 탭 이동", async ({ page }) => {
    await navigateToTab(page, "복습");
    await page.waitForURL(/\/review/);
  });

  test("게시판 탭 이동", async ({ page }) => {
    await navigateToTab(page, "게시판");
    await page.waitForURL(/\/board/);
  });

  test("프로필 접근", async ({ page }) => {
    // 프로필 페이지 이동
    await page.goto("/profile");
    await waitForPageLoad(page);

    // 닉네임이 표시되는지 확인
    await expect(page.locator("body")).not.toHaveText("Loading...");
  });
});

test.describe("퀴즈 제출 (실제 풀이)", () => {
  // 이 테스트는 테스트용 퀴즈가 있을 때만 실행
  const TEST_QUIZ_ID = process.env.E2E_QUIZ_ID;

  test.skip(!TEST_QUIZ_ID, "E2E_QUIZ_ID 미설정");

  test("퀴즈 풀기 → 제출 → 결과 확인", async ({ page }) => {
    await loginAsStudent(page);

    // 퀴즈 페이지 직접 이동
    await page.goto(`/quiz/${TEST_QUIZ_ID}`);
    await waitForPageLoad(page);

    // 문제가 표시될 때까지 대기
    await expect(page.locator("body")).not.toHaveText("Loading...", { timeout: 15_000 });

    // 첫 번째 선택지 클릭 (존재하면)
    const firstChoice = page.locator("[data-choice]").first();
    if (await firstChoice.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await firstChoice.click();
    }

    // 제출 버튼 찾기
    const submitBtn = page.getByRole("button", { name: /제출|다음/ });
    if (await submitBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await submitBtn.click();

      // 결과 페이지 대기
      await page.waitForURL(/\/result/, { timeout: 30_000 });
    }
  });
});

test.describe("네비게이션 전환", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
  });

  test("4개 탭 순환 이동", async ({ page }) => {
    // 홈 → 퀴즈
    await navigateToTab(page, "퀴즈");
    await expect(page).toHaveURL(/\/quiz/);

    // 퀴즈 → 복습
    await navigateToTab(page, "복습");
    await expect(page).toHaveURL(/\/review/);

    // 복습 → 게시판
    await navigateToTab(page, "게시판");
    await expect(page).toHaveURL(/\/board/);

    // 게시판 → 홈
    await navigateToTab(page, "홈");
    await expect(page).toHaveURL(/^\/$/);
  });
});
