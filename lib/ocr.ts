/**
 * OCR 유틸리티
 *
 * 이미지/PDF에서 텍스트를 추출하고, 퀴즈 문제를 파싱합니다.
 *
 * 주요 기능:
 * - OCR 전처리 (저작권 제거, 오타 수정, 공백 정리)
 * - 결합형 문제 자동 감지 ([36~37] 형식)
 * - 개선된 선지 추출 (①②③④⑤ 원숫자)
 * - 각주 추출
 * - 하위 지문 분리
 * - 유효성 검사
 */

import Tesseract from 'tesseract.js';

// ============================================================
// 타입 정의
// ============================================================

/**
 * OCR 진행 상태
 */
export interface OCRProgress {
  /** 진행률 (0-100) */
  progress: number;
  /** 현재 상태 메시지 */
  status: string;
}

/**
 * OCR 결과
 */
export interface OCRResult {
  /** 추출된 텍스트 */
  text: string;
  /** 신뢰도 (0-100) */
  confidence: number;
  /** 에러 메시지 (있는 경우) */
  error?: string;
}

/**
 * 파싱된 문제 타입
 * - ox: OX 문제
 * - multiple: 객관식 (2~8개 선지)
 * - short_answer: 단답형
 * - subjective: 주관식 (학생용 단답형 별칭)
 * - essay: 서술형 (루브릭 채점)
 * - combined: 결합형 (공통 제시문/이미지 + 여러 하위 문제)
 */
export type QuestionType = 'ox' | 'multiple' | 'short_answer' | 'subjective' | 'essay' | 'combined';

/**
 * 보기 타입 ('text': 텍스트 박스 형식, 'labeled': ㄱ.ㄴ.ㄷ. 형식)
 */
export type ExamplesType = 'text' | 'labeled';

/**
 * 보기 데이터
 */
export interface ExamplesData {
  /** 보기 유형 */
  type: ExamplesType;
  /** 보기 항목들 */
  items: string[];
}

/**
 * 서술형 루브릭 항목
 */
export interface RubricItem {
  /** 평가요소 이름 */
  criteria: string;
  /** 배점 비율 (0-100) */
  percentage: number;
  /** 평가 기준 상세 설명 (선택) */
  description?: string;
}

/**
 * 하위 문제 (결합형용)
 */
export interface ParsedSubQuestion {
  /** 하위 문제 ID */
  id: string;
  /** 하위 문제 텍스트 */
  text: string;
  /** 문제 유형 */
  type: 'ox' | 'multiple' | 'short_answer';
  /** 객관식 선지 */
  choices?: string[];
  /** 정답 인덱스 (OX/객관식) */
  answerIndex?: number;
  /** 복수정답 인덱스 배열 */
  answerIndices?: number[];
  /** 단답형 정답 */
  answerText?: string;
  /** 보기 데이터 */
  examples?: ExamplesData;
}

/**
 * 파싱된 문제
 */
export interface ParsedQuestion {
  /** 문제 텍스트 */
  text: string;
  /** 문제 유형 */
  type: QuestionType;
  /** 선지 (객관식) */
  choices?: string[];
  /** 정답 (인덱스 또는 텍스트) */
  answer?: string | number;
  /** 복수정답 인덱스 배열 */
  answerIndices?: number[];
  /** 복수정답 여부 */
  hasMultipleAnswers?: boolean;
  /** 해설 */
  explanation?: string;
  /** 루브릭 (서술형) */
  rubric?: RubricItem[];
  /** 보기 데이터 */
  examples?: ExamplesData;
  /** 결합형: 공통 제시문 타입 */
  passageType?: 'text' | 'korean_abc';
  /** 결합형: 공통 제시문 */
  passage?: string;
  /** 결합형: ㄱㄴㄷ 보기 항목 */
  koreanAbcItems?: string[];
  /** 결합형: 하위 문제 목록 */
  subQuestions?: ParsedSubQuestion[];
  /** 제시문 발문 */
  passagePrompt?: string;
  /** 보기 데이터 (ㄱㄴㄷ 항목 + 발문) */
  bogi?: {
    questionText: string;
    items: Array<{
      id: string;
      label: string;
      content: string;
    }>;
  };
  /** 혼합 보기 형식 (bullet 타입 제시문 포함) */
  mixedExamples?: Array<{
    id: string;
    type: 'text' | 'labeled' | 'bullet';
    label?: string;
    content?: string;
    items?: Array<{
      id: string;
      label: string;
      content: string;
    }>;
  }>;
  /** 제시문 블록들 (text, gana, bullet 등) */
  passageBlocks?: Array<{
    id: string;
    type: 'text' | 'gana' | 'bullet' | 'image' | 'grouped';
    content?: string;
    items?: Array<{
      id: string;
      label: string;
      content: string;
    }>;
    imageUrl?: string;
  }>;
}

/**
 * 문제 파싱 결과
 */
export interface ParseResult {
  /** 파싱된 문제 목록 */
  questions: ParsedQuestion[];
  /** 파싱되지 않은 원본 텍스트 */
  rawText: string;
  /** 파싱 성공 여부 */
  success: boolean;
  /** 안내 메시지 */
  message: string;
}

/**
 * 각주 데이터
 */
export interface Footnote {
  /** 용어 */
  term: string;
  /** 설명 */
  definition: string;
}

/**
 * 하위 제시문 데이터 (결합형용)
 */
export interface SubPassage {
  /** 라벨 (A, B, C, D 등) */
  label: string;
  /** 제시문 내용 */
  content: string;
}

/**
 * 문제 유효성 검사 결과
 */
export interface ValidationResult {
  /** 유효 여부 */
  isValid: boolean;
  /** 오류 목록 */
  errors: string[];
  /** 경고 목록 */
  warnings: string[];
}

// ============================================================
// OCR 전처리 함수
// ============================================================

/**
 * OCR 인식 오류 수정 맵
 * 흔한 OCR 오타를 수정합니다
 */
const OCR_ERROR_FIXES: Record<string, string> = {
  // 숫자 오인식
  'O': '0', // 영문 O -> 숫자 0 (문맥에 따라)
  'l': '1', // 소문자 L -> 숫자 1 (문맥에 따라)
  'I': '1', // 대문자 I -> 숫자 1 (문맥에 따라)
  // 한글 오인식
  '묻': '문',
  '쩨': '제',
  '딥': '답',
  '젱': '정',
  '뎝': '답',
  // 특수문자 오인식
  '「': '[',
  '」': ']',
  '『': '[',
  '』': ']',
  '（': '(',
  '）': ')',
};

/**
 * 저작권 문구 패턴
 */
const COPYRIGHT_PATTERNS = [
  /ⓒ\s*\d{4}.*?(?:저작권|Copyright|All rights reserved)[^\n]*/gi,
  /Copyright\s*©?\s*\d{4}[^\n]*/gi,
  /저작권[은는이가]?\s*[^\n]*에\s*있습니다[.。]?/gi,
  /무단\s*(?:복제|전재|배포)[^\n]*/gi,
  /출처\s*[:：]\s*[^\n]*/gi,
];

/**
 * OCR에서 자주 발생하는 원숫자 오인식 패턴 보정
 * ① → (D, @, CD, (1), 1), ⓵ 등으로 인식될 수 있음
 */
const normalizeCircledNumbers = (text: string): string => {
  let result = text;

  // 1단계: 다른 스타일의 원숫자 통일
  const circledVariants: Array<[RegExp, string]> = [
    [/⓵/g, '①'],
    [/⓶/g, '②'],
    [/⓷/g, '③'],
    [/⓸/g, '④'],
    [/⓹/g, '⑤'],
    [/⓺/g, '⑥'],
    [/⓻/g, '⑦'],
    [/⓼/g, '⑧'],
    // 네모 숫자
    [/❶/g, '①'],
    [/❷/g, '②'],
    [/❸/g, '③'],
    [/❹/g, '④'],
    [/❺/g, '⑤'],
  ];

  for (const [pattern, replacement] of circledVariants) {
    result = result.replace(pattern, replacement);
  }

  // 2단계: OCR 오인식 패턴을 원숫자로 변환 (더 유연하게)
  // 줄 시작이나 공백 뒤에 있는 (1), (2), ... 패턴
  result = result.replace(/(?:^|[\s\n])\(1\)\s*/gm, ' ① ');
  result = result.replace(/(?:^|[\s\n])\(2\)\s*/gm, ' ② ');
  result = result.replace(/(?:^|[\s\n])\(3\)\s*/gm, ' ③ ');
  result = result.replace(/(?:^|[\s\n])\(4\)\s*/gm, ' ④ ');
  result = result.replace(/(?:^|[\s\n])\(5\)\s*/gm, ' ⑤ ');
  result = result.replace(/(?:^|[\s\n])\(6\)\s*/gm, ' ⑥ ');
  result = result.replace(/(?:^|[\s\n])\(7\)\s*/gm, ' ⑦ ');
  result = result.replace(/(?:^|[\s\n])\(8\)\s*/gm, ' ⑧ ');

  // @1, @2 등의 오인식 (더 유연한 패턴)
  result = result.replace(/@1\b/g, '①');
  result = result.replace(/@2\b/g, '②');
  result = result.replace(/@3\b/g, '③');
  result = result.replace(/@4\b/g, '④');
  result = result.replace(/@5\b/g, '⑤');

  // CD, (D 등이 ① 로 오인식되는 경우 (흔하지 않으므로 보수적으로)
  // 줄 시작에 CD나 (D가 있고 뒤에 텍스트가 오면 ①로 추정
  result = result.replace(/^CD\s+/gm, '① ');
  result = result.replace(/^\(D\s+/gm, '① ');

  // 3단계: 선지 블록 감지 및 변환
  // 선지가 연속으로 나열된 블록을 찾아서 변환
  // 예: "1) 가나다 2) 라마바 3) 사아자 4) 차카타 5) 파하"
  const choiceBlockPattern = /(?:^|\n)(\s*)1\)\s*(.+?)\s+2\)\s*(.+?)\s+3\)\s*(.+?)\s+4\)\s*(.+?)(?:\s+5\)\s*(.+?))?(?=\s*\n|$)/gm;
  result = result.replace(choiceBlockPattern, (match, indent, c1, c2, c3, c4, c5) => {
    let converted = `\n${indent}① ${c1} ② ${c2} ③ ${c3} ④ ${c4}`;
    if (c5) converted += ` ⑤ ${c5}`;
    return converted;
  });

  return result;
};

