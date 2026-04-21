/**
 * 공지 투표(설문) 결과 내보내기 — Excel + CSV ZIP
 *
 * 연구 데이터 분석 목적으로 Tidy Data 형식 준수:
 * - 각 행 = 한 관찰치 (한 학생의 한 응답)
 * - 각 열 = 한 변수
 * - 표준 영문 컬럼명 (SPSS/R/Python import 호환)
 * - 주관식 응답은 wrap-text로 긴 답변도 전부 표시
 * - 복수선택 객관식은 long format (한 선지 선택당 한 행)
 */

import { saveAs } from 'file-saver';
import type { CloudFunctionMap } from '@/lib/api/types';
import type { Poll } from './types';

type PollResponsesResult = CloudFunctionMap['getPollResponses']['output'];

// ─── 입력 타입 ─────────────────────────────────────────

export interface SurveyExportPoll {
  pollIdx: number;
  question: string;
  type: 'choice' | 'text';
  options: string[];
  allowMultiple: boolean;
  /** getPollResponses CF 결과 */
  result: PollResponsesResult;
}

export interface SurveyExportData {
  announcementId: string;
  announcementContent: string;
  announcementCreatedAt: Date | null;
  courseName?: string;
  polls: SurveyExportPoll[];
}

// ─── 공통 헬퍼 ─────────────────────────────────────────

/** ISO 8601 문자열 변환 (null-safe) */
function toIso(ts: number | null | undefined): string {
  if (!ts) return '';
  return new Date(ts).toISOString();
}

