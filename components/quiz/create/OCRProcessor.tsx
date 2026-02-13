'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import {
  parseQuestionsAuto,
  isImageFile,
  isPDFFile,
  type ParseResult,
} from '@/lib/ocr';
import * as pdfjsLib from 'pdfjs-dist';

// PDF.js 워커 설정
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

// ============================================================
// 타입 정의
// ============================================================

interface OCRProcessorProps {
  /** 처리할 파일 */
  file: File | null;
  /** OCR 처리 완료 시 콜백 */
  onComplete: (result: ParseResult) => void;
  /** 에러 발생 시 콜백 */
  onError?: (error: string) => void;
  /** 취소 시 콜백 */
  onCancel?: () => void;
  /** 원본 이미지 URL 전달 콜백 (이미지 크롭용) */
  onImageReady?: (imageUrl: string) => void;
  /** 자동 크롭된 이미지 추가 콜백 */
  onAutoExtractImage?: (dataUrl: string, questionNumber: number, sourceFileName?: string) => void;
  /** 추가 클래스명 */
  className?: string;
}

interface OcrUsage {
  used: number;
  limit: number;
  remaining: number;
}

interface ParsedQuestionV4 {
  questionNumber: number | string;
  type: 'multipleChoice' | 'ox' | 'unknown';
  stem: string;
  // 제시문
  passage?: string;
  passageType?: 'text' | 'labeled' | 'bullet';
  labeledPassages?: Record<string, string>;
  bulletItems?: string[];  // ◦ 항목 형식 제시문
  passagePrompt?: string;  // 제시문 발문
  // 보기
  boxItems: Array<{ label: string; text: string }>;
  bogiPrompt?: string;  // 보기 발문
  // 선지
  choices: Array<{ label: string; text: string }>;
  needsReview: boolean;
  // 이미지 필요 여부
  needsImage?: boolean;
}

/** 이미지 영역 바운딩 박스 */
interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 문제별 이미지 영역 */
interface QuestionImageRegion {
  questionNumber: number;
  boundingBox: BoundingBox;
  description?: string;
}

interface ParseResultV4 {
  success: boolean;
  questions: ParsedQuestionV4[];
  preprocessed: boolean;
}

interface OcrResult {
  success: boolean;
  text: string;
  usage: OcrUsage;
  parsedV4?: ParseResultV4;  // Gemini 전처리 결과
}

interface ProgressState {
  progress: number;
  status: string;
}

// ============================================================
// 유틸리티 함수
// ============================================================

/**
 * 파일을 base64로 변환
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 이미지 URL을 로드하여 Image 객체 반환
 */
async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * 바운딩 박스 좌표로 이미지 크롭 (정규화 좌표 0-1)
 * 텍스트가 포함되지 않도록 상하 여백을 축소하여 크롭
 */
async function cropImageRegion(
  imageBase64: string,
  boundingBox: BoundingBox
): Promise<string> {
  const img = await loadImage(imageBase64);

  // 텍스트 제거를 위한 내부 여백 축소 (최소화하여 화질 보존)
  const topPadding = 0.02;    // 상단 2% 축소
  const bottomPadding = 0.02; // 하단 2% 축소
  const sidePadding = 0.01;   // 좌우 1% 축소

  // 조정된 바운딩 박스 계산
  const adjustedBox = {
    x: boundingBox.x + (boundingBox.width * sidePadding),
    y: boundingBox.y + (boundingBox.height * topPadding),
    width: boundingBox.width * (1 - 2 * sidePadding),
    height: boundingBox.height * (1 - topPadding - bottomPadding),
  };

  // 정규화 좌표를 픽셀 좌표로 변환
  const x = Math.floor(adjustedBox.x * img.width);
  const y = Math.floor(adjustedBox.y * img.height);
  const width = Math.floor(adjustedBox.width * img.width);
  const height = Math.floor(adjustedBox.height * img.height);

  // 범위 검증
  const safeX = Math.max(0, Math.min(x, img.width - 1));
  const safeY = Math.max(0, Math.min(y, img.height - 1));
  const safeWidth = Math.min(width, img.width - safeX);
  const safeHeight = Math.min(height, img.height - safeY);

  if (safeWidth <= 0 || safeHeight <= 0) {
    throw new Error('크롭 영역이 너무 작습니다');
  }

  // 캔버스에 크롭
  const canvas = document.createElement('canvas');
  canvas.width = safeWidth;
  canvas.height = safeHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas context 생성 실패');
  }

  // 고품질 이미지 스케일링 설정
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(img, safeX, safeY, safeWidth, safeHeight, 0, 0, safeWidth, safeHeight);

  // JPEG 고품질(0.95)로 저장하여 화질 유지
  return canvas.toDataURL('image/jpeg', 0.95);
}

