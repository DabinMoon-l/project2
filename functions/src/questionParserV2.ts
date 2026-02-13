/**
 * 문제지 파서 V2
 *
 * Clova OCR 결과를 좌표 기반으로 파싱하여 문제 단위로 분리합니다.
 *
 * 핵심 원칙:
 * 1. 좌표 기반 레이아웃 파싱 (텍스트 단순 연결 금지)
 * 2. 2단 문서: 좌측 컬럼 전체 → 우측 컬럼 전체 순서
 * 3. 문제 경계: 라인 시작의 "숫자." 패턴만 인식
 * 4. 선지: 토큰 레벨에서 ①②③④⑤ 감지
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
  lineBreak: boolean;
  confidence: number;
}

interface LogicalLine {
  tokens: Token[];
  text: string;
  y: number;
  minX: number;
  maxX: number;
}

export interface BoxItem {
  kind: 'text' | 'labeled';
  title?: string;
  text?: string;
  items?: string[];
}

export interface SubQuestion {
  number: number;
  questionText: string;
  choices: string[];
  type: 'multipleChoice' | 'shortAnswer' | 'ox';
}

export interface ParsedQuestionV2 {
  questionNumber: number | string;
  type: 'multipleChoice' | 'shortAnswer' | 'ox' | 'combined';
  questionText: string;
  passage: string;
  boxes: BoxItem[];
  choices: string[];
  imageSlots: string[];
  subQuestions?: SubQuestion[];
}

export interface ParseResultV2 {
  success: boolean;
  questions: ParsedQuestionV2[];
  debug: {
    totalTokens: number;
    totalLines: number;
    isTwoColumn: boolean;
    pageWidth: number;
    pageHeight: number;
    choiceTokenCount: number;
  };
}

// ============================================================
// 상수
// ============================================================

// 원문자 (선지 마커) - 여러 형태 지원
const CIRCLE_NUMBER_PATTERN = /^[①②③④⑤⑥⑦⑧⑨⑩]/;

// 라인 내 원문자 존재 여부 (위치 무관)
const CIRCLE_NUMBER_IN_LINE = /[①②③④⑤⑥⑦⑧⑨⑩]/;

// 보기 내 한글 라벨
const KOREAN_BOX_PATTERN = /^[ㄱㄴㄷㄹㅁㅂㅅㅇ][.\)]/;

// 보기 시작
const BOX_START_PATTERN = /<\s*보\s*기\s*>|【\s*보\s*기\s*】|\[\s*보\s*기\s*\]|^보\s*기$/;

// OX 패턴
const OX_PATTERNS = [/O\s*[\/,]\s*X/i, /옳으면\s*O/i, /[○×]/];

// 선지 라인 패턴들 (라인 전체 분석용)
// "① ㄱ ② ㄴ ③ ㄱ,ㄴ ④ ㄴ,ㄷ ⑤ ㄱ,ㄴ,ㄷ" 형태
const MULTI_CHOICE_LINE_PATTERNS = [
  // 원문자가 2개 이상 있는 라인
  /[①②③④⑤].*[①②③④⑤]/,
  // "1 ㄱ 2 ㄴ" 형태 (Clova가 원문자를 숫자로 인식할 경우)
  /\d\s+[ㄱㄴㄷㄹ].*\d\s+[ㄱㄴㄷㄹ]/,
  // "(1) ㄱ (2) ㄴ" 형태
  /\(\d\)\s*[ㄱㄴㄷㄹ].*\(\d\)\s*[ㄱㄴㄷㄹ]/,
];

// 단일 선지 라인 패턴
const SINGLE_CHOICE_PATTERNS = [
  /^[①②③④⑤]\s+/,        // ① ...
  /^\(\d\)\s+/,            // (1) ...
  /^\d\)\s+/,              // 1) ...
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
      x,
      y,
      width: Math.max(x2 - x, 1),
      height: Math.max(y2 - y, 1),
      centerX: (x + x2) / 2,
      centerY: (y + y2) / 2,
      lineBreak: field.lineBreak || false,
      confidence: field.inferConfidence || 0,
    };
  });
}

// ============================================================
// Stage 2: 컬럼 분석 및 읽기 순서
// ============================================================

interface ColumnInfo {
  isTwoColumn: boolean;
  columnDivider: number;
  pageWidth: number;
  pageHeight: number;
}

function analyzeColumns(tokens: Token[]): ColumnInfo {
  if (tokens.length === 0) {
    return { isTwoColumn: false, columnDivider: 0, pageWidth: 0, pageHeight: 0 };
  }

  const allX = tokens.map(t => t.x);
  const allX2 = tokens.map(t => t.x + t.width);
  const allY2 = tokens.map(t => t.y + t.height);

  const minX = Math.min(...allX);
  const maxX = Math.max(...allX2);
  const maxY = Math.max(...allY2);
  const pageWidth = maxX - minX;

  // centerX 분포로 2단 판정
  const midPoint = minX + pageWidth / 2;
  const leftThreshold = minX + pageWidth * 0.35;
  const rightThreshold = minX + pageWidth * 0.65;

  const leftCount = tokens.filter(t => t.centerX < leftThreshold).length;
  const rightCount = tokens.filter(t => t.centerX > rightThreshold).length;
  const middleCount = tokens.filter(t => t.centerX >= leftThreshold && t.centerX <= rightThreshold).length;

  // 2단 조건: 좌/우 각 15개 이상, 중앙 30% 미만 (기준 완화)
  const isTwoColumn = leftCount >= 15 && rightCount >= 15 && middleCount < tokens.length * 0.3;

  console.log(`[V2] 컬럼: 좌=${leftCount}, 우=${rightCount}, 중앙=${middleCount}(${(middleCount/tokens.length*100).toFixed(1)}%), 2단=${isTwoColumn}`);

  return {
    isTwoColumn,
    columnDivider: midPoint,
    pageWidth,
    pageHeight: maxY,
  };
}

// ============================================================
// Stage 3: 라인 구성 (컬럼별로 분리 처리)
// ============================================================

function buildLinesForColumn(tokens: Token[]): LogicalLine[] {
  if (tokens.length === 0) return [];

  // 토큰 높이의 중앙값으로 적응형 Y_TOLERANCE 계산
  const heights = tokens.map(t => t.height).filter(h => h > 0).sort((a, b) => a - b);
  const medianHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 20;
  const Y_TOLERANCE = Math.max(medianHeight * 0.6, 8); // 높이의 60% 또는 최소 8px

  console.log(`[V2] 라인 빌드: 토큰수=${tokens.length}, 중앙높이=${medianHeight}, Y허용=${Y_TOLERANCE.toFixed(1)}`);

  // y좌표로 클러스터링 (토큰 순회 전 전체 분석)
  const yClusters: { y: number; tokens: Token[] }[] = [];

  for (const token of tokens) {
    // 기존 클러스터에 속하는지 확인
    let foundCluster = false;
    for (const cluster of yClusters) {
      if (Math.abs(token.centerY - cluster.y) <= Y_TOLERANCE) {
        cluster.tokens.push(token);
        // 클러스터 y값을 평균으로 업데이트
        cluster.y = cluster.tokens.reduce((s, t) => s + t.centerY, 0) / cluster.tokens.length;
        foundCluster = true;
        break;
      }
    }

    if (!foundCluster) {
      yClusters.push({ y: token.centerY, tokens: [token] });
    }
  }

  // 클러스터를 y좌표순으로 정렬
  yClusters.sort((a, b) => a.y - b.y);

  // 각 클러스터에서 라인 생성
  const lines: LogicalLine[] = [];
  for (const cluster of yClusters) {
    if (cluster.tokens.length > 0) {
      lines.push(createLineFromTokens(cluster.tokens));
    }
  }

  return lines;
}

function createLineFromTokens(tokens: Token[]): LogicalLine {
  // x좌표로 정렬
  const sorted = [...tokens].sort((a, b) => a.x - b.x);

  // 텍스트 조합 (간격 기반 공백)
  let text = '';
  for (let i = 0; i < sorted.length; i++) {
    const token = sorted[i];
    if (i > 0) {
      const prev = sorted[i - 1];
      const gap = token.x - (prev.x + prev.width);
      const avgCharWidth = prev.width / Math.max(prev.text.length, 1);
      // 간격이 문자 너비의 0.5배 이상이면 공백
      if (gap > avgCharWidth * 0.5) {
        text += ' ';
      }
    }
    text += token.text;
  }

  const avgY = sorted.reduce((s, t) => s + t.centerY, 0) / sorted.length;
  const minX = Math.min(...sorted.map(t => t.x));
  const maxX = Math.max(...sorted.map(t => t.x + t.width));

  return {
    tokens: sorted,
    text: text.trim(),
    y: avgY,
    minX,
    maxX,
  };
}

function buildAllLines(tokens: Token[], columnInfo: ColumnInfo): LogicalLine[] {
  let rawLines: LogicalLine[];

  if (!columnInfo.isTwoColumn) {
    rawLines = buildLinesForColumn(tokens);
  } else {
    // 2단: 좌측 컬럼 → 우측 컬럼
    const leftTokens = tokens.filter(t => t.centerX < columnInfo.columnDivider);
    const rightTokens = tokens.filter(t => t.centerX >= columnInfo.columnDivider);

    const leftLines = buildLinesForColumn(leftTokens);
    const rightLines = buildLinesForColumn(rightTokens);

    console.log(`[V2] 2단 라인: 좌측=${leftLines.length}, 우측=${rightLines.length}`);
    rawLines = [...leftLines, ...rightLines];
  }

  // 후처리: 한 줄에 여러 문제 번호가 있으면 분리
  const splitLines: LogicalLine[] = [];
  for (const line of rawLines) {
    const splitResult = splitLineByQuestionNumbers(line);
    splitLines.push(...splitResult);
  }

  return splitLines;
}

/**
 * 한 줄에 여러 문제 번호(1. 2. 3.)가 있으면 분리
 * "1.다음은... 4.다음은..." → ["1.다음은...", "4.다음은..."]
 */
