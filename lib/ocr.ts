/**
 * OCR 유틸리티
 *
 * Tesseract.js를 사용하여 이미지/PDF에서 텍스트를 추출하고,
 * 추출된 텍스트에서 퀴즈 문제를 파싱합니다.
 */

import Tesseract from 'tesseract.js';

// ============================================================
// 타입 정의
// ============================================================

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
 * - essay: 서술형 (루브릭 채점)
 * - combined: 결합형 (공통 지문/이미지 + 여러 하위 문제)
 */
export type QuestionType = 'ox' | 'multiple' | 'short_answer' | 'essay' | 'combined';

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
  /** 해설 */
  explanation?: string;
  /** 루브릭 (서술형) */
  rubric?: RubricItem[];
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

// ============================================================
// OCR Worker 관리
// ============================================================

// Tesseract Worker 인스턴스 (lazy load)
let worker: Tesseract.Worker | null = null;
let isWorkerInitialized = false;

/**
 * OCR Worker 초기화
 * 한국어 + 영어 인식을 위해 kor+eng 언어팩 사용
 */
export const initializeOCRWorker = async (): Promise<void> => {
  if (isWorkerInitialized && worker) {
    return;
  }

  try {
    // Worker 생성 (lazy load)
    worker = await Tesseract.createWorker('kor+eng', 1, {
      logger: (m) => {
        // 진행 상태 로깅 (디버그용)
        if (process.env.NODE_ENV === 'development') {
          console.log('[OCR]', m);
        }
      },
    });

    isWorkerInitialized = true;
  } catch (error) {
    console.error('OCR Worker 초기화 실패:', error);
    throw new Error('OCR 엔진을 초기화할 수 없습니다.');
  }
};

/**
 * OCR Worker 종료
 */
export const terminateOCRWorker = async (): Promise<void> => {
  if (worker) {
    await worker.terminate();
    worker = null;
    isWorkerInitialized = false;
  }
};

// ============================================================
// OCR 처리 함수
// ============================================================

/**
 * 이미지에서 텍스트 추출
 *
 * @param imageSource - 이미지 파일, URL, 또는 base64 문자열
 * @param onProgress - 진행 상태 콜백 (선택)
 * @returns OCR 결과
 */
export const extractTextFromImage = async (
  imageSource: File | string,
  onProgress?: (progress: OCRProgress) => void
): Promise<OCRResult> => {
  try {
    // Worker 초기화 확인
    if (!isWorkerInitialized || !worker) {
      onProgress?.({ progress: 0, status: 'OCR 엔진 초기화 중...' });
      await initializeOCRWorker();
    }

    onProgress?.({ progress: 10, status: '이미지 분석 중...' });

    // 이미지 소스 준비
    let source: string | File = imageSource;

    if (imageSource instanceof File) {
      // File 객체인 경우 URL로 변환
      source = URL.createObjectURL(imageSource);
    }

    onProgress?.({ progress: 20, status: '텍스트 인식 중...' });

    // OCR 실행
    const result = await worker!.recognize(source);

    onProgress?.({ progress: 90, status: '결과 처리 중...' });

    // URL 해제 (메모리 정리)
    if (imageSource instanceof File) {
      URL.revokeObjectURL(source as string);
    }

    onProgress?.({ progress: 100, status: '완료!' });

    return {
      text: result.data.text,
      confidence: result.data.confidence,
    };
  } catch (error) {
    console.error('OCR 처리 실패:', error);
    return {
      text: '',
      confidence: 0,
      error: error instanceof Error ? error.message : 'OCR 처리 중 오류가 발생했습니다.',
    };
  }
};

/**
 * PDF에서 텍스트 추출
 * PDF.js를 사용하여 각 페이지를 이미지로 변환 후 OCR 처리
 *
 * @param pdfFile - PDF 파일
 * @param onProgress - 진행 상태 콜백 (선택)
 * @returns OCR 결과
 */
