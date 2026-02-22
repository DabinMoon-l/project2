/**
 * 월별 리포트 Excel/Word 출력 유틸
 *
 * monthlyReports 데이터 + Claude insight → Excel/Word 변환 → Blob 다운로드
 */

import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { saveAs } from 'file-saver';

// ============================================================
// 타입
// ============================================================

export interface ReportData {
  courseId: string;
  courseName: string;
  monthLabel: string; // "2026-03"
  year: number;
  month: number;
  insight: string; // Claude 인사이트 마크다운
  weeklyStats: WeeklyStatSummary[];
}

export interface WeeklyStatSummary {
  weekLabel: string;
  quiz: {
    newCount: number;
    avgCorrectRate: number;
  };
  feedback: {
    total: number;
    avgScore: number;
  };
  student: {
    activeCount: number;
    totalCount: number;
    avgExpGain: number;
  };
  board: {
    postCount: number;
    commentCount: number;
  };
}

// ============================================================
// Excel 출력
// ============================================================

export async function exportToExcel(data: ReportData) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RabbiTory';
  wb.created = new Date();

  // 시트 1: 요약
  const summarySheet = wb.addWorksheet('요약');
  summarySheet.columns = [
    { header: '항목', key: 'label', width: 25 },
    { header: '값', key: 'value', width: 40 },
  ];
  summarySheet.addRow({ label: '과목', value: data.courseName });
  summarySheet.addRow({ label: '기간', value: `${data.year}년 ${data.month}월` });
  summarySheet.addRow({ label: '주별 데이터 수', value: data.weeklyStats.length });
  summarySheet.addRow({});

  // 총합 계산
  const totalQuizzes = data.weeklyStats.reduce((s, w) => s + w.quiz.newCount, 0);
  const totalFeedback = data.weeklyStats.reduce((s, w) => s + w.feedback.total, 0);
  const totalPosts = data.weeklyStats.reduce((s, w) => s + w.board.postCount, 0);
  const totalComments = data.weeklyStats.reduce((s, w) => s + w.board.commentCount, 0);
  const avgCorrectRate = data.weeklyStats.length > 0
    ? Math.round(data.weeklyStats.reduce((s, w) => s + w.quiz.avgCorrectRate, 0) / data.weeklyStats.length)
    : 0;

  summarySheet.addRow({ label: '총 신규 퀴즈', value: totalQuizzes });
  summarySheet.addRow({ label: '평균 정답률', value: `${avgCorrectRate}%` });
  summarySheet.addRow({ label: '총 피드백', value: totalFeedback });
  summarySheet.addRow({ label: '총 게시글', value: totalPosts });
  summarySheet.addRow({ label: '총 댓글', value: totalComments });

  // 헤더 스타일
  summarySheet.getRow(1).font = { bold: true };

  // 시트 2: 주별 퀴즈
  const quizSheet = wb.addWorksheet('퀴즈');
  quizSheet.columns = [
    { header: '주', key: 'week', width: 15 },
    { header: '신규 퀴즈', key: 'newCount', width: 12 },
    { header: '평균 정답률(%)', key: 'correctRate', width: 18 },
  ];
  data.weeklyStats.forEach(w => {
    quizSheet.addRow({ week: w.weekLabel, newCount: w.quiz.newCount, correctRate: w.quiz.avgCorrectRate });
  });
  quizSheet.getRow(1).font = { bold: true };

  // 시트 3: 학생
  const studentSheet = wb.addWorksheet('학생');
  studentSheet.columns = [
    { header: '주', key: 'week', width: 15 },
    { header: '활동 학생', key: 'active', width: 12 },
    { header: '전체 학생', key: 'total', width: 12 },
    { header: '평균 EXP 증가', key: 'exp', width: 18 },
  ];
  data.weeklyStats.forEach(w => {
    studentSheet.addRow({
      week: w.weekLabel,
      active: w.student.activeCount,
      total: w.student.totalCount,
      exp: w.student.avgExpGain,
    });
  });
  studentSheet.getRow(1).font = { bold: true };

  // 시트 4: 게시판
  const boardSheet = wb.addWorksheet('게시판');
  boardSheet.columns = [
    { header: '주', key: 'week', width: 15 },
    { header: '게시글', key: 'posts', width: 12 },
    { header: '댓글', key: 'comments', width: 12 },
  ];
  data.weeklyStats.forEach(w => {
    boardSheet.addRow({ week: w.weekLabel, posts: w.board.postCount, comments: w.board.commentCount });
  });
  boardSheet.getRow(1).font = { bold: true };

  // 시트 5: AI 인사이트
  const insightSheet = wb.addWorksheet('인사이트');
  insightSheet.columns = [{ header: 'Claude 분석 리포트', key: 'text', width: 100 }];
  insightSheet.getRow(1).font = { bold: true };

  // 인사이트를 줄 단위로 추가
  data.insight.split('\n').forEach(line => {
    insightSheet.addRow({ text: line });
  });

  // 다운로드
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `RabbiTory_리포트_${data.courseName}_${data.monthLabel}.xlsx`);
}

