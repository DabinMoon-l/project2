'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as pdfjsLib from 'pdfjs-dist';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/lib/firebase';
import { useCourse } from '@/lib/contexts/CourseContext';
import { useVisionOcr } from '@/lib/hooks/useVisionOcr';
import { generateCourseTags, COMMON_TAGS, type TagOption } from '@/lib/courseIndex';
import ExpandModal from '@/components/common/ExpandModal';
import type { SourceRect } from '@/lib/hooks/useExpandSource';
import PageSelectionModal from './PageSelectionModal';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
// PDF.js worker - CDN 사용 (버전 일치 필수)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

interface AIQuizModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartQuiz: (data: AIQuizData) => void;
  sourceRect?: SourceRect | null;
}

export interface AIQuizData {
  folderName: string;
  images: string[]; // base64 이미지 배열
  difficulty: 'easy' | 'medium' | 'hard';
  questionCount: number;
  tags: string[]; // 태그 배열
  textContent?: string; // OCR/PPT 텍스트 내용 (선택적)
  courseCustomized?: boolean; // 과목 맞춤형 (교수 스타일/범위/포커스 반영)
}

interface DocumentPage {
  pageNum: number;
  thumbnail: string;
  selected: boolean;
  text?: string; // PPT 슬라이드 텍스트 (선택적)
}

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: '쉬움', description: '기본 개념 확인' },
  { value: 'medium', label: '보통', description: '응용 문제 포함' },
  { value: 'hard', label: '어려움', description: '심화 문제' },
] as const;

/**
 * 모바일/태블릿 디바이스 감지
 */
function useIsMobileDevice() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      // 터치 지원 + 화면 크기로 판단
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth <= 1024;
      // User Agent로 모바일 확인
      const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );
      setIsMobile(hasTouch && (isSmallScreen || mobileUA));
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
}

/**
 * AI 퀴즈 생성 모달
 */
