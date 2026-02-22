/**
 * 학생 등록 컴포넌트
 *
 * 3가지 등록 방식:
 * 1. 엑셀 업로드 (exceljs)
 * 2. 직접 입력 (1명씩)
 * 3. 텍스트 붙여넣기 (탭/쉼표 구분)
 */

'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

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

type TabType = 'excel' | 'manual' | 'paste';

interface Props {
  courseId: string;
  onClose: () => void;
  onComplete: () => void;
}

export default function StudentEnrollment({ courseId, onClose, onComplete }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('excel');
  const [previewRows, setPreviewRows] = useState<StudentRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<EnrollResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 직접 입력 상태
  const [manualName, setManualName] = useState('');
  const [manualStudentId, setManualStudentId] = useState('');

  // 텍스트 붙여넣기 상태
  const [pasteText, setPasteText] = useState('');

  // ============================================
  // 엑셀 업로드 처리
  // ============================================

  const handleExcelUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setPreviewRows([]);

    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const buffer = await file.arrayBuffer();
      await workbook.xlsx.load(buffer);

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        setError('시트를 찾을 수 없습니다.');
        return;
      }

      const rows: StudentRow[] = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // 헤더 스킵

        const name = String(row.getCell(1).value || '').trim();
        const studentId = String(row.getCell(2).value || '').trim();

        if (name && studentId) {
          rows.push({ name, studentId });
        }
      });

      if (rows.length === 0) {
        setError('유효한 데이터가 없습니다. 컬럼: 이름, 학번');
        return;
      }

      setPreviewRows(rows);
    } catch (err) {
      console.error('엑셀 파싱 실패:', err);
      setError('엑셀 파일을 읽을 수 없습니다.');
    }
  }, []);

  // ============================================
  // 직접 입력 처리
  // ============================================

  const handleManualAdd = useCallback(() => {
    if (!manualName || !manualStudentId) {
      setError('이름과 학번을 입력해주세요.');
      return;
    }

    setPreviewRows(prev => [
      ...prev,
      { name: manualName, studentId: manualStudentId },
    ]);

    setManualName('');
    setManualStudentId('');
    setError(null);
  }, [manualName, manualStudentId]);

  // ============================================
  // 텍스트 붙여넣기 처리
  // ============================================

  const handleParse = useCallback(() => {
    if (!pasteText.trim()) {
      setError('텍스트를 입력해주세요.');
      return;
    }

    const lines = pasteText.trim().split('\n');
    const rows: StudentRow[] = [];

    for (const line of lines) {
      // 탭 또는 쉼표로 분리
      const parts = line.includes('\t')
        ? line.split('\t')
        : line.split(',');

      const name = parts[0]?.trim();
      const studentId = parts[1]?.trim();

      if (name && studentId) {
        rows.push({ name, studentId });
      }
    }

    if (rows.length === 0) {
      setError('유효한 데이터가 없습니다. 형식: 이름, 학번');
      return;
    }

    setPreviewRows(rows);
    setError(null);
  }, [pasteText]);

  // ============================================
  // 등록 실행 (CF 호출)
  // ============================================

  const handleEnroll = useCallback(async () => {
    if (previewRows.length === 0) {
      setError('등록할 학생이 없습니다.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const bulkEnrollFn = httpsCallable<
        { courseId: string; students: StudentRow[] },
        EnrollResult
      >(functions, 'bulkEnrollStudents');

      const response = await bulkEnrollFn({
        courseId,
        students: previewRows,
      });

      setResult(response.data);
    } catch (err: unknown) {
      const firebaseError = err as { message?: string };
      setError(firebaseError.message || '등록에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  }, [previewRows, courseId]);

  // 미리보기에서 행 삭제
  const removeRow = useCallback((index: number) => {
    setPreviewRows(prev => prev.filter((_, i) => i !== index));
  }, []);

  const tabs: { key: TabType; label: string }[] = [
    { key: 'excel', label: '엑셀' },
    { key: 'manual', label: '직접 입력' },
    { key: 'paste', label: '텍스트' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#FDFBF7] border-2 border-[#1A1A1A]"
      >
        {/* 헤더 */}
        <div className="sticky top-0 z-10 bg-[#1A1A1A] text-[#F5F0E8] px-4 py-3 flex items-center justify-between">
          <h2 className="font-bold">학생 등록</h2>
          <button onClick={onClose} className="text-[#F5F0E8]/70 hover:text-[#F5F0E8]">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 결과 표시 */}
        {result ? (
          <div className="p-4 space-y-4">
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto mb-3 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-[#1A1A1A]">등록 완료</h3>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between px-3 py-2 bg-green-50 border border-green-200">
                <span>성공</span>
                <span className="font-bold text-green-700">{result.successCount}명</span>
              </div>
              {result.duplicateCount > 0 && (
                <div className="flex justify-between px-3 py-2 bg-yellow-50 border border-yellow-200">
                  <span>중복 (스킵)</span>
                  <span className="font-bold text-yellow-700">{result.duplicateCount}명</span>
                </div>
              )}
              {result.errorCount > 0 && (
                <div className="px-3 py-2 bg-red-50 border border-red-200">
                  <div className="flex justify-between">
                    <span>오류</span>
                    <span className="font-bold text-red-700">{result.errorCount}건</span>
                  </div>
                  {result.errors.length > 0 && (
                    <ul className="mt-2 text-xs text-red-600 space-y-1">
                      {result.errors.map((e, i) => (
                        <li key={i}>• {e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => {
                onComplete();
                onClose();
              }}
              className="w-full py-2.5 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-sm"
            >
              확인
            </button>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* 탭 */}
            <div className="flex border-2 border-[#1A1A1A]">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key);
                    setPreviewRows([]);
                    setError(null);
                  }}
                  className={`flex-1 py-2 text-xs font-bold transition-colors ${
                    activeTab === tab.key
                      ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                      : 'bg-[#FDFBF7] text-[#1A1A1A] hover:bg-[#EBE5D9]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* 에러 */}
            {error && (
              <div className="p-2 border border-red-300 bg-red-50 text-xs text-red-700">
                {error}
              </div>
            )}

            {/* 엑셀 탭 */}
            {activeTab === 'excel' && (
              <div className="space-y-3">
                <p className="text-xs text-[#5C5C5C]">
                  엑셀 파일 (xlsx)을 업로드하세요. 컬럼: 이름, 학번
                </p>
                <label className="block">
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleExcelUpload}
                    className="block w-full text-xs text-[#5C5C5C] file:mr-2 file:py-2 file:px-4 file:border file:border-[#1A1A1A] file:text-xs file:font-bold file:bg-[#FDFBF7] file:text-[#1A1A1A] hover:file:bg-[#EBE5D9]"
                  />
                </label>
              </div>
            )}

            {/* 직접 입력 탭 */}
            {activeTab === 'manual' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="이름"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    className="px-2 py-2 border border-[#D4CFC4] text-sm bg-white focus:outline-none focus:border-[#1A1A1A]"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="학번"
                    value={manualStudentId}
                    onChange={(e) => setManualStudentId(e.target.value.replace(/\D/g, ''))}
                    maxLength={10}
                    className="px-2 py-2 border border-[#D4CFC4] text-sm bg-white focus:outline-none focus:border-[#1A1A1A]"
                  />
                </div>
                <button
                  onClick={handleManualAdd}
                  className="w-full py-2 border-2 border-[#1A1A1A] text-sm font-bold hover:bg-[#EBE5D9] transition-colors"
                >
                  + 추가
                </button>
              </div>
            )}

            {/* 텍스트 붙여넣기 탭 */}
            {activeTab === 'paste' && (
              <div className="space-y-3">
                <p className="text-xs text-[#5C5C5C]">
                  이름, 학번을 탭 또는 쉼표로 구분하여 입력하세요 (한 줄에 한 명)
                </p>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="홍길동	25010501&#10;김철수	25010502"
                  rows={5}
                  className="w-full px-3 py-2 border border-[#D4CFC4] text-sm bg-white focus:outline-none focus:border-[#1A1A1A] resize-none"
                />
                <button
                  onClick={handleParse}
                  className="w-full py-2 border-2 border-[#1A1A1A] text-sm font-bold hover:bg-[#EBE5D9] transition-colors"
                >
                  파싱
                </button>
              </div>
            )}

            {/* 미리보기 테이블 */}
            {previewRows.length > 0 && (
              <div className="border-2 border-[#1A1A1A]">
                <div className="bg-[#1A1A1A] text-[#F5F0E8] px-3 py-1.5 text-xs font-bold">
                  미리보기 ({previewRows.length}명)
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#D4CFC4] bg-[#EBE5D9]">
                        <th className="px-2 py-1.5 text-left font-bold">이름</th>
                        <th className="px-2 py-1.5 text-left font-bold">학번</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="border-b border-[#D4CFC4] last:border-b-0">
                          <td className="px-2 py-1.5">{row.name}</td>
                          <td className="px-2 py-1.5">{row.studentId}</td>
                          <td className="px-1 py-1.5">
                            <button
                              onClick={() => removeRow(i)}
                              className="text-red-500 hover:text-red-700"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 등록 버튼 */}
            {previewRows.length > 0 && (
              <button
                onClick={handleEnroll}
                disabled={isSubmitting}
                className="w-full py-2.5 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-sm disabled:opacity-50"
              >
                {isSubmitting ? '등록 중...' : `${previewRows.length}명 등록하기`}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
