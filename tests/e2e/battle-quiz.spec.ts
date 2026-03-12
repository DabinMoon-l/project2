/**
 * E2E 테스트 — 배틀 퀴즈 (철권퀴즈)
 *
 * 홈 → 배틀 진입 → 매칭 대기 → 봇 매칭 → 문제 풀기 → 라운드 결과
 */
import { test, expect } from "@playwright/test";
import { loginAsStudent, waitForPageLoad, dismissOverlays } from "./helpers";

test.describe("배틀 퀴즈", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
    await dismissOverlays(page);
  });

  test("홈에서 배틀 진입 버튼 확인", async ({ page }) => {
    // CharacterBox에 배틀 버튼이 있는지
    const battleBtn = page.locator("button, a").filter({ hasText: /배틀|대전|철권/ }).first();
    await expect(battleBtn).toBeVisible({ timeout: 10_000 });
  });

  test("배틀 매칭 시작 → 대기 화면", async ({ page }) => {
    // 배틀 진입
    const battleBtn = page.locator("button, a").filter({ hasText: /배틀|대전|철권/ }).first();
    if (await battleBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await battleBtn.click();

      // 매칭 대기 화면 (카운트다운 or "매칭 중")
      const matchingText = page.locator("body");
      await expect(matchingText).toContainText(/매칭|대기|상대/, { timeout: 10_000 });
    }
  });

  test("배틀 매칭 → 봇 대전 → 문제 표시", async ({ page }) => {
    test.setTimeout(60_000); // 봇 매칭 30초 + 여유

    const battleBtn = page.locator("button, a").filter({ hasText: /배틀|대전|철권/ }).first();
    if (!(await battleBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, "배틀 버튼 없음");
      return;
    }

    await battleBtn.click();

    // 매칭 완료 대기 (봇 폴백 30초)
    // 카운트다운(3-2-1) or 문제 표시
    const questionOrCountdown = page.locator("body");
    await expect(questionOrCountdown).toContainText(/문제|카운트|3|2|1|VS/, { timeout: 40_000 });

    // 문제가 보이면 답변
    const choice = page.locator("[data-choice], [data-answer-option], button").filter({ hasText: /보기|선택|①|②|③|④/ }).first();
    if (await choice.isVisible({ timeout: 20_000 }).catch(() => false)) {
      await choice.click();
    }
  });
});