function splitLineByQuestionNumbers(line: LogicalLine): LogicalLine[] {
  const text = line.text;

  // 문제 번호 패턴 위치 찾기 (라인 중간에 있는 것들)
  // "숫자." 다음에 한글이 오는 패턴
  const matches: { index: number; num: string }[] = [];
  const regex = /(\d{1,2})\.\s*[가-힣\(]/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    matches.push({ index: match.index, num: match[1] });
  }

  // 문제 번호가 2개 이상이면 분리
  if (matches.length >= 2) {
    console.log(`[V2] 라인 분리: "${text.substring(0, 50)}..." → ${matches.length}개 문제`);

    const result: LogicalLine[] = [];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const partText = text.substring(start, end).trim();

      if (partText) {
        result.push({
          tokens: [], // 토큰 분리는 복잡하므로 빈 배열
          text: partText,
          y: line.y,
          minX: line.minX,
          maxX: line.maxX,
        });
      }
    }

    return result.length > 0 ? result : [line];
  }

  return [line];
}

// ============================================================
// Stage 4: 문제 경계 탐지
// ============================================================

interface QuestionBoundary {
  number: string;
  isCombined: boolean;
  startLineIndex: number;
}

function detectQuestionBoundaries(lines: LogicalLine[]): QuestionBoundary[] {
  const boundaries: QuestionBoundary[] = [];

  // 문제 번호 뒤에 올 수 있는 패턴 (한글 시작 또는 특정 키워드)
  // "1. 다음은" "2. 그림은" 등
  const QUESTION_START_KEYWORDS = /^(다음|그림|표|자료|어떤|위|아래|\(가\)|\(나\)|그래프|실험)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.text.trim();

    // 라인 시작이 "숫자." 패턴인지 확인
    // 선지 패턴 제외: ①②③④⑤, 1), ㄱ.
    if (CIRCLE_NUMBER_PATTERN.test(text)) continue;
    if (/^\d\)\s*/.test(text)) continue;
    if (KOREAN_BOX_PATTERN.test(text)) continue;

    // 결합형: [18~19] 또는 18-19.
    const combinedMatch1 = text.match(/^\[(\d+)\s*[~\-]\s*(\d+)\]/);
    if (combinedMatch1) {
      boundaries.push({
        number: `${combinedMatch1[1]}-${combinedMatch1[2]}`,
        isCombined: true,
        startLineIndex: i,
      });
      continue;
    }

    const combinedMatch2 = text.match(/^(\d+)\s*[~\-]\s*(\d+)\./);
    if (combinedMatch2) {
      boundaries.push({
        number: `${combinedMatch2[1]}-${combinedMatch2[2]}`,
        isCombined: true,
        startLineIndex: i,
      });
      continue;
    }

    // 일반 문제: "1. 다음은..." 또는 "1.다음은..." 형태
    // "숫자." 다음에 공백은 선택적, 그 뒤에 한글이 와야 함
    const normalMatch = text.match(/^(\d{1,2})\.\s*(.+)/);
    if (normalMatch) {
      const num = parseInt(normalMatch[1], 10);
      const afterNumber = normalMatch[2];

      // 1~20 범위만 허용 (수능 기준)
      if (num < 1 || num > 20) continue;

      // 문제 번호 뒤의 텍스트 검증
      // 1) 한글로 시작해야 함 (숫자나 영문 제외)
      // 2) 또는 특정 문제 시작 키워드
      const startsWithKorean = /^[가-힣\(]/.test(afterNumber);
      const hasKeyword = QUESTION_START_KEYWORDS.test(afterNumber);

      if (startsWithKorean || hasKeyword) {
        // 중복 체크: 이미 같은 번호가 있으면 스킵
        if (boundaries.some(b => b.number === normalMatch[1])) {
          console.log(`[V2] 문제 ${normalMatch[1]} 중복 발견, 스킵: "${text.substring(0, 40)}..."`);
          continue;
        }

        boundaries.push({
          number: normalMatch[1],
          isCombined: false,
          startLineIndex: i,
        });
        console.log(`[V2] 문제 ${normalMatch[1]} 발견 at line ${i}: "${text.substring(0, 40)}..."`);
      }
    }
  }

  console.log(`[V2] 문제 경계: 총 ${boundaries.length}개 발견`);
  boundaries.forEach(b => console.log(`  - 문제 ${b.number} at line ${b.startLineIndex}`));

  return boundaries;
}

