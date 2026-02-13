/**
 * 문제지 파싱 모듈
 *
 * Clova OCR 결과(텍스트+좌표)를 받아서 문제 단위로 분리합니다.
 *
 * 주요 기능:
 * 1. 2단 문서 처리 + 읽기 순서 복원
 * 2. 문제 시작/끝 세그먼테이션
 * 3. 선지 파싱 (①②③, 1)2)3), ㄱㄴㄷ, 가나다)
 * 4. <보기> 파싱
 * 5. 결합형 [18-19] 처리
 */

// ============================================================
// 타입 정의
// ============================================================

/**
 * OCR 필드 (Clova OCR 응답의 각 텍스트 블록)
 */
export interface OcrField {
  inferText: string;
  inferConfidence: number;
  lineBreak: boolean;
  boundingPoly: {
    vertices: Array<{ x: number; y: number }>;
  };
}

/**
 * 좌표가 추가된 OCR 필드
 */
interface FieldWithCoords extends OcrField {
  _x: number; // 좌측 상단 x
  _y: number; // 좌측 상단 y
  _centerX: number;
  _centerY: number;
  _width: number;
  _height: number;
}

/**
 * 라인 (같은 y좌표의 필드들을 묶은 것)
 */
interface TextLine {
  text: string;
  y: number; // 라인의 평균 y좌표
  fields: FieldWithCoords[];
}

/**
 * 선지
 */
export interface Choice {
  key: string; // ①, 1, ㄱ, 가 등
  text: string;
}

/**
 * 파싱된 문제
 */
export interface ParsedQuestion {
  number: string; // "1" 또는 "18-19"
  type: "multiple" | "ox" | "subjective" | "combined" | "unknown";
  stem: string; // 문제 본문
  passage?: string; // 별도 지문
  box?: string; // <보기> 텍스트
  choices?: Choice[];
  subQuestions?: ParsedQuestion[]; // 결합형 하위 문제
  rawLines?: string[]; // 디버그용 원본 라인
}

/**
 * 바운딩 박스 (좌표)
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 디버그 오버레이 아이템
 */
export interface DebugOverlayItem {
  type: "question" | "choice" | "box" | "field" | "line";
  label: string;
  bounds: BoundingBox;
  color: string; // hex color
  text?: string;
}

/**
 * 자동 크롭 정보
 */
export interface AutoCropInfo {
  contentBounds: BoundingBox; // 실제 컨텐츠 영역
  suggestedCrop: BoundingBox; // 제안 크롭 영역 (여백 포함)
  padding: number; // 적용된 여백
  pageWidth: number;
  pageHeight: number;
}

/**
 * 파싱 결과
 */
export interface ParseResult {
  success: boolean;
  questions: ParsedQuestion[];
  readingOrderLines: string[]; // 디버그용
  isTwoColumn: boolean;
  autoCrop?: AutoCropInfo; // 자동 크롭 정보
  debugOverlays?: DebugOverlayItem[]; // 디버그 오버레이
  debugInfo: {
    totalFields: number;
    totalLines: number;
    leftColumnLines: number;
    rightColumnLines: number;
  };
}

// ============================================================
// 상수 및 패턴
// ============================================================

// 문제 시작 패턴
const QUESTION_START_PATTERNS = [
  /^\s*(\d+)\.\s+/, // "1. "
  /^\s*(\d+)\)\s+/, // "1) "
  /^\s*\((\d+)\)\s+/, // "(1) "
  /^\s*\[(\d+)\s*[~\-]\s*(\d+)\]/, // "[18-19]" 또는 "[18~19]"
  /^\s*(\d+)\s*[~\-]\s*(\d+)\s*\./, // "18-19." 또는 "18~19."
];

// 선지 마커 패턴
const CHOICE_PATTERNS = {
  circleNumber: /^([①②③④⑤⑥⑦⑧⑨⑩])\s*/, // 원문자
  parenNumber: /^(\d+)\)\s*/, // 1) 2)
  dotNumber: /^(\d+)\.\s+/, // 1. 2. (문제 시작과 구분 필요)
  koreanConsonant: /^([ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ])[\.\)]\s*/, // ㄱ. ㄴ.
  koreanSyllable: /^([가나다라마바사아자차카타파하])[\.\)]\s*/, // 가. 나.
  alphabet: /^([a-eA-E])[\.\)]\s*/, // a. b. 또는 a) b)
};

