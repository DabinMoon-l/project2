/**
 * 문제지 파서 V3
 *
 * 목표: OCR 결과를 "퀴즈 앱 문제 구조"로 변환
 *
 * 핵심 원칙:
 * 1. 문제 경계: 좌표 + 패턴 + 문맥 기반
 * 2. 선지 없으면 unknown (주관식 확정 금지)
 * 3. 지문(가)(나)(다) → passages (stem에 넣지 않음)
 * 4. <보기> ㄱ.ㄴ.ㄷ. → boxItems (stem에 넣지 않음)
 * 5. 이미지/표 → [IMAGE_REQUIRED] placeholder
 */

// ============================================================
// 타입 정의
// ============================================================

export interface ClovaField {
  inferText: string;
  inferConfidence: number;
  type: string;
  lineBreak: boolean;
  boundingPoly: {
    vertices: Array<{ x: number; y: number }>;
  };
}

interface Token {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  right: number;
  bottom: number;
}

interface LogicalLine {
  tokens: Token[];
  text: string;
  y: number;
  minX: number;
  maxX: number;
  column: 'left' | 'right' | 'single';
}

// ============================================================
// 출력 타입 (앱 구조에 맞춤)
// ============================================================

export interface PassageBlock {
  type: 'text' | 'labeled';
  content?: string;
  items?: Array<{ label: string; text: string }>;
}

export interface BoxItem {
  label: string;
  text: string;
}

export interface Choice {
  label: string;
  text: string;
}

export interface MediaPlaceholder {
  kind: 'image' | 'table' | 'graph';
  note: string;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface ParsedQuestionV3 {
  questionNumber: number | string;
  type: 'multipleChoice' | 'ox' | 'unknown';  // 주관식 없음, unknown 사용
  stem: string;
  passages: Record<string, string>;  // { "(가)": "...", "(나)": "..." }
  passageBlocks: PassageBlock[];     // 기존 호환용
  optionBoxText: string;
  boxItems: BoxItem[];
  choices: Choice[];
  mediaPlaceholders: MediaPlaceholder[];
  needsReview: boolean;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface ParseResultV3 {
  success: boolean;
  questions: ParsedQuestionV3[];
  debug: {
    totalTokens: number;
    totalLines: number;
    isTwoColumn: boolean;
    columnDividerX: number;
    pageWidth: number;
    pageHeight: number;
    questionsFound: number;
    leftColumnLines: number;
    rightColumnLines: number;
  };
}

// ============================================================
// 상수
// ============================================================

// 원문자
const CIRCLE_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

// ===== 선지 패턴 (줄 시작 기준) =====
// 1. 원문자: ①②③④⑤
const CHOICE_CIRCLE_PATTERN = /^([①②③④⑤⑥⑦⑧⑨⑩])\s*(.*)/;
// 2. 숫자 괄호: 1) 2) 3)
const CHOICE_PAREN_PATTERN = /^([1-9])\)\s*(.*)/;
// 3. 괄호 숫자: (1) (2) (3)
const CHOICE_BRACKET_PATTERN = /^\(([1-9])\)\s*(.*)/;
// 4. 한글 자음 + 구분자: ㄱ. ㄴ. ㄷ. (보기 아닌 경우 선지)
const CHOICE_KOREAN_PATTERN = /^([ㄱㄴㄷㄹㅁㅂㅅㅇ])[.\):\-]\s*(.*)/;
// 5. OCR 오인식 한글 자음: 7. L. 드. 그.
const CHOICE_OCR_KOREAN_PATTERN = /^([7Lr그드기己])[.\):\-]\s*(.*)/;

// 6. OCR이 ①→1로 인식한 경우: "1(a)" "1 (a)" "1(A)" 등
const CHOICE_OCR_NUMBER_PAREN = /^([1-5])\s*\(([a-eA-E])\)\s*(.*)/;
// 7. OCR이 ①→1로 인식 + 영어 대문자 시작: "1Dress" "1 Dress" (문제 번호가 아님!)
const CHOICE_OCR_NUMBER_ENGLISH = /^([1-5])\s*([A-Z][a-zA-Z].*)/;

