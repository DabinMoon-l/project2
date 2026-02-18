'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { storage, db, auth, functions } from '@/lib/firebase';
import { useCourse } from '@/lib/contexts/CourseContext';
import { useVisionOcr } from '@/lib/hooks/useVisionOcr';
import { generateCourseTags, COMMON_TAGS, type TagOption } from '@/lib/courseIndex';
import PageSelectionModal from './PageSelectionModal';
import PptxProgressModal from './PptxProgressModal';
// PDF.js worker - CDN 사용 (버전 일치 필수)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

interface AIQuizModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartQuiz: (data: AIQuizData) => void;
}

export interface AIQuizData {
  folderName: string;
  images: string[]; // base64 이미지 배열
  difficulty: 'easy' | 'medium' | 'hard';
  questionCount: number;
  tags: string[]; // 태그 배열
  textContent?: string; // PPT 텍스트 내용 (선택적)
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
export default function AIQuizModal({ isOpen, onClose, onStartQuiz }: AIQuizModalProps) {
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
      setShowTagFilter(false);
      setDocumentPages([]);
      setUploadType(null);
      setIsLoadingDocument(false);
      setLoadingMessage('');
      setPdfArrayBuffer(null);
      setShowPageSelectionModal(false);
      setPageSelectionTitle('');
      setPendingPptxFile(null);
      setPptxFullText('');
      setOcrExtractedText('');
      setIsOcrProcessing(false);
      setPendingOcrImages([]);
      // PPTX 진행 모달 관련 상태는 진행 중일 수 있으므로 완료/실패 시에만 초기화
    }
  }, [isOpen]);

  // 이미지 파일 처리 및 OCR (Google Vision OCR 사용)
  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // input 초기화 (먼저 실행)
    if (e.target) e.target.value = '';

    const newImages: string[] = [];

    for (const file of Array.from(files)) {
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

  // PPTX 진행 상황 모달 상태
  const [showPptxProgressModal, setShowPptxProgressModal] = useState(false);
  const [pptxJobId, setPptxJobId] = useState<string | null>(null);

  // PPTX 파일 임시 저장
  const [pendingPptxFile, setPendingPptxFile] = useState<File | null>(null);
  // PPTX 전체 텍스트
  const [pptxFullText, setPptxFullText] = useState<string>('');
  // OCR 추출 텍스트 (이미지/PDF용)
  const [ocrExtractedText, setOcrExtractedText] = useState<string>('');
  // OCR 진행 중
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);

  // PPTX 슬라이드에서 텍스트 추출
  const extractTextFromSlideXml = (xmlContent: string): { title: string; content: string } => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlContent, 'application/xml');

    // 모든 텍스트 요소 추출 (a:t 태그)
    const textElements = doc.getElementsByTagName('a:t');
    const texts: string[] = [];

    for (let i = 0; i < textElements.length; i++) {
      const text = textElements[i].textContent?.trim();
      if (text) {
        texts.push(text);
      }
    }

    // 첫 번째 텍스트를 제목으로, 나머지를 내용으로
    const title = texts[0] || '';
    const content = texts.slice(1).join('\n');

    return { title, content };
  };

  // PPTX 파일 선택 및 텍스트 추출
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

    setPendingPptxFile(file);
    setUploadType('ppt');
    setIsOcrProcessing(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      // 슬라이드 파일들 찾기
      const slideFiles: { num: number; file: JSZip.JSZipObject }[] = [];

      zip.forEach((relativePath, zipEntry) => {
        const match = relativePath.match(/^ppt\/slides\/slide(\d+)\.xml$/);
        if (match) {
          slideFiles.push({
            num: parseInt(match[1]),
            file: zipEntry
          });
        }
      });

      // 슬라이드 번호순 정렬
      slideFiles.sort((a, b) => a.num - b.num);

      // 전체 텍스트 추출
      let fullText = '';

      for (const { num, file } of slideFiles) {
        const xmlContent = await file.async('string');
        const { title, content } = extractTextFromSlideXml(xmlContent);
        fullText += `${title} ${content} `;
      }

      if (!fullText.trim()) {
        alert('슬라이드에서 텍스트를 찾을 수 없습니다.');
        setPendingPptxFile(null);
        setUploadType(null);
        return;
      }

      // 전체 텍스트 저장
      setPptxFullText(fullText.trim());

    } catch (error: any) {
      console.error('PPTX 분석 오류:', error);
      alert(error.message || 'PPTX 파일을 분석할 수 없습니다.');
      setPendingPptxFile(null);
      setUploadType(null);
    } finally {
      setIsOcrProcessing(false);
    }
  }, []);

  // 제외할 태그 (챕터 태그가 아닌 것들)
  const EXCLUDED_TAGS = ['중간', '기말', '기타'];

  // 챕터 태그가 선택되었는지 확인
  const hasChapterTag = selectedTags.some(tag => !EXCLUDED_TAGS.includes(tag));

  // PPTX 업로드 및 처리 시작
  const startPptxProcessing = useCallback(async () => {
    if (!pendingPptxFile) return;

    // 텍스트 확인
    if (!pptxFullText.trim()) {
      alert('PPTX 텍스트가 없습니다. 파일을 다시 선택해주세요.');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }

    try {
      // 작업 ID 생성
      const jobId = `pptx_${user.uid}_${Date.now()}`;
      setPptxJobId(jobId);
      setShowPptxProgressModal(true);

      // Firebase Storage에 파일 업로드
      const storagePath = `pptx-uploads/${user.uid}/${jobId}.pptx`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, pendingPptxFile);

      // Firestore에 작업 문서 생성 (Cloud Functions 트리거)
      await setDoc(doc(db, 'quizJobs', jobId), {
        jobId,
        storagePath,
        userId: user.uid,
        folderName: folderName.trim(),
        difficulty,
        questionCount,
        tags: selectedTags,
        textContent: pptxFullText, // 추출된 텍스트
        status: 'pending',
        progress: 0,
        message: '업로드 완료. 처리 대기 중...',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

    } catch (error) {
      console.error('PPTX 업로드 오류:', error);
      alert('파일 업로드에 실패했습니다. 다시 시도해주세요.');
      setShowPptxProgressModal(false);
      setPptxJobId(null);
    }
  }, [pendingPptxFile, folderName, selectedTags, difficulty, questionCount, pptxFullText]);

  // PPTX 처리 완료 시
  const handlePptxComplete = useCallback((quizId: string) => {
    setShowPptxProgressModal(false);
    setPptxJobId(null);
    onClose();
    // 생성된 퀴즈로 이동 (라우터 사용 대신 window.location)
    window.location.href = `/quiz/${quizId}`;
  }, [onClose]);

  // PPTX 진행 모달 닫기
  const handlePptxProgressClose = useCallback(() => {
    setShowPptxProgressModal(false);
    setPptxJobId(null);
  }, []);

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
        alert('PDF에서 텍스트를 인식할 수 없습니다.');
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
    if (uploadType === 'pdf') {
      setPageSelectionTitle('PDF 페이지 선택');
    } else if (uploadType === 'ppt') {
      setPageSelectionTitle('PPT 이미지 선택');
    }
    setShowPageSelectionModal(true);
  }, [uploadType]);

  // 문서 선택 초기화
  const handleClearDocumentSelection = useCallback(() => {
    setDocumentPages([]);
    setPdfArrayBuffer(null);
    setOcrExtractedText(''); // OCR 텍스트도 초기화
    // 다른 콘텐츠가 있으면 uploadType 유지
    if (images.length === 0 && !pendingPptxFile) {
      setUploadType(null);
    }
  }, [images.length, pendingPptxFile]);

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

  // 선택된 PPT 이미지 가져오기
  const getSelectedPptImages = useCallback((): string[] => {
    return documentPages.filter(p => p.selected).map(p => p.thumbnail);
  }, [documentPages]);

  // 선택된 PPT 텍스트 가져오기
  const getSelectedPptText = useCallback((): string => {
    return documentPages
      .filter(p => p.selected && p.text)
      .map(p => `[슬라이드 ${p.pageNum}]\n${p.text}`)
      .join('\n\n');
  }, [documentPages]);

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

    // 챕터 태그 필수 체크 (중간, 기말, 기타 제외)
    if (!hasChapterTag) {
      alert('챕터 태그를 1개 이상 선택해주세요.\n(#중간, #기말, #기타는 챕터 태그가 아닙니다)');
      return;
    }

    // PPTX 파일이 선택된 경우 Cloud Run 처리
    if (pendingPptxFile && pptxFullText.trim()) {
      await startPptxProcessing();
      return;
    }

    // 이미지 + PDF 페이지 합치기
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
      textContent: ocrExtractedText || undefined, // OCR 추출 텍스트 전달
    });
  }, [folderName, images, difficulty, questionCount, documentPages, pendingPptxFile, pptxFullText, convertSelectedPdfPagesToImages, startPptxProcessing, onStartQuiz, selectedTags, ocrExtractedText, hasChapterTag]);

  // ESC 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  // 업로드 버튼 수 계산 (모바일: 4개, PC: 3개)
  const buttonCount = isMobile ? 4 : 3;
  const gridCols = isMobile ? 'grid-cols-4' : 'grid-cols-3';

  const selectedPageCount = documentPages.filter(p => p.selected).length;
  // 어떤 유형이든 콘텐츠가 있으면 true (중복 업로드 지원)
  const hasContent = images.length > 0 ||
    selectedPageCount > 0 ||
    (pendingPptxFile !== null && pptxFullText.trim().length > 0);

  if (typeof window === 'undefined') return null;

  return (
    <>
      {createPortal(
        <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 백드롭 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />

          {/* 모달 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-md bg-[#F5F0E8] border-2 border-[#1A1A1A] shadow-[4px_4px_0px_#1A1A1A] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b-2 border-[#1A1A1A]">
              <h2 className="text-lg font-bold text-[#1A1A1A]">퀴즈로 학습하기</h2>
              <button
                onClick={onClose}
                className="p-1 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 본문 */}
            <div className="px-5 py-4 max-h-[70vh] overflow-y-auto overscroll-contain space-y-5">
              {/* 퀴즈 이름 */}
              <div>
                <label className="block text-sm font-semibold text-[#1A1A1A] mb-2">
                  퀴즈 이름
                </label>
                <input
                  type="text"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="퀴즈 이름을 입력하세요"
                  className="w-full px-4 py-3 border-2 border-[#1A1A1A] bg-white text-[#1A1A1A] placeholder-[#9A9A9A] focus:outline-none focus:ring-2 focus:ring-[#1A1A1A] focus:ring-offset-2"
                />
              </div>

              {/* 태그 선택 (챕터 태그 필수) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-[#1A1A1A]">
                    태그 <span className="text-[#8B1A1A] font-normal text-xs">(챕터 필수)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowTagFilter(!showTagFilter)}
                    className={`flex items-center justify-center w-8 h-8 border transition-colors ${
                      showTagFilter
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                        : 'bg-white text-[#1A1A1A] border-[#1A1A1A]'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                  </button>
                </div>

                {/* 선택된 태그들 */}
                {selectedTags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {selectedTags.map((tag) => {
                      const isChapterTag = !EXCLUDED_TAGS.includes(tag);
                      return (
                        <div
                          key={tag}
                          className={`flex items-center gap-1 px-2 py-1 text-sm font-bold ${
                            isChapterTag
                              ? 'bg-[#1A6B1A] text-white'
                              : 'bg-[#5C5C5C] text-white'
                          }`}
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

                {/* 챕터 태그 미선택 경고 */}
                {selectedTags.length > 0 && !hasChapterTag && (
                  <p className="text-xs text-[#8B1A1A] mb-2">
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
                      <div className="flex flex-wrap gap-2 p-3 bg-white border-2 border-[#1A1A1A] max-h-40 overflow-y-auto">
                        {tagOptions
                          .filter(tag => !selectedTags.includes(tag.value))
                          .map((tag) => (
                            <button
                              key={tag.value}
                              type="button"
                              onClick={() => {
                                setSelectedTags(prev => [...prev, tag.value]);
                              }}
                              className="px-3 py-1.5 text-sm font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                            >
                              {tag.label}
                            </button>
                          ))}
                        {tagOptions.filter(tag => !selectedTags.includes(tag.value)).length === 0 && (
                          <p className="text-sm text-[#5C5C5C]">모든 태그가 선택되었습니다</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* 파일 업로드 */}
              <div>
                <label className="block text-sm font-semibold text-[#1A1A1A] mb-2">
                  학습 자료 업로드
                </label>

                {/* 업로드 버튼들 */}
                <div className={`grid ${gridCols} gap-2 mb-3`}>
                  {/* 카메라 - 모바일에서만 표시 */}
                  {isMobile && (
                    <>
                      <button
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex flex-col items-center gap-1 p-3 border-2 border-[#1A1A1A] bg-white hover:bg-[#EDEAE4] transition-colors"
                      >
                        <svg className="w-6 h-6 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-xs text-[#1A1A1A]">카메라</span>
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
                    className="flex flex-col items-center gap-1 p-3 border-2 border-[#1A1A1A] bg-white hover:bg-[#EDEAE4] transition-colors"
                  >
                    <svg className="w-6 h-6 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs text-[#1A1A1A]">{isMobile ? '갤러리' : '이미지'}</span>
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
                    className="flex flex-col items-center gap-1 p-3 border-2 border-[#1A1A1A] bg-white hover:bg-[#EDEAE4] transition-colors"
                  >
                    <svg className="w-6 h-6 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h1.5M9 16h1.5M12.5 13h2M12.5 16h2" />
                    </svg>
                    <span className="text-xs text-[#1A1A1A]">PDF</span>
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
                    className="flex flex-col items-center gap-1 p-3 border-2 border-[#1A1A1A] bg-white hover:bg-[#EDEAE4] transition-colors"
                  >
                    <svg className="w-6 h-6 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9h6M9 12h4M9 15h5" />
                    </svg>
                    <span className="text-xs text-[#1A1A1A]">PPT</span>
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
                  <div className="flex items-center justify-center py-8 border-2 border-dashed border-[#9A9A9A]">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm text-[#5C5C5C]">{loadingMessage}</span>
                    </div>
                  </div>
                )}

                {/* PPTX 파일 선택 상태 */}
                {pendingPptxFile && pptxFullText.trim() && (
                  <div className="border-2 border-[#1A1A1A] p-4 bg-white">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 border-2 border-[#1A1A1A] bg-[#EDEAE4] flex items-center justify-center">
                          <svg className="w-5 h-5 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div>
                          <p className="font-bold text-[#1A1A1A] text-sm truncate max-w-[180px]">{pendingPptxFile.name}</p>
                          <p className="text-xs text-[#1A6B1A] font-semibold">텍스트 추출 완료</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingPptxFile(null);
                          setPptxFullText('');
                          // 다른 콘텐츠가 있으면 uploadType 유지
                          if (images.length === 0 && documentPages.length === 0) {
                            setUploadType(null);
                          }
                        }}
                        className="px-3 py-1.5 text-sm font-bold border border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#FEE2E2] transition-colors"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                )}

                {/* PDF 문서 페이지 선택 완료 요약 */}
                {documentPages.length > 0 && (
                  <div className="border-2 border-[#1A1A1A] p-4 bg-white">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* 문서 아이콘 */}
                        <div className="w-12 h-12 border-2 border-[#1A1A1A] bg-[#EDEAE4] flex items-center justify-center">
                          <svg className="w-6 h-6 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div>
                          <p className="font-bold text-[#1A1A1A]">PDF 파일</p>
                          <p className="text-sm text-[#5C5C5C]">
                            {selectedPageCount > 0 ? (
                              <span className="text-[#1A6B1A] font-semibold">{selectedPageCount}개 페이지 선택됨</span>
                            ) : (
                              <span className="text-[#8B1A1A]">페이지를 선택해주세요</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleReopenPageSelection}
                          className="px-3 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                        >
                          {selectedPageCount > 0 ? '다시 선택' : '선택하기'}
                        </button>
                        <button
                          type="button"
                          onClick={handleClearDocumentSelection}
                          className="px-3 py-2 text-sm font-bold border border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#FEE2E2] transition-colors"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 업로드된 이미지 미리보기 */}
                {images.length > 0 && (
                  <div className="grid grid-cols-4 gap-2">
                    {images.map((img, idx) => (
                      <div key={idx} className="relative aspect-square border-2 border-[#1A1A1A]">
                        <img
                          src={img}
                          alt={`Upload ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={() => removeImage(idx)}
                          className="absolute -top-2 -right-2 w-5 h-5 bg-[#8B1A1A] text-white rounded-full flex items-center justify-center"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                <label className="block text-sm font-semibold text-[#1A1A1A] mb-2">
                  난이도
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {DIFFICULTY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setDifficulty(opt.value)}
                      className={`p-3 border-2 transition-all ${
                        difficulty === opt.value
                          ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white'
                          : 'border-[#1A1A1A] bg-white text-[#1A1A1A] hover:bg-[#EDEAE4]'
                      }`}
                    >
                      <div className="text-sm font-semibold">{opt.label}</div>
                      <div className={`text-[10px] ${difficulty === opt.value ? 'text-white/70' : 'text-[#5C5C5C]'}`}>
                        {opt.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 문제 수 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-[#1A1A1A]">
                    문제 수
                  </label>
                  <span className="text-lg font-bold text-[#1A1A1A]">{questionCount}문제</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={20}
                  value={questionCount}
                  onChange={(e) => setQuestionCount(parseInt(e.target.value))}
                  className="w-full h-2 bg-[#E5E5E5] rounded-lg appearance-none cursor-pointer accent-[#1A1A1A]"
                />
                <div className="flex justify-between text-xs text-[#5C5C5C] mt-1">
                  <span>5문제</span>
                  <span>20문제</span>
                </div>
              </div>

              {/* AI 할루시네이션 경고 */}
              <div className="p-3 border-2 border-[#8B1A1A]">
                <div className="flex gap-2">
                  <svg className="w-5 h-5 text-[#8B1A1A] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-[#8B1A1A]">AI 생성 문제 주의사항</p>
                    <p className="text-xs text-[#5C5C5C] mt-1">
                      AI가 생성한 문제는 오류가 있을 수 있습니다. 학습 보조 용도로만 활용하세요.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 푸터 */}
            <div className="px-5 py-4 border-t-2 border-[#1A1A1A] bg-[#EDEAE4]">
              <button
                onClick={handleStart}
                disabled={!folderName.trim() || !hasContent || !hasChapterTag}
                className={`w-full py-3 font-bold text-lg border-2 border-[#1A1A1A] transition-all ${
                  folderName.trim() && hasContent && hasChapterTag
                    ? 'bg-[#1A1A1A] text-white hover:bg-[#3A3A3A] shadow-[2px_2px_0px_#1A1A1A] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]'
                    : 'bg-[#E5E5E5] text-[#9A9A9A] cursor-not-allowed'
                }`}
              >
                학습 시작하기
              </button>
            </div>
          </motion.div>
        </div>
      )}
        </AnimatePresence>,
        document.body
      )}

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

      {/* PPTX 처리 진행 모달 */}
      <PptxProgressModal
        isOpen={showPptxProgressModal}
        jobId={pptxJobId}
        onClose={handlePptxProgressClose}
        onComplete={handlePptxComplete}
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

// 텍스트 미리보기 이미지 생성 (PPT 슬라이드용)
function createTextPreviewImage(pageNum: number, title: string, content: string): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  // 캔버스 크기 설정 (4:3 비율)
  canvas.width = 400;
  canvas.height = 300;

  // 배경
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 테두리
  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

  // 슬라이드 번호 헤더
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(0, 0, canvas.width, 36);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`슬라이드 ${pageNum}`, 12, 24);

  // 제목 표시
  let currentY = 52;
  if (title) {
    ctx.fillStyle = '#1A1A1A';
    ctx.font = 'bold 16px sans-serif';
    const titleLines = wrapText(ctx, title, canvas.width - 24, 2);
    for (const line of titleLines) {
      ctx.fillText(line, 12, currentY);
      currentY += 20;
    }
    currentY += 8;
  }

  // 구분선
  if (title && content) {
    ctx.strokeStyle = '#D4CFC4';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, currentY - 4);
    ctx.lineTo(canvas.width - 12, currentY - 4);
    ctx.stroke();
    currentY += 8;
  }

  // 내용 표시
  if (content) {
    ctx.fillStyle = '#5C5C5C';
    ctx.font = '12px sans-serif';
    const maxContentLines = Math.floor((canvas.height - currentY - 10) / 16);
    const contentLines = wrapText(ctx, content.replace(/\n/g, ' '), canvas.width - 24, maxContentLines);
    for (const line of contentLines) {
      ctx.fillText(line, 12, currentY);
      currentY += 16;
    }
  }

  // 텍스트가 없는 경우
  if (!title && !content) {
    ctx.fillStyle = '#9A9A9A';
    ctx.font = '14px sans-serif';
    ctx.fillText('(텍스트 없음)', 12, 70);
  }

  return canvas.toDataURL('image/png');
}

// 텍스트 줄바꿈 헬퍼 함수
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine + (currentLine ? ' ' : '') + word;
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines) {
        lines[lines.length - 1] += '...';
        return lines;
      }
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  return lines;
}
