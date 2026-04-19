'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { uploadBase64ToStorage, sanitizeForFirestore } from '@/lib/utils/quizImageUpload';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse, useClosePanel, usePanelLock, usePanelStatePreservation } from '@/lib/contexts';
import { useProfessorQuiz, type QuizInput, type Difficulty } from '@/lib/hooks/useProfessorQuiz';
import type { QuizType } from '@/components/professor/QuizEditorForm';
import type { CourseId } from '@/lib/types/course';
import { generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';
import dynamic from 'next/dynamic';
import {
  ImageUploader,
  QuestionList,
  calculateTotalQuestionCount,
  ExtractedImagesProvider,
  useExtractedImages,
  ExtractedImagePicker,
  type QuestionData,
} from '@/components/quiz/create';
import ImageRegionSelector, { type UploadedFileItem } from '@/components/quiz/create/ImageRegionSelector';
import type { MixedExampleBlock, LabeledItem } from '@/components/quiz/create/questionTypes';

// 대형 컴포넌트 lazy load (단계별 조건부 렌더링)
const OCRProcessor = dynamic(() => import('@/components/quiz/create/OCRProcessor'));
const QuestionEditor = dynamic(() => import('@/components/quiz/create/QuestionEditor'));
const ImageCropper = dynamic(() => import('@/components/quiz/create/ImageCropper'), { ssr: false });
const PageSelectionModal = dynamic(() => import('@/components/ai-quiz/PageSelectionModal'), { ssr: false });
import type { ParseResult, ParsedQuestion } from '@/lib/ocr';
// pdfjs-dist 동적 import (번들 크기 최적화)
let _pdfjsLib: typeof import('pdfjs-dist') | null = null;
async function getPdfjs() {
  if (!_pdfjsLib) {
    _pdfjsLib = await import('pdfjs-dist');
    _pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  }
  return _pdfjsLib;
}

// PDF 페이지 타입
interface DocumentPage {
  pageNum: number;
  thumbnail: string;
  selected: boolean;
}

// ============================================================
// 타입 정의
// ============================================================

type Step = 'upload' | 'questions' | 'meta' | 'confirm';

/**
 * Firestore에 저장할 평탄화된 문제 데이터
 */
interface FlattenedQuestion {
  id: string;
  order: number;
  text: string;
  type: string;
  choices?: string[] | null;
  answer: string | number | number[];
  explanation?: string | null;
  choiceExplanations?: string[] | null;
  imageUrl?: string | null;
  mixedExamples?: MixedExampleBlock[] | null;
  combinedGroupId?: string;
  combinedIndex?: number;
  combinedTotal?: number;
  chapterId?: string | null;
  chapterDetailId?: string | null;
  passageType?: string;
  passage?: string;
  passageImage?: string | null;
  commonQuestion?: string | null;
  koreanAbcItems?: string[] | null;
  passageMixedExamples?: MixedExampleBlock[] | null;
  combinedMainText?: string;
}

/** 시험 유형 옵션 */
const QUIZ_TYPE_OPTIONS: { value: QuizType; label: string }[] = [
  { value: 'midterm', label: '중간' },
  { value: 'final', label: '기말' },
  { value: 'past', label: '기출' },
  { value: 'independent', label: '단독' },
];

/** 난이도 옵션 */
const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: '쉬움' },
  { value: 'normal', label: '보통' },
  { value: 'hard', label: '어려움' },
];


// ============================================================
// 컴포넌트
// ============================================================

/**
 * 교수 퀴즈 출제 페이지
 *
 * 학생 퀴즈 만들기와 동일한 4단계 플로우:
 * 1. 업로드 (OCR / 직접 입력 / 이미지 추출)
 * 2. 문제 편집
 * 3. 퀴즈 정보 (시험 유형, 과목, 대상 반, 제목, 난이도)
 * 4. 확인 및 저장
 */