/**
 * 문제 번호 정규화
 * "1.", "1)", "1번", "문제1", "Q1" 등을 통일된 형식으로
 */
const normalizeQuestionNumbers = (text: string): string => {
  let result = text;

  // 문제 번호 패턴들을 "숫자. " 형식으로 통일
  // 단, 선지(①②③④⑤)와 혼동하지 않도록 주의

  // "문제 1", "문제1" → "1."
  result = result.replace(/문제\s*(\d+)\s*[.):：]?\s*/g, '$1. ');

  // "Q1", "Q.1", "Q 1" → "1."
  result = result.replace(/Q\.?\s*(\d+)\s*[.):：]?\s*/gi, '$1. ');

  // "1번", "1 번" → "1."
  result = result.replace(/(\d+)\s*번\s*[.):：]?\s*/g, '$1. ');

  // 줄 시작의 "1)" → "1."
  result = result.replace(/^(\d+)\)\s*/gm, '$1. ');

  return result;
};

/**
 * OCR 텍스트 전처리
 * 저작권 문구 제거, 오타 수정, 불필요한 공백 정리
 */
export const preprocessOCRText = (text: string): string => {
  let processed = text;

  // 1. 저작권 문구 제거
  for (const pattern of COPYRIGHT_PATTERNS) {
    processed = processed.replace(pattern, '');
  }

  // 2. 흔한 OCR 오타 수정 (문맥에 맞게)
  processed = processed.replace(/묻제/g, '문제');
  processed = processed.replace(/쩨목/g, '제목');
  processed = processed.replace(/젱답/g, '정답');
  processed = processed.replace(/딥안/g, '답안');
  processed = processed.replace(/헤설/g, '해설');

  // 3. 원숫자 오인식 보정
  processed = normalizeCircledNumbers(processed);

  // 4. 문제 번호 정규화
  processed = normalizeQuestionNumbers(processed);

  // 5. 불필요한 공백 정리
  processed = processed
    // 여러 개의 공백을 하나로
    .replace(/[ \t]+/g, ' ')
    // 빈 줄 여러 개를 2개로 제한
    .replace(/\n{3,}/g, '\n\n')
    // 줄 끝 공백 제거
    .replace(/[ \t]+$/gm, '')
    // 줄 시작 공백 제거 (들여쓰기 유지하되 과도한 공백 제거)
    .replace(/^[ \t]{4,}/gm, '  ')
    .trim();

  return processed;
};

/**
 * 결합형 문제 번호 범위 감지
 * [36~37], [36-37], 36~37번 등의 형식 인식
 */
export const detectCombinedQuestionRange = (text: string): { start: number; end: number } | null => {
  const patterns = [
    /\[(\d+)\s*[~\-]\s*(\d+)\]/,       // [36~37] 또는 [36-37]
    /(\d+)\s*[~\-]\s*(\d+)\s*번/,       // 36~37번
    /문제\s*(\d+)\s*[~\-]\s*(\d+)/,     // 문제 36~37
    /Q\.?\s*(\d+)\s*[~\-]\s*(\d+)/i,    // Q36~37 또는 Q.36~37
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        start: parseInt(match[1], 10),
        end: parseInt(match[2], 10),
      };
    }
  }

  return null;
};

/**
 * 수능 스타일 선지 추출 (CSAT-specific)
 * "① ㄱ ② ㄷ ③ ㄱ, ㄴ ④ ㄴ, ㄷ ⑤ ㄱ, ㄴ, ㄷ" 형식
 *
 * OCR이 원숫자를 인식 못해도 패턴으로 감지:
 * - 5개의 짧은 항목이 한 줄에 나열
 * - 각 항목은 ㄱ,ㄴ,ㄷ 조합이거나 짧은 텍스트
 */
export const extractCSATChoices = (text: string): string[] | null => {
  console.log('[extractCSATChoices] 수능 스타일 선지 추출 시도');

  // 줄 단위로 분석
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // 방법 1: 원숫자가 포함된 줄 찾기
    // "① ㄱ ② ㄷ ③ ㄱ, ㄴ ④ ㄴ, ㄷ ⑤ ㄱ, ㄴ, ㄷ"
    const circledPattern = /[①②③④⑤].*[①②③④⑤].*[①②③④⑤]/;
    if (circledPattern.test(trimmed)) {
      const choices: string[] = [];
      const parts = trimmed.split(/[①②③④⑤⑥⑦⑧]/).filter(p => p.trim());
      if (parts.length >= 4) {
        console.log('[extractCSATChoices] 원숫자 패턴 발견:', parts);
        return parts.map(p => p.trim());
      }
    }

    // 방법 2: OCR이 원숫자를 숫자로 인식한 경우
    // "1 ㄱ 2 ㄷ 3 ㄱ, ㄴ 4 ㄴ, ㄷ 5 ㄱ, ㄴ, ㄷ"
    // 또는 "0 ㄱ @ ㄷ 3 ㄱ, ㄴ" 등 다양한 변형
    const numberedChoiceLine = /^[\s\d①②③④⑤@O0]*[ㄱㄴㄷㄹㅁㅂ,\s]+$/;
    if (numberedChoiceLine.test(trimmed) && trimmed.length > 10) {
      // ㄱ,ㄴ,ㄷ 조합을 추출
      const koreanMatches = trimmed.match(/[ㄱㄴㄷㄹㅁㅂ][,\s]*[ㄱㄴㄷㄹㅁㅂ]?[,\s]*[ㄱㄴㄷㄹㅁㅂ]?/g);
      if (koreanMatches && koreanMatches.length >= 4) {
        console.log('[extractCSATChoices] ㄱㄴㄷ 패턴 발견:', koreanMatches);
        return koreanMatches.map(m => m.trim());
      }
    }

    // 방법 3: 5개의 짧은 항목이 반복되는 패턴
    // "ㄱ    ㄷ    ㄱ, ㄴ    ㄴ, ㄷ    ㄱ, ㄴ, ㄷ" (번호 없이)
    const shortItemsPattern = /^[ㄱㄴㄷㄹㅁㅂ,\s]+$/;
    if (shortItemsPattern.test(trimmed) && trimmed.includes('ㄱ')) {
      const items = trimmed.split(/\s{2,}/).filter(i => i.trim());
      if (items.length >= 4) {
        console.log('[extractCSATChoices] 공백 구분 패턴 발견:', items);
        return items;
      }
    }
  }

  console.log('[extractCSATChoices] 수능 스타일 선지 없음');
  return null;
};

/**
 * OCR 오인식 문자를 원숫자로 변환 후 선지 추출
 * Tesseract가 ①을 0, @, O, CD 등으로 인식하는 경우 처리
 */
export const extractMangledCircledChoices = (text: string): string[] | null => {
  console.log('[extractMangledCircledChoices] 오인식 문자 선지 추출 시도');

  // OCR이 원숫자를 오인식하는 패턴들
  // ① → 0, @, O, CD, (D, Q), 1)
  // ② → @, 2, 2), Q, (2)
  // 등등

  // 한 줄에 5개의 항목이 있는 패턴 찾기
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 5) continue;

    // 패턴: 숫자/기호 + 텍스트가 5번 반복
    // 예: "0 가 @ 나 3 다 4 라 5 마"
    // 예: "1) 가 2) 나 3) 다 4) 라 5) 마"

    // 숫자나 기호로 시작하고 짧은 텍스트가 5개 이상 있는지 체크
    const itemPattern = /(?:[\d@O0①②③④⑤]\)?|\(\d\))\s*([^0-9@O①②③④⑤()\s][^\d@O①②③④⑤()]*?)(?=\s*(?:[\d@O0①②③④⑤]\)?|\(\d\)|$))/g;
    const matches: string[] = [];
    let match;

    while ((match = itemPattern.exec(trimmed)) !== null) {
      const content = match[1].trim();
      if (content && content.length > 0) {
        matches.push(content);
      }
    }

    if (matches.length >= 4) {
      console.log('[extractMangledCircledChoices] 오인식 패턴 발견:', matches);
      return matches;
    }
  }

  console.log('[extractMangledCircledChoices] 오인식 패턴 없음');
  return null;
};