export const extractTextFromPDF = async (
  pdfFile: File,
  onProgress?: (progress: OCRProgress) => void
): Promise<OCRResult> => {
  try {
    onProgress?.({ progress: 0, status: 'PDF 처리 준비 중...' });

    // PDF.js 동적 로드
    const pdfjsLib = await import('pdfjs-dist');

    // PDF.js 워커 설정 (unpkg CDN 사용 - 더 안정적)
    // pdfjs-dist 4.x 버전용
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

    // PDF 파일을 ArrayBuffer로 변환
    const arrayBuffer = await pdfFile.arrayBuffer();

    onProgress?.({ progress: 10, status: 'PDF 로딩 중...' });

    // PDF 문서 로드
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;

    let fullText = '';
    let totalConfidence = 0;

    // 각 페이지 처리
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const progressBase = 10 + ((pageNum - 1) / totalPages) * 80;
      onProgress?.({
        progress: progressBase,
        status: `페이지 ${pageNum}/${totalPages} 처리 중...`,
      });

      // 페이지 가져오기
      const page = await pdf.getPage(pageNum);

      // 캔버스에 렌더링
      const scale = 2; // 고해상도를 위해 2배 스케일
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      // 캔버스를 이미지로 변환하여 OCR 처리
      const imageData = canvas.toDataURL('image/png');
      const result = await extractTextFromImage(imageData);

      if (result.text) {
        fullText += `\n[페이지 ${pageNum}]\n${result.text}\n`;
        totalConfidence += result.confidence;
      }

      // 캔버스 정리
      canvas.remove();
    }

    onProgress?.({ progress: 100, status: '완료!' });

    return {
      text: fullText.trim(),
      confidence: totalPages > 0 ? totalConfidence / totalPages : 0,
    };
  } catch (error) {
    console.error('PDF OCR 처리 실패:', error);
    return {
      text: '',
      confidence: 0,
      error: error instanceof Error ? error.message : 'PDF 처리 중 오류가 발생했습니다.',
    };
  }
};

// ============================================================
// 문제 파싱 함수
// ============================================================

/**
 * 추출된 텍스트에서 문제를 파싱
 *
 * 다양한 형식의 문제를 인식합니다:
 * - "1.", "1)", "1번", "문제 1" 등의 문제 번호
 * - "O/X", "OX", "참/거짓" 등의 OX 문제
 * - "①②③④", "A B C D", "1) 2) 3) 4)" 등의 객관식 선지
 * - "정답:", "답:" 등의 정답 표시
 *
 * @param text - 추출된 텍스트
 * @returns 파싱 결과
 */
