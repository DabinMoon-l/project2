/**
 * 퀴즈 문제 Word(docx) 출력 유틸
 *
 * 2단 시험지 형식으로 문제를 Word 문서로 내보내기.
 * 이미지는 "[이미지]" 텍스트 플레이스홀더로 대체.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  SectionType,
} from 'docx';
import { saveAs } from 'file-saver';

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
  bogi?: {
    questionText?: string;
    items: Array<{ label: string; content: string }>;
  } | null;
  passagePrompt?: string;
  hasMultipleAnswers?: boolean;
  // 결합형 문제
  passageImage?: string;
  combinedGroupId?: string;
  combinedIndex?: number;
  combinedTotal?: number;
  // 복합 제시문
  passageMixedExamples?: any[];
  mixedExamples?: any[];
}

export interface ExportOptions {
  includeAnswers: boolean;
  includeExplanations: boolean;
  folderName: string;
}

// ============================================================
// 상수
// ============================================================

/** 객관식 보기 번호 기호 */
const CHOICE_SYMBOLS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

/** 한글 ㄱㄴㄷ 라벨 */
const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ'];

// ============================================================
// 헬퍼 함수
// ============================================================

/**
 * 정답 문자열을 사람이 읽기 쉬운 형태로 변환
 * - 객관식: 0-indexed → ①②③... 기호
 * - OX: '0' → 'O', '1' → 'X'
 * - 단답형/서술형: 그대로 반환
 */
function formatAnswer(
  answer: string | undefined,
  type: string,
  hasMultipleAnswers?: boolean
): string {
  if (!answer && answer !== '0') return '-';

  if (type === 'ox') {
    return answer === '0' ? 'O' : 'X';
  }

  if (type === 'multiple') {
    // 복수 정답 처리 (쉼표 구분)
    if (hasMultipleAnswers && answer.includes(',')) {
      return answer
        .split(',')
        .map((a) => {
          const idx = parseInt(a.trim(), 10);
          return isNaN(idx) ? a.trim() : (CHOICE_SYMBOLS[idx] || `(${idx + 1})`);
        })
        .join(', ');
    }
    const idx = parseInt(answer, 10);
    if (!isNaN(idx)) {
      return CHOICE_SYMBOLS[idx] || `(${idx + 1})`;
    }
    return answer;
  }

  // 단답형: ||| 구분자를 쉼표로 변환
  if (type === 'short_answer' && answer.includes('|||')) {
    return answer.split('|||').join(', ');
  }

  return answer;
}

/**
 * 제시문(passage) 단락 생성
 * passageType에 따라 텍스트/ㄱㄴㄷ 형식 분기
 */
function buildPassageParagraphs(q: QuestionExportData): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // 제시문 프롬프트 (예: "다음 글을 읽고 물음에 답하시오.")
  if (q.passagePrompt) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({ text: q.passagePrompt, italics: true, size: 20 }),
        ],
        spacing: { before: 80, after: 60 },
      })
    );
  }

  // ㄱㄴㄷ 형식
  if (q.passageType === 'korean_abc' && q.koreanAbcItems && q.koreanAbcItems.length > 0) {
    q.koreanAbcItems.forEach((item, idx) => {
      const label = KOREAN_LABELS[idx] || `(${idx + 1})`;
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${label}. `, bold: true, size: 20 }),
            new TextRun({ text: item, size: 20 }),
          ],
          indent: { left: 400 },
          spacing: { after: 40 },
        })
      );
    });
  } else if (q.passage) {
    // 일반 텍스트 제시문 — 들여쓰기 블록
    const lines = q.passage.split('\n');
    lines.forEach((line) => {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: line, size: 20 })],
          indent: { left: 400 },
          spacing: { after: 30 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA', space: 8 },
          },
        })
      );
    });
  }

  // 제시문 이미지 플레이스홀더
  if (q.imageUrl) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({ text: '[이미지]', italics: true, color: '888888', size: 20 }),
        ],
        indent: { left: 400 },
        spacing: { before: 60, after: 60 },
      })
    );
  }

  return paragraphs;
}

/**
 * 보기(bogi) 단락 생성
 * 객관식과 별도로, 지문에 딸린 보기 항목 표시
 */
function buildBogiParagraphs(q: QuestionExportData): Paragraph[] {
  if (!q.bogi || !q.bogi.items || q.bogi.items.length === 0) return [];

  const paragraphs: Paragraph[] = [];

  // 보기 질문 텍스트
  if (q.bogi.questionText) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({ text: q.bogi.questionText, italics: true, size: 20 }),
        ],
        spacing: { before: 60, after: 40 },
      })
    );
  }

  // 보기 아이템
  q.bogi.items
    .filter((item) => item.content?.trim())
    .forEach((item) => {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${item.label}. `, bold: true, size: 20 }),
            new TextRun({ text: item.content, size: 20 }),
          ],
          indent: { left: 400 },
          spacing: { after: 30 },
        })
      );
    });

  return paragraphs;
}