/**
 * 원숫자 선지 추출 (CLOVA OCR 최적화 버전)
 * ①②③④⑤ 형식의 선지를 배열로 변환
 *
 * CLOVA OCR은 원숫자를 정확하게 인식하므로:
 * - 오인식 처리보다 정확한 패턴 매칭에 집중
 * - 선지가 연속적으로 나와야 함 (①→②→③...)
 * - 중간에 다른 문제 번호가 나오면 거기서 끊음
 */
export const extractCircledChoices = (text: string): string[] | null => {
  const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
  const choices: string[] = [];

  console.log('[extractCircledChoices] 입력 텍스트 (처음 500자):', text.slice(0, 500));

  // 방법 1: 정규식으로 원숫자 + 내용 패턴 매칭 (CLOVA OCR에 최적)
  const circledPattern = /([①②③④⑤⑥⑦⑧])\s*([^①②③④⑤⑥⑦⑧\n]+)/g;
  const matches = [...text.matchAll(circledPattern)];

  if (matches.length >= 2) {
    // 순서 검증
    let expectedIdx = 0;
    for (const match of matches) {
      const circleChar = match[1];
      const actualIdx = circledNumbers.indexOf(circleChar);

      if (actualIdx === expectedIdx) {
        const content = match[2].trim();
        if (content && content.length > 0) {
          choices.push(content);
          expectedIdx++;
        }
      } else if (actualIdx > expectedIdx) {
        // 순서가 건너뛰면 중단
        break;
      }
    }

    if (choices.length >= 2) {
      console.log(`[extractCircledChoices] 정규식 패턴으로 ${choices.length}개 선지 추출`);
      return choices;
    }
  }

  // 방법 2: 수능 스타일 선지 시도
  const csatChoices = extractCSATChoices(text);
  if (csatChoices) {
    return csatChoices;
  }

  // 방법 3: 위치 기반 추출 (fallback)
  const positions: { index: number; num: number; char: string }[] = [];

  for (let i = 0; i < circledNumbers.length; i++) {
    const idx = text.indexOf(circledNumbers[i]);
    if (idx !== -1) {
      positions.push({ index: idx, num: i, char: circledNumbers[i] });
    }
  }

  // 위치순 정렬
  positions.sort((a, b) => a.index - b.index);

  console.log('[extractCircledChoices] 찾은 원숫자 위치:', positions);

  // ①부터 시작하는지 확인
  if (positions.length === 0 || positions[0].num !== 0) {
    console.log('[extractCircledChoices] ①을 찾지 못함');
    return null;
  }

  // 연속된 선지 추출
  let expectedNum = 0;
  for (let i = 0; i < positions.length; i++) {
    const current = positions[i];

    // 순서가 맞지 않으면 중단
    if (current.num !== expectedNum) {
      console.log(`[extractCircledChoices] 순서 불일치: 예상 ${expectedNum}, 실제 ${current.num}`);
      break;
    }

    const next = positions[i + 1];
    const startIdx = current.index + 1; // 원숫자 다음부터

    // 끝 위치 결정: 다음 원숫자 또는 문제 번호 패턴 또는 텍스트 끝
    let endIdx = next ? next.index : text.length;

    // 다음 문제 시작 패턴 체크 (예: "2. ", "\n2.")
    const remainingText = text.slice(startIdx, endIdx);
    const nextQuestionMatch = remainingText.match(/\n\s*\d+\s*[.．]\s/);
    if (nextQuestionMatch?.index !== undefined) {
      endIdx = startIdx + nextQuestionMatch.index;
    }

    let choice = text.slice(startIdx, endIdx).trim();

    // 줄바꿈 처리: 여러 줄이면 첫 줄만 (또는 내용이 짧으면 합치기)
    const lines = choice.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length > 0) {
      // 첫 줄이 짧고 다음 줄이 있으면 합치기 (선지가 줄바꿈된 경우)
      if (lines[0].length < 30 && lines.length > 1 && !lines[1].match(/^[①②③④⑤⑥⑦⑧\d]/)) {
        choice = lines.slice(0, 2).join(' ');
      } else {
        choice = lines[0];
      }
    }

    // 내용이 너무 길면 자르기 (150자로 확장 - CLOVA OCR이 정확하므로)
    if (choice.length > 150) {
      choice = choice.slice(0, 150).trim();
    }

    if (choice) {
      choices.push(choice);
      console.log(`[extractCircledChoices] 선지 ${current.char}: "${choice.slice(0, 50)}..."`);
    }

    expectedNum++;
  }

  console.log(`[extractCircledChoices] 총 ${choices.length}개 선지 추출`);
  return choices.length >= 2 ? choices : null;
};

/**
 * 괄호 숫자 선지 추출
 * (1)(2)(3)(4)(5) 형식의 선지를 배열로 변환
 */
export const extractParenChoices = (text: string): string[] | null => {
  // 패턴 1: (1) 텍스트 형식
  const pattern1 = /\((\d)\)\s*([^\n(①②③④⑤]+)/g;
  const choices1: string[] = [];
  let match;

  while ((match = pattern1.exec(text)) !== null) {
    const choiceNum = parseInt(match[1], 10);
    const choiceText = match[2].trim();

    // 순서대로 추가
    if (choiceNum === choices1.length + 1 && choiceText && choiceText.length > 1) {
      choices1.push(choiceText);
    }
  }

  if (choices1.length >= 2) return choices1;

  // 패턴 2: 1) 텍스트 형식 (줄 시작)
  const pattern2 = /(?:^|\n)\s*(\d)\)\s*([^\n]+)/g;
  const choices2: string[] = [];

  while ((match = pattern2.exec(text)) !== null) {
    const choiceNum = parseInt(match[1], 10);
    const choiceText = match[2].trim();

    if (choiceNum === choices2.length + 1 && choiceText && choiceText.length > 1) {
      choices2.push(choiceText);
    }
  }

  return choices2.length >= 2 ? choices2 : null;
};

/**
 * 숫자 목록 형태 선지 추출 (Fallback)
 * 1. 텍스트 또는 1, 텍스트 형식의 선지를 배열로 변환
 * OCR이 원숫자를 전혀 인식하지 못한 경우의 fallback
 */
export const extractNumberedListChoices = (text: string): string[] | null => {
  const choices: string[] = [];

  // 줄 단위로 분석
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  // 패턴: 줄 시작에 숫자가 있고 뒤에 텍스트가 있는 경우
  // 1. 텍스트, 1, 텍스트, 1) 텍스트 등
  const linePattern = /^(\d)[.),\s]\s*(.+)/;

  let expectedNum = 1;
  for (const line of lines) {
    const match = line.match(linePattern);
    if (match) {
      const num = parseInt(match[1], 10);
      const content = match[2].trim();

      // 연속된 번호인지 확인
      if (num === expectedNum && content.length > 1) {
        choices.push(content);
        expectedNum++;
      } else if (num > expectedNum) {
        // 번호가 건너뛰어진 경우 중단
        break;
      }
    } else if (choices.length > 0) {
      // 숫자로 시작하지 않는 줄이면 이전 선지에 추가하거나 중단
      // 선지가 2개 이상이면 중단
      if (choices.length >= 2) break;
    }
  }

  console.log(`[extractNumberedListChoices] 추출된 선지: ${choices.length}개`);
  return choices.length >= 2 ? choices : null;
};

/**
 * 한 줄에 나열된 선지 추출
 * 예: "① 가나다 ② 라마바 ③ 사아자 ④ 차카타 ⑤ 파하"
 * 또는 "1.가나다 2.라마바 3.사아자 4.차카타 5.파하"
 */
export const extractInlineChoices = (text: string): string[] | null => {
  // 원숫자 패턴
  const circledPattern = /([①②③④⑤⑥⑦⑧])\s*([^①②③④⑤⑥⑦⑧\n]+)/g;
  const circledChoices: { num: number; text: string }[] = [];
  const circledNums = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

  let match;
  while ((match = circledPattern.exec(text)) !== null) {
    const num = circledNums.indexOf(match[1]);
    if (num !== -1) {
      circledChoices.push({ num, text: match[2].trim() });
    }
  }

  // 순서대로 정렬하고 연속성 체크
  circledChoices.sort((a, b) => a.num - b.num);
  const result: string[] = [];
  for (let i = 0; i < circledChoices.length; i++) {
    if (circledChoices[i].num === i && circledChoices[i].text) {
      result.push(circledChoices[i].text);
    } else {
      break;
    }
  }

  if (result.length >= 2) {
    console.log(`[extractInlineChoices] 원숫자 선지 ${result.length}개 추출`);
    return result;
  }

  // 숫자. 패턴 (1.가나다 2.라마바...)
  const numberedPattern = /(\d)[.．]\s*([^\d\n.．]+?)(?=\s*\d[.．]|\s*$)/g;
  const numberedChoices: { num: number; text: string }[] = [];

  while ((match = numberedPattern.exec(text)) !== null) {
    const num = parseInt(match[1], 10) - 1; // 0-indexed
    const content = match[2].trim();
    if (num >= 0 && num < 8 && content) {
      numberedChoices.push({ num, text: content });
    }
  }

  numberedChoices.sort((a, b) => a.num - b.num);
  const result2: string[] = [];
  for (let i = 0; i < numberedChoices.length; i++) {
    if (numberedChoices[i].num === i && numberedChoices[i].text) {
      result2.push(numberedChoices[i].text);
    } else {
      break;
    }
  }

  if (result2.length >= 2) {
    console.log(`[extractInlineChoices] 숫자 선지 ${result2.length}개 추출`);
    return result2;
  }

  return null;
};

