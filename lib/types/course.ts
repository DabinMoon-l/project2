/**
 * 과목 시스템 타입 정의
 */

/**
 * 과목 ID
 */
export type CourseId = 'biology' | 'pathophysiology' | 'microbiology';

/**
 * 반 ID
 */
export type ClassId = 'A' | 'B' | 'C' | 'D';

/**
 * 학기
 */
export type Semester = 1 | 2;

/**
 * 과목 정보
 */
export interface Course {
  /** 과목 ID */
  id: CourseId;
  /** 과목명 (한글) */
  name: string;
  /** 과목명 (영문) */
  nameEn: string;
  /** 해당 학년 */
  grade: number;
  /** 해당 학기 */
  semester: Semester;
  /** Universe 분리 여부 (true: 반별 분리, false: 단일) */
  isUniverseSeparated: boolean;
  /** 반 목록 */
  classes: ClassId[];
  /** 테마 ID (생물학용 단일 테마) */
  themeId?: string;
  /** 정렬 순서 */
  order: number;
  /** 과목별 리본 이미지 (퀴즈창) */
  quizRibbonImage: string;
  /** 과목별 리본 이미지 (리뷰창) */
  reviewRibbonImage: string;
  /** 퀴즈 리본 이미지 스케일 (기본값 1) */
  quizRibbonScale?: number;
  /** 리뷰 리본 이미지 스케일 (기본값 1) */
  reviewRibbonScale?: number;
  /** 퀴즈 리본 Y축 오프셋 (px, 양수=아래로) */
  quizRibbonOffsetY?: number;
}

/**
 * 학기 설정
 */
export interface SemesterSettings {
  /** 현재 학년도 */
  currentYear: number;
  /** 현재 학기 (1: 봄, 2: 가을) */
  currentSemester: Semester;
  /** 학기별 날짜 */
  semesterDates: {
    spring: {
      start: string; // 'YYYY-MM-DD'
      end: string;
    };
    fall: {
      start: string;
      end: string;
    };
  };
  /** 다음 학기 전환 정보 */
  nextTransition?: {
    scheduledDate: Date;
    executed: boolean;
    executedAt?: Date;
  };
}

/**
 * 과목 결정 결과
 */
export interface CourseAssignment {
  courseId: CourseId;
  courseName: string;
  grade: number;
  semester: Semester;
}

/**
 * 과목 상수 데이터
 */
export const COURSES: Record<CourseId, Course> = {
  biology: {
    id: 'biology',
    name: '생물학',
    nameEn: 'Biology',
    grade: 1,
    semester: 1,
    isUniverseSeparated: false, // 단일 Universe
    classes: ['A', 'B', 'C', 'D'],
    themeId: 'biology', // 단일 테마
    order: 1,
    quizRibbonImage: '/images/biology-quiz-ribbon.png',
    reviewRibbonImage: '/images/biology-review-ribbon.png',
    quizRibbonScale: 1,
    reviewRibbonScale: 1,
  },
  pathophysiology: {
    id: 'pathophysiology',
    name: '병태생리학',
    nameEn: 'Pathophysiology',
    grade: 1,
    semester: 2,
    isUniverseSeparated: false, // 전체 학년 공통
    classes: ['A', 'B', 'C', 'D'],
    order: 2,
    quizRibbonImage: '/images/pathophysiology-quiz-ribbon.png',
    reviewRibbonImage: '/images/pathophysiology-review-ribbon.png',
    quizRibbonScale: 1,
    reviewRibbonScale: 1,
  },
  microbiology: {
    id: 'microbiology',
    name: '미생물학',
    nameEn: 'Microbiology',
    grade: 2,
    semester: 1,
    isUniverseSeparated: false, // 전체 학년 공통
    classes: ['A', 'B', 'C', 'D'],
    order: 3,
    quizRibbonImage: '/images/microbiology-quiz-ribbon.png',
    reviewRibbonImage: '/images/microbiology-review-ribbon.png',
    quizRibbonScale: 1,
    reviewRibbonScale: 1,
  },
};

/**
 * 현재 학기와 학년으로 과목 결정
 */
export function determineCourse(
  grade: number,
  currentSemester: Semester
): CourseAssignment | null {
  if (currentSemester === 1) {
    // 1학기 (봄): 생물학 or 미생물학
    if (grade === 1) {
      return {
        courseId: 'biology',
        courseName: '생물학',
        grade: 1,
        semester: 1,
      };
    }
    if (grade === 2) {
      return {
        courseId: 'microbiology',
        courseName: '미생물학',
        grade: 2,
        semester: 1,
      };
    }
  } else {
    // 2학기 (가을): 병태생리학만
    if (grade === 1) {
      return {
        courseId: 'pathophysiology',
        courseName: '병태생리학',
        grade: 1,
        semester: 2,
      };
    }
    // 2학년 2학기는 과목 없음
  }
  return null;
}

/**
 * 현재 학기에서 선택 가능한 학년 목록
 */
export function getAvailableGrades(currentSemester: Semester): number[] {
  if (currentSemester === 1) {
    return [1, 2]; // 1학기: 1학년, 2학년 선택 가능
  } else {
    return [1]; // 2학기: 1학년만 선택 가능
  }
}

