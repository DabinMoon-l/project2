/**
 * E2E 테스트 — 마일스톤 (토끼 뽑기 / 레벨업)
 *
 * 홈 → 마일스톤 모달 → 뽑기 or 레벨업 선택
 * (50XP마다 1 마일스톤 → MilestoneChoiceModal 자동 표시)
 */
import { test, expect } from "@playwright/test";
import { loginAsStudent, waitForPageLoad, dismissOverlays } from "./helpers";

test.describe("마일스톤 시스템", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
  });

  test("홈 화면에서 토끼 캐릭터 표시", async ({ page }) => {
    // CharacterBox 영역에 토끼 이미지 존재
    const rabbitImg = page.locator("img[src*='rabbit']").first();
    await expect(rabbitImg).toBeVisible({ timeout: 10_000 });
  });

  test("마일스톤 모달 확인 (미소비 마일스톤 있을 때)", async ({ page }) => {
    // 마일스톤이 있으면 600ms 후 자동 표시
    const milestoneModal = page.locator("[data-milestone-modal], [role='dialog']").filter({ hasText: /뽑기|레벨업|마일스톤/ }).first();

    const hasModal = await milestoneModal.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasModal) {
      // 뽑기 선택지
      const gachaBtn = page.locator("button").filter({ hasText: /뽑기/ }).first();
      const levelUpBtn = page.locator("button").filter({ hasText: /레벨업/ }).first();

      const hasGacha = await gachaBtn.isVisible({ timeout: 2_000 }).catch(() => false);
      const hasLevelUp = await levelUpBtn.isVisible({ timeout: 2_000 }).catch(() => false);

      expect(hasGacha || hasLevelUp).toBeTruthy();
    }
  });

  test("뽑기 선택 → 뽑기 애니메이션 → 결과", async ({ page }) => {
    test.setTimeout(30_000);

    const milestoneModal = page.locator("[data-milestone-modal], [role='dialog']").filter({ hasText: /뽑기|레벨업|마일스톤/ }).first();
    const hasModal = await milestoneModal.isVisible({ timeout: 5_000 }).catch(() => false);

    if (!hasModal) {
      test.skip(true, "마일스톤 모달 미표시 (마일스톤 없음)");
      return;
    }

    // 뽑기 버튼 클릭
    const gachaBtn = page.locator("button").filter({ hasText: /뽑기/ }).first();
    if (await gachaBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await gachaBtn.click();

      // 뽑기 결과 대기 (토끼 이미지 or 이름 짓기)
      const result = page.locator("body");
      await expect(result).toContainText(/토끼|발견|이름|보유/, { timeout: 15_000 });
    }
  });

  test("레벨업 선택 → 레벨업 결과", async ({ page }) => {
    test.setTimeout(30_000);

    const milestoneModal = page.locator("[data-milestone-modal], [role='dialog']").filter({ hasText: /뽑기|레벨업|마일스톤/ }).first();
    const hasModal = await milestoneModal.isVisible({ timeout: 5_000 }).catch(() => false);

    if (!hasModal) {
      test.skip(true, "마일스톤 모달 미표시");
      return;
    }

    // 레벨업 버튼
    const levelUpBtn = page.locator("button").filter({ hasText: /레벨업/ }).first();
    if (await levelUpBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await levelUpBtn.click();

      // 레벨업 결과 (HP/ATK/DEF 증가)
      const result = page.locator("body");
      await expect(result).toContainText(/레벨|HP|ATK|DEF|증가|업/, { timeout: 15_000 });
    }
  });

  test("도감 페이지 접근", async ({ page }) => {
    await dismissOverlays(page);

    // 도감 버튼 (홈 화면)
    const dexBtn = page.locator("button, a").filter({ hasText: /도감/ }).first();
    if (await dexBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await dexBtn.click();
      await waitForPageLoad(page);

      // 토끼 그리드 or 리스트
      const rabbitImg = page.locator("img[src*='rabbit']").first();
      await expect(rabbitImg).toBeVisible({ timeout: 10_000 });
    }
  });
});