// 한글 자음 정규화 맵
const KOREAN_LABEL_MAP: Record<string, string> = {
  'ㄱ': 'ㄱ', 'ㄴ': 'ㄴ', 'ㄷ': 'ㄷ', 'ㄹ': 'ㄹ',
  'ㅁ': 'ㅁ', 'ㅂ': 'ㅂ', 'ㅅ': 'ㅅ', 'ㅇ': 'ㅇ',
  '7': 'ㄱ', 'L': 'ㄴ', '드': 'ㄷ', '그': 'ㄱ',
  'r': 'ㄱ', '기': 'ㄱ', '己': 'ㄱ',
};

// 수능 스타일 한 줄 선지: "① ㄱ ② ㄴ ③ ㄱ,ㄴ" 또는 "1 ㄱ 2 ㄴ 3 ㄱ,ㄴ"
const CSAT_CHOICE_LINE_PATTERN = /[①②③④⑤1-5]\s*[ㄱㄴㄷㄹ그L7].*[①②③④⑤1-5]\s*[ㄱㄴㄷㄹ그L7]/;

// ===== 보기 패턴 (단어로만 찾음) =====
const BOX_KEYWORD_PATTERNS = [
  /<\s*보\s*기\s*>/,
  /【\s*보\s*기\s*】/,
  /\[\s*보\s*기\s*\]/,
  /보\s*기/,
];