/**
 * 과목 정보 가져오기
 */
export function getCourse(courseId: CourseId): Course {
  return COURSES[courseId];
}

/**
 * 퀴즈 필터 탭 타입
 */
export type QuizFilterTab = 'midterm' | 'final' | 'past' | 'custom';

/**
 * 현재 날짜 기반 학기 계산
 * - 02-22 ~ 08-21: 1학기
 * - 08-22 ~ 02-21: 2학기
 */
export function getCurrentSemesterByDate(): Semester {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  // 2월 22일 ~ 8월 21일: 1학기
  if (month === 2 && day >= 22) return 1;
  if (month >= 3 && month <= 7) return 1;
  if (month === 8 && day <= 21) return 1;

  // 8월 22일 ~ 다음해 2월 21일: 2학기
  return 2;
}

/**
 * 현재 날짜 기반 기본 퀴즈 탭 계산
 * - 02-22 ~ 04-30: 중간대비 (1학기)
 * - 05-01 ~ 06-30: 기말대비 (1학기)
 * - 07-01 ~ 08-21: 족보 (1학기)
 * - 08-22 ~ 10-30: 중간대비 (2학기)
 * - 11-01 ~ 12-31: 기말대비 (2학기)
 * - 01-01 ~ 02-21: 족보 (2학기)
 */
export function getDefaultQuizTab(): QuizFilterTab {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const mmdd = month * 100 + day; // 예: 2월 22일 = 222, 12월 31일 = 1231

  // 1학기
  if (mmdd >= 222 && mmdd <= 430) return 'midterm';
  if (mmdd >= 501 && mmdd <= 630) return 'final';
  if (mmdd >= 701 && mmdd <= 821) return 'past';

  // 2학기
  if (mmdd >= 822 && mmdd <= 1030) return 'midterm';
  if (mmdd >= 1101 && mmdd <= 1231) return 'final';
  if (mmdd >= 101 && mmdd <= 221) return 'past';

  return 'midterm'; // 기본값
}

/**
 * 과목 목록 가져오기 (정렬됨)
 */
export function getCourseList(): Course[] {
  return Object.values(COURSES).sort((a, b) => a.order - b.order);
}

/**
 * 기출 옵션 타입
 */
export interface PastExamOption {
  year: number;
  examType: 'midterm' | 'final';
  label: string; // "2025-중간"
  value: string; // "2025-midterm"
}

/**
 * 과목의 학기 기반 기출 옵션 생성
 * - 2025년: 중간/기말 기본 표시
 * - 2026년부터: 시즌에 따라 자동 추가
 *   - 1학기 과목 (생물학, 미생물학): 02-22 이후 중간, 05-01 이후 기말
 *   - 2학기 과목 (병태생리학): 08-22 이후 중간, 11-01 이후 기말
 */
export function getPastExamOptions(courseId: CourseId | string | null): PastExamOption[] {
  const options: PastExamOption[] = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const mmdd = month * 100 + day;

  // 과목별 학기 확인 (1학기 or 2학기)
  const course = courseId ? COURSES[courseId as CourseId] : null;
  const courseSemester = course?.semester || 1;

  // 2025년: 기본으로 중간/기말 둘 다 표시
  options.push(
    { year: 2025, examType: 'midterm', label: '2025-중간', value: '2025-midterm' },
    { year: 2025, examType: 'final', label: '2025-기말', value: '2025-final' }
  );

  // 2026년부터: 시즌에 따라 자동 추가
  for (let year = 2026; year <= currentYear; year++) {
    if (year < currentYear) {
      // 이전 연도는 중간/기말 둘 다 추가
      options.push(
        { year, examType: 'midterm', label: `${year}-중간`, value: `${year}-midterm` },
        { year, examType: 'final', label: `${year}-기말`, value: `${year}-final` }
      );
    } else {
      // 현재 연도: 과목 학기와 현재 날짜로 판단
      if (courseSemester === 1) {
        // 1학기 과목 (생물학, 미생물학): 봄학기 기준
        // 중간고사 시즌 시작: 02-22
        if (mmdd >= 222) {
          options.push({ year, examType: 'midterm', label: `${year}-중간`, value: `${year}-midterm` });
        }
        // 기말고사 시즌 시작: 05-01
        if (mmdd >= 501) {
          options.push({ year, examType: 'final', label: `${year}-기말`, value: `${year}-final` });
        }
      } else {
        // 2학기 과목 (병태생리학): 가을학기 기준
        // 중간고사 시즌 시작: 08-22
        if (mmdd >= 822) {
          options.push({ year, examType: 'midterm', label: `${year}-중간`, value: `${year}-midterm` });
        }
        // 기말고사 시즌 시작: 11-01
        if (mmdd >= 1101) {
          options.push({ year, examType: 'final', label: `${year}-기말`, value: `${year}-final` });
        }
      }
    }
  }

  // 최신순 정렬 (2026-기말, 2026-중간, 2025-기말, 2025-중간)
  options.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    // 같은 연도면 기말 > 중간
    return a.examType === 'final' ? -1 : 1;
  });

  return options;
}
