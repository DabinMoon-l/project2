/**
 * 수능 스타일 시험지 HTML 생성 유틸
 *
 * QuestionExportData[] → Playwright에서 PDF로 변환할 완전한 HTML 문자열 반환.
 * rabbitory_exam_template.html 디자인을 기반으로 2단 레이아웃.
 */

import type { QuestionExportData, PdfExportOptions } from './questionPdfExport';

// ============================================================
// 상수
// ============================================================

const CHOICE_SYMBOLS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ'];

/** 선지 텍스트가 짧으면 inline, 길면 block */
const INLINE_CHOICE_MAX_LEN = 12;

// ============================================================
// 헬퍼
// ============================================================

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAnswer(q: QuestionExportData): string {
  if (!q.answer && q.answer !== '0') return '-';

  if (q.type === 'ox') {
    return q.answer === '0' ? 'O' : 'X';
  }
  if (q.type === 'multiple') {
    if (q.hasMultipleAnswers && q.answer.includes(',')) {
      return q.answer
        .split(',')
        .map((a) => {
          const idx = parseInt(a.trim(), 10);
          return isNaN(idx) ? esc(a.trim()) : (CHOICE_SYMBOLS[idx] || `(${idx + 1})`);
        })
        .join(', ');
    }
    const idx = parseInt(q.answer, 10);
    if (!isNaN(idx) && idx >= 0 && idx < CHOICE_SYMBOLS.length) {
      return CHOICE_SYMBOLS[idx];
    }
    return esc(q.answer);
  }
  // 단답형
  return esc(q.answer.replace(/\|\|\|/g, ', '));
}

function formatDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

// ============================================================
// 문제 HTML 렌더링
// ============================================================

function renderQuestion(q: QuestionExportData, num: number): string {
  const parts: string[] = [];

  parts.push('<div class="q">');

  // 번호 + 문제 텍스트
  parts.push('<div class="q-head">');
  parts.push(`<span class="q-num">${num}.</span> `);
  parts.push(`<span class="q-txt">${esc(q.text)}</span>`);
  parts.push('</div>');

  // 제시문 (text)
  if (q.passage && q.passageType !== 'korean_abc') {
    parts.push(`<div class="passage">${esc(q.passage)}</div>`);
  }

  // ㄱㄴㄷ 제시문
  if (q.passageType === 'korean_abc' && q.koreanAbcItems && q.koreanAbcItems.length > 0) {
    parts.push('<div class="passage">');
    q.koreanAbcItems.filter(i => i.trim()).forEach((item, idx) => {
      parts.push(`<div class="bogi-item"><span class="bogi-lbl">${KOREAN_LABELS[idx]}.</span> ${esc(item)}</div>`);
    });
    parts.push('</div>');
  }

  // 보기 박스
  if (q.bogi && q.bogi.items && q.bogi.items.some(i => i.content?.trim())) {
    parts.push('<div class="bogi">');
    parts.push('<div class="bogi-title">&lt; 보 기 &gt;</div>');
    q.bogi.items.filter(i => i.content?.trim()).forEach((item) => {
      parts.push(`<div class="bogi-item"><span class="bogi-lbl">${esc(item.label)}.</span> ${esc(item.content)}</div>`);
    });
    parts.push('</div>');
  }

  // 발문
  const prompt = q.passagePrompt || q.bogi?.questionText;
  if (prompt) {
    parts.push(`<div style="font-size:9.5pt;margin:4px 0 6px 0;">${esc(prompt)}</div>`);
  }

  // 이미지
  if (q.imageUrl) {
    parts.push(`<div class="q-img"><img src="${esc(q.imageUrl)}" alt=""></div>`);
  }

  // 선지 (객관식)
  if (q.type === 'multiple' && q.choices && q.choices.length > 0) {
    const allShort = q.choices.every(c => c.length <= INLINE_CHOICE_MAX_LEN);
    if (allShort) {
      parts.push('<div class="ch-inline">');
      q.choices.forEach((c, idx) => {
        parts.push(`<span class="ci"><span class="c-n">${CHOICE_SYMBOLS[idx]}</span> ${esc(c)}</span>`);
      });
      parts.push('</div>');
    } else {
      parts.push('<div class="ch-block">');
      q.choices.forEach((c, idx) => {
        parts.push(`<div class="cb"><span class="c-n">${CHOICE_SYMBOLS[idx]}</span> ${esc(c)}</div>`);
      });
      parts.push('</div>');
    }
  }

  // OX
  if (q.type === 'ox') {
    parts.push('<div class="ch-inline"><span class="ci" style="font-size:14pt;font-weight:900;">O</span><span class="ci" style="font-size:14pt;font-weight:900;">X</span></div>');
  }

  // 단답형 빈칸
  if (q.type === 'short_answer' || q.type === 'short') {
    parts.push('<div style="margin-top:8px;font-size:9.5pt;">정답: ________________________________</div>');
  }

  parts.push('</div>');
  return parts.join('\n');
}