// ============================================================
// Word 출력
// ============================================================

/** 마크다운 줄을 Word Paragraph로 변환 (간이 파서) */
function mdLineToParagraph(line: string): Paragraph {
  // 헤딩
  if (line.startsWith('### ')) {
    return new Paragraph({
      text: line.slice(4),
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 200, after: 100 },
    });
  }
  if (line.startsWith('## ')) {
    return new Paragraph({
      text: line.slice(3),
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 100 },
    });
  }
  if (line.startsWith('# ')) {
    return new Paragraph({
      text: line.slice(2),
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    });
  }

  // 볼드 처리 (**text**)
  const parts: TextRun[] = [];
  const regex = /\*\*(.*?)\*\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIdx) {
      parts.push(new TextRun(line.slice(lastIdx, match.index)));
    }
    parts.push(new TextRun({ text: match[1], bold: true }));
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < line.length) {
    parts.push(new TextRun(line.slice(lastIdx)));
  }

  // 불릿 포인트
  const isBullet = line.startsWith('- ') || line.startsWith('* ');
  const text = isBullet ? line.slice(2) : undefined;

  if (isBullet) {
    return new Paragraph({
      children: parts.length > 0 ? parts : [new TextRun(text || '')],
      bullet: { level: 0 },
      spacing: { after: 50 },
    });
  }

  return new Paragraph({
    children: parts.length > 0 ? parts : [new TextRun(line)],
    spacing: { after: 80 },
  });
}

export async function exportToWord(data: ReportData) {
  const paragraphs: Paragraph[] = [];

  // 타이틀
  paragraphs.push(
    new Paragraph({
      text: `RabbiTory 월간 리포트`,
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
    })
  );

  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({ text: `과목: `, bold: true }),
        new TextRun(data.courseName),
        new TextRun('    '),
        new TextRun({ text: `기간: `, bold: true }),
        new TextRun(`${data.year}년 ${data.month}월`),
      ],
      spacing: { after: 300 },
    })
  );

  // 요약 통계
  paragraphs.push(
    new Paragraph({
      text: '요약 통계',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    })
  );

  const totalQuizzes = data.weeklyStats.reduce((s, w) => s + w.quiz.newCount, 0);
  const totalFeedback = data.weeklyStats.reduce((s, w) => s + w.feedback.total, 0);
  const totalPosts = data.weeklyStats.reduce((s, w) => s + w.board.postCount, 0);

  [
    `주별 데이터: ${data.weeklyStats.length}주`,
    `총 신규 퀴즈: ${totalQuizzes}개`,
    `총 피드백: ${totalFeedback}건`,
    `총 게시글: ${totalPosts}개`,
  ].forEach(text => {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun(text)],
        bullet: { level: 0 },
        spacing: { after: 50 },
      })
    );
  });

  // Claude 인사이트
  paragraphs.push(
    new Paragraph({
      text: 'AI 분석 인사이트',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    })
  );

  data.insight.split('\n').forEach(line => {
    if (line.trim()) {
      paragraphs.push(mdLineToParagraph(line));
    } else {
      paragraphs.push(new Paragraph({ spacing: { after: 100 } }));
    }
  });

  const doc = new Document({
    sections: [{ children: paragraphs }],
  });

  const buffer = await Packer.toBuffer(doc);
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  saveAs(blob, `RabbiTory_리포트_${data.courseName}_${data.monthLabel}.docx`);
}