// ============================================================
// Stage 5: 문제 블록 추출 및 유형 판정
// ============================================================

interface QuestionBlock {
  number: string;
  isCombined: boolean;
  lines: LogicalLine[];
  allTokens: Token[];
}

function extractQuestionBlocks(lines: LogicalLine[], boundaries: QuestionBoundary[]): QuestionBlock[] {
  const blocks: QuestionBlock[] = [];

  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].startLineIndex;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].startLineIndex : lines.length;

    const blockLines = lines.slice(start, end);
    const allTokens = blockLines.flatMap(l => l.tokens);

    blocks.push({
      number: boundaries[i].number,
      isCombined: boundaries[i].isCombined,
      lines: blockLines,
      allTokens,
    });
  }

  return blocks;
}

function determineQuestionType(block: QuestionBlock): 'multipleChoice' | 'shortAnswer' | 'ox' | 'combined' {
  if (block.isCombined) return 'combined';

  const fullText = block.lines.map(l => l.text).join(' ');

  // OX 체크 (최우선)
  for (const pattern of OX_PATTERNS) {
    if (pattern.test(fullText)) {
      console.log(`[V2] 문제 ${block.number}: OX 패턴 발견`);
      return 'ox';
    }
  }

  // 선지 라인 체크 (라인 기반 분석)
  for (const line of block.lines) {
    const text = line.text.trim();

    // 원문자 선지 체크 (①②③④⑤)
    if (CIRCLE_NUMBER_IN_LINE.test(text)) {
      console.log(`[V2] 문제 ${block.number}: 원문자 선지 발견 - "${text.substring(0, 50)}"`);
      return 'multipleChoice';
    }

    // 다중 선지 라인 패턴 체크
    for (const pattern of MULTI_CHOICE_LINE_PATTERNS) {
      if (pattern.test(text)) {
        console.log(`[V2] 문제 ${block.number}: 다중 선지 패턴 발견 - "${text.substring(0, 50)}"`);
        return 'multipleChoice';
      }
    }

    // 단일 선지 패턴 체크
    for (const pattern of SINGLE_CHOICE_PATTERNS) {
      if (pattern.test(text)) {
        console.log(`[V2] 문제 ${block.number}: 단일 선지 패턴 발견 - "${text.substring(0, 50)}"`);
        return 'multipleChoice';
      }
    }
  }

  // 토큰 레벨 체크 (백업)
  const hasCircleChoice = block.allTokens.some(t => CIRCLE_NUMBER_PATTERN.test(t.text));
  if (hasCircleChoice) {
    console.log(`[V2] 문제 ${block.number}: 토큰에서 원문자 발견`);
    return 'multipleChoice';
  }

  // "고르시오", "것은?" 패턴 + <보기> 존재
  if (/고르[시는]|것은\?|옳[은지]/.test(fullText)) {
    const hasBox = BOX_START_PATTERN.test(fullText) || /<\s*보\s*기\s*>/.test(fullText);
    if (hasBox) {
      console.log(`[V2] 문제 ${block.number}: "고르시오" + <보기> 존재 → 객관식 추정`);
      return 'multipleChoice';
    }

    // "ㄱ, ㄴ, ㄷ" 형태의 보기 조합 존재
    if (/[ㄱㄴㄷ]\s*,\s*[ㄱㄴㄷ]/.test(fullText)) {
      console.log(`[V2] 문제 ${block.number}: "고르시오" + ㄱㄴㄷ 조합 → 객관식 추정`);
      return 'multipleChoice';
    }
  }

  console.log(`[V2] 문제 ${block.number}: 선지 미발견 → 주관식`);
  return 'shortAnswer';
}

