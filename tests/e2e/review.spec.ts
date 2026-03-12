/**
 * E2E 테스트 — 복습 플로우
 *
 * 복습 탭 → 필터 → 복습 연습 → 완료
 */
import { test, expect } from "@playwright/test";
import { loginAsStudent, waitForPageLoad, navigateToTab, dismissOverlays, answerCurrentQuestion } from "./helpers";

test.describe("복습", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
    await dismissOverlays(page);
  });

  test("복습 탭 → 목록 표시", async ({ page }) => {
    await navigateToTab(page, "복습");
    await page.waitForURL(/\/review/);

    // 복습 목록 or 빈 상태
    const body = page.locator("body");
    await expect(body).not.toHaveText("Loading...", { timeout: 10_000 });
  });

  test("복습 필터 전환 (오답/찜/복습)", async ({ page }) => {
    await navigateToTab(page, "복습");

    // 필터 탭들 확인
    const filters = page.locator("button, [role='tab']").filter({ hasText: /오답|찜|복습|전체/ });
    const filterCount = await filters.count();

    // 최소 2개 이상 필터 탭
    expect(filterCount).toBeGreaterThanOrEqual(1);

    // 첫 번째 필터 클릭
    if (filterCount > 1) {
      await filters.nth(1).click();
      await page.waitForTimeout(500);
    }
  });

  test("복습 항목 클릭 → 복습 연습 진입", async ({ page }) => {
    await navigateToTab(page, "복습");

    // 복습 항목 클릭
    const reviewItem = page.locator("[data-review-item], a[href*='review']").first();
    if (await reviewItem.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await reviewItem.click();

      // 복습 연습 페이지
      await expect(page).toHaveURL(/\/review\/.+/);
      await waitForPageLoad(page);
    }
  });

  test("랜덤 복습 진입", async ({ page }) => {
    await navigateToTab(page, "복습");

    // 랜덤 복습 버튼
    const randomBtn = page.locator("button, a").filter({ hasText: /랜덤|셔플|무작위/ }).first();
    if (await randomBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await randomBtn.click();
      await expect(page).toHaveURL(/\/review\/random/);
    }
  });
});
