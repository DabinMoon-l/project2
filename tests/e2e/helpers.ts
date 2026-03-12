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

  // 홈 화면 로드 대기
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

  await page.waitForURL(/\/professor/, { timeout: 15_000 });
}

// ── 로딩 완료 대기 ──

export async function waitForPageLoad(page: Page) {
  await expect(page.getByText("Loading...")).toBeHidden({ timeout: 15_000 });
}

// ── 네비게이션 탭 클릭 ──

export async function navigateToTab(page: Page, tabName: string) {
  await page.getByRole("navigation").getByText(tabName).click();
  await waitForPageLoad(page);
}

// ── 모달/오버레이 닫기 (뜨면 닫기) ──

export async function dismissOverlays(page: Page) {
  // 마일스톤 모달이 떠있으면 닫기
  const closeBtn = page.locator("[data-modal-close], [aria-label='닫기']").first();
  if (await closeBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await closeBtn.click();
  }
}

// ── 퀴즈 선택지 클릭 (문제 유형 자동 감지) ──

export async function answerCurrentQuestion(page: Page) {
  // 객관식 선택지
  const choice = page.locator("[data-choice], [data-answer-option]").first();
  if (await choice.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await choice.click();
    return;
  }

  // OX 버튼
  const oxBtn = page.locator("button").filter({ hasText: /^O$|^X$/ }).first();
  if (await oxBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await oxBtn.click();
    return;
  }

  // 단답형 입력
  const input = page.locator("input[type='text'], textarea").first();
  if (await input.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await input.fill("정답");
  }
}