// ============================================================
// Stage 6: 내용 분리 (passage, boxes, questionText, choices)
// ============================================================

interface ExtractedContent {
  questionText: string;
  passage: string;
  boxes: BoxItem[];
  choices: string[];
}

function extractContent(block: QuestionBlock): ExtractedContent {
  const result: ExtractedContent = {
    questionText: '',
    passage: '',
    boxes: [],
    choices: [],
  };

  // 첫 번째 라인에서 문제 번호 제거
  let firstLineText = block.lines[0]?.text || '';
  const numMatch = firstLineText.match(/^(\d{1,2})\.\s*/);
  if (numMatch) {
    firstLineText = firstLineText.slice(numMatch[0].length);
  }

  // 결합형 번호 제거
  const combinedMatch = firstLineText.match(/^\[?\d+\s*[~\-]\s*\d+\]?\s*/);
  if (combinedMatch) {
    firstLineText = firstLineText.slice(combinedMatch[0].length);
  }

  // 상태 기반 파싱
  type State = 'passage' | 'box' | 'question' | 'choices';
  let state: State = 'passage';

  const passageParts: string[] = [];
  const questionParts: string[] = [];
  let currentBoxItems: string[] = [];
  const choiceList: string[] = [];

  // 첫 라인 처리
  if (firstLineText) {
    passageParts.push(firstLineText);
  }

  // 나머지 라인 처리
  for (let i = 1; i < block.lines.length; i++) {
    const line = block.lines[i];
    const text = line.text.trim();

    if (!text) continue;

    // <보기> 시작
    if (BOX_START_PATTERN.test(text)) {
      state = 'box';
      currentBoxItems = [];
      continue;
    }

    // 한 줄에 여러 선지가 있는 패턴 체크 (① ㄱ ② ㄴ ③ ㄱ,ㄴ ④ ㄴ,ㄷ ⑤ ㄱ,ㄴ,ㄷ)
    if (CIRCLE_NUMBER_IN_LINE.test(text)) {
      // 보기 종료
      if (currentBoxItems.length > 0) {
        result.boxes.push({
          kind: 'labeled',
          title: '보기',
          items: [...currentBoxItems],
        });
        currentBoxItems = [];
      }

      // 선지 파싱: 원문자로 분리
      const choices = parseChoicesFromLine(text);
      if (choices.length > 0) {
        choiceList.push(...choices);
        state = 'choices';
        continue;
      }
    }

    // 대체 선지 패턴 (1 ㄱ 2 ㄴ 형태)
    if (/\d\s+[ㄱㄴㄷㄹ].*\d\s+[ㄱㄴㄷㄹ]/.test(text)) {
      if (currentBoxItems.length > 0) {
        result.boxes.push({
          kind: 'labeled',
          title: '보기',
          items: [...currentBoxItems],
        });
        currentBoxItems = [];
      }

      const choices = parseAltChoicesFromLine(text);
      if (choices.length > 0) {
        choiceList.push(...choices);
        state = 'choices';
        continue;
      }
    }

    // 단일 선지 시작 (①로 시작)
    const circleMatch = text.match(/^([①②③④⑤⑥⑦⑧⑨⑩])\s*(.*)/);
    if (circleMatch) {
      if (currentBoxItems.length > 0) {
        result.boxes.push({
          kind: 'labeled',
          title: '보기',
          items: [...currentBoxItems],
        });
        currentBoxItems = [];
      }
      choiceList.push(`${circleMatch[1]} ${circleMatch[2]}`.trim());
      state = 'choices';
      continue;
    }

    // 보기 내 ㄱ.ㄴ.ㄷ. 항목
    const boxItemMatch = text.match(/^([ㄱㄴㄷㄹㅁㅂㅅㅇ])[.\)]\s*(.*)/);
    if (boxItemMatch && (state === 'box' || currentBoxItems.length > 0)) {
      state = 'box';
      currentBoxItems.push(`${boxItemMatch[1]}. ${boxItemMatch[2]}`);
      continue;
    }

    // 질문 마무리 패턴
    if (/고르[시는]|것은\?|무엇인가|옳[은지]/.test(text)) {
      // 보기 종료
      if (currentBoxItems.length > 0) {
        result.boxes.push({
          kind: 'labeled',
          title: '보기',
          items: [...currentBoxItems],
        });
        currentBoxItems = [];
      }
      questionParts.push(text);
      state = 'question';
      continue;
    }

    // 상태별 텍스트 추가
    switch (state) {
      case 'passage':
        passageParts.push(text);
        break;
      case 'box':
        if (currentBoxItems.length > 0) {
          currentBoxItems[currentBoxItems.length - 1] += ' ' + text;
        } else {
          currentBoxItems.push(text);
        }
        break;
      case 'question':
        questionParts.push(text);
        break;
      case 'choices':
        // 선지 이후 추가 텍스트는 무시 (또는 마지막 선지에 추가)
        break;
    }
  }

  // 남은 보기 저장
  if (currentBoxItems.length > 0) {
    result.boxes.push({
      kind: 'labeled',
      title: '보기',
      items: [...currentBoxItems],
    });
  }

  // passage와 questionText 정리
  const allPassage = passageParts.join(' ').trim();
  const allQuestion = questionParts.join(' ').trim();

  if (allQuestion) {
    result.questionText = allQuestion;
    result.passage = allPassage;
  } else {
    // questionText가 없으면 passage에서 질문 패턴 추출
    const questionPattern = /([^.]*(?:고르[시는]|것은\?|무엇인가|옳[은지])[^.]*\.?\s*)$/;
    const lastSentence = allPassage.match(questionPattern);
    if (lastSentence) {
      result.questionText = lastSentence[1].trim();
      result.passage = allPassage.slice(0, -lastSentence[1].length).trim();
    } else {
      result.passage = allPassage;
    }
  }

  result.choices = choiceList;

  return result;
}

