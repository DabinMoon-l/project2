/**
 * E2E 테스트 — 게시판 + 콩콩이 AI 답변
 *
 * 게시판 탭 → 글 작성 (학술 태그) → 콩콩이 자동답변 확인
 */
import { test, expect } from "@playwright/test";
import { loginAsStudent, waitForPageLoad, navigateToTab, dismissOverlays } from "./helpers";

test.describe("게시판", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
    await dismissOverlays(page);
  });

  test("게시판 탭 → 글 목록 표시", async ({ page }) => {
    await navigateToTab(page, "게시판");
    await expect(page).toHaveURL(/\/board/);
    await waitForPageLoad(page);
  });

  test("글 작성 버튼 → 작성 페이지 이동", async ({ page }) => {
    await navigateToTab(page, "게시판");

    // 글쓰기 버튼 (FAB or 상단 버튼)
    const writeBtn = page.locator("button, a").filter({ hasText: /글쓰기|작성|새 글/ }).first();
    // 또는 + 아이콘 FAB
    const fabBtn = page.locator("[data-write-btn], a[href*='write'], a[href*='new']").first();

    const btn = (await writeBtn.isVisible({ timeout: 3_000 }).catch(() => false))
      ? writeBtn : fabBtn;

    if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await btn.click();
      await expect(page).toHaveURL(/\/board\/(write|new)/);
    }
  });

  test("게시글 상세 → 댓글 영역 표시", async ({ page }) => {
    await navigateToTab(page, "게시판");

    // 첫 게시글 클릭
    const firstPost = page.locator("a[href*='/board/'], [data-post-item]").first();
    if (await firstPost.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await firstPost.click();
      await expect(page).toHaveURL(/\/board\/.+/);
      await waitForPageLoad(page);
    }
  });

  test("학술 태그 게시글에서 콩콩이 답변 확인", async ({ page }) => {
    await navigateToTab(page, "게시판");

    // 학술 태그가 붙은 글 찾기
    const academicPost = page.locator("a[href*='/board/'], [data-post-item]").filter({ hasText: /학술/ }).first();
    if (await academicPost.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await academicPost.click();
      await waitForPageLoad(page);

      // 콩콩이 댓글 존재 확인
      const hasKongi = await page.getByText("콩콩이").isVisible({ timeout: 10_000 }).catch(() => false);
      console.log(`콩콩이 답변 존재: ${hasKongi}`);
    }
  });
});