/** 파일명에 쓸 수 있게 문자열 정리 */
function sanitizeForFilename(s: string, maxLen = 20): string {
  const cleaned = (s || '공지').replace(/[\\/:*?"<>|\n\r\t]/g, '').trim();
  return cleaned.slice(0, maxLen) || '공지';
}

function formatDateSuffix(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function baseFilename(data: SurveyExportData): string {
  const title = sanitizeForFilename(data.announcementContent);
  const date = formatDateSuffix(data.announcementCreatedAt || new Date());
  return `설문결과_${title}_${date}`;
}

/** 응답자 총 인원 (객관식: 중복 제거, 주관식: responseCount) */
function getUniqueRespondents(polls: SurveyExportPoll[]): Set<string> {
  const uids = new Set<string>();
  for (const p of polls) {
    if (p.result.type === 'choice') {
      for (const opt of p.result.options) {
        for (const v of opt.voters) uids.add(v.uid);
      }
    } else {
      for (const r of p.result.responses) uids.add(r.uid);
    }
  }
  return uids;
}

// ─── 테이블 빌더 (엑셀/CSV 공통 원천) ─────────────────────

/** 객관식 응답 long format (한 선지 선택당 한 행) */
interface ChoiceResponseRow {
  announcement_id: string;
  question_index: number;      // 1-indexed (연구자 친화)
  question_text: string;
  allow_multiple: boolean;
  respondent_uid: string;
  respondent_student_number: string;
  respondent_name: string;
  respondent_nickname: string;
  selected_option_index: number; // 1-indexed
  selected_option_text: string;
}

function buildChoiceRows(data: SurveyExportData): ChoiceResponseRow[] {
  const rows: ChoiceResponseRow[] = [];
  for (const p of data.polls) {
    if (p.result.type !== 'choice') continue;
    for (const opt of p.result.options) {
      for (const v of opt.voters) {
        rows.push({
          announcement_id: data.announcementId,
          question_index: p.pollIdx + 1,
          question_text: p.question,
          allow_multiple: p.allowMultiple,
          respondent_uid: v.uid,
          respondent_student_number: v.studentNumber || '',
          respondent_name: v.name || '',
          respondent_nickname: v.nickname || '',
          selected_option_index: opt.optIdx + 1,
          selected_option_text: opt.option,
        });
      }
    }
  }
  // 학번 → 질문 → 선지 순 정렬
  rows.sort((a, b) => {
    const c1 = a.respondent_student_number.localeCompare(b.respondent_student_number);
    if (c1 !== 0) return c1;
    const c2 = a.question_index - b.question_index;
    if (c2 !== 0) return c2;
    return a.selected_option_index - b.selected_option_index;
  });
  return rows;
}

/** 객관식 집계 wide (각 선지별 카운트 + %) */
interface ChoiceAggregateRow {
  announcement_id: string;
  question_index: number;
  question_text: string;
  option_index: number;
  option_text: string;
  voter_count: number;
  total_voters: number;
  percentage: number; // 0-100
}

function buildChoiceAggregates(data: SurveyExportData): ChoiceAggregateRow[] {
  const rows: ChoiceAggregateRow[] = [];
  for (const p of data.polls) {
    if (p.result.type !== 'choice') continue;
    const total = p.result.totalVoters;
    for (const opt of p.result.options) {
      rows.push({
        announcement_id: data.announcementId,
        question_index: p.pollIdx + 1,
        question_text: p.question,
        option_index: opt.optIdx + 1,
        option_text: opt.option,
        voter_count: opt.voters.length,
        total_voters: total,
        percentage: total > 0 ? Math.round((opt.voters.length / total) * 1000) / 10 : 0,
      });
    }
  }
  return rows;
}

/** 주관식 응답 */
interface TextResponseRow {
  announcement_id: string;
  question_index: number;
  question_text: string;
  respondent_uid: string;
  respondent_student_number: string;
  respondent_name: string;
  respondent_nickname: string;
  answer_text: string;
  answer_length: number;
  response_created_at: string; // ISO
  response_updated_at: string;
  was_edited: boolean;
}

function buildTextRows(data: SurveyExportData): TextResponseRow[] {
  const rows: TextResponseRow[] = [];
  for (const p of data.polls) {
    if (p.result.type !== 'text') continue;
    for (const r of p.result.responses) {
      rows.push({
        announcement_id: data.announcementId,
        question_index: p.pollIdx + 1,
        question_text: p.question,
        respondent_uid: r.uid,
        respondent_student_number: r.studentNumber || '',
        respondent_name: r.name || '',
        respondent_nickname: r.nickname || '',
        answer_text: r.text,
        answer_length: r.text.length,
        response_created_at: toIso(r.createdAt),
        response_updated_at: toIso(r.updatedAt),
        was_edited: r.createdAt !== r.updatedAt,
      });
    }
  }
  rows.sort((a, b) => {
    const c1 = a.respondent_student_number.localeCompare(b.respondent_student_number);
    if (c1 !== 0) return c1;
    return a.question_index - b.question_index;
  });
  return rows;
}

/** 질문 메타 */
interface QuestionRow {
  question_index: number;
  question_type: 'choice' | 'text';
  question_text: string;
  option_count: number;
  allow_multiple: boolean;
  response_count: number;
}

function buildQuestionRows(data: SurveyExportData): QuestionRow[] {
  return data.polls.map((p) => ({
    question_index: p.pollIdx + 1,
    question_type: p.type,
    question_text: p.question,
    option_count: p.type === 'choice' ? p.options.length : 0,
    allow_multiple: p.allowMultiple,
    response_count:
      p.result.type === 'choice' ? p.result.totalVoters : p.result.responseCount,
  }));
}

/**
 * 응답자 매트릭스 — wide format
 * 행: 학생, 열: 질문. 각 셀에 선택지(문자열 결합) 또는 주관식 답변 전문.
 */
interface MatrixRow {
  respondent_uid: string;
  respondent_student_number: string;
  respondent_name: string;
  respondent_nickname: string;
  [questionKey: string]: string; // q1_text, q2_text ...
}

function buildMatrixRows(data: SurveyExportData): { columns: string[]; rows: MatrixRow[] } {
  const byUid = new Map<string, MatrixRow>();

  // 사용자 정보 수집
  function ensure(uid: string, profile: { name: string; studentNumber: string; nickname?: string }) {
    if (!byUid.has(uid)) {
      byUid.set(uid, {
        respondent_uid: uid,
        respondent_student_number: profile.studentNumber || '',
        respondent_name: profile.name || '',
        respondent_nickname: profile.nickname || '',
      });
    }
    return byUid.get(uid)!;
  }

  const questionKeys: string[] = [];

  for (const p of data.polls) {
    const qKey = `q${p.pollIdx + 1}_${p.type === 'text' ? 'text' : 'choice'}`;
    questionKeys.push(qKey);

    if (p.result.type === 'choice') {
      // 학생별 선택 옵션 수집 (복수선택은 세미콜론으로 결합)
      const selectedByUid = new Map<string, string[]>();
      for (const opt of p.result.options) {
        for (const v of opt.voters) {
          ensure(v.uid, v);
          const arr = selectedByUid.get(v.uid) || [];
          arr.push(opt.option);
          selectedByUid.set(v.uid, arr);
        }
      }
      for (const [uid, row] of byUid.entries()) {
        const selected = selectedByUid.get(uid);
        row[qKey] = selected ? selected.join(' ; ') : '';
      }
    } else {
      // 주관식
      const byUidText = new Map<string, string>();
      for (const r of p.result.responses) {
        ensure(r.uid, r);
        byUidText.set(r.uid, r.text);
      }
      for (const [uid, row] of byUid.entries()) {
        row[qKey] = byUidText.get(uid) || '';
      }
    }
  }

  const rows = Array.from(byUid.values()).sort((a, b) =>
    a.respondent_student_number.localeCompare(b.respondent_student_number)
  );
  const columns = ['respondent_uid', 'respondent_student_number', 'respondent_name', 'respondent_nickname', ...questionKeys];
  return { columns, rows };
}

// ─── Excel 내보내기 ─────────────────────────────────────

export async function exportSurveyToExcel(data: SurveyExportData): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RabbiTory Survey';
  wb.created = new Date();

  const respondentCount = getUniqueRespondents(data.polls).size;

  // ─── 시트 1: 개요 ─────────────────────────────
  const s1 = wb.addWorksheet('개요');
  s1.columns = [
    { header: '항목', key: 'label', width: 28 },
    { header: '값', key: 'value', width: 70 },
  ];
  s1.addRow({ label: 'announcement_id', value: data.announcementId });
  s1.addRow({ label: '공지 내용', value: data.announcementContent });
  s1.addRow({
    label: '작성일',
    value: data.announcementCreatedAt ? data.announcementCreatedAt.toISOString() : '',
  });
  if (data.courseName) s1.addRow({ label: '과목', value: data.courseName });
  s1.addRow({ label: '투표 수', value: data.polls.length });
  s1.addRow({ label: '고유 응답자 수', value: respondentCount });
  s1.addRow({ label: '내보낸 시각', value: new Date().toISOString() });
  s1.getRow(1).font = { bold: true };
  s1.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  // ─── 시트 2: 질문목록 ─────────────────────────
  const s2 = wb.addWorksheet('질문목록');
  s2.columns = [
    { header: 'question_index', key: 'question_index', width: 14 },
    { header: 'question_type', key: 'question_type', width: 14 },
    { header: 'question_text', key: 'question_text', width: 60 },
    { header: 'option_count', key: 'option_count', width: 12 },
    { header: 'allow_multiple', key: 'allow_multiple', width: 14 },
    { header: 'response_count', key: 'response_count', width: 14 },
  ];
  buildQuestionRows(data).forEach((r) => s2.addRow(r));
  s2.getRow(1).font = { bold: true };
  s2.getColumn(3).alignment = { wrapText: true, vertical: 'top' };

  // ─── 시트 3: 객관식_응답(long) ─────────────────
  const s3 = wb.addWorksheet('객관식_응답_long');
  s3.columns = [
    { header: 'announcement_id', key: 'announcement_id', width: 24 },
    { header: 'question_index', key: 'question_index', width: 14 },
    { header: 'question_text', key: 'question_text', width: 40 },
    { header: 'allow_multiple', key: 'allow_multiple', width: 14 },
    { header: 'respondent_uid', key: 'respondent_uid', width: 30 },
    { header: 'respondent_student_number', key: 'respondent_student_number', width: 22 },
    { header: 'respondent_name', key: 'respondent_name', width: 15 },
    { header: 'respondent_nickname', key: 'respondent_nickname', width: 18 },
    { header: 'selected_option_index', key: 'selected_option_index', width: 20 },
    { header: 'selected_option_text', key: 'selected_option_text', width: 40 },
  ];
  buildChoiceRows(data).forEach((r) => s3.addRow(r));
  s3.getRow(1).font = { bold: true };
  // 자동 필터
  if (s3.rowCount > 1) {
    s3.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };
  }

  // ─── 시트 4: 객관식_집계(wide) ─────────────────
  const s4 = wb.addWorksheet('객관식_집계');
  s4.columns = [
    { header: 'announcement_id', key: 'announcement_id', width: 24 },
    { header: 'question_index', key: 'question_index', width: 14 },
    { header: 'question_text', key: 'question_text', width: 40 },
    { header: 'option_index', key: 'option_index', width: 12 },
    { header: 'option_text', key: 'option_text', width: 40 },
    { header: 'voter_count', key: 'voter_count', width: 12 },
    { header: 'total_voters', key: 'total_voters', width: 14 },
    { header: 'percentage', key: 'percentage', width: 12 },
  ];
  buildChoiceAggregates(data).forEach((r) => s4.addRow(r));
  s4.getRow(1).font = { bold: true };

  // ─── 시트 5: 주관식_응답 ──────────────────────
  const s5 = wb.addWorksheet('주관식_응답');
  s5.columns = [
    { header: 'announcement_id', key: 'announcement_id', width: 24 },
    { header: 'question_index', key: 'question_index', width: 14 },
    { header: 'question_text', key: 'question_text', width: 40 },
    { header: 'respondent_uid', key: 'respondent_uid', width: 30 },
    { header: 'respondent_student_number', key: 'respondent_student_number', width: 22 },
    { header: 'respondent_name', key: 'respondent_name', width: 15 },
    { header: 'respondent_nickname', key: 'respondent_nickname', width: 18 },
    { header: 'answer_text', key: 'answer_text', width: 80 },
    { header: 'answer_length', key: 'answer_length', width: 14 },
    { header: 'response_created_at', key: 'response_created_at', width: 24 },
    { header: 'response_updated_at', key: 'response_updated_at', width: 24 },
    { header: 'was_edited', key: 'was_edited', width: 12 },
  ];
  buildTextRows(data).forEach((r) => s5.addRow(r));
  s5.getRow(1).font = { bold: true };
  // 긴 답변 wrap
  s5.getColumn(8).alignment = { wrapText: true, vertical: 'top' };
  // 행 높이 자동
  for (let i = 2; i <= s5.rowCount; i++) {
    s5.getRow(i).alignment = { wrapText: true, vertical: 'top' };
  }
  if (s5.rowCount > 1) {
    s5.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 12 } };
  }

  // ─── 시트 6: 응답자_매트릭스(wide) ─────────────
  const s6 = wb.addWorksheet('응답자_매트릭스');
  const matrix = buildMatrixRows(data);
  s6.columns = matrix.columns.map((key) => ({
    header: key,
    key,
    width: key.startsWith('q') ? 40 : 22,
  }));
  matrix.rows.forEach((r) => s6.addRow(r));
  s6.getRow(1).font = { bold: true };
  for (let i = 2; i <= s6.rowCount; i++) {
    s6.getRow(i).alignment = { wrapText: true, vertical: 'top' };
  }
  if (s6.rowCount > 1) {
    s6.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: matrix.columns.length },
    };
  }

  // 다운로드
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, `${baseFilename(data)}.xlsx`);
}