export default function ProfessorQuizCreatePage({ isPanelMode }: { isPanelMode?: boolean } = {}) {
  const router = useRouter();
  const closePanel = useClosePanel();
  const { user } = useAuth();
  const { semesterSettings, userCourseId, getCourseById, courseList } = useCourse();
  const { createQuiz, error, clearError } = useProfessorQuiz();

  // 3쪽 패널 잠금 (가로모드)
  usePanelLock(isPanelMode);

  // 단계 관리
  const [step, setStep] = useState<Step>('upload');

  // 파일 업로드 상태
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isOCRProcessing, setIsOCRProcessing] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // 이미지 크롭 상태
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [showImageCropper, setShowImageCropper] = useState(false);

  // OCR 대상 파일
  const [ocrTargetFile, setOcrTargetFile] = useState<File | null>(null);

  // 추출된 이미지 목록
  const EXTRACTED_IMAGES_KEY = 'professor_quiz_extracted_images';
  const [extractedImages, setExtractedImages] = useState<Array<{ id: string; dataUrl: string; sourceFileName?: string }>>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem(EXTRACTED_IMAGES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // 자동 추출 이미지 매핑
  const [autoExtractedImages, setAutoExtractedImages] = useState<Map<number, string>>(new Map());

  // PDF 페이지 선택 관련 상태
  const [documentPages, setDocumentPages] = useState<DocumentPage[]>([]);
  const [showPageSelectionModal, setShowPageSelectionModal] = useState(false);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
  const [pdfLoadingMessage, setPdfLoadingMessage] = useState('');
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);

  // 문제 관리
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  // 퀴즈 메타 정보 (교수 전용)
  const [quizType, setQuizType] = useState<QuizType | undefined>(undefined);
  const [pastYear, setPastYear] = useState<number>(new Date().getFullYear());
  const [pastExamType, setPastExamType] = useState<'midterm' | 'final'>('midterm');
  const [selectedCourseId, setSelectedCourseId] = useState<CourseId | null>(
    (userCourseId as CourseId) || null
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [tags, setTags] = useState<string[]>([]);
  const [showTagPicker, setShowTagPicker] = useState(false);

  // userCourseId가 비동기로 로드된 후 selectedCourseId 동기화
  const courseInitRef = useRef(false);
  useEffect(() => {
    if (userCourseId && !courseInitRef.current && !selectedCourseId) {
      courseInitRef.current = true;
      setSelectedCourseId(userCourseId as CourseId);
    }
  }, [userCourseId, selectedCourseId]);

  // 2쪽→3쪽 승격 시 상태 보존
  usePanelStatePreservation(
    'professor-quiz-create',
    () => isPanelMode ? ({
      step, questions, quizType, selectedCourseId, title, description,
      difficulty, tags, pastYear, pastExamType,
    }) : ({}),
    (saved) => {
      if (saved.step) setStep(saved.step as Step);
      if (saved.questions) setQuestions(saved.questions as QuestionData[]);
      if (saved.quizType !== undefined) setQuizType(saved.quizType as QuizType);
      if (saved.selectedCourseId) setSelectedCourseId(saved.selectedCourseId as CourseId);
      if (saved.title) setTitle(saved.title as string);
      if (saved.description) setDescription(saved.description as string);
      if (saved.difficulty) setDifficulty(saved.difficulty as Difficulty);
      if (saved.tags) setTags(saved.tags as string[]);
      if (saved.pastYear) setPastYear(saved.pastYear as number);
      if (saved.pastExamType) setPastExamType(saved.pastExamType as 'midterm' | 'final');
    },
  );

  // 태그 옵션 (과목별)
  const tagOptions = useMemo(() => {
    const courseId = selectedCourseId || userCourseId || 'biology';
    const courseTags = generateCourseTags(courseId);
    return [...COMMON_TAGS.map(t => t.value), ...courseTags.map(t => t.value)];
  }, [selectedCourseId, userCourseId]);

  // 저장 상태
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 미리보기 아코디언 상태
  const [previewExpanded, setPreviewExpanded] = useState<Set<string>>(new Set());

  // 유효성 검사 에러
  const [metaErrors, setMetaErrors] = useState<{ title?: string; quizType?: string; courseId?: string }>({});

  // 이미지 추출 모드 상태
  const [showImageExtractor, setShowImageExtractor] = useState(false);
  const [extractorFiles, setExtractorFiles] = useState<UploadedFileItem[]>([]);
  const [isExtractProcessing, setIsExtractProcessing] = useState(false);
  const extractFileInputRef = useRef<HTMLInputElement>(null);

  // 초안 저장/복원 관련 상태
  const [showExitModal, setShowExitModal] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [savedDraftInfo, setSavedDraftInfo] = useState<{ questionCount: number; title: string } | null>(null);

  // localStorage 키
  const DRAFT_KEY = 'professor_quiz_create_draft';

  // extractedImages 변경 시 localStorage에 동기화
  useEffect(() => {
    try {
      if (extractedImages.length > 0) {
        localStorage.setItem(EXTRACTED_IMAGES_KEY, JSON.stringify(extractedImages));
      } else {
        localStorage.removeItem(EXTRACTED_IMAGES_KEY);
      }
    } catch (err) {
      console.error('추출 이미지 저장 실패:', err);
    }
  }, [extractedImages]);

  /**
   * 초안 저장
   */
  const saveDraft = useCallback(() => {
    try {
      // 공용 sanitizeForFirestore로 데이터 정리 후 저장
      const cleanedQuestions = sanitizeForFirestore(questions) || [];
      const draftData = {
        step,
        questions: cleanedQuestions,
        quizType,
        pastYear,
        pastExamType,
        selectedCourseId,
        title,
        description,
        difficulty,
        tags,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draftData));
      return true;
    } catch (err) {
      console.error('초안 저장 실패:', err);
      return false;
    }
  }, [step, questions, quizType, pastYear, pastExamType, selectedCourseId, title, description, difficulty, tags]);

  /**
   * 초안 불러오기
   */
  const loadDraft = useCallback(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) return JSON.parse(saved);
    } catch (err) {
      console.error('초안 불러오기 실패:', err);
    }
    return null;
  }, []);

  /**
   * 초안 삭제
   */
  const deleteDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (err) {
      console.error('초안 삭제 실패:', err);
    }
  }, []);

  /**
   * 페이지 로드 시 저장된 초안 확인
   * - 최근 30분 이내면 모달 없이 바로 복원 (앱 전환 복귀 대응)
   * - 오래되면 기존 모달
   */
  useEffect(() => {
    const draft = loadDraft();
    if (!draft) return;
    const hasContent = draft.questions?.length > 0 || draft.title;
    if (!hasContent) return;

    const savedAt = draft.savedAt ? new Date(draft.savedAt).getTime() : 0;
    const isRecent = savedAt > 0 && Date.now() - savedAt < 30 * 60 * 1000;

    if (isRecent) {
      if (draft.step) setStep(draft.step);
      if (draft.questions) setQuestions(draft.questions);
      if (draft.quizType) setQuizType(draft.quizType);
      if (draft.pastYear) setPastYear(draft.pastYear);
      if (draft.pastExamType) setPastExamType(draft.pastExamType);
      if (draft.selectedCourseId) setSelectedCourseId(draft.selectedCourseId);
      if (draft.title) setTitle(draft.title);
      if (draft.description) setDescription(draft.description);
      if (draft.difficulty) setDifficulty(draft.difficulty);
      if (draft.tags) setTags(draft.tags);
      return;
    }

    setSavedDraftInfo({
      questionCount: draft.questions?.length || 0,
      title: draft.title || '',
    });
    setShowResumeModal(true);
  }, [loadDraft]);

  // 상태 변경 시 디바운스 자동 저장 + 앱 백그라운드 시 즉시 flush
  useEffect(() => {
    const hasContent = questions.length > 0 || !!title;
    if (!hasContent) return;
    const timer = setTimeout(() => saveDraft(), 500);
    return () => clearTimeout(timer);
  }, [questions, title, description, quizType, pastYear, pastExamType, selectedCourseId, difficulty, tags, step, saveDraft]);

  useEffect(() => {
    const flush = () => {
      if (questions.length > 0 || !!title) saveDraft();
    };
    const onHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [questions, title, saveDraft]);

  /**
   * 이전 초안 이어서 작성
   */
  const handleResumeDraft = useCallback(() => {
    const draft = loadDraft();
    if (draft) {
      if (draft.step) setStep(draft.step);
      if (draft.questions) setQuestions(draft.questions);
      if (draft.quizType) setQuizType(draft.quizType);
      if (draft.pastYear) setPastYear(draft.pastYear);
      if (draft.pastExamType) setPastExamType(draft.pastExamType);
      if (draft.selectedCourseId) setSelectedCourseId(draft.selectedCourseId);
      if (draft.title) setTitle(draft.title);
      if (draft.description) setDescription(draft.description);
      if (draft.difficulty) setDifficulty(draft.difficulty);
      if (draft.tags) setTags(draft.tags);
    }
    setShowResumeModal(false);
    setSavedDraftInfo(null);
  }, [loadDraft]);

  /**
   * 처음부터 새로 작성
   */
  const handleStartFresh = useCallback(() => {
    deleteDraft();
    setShowResumeModal(false);
    setSavedDraftInfo(null);
  }, [deleteDraft]);

  /**
   * 저장하고 나가기
   */
  const goBack = useCallback(() => {
    if (isPanelMode) closePanel();
    else router.back();
  }, [isPanelMode, closePanel, router]);

  const handleSaveAndExit = useCallback(() => {
    const success = saveDraft();
    if (success) {
      goBack();
    } else {
      alert('저장에 실패했습니다.');
    }
  }, [saveDraft, goBack]);

  /**
   * 저장하지 않고 나가기
   */
  const handleExitWithoutSave = useCallback(() => {
    deleteDraft();
    goBack();
  }, [deleteDraft, goBack]);

  /**
   * 뒤로가기 버튼 핸들러
   */
  const handleBackButton = useCallback(() => {
    if (step !== 'upload' || questions.length > 0 || title) {
      setShowExitModal(true);
    } else {
      goBack();
    }
  }, [step, questions.length, title, goBack]);

  /**
   * Blob을 dataUrl로 변환
   */
  const blobToDataUrl = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, []);

  /**
   * 이미지 추출용 파일 선택 핸들러
   */
  const handleExtractFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileArray = Array.from(e.target.files || []);
    if (fileArray.length === 0) return;
    e.target.value = '';

    setIsExtractProcessing(true);
    const items: UploadedFileItem[] = [];

    try {
      for (const file of fileArray) {
        if (file.name.endsWith('.pptx') || file.type.includes('presentation')) {
          try {
            const idToken = await auth.currentUser!.getIdToken();
            const formData = new FormData();
            formData.append('file', file);
            const resp = await fetch(
              `${process.env.NEXT_PUBLIC_PPTX_CLOUD_RUN_URL}/convert-pdf`,
              {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${idToken}` },
                body: formData,
              }
            );
            if (!resp.ok) {
              const errData = await resp.json().catch(() => ({ error: resp.statusText }));
              throw new Error(errData.error || 'PDF 변환 실패');
            }
            const pdfBlob = await resp.blob();
            const pdfFile = new File(
              [pdfBlob],
              file.name.replace(/\.pptx$/i, '.pdf'),
              { type: 'application/pdf' }
            );
            items.push({ id: `pdf-${Date.now()}-${file.name}`, file: pdfFile, preview: 'pdf' });
          } catch (err) {
            console.error('PPT 변환 실패:', err);
            alert('PPT 파일을 변환하는 중 오류가 발생했습니다.');
          }
        } else if (file.type === 'application/pdf') {
          items.push({ id: `pdf-${Date.now()}-${file.name}`, file, preview: 'pdf' });
        } else if (file.type.startsWith('image/')) {
          items.push({ id: `img-${Date.now()}-${file.name}`, file, preview: await blobToDataUrl(file) });
        }
      }
      if (items.length > 0) {
        setExtractorFiles(items);
        setShowImageExtractor(true);
      }
    } finally {
      setIsExtractProcessing(false);
    }
  }, [blobToDataUrl]);

  /**
   * 파일 선택 핸들러
   */
  const handleFileSelect = useCallback(async (file: File) => {
    if (file.type === 'application/pdf') {
      try {
        setIsLoadingDocument(true);
        setPdfLoadingMessage('PDF 로딩 중...');
        setOcrError(null);
        setPendingPdfFile(file);

        const arrayBuffer = await file.arrayBuffer();
        const pdfjsLib = await getPdfjs();
        const pdf = await pdfjsLib.getDocument({
          data: arrayBuffer,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/cmaps/',
          cMapPacked: true,
        }).promise;

        const pages: DocumentPage[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          setPdfLoadingMessage(`PDF 로딩 중... (${i}/${pdf.numPages})`);
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 0.8 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d')!;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: context, viewport }).promise;
          pages.push({ pageNum: i, thumbnail: canvas.toDataURL('image/jpeg', 0.9), selected: false });
        }
        setDocumentPages(pages);
        setShowPageSelectionModal(true);
      } catch (err) {
        console.error('PDF 로딩 오류:', err);
        setOcrError('PDF 파일을 읽을 수 없습니다.');
        setPendingPdfFile(null);
      } finally {
        setIsLoadingDocument(false);
        setPdfLoadingMessage('');
      }
    } else if (file.type.startsWith('image/')) {
      setOcrTargetFile(file);
      setSelectedFile(file);
      setIsOCRProcessing(true);
      setOcrError(null);
    } else {
      setOcrError('지원하지 않는 파일 형식입니다.');
    }
  }, []);

  /**
   * PDF 페이지 선택 확인 핸들러
   */
  const handlePageSelectionConfirm = useCallback(async (selectedPages: DocumentPage[]) => {
    setShowPageSelectionModal(false);
    const selected = selectedPages.filter(p => p.selected);
    if (selected.length === 0 || !pendingPdfFile) return;

    try {
      setIsOCRProcessing(true);
      setOcrError(null);

      const arrayBuffer = await pendingPdfFile.arrayBuffer();
      const pdfjsLib = await getPdfjs();
      const pdf = await pdfjsLib.getDocument({
        data: arrayBuffer,
        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/cmaps/',
        cMapPacked: true,
      }).promise;

      const pageCanvases: HTMLCanvasElement[] = [];
      let totalHeight = 0;
      let maxWidth = 0;

      for (const pageInfo of selected) {
        const page = await pdf.getPage(pageInfo.pageNum);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context failed');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport }).promise;
        pageCanvases.push(canvas);
        totalHeight += canvas.height;
        maxWidth = Math.max(maxWidth, canvas.width);
      }

      const mergedCanvas = document.createElement('canvas');
      const mergedContext = mergedCanvas.getContext('2d');
      if (!mergedContext) throw new Error('Merged canvas context failed');
      mergedCanvas.width = maxWidth;
      mergedCanvas.height = totalHeight;
      mergedContext.fillStyle = '#FFFFFF';
      mergedContext.fillRect(0, 0, maxWidth, totalHeight);

      let currentY = 0;
      for (const canvas of pageCanvases) {
        mergedContext.drawImage(canvas, (maxWidth - canvas.width) / 2, currentY);
        currentY += canvas.height;
      }

      const blob = await new Promise<Blob>((resolve, reject) => {
        mergedCanvas.toBlob((b) => b ? resolve(b) : reject(new Error('Blob conversion failed')), 'image/png');
      });

      const pageNumbers = selected.map(p => p.pageNum).join('_');
      const pdfImageFile = new File([blob], `${pendingPdfFile.name}_pages_${pageNumbers}.png`, { type: 'image/png' });

      setOcrTargetFile(pdfImageFile);
      setSelectedFile(pdfImageFile);
    } catch (err) {
      console.error('PDF 페이지 변환 오류:', err);
      setOcrError('PDF 페이지를 처리하는 중 오류가 발생했습니다.');
      setIsOCRProcessing(false);
    } finally {
      setDocumentPages([]);
      setPendingPdfFile(null);
    }
  }, [pendingPdfFile]);

  /**
   * 이미지 영역 추출 핸들러
   */
  const handleExtractImage = useCallback((dataUrl: string, sourceFileName?: string) => {
    const newImage = {
      id: `extract_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      dataUrl,
      sourceFileName,
    };
    setExtractedImages((prev) => [...prev, newImage]);
  }, []);

  const handleRemoveExtractedImage = useCallback((id: string) => {
    setExtractedImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const handleAutoExtractImage = useCallback((dataUrl: string, questionNumber: number, sourceFileName?: string) => {
    setAutoExtractedImages((prev) => {
      const newMap = new Map(prev);
      newMap.set(questionNumber, dataUrl);
      return newMap;
    });
    const newImage = {
      id: `auto_${questionNumber}_${Date.now()}`,
      dataUrl,
      sourceFileName: sourceFileName ? `${sourceFileName} (문제 ${questionNumber})` : `문제 ${questionNumber} 자동 추출`,
    };
    setExtractedImages((prev) => [...prev, newImage]);
  }, []);

  /**
   * OCR 완료 핸들러
   */
  const handleOCRComplete = useCallback((result: ParseResult) => {
    setIsOCRProcessing(false);

    if (result.questions.length > 0) {
      const convertedQuestions: QuestionData[] = result.questions.map(
        (parsed: ParsedQuestion, index: number) => {
          let answerIndex = -1;
          if (typeof parsed.answer === 'number') {
            answerIndex = parsed.answer;
          } else if (parsed.type === 'ox') {
            const ansStr = String(parsed.answer).toLowerCase();
            answerIndex = (ansStr === 'o' || ansStr === '참') ? 0 : 1;
          }

          const answerIndices = parsed.answerIndices || undefined;
          const answerText = (parsed.type === 'short_answer' || parsed.type === 'subjective') &&
            typeof parsed.answer === 'string' ? parsed.answer : '';

          let mixedExamples: Array<{ id: string; type: 'text' | 'labeled' | 'gana' | 'bullet'; label?: string; content?: string; items?: Array<{ id: string; label: string; content: string }> }> | undefined;

          if (parsed.mixedExamples && parsed.mixedExamples.length > 0) {
            mixedExamples = parsed.mixedExamples;
          } else if (parsed.examples) {
            if (parsed.examples.type === 'labeled') {
              const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'];
              mixedExamples = parsed.examples.items.map((content, idx) => ({
                id: `ex_${Date.now()}_${idx}`,
                type: 'labeled' as const,
                label: KOREAN_LABELS[idx] || `${idx + 1}`,
                content,
              }));
            } else {
              mixedExamples = parsed.examples.items.map((content, idx) => ({
                id: `ex_${Date.now()}_${idx}`,
                type: 'text' as const,
                content,
              }));
            }
          }

          let passageType: 'text' | 'korean_abc' | undefined;
          let passage: string | undefined;
          let koreanAbcItems: Array<{ label: string; text: string }> | undefined;

          if (parsed.passageType) passageType = parsed.passageType;
          if (parsed.passage) passage = parsed.passage;
          if (parsed.koreanAbcItems && parsed.koreanAbcItems.length > 0) {
            const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'];
            koreanAbcItems = parsed.koreanAbcItems.map((text, idx) => ({
              label: KOREAN_LABELS[idx] || `${idx + 1}`,
              text,
            }));
          }

          const questionNumber = index + 1;
          const autoImage = autoExtractedImages.get(questionNumber);

          const questionData: QuestionData = {
            id: `ocr_${Date.now()}_${index}`,
            text: parsed.text,
            type: parsed.type,
            choices: parsed.choices || ['', '', '', ''],
            answerIndex,
            answerText,
            explanation: parsed.explanation || '',
            imageUrl: autoImage || null,
            examples: null,
            mixedExamples,
          };

          if (answerIndices && answerIndices.length > 0) questionData.answerIndices = answerIndices;
          if (passageType) questionData.passageType = passageType;
          if (passage) questionData.passage = passage;
          if (koreanAbcItems) questionData.koreanAbcItems = koreanAbcItems;
          if (parsed.passagePrompt) questionData.passagePrompt = parsed.passagePrompt;
          if (parsed.bogi) questionData.bogi = parsed.bogi;
          if (parsed.passageBlocks && parsed.passageBlocks.length > 0) questionData.passageBlocks = parsed.passageBlocks;

          return questionData;
        }
      );

      setQuestions((prev) => [...prev, ...convertedQuestions]);
      setStep('questions');
    } else if (result.rawText.trim()) {
      alert(`텍스트가 추출되었지만 문제 형식을 인식하지 못했습니다.\n직접 문제를 입력해주세요.`);
      setStep('questions');
      setIsAddingNew(true);
    }
    setAutoExtractedImages(new Map());
  }, [autoExtractedImages]);

  const handleOCRError = useCallback((error: string) => {
    setIsOCRProcessing(false);
    setOcrError(error);
  }, []);

  const handleOCRCancel = useCallback(() => {
    setIsOCRProcessing(false);
    setSelectedFile(null);
    setOcrError(null);
    setOriginalImageUrl(null);
  }, []);

  const handleImageReady = useCallback((imageUrl: string) => {
    setOriginalImageUrl(imageUrl);
  }, []);

  const handleImageCrop = useCallback((croppedImage: string) => {
    if (editingIndex !== null) {
      setQuestions((prev) => {
        const updated = [...prev];
        updated[editingIndex] = { ...updated[editingIndex], imageUrl: croppedImage };
        return updated;
      });
    } else if (questions.length > 0) {
      setQuestions((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], imageUrl: croppedImage };
        return updated;
      });
    }
    setShowImageCropper(false);
  }, [editingIndex, questions.length]);

  const handleStartAddQuestion = useCallback(() => {
    setIsAddingNew(true);
    setEditingIndex(null);
  }, []);

  const handleEditQuestion = useCallback((index: number) => {
    setEditingIndex(index);
    setIsAddingNew(false);
  }, []);

  const handleSaveQuestion = useCallback(
    (question: QuestionData) => {
      if (editingIndex !== null) {
        setQuestions((prev) => {
          const newQuestions = [...prev];
          newQuestions[editingIndex] = question;
          return newQuestions;
        });
        setEditingIndex(null);
      } else {
        setQuestions((prev) => [...prev, question]);
        setIsAddingNew(false);
      }
    },
    [editingIndex]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
    setIsAddingNew(false);
  }, []);

  /**
   * 다음 단계로 이동
   */
  const handleNextStep = useCallback(() => {
    if (step === 'upload') {
      setStep('questions');
    } else if (step === 'questions') {
      const totalCount = calculateTotalQuestionCount(questions);
      if (totalCount < 1) return;
      setStep('meta');
    } else if (step === 'meta') {
      const errors: { title?: string; quizType?: string; courseId?: string } = {};
      if (!title.trim()) errors.title = '퀴즈 제목을 입력해주세요.';
      if (!quizType) errors.quizType = '시험 유형을 선택해주세요.';
      if (!selectedCourseId) errors.courseId = '과목을 선택해주세요.';
      if (Object.keys(errors).length > 0) {
        setMetaErrors(errors);
        return;
      }
      setMetaErrors({});
      setStep('confirm');
    }
  }, [step, questions, title, quizType, selectedCourseId]);

  const handlePrevStep = useCallback(() => {
    if (step === 'questions') {
      setSelectedFile(null);
      setIsOCRProcessing(false);
      setOcrError(null);
      setStep('upload');
    } else if (step === 'meta') {
      setStep('questions');
    } else if (step === 'confirm') {
      setStep('meta');
    }
  }, [step]);

  /**
   * QuestionData를 QuizQuestion 형식으로 변환 (결합형 펼침)
   */
  const convertToQuizQuestions = useCallback((questionList: QuestionData[]) => {
    const flattenedQuestions: FlattenedQuestion[] = [];
    let orderIndex = 0;

    questionList.forEach((q) => {
      if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
        const combinedGroupId = `combined_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const subQuestionsCount = q.subQuestions.length;

        q.subQuestions.forEach((sq, sqIndex) => {
          let subAnswer: string | number | number[];
          if (sq.type === 'short_answer') {
            const answerTexts = (sq.answerTexts || [sq.answerText || '']).filter(t => t.trim());
            subAnswer = answerTexts.length > 1 ? answerTexts.join('|||') : answerTexts[0] || '';
          } else if (sq.type === 'multiple') {
            // 0-indexed로 저장 (recordAttempt CF와 일치)
            if (sq.answerIndices && sq.answerIndices.length > 1) {
              subAnswer = sq.answerIndices;
            } else if (sq.answerIndices && sq.answerIndices.length === 1) {
              subAnswer = sq.answerIndices[0];
            } else if (sq.answerIndex !== undefined && sq.answerIndex >= 0) {
              subAnswer = sq.answerIndex;
            } else {
              subAnswer = -1;
            }
          } else {
            subAnswer = sq.answerIndex ?? -1;
          }

          let subMixedExamples = null;
          if (sq.mixedExamples && Array.isArray(sq.mixedExamples) && sq.mixedExamples.length > 0) {
            const filteredMixed = sq.mixedExamples
              .filter((block: MixedExampleBlock) => {
                switch (block.type) {
                  case 'text': return block.content?.trim();
                  case 'labeled': return (block.items || []).some((i: LabeledItem) => i.content?.trim());
                  case 'image': return block.imageUrl?.trim();
                  case 'grouped': return (block.children?.length ?? 0) > 0;
                  default: return false;
                }
              })
              .map((block: MixedExampleBlock) => {
                if (block.type === 'labeled') return { ...block, items: (block.items || []).filter((i: LabeledItem) => i.content?.trim()) };
                if (block.type === 'grouped') return { ...block, children: (block.children || []).filter((child: MixedExampleBlock) => { if (child.type === 'text') return child.content?.trim(); if (child.type === 'labeled') return (child.items || []).some((i: LabeledItem) => i.content?.trim()); if (child.type === 'image') return child.imageUrl?.trim(); return false; }) };
                return block;
              });
            if (filteredMixed.length > 0) subMixedExamples = filteredMixed;
          }

          const subQuestionData: FlattenedQuestion = {
            id: sq.id || `${combinedGroupId}_${sqIndex}`,
            order: orderIndex++,
            text: sq.text,
            type: sq.type,
            choices: sq.type === 'multiple' ? sq.choices?.filter((c) => c.trim()) : undefined,
            answer: subAnswer,
            explanation: sq.explanation || undefined,
            choiceExplanations: sq.type === 'multiple' && sq.choiceExplanations && sq.choiceExplanations.some((e) => e && e.trim())
              ? sq.choiceExplanations.slice(0, (sq.choices || []).filter((c) => c.trim()).length)
              : undefined,
            imageUrl: sq.image || undefined,
            mixedExamples: subMixedExamples,
            combinedGroupId,
            combinedIndex: sqIndex,
            combinedTotal: subQuestionsCount,
            chapterId: sq.chapterId || q.chapterId || undefined,
            chapterDetailId: sq.chapterDetailId || q.chapterDetailId || undefined,
          };

          if (sqIndex === 0) {
            subQuestionData.passageType = q.passageType || 'text';
            subQuestionData.passage = q.passageType === 'text' ? (q.passage || q.text || '') : '';
            subQuestionData.passageImage = q.passageImage || undefined;
            subQuestionData.commonQuestion = q.commonQuestion || undefined;
            subQuestionData.koreanAbcItems = q.passageType === 'korean_abc'
              ? (q.koreanAbcItems || []).filter((item) => item.text?.trim()).map(item => item.text)
              : undefined;
            if (q.passageType === 'mixed' && q.passageMixedExamples && q.passageMixedExamples.length > 0) {
              const filteredPassageMixed = q.passageMixedExamples
                .filter((block: MixedExampleBlock) => { switch (block.type) { case 'text': return block.content?.trim(); case 'labeled': return (block.items || []).some((i: LabeledItem) => i.content?.trim()); case 'image': return block.imageUrl?.trim(); case 'grouped': return (block.children?.length ?? 0) > 0; default: return false; } })
                .map((block: MixedExampleBlock) => { if (block.type === 'labeled') return { ...block, items: (block.items || []).filter((i: LabeledItem) => i.content?.trim()) }; if (block.type === 'grouped') return { ...block, children: (block.children || []).filter((child: MixedExampleBlock) => { if (child.type === 'text') return child.content?.trim(); if (child.type === 'labeled') return (child.items || []).some((i: LabeledItem) => i.content?.trim()); if (child.type === 'image') return child.imageUrl?.trim(); return false; }) }; return block; });
              subQuestionData.passageMixedExamples = filteredPassageMixed.length > 0 ? filteredPassageMixed : undefined;
            }
            subQuestionData.combinedMainText = q.text || '';
          }

          flattenedQuestions.push(subQuestionData);
        });
      } else {
        let answer: string | number | number[];
        if (q.type === 'subjective' || q.type === 'short_answer') {
          const answerTexts = (q.answerTexts || [q.answerText]).filter(t => t.trim());
          answer = answerTexts.length > 1 ? answerTexts.join('|||') : answerTexts[0] || '';
        } else if (q.type === 'multiple') {
          // 0-indexed로 저장 (recordAttempt CF와 일치)
          if (q.answerIndices && q.answerIndices.length > 1) {
            answer = q.answerIndices;
          } else if (q.answerIndices && q.answerIndices.length === 1) {
            answer = q.answerIndices[0];
          } else if (q.answerIndex !== undefined && q.answerIndex >= 0) {
            answer = q.answerIndex;
          } else {
            answer = -1;
          }
        } else if (q.type === 'essay') {
          answer = '';
        } else {
          answer = q.answerIndex;
        }

        let questionMixedExamples = null;
        if (q.mixedExamples && Array.isArray(q.mixedExamples) && q.mixedExamples.length > 0) {
          const filteredMixed = q.mixedExamples
            .filter((block) => { switch (block.type) { case 'text': return block.content?.trim(); case 'labeled': return (block.items || []).some(i => i.content?.trim()); case 'image': return block.imageUrl?.trim(); case 'grouped': return (block.children?.length ?? 0) > 0; default: return false; } })
            .map(block => { if (block.type === 'labeled') return { ...block, items: (block.items || []).filter(i => i.content?.trim()) }; if (block.type === 'grouped') return { ...block, children: (block.children || []).filter(child => { if (child.type === 'text') return child.content?.trim(); if (child.type === 'labeled') return (child.items || []).some(i => i.content?.trim()); if (child.type === 'image') return child.imageUrl?.trim(); return false; }) }; return block; });
          if (filteredMixed.length > 0) questionMixedExamples = filteredMixed;
        }

        flattenedQuestions.push({
          order: orderIndex++,
          id: q.id,
          text: q.text,
          type: q.type === 'subjective' ? 'short_answer' : q.type,
          choices: q.type === 'multiple' ? q.choices.filter((c) => c.trim()) : undefined,
          answer,
          explanation: q.explanation || undefined,
          choiceExplanations: q.type === 'multiple' && q.choiceExplanations && q.choiceExplanations.some((e) => e && e.trim())
            ? q.choiceExplanations.slice(0, q.choices.filter((c) => c.trim()).length)
            : undefined,
          imageUrl: q.imageUrl || undefined,
          mixedExamples: questionMixedExamples,
          chapterId: q.chapterId || undefined,
          chapterDetailId: q.chapterDetailId || undefined,
        });
      }
    });

    return flattenedQuestions;
  }, []);

  /**
   * 퀴즈 저장
   */
  const handleSaveQuiz = useCallback(async (isPublished: boolean) => {
    if (!user) {
      setSaveError('로그인이 필요합니다.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      // 1. 문제 변환
      const flattenedQuestions = convertToQuizQuestions(questions);

      // 2. base64 이미지를 Storage에 업로드
      for (let i = 0; i < flattenedQuestions.length; i++) {
        const q = flattenedQuestions[i];
        if (q.imageUrl && typeof q.imageUrl === 'string' && q.imageUrl.startsWith('data:image/')) {
          const url = await uploadBase64ToStorage(q.imageUrl, user.uid, `questions[${i}].imageUrl`);
          flattenedQuestions[i].imageUrl = url;
        }
        if (q.passageImage && typeof q.passageImage === 'string' && q.passageImage.startsWith('data:image/')) {
          const url = await uploadBase64ToStorage(q.passageImage, user.uid, `questions[${i}].passageImage`);
          flattenedQuestions[i].passageImage = url;
        }
      }

      // 3. undefined 제거 (Firestore 호환)
      const cleanedQuestions = JSON.parse(JSON.stringify(flattenedQuestions));

      // 4. QuizInput 구성
      const quizInput: QuizInput = {
        title: title.trim(),
        description: description.trim() || undefined,
        targetClass: 'all',
        difficulty,
        isPublished,
        questions: cleanedQuestions,
        questionCount: questions.reduce((total, q) => {
          if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
            return total + q.subQuestions.length;
          }
          return total + 1;
        }, 0),
        courseId: selectedCourseId,
        quizType: quizType,
        tags: tags.length > 0 ? tags : undefined,
        ...(quizType === 'past' ? { pastYear, pastExamType } : {}),
      };

      // 5. createQuiz 호출
      await createQuiz(
        user.uid,
        user.displayName || '교수님',
        quizInput
      );

      // 초안 삭제
      deleteDraft();

      // 성공 시 퀴즈 목록으로 이동
      if (isPanelMode) closePanel();
      else router.push('/professor/quiz');
    } catch (error) {
      console.error('퀴즈 저장 실패:', error);
      setSaveError('퀴즈 저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSaving(false);
    }
  }, [user, title, description, difficulty, questions, selectedCourseId, quizType, tags, pastYear, pastExamType, createQuiz, convertToQuizQuestions, deleteDraft, router]);

  /**
   * 단계별 진행률
   */
  const getProgress = () => {
    switch (step) {
      case 'upload': return 25;
      case 'questions': return 50;
      case 'meta': return 75;
      case 'confirm': return 100;
      default: return 0;
    }
  };

  const pageVariants = {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0, transition: { duration: 0.3, ease: 'easeOut' } },
    exit: { opacity: 0, x: -20 },
  };

  // 과목 정보
  const selectedCourse = selectedCourseId ? getCourseById(selectedCourseId) : null;
  const quizTypeLabel = quizType === 'midterm' ? '중간' : quizType === 'final' ? '기말' : quizType === 'past' ? `기출 (${pastYear} ${pastExamType === 'midterm' ? '중간' : '기말'})` : quizType === 'independent' ? '단독' : '';

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="sticky top-0 z-20 border-b-2 border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8', marginTop: 'calc(-1 * env(safe-area-inset-top, 0px))', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="flex items-center justify-between px-3 py-2">
          <button type="button" onClick={handleBackButton} className="flex items-center text-[#1A1A1A] p-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-sm font-bold text-[#1A1A1A]">퀴즈 만들기</h1>
          <div className="w-8" />
        </div>
      </header>

      {/* 진행률 바 */}
      <div className="sticky z-10 border-b border-[#1A1A1A]" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 42px)', backgroundColor: '#F5F0E8' }}>
        <div className="px-3 py-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-bold text-[#1A1A1A]">
              {step === 'upload' && '1. 업로드'}
              {step === 'questions' && '2. 문제 편집'}
              {step === 'meta' && '3. 퀴즈 정보'}
              {step === 'confirm' && '4. 확인'}
            </span>
            <span className="text-sm text-[#5C5C5C]">{getProgress()}%</span>
          </div>
          <div className="h-1.5 bg-[#EDEAE4] overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${getProgress()}%` }}
              transition={{ duration: 0.3 }}
              className="h-full bg-[#1A1A1A]"
            />
          </div>
        </div>
      </div>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 px-3 py-6 max-w-lg mx-auto w-full overflow-y-auto">
        <AnimatePresence mode="wait">
          {/* Step 1: 업로드 */}
          {step === 'upload' && (
            <motion.div key="upload" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="space-y-6">
              <p className="text-base font-bold text-[#1A1A1A]">문제지 스캔</p>

              <ImageUploader
                onFileSelect={handleFileSelect}
                onExtractClick={() => extractFileInputRef.current?.click()}
                isExtractProcessing={isExtractProcessing}
                isLoading={isOCRProcessing || isLoadingDocument}
                error={ocrError}
              />

              {/* 이미지 추출용 숨겨진 파일 입력 */}
              <input
                ref={extractFileInputRef}
                type="file"
                accept="image/*,application/pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                multiple
                onChange={handleExtractFileSelect}
                className="hidden"
              />

              {/* PDF 로딩 중 표시 */}
              {isLoadingDocument && (
                <div className="flex items-center justify-center py-8 border-2 border-dashed border-[#9A9A9A]">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-[#5C5C5C]">{pdfLoadingMessage}</span>
                  </div>
                </div>
              )}

              {/* OCR 처리기 */}
              {ocrTargetFile && isOCRProcessing && (
                <OCRProcessor
                  file={ocrTargetFile}
                  onComplete={handleOCRComplete}
                  onError={handleOCRError}
                  onCancel={handleOCRCancel}
                  onImageReady={handleImageReady}
                  onAutoExtractImage={handleAutoExtractImage}
                />
              )}

              {/* 이전에 추출한 이미지가 있으면 표시 */}
              {extractedImages.length > 0 && (
                <div className="bg-[#E8F5E9] p-3 border border-[#1A6B1A] rounded-lg">
                  <p className="text-xs text-[#1A6B1A] font-bold">
                    추출된 이미지 {extractedImages.length}개가 있습니다.
                  </p>
                </div>
              )}

              {/* 직접 입력 버튼 */}
              <button
                type="button"
                onClick={() => { setStep('questions'); setIsAddingNew(true); }}
                disabled={isOCRProcessing}
                className="w-full py-2.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
              >
                직접 문제 입력하기
              </button>
            </motion.div>
          )}

          {/* Step 2: 문제 편집 */}
          {step === 'questions' && (
            <motion.div key="questions" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="space-y-4">
              <AnimatePresence>
                {(editingIndex !== null || isAddingNew) && (
                  <QuestionEditor
                    initialQuestion={editingIndex !== null ? questions[editingIndex] : undefined}
                    onSave={handleSaveQuestion}
                    onCancel={handleCancelEdit}
                    questionNumber={editingIndex !== null ? editingIndex + 1 : questions.length + 1}
                    userRole="professor"
                    courseId={selectedCourseId || userCourseId || undefined}
                    extractedImages={extractedImages}
                    onAddExtracted={handleExtractImage}
                    onRemoveExtracted={handleRemoveExtractedImage}
                  />
                )}
              </AnimatePresence>

              {editingIndex === null && !isAddingNew && (
                <>
                  <QuestionList
                    questions={questions}
                    onQuestionsChange={setQuestions}
                    onEditQuestion={handleEditQuestion}
                    userRole="professor"
                    courseId={selectedCourseId || userCourseId || undefined}
                  />

                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleStartAddQuestion}
                    className="w-full py-2.5 px-4 flex items-center justify-center gap-2 border-2 border-dashed border-[#1A1A1A] text-[#1A1A1A] text-xs font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    문제 추가
                  </motion.button>
                </>
              )}
            </motion.div>
          )}

          {/* Step 3: 퀴즈 정보 */}
          {step === 'meta' && (
            <motion.div key="meta" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="space-y-6">
              {/* 시험 유형 선택 */}
              <div>
                <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
                  시험 유형 <span className="text-[#8B1A1A]">*</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {QUIZ_TYPE_OPTIONS.map((option) => (
                    <motion.button
                      key={option.value}
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setQuizType(option.value)}
                      className={`
                        py-2.5 px-4 font-bold text-sm border-2 transition-all duration-200
                        ${quizType === option.value
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                        }
                      `}
                    >
                      {option.label}
                    </motion.button>
                  ))}
                </div>
                {metaErrors.quizType && <p className="mt-1 text-sm text-[#8B1A1A]">{metaErrors.quizType}</p>}
              </div>

              {/* 기출 상세 (년도 + 중간/기말) */}
              {quizType === 'past' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
                      기출 년도 <span className="text-[#8B1A1A]">*</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPastYear(prev => prev - 1)}
                        className="w-10 h-10 border-2 border-[#1A1A1A] bg-[#EDEAE4] text-[#1A1A1A] font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                      >
                        −
                      </button>
                      <span className="flex-1 text-center text-lg font-bold text-[#1A1A1A]">{pastYear}년</span>
                      <button
                        type="button"
                        onClick={() => setPastYear(prev => prev + 1)}
                        className="w-10 h-10 border-2 border-[#1A1A1A] bg-[#EDEAE4] text-[#1A1A1A] font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
                      시험 구분 <span className="text-[#8B1A1A]">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { value: 'midterm' as const, label: '중간고사' },
                        { value: 'final' as const, label: '기말고사' },
                      ]).map((option) => (
                        <motion.button
                          key={option.value}
                          type="button"
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setPastExamType(option.value)}
                          className={`
                            py-2.5 px-4 font-bold text-sm border-2 transition-all duration-200
                            ${pastExamType === option.value
                              ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                              : 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                            }
                          `}
                        >
                          {option.label}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 과목 선택 */}
              <div>
                <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
                  과목 <span className="text-[#8B1A1A]">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {courseList.map((course) => (
                    <motion.button
                      key={course.id}
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedCourseId(course.id)}
                      className={`
                        py-2.5 px-2 font-bold text-xs border-2 transition-all duration-200
                        ${selectedCourseId === course.id
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                        }
                      `}
                    >
                      {course.name}
                    </motion.button>
                  ))}
                </div>
                {metaErrors.courseId && <p className="mt-1 text-sm text-[#8B1A1A]">{metaErrors.courseId}</p>}
              </div>

              {/* 퀴즈 제목 */}
              <div>
                <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
                  퀴즈 제목 <span className="text-[#8B1A1A]">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: 중간고사 대비 퀴즈"
                  className="w-full px-4 py-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] placeholder:text-[#9A9A9A] outline-none focus:bg-[#FDFBF7]"
                />
                {metaErrors.title && <p className="mt-1 text-sm text-[#8B1A1A]">{metaErrors.title}</p>}
              </div>

              {/* 총평 (선택) */}
              <div>
                <label className="block text-sm font-bold text-[#1A1A1A] mb-2">총평 (선택)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="학생들에게 전할 한마디를 입력하세요"
                  rows={3}
                  className="w-full px-4 py-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] placeholder:text-[#9A9A9A] outline-none focus:bg-[#FDFBF7] resize-none"
                />
              </div>

              {/* 난이도 */}
              <div>
                <label className="block text-sm font-bold text-[#1A1A1A] mb-2">난이도</label>
                <div className="flex gap-2">
                  {DIFFICULTY_OPTIONS.map((option) => (
                    <motion.button
                      key={option.value}
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setDifficulty(option.value)}
                      className={`
                        flex-1 py-2.5 px-4 font-bold text-sm border-2 transition-all duration-200
                        ${difficulty === option.value
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                        }
                      `}
                    >
                      {option.label}
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* 태그 (선택) */}
              <div>
                <label className="block text-sm font-bold text-[#1A1A1A] mb-2">태그 (선택)</label>

                {/* 선택된 태그 */}
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {tags.map((tag) => (
                      <div
                        key={tag}
                        className="flex items-center gap-1 px-2 py-1 bg-[#1A1A1A] text-[#F5F0E8] text-sm font-medium rounded"
                      >
                        #{tag}
                        <button
                          type="button"
                          onClick={() => setTags(prev => prev.filter(t => t !== tag))}
                          className="ml-0.5 hover:text-[#D4CFC4]"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 태그 추가 버튼 */}
                <button
                  type="button"
                  onClick={() => setShowTagPicker(!showTagPicker)}
                  className={`w-full py-2.5 text-sm font-bold border-2 transition-all duration-200 rounded-lg ${
                    showTagPicker
                      ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                      : 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                  }`}
                >
                  {showTagPicker ? '태그 목록 닫기' : '태그 선택하기'}
                </button>

                {/* 태그 목록 */}
                <AnimatePresence>
                  {showTagPicker && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden mt-2"
                    >
                      <div className="flex flex-wrap gap-2 p-3 bg-[#EDEAE4] border border-[#D4CFC4] rounded-lg">
                        {tagOptions
                          .filter(tag => !tags.includes(tag))
                          .map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setTags(prev => [...prev, tag])}
                              className="px-3 py-1.5 text-sm font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
                            >
                              #{tag}
                            </button>
                          ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* Step 4: 확인 */}
          {step === 'confirm' && (
            <motion.div key="confirm" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="space-y-4">
              {/* 퀴즈 요약 카드 */}
              <div className="p-4 border border-[#1A1A1A] space-y-3 rounded-xl" style={{ backgroundColor: '#F5F0E8' }}>
                <div>
                  <span className="text-[10px] text-[#5C5C5C]">퀴즈 제목</span>
                  <p className="text-sm font-bold text-[#1A1A1A]">{title}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] text-[#5C5C5C]">시험 유형</span>
                    <p className="text-sm font-bold text-[#1A1A1A]">{quizTypeLabel}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#5C5C5C]">과목</span>
                    <p className="text-sm font-bold text-[#1A1A1A]">{selectedCourse?.name || '-'}</p>
                  </div>
                </div>

                {/* 태그 */}
                {tags.length > 0 && (
                  <div>
                    <span className="text-[10px] text-[#5C5C5C] mb-1 block">태그</span>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 border border-[#1A1A1A] text-[#1A1A1A] text-sm"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[#1A1A1A]">
                  <div className="text-center">
                    <p className="text-lg font-bold text-[#1A1A1A]">
                      {questions.reduce((total, q) => {
                        if (q.type === 'combined' && q.subQuestions) return total + q.subQuestions.length;
                        return total + 1;
                      }, 0)}
                    </p>
                    <p className="text-[10px] text-[#5C5C5C]">문제 수</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-[#1A1A1A]">
                      {difficulty === 'easy' ? '쉬움' : difficulty === 'hard' ? '어려움' : '보통'}
                    </p>
                    <p className="text-[10px] text-[#5C5C5C]">난이도</p>
                  </div>
                </div>

                {description.trim() && (
                  <div className="pt-3 border-t border-[#1A1A1A]">
                    <span className="text-[10px] text-[#5C5C5C]">총평</span>
                    <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{description}</p>
                  </div>
                )}
              </div>

              {/* 문제 미리보기 */}
              <div className="p-3 border border-[#1A1A1A] rounded-xl" style={{ backgroundColor: '#F5F0E8' }}>
                <h3 className="text-xs font-bold text-[#1A1A1A] mb-2">문제 미리보기</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {questions.map((q, index) => (
                    <div key={q.id}>
                      <div
                        className={`flex items-start gap-2 p-2 bg-[#EDEAE4] ${q.type === 'combined' ? 'cursor-pointer hover:bg-[#E5E0D8]' : ''}`}
                        onClick={() => {
                          if (q.type === 'combined') {
                            setPreviewExpanded(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(q.id)) newSet.delete(q.id);
                              else newSet.add(q.id);
                              return newSet;
                            });
                          }
                        }}
                      >
                        <span className="w-6 h-6 bg-[#1A1A1A] text-[#F5F0E8] flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {index + 1}
                        </span>
                        <div className="flex-1 flex items-center gap-2">
                          <p className="text-sm text-[#1A1A1A] line-clamp-1 flex-1">
                            {q.type === 'combined' ? (q.commonQuestion || q.text || '(공통 문제 없음)') : q.text}
                          </p>
                          {q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0 && (
                            <svg className={`w-4 h-4 text-[#5C5C5C] flex-shrink-0 transition-transform ${previewExpanded.has(q.id) ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </div>
                      </div>
                      {q.type === 'combined' && q.subQuestions && previewExpanded.has(q.id) && (
                        <div className="ml-8 border-l-2 border-[#1A1A1A] bg-[#F5F0E8]">
                          {q.subQuestions.map((sq, sqIdx) => (
                            <div key={sq.id} className="flex items-start gap-2 p-2 border-b border-[#EDEAE4] last:border-b-0">
                              <span className="text-sm font-bold text-[#5C5C5C] flex-shrink-0 w-8">{index + 1}-{sqIdx + 1}</span>
                              <p className="text-sm text-[#1A1A1A] line-clamp-1 flex-1">{sq.text || '(내용 없음)'}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {saveError && (
                <div className="p-3 border border-[#8B1A1A] text-[#8B1A1A] text-sm">{saveError}</div>
              )}
              {error && (
                <div className="p-3 border border-[#8B1A1A] text-[#8B1A1A] text-sm">{error}</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 하단 버튼 (업로드 단계에서는 숨김) */}
      {step !== 'upload' && <div className="sticky bottom-0 border-t-2 border-[#1A1A1A] px-3 py-3" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="max-w-lg mx-auto flex gap-2">
          <button
            type="button"
            onClick={handlePrevStep}
            disabled={isSaving}
            className="px-4 py-3 text-sm border-2 border-[#1A1A1A] text-[#1A1A1A] font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
          >
            이전
          </button>

          {step !== 'confirm' ? (
            <button
              type="button"
              onClick={handleNextStep}
              disabled={
                (step === 'questions' && calculateTotalQuestionCount(questions) < 1) ||
                isOCRProcessing ||
                editingIndex !== null ||
                isAddingNew
              }
              className="flex-1 py-3 text-sm bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
            >
              다음
            </button>
          ) : (
            <div className="flex-1 flex gap-3">
              <button
                type="button"
                onClick={() => handleSaveQuiz(false)}
                disabled={isSaving}
                className="flex-1 py-3 border-2 border-[#1A1A1A] text-[#1A1A1A] font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
              >
                비공개 저장
              </button>
              <button
                type="button"
                onClick={() => handleSaveQuiz(true)}
                disabled={isSaving}
                className="flex-1 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 rounded-lg"
              >
                {isSaving && (
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                공개 저장
              </button>
            </div>
          )}
        </div>
      </div>}

      {/* 나가기 확인 모달 */}
      <AnimatePresence>
        {showExitModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={isPanelMode
              ? 'absolute inset-0 z-50 flex items-end'
              : 'fixed inset-0 z-50 flex items-center justify-center p-4'
            }
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowExitModal(false)}
              className={isPanelMode ? 'absolute inset-0 bg-transparent' : 'absolute inset-0 bg-black/50'}
            />
            <motion.div
              initial={isPanelMode ? { y: '100%' } : { scale: 0.95, opacity: 0 }}
              animate={isPanelMode ? { y: 0 } : { scale: 1, opacity: 1 }}
              exit={isPanelMode ? { y: '100%' } : { scale: 0.95, opacity: 0 }}
              transition={isPanelMode ? { type: 'spring', stiffness: 400, damping: 35 } : undefined}
              className={isPanelMode
                ? 'relative bg-[#F5F0E8] border-t-2 border-[#1A1A1A] p-4 w-full rounded-t-2xl'
                : 'relative bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 max-w-[280px] w-full rounded-xl'
              }
            >
              <div className="text-center">
                <div className="w-9 h-9 bg-[#FFF8E7] border-2 border-[#D4A84B] flex items-center justify-center mx-auto mb-3">
                  <svg className="w-4 h-4 text-[#D4A84B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-[#1A1A1A] mb-1.5">작성 중인 내용이 있습니다</h3>
                <p className="text-xs text-[#5C5C5C] mb-4">저장하지 않고 나가면 작성 중인 내용이 사라집니다.<br />나중에 이어서 작성하시겠습니까?</p>
                <div className="space-y-1.5">
                  <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleSaveAndExit} className="w-full py-1.5 px-3 text-xs bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg">저장하고 나가기</motion.button>
                  <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleExitWithoutSave} className="w-full py-1.5 px-3 text-xs bg-[#EDEAE4] text-[#8B1A1A] font-bold border-2 border-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors rounded-lg">저장하지 않고 나가기</motion.button>
                  <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setShowExitModal(false)} className="w-full py-1.5 px-3 text-xs bg-[#EDEAE4] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg">계속 작성하기</motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 초안 복원 모달 */}
      <AnimatePresence>
        {showResumeModal && savedDraftInfo && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/50" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 max-w-[280px] w-full rounded-xl">
              <div className="text-center">
                <div className="w-9 h-9 bg-[#E8F5E9] border-2 border-[#1A6B1A] flex items-center justify-center mx-auto mb-3">
                  <svg className="w-4 h-4 text-[#1A6B1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-[#1A1A1A] mb-1.5">이전 작성 내용이 있습니다</h3>
                <div className="bg-[#EDEAE4] p-2.5 mb-3 text-left">
                  <p className="text-xs text-[#5C5C5C]">
                    {savedDraftInfo.title && <span className="block mb-0.5">제목: <span className="text-[#1A1A1A] font-medium">{savedDraftInfo.title}</span></span>}
                    <span className="block">문제 수: <span className="text-[#1A1A1A] font-medium">{savedDraftInfo.questionCount}개</span></span>
                  </p>
                </div>
                <p className="text-xs text-[#5C5C5C] mb-4">이어서 작성하시겠습니까?</p>
                <div className="flex gap-2">
                  <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleStartFresh} className="flex-1 py-1.5 px-3 text-xs bg-[#EDEAE4] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg">처음부터</motion.button>
                  <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleResumeDraft} className="flex-1 py-1.5 px-3 text-xs bg-[#1A6B1A] text-[#F5F0E8] font-bold border-2 border-[#1A6B1A] hover:bg-[#145214] transition-colors rounded-lg">이어서 작성</motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 이미지 크롭 모달 */}
      {showImageCropper && originalImageUrl && (
        <ImageCropper
          imageSource={originalImageUrl}
          onCrop={handleImageCrop}
          onClose={() => setShowImageCropper(false)}
          title="이미지 영역 선택"
        />
      )}

      {/* PDF 페이지 선택 모달 */}
      <PageSelectionModal
        isOpen={showPageSelectionModal}
        onClose={() => { setShowPageSelectionModal(false); setDocumentPages([]); setPendingPdfFile(null); }}
        onConfirm={handlePageSelectionConfirm}
        pages={documentPages}
        title="PDF 페이지 선택"
        isLoading={isLoadingDocument}
        loadingMessage={pdfLoadingMessage}
      />

      {/* 이미지 추출 모달 */}
      {showImageExtractor && extractorFiles.length > 0 && (
        <ImageRegionSelector
          uploadedFiles={extractorFiles}
          extractedImages={extractedImages}
          onExtract={handleExtractImage}
          onRemoveExtracted={handleRemoveExtractedImage}
          onClose={() => { setShowImageExtractor(false); setExtractorFiles([]); }}
        />
      )}
    </div>
  );
}
