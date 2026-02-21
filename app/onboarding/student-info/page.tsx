'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import StepIndicator, { ONBOARDING_STEPS } from '@/components/onboarding/StepIndicator';
import { useTheme } from '@/styles/themes/useTheme';
import type { ClassType } from '@/styles/themes';
import {
  type CourseId,
  type Semester,
  type SemesterSettings,
  determineCourse,
  getAvailableGrades,
  getCurrentSemesterByDate,
} from '@/lib/types/course';

/**
 * 학적정보 폼 데이터 타입
 */
interface StudentInfoFormData {
  studentId: string;    // 학번
  grade: number | null; // 학년 (숫자)
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

// 반 옵션 (원색 사용)
const CLASS_OPTIONS: { value: ClassType; label: string; color: string }[] = [
  { value: 'A', label: 'A반', color: '#EF4444' },  // 빨강
  { value: 'B', label: 'B반', color: '#EAB308' },  // 노랑
  { value: 'C', label: 'C반', color: '#22C55E' },  // 초록
  { value: 'D', label: 'D반', color: '#3B82F6' },  // 파랑
];

/**
 * 기본 학기 설정
 */
const DEFAULT_SEMESTER_SETTINGS: SemesterSettings = {
  currentYear: new Date().getFullYear(),
  currentSemester: getCurrentSemesterByDate(),
  semesterDates: {
    spring: { start: '03-01', end: '08-31' },
    fall: { start: '09-01', end: '02-28' },
  },
};

/**
 * 학적정보 입력 페이지
 * 온보딩 1단계: 학번, 학년, 반 입력 + 과목 자동 배정
 */
export default function StudentInfoPage() {
  const router = useRouter();
  const { setClassType } = useTheme();

  // 학기 설정
  const [semesterSettings, setSemesterSettings] = useState<SemesterSettings>(DEFAULT_SEMESTER_SETTINGS);
  const [loadingSettings, setLoadingSettings] = useState(true);

  // 폼 상태
  const [formData, setFormData] = useState<StudentInfoFormData>({
    studentId: '',
    grade: null,
    classType: 'A',
  });

  // 에러 상태
  const [errors, setErrors] = useState<FormErrors>({});

  // 로딩 상태
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 학기 설정 로드
  useEffect(() => {
    const loadSemesterSettings = async () => {
      try {
        const settingsRef = doc(db, 'settings', 'semester');
        const snapshot = await getDoc(settingsRef);

        if (snapshot.exists()) {
          setSemesterSettings(snapshot.data() as SemesterSettings);
        } else {
          // 설정이 없으면 기본값 생성 시도
          try {
            await setDoc(settingsRef, DEFAULT_SEMESTER_SETTINGS);
          } catch (err) {
            console.log('학기 설정 생성 실패 (권한 없음), 기본값 사용');
          }
        }
      } catch (err) {
        console.error('학기 설정 로드 실패:', err);
      } finally {
        setLoadingSettings(false);
      }
    };

    loadSemesterSettings();
  }, []);

  // 페이지 로드 시 A반 테마 적용 (마운트 시 1회만)
  useEffect(() => {
    setClassType('A');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 선택 가능한 학년 목록
  const availableGrades = getAvailableGrades(semesterSettings.currentSemester);

  // 현재 선택된 과목
  const selectedCourse = formData.grade
    ? determineCourse(formData.grade, semesterSettings.currentSemester)
    : null;

  /**
   * 입력값 변경 핸들러
   */
  const handleInputChange = useCallback(
    (field: keyof StudentInfoFormData, value: string | number | null) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
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
      setClassType(classType);
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
  const handleSubmit = () => {
    if (!validateForm() || !selectedCourse) return;

    // 바로 다음 페이지로 이동
    router.push(ONBOARDING_STEPS[1].path);

    // Firestore 저장은 백그라운드로 처리
    const user = auth.currentUser;
    if (user) {
      setDoc(
        doc(db, 'users', user.uid),
        {
          email: user.email,
          studentId: formData.studentId,
          grade: formData.grade,
          semester: semesterSettings.currentSemester,
          classId: formData.classType,
          courseId: selectedCourse.courseId,
          onboardingStep: 2,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch((error) => console.error('학적정보 저장 실패:', error));
    } else {
      localStorage.setItem('onboarding_student_info', JSON.stringify({
        ...formData,
        courseId: selectedCourse.courseId,
        semester: semesterSettings.currentSemester,
      }));
    }
  };

  /**
   * 페이지 전환 애니메이션 설정
   */
  const pageVariants = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  };

  // 로딩 중
  if (loadingSettings) {
    return (
      <div className="min-h-screen flex items-center justify-center relative">
        {/* 비디오 배경 */}
        <div className="fixed inset-0 overflow-hidden">
          <video
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          >
            <source src="/videos/login-bg.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-black/30" />
        </div>
        <div className="text-center relative z-10">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-white/70">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="min-h-screen flex flex-col relative"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.15 }}
    >
      {/* 비디오 배경 */}
      <div className="fixed inset-0 overflow-hidden">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/videos/login-bg.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/30" />
      </div>

      {/* 헤더 */}
      <header className="sticky top-0 z-20 px-4 py-3 relative">
        <div className="flex items-center justify-between">
          <button
            onClick={async () => {
              await signOut(auth);
              router.replace('/login');
            }}
            className="p-2 -ml-2 text-white/70 hover:text-white"
            aria-label="뒤로가기"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-white drop-shadow-md">학적정보 입력</h1>
          <div className="w-10" />
        </div>
        <StepIndicator currentStep={1} />
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 px-4 pt-0 pb-6 overflow-y-auto relative z-10 flex items-start justify-center">
        <motion.div
          className="max-w-md w-full space-y-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          {/* 안내 문구 */}
          <div className="text-center mb-8">
            <h2 className="text-xl font-bold text-white mb-2 drop-shadow-md">
              학적정보를 입력해주세요
            </h2>
            <p className="text-sm text-white/70">
              입력하신 정보로 수강 과목이 자동 배정됩니다
            </p>
          </div>

          {/* 현재 학기 표시 */}
          <div className="bg-white/10 border border-white/30 rounded-xl p-3 text-center">
            <p className="text-sm text-white/70">
              현재 학기: <span className="font-bold text-white">
                {semesterSettings.currentYear}년 {semesterSettings.currentSemester}학기
              </span>
            </p>
          </div>

          {/* 학번 입력 */}
          <div>
            <label className="block text-sm font-medium text-white mb-2 drop-shadow-sm">
              학번 *
            </label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="학번을 입력하세요 (예: 25010501)"
              value={formData.studentId}
              onChange={(e) => handleInputChange('studentId', e.target.value)}
              maxLength={10}
              className="w-full px-4 py-3 bg-white/10 border border-white/30 text-white placeholder-white/50 rounded-xl focus:outline-none focus:border-white/60"
            />
            {errors.studentId && (
              <p className="mt-1.5 text-sm text-red-400 flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                {errors.studentId}
              </p>
            )}
          </div>

          {/* 학년 선택 */}
          <div>
            <label className="block text-sm font-medium text-white mb-2 drop-shadow-sm">
              학년 * {semesterSettings.currentSemester === 2 && (
                <span className="text-xs text-white/60">
                  (2학기에는 1학년만 선택 가능)
                </span>
              )}
            </label>
            <div className="grid grid-cols-2 gap-3">
              {[1, 2].map((grade) => {
                const isAvailable = availableGrades.includes(grade);
                return (
                  <motion.button
                    key={grade}
                    type="button"
                    onClick={() => isAvailable && handleInputChange('grade', grade)}
                    disabled={!isAvailable}
                    whileHover={isAvailable ? { scale: 1.02 } : {}}
                    whileTap={isAvailable ? { scale: 0.98 } : {}}
                    className={`
                      px-4 py-3 rounded-xl text-sm font-medium
                      transition-all duration-200
                      ${!isAvailable
                        ? 'bg-white/5 text-white/30 cursor-not-allowed'
                        : formData.grade === grade
                          ? 'bg-white text-black shadow-lg'
                          : 'bg-white/10 text-white border border-white/30 hover:bg-white/20'
                      }
                    `}
                  >
                    {grade}학년
                    {!isAvailable && ' (선택 불가)'}
                  </motion.button>
                );
              })}
            </div>
            {errors.grade && (
              <p className="mt-1.5 text-sm text-red-400 flex items-center gap-1">
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
            <label className="block text-sm font-medium text-white mb-2 drop-shadow-sm">
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
                          ? 'bg-white text-black shadow-xl ring-2 ring-white ring-offset-2 ring-offset-transparent'
                          : 'bg-white/10 text-white border border-white/30 hover:bg-white/20'
                      }
                    `}
                  >
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
                    <div
                      className="w-8 h-8 rounded-full mb-2 shadow-inner border border-white/20"
                      style={{ backgroundColor: option.color }}
                    />
                    <span className="text-lg font-bold">{option.label}</span>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
            {errors.classType && (
              <p className="mt-1.5 text-sm text-red-400">{errors.classType}</p>
            )}
          </div>

          {/* 배정 과목 표시 */}
          <AnimatePresence>
            {selectedCourse && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="-mt-4 bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl p-4 text-center shadow-lg"
              >
                <p className="text-sm text-white/80 mb-1">배정 과목</p>
                <p className="text-xl font-bold text-white">
                  {selectedCourse.courseName}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

        </motion.div>
      </main>

      {/* 하단 버튼 영역 */}
      <footer className="sticky bottom-0 px-4 py-4 safe-area-pb relative z-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedCourse}
            className="w-full py-3 bg-white text-black font-medium rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? '처리 중...' : '다음 단계로'}
          </button>
        </motion.div>
      </footer>
    </motion.div>
  );
}
