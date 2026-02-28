/**
 * 학생 등록 컴포넌트
 *
 * 3가지 등록 방식:
 * 1. 엑셀 업로드 (exceljs)
 * 2. 직접 입력 (1명씩)
 * 3. 텍스트 붙여넣기 (탭/쉼표 구분)
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
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

type TabType = 'excel' | 'manual';

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

  // 네비게이션 숨김
  useEffect(() => {
    document.body.setAttribute('data-hide-nav', '');
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, []);

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
  ];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs max-h-[70vh] overflow-y-auto bg-[#F5F0E8] border-2 border-[#1A1A1A] rounded-2xl p-5"
      >
        {/* 결과 표시 */}
        {result ? (
          <div className="text-center">
            {/* 완료 아이콘 */}
            <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center border-2 border-[#1D5D4A] bg-[#E8F5E9] rounded-full">
              <svg className="w-6 h-6 text-[#1D5D4A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h3 className="text-lg font-bold text-[#1A1A1A] mb-4">등록 완료</h3>

            <div className="space-y-2 text-sm mb-6 text-left">
              <div className="flex justify-between px-3 py-2 border border-[#D4CFC4]">
                <span className="text-[#5C5C5C]">성공</span>
                <span className="font-bold text-[#1D5D4A]">{result.successCount}명</span>
              </div>
              {result.duplicateCount > 0 && (
                <div className="flex justify-between px-3 py-2 border border-[#D4CFC4]">
                  <span className="text-[#5C5C5C]">중복 (스킵)</span>
                  <span className="font-bold text-[#B8860B]">{result.duplicateCount}명</span>
                </div>
              )}
              {result.errorCount > 0 && (
                <div className="px-3 py-2 border border-[#8B1A1A]">
                  <div className="flex justify-between">
                    <span className="text-[#5C5C5C]">오류</span>
                    <span className="font-bold text-[#8B1A1A]">{result.errorCount}건</span>
                  </div>
                  {result.errors.length > 0 && (
                    <ul className="mt-2 text-xs text-[#8B1A1A] space-y-1">
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
              className="w-full py-3 font-bold border-2 border-[#1A1A1A] rounded-lg text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
            >
              확인
            </button>
          </div>
        ) : (
          <>
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-[#1A1A1A]">학생 등록</h2>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center border-2 border-[#1A1A1A] rounded-lg hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 탭 */}
            <div className="flex border-2 border-[#1A1A1A] mb-4">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key);
                    setPreviewRows([]);
                    setError(null);
                  }}
                  className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                    activeTab === tab.key
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
              <div className="p-3 mb-4 border-2 border-[#8B1A1A] text-sm text-[#8B1A1A]">
                {error}
              </div>
            )}

            {/* 엑셀 탭 */}
            {activeTab === 'excel' && (
              <div className="space-y-3">
                <p className="text-sm text-[#5C5C5C]">
                  엑셀 파일 (.xlsx)을 업로드하세요.
                  <br />컬럼: 이름, 학번
                </p>
                <label className="block">
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleExcelUpload}
                    className="block w-full text-sm text-[#5C5C5C]
                      file:mr-3 file:py-2.5 file:px-4
                      file:border-2 file:border-[#1A1A1A]
                      file:text-sm file:font-bold
                      file:bg-[#F5F0E8] file:text-[#1A1A1A]
                      hover:file:bg-[#EBE5D9]"
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
                    className="px-3 py-2.5 border-2 border-[#1A1A1A] rounded-lg text-sm bg-[#F5F0E8] placeholder-[#5C5C5C] focus:outline-none"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="학번"
                    value={manualStudentId}
                    onChange={(e) => setManualStudentId(e.target.value.replace(/\D/g, ''))}
                    maxLength={10}
                    className="px-3 py-2.5 border-2 border-[#1A1A1A] rounded-lg text-sm bg-[#F5F0E8] placeholder-[#5C5C5C] focus:outline-none"
                  />
                </div>
                <button
                  onClick={handleManualAdd}
                  className="w-full py-2.5 border-2 border-[#1A1A1A] rounded-lg text-sm font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                >
                  + 추가
                </button>
              </div>
            )}

            {/* 미리보기 테이블 */}
            {previewRows.length > 0 && (
              <div className="border-2 border-[#1A1A1A] mt-4">
                <div className="bg-[#1A1A1A] text-[#F5F0E8] px-3 py-2 text-sm font-bold">
                  미리보기 ({previewRows.length}명)
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-[#1A1A1A] bg-[#EBE5D9]">
                        <th className="px-3 py-2 text-left font-bold">이름</th>
                        <th className="px-3 py-2 text-left font-bold">학번</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="border-b border-[#D4CFC4] last:border-b-0">
                          <td className="px-3 py-2">{row.name}</td>
                          <td className="px-3 py-2">{row.studentId}</td>
                          <td className="px-2 py-2">
                            <button
                              onClick={() => removeRow(i)}
                              className="text-[#8B1A1A] hover:text-[#6B1414]"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

            {/* 등록 / 취소 버튼 */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={onClose}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] rounded-lg text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                취소
              </button>
              {previewRows.length > 0 ? (
                <button
                  onClick={handleEnroll}
                  disabled={isSubmitting}
                  className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] rounded-lg bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? '등록 중...' : `${previewRows.length}명 등록`}
                </button>
              ) : (
                <button
                  disabled
                  className="flex-1 py-3 font-bold border-2 border-[#D4CFC4] rounded-lg text-[#D4CFC4] cursor-not-allowed"
                >
                  등록
                </button>
              )}
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
