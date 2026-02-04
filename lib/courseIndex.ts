// 과목별 챕터 인덱스 데이터

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

// 생물학 인덱스
export const BIOLOGY_INDEX: CourseIndex = {
  courseId: 'biology',
  courseName: '생물학',
  chapters: [
    {
      id: 'bio_1',
      name: '1. 생명현상의 특성',
      shortName: '생명현상의 특성',
      details: [],
    },
    {
      id: 'bio_2',
      name: '2. 세포의 특성',
      shortName: '세포의 특성',
      details: [],
    },
    {
      id: 'bio_3',
      name: '3. 생명체의 화학적 이해',
      shortName: '생명체의 화학적 이해',
      details: [
        { id: 'bio_3_1', name: '물질의 구성 단위' },
        { id: 'bio_3_2', name: '생명을 유지하는 기본 물질 - 물·pH·삼투압' },
        { id: 'bio_3_3', name: '생체의 구성 물질' },
      ],
    },
    {
      id: 'bio_4',
      name: '4. 영양과 물질대사',
      shortName: '영양과 물질대사',
      details: [
        { id: 'bio_4_1', name: '영양의 섭취 - 소화' },
        { id: 'bio_4_2', name: '물질대사' },
        { id: 'bio_4_3', name: '효소' },
        { id: 'bio_4_4', name: '에너지대사' },
      ],
    },
    {
      id: 'bio_5',
      name: '5. 유전과 분자생물학',
      shortName: '유전과 분자생물학',
      details: [
        { id: 'bio_5_1', name: '유전 현상 - 멘델 법칙' },
        { id: 'bio_5_2', name: '유전 물질의 탐구 - DNA' },
        { id: 'bio_5_3', name: '유전체와 염색체' },
        { id: 'bio_5_4', name: 'DNA의 복제' },
      ],
    },
    {
      id: 'bio_6',
      name: '6. 유전자의 발현과 조절',
      shortName: '유전자의 발현과 조절',
      details: [
        { id: 'bio_6_1', name: '유전 정보의 발현 - 전사·RNA·단백질 합성' },
        { id: 'bio_6_2', name: '복구와 재조합' },
        { id: 'bio_6_3', name: '돌연변이' },
      ],
    },
    {
      id: 'bio_7',
      name: '7. 세포의 주기와 죽음',
      shortName: '세포의 주기와 죽음',
      details: [
        { id: 'bio_7_1', name: '세포 주기와 그 조절' },
        { id: 'bio_7_2', name: '체세포 분열' },
        { id: 'bio_7_3', name: '감수 분열' },
        { id: 'bio_7_4', name: '세포의 죽음' },
      ],
    },
    {
      id: 'bio_8',
      name: '8. 생식·발생·분화',
      shortName: '생식·발생·분화',
      details: [
        { id: 'bio_8_1', name: '생물의 증식 양상' },
        { id: 'bio_8_2', name: '동물의 발생' },
        { id: 'bio_8_3', name: '분화 및 재생' },
      ],
    },
    {
      id: 'bio_9',
      name: '9. 동물의 조직',
      shortName: '동물의 조직',
      details: [
        { id: 'bio_9_1', name: '동물의 조직' },
        { id: 'bio_9_2', name: '혈액' },
      ],
    },
    {
      id: 'bio_10',
      name: '10. 동물의 기관',
      shortName: '동물의 기관',
      details: [
        { id: 'bio_10_1', name: '소화계' },
        { id: 'bio_10_2', name: '호흡계' },
        { id: 'bio_10_3', name: '비뇨계' },
        { id: 'bio_10_4', name: '순환계' },
      ],
    },
    {
      id: 'bio_11',
      name: '11. 내분비계',
      shortName: '내분비계',
      details: [
        { id: 'bio_11_1', name: '생체 조절과 호르몬' },
        { id: 'bio_11_2', name: '내분비기관에서 분비되는 호르몬과 그 작용' },
        { id: 'bio_11_3', name: '호르몬의 분비 조절' },
        { id: 'bio_11_4', name: '호르몬에 의한 항상성 유지' },
      ],
    },
    {
      id: 'bio_12',
      name: '12. 신경계',
      shortName: '신경계',
      details: [
        { id: 'bio_12_1', name: '신경계의 구성' },
        { id: 'bio_12_2', name: '말초 신경계와 신경 전달 경로' },
        { id: 'bio_12_3', name: '뉴런에서의 신경 흥분 경로' },
        { id: 'bio_12_4', name: '신경 간 전달과 신경 전달 물질' },
      ],
    },
  ],
};

