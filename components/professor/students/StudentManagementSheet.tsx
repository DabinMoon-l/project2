'use client';

/**
 * 학생 관리 바텀시트
 *
 * 가입률 도넛 차트 + 등록 학생 목록/삭제 + 학생 추가(엑셀/학번) + 미가입 학생 서브시트
 */

import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import MobileBottomSheet from '@/components/common/MobileBottomSheet';
import { useEnrolledStudents, type EnrolledStudent } from '@/lib/hooks/useEnrolledStudents';

// ============================================================
// 타입
// ============================================================

interface Props {
  open: boolean;
  onClose: () => void;
  courseId: string;
}

interface StudentRow {
  name: string;
  studentId: string;
}

interface EnrollResult {
  successCount: number;
  duplicateCount: number;
  errorCount: number;
  errors: string[];
}

type TabType = 'excel' | 'manual';

// ============================================================
// 메인 컴포넌트
// ============================================================

export default function StudentManagementSheet({ open, onClose, courseId }: Props) {
  const {
    enrolledStudents,
    loading,
    enrolledCount,
    registeredCount,
    unregisteredStudents,
  } = useEnrolledStudents(open ? courseId : null);

  // 미가입 학생 서브시트
  const [showUnregistered, setShowUnregistered] = useState(false);

  // 삭제 확인 중인 학번
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 학생 추가 상태
  const [addTab, setAddTab] = useState<TabType>('excel');
  const [previewRows, setPreviewRows] = useState<StudentRow[]>([]);
  const [manualStudentId, setManualStudentId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [enrollResult, setEnrollResult] = useState<EnrollResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ============================================================
  // 학생 삭제
  // ============================================================

  const handleDelete = useCallback(async (studentId: string) => {
    setDeleting(true);
    try {
      const removeFn = httpsCallable<
        { courseId: string; studentId: string },
        { success: boolean; wasRegistered: boolean }
      >(functions, 'removeEnrolledStudent');

      await removeFn({ courseId, studentId });
      setConfirmDeleteId(null);
    } catch (err: unknown) {
      const firebaseError = err as { message?: string };
      setError(firebaseError.message || '삭제에 실패했습니다.');
    } finally {
      setDeleting(false);
    }
  }, [courseId]);

  // ============================================================
  // 엑셀 업로드
  // ============================================================

  const handleExcelUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setPreviewRows([]);

    const buffer = await file.arrayBuffer();
    let rows: StudentRow[] = [];

    // 1차: exceljs로 시도
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      const worksheet = workbook.worksheets[0];
      if (worksheet) {
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;

          const cell1 = String(row.getCell(1).value || '').trim();
          const cell2 = String(row.getCell(2).value || '').trim();

          let studentId = '';
          let name = '';
          if (/^\d{7,10}$/.test(cell1)) {
            studentId = cell1;
            name = cell2;
          } else if (/^\d{7,10}$/.test(cell2)) {
            studentId = cell2;
            name = cell1;
          } else {
            return;
          }

          if (studentId) {
            rows.push({ name, studentId });
          }
        });
      }
    } catch {
      // 2차: 한컴 .cell 등 exceljs 호환 안 되는 xlsx 변형 → JSZip 직접 파싱
      try {
        rows = await parseCellWithJSZip(buffer);
      } catch {
        setError('엑셀 파일을 읽을 수 없습니다.');
        return;
      }
    }

    if (rows.length === 0) {
      setError('유효한 데이터가 없습니다. 학번(7-10자리 숫자)이 포함된 열이 필요합니다.');
      return;
    }

    setPreviewRows(rows);
  }, []);

  // ============================================================
  // 직접 입력
  // ============================================================

  const handleManualAdd = useCallback(() => {
    if (!manualStudentId) {
      setError('학번을 입력해주세요.');
      return;
    }
    setPreviewRows(prev => [...prev, { name: '', studentId: manualStudentId }]);
    setManualStudentId('');
    setError(null);
  }, [manualStudentId]);

  const removePreviewRow = useCallback((index: number) => {
    setPreviewRows(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ============================================================
  // 등록 실행
  // ============================================================

  const handleEnroll = useCallback(async () => {
    if (previewRows.length === 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const bulkEnrollFn = httpsCallable<
        { courseId: string; students: StudentRow[] },
        EnrollResult
      >(functions, 'bulkEnrollStudents');

      const response = await bulkEnrollFn({ courseId, students: previewRows });
      setEnrollResult(response.data);
      setPreviewRows([]);
    } catch (err: unknown) {
      const firebaseError = err as { message?: string };
      setError(firebaseError.message || '등록에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  }, [previewRows, courseId]);

  // ============================================================
  // 도넛 차트 데이터
  // ============================================================

  const registrationPct = enrolledCount > 0
    ? Math.round((registeredCount / enrolledCount) * 100)
    : 0;

  const R = 42;
  const C = 2 * Math.PI * R;
  const registeredLen = (registrationPct / 100) * C;

  return (
    <>
      <MobileBottomSheet open={open} onClose={onClose} maxHeight="85vh">
        <div className="px-5 pb-6">
          {/* 헤더 */}
          <h2 className="text-lg font-bold text-[#1A1A1A] mb-4">학생 관리</h2>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* ======== A. 가입률 도넛 차트 ======== */}
              <div className="flex items-center justify-center gap-6 py-2 mb-4">
                <div className="flex-shrink-0 w-[160px] h-[160px]">
                  <svg width="160" height="160" viewBox="0 0 100 100">
                    <circle
                      cx="50" cy="50" r={R} fill="none"
                      stroke="#1A1A1A" strokeWidth="13" opacity="0.12"
                    />
                    {registrationPct > 0 && (
                      <motion.circle
                        cx="50" cy="50" r={R} fill="none"
                        stroke="#1A1A1A" strokeWidth="13"
                        strokeLinecap="round"
                        transform="rotate(-90 50 50)"
                        initial={{ strokeDasharray: `0 ${C}` }}
                        animate={{ strokeDasharray: `${registeredLen} ${C - registeredLen}` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                      />
                    )}
                    <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
                      className="font-bold text-[16px] fill-[#1A1A1A]">
                      {registrationPct}%
                    </text>
                  </svg>
                </div>

                {/* 범례 */}
                <div className="w-[160px] space-y-2.5">
                  {/* 전체 등록 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full flex-shrink-0 border-2 border-[#1A1A1A] bg-[#1A1A1A]/50" />
                      <span className="text-base font-bold text-[#1A1A1A]">전체 등록</span>
                    </div>
                    <span className="text-2xl font-bold text-[#1A1A1A]">
                      {enrolledCount}<span className="text-sm text-[#5C5C5C] font-normal ml-0.5">명</span>
                    </span>
                  </div>
                  {/* 가입 완료 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-[#1A1A1A] flex-shrink-0" />
                      <span className="text-base font-bold text-[#1A1A1A]">가입 완료</span>
                    </div>
                    <span className="text-2xl font-bold text-[#1A1A1A]">
                      {registeredCount}<span className="text-sm text-[#5C5C5C] font-normal ml-0.5">명</span>
                    </span>
                  </div>
                  {/* 미가입 — 클릭 가능 */}
                  <button
                    onClick={() => unregisteredStudents.length > 0 && setShowUnregistered(true)}
                    className="flex items-center justify-between w-full group"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full border-2 border-[#1A1A1A] bg-[#F5F0E8] flex-shrink-0" />
                      <span className="text-base font-bold text-[#1A1A1A] group-hover:underline">미가입</span>
                    </div>
                    <span className="text-2xl font-bold text-[#1A1A1A]">
                      {enrolledCount - registeredCount}
                      <span className="text-sm text-[#5C5C5C] font-normal ml-0.5">명</span>
                    </span>
                  </button>
                </div>
              </div>

              {/* ======== B. 등록 학생 목록 ======== */}
              <div className="mb-4">
                <h3 className="text-sm font-bold text-[#1A1A1A] mb-2">
                  등록 학생 ({enrolledCount}명)
                </h3>

                {enrolledCount === 0 ? (
                  <p className="text-sm text-[#5C5C5C] text-center py-4">등록된 학생이 없습니다</p>
                ) : (
                  <div className="max-h-[250px] overflow-y-auto border border-[#D4CFC4] rounded-lg">
                    {enrolledStudents.map((student) => (
                      <StudentRow
                        key={student.studentId}
                        student={student}
                        isConfirming={confirmDeleteId === student.studentId}
                        isDeleting={deleting && confirmDeleteId === student.studentId}
                        onDeleteClick={() => setConfirmDeleteId(student.studentId)}
                        onConfirmDelete={() => handleDelete(student.studentId)}
                        onCancelDelete={() => setConfirmDeleteId(null)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* ======== C. 학생 추가 ======== */}
              <div className="border-t border-[#D4CFC4] pt-4">
                <h3 className="text-sm font-bold text-[#1A1A1A] mb-3">학생 추가</h3>

                {/* 등록 결과 표시 */}
                {enrollResult ? (
                  <div className="space-y-2 text-sm mb-3">
                    <div className="flex justify-between px-3 py-2 border border-[#D4CFC4] rounded-lg">
                      <span className="text-[#5C5C5C]">성공</span>
                      <span className="font-bold text-[#1D5D4A]">{enrollResult.successCount}명</span>
                    </div>
                    {enrollResult.duplicateCount > 0 && (
                      <div className="flex justify-between px-3 py-2 border border-[#D4CFC4] rounded-lg">
                        <span className="text-[#5C5C5C]">중복 (스킵)</span>
                        <span className="font-bold text-[#B8860B]">{enrollResult.duplicateCount}명</span>
                      </div>
                    )}
                    {enrollResult.errorCount > 0 && (
                      <div className="px-3 py-2 border border-[#8B1A1A] rounded-lg">
                        <div className="flex justify-between">
                          <span className="text-[#5C5C5C]">오류</span>
                          <span className="font-bold text-[#8B1A1A]">{enrollResult.errorCount}건</span>
                        </div>
                        {enrollResult.errors.length > 0 && (
                          <ul className="mt-2 text-xs text-[#8B1A1A] space-y-1">
                            {enrollResult.errors.map((e, i) => (
                              <li key={i}>• {e}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => setEnrollResult(null)}
                      className="w-full py-2 text-sm font-bold border border-[#D4CFC4] rounded-lg hover:bg-[#EBE5D9] transition-colors"
                    >
                      추가 등록
                    </button>
                  </div>
                ) : (
                  <>
                    {/* 탭 */}
                    <div className="flex border-2 border-[#1A1A1A] rounded-lg mb-3 overflow-hidden">
                      {([
                        { key: 'excel' as TabType, label: '엑셀' },
                        { key: 'manual' as TabType, label: '직접 입력' },
                      ]).map(tab => (
                        <button
                          key={tab.key}
                          onClick={() => {
                            setAddTab(tab.key);
                            setPreviewRows([]);
                            setError(null);
                          }}
                          className={`flex-1 py-2 text-sm font-bold transition-colors ${
                            addTab === tab.key
                              ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                              : 'text-[#1A1A1A] hover:bg-[#EBE5D9]'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* 에러 */}
                    {error && (
                      <div className="p-2 mb-3 border border-[#8B1A1A] rounded-lg text-xs text-[#8B1A1A]">
                        {error}
                      </div>
                    )}

                    {/* 엑셀 탭 */}
                    {addTab === 'excel' && (
                      <div className="space-y-2">
                        <p className="text-xs text-[#5C5C5C]">
                          엑셀 (.xlsx/.cell) — 학번(7-10자리) 컬럼 필요
                        </p>
                        <label className="block">
                          <input
                            type="file"
                            accept=".xlsx,.xls,.cell"
                            onChange={handleExcelUpload}
                            className="block w-full text-xs text-[#5C5C5C]
                              file:mr-2 file:py-2 file:px-3
                              file:border-2 file:border-[#1A1A1A]
                              file:text-xs file:font-bold
                              file:bg-[#F5F0E8] file:text-[#1A1A1A]
                              hover:file:bg-[#EBE5D9]"
                          />
                        </label>
                      </div>
                    )}

                    {/* 직접 입력 탭 */}
                    {addTab === 'manual' && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="학번 (7-10자리)"
                          value={manualStudentId}
                          onChange={(e) => setManualStudentId(e.target.value.replace(/\D/g, ''))}
                          maxLength={10}
                          className="flex-1 px-3 py-2 border-2 border-[#1A1A1A] rounded-lg text-sm bg-[#F5F0E8] placeholder-[#5C5C5C] focus:outline-none"
                          onKeyDown={(e) => e.key === 'Enter' && handleManualAdd()}
                        />
                        <button
                          onClick={handleManualAdd}
                          className="px-3 py-2 border-2 border-[#1A1A1A] rounded-lg text-sm font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                        >
                          +
                        </button>
                      </div>
                    )}

                    {/* 미리보기 */}
                    {previewRows.length > 0 && (
                      <div className="border-2 border-[#1A1A1A] rounded-lg mt-3 overflow-hidden">
                        <div className="bg-[#1A1A1A] text-[#F5F0E8] px-3 py-1.5 text-xs font-bold">
                          미리보기 ({previewRows.length}명)
                        </div>
                        <div className="max-h-32 overflow-y-auto">
                          {previewRows.map((row, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-1.5 border-b border-[#D4CFC4] last:border-b-0 text-xs">
                              <span>{row.studentId}</span>
                              <button
                                onClick={() => removePreviewRow(i)}
                                className="text-[#8B1A1A] hover:text-[#6B1414]"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="p-2">
                          <button
                            onClick={handleEnroll}
                            disabled={isSubmitting}
                            className="w-full py-2 text-sm font-bold border-2 border-[#1A1A1A] rounded-lg bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors disabled:opacity-50"
                          >
                            {isSubmitting ? '등록 중...' : `${previewRows.length}명 등록`}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </MobileBottomSheet>

      {/* ======== D. 미가입 학생 서브시트 ======== */}
      <MobileBottomSheet
        open={showUnregistered}
        onClose={() => setShowUnregistered(false)}
        maxHeight="60vh"
      >
        <div className="px-5 pb-6">
          <h2 className="text-lg font-bold text-[#1A1A1A] mb-4">
            미가입 학생 ({unregisteredStudents.length}명)
          </h2>

          {unregisteredStudents.length === 0 ? (
            <p className="text-sm text-[#5C5C5C] text-center py-4">
              모든 학생이 가입했습니다
            </p>
          ) : (
            <div className="max-h-[400px] overflow-y-auto border border-[#D4CFC4] rounded-lg">
              {/* 헤더 */}
              <div className="flex items-center px-3 py-2 border-b border-[#1A1A1A] bg-[#EBE5D9] text-xs font-bold text-[#1A1A1A]">
                <span className="w-24">학번</span>
                <span className="flex-1">이름</span>
                <span className="w-20 text-right">등록일</span>
              </div>
              {unregisteredStudents.map((student) => (
                <div
                  key={student.studentId}
                  className="flex items-center px-3 py-2 border-b border-[#D4CFC4] last:border-b-0 text-xs"
                >
                  <span className="w-24 font-mono text-[#1A1A1A]">{student.studentId}</span>
                  <span className="flex-1 text-[#5C5C5C]">{student.name || '-'}</span>
                  <span className="w-20 text-right text-[#5C5C5C]">
                    {formatDate(student.enrolledAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </MobileBottomSheet>
    </>
  );
}

// ============================================================
// 등록 학생 행 컴포넌트
// ============================================================

function StudentRow({
  student,
  isConfirming,
  isDeleting,
  onDeleteClick,
  onConfirmDelete,
  onCancelDelete,
}: {
  student: EnrolledStudent;
  isConfirming: boolean;
  isDeleting: boolean;
  onDeleteClick: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  return (
    <div className="flex items-center px-3 py-2 border-b border-[#D4CFC4] last:border-b-0 text-xs">
      <span className="w-20 font-mono text-[#1A1A1A] flex-shrink-0">{student.studentId}</span>
      <span className="flex-1 text-[#5C5C5C] truncate mx-1">{student.name || '-'}</span>

      {/* 상태 */}
      <span className={`flex-shrink-0 mr-2 ${student.isRegistered ? 'text-[#1D5D4A]' : 'text-[#5C5C5C]'}`}>
        {student.isRegistered ? '●가입' : '○미가입'}
      </span>

      {/* 삭제 */}
      {isConfirming ? (
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={onConfirmDelete}
            disabled={isDeleting}
            className="px-2 py-0.5 text-xs font-bold bg-[#8B1A1A] text-white rounded disabled:opacity-50"
          >
            {isDeleting ? '...' : '삭제'}
          </button>
          <button
            onClick={onCancelDelete}
            disabled={isDeleting}
            className="px-2 py-0.5 text-xs font-bold border border-[#D4CFC4] rounded"
          >
            취소
          </button>
        </div>
      ) : (
        <button
          onClick={onDeleteClick}
          className="flex-shrink-0 text-[#8B1A1A] hover:text-[#6B1414]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ============================================================
// 유틸: 날짜 포맷
// ============================================================

function formatDate(date: Date): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${m}/${d}`;
}

// ============================================================
// 유틸: 한컴 .cell 등 exceljs 호환 안 되는 xlsx 변형 파싱
// ============================================================

async function parseCellWithJSZip(buffer: ArrayBuffer): Promise<StudentRow[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);

  // sharedStrings 파싱
  const strings: string[] = [];
  const ssXml = await zip.files['xl/sharedStrings.xml']?.async('text');
  if (ssXml) {
    const tRegex = /<(?:x:)?t[^>]*>([^<]*)<\/(?:x:)?t>/g;
    let m;
    while ((m = tRegex.exec(ssXml)) !== null) strings.push(m[1]);
  }

  // sheet1.xml 파싱
  const wsXml = await zip.files['xl/worksheets/sheet1.xml']?.async('text');
  if (!wsXml) return [];

  const rows: StudentRow[] = [];
  const rowRegex = /<(?:x:)?row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/(?:x:)?row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(wsXml)) !== null) {
    const rowNum = parseInt(rowMatch[1]);
    if (rowNum === 1) continue; // 헤더 스킵

    // 셀 값 추출
    const cellValues: string[] = [];
    const cellRegex = /<(?:x:)?c[^>]*(?:t="([^"]*)")?\s*[^>]*>(?:[\s\S]*?<(?:x:)?v>([^<]*)<\/(?:x:)?v>)?/g;
    let cellMatch;
    const rowContent = rowMatch[2];

    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const type = cellMatch[1];
      const val = cellMatch[2];
      let value = val || '';
      if (type === 's' && val) {
        value = strings[parseInt(val)] || val;
      }
      cellValues.push(value.trim());
    }

    // 학번 자동 감지
    let studentId = '';
    let name = '';
    for (let i = 0; i < cellValues.length; i++) {
      if (/^\d{7,10}$/.test(cellValues[i])) {
        studentId = cellValues[i];
        // 다른 셀에서 이름 찾기
        for (let j = 0; j < cellValues.length; j++) {
          if (j !== i && cellValues[j] && !/^\d+$/.test(cellValues[j])) {
            name = cellValues[j];
            break;
          }
        }
        break;
      }
    }

    if (studentId) {
      rows.push({ name, studentId });
    }
  }

  return rows;
}