/**
 * 각주 추출
 * * 용어: 설명 형식의 각주를 추출
 */
export const extractFootnotes = (text: string): Footnote[] => {
  const footnotes: Footnote[] = [];
  const pattern = /\*\s*([^:：\n]+)\s*[:：]\s*([^\n]+)/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    footnotes.push({
      term: match[1].trim(),
      definition: match[2].trim(),
    });
  }

  return footnotes;
};

/**
 * 하위 제시문 분리
 * (A), (B), (C), (D) 형식의 하위 제시문을 분리
 */
export const extractSubPassages = (text: string): SubPassage[] => {
  const subPassages: SubPassage[] = [];
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];

  // (A), (B)... 패턴 위치 찾기
  const positions: { index: number; label: string }[] = [];
  for (const label of labels) {
    const pattern = new RegExp(`\\(${label}\\)`, 'g');
    let match;
    while ((match = pattern.exec(text)) !== null) {
      positions.push({ index: match.index, label });
    }
  }

  // 위치순 정렬
  positions.sort((a, b) => a.index - b.index);

  // 각 제시문 추출
  for (let i = 0; i < positions.length; i++) {
    const current = positions[i];
    const next = positions[i + 1];

    const startIdx = current.index + 3; // (A) 다음부터
    const endIdx = next ? next.index : text.length;

    const content = text.slice(startIdx, endIdx).trim();
    if (content) {
      subPassages.push({
        label: current.label,
        content,
      });
    }
  }

  return subPassages;
};

// ============================================================
// 보기(Examples) 감지 및 추출 함수
// ============================================================

/**
 * 한글 자음 라벨 (ㄱ, ㄴ, ㄷ...)
 */
export const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/**
 * ㄱ.ㄴ.ㄷ. 형식의 보기 감지 및 추출
 * @param text - 검사할 텍스트
 * @returns ExamplesData 또는 null
 */
export const extractKoreanLabeledExamples = (text: string): ExamplesData | null => {
  const items: string[] = [];

  // ㄱ. 내용, ㄴ. 내용 형식 감지
  // 패턴: ㄱ. 또는 ㄱ) 또는 ㄱ: 다음에 내용
  const pattern = /([ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ])\s*[.):\s]\s*([^\nㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ]+)/g;
  let match;
  const foundLabels: string[] = [];

  while ((match = pattern.exec(text)) !== null) {
    const label = match[1];
    const content = match[2].trim();

    // 순서대로 나와야 함 (ㄱ -> ㄴ -> ㄷ)
    const expectedIndex = foundLabels.length;
    if (expectedIndex < KOREAN_LABELS.length && label === KOREAN_LABELS[expectedIndex]) {
      if (content && content.length > 0) {
        items.push(content);
        foundLabels.push(label);
      }
    }
  }

  // 최소 2개 이상의 보기가 있어야 유효
  if (items.length >= 2) {
    return {
      type: 'labeled',
      items,
    };
  }

  return null;
};

/**
 * <보기> 블록 형식의 텍스트 보기 추출
 * @param text - 검사할 텍스트
 * @returns ExamplesData 또는 null
 */
export const extractTextBoxExamples = (text: string): ExamplesData | null => {
  // <보기>, [보기], 【보기】, ※ 보기 등의 패턴
  const boxPatterns = [
    /<보기>([\s\S]*?)(?:<\/보기>|(?=\n\s*[①②③④⑤⑥⑦⑧\d]|\n\s*[ㄱㄴㄷ]|\n\s*문제|\n\s*Q\d|$))/i,
    /\[보기\]([\s\S]*?)(?:\[\/보기\]|(?=\n\s*[①②③④⑤⑥⑦⑧\d]|\n\s*[ㄱㄴㄷ]|\n\s*문제|\n\s*Q\d|$))/i,
    /【보기】([\s\S]*?)(?:【\/보기】|(?=\n\s*[①②③④⑤⑥⑦⑧\d]|\n\s*[ㄱㄴㄷ]|\n\s*문제|\n\s*Q\d|$))/i,
    /※\s*보기\s*[:：]?\s*([\s\S]*?)(?=\n\s*[①②③④⑤⑥⑦⑧\d]|\n\s*[ㄱㄴㄷ]|\n\s*문제|\n\s*Q\d|$)/i,
    /보기\s*[:：]\s*([\s\S]*?)(?=\n\s*[①②③④⑤⑥⑦⑧\d]|\n\s*[ㄱㄴㄷ]|\n\s*문제|\n\s*Q\d|$)/i,
  ];

  for (const pattern of boxPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const content = match[1].trim();
      if (content.length > 5) { // 최소 길이 체크
        return {
          type: 'text',
          items: [content],
        };
      }
    }
  }

  return null;
};

/**
 * 보기(Examples) 통합 추출
 * 텍스트에서 보기를 감지하고 적절한 형식으로 반환
 * @param text - 검사할 텍스트
 * @returns ExamplesData 또는 null
 */
export const extractExamples = (text: string): ExamplesData | null => {
  // 1. 먼저 ㄱ.ㄴ.ㄷ. 형식 시도
  const labeledExamples = extractKoreanLabeledExamples(text);
  if (labeledExamples) {
    return labeledExamples;
  }

  // 2. 텍스트 박스 형식 시도
  const textBoxExamples = extractTextBoxExamples(text);
  if (textBoxExamples) {
    return textBoxExamples;
  }

  return null;
};

/**
 * 텍스트에서 보기 영역 제거
 * @param text - 원본 텍스트
 * @returns 보기가 제거된 텍스트
 */
export const removeExamplesFromText = (text: string): string => {
  let result = text;

  // <보기> 블록 제거
  const boxPatterns = [
    /<보기>[\s\S]*?(?:<\/보기>|(?=\n\s*[①②③④⑤⑥⑦⑧\d]|\n\s*[ㄱㄴㄷ]|\n\s*문제|\n\s*Q\d|$))/gi,
    /\[보기\][\s\S]*?(?:\[\/보기\]|(?=\n\s*[①②③④⑤⑥⑦⑧\d]|\n\s*[ㄱㄴㄷ]|\n\s*문제|\n\s*Q\d|$))/gi,
    /【보기】[\s\S]*?(?:【\/보기】|(?=\n\s*[①②③④⑤⑥⑦⑧\d]|\n\s*[ㄱㄴㄷ]|\n\s*문제|\n\s*Q\d|$))/gi,
  ];

  for (const pattern of boxPatterns) {
    result = result.replace(pattern, '');
  }

  // ㄱ.ㄴ.ㄷ. 형식 제거 (선지 앞에 있는 경우)
  result = result.replace(/([ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ])\s*[.):\s]\s*[^\n]+(?=\n|$)/g, '');

  return result.trim();
};

// ============================================================
// 결합형 문제 하위 문제 파싱
// ============================================================

/**
 * 결합형 문제의 하위 문제 파싱
 * @param text - 결합형 문제 전체 텍스트
 * @param startNum - 시작 문제 번호
 * @param endNum - 끝 문제 번호
 * @returns 파싱된 하위 문제 배열
 */
export const parseSubQuestions = (
  text: string,
  startNum: number,
  endNum: number
): ParsedSubQuestion[] => {
  const subQuestions: ParsedSubQuestion[] = [];

  // 하위 문제 번호 패턴 (36-1, 36-2 또는 (1), (2) 또는 가., 나. 등)
  const subPatterns = [
    // 36-1, 36-2 형식
    new RegExp(`(${startNum})\\s*-\\s*(\\d+)`, 'g'),
    // (가), (나), (다) 형식
    /\(([가나다라마바사아])\)/g,
    // 가., 나., 다. 형식
    /([가나다라마바사아])\s*[.)]/g,
    // (1), (2), (3) 형식 (선지와 구분 필요)
    /^\s*\((\d)\)\s*(?=[가-힣])/gm,
  ];

  // 먼저 하위 문제 위치 찾기
  const positions: { index: number; label: string; id: string }[] = [];

  for (const pattern of subPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const label = match[2] || match[1];
      positions.push({
        index: match.index,
        label,
        id: `sub_${label}`,
      });
    }
    pattern.lastIndex = 0; // 패턴 리셋
  }

  // 중복 제거 및 정렬
  const uniquePositions = positions
    .filter((pos, idx, arr) =>
      arr.findIndex(p => Math.abs(p.index - pos.index) < 5) === idx
    )
    .sort((a, b) => a.index - b.index);

  // 각 하위 문제 파싱
  for (let i = 0; i < uniquePositions.length; i++) {
    const current = uniquePositions[i];
    const next = uniquePositions[i + 1];

    const startIdx = current.index;
    const endIdx = next ? next.index : text.length;
    const subText = text.slice(startIdx, endIdx).trim();

    // 하위 문제 유형 판별
    let type: 'ox' | 'multiple' | 'short_answer' = 'short_answer';
    let choices: string[] | undefined;
    let answerIndex: number | undefined;
    let answerIndices: number[] | undefined;
    let answerText: string | undefined;
    let examples: ExamplesData | undefined;

    // OX 패턴 체크
    if (/[OoXx○×]\s*[,/|]\s*[OoXx○×]|참\s*[,/|]\s*거짓/i.test(subText)) {
      type = 'ox';
    } else {
      // 선지 추출 시도
      choices = extractCircledChoices(subText) ?? extractParenChoices(subText) ?? undefined;
      if (choices && choices.length >= 2) {
        type = 'multiple';
      }
    }

    // 보기 추출
    const extractedExamples = extractExamples(subText);
    if (extractedExamples) {
      examples = extractedExamples;
    }

    // 정답 추출
    const answerMatch = subText.match(/(?:정답|답)[\s:：]+([^\n]+)/i);
    if (answerMatch) {
      const answerValue = answerMatch[1].trim();
      if (type === 'multiple') {
        // 복수 정답 체크 (①②, 1,2 등)
        const multipleAnswers = answerValue.match(/[①②③④⑤⑥⑦⑧]/g);
        if (multipleAnswers && multipleAnswers.length > 1) {
          const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
          answerIndices = multipleAnswers.map(a => circledNumbers.indexOf(a));
        } else if (/^[①②③④⑤⑥⑦⑧]$/.test(answerValue)) {
          const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
          answerIndex = circledNumbers.indexOf(answerValue);
        } else if (/^\d$/.test(answerValue)) {
          answerIndex = parseInt(answerValue, 10) - 1;
        }
      } else if (type === 'ox') {
        if (/[Oo○]/.test(answerValue)) {
          answerIndex = 0; // O
        } else if (/[Xx×]/.test(answerValue)) {
          answerIndex = 1; // X
        }
      } else {
        answerText = answerValue;
      }
    }

    // 문제 텍스트 정리 (라벨, 정답, 선지 제거)
    let cleanedText = subText
      .replace(/^[\s\d\-()가나다라마바사아.]+/, '') // 라벨 제거
      .replace(/(?:정답|답)[\s:：]+[^\n]+/gi, '') // 정답 제거
      .trim();

    // 선지가 있으면 선지 전까지만
    if (choices) {
      const firstChoiceMatch = cleanedText.match(/[①②③④⑤⑥⑦⑧\(1\)]/);
      if (firstChoiceMatch && firstChoiceMatch.index !== undefined && firstChoiceMatch.index > 0) {
        cleanedText = cleanedText.slice(0, firstChoiceMatch.index).trim();
      }
    }

    subQuestions.push({
      id: current.id,
      text: cleanedText || `하위 문제 ${current.label}`,
      type,
      choices,
      answerIndex,
      answerIndices,
      answerText,
      examples,
    });
  }

  return subQuestions;
};