// 병태생리학 인덱스
export const PATHOPHYSIOLOGY_INDEX: CourseIndex = {
  courseId: 'pathophysiology',
  courseName: '병태생리학',
  chapters: [
    {
      id: 'patho_1',
      name: '1. 세포손상',
      shortName: '세포손상',
      details: [
        { id: 'patho_1_1', name: '세포 적응' },
        { id: 'patho_1_2', name: '가역적 세포 손상과 석회화' },
        { id: 'patho_1_3', name: '비가역적 세포 손상' },
      ],
    },
    {
      id: 'patho_2',
      name: '2. 염증',
      shortName: '염증',
      details: [
        { id: 'patho_2_1', name: '혈액과 혈구' },
        { id: 'patho_2_2', name: '염증의 기본 증후' },
        { id: 'patho_2_3', name: '급성 염증' },
        { id: 'patho_2_4', name: '만성 염증' },
        { id: 'patho_2_5', name: '염증의 화학 매개 물질과 염증 세포' },
      ],
    },
    {
      id: 'patho_3',
      name: '3. 치유',
      shortName: '치유',
      details: [
        { id: 'patho_3_1', name: '세포 환경과 증식' },
        { id: 'patho_3_2', name: '재생과 재생 능력에 따른 세포 분류' },
        { id: 'patho_3_3', name: '피부의 상처 치유와 섬유화' },
      ],
    },
    {
      id: 'patho_4',
      name: '4. 면역',
      shortName: '면역',
      details: [
        { id: 'patho_4_1', name: '생물학적 면역체계' },
        { id: 'patho_4_2', name: '면역체계의 분류' },
        { id: 'patho_4_3', name: '과민반응' },
        { id: 'patho_4_4', name: '자가면역질환과 AIDS' },
        { id: 'patho_4_5', name: '이식면역' },
      ],
    },
    {
      id: 'patho_5',
      name: '5. 순환장애',
      shortName: '순환장애',
      details: [
        { id: 'patho_5_1', name: '충혈과 울혈' },
        { id: 'patho_5_2', name: '혈전과 색전' },
        { id: 'patho_5_3', name: '경색' },
        { id: 'patho_5_4', name: '쇼크' },
        { id: 'patho_5_5', name: 'DIC (파종성 혈관 내 응고)' },
      ],
    },
    {
      id: 'patho_6',
      name: '6. 신생물',
      shortName: '신생물',
      details: [
        { id: 'patho_6_1', name: '신생물의 정의와 특징' },
        { id: 'patho_6_2', name: '종양의 종류와 명칭' },
        { id: 'patho_6_3', name: '신생물이 신체에 미치는 영향' },
        { id: 'patho_6_4', name: '종양의 악성도와 병기' },
        { id: 'patho_6_5', name: '신생물 분류' },
        { id: 'patho_6_6', name: '종양의 전파' },
      ],
    },
    {
      id: 'patho_7',
      name: '7. 선천성 이상',
      shortName: '선천성 이상',
      details: [],
    },
    {
      id: 'patho_8',
      name: '8. 노화',
      shortName: '노화',
      details: [],
    },
  ],
};

// 과목 ID로 인덱스 가져오기
export const COURSE_INDEXES: Record<string, CourseIndex> = {
  biology: BIOLOGY_INDEX,
  pathophysiology: PATHOPHYSIOLOGY_INDEX,
  // 추후 미생물학 추가
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