// ============================================================
// 페이지 분할 (문제 → 2단 레이아웃)
// ============================================================

/** 문제를 2단으로 나눠 페이지 배열 반환 (각 페이지 = [좌측[], 우측[]]) */
function splitIntoPages(questions: QuestionExportData[], questionsPerPage: number): Array<[QuestionExportData[], QuestionExportData[]]> {
  const pages: Array<[QuestionExportData[], QuestionExportData[]]> = [];

  for (let i = 0; i < questions.length; i += questionsPerPage) {
    const pageQuestions = questions.slice(i, i + questionsPerPage);
    const mid = Math.ceil(pageQuestions.length / 2);
    pages.push([pageQuestions.slice(0, mid), pageQuestions.slice(mid)]);
  }

  return pages;
}

// ============================================================
// CSS (rabbitory_exam_template.html 기반)
// ============================================================

const EXAM_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: A4; margin: 0; }

  body {
    font-family: 'Noto Sans CJK KR', 'Malgun Gothic', sans-serif;
    font-size: 10pt;
    line-height: 1.6;
    color: #000;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    width: 210mm;
    height: 297mm;
    padding: 9mm 11mm 14mm 11mm;
    page-break-after: always;
    position: relative;
    overflow: hidden;
  }

  /* HEADER */
  .header {
    border: 2.5pt solid #000;
  }
  .header-top {
    display: table;
    width: 100%;
    border-bottom: 1.2pt solid #000;
  }
  .h-date-cell {
    display: table-cell;
    width: 88px;
    border-right: 2.5pt solid #000;
    padding: 6px 12px;
    vertical-align: middle;
    text-align: center;
    font-weight: 700;
    font-size: 10.5pt;
  }
  .h-brand-cell {
    display: table-cell;
    vertical-align: middle;
    text-align: center;
    padding: 7px 0;
  }
  .brand {
    font-family: 'Noto Serif CJK KR', 'Georgia', 'Times New Roman', serif;
    font-weight: 900;
    font-size: 30pt;
    letter-spacing: 5px;
  }
  .header-info {
    display: table;
    width: 100%;
  }
  .h-info-cell {
    display: table-cell;
    width: 50%;
    padding: 5px 12px;
    font-size: 9.5pt;
    vertical-align: middle;
  }
  .h-info-cell + .h-info-cell {
    border-left: 0.8pt solid #000;
  }
  .label { font-weight: 700; margin-right: 8px; }
  .value { font-weight: 400; color: #222; }

  .sep-thick {
    border: none;
    border-top: 2pt solid #000;
    margin: 0 0 8px 0;
  }

  /* 2-COLUMN TABLE */
  .col-layout {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .col-layout > tbody > tr > td {
    width: 50%;
    vertical-align: top;
    padding: 0;
  }
  .col-layout > tbody > tr > td:first-child {
    padding-right: 10px;
    border-right: 0.4pt solid #bbb;
  }
  .col-layout > tbody > tr > td:last-child {
    padding-left: 10px;
  }

  /* QUESTION */
  .q {
    margin-bottom: 18px;
    padding-bottom: 14px;
    border-bottom: 0.4pt solid #ccc;
  }
  .q:last-child { border-bottom: none; margin-bottom: 0; }

  .q-head {
    margin-bottom: 6px;
    line-height: 1.6;
  }
  .q-num {
    font-weight: 900;
    font-size: 11pt;
  }
  .q-txt {
    font-size: 10pt;
  }

  /* 제시문 */
  .passage {
    border: 0.8pt solid #000;
    padding: 8px 10px;
    margin: 8px 4px;
    font-size: 9.5pt;
    line-height: 1.65;
  }

  /* 보기 */
  .bogi {
    border: 0.8pt solid #000;
    padding: 6px 10px;
    margin: 8px 4px;
  }
  .bogi-title {
    text-align: center;
    font-size: 9pt;
    font-weight: 700;
    margin-bottom: 4px;
    letter-spacing: 6px;
  }
  .bogi-item {
    font-size: 9.5pt;
    line-height: 1.6;
    margin-bottom: 1px;
  }
  .bogi-lbl { font-weight: 600; }

  /* 이미지 */
  .q-img {
    text-align: center;
    margin: 6px 0;
  }
  .q-img img {
    max-width: 90%;
    max-height: 130px;
  }

  /* 선택지 inline */
  .ch-inline {
    margin: 10px 0 0 2px;
    font-size: 9.5pt;
    line-height: 1.8;
  }
  .ch-inline .ci {
    margin-right: 10px;
    white-space: nowrap;
  }

  /* 선택지 block */
  .ch-block {
    margin: 10px 0 0 2px;
  }
  .ch-block .cb {
    font-size: 9.5pt;
    line-height: 1.75;
  }
  .c-n { font-weight: 500; margin-right: 3px; }

  /* FOOTER */
  .pg-footer {
    position: absolute;
    bottom: 7mm;
    left: 0; right: 0;
    text-align: center;
    font-size: 9pt;
  }

  /* ANSWER PAGE */
  .ans-header {
    border: 2.5pt solid #000;
  }
  .ans-main {
    display: table;
    width: 100%;
    border-bottom: 1.2pt solid #000;
  }
  .ans-title-cell {
    display: table-cell;
    vertical-align: middle;
    text-align: center;
    padding: 6px 0;
  }
  .ans-title {
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-weight: 900;
    font-size: 28pt;
    letter-spacing: 4px;
  }
  .ans-brand-row {
    text-align: center;
    padding: 4px 0;
  }

  .ans-item {
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 0.3pt solid #ddd;
  }
  .ans-item:last-child { border-bottom: none; }

  .ans-num-line {
    font-weight: 900;
    font-size: 10.5pt;
    margin-bottom: 3px;
  }
  .ans-val {
    font-weight: 900;
    font-size: 11pt;
  }
  .ans-exp {
    font-size: 9.5pt;
    line-height: 1.7;
    color: #111;
    margin-left: 16px;
    margin-top: 4px;
    white-space: pre-wrap;
  }
`;

// ============================================================
// 메인 함수
// ============================================================

/**
 * 수능 스타일 시험지 HTML 생성
 * Playwright에서 PDF로 변환할 완전한 HTML 문자열을 반환합니다.
 */
export function generateExamHtml(
  questions: QuestionExportData[],
  options: PdfExportOptions & { date?: string }
): string {
  const date = options.date || formatDate();
  const questionsPerPage = 6; // 페이지당 문제 수 (조정 가능)
  const pages = splitIntoPages(questions, questionsPerPage);

  const html: string[] = [];

  html.push('<!DOCTYPE html>');
  html.push('<html lang="ko">');
  html.push('<head>');
  html.push('<meta charset="UTF-8">');
  html.push('<title>RABBITORY 시험지</title>');
  html.push(`<style>${EXAM_CSS}</style>`);
  html.push('</head>');
  html.push('<body>');

  // 문제 페이지들
  let globalNum = 1; // 전체 문제 번호
  pages.forEach(([ leftQ, rightQ ], pageIdx) => {
    html.push('<div class="page">');

    // 헤더 (첫 페이지만)
    if (pageIdx === 0) {
      html.push('<div class="header">');
      html.push('<div class="header-top">');
      html.push(`<div class="h-date-cell">${esc(date)}</div>`);
      html.push('<div class="h-brand-cell"><span class="brand">RABBITORY</span></div>');
      html.push('</div>');
      html.push('<div class="header-info">');
      html.push(`<div class="h-info-cell"><span class="label">성명</span><span class="value">${esc(options.userName || '')}</span></div>`);
      html.push(`<div class="h-info-cell"><span class="label">학번</span><span class="value">${esc(options.studentId || '')}</span></div>`);
      html.push('</div>');
      html.push('</div>');
      html.push('<hr class="sep-thick">');
    }

    // 2단 레이아웃
    html.push('<table class="col-layout"><tr>');

    // 좌측 칼럼
    html.push('<td>');
    const leftStartNum = globalNum;
    leftQ.forEach((q, idx) => {
      html.push(renderQuestion(q, leftStartNum + idx));
    });
    html.push('</td>');

    // 우측 칼럼
    html.push('<td>');
    const rightStartNum = leftStartNum + leftQ.length;
    rightQ.forEach((q, idx) => {
      html.push(renderQuestion(q, rightStartNum + idx));
    });
    html.push('</td>');

    html.push('</tr></table>');

    globalNum += leftQ.length + rightQ.length;

    // 페이지 번호
    html.push(`<div class="pg-footer">- ${pageIdx + 1} -</div>`);
    html.push('</div>');
  });

  // 정답/해설 페이지
  if (options.includeAnswers) {
    const answerPages = splitIntoPages(questions, 12); // 정답은 더 많이 넣을 수 있음
    let ansGlobalNum = 1;

    answerPages.forEach(([ leftQ, rightQ ], pageIdx) => {
      html.push('<div class="page">');

      // 정답 헤더 (첫 페이지만)
      if (pageIdx === 0) {
        html.push('<div class="ans-header">');
        html.push('<div class="ans-main">');
        html.push(`<div class="h-date-cell" style="border-right:2.5pt solid #000;">${esc(date)}</div>`);
        html.push('<div class="ans-title-cell"><span class="ans-title">정답 및 해설</span></div>');
        html.push('</div>');
        html.push('<div class="ans-brand-row">');
        html.push('<span class="brand" style="font-size:13pt;letter-spacing:2px;">RABBITORY</span>');
        html.push('</div>');
        html.push('</div>');
        html.push('<hr class="sep-thick">');
      }

      // 2단 레이아웃
      html.push('<table class="col-layout"><tr>');

      // 좌측
      html.push('<td>');
      const leftStart = ansGlobalNum;
      leftQ.forEach((q, idx) => {
        const num = leftStart + idx;
        html.push('<div class="ans-item">');
        html.push(`<div class="ans-num-line"><span>${num}.</span> <span class="ans-val">${formatAnswer(q)}</span></div>`);
        if (options.includeExplanations && q.explanation) {
          html.push(`<div class="ans-exp">${esc(q.explanation)}</div>`);
        }
        html.push('</div>');
      });
      html.push('</td>');

      // 우측
      html.push('<td>');
      const rightStart = leftStart + leftQ.length;
      rightQ.forEach((q, idx) => {
        const num = rightStart + idx;
        html.push('<div class="ans-item">');
        html.push(`<div class="ans-num-line"><span>${num}.</span> <span class="ans-val">${formatAnswer(q)}</span></div>`);
        if (options.includeExplanations && q.explanation) {
          html.push(`<div class="ans-exp">${esc(q.explanation)}</div>`);
        }
        html.push('</div>');
      });
      html.push('</td>');

      html.push('</tr></table>');

      ansGlobalNum += leftQ.length + rightQ.length;

      // 페이지 번호
      const totalQuestionPages = pages.length;
      html.push(`<div class="pg-footer">- ${totalQuestionPages + pageIdx + 1} -</div>`);
      html.push('</div>');
    });
  }

  html.push('</body>');
  html.push('</html>');

  return html.join('\n');
}
