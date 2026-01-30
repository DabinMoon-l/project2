'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { Button, Input } from '@/components/common';
import StepIndicator, { ONBOARDING_STEPS } from '@/components/onboarding/StepIndicator';
import { useTheme } from '@/styles/themes/useTheme';
import type { ClassType } from '@/styles/themes';

/**
 * 학적정보 폼 데이터 타입
 */
interface StudentInfoFormData {
  studentId: string;    // 학번
  grade: string;        // 학년
  classType: ClassType; // 반 (A/B/C/D)
}

/**
 * 폼 에러 타입
 */
interface FormErrors {
  studentId?: string;
  grade?: string;
  classType?: string;
}

// 학년 옵션
const GRADE_OPTIONS = ['1학년', '2학년'];

// 반 옵션 (원래 배경색 사용)
const CLASS_OPTIONS: { value: ClassType; label: string; color: string }[] = [
  { value: 'A', label: 'A반', color: '#4A0E0E' },  // 버건디 (빨간색)
  { value: 'B', label: 'B반', color: '#3D2B1F' },  // 다크 브라운
  { value: 'C', label: 'C반', color: '#0D3D2E' },  // 에메랄드
  { value: 'D', label: 'D반', color: '#0E1927' },  // 다크 네이비
];

/**
 * 학적정보 입력 페이지
 * 온보딩 1단계: 학번, 학년, 반, 전공 입력
 */
