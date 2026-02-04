/**
 * OCR 유틸리티
 *
 * Tesseract.js를 사용하여 이미지/PDF에서 텍스트를 추출하고,
 * 추출된 텍스트에서 퀴즈 문제를 파싱합니다.
 *
 * examParser.ts의 고급 기능 통합:
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
 * - combined: 결합형 (공통 지문/이미지 + 여러 하위 문제)
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
  /** 결합형: 공통 지문 타입 */
  passageType?: 'text' | 'korean_abc';
  /** 결합형: 공통 지문 */
  passage?: string;
  /** 결합형: ㄱㄴㄷ 보기 항목 */
  koreanAbcItems?: string[];
  /** 결합형: 하위 문제 목록 */
  subQuestions?: ParsedSubQuestion[];
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
 * 하위 지문 데이터 (결합형용)
 */
export interface SubPassage {
  /** 라벨 (A, B, C, D 등) */
  label: string;
  /** 지문 내용 */
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
// OCR 전처리 함수 (examParser.ts 기능 통합)
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
  // 문제/정답/해설 등의 키워드 주변에서만 수정
  processed = processed.replace(/묻제/g, '문제');
  processed = processed.replace(/쩨목/g, '제목');
  processed = processed.replace(/젱답/g, '정답');
  processed = processed.replace(/딥안/g, '답안');
  processed = processed.replace(/헤설/g, '해설');

  // 3. 불필요한 공백 정리
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
 * 원숫자 선지 추출
 * ①②③④⑤ 형식의 선지를 배열로 변환
 */
export const extractCircledChoices = (text: string): string[] | null => {
  const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
  const choices: string[] = [];

  // 원숫자 위치 찾기
  const positions: { index: number; num: number }[] = [];
  for (let i = 0; i < circledNumbers.length; i++) {
    let pos = 0;
    while ((pos = text.indexOf(circledNumbers[i], pos)) !== -1) {
      positions.push({ index: pos, num: i });
      pos++;
    }
  }

  // 위치순 정렬
  positions.sort((a, b) => a.index - b.index);

  // 연속된 선지 추출
  for (let i = 0; i < positions.length; i++) {
    const current = positions[i];
    const next = positions[i + 1];

    const startIdx = current.index + 1; // 원숫자 다음부터
    const endIdx = next ? next.index : text.length;

    let choice = text.slice(startIdx, endIdx).trim();
    // 줄바꿈 이후 내용은 제외 (다음 문제로 넘어갈 수 있음)
    const newlineIdx = choice.indexOf('\n');
    if (newlineIdx > 0 && newlineIdx < 50) {
      // 짧은 선지 내에서만
      choice = choice.slice(0, newlineIdx).trim();
    }

    if (choice) {
      choices.push(choice);
    }
  }

  return choices.length >= 2 ? choices : null;
};

/**
 * 괄호 숫자 선지 추출
 * (1)(2)(3)(4)(5) 형식의 선지를 배열로 변환
 */
export const extractParenChoices = (text: string): string[] | null => {
  const pattern = /\((\d)\)\s*([^\n(]+)/g;
  const choices: string[] = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const choiceNum = parseInt(match[1], 10);
    const choiceText = match[2].trim();

    // 순서대로 추가
    if (choiceNum === choices.length + 1 && choiceText) {
      choices.push(choiceText);
    }
  }

  return choices.length >= 2 ? choices : null;
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
 * 하위 지문 분리
 * (A), (B), (C), (D) 형식의 하위 지문을 분리
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

  // 각 지문 추출
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
 * 결합형 문제의 공통 지문 추출
 * @param text - 결합형 문제 텍스트
 * @returns 공통 지문 데이터
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

  // 2. 텍스트 형식의 공통 지문 체크
  // [공통 지문], <지문>, 다음 글을 읽고 등의 패턴
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

  // 3. 첫 번째 하위 문제 전까지를 공통 지문으로 처리
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
 * 이미지에서 텍스트 추출
 *
 * @param imageSource - 이미지 파일, URL, 또는 base64 문자열
 * @param onProgress - 진행 상태 콜백 (선택)
 * @returns OCR 결과
 */
export const extractTextFromImage = async (
  imageSource: File | string,
  onProgress?: (progress: OCRProgress) => void
): Promise<OCRResult> => {
  try {
    // Worker 초기화 확인
    if (!isWorkerInitialized || !worker) {
      onProgress?.({ progress: 0, status: 'OCR 엔진 초기화 중...' });
      await initializeOCRWorker();
    }

    onProgress?.({ progress: 10, status: '이미지 분석 중...' });

    // 이미지 소스 준비
    let source: string | File = imageSource;

    if (imageSource instanceof File) {
      // File 객체인 경우 URL로 변환
      source = URL.createObjectURL(imageSource);
    }

    onProgress?.({ progress: 20, status: '텍스트 인식 중...' });

    // OCR 실행
    const result = await worker!.recognize(source);

    onProgress?.({ progress: 90, status: '결과 처리 중...' });

    // URL 해제 (메모리 정리)
    if (imageSource instanceof File) {
      URL.revokeObjectURL(source as string);
    }

    onProgress?.({ progress: 100, status: '완료!' });

    return {
      text: result.data.text,
      confidence: result.data.confidence,
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

    // 2. 각주 추출 (문제 파싱 전에 추출해서 나중에 활용 가능)
    const footnotes = extractFootnotes(processedText);

    // 3. 결합형 문제 범위 감지
    const combinedRange = detectCombinedQuestionRange(processedText);

    // 문제 번호 패턴 (1., 1), 1번, 문제1, Q1 등)
    const questionPattern = /(?:^|\n)\s*(?:문제\s*)?(?:Q\.?\s*)?(\d+)\s*[.)번:\s]/gi;

    // OX 문제 패턴
    const oxPatterns = [
      /[OoXx○×]\s*[,/|]\s*[OoXx○×]/i,  // O/X, O,X 등
      /참\s*[,/|]\s*거짓/i,              // 참/거짓
      /True\s*[,/|]\s*False/i,           // True/False
      /맞으면\s*O.*틀리면\s*X/i,          // 맞으면 O, 틀리면 X
    ];

    // 정답 패턴
    const answerPattern = /(?:정답|답|Answer|Ans)[\s:：]+([^\n]+)/i;

    // 해설 패턴
    const explanationPattern = /(?:해설|설명|풀이|Explanation)[\s:：]+([^\n]+(?:\n(?![문제Q\d])[^\n]+)*)/i;

    // 문제 분리
    const matches = [...processedText.matchAll(questionPattern)];

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
      const questionNumber = parseInt(currentMatch[1], 10);

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

        // 공통 지문 추출
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

        // 하위 문제가 없으면 하위 지문이라도 추출
        if (!subQuestions || subQuestions.length === 0) {
          const subPassages = extractSubPassages(questionText);
          if (subPassages.length > 0) {
            explanation = `[하위 지문]\n${subPassages.map(sp => `(${sp.label}) ${sp.content}`).join('\n')}`;
          }
        }
      }
      // OX 문제 확인
      else if (oxPatterns.some(pattern => pattern.test(questionText))) {
        type = 'ox';
      }
      // 객관식 선지 확인 (개선된 추출)
      else {
        // 원숫자 선지 시도
        choices = extractCircledChoices(questionText) ?? undefined;

        if (!choices) {
          // 괄호 숫자 선지 시도
          choices = extractParenChoices(questionText) ?? undefined;
        }

        if (choices && choices.length >= 2) {
          type = 'multiple';
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