/**
 * 하나의 문제를 Word 단락 배열로 변환
 */
function buildQuestionParagraphs(
  q: QuestionExportData,
  questionNum: number,
  options: ExportOptions
): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // 문제 번호 + 본문
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({ text: `${questionNum}. `, bold: true, size: 22 }),
        new TextRun({ text: q.text, size: 22 }),
      ],
      spacing: { before: 200, after: 80 },
    })
  );

  // 제시문 (passage)
  if (q.passage || q.passagePrompt || (q.koreanAbcItems && q.koreanAbcItems.length > 0)) {
    paragraphs.push(...buildPassageParagraphs(q));
  } else if (q.imageUrl) {
    // 제시문 없이 이미지만 있는 경우
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({ text: '[이미지]', italics: true, color: '888888', size: 20 }),
        ],
        spacing: { before: 60, after: 60 },
      })
    );
  }

  // 보기 (bogi)
  paragraphs.push(...buildBogiParagraphs(q));

  // 문제 유형별 선지/입력란
  switch (q.type) {
    case 'ox':
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: '   O', size: 22 }),
            new TextRun({ text: '          ', size: 22 }),
            new TextRun({ text: 'X', size: 22 }),
          ],
          spacing: { after: 60 },
          indent: { left: 200 },
        })
      );
      break;

    case 'multiple':
      // 객관식 선지
      if (q.choices && q.choices.length > 0) {
        q.choices.forEach((choice, idx) => {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `${CHOICE_SYMBOLS[idx] || `(${idx + 1})`} `,
                  size: 20,
                }),
                new TextRun({ text: choice, size: 20 }),
              ],
              indent: { left: 300 },
              spacing: { after: 30 },
            })
          );
        });
      }
      break;

    case 'short_answer':
      // 단답형 — 빈칸
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: '정답: ________________________________',
              size: 20,
            }),
          ],
          indent: { left: 200 },
          spacing: { before: 60, after: 60 },
        })
      );
      break;

    case 'essay':
      // 서술형 — 작성란 안내
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: '[서술형 — 답안 작성란]',
              italics: true,
              color: '888888',
              size: 20,
            }),
          ],
          indent: { left: 200 },
          spacing: { before: 60, after: 60 },
        })
      );
      break;

    default:
      // combined 등 기타 유형
      break;
  }

  return paragraphs;
}

// ============================================================
// 정답지 섹션 생성
// ============================================================

/**
 * 정답지 단락 배열 생성
 * - 한 줄에 정답 나열: "1. ③  2. O  3. 세포막  ..."
 * - 해설 포함 시 각 문제별 해설 추가
 */