// 제외 대상 (헤더/수험정보/페이지)
const EXCLUDE_PATTERNS = [
  /성명/,
  /수험\s*번호/,
  /선택/,
  /교시/,
  /^제\s*\d+/,
  /학년도/,
  /대학수학능력/,
  /과학탐구/,
  /문제지/,
  /페이지/,
  /^\d+\s*\/\s*\d+$/,
  /영역\s*\(/,
  /^\[\s*선택\s*\]/,
  /^[A-Z]\s*형$/i,
];

// 쓰레기 라인
const GARBAGE_PATTERNS = [
  /^[1-5\s,]+$/,           // 단독 번호열 "1 2 3 4 5"
  /^[□■○●◇◆\s]+$/,       // □ 반복
  /^[=\-_\.·\s]+$/,        // 구분선
  /^[\d\s]+$/,             // 숫자만
  /^.{0,2}$/,              // 2자 이하
];

// 문제 번호 패턴 (이게 왕!)
// N. 뒤에 공백 필수, 한글/괄호로 시작하는 경우만
const QUESTION_NUMBER_PATTERN = /^(\d{1,2})\.\s+/;
// 선지가 아닌지 확인용 (문제 시작은 한글/괄호로)
const QUESTION_START_PATTERN = /^[가-힣\[\(다음그림표]/;

// 지문 라벨 (가)(나)(다)
const PASSAGE_LABEL_PATTERN = /^\(([가나다라마바사아])\)\s*(.*)/;

// OX 패턴
const OX_PATTERNS = [
  /O\s*[\/,]\s*X/i,
  /옳으면\s*O/i,
  /[○×]/,
];

// ============================================================
// Stage 1: 토큰 정규화
// ============================================================

function normalizeTokens(fields: ClovaField[]): Token[] {
  return fields.map(field => {
    const vertices = field.boundingPoly?.vertices || [];
    const x = vertices[0]?.x || 0;
    const y = vertices[0]?.y || 0;
    const x2 = vertices[1]?.x || vertices[2]?.x || x;
    const y2 = vertices[2]?.y || vertices[3]?.y || y;

    return {
      text: field.inferText || '',
      x, y,
      width: Math.max(x2 - x, 1),
      height: Math.max(y2 - y, 1),
      centerX: (x + x2) / 2,
      centerY: (y + y2) / 2,
      right: x2,
      bottom: y2,
    };
  });
}

// ============================================================
// Stage 2: 2단 컬럼 분석
// ============================================================

interface ColumnInfo {
  isTwoColumn: boolean;
  columnDividerX: number;
  leftMinX: number;
  rightMinX: number;
  pageWidth: number;
  pageHeight: number;
  pageMinX: number;
}

function analyzeColumns(tokens: Token[]): ColumnInfo {
  if (tokens.length === 0) {
    return {
      isTwoColumn: false, columnDividerX: 0,
      leftMinX: 0, rightMinX: 0,
      pageWidth: 0, pageHeight: 0, pageMinX: 0,
    };
  }

  const pageMinX = Math.min(...tokens.map(t => t.x));
  const pageMaxX = Math.max(...tokens.map(t => t.right));
  const pageMaxY = Math.max(...tokens.map(t => t.bottom));
  const pageWidth = pageMaxX - pageMinX;

  // X좌표 히스토그램으로 valley 찾기
  const binSize = 20;
  const numBins = Math.ceil(pageWidth / binSize);
  const histogram = new Array(numBins).fill(0);

  for (const token of tokens) {
    const binIndex = Math.floor((token.centerX - pageMinX) / binSize);
    if (binIndex >= 0 && binIndex < numBins) histogram[binIndex]++;
  }

  // 중앙 30%~70%에서 valley 찾기
  const searchStart = Math.floor(numBins * 0.3);
  const searchEnd = Math.floor(numBins * 0.7);
  let minVal = Infinity, valleyBin = Math.floor(numBins / 2);

  for (let i = searchStart; i <= searchEnd; i++) {
    const avg = (histogram[i - 1] || 0) + histogram[i] + (histogram[i + 1] || 0);
    if (avg < minVal) { minVal = avg; valleyBin = i; }
  }

  const valleyX = pageMinX + (valleyBin + 0.5) * binSize;
  const leftTokens = tokens.filter(t => t.centerX < valleyX);
  const rightTokens = tokens.filter(t => t.centerX >= valleyX);

  // 2단 판정
  const isTwoColumn = leftTokens.length >= 30 && rightTokens.length >= 30 &&
    Math.min(leftTokens.length, rightTokens.length) / Math.max(leftTokens.length, rightTokens.length) > 0.4;

  const leftMinX = leftTokens.length > 0 ? Math.min(...leftTokens.map(t => t.x)) : pageMinX;
  const rightMinX = rightTokens.length > 0 ? Math.min(...rightTokens.map(t => t.x)) : valleyX;

  console.log(`[V3] ===== 컬럼 분석 =====`);
  console.log(`[V3] 페이지: ${pageWidth.toFixed(0)}x${pageMaxY.toFixed(0)}`);
  console.log(`[V3] 토큰: 좌=${leftTokens.length}, 우=${rightTokens.length}`);
  console.log(`[V3] 2단: ${isTwoColumn}, 분리선: x=${valleyX.toFixed(0)}`);
  console.log(`[V3] 컬럼 시작: 좌=${leftMinX.toFixed(0)}, 우=${rightMinX.toFixed(0)}`);

  return {
    isTwoColumn,
    columnDividerX: valleyX,
    leftMinX, rightMinX,
    pageWidth, pageHeight: pageMaxY, pageMinX,
  };
}

// ============================================================
// Stage 3: 라인 구성 (컬럼별 top→bottom, 좌→우)
// ============================================================

function buildLines(tokens: Token[], columnInfo: ColumnInfo): LogicalLine[] {
  const heights = tokens.map(t => t.height).filter(h => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 20;
  const yTol = Math.max(medianH * 0.5, 8);

  function buildForColumn(colTokens: Token[], column: 'left' | 'right' | 'single'): LogicalLine[] {
    if (colTokens.length === 0) return [];

    const sorted = [...colTokens].sort((a, b) => a.centerY - b.centerY);
    const lines: LogicalLine[] = [];
    let lineTokens: Token[] = [sorted[0]];
    let lineY = sorted[0].centerY;

    for (let i = 1; i < sorted.length; i++) {
      const t = sorted[i];
      if (Math.abs(t.centerY - lineY) <= yTol) {
        lineTokens.push(t);
      } else {
        lines.push(makeLine(lineTokens, column));
        lineTokens = [t];
        lineY = t.centerY;
      }
    }
    if (lineTokens.length > 0) lines.push(makeLine(lineTokens, column));
    return lines;
  }

  function makeLine(toks: Token[], column: 'left' | 'right' | 'single'): LogicalLine {
    const sorted = [...toks].sort((a, b) => a.x - b.x);
    let text = '';
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) {
        const gap = sorted[i].x - sorted[i - 1].right;
        const charW = sorted[i - 1].width / Math.max(sorted[i - 1].text.length, 1);
        if (gap > charW * 0.3) text += ' ';
      }
      text += sorted[i].text;
    }
    return {
      tokens: sorted,
      text: text.trim(),
      y: sorted.reduce((s, t) => s + t.centerY, 0) / sorted.length,
      minX: Math.min(...sorted.map(t => t.x)),
      maxX: Math.max(...sorted.map(t => t.right)),
      column,
    };
  }

  if (!columnInfo.isTwoColumn) {
    return buildForColumn(tokens, 'single');
  }

  const leftTokens = tokens.filter(t => t.centerX < columnInfo.columnDividerX);
  const rightTokens = tokens.filter(t => t.centerX >= columnInfo.columnDividerX);

  const leftLines = buildForColumn(leftTokens, 'left');
  const rightLines = buildForColumn(rightTokens, 'right');

  console.log(`[V3] 라인: 좌=${leftLines.length}, 우=${rightLines.length}`);

  // 좌측 먼저 → 우측
  return [...leftLines, ...rightLines];
}

// ============================================================
// Stage 4: 쓰레기/헤더 필터링
// ============================================================

function isGarbage(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  for (const p of GARBAGE_PATTERNS) if (p.test(t)) return true;
  if (t.length <= 3 && !/[가-힣]/.test(t)) return true;
  return false;
}

function isHeader(text: string): boolean {
  for (const p of EXCLUDE_PATTERNS) if (p.test(text)) return true;
  return false;
}

// ============================================================
// Stage 5: 문제 경계 탐지
// ============================================================

interface QuestionBoundary {
  number: number;
  lineIndex: number;
  line: LogicalLine;
}

function detectQuestionBoundaries(lines: LogicalLine[], columnInfo: ColumnInfo): QuestionBoundary[] {
  const boundaries: QuestionBoundary[] = [];

  console.log(`[V3] ===== 문제 탐지 (번호가 왕!) =====`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.text.trim();

    // 문제 번호 패턴: N. + 공백 으로 시작
    const match = text.match(QUESTION_NUMBER_PATTERN);
    if (!match) continue;

    const num = parseInt(match[1], 10);
    if (num < 1 || num > 50) continue;

    const afterNum = text.slice(match[0].length);

    // 필터 1: 헤더/수험정보 제외
    if (isHeader(text)) {
      console.log(`[V3] ${num}번 스킵: 헤더`);
      continue;
    }

    // 필터 2: 번호 뒤가 선지 패턴이면 제외 (1. (a) 같은 건 선지)
    if (startsWithChoice(afterNum)) {
      console.log(`[V3] ${num}번 스킵: 선지 패턴`);
      continue;
    }

    // 필터 3: 번호 뒤가 한글/괄호로 시작하지 않으면 제외
    if (afterNum.length > 0 && !QUESTION_START_PATTERN.test(afterNum)) {
      console.log(`[V3] ${num}번 스킵: 한글 시작 아님 "${afterNum.substring(0, 10)}..."`);
      continue;
    }

    // 중복 체크 - 같은 번호가 이미 있으면 스킵
    if (boundaries.some(b => b.number === num)) {
      console.log(`[V3] ${num}번 스킵: 중복`);
      continue;
    }

    boundaries.push({ number: num, lineIndex: i, line });
    console.log(`[V3] ${num}번 발견: line ${i}, col=${line.column}, text="${text.substring(0, 30)}..."`);
  }

  // 라인 인덱스 순서대로 정렬 (문제 번호가 아닌 등장 순서!)
  boundaries.sort((a, b) => a.lineIndex - b.lineIndex);
  console.log(`[V3] 문제 순서: [${boundaries.map(b => b.number).join(', ')}]`);

  return boundaries;
}

// ============================================================
// Stage 6: 문제 블록 추출 + 내용 파싱
// ============================================================

/**
 * 선지 패턴 체크 (줄 시작 기준)
 * 반환: { type, label, text } 또는 null
 */
function matchChoicePattern(text: string): { type: string; label: string; text: string } | null {
  // 1. 원문자: ①②③④⑤
  const circleMatch = text.match(CHOICE_CIRCLE_PATTERN);
  if (circleMatch) {
    return { type: 'circle', label: circleMatch[1], text: circleMatch[2].trim() };
  }

  // 2. 숫자 괄호: 1) 2)
  const parenMatch = text.match(CHOICE_PAREN_PATTERN);
  if (parenMatch) {
    const num = parseInt(parenMatch[1], 10);
    if (num >= 1 && num <= 10) {
      return { type: 'paren', label: CIRCLE_NUMBERS[num - 1], text: parenMatch[2].trim() };
    }
  }

  // 3. 괄호 숫자: (1) (2)
  const bracketMatch = text.match(CHOICE_BRACKET_PATTERN);
  if (bracketMatch) {
    const num = parseInt(bracketMatch[1], 10);
    if (num >= 1 && num <= 10) {
      return { type: 'bracket', label: CIRCLE_NUMBERS[num - 1], text: bracketMatch[2].trim() };
    }
  }

  // 4. OCR이 ①→1로 인식: "1(a)" "1 (a)"
  const ocrParenMatch = text.match(CHOICE_OCR_NUMBER_PAREN);
  if (ocrParenMatch) {
    const num = parseInt(ocrParenMatch[1], 10);
    const letter = ocrParenMatch[2].toLowerCase();
    const extra = ocrParenMatch[3]?.trim() || '';
    return { type: 'ocr_paren', label: CIRCLE_NUMBERS[num - 1], text: `(${letter})${extra ? ' ' + extra : ''}` };
  }

  // 5. OCR이 ①→1로 인식 + 영어 대문자: "1Dress" "1 Dress"
  const ocrEnglishMatch = text.match(CHOICE_OCR_NUMBER_ENGLISH);
  if (ocrEnglishMatch) {
    const num = parseInt(ocrEnglishMatch[1], 10);
    return { type: 'ocr_english', label: CIRCLE_NUMBERS[num - 1], text: ocrEnglishMatch[2].trim() };
  }

  return null;
}

/**
 * 텍스트가 선지로 시작하는지 확인 (문제 번호와 구분용)
 */
function startsWithChoice(text: string): boolean {
  if (matchChoicePattern(text)) return true;
  if (matchKoreanLabelPattern(text)) return true;
  if (CSAT_CHOICE_LINE_PATTERN.test(text)) return true;
  return false;
}

/**
 * 한글 자음 패턴 체크 (ㄱ. ㄴ. ㄷ. 등)
 * "보기"가 있으면 보기 항목, 없으면 선지
 */
function matchKoreanLabelPattern(text: string): { label: string; text: string } | null {
  // 정상 한글 자음
  const koreanMatch = text.match(CHOICE_KOREAN_PATTERN);
  if (koreanMatch) {
    return { label: koreanMatch[1], text: koreanMatch[2].trim() };
  }

  // OCR 오인식
  const ocrMatch = text.match(CHOICE_OCR_KOREAN_PATTERN);
  if (ocrMatch) {
    const mapped = KOREAN_LABEL_MAP[ocrMatch[1]] || ocrMatch[1];
    return { label: mapped, text: ocrMatch[2].trim() };
  }

  return null;
}

/**
 * "보기"라는 단어가 있는지 체크
 */
function hasBoxKeyword(text: string): boolean {
  return BOX_KEYWORD_PATTERNS.some(p => p.test(text));
}

/**
 * 수능 스타일 선지 파싱
 * "① ㄱ ② ㄴ ③ ㄱ,ㄴ" 또는 "1 ㄱ 2 ㄴ 3 ㄱ,ㄴ"
 */
function parseCsatChoiceLine(text: string): Choice[] {
  const choices: Choice[] = [];

  // OCR 오인식 정규화
  let normalized = text
    .replace(/그/g, 'ㄱ')
    .replace(/L/g, 'ㄴ')
    .replace(/드/g, 'ㄷ')
    .replace(/7(?=\s|,|$)/g, 'ㄱ')
    .replace(/□/g, '')
    .trim();

  // 원문자 → 숫자 변환
  for (let i = 0; i < CIRCLE_NUMBERS.length; i++) {
    normalized = normalized.replace(new RegExp(CIRCLE_NUMBERS[i], 'g'), `${i + 1}`);
  }

  // 패턴: 숫자 + (ㄱㄴㄷ 조합)
  const pattern = /([1-5])\s*([ㄱㄴㄷㄹ][,ㄱㄴㄷㄹ\s]*?)(?=\s*[1-5]|$)/g;
  let match;

  while ((match = pattern.exec(normalized)) !== null) {
    const num = parseInt(match[1], 10);
    const choiceText = match[2].replace(/[,\s]+$/g, '').trim();

    if (choiceText && num >= 1 && num <= 5) {
      if (!choices.some(c => c.label === CIRCLE_NUMBERS[num - 1])) {
        choices.push({ label: CIRCLE_NUMBERS[num - 1], text: choiceText });
      }
    }
  }

  return choices;
}

/**
 * 원문자 선지 파싱 (한 줄에 여러 개)
 */
function parseCircleChoicesInLine(text: string): Choice[] {
  const choices: Choice[] = [];
  const regex = /([①②③④⑤⑥⑦⑧⑨⑩])\s*([^①②③④⑤⑥⑦⑧⑨⑩]*)/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    choices.push({ label: m[1], text: m[2].trim() });
  }
  return choices;
}

function extractQuestionContent(
  lines: LogicalLine[],
  startIdx: number,
  endIdx: number,
  qNum: number
): {
  stem: string;
  passages: Record<string, string>;
  boxItems: BoxItem[];
  choices: Choice[];
} {
  const stemParts: string[] = [];
  const passages: Record<string, string> = {};
  const boxItems: BoxItem[] = [];
  const choices: Choice[] = [];

  let currentPassageLabel: string | null = null;
  let inChoiceSection = false;  // 선지 섹션
  let hasBoxKeywordFound = false;  // "보기"라는 단어가 있었는지
  let inBoxSection = false;  // 보기 섹션 내부

  // 1차 스캔: "보기"라는 단어가 있는지 확인
  for (let i = startIdx; i < endIdx; i++) {
    if (hasBoxKeyword(lines[i].text)) {
      hasBoxKeywordFound = true;
      break;
    }
  }

  console.log(`[V3] 문제 ${qNum}: 보기 키워드 ${hasBoxKeywordFound ? '있음' : '없음'}`);

  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i];
    let text = line.text.trim();

    // 첫 줄: 문제 번호 제거
    if (i === startIdx) {
      text = text.replace(QUESTION_NUMBER_PATTERN, '').trim();
      if (!text) continue;
    }

    // 쓰레기 스킵
    if (isGarbage(text)) continue;

    // ===== "보기" 키워드 발견 =====
    if (hasBoxKeyword(text)) {
      inBoxSection = true;
      inChoiceSection = false;
      // 이전 passage 저장
      if (currentPassageLabel) {
        passages[currentPassageLabel] = (passages[currentPassageLabel] || '').trim();
        currentPassageLabel = null;
      }
      continue;
    }

    // ===== 수능 스타일 선지: "① ㄱ ② ㄴ ③ ㄱ,ㄴ" =====
    if (CSAT_CHOICE_LINE_PATTERN.test(text)) {
      const csatChoices = parseCsatChoiceLine(text);
      if (csatChoices.length >= 2) {
        choices.push(...csatChoices);
        inChoiceSection = true;
        inBoxSection = false;
        continue;
      }
    }

    // ===== 선지 패턴 체크 (①, 1), (1) 등) =====
    const choiceMatch = matchChoicePattern(text);
    if (choiceMatch) {
      // 한 줄에 여러 원문자가 있으면 모두 파싱
      if (choiceMatch.type === 'circle' && text.match(/[①②③④⑤⑥⑦⑧⑨⑩].*[①②③④⑤⑥⑦⑧⑨⑩]/)) {
        choices.push(...parseCircleChoicesInLine(text));
      } else {
        choices.push({ label: choiceMatch.label, text: choiceMatch.text });
      }
      inChoiceSection = true;
      inBoxSection = false;
      continue;
    }

    // ===== 한글 자음 패턴 (ㄱ. ㄴ. ㄷ.) =====
    const koreanMatch = matchKoreanLabelPattern(text);
    if (koreanMatch) {
      if (hasBoxKeywordFound && inBoxSection) {
        // "보기"가 있고, 보기 섹션 내부 → 보기 항목
        boxItems.push({ label: koreanMatch.label, text: koreanMatch.text });
      } else {
        // "보기"가 없거나, 보기 섹션 아님 → 선지
        choices.push({ label: koreanMatch.label, text: koreanMatch.text });
        inChoiceSection = true;
        inBoxSection = false;
      }
      continue;
    }

    // ===== 지문 (가)(나)(다) =====
    const passageMatch = text.match(PASSAGE_LABEL_PATTERN);
    if (passageMatch && !inChoiceSection && !inBoxSection) {
      // 선지/보기 섹션이 아닐 때만 지문으로 인식
      if (currentPassageLabel) {
        passages[currentPassageLabel] = (passages[currentPassageLabel] || '').trim();
      }
      currentPassageLabel = `(${passageMatch[1]})`;
      passages[currentPassageLabel] = passageMatch[2].trim();
      continue;
    }

    // ===== 일반 텍스트 분류 =====
    if (inBoxSection) {
      // 보기 섹션 내 → 마지막 boxItem에 추가
      if (boxItems.length > 0) {
        boxItems[boxItems.length - 1].text += ' ' + text;
      }
    } else if (inChoiceSection) {
      // 선지 섹션 내 → 마지막 choice에 추가
      if (choices.length > 0) {
        choices[choices.length - 1].text += ' ' + text;
      }
    } else if (currentPassageLabel) {
      // 지문 섹션 내 → passages에 추가
      passages[currentPassageLabel] = (passages[currentPassageLabel] || '') + ' ' + text;
    } else {
      // stem
      stemParts.push(text);
    }
  }

  // 마지막 passage 정리
  if (currentPassageLabel) {
    passages[currentPassageLabel] = (passages[currentPassageLabel] || '').trim();
  }

  // boxItems/choices 정리
  for (const item of boxItems) {
    item.text = item.text.trim();
  }
  for (const choice of choices) {
    choice.text = choice.text.trim();
  }

  console.log(`[V3] 문제 ${qNum}: stem=${stemParts.length}줄, choices=${choices.length}, boxItems=${boxItems.length}`);

  return {
    stem: stemParts.join(' ').trim(),
    passages,
    boxItems,
    choices,
  };
}


