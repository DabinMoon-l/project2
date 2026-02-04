'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { compressImage, formatFileSize } from '@/lib/imageUtils';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse, useUser } from '@/lib/contexts';
import { useExpToast } from '@/components/common';
import { getCurrentSemesterByDate } from '@/lib/types/course';
import {
  ImageUploader,
  OCRProcessor,
  QuestionEditor,
  QuestionList,
  QuizMetaForm,
  calculateTotalQuestionCount,
  validateRequiredTags,
  getChapterTags,
  ExtractedImagesProvider,
  useExtractedImages,
  ImageRegionSelector,
  ExtractedImagePicker,
  type QuestionData,
  type QuizMeta,
} from '@/components/quiz/create';
import ImageCropper from '@/components/quiz/create/ImageCropper';
import type { ParseResult, ParsedQuestion } from '@/lib/ocr';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 페이지 단계
 */
type Step = 'upload' | 'questions' | 'meta' | 'confirm';

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 자체제작 퀴즈 생성 페이지
 *
 * OCR을 통한 이미지/PDF 업로드 또는 직접 입력으로
 * 퀴즈 문제를 생성하고 저장합니다.
 */
export default function QuizCreatePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { userCourseId } = useCourse();
  const { profile } = useUser();
  const { showExpToast } = useExpToast();

  // 단계 관리
  const [step, setStep] = useState<Step>('upload');

  // 파일 업로드 상태
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isOCRProcessing, setIsOCRProcessing] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // 이미지 크롭 상태
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [showImageCropper, setShowImageCropper] = useState(false);

  // 새로운 OCR 흐름: 파일 목록 관리
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ id: string; file: File; preview: string }>>([]);
  const [showImageRegionSelector, setShowImageRegionSelector] = useState(false);
  const [ocrTargetFile, setOcrTargetFile] = useState<File | null>(null);

  // 파일 선택 모드
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

  // 추출된 이미지 목록 (퀴즈 생성 세션 동안만 유지)
  const [extractedImages, setExtractedImages] = useState<Array<{ id: string; dataUrl: string; sourceFileName?: string }>>([]);

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

  // 저장 상태
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 미리보기 아코디언 상태 (결합형 문제 ID -> 펼침 여부)
  const [previewExpanded, setPreviewExpanded] = useState<Set<string>>(new Set());

  // 유효성 검사 에러
  const [metaErrors, setMetaErrors] = useState<{ title?: string; tags?: string }>({});

  // 초안 저장/복원 관련 상태
  const [showExitModal, setShowExitModal] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [savedDraftInfo, setSavedDraftInfo] = useState<{ questionCount: number; title: string } | null>(null);

  // localStorage 키
  const DRAFT_KEY = 'quiz_create_draft';

  /**
   * 데이터 정리 (undefined, null, 빈 배열 제거)
   * localStorage와 Firestore 모두 직렬화 가능한 데이터만 허용
   */
  const cleanDataForStorage = useCallback((data: any): any => {
    if (data === null || data === undefined) return null;
    if (Array.isArray(data)) {
      return data.map(item => cleanDataForStorage(item)).filter(item => item !== null && item !== undefined);
    }
    if (typeof data === 'object') {
      const cleaned: any = {};
      for (const key in data) {
        const value = data[key];
        // undefined, 함수, File 객체 제외
        if (value !== undefined && typeof value !== 'function' && !(value instanceof File)) {
          const cleanedValue = cleanDataForStorage(value);
          if (cleanedValue !== null && cleanedValue !== undefined) {
            cleaned[key] = cleanedValue;
          }
        }
      }
      return Object.keys(cleaned).length > 0 ? cleaned : null;
    }
    return data;
  }, []);

  /**
   * 초안 저장
   */
  const saveDraft = useCallback(() => {
    try {
      // 데이터 정리 후 저장
      const cleanedQuestions = cleanDataForStorage(questions) || [];
      const cleanedMeta = cleanDataForStorage(quizMeta) || {};

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
  }, [step, questions, quizMeta, cleanDataForStorage]);

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

  /**
   * 저장하고 나가기
   */
  const handleSaveAndExit = useCallback(() => {
    const success = saveDraft();
    if (success) {
      router.back();
    } else {
      alert('저장에 실패했습니다.');
    }
  }, [saveDraft, router]);

  /**
   * 저장하지 않고 나가기
   */
  const handleExitWithoutSave = useCallback(() => {
    deleteDraft();
    router.back();
  }, [deleteDraft, router]);

  /**
   * 뒤로가기 버튼 핸들러
   */
  const handleBackButton = useCallback(() => {
    // 작성 중인 내용이 있으면 모달 표시
    if (step !== 'upload' || questions.length > 0 || quizMeta.title) {
      setShowExitModal(true);
    } else {
      router.back();
    }
  }, [step, questions.length, quizMeta.title, router]);

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
   * 파일 선택 핸들러 (목록에 추가만, OCR 자동 실행 X)
   */
  const handleFileSelect = useCallback(async (file: File) => {
    try {
      const preview = file.type.startsWith('image/') ? await fileToBase64(file) : 'pdf';
      const newFile = {
        id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        file,
        preview,
      };
      setUploadedFiles((prev) => [...prev, newFile]);
      setOcrError(null);
    } catch (err) {
      console.error('파일 추가 실패:', err);
      setOcrError('파일을 추가하는데 실패했습니다.');
    }
  }, [fileToBase64]);

  /**
   * 업로드된 파일 삭제
   */
  const handleRemoveUploadedFile = useCallback((fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
    setSelectedFileIds((prev) => {
      const newSet = new Set(prev);
      newSet.delete(fileId);
      return newSet;
    });
  }, []);

  /**
   * 파일 선택 토글
   */
  const handleToggleFileSelection = useCallback((fileId: string) => {
    setSelectedFileIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  }, []);

  /**
   * 선택 모드 토글
   */
  const handleToggleSelectMode = useCallback(() => {
    setIsSelectMode((prev) => !prev);
    if (isSelectMode) {
      // 선택 모드 해제 시 선택 초기화
      setSelectedFileIds(new Set());
    }
  }, [isSelectMode]);

  /**
   * 전체 선택/해제
   */
  const handleSelectAll = useCallback(() => {
    if (selectedFileIds.size === uploadedFiles.length) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(uploadedFiles.map(f => f.id)));
    }
  }, [selectedFileIds.size, uploadedFiles]);

  /**
   * 선택된 파일들 가져오기
   */
  const selectedFiles = uploadedFiles.filter(f => selectedFileIds.has(f.id));

  /**
   * 텍스트 추출 버튼 클릭 (OCR 시작)
   * 선택된 파일들에 대해 OCR 수행 (PDF도 지원)
   */
  const handleStartOCR = useCallback(async () => {
    if (selectedFiles.length === 0) {
      setOcrError('먼저 파일을 선택해주세요.');
      return;
    }

    // 첫 번째 파일로 OCR 시작
    const firstFile = selectedFiles[0];

    // PDF 파일인 경우 첫 페이지를 이미지로 변환
    if (firstFile.file.type === 'application/pdf') {
      try {
        setIsOCRProcessing(true);
        setOcrError(null);

        // PDF.js로 첫 페이지를 이미지로 변환
        const pdfjsLib = await import('pdfjs-dist');
        if (typeof window !== 'undefined') {
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
        }

        const arrayBuffer = await firstFile.file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({
          data: arrayBuffer,
          cMapUrl: 'https://unpkg.com/pdfjs-dist@4.10.38/cmaps/',
          cMapPacked: true,
        }).promise;

        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2.5 });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context failed');

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise;

        // Canvas를 Blob으로 변환
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error('Blob conversion failed'));
          }, 'image/png');
        });

        // Blob을 File로 변환
        const pdfImageFile = new File([blob], `${firstFile.file.name}_page1.png`, { type: 'image/png' });
        setOcrTargetFile(pdfImageFile);
        setSelectedFile(pdfImageFile);
      } catch (err) {
        console.error('PDF 변환 오류:', err);
        setOcrError('PDF 파일을 처리하는 중 오류가 발생했습니다.');
        setIsOCRProcessing(false);
      }
    } else if (firstFile.file.type.startsWith('image/')) {
      // 이미지 파일인 경우 바로 OCR 시작
      setOcrTargetFile(firstFile.file);
      setSelectedFile(firstFile.file);
      setIsOCRProcessing(true);
      setOcrError(null);
    } else {
      setOcrError('지원하지 않는 파일 형식입니다.');
    }
  }, [selectedFiles]);

  /**
   * 이미지 영역 선택 모달 열기
   */
  const handleOpenImageRegionSelector = useCallback(() => {
    if (selectedFiles.length === 0) {
      setOcrError('먼저 파일을 선택해주세요.');
      return;
    }
    setShowImageRegionSelector(true);
  }, [selectedFiles]);

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

          // 보기(Examples) 변환 - mixedExamples 형식으로
          let mixedExamples: Array<{ id: string; type: 'text' | 'labeled'; label?: string; content: string }> | undefined;
          if (parsed.examples) {
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

          const questionData: QuestionData = {
            id: `ocr_${Date.now()}_${index}`,
            text: parsed.text,
            type: parsed.type,
            choices: parsed.choices || ['', '', '', ''],
            answerIndex,
            answerText,
            explanation: parsed.explanation || '',
            imageUrl: null,
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
  }, []);

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
  const handleSaveQuiz = useCallback(async () => {
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
        isPublic: quizMeta.isPublic,
        difficulty: quizMeta.difficulty,
        type: 'custom' as const, // 자체제작 퀴즈

        // 문제 정보 - 결합형은 하위 문제를 개별 문제로 펼침
        questions: (() => {
          const flattenedQuestions: any[] = [];
          let orderIndex = 0;

          questions.forEach((q) => {
            // 결합형 문제: 하위 문제를 개별 문제로 펼침
            if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
              const combinedGroupId = `combined_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              const subQuestionsCount = q.subQuestions.length;

              q.subQuestions.forEach((sq, sqIndex) => {
                // 하위 문제 정답 처리
                let subAnswer: string | number;
                if (sq.type === 'short_answer') {
                  const answerTexts = (sq.answerTexts || [sq.answerText || '']).filter(t => t.trim());
                  subAnswer = answerTexts.length > 1 ? answerTexts.join('|||') : answerTexts[0] || '';
                } else if (sq.type === 'multiple') {
                  // 객관식: 1-indexed로 변환
                  if (sq.answerIndices && sq.answerIndices.length > 1) {
                    // 복수정답
                    subAnswer = sq.answerIndices.map(i => i + 1).join(',');
                  } else if (sq.answerIndices && sq.answerIndices.length === 1) {
                    // 단일정답 (answerIndices에서)
                    subAnswer = sq.answerIndices[0] + 1;
                  } else if (sq.answerIndex !== undefined && sq.answerIndex >= 0) {
                    // 단일정답 (answerIndex에서)
                    subAnswer = sq.answerIndex + 1;
                  } else {
                    subAnswer = -1;
                  }
                } else {
                  // OX: 0 = O, 1 = X (그대로 저장)
                  subAnswer = sq.answerIndex ?? -1;
                }

                // 하위 문제의 보기(examples) 처리
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

                const subQuestionData: any = {
                  order: orderIndex++,
                  text: sq.text,
                  type: sq.type,
                  choices: sq.type === 'multiple' && sq.choices ? sq.choices.filter((c) => c && c.trim()) : null,
                  answer: subAnswer,
                  explanation: sq.explanation || null,
                  imageUrl: sq.image || null,
                  examples: subExamples,
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
                  subQuestionData.combinedMainText = q.text || ''; // 결합형 메인 문제 텍스트
                }

                flattenedQuestions.push(subQuestionData);
              });
            } else {
              // 일반 문제 처리
              let answer: string | number;
              if (q.type === 'subjective' || q.type === 'short_answer') {
                const answerTexts = (q.answerTexts || [q.answerText]).filter(t => t.trim());
                answer = answerTexts.length > 1 ? answerTexts.join('|||') : answerTexts[0] || '';
              } else if (q.type === 'multiple') {
                // 객관식: 1-indexed로 변환
                if (q.answerIndices && q.answerIndices.length > 1) {
                  // 복수정답
                  answer = q.answerIndices.map(i => i + 1).join(',');
                } else if (q.answerIndices && q.answerIndices.length === 1) {
                  // 단일정답 (answerIndices에서)
                  answer = q.answerIndices[0] + 1;
                } else if (q.answerIndex !== undefined && q.answerIndex >= 0) {
                  // 단일정답 (answerIndex에서)
                  answer = q.answerIndex + 1;
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

              // 혼합 보기(mixedExamples) 처리 - 블록 형식 (텍스트박스+ㄱㄴㄷ 블록)
              let questionMixedExamples = null;
              if (q.mixedExamples && Array.isArray(q.mixedExamples) && q.mixedExamples.length > 0) {
                const filteredMixed = q.mixedExamples
                  .filter((block) =>
                    block.type === 'text'
                      ? block.content?.trim()
                      : (block.items || []).some(i => i.content.trim())
                  )
                  .map(block => ({
                    ...block,
                    items: block.type === 'labeled'
                      ? (block.items || []).filter(i => i.content.trim())
                      : undefined,
                  }));
                if (filteredMixed.length > 0) {
                  questionMixedExamples = filteredMixed;
                }
              }

              flattenedQuestions.push({
                order: orderIndex++,
                text: q.text,
                type: q.type === 'subjective' ? 'short_answer' : q.type,
                choices: q.type === 'multiple' && q.choices ? q.choices.filter((c) => c && c.trim()) : null,
                answer,
                explanation: q.explanation || null,
                imageUrl: q.imageUrl || null,
                examples: questionExamples,
                mixedExamples: questionMixedExamples,
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
        completedUsers: [],
        userScores: {},

      };

      // base64 이미지를 Firebase Storage에 업로드하는 함수
      const uploadBase64ToStorage = async (base64: string, path: string): Promise<string | null> => {
        try {
          console.log(`[이미지 업로드 시작] ${path}`);

          // base64에서 데이터 추출
          const matches = base64.match(/^data:image\/(\w+);base64,(.+)$/);
          if (!matches) {
            console.error(`[실패] ${path}: 잘못된 base64 형식`);
            return null;
          }

          const extension = matches[1];
          const data = matches[2];

          // base64를 Blob으로 변환
          const byteCharacters = atob(data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const originalBlob = new Blob([byteArray], { type: `image/${extension}` });

          console.log(`[원본 크기] ${path}: ${formatFileSize(originalBlob.size)}`);

          // 이미지 압축 (1MB 초과 시 또는 항상 최적화)
          let finalBlob: Blob = originalBlob;
          let finalExtension = extension;

          try {
            const compressionResult = await compressImage(originalBlob, {
              maxWidth: 1920,
              maxHeight: 1080,
              quality: 0.85,
              maxSizeBytes: 800 * 1024, // 800KB 목표
              outputType: 'image/jpeg',
            });

            finalBlob = compressionResult.blob;
            finalExtension = 'jpg';

            console.log(`[압축 완료] ${path}: ${formatFileSize(compressionResult.originalSize)} → ${formatFileSize(compressionResult.compressedSize)} (${compressionResult.compressionRatio}% 절감)`);
          } catch (compressErr) {
            console.warn(`[압축 실패] ${path}: 원본 사용`, compressErr);
            // 압축 실패 시 원본 사용
          }

          // 최종 크기 확인
          if (finalBlob.size > 5 * 1024 * 1024) {
            console.error(`[실패] ${path}: 파일 크기 초과 (${formatFileSize(finalBlob.size)} > 5MB)`);
            throw new Error(`이미지 크기가 너무 큽니다: ${formatFileSize(finalBlob.size)}. 5MB 이하로 줄여주세요.`);
          }

          // Storage에 업로드
          const timestamp = Date.now();
          const randomStr = Math.random().toString(36).substring(2, 8);
          const storageRef = ref(storage, `quiz-images/${user.uid}/${timestamp}_${randomStr}.${finalExtension}`);

          console.log(`[업로드 중] ${path}: ${formatFileSize(finalBlob.size)}`);

          await uploadBytes(storageRef, finalBlob);
          const downloadUrl = await getDownloadURL(storageRef);

          console.log(`[성공] ${path}: 이미지 업로드 완료 - ${downloadUrl.substring(0, 80)}...`);
          return downloadUrl;
        } catch (err: any) {
          // 상세 에러 로깅
          console.error(`[실패] ${path}: 이미지 업로드 실패`);
          console.error(`  - 에러 타입: ${err?.name || 'Unknown'}`);
          console.error(`  - 에러 코드: ${err?.code || 'N/A'}`);
          console.error(`  - 에러 메시지: ${err?.message || String(err)}`);

          if (err?.code === 'storage/unauthorized') {
            console.error(`  - 원인: Storage 권한 부족. storage.rules 확인 필요.`);
            console.error(`  - 경로: quiz-images/${user.uid}/...`);
          } else if (err?.code === 'storage/quota-exceeded') {
            console.error(`  - 원인: Storage 용량 초과`);
          } else if (err?.code === 'storage/invalid-format') {
            console.error(`  - 원인: 잘못된 파일 형식`);
          }

          return null;
        }
      };

      // 퀴즈 데이터에서 base64 이미지를 Storage URL로 변환
      const processImagesInQuizData = async (data: any): Promise<any> => {
        // questions 배열의 이미지 처리
        if (data.questions && Array.isArray(data.questions)) {
          for (let i = 0; i < data.questions.length; i++) {
            const q = data.questions[i];

            // imageUrl 처리
            if (q.imageUrl && typeof q.imageUrl === 'string' && q.imageUrl.startsWith('data:image/')) {
              console.log(`[처리중] questions[${i}].imageUrl 업로드...`);
              const url = await uploadBase64ToStorage(q.imageUrl, `questions[${i}].imageUrl`);
              data.questions[i].imageUrl = url;
            }

            // passageImage 처리 (결합형 문제)
            if (q.passageImage && typeof q.passageImage === 'string' && q.passageImage.startsWith('data:image/')) {
              console.log(`[처리중] questions[${i}].passageImage 업로드...`);
              const url = await uploadBase64ToStorage(q.passageImage, `questions[${i}].passageImage`);
              data.questions[i].passageImage = url;
            }
          }
        }

        return data;
      };

      // Firestore 호환성을 위한 데이터 정리 함수 (이미지 처리 후 사용)
      const sanitizeForFirestore = (data: any, path: string = ''): any => {
        if (data === null || data === undefined) {
          return null;
        }

        if (typeof data === 'string') {
          // 이미지 업로드 후에도 남은 base64가 있으면 제거
          if (data.startsWith('data:image/')) {
            console.warn(`[경고] ${path}: 업로드되지 않은 base64 이미지 발견 - null로 대체`);
            return null;
          }
          return data;
        }

        if (Array.isArray(data)) {
          return data
            .filter((item) => item !== undefined && item !== null)
            .map((item, idx) => {
              if (Array.isArray(item)) {
                // 중첩 배열은 문자열로 변환
                return item.filter(i => i != null).join(', ');
              }
              return sanitizeForFirestore(item, `${path}[${idx}]`);
            });
        }

        if (typeof data === 'object') {
          const sanitized: any = {};
          for (const key of Object.keys(data)) {
            const value = data[key];
            if (value !== undefined) {
              sanitized[key] = sanitizeForFirestore(value, path ? `${path}.${key}` : key);
            }
          }
          return sanitized;
        }

        return data;
      };

      // 1. 먼저 이미지를 Storage에 업로드
      console.log('=== 이미지 업로드 시작 ===');
      const quizDataWithUrls = await processImagesInQuizData(JSON.parse(JSON.stringify(quizData)));
      console.log('=== 이미지 업로드 완료 ===');

      // 2. 데이터 정리 (중첩 배열 제거 등)
      const cleanedQuizData = sanitizeForFirestore(quizDataWithUrls);

      // 3. 데이터 크기 확인
      const dataSize = JSON.stringify(cleanedQuizData).length;
      console.log(`최종 데이터 크기: ${(dataSize / 1024).toFixed(1)}KB`);

      // 4. 타임스탬프 추가
      cleanedQuizData.createdAt = serverTimestamp();
      cleanedQuizData.updatedAt = serverTimestamp();

      // 5. Firestore에 저장
      await addDoc(collection(db, 'quizzes'), cleanedQuizData);

      // EXP 토스트 표시 (퀴즈 생성 15 EXP)
      // Cloud Functions에서 자동으로 EXP가 지급됨
      const earnedExp = 15;
      showExpToast(earnedExp, '퀴즈 생성');

      // 저장된 초안 삭제
      deleteDraft();

      // 성공 시 퀴즈 목록 페이지로 이동
      setTimeout(() => {
        router.push('/quiz?created=true');
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
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="sticky top-0 z-20 border-b-2 border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={handleBackButton}
            className="w-10 h-10 flex items-center justify-center border border-[#1A1A1A]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="font-serif-display text-lg font-bold text-[#1A1A1A]">퀴즈 만들기</h1>
          <div className="w-10" />
        </div>
      </header>

      {/* 진행률 바 */}
      <div className="sticky top-[57px] z-10 border-b border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="px-4 py-3">
          {/* 단계 표시 */}
          <div className="flex items-center justify-between mb-2">
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
      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full overflow-y-auto">
        <AnimatePresence mode="wait">
          {/* Step 1: 업로드 */}
          {step === 'upload' && (
            <motion.div
              key="upload"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="space-y-6"
            >
              <div>
                <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">
                  사진/PDF로 문제 추출
                </h2>
                <p className="text-sm text-[#5C5C5C]">
                  이미지를 업로드한 후 텍스트 추출 또는 이미지 영역 선택을 할 수 있습니다.
                </p>
              </div>

              {/* 이미지 업로더 */}
              <ImageUploader
                onFileSelect={handleFileSelect}
                isLoading={isOCRProcessing}
                error={ocrError}
              />

              {/* 업로드된 파일 목록 */}
              {uploadedFiles.length > 0 && !isOCRProcessing && (
                <div className="space-y-3">
                  {/* 헤더: 파일 개수 + 선택 버튼 */}
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-[#1A1A1A]">
                      업로드된 파일 ({uploadedFiles.length}개)
                      {isSelectMode && selectedFileIds.size > 0 && (
                        <span className="text-[#1A6B1A] ml-2">
                          {selectedFileIds.size}개 선택됨
                        </span>
                      )}
                    </p>
                    <div className="flex gap-2">
                      {isSelectMode && (
                        <button
                          type="button"
                          onClick={handleSelectAll}
                          className="px-3 py-1 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                        >
                          {selectedFileIds.size === uploadedFiles.length ? '전체 해제' : '전체 선택'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleToggleSelectMode}
                        className={`px-3 py-1 text-xs font-bold border transition-colors ${
                          isSelectMode
                            ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                            : 'border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                        }`}
                      >
                        {isSelectMode ? '취소' : '선택'}
                      </button>
                    </div>
                  </div>

                  {/* 파일 그리드 */}
                  <div className="grid grid-cols-3 gap-2">
                    {uploadedFiles.map((item) => {
                      const isSelected = selectedFileIds.has(item.id);
                      return (
                        <div
                          key={item.id}
                          className={`relative aspect-square bg-[#EDEAE4] border-2 overflow-hidden group cursor-pointer transition-all ${
                            isSelectMode
                              ? isSelected
                                ? 'border-[#1A6B1A] ring-2 ring-[#1A6B1A]'
                                : 'border-[#D4CFC4] hover:border-[#1A1A1A]'
                              : 'border-[#1A1A1A]'
                          }`}
                          onClick={() => {
                            if (isSelectMode) {
                              handleToggleFileSelection(item.id);
                            }
                          }}
                        >
                          {item.preview !== 'pdf' ? (
                            <img
                              src={item.preview}
                              alt={item.file.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center">
                              <svg className="w-8 h-8 text-[#8B1A1A]" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
                              </svg>
                              <span className="text-[10px] text-[#5C5C5C] mt-1">PDF</span>
                            </div>
                          )}

                          {/* 선택 모드: 체크박스 */}
                          {isSelectMode && (
                            <div className={`absolute top-1 left-1 w-6 h-6 flex items-center justify-center border-2 ${
                              isSelected
                                ? 'bg-[#1A6B1A] border-[#1A6B1A]'
                                : 'bg-white border-[#1A1A1A]'
                            }`}>
                              {isSelected && (
                                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                                </svg>
                              )}
                            </div>
                          )}

                          {/* 비선택 모드: 삭제 버튼 */}
                          {!isSelectMode && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveUploadedFile(item.id);
                              }}
                              className="absolute top-1 right-1 w-5 h-5 bg-[#8B1A1A] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* 액션 버튼들 - 선택 모드에서 파일이 선택되었을 때만 표시 */}
                  {isSelectMode && selectedFileIds.size > 0 && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleStartOCR}
                        className="flex-1 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        텍스트 추출
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenImageRegionSelector}
                        className="flex-1 py-3 text-sm font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        이미지 영역 선택
                      </button>
                    </div>
                  )}

                  {/* 선택 모드가 아닐 때 안내 메시지 */}
                  {!isSelectMode && (
                    <p className="text-xs text-[#5C5C5C] text-center">
                      &apos;선택&apos; 버튼을 눌러 파일을 선택한 후 텍스트 추출 또는 이미지 영역 선택을 할 수 있습니다.
                    </p>
                  )}
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
                />
              )}

              {/* 직접 입력 버튼 */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#1A1A1A]" />
                </div>
                <div className="relative flex justify-center">
                  <span className="px-3 text-sm text-[#5C5C5C]" style={{ backgroundColor: '#F5F0E8' }}>또는</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setStep('questions');
                  setIsAddingNew(true);
                }}
                disabled={isOCRProcessing}
                className="w-full py-3 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="space-y-6"
            >
              <div>
                <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">
                  문제 편집
                </h2>
                <p className="text-sm text-[#5C5C5C]">
                  문제를 추가하거나 수정하세요. 최소 3문제 이상 필요합니다.
                </p>
              </div>

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
                    className="w-full py-4 px-6 flex items-center justify-center gap-2 border-2 border-dashed border-[#1A1A1A] text-[#1A1A1A] font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                  >
                    <svg
                      className="w-5 h-5"
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
              className="space-y-6"
            >
              <div>
                <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">
                  퀴즈 정보
                </h2>
                <p className="text-sm text-[#5C5C5C]">
                  퀴즈 제목과 태그를 입력해주세요.
                </p>
              </div>

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
              className="space-y-6"
            >
              <div>
                <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">
                  퀴즈 확인
                </h2>
                <p className="text-sm text-[#5C5C5C]">
                  내용을 확인하고 퀴즈를 저장하세요.
                </p>
              </div>

              {/* 퀴즈 요약 카드 */}
              <div className="p-6 border border-[#1A1A1A] space-y-4" style={{ backgroundColor: '#F5F0E8' }}>
                {/* 제목 */}
                <div>
                  <span className="text-xs text-[#5C5C5C]">퀴즈 제목</span>
                  <p className="text-lg font-bold text-[#1A1A1A]">{quizMeta.title}</p>
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
                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-[#1A1A1A]">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-[#1A1A1A]">
                      {questions.length}
                    </p>
                    <p className="text-xs text-[#5C5C5C]">문제 수</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-[#1A1A1A]">
                      {quizMeta.difficulty === 'easy'
                        ? '쉬움'
                        : quizMeta.difficulty === 'hard'
                          ? '어려움'
                          : '보통'}
                    </p>
                    <p className="text-xs text-[#5C5C5C]">난이도</p>
                  </div>
                </div>
              </div>

              {/* 문제 미리보기 */}
              <div className="p-4 border border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
                <h3 className="font-bold text-[#1A1A1A] mb-3">문제 미리보기</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
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
                      {/* 결합형: 하위 문제 목록 (펼쳤을 때) */}
                      {q.type === 'combined' && q.subQuestions && previewExpanded.has(q.id) && (
                        <div className="ml-8 border-l-2 border-[#1A1A1A] bg-[#F5F0E8]">
                          {q.subQuestions.map((sq, sqIdx) => (
                            <div key={sq.id} className="flex items-start gap-2 p-2 border-b border-[#EDEAE4] last:border-b-0">
                              <span className="text-sm font-bold text-[#5C5C5C] flex-shrink-0 w-8">
                                {index + 1}-{sqIdx + 1}
                              </span>
                              <p className="text-sm text-[#1A1A1A] line-clamp-1 flex-1">
                                {sq.text || '(내용 없음)'}
                              </p>
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

      {/* 하단 버튼 - 고정 */}
      <div className="sticky bottom-0 border-t-2 border-[#1A1A1A] px-4 py-4" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="max-w-lg mx-auto flex gap-3">
          {/* 이전 버튼 */}
          {step !== 'upload' && (
            <button
              type="button"
              onClick={handlePrevStep}
              disabled={isSaving}
              className="px-6 py-3 border-2 border-[#1A1A1A] text-[#1A1A1A] font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              이전
            </button>
          )}

          {/* 다음/저장 버튼 - upload 단계에서는 숨김 (직접 입력하기 버튼 사용) */}
          {step === 'upload' ? null : step !== 'confirm' ? (
            <button
              type="button"
              onClick={handleNextStep}
              disabled={
                (step === 'questions' && calculateTotalQuestionCount(questions) < 3) ||
                isOCRProcessing ||
                editingIndex !== null ||
                isAddingNew
              }
              className="flex-1 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              다음
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSaveQuiz}
              disabled={isSaving}
              className="flex-1 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSaving && (
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              퀴즈 저장하기
            </button>
          )}
        </div>
      </div>

      {/* 나가기 확인 모달 */}
      <AnimatePresence>
        {showExitModal && (
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
              onClick={() => setShowExitModal(false)}
              className="absolute inset-0 bg-black/50"
            />

            {/* 모달 */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6 max-w-sm w-full"
            >
              <div className="text-center">
                {/* 아이콘 */}
                <div className="w-12 h-12 bg-[#FFF8E7] border-2 border-[#D4A84B] flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-[#D4A84B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>

                {/* 제목 */}
                <h3 className="text-lg font-bold text-[#1A1A1A] mb-2">
                  작성 중인 내용이 있습니다
                </h3>

                {/* 설명 */}
                <p className="text-sm text-[#5C5C5C] mb-6">
                  저장하지 않고 나가면 작성 중인 내용이 사라집니다.
                  <br />나중에 이어서 작성하시겠습니까?
                </p>

                {/* 버튼 */}
                <div className="space-y-2">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSaveAndExit}
                    className="w-full py-2.5 px-4 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
                  >
                    저장하고 나가기
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleExitWithoutSave}
                    className="w-full py-2.5 px-4 bg-[#EDEAE4] text-[#8B1A1A] font-bold border-2 border-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
                  >
                    저장하지 않고 나가기
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowExitModal(false)}
                    className="w-full py-2.5 px-4 bg-[#EDEAE4] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
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
              className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6 max-w-sm w-full"
            >
              <div className="text-center">
                {/* 아이콘 */}
                <div className="w-12 h-12 bg-[#E8F5E9] border-2 border-[#1A6B1A] flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-[#1A6B1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>

                {/* 제목 */}
                <h3 className="text-lg font-bold text-[#1A1A1A] mb-2">
                  이전 작성 내용이 있습니다
                </h3>

                {/* 진행 상황 정보 */}
                <div className="bg-[#EDEAE4] p-3 mb-4 text-left">
                  <p className="text-sm text-[#5C5C5C]">
                    {savedDraftInfo.title && (
                      <span className="block mb-1">
                        제목: <span className="text-[#1A1A1A] font-medium">{savedDraftInfo.title}</span>
                      </span>
                    )}
                    <span className="block">
                      문제 수: <span className="text-[#1A1A1A] font-medium">{savedDraftInfo.questionCount}개</span>
                    </span>
                  </p>
                </div>

                {/* 설명 */}
                <p className="text-sm text-[#5C5C5C] mb-6">
                  이어서 작성하시겠습니까?
                </p>

                {/* 버튼 */}
                <div className="flex gap-3">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleStartFresh}
                    className="flex-1 py-2.5 px-4 bg-[#EDEAE4] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                  >
                    처음부터
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleResumeDraft}
                    className="flex-1 py-2.5 px-4 bg-[#1A6B1A] text-[#F5F0E8] font-bold border-2 border-[#1A6B1A] hover:bg-[#145214] transition-colors"
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

      {/* 이미지 영역 선택 모달 */}
      <AnimatePresence>
        {showImageRegionSelector && (
          <ImageRegionSelector
            uploadedFiles={selectedFiles}
            extractedImages={extractedImages}
            onExtract={handleExtractImage}
            onRemoveExtracted={handleRemoveExtractedImage}
            onClose={() => setShowImageRegionSelector(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