/**
 * 결합형 문제의 공통 제시문 추출
 * @param text - 결합형 문제 텍스트
 * @returns 공통 제시문 데이터
 */
export const extractCombinedPassage = (text: string): {
  passageType: 'text' | 'korean_abc';
  passage?: string;
  koreanAbcItems?: string[];
} | null => {
  // 1. ㄱㄴㄷ 형식의 공통 보기 체크
  const koreanExamples = extractKoreanLabeledExamples(text);
  if (koreanExamples && koreanExamples.items.length >= 2) {
    return {
      passageType: 'korean_abc',
      koreanAbcItems: koreanExamples.items,
    };
  }

  // 2. 텍스트 형식의 공통 제시문 체크
  // [공통 제시문], <제시문>, 다음 글을 읽고 등의 패턴
  const passagePatterns = [
    /\[공통\s*지문\]([\s\S]*?)(?=\n\s*\d+\s*[-.)번]|\n\s*\([가나다]\)|\n\s*[가나다]\s*[.).])/i,
    /<지문>([\s\S]*?)<\/지문>/i,
    /【지문】([\s\S]*?)(?=\n\s*\d+\s*[-.)번]|\n\s*\([가나다]\)|\n\s*[가나다]\s*[.).])/i,
    /다음\s+글을\s+읽고[\s\S]*?(?:물음에\s+답하시오|답하시오)[.。]?\s*([\s\S]*?)(?=\n\s*\d+\s*[-.)번]|\n\s*\([가나다]\)|\n\s*[가나다]\s*[.).])/i,
  ];

  for (const pattern of passagePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const passage = match[1].trim();
      if (passage.length > 10) {
        return {
          passageType: 'text',
          passage,
        };
      }
    }
  }

  // 3. 첫 번째 하위 문제 전까지를 공통 제시문으로 처리
  const firstSubMatch = text.match(/\n\s*(\d+)\s*[-.)]\s*\d|\n\s*\([가나다]\)|\n\s*[가나다]\s*[.)]/);
  if (firstSubMatch && firstSubMatch.index !== undefined && firstSubMatch.index > 50) {
    const passage = text.slice(0, firstSubMatch.index).trim();
    // 문제 번호 부분 제거
    const cleanedPassage = passage.replace(/^[\s\d.)\-]+/, '').trim();
    if (cleanedPassage.length > 20) {
      return {
        passageType: 'text',
        passage: cleanedPassage,
      };
    }
  }

  return null;
};

/**
 * 문제 유효성 검사
 */
