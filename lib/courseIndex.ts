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

// 병태생리학 인덱스 (1, 2, 6단원은 범위 외)
export const PATHOPHYSIOLOGY_INDEX: CourseIndex = {
  courseId: 'pathophysiology',
  courseName: '병태생리학',
  chapters: [
    {
      id: 'patho_3',
      name: '3. 세포손상',
      shortName: '세포손상',
      details: [
        { id: 'patho_3_1', name: '세포 적응' },
        { id: 'patho_3_2', name: '가역적 세포 손상과 석회화' },
        { id: 'patho_3_3', name: '비가역적 세포 손상' },
      ],
    },
    {
      id: 'patho_4',
      name: '4. 염증',
      shortName: '염증',
      details: [
        { id: 'patho_4_1', name: '혈액과 혈구' },
        { id: 'patho_4_2', name: '염증의 기본 증후' },
        { id: 'patho_4_3', name: '급성 염증' },
        { id: 'patho_4_4', name: '만성 염증' },
        { id: 'patho_4_5', name: '염증의 화학 매개 물질과 염증 세포' },
      ],
    },
    {
      id: 'patho_5',
      name: '5. 치유',
      shortName: '치유',
      details: [
        { id: 'patho_5_1', name: '세포 환경과 증식' },
        { id: 'patho_5_2', name: '재생과 재생 능력에 따른 세포 분류' },
        { id: 'patho_5_3', name: '피부의 상처 치유와 섬유화' },
      ],
    },
    {
      id: 'patho_7',
      name: '7. 면역',
      shortName: '면역',
      details: [
        { id: 'patho_7_1', name: '생물학적 면역체계' },
        { id: 'patho_7_2', name: '면역체계의 분류' },
        { id: 'patho_7_3', name: '과민반응' },
        { id: 'patho_7_4', name: '자가면역질환과 AIDS' },
        { id: 'patho_7_5', name: '이식면역' },
      ],
    },
    {
      id: 'patho_8',
      name: '8. 순환장애',
      shortName: '순환장애',
      details: [
        { id: 'patho_8_1', name: '충혈과 울혈' },
        { id: 'patho_8_2', name: '혈전과 색전' },
        { id: 'patho_8_3', name: '경색' },
        { id: 'patho_8_4', name: '쇼크' },
        { id: 'patho_8_5', name: 'DIC (파종성 혈관 내 응고)' },
      ],
    },
    {
      id: 'patho_9',
      name: '9. 신생물',
      shortName: '신생물',
      details: [
        { id: 'patho_9_1', name: '신생물의 정의와 특징' },
        { id: 'patho_9_2', name: '종양의 종류와 명칭' },
        { id: 'patho_9_3', name: '신생물이 신체에 미치는 영향' },
        { id: 'patho_9_4', name: '종양의 악성도와 병기' },
        { id: 'patho_9_5', name: '신생물 분류' },
        { id: 'patho_9_6', name: '종양의 전파' },
      ],
    },
    {
      id: 'patho_10',
      name: '10. 선천성 이상',
      shortName: '선천성 이상',
      details: [],
    },
    {
      id: 'patho_11',
      name: '11. 노화',
      shortName: '노화',
      details: [],
    },
  ],
};

