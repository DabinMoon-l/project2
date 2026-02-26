/**
 * 수능 스타일 시험지 HTML 생성 유틸
 *
 * QuestionExportData[] → Playwright에서 PDF로 변환할 완전한 HTML 문자열 반환.
 * rabbitory_exam_template.html 디자인을 기반으로 2단 레이아웃.
 */

import type { QuestionExportData, PdfExportOptions } from './questionPdfExport';
import { CORNER_IMAGE_DATA_URI } from './cornerImageBase64';

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
  // 미설정 정답
  if (q.answer === '-1') return '-';

  if (q.type === 'ox') {
    return q.answer === '0' ? 'O' : 'X';
  }
  if (q.type === 'multiple') {
    // 0-indexed(AI 퀴즈) vs 1-indexed(수동 퀴즈) 구분
    const zeroIndexed = q.answerZeroIndexed === true;

    if (q.hasMultipleAnswers && q.answer.includes(',')) {
      return q.answer
        .split(',')
        .map((a) => {
          const idx = parseInt(a.trim(), 10);
          if (isNaN(idx) || idx < 0) return esc(a.trim());
          const symbolIdx = zeroIndexed ? idx : (idx > 0 ? idx - 1 : idx);
          return CHOICE_SYMBOLS[symbolIdx] || `(${idx})`;
        })
        .join(', ');
    }
    const idx = parseInt(q.answer, 10);
    if (!isNaN(idx) && idx >= 0) {
      const symbolIdx = zeroIndexed ? idx : (idx > 0 ? idx - 1 : idx);
      return CHOICE_SYMBOLS[symbolIdx] || `(${idx})`;
    }
    return esc(q.answer);
  }
  // 단답형 (answer가 존재하지만 빈 문자열일 수 있음)
  if (!q.answer) return '-';
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
// 복합 제시문(mixed) 렌더링 헬퍼
// ============================================================

/** mixed 타입 블록 배열 → HTML 내용 (passage div 안에 삽입) */
function renderMixedContent(blocks: any[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block) continue;
    switch (block.type) {
      case 'text':
        if (block.content?.trim()) {
          parts.push(`<div>${esc(block.content)}</div>`);
        }
        break;
      case 'labeled':
        if (block.items?.length) {
          for (const item of block.items) {
            if (item.content?.trim()) {
              parts.push(`<div class="bogi-item"><span class="bogi-lbl">${esc(item.label || '')}.</span> ${esc(item.content)}</div>`);
            }
          }
        }
        break;
      case 'image':
        if (block.imageUrl) {
          parts.push(`<div class="q-img"><img src="${esc(block.imageUrl)}" alt="[이미지]"></div>`);
        }
        break;
      case 'grouped':
        if (block.children?.length) {
          parts.push(renderMixedContent(block.children));
        }
        break;
    }
  }
  return parts.join('\n');
}

// ============================================================
// 공유 제시문 렌더링 (결합형 그룹 헤더)
// ============================================================

/** 결합형 첫 문제에서 공유 제시문/이미지를 렌더링 */
function renderCombinedHeader(firstQ: QuestionExportData): string {
  const parts: string[] = [];

  // 공통 발문 (commonQuestion)
  if (firstQ.passagePrompt) {
    parts.push(`<div style="font-size:10pt;font-weight:700;margin-bottom:6px;">${esc(firstQ.passagePrompt)}</div>`);
  }

  // 제시문 (text)
  if (firstQ.passage && firstQ.passageType !== 'korean_abc' && firstQ.passageType !== 'mixed') {
    parts.push(`<div class="passage">${esc(firstQ.passage)}</div>`);
  }

  // ㄱㄴㄷ 제시문
  if (firstQ.passageType === 'korean_abc' && firstQ.koreanAbcItems && firstQ.koreanAbcItems.length > 0) {
    parts.push('<div class="passage">');
    firstQ.koreanAbcItems.filter(i => i.trim()).forEach((item, idx) => {
      parts.push(`<div class="bogi-item"><span class="bogi-lbl">${KOREAN_LABELS[idx]}.</span> ${esc(item)}</div>`);
    });
    parts.push('</div>');
  }

  // 복합 제시문 (mixed)
  if (firstQ.passageType === 'mixed' && firstQ.passageMixedExamples && firstQ.passageMixedExamples.length > 0) {
    parts.push('<div class="passage">');
    parts.push(renderMixedContent(firstQ.passageMixedExamples));
    parts.push('</div>');
  }

  // 제시문 이미지
  if (firstQ.passageImage) {
    parts.push(`<div class="q-img"><img src="${esc(firstQ.passageImage)}" alt="[제시문 이미지]"></div>`);
  }

  return parts.join('\n');
}