// OX 패턴
const OX_PATTERN = /^[OX○×]\s*$/i;

// <보기> 시작 패턴
const BOX_START_PATTERNS = [
  /^<\s*보\s*기\s*>/,
  /^【\s*보\s*기\s*】/,
  /^보\s*기\s*$/,
  /^\[\s*보\s*기\s*\]/,
];

// <보기> 종료 패턴 (질문 마무리)
const BOX_END_PATTERNS = [
  /고르시오/,
  /옳은 것은/,
  /옳지 않은 것은/,
  /맞는 것은/,
  /틀린 것은/,
  /해당하는 것은/,
  /아닌 것은/,
];

// 주관식 키워드
const SUBJECTIVE_KEYWORDS = [
  "서술하시오",
  "설명하시오",
  "기술하시오",
  "작성하시오",
  "적으시오",
  "쓰시오",
  "기입하시오",
  "답하시오",
];

// ============================================================
// 유틸리티 함수
// ============================================================

/**
 * 필드에 좌표 정보 추가
 */
function addCoordinates(field: OcrField): FieldWithCoords {
  const vertices = field.boundingPoly?.vertices || [];
  const x = vertices[0]?.x || 0;
  const y = vertices[0]?.y || 0;
  const x2 = vertices[2]?.x || x;
  const y2 = vertices[2]?.y || y;

  return {
    ...field,
    _x: x,
    _y: y,
    _centerX: (x + x2) / 2,
    _centerY: (y + y2) / 2,
    _width: x2 - x,
    _height: y2 - y,
  };
}

/**
 * 필드들을 라인으로 클러스터링
 */
function clusterIntoLines(
  fields: FieldWithCoords[],
  tolerance: number = 15
): TextLine[] {
  if (fields.length === 0) return [];

  // y좌표로 정렬
  const sortedFields = [...fields].sort((a, b) => a._y - b._y);

  const lines: TextLine[] = [];
  let currentLine: FieldWithCoords[] = [sortedFields[0]];
  let currentY = sortedFields[0]._centerY;

  for (let i = 1; i < sortedFields.length; i++) {
    const field = sortedFields[i];

    if (Math.abs(field._centerY - currentY) <= tolerance) {
      // 같은 라인
      currentLine.push(field);
    } else {
      // 새 라인 시작
      // 현재 라인을 x좌표로 정렬하여 저장
      currentLine.sort((a, b) => a._x - b._x);
      const lineText = currentLine.map((f) => f.inferText).join(" ");
      lines.push({
        text: lineText.trim(),
        y: currentY,
        fields: currentLine,
      });

      currentLine = [field];
      currentY = field._centerY;
    }
  }

  // 마지막 라인 처리
  if (currentLine.length > 0) {
    currentLine.sort((a, b) => a._x - b._x);
    const lineText = currentLine.map((f) => f.inferText).join(" ");
    lines.push({
      text: lineText.trim(),
      y: currentY,
      fields: currentLine,
    });
  }

  return lines;
}

/**
 * 2단 문서 감지 및 읽기 순서 정렬
 */
