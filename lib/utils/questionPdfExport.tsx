/**
 * 수능 스타일 PDF 시험지 내보내기 유틸
 *
 * Cloud Run의 /render-pdf 엔드포인트(Playwright/Chromium)를 호출하여
 * HTML → 고품질 A4 PDF를 생성합니다.
 */

import { saveAs } from 'file-saver';
import { getAuth } from 'firebase/auth';
import { generateExamHtml } from './questionHtmlTemplate';

// ============================================================
// 타입
// ============================================================

export interface QuestionExportData {
  text: string;
  type: 'ox' | 'multiple' | 'short_answer' | 'essay' | 'combined' | string;
  choices?: string[];
  answer?: string;
  explanation?: string;
  imageUrl?: string;
  passage?: string;
  passageType?: 'text' | 'korean_abc' | 'mixed';
  koreanAbcItems?: string[];
  bogi?: { questionText?: string; items: Array<{ label: string; content: string }> } | null;
  passagePrompt?: string;
  hasMultipleAnswers?: boolean;
}

export interface PdfExportOptions {
  includeAnswers: boolean;
  includeExplanations: boolean;
  folderName: string;
  userName?: string;
  studentId?: string;
}

// ============================================================
// 내보내기 함수
// ============================================================

export async function exportQuestionsToPdf(
  questions: QuestionExportData[],
  options: PdfExportOptions
): Promise<void> {
  // HTML 생성
  const html = generateExamHtml(questions, options);

  // Firebase Auth 토큰
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  const idToken = await user.getIdToken();

  // Cloud Run /render-pdf 호출
  const cloudRunUrl = process.env.NEXT_PUBLIC_PPTX_CLOUD_RUN_URL;
  if (!cloudRunUrl) throw new Error('PPTX_CLOUD_RUN_URL이 설정되지 않았습니다.');

  const resp = await fetch(`${cloudRunUrl}/render-pdf`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ html }),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    throw new Error(`PDF 생성 실패 (${resp.status}): ${errorText}`);
  }

  const blob = await resp.blob();
  const safeName = options.folderName.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
  saveAs(blob, `RABBITORY_${safeName}.pdf`);
}
