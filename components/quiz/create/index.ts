// 자체제작 퀴즈 관련 컴포넌트 모음
// 이미지 업로더, OCR 처리, 문제 편집기, 문제 목록, 퀴즈 메타정보 폼 컴포넌트를 내보냅니다.

// ImageUploader: 이미지/PDF 업로더 컴포넌트
export { default as ImageUploader } from './ImageUploader';

// OCRProcessor: OCR 처리 컴포넌트
export { default as OCRProcessor } from './OCRProcessor';

// QuestionEditor: 문제 편집기 컴포넌트
export { default as QuestionEditor, calculateTotalQuestionCount } from './QuestionEditor';
export type { QuestionData, ExamplesData, ExamplesType, ExtractedImageForEditor } from './QuestionEditor';

// QuestionList: 문제 목록 컴포넌트
export { default as QuestionList } from './QuestionList';

// QuizMetaForm: 퀴즈 메타정보 폼 컴포넌트
export { default as QuizMetaForm, validateRequiredTags, getChapterTags } from './QuizMetaForm';
export type { QuizMeta } from './QuizMetaForm';

// ExtractedImagesContext: 추출 이미지 상태 관리
export { ExtractedImagesProvider, useExtractedImages } from './ExtractedImagesContext';
export type { UploadedFile, ExtractedImage } from './ExtractedImagesContext';

// ImageRegionSelector: 이미지 영역 선택 모달
export { default as ImageRegionSelector } from './ImageRegionSelector';

// ExtractedImagePicker: 추출 이미지 선택 모달
export { default as ExtractedImagePicker } from './ExtractedImagePicker';

// AIQuizGenerator: AI 문제 생성 컴포넌트 (Gemini)
export { default as AIQuizGenerator } from './AIQuizGenerator';
