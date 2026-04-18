// ============================================================
// 문제 편집기 타입 정의
// ============================================================

import type { QuestionType, RubricItem } from '@/lib/ocr';

/**
 * 보기 타입 ('text': 텍스트 박스 형식, 'labeled': ㄱ.ㄴ.ㄷ. 형식)
 */
export type ExamplesType = 'text' | 'labeled';

/**
 * 보기 데이터 (기존 호환성 유지)
 */
export interface ExamplesData {
  /** 보기 유형 */
  type: ExamplesType;
  /** 보기 항목들 */
  items: string[];
}

/**
 * ㄱㄴㄷ 블록 내 개별 항목
 */
export interface LabeledItem {
  id: string;
  label: string; // ㄱ, ㄴ, ㄷ 등
  content: string;
}

/**
 * 혼합 보기 블록 (텍스트박스, ㄱㄴㄷ 그룹, (가)(나)(다) 그룹, ◦항목, 이미지, 또는 묶음)
 * - text: 텍스트박스 (content 필드 사용)
 * - labeled: ㄱ.ㄴ.ㄷ. 형식 (items 배열 사용, 블록 내에서 항목 추가/삭제 가능)
 * - gana: (가)(나)(다) 형식 (items 배열 사용)
 * - bullet: ◦ 항목 형식 (items 배열 사용)
 * - image: 이미지 (imageUrl 필드 사용)
 * - grouped: 묶음 (children 배열 사용 - 여러 블록을 하나로 묶음)
 * @deprecated 지문(PassageBlock)과 보기(BogiData)로 분리됨
 */
export interface MixedExampleBlock {
  id: string;
  type: 'text' | 'labeled' | 'gana' | 'bullet' | 'image' | 'grouped';
  content?: string; // text 타입일 때
  items?: LabeledItem[]; // labeled, gana, bullet 타입일 때
  imageUrl?: string; // image 타입일 때
  children?: MixedExampleBlock[]; // grouped 타입일 때
}

/**
 * 제시문 블록 (텍스트박스, (가)(나)(다) 그룹, ◦항목, 이미지, 또는 묶음)
 * - text: 텍스트박스 (content 필드 사용)
 * - gana: (가)(나)(다) 형식 (items 배열 사용)
 * - bullet: ◦ 항목 형식 (items 배열 사용)
 * - image: 이미지 (imageUrl 필드 사용)
 * - grouped: 묶음 (children 배열 사용 - 여러 블록을 하나로 묶음)
 *
 * 주의: labeled(ㄱㄴㄷ) 타입은 제시문에서 사용 불가 (보기에서만 사용)
 */
export interface PassageBlock {
  id: string;
  type: 'text' | 'gana' | 'bullet' | 'image' | 'grouped';
  content?: string; // text 타입일 때
  items?: LabeledItem[]; // gana, bullet 타입일 때
  imageUrl?: string; // image 타입일 때
  children?: PassageBlock[]; // grouped 타입일 때
  prompt?: string; // 제시문 발문
}

/**
 * 보기 데이터 (<보기> 박스 - 객관식/주관식에서만 사용)
 * - questionText: 발문 ("이에 대한 설명으로 옳은 것만을 <보기>에서 있는 대로 고른 것은?" 같은 문구)
 * - items: ㄱ.ㄴ.ㄷ. 형식의 보기 항목들
 */
export interface BogiData {
  /** 발문 (자동 선택 또는 직접 입력) */
  questionText: string;
  /** ㄱ.ㄴ.ㄷ. 형식의 보기 항목들 */
  items: LabeledItem[];
}

/**
 * 보기 발문 프리셋
 */
export const BOGI_QUESTION_PRESETS = [
  '이에 대한 설명으로 옳은 것만을 <보기>에서 있는 대로 고른 것은?',
  '이에 대한 설명으로 옳지 않은 것만을 <보기>에서 있는 대로 고른 것은?',
  '위 자료에 대한 분석으로 옳은 것만을 <보기>에서 있는 대로 고른 것은?',
  '위 자료에 대한 분석으로 옳지 않은 것만을 <보기>에서 있는 대로 고른 것은?',
];

/**
 * @deprecated 이전 버전 호환용 - MixedExampleBlock으로 마이그레이션됨
 */
export interface MixedExampleItem {
  id: string;
  type: 'text' | 'labeled';
  label?: string;
  content: string;
}

/**
 * 공통 지문 타입 (결합형에서 사용)
 * - 'text': 텍스트 박스 형식 (자유롭게 작성)
 * - 'korean_abc': ㄱ.ㄴ.ㄷ. 형식 (각 항목 개별 입력)
 */
export type PassageType = 'text' | 'korean_abc';

/**
 * 한글 자음 라벨 순서 (ㄱ ~ ㅎ)
 */
export const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/**
 * (가)(나)(다) 라벨 순서 (가~바까지 6개)
 */
export const GANA_LABELS = ['가', '나', '다', '라', '마', '바'];

/**
 * ㄱㄴㄷ식 보기 항목 (결합형 공통 지문용)
 */
export interface KoreanAbcItem {
  label: string; // ㄱ, ㄴ, ㄷ, ㄹ, ㅁ 등
  text: string;
}

/**
 * 하위 문제 (결합형에서 사용)
 */