// ============================================================
// Stage 7: 문제 유형 판정
// ============================================================

function determineType(content: { choices: Choice[] }, fullText: string): 'multipleChoice' | 'ox' | 'unknown' {
  // OX 체크
  for (const p of OX_PATTERNS) {
    if (p.test(fullText)) return 'ox';
  }

  // 선지 2개 이상 → 객관식
  if (content.choices.length >= 2) return 'multipleChoice';

  // 선지 없음 → unknown (주관식 확정 금지)
  return 'unknown';
}

// ============================================================
// 메인 함수
// ============================================================

export function parseQuestionsV3(fields: ClovaField[]): ParseResultV3 {
  console.log(`[V3] ========================================`);
  console.log(`[V3] 파싱 시작: ${fields.length}개 필드`);
  console.log(`[V3] ========================================`);

  // Stage 1: 토큰 정규화
  const tokens = normalizeTokens(fields);
  console.log(`[V3] 토큰: ${tokens.length}개`);

  // Stage 2: 컬럼 분석
  const columnInfo = analyzeColumns(tokens);

  // Stage 3: 라인 구성
  const lines = buildLines(tokens, columnInfo);
  console.log(`[V3] 라인: ${lines.length}줄`);

  // 디버그: 처음 10줄
  console.log(`[V3] ----- 처음 10줄 -----`);
  lines.slice(0, 10).forEach((l, i) => {
    console.log(`[V3] [${i}] col=${l.column} x=${l.minX.toFixed(0)}: "${l.text.substring(0, 40)}..."`);
  });

  // Stage 5: 문제 경계 탐지
  const boundaries = detectQuestionBoundaries(lines, columnInfo);

  // Stage 6-7: 문제별 내용 추출 및 유형 판정
  const questions: ParsedQuestionV3[] = [];

  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i];
    const startIdx = boundary.lineIndex;
    const endIdx = i + 1 < boundaries.length ? boundaries[i + 1].lineIndex : lines.length;

    const blockLines = lines.slice(startIdx, endIdx);
    const fullText = blockLines.map(l => l.text).join(' ');

    const content = extractQuestionContent(lines, startIdx, endIdx, boundary.number);
    const type = determineType(content, fullText);

    // bbox 계산
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    for (const line of blockLines) {
      for (const t of line.tokens) {
        minX = Math.min(minX, t.x);
        minY = Math.min(minY, t.y);
        maxX = Math.max(maxX, t.right);
        maxY = Math.max(maxY, t.bottom);
      }
    }
    if (!isFinite(minX)) minX = minY = maxX = maxY = 0;

    // passageBlocks 변환 (기존 호환)
    const passageBlocks: PassageBlock[] = [];
    const passageKeys = Object.keys(content.passages);
    if (passageKeys.length > 0) {
      passageBlocks.push({
        type: 'labeled',
        items: passageKeys.map(k => ({ label: k, text: content.passages[k] })),
      });
    }

    questions.push({
      questionNumber: boundary.number,
      type,
      stem: content.stem,
      passages: content.passages,
      passageBlocks,
      optionBoxText: '',
      boxItems: content.boxItems,
      choices: content.choices,
      mediaPlaceholders: [],
      needsReview: type === 'unknown',
      bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    });
  }

  // 결과 요약
  console.log(`[V3] ========================================`);
  console.log(`[V3] 파싱 완료: ${questions.length}개 문제`);
  console.log(`[V3] ========================================`);

  for (const q of questions) {
    const passageCount = Object.keys(q.passages).length;
    console.log(`[V3] ${q.questionNumber}번: type=${q.type}, choices=${q.choices.length}, boxItems=${q.boxItems.length}, passages=${passageCount}`);
    console.log(`[V3]   stem: "${q.stem.substring(0, 50)}${q.stem.length > 50 ? '...' : ''}"`);
  }

  const leftLines = lines.filter(l => l.column === 'left').length;
  const rightLines = lines.filter(l => l.column === 'right').length;

  return {
    success: questions.length > 0,
    questions,
    debug: {
      totalTokens: tokens.length,
      totalLines: lines.length,
      isTwoColumn: columnInfo.isTwoColumn,
      columnDividerX: columnInfo.columnDividerX,
      pageWidth: columnInfo.pageWidth,
      pageHeight: columnInfo.pageHeight,
      questionsFound: questions.length,
      leftColumnLines: leftLines,
      rightColumnLines: rightLines,
    },
  };
}