// ============================================================
// 문제 HTML 렌더링
// ============================================================

/**
 * 개별 문제 렌더링
 * @param skipSharedPassage true이면 공유 제시문/passageImage/passagePrompt 건너뜀 (결합형 그룹에서 사용)
 */
function renderQuestion(q: QuestionExportData, num: number, skipSharedPassage = false): string {
  const parts: string[] = [];

  parts.push('<div class="q">');

  // 번호 + 문제 텍스트
  parts.push('<div class="q-head">');
  parts.push(`<span class="q-num">${num}.</span> `);
  parts.push(`<span class="q-txt">${esc(q.text)}</span>`);
  parts.push('</div>');

  if (!skipSharedPassage) {
    // 제시문 (text)
    if (q.passage && q.passageType !== 'korean_abc' && q.passageType !== 'mixed') {
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

    // 복합 제시문 (mixed)
    if (q.passageType === 'mixed' && q.passageMixedExamples && q.passageMixedExamples.length > 0) {
      parts.push('<div class="passage">');
      parts.push(renderMixedContent(q.passageMixedExamples));
      parts.push('</div>');
    }

    // 제시문 이미지
    if (q.passageImage) {
      parts.push(`<div class="q-img"><img src="${esc(q.passageImage)}" alt="[제시문 이미지]"></div>`);
    }
  }

  // 보기 박스 (개별 문제 고유)
  if (q.bogi && q.bogi.items && q.bogi.items.some(i => i.content?.trim())) {
    parts.push('<div class="bogi">');
    parts.push('<div class="bogi-title">&lt; 보 기 &gt;</div>');
    q.bogi.items.filter(i => i.content?.trim()).forEach((item) => {
      parts.push(`<div class="bogi-item"><span class="bogi-lbl">${esc(item.label)}.</span> ${esc(item.content)}</div>`);
    });
    parts.push('</div>');
  }

  // 발문 (결합형이 아닐 때만 — 결합형은 그룹 헤더에서 렌더링)
  if (!skipSharedPassage) {
    const prompt = q.passagePrompt || q.bogi?.questionText;
    if (prompt) {
      parts.push(`<div style="font-size:9.5pt;margin:4px 0 6px 0;">${esc(prompt)}</div>`);
    }
  } else {
    // 결합형 하위 문제에서는 bogi.questionText만 표시 (passagePrompt는 그룹 헤더)
    if (q.bogi?.questionText) {
      parts.push(`<div style="font-size:9.5pt;margin:4px 0 6px 0;">${esc(q.bogi.questionText)}</div>`);
    }
  }

  // 개별 문제의 복합 제시문 (mixedExamples)
  if (q.mixedExamples && q.mixedExamples.length > 0) {
    parts.push('<div class="passage">');
    parts.push(renderMixedContent(q.mixedExamples));
    parts.push('</div>');
  }

  // 이미지 (개별 문제 고유)
  if (q.imageUrl) {
    parts.push(`<div class="q-img"><img src="${esc(q.imageUrl)}" alt="[이미지]"></div>`);
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
    parts.push('<div class="ox-choices"><span class="ox-opt">O</span><span class="ox-opt">X</span></div>');
  }

  // 단답형 빈칸
  if (q.type === 'short_answer' || q.type === 'short') {
    parts.push('<div style="margin-top:8px;font-size:9.5pt;">정답: ________________________________</div>');
  }

  parts.push('</div>');
  return parts.join('\n');
}

// ============================================================
// 칼럼 내 문제 렌더링 (결합형 그룹핑 포함)
// ============================================================

/** 칼럼 내 문제 배열을 결합형 그룹 포함하여 렌더링 (문제 사이에 flex 스페이서 삽입) */
function renderColumnQuestions(html: string[], questions: QuestionExportData[], startNum: number): void {
  // 먼저 문제 블록을 모아서 사이에 스페이서를 넣음
  const blocks: string[] = [];
  let i = 0;
  while (i < questions.length) {
    const q = questions[i];
    if (q.combinedGroupId) {
      const gid = q.combinedGroupId;
      const groupStart = i;
      while (i < questions.length && questions[i].combinedGroupId === gid) {
        i++;
      }
      const groupQuestions = questions.slice(groupStart, i);
      const firstQ = groupQuestions[0];

      const parts: string[] = [];
      parts.push('<div class="combined-group">');
      parts.push(renderCombinedHeader(firstQ));
      groupQuestions.forEach((gq, idx) => {
        parts.push(renderQuestion(gq, startNum + groupStart + idx, true));
      });
      parts.push('</div>');
      blocks.push(parts.join('\n'));
    } else {
      blocks.push(renderQuestion(q, startNum + i));
      i++;
    }
  }

  // 문제 수에 따라 간격 전략 결정
  // 1-3개: flex 스페이서로 페이지 자연 분배
  // 4+개: 고정 간격, 남는 공간은 하단
  const useFlexSpacers = blocks.length <= 3;

  blocks.forEach((block, idx) => {
    html.push(block);
    if (idx < blocks.length - 1) {
      html.push(useFlexSpacers ? '<div class="q-spacer"></div>' : '<div class="q-gap"></div>');
    }
  });
}

// ============================================================
// 페이지 분할 (문제 → 2단 레이아웃)
// ============================================================

/** 결합형 그룹을 분리하지 않도록 문제를 2단으로 나눠 페이지 배열 반환 */
function splitIntoPages(questions: QuestionExportData[], questionsPerPage: number): Array<[QuestionExportData[], QuestionExportData[]]> {
  // 결합형 그룹을 분리하지 않도록 유닛 단위로 분할
  type Unit = { questions: QuestionExportData[]; weight: number };
  const units: Unit[] = [];
  let i = 0;
  while (i < questions.length) {
    const q = questions[i];
    if (q.combinedGroupId) {
      const gid = q.combinedGroupId;
      const start = i;
      while (i < questions.length && questions[i].combinedGroupId === gid) i++;
      const group = questions.slice(start, i);
      units.push({ questions: group, weight: group.length });
    } else {
      units.push({ questions: [q], weight: 1 });
      i++;
    }
  }

  const pages: Array<[QuestionExportData[], QuestionExportData[]]> = [];
  let unitIdx = 0;

  while (unitIdx < units.length) {
    const left: QuestionExportData[] = [];
    const right: QuestionExportData[] = [];
    let leftWeight = 0;
    let rightWeight = 0;
    const halfWeight = Math.ceil(questionsPerPage / 2);

    // 좌측 채우기
    while (unitIdx < units.length && leftWeight + units[unitIdx].weight <= halfWeight) {
      left.push(...units[unitIdx].questions);
      leftWeight += units[unitIdx].weight;
      unitIdx++;
    }
    // 좌측이 비었으면 최소 1유닛 강제 배치
    if (left.length === 0 && unitIdx < units.length) {
      left.push(...units[unitIdx].questions);
      leftWeight += units[unitIdx].weight;
      unitIdx++;
    }

    // 우측 채우기
    const rightMax = questionsPerPage - leftWeight;
    while (unitIdx < units.length && rightWeight + units[unitIdx].weight <= rightMax) {
      right.push(...units[unitIdx].questions);
      rightWeight += units[unitIdx].weight;
      unitIdx++;
    }

    pages.push([left, right]);
  }

  // 빈 페이지 방지
  if (pages.length === 0 && questions.length > 0) {
    const mid = Math.ceil(questions.length / 2);
    pages.push([questions.slice(0, mid), questions.slice(mid)]);
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
  .h-img-cell {
    display: table-cell;
    width: 200px;
    border-right: 2.5pt solid #000;
    padding: 6px 10px;
    vertical-align: middle;
    text-align: center;
  }
  .h-img-cell img {
    width: 100%;
    height: auto;
    object-fit: contain;
    display: block;
    margin: 0 auto;
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

  /* 2-COLUMN — flex 기반, 중앙선 고정, 하단 dead space 확보 */
  .col-wrap {
    position: relative;
    display: flex;
    gap: 0;
    /* 하단 dead space 30mm 확보 → 자연스러운 여백 */
    height: calc(297mm - 9mm - 14mm - 7mm - 30mm);
  }
  /* 첫 페이지는 헤더(~70px) + sep-thick(~10px) 추가 차감 */
  .col-wrap.has-header {
    height: calc(297mm - 9mm - 14mm - 7mm - 80px - 30mm);
  }
  /* 중앙선 — col-wrap + dead space 영역까지 (페이지 번호 위 8mm 여백) */
  .col-wrap::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: -22mm;
    left: 50%;
    border-left: 0.4pt solid #bbb;
  }

  /* 좌우 칼럼 */
  .col-left, .col-right {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    gap: 0;
  }
  .col-left {
    padding-right: 10px;
  }
  .col-right {
    padding-left: 10px;
  }

  /* 문제 적을 때(1-3): flex 균등 분배 */
  .q-spacer {
    flex: 1;
  }
  /* 문제 많을 때(4+): 고정 간격 */
  .q-gap {
    height: 14px;
    flex-shrink: 0;
  }

  /* QUESTION */
  .q {
    flex-shrink: 0;
  }

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

  /* 결합형 그룹 */
  .combined-group {
    border: 1.2pt solid #000;
    padding: 8px 6px 4px 6px;
    flex-shrink: 0;
  }
  .combined-group .q {
    padding-left: 6px;
    margin-top: 6px;
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

  /* OX 선지 (가운데 정렬) */
  .ox-choices {
    display: flex;
    justify-content: center;
    gap: 24px;
    margin: 10px 0 0 0;
  }
  .ox-opt {
    font-size: 14pt;
    font-weight: 900;
  }

  /* FOOTER */
  .pg-footer {
    position: absolute;
    bottom: 7mm;
    left: 0; right: 0;
    text-align: center;
    font-size: 9pt;
  }

  /* 정답 페이지 2단 (table 유지, 중앙선 없음) */
  .ans-col-layout {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .ans-col-layout > tbody > tr > td {
    width: 50%;
    vertical-align: top;
    padding: 0;
  }
  .ans-col-layout > tbody > tr > td:first-child {
    padding-right: 10px;
    border-right: 0.4pt solid #ddd;
  }
  .ans-col-layout > tbody > tr > td:last-child {
    padding-left: 10px;
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
  const brandName = options.courseName || 'RABBITORY';
  const questionsPerPage = 6; // 페이지당 문제 수 (조정 가능)
  const pages = splitIntoPages(questions, questionsPerPage);

  const html: string[] = [];

  html.push('<!DOCTYPE html>');
  html.push('<html lang="ko">');
  html.push('<head>');
  html.push('<meta charset="UTF-8">');
  html.push(`<title>${esc(brandName)} 시험지</title>`);
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
      html.push(`<div class="h-img-cell"><img src="${CORNER_IMAGE_DATA_URI}" alt=""></div>`);
      html.push(`<div class="h-brand-cell"><span class="brand">${esc(brandName)}</span></div>`);
      html.push('</div>');
      html.push('<div class="header-info">');
      html.push(`<div class="h-info-cell"><span class="label">성명</span><span class="value">${esc(options.userName || '')}</span></div>`);
      html.push(`<div class="h-info-cell"><span class="label">학번</span><span class="value">${esc(options.studentId || '')}</span></div>`);
      html.push('</div>');
      html.push('</div>');
      html.push('<hr class="sep-thick">');
    }

    // 2단 레이아웃 (flex 기반, 문제가 페이지를 꽉 채움)
    html.push(`<div class="col-wrap${pageIdx === 0 ? ' has-header' : ''}">`);

    // 좌측 칼럼
    html.push('<div class="col-left">');
    renderColumnQuestions(html, leftQ, globalNum);
    html.push('</div>');

    // 우측 칼럼
    html.push('<div class="col-right">');
    renderColumnQuestions(html, rightQ, globalNum + leftQ.length);
    html.push('</div>');

    html.push('</div>');

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
        html.push(`<div class="h-img-cell" style="border-right:2.5pt solid #000;"><img src="${CORNER_IMAGE_DATA_URI}" alt=""></div>`);
        html.push('<div class="ans-title-cell"><span class="ans-title">정답 및 해설</span></div>');
        html.push('</div>');
        html.push('<div class="ans-brand-row">');
        html.push(`<span class="brand" style="font-size:13pt;letter-spacing:2px;">${esc(brandName)}</span>`);
        html.push('</div>');
        html.push('</div>');
        html.push('<hr class="sep-thick">');
      }

      // 2단 레이아웃 (정답은 중앙선 없이 table 유지)
      html.push('<table class="ans-col-layout"><tr>');

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
