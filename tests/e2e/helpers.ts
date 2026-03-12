/**
 * E2E 테스트 공통 헬퍼
 */
import { type Page, expect } from "@playwright/test";

// ── 환경변수에서 테스트 계정 로드 ──

export const TEST_STUDENT = {
  id: process.env.E2E_STUDENT_ID || "25010423",
  password: process.env.E2E_STUDENT_PW || "test1234",
};

export const TEST_PROFESSOR = {
  email: process.env.E2E_PROFESSOR_EMAIL || "jkim@ccn.ac.kr",
  password: process.env.E2E_PROFESSOR_PW || "",
};

// ── 학생 로그인 ──

export async function loginAsStudent(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("학번").fill(TEST_STUDENT.id);
  await page.getByPlaceholder("비밀번호").fill(TEST_STUDENT.password);
  await page.getByRole("button", { name: "로그인" }).click();

  // 홈 화면 로드 대기 (네비게이션 표시)
  await page.waitForURL(/^\/$/, { timeout: 15_000 });
}

// ── 교수 로그인 ──

export async function loginAsProfessor(page: Page) {
  if (!TEST_PROFESSOR.password) {
    throw new Error("E2E_PROFESSOR_PW 환경변수가 필요합니다.");
  }

  await page.goto("/login");
  await page.getByPlaceholder("학번").fill(TEST_PROFESSOR.email);
  await page.getByPlaceholder("비밀번호").fill(TEST_PROFESSOR.password);
  await page.getByRole("button", { name: "로그인" }).click();

  // 교수 대시보드 로드 대기
  await page.waitForURL(/\/professor/, { timeout: 15_000 });
}

// ── 로딩 완료 대기 ──

export async function waitForPageLoad(page: Page) {
  // Loading... 스피너가 사라질 때까지 대기
  await expect(page.getByText("Loading...")).toBeHidden({ timeout: 15_000 });
}

// ── 네비게이션 탭 클릭 ──

export async function navigateToTab(page: Page, tabName: string) {
  await page.getByRole("navigation").getByText(tabName).click();
  await waitForPageLoad(page);
}