export interface SubQuestion {
  id: string;
  text: string;
  type: Exclude<QuestionType, 'combined' | 'essay'>;
  choices?: string[];
  answerIndex?: number;
  answerIndices?: number[];
  answerText?: string;
  answerTexts?: string[];
  rubric?: RubricItem[];
  explanation?: string;
  /** 선지별 해설 (객관식 전용, choices와 동일 길이) */
  choiceExplanations?: string[];
  /** @deprecated 제시문(passageBlocks)으로 대체됨 */
  examplesType?: 'text' | 'korean_abc' | 'mixed';
  /** @deprecated 제시문(passageBlocks)으로 대체됨 */
  examples?: string[];
  /** @deprecated 제시문(passageBlocks)으로 대체됨 */
  koreanAbcExamples?: KoreanAbcItem[];
  /** @deprecated 제시문(passageBlocks)으로 대체됨 */
  mixedExamples?: MixedExampleBlock[];
  /** 제시문 블록들 (텍스트박스, (가)(나)(다), 이미지, 묶기) */
  passageBlocks?: PassageBlock[];
  /** 제시문 발문 */
  passagePrompt?: string;
  /** 보기 데이터 (<보기> 박스 - 객관식/주관식에서만 사용, OX는 사용 안함) */
  bogi?: BogiData | null;
  /** 이미지 URL (하위 문제별 개별 이미지) */
  image?: string;
  /** 복수정답 모드 (객관식용) */
  isMultipleAnswer?: boolean;
  /** 챕터 ID */
  chapterId?: string;
  /** 세부항목 ID */
  chapterDetailId?: string;
}

/**
 * 문제 데이터 타입
 */
export interface QuestionData {
  /** 고유 ID */
  id: string;
  /** 문제 텍스트 */
  text: string;
  /** 문제 유형 */
  type: QuestionType;
  /** 선지 (객관식) */
  choices: string[];
  /** 정답 인덱스 (OX: 0=O, 1=X / 객관식: 0~7 / 단답형/서술형: -1) */
  answerIndex: number;
  /** 복수 정답 인덱스 (객관식에서 복수정답 사용 시) */
  answerIndices?: number[];
  /** 정답 텍스트 (단답형) */
  answerText: string;
  /** 복수 정답 텍스트 (단답형에서 복수정답 사용 시) */
  answerTexts?: string[];
  /** 해설 */
  explanation: string;
  /** 선지별 해설 (객관식 전용, choices와 동일 길이) */
  choiceExplanations?: string[];
  /** 문제 이미지 URL */
  imageUrl?: string | null;
  /** @deprecated 제시문(passageBlocks)으로 대체됨 - 호환성 유지 */
  examples?: ExamplesData | null;
  /** @deprecated 제시문(passageBlocks)으로 대체됨 - 호환성 유지 */
  mixedExamples?: MixedExampleBlock[];
  /** 제시문 블록들 (텍스트박스, (가)(나)(다), 이미지, 묶기) */
  passageBlocks?: PassageBlock[];
  /** 제시문 발문 */
  passagePrompt?: string;
  /** 보기 데이터 (<보기> 박스 - 객관식/주관식에서만 사용) */
  bogi?: BogiData | null;
  /** 루브릭 (서술형용) */
  rubric?: RubricItem[];
  /** 채점 방식 (서술형용) - 기본값: 'manual' */
  scoringMethod?: 'ai_assisted' | 'manual';
  /** 하위 문제 (결합형용) */
  subQuestions?: SubQuestion[];
  /** 공통 제시문 타입 (결합형용) - text: 텍스트 박스, korean_abc: ㄱㄴㄷ식 보기, mixed: 혼합 */
  passageType?: PassageType | 'mixed';
  /** 공통 제시문 텍스트 (결합형에서 passageType이 text일 때) - text 필드와 함께 사용 */
  passage?: string;
  /** ㄱㄴㄷ식 보기 항목들 (결합형에서 passageType이 korean_abc일 때) */
  koreanAbcItems?: KoreanAbcItem[];
  /** 공통 제시문 혼합 보기 (결합형에서 passageType이 mixed일 때) */
  passageMixedExamples?: MixedExampleBlock[];
  /** 공통 제시문 이미지 (결합형용) */
  passageImage?: string | null;
  /** 공통 문제 (결합형용) - 공통 제시문 위에 표시되는 문제 텍스트 */
  commonQuestion?: string;
  /** 복수정답 모드 (객관식용) */
  isMultipleAnswer?: boolean;
  /** 챕터 ID (결합형이 아닌 문제용) */
  chapterId?: string;
  /** 세부항목 ID (결합형이 아닌 문제용) */
  chapterDetailId?: string;
}

/**
 * 에디터에서 사용하는 추출 이미지 타입
 */
export interface ExtractedImageForEditor {
  id: string;
  dataUrl: string;
  sourceFileName?: string;
}

/**
 * 문제 편집기 Props
 */
export interface QuestionEditorProps {
  /** 편집할 기존 문제 (새 문제 추가 시 undefined) */
  initialQuestion?: QuestionData;
  /** 저장 시 콜백 */
  onSave: (question: QuestionData) => void;
  /** 취소 시 콜백 */
  onCancel: () => void;
  /** 문제 번호 (새 문제 추가용) */
  questionNumber: number;
  /** 추가 클래스명 */
  className?: string;
  /** 사용자 역할 - 학생/교수 (기본값: 'student') */
  userRole?: 'student' | 'professor';
  /** 과목 ID (챕터 선택용) */
  courseId?: string;
  /** 추출된 이미지 목록 (이미지 영역 선택에서 추출) */
  extractedImages?: ExtractedImageForEditor[];
  /** 크롭 이미지를 추출 이미지 풀에 추가하는 콜백 */
  onAddExtracted?: (dataUrl: string, sourceFileName?: string) => void;
  /** 추출 이미지 삭제 콜백 */
  onRemoveExtracted?: (id: string) => void;
}
