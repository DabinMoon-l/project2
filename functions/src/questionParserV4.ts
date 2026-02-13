/**
 * 문제지 파서 V4 (단순화 버전)
 *
 * Gemini 전처리 결과를 앱 구조로 매핑만 수행
 * 복잡한 패턴 매칭 없음!
 */

import { StructuredQuestion, preprocessOcrText } from "./ocrPreprocess";

// ============================================================
// 출력 타입 (앱 구조)
// ============================================================

export interface ParsedQuestionV4 {
  questionNumber: number | string;
  type: "multipleChoice" | "ox" | "unknown";
  stem: string;
  // 제시문 (박스 안 자료)
  passage?: string;
  passageType?: "text" | "labeled" | "bullet";
  labeledPassages?: Record<string, string>;
  bulletItems?: string[];  // ◦ 항목 형식 제시문
  passagePrompt?: string;  // 제시문 발문
  // 보기 (ㄱㄴㄷ 항목)
  boxItems: Array<{ label: string; text: string }>;
  bogiPrompt?: string;  // 보기 발문
  // 선지
  choices: Array<{ label: string; text: string }>;
  needsReview: boolean;
  // 이미지/표/그래프 필요 여부
  needsImage?: boolean;
}

export interface ParseResultV4 {
  success: boolean;
  questions: ParsedQuestionV4[];
  preprocessed: boolean;  // Gemini 전처리 사용 여부
  debug?: {
    rawQuestionCount: number;
    error?: string;  // 실패 시 에러 메시지
  };
}

// ============================================================
// 메인 파서 (단순 매핑)
// ============================================================

/**
 * Gemini 전처리 결과를 앱 구조로 변환
 */
export function convertToAppStructure(
  structured: StructuredQuestion[]
): ParsedQuestionV4[] {
  const questions: ParsedQuestionV4[] = [];

  for (const q of structured) {
    // 문제 유형 판정 (단순!)
    let type: "multipleChoice" | "ox" | "unknown" = "unknown";

    if (q.choices.length >= 2) {
      type = "multipleChoice";
    }

    // OX 체크
    const fullText = q.stem + q.choices.map((c) => c.text).join(" ");
    if (/O\s*[\/,]\s*X/i.test(fullText) || /[○×]/.test(fullText)) {
      type = "ox";
    }

    // 결과 객체 생성
    const parsed: ParsedQuestionV4 = {
      questionNumber: q.questionNumber,
      type,
      stem: q.stem,
      boxItems: q.boxItems || [],
      choices: q.choices,
      needsReview: type === "unknown",
    };

    // 제시문 처리
    if (q.passage) {
      parsed.passage = q.passage;
      parsed.passageType = "text";
    }
    if (q.labeledPassages && Object.keys(q.labeledPassages).length > 0) {
      parsed.labeledPassages = q.labeledPassages;
      parsed.passageType = "labeled";
    }
    if (q.bulletItems && q.bulletItems.length > 0) {
      parsed.bulletItems = q.bulletItems;
      parsed.passageType = "bullet";
    }

    // 제시문 발문
    if (q.passagePrompt) {
      parsed.passagePrompt = q.passagePrompt;
    }

    // 보기 발문
    if (q.bogiPrompt) {
      parsed.bogiPrompt = q.bogiPrompt;
    }

    // 이미지 필요 여부
    if (q.needsImage) {
      parsed.needsImage = true;
    }

    questions.push(parsed);
  }

  // 문제 번호 순 정렬
  questions.sort((a, b) => {
    const numA = typeof a.questionNumber === "number" ? a.questionNumber : parseInt(String(a.questionNumber), 10);
    const numB = typeof b.questionNumber === "number" ? b.questionNumber : parseInt(String(b.questionNumber), 10);
    return numA - numB;
  });

  return questions;
}

/**
 * OCR 텍스트에서 문제 파싱 (Gemini 전처리 + 단순 매핑)
 */
export async function parseQuestionsV4(
  ocrText: string,
  apiKey: string
): Promise<ParseResultV4> {
  console.log("[V4] ========================================");
  console.log(`[V4] 파싱 시작: ${ocrText.length}자`);
  console.log("[V4] ========================================");

  // 1. Gemini 전처리
  const preprocessResult = await preprocessOcrText(ocrText, apiKey);

  if (!preprocessResult.success) {
    console.error("[V4] 전처리 실패:", preprocessResult.error);
    return {
      success: false,
      questions: [],
      preprocessed: false,
      debug: {
        rawQuestionCount: 0,
        error: preprocessResult.error || "알 수 없는 전처리 오류",  // 에러 메시지 전달
      },
    };
  }

  console.log(`[V4] 전처리 완료: ${preprocessResult.questions.length}개 문제`);

  // 2. 앱 구조로 변환
  const questions = convertToAppStructure(preprocessResult.questions);

  // 결과 로그
  console.log("[V4] ========================================");
  console.log(`[V4] 파싱 완료: ${questions.length}개 문제`);
  console.log("[V4] ========================================");

  for (const q of questions) {
    console.log(`[V4] ${q.questionNumber}번: type=${q.type}, choices=${q.choices.length}`);
    console.log(`[V4]   stem: "${q.stem.substring(0, 50)}..."`);
  }

  return {
    success: questions.length > 0,
    questions,
    preprocessed: true,
    debug: {
      rawQuestionCount: preprocessResult.questions.length,
    },
  };
}

/**
 * ClovaField에서 텍스트만 추출 (기존 OCR 결과 호환용)
 */
export function extractTextFromClovaFields(
  fields: Array<{ inferText: string }>
): string {
  return fields.map((f) => f.inferText).join(" ");
}