function detectAndSortTwoColumn(
  fields: FieldWithCoords[]
): {
  lines: TextLine[];
  isTwoColumn: boolean;
  leftCount: number;
  rightCount: number;
} {
  if (fields.length === 0) {
    return { lines: [], isTwoColumn: false, leftCount: 0, rightCount: 0 };
  }

  // x좌표 분포 분석
  const xCoordinates = fields.map((f) => f._x);
  const sortedX = [...xCoordinates].sort((a, b) => a - b);
  const minX = sortedX[0];
  const maxX = sortedX[sortedX.length - 1];
  const pageWidth = maxX - minX;

  // 2단 판정 기준
  const leftThreshold = minX + pageWidth * 0.4;
  const rightThreshold = minX + pageWidth * 0.6;
  const columnDivider = minX + pageWidth * 0.5;

  const leftFields = fields.filter((f) => f._x < leftThreshold);
  const rightFields = fields.filter((f) => f._x > rightThreshold);
  const middleFields = fields.filter(
    (f) => f._x >= leftThreshold && f._x <= rightThreshold
  );

  // 2단 판정: 좌/우 모두 10개 이상, 중간이 전체의 20% 미만
  const isTwoColumn =
    leftFields.length >= 10 &&
    rightFields.length >= 10 &&
    middleFields.length < fields.length * 0.2;

  let lines: TextLine[];

  if (isTwoColumn) {
    // 2단: 좌측 컬럼 라인들 + 우측 컬럼 라인들
    const leftColumnFields = fields.filter((f) => f._centerX < columnDivider);
    const rightColumnFields = fields.filter((f) => f._centerX >= columnDivider);

    const leftLines = clusterIntoLines(leftColumnFields);
    const rightLines = clusterIntoLines(rightColumnFields);

    // 좌측 먼저, 그 다음 우측
    lines = [...leftLines, ...rightLines];

    console.log(
      `[Parser] 2단 감지: 좌측 ${leftLines.length}줄, 우측 ${rightLines.length}줄`
    );
  } else {
    // 1단: y좌표 순서로 정렬
    lines = clusterIntoLines(fields);
    console.log(`[Parser] 1단 문서: ${lines.length}줄`);
  }

  return {
    lines,
    isTwoColumn,
    leftCount: leftFields.length,
    rightCount: rightFields.length,
  };
}

/**
 * 문제 시작 패턴 매칭
 */
function matchQuestionStart(
  text: string
): { number: string; isCombined: boolean; restText: string } | null {
  // 결합형 먼저 체크
  const combinedMatch1 = text.match(/^\s*\[(\d+)\s*[~\-]\s*(\d+)\]/);
  if (combinedMatch1) {
    return {
      number: `${combinedMatch1[1]}-${combinedMatch1[2]}`,
      isCombined: true,
      restText: text.slice(combinedMatch1[0].length).trim(),
    };
  }

  const combinedMatch2 = text.match(/^\s*(\d+)\s*[~\-]\s*(\d+)\s*\./);
  if (combinedMatch2) {
    return {
      number: `${combinedMatch2[1]}-${combinedMatch2[2]}`,
      isCombined: true,
      restText: text.slice(combinedMatch2[0].length).trim(),
    };
  }

  // 일반 문제 번호
  for (const pattern of QUESTION_START_PATTERNS.slice(0, 3)) {
    const match = text.match(pattern);
    if (match) {
      return {
        number: match[1],
        isCombined: false,
        restText: text.slice(match[0].length).trim(),
      };
    }
  }

  return null;
}

/**
 * 선지 마커 매칭
 */
function matchChoiceMarker(
  text: string
): { key: string; restText: string; markerType: string } | null {
  // 원문자 (가장 높은 우선순위)
  const circleMatch = text.match(CHOICE_PATTERNS.circleNumber);
  if (circleMatch) {
    return {
      key: circleMatch[1],
      restText: text.slice(circleMatch[0].length).trim(),
      markerType: "circle",
    };
  }

  // 1) 2) 형식
  const parenMatch = text.match(CHOICE_PATTERNS.parenNumber);
  if (parenMatch) {
    return {
      key: parenMatch[1],
      restText: text.slice(parenMatch[0].length).trim(),
      markerType: "paren",
    };
  }

  // ㄱ. ㄴ. 형식
  const koreanConsonantMatch = text.match(CHOICE_PATTERNS.koreanConsonant);
  if (koreanConsonantMatch) {
    return {
      key: koreanConsonantMatch[1],
      restText: text.slice(koreanConsonantMatch[0].length).trim(),
      markerType: "koreanConsonant",
    };
  }

  // 가. 나. 형식
  const koreanSyllableMatch = text.match(CHOICE_PATTERNS.koreanSyllable);
  if (koreanSyllableMatch) {
    return {
      key: koreanSyllableMatch[1],
      restText: text.slice(koreanSyllableMatch[0].length).trim(),
      markerType: "koreanSyllable",
    };
  }

  // a. b. 형식
  const alphabetMatch = text.match(CHOICE_PATTERNS.alphabet);
  if (alphabetMatch) {
    return {
      key: alphabetMatch[1].toLowerCase(),
      restText: text.slice(alphabetMatch[0].length).trim(),
      markerType: "alphabet",
    };
  }

  return null;
}

/**
 * <보기> 시작 감지
 */