export const validateQuestion = (question: ParsedQuestion): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 필수 검사: 문제 텍스트
  if (!question.text || question.text.trim().length < 5) {
    errors.push('문제 텍스트가 너무 짧습니다.');
  }

  // 객관식 검사
  if (question.type === 'multiple') {
    if (!question.choices || question.choices.length < 2) {
      errors.push('객관식 문제에는 최소 2개의 선지가 필요합니다.');
    } else if (question.choices.length > 8) {
      warnings.push('선지가 8개를 초과합니다. 일부가 잘못 인식되었을 수 있습니다.');
    }

    // 빈 선지 검사
    if (question.choices?.some(c => !c.trim())) {
      warnings.push('빈 선지가 있습니다.');
    }
  }

  // OX 문제 검사
  if (question.type === 'ox') {
    // OX 문제는 선지가 없어야 함
    if (question.choices && question.choices.length > 0) {
      warnings.push('OX 문제에 선지가 포함되어 있습니다.');
    }
  }

  // 문제 텍스트 품질 검사
  if (question.text) {
    // 너무 많은 특수문자
    const specialCharRatio = (question.text.match(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ]/g) || []).length / question.text.length;
    if (specialCharRatio > 0.3) {
      warnings.push('OCR 인식 품질이 낮을 수 있습니다.');
    }

    // 깨진 문자 감지
    if (/[�□■◆◇]/.test(question.text)) {
      warnings.push('일부 문자가 제대로 인식되지 않았을 수 있습니다.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
};

/**
 * 파싱 결과 전체 유효성 검사
 */
export const validateParseResult = (result: ParseResult): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (result.questions.length === 0) {
    errors.push('파싱된 문제가 없습니다.');
    return { isValid: false, errors, warnings };
  }

  // 각 문제 검사
  result.questions.forEach((q, idx) => {
    const validation = validateQuestion(q);
    if (!validation.isValid) {
      errors.push(`문제 ${idx + 1}: ${validation.errors.join(', ')}`);
    }
    if (validation.warnings.length > 0) {
      warnings.push(`문제 ${idx + 1}: ${validation.warnings.join(', ')}`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
};

// ============================================================
// OCR Worker 관리
// ============================================================

// Tesseract Worker 인스턴스 (lazy load)
let worker: Tesseract.Worker | null = null;
let isWorkerInitialized = false;

/**
 * OCR Worker 초기화
 * 한국어 + 영어 인식을 위해 kor+eng 언어팩 사용
 */
export const initializeOCRWorker = async (): Promise<void> => {
  if (isWorkerInitialized && worker) {
    return;
  }

  try {
    // Worker 생성 (lazy load)
    worker = await Tesseract.createWorker('kor+eng', 1, {
      logger: (m) => {
        // 진행 상태 로깅 (디버그용)
        if (process.env.NODE_ENV === 'development') {
          console.log('[OCR]', m);
        }
      },
    });

    isWorkerInitialized = true;
  } catch (error) {
    console.error('OCR Worker 초기화 실패:', error);
    throw new Error('OCR 엔진을 초기화할 수 없습니다.');
  }
};

/**
 * OCR Worker 종료
 */
export const terminateOCRWorker = async (): Promise<void> => {
  if (worker) {
    await worker.terminate();
    worker = null;
    isWorkerInitialized = false;
  }
};

// ============================================================
// OCR 처리 함수
// ============================================================

/**
 * 이미지를 Canvas에 로드
 */
const loadImageToCanvas = (source: string): Promise<HTMLCanvasElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context 생성 실패'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = source;
  });
};

/**
 * 이미지를 좌/우로 분할하여 각각 OCR 후 합치기
 * 2단 레이아웃 시험지 처리용
 */
const extractTextFromTwoColumnImage = async (
  canvas: HTMLCanvasElement,
  onProgress?: (progress: OCRProgress) => void
): Promise<{ text: string; confidence: number }> => {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context 생성 실패');

  const width = canvas.width;
  const height = canvas.height;
  const halfWidth = Math.floor(width / 2);

  // 왼쪽 절반 추출
  const leftCanvas = document.createElement('canvas');
  leftCanvas.width = halfWidth;
  leftCanvas.height = height;
  const leftCtx = leftCanvas.getContext('2d');
  if (!leftCtx) throw new Error('Left canvas context 생성 실패');
  leftCtx.drawImage(canvas, 0, 0, halfWidth, height, 0, 0, halfWidth, height);

  // 오른쪽 절반 추출
  const rightCanvas = document.createElement('canvas');
  rightCanvas.width = width - halfWidth;
  rightCanvas.height = height;
  const rightCtx = rightCanvas.getContext('2d');
  if (!rightCtx) throw new Error('Right canvas context 생성 실패');
  rightCtx.drawImage(canvas, halfWidth, 0, width - halfWidth, height, 0, 0, width - halfWidth, height);

  onProgress?.({ progress: 20, status: '왼쪽 영역 인식 중...' });

  // 왼쪽 OCR
  const leftDataUrl = leftCanvas.toDataURL('image/png');
  const leftResult = await worker!.recognize(leftDataUrl);

  onProgress?.({ progress: 60, status: '오른쪽 영역 인식 중...' });

  // 오른쪽 OCR
  const rightDataUrl = rightCanvas.toDataURL('image/png');
  const rightResult = await worker!.recognize(rightDataUrl);

  // 캔버스 정리
  leftCanvas.remove();
  rightCanvas.remove();

  // 텍스트 합치기 (왼쪽 먼저, 오른쪽 다음)
  const combinedText = leftResult.data.text + '\n\n' + rightResult.data.text;
  const avgConfidence = (leftResult.data.confidence + rightResult.data.confidence) / 2;

  return {
    text: combinedText,
    confidence: avgConfidence,
  };
};

/**
 * 이미지가 2단 레이아웃인지 감지
 *
 * 2단 레이아웃 추정 조건:
 * 1. 가로가 넓은 이미지 (책 펼침 스캔, 가로 사진)
 * 2. 충분히 큰 세로 이미지 (A4 시험지 2단 스캔)
 * 3. 시험지 크기의 이미지 (스캔 또는 사진)
 */
const isTwoColumnLayout = (width: number, height: number): boolean => {
  const aspectRatio = width / height;

  // 케이스 1: 가로가 넓은 이미지 (책 펼침, 2페이지 스캔)
  // 비율 1.2 이상이면 확실히 2단
  if (aspectRatio > 1.2) {
    console.log('[isTwoColumnLayout] 가로형 이미지 → 2단 판정');
    return true;
  }

  // 케이스 2: 세로 이미지이지만 충분히 넓은 경우
  // A4 시험지를 스캔하면 보통 2000x3000 픽셀 정도
  // 가로 700px 이상이면 2단 시험지일 가능성 높음
  if (width >= 700 && height >= 900) {
    console.log(`[isTwoColumnLayout] 큰 세로 이미지 (${width}x${height}) → 2단 판정`);
    return true;
  }

  // 케이스 3: 중간 크기 이미지이지만 문서 비율
  // 세로가 가로의 1.2~1.6배 (A4 비율 근처)이고 적당한 크기
  if (aspectRatio >= 0.6 && aspectRatio <= 0.85 && width >= 500) {
    console.log(`[isTwoColumnLayout] 문서 비율 이미지 (비율: ${aspectRatio.toFixed(2)}) → 2단 판정`);
    return true;
  }

  console.log(`[isTwoColumnLayout] 1단 판정 (${width}x${height}, 비율: ${aspectRatio.toFixed(2)})`);
  return false;
};

/**
 * 이미지에서 텍스트 추출
 * 2단 레이아웃 자동 감지 및 처리
 *
 * @param imageSource - 이미지 파일, URL, 또는 base64 문자열
 * @param onProgress - 진행 상태 콜백 (선택)
 * @param forceTwoColumn - 강제로 2단 처리 (선택)
 * @returns OCR 결과
 */
export const extractTextFromImage = async (
  imageSource: File | string,
  onProgress?: (progress: OCRProgress) => void,
  forceTwoColumn?: boolean
): Promise<OCRResult> => {
  try {
    // Worker 초기화 확인
    if (!isWorkerInitialized || !worker) {
      onProgress?.({ progress: 0, status: 'OCR 엔진 초기화 중...' });
      await initializeOCRWorker();
    }

    onProgress?.({ progress: 10, status: '이미지 분석 중...' });

    // 이미지 소스 준비
    let source: string;

    if (imageSource instanceof File) {
      source = URL.createObjectURL(imageSource);
    } else {
      source = imageSource;
    }

    // 이미지를 Canvas에 로드하여 크기 확인
    const canvas = await loadImageToCanvas(source);
    const { width, height } = canvas;

    console.log(`[OCR] 이미지 크기: ${width}x${height}, 비율: ${(width/height).toFixed(2)}`);

    let text: string;
    let confidence: number;

    // 2단 레이아웃 처리
    if (forceTwoColumn || isTwoColumnLayout(width, height)) {
      console.log('[OCR] 2단 레이아웃 감지, 분할 처리');
      onProgress?.({ progress: 15, status: '2단 레이아웃 감지, 분할 처리 중...' });

      const result = await extractTextFromTwoColumnImage(canvas, onProgress);
      text = result.text;
      confidence = result.confidence;
    } else {
      console.log('[OCR] 1단 레이아웃, 일반 처리');
      onProgress?.({ progress: 20, status: '텍스트 인식 중...' });

      const result = await worker!.recognize(canvas.toDataURL('image/png'));
      text = result.data.text;
      confidence = result.data.confidence;
    }

    onProgress?.({ progress: 90, status: '결과 처리 중...' });

    // 캔버스 정리
    canvas.remove();

    // URL 해제 (메모리 정리)
    if (imageSource instanceof File) {
      URL.revokeObjectURL(source);
    }

    onProgress?.({ progress: 100, status: '완료!' });

    return {
      text,
      confidence,
    };
  } catch (error) {
    console.error('OCR 처리 실패:', error);
    return {
      text: '',
      confidence: 0,
      error: error instanceof Error ? error.message : 'OCR 처리 중 오류가 발생했습니다.',
    };
  }
};

/**
 * PDF에서 텍스트 추출
 * PDF.js를 사용하여 각 페이지를 이미지로 변환 후 OCR 처리
 *
 * @param pdfFile - PDF 파일
 * @param onProgress - 진행 상태 콜백 (선택)
 * @returns OCR 결과
 */
export const extractTextFromPDF = async (
  pdfFile: File,
  onProgress?: (progress: OCRProgress) => void
): Promise<OCRResult> => {
  try {
    onProgress?.({ progress: 0, status: 'PDF 처리 준비 중...' });

    // PDF.js 동적 로드
    const pdfjsLib = await import('pdfjs-dist');

    // PDF.js 워커 설정 (unpkg CDN 사용 - 더 안정적)
    // pdfjs-dist 4.x 버전용
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

    // PDF 파일을 ArrayBuffer로 변환
    const arrayBuffer = await pdfFile.arrayBuffer();

    onProgress?.({ progress: 10, status: 'PDF 로딩 중...' });

    // PDF 문서 로드
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;

    let fullText = '';
    let totalConfidence = 0;

    // 각 페이지 처리
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const progressBase = 10 + ((pageNum - 1) / totalPages) * 80;
      onProgress?.({
        progress: progressBase,
        status: `페이지 ${pageNum}/${totalPages} 처리 중...`,
      });

      // 페이지 가져오기
      const page = await pdf.getPage(pageNum);

      // 캔버스에 렌더링
      const scale = 2; // 고해상도를 위해 2배 스케일
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      // 캔버스를 이미지로 변환하여 OCR 처리
      const imageData = canvas.toDataURL('image/png');
      const result = await extractTextFromImage(imageData);

      if (result.text) {
        fullText += `\n[페이지 ${pageNum}]\n${result.text}\n`;
        totalConfidence += result.confidence;
      }

      // 캔버스 정리
      canvas.remove();
    }

    onProgress?.({ progress: 100, status: '완료!' });

    return {
      text: fullText.trim(),
      confidence: totalPages > 0 ? totalConfidence / totalPages : 0,
    };
  } catch (error) {
    console.error('PDF OCR 처리 실패:', error);
    return {
      text: '',
      confidence: 0,
      error: error instanceof Error ? error.message : 'PDF 처리 중 오류가 발생했습니다.',
    };
  }
};

// ============================================================
// 문제 파싱 함수
// ============================================================

/**
 * 추출된 텍스트에서 문제를 파싱 (개선된 버전)
 *
 * 다양한 형식의 문제를 인식합니다:
 * - "1.", "1)", "1번", "문제 1" 등의 문제 번호
 * - "O/X", "OX", "참/거짓" 등의 OX 문제
 * - "①②③④⑤", "(1)(2)(3)(4)(5)" 등의 객관식 선지
 * - "[36~37]" 형식의 결합형 문제 자동 감지
 * - "정답:", "답:" 등의 정답 표시
 * - "* 용어: 설명" 형식의 각주
 *
 * @param text - 추출된 텍스트
 * @param options - 파싱 옵션
 * @returns 파싱 결과
 */
