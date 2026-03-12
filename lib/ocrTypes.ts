/**
 * OCR 타입 정의
 *
 * 이미지/PDF 문제 파싱 관련 인터페이스 및 타입
 */

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