// ─── CSV ZIP 내보내기 ───────────────────────────────────

/** 배열을 CSV 문자열로 변환 (RFC 4180 준수) */
function toCSV(columns: string[], rows: Array<Record<string, unknown>>): string {
  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    let s = String(val);
    // CRLF → LF 정규화 (셀 내부)
    s = s.replace(/\r\n/g, '\n');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      s = `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = columns.join(',');
  const body = rows
    .map((r) => columns.map((c) => escape(r[c])).join(','))
    .join('\r\n');
  return body ? `${header}\r\n${body}` : header;
}

/** UTF-8 BOM — 엑셀이 CSV 읽을 때 한글 깨짐 방지 */
const BOM = '\uFEFF';

export async function exportSurveyToCSVZip(data: SurveyExportData): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  // 개요
  const overview: Array<Record<string, unknown>> = [
    { key: 'announcement_id', value: data.announcementId },
    { key: 'announcement_content', value: data.announcementContent },
    { key: 'announcement_created_at', value: data.announcementCreatedAt?.toISOString() || '' },
    { key: 'course_name', value: data.courseName || '' },
    { key: 'poll_count', value: data.polls.length },
    { key: 'unique_respondent_count', value: getUniqueRespondents(data.polls).size },
    { key: 'exported_at', value: new Date().toISOString() },
  ];
  zip.file('00_overview.csv', BOM + toCSV(['key', 'value'], overview));

  // 질문 목록
  const qs = buildQuestionRows(data);
  zip.file(
    '01_questions.csv',
    BOM +
      toCSV(
        ['question_index', 'question_type', 'question_text', 'option_count', 'allow_multiple', 'response_count'],
        qs as unknown as Array<Record<string, unknown>>
      )
  );

  // 객관식 long
  const choiceLong = buildChoiceRows(data);
  zip.file(
    '02_choice_responses_long.csv',
    BOM +
      toCSV(
        [
          'announcement_id',
          'question_index',
          'question_text',
          'allow_multiple',
          'respondent_uid',
          'respondent_student_number',
          'respondent_name',
          'respondent_nickname',
          'selected_option_index',
          'selected_option_text',
        ],
        choiceLong as unknown as Array<Record<string, unknown>>
      )
  );

  // 객관식 집계
  const choiceAgg = buildChoiceAggregates(data);
  zip.file(
    '03_choice_aggregates.csv',
    BOM +
      toCSV(
        [
          'announcement_id',
          'question_index',
          'question_text',
          'option_index',
          'option_text',
          'voter_count',
          'total_voters',
          'percentage',
        ],
        choiceAgg as unknown as Array<Record<string, unknown>>
      )
  );

  // 주관식
  const textRows = buildTextRows(data);
  zip.file(
    '04_text_responses.csv',
    BOM +
      toCSV(
        [
          'announcement_id',
          'question_index',
          'question_text',
          'respondent_uid',
          'respondent_student_number',
          'respondent_name',
          'respondent_nickname',
          'answer_text',
          'answer_length',
          'response_created_at',
          'response_updated_at',
          'was_edited',
        ],
        textRows as unknown as Array<Record<string, unknown>>
      )
  );

  // 응답자 매트릭스
  const matrix = buildMatrixRows(data);
  zip.file(
    '05_respondent_matrix.csv',
    BOM + toCSV(matrix.columns, matrix.rows as unknown as Array<Record<string, unknown>>)
  );

  // README
  const readme = `RabbiTory 설문 결과 데이터셋
=====================================

파일 목록:
- 00_overview.csv           : 설문 메타 정보
- 01_questions.csv          : 질문 목록 (질문 인덱스, 타입, 본문)
- 02_choice_responses_long.csv : 객관식 응답 (long format, SPSS/R import 권장)
- 03_choice_aggregates.csv  : 객관식 선지별 집계 + 퍼센트
- 04_text_responses.csv     : 주관식 응답 전문 + 글자수/수정여부
- 05_respondent_matrix.csv  : 응답자 × 질문 wide format (한 학생의 전체 응답 한 행)

공통 컬럼:
- announcement_id        : 공지 ID (데이터 조인용)
- question_index         : 질문 번호 (1-indexed)
- respondent_uid         : Firebase Auth UID
- respondent_student_number : 학번
- respondent_name        : 이름
- respondent_nickname    : 닉네임
- selected_option_index  : 선택한 선지 번호 (1-indexed, 복수선택은 long format에서 여러 행)
- selected_option_text   : 선택한 선지 텍스트
- answer_text            : 주관식 답변 원문
- response_created_at    : ISO 8601 타임스탬프
- response_updated_at    : ISO 8601 타임스탬프

인코딩: UTF-8 with BOM (엑셀에서 한글 깨짐 방지)
구분자: 쉼표 (,)
줄바꿈: CRLF

R:     read.csv("02_choice_responses_long.csv", fileEncoding = "UTF-8-BOM")
Python: pd.read_csv("02_choice_responses_long.csv", encoding="utf-8-sig")
`;
  zip.file('README.txt', readme);

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `${baseFilename(data)}.zip`);
}