/**
 * 원문자 선지 라인 파싱
 * "① ㄱ ② ㄴ ③ ㄱ,ㄴ ④ ㄴ,ㄷ ⑤ ㄱ,ㄴ,ㄷ" → ["① ㄱ", "② ㄴ", ...]
 */
function parseChoicesFromLine(text: string): string[] {
  const choices: string[] = [];
  const regex = /([①②③④⑤⑥⑦⑧⑨⑩])\s*([^①②③④⑤⑥⑦⑧⑨⑩]*)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const choiceNum = match[1];
    const choiceContent = match[2].trim();
    if (choiceContent) {
      choices.push(`${choiceNum} ${choiceContent}`);
    }
  }

  return choices;
}

/**
 * 대체 선지 라인 파싱 (Clova가 ①을 1로 인식한 경우)
 * "1 ㄱ 2 ㄴ 3 ㄱ,ㄴ 4 ㄴ,ㄷ 5 ㄱ,ㄴ,ㄷ" → ["① ㄱ", "② ㄴ", ...]
 */
function parseAltChoicesFromLine(text: string): string[] {
  const choices: string[] = [];
  const circleNums = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

  // "숫자 내용" 패턴으로 분리
  const regex = /([1-5])\s+([ㄱㄴㄷㄹ][,ㄱㄴㄷㄹ\s]*?)(?=\s+[1-5]\s+|$)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    const content = match[2].trim();
    if (num >= 1 && num <= 5 && content) {
      choices.push(`${circleNums[num - 1]} ${content}`);
    }
  }

  return choices;
}

