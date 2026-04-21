/**
 * Safe area 디버깅 스크립트
 * iPhone 뷰포트로 각 페이지 스크린샷 + CSS 분석
 */
import { chromium } from 'playwright';

async function debug() {
  const browser = await chromium.launch({ headless: true });

  // iPhone 15 Pro 시뮬레이션
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  });

  const page = await context.newPage();

  // 로그인 페이지 → 하단 영역 확인
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tests/screenshots/login.png', fullPage: false });
  console.log('로그인 페이지 스크린샷 완료');

  // body/html 하단 CSS 분석
  const bottomCSS = await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const htmlStyle = getComputedStyle(html);
    const bodyStyle = getComputedStyle(body);

    return {
      htmlHeight: html.scrollHeight,
      htmlBg: htmlStyle.backgroundColor,
      bodyHeight: body.scrollHeight,
      bodyBg: bodyStyle.backgroundColor,
      viewportHeight: window.innerHeight,
      // safe area values
      safeAreaBottom: getComputedStyle(document.documentElement).getPropertyValue('--sab') ||
        'env not computed',
    };
  });
  console.log('CSS 분석:', JSON.stringify(bottomCSS, null, 2));

  // 모든 fixed 요소 확인
  const fixedElements = await page.evaluate(() => {
    const allElements = document.querySelectorAll('*');
    const fixed: Array<{tag: string, className: string, bottom: string, zIndex: string, height: number}> = [];
    allElements.forEach(el => {
      const style = getComputedStyle(el);
      if (style.position === 'fixed') {
        const rect = el.getBoundingClientRect();
        fixed.push({
          tag: el.tagName,
          className: (el.className || '').toString().slice(0, 80),
          bottom: style.bottom,
          zIndex: style.zIndex,
          height: rect.height,
        });
      }
    });
    return fixed;
  });
  console.log('Fixed 요소:', JSON.stringify(fixedElements, null, 2));

  await browser.close();
}

debug().catch(console.error);