export default function StudentInfoPage() {
  const router = useRouter();
  const { setClassType } = useTheme();

  // 폼 상태
  const [formData, setFormData] = useState<StudentInfoFormData>({
    studentId: '',
    grade: '',
    classType: 'A',
  });

  // 에러 상태
  const [errors, setErrors] = useState<FormErrors>({});

  // 로딩 상태
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 페이지 로드 시 A반 테마 적용
  useEffect(() => {
    setClassType('A');
  }, [setClassType]);

  /**
   * 입력값 변경 핸들러
   */
  const handleInputChange = useCallback(
    (field: keyof StudentInfoFormData, value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      // 입력 시 해당 필드 에러 제거
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    },
    []
  );

  /**
   * 반 선택 핸들러
   */
  const handleClassSelect = useCallback(
    (classType: ClassType) => {
      setFormData((prev) => ({ ...prev, classType }));
      setClassType(classType); // 테마 즉시 적용
      setErrors((prev) => ({ ...prev, classType: undefined }));
    },
    [setClassType]
  );

  /**
   * 폼 유효성 검사
   */
  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    // 학번 검사 (숫자만, 7-10자리)
    if (!formData.studentId) {
      newErrors.studentId = '학번을 입력해주세요';
    } else if (!/^\d{7,10}$/.test(formData.studentId)) {
      newErrors.studentId = '학번은 7-10자리 숫자입니다';
    }

    // 학년 검사
    if (!formData.grade) {
      newErrors.grade = '학년을 선택해주세요';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  /**
   * 폼 제출 핸들러
   */
  const handleSubmit = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      // 현재 로그인된 사용자 확인
      const user = auth.currentUser;

      if (user) {
        // Firestore에 학적정보 저장
        await setDoc(
          doc(db, 'users', user.uid),
          {
            studentId: formData.studentId,
            grade: formData.grade,
            classType: formData.classType,
            onboardingStep: 2, // 다음 단계로 표시
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        // 로그인되지 않은 경우 로컬 스토리지에 임시 저장
        localStorage.setItem('onboarding_student_info', JSON.stringify(formData));
      }

      // 다음 단계로 이동
      router.push(ONBOARDING_STEPS[1].path);
    } catch (error) {
      console.error('학적정보 저장 실패:', error);
      alert('저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 페이지 전환 애니메이션 설정
   */
  const pageVariants = {
    initial: { opacity: 0, x: 50 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -50 },
  };

  return (
    <motion.div
      className="min-h-screen bg-[var(--theme-background)] flex flex-col"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.3 }}
    >
      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-[var(--theme-background)]/95 backdrop-blur-sm border-b border-[var(--theme-border)] px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={async () => {
              // 로그아웃 후 로그인 페이지로 이동
              await signOut(auth);
              router.replace('/login');
            }}
            className="p-2 -ml-2 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)]"
            aria-label="뒤로가기"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-[var(--theme-text)]">학적정보 입력</h1>
          <div className="w-10" /> {/* 균형을 위한 빈 공간 */}
        </div>
        <StepIndicator currentStep={1} />
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 px-4 py-6 overflow-y-auto">
        <motion.div
          className="max-w-md mx-auto space-y-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          {/* 안내 문구 */}
          <div className="text-center mb-8">
            <h2 className="text-xl font-bold text-[var(--theme-text)] mb-2">
              학적정보를 입력해주세요
            </h2>
            <p className="text-sm text-[var(--theme-text-secondary)]">
              입력하신 정보는 퀴즈 활동에 사용됩니다
            </p>
          </div>

          {/* 학번 입력 */}
          <div>
            <label className="block text-sm font-medium text-[var(--theme-text)] mb-2">
              학번 *
            </label>
            <Input
              type="text"
              inputMode="numeric"
              placeholder="학번을 입력하세요 (예: 25010501)"
              value={formData.studentId}
              onChange={(e) => handleInputChange('studentId', e.target.value)}
              error={errors.studentId}
              maxLength={10}
            />
          </div>

          {/* 학년 선택 */}
          <div>
            <label className="block text-sm font-medium text-[var(--theme-text)] mb-2">
              학년 *
            </label>
            <div className="grid grid-cols-2 gap-3">
              {GRADE_OPTIONS.map((grade) => (
                <motion.button
                  key={grade}
                  type="button"
                  onClick={() => handleInputChange('grade', grade)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`
                    px-4 py-3 rounded-xl text-sm font-medium
                    transition-all duration-200
                    ${
                      formData.grade === grade
                        ? 'bg-[var(--theme-accent)] text-white shadow-lg'
                        : 'bg-white/10 text-[var(--theme-text)] border border-[var(--theme-border)] hover:bg-white/20'
                    }
                  `}
                >
                  {grade}
                </motion.button>
              ))}
            </div>
            {errors.grade && (
              <p className="mt-1.5 text-sm text-red-500 flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                {errors.grade}
              </p>
            )}
          </div>

          {/* 반 선택 */}
          <div>
            <label className="block text-sm font-medium text-[var(--theme-text)] mb-2">
              반 선택 *
            </label>
            <div className="grid grid-cols-4 gap-3">
              <AnimatePresence>
                {CLASS_OPTIONS.map((option) => (
                  <motion.button
                    key={option.value}
                    type="button"
                    onClick={() => handleClassSelect(option.value)}
                    layout
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`
                      relative flex flex-col items-center justify-center
                      p-4 rounded-2xl
                      transition-all duration-300
                      ${
                        formData.classType === option.value
                          ? 'bg-[var(--theme-accent)] text-white shadow-xl ring-2 ring-[var(--theme-accent)] ring-offset-2 ring-offset-[var(--theme-background)]'
                          : 'bg-white/10 text-[var(--theme-text)] border border-[var(--theme-border)] hover:bg-white/20'
                      }
                    `}
                  >
                    {/* 선택 체크 아이콘 */}
                    {formData.classType === option.value && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center"
                      >
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </motion.div>
                    )}

                    {/* 반 컬러 인디케이터 */}
                    <div
                      className="w-8 h-8 rounded-full mb-2 shadow-inner"
                      style={{ backgroundColor: option.color }}
                    />
                    <span className="text-lg font-bold">{option.label}</span>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
            {errors.classType && (
              <p className="mt-1.5 text-sm text-red-500">{errors.classType}</p>
            )}
          </div>

        </motion.div>
      </main>

      {/* 하단 버튼 영역 */}
      <footer className="sticky bottom-0 bg-[var(--theme-background)]/95 backdrop-blur-sm border-t border-[var(--theme-border)] px-4 py-4 safe-area-pb">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Button
            onClick={handleSubmit}
            loading={isSubmitting}
            fullWidth
            size="lg"
            className="bg-white hover:bg-gray-100 text-black"
          >
            다음 단계로
          </Button>
        </motion.div>
      </footer>
    </motion.div>
  );
}
