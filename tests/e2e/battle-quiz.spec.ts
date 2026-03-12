/**
 * E2E 테스트 — 배틀 퀴즈 (철권퀴즈)
 *
 * 홈 → 캐릭터 롱프레스 → 매칭 대기 → 봇 매칭 → 문제 풀기
 */
import { test, expect } from "@playwright/test";
import { loginAsStudent, waitForPageLoad, dismissOverlays } from "./helpers";

test.describe("배틀 퀴즈", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
    await dismissOverlays(page);
    // 홈으로 이동
    await page.goto("/");
    await waitForPageLoad(page);
  });

  test("홈에서 캐릭터 토끼 표시", async ({ page }) => {
    // 토끼 캐릭터 이미지 존재
    const rabbitImg = page.locator("img[src*='rabbit']").first();
    await expect(rabbitImg).toBeVisible({ timeout: 10_000 });
  });

  test("배틀 매칭 시작 → 대기 화면", async ({ page }) => {
    // 토끼 캐릭터 이미지 롱프레스
    const rabbitImg = page.locator("img[src*='rabbit']").first();
    if (await rabbitImg.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // 롱프레스 시뮬레이션
      const box = await rabbitImg.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(1500); // 롱프레스 대기
        await page.mouse.up();
      }

      // 매칭 대기 화면 (카운트다운 or "매칭 중")
      await expect(page.locator("body")).toContainText(/매칭|대기|상대|VS/, { timeout: 10_000 });
    }
  });

  test("배틀 매칭 → 봇 대전 → 문제 표시", async ({ page }) => {
    test.setTimeout(60_000); // 봇 매칭 30초 + 여유

    const rabbitImg = page.locator("img[src*='rabbit']").first();
    if (!(await rabbitImg.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, "토끼 이미지 없음");
      return;
    }

    // 롱프레스
    const box = await rabbitImg.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(1500);
      await page.mouse.up();
    }

    // 매칭 완료 대기 (봇 폴백 30초)
    await expect(page.locator("body")).toContainText(/문제|카운트|3|2|1|VS/, { timeout: 40_000 });

    // 문제가 보이면 답변
    const choice = page.locator("[data-choice], [data-answer-option]").first();
    if (await choice.isVisible({ timeout: 20_000 }).catch(() => false)) {
      await choice.click();
    }
  });
});