export const parseQuestions = (
  text: string,
  options: { preprocess?: boolean } = { preprocess: true }
): ParseResult => {
  const questions: ParsedQuestion[] = [];

  console.log('[parseQuestions] 입력 텍스트 길이:', text.length);

  // 텍스트가 비어있는 경우
  if (!text.trim()) {
    return {
      questions: [],
      rawText: text,
      success: false,
      message: '추출된 텍스트가 없습니다.',
    };
  }

  try {
    // 1. 전처리 적용 (옵션)
    const processedText = options.preprocess ? preprocessOCRText(text) : text;

    console.log('[parseQuestions] 전처리 후 텍스트 (처음 1000자):', processedText.slice(0, 1000));

    // 2. 각주 추출 (문제 파싱 전에 추출해서 나중에 활용 가능)
    const footnotes = extractFootnotes(processedText);

    // 3. 결합형 문제 범위 감지
    const combinedRange = detectCombinedQuestionRange(processedText);
    console.log('[parseQuestions] 결합형 범위:', combinedRange);

    // 문제 번호 패턴 - 다양한 형식 지원
    // "1.", "1)", "1번", "(1)", "[1]", "【1】", "문1.", "Q1.", "[16~17]" 등
    const questionPattern = /(?:^|\n)\s*(?:문제?\s*)?(?:Q\.?\s*)?(?:\[(\d+)\s*[~～\-]\s*\d+\]|\[(\d+)\]|【(\d+)】|\((\d+)\)|(\d+)\s*[.．\):\), 번])\s*/gmi;

    // OX 문제 패턴 - CLOVA OCR에 맞게 확장
    const oxPatterns = [
      /[OoXx○×]\s*[,/|]\s*[OoXx○×]/i,  // O/X, O,X 등
      /참\s*[,/|]\s*거짓/i,              // 참/거짓
      /True\s*[,/|]\s*False/i,           // True/False
      /맞으면\s*O.*틀리면\s*X/i,          // 맞으면 O, 틀리면 X
      /옳으면\s*O.*틀리면\s*X/i,          // 옳으면 O, 틀리면 X
      /\(?\s*[OoXx○×]\s*[,/]\s*[OoXx○×]\s*\)?/i, // (O/X), (O, X)
      /맞[는으]?\s*(것|면)[은를]?\s*O/i,   // 맞는 것은 O
      /틀린\s*(것|면)[은를]?\s*X/i,       // 틀린 것은 X
      /옳[은고]\s*것[을은]?\s*모두/i,     // 옳은 것을 모두 → OX일 수 있음
    ];

    // 정답 패턴 - 더 다양한 형식 지원
    const answerPattern = /(?:정답|답|답안|Answer|Ans|정답란)[\s:：=]*([^\n]+)/i;

    // 해설 패턴
    const explanationPattern = /(?:해설|설명|풀이|Explanation)[\s:：]+([^\n]+(?:\n(?![문제Q\d])[^\n]+)*)/i;

    // 문제 분리
    const matches = [...processedText.matchAll(questionPattern)];

    console.log('[parseQuestions] 찾은 문제 번호 수:', matches.length);
    matches.forEach((m, i) => {
      // 여러 캡처 그룹 중 매칭된 것 찾기
      const num = m[1] || m[2] || m[3] || m[4] || m[5];
      console.log(`[parseQuestions] 문제 ${i + 1}: 번호=${num}, 위치=${m.index}, 매치="${m[0].slice(0, 20)}..."`);
    });

    if (matches.length === 0) {
      // 문제 번호가 없으면 줄 단위로 분리 시도
      const lines = processedText
        .split(/\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 10);

      if (lines.length > 0) {
        lines.forEach((line) => {
          questions.push({
            text: line,
            type: 'short_answer', // 기본값은 단답형
          });
        });

        return {
          questions,
          rawText: text,
          success: true,
          message: `${questions.length}개의 문장을 발견했습니다. 문제 형식을 확인해주세요.`,
        };
      }

      return {
        questions: [],
        rawText: text,
        success: false,
        message: '문제 형식을 인식할 수 없습니다. 직접 입력해주세요.',
      };
    }

    // 각 문제 파싱
    for (let i = 0; i < matches.length; i++) {
      const currentMatch = matches[i];
      const nextMatch = matches[i + 1];
      // 여러 캡처 그룹 중 매칭된 것에서 번호 추출
      const numStr = currentMatch[1] || currentMatch[2] || currentMatch[3] || currentMatch[4] || currentMatch[5];
      const questionNumber = parseInt(numStr, 10);

      const startIndex = currentMatch.index! + currentMatch[0].length;
      const endIndex = nextMatch ? nextMatch.index! : processedText.length;

      const questionText = processedText.slice(startIndex, endIndex).trim();

      // 문제 유형 판별
      let type: QuestionType = 'short_answer';
      let choices: string[] | undefined;
      let answer: string | number | undefined;
      let answerIndices: number[] | undefined;
      let hasMultipleAnswers = false;
      let explanation: string | undefined;
      let examples: ExamplesData | undefined;
      let passageType: 'text' | 'korean_abc' | undefined;
      let passage: string | undefined;
      let koreanAbcItems: string[] | undefined;
      let subQuestions: ParsedSubQuestion[] | undefined;

      // 결합형 문제 확인 (범위 내에 있는 경우)
      if (combinedRange && questionNumber >= combinedRange.start && questionNumber <= combinedRange.end) {
        type = 'combined';

        // 공통 제시문 추출
        const passageData = extractCombinedPassage(questionText);
        if (passageData) {
          passageType = passageData.passageType;
          if (passageData.passageType === 'text') {
            passage = passageData.passage;
          } else {
            koreanAbcItems = passageData.koreanAbcItems;
          }
        }

        // 하위 문제 파싱
        subQuestions = parseSubQuestions(questionText, combinedRange.start, combinedRange.end);

        // 하위 문제가 없으면 하위 제시문이라도 추출
        if (!subQuestions || subQuestions.length === 0) {
          const subPassages = extractSubPassages(questionText);
          if (subPassages.length > 0) {
            explanation = `[하위 제시문]\n${subPassages.map(sp => `(${sp.label}) ${sp.content}`).join('\n')}`;
          }
        }
      }
      // OX 문제 확인
      else if (oxPatterns.some(pattern => pattern.test(questionText))) {
        type = 'ox';
      }
      // 객관식 선지 확인 (개선된 추출 - 여러 fallback 시도)
      else {
        console.log(`[parseQuestions] 문제 ${questionNumber}: 선지 추출 시도`);
        console.log(`[parseQuestions] 문제 텍스트 (처음 500자): "${questionText.slice(0, 500)}"`);

        // 1. 원숫자 선지 시도 (①②③④⑤)
        choices = extractCircledChoices(questionText) ?? undefined;
        console.log(`[parseQuestions] 1. 원숫자 선지 결과:`, choices?.length ?? 0);

        // 2. 한 줄 인라인 선지 시도 (① 가 ② 나 ③ 다...)
        if (!choices) {
          choices = extractInlineChoices(questionText) ?? undefined;
          console.log(`[parseQuestions] 2. 인라인 선지 결과:`, choices?.length ?? 0);
        }

        // 3. 괄호 숫자 선지 시도 ((1)(2)(3)...)
        if (!choices) {
          choices = extractParenChoices(questionText) ?? undefined;
          console.log(`[parseQuestions] 3. 괄호 선지 결과:`, choices?.length ?? 0);
        }

        // 4. 숫자 목록 선지 시도 (1. 2. 3. 또는 1, 2, 3,)
        if (!choices) {
          choices = extractNumberedListChoices(questionText) ?? undefined;
          console.log(`[parseQuestions] 4. 숫자 목록 선지 결과:`, choices?.length ?? 0);
        }

        if (choices && choices.length >= 2) {
          type = 'multiple';
          console.log(`[parseQuestions] 문제 ${questionNumber}: 객관식으로 판정, 선지 ${choices.length}개`);
        } else {
          console.log(`[parseQuestions] 문제 ${questionNumber}: 선지 없음, 주관식으로 판정`);
          choices = undefined;
        }
      }

      // 보기(Examples) 추출 (결합형이 아닌 경우)
      if (type !== 'combined') {
        examples = extractExamples(questionText) ?? undefined;
      }

      // 정답 추출
      const answerMatch = questionText.match(answerPattern);
      if (answerMatch) {
        const answerValue = answerMatch[1].trim();

        // 복수 정답 체크 (①②, 1,2 등)
        if (type === 'multiple') {
          const multipleAnswerMatches = answerValue.match(/[①②③④⑤⑥⑦⑧]/g);
          if (multipleAnswerMatches && multipleAnswerMatches.length > 1) {
            const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
            answerIndices = multipleAnswerMatches.map(a => circledNumbers.indexOf(a));
            hasMultipleAnswers = true;
          } else if (/^[①②③④⑤⑥⑦⑧]$/.test(answerValue)) {
            const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
            answer = circledNumbers.indexOf(answerValue);
          } else if (/^\d$/.test(answerValue)) {
            answer = parseInt(answerValue, 10) - 1; // 0-based index
          } else {
            // 쉼표로 구분된 복수 정답 (1, 2, 3)
            const commaAnswers = answerValue.match(/\d/g);
            if (commaAnswers && commaAnswers.length > 1) {
              answerIndices = commaAnswers.map(a => parseInt(a, 10) - 1);
              hasMultipleAnswers = true;
            } else {
              answer = answerValue;
            }
          }
        } else if (type === 'ox') {
          // OX 정답
          if (/[Oo○참]/.test(answerValue)) {
            answer = 0; // O
          } else if (/[Xx×거짓]/.test(answerValue)) {
            answer = 1; // X
          }
        } else {
          answer = answerValue;
        }
      }

      // 해설 추출
      const explanationMatch = questionText.match(explanationPattern);
      if (explanationMatch) {
        const existingExplanation = explanation || '';
        explanation = existingExplanation
          ? `${existingExplanation}\n\n[해설] ${explanationMatch[1].trim()}`
          : explanationMatch[1].trim();
      }

      // 문제 텍스트에서 정답/해설/선지/보기 부분 제거
      let cleanedText = questionText
        .replace(answerPattern, '')
        .replace(explanationPattern, '')
        .trim();

      // 보기 영역 제거
      if (examples) {
        cleanedText = removeExamplesFromText(cleanedText);
      }

      // 선지가 있는 경우 문제와 선지 분리
      if (type === 'multiple' && choices) {
        // 첫 번째 선지 시작점 찾기
        const firstChoicePatterns = [
          /[①②③④⑤⑥⑦⑧]/,
          /\([1-8]\)/,
        ];

        for (const pattern of firstChoicePatterns) {
          const match = cleanedText.match(pattern);
          if (match && match.index !== undefined && match.index > 0) {
            cleanedText = cleanedText.slice(0, match.index).trim();
            break;
          }
        }
      }

      // 관련 각주 찾기
      const relevantFootnotes = footnotes.filter(fn =>
        questionText.includes(fn.term) || cleanedText.includes(fn.term)
      );

      if (relevantFootnotes.length > 0) {
        const footnoteText = relevantFootnotes
          .map(fn => `* ${fn.term}: ${fn.definition}`)
          .join('\n');
        explanation = explanation
          ? `${explanation}\n\n[각주]\n${footnoteText}`
          : `[각주]\n${footnoteText}`;
      }

      // ParsedQuestion 객체 생성
      const parsedQuestion: ParsedQuestion = {
        text: cleanedText || questionText,
        type,
        choices,
        answer,
        explanation,
      };

      // 선택적 필드 추가
      if (answerIndices && answerIndices.length > 0) {
        parsedQuestion.answerIndices = answerIndices;
      }
      if (hasMultipleAnswers) {
        parsedQuestion.hasMultipleAnswers = true;
      }
      if (examples) {
        parsedQuestion.examples = examples;
      }
      if (passageType) {
        parsedQuestion.passageType = passageType;
      }
      if (passage) {
        parsedQuestion.passage = passage;
      }
      if (koreanAbcItems && koreanAbcItems.length > 0) {
        parsedQuestion.koreanAbcItems = koreanAbcItems;
      }
      if (subQuestions && subQuestions.length > 0) {
        parsedQuestion.subQuestions = subQuestions;
      }

      questions.push(parsedQuestion);
    }

    // 유효성 검사
    const validation = validateParseResult({ questions, rawText: text, success: true, message: '' });

    let message = `${questions.length}개의 문제를 발견했습니다.`;
    if (combinedRange) {
      message += ` (결합형: ${combinedRange.start}~${combinedRange.end}번)`;
    }
    if (footnotes.length > 0) {
      message += ` 각주 ${footnotes.length}개 감지.`;
    }
    if (validation.warnings.length > 0) {
      message += ' 일부 확인 필요.';
    }

    return {
      questions,
      rawText: text,
      success: true,
      message,
    };
  } catch (error) {
    console.error('문제 파싱 실패:', error);
    return {
      questions: [],
      rawText: text,
      success: false,
      message: '문제 파싱 중 오류가 발생했습니다.',
    };
  }
};

