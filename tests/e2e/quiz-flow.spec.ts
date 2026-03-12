/**
 * E2E 테스트 — 퀴즈 풀기 플로우
 *
 * 학생 로그인 → 퀴즈 탭 → 퀴즈 선택 → 문제 풀기 → 제출 → 결과 → 피드백 → EXP
 */
import { test, expect } from "@playwright/test";
import { loginAsStudent, waitForPageLoad, navigateToTab, answerCurrentQuestion, dismissOverlays } from "./helpers";

test.describe("퀴즈 풀기 (캐러셀 퀴즈)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
    await dismissOverlays(page);
  });

  test("퀴즈 탭 → 퀴즈 목록 표시", async ({ page }) => {
    await navigateToTab(page, "퀴즈");
    await expect(page).toHaveURL(/\/quiz/);

    // 퀴즈 카드가 있거나 빈 상태 메시지
    await waitForPageLoad(page);
  });

  test("퀴즈 카드 클릭 → 풀이 페이지 진입", async ({ page }) => {
    await navigateToTab(page, "퀴즈");

    // Start 버튼 클릭
    const startBtn = page.getByRole("button", { name: "Start" }).first();
    if (await startBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await startBtn.click();
      // 퀴즈 풀이 페이지
      await expect(page).toHaveURL(/\/quiz\/.+/);
    }
  });

  // 테스트 퀴즈 ID가 있으면 전체 플로우 테스트
  const TEST_QUIZ_ID = process.env.E2E_QUIZ_ID;

  test("퀴즈 전체 플로우: 풀기 → 제출 → 결과 → 피드백", async ({ page }) => {
    test.skip(!TEST_QUIZ_ID, "E2E_QUIZ_ID 미설정");

    // 퀴즈 페이지 직접 이동
    await page.goto(`/quiz/${TEST_QUIZ_ID}`);
    await waitForPageLoad(page);

    // 문제 답변 (최대 10문제 루프)
    for (let i = 0; i < 10; i++) {
      await answerCurrentQuestion(page);

      // 다음/제출 버튼
      const nextBtn = page.getByRole("button", { name: /다음|제출/ });
      if (await nextBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await nextBtn.click();
      }

      // 결과 페이지로 이동했으면 루프 종료
      if (page.url().includes("/result")) break;

      await page.waitForTimeout(500);
    }

    // 결과 페이지 도착 확인
    await page.waitForURL(/\/result/, { timeout: 30_000 });
    await expect(page.locator("body")).toContainText(/점|점수|결과/);

    // 피드백 페이지로 이동
    const feedbackBtn = page.getByRole("button", { name: /피드백|다음/ });
    if (await feedbackBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await feedbackBtn.click();
      await page.waitForURL(/\/feedback/, { timeout: 10_000 });
    }

    // EXP 페이지
    const expLink = page.getByRole("button", { name: /EXP|경험치|확인/ });
    if (await expLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expLink.click();
      await page.waitForURL(/\/exp/, { timeout: 10_000 });
    }
  });
});

test.describe("네비게이션", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
    await dismissOverlays(page);
  });

  test("4개 탭 순환: 홈 → 퀴즈 → 복습 → 게시판", async ({ page }) => {
    await navigateToTab(page, "퀴즈");
    await expect(page).toHaveURL(/\/quiz/);

    await navigateToTab(page, "복습");
    await expect(page).toHaveURL(/\/review/);

    await navigateToTab(page, "게시판");
    await expect(page).toHaveURL(/\/board/);
  });
});