function isBoxStart(text: string): boolean {
  return BOX_START_PATTERNS.some((p) => p.test(text));
}

/**
 * <보기> 종료 감지 (질문 마무리 문구)
 */
function isBoxEnd(text: string): boolean {
  return BOX_END_PATTERNS.some((p) => p.test(text));
}

/**
 * OX 선지 감지
 */
function isOxChoice(text: string): boolean {
  return OX_PATTERN.test(text.trim());
}

/**
 * 주관식 감지
 */
function isSubjective(text: string): boolean {
  return SUBJECTIVE_KEYWORDS.some((kw) => text.includes(kw));
}

// ============================================================
// 메인 파싱 로직
// ============================================================

/**
 * 문제 블록 파싱 (라인들 → 문제 구조)
 */
function parseQuestionBlock(
  lines: string[],
  questionNumber: string,
  isCombined: boolean
): ParsedQuestion {
  const question: ParsedQuestion = {
    number: questionNumber,
    type: "unknown",
    stem: "",
    rawLines: lines,
  };

  let stemParts: string[] = [];
  let boxParts: string[] = [];
  let choices: Choice[] = [];
  let inBox = false;
  let currentChoiceKey: string | null = null;
  let currentChoiceText: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (!trimmedLine) continue;

    // <보기> 시작 감지
    if (isBoxStart(trimmedLine)) {
      inBox = true;
      // <보기> 라벨 자체는 저장하지 않음
      continue;
    }

    // 선지 마커 감지
    const choiceMatch = matchChoiceMarker(trimmedLine);
    if (choiceMatch) {
      // 이전 선지 저장
      if (currentChoiceKey !== null) {
        choices.push({
          key: currentChoiceKey,
          text: currentChoiceText.join(" ").trim(),
        });
      }

      // <보기> 종료
      inBox = false;

      // 새 선지 시작
      currentChoiceKey = choiceMatch.key;
      currentChoiceText = [choiceMatch.restText];
      continue;
    }

    // OX 선지 감지
    if (isOxChoice(trimmedLine)) {
      if (currentChoiceKey !== null) {
        choices.push({
          key: currentChoiceKey,
          text: currentChoiceText.join(" ").trim(),
        });
      }
      choices.push({
        key: trimmedLine.trim(),
        text: "",
      });
      currentChoiceKey = null;
      currentChoiceText = [];
      continue;
    }

    // <보기> 종료 감지 (질문 마무리 문구)
    if (inBox && isBoxEnd(trimmedLine)) {
      inBox = false;
      stemParts.push(trimmedLine);
      continue;
    }

    // 현재 상태에 따라 텍스트 추가
    if (currentChoiceKey !== null) {
      // 선지 텍스트 이어붙이기
      currentChoiceText.push(trimmedLine);
    } else if (inBox) {
      // <보기> 텍스트
      boxParts.push(trimmedLine);
    } else {
      // stem 텍스트
      stemParts.push(trimmedLine);
    }
  }

  // 마지막 선지 저장
  if (currentChoiceKey !== null) {
    choices.push({
      key: currentChoiceKey,
      text: currentChoiceText.join(" ").trim(),
    });
  }

  // 결과 정리
  question.stem = stemParts.join(" ").trim();

  if (boxParts.length > 0) {
    question.box = boxParts.join("\n").trim();
  }

  if (choices.length > 0) {
    question.choices = choices;

    // 타입 결정
    const isOx = choices.every(
      (c) => c.key === "O" || c.key === "X" || c.key === "○" || c.key === "×"
    );
    if (isOx) {
      question.type = "ox";
    } else {
      question.type = "multiple";
    }
  } else if (isSubjective(question.stem)) {
    question.type = "subjective";
  }

  if (isCombined) {
    question.type = "combined";
  }

  return question;
}

/**
 * 문제들 세그먼테이션 (라인들 → 문제 블록들)
 */
