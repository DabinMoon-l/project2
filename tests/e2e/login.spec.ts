/**
 * E2E 테스트 — 로그인 플로우
 */
import { test, expect } from "@playwright/test";
import { TEST_STUDENT, TEST_PROFESSOR, waitForPageLoad } from "./helpers";

test.describe("학생 로그인", () => {
  test("학번 + 비밀번호로 로그인 → 홈 화면", async ({ page }) => {
    await page.goto("/login");

    // 로그인 폼 확인
    await expect(page.getByPlaceholder("학번")).toBeVisible();
    await expect(page.getByPlaceholder("비밀번호")).toBeVisible();
    await expect(page.getByRole("button", { name: "로그인" })).toBeVisible();

    // 학번 입력
    await page.getByPlaceholder("학번").fill(TEST_STUDENT.id);
    await page.getByPlaceholder("비밀번호").fill(TEST_STUDENT.password);
    await page.getByRole("button", { name: "로그인" }).click();

    // 홈 화면 리다이렉트 확인
    await page.waitForURL(/^\/$/, { timeout: 15_000 });
    await waitForPageLoad(page);
  });

  test("잘못된 비밀번호 → 에러 메시지", async ({ page }) => {
    await page.goto("/login");

    await page.getByPlaceholder("학번").fill(TEST_STUDENT.id);
    await page.getByPlaceholder("비밀번호").fill("wrong_password_123");
    await page.getByRole("button", { name: "로그인" }).click();

    // 에러 메시지 표시 확인
    await expect(page.locator(".bg-red-500\\/90")).toBeVisible({ timeout: 10_000 });
  });

  test("빈 입력 → 로그인 버튼 비활성화", async ({ page }) => {
    await page.goto("/login");

    const loginBtn = page.getByRole("button", { name: "로그인" });
    await expect(loginBtn).toBeDisabled();

    // 학번만 입력 → 여전히 비활성화
    await page.getByPlaceholder("학번").fill("12345678");
    await expect(loginBtn).toBeDisabled();
  });

  test("회원가입 링크 이동", async ({ page }) => {
    await page.goto("/login");
    await page.getByText("회원가입").click();
    await page.waitForURL(/\/signup/);
  });
});

test.describe("교수 로그인", () => {
  test.skip(!TEST_PROFESSOR.password, "E2E_PROFESSOR_PW 미설정");

  test("이메일로 로그인 → 교수 대시보드", async ({ page }) => {
    await page.goto("/login");

    await page.getByPlaceholder("학번").fill(TEST_PROFESSOR.email);
    await page.getByPlaceholder("비밀번호").fill(TEST_PROFESSOR.password);
    await page.getByRole("button", { name: "로그인" }).click();

    // 교수 대시보드 리다이렉트 확인
    await page.waitForURL(/\/professor/, { timeout: 15_000 });
    await waitForPageLoad(page);
  });
});