/**
 * PDF 파일을 이미지(base64)로 변환
 * 멀티 페이지 PDF의 경우 모든 페이지를 하나의 긴 이미지로 합침
 */
async function pdfToImages(file: File): Promise<{ images: string[]; combinedImage: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;

  const images: string[] = [];
  const scale = 2.0; // 고해상도 렌더링

  let totalHeight = 0;
  let maxWidth = 0;
  const pageCanvases: HTMLCanvasElement[] = [];

  // 각 페이지를 캔버스로 렌더링
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    await page.render({
      canvasContext: ctx,
      viewport: viewport,
    }).promise;

    // 개별 페이지 이미지 저장
    images.push(canvas.toDataURL('image/png'));
    pageCanvases.push(canvas);

    totalHeight += viewport.height;
    maxWidth = Math.max(maxWidth, viewport.width);
  }

  // 모든 페이지를 하나의 긴 이미지로 합치기
  const combinedCanvas = document.createElement('canvas');
  combinedCanvas.width = maxWidth;
  combinedCanvas.height = totalHeight;
  const combinedCtx = combinedCanvas.getContext('2d');

  if (combinedCtx) {
    let yOffset = 0;
    for (const pageCanvas of pageCanvases) {
      combinedCtx.drawImage(pageCanvas, 0, yOffset);
      yOffset += pageCanvas.height;
    }
  }

  return {
    images,
    combinedImage: combinedCanvas.toDataURL('image/png'),
  };
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * OCR 처리 컴포넌트
 *
 * Naver CLOVA OCR을 사용하여 이미지에서 텍스트를 추출하고
 * 문제 형식으로 파싱합니다.
 *
 * 월 500건 무료 한도를 추적합니다.
 */