export const parseQuestions = (text: string): ParseResult => {
  const questions: ParsedQuestion[] = [];

  // 텍스트가 비어있는 경우
  if (!text.trim()) {
    return {
      questions: [],
      rawText: text,
      success: false,
      message: '추출된 텍스트가 없습니다.',
    };
  }

  try {
    // 문제 번호 패턴 (1., 1), 1번, 문제1, Q1 등)
    const questionPattern = /(?:^|\n)\s*(?:문제\s*)?(?:Q\.?\s*)?(\d+)\s*[.)번:\s]/gi;

    // OX 문제 패턴
    const oxPattern = /[OoXx○×].*[OoXx○×]|참.*거짓|True.*False/i;

    // 객관식 선지 패턴
    const choicePatterns = [
      /[①②③④⑤]/g, // 원숫자
      /\([1-5]\)/g, // (1), (2)...
      /[a-eA-E]\)/g, // a), b)...
      /\d\)\s+[^\d]/g, // 1) 내용...
    ];

    // 정답 패턴
    const answerPattern = /(?:정답|답|Answer|Ans)[\s:]+([^\n]+)/i;

    // 해설 패턴
    const explanationPattern = /(?:해설|설명|풀이|Explanation)[\s:]+([^\n]+(?:\n(?![문제Q\d])[^\n]+)*)/i;

    // 문제 분리
    const matches = [...text.matchAll(questionPattern)];

    if (matches.length === 0) {
      // 문제 번호가 없으면 줄 단위로 분리 시도
      const lines = text
        .split(/\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 10);

      if (lines.length > 0) {
        lines.forEach((line, index) => {
          questions.push({
            text: line,
            type: 'subjective', // 기본값은 주관식
          });
        });

        return {
          questions,
          rawText: text,
          success: true,
          message: `${questions.length}개의 문장을 발견했습니다. 문제 형식을 확인해주세요.`,
        };
      }

      return {
        questions: [],
        rawText: text,
        success: false,
        message: '문제 형식을 인식할 수 없습니다. 직접 입력해주세요.',
      };
    }

    // 각 문제 파싱
    for (let i = 0; i < matches.length; i++) {
      const currentMatch = matches[i];
      const nextMatch = matches[i + 1];

      const startIndex = currentMatch.index! + currentMatch[0].length;
      const endIndex = nextMatch ? nextMatch.index! : text.length;

      const questionText = text.slice(startIndex, endIndex).trim();

      // 문제 유형 판별
      let type: QuestionType = 'subjective';
      let choices: string[] | undefined;
      let answer: string | number | undefined;
      let explanation: string | undefined;

      // OX 문제 확인
      if (oxPattern.test(questionText)) {
        type = 'ox';
      } else {
        // 객관식 선지 확인
        for (const pattern of choicePatterns) {
          const choiceMatches = questionText.match(pattern);
          if (choiceMatches && choiceMatches.length >= 3) {
            type = 'multiple';

            // 선지 추출 시도
            const choiceLines = questionText.split(/\n/).filter((line) => {
              return pattern.test(line);
            });

            if (choiceLines.length >= 3) {
              choices = choiceLines.map((line) =>
                line.replace(/^[\s①②③④⑤()\da-eA-E.\-]+/, '').trim()
              );
            }

            break;
          }
        }
      }

      // 정답 추출
      const answerMatch = questionText.match(answerPattern);
      if (answerMatch) {
        answer = answerMatch[1].trim();
      }

      // 해설 추출
      const explanationMatch = questionText.match(explanationPattern);
      if (explanationMatch) {
        explanation = explanationMatch[1].trim();
      }

      // 문제 텍스트에서 정답/해설 부분 제거
      let cleanedText = questionText
        .replace(answerPattern, '')
        .replace(explanationPattern, '')
        .trim();

      // 선지가 있는 경우 문제와 선지 분리
      if (type === 'multiple' && choices) {
        const firstChoiceIndex = cleanedText.search(/[①②③④⑤\(1\)]/);
        if (firstChoiceIndex > 0) {
          cleanedText = cleanedText.slice(0, firstChoiceIndex).trim();
        }
      }

      questions.push({
        text: cleanedText || questionText,
        type,
        choices,
        answer,
        explanation,
      });
    }

    return {
      questions,
      rawText: text,
      success: true,
      message: `${questions.length}개의 문제를 발견했습니다. 내용을 확인해주세요.`,
    };
  } catch (error) {
    console.error('문제 파싱 실패:', error);
    return {
      questions: [],
      rawText: text,
      success: false,
      message: '문제 파싱 중 오류가 발생했습니다.',
    };
  }
};

// ============================================================
// 유틸리티 함수
// ============================================================

/**
 * 파일 타입 확인
 */
export const isImageFile = (file: File): boolean => {
  return file.type.startsWith('image/');
};

/**
 * PDF 파일 확인
 */
export const isPDFFile = (file: File): boolean => {
  return file.type === 'application/pdf';
};

/**
 * 지원되는 파일 타입 확인
 */
export const isSupportedFile = (file: File): boolean => {
  return isImageFile(file) || isPDFFile(file);
};

/**
 * 파일 크기 검사 (MB 단위)
 */
export const checkFileSize = (file: File, maxSizeMB: number = 10): boolean => {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return file.size <= maxSizeBytes;
};
