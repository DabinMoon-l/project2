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
    reviewRibbonScale: 1.15, // 리뷰 리본 키움
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
    quizRibbonScale: 1.0, // 퀴즈 리본
    quizRibbonOffsetY: 0, // 중앙 유지
    reviewRibbonScale: 1.0, // 리뷰 리본
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
    quizRibbonScale: 1.0, // 퀴즈 리본
    quizRibbonOffsetY: 0, // 중앙 유지
    reviewRibbonScale: 1.0, // 리뷰 리본
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
 * 과목 목록 가져오기 (정렬됨)
 */
export function getCourseList(): Course[] {
  return Object.values(COURSES).sort((a, b) => a.order - b.order);
}