export default function OCRProcessor({
  file,
  onComplete,
  onError,
  onCancel,
  onImageReady,
  onAutoExtractImage,
  className = '',
}: OCRProcessorProps) {
  // 상태
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [ocrUsage, setOcrUsage] = useState<OcrUsage | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [step, setStep] = useState<'idle' | 'ocr' | 'parsing' | 'review'>('idle');

  // 취소 플래그
  const isCancelledRef = useRef(false);
  // 현재 처리 중인 파일 추적
  const processedFileRef = useRef<File | null>(null);

  /**
   * 파일 변경 시 OCR 처리 시작
   */
  useEffect(() => {
    if (file && file !== processedFileRef.current) {
      processedFileRef.current = file;
      isCancelledRef.current = false;
      processFile(file);
    } else if (!file) {
      // 파일이 없으면 상태 초기화
      resetState();
    }
  }, [file]);

  /**
   * 상태 초기화
   */
  const resetState = useCallback(() => {
    setIsProcessing(false);
    setProgress(null);
    setOcrUsage(null);
    setParseResult(null);
    setStep('idle');
    processedFileRef.current = null;
  }, []);

  /**
   * 취소 핸들러
   */
  const handleCancel = useCallback(() => {
    isCancelledRef.current = true;
    resetState();
    onCancel?.();
  }, [resetState, onCancel]);

  /**
   * 파일 OCR 처리
   */
  const processFile = useCallback(
    async (targetFile: File) => {
      setIsProcessing(true);
      setStep('ocr');
      setProgress({ progress: 0, status: '준비 중...' });

      try {
        // 이미지 또는 PDF 파일만 지원
        const isPdf = isPDFFile(targetFile);
        const isImage = isImageFile(targetFile);

        if (!isImage && !isPdf) {
          throw new Error('지원하지 않는 파일 형식입니다. JPG, PNG 이미지 또는 PDF 파일을 사용해주세요.');
        }

        let base64Image: string;

        if (isPdf) {
          // PDF 파일 처리
          setProgress({ progress: 5, status: 'PDF 변환 중...' });

          const { combinedImage, images } = await pdfToImages(targetFile);
          base64Image = combinedImage;

          // PDF의 첫 페이지 이미지를 크롭용으로 전달
          if (images.length > 0) {
            onImageReady?.(images[0]);
          }

          console.log(`[OCRProcessor] PDF 변환 완료: ${images.length}페이지`);
        } else {
          // 이미지 파일 처리
          // 원본 이미지 URL 생성 및 전달 (이미지 크롭용)
          const imageUrl = URL.createObjectURL(targetFile);
          onImageReady?.(imageUrl);

          setProgress({ progress: 10, status: '이미지 변환 중...' });

          // 이미지를 base64로 변환
          base64Image = await fileToBase64(targetFile);
        }

        if (isCancelledRef.current) return;

        setProgress({ progress: 30, status: 'CLOVA OCR 처리 중...' });

        // Cloud Function 호출
        const runClovaOcr = httpsCallable<{ image: string }, OcrResult>(
          functions,
          'runClovaOcr'
        );

        const result = await runClovaOcr({ image: base64Image });

        if (isCancelledRef.current) return;

        const { text, usage, parsedV4 } = result.data;

        // 🔍 디버그: 서버 응답 확인
        console.log('=== OCR 서버 응답 디버그 ===');
        console.log('text 길이:', text?.length || 0);
        console.log('parsedV4 존재:', !!parsedV4);
        console.log('parsedV4.success:', parsedV4?.success);
        console.log('parsedV4.questions 수:', parsedV4?.questions?.length || 0);
        if (parsedV4?.questions && parsedV4.questions.length > 0) {
          console.log('첫번째 문제 stem:', parsedV4.questions[0].stem?.substring(0, 50));
        }
        console.log('=== 디버그 끝 ===');

        setOcrUsage(usage);

        setStep('parsing');
        setProgress({ progress: 70, status: '문제 분석 중...' });

        // 약간의 딜레이 후 파싱 (UI 업데이트를 위해)
        await new Promise((resolve) => setTimeout(resolve, 300));

        if (isCancelledRef.current) return;

        // V4 (Gemini 전처리) 결과 우선 사용
        if (parsedV4?.success && parsedV4.questions.length > 0) {
          console.log('[OCRProcessor] V4 파싱 결과 사용:', parsedV4.questions.length, '문제');

          // 이미지가 필요한 문제가 있는지 확인
          const questionsNeedingImage = parsedV4.questions.filter(q => q.needsImage);

          if (questionsNeedingImage.length > 0 && onAutoExtractImage) {
            console.log('[OCRProcessor] 이미지 필요 문제:', questionsNeedingImage.length, '개');
            setProgress({ progress: 75, status: '이미지 영역 분석 중...' });

            try {
              // 이미지 영역 분석 Cloud Function 호출
              const analyzeImageRegionsCall = httpsCallable<
                { imageBase64: string },
                { success: boolean; regions: QuestionImageRegion[] }
              >(functions, 'analyzeImageRegionsCall');

              const regionResult = await analyzeImageRegionsCall({ imageBase64: base64Image });

              if (regionResult.data.success && regionResult.data.regions.length > 0) {
                console.log('[OCRProcessor] 이미지 영역 분석 완료:', regionResult.data.regions.length, '개');
                setProgress({ progress: 85, status: '이미지 자동 추출 중...' });

                // 각 영역을 크롭하여 해당 문제에 매핑
                for (const region of regionResult.data.regions) {
                  try {
                    const croppedDataUrl = await cropImageRegion(base64Image, region.boundingBox);
                    onAutoExtractImage(
                      croppedDataUrl,
                      region.questionNumber,
                      targetFile.name
                    );
                    console.log(`[OCRProcessor] ${region.questionNumber}번 문제 이미지 추출 완료`);
                  } catch (cropError) {
                    console.error(`[OCRProcessor] ${region.questionNumber}번 이미지 크롭 실패:`, cropError);
                  }
                }
              } else {
                console.log('[OCRProcessor] 분석된 이미지 영역 없음');
              }
            } catch (analyzeError) {
              console.error('[OCRProcessor] 이미지 영역 분석 실패:', analyzeError);
              // 이미지 분석 실패해도 계속 진행
            }
          }

          // V4 결과를 앱의 ParseResult 형식으로 변환
          const parsed: ParseResult = {
            questions: parsedV4.questions.map((q) => {
              const question: any = {
                // 필수 필드
                text: q.stem,
                type: q.type === 'multipleChoice' ? 'multiple' : q.type === 'ox' ? 'ox' : 'short_answer',
                // 선지는 text만 사용 (UI에서 번호 표시)
                choices: q.choices.map((c) => c.text),
                answer: '',
                explanation: '',
              };

              // 제시문 처리 - mixedExamples 형식으로 변환 (QuestionEditor UI와 호환)
              // QuestionEditor는 mixedExamples를 사용하여 제시문 섹션을 렌더링함
              const mixedExamples: Array<{
                id: string;
                type: 'text' | 'gana' | 'bullet';
                content?: string;
                items?: Array<{ id: string; label: string; content: string }>;
              }> = [];

              // 1. text 타입 제시문
              if (q.passage) {
                mixedExamples.push({
                  id: `passage_text_${Date.now()}`,
                  type: 'text',
                  content: q.passage,
                });
              }

              // 2. (가)(나)(다) 타입 제시문
              if (q.labeledPassages && Object.keys(q.labeledPassages).length > 0) {
                mixedExamples.push({
                  id: `passage_gana_${Date.now()}`,
                  type: 'gana',
                  items: Object.entries(q.labeledPassages).map(([label, text], idx) => ({
                    id: `gana_item_${Date.now()}_${idx}`,
                    label: label,
                    content: text as string,
                  })),
                });
              }

              // 3. bullet 타입 제시문 (◦ 항목)
              if (q.bulletItems && q.bulletItems.length > 0) {
                mixedExamples.push({
                  id: `passage_bullet_${Date.now()}`,
                  type: 'bullet',
                  items: q.bulletItems.map((text, idx) => ({
                    id: `bullet_item_${Date.now()}_${idx}`,
                    label: '◦',
                    content: text,
                  })),
                });
              }

              // mixedExamples가 있으면 추가 (QuestionEditor에서 제시문 섹션에 표시됨)
              if (mixedExamples.length > 0) {
                question.mixedExamples = mixedExamples;
              }

              // 제시문 발문
              if (q.passagePrompt) {
                question.passagePrompt = q.passagePrompt;
              }

              // 보기 데이터 (bogi 형식으로 변환)
              if (q.boxItems && q.boxItems.length > 0) {
                question.bogi = {
                  questionText: q.bogiPrompt || '',  // 보기 발문
                  items: q.boxItems.map((b, idx) => ({
                    id: `bogi_${Date.now()}_${idx}`,
                    label: b.label,
                    content: b.text,
                  })),
                };
              }

              return question;
            }),
            rawText: text,
            success: true,
            message: `${parsedV4.questions.length}개의 문제를 인식했습니다. (AI 전처리)`,
          };

          setParseResult(parsed);
          setStep('review');
          setProgress({ progress: 100, status: '완료!' });
          onComplete(parsed);
        } else if (text.trim()) {
          // V4 실패 - 에러 표시 (디버깅용)
          console.error('[OCRProcessor] V4 실패!');
          console.error('[OCRProcessor] parsedV4:', parsedV4);
          console.error('[OCRProcessor] parsedV4?.debug:', (parsedV4 as any)?.debug);

          // 서버에서 전달된 에러 메시지 추출
          const serverError = (parsedV4 as any)?.debug?.error || '알 수 없는 오류';

          const errorMsg = parsedV4
            ? `V4 파싱 실패: ${serverError}`
            : 'V4 결과가 null입니다 (서버에서 Gemini 호출 실패)';

          throw new Error(errorMsg);
        } else {
          // 텍스트가 없는 경우
          const emptyResult: ParseResult = {
            questions: [],
            rawText: '',
            success: false,
            message: '텍스트를 추출할 수 없습니다. 이미지 품질을 확인해주세요.',
          };
          setParseResult(emptyResult);
          setStep('review');
          onComplete(emptyResult);
        }
      } catch (error: any) {
        if (isCancelledRef.current) return;

        let errorMessage = 'OCR 처리 중 오류가 발생했습니다.';

        // Firebase Functions 에러 처리
        if (error.code === 'functions/resource-exhausted') {
          errorMessage = error.message || '이번 달 OCR 사용량(500건)을 초과했습니다.';
        } else if (error.code === 'functions/failed-precondition') {
          errorMessage = 'OCR 서비스가 설정되지 않았습니다. 관리자에게 문의하세요.';
        } else if (error.code === 'functions/unauthenticated') {
          errorMessage = '로그인이 필요합니다.';
        } else if (error.message) {
          errorMessage = error.message;
        }

        console.error('OCR 처리 오류:', error);
        onError?.(errorMessage);
        setStep('idle');
      } finally {
        if (!isCancelledRef.current) {
          setIsProcessing(false);
        }
      }
    },
    [onComplete, onError, onImageReady, onAutoExtractImage]
  );

  // 파일이 없거나 idle 상태면 렌더링하지 않음
  if (!file && step === 'idle') {
    return null;
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 진행 상태 카드 */}
      <AnimatePresence mode="wait">
        {isProcessing && progress && (
          <motion.div
            key="progress"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-[#F5F0E8] p-6 border-2 border-[#1A1A1A]"
          >
            {/* 단계 표시 */}
            <div className="flex items-center gap-2 mb-4">
              <div
                className={`
                  w-8 h-8 flex items-center justify-center text-sm font-bold border-2
                  ${step === 'ocr'
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C]'
                  }
                `}
              >
                1
              </div>
              <div
                className={`flex-1 h-0.5 ${step === 'parsing' || step === 'review' ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'}`}
              />
              <div
                className={`
                  w-8 h-8 flex items-center justify-center text-sm font-bold border-2
                  ${step === 'parsing'
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : step === 'review'
                      ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                      : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C]'
                  }
                `}
              >
                2
              </div>
            </div>

            {/* 현재 상태 */}
            <div className="text-center mb-4">
              <p className="font-serif-display text-xl font-black text-[#1A1A1A]">
                {step === 'ocr' ? 'CLOVA OCR 처리 중' : '문제 분석 중'}
              </p>
              <p className="text-sm text-[#5C5C5C] mt-1">{progress.status}</p>
            </div>

            {/* 진행률 바 */}
            <div className="relative h-2 bg-[#EDEAE4] border border-[#1A1A1A] overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress.progress}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="absolute left-0 top-0 h-full bg-[#1A1A1A]"
              />
            </div>

            {/* 진행률 퍼센트 */}
            <p className="text-center text-sm font-bold text-[#1A1A1A] mt-2">
              {Math.round(progress.progress)}%
            </p>

            {/* 취소 버튼 */}
            <button
              type="button"
              onClick={handleCancel}
              className="w-full mt-4 py-2 text-sm font-bold border border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-[#F5F0E8] transition-colors"
            >
              취소
            </button>
          </motion.div>
        )}

        {/* 결과 표시 */}
        {!isProcessing && step === 'review' && parseResult && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            {/* OCR 사용량 표시 */}
            {ocrUsage && (
              <div className="bg-[#F5F0E8] p-4 border-2 border-[#1A1A1A]">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-[#1A1A1A]">이번 달 OCR 사용량</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-[#EDEAE4] border border-[#1A1A1A] overflow-hidden">
                      <div
                        className={`h-full ${ocrUsage.remaining < 50 ? 'bg-[#8B1A1A]' : 'bg-[#1A1A1A]'}`}
                        style={{ width: `${(ocrUsage.used / ocrUsage.limit) * 100}%` }}
                      />
                    </div>
                    <span className={`text-sm font-bold ${ocrUsage.remaining < 50 ? 'text-[#8B1A1A]' : 'text-[#1A1A1A]'}`}>
                      {ocrUsage.used} / {ocrUsage.limit}
                    </span>
                  </div>
                </div>
                {ocrUsage.remaining < 50 && (
                  <p className="text-xs text-[#8B1A1A] mt-2">
                    남은 횟수: {ocrUsage.remaining}회
                  </p>
                )}
              </div>
            )}

            {/* 결과 메시지 */}
            <div
              className={`
                p-4 border-2
                ${parseResult.success
                  ? 'bg-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#FFF9E6] border-[#C9A227]'
                }
              `}
            >
              <div className="flex items-start gap-3">
                {parseResult.success ? (
                  <svg
                    className="w-6 h-6 text-[#1A1A1A] flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-6 h-6 text-[#C9A227] flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                <div>
                  <p
                    className={`font-bold ${parseResult.success ? 'text-[#1A1A1A]' : 'text-[#8B6914]'}`}
                  >
                    {parseResult.message}
                  </p>
                  {parseResult.questions.length > 0 && (
                    <p className="text-sm text-[#5C5C5C] mt-1">
                      아래에서 문제를 확인하고 수정할 수 있습니다.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* 추출된 원본 텍스트 토글 */}
            <ExtractedTextView rawText={parseResult.rawText} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// 추출된 텍스트 보기 컴포넌트
// ============================================================

interface ExtractedTextViewProps {
  rawText: string;
}

function ExtractedTextView({ rawText }: ExtractedTextViewProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!rawText.trim()) {
    return null;
  }

  return (
    <div className="bg-[#F5F0E8] overflow-hidden border-2 border-[#1A1A1A]">
      {/* 헤더 */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="
          w-full flex items-center justify-between
          px-4 py-3
          text-left text-sm font-bold text-[#1A1A1A]
          hover:bg-[#EDEAE4]
          transition-colors
        "
      >
        <span>추출된 원본 텍스트</span>
        <motion.svg
          animate={{ rotate: isExpanded ? 180 : 0 }}
          className="w-5 h-5 text-[#1A1A1A]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </motion.svg>
      </button>

      {/* 텍스트 내용 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              <pre className="whitespace-pre-wrap text-sm text-[#1A1A1A] bg-[#EDEAE4] p-3 border border-[#1A1A1A] max-h-60 overflow-y-auto">
                {rawText}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