function segmentQuestions(lines: TextLine[]): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  let currentQuestionLines: string[] = [];
  let currentQuestionNumber: string | null = null;
  let currentIsCombined = false;

  for (const line of lines) {
    const text = line.text;
    const questionMatch = matchQuestionStart(text);

    if (questionMatch) {
      // 이전 문제 저장
      if (currentQuestionNumber !== null && currentQuestionLines.length > 0) {
        const parsedQuestion = parseQuestionBlock(
          currentQuestionLines,
          currentQuestionNumber,
          currentIsCombined
        );
        questions.push(parsedQuestion);
      }

      // 새 문제 시작
      currentQuestionNumber = questionMatch.number;
      currentIsCombined = questionMatch.isCombined;
      currentQuestionLines = [questionMatch.restText || text];
    } else if (currentQuestionNumber !== null) {
      // 현재 문제에 라인 추가
      currentQuestionLines.push(text);
    }
    // 문제 시작 전 라인은 무시 (헤더 등)
  }

  // 마지막 문제 저장
  if (currentQuestionNumber !== null && currentQuestionLines.length > 0) {
    const parsedQuestion = parseQuestionBlock(
      currentQuestionLines,
      currentQuestionNumber,
      currentIsCombined
    );
    questions.push(parsedQuestion);
  }

  return questions;
}

// ============================================================
// 6. 자동 크롭 (Auto-crop)
// ============================================================

/**
 * OCR 필드들의 바운딩 박스 계산
 */
