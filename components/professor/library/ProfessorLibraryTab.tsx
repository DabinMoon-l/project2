'use client';

/**
 * 교수 서재 탭 — AI 문제 생성 + 관리
 *
 * 프롬프트 + 슬라이더(스타일/범위/포커스가이드/난이도/문제수) + 파일 업로드로 AI 문제 생성
 * 백그라운드 Job 매니저(libraryJobManager)에 위임 → 다른 페이지로 이동해도 생성 계속됨
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import * as pdfjsLib from 'pdfjs-dist';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/lib/firebase';
import { useUser } from '@/lib/contexts';
import { useCourse } from '@/lib/contexts/CourseContext';
import { useVisionOcr } from '@/lib/hooks/useVisionOcr';
import { useProfessorAiQuizzes } from '@/lib/hooks/useProfessorAiQuizzes';
import {
  startLibraryJob,
  isLibraryJobActive,
  onLibraryJobEvent,
} from '@/lib/utils/libraryJobManager';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/common';
import PageSelectionModal from '@/components/ai-quiz/PageSelectionModal';

// PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

// ============================================================
// 타입
// ============================================================

interface DocumentPage {
  pageNum: number;
  thumbnail: string;
  selected: boolean;
}

interface SliderWeights {
  style: number;
  scope: number;
  focusGuide: number;
  difficulty: number;
  questionCount: number;
}

// ============================================================
// 유틸
// ============================================================

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** 슬라이더 difficulty → API difficulty */
function mapDifficulty(value: number): 'easy' | 'medium' | 'hard' {
  if (value <= 33) return 'easy';
  if (value <= 66) return 'medium';
  return 'hard';
}

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '쉬움',
  medium: '보통',
  hard: '어려움',
};

// ============================================================
// 컴포넌트
// ============================================================

