/**
 * 과목 시스템 초기 데이터 시드 스크립트
 *
 * 실행 방법:
 * npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seedCourseData.ts
 *
 * 또는 Firebase Console에서 직접 입력
 */

// Firebase Admin SDK 또는 클라이언트 SDK 사용
// 이 파일은 참고용입니다. 실제로는 Firebase Console에서 직접 생성하거나
// 앱 첫 실행 시 자동 생성되도록 CourseContext에서 처리합니다.

/**
 * courses 컬렉션 초기 데이터
 */
export const COURSES_SEED_DATA = {
  biology: {
    id: 'biology',
    name: '생물학',
    nameEn: 'Biology',
    grade: 1,
    semester: 1,
    isUniverseSeparated: false,
    classes: ['A', 'B', 'C', 'D'],
    themeId: 'biology',
    order: 1,
  },
  pathophysiology: {
    id: 'pathophysiology',
    name: '병태생리학',
    nameEn: 'Pathophysiology',
    grade: 1,
    semester: 2,
    isUniverseSeparated: true,
    classes: ['A', 'B', 'C', 'D'],
    order: 2,
  },
  microbiology: {
    id: 'microbiology',
    name: '미생물학',
    nameEn: 'Microbiology',
    grade: 2,
    semester: 1,
    isUniverseSeparated: true,
    classes: ['A', 'B', 'C', 'D'],
    order: 3,
  },
};

/**
 * settings/semester 초기 데이터
 */
export const SEMESTER_SETTINGS_SEED_DATA = {
  currentYear: 2024,
  currentSemester: 1, // 1 = 봄학기, 2 = 가을학기
  semesterDates: {
    spring: {
      start: '2024-03-01',
      end: '2024-08-31',
    },
    fall: {
      start: '2024-09-01',
      end: '2025-02-28',
    },
  },
};

/**
 * Firebase Console에서 직접 생성하려면:
 *
 * 1. Firestore Database로 이동
 * 2. "컬렉션 시작" 클릭
 *
 * === courses 컬렉션 ===
 * 컬렉션 ID: courses
 *
 * 문서 ID: biology
 * 필드:
 *   - id (string): "biology"
 *   - name (string): "생물학"
 *   - nameEn (string): "Biology"
 *   - grade (number): 1
 *   - semester (number): 1
 *   - isUniverseSeparated (boolean): false
 *   - classes (array): ["A", "B", "C", "D"]
 *   - themeId (string): "biology"
 *   - order (number): 1
 *
 * 문서 ID: pathophysiology
 * 필드:
 *   - id (string): "pathophysiology"
 *   - name (string): "병태생리학"
 *   - nameEn (string): "Pathophysiology"
 *   - grade (number): 1
 *   - semester (number): 2
 *   - isUniverseSeparated (boolean): true
 *   - classes (array): ["A", "B", "C", "D"]
 *   - order (number): 2
 *
 * 문서 ID: microbiology
 * 필드:
 *   - id (string): "microbiology"
 *   - name (string): "미생물학"
 *   - nameEn (string): "Microbiology"
 *   - grade (number): 2
 *   - semester (number): 1
 *   - isUniverseSeparated (boolean): true
 *   - classes (array): ["A", "B", "C", "D"]
 *   - order (number): 3
 *
 * === settings 컬렉션 ===
 * 컬렉션 ID: settings
 *
 * 문서 ID: semester
 * 필드:
 *   - currentYear (number): 2024
 *   - currentSemester (number): 1
 *   - semesterDates (map):
 *     - spring (map):
 *       - start (string): "2024-03-01"
 *       - end (string): "2024-08-31"
 *     - fall (map):
 *       - start (string): "2024-09-01"
 *       - end (string): "2025-02-28"
 */

console.log('과목 시드 데이터:');
console.log(JSON.stringify(COURSES_SEED_DATA, null, 2));
console.log('\n학기 설정 시드 데이터:');
console.log(JSON.stringify(SEMESTER_SETTINGS_SEED_DATA, null, 2));