function buildAnswerKeyParagraphs(
  questions: QuestionExportData[],
  options: ExportOptions
): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // "정답" 헤딩
  paragraphs.push(
    new Paragraph({
      text: '정답',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 200 },
      alignment: AlignmentType.CENTER,
    })
  );

  // 구분선
  paragraphs.push(
    new Paragraph({
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: '333333', space: 4 },
      },
      spacing: { after: 200 },
    })
  );

  // 정답 한 줄 요약 — TextRun 배열로 구성
  const answerRuns: TextRun[] = [];
  questions.forEach((q, idx) => {
    const num = idx + 1;
    const ans = formatAnswer(q.answer, q.type, q.hasMultipleAnswers);

    if (idx > 0) {
      answerRuns.push(new TextRun({ text: '    ', size: 20 })); // 간격
    }
    answerRuns.push(new TextRun({ text: `${num}. `, bold: true, size: 20 }));
    answerRuns.push(new TextRun({ text: ans, size: 20 }));
  });

  paragraphs.push(
    new Paragraph({
      children: answerRuns,
      spacing: { after: 200 },
    })
  );

  // 해설 포함 시 각 문제별 해설
  if (options.includeExplanations) {
    paragraphs.push(
      new Paragraph({
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA', space: 4 },
        },
        spacing: { after: 150 },
      })
    );

    paragraphs.push(
      new Paragraph({
        text: '해설',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 150 },
      })
    );

    questions.forEach((q, idx) => {
      const num = idx + 1;
      const ans = formatAnswer(q.answer, q.type, q.hasMultipleAnswers);

      // 문제 번호 + 정답
      const children: TextRun[] = [
        new TextRun({ text: `${num}. `, bold: true, size: 20 }),
        new TextRun({ text: `정답: ${ans}`, size: 20 }),
      ];

      paragraphs.push(
        new Paragraph({
          children,
          spacing: { before: 120, after: 40 },
        })
      );

      // 해설 본문
      if (q.explanation) {
        const explanationLines = q.explanation.split('\n');
        explanationLines.forEach((line) => {
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: line, size: 20, color: '444444' })],
              indent: { left: 300 },
              spacing: { after: 30 },
            })
          );
        });
      } else {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({ text: '(해설 없음)', italics: true, color: '999999', size: 18 }),
            ],
            indent: { left: 300 },
            spacing: { after: 30 },
          })
        );
      }
    });
  }

  return paragraphs;
}

// ============================================================
// 메인 내보내기 함수
// ============================================================

/**
 * 문제 배열을 2단 시험지 형식의 Word 문서로 생성하고 다운로드
 *
 * @param questions - 내보낼 문제 배열
 * @param options - 내보내기 옵션 (정답/해설 포함 여부, 폴더명)
 */
export async function exportQuestionsToDocx(
  questions: QuestionExportData[],
  options: ExportOptions
): Promise<void> {
  // 섹션 1: 헤더 (1단)
  const headerSection = {
    properties: {
      type: SectionType.NEXT_PAGE,
      page: {
        margin: { top: 800, bottom: 800, left: 800, right: 800 },
      },
    },
    children: [
      // RABBITORY 타이틀
      new Paragraph({
        children: [
          new TextRun({
            text: 'RABBITORY',
            bold: true,
            size: 48,
            font: 'Georgia',
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }),
      // 구분선
      new Paragraph({
        border: {
          bottom: { style: BorderStyle.DOUBLE, size: 6, color: '333333', space: 4 },
        },
        spacing: { after: 100 },
      }),
      // 폴더명 (부제)
      new Paragraph({
        children: [
          new TextRun({
            text: options.folderName,
            size: 28,
            font: 'Georgia',
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
      }),
      // 문제 수 안내
      new Paragraph({
        children: [
          new TextRun({
            text: `총 ${questions.length}문제`,
            size: 20,
            color: '666666',
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
      // 하단 구분선
      new Paragraph({
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: '333333', space: 4 },
        },
        spacing: { after: 100 },
      }),
    ],
  };

  // 섹션 2: 문제 영역 (2단)
  const questionParagraphs: Paragraph[] = [];
  questions.forEach((q, idx) => {
    const qParagraphs = buildQuestionParagraphs(q, idx + 1, options);
    questionParagraphs.push(...qParagraphs);
  });

  const questionSection = {
    properties: {
      type: SectionType.NEXT_PAGE,
      column: {
        space: 400, // 단 사이 간격
        count: 2,   // 2단 레이아웃
      },
      page: {
        margin: { top: 700, bottom: 700, left: 700, right: 700 },
      },
    },
    children: questionParagraphs,
  };

  // 문서 섹션 구성
  const sections = [headerSection, questionSection];

  // 섹션 3: 정답지 (1단, 선택적)
  if (options.includeAnswers) {
    const answerParagraphs = buildAnswerKeyParagraphs(questions, options);
    sections.push({
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          margin: { top: 800, bottom: 800, left: 800, right: 800 },
        },
      },
      children: answerParagraphs,
    } as typeof headerSection);
  }

  // Word 문서 생성
  const doc = new Document({
    sections,
  });

  // Blob 생성 및 다운로드
  const buffer = await Packer.toBuffer(doc);
  const blob = new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  // 파일명: "RabbiTory_문제_폴더명.docx"
  const safeFolderName = options.folderName.replace(/[\\/:*?"<>|]/g, '_');
  saveAs(blob, `RabbiTory_문제_${safeFolderName}.docx`);
}