export default function ProfessorLibraryTab() {
  const router = useRouter();
  const { profile } = useUser();
  const { userCourseId, userCourse } = useCourse();
  const visionOcr = useVisionOcr();
  const { quizzes, loading: quizzesLoading, deleteQuiz, publishQuiz } = useProfessorAiQuizzes();

  // 프롬프트
  const [prompt, setPrompt] = useState('');

  // 파일 업로드
  const [showFilePanel, setShowFilePanel] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [ocrText, setOcrText] = useState('');
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [documentPages, setDocumentPages] = useState<DocumentPage[]>([]);
  const [pdfArrayBuffer, setPdfArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [showPageSelection, setShowPageSelection] = useState(false);
  const [pageSelectionTitle, setPageSelectionTitle] = useState('');
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pptInputRef = useRef<HTMLInputElement>(null);

  // 슬라이더
  const [showSliderPanel, setShowSliderPanel] = useState(false);
  const [sliders, setSliders] = useState<SliderWeights>({
    style: 50,
    scope: 50,
    focusGuide: 50,
    difficulty: 50,
    questionCount: 10,
  });

  // 백그라운드 Job 진행 상태 (libraryJobManager 이벤트 구독)
  const [isGenerating, setIsGenerating] = useState(() => isLibraryJobActive());

  // Job 이벤트 구독 — 완료/실패 시 isGenerating 해제
  useEffect(() => {
    const unsub = onLibraryJobEvent((event) => {
      if (event.type === 'started') setIsGenerating(true);
      if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
        setIsGenerating(false);
      }
    });
    return unsub;
  }, []);

  // 공개 모달
  const [publishTarget, setPublishTarget] = useState<string | null>(null);
  const [publishType, setPublishType] = useState<string>('midterm');

  // 삭제 확인
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // ============================================================
  // 파일 업로드 핸들러 (AIQuizModal 패턴 재사용)
  // ============================================================

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (e.target) e.target.value = '';

    const newImages: string[] = [];
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        const base64 = await fileToBase64(file);
        newImages.push(base64);
      }
    }

    if (newImages.length > 0) {
      setImages(prev => [...prev, ...newImages]);
      setIsOcrProcessing(true);
      try {
        const result = await visionOcr.runOcr(newImages);
        if (result.text.trim()) {
          setOcrText(prev => prev ? `${prev}\n\n${result.text}` : result.text);
        } else {
          alert('이미지에서 텍스트를 인식할 수 없습니다.');
        }
      } catch (error: any) {
        alert(error.message || 'OCR 처리 중 오류가 발생했습니다.');
      } finally {
        setIsOcrProcessing(false);
      }
    }
  }, [visionOcr]);

  const handlePdfSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('PDF 파일만 선택해주세요.');
      if (e.target) e.target.value = '';
      return;
    }

    setIsLoadingDocument(true);
    setLoadingMessage('PDF 로딩 중...');
    setDocumentPages([]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      setPdfArrayBuffer(arrayBuffer.slice(0));
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      const pages: DocumentPage[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        setLoadingMessage(`PDF 로딩 중... (${i}/${pdf.numPages})`);
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
      setPageSelectionTitle('PDF 페이지 선택');
      setShowPageSelection(true);
    } catch {
      alert('PDF 파일을 읽을 수 없습니다.');
    } finally {
      setIsLoadingDocument(false);
      setLoadingMessage('');
    }
    if (e.target) e.target.value = '';
  }, []);

  const handlePptSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;

    const isPptx = file.name.toLowerCase().endsWith('.pptx') ||
      file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (!isPptx) {
      alert('PPTX 파일만 업로드 가능합니다.');
      return;
    }
    if (!auth.currentUser) {
      alert('로그인이 필요합니다.');
      return;
    }

    setIsLoadingDocument(true);
    setLoadingMessage('PPT를 PDF로 변환 중...');
    setDocumentPages([]);

    try {
      setLoadingMessage('PPT 파일 준비 중...');
      const pptxBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setLoadingMessage('PPT를 PDF로 변환 중... (최대 1~2분 소요)');
      const convertFn = httpsCallable<{ pptxBase64: string }, { pdfBase64: string }>(
        functions, 'convertPptxToPdf', { timeout: 180000 }
      );
      const result = await convertFn({ pptxBase64 });

      const pdfBinaryString = atob(result.data.pdfBase64);
      const pdfBytes = new Uint8Array(pdfBinaryString.length);
      for (let i = 0; i < pdfBinaryString.length; i++) {
        pdfBytes[i] = pdfBinaryString.charCodeAt(i);
      }
      const arrayBuffer = pdfBytes.buffer;
      setPdfArrayBuffer(arrayBuffer.slice(0));

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
        await page.render({ canvasContext: context, viewport }).promise;
        pages.push({ pageNum: i, thumbnail: canvas.toDataURL('image/jpeg', 0.9), selected: false });
      }

      setDocumentPages(pages);
      setPageSelectionTitle('PPT 페이지 선택');
      setShowPageSelection(true);
    } catch (error: any) {
      alert(error.message || 'PPT 파일을 변환할 수 없습니다.');
    } finally {
      setIsLoadingDocument(false);
      setLoadingMessage('');
    }
  }, []);

  // 페이지 선택 확인 → OCR
  const handlePageSelectionConfirm = useCallback(async (selectedPages: DocumentPage[]) => {
    setDocumentPages(selectedPages);
    setShowPageSelection(false);

    const selectedPageNums = selectedPages.filter(p => p.selected);
    if (selectedPageNums.length === 0) return;

    let selectedImages: string[] = [];
    if (pdfArrayBuffer) {
      try {
        const pdf = await pdfjsLib.getDocument({ data: pdfArrayBuffer.slice(0) }).promise;
        for (const page of selectedPageNums) {
          const pdfPage = await pdf.getPage(page.pageNum);
          const viewport = pdfPage.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d')!;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await pdfPage.render({ canvasContext: context, viewport }).promise;
          selectedImages.push(canvas.toDataURL('image/jpeg', 0.9));
        }
      } catch {
        selectedImages = selectedPageNums.map(p => p.thumbnail);
      }
    } else {
      selectedImages = selectedPageNums.map(p => p.thumbnail);
    }

    if (selectedImages.length === 0) return;

    // 이미지도 추가 (AI 생성용)
    setImages(prev => [...prev, ...selectedImages]);
    setIsOcrProcessing(true);
    try {
      const result = await visionOcr.runOcr(selectedImages);
      if (result.text.trim()) {
        setOcrText(prev => prev ? `${prev}\n\n${result.text}` : result.text);
      } else {
        alert('문서에서 텍스트를 인식할 수 없습니다.');
      }
    } catch (error: any) {
      alert(error.message || 'OCR 처리 중 오류가 발생했습니다.');
    } finally {
      setIsOcrProcessing(false);
    }
  }, [visionOcr, pdfArrayBuffer]);

  // ============================================================
  // AI 문제 생성
  // ============================================================

  const handleGenerate = useCallback(async () => {
    if (!profile?.uid) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!prompt.trim() && !ocrText.trim() && images.length === 0) {
      alert('프롬프트를 입력하거나 파일을 업로드해주세요.');
      return;
    }
    if (isLibraryJobActive()) {
      alert('이미 문제를 생성 중입니다.');
      return;
    }

    const combinedText = [ocrText, prompt].filter(Boolean).join('\n\n');
    const difficulty = mapDifficulty(sliders.difficulty);

    try {
      // Job 등록
      const enqueueJob = httpsCallable<
        {
          text?: string;
          images?: string[];
          difficulty: string;
          questionCount: number;
          courseId: string;
          courseName?: string;
          courseCustomized?: boolean;
          sliderWeights?: SliderWeights;
          professorPrompt?: string;
        },
        { jobId: string; status: string; deduplicated: boolean }
      >(functions, 'enqueueGenerationJob');

      const enqueueResult = await enqueueJob({
        text: combinedText,
        images,
        difficulty,
        questionCount: sliders.questionCount,
        courseId: userCourseId || 'biology',
        courseName: userCourse?.name || '일반',
        courseCustomized: true,
        sliderWeights: sliders,
        professorPrompt: prompt.trim() || undefined,
      });

      const { jobId } = enqueueResult.data;

      // 학기 계산
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const semester = month >= 3 && month <= 8 ? `${year}-1` : `${year}-2`;

      // 백그라운드 Job 매니저에 위임 (fire-and-forget)
      startLibraryJob(jobId, {
        uid: profile.uid,
        nickname: profile.nickname || '교수',
        courseId: userCourseId || 'biology',
        semester,
        questionCount: sliders.questionCount,
        difficulty,
      });

      // 입력 초기화 (Job은 백그라운드에서 계속 진행)
      setPrompt('');
      setOcrText('');
      setImages([]);
      setDocumentPages([]);
      setPdfArrayBuffer(null);

    } catch (err: any) {
      const msg = err?.message || 'Job 등록 중 오류가 발생했습니다.';
      if (msg.includes('횟수') || msg.includes('초과') || msg.includes('exhausted')) {
        alert(msg);
      } else {
        alert(`오류: ${msg}`);
      }
    }
  }, [profile, prompt, ocrText, images, sliders, userCourseId, userCourse]);

  // ============================================================
  // 파일 초기화
  // ============================================================

  const handleClearFiles = useCallback(() => {
    setImages([]);
    setOcrText('');
    setDocumentPages([]);
    setPdfArrayBuffer(null);
  }, []);

  // ============================================================
  // 슬라이더 라벨
  // ============================================================

  const getWeightLabel = (value: number): string => {
    if (value < 10) return 'OFF';
    if (value < 50) return '낮음';
    if (value < 75) return '보통';
    if (value < 95) return '높음';
    return '강력';
  };

  // ============================================================
  // JSX
  // ============================================================

  const selectedPageCount = documentPages.filter(p => p.selected).length;
  const hasContent = prompt.trim() || ocrText.trim() || images.length > 0;

  return (
    <div className="flex-1 flex flex-col px-4 pb-8">
      {/* ============================================================ */}
      {/* 프롬프트 입력 영역 */}
      {/* ============================================================ */}
      <div className="border-2 border-[#1A1A1A] bg-[#FDFBF7] mb-4">
        {/* 텍스트 입력 */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="AI에게 문제 생성 지시사항을 입력하세요...&#10;예: 세포 분열 관련 문제를 만들어주세요."
          className="w-full px-4 pt-3 pb-2 text-sm text-[#1A1A1A] placeholder-[#999] bg-transparent outline-none resize-none min-h-[80px]"
          rows={3}
        />

        {/* OCR 텍스트 미리보기 */}
        {ocrText && (
          <div className="mx-4 mb-2 p-2 bg-[#EDEAE4] border border-[#D4CFC4] text-xs text-[#5C5C5C] max-h-[60px] overflow-y-auto">
            <span className="font-bold">추출된 텍스트: </span>
            {ocrText.slice(0, 200)}
            {ocrText.length > 200 && '...'}
          </div>
        )}

        {/* 문서 선택 정보 */}
        {selectedPageCount > 0 && (
          <div className="mx-4 mb-2 text-xs text-[#5C5C5C]">
            선택된 페이지: {selectedPageCount}장
          </div>
        )}

        {/* 하단 아이콘 + 생성 버튼 */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-[#EDEAE4]">
          <div className="flex gap-1">
            {/* 파일 아이콘 */}
            <button
              onClick={() => { setShowFilePanel(!showFilePanel); setShowSliderPanel(false); }}
              className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                showFilePanel ? 'bg-[#1A1A1A] text-[#F5F0E8]' : 'text-[#5C5C5C] hover:bg-[#EDEAE4]'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            {/* 슬라이더 아이콘 */}
            <button
              onClick={() => { setShowSliderPanel(!showSliderPanel); setShowFilePanel(false); }}
              className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                showSliderPanel ? 'bg-[#1A1A1A] text-[#F5F0E8]' : 'text-[#5C5C5C] hover:bg-[#EDEAE4]'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>
            {/* 파일 초기화 */}
            {(images.length > 0 || ocrText) && (
              <button
                onClick={handleClearFiles}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-[#5C5C5C] hover:bg-[#EDEAE4]"
                title="파일 초기화"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* 생성 버튼 */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || isOcrProcessing || !hasContent}
            className={`px-5 py-2 text-sm font-bold transition-colors ${
              isGenerating || isOcrProcessing || !hasContent
                ? 'bg-[#D4CFC4] text-[#999] cursor-not-allowed'
                : 'bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A]'
            }`}
          >
            {isOcrProcessing ? 'OCR 처리 중...' : isGenerating ? '생성 중...' : '생성'}
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 파일 업로드 패널 */}
      {/* ============================================================ */}
      <AnimatePresence>
        {showFilePanel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="border border-[#D4CFC4] bg-[#FDFBF7] p-3">
              <p className="text-xs text-[#5C5C5C] mb-3">학습 자료를 업로드하면 OCR로 텍스트를 추출하여 문제를 생성합니다.</p>
              <div className="flex gap-2">
                {/* 이미지 */}
                <button
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isLoadingDocument || isOcrProcessing}
                  className="flex-1 py-3 border border-[#1A1A1A] text-sm font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors disabled:opacity-50"
                >
                  이미지
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageSelect}
                  className="hidden"
                />

                {/* PDF */}
                <button
                  onClick={() => pdfInputRef.current?.click()}
                  disabled={isLoadingDocument || isOcrProcessing}
                  className="flex-1 py-3 border border-[#1A1A1A] text-sm font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors disabled:opacity-50"
                >
                  PDF
                </button>
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handlePdfSelect}
                  className="hidden"
                />

                {/* PPT */}
                <button
                  onClick={() => pptInputRef.current?.click()}
                  disabled={isLoadingDocument || isOcrProcessing}
                  className="flex-1 py-3 border border-[#1A1A1A] text-sm font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors disabled:opacity-50"
                >
                  PPT
                </button>
                <input
                  ref={pptInputRef}
                  type="file"
                  accept=".pptx"
                  onChange={handlePptSelect}
                  className="hidden"
                />
              </div>

              {/* 로딩 표시 */}
              {(isLoadingDocument || isOcrProcessing) && (
                <div className="mt-3 text-sm text-[#5C5C5C] text-center">
                  {isLoadingDocument ? loadingMessage : 'OCR 텍스트 추출 중...'}
                </div>
              )}

              {/* 업로드된 이미지 미리보기 */}
              {images.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto">
                  {images.slice(0, 6).map((img, idx) => (
                    <div key={idx} className="w-16 h-16 flex-shrink-0 border border-[#D4CFC4] overflow-hidden">
                      <img src={img} alt={`업로드 ${idx + 1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                  {images.length > 6 && (
                    <div className="w-16 h-16 flex-shrink-0 border border-[#D4CFC4] flex items-center justify-center text-xs text-[#5C5C5C]">
                      +{images.length - 6}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================================ */}
      {/* 슬라이더 패널 */}
      {/* ============================================================ */}
      <AnimatePresence>
        {showSliderPanel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="border border-[#D4CFC4] bg-[#FDFBF7] p-4 space-y-4">
              {/* Style */}
              <SliderRow
                label="교수 스타일"
                value={sliders.style}
                weightLabel={getWeightLabel(sliders.style)}
                onChange={(v) => setSliders(prev => ({ ...prev, style: v }))}
              />
              {/* Scope */}
              <SliderRow
                label="과목 범위"
                value={sliders.scope}
                weightLabel={getWeightLabel(sliders.scope)}
                onChange={(v) => setSliders(prev => ({ ...prev, scope: v }))}
              />
              {/* Focus Guide */}
              <SliderRow
                label="포커스 가이드"
                value={sliders.focusGuide}
                weightLabel={getWeightLabel(sliders.focusGuide)}
                onChange={(v) => setSliders(prev => ({ ...prev, focusGuide: v }))}
              />
              {/* Difficulty */}
              <SliderRow
                label="난이도"
                value={sliders.difficulty}
                weightLabel={DIFFICULTY_LABELS[mapDifficulty(sliders.difficulty)]}
                onChange={(v) => setSliders(prev => ({ ...prev, difficulty: v }))}
              />
              {/* Question Count */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold text-[#1A1A1A]">문제 수</span>
                  <span className="text-sm font-bold text-[#1A1A1A]">{sliders.questionCount}문제</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={20}
                  step={1}
                  value={sliders.questionCount}
                  onChange={(e) => setSliders(prev => ({ ...prev, questionCount: parseInt(e.target.value) }))}
                  className="w-full h-2 bg-[#D4CFC4] appearance-none cursor-pointer accent-[#1A1A1A]"
                  style={{
                    background: `linear-gradient(to right, #1A1A1A 0%, #1A1A1A ${((sliders.questionCount - 5) / 15) * 100}%, #D4CFC4 ${((sliders.questionCount - 5) / 15) * 100}%, #D4CFC4 100%)`
                  }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================================ */}
      {/* 백그라운드 생성 진행 인라인 뱃지 */}
      {/* ============================================================ */}
      {isGenerating && (
        <div className="flex items-center gap-2 px-3 py-2 mb-4 border border-[#D4CFC4] bg-[#EDEAE4]">
          <div className="w-4 h-4 flex-shrink-0 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-bold text-[#1A1A1A]">AI 문제 생성 중... 다른 페이지로 이동해도 계속 생성됩니다.</span>
        </div>
      )}

      {/* ============================================================ */}
      {/* 생성된 퀴즈 카드 그리드 */}
      {/* ============================================================ */}
      {quizzesLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-none" />
          <Skeleton className="h-24 rounded-none" />
        </div>
      ) : quizzes.length === 0 && !isGenerating ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <svg className="w-12 h-12 text-[#D4CFC4] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <p className="text-base font-bold text-[#1A1A1A] mb-1">아직 생성된 퀴즈가 없습니다</p>
          <p className="text-sm text-[#5C5C5C]">위에서 프롬프트를 입력하고 문제를 생성해보세요.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {quizzes.map((quiz) => (
            <div key={quiz.id} className="border-2 border-[#1A1A1A] bg-[#FDFBF7] p-4">
              {/* 상단 라인 */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-[#1A1A1A] truncate">{quiz.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-[#5C5C5C]">{quiz.questionCount}문제</span>
                    <span className="text-xs text-[#5C5C5C]">{DIFFICULTY_LABELS[quiz.difficulty] || quiz.difficulty}</span>
                    {quiz.isPublished && (
                      <span className="text-xs text-[#8B6914] font-bold">공개됨</span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-[#999] flex-shrink-0">
                  {quiz.createdAt?.toDate?.()
                    ? new Date(quiz.createdAt.toDate()).toLocaleDateString('ko-KR')
                    : ''}
                </span>
              </div>

              {/* 액션 버튼 */}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => router.push(`/professor/quiz/${quiz.id}/edit`)}
                  className="flex-1 py-2 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                >
                  편집
                </button>
                {!quiz.isPublished && (
                  <button
                    onClick={() => setPublishTarget(quiz.id)}
                    className="flex-1 py-2 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
                  >
                    공개
                  </button>
                )}
                <button
                  onClick={() => setDeleteTarget(quiz.id)}
                  className="py-2 px-3 text-xs font-bold border border-[#C44] text-[#C44] hover:bg-[#FEE] transition-colors"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ============================================================ */}
      {/* 페이지 선택 모달 (PDF/PPT) */}
      {/* ============================================================ */}
      {showPageSelection && (
        <PageSelectionModal
          isOpen={showPageSelection}
          pages={documentPages}
          title={pageSelectionTitle}
          onConfirm={handlePageSelectionConfirm}
          onClose={() => setShowPageSelection(false)}
        />
      )}

      {/* ============================================================ */}
      {/* 공개 타입 선택 모달 */}
      {/* ============================================================ */}
      {publishTarget && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setPublishTarget(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            <h3 className="text-lg font-bold text-[#1A1A1A] mb-4">퀴즈 공개</h3>
            <p className="text-sm text-[#5C5C5C] mb-4">퀴즈 유형을 선택하세요. 학생들에게 공개됩니다.</p>

            <div className="space-y-2 mb-6">
              {[
                { value: 'midterm', label: '중간고사' },
                { value: 'final', label: '기말고사' },
                { value: 'past', label: '기출문제' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPublishType(opt.value)}
                  className={`w-full py-3 text-sm font-bold border-2 transition-colors ${
                    publishType === opt.value
                      ? 'bg-[#1A1A1A] border-[#1A1A1A] text-[#F5F0E8]'
                      : 'border-[#D4CFC4] text-[#5C5C5C] hover:border-[#1A1A1A]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setPublishTarget(null)}
                className="flex-1 py-3 text-sm font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4]"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  if (publishTarget) {
                    await publishQuiz(publishTarget, publishType);
                    setPublishTarget(null);
                  }
                }}
                className="flex-1 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A]"
              >
                공개하기
              </button>
            </div>
          </motion.div>
        </div>,
        document.body
      )}

      {/* ============================================================ */}
      {/* 삭제 확인 모달 */}
      {/* ============================================================ */}
      {deleteTarget && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setDeleteTarget(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            <h3 className="text-lg font-bold text-[#1A1A1A] mb-2">퀴즈 삭제</h3>
            <p className="text-sm text-[#5C5C5C] mb-6">이 퀴즈를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-3 text-sm font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4]"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  if (deleteTarget) {
                    await deleteQuiz(deleteTarget);
                    setDeleteTarget(null);
                  }
                }}
                className="flex-1 py-3 text-sm font-bold bg-[#C44] text-white hover:bg-[#A33]"
              >
                삭제
              </button>
            </div>
          </motion.div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ============================================================
// 슬라이더 행 컴포넌트
// ============================================================

function SliderRow({
  label,
  value,
  weightLabel,
  onChange,
}: {
  label: string;
  value: number;
  weightLabel: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-bold text-[#1A1A1A]">{label}</span>
        <span className="text-xs font-bold text-[#5C5C5C]">{value}% ({weightLabel})</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-2 bg-[#D4CFC4] appearance-none cursor-pointer accent-[#1A1A1A]"
        style={{
          background: `linear-gradient(to right, #1A1A1A 0%, #1A1A1A ${value}%, #D4CFC4 ${value}%, #D4CFC4 100%)`
        }}
      />
    </div>
  );
}
