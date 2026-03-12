/**
 * E2E 테스트 공통 헬퍼
 */
import { type Page, expect } from "@playwright/test";

// ── 환경변수에서 테스트 계정 로드 ──

export const TEST_STUDENT = {
  id: process.env.E2E_STUDENT_ID || "11111111",
  password: process.env.E2E_STUDENT_PW || "sjsj1254",
};

export const TEST_STUDENT_BIO = {
  id: process.env.E2E_STUDENT_BIO_ID || "26030001",
  password: process.env.E2E_STUDENT_BIO_PW || "sjsj1254",
};

export const TEST_PROFESSOR = {
  email: process.env.E2E_PROFESSOR_EMAIL || "jkim@ccn.ac.kr",
  password: process.env.E2E_PROFESSOR_PW || "sjsj1254",
};

// ── 로그인 페이지 로딩 완료 대기 ──

export async function waitForLoginReady(page: Page) {
  // Firebase Auth 초기화 완료까지 "로딩 중..." 표시됨 → 사라질 때까지 대기
  await expect(page.getByText("로딩 중...")).toBeHidden({ timeout: 15_000 });
}

// ── 학생 로그인 ──

export async function loginAsStudent(page: Page, account = TEST_STUDENT) {
  await page.goto("/login");
  await waitForLoginReady(page);
  await page.getByPlaceholder("학번").fill(account.id);
  await page.getByPlaceholder("비밀번호").fill(account.password);
  await page.getByRole("button", { name: "로그인" }).click();

  // 로그인 후 메인 앱으로 이동 대기 (/login에서 벗어남)
  await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

// ── 교수 로그인 ──

export async function loginAsProfessor(page: Page) {
  if (!TEST_PROFESSOR.password) {
    throw new Error("E2E_PROFESSOR_PW 환경변수가 필요합니다.");
  }

  await page.goto("/login");
  await waitForLoginReady(page);
  await page.getByPlaceholder("학번").fill(TEST_PROFESSOR.email);
  await page.getByPlaceholder("비밀번호").fill(TEST_PROFESSOR.password);
  await page.getByRole("button", { name: "로그인" }).click();

  await page.waitForURL(/\/professor/, { timeout: 15_000 });
}

// ── 로딩 완료 대기 ──

export async function waitForPageLoad(page: Page) {
  // 한국어/영어 로딩 텍스트 모두 대기 (first()로 다중 요소 처리)
  await expect(page.getByText(/로딩 중\.\.\.|Loading\.\.\./).first()).toBeHidden({ timeout: 15_000 }).catch(() => {
    // 이미 사라졌거나 존재하지 않으면 무시
  });
}

// ── 페이지 직접 이동 (홈 오버레이 영향 없음) ──

const TAB_ROUTES: Record<string, string> = {
  "홈": "/",
  "퀴즈": "/quiz",
  "복습": "/review",
  "게시판": "/board",
};

export async function navigateToTab(page: Page, tabName: string) {
  const route = TAB_ROUTES[tabName];
  if (route) {
    await page.goto(route);
  } else {
    await page.goto(`/${tabName}`);
  }
  await waitForPageLoad(page);
}

// ── 네비게이션 탭 클릭 (실제 UI 클릭 테스트용) ──

export async function clickNavTab(page: Page, tabName: string) {
  const nav = page.getByRole("navigation");
  await expect(nav).toBeVisible({ timeout: 10_000 });
  await nav.getByText(tabName).click();
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