// ============================================================
// 메인 함수
// ============================================================

export function parseQuestionsV2(fields: ClovaField[]): ParseResultV2 {
  console.log(`[V2] ========== 파싱 시작 ==========`);
  console.log(`[V2] 입력 필드 수: ${fields.length}`);

  // Stage 1: 토큰 정규화
  const tokens = normalizeTokens(fields);

  // 선지 토큰 카운트 (여러 패턴)
  const choiceTokens = tokens.filter(t => CIRCLE_NUMBER_PATTERN.test(t.text));

  console.log(`[V2] 선지(①②③) 토큰 수: ${choiceTokens.length}`);

  if (choiceTokens.length > 0) {
    console.log(`[V2] 원문자 선지 샘플: ${choiceTokens.slice(0, 5).map(t => t.text).join(', ')}`);
  }

  // Stage 2: 컬럼 분석
  const columnInfo = analyzeColumns(tokens);

  // Stage 3: 라인 구성
  const lines = buildAllLines(tokens, columnInfo);
  console.log(`[V2] 총 라인 수: ${lines.length}`);

  // 디버그: 처음 20줄 (라인 텍스트 전체 확인)
  console.log(`[V2] ===== 처음 20줄 =====`);
  lines.slice(0, 20).forEach((l, i) => {
    console.log(`  [${i}] "${l.text}"`);
  });
  console.log(`[V2] ===== 라인 끝 =====`);

  // Stage 4: 문제 경계 탐지
  const boundaries = detectQuestionBoundaries(lines);

  // Stage 5: 문제 블록 추출
  const blocks = extractQuestionBlocks(lines, boundaries);

  // Stage 6: 각 블록 처리
  const questions: ParsedQuestionV2[] = blocks.map(block => {
    const type = determineQuestionType(block);
    const content = extractContent(block);

    return {
      questionNumber: block.isCombined ? block.number : parseInt(block.number, 10),
      type,
      questionText: content.questionText,
      passage: content.passage,
      boxes: content.boxes,
      choices: content.choices,
      imageSlots: [],
    };
  });

  console.log(`[V2] ========== 파싱 완료 ==========`);
  console.log(`[V2] 총 문제 수: ${questions.length}`);
  questions.forEach(q => {
    console.log(`[V2] 문제 ${q.questionNumber}: type=${q.type}, choices=${q.choices.length}, boxes=${q.boxes.length}`);
    console.log(`[V2]   passage: ${(q.passage || '').substring(0, 60)}...`);
    console.log(`[V2]   questionText: ${(q.questionText || '').substring(0, 60)}...`);
    if (q.choices.length > 0) {
      console.log(`[V2]   choices: ${q.choices.join(' | ')}`);
    }
    if (q.boxes.length > 0) {
      q.boxes.forEach((box, bi) => {
        console.log(`[V2]   box[${bi}]: kind=${box.kind}, items=${box.items?.length || 0}`);
      });
    }
  });

  return {
    success: questions.length > 0,
    questions,
    debug: {
      totalTokens: tokens.length,
      totalLines: lines.length,
      isTwoColumn: columnInfo.isTwoColumn,
      pageWidth: columnInfo.pageWidth,
      pageHeight: columnInfo.pageHeight,
      choiceTokenCount: choiceTokens.length,
    },
  };
}
