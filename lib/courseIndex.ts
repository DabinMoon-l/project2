// 과목별 챕터 인덱스 데이터 — shared/courseChapters.json 단일 소스

import courseChaptersData from '@/shared/courseChapters.json';

export interface ChapterDetail {
  id: string;
  name: string;
}

export interface Chapter {
  id: string;
  name: string;       // "1. 세포손상" 형태
  shortName: string;  // "세포손상" 형태 (UI용)
  details: ChapterDetail[];
}

export interface CourseIndex {
  courseId: string;
  courseName: string;
  chapters: Chapter[];
}

// JSON 데이터를 CourseIndex 형태로 변환
function buildCourseIndex(courseId: string): CourseIndex | null {
  const data = (courseChaptersData as Record<string, { courseName: string; chapters: Chapter[] }>)[courseId];
  if (!data) return null;
  return {
    courseId,
    courseName: data.courseName,
    chapters: data.chapters,
  };
}

// 생물학 인덱스
export const BIOLOGY_INDEX: CourseIndex = buildCourseIndex('biology')!;

// 병태생리학 인덱스
export const PATHOPHYSIOLOGY_INDEX: CourseIndex = buildCourseIndex('pathophysiology')!;

// 미생물학 인덱스
export const MICROBIOLOGY_INDEX: CourseIndex = buildCourseIndex('microbiology')!;

// 과목 ID로 인덱스 가져오기
export const COURSE_INDEXES: Record<string, CourseIndex> = {
  biology: BIOLOGY_INDEX,
  pathophysiology: PATHOPHYSIOLOGY_INDEX,
  microbiology: MICROBIOLOGY_INDEX,
};

// 과목 ID로 인덱스 가져오기 함수
export function getCourseIndex(courseId: string): CourseIndex | null {
  return COURSE_INDEXES[courseId] || null;
}

// 챕터 ID로 챕터 정보 가져오기
export function getChapterById(courseId: string, chapterId: string): Chapter | null {
  const index = getCourseIndex(courseId);
  if (!index) return null;
  return index.chapters.find(c => c.id === chapterId) || null;
}

// 세부항목 ID로 세부항목 정보 가져오기
export function getDetailById(courseId: string, chapterId: string, detailId: string): ChapterDetail | null {
  const chapter = getChapterById(courseId, chapterId);
  if (!chapter) return null;
  return chapter.details.find(d => d.id === detailId) || null;
}

// 표시용 문자열 생성 (챕터·세부항목)
export function formatChapterLabel(
  courseId: string,
  chapterId?: string,
  detailId?: string
): string {
  if (!chapterId) return '미설정';

  const chapter = getChapterById(courseId, chapterId);
  if (!chapter) return '미설정';

  if (detailId) {
    const detail = getDetailById(courseId, chapterId, detailId);
    if (detail) {
      // 챕터 번호만 추출 (예: "1. 세포손상" -> "1")
      const chapterNum = chapter.name.split('.')[0];
      return `${chapterNum}·${detail.name}`;
    }
  }

  // 세부항목 없으면 챕터만
  const chapterNum = chapter.name.split('.')[0];
  return `${chapterNum}·${chapter.shortName}`;
}

/**
 * 태그 옵션 타입
 */
export interface TagOption {
  value: string;  // 태그 값 (예: "12_신경계")
  label: string;  // 표시 라벨 (예: "#12_신경계")
}

/**
 * 과목별 태그 옵션 생성
 * 챕터 번호를 포함한 태그 목록을 생성
 * 예: 생물학 12장 신경계 -> { value: "12_신경계", label: "#12_신경계" }
 */
export function generateCourseTags(courseId: string | null): TagOption[] {
  if (!courseId) {
    // 과목이 설정되지 않은 경우 기본 태그 (생물학)
    return generateCourseTags('biology');
  }

  const courseIndex = getCourseIndex(courseId);
  if (!courseIndex) {
    // 인덱스가 없으면 빈 배열 반환
    return [];
  }

  return courseIndex.chapters.map((chapter) => {
    // 챕터 번호 추출 (예: "12. 신경계" -> "12")
    const chapterNum = chapter.name.split('.')[0].trim();
    // 태그 값 생성 (예: "12_신경계")
    const tagValue = `${chapterNum}_${chapter.shortName}`;

    return {
      value: tagValue,
      label: `#${tagValue}`,
    };
  });
}

/**
 * 태그에서 챕터 ID 역추적
 * 예: "12_신경계" -> "bio_12"
 */
export function getChapterIdFromTag(courseId: string, tag: string): string | null {
  const courseIndex = getCourseIndex(courseId);
  if (!courseIndex) return null;

  // 태그에서 챕터 번호 추출 (예: "12_신경계" -> "12")
  const match = tag.match(/^(\d+)_/);
  if (!match) return null;

  const chapterNum = match[1];

  // 해당 번호의 챕터 찾기
  const chapter = courseIndex.chapters.find((c) =>
    c.name.startsWith(`${chapterNum}.`)
  );

  return chapter?.id || null;
}

/**
 * 기본 공통 태그 (과목과 무관)
 */
export const COMMON_TAGS: TagOption[] = [
  { value: '중간', label: '#중간' },
  { value: '기말', label: '#기말' },
  { value: '기타', label: '#기타' },
];