export default function AIQuizModal({ isOpen, onClose, onStartQuiz, sourceRect }: AIQuizModalProps) {
  const isMobile = useIsMobileDevice();
  const { userCourseId } = useCourse();
  const visionOcr = useVisionOcr();

  // 과목별 동적 태그 생성 (챕터 번호 포함)
  const tagOptions = useMemo(() => {
    const courseTags = generateCourseTags(userCourseId);
    // 공통 태그 + 과목별 챕터 태그
    return [...COMMON_TAGS, ...courseTags];
  }, [userCourseId]);

  const [folderName, setFolderName] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [questionCount, setQuestionCount] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [courseCustomized, setCourseCustomized] = useState(true);
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [documentPages, setDocumentPages] = useState<DocumentPage[]>([]);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
  const [uploadType, setUploadType] = useState<'image' | 'pdf' | 'ppt' | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [showPageSelectionModal, setShowPageSelectionModal] = useState(false);
  const [pageSelectionTitle, setPageSelectionTitle] = useState('');

  // 파일 데이터 저장 (고해상도 변환용)
  const [pdfArrayBuffer, setPdfArrayBuffer] = useState<ArrayBuffer | null>(null);

  // OCR 관련 상태
  const [pendingOcrImages, setPendingOcrImages] = useState<string[]>([]);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pptInputRef = useRef<HTMLInputElement>(null);

  // 모달 닫힐 때 상태 초기화
  useEffect(() => {
    if (!isOpen) {
      setFolderName('');
      setImages([]);
      setDifficulty('medium');
      setQuestionCount(5);
      setSelectedTags([]);
      setCourseCustomized(true);
      setShowTagFilter(false);
      setDocumentPages([]);
      setUploadType(null);
      setIsLoadingDocument(false);
      setLoadingMessage('');
      setPdfArrayBuffer(null);
      setShowPageSelectionModal(false);
      setPageSelectionTitle('');
      setOcrExtractedText('');
      setIsOcrProcessing(false);
      setPendingOcrImages([]);
    }
  }, [isOpen]);

  // 이미지 파일 처리 및 OCR (Google Vision OCR 사용)
  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // 파일 배열을 먼저 복사 (input 초기화 전에)
    const fileArray = Array.from(files);

    // input 초기화 (파일 복사 후 실행)
    if (e.target) e.target.value = '';

    const newImages: string[] = [];

    for (const file of fileArray) {
      if (file.type.startsWith('image/')) {
        const base64 = await fileToBase64(file);
        newImages.push(base64);
      }
    }

    if (newImages.length > 0) {
      // 이미지 추가
      setImages(prev => [...prev, ...newImages]);
      if (!uploadType) {
        setUploadType('image');
      }

      // OCR 텍스트 추출 시작
      setPendingOcrImages(newImages);
      setIsOcrProcessing(true);

      try {
        // Google Vision OCR로 텍스트 추출
        const result = await visionOcr.runOcr(newImages);

        if (result.text.trim()) {
          // OCR 추출 텍스트 저장 (퀴즈 생성 시 사용)
          setOcrExtractedText(prev => prev ? `${prev}\n\n${result.text}` : result.text);
        } else {
          alert('이미지에서 텍스트를 인식할 수 없습니다.');
        }
      } catch (error: any) {
        console.error('OCR 오류:', error);
        const errorMessage = error.message || 'OCR 처리 중 오류가 발생했습니다.';
        alert(errorMessage);
      } finally {
        setIsOcrProcessing(false);
        setPendingOcrImages([]);
      }
    }
  }, [uploadType, visionOcr]);

  // PDF 파일 처리
  const handlePdfSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // PDF 파일 확인
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('PDF 파일만 선택해주세요.');
      if (e.target) e.target.value = '';
      return;
    }

    setIsLoadingDocument(true);
    setLoadingMessage('PDF 로딩 중...');
    // 기존 PDF 페이지만 초기화 (이미지와 PPT는 유지)
    setDocumentPages([]);
    setUploadType('pdf');

    try {
      const arrayBuffer = await file.arrayBuffer();
      // ArrayBuffer 복사본 저장 (PDF.js가 원본을 transfer하므로)
      setPdfArrayBuffer(arrayBuffer.slice(0));

      // 복사본으로 PDF 로드 (원본 유지)
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      const pages: DocumentPage[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        setLoadingMessage(`PDF 로딩 중... (${i}/${pdf.numPages})`);
        const page = await pdf.getPage(i);
        // 썸네일 화질 개선: scale 0.3 → 0.8, JPEG 품질 70% → 90%
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
      // 페이지 선택 모달 열기
      setPageSelectionTitle('PDF 페이지 선택');
      setShowPageSelectionModal(true);
    } catch (error) {
      console.error('PDF 처리 오류:', error);
      alert('PDF 파일을 읽을 수 없습니다.');
      setUploadType(null);
    } finally {
      setIsLoadingDocument(false);
      setLoadingMessage('');
    }

    if (e.target) e.target.value = '';
  }, []);

  // OCR 추출 텍스트 (이미지/PDF용)
  const [ocrExtractedText, setOcrExtractedText] = useState<string>('');
  // OCR 진행 중
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);

  // PPTX 파일 선택 → Cloud Run에서 PDF 변환 후 페이지 미리보기
  const handlePptSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';

    if (!file) return;

    // PPTX 파일 확인
    const isPptx = file.name.toLowerCase().endsWith('.pptx') ||
                   file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

    if (!isPptx) {
      alert('PPTX 파일만 업로드 가능합니다.\n\nPPT 파일은 PowerPoint에서 .pptx로 저장해주세요.');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }

    setIsLoadingDocument(true);
    setLoadingMessage('PPT를 PDF로 변환 중...');
    setDocumentPages([]);
    setUploadType('ppt');

    try {
      // 1. PPTX → base64로 변환 (FileReader 네이티브 인코딩 — reduce 방식보다 훨씬 빠름)
      setLoadingMessage('PPT 파일 준비 중...');
      const pptxBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // 2. Cloud Function으로 PDF 변환 요청 (CORS 자동 처리)
      setLoadingMessage('PPT를 PDF로 변환 중... (최대 1~2분 소요)');
      const convertFn = httpsCallable<{ pptxBase64: string }, { pdfBase64: string }>(functions, 'convertPptxToPdf', { timeout: 180000 });
      const result = await convertFn({ pptxBase64 });

      // 3. base64 PDF → ArrayBuffer 변환
      const pdfBinaryString = atob(result.data.pdfBase64);
      const pdfBytes = new Uint8Array(pdfBinaryString.length);
      for (let i = 0; i < pdfBinaryString.length; i++) {
        pdfBytes[i] = pdfBinaryString.charCodeAt(i);
      }
      const arrayBuffer = pdfBytes.buffer;

      // ArrayBuffer 복사본 저장 (PDF.js가 원본을 transfer하므로)
      setPdfArrayBuffer(arrayBuffer.slice(0));

      // 3. pdfjs-dist로 페이지 썸네일 생성 (기존 PDF 플로우 재사용)
      setLoadingMessage('페이지 로딩 중...');
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      const pages: DocumentPage[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        setLoadingMessage(`페이지 로딩 중... (${i}/${pdf.numPages})`);
        const page = await pdf.getPage(i);
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
      // 페이지 선택 모달 열기
      setPageSelectionTitle('PPT 페이지 선택');
      setShowPageSelectionModal(true);

    } catch (error: any) {
      console.error('PPTX 변환 오류:', error);
      alert(error.message || 'PPT 파일을 변환할 수 없습니다.\nPDF로 변환 후 업로드해주세요.');
      setUploadType(null);
    } finally {
      setIsLoadingDocument(false);
      setLoadingMessage('');
    }
  }, []);

  // 제외할 태그 (챕터 태그가 아닌 것들)
  const EXCLUDED_TAGS = ['중간', '기말', '기타'];

  // 챕터 태그가 선택되었는지 확인
  const hasChapterTag = selectedTags.some(tag => !EXCLUDED_TAGS.includes(tag));

  // 페이지 선택/해제 토글
  const togglePage = useCallback((pageNum: number) => {
    setDocumentPages(prev =>
      prev.map(page =>
        page.pageNum === pageNum
          ? { ...page, selected: !page.selected }
          : page
      )
    );
  }, []);

  // 페이지 선택 모달에서 확인 및 OCR
  const handlePageSelectionConfirm = useCallback(async (selectedPages: DocumentPage[]) => {
    setDocumentPages(selectedPages);
    setShowPageSelectionModal(false);

    const selectedPageNums = selectedPages.filter(p => p.selected);
    if (selectedPageNums.length === 0) return;

    // 고해상도 이미지로 OCR 수행 (썸네일 대신 scale 2.0)
    let selectedImages: string[] = [];

    if (pdfArrayBuffer) {
      try {
        const pdf = await pdfjsLib.getDocument({ data: pdfArrayBuffer.slice(0) }).promise;

        for (const page of selectedPageNums) {
          const pdfPage = await pdf.getPage(page.pageNum);
          // OCR용 고해상도 (scale 2.0)
          const viewport = pdfPage.getViewport({ scale: 2.0 });

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d')!;
          canvas.width = viewport.width;
          canvas.height = viewport.height;

          await pdfPage.render({
            canvasContext: context,
            viewport: viewport,
          }).promise;

          const imageData = canvas.toDataURL('image/jpeg', 0.9);
          selectedImages.push(imageData);
        }
      } catch (error) {
        console.error('PDF 고해상도 변환 오류:', error);
        // 실패 시 썸네일 사용
        selectedImages = selectedPageNums.map(p => p.thumbnail);
      }
    } else {
      // PDF가 아닌 경우 (PPT 등) 썸네일 사용
      selectedImages = selectedPageNums.map(p => p.thumbnail);
    }

    if (selectedImages.length === 0) return;

    // OCR 시작
    setIsOcrProcessing(true);

    try {
      // Google Vision OCR로 텍스트 추출
      const result = await visionOcr.runOcr(selectedImages);

      if (result.text.trim()) {
        // OCR 추출 텍스트 저장 (퀴즈 생성 시 사용)
        setOcrExtractedText(result.text);
      } else {
        alert('문서에서 텍스트를 인식할 수 없습니다.');
      }
    } catch (error: any) {
      console.error('OCR 오류:', error);
      const errorMessage = error.message || 'OCR 처리 중 오류가 발생했습니다.';
      alert(errorMessage);
    } finally {
      setIsOcrProcessing(false);
    }
  }, [visionOcr, pdfArrayBuffer]);

  // 페이지 선택 모달 다시 열기
  const handleReopenPageSelection = useCallback(() => {
    setPageSelectionTitle(uploadType === 'ppt' ? 'PPT 페이지 선택' : 'PDF 페이지 선택');
    setShowPageSelectionModal(true);
  }, [uploadType]);

  // 문서 선택 초기화
  const handleClearDocumentSelection = useCallback(() => {
    setDocumentPages([]);
    setPdfArrayBuffer(null);
    setOcrExtractedText(''); // OCR 텍스트도 초기화
    // 다른 콘텐츠가 있으면 uploadType 유지
    if (images.length === 0) {
      setUploadType(null);
    }
  }, [images.length]);

  // 선택된 PDF 페이지를 고해상도 이미지로 변환
  const convertSelectedPdfPagesToImages = useCallback(async (): Promise<string[]> => {
    const selectedPages = documentPages.filter(p => p.selected);
    if (selectedPages.length === 0 || !pdfArrayBuffer) return [];

    // ArrayBuffer 복사본 사용 (PDF.js가 transfer하므로)
    const pdf = await pdfjsLib.getDocument({ data: pdfArrayBuffer.slice(0) }).promise;
    const images: string[] = [];

    for (const page of selectedPages) {
      const pdfPage = await pdf.getPage(page.pageNum);
      const viewport = pdfPage.getViewport({ scale: 2 });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await pdfPage.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;

      const imageData = canvas.toDataURL('image/jpeg', 0.9);
      images.push(imageData);
    }

    return images;
  }, [documentPages, pdfArrayBuffer]);

  // 이미지 삭제
  const removeImage = useCallback((index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  // 퀴즈 시작
  const handleStart = useCallback(async () => {
    if (!folderName.trim()) {
      alert('퀴즈 이름을 입력해주세요.');
      return;
    }

    if (selectedTags.length === 0) {
      alert('태그를 1개 이상 선택해주세요.');
      return;
    }

    // 챕터 태그 필수 체크 (과목 맞춤형일 때만)
    if (courseCustomized && !hasChapterTag) {
      alert('챕터 태그를 1개 이상 선택해주세요.\n(#중간, #기말, #기타는 챕터 태그가 아닙니다)');
      return;
    }

    // 이미지 + PDF/PPT 페이지 합치기
    let finalImages = [...images];

    // PDF 페이지가 있으면 이미지로 변환하여 추가
    const selectedPdfPageCount = documentPages.filter(p => p.selected).length;
    if (selectedPdfPageCount > 0) {
      const pdfImages = await convertSelectedPdfPagesToImages();
      finalImages = [...finalImages, ...pdfImages];
    }

    if (finalImages.length === 0) {
      alert('학습 자료를 업로드해주세요.');
      return;
    }

    onStartQuiz({
      folderName: folderName.trim(),
      images: finalImages,
      difficulty,
      questionCount,
      tags: selectedTags,
      textContent: ocrExtractedText || undefined,
      courseCustomized,
    });
  }, [folderName, images, difficulty, questionCount, documentPages, convertSelectedPdfPagesToImages, onStartQuiz, selectedTags, ocrExtractedText, hasChapterTag, courseCustomized]);

  // body overflow 제어 (ExpandModal이 ESC 키 처리)
  useEffect(() => {
    if (isOpen) {
      lockScroll();
    }
    return () => {
      unlockScroll();
    };
  }, [isOpen]);

  // 업로드 버튼 수 계산 (모바일: 4개, PC: 3개)
  const buttonCount = isMobile ? 4 : 3;
  const gridCols = isMobile ? 'grid-cols-4' : 'grid-cols-3';

  const selectedPageCount = documentPages.filter(p => p.selected).length;
  // 어떤 유형이든 콘텐츠가 있으면 true
  const hasContent = images.length > 0 || selectedPageCount > 0;

  return (
    <>
      <ExpandModal isOpen={isOpen} onClose={onClose} sourceRect={sourceRect} className="w-[85%] max-w-sm" zIndex={50}>
        <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] shadow-[4px_4px_0px_#1A1A1A] overflow-hidden rounded-2xl">
          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b-2 border-[#1A1A1A]">
            <h2 className="text-sm font-bold text-[#1A1A1A]">퀴즈로 학습하기</h2>
            <button
              onClick={onClose}
              className="p-0.5 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 본문 */}
          <div className="px-4 py-3 max-h-[80vh] overflow-y-auto overscroll-contain space-y-2.5">
            {/* 퀴즈 이름 */}
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] mb-1.5">
                퀴즈 이름
              </label>
              <input
                type="text"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="퀴즈 이름을 입력하세요"
                className="w-full px-3 py-2 text-sm border-2 border-[#1A1A1A] bg-white text-[#1A1A1A] placeholder-[#9A9A9A] focus:outline-none focus:ring-2 focus:ring-[#1A1A1A] focus:ring-offset-2 rounded-lg"
              />
            </div>

            {/* 태그 선택 (챕터 태그 필수) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-[#1A1A1A]">
                  태그 {courseCustomized && <span className="text-[#8B1A1A] font-normal text-[10px]">(챕터 필수)</span>}
                </label>
                <button
                  type="button"
                  onClick={() => setShowTagFilter(!showTagFilter)}
                  className={`flex items-center justify-center w-7 h-7 border rounded-lg transition-colors ${
                    showTagFilter
                      ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                      : 'bg-white text-[#1A1A1A] border-[#1A1A1A]'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                </button>
              </div>

              {/* 선택된 태그들 */}
              {selectedTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {selectedTags.map((tag) => {
                    return (
                      <div
                        key={tag}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-bold bg-[#1A1A1A] text-white rounded-md"
                      >
                        #{tag}
                        <button
                          type="button"
                          onClick={() => setSelectedTags(prev => prev.filter(t => t !== tag))}
                          className="ml-0.5 hover:text-[#CCCCCC]"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 챕터 태그 미선택 경고 (과목 맞춤형일 때만) */}
              {courseCustomized && selectedTags.length > 0 && !hasChapterTag && (
                <p className="text-[10px] text-[#8B1A1A] mb-1.5">
                  챕터 태그를 1개 이상 선택해주세요
                </p>
              )}

              {/* 태그 선택 목록 */}
              <AnimatePresence>
                {showTagFilter && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-wrap gap-1.5 p-2 bg-white border-2 border-[#1A1A1A] rounded-lg max-h-36 overflow-y-auto overscroll-contain">
                      {tagOptions
                        .filter(tag => !selectedTags.includes(tag.value))
                        .map((tag) => (
                          <button
                            key={tag.value}
                            type="button"
                            onClick={() => {
                              setSelectedTags(prev => [...prev, tag.value]);
                            }}
                            className="px-2 py-1 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] rounded-md hover:bg-[#EDEAE4] transition-colors"
                          >
                            {tag.label}
                          </button>
                        ))}
                      {tagOptions.filter(tag => !selectedTags.includes(tag.value)).length === 0 && (
                        <p className="text-xs text-[#5C5C5C]">모든 태그가 선택되었습니다</p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 파일 업로드 */}
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] mb-1.5">
                학습 자료 업로드
              </label>

              {/* 업로드 버튼들 */}
              <div className={`grid ${gridCols} gap-1.5 mb-2`}>
                {/* 카메라 - 모바일에서만 표시 */}
                {isMobile && (
                  <>
                    <button
                      onClick={() => cameraInputRef.current?.click()}
                      className="flex flex-col items-center gap-0.5 p-2 border-2 border-[#1A1A1A] bg-white hover:bg-[#EDEAE4] transition-colors rounded-lg"
                    >
                      <svg className="w-5 h-5 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-[10px] text-[#1A1A1A]">카메라</span>
                    </button>
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                  </>
                )}

                {/* 갤러리/이미지 */}
                <button
                  onClick={() => galleryInputRef.current?.click()}
                  className="flex flex-col items-center gap-0.5 p-2 border-2 border-[#1A1A1A] bg-white hover:bg-[#EDEAE4] transition-colors rounded-lg"
                >
                  <svg className="w-5 h-5 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-[10px] text-[#1A1A1A]">{isMobile ? '갤러리' : '이미지'}</span>
                </button>
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageSelect}
                  className="hidden"
                />

                {/* PDF */}
                <button
                  onClick={() => pdfInputRef.current?.click()}
                  className="flex flex-col items-center gap-0.5 p-2 border-2 border-[#1A1A1A] bg-white hover:bg-[#EDEAE4] transition-colors rounded-lg"
                >
                  <svg className="w-5 h-5 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h1.5M9 16h1.5M12.5 13h2M12.5 16h2" />
                  </svg>
                  <span className="text-[10px] text-[#1A1A1A]">PDF</span>
                </button>
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handlePdfSelect}
                  className="hidden"
                />

                {/* PPT */}
                <button
                  onClick={() => pptInputRef.current?.click()}
                  className="flex flex-col items-center gap-0.5 p-2 border-2 border-[#1A1A1A] bg-white hover:bg-[#EDEAE4] transition-colors rounded-lg"
                >
                  <svg className="w-5 h-5 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9h6M9 12h4M9 15h5" />
                  </svg>
                  <span className="text-[10px] text-[#1A1A1A]">PPT</span>
                </button>
                <input
                  ref={pptInputRef}
                  type="file"
                  accept=".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  onChange={handlePptSelect}
                  className="hidden"
                />
              </div>

              {/* 문서 로딩 */}
              {isLoadingDocument && (
                <div className="flex items-center justify-center py-6 border-2 border-dashed border-[#9A9A9A]">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="w-6 h-6 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-[#5C5C5C]">{loadingMessage}</span>
                  </div>
                </div>
              )}

              {/* 문서 페이지 선택 완료 요약 (PDF/PPT 공통) */}
              {documentPages.length > 0 && (
                <div className="border-2 border-[#1A1A1A] p-3 bg-white rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {/* 문서 아이콘 */}
                      <div className="w-10 h-10 border-2 border-[#1A1A1A] bg-[#EDEAE4] flex items-center justify-center">
                        <svg className="w-5 h-5 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[#1A1A1A]">{uploadType === 'ppt' ? 'PPT 파일' : 'PDF 파일'}</p>
                        <p className="text-xs text-[#5C5C5C]">
                          {selectedPageCount > 0 ? (
                            <span className="text-[#1A6B1A] font-semibold">{selectedPageCount}개 페이지 선택됨</span>
                          ) : (
                            <span className="text-[#8B1A1A]">페이지를 선택해주세요</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={handleReopenPageSelection}
                        className="px-2 py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
                      >
                        {selectedPageCount > 0 ? '다시 선택' : '선택하기'}
                      </button>
                      <button
                        type="button"
                        onClick={handleClearDocumentSelection}
                        className="px-2 py-1.5 text-xs font-bold border border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#FEE2E2] transition-colors rounded-lg"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 업로드된 이미지 미리보기 */}
              {images.length > 0 && (
                <div className="grid grid-cols-4 gap-1.5">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative aspect-square border-2 border-[#1A1A1A]">
                      <img
                        src={img}
                        alt={`Upload ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={() => removeImage(idx)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#8B1A1A] text-white rounded-full flex items-center justify-center"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 난이도 */}
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] mb-1.5">
                난이도
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {DIFFICULTY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDifficulty(opt.value)}
                    className={`p-2 border-2 rounded-lg transition-all ${
                      difficulty === opt.value
                        ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white'
                        : 'border-[#1A1A1A] bg-white text-[#1A1A1A] hover:bg-[#EDEAE4]'
                    }`}
                  >
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div className={`text-[9px] ${difficulty === opt.value ? 'text-white/70' : 'text-[#5C5C5C]'}`}>
                      {opt.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 문제 수 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-[#1A1A1A]">
                  문제 수
                </label>
                <span className="text-sm font-bold text-[#1A1A1A]">{questionCount}문제</span>
              </div>
              <input
                type="range"
                min={5}
                max={20}
                value={questionCount}
                onChange={(e) => setQuestionCount(parseInt(e.target.value))}
                className="w-full h-1.5 bg-[#E5E5E5] rounded-lg appearance-none cursor-pointer accent-[#1A1A1A]"
              />
              <div className="flex justify-between text-[10px] text-[#5C5C5C] mt-0.5">
                <span>5문제</span>
                <span>20문제</span>
              </div>
            </div>

            {/* 과목 맞춤형 */}
            <label className="flex items-center gap-2.5 p-2 border-2 border-[#1A1A1A] bg-white cursor-pointer select-none rounded-lg">
              <input
                type="checkbox"
                checked={courseCustomized}
                onChange={(e) => setCourseCustomized(e.target.checked)}
                className="w-4 h-4 accent-[#1A1A1A] flex-shrink-0"
              />
              <div>
                <p className="text-xs font-semibold text-[#1A1A1A]">과목 맞춤형</p>
                <p className="text-[10px] text-[#5C5C5C]">
                  {courseCustomized
                    ? '교수님 출제 스타일과 과목 범위를 반영합니다'
                    : '업로드한 자료에서만 문제를 생성합니다'}
                </p>
              </div>
            </label>

            {/* AI 할루시네이션 경고 */}
            <div className="p-2 border-2 border-[#8B1A1A] rounded-lg">
              <div className="flex gap-1.5">
                <svg className="w-4 h-4 text-[#8B1A1A] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="text-xs font-semibold text-[#8B1A1A]">AI 생성 문제 주의사항</p>
                  <p className="text-[10px] text-[#5C5C5C] mt-0.5">
                    AI가 생성한 문제는 오류가 있을 수 있습니다. 학습 보조 용도로만 활용하세요.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 푸터 */}
          <div className="px-4 py-3 border-t-2 border-[#1A1A1A] bg-[#EDEAE4]">
            <button
              onClick={handleStart}
              disabled={!folderName.trim() || !hasContent || (courseCustomized && !hasChapterTag)}
              className={`w-full py-2.5 font-bold text-sm border-2 border-[#1A1A1A] rounded-lg transition-all ${
                folderName.trim() && hasContent && (!courseCustomized || hasChapterTag)
                  ? 'bg-[#1A1A1A] text-white hover:bg-[#3A3A3A] shadow-[2px_2px_0px_#1A1A1A] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]'
                  : 'bg-[#E5E5E5] text-[#9A9A9A] cursor-not-allowed'
              }`}
            >
              학습 시작하기
            </button>
          </div>
        </div>
      </ExpandModal>

      {/* 페이지 선택 모달 */}
      <PageSelectionModal
        isOpen={showPageSelectionModal}
        onClose={() => setShowPageSelectionModal(false)}
        onConfirm={handlePageSelectionConfirm}
        pages={documentPages}
        title={pageSelectionTitle}
        isLoading={isLoadingDocument}
        loadingMessage={loadingMessage}
      />
    </>
  );
}

// 파일을 base64로 변환
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