function calculateContentBounds(fields: FieldWithCoords[]): BoundingBox {
  if (fields.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const field of fields) {
    const vertices = field.boundingPoly?.vertices || [];
    for (const v of vertices) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * 자동 크롭 정보 생성
 */
function generateAutoCropInfo(
  fields: FieldWithCoords[],
  padding: number = 20
): AutoCropInfo {
  const contentBounds = calculateContentBounds(fields);

  // 페이지 크기 추정 (필드 좌표 기반)
  const pageWidth = contentBounds.x + contentBounds.width + padding * 2;
  const pageHeight = contentBounds.y + contentBounds.height + padding * 2;

  // 여백 포함 크롭 영역
  const suggestedCrop: BoundingBox = {
    x: Math.max(0, contentBounds.x - padding),
    y: Math.max(0, contentBounds.y - padding),
    width: contentBounds.width + padding * 2,
    height: contentBounds.height + padding * 2,
  };

  return {
    contentBounds,
    suggestedCrop,
    padding,
    pageWidth,
    pageHeight,
  };
}

// ============================================================
// 7. 디버그 오버레이 (Debug Overlays)
// ============================================================

// 색상 팔레트
const OVERLAY_COLORS = {
  question: "#1A6B1A", // 녹색 - 문제 영역
  choice: "#3B82F6", // 파랑 - 선지
  box: "#EAB308", // 노랑 - 보기
  field: "#9CA3AF", // 회색 - 개별 필드
  line: "#8B5CF6", // 보라 - 라인
  combined: "#DC2626", // 빨강 - 결합형
};

/**
 * 필드들의 통합 바운딩 박스 계산
 */
function mergeFieldBounds(fields: FieldWithCoords[]): BoundingBox {
  return calculateContentBounds(fields);
}

/**
 * 디버그 오버레이 생성 (상세 옵션 지원)
 * 클라이언트에서 직접 호출하여 다양한 레벨의 오버레이 생성 가능
 */
export function generateDebugOverlays(
  fields: FieldWithCoords[],
  lines: TextLine[],
  questions: ParsedQuestion[],
  options: {
    showFields?: boolean;
    showLines?: boolean;
    showQuestions?: boolean;
  } = {}
): DebugOverlayItem[] {
  const { showFields = false, showLines = true, showQuestions = true } = options;
  const overlays: DebugOverlayItem[] = [];

  // 1. 개별 필드 오버레이 (옵션)
  if (showFields) {
    fields.forEach((field, idx) => {
      overlays.push({
        type: "field",
        label: `F${idx}`,
        bounds: {
          x: field._x,
          y: field._y,
          width: field._width,
          height: field._height,
        },
        color: OVERLAY_COLORS.field,
        text: field.inferText.substring(0, 20),
      });
    });
  }

  // 2. 라인 오버레이 (옵션)
  if (showLines) {
    lines.forEach((line, idx) => {
      const bounds = mergeFieldBounds(line.fields);
      overlays.push({
        type: "line",
        label: `L${idx + 1}`,
        bounds,
        color: OVERLAY_COLORS.line,
        text: line.text.substring(0, 30),
      });
    });
  }

  // 3. 문제 단위 오버레이
  if (showQuestions) {
    questions.forEach((q) => {
      // 문제 전체 영역 (rawLines 기반으로는 좌표가 없으므로 별도 처리 필요)
      // 일단 라벨만 추가
      const color =
        q.type === "combined" ? OVERLAY_COLORS.combined : OVERLAY_COLORS.question;

      // 문제 헤더 오버레이 (placeholder - 실제 좌표는 추후 연결 필요)
      overlays.push({
        type: "question",
        label: `Q${q.number}`,
        bounds: { x: 0, y: 0, width: 100, height: 20 }, // placeholder
        color,
        text: `${q.type}: ${q.stem.substring(0, 30)}...`,
      });

      // 선지 오버레이
      if (q.choices) {
        q.choices.forEach((choice, cIdx) => {
          overlays.push({
            type: "choice",
            label: choice.key,
            bounds: { x: 0, y: 0, width: 100, height: 20 }, // placeholder
            color: OVERLAY_COLORS.choice,
            text: choice.text.substring(0, 30),
          });
        });
      }

      // 보기 오버레이
      if (q.box) {
        overlays.push({
          type: "box",
          label: "보기",
          bounds: { x: 0, y: 0, width: 100, height: 20 }, // placeholder
          color: OVERLAY_COLORS.box,
          text: q.box.substring(0, 30),
        });
      }
    });
  }

  return overlays;
}

/**
 * 필드-라인-문제 좌표 매핑 (정확한 오버레이용)
 */
function mapFieldsToQuestions(
  lines: TextLine[],
  questions: ParsedQuestion[]
): Map<string, FieldWithCoords[]> {
  const questionFieldMap = new Map<string, FieldWithCoords[]>();

  // 문제 번호로 라인 범위 매핑
  let currentQuestion: string | null = null;
  let currentFields: FieldWithCoords[] = [];

  for (const line of lines) {
    const questionMatch = matchQuestionStart(line.text);

    if (questionMatch) {
      // 이전 문제 저장
      if (currentQuestion !== null) {
        questionFieldMap.set(currentQuestion, [...currentFields]);
      }
      // 새 문제 시작
      currentQuestion = questionMatch.number;
      currentFields = [...line.fields];
    } else if (currentQuestion !== null) {
      // 현재 문제에 필드 추가
      currentFields.push(...line.fields);
    }
  }

  // 마지막 문제 저장
  if (currentQuestion !== null) {
    questionFieldMap.set(currentQuestion, currentFields);
  }

  return questionFieldMap;
}

/**
 * 정확한 좌표가 포함된 디버그 오버레이 생성
 */
function generateAccurateOverlays(
  lines: TextLine[],
  questions: ParsedQuestion[]
): DebugOverlayItem[] {
  const overlays: DebugOverlayItem[] = [];
  const questionFieldMap = mapFieldsToQuestions(lines, questions);

  questions.forEach((q) => {
    const fields = questionFieldMap.get(q.number);
    if (!fields || fields.length === 0) return;

    const bounds = mergeFieldBounds(fields);
    const color =
      q.type === "combined" ? OVERLAY_COLORS.combined : OVERLAY_COLORS.question;

    overlays.push({
      type: "question",
      label: `Q${q.number}`,
      bounds,
      color,
      text: `[${q.type}] ${q.stem.substring(0, 40)}...`,
    });
  });

  return overlays;
}

// ============================================================
// 메인 엔트리
// ============================================================

/**
 * OCR 필드들을 받아서 문제들로 파싱
 *
 * @param ocrFields - Clova OCR에서 반환된 필드 배열
 * @param options - 파싱 옵션
 * @param options.includeAutoCrop - 자동 크롭 정보 포함 여부 (기본: true)
 * @param options.includeDebugOverlays - 디버그 오버레이 포함 여부 (기본: false, 디버그 모드에서만 활성화)
 * @param options.cropPadding - 크롭 여백 (기본: 20px)
 */
export function parseQuestions(
  ocrFields: OcrField[],
  options: {
    includeAutoCrop?: boolean;
    includeDebugOverlays?: boolean;
    cropPadding?: number;
  } = {}
): ParseResult {
  const {
    includeAutoCrop = true,
    includeDebugOverlays = false,
    cropPadding = 20,
  } = options;

  console.log(`[Parser] 파싱 시작: ${ocrFields.length}개 필드`);

  // 1. 좌표 정보 추가
  const fieldsWithCoords = ocrFields.map(addCoordinates);

  // 2. 2단 감지 및 읽기 순서 정렬
  const { lines, isTwoColumn, leftCount, rightCount } =
    detectAndSortTwoColumn(fieldsWithCoords);

  console.log(`[Parser] 라인 클러스터링 완료: ${lines.length}줄`);

  // 3. 문제 세그먼테이션
  const questions = segmentQuestions(lines);

  console.log(`[Parser] 문제 파싱 완료: ${questions.length}개 문제`);

  // 디버그: 각 문제 요약
  questions.forEach((q, idx) => {
    console.log(
      `  [문제 ${q.number}] type=${q.type}, choices=${q.choices?.length || 0}, box=${q.box ? "있음" : "없음"}`
    );
    console.log(`    stem: ${q.stem.slice(0, 50)}...`);
  });

  // 4. 자동 크롭 정보 생성
  let autoCrop: AutoCropInfo | undefined;
  if (includeAutoCrop && fieldsWithCoords.length > 0) {
    autoCrop = generateAutoCropInfo(fieldsWithCoords, cropPadding);
    console.log(`[Parser] 자동 크롭 정보:`);
    console.log(`  컨텐츠 영역: (${autoCrop.contentBounds.x}, ${autoCrop.contentBounds.y}) ` +
      `${autoCrop.contentBounds.width}x${autoCrop.contentBounds.height}`);
    console.log(`  제안 크롭: (${autoCrop.suggestedCrop.x}, ${autoCrop.suggestedCrop.y}) ` +
      `${autoCrop.suggestedCrop.width}x${autoCrop.suggestedCrop.height}`);
  }

  // 5. 디버그 오버레이 생성
  let debugOverlays: DebugOverlayItem[] | undefined;
  if (includeDebugOverlays) {
    debugOverlays = generateAccurateOverlays(lines, questions);
    console.log(`[Parser] 디버그 오버레이: ${debugOverlays.length}개 항목`);
  }

  return {
    success: questions.length > 0,
    questions,
    readingOrderLines: lines.map((l) => l.text),
    isTwoColumn,
    autoCrop,
    debugOverlays,
    debugInfo: {
      totalFields: ocrFields.length,
      totalLines: lines.length,
      leftColumnLines: leftCount,
      rightColumnLines: rightCount,
    },
  };
}

/**
 * 파싱 결과를 앱의 ParsedQuestion 형식으로 변환
 */
export function convertToAppFormat(
  parseResult: ParseResult
): {
  questions: Array<{
    text: string;
    type: string;
    choices?: string[];
    examples?: { type: string; items: string[] };
    passage?: string;
  }>;
  rawText: string;
  success: boolean;
  message: string;
} {
  const appQuestions = parseResult.questions.map((q) => {
    const appQuestion: any = {
      text: q.stem,
      type: q.type === "unknown" ? "short_answer" : q.type,
    };

    // 선지 변환 (Choice[] → string[])
    if (q.choices && q.choices.length > 0) {
      appQuestion.choices = q.choices.map((c) => c.text);
    }

    // <보기> 변환
    if (q.box) {
      // ㄱ.ㄴ.ㄷ. 형식인지 확인
      const koreanPattern = /^[ㄱㄴㄷㄹㅁㅂㅅㅇ][\.\)]/m;
      if (koreanPattern.test(q.box)) {
        const items = q.box
          .split(/(?=[ㄱㄴㄷㄹㅁㅂㅅㅇ][\.\)])/)
          .map((s) => s.trim())
          .filter((s) => s);
        appQuestion.examples = {
          type: "labeled",
          items,
        };
      } else {
        appQuestion.examples = {
          type: "text",
          items: [q.box],
        };
      }
    }

    // 공통 지문
    if (q.passage) {
      appQuestion.passage = q.passage;
    }

    return appQuestion;
  });

  return {
    questions: appQuestions,
    rawText: parseResult.readingOrderLines.join("\n"),
    success: parseResult.success,
    message: parseResult.success
      ? `${parseResult.questions.length}개 문제 파싱 완료`
      : "문제를 찾을 수 없습니다",
  };
}