// 미생물학 인덱스
export const MICROBIOLOGY_INDEX: CourseIndex = {
  courseId: 'microbiology',
  courseName: '미생물학',
  chapters: [
    {
      id: 'micro_1',
      name: '1. 미생물과 미생물학',
      shortName: '미생물과 미생물학',
      details: [
        { id: 'micro_1_1', name: '미생물의 개요' },
        { id: 'micro_1_2', name: '미생물학의 역사' },
      ],
    },
    {
      id: 'micro_2',
      name: '2. 숙주면역반응',
      shortName: '숙주면역반응',
      details: [
        { id: 'micro_2_1', name: '면역계통의 개요' },
        { id: 'micro_2_2', name: '선천면역' },
        { id: 'micro_2_3', name: '후천면역' },
        { id: 'micro_2_4', name: '면역계통의 병리와 응용' },
      ],
    },
    {
      id: 'micro_3',
      name: '3. 감염과 발병',
      shortName: '감염과 발병',
      details: [
        { id: 'micro_3_1', name: '감염의 성립' },
        { id: 'micro_3_2', name: '감염과 발병' },
        { id: 'micro_3_3', name: '감염의 경과' },
      ],
    },
    {
      id: 'micro_4',
      name: '4. 세균의 일반적인 성질',
      shortName: '세균의 일반적인 성질',
      details: [
        { id: 'micro_4_1', name: '세균의 분류' },
        { id: 'micro_4_2', name: '세균의 형태와 구조' },
        { id: 'micro_4_3', name: '세균의 증식' },
        { id: 'micro_4_4', name: '세균의 대사' },
        { id: 'micro_4_5', name: '세균의 유전' },
        { id: 'micro_4_6', name: '세균의 병원성' },
        { id: 'micro_4_7', name: '세균 감염병의 진단' },
        { id: 'micro_4_8', name: '항균제' },
      ],
    },
    {
      id: 'micro_5',
      name: '5. 병원성 세균',
      shortName: '병원성 세균',
      details: [
        { id: 'micro_5_1', name: '그람양성 조건무산소성 및 산소성 알균' },
        { id: 'micro_5_2', name: '그람음성 조건무산소성 막대균' },
        { id: 'micro_5_3', name: '나선균군' },
        { id: 'micro_5_4', name: '그람음성 산소성 막대균 및 알균' },
        { id: 'micro_5_5', name: '그람양성 조건무산소성 및 산소성 막대균' },
        { id: 'micro_5_6', name: '절대무산소성균' },
        { id: 'micro_5_7', name: '미코박테륨속' },
        { id: 'micro_5_8', name: '바퀴살균' },
        { id: 'micro_5_9', name: '스피로헤타' },
        { id: 'micro_5_10', name: '미코플라스마, 리케차, 클라미디아' },
      ],
    },
    {
      id: 'micro_6',
      name: '6. 바이러스의 일반적 성질',
      shortName: '바이러스의 일반적 성질',
      details: [
        { id: 'micro_6_1', name: '바이러스의 특징' },
        { id: 'micro_6_2', name: '바이러스의 분류' },
        { id: 'micro_6_3', name: '바이러스의 형태와 구조' },
        { id: 'micro_6_4', name: '바이러스의 증식' },
        { id: 'micro_6_5', name: '바이러스의 유전' },
        { id: 'micro_6_6', name: '바이러스의 병원성' },
        { id: 'micro_6_7', name: '바이러스 감염병의 진단' },
        { id: 'micro_6_8', name: '항바이러스제' },
      ],
    },
    {
      id: 'micro_7',
      name: '7. 병원성 바이러스',
      shortName: '병원성 바이러스',
      details: [
        { id: 'micro_7_1', name: 'DNA 바이러스' },
        { id: 'micro_7_2', name: 'RNA 바이러스' },
        { id: 'micro_7_3', name: '간염바이러스' },
        { id: 'micro_7_4', name: '종양바이러스' },
        { id: 'micro_7_5', name: '프리온' },
      ],
    },
    {
      id: 'micro_8',
      name: '8. 진균의 일반적 성질',
      shortName: '진균의 일반적 성질',
      details: [
        { id: 'micro_8_1', name: '진균의 형태와 구조' },
        { id: 'micro_8_2', name: '진균의 증식' },
        { id: 'micro_8_3', name: '진균의 분류' },
        { id: 'micro_8_4', name: '진균의 영양과 배양' },
        { id: 'micro_8_5', name: '진균의 병원성' },
        { id: 'micro_8_6', name: '진균 감염병의 진단' },
        { id: 'micro_8_7', name: '항진균제' },
      ],
    },
    {
      id: 'micro_9',
      name: '9. 병원성 진균',
      shortName: '병원성 진균',
      details: [
        { id: 'micro_9_1', name: '심재성 진균증을 일으키는 진균' },
        { id: 'micro_9_2', name: '표재성 피부진균증을 일으키는 진균' },
        { id: 'micro_9_3', name: '심재성 피부진균증을 일으키는 진균' },
      ],
    },
    {
      id: 'micro_10',
      name: '10. 원충의 일반적 성질과 병원성 원충',
      shortName: '원충',
      details: [
        { id: 'micro_10_1', name: '원충의 특징' },
        { id: 'micro_10_2', name: '원충의 형태와 구조' },
        { id: 'micro_10_3', name: '원충의 분류' },
        { id: 'micro_10_4', name: '원충의 발육과 증식' },
        { id: 'micro_10_5', name: '원충 감염병의 진단' },
        { id: 'micro_10_6', name: '항원충제' },
        { id: 'micro_10_7', name: '병원성 원충' },
      ],
    },
    {
      id: 'micro_11',
      name: '11. 감염병의 예방과 대책',
      shortName: '감염병의 예방과 대책',
      details: [
        { id: 'micro_11_1', name: '감염병 현황' },
        { id: 'micro_11_2', name: '감염병 예방' },
        { id: 'micro_11_3', name: '감염병 대책' },
      ],
    },
  ],
};

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
