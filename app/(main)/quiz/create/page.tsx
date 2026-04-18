'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { collection, addDoc, serverTimestamp, db } from '@/lib/repositories';
import { auth } from '@/lib/firebase';
import { processQuizImages, sanitizeForFirestore } from '@/lib/utils/quizImageUpload';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse, useUser, useClosePanel, usePanelLock, usePanelStatePreservation } from '@/lib/contexts';
import { useExpToast } from '@/components/common';
import { EXP_REWARDS } from '@/lib/utils/expRewards';
import { getCurrentSemesterByDate } from '@/lib/types/course';
import dynamic from 'next/dynamic';
import {
  ImageUploader,
  QuestionList,
  QuizMetaForm,
  calculateTotalQuestionCount,
  validateRequiredTags,
  getChapterTags,
  ExtractedImagesProvider,
  useExtractedImages,
  ExtractedImagePicker,
  AutoExplanationGenerator,
  type QuestionData,
  type QuizMeta,
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

/**
 * 페이지 단계
 */
type Step = 'upload' | 'questions' | 'meta' | 'confirm';

/**
 * Firestore에 저장할 평탄화된 문제 데이터
 * 결합형 하위 문제와 일반 문제 모두 이 형태로 저장됨
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
  examples?: { type: string; items: string[] } | null;
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
  passagePrompt?: string;
  bogi?: { questionText: string; items: Array<{ id: string; label: string; content: string }> } | null;
  passageBlocks?: Array<{ id: string; type: string; content?: string; items?: Array<{ id: string; label: string; content: string }>; imageUrl?: string; children?: unknown[]; prompt?: string }>;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 자체제작 퀴즈 생성 페이지
 *
 * OCR을 통한 이미지/PDF 업로드 또는 직접 입력으로
 * 퀴즈 문제를 생성하고 저장합니다.
 */
export default function QuizCreatePage({ isPanelMode }: { isPanelMode?: boolean } = {}) {
  const router = useRouter();
  const { user } = useAuth();
  const { userCourseId } = useCourse();
  const { profile } = useUser();
  const { showExpToast } = useExpToast();
  const closePanel = useClosePanel();
  usePanelLock(isPanelMode); // 패널 모드 + 3쪽에서만 lock

  // 단계 관리
  const [step, setStep] = useState<Step>('upload');
  // (아래에서 usePanelStatePreservation으로 승격 시 복원)

  // 파일 업로드 상태
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isOCRProcessing, setIsOCRProcessing] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);


  // 이미지 크롭 상태
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [showImageCropper, setShowImageCropper] = useState(false);

  // OCR 대상 파일
  const [ocrTargetFile, setOcrTargetFile] = useState<File | null>(null);

  // 추출된 이미지 목록 (localStorage에 영구 저장)
  const EXTRACTED_IMAGES_KEY = 'quiz_extracted_images';
  const [extractedImages, setExtractedImages] = useState<Array<{ id: string; dataUrl: string; sourceFileName?: string }>>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('quiz_extracted_images');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // 자동 추출 이미지 매핑 (문제 번호 -> 이미지 데이터)
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

  // 퀴즈 메타 정보
  const [quizMeta, setQuizMeta] = useState<QuizMeta>({
    title: '',
    tags: [],
    isPublic: true,
    difficulty: 'normal',
  });

  // 승격 시 상태 보존 (2쪽→3쪽 이동 시 step/questions/quizMeta 유지)
  usePanelStatePreservation(
    'quiz-create',
    () => ({ step, questions, quizMeta }),
    (saved) => {
      if (saved.step) setStep(saved.step as Step);
      if (saved.questions) setQuestions(saved.questions as QuestionData[]);
      if (saved.quizMeta) setQuizMeta(saved.quizMeta as QuizMeta);
    },
  );

  // 저장 상태
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 미리보기 아코디언 상태 (결합형 문제 ID -> 펼침 여부)
  const [previewExpanded, setPreviewExpanded] = useState<Set<string>>(new Set());

  // 유효성 검사 에러
  const [metaErrors, setMetaErrors] = useState<{ title?: string; tags?: string }>({});

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
  const DRAFT_KEY = 'quiz_create_draft';

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
      const cleanedMeta = sanitizeForFirestore(quizMeta) || {};

      const draftData = {
        step,
        questions: cleanedQuestions,
        quizMeta: cleanedMeta,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draftData));
      return true;
    } catch (err) {
      console.error('초안 저장 실패:', err);
      return false;
    }
  }, [step, questions, quizMeta]);

  /**
   * 초안 불러오기
   */
  const loadDraft = useCallback(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
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
   */
  useEffect(() => {
    const draft = loadDraft();
    if (draft && (draft.questions?.length > 0 || draft.quizMeta?.title)) {
      setSavedDraftInfo({
        questionCount: draft.questions?.length || 0,
        title: draft.quizMeta?.title || '',
      });
      setShowResumeModal(true);
    }
  }, [loadDraft]);

  /**
   * 이전 초안 이어서 작성
   */
  const handleResumeDraft = useCallback(() => {
    const draft = loadDraft();
    if (draft) {
      if (draft.step) setStep(draft.step);
      if (draft.questions) setQuestions(draft.questions);
      if (draft.quizMeta) setQuizMeta(draft.quizMeta);
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

  // 슬라이드 아웃 애니메이션 상태
  const [isClosing, setIsClosing] = useState(false);

  // 뒤로가기 — 패널 모드: closeDetail, 세로모드: 슬라이드 아웃
  const navigateBack = useCallback(() => {
    if (isPanelMode) { closePanel(); return; }
    setIsClosing(true);
    setTimeout(() => router.back(), 280);
  }, [router, isPanelMode, closePanel]);

  /**
   * 저장하고 나가기
   */
  const handleSaveAndExit = useCallback(() => {
    const success = saveDraft();
    if (success) {
      navigateBack();
    } else {
      alert('저장에 실패했습니다.');
    }
  }, [saveDraft, navigateBack]);

  /**
   * 저장하지 않고 나가기
   */
  const handleExitWithoutSave = useCallback(() => {
    deleteDraft();
    navigateBack();
  }, [deleteDraft, navigateBack]);

  /**
   * 뒤로가기 버튼 핸들러
   */
  const handleBackButton = useCallback(() => {
    // 작성 중인 내용이 있으면 모달 표시
    if (step !== 'upload' || questions.length > 0 || quizMeta.title) {
      setShowExitModal(true);
    } else {
      navigateBack();
    }
  }, [step, questions.length, quizMeta.title, navigateBack]);

  /**
   * 파일을 base64로 변환
   */
  const fileToBase64 = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

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
   * 이미지/PDF/PPT를 받아서 ImageRegionSelector에 전달
   */
  const handleExtractFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileArray = Array.from(e.target.files || []); // value 리셋 전에 복사
    if (fileArray.length === 0) return;
    e.target.value = ''; // 같은 파일 재선택 허용

    setIsExtractProcessing(true);
    const items: UploadedFileItem[] = [];

    try {
      for (const file of fileArray) {
        if (file.name.endsWith('.pptx') || file.type.includes('presentation')) {
          // PPT → Cloud Run LibreOffice로 PDF 변환 후 ImageRegionSelector에 전달
          try {
            // 1. Firebase ID 토큰 획득
            const idToken = await auth.currentUser!.getIdToken();

            // 2. Cloud Run 직접 호출 (CF 미경유, 바이너리 전송)
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

            // 3. PDF 바이너리 직접 수신 → File 객체
            const pdfBlob = await resp.blob();
            const pdfFile = new File(
              [pdfBlob],
              file.name.replace(/\.pptx$/i, '.pdf'),
              { type: 'application/pdf' }
            );

            // 4. PDF로 ImageRegionSelector에 전달
            items.push({
              id: `pdf-${Date.now()}-${file.name}`,
              file: pdfFile,
              preview: 'pdf',
            });
          } catch (err) {
            console.error('PPT 변환 실패:', err);
            alert('PPT 파일을 변환하는 중 오류가 발생했습니다. PDF로 변환 후 업로드해주세요.');
          }
        } else if (file.type === 'application/pdf') {
          items.push({ id: `pdf-${Date.now()}-${file.name}`, file, preview: 'pdf' });
        } else if (file.type.startsWith('image/')) {
          items.push({
            id: `img-${Date.now()}-${file.name}`,
            file,
            preview: await blobToDataUrl(file),
          });
        }
      }

      if (items.length > 0) {
        setExtractorFiles(items);
        setShowImageExtractor(true);
      }
    } finally {
      setIsExtractProcessing(false);
    }
  }, [blobToDataUrl, user]);

  /**
   * 파일 선택 핸들러 - 이미지는 바로 OCR, PDF는 페이지 선택 모달 표시
   */
  const handleFileSelect = useCallback(async (file: File) => {
    // PDF 파일인 경우 - 페이지 선택 모달 표시
    if (file.type === 'application/pdf') {
      try {
        setIsLoadingDocument(true);
        setPdfLoadingMessage('PDF 로딩 중...');
        setOcrError(null);
        setPendingPdfFile(file);

        const arrayBuffer = await file.arrayBuffer();

        // PDF 로드
        const pdfjsLib = await getPdfjs();
        const pdf = await pdfjsLib.getDocument({
          data: arrayBuffer,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/cmaps/',
          cMapPacked: true,
        }).promise;

        const pages: DocumentPage[] = [];

        // 각 페이지의 썸네일 생성
        for (let i = 1; i <= pdf.numPages; i++) {
          setPdfLoadingMessage(`PDF 로딩 중... (${i}/${pdf.numPages})`);
          const page = await pdf.getPage(i);
          // 썸네일 생성 (scale 0.8)
          const viewport = page.getViewport({ scale: 0.8 });

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d')!;
          canvas.width = viewport.width;
          canvas.height = viewport.height;

          await page.render({
            canvasContext: context,
            viewport: viewport,
          }).promise;

          const thumbnail = canvas.toDataURL('image/jpeg', 0.9);

          pages.push({
            pageNum: i,
            thumbnail,
            selected: false,
          });
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
      // 이미지 파일인 경우 바로 OCR 시작
      setOcrTargetFile(file);
      setSelectedFile(file);
      setIsOCRProcessing(true);
      setOcrError(null);
    } else {
      setOcrError('지원하지 않는 파일 형식입니다. 이미지 또는 PDF 파일을 업로드해주세요.');
    }
  }, []);

  /**
   * PDF 페이지 선택 확인 핸들러 - 선택된 모든 페이지를 병합하여 OCR 처리
   */
  const handlePageSelectionConfirm = useCallback(async (selectedPages: DocumentPage[]) => {
    setShowPageSelectionModal(false);

    const selected = selectedPages.filter(p => p.selected);
    if (selected.length === 0 || !pendingPdfFile) return;

    try {
      setIsOCRProcessing(true);
      setOcrError(null);

      // 선택된 페이지들을 고해상도 이미지로 변환
      const arrayBuffer = await pendingPdfFile.arrayBuffer();
      const pdfjsLib = await getPdfjs();
      const pdf = await pdfjsLib.getDocument({
        data: arrayBuffer,
        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/cmaps/',
        cMapPacked: true,
      }).promise;

      // 모든 선택된 페이지를 렌더링
      const pageCanvases: HTMLCanvasElement[] = [];
      let totalHeight = 0;
      let maxWidth = 0;

      for (const pageInfo of selected) {
        const page = await pdf.getPage(pageInfo.pageNum);
        const viewport = page.getViewport({ scale: 2.0 }); // 고해상도 (메모리 고려하여 2.0으로 조정)

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context failed');

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise;

        pageCanvases.push(canvas);
        totalHeight += canvas.height;
        maxWidth = Math.max(maxWidth, canvas.width);
      }

      // 모든 페이지를 세로로 병합
      const mergedCanvas = document.createElement('canvas');
      const mergedContext = mergedCanvas.getContext('2d');
      if (!mergedContext) throw new Error('Merged canvas context failed');

      mergedCanvas.width = maxWidth;
      mergedCanvas.height = totalHeight;

      // 흰색 배경으로 채우기
      mergedContext.fillStyle = '#FFFFFF';
      mergedContext.fillRect(0, 0, maxWidth, totalHeight);

      // 각 페이지를 순서대로 그리기
      let currentY = 0;
      for (const canvas of pageCanvases) {
        // 페이지를 가운데 정렬
        const offsetX = (maxWidth - canvas.width) / 2;
        mergedContext.drawImage(canvas, offsetX, currentY);
        currentY += canvas.height;
      }

      // 병합된 Canvas를 Blob으로 변환
      const blob = await new Promise<Blob>((resolve, reject) => {
        mergedCanvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Blob conversion failed'));
        }, 'image/png');
      });

      // Blob을 File로 변환
      const pageNumbers = selected.map(p => p.pageNum).join('_');
      const pdfImageFile = new File(
        [blob],
        `${pendingPdfFile.name}_pages_${pageNumbers}.png`,
        { type: 'image/png' }
      );

      setOcrTargetFile(pdfImageFile);
      setSelectedFile(pdfImageFile);
    } catch (err) {
      console.error('PDF 페이지 변환 오류:', err);
      setOcrError('PDF 페이지를 처리하는 중 오류가 발생했습니다.');
      setIsOCRProcessing(false);
    } finally {
      // PDF 관련 상태 초기화
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

  /**
   * 추출 이미지 삭제 핸들러
   */
  const handleRemoveExtractedImage = useCallback((id: string) => {
    setExtractedImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  /**
   * 자동 추출 이미지 핸들러 (OCR 이미지 영역 분석 후 호출)
   */
  const handleAutoExtractImage = useCallback((dataUrl: string, questionNumber: number, sourceFileName?: string) => {
    // 자동 추출 이미지 매핑에 저장
    setAutoExtractedImages((prev) => {
      const newMap = new Map(prev);
      newMap.set(questionNumber, dataUrl);
      return newMap;
    });

    // 추출 이미지 목록에도 추가 (나중에 수동으로 다른 문제에 할당할 수 있도록)
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

    // 파싱된 문제가 있으면 문제 목록에 추가하고 자동으로 다음 단계로 이동
    if (result.questions.length > 0) {
      const convertedQuestions: QuestionData[] = result.questions.map(
        (parsed: ParsedQuestion, index: number) => {
          // 정답 인덱스 계산
          let answerIndex = -1;
          if (typeof parsed.answer === 'number') {
            answerIndex = parsed.answer;
          } else if (parsed.type === 'ox') {
            const ansStr = String(parsed.answer).toLowerCase();
            answerIndex = (ansStr === 'o' || ansStr === '참') ? 0 : 1;
          }

          // 복수정답 처리
          const answerIndices = parsed.answerIndices || undefined;
          const hasMultipleAnswers = parsed.hasMultipleAnswers || (answerIndices && answerIndices.length > 1);

          // 단답형 정답
          const answerText = (parsed.type === 'short_answer' || parsed.type === 'subjective') &&
            typeof parsed.answer === 'string' ? parsed.answer : '';

          // 보기(Examples) 변환 - mixedExamples 형식으로 (레거시 호환용)
          let mixedExamples: Array<{ id: string; type: 'text' | 'labeled' | 'gana' | 'bullet'; label?: string; content?: string; items?: Array<{ id: string; label: string; content: string }> }> | undefined;

          // 1. parsed.mixedExamples가 있으면 그대로 사용 (레거시)
          if (parsed.mixedExamples && parsed.mixedExamples.length > 0) {
            mixedExamples = parsed.mixedExamples;
          }
          // 2. parsed.examples가 있으면 변환 (레거시)
          else if (parsed.examples) {
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

          // 결합형 처리
          let passageType: 'text' | 'korean_abc' | undefined;
          let passage: string | undefined;
          let koreanAbcItems: Array<{ label: string; text: string }> | undefined;

          if (parsed.passageType) {
            passageType = parsed.passageType;
          }
          if (parsed.passage) {
            passage = parsed.passage;
          }
          if (parsed.koreanAbcItems && parsed.koreanAbcItems.length > 0) {
            const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'];
            koreanAbcItems = parsed.koreanAbcItems.map((text, idx) => ({
              label: KOREAN_LABELS[idx] || `${idx + 1}`,
              text,
            }));
          }

          // 자동 추출 이미지 확인 (문제 번호는 index + 1)
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
            imageUrl: autoImage || null,  // 자동 추출 이미지가 있으면 사용
            examples: null, // 레거시 필드
            mixedExamples, // 새로운 혼합 보기 형식
          };

          // 선택적 필드 추가
          if (answerIndices && answerIndices.length > 0) {
            questionData.answerIndices = answerIndices;
          }
          if (passageType) {
            questionData.passageType = passageType;
          }
          if (passage) {
            questionData.passage = passage;
          }
          if (koreanAbcItems) {
            questionData.koreanAbcItems = koreanAbcItems;
          }

          // 제시문 발문 추가
          if (parsed.passagePrompt) {
            questionData.passagePrompt = parsed.passagePrompt;
          }

          // 보기(bogi) 추가 - OCRProcessor에서 전달됨
          if (parsed.bogi) {
            questionData.bogi = parsed.bogi;
          }

          // 제시문 블록들 추가 - OCRProcessor에서 전달됨
          if (parsed.passageBlocks && parsed.passageBlocks.length > 0) {
            questionData.passageBlocks = parsed.passageBlocks;
          }

          return questionData;
        }
      );

      setQuestions((prev) => [...prev, ...convertedQuestions]);

      // 문제가 추출되면 자동으로 문제 편집 단계로 이동
      setStep('questions');
    } else if (result.rawText.trim()) {
      // 텍스트는 추출되었지만 문제 형식을 인식하지 못한 경우
      // 사용자에게 알림 후 문제 편집 단계로 이동하여 직접 입력하도록 함
      alert(`텍스트가 추출되었지만 문제 형식을 인식하지 못했습니다.\n직접 문제를 입력해주세요.\n\n추출된 텍스트:\n${result.rawText.slice(0, 200)}...`);
      setStep('questions');
      setIsAddingNew(true);
    }

    // OCR 완료 후 자동 추출 이미지 매핑 초기화
    setAutoExtractedImages(new Map());
  }, [autoExtractedImages]);

  /**
   * OCR 에러 핸들러
   */
  const handleOCRError = useCallback((error: string) => {
    setIsOCRProcessing(false);
    setOcrError(error);
  }, []);

  /**
   * OCR 취소 핸들러
   */
  const handleOCRCancel = useCallback(() => {
    setIsOCRProcessing(false);
    setSelectedFile(null);
    setOcrError(null);
    setOriginalImageUrl(null);
  }, []);

  /**
   * 원본 이미지 URL 설정 핸들러 (이미지 크롭용)
   */
  const handleImageReady = useCallback((imageUrl: string) => {
    setOriginalImageUrl(imageUrl);
  }, []);

  /**
   * 이미지 크롭 완료 핸들러
   */
  const handleImageCrop = useCallback((croppedImage: string) => {
    // 현재 편집 중인 문제 또는 마지막 문제에 이미지 첨부
    if (editingIndex !== null) {
      // 편집 중인 문제에 이미지 첨부
      setQuestions((prev) => {
        const updated = [...prev];
        updated[editingIndex] = {
          ...updated[editingIndex],
          imageUrl: croppedImage,
        };
        return updated;
      });
    } else if (questions.length > 0) {
      // 마지막 문제에 이미지 첨부
      setQuestions((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          imageUrl: croppedImage,
        };
        return updated;
      });
    } else {
      // 문제가 없으면 알림
      alert('이미지를 첨부할 문제가 없습니다. 먼저 문제를 추가해주세요.');
    }
    setShowImageCropper(false);
  }, [editingIndex, questions.length]);

  /**
   * 새 문제 추가 시작
   */
  const handleStartAddQuestion = useCallback(() => {
    setIsAddingNew(true);
    setEditingIndex(null);
  }, []);

  /**
   * 문제 편집 시작
   */
  const handleEditQuestion = useCallback((index: number) => {
    setEditingIndex(index);
    setIsAddingNew(false);
  }, []);

  /**
   * 문제 저장 (새 문제 또는 편집)
   */
  const handleSaveQuestion = useCallback(
    (question: QuestionData) => {
      if (editingIndex !== null) {
        // 기존 문제 수정
        setQuestions((prev) => {
          const newQuestions = [...prev];
          newQuestions[editingIndex] = question;
          return newQuestions;
        });
        setEditingIndex(null);
      } else {
        // 새 문제 추가
        setQuestions((prev) => [...prev, question]);
        setIsAddingNew(false);
      }
    },
    [editingIndex]
  );

  /**
   * 문제 편집 취소
   */
  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
    setIsAddingNew(false);
  }, []);

  /**
   * 다음 단계로 이동
   */
  const handleNextStep = useCallback(() => {
    if (step === 'upload') {
      // 문제가 없으면 직접 입력 모드로 전환
      setStep('questions');
    } else if (step === 'questions') {
      // 최소 3문제 확인 (결합형 하위문제 포함)
      const totalCount = calculateTotalQuestionCount(questions);
      if (totalCount < 3) {
        return;
      }
      setStep('meta');
    } else if (step === 'meta') {
      // 유효성 검사
      const errors: { title?: string; tags?: string } = {};

      if (!quizMeta.title.trim()) {
        errors.title = '퀴즈 제목을 입력해주세요.';
      }

      // 필수 태그 검증
      const chapterTags = getChapterTags(userCourseId);
      const tagError = validateRequiredTags(quizMeta.tags, chapterTags);
      if (tagError) {
        errors.tags = tagError;
      }

      if (Object.keys(errors).length > 0) {
        setMetaErrors(errors);
        return;
      }

      setMetaErrors({});
      setStep('confirm');
    }
  }, [step, questions, quizMeta.title, quizMeta.tags, userCourseId]);

  /**
   * 이전 단계로 이동
   */
  const handlePrevStep = useCallback(() => {
    if (step === 'questions') {
      // upload로 돌아갈 때 파일 상태 초기화
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
   * 퀴즈 저장
   */
  const handleSaveQuiz = useCallback(async (isPublic: boolean) => {
    if (!user) {
      setSaveError('로그인이 필요합니다.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      // Firestore에 퀴즈 저장
      const quizData = {
        // 메타 정보
        title: quizMeta.title.trim(),
        tags: quizMeta.tags,
        isPublic,
        difficulty: quizMeta.difficulty,
        type: 'custom' as const, // 자체제작 퀴즈

        // 문제 정보 - 결합형은 하위 문제를 개별 문제로 펼침
        questions: (() => {
          const flattenedQuestions: FlattenedQuestion[] = [];
          let orderIndex = 0;

          questions.forEach((q) => {
            // 결합형 문제: 하위 문제를 개별 문제로 펼침
            if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
              const combinedGroupId = `combined_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              const subQuestionsCount = q.subQuestions.length;

              q.subQuestions.forEach((sq, sqIndex) => {
                // 하위 문제 정답 처리
                let subAnswer: string | number | number[];
                if (sq.type === 'short_answer') {
                  const answerTexts = (sq.answerTexts || [sq.answerText || '']).filter(t => t.trim());
                  subAnswer = answerTexts.length > 1 ? answerTexts.join('|||') : answerTexts[0] || '';
                } else if (sq.type === 'multiple') {
                  // 객관식: 0-indexed로 저장 (AI 퀴즈와 통일)
                  if (sq.answerIndices && sq.answerIndices.length > 1) {
                    // 복수정답
                    subAnswer = sq.answerIndices;
                  } else if (sq.answerIndices && sq.answerIndices.length === 1) {
                    // 단일정답 (answerIndices에서)
                    subAnswer = sq.answerIndices[0];
                  } else if (sq.answerIndex !== undefined && sq.answerIndex >= 0) {
                    // 단일정답 (answerIndex에서)
                    subAnswer = sq.answerIndex;
                  } else {
                    subAnswer = -1;
                  }
                } else {
                  // OX: 0 = O, 1 = X (그대로 저장)
                  subAnswer = sq.answerIndex ?? -1;
                }

                // 하위 문제의 보기(examples) 처리 - 레거시 형식
                let subExamples = null;
                if (sq.examples && Array.isArray(sq.examples) && sq.examples.length > 0) {
                  const filteredItems = sq.examples.filter((item) => typeof item === 'string' && item.trim());
                  if (filteredItems.length > 0) {
                    subExamples = {
                      type: sq.examplesType || 'text',
                      items: filteredItems,
                    };
                  }
                } else if (sq.koreanAbcExamples && Array.isArray(sq.koreanAbcExamples) && sq.koreanAbcExamples.length > 0) {
                  const filteredItems = sq.koreanAbcExamples
                    .filter((item) => item && typeof item.text === 'string' && item.text.trim())
                    .map((item) => item.text);
                  if (filteredItems.length > 0) {
                    subExamples = {
                      type: 'labeled',
                      items: filteredItems,
                    };
                  }
                }

                // 하위 문제의 혼합 보기(mixedExamples) 처리
                let subMixedExamples = null;
                if (sq.mixedExamples && Array.isArray(sq.mixedExamples) && sq.mixedExamples.length > 0) {
                  const filteredMixed = sq.mixedExamples
                    .filter((block: MixedExampleBlock) => {
                      switch (block.type) {
                        case 'text':
                          return block.content?.trim();
                        case 'labeled':
                        case 'gana':
                        case 'bullet':
                          return (block.items || []).some((i: LabeledItem) => i.content?.trim());
                        case 'image':
                          return block.imageUrl?.trim();
                        case 'grouped':
                          return (block.children?.length ?? 0) > 0;
                        default:
                          return false;
                      }
                    })
                    .map((block: MixedExampleBlock) => {
                      if (block.type === 'labeled' || block.type === 'gana' || block.type === 'bullet') {
                        return {
                          ...block,
                          items: (block.items || []).filter((i: LabeledItem) => i.content?.trim()),
                        };
                      }
                      if (block.type === 'grouped') {
                        return {
                          ...block,
                          children: (block.children || []).filter((child: MixedExampleBlock) => {
                            if (child.type === 'text') return child.content?.trim();
                            if (child.type === 'labeled' || child.type === 'gana' || child.type === 'bullet') return (child.items || []).some((i: LabeledItem) => i.content?.trim());
                            if (child.type === 'image') return child.imageUrl?.trim();
                            return false;
                          }),
                        };
                      }
                      return block;
                    });
                  if (filteredMixed.length > 0) {
                    subMixedExamples = filteredMixed;
                  }
                }

                const subQuestionData: FlattenedQuestion = {
                  id: sq.id || `${combinedGroupId}_${sqIndex}`, // ID 명시적 포함
                  order: orderIndex++,
                  text: sq.text,
                  type: sq.type,
                  choices: sq.type === 'multiple' && sq.choices ? sq.choices.filter((c) => c && c.trim()) : null,
                  answer: subAnswer,
                  explanation: sq.explanation || null,
                  choiceExplanations: sq.type === 'multiple' && sq.choiceExplanations && sq.choiceExplanations.some((e) => e && e.trim())
                    ? sq.choiceExplanations.slice(0, (sq.choices || []).filter((c) => c && c.trim()).length)
                    : null,
                  imageUrl: sq.image || null,
                  examples: subExamples,
                  mixedExamples: subMixedExamples,
                  // 제시문/보기
                  ...(sq.passagePrompt ? { passagePrompt: sq.passagePrompt } : {}),
                  ...(sq.bogi ? { bogi: sq.bogi } : {}),
                  ...(sq.passageBlocks && sq.passageBlocks.length > 0 ? { passageBlocks: sq.passageBlocks } : {}),
                  // 결합형 그룹 정보
                  combinedGroupId,
                  combinedIndex: sqIndex,
                  combinedTotal: subQuestionsCount,
                  // 챕터 정보
                  chapterId: sq.chapterId || null,
                  chapterDetailId: sq.chapterDetailId || null,
                };

                // 첫 번째 하위 문제에만 공통 지문 정보 포함
                if (sqIndex === 0) {
                  subQuestionData.passageType = q.passageType || 'text';
                  subQuestionData.passage = q.passageType === 'text' ? (q.passage || q.text || '') : '';
                  subQuestionData.passageImage = q.passageImage || null;
                  subQuestionData.commonQuestion = q.commonQuestion || null; // 공통 문제 추가
                  subQuestionData.koreanAbcItems = q.passageType === 'korean_abc' && q.koreanAbcItems
                    ? q.koreanAbcItems.filter((item) => item && item.text?.trim()).map((item) => item.text)
                    : null;
                  // 공통 지문 혼합 보기 (passageType이 mixed일 때)
                  if (q.passageType === 'mixed' && q.passageMixedExamples && q.passageMixedExamples.length > 0) {
                    const filteredPassageMixed = q.passageMixedExamples
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
                        if (block.type === 'labeled') {
                          return { ...block, items: (block.items || []).filter((i: LabeledItem) => i.content?.trim()) };
                        }
                        if (block.type === 'grouped') {
                          return {
                            ...block,
                            children: (block.children || []).filter((child: MixedExampleBlock) => {
                              if (child.type === 'text') return child.content?.trim();
                              if (child.type === 'labeled') return (child.items || []).some((i: LabeledItem) => i.content?.trim());
                              if (child.type === 'image') return child.imageUrl?.trim();
                              return false;
                            }),
                          };
                        }
                        return block;
                      });
                    subQuestionData.passageMixedExamples = filteredPassageMixed.length > 0 ? filteredPassageMixed : null;
                  }
                  subQuestionData.combinedMainText = q.text || ''; // 결합형 메인 문제 텍스트
                }

                flattenedQuestions.push(subQuestionData);
              });
            } else {
              // 일반 문제 처리
              let answer: string | number | number[];
              if (q.type === 'subjective' || q.type === 'short_answer') {
                const answerTexts = (q.answerTexts || [q.answerText]).filter(t => t.trim());
                answer = answerTexts.length > 1 ? answerTexts.join('|||') : answerTexts[0] || '';
              } else if (q.type === 'multiple') {
                // 객관식: 0-indexed로 저장 (AI 퀴즈와 통일)
                if (q.answerIndices && q.answerIndices.length > 1) {
                  // 복수정답
                  answer = q.answerIndices;
                } else if (q.answerIndices && q.answerIndices.length === 1) {
                  // 단일정답 (answerIndices에서)
                  answer = q.answerIndices[0];
                } else if (q.answerIndex !== undefined && q.answerIndex >= 0) {
                  // 단일정답 (answerIndex에서)
                  answer = q.answerIndex;
                } else {
                  answer = -1;
                }
              } else {
                // OX: 0 = O, 1 = X (그대로 저장)
                answer = q.answerIndex;
              }

              // 일반 문제의 보기(examples) 처리 - 레거시 형식
              let questionExamples = null;
              if (q.examples && q.examples.items && Array.isArray(q.examples.items) && q.examples.items.length > 0) {
                const filteredItems = q.examples.items.filter((item) => typeof item === 'string' && item.trim());
                if (filteredItems.length > 0) {
                  questionExamples = {
                    type: q.examples.type || 'text',
                    items: filteredItems,
                  };
                }
              }

              // 혼합 보기(mixedExamples) 처리 - 블록 형식 (텍스트박스+ㄱㄴㄷ+이미지+그룹 블록)
              let questionMixedExamples = null;
              if (q.mixedExamples && Array.isArray(q.mixedExamples) && q.mixedExamples.length > 0) {
                const filteredMixed = q.mixedExamples
                  .filter((block) => {
                    switch (block.type) {
                      case 'text':
                        return block.content?.trim();
                      case 'labeled':
                      case 'gana':
                      case 'bullet':
                        return (block.items || []).some(i => i.content?.trim());
                      case 'image':
                        return block.imageUrl?.trim();
                      case 'grouped':
                        return (block.children?.length ?? 0) > 0;
                      default:
                        return false;
                    }
                  })
                  .map(block => {
                    if (block.type === 'labeled' || block.type === 'gana' || block.type === 'bullet') {
                      return {
                        ...block,
                        items: (block.items || []).filter(i => i.content?.trim()),
                      };
                    }
                    if (block.type === 'grouped') {
                      return {
                        ...block,
                        children: (block.children || []).filter(child => {
                          if (child.type === 'text') return child.content?.trim();
                          if (child.type === 'labeled' || child.type === 'gana' || child.type === 'bullet') return (child.items || []).some(i => i.content?.trim());
                          if (child.type === 'image') return child.imageUrl?.trim();
                          return false;
                        }),
                      };
                    }
                    return block;
                  });
                if (filteredMixed.length > 0) {
                  questionMixedExamples = filteredMixed;
                }
              }

              flattenedQuestions.push({
                id: q.id, // ID 명시적 포함 (통계 매칭용)
                order: orderIndex++,
                text: q.text,
                type: q.type === 'subjective' ? 'short_answer' : q.type,
                choices: q.type === 'multiple' && q.choices ? q.choices.filter((c) => c && c.trim()) : null,
                answer,
                explanation: q.explanation || null,
                choiceExplanations: q.type === 'multiple' && q.choiceExplanations && q.choiceExplanations.some((e) => e && e.trim())
                  ? q.choiceExplanations.slice(0, (q.choices || []).filter((c) => c && c.trim()).length)
                  : null,
                imageUrl: q.imageUrl || null,
                examples: questionExamples,
                mixedExamples: questionMixedExamples,
                // 제시문/보기
                ...(q.passagePrompt ? { passagePrompt: q.passagePrompt } : {}),
                ...(q.bogi ? { bogi: q.bogi } : {}),
                ...(q.passageBlocks && q.passageBlocks.length > 0 ? { passageBlocks: q.passageBlocks } : {}),
                // 챕터 정보
                chapterId: q.chapterId || null,
                chapterDetailId: q.chapterDetailId || null,
              });
            }
          });

          return flattenedQuestions;
        })(),
        // 실제 문제 수 계산 (결합형 하위 문제 포함)
        questionCount: (() => {
          return questions.reduce((total, q) => {
            if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
              return total + q.subQuestions.length;
            }
            return total + 1;
          }, 0);
        })(),

        // 문제 유형별 개수
        oxCount: questions.reduce((count, q) => {
          if (q.type === 'combined' && q.subQuestions) {
            return count + q.subQuestions.filter(sq => sq.type === 'ox').length;
          }
          return count + (q.type === 'ox' ? 1 : 0);
        }, 0),
        multipleChoiceCount: questions.reduce((count, q) => {
          if (q.type === 'combined' && q.subQuestions) {
            return count + q.subQuestions.filter(sq => sq.type === 'multiple').length;
          }
          return count + (q.type === 'multiple' ? 1 : 0);
        }, 0),
        subjectiveCount: questions.reduce((count, q) => {
          if (q.type === 'combined' && q.subQuestions) {
            return count + q.subQuestions.filter(sq => sq.type === 'short_answer' || sq.type === 'subjective').length;
          }
          return count + (q.type === 'short_answer' || q.type === 'subjective' ? 1 : 0);
        }, 0),

        // 생성자 정보
        creatorId: user.uid,
        creatorNickname: profile?.nickname || user.displayName || '익명 용사',
        creatorClassType: profile?.classType || null,

        // 과목 정보
        courseId: userCourseId || null,

        // 학기 정보 (날짜 기반 자동 설정)
        semester: getCurrentSemesterByDate(),

        // 통계 (초기값)
        participantCount: 0,
        averageScore: 0,
        bookmarkCount: 0,
        userScores: {},

      };

      // 1. 먼저 이미지를 Storage에 업로드
      const quizDataWithUrls = await processQuizImages(JSON.parse(JSON.stringify(quizData)), user.uid);

      // 2. 문제별 고유 ID 부여
      if (Array.isArray(quizDataWithUrls.questions)) {
        const { ensureQuestionIds } = await import('@/lib/utils/questionId');
        quizDataWithUrls.questions = ensureQuestionIds(quizDataWithUrls.questions);
      }

      // 3. 데이터 정리 (중첩 배열 제거 등)
      const cleanedQuizData = sanitizeForFirestore(quizDataWithUrls) as Record<string, unknown>;

      // 3. 타임스탬프 추가
      cleanedQuizData.createdAt = serverTimestamp();
      cleanedQuizData.updatedAt = serverTimestamp();

      // 5. Firestore에 저장
      await addDoc(collection(db, 'quizzes'), cleanedQuizData);

      // EXP 토스트 표시 — 실제 지급은 CF onQuizCreate에서 수행
      const earnedExp = cleanedQuizData.isPublic ? EXP_REWARDS.QUIZ_CREATE : EXP_REWARDS.QUIZ_AI_SAVE;
      showExpToast(earnedExp, '퀴즈 생성');

      // 저장된 초안 삭제
      deleteDraft();

      // 성공 시 이동
      setTimeout(() => {
        if (isPanelMode) { closePanel(); return; }
        router.push(cleanedQuizData.isPublic ? '/quiz?created=true' : '/review?filter=library');
      }, 300);
    } catch (error) {
      console.error('퀴즈 저장 실패:', error);
      setSaveError('퀴즈 저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSaving(false);
    }
  }, [user, quizMeta, questions, router, userCourseId, showExpToast, deleteDraft]);

  /**
   * 단계별 진행률
   */
  const getProgress = () => {
    switch (step) {
      case 'upload':
        return 25;
      case 'questions':
        return 50;
      case 'meta':
        return 75;
      case 'confirm':
        return 100;
      default:
        return 0;
    }
  };

  // 페이지 애니메이션
  const pageVariants = {
    initial: { opacity: 0, x: 20 },
    animate: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.3, ease: 'easeOut' },
    },
    exit: { opacity: 0, x: -20 },
  };

  return (
    <motion.div
      initial={isPanelMode ? { opacity: 0 } : { x: '100%' }}
      animate={isPanelMode ? { opacity: 1 } : { x: isClosing ? '100%' : 0 }}
      transition={isPanelMode ? { duration: 0.15 } : { type: 'spring', stiffness: 400, damping: 35 }}
      className={isPanelMode
        ? 'flex flex-col min-h-screen'
        : 'fixed inset-0 z-40 flex flex-col overflow-y-auto'
      }
      style={{ backgroundColor: '#F5F0E8' }}
    >
      {/* 헤더 */}
      <header className="sticky top-0 z-20 border-b-2 border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex items-center justify-between px-3 py-2" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
          <button
            type="button"
            onClick={handleBackButton}
            className="flex items-center text-[#1A1A1A] p-1"
          >
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
          {/* 단계 표시 */}
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-bold text-[#1A1A1A]">
              {step === 'upload' && '1. 업로드'}
              {step === 'questions' && '2. 문제 편집'}
              {step === 'meta' && '3. 퀴즈 정보'}
              {step === 'confirm' && '4. 확인'}
            </span>
            <span className="text-sm text-[#5C5C5C]">{getProgress()}%</span>
          </div>

          {/* 진행률 바 */}
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
      <main className="flex-1 px-3 py-4 max-w-lg mx-auto w-full overflow-y-auto">
        <AnimatePresence mode="wait">
          {/* Step 1: 업로드 */}
          {step === 'upload' && (
            <motion.div
              key="upload"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="space-y-4"
            >
              {/* 모드 설명 */}
              <p className="text-base font-bold text-[#1A1A1A]">문제지 스캔</p>

              {/* 이미지 업로더 - 파일 선택 시 바로 OCR 시작 (PDF는 페이지 선택 모달) */}
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
                onClick={() => {
                  setStep('questions');
                  setIsAddingNew(true);
                }}
                disabled={isOCRProcessing}
                className="w-full py-2.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
              >
                직접 문제 입력하기
              </button>
            </motion.div>
          )}

          {/* Step 2: 문제 편집 */}
          {step === 'questions' && (
            <motion.div
              key="questions"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="space-y-4"
            >
              {/* 문제 편집기 (편집 또는 새 문제 추가 중일 때) */}
              <AnimatePresence>
                {(editingIndex !== null || isAddingNew) && (
                  <QuestionEditor
                    initialQuestion={
                      editingIndex !== null ? questions[editingIndex] : undefined
                    }
                    onSave={handleSaveQuestion}
                    onCancel={handleCancelEdit}
                    questionNumber={
                      editingIndex !== null ? editingIndex + 1 : questions.length + 1
                    }
                    userRole={profile?.role === 'professor' ? 'professor' : 'student'}
                    courseId={userCourseId || undefined}
                    extractedImages={extractedImages}
                    onAddExtracted={handleExtractImage}
                    onRemoveExtracted={handleRemoveExtractedImage}
                  />
                )}
              </AnimatePresence>

              {/* 문제 목록 */}
              {editingIndex === null && !isAddingNew && (
                <>
                  <QuestionList
                    questions={questions}
                    onQuestionsChange={setQuestions}
                    onEditQuestion={handleEditQuestion}
                    userRole={profile?.role === 'professor' ? 'professor' : 'student'}
                    courseId={userCourseId || undefined}
                  />

                  {/* 문제 추가 버튼 */}
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleStartAddQuestion}
                    className="w-full py-2.5 px-4 flex items-center justify-center gap-2 border-2 border-dashed border-[#1A1A1A] text-[#1A1A1A] text-xs font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    문제 추가
                  </motion.button>
                </>
              )}
            </motion.div>
          )}

          {/* Step 3: 퀴즈 정보 */}
          {step === 'meta' && (
            <motion.div
              key="meta"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="space-y-4"
            >
              <QuizMetaForm
                meta={quizMeta}
                onChange={setQuizMeta}
                errors={metaErrors}
                courseId={userCourseId}
              />
            </motion.div>
          )}

          {/* Step 4: 확인 */}
          {step === 'confirm' && (
            <motion.div
              key="confirm"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="space-y-4"
            >
              {/* 퀴즈 요약 카드 */}
              <div className="p-4 border border-[#1A1A1A] space-y-3 rounded-xl" style={{ backgroundColor: '#F5F0E8' }}>
                {/* 제목 */}
                <div>
                  <span className="text-[10px] text-[#5C5C5C]">퀴즈 제목</span>
                  <p className="text-sm font-bold text-[#1A1A1A]">{quizMeta.title}</p>
                </div>

                {/* 태그 */}
                {quizMeta.tags.length > 0 && (
                  <div>
                    <span className="text-xs text-[#5C5C5C] mb-1 block">태그</span>
                    <div className="flex flex-wrap gap-2">
                      {quizMeta.tags.map((tag) => (
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

                {/* 정보 그리드 */}
                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-[#1A1A1A]">
                  <div className="text-center">
                    <p className="text-lg font-bold text-[#1A1A1A]">
                      {questions.length}
                    </p>
                    <p className="text-[10px] text-[#5C5C5C]">문제 수</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-[#1A1A1A]">
                      {quizMeta.difficulty === 'easy'
                        ? '쉬움'
                        : quizMeta.difficulty === 'hard'
                          ? '어려움'
                          : '보통'}
                    </p>
                    <p className="text-[10px] text-[#5C5C5C]">난이도</p>
                  </div>
                </div>
              </div>

              {/* 자동 해설 생성 */}
              <AutoExplanationGenerator
                questions={questions}
                courseId={userCourseId || null}
                onApply={setQuestions}
              />

              {/* 문제 미리보기 */}
              <div className="p-3 border border-[#1A1A1A] rounded-xl" style={{ backgroundColor: '#F5F0E8' }}>
                <h3 className="text-xs font-bold text-[#1A1A1A] mb-2">문제 미리보기</h3>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {questions.map((q, index) => (
                    <div key={q.id}>
                      {/* 일반 문제 또는 결합형 문제 헤더 */}
                      <div
                        className={`flex items-start gap-2 p-2 bg-[#EDEAE4] ${
                          q.type === 'combined' ? 'cursor-pointer hover:bg-[#E5E0D8]' : ''
                        }`}
                        onClick={() => {
                          if (q.type === 'combined') {
                            setPreviewExpanded(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(q.id)) {
                                newSet.delete(q.id);
                              } else {
                                newSet.add(q.id);
                              }
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
                          {/* 결합형: 아코디언 아이콘 */}
                          {q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0 && (
                            <svg
                              className={`w-4 h-4 text-[#5C5C5C] flex-shrink-0 transition-transform ${
                                previewExpanded.has(q.id) ? 'rotate-180' : ''
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </div>
                      </div>
                      {/* 해설 (일반 문제) */}
                      {q.type !== 'combined' && q.explanation && q.explanation.trim() && (
                        <div className="ml-8 px-2 py-1.5 border-l-2 border-[#1D5D4A] bg-[#F0F7F4] text-[11px] text-[#1A1A1A] leading-relaxed">
                          <span className="font-bold text-[#1D5D4A] mr-1">해설</span>
                          {q.explanation}
                        </div>
                      )}
                      {/* 결합형: 하위 문제 목록 (펼쳤을 때) */}
                      {q.type === 'combined' && q.subQuestions && previewExpanded.has(q.id) && (
                        <div className="ml-8 border-l-2 border-[#1A1A1A] bg-[#F5F0E8]">
                          {q.subQuestions.map((sq, sqIdx) => (
                            <div key={sq.id} className="border-b border-[#EDEAE4] last:border-b-0">
                              <div className="flex items-start gap-2 p-2">
                                <span className="text-sm font-bold text-[#5C5C5C] flex-shrink-0 w-8">
                                  {index + 1}-{sqIdx + 1}
                                </span>
                                <p className="text-sm text-[#1A1A1A] line-clamp-1 flex-1">
                                  {sq.text || '(내용 없음)'}
                                </p>
                              </div>
                              {sq.explanation && sq.explanation.trim() && (
                                <div className="ml-10 mr-2 mb-2 px-2 py-1.5 border-l-2 border-[#1D5D4A] bg-[#F0F7F4] text-[11px] text-[#1A1A1A] leading-relaxed">
                                  <span className="font-bold text-[#1D5D4A] mr-1">해설</span>
                                  {sq.explanation}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 저장 에러 */}
              {saveError && (
                <div className="p-3 border border-[#8B1A1A] text-[#8B1A1A] text-sm">
                  {saveError}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 하단 버튼 - 고정 (업로드 단계에서는 숨김) */}
      {step !== 'upload' && <div className="sticky bottom-0 border-t-2 border-[#1A1A1A] px-3 py-3" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="max-w-lg mx-auto flex gap-2">
          {/* 이전 버튼 */}
          <button
            type="button"
            onClick={handlePrevStep}
            disabled={isSaving}
            className="px-4 py-3 text-sm border-2 border-[#1A1A1A] text-[#1A1A1A] font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
          >
            이전
          </button>

          {/* 다음/저장 버튼 */}
          {step !== 'confirm' ? (
            <button
              type="button"
              onClick={handleNextStep}
              disabled={
                (step === 'questions' && calculateTotalQuestionCount(questions) < 3) ||
                isOCRProcessing ||
                editingIndex !== null ||
                isAddingNew
              }
              className="flex-1 py-3 text-sm bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
            >
              다음
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleSaveQuiz(false)}
                disabled={isSaving}
                className="flex-1 py-3 text-sm border-2 border-[#1A1A1A] text-[#1A1A1A] font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
              >
                비공개 저장
              </button>
              <button
                type="button"
                onClick={() => handleSaveQuiz(true)}
                disabled={isSaving}
                className="flex-1 py-3 text-sm bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 rounded-lg"
              >
                {isSaving && (
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                공개 저장
              </button>
            </>
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
            {/* 백드롭 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowExitModal(false)}
              className={isPanelMode ? 'absolute inset-0 bg-transparent' : 'absolute inset-0 bg-black/50'}
            />

            {/* 패널 모드: 바텀시트, 세로모드: 센터 모달 */}
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
                {/* 아이콘 */}
                <div className="w-9 h-9 bg-[#FFF8E7] border-2 border-[#D4A84B] flex items-center justify-center mx-auto mb-3">
                  <svg className="w-4 h-4 text-[#D4A84B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>

                {/* 제목 */}
                <h3 className="text-sm font-bold text-[#1A1A1A] mb-1.5">
                  작성 중인 내용이 있습니다
                </h3>

                {/* 설명 */}
                <p className="text-xs text-[#5C5C5C] mb-4">
                  저장하지 않고 나가면 작성 중인 내용이 사라집니다.
                  <br />나중에 이어서 작성하시겠습니까?
                </p>

                {/* 버튼 */}
                <div className="space-y-1.5">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSaveAndExit}
                    className="w-full py-1.5 px-3 text-xs bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg"
                  >
                    저장하고 나가기
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleExitWithoutSave}
                    className="w-full py-1.5 px-3 text-xs bg-[#EDEAE4] text-[#8B1A1A] font-bold border-2 border-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors rounded-lg"
                  >
                    저장하지 않고 나가기
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowExitModal(false)}
                    className="w-full py-1.5 px-3 text-xs bg-[#EDEAE4] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
                  >
                    계속 작성하기
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 초안 복원 모달 */}
      <AnimatePresence>
        {showResumeModal && savedDraftInfo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            {/* 백드롭 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50"
            />

            {/* 모달 */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 max-w-[280px] w-full rounded-xl"
            >
              <div className="text-center">
                {/* 아이콘 */}
                <div className="w-9 h-9 bg-[#E8F5E9] border-2 border-[#1A6B1A] flex items-center justify-center mx-auto mb-3">
                  <svg className="w-4 h-4 text-[#1A6B1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>

                {/* 제목 */}
                <h3 className="text-sm font-bold text-[#1A1A1A] mb-1.5">
                  이전 작성 내용이 있습니다
                </h3>

                {/* 진행 상황 정보 */}
                <div className="bg-[#EDEAE4] p-2.5 mb-3 text-left">
                  <p className="text-xs text-[#5C5C5C]">
                    {savedDraftInfo.title && (
                      <span className="block mb-0.5">
                        제목: <span className="text-[#1A1A1A] font-medium">{savedDraftInfo.title}</span>
                      </span>
                    )}
                    <span className="block">
                      문제 수: <span className="text-[#1A1A1A] font-medium">{savedDraftInfo.questionCount}개</span>
                    </span>
                  </p>
                </div>

                {/* 설명 */}
                <p className="text-xs text-[#5C5C5C] mb-4">
                  이어서 작성하시겠습니까?
                </p>

                {/* 버튼 */}
                <div className="flex gap-2">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleStartFresh}
                    className="flex-1 py-1.5 px-3 text-xs bg-[#EDEAE4] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
                  >
                    처음부터
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleResumeDraft}
                    className="flex-1 py-1.5 px-3 text-xs bg-[#1A6B1A] text-[#F5F0E8] font-bold border-2 border-[#1A6B1A] hover:bg-[#145214] transition-colors rounded-lg"
                  >
                    이어서 작성
                  </motion.button>
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
        onClose={() => {
          setShowPageSelectionModal(false);
          setDocumentPages([]);
          setPendingPdfFile(null);
        }}
        onConfirm={handlePageSelectionConfirm}
        pages={documentPages}
        title="PDF 페이지 선택"
        isLoading={isLoadingDocument}
        loadingMessage={pdfLoadingMessage}
      />

      {/* 이미지 추출 모달 (ImageRegionSelector) */}
      {showImageExtractor && extractorFiles.length > 0 && (
        <ImageRegionSelector
          uploadedFiles={extractorFiles}
          extractedImages={extractedImages}
          onExtract={handleExtractImage}
          onRemoveExtracted={handleRemoveExtractedImage}
          onClose={() => {
            setShowImageExtractor(false);
            setExtractorFiles([]);
          }}
        />
      )}

    </motion.div>
  );
}