// ============================================================
// QuestionData 변환 함수 (퀴즈 생성 페이지 호환)
// ============================================================

/**
 * KoreanAbcItem 타입 (QuestionEditor 호환)
 */
export interface KoreanAbcItem {
  label: string;
  text: string;
}

/**
 * QuestionData 형식 (QuestionEditor 호환)
 * ParsedQuestion을 퀴즈 생성 페이지에서 사용하는 형식으로 변환
 */
export interface QuestionDataForEditor {
  id: string;
  text: string;
  type: QuestionType;
  choices: string[];
  answerIndex: number;
  answerIndices?: number[];
  answerText: string;
  answerTexts?: string[];
  explanation: string;
  imageUrl?: string | null;
  examples?: ExamplesData | null;
  rubric?: RubricItem[];
  scoringMethod?: 'ai_assisted' | 'manual';
  subQuestions?: SubQuestionForEditor[];
  passageType?: 'text' | 'korean_abc';
  passage?: string;
  koreanAbcItems?: KoreanAbcItem[];
  passageImage?: string | null;
}

/**
 * SubQuestion 형식 (QuestionEditor 호환)
 */
export interface SubQuestionForEditor {
  id: string;
  text: string;
  type: 'ox' | 'multiple' | 'short_answer';
  choices?: string[];
  answerIndex?: number;
  answerIndices?: number[];
  answerText?: string;
  answerTexts?: string[];
  rubric?: RubricItem[];
  explanation?: string;
  examplesType?: 'text' | 'korean_abc';
  examples?: string[];
  koreanAbcExamples?: KoreanAbcItem[];
  image?: string;
  isMultipleAnswer?: boolean;
  /** 챕터 ID */
  chapterId?: string;
  /** 세부항목 ID */
  chapterDetailId?: string;
}

/**
 * 고유 ID 생성
 */
const generateId = (): string => {
  return `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * ParsedQuestion을 QuestionDataForEditor로 변환
 * @param parsed - 파싱된 문제
 * @param index - 문제 번호 (0부터 시작)
 * @returns QuestionDataForEditor
 */
export const convertToQuestionData = (
  parsed: ParsedQuestion,
  index: number = 0
): QuestionDataForEditor => {
  // 정답 인덱스 결정
  let answerIndex = -1;
  let answerText = '';

  if (typeof parsed.answer === 'number') {
    answerIndex = parsed.answer;
  } else if (typeof parsed.answer === 'string') {
    // OX 문제에서 문자열 정답 처리
    if (parsed.type === 'ox') {
      if (/[Oo○참]/.test(parsed.answer)) {
        answerIndex = 0;
      } else if (/[Xx×거짓]/.test(parsed.answer)) {
        answerIndex = 1;
      }
    } else {
      answerText = parsed.answer;
    }
  }

  // koreanAbcItems 변환 (string[] -> KoreanAbcItem[])
  let koreanAbcItems: KoreanAbcItem[] | undefined;
  if (parsed.koreanAbcItems && parsed.koreanAbcItems.length > 0) {
    koreanAbcItems = parsed.koreanAbcItems.map((text, idx) => ({
      label: KOREAN_LABELS[idx] || `항목${idx + 1}`,
      text,
    }));
  }

  // subQuestions 변환
  let subQuestions: SubQuestionForEditor[] | undefined;
  if (parsed.subQuestions && parsed.subQuestions.length > 0) {
    subQuestions = parsed.subQuestions.map((sub, subIdx) => {
      const subQuestion: SubQuestionForEditor = {
        id: sub.id || `sub_${index}_${subIdx}`,
        text: sub.text,
        type: sub.type,
        answerIndex: sub.answerIndex,
        answerIndices: sub.answerIndices,
        answerText: sub.answerText,
        isMultipleAnswer: sub.answerIndices && sub.answerIndices.length > 1,
      };

      if (sub.choices && sub.choices.length > 0) {
        subQuestion.choices = sub.choices;
      }

      // 하위 문제의 보기 변환
      if (sub.examples) {
        if (sub.examples.type === 'labeled') {
          subQuestion.examplesType = 'korean_abc';
          subQuestion.koreanAbcExamples = sub.examples.items.map((text, idx) => ({
            label: KOREAN_LABELS[idx] || `항목${idx + 1}`,
            text,
          }));
        } else {
          subQuestion.examplesType = 'text';
          subQuestion.examples = sub.examples.items;
        }
      }

      return subQuestion;
    });
  }

  const result: QuestionDataForEditor = {
    id: generateId(),
    text: parsed.text,
    type: parsed.type,
    choices: parsed.choices || [],
    answerIndex,
    answerText,
    explanation: parsed.explanation || '',
  };

  // 선택적 필드 추가
  if (parsed.answerIndices && parsed.answerIndices.length > 0) {
    result.answerIndices = parsed.answerIndices;
  }

  if (parsed.examples) {
    result.examples = parsed.examples;
  }

  if (parsed.rubric && parsed.rubric.length > 0) {
    result.rubric = parsed.rubric;
  }

  if (parsed.passageType) {
    result.passageType = parsed.passageType;
  }

  if (parsed.passage) {
    result.passage = parsed.passage;
  }

  if (koreanAbcItems) {
    result.koreanAbcItems = koreanAbcItems;
  }

  if (subQuestions && subQuestions.length > 0) {
    result.subQuestions = subQuestions;
  }

  return result;
};

/**
 * ParseResult의 모든 문제를 QuestionDataForEditor 배열로 변환
 * @param parseResult - 파싱 결과
 * @returns QuestionDataForEditor 배열
 */
export const convertAllToQuestionData = (
  parseResult: ParseResult
): QuestionDataForEditor[] => {
  return parseResult.questions.map((q, idx) => convertToQuestionData(q, idx));
};

/**
 * 통합 파싱 함수 (진입점)
 * 모든 형식의 문제를 처리합니다.
 */
export const parseQuestionsAuto = (text: string): ParseResult => {
  return parseQuestions(text);
};

// ============================================================
// 유틸리티 함수
// ============================================================

/**
 * 파일 타입 확인
 */
export const isImageFile = (file: File): boolean => {
  return file.type.startsWith('image/');
};

/**
 * PDF 파일 확인
 */
export const isPDFFile = (file: File): boolean => {
  return file.type === 'application/pdf';
};

/**
 * 지원되는 파일 타입 확인
 */
export const isSupportedFile = (file: File): boolean => {
  return isImageFile(file) || isPDFFile(file);
};

/**
 * 파일 크기 검사 (MB 단위)
 */
export const checkFileSize = (file: File, maxSizeMB: number = 10): boolean => {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return file.size <= maxSizeBytes;
};
