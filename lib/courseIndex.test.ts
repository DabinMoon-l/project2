// courseIndex.ts 유틸리티 함수 테스트
import { describe, it, expect } from 'vitest';
import {
  BIOLOGY_INDEX,
  PATHOPHYSIOLOGY_INDEX,
  MICROBIOLOGY_INDEX,
  COURSE_INDEXES,
  COMMON_TAGS,
  getCourseIndex,
  getChapterById,
  getDetailById,
  formatChapterLabel,
  generateCourseTags,
  getChapterIdFromTag,
} from './courseIndex';
import type { CourseIndex, TagOption } from './courseIndex';

// ─── 상수 내보내기 검증 ───

describe('COURSE_INDEXES 상수', () => {
  it('3개 과목 인덱스가 모두 존재한다', () => {
    expect(COURSE_INDEXES).toHaveProperty('biology');
    expect(COURSE_INDEXES).toHaveProperty('pathophysiology');
    expect(COURSE_INDEXES).toHaveProperty('microbiology');
    expect(Object.keys(COURSE_INDEXES)).toHaveLength(3);
  });

  it('개별 상수와 COURSE_INDEXES 항목이 동일 참조다', () => {
    expect(COURSE_INDEXES.biology).toBe(BIOLOGY_INDEX);
    expect(COURSE_INDEXES.pathophysiology).toBe(PATHOPHYSIOLOGY_INDEX);
    expect(COURSE_INDEXES.microbiology).toBe(MICROBIOLOGY_INDEX);
  });

  it('각 과목 인덱스에 courseId, courseName, chapters가 있다', () => {
    for (const [key, idx] of Object.entries(COURSE_INDEXES)) {
      expect(idx.courseId).toBe(key);
      expect(typeof idx.courseName).toBe('string');
      expect(idx.courseName.length).toBeGreaterThan(0);
      expect(Array.isArray(idx.chapters)).toBe(true);
      expect(idx.chapters.length).toBeGreaterThan(0);
    }
  });
});

describe('과목별 인덱스 구조', () => {
  it('생물학: 12개 챕터, bio_ 접두사', () => {
    expect(BIOLOGY_INDEX.courseId).toBe('biology');
    expect(BIOLOGY_INDEX.courseName).toBe('생물학');
    expect(BIOLOGY_INDEX.chapters).toHaveLength(12);
    BIOLOGY_INDEX.chapters.forEach((ch) => {
      expect(ch.id).toMatch(/^bio_\d+$/);
    });
  });

  it('병태생리학: 13개 챕터, patho_ 접두사 (3장부터 시작, 6장 없음)', () => {
    expect(PATHOPHYSIOLOGY_INDEX.courseId).toBe('pathophysiology');
    expect(PATHOPHYSIOLOGY_INDEX.courseName).toBe('병태생리학');
    expect(PATHOPHYSIOLOGY_INDEX.chapters).toHaveLength(13);
    PATHOPHYSIOLOGY_INDEX.chapters.forEach((ch) => {
      expect(ch.id).toMatch(/^patho_\d+$/);
    });
  });

  it('미생물학: 11개 챕터, micro_ 접두사', () => {
    expect(MICROBIOLOGY_INDEX.courseId).toBe('microbiology');
    expect(MICROBIOLOGY_INDEX.courseName).toBe('미생물학');
    expect(MICROBIOLOGY_INDEX.chapters).toHaveLength(11);
    MICROBIOLOGY_INDEX.chapters.forEach((ch) => {
      expect(ch.id).toMatch(/^micro_\d+$/);
    });
  });

  it('모든 챕터에 id, name, shortName, details 필드가 있다', () => {
    for (const idx of Object.values(COURSE_INDEXES)) {
      idx.chapters.forEach((ch) => {
        expect(ch).toHaveProperty('id');
        expect(ch).toHaveProperty('name');
        expect(ch).toHaveProperty('shortName');
        expect(ch).toHaveProperty('details');
        expect(Array.isArray(ch.details)).toBe(true);
      });
    }
  });

  it('챕터 name은 "번호. 이름" 형식이다', () => {
    for (const idx of Object.values(COURSE_INDEXES)) {
      idx.chapters.forEach((ch) => {
        expect(ch.name).toMatch(/^\d+\.\s*.+$/);
      });
    }
  });
});

describe('COMMON_TAGS 상수', () => {
  it('3개 공통 태그가 존재한다', () => {
    expect(COMMON_TAGS).toHaveLength(3);
  });

  it('중간/기말/기타 태그를 포함한다', () => {
    const values = COMMON_TAGS.map((t) => t.value);
    expect(values).toEqual(['중간', '기말', '기타']);
  });

  it('label은 # 접두사를 가진다', () => {
    COMMON_TAGS.forEach((tag) => {
      expect(tag.label).toBe(`#${tag.value}`);
    });
  });
});

// ─── getCourseIndex ───

describe('getCourseIndex', () => {
  it('유효한 과목 ID로 인덱스를 반환한다', () => {
    const bio = getCourseIndex('biology');
    expect(bio).not.toBeNull();
    expect(bio!.courseId).toBe('biology');

    const patho = getCourseIndex('pathophysiology');
    expect(patho).not.toBeNull();
    expect(patho!.courseId).toBe('pathophysiology');

    const micro = getCourseIndex('microbiology');
    expect(micro).not.toBeNull();
    expect(micro!.courseId).toBe('microbiology');
  });

  it('존재하지 않는 과목 ID는 null을 반환한다', () => {
    expect(getCourseIndex('chemistry')).toBeNull();
    expect(getCourseIndex('')).toBeNull();
    expect(getCourseIndex('BIOLOGY')).toBeNull(); // 대소문자 구분
  });
});

// ─── getChapterById ───

describe('getChapterById', () => {
  it('유효한 과목+챕터 ID로 챕터를 반환한다', () => {
    const ch = getChapterById('biology', 'bio_1');
    expect(ch).not.toBeNull();
    expect(ch!.id).toBe('bio_1');
    expect(ch!.shortName).toBe('생명현상의 특성');
  });

  it('생물학 12장(신경계)을 조회할 수 있다', () => {
    const ch = getChapterById('biology', 'bio_12');
    expect(ch).not.toBeNull();
    expect(ch!.shortName).toBe('신경계');
    expect(ch!.details.length).toBeGreaterThan(0);
  });

  it('병태생리학 챕터를 조회할 수 있다', () => {
    const ch = getChapterById('pathophysiology', 'patho_3');
    expect(ch).not.toBeNull();
    expect(ch!.shortName).toBe('세포손상');
  });

  it('미생물학 챕터를 조회할 수 있다', () => {
    const ch = getChapterById('microbiology', 'micro_5');
    expect(ch).not.toBeNull();
    expect(ch!.shortName).toBe('병원성 세균');
  });

  it('잘못된 과목 ID는 null을 반환한다', () => {
    expect(getChapterById('invalid', 'bio_1')).toBeNull();
  });

  it('존재하지 않는 챕터 ID는 null을 반환한다', () => {
    expect(getChapterById('biology', 'bio_99')).toBeNull();
    expect(getChapterById('biology', 'patho_3')).toBeNull(); // 다른 과목 챕터
  });

  it('빈 문자열 챕터 ID는 null을 반환한다', () => {
    expect(getChapterById('biology', '')).toBeNull();
  });
});

// ─── getDetailById ───

describe('getDetailById', () => {
  it('유효한 세부항목을 반환한다', () => {
    const detail = getDetailById('biology', 'bio_3', 'bio_3_1');
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe('bio_3_1');
    expect(detail!.name).toBe('물질의 구성 단위');
  });

  it('병태생리학 세부항목을 조회할 수 있다', () => {
    const detail = getDetailById('pathophysiology', 'patho_4', 'patho_4_3');
    expect(detail).not.toBeNull();
    expect(detail!.name).toBe('급성 염증');
  });

  it('미생물학 세부항목을 조회할 수 있다', () => {
    const detail = getDetailById('microbiology', 'micro_2', 'micro_2_4');
    expect(detail).not.toBeNull();
    expect(detail!.name).toBe('면역계통의 병리와 응용');
  });

  it('세부항목이 없는 챕터에서 조회하면 null을 반환한다', () => {
    // bio_1은 details가 빈 배열
    expect(getDetailById('biology', 'bio_1', 'bio_1_1')).toBeNull();
  });

  it('잘못된 과목 ID는 null을 반환한다', () => {
    expect(getDetailById('invalid', 'bio_3', 'bio_3_1')).toBeNull();
  });

  it('잘못된 챕터 ID는 null을 반환한다', () => {
    expect(getDetailById('biology', 'bio_99', 'bio_99_1')).toBeNull();
  });

  it('존재하지 않는 세부항목 ID는 null을 반환한다', () => {
    expect(getDetailById('biology', 'bio_3', 'bio_3_99')).toBeNull();
  });
});

// ─── formatChapterLabel ───

describe('formatChapterLabel', () => {
  it('chapterId 없으면 "미설정" 반환', () => {
    expect(formatChapterLabel('biology')).toBe('미설정');
    expect(formatChapterLabel('biology', undefined)).toBe('미설정');
  });

  it('잘못된 chapterId면 "미설정" 반환', () => {
    expect(formatChapterLabel('biology', 'bio_99')).toBe('미설정');
    expect(formatChapterLabel('invalid', 'bio_1')).toBe('미설정');
  });

  it('챕터만 지정하면 "번호·shortName" 형식', () => {
    expect(formatChapterLabel('biology', 'bio_1')).toBe('1·생명현상의 특성');
    expect(formatChapterLabel('biology', 'bio_12')).toBe('12·신경계');
  });

  it('세부항목까지 지정하면 "번호·detailName" 형식', () => {
    expect(formatChapterLabel('biology', 'bio_3', 'bio_3_1')).toBe('3·물질의 구성 단위');
  });

  it('존재하지 않는 세부항목이면 챕터로 폴백', () => {
    expect(formatChapterLabel('biology', 'bio_3', 'bio_3_99')).toBe('3·생명체의 화학적 이해');
  });

  it('병태생리학 포맷 확인 (챕터 번호가 3부터 시작)', () => {
    expect(formatChapterLabel('pathophysiology', 'patho_3')).toBe('3·세포손상');
    expect(formatChapterLabel('pathophysiology', 'patho_16')).toBe('16·신경계');
  });

  it('미생물학 포맷 확인', () => {
    expect(formatChapterLabel('microbiology', 'micro_1')).toBe('1·미생물과 미생물학');
    expect(formatChapterLabel('microbiology', 'micro_11')).toBe('11·감염병의 예방과 대책');
  });

  it('세부항목이 유효하지만 챕터 ID가 잘못되면 "미설정"', () => {
    expect(formatChapterLabel('biology', 'bio_99', 'bio_3_1')).toBe('미설정');
  });
});

// ─── generateCourseTags ───

describe('generateCourseTags', () => {
  it('생물학 태그: 12개, 올바른 형식', () => {
    const tags = generateCourseTags('biology');
    expect(tags).toHaveLength(12);

    // 첫 번째 태그
    expect(tags[0].value).toBe('1_생명현상의 특성');
    expect(tags[0].label).toBe('#1_생명현상의 특성');

    // 마지막 태그
    expect(tags[11].value).toBe('12_신경계');
    expect(tags[11].label).toBe('#12_신경계');
  });

  it('병태생리학 태그: 13개, 3번 챕터부터 시작', () => {
    const tags = generateCourseTags('pathophysiology');
    expect(tags).toHaveLength(13);

    expect(tags[0].value).toBe('3_세포손상');
    expect(tags[0].label).toBe('#3_세포손상');

    expect(tags[tags.length - 1].value).toBe('16_신경계');
  });

  it('미생물학 태그: 11개', () => {
    const tags = generateCourseTags('microbiology');
    expect(tags).toHaveLength(11);

    expect(tags[0].value).toBe('1_미생물과 미생물학');
    expect(tags[tags.length - 1].value).toBe('11_감염병의 예방과 대책');
  });

  it('null 과목이면 생물학 태그로 폴백한다', () => {
    const tags = generateCourseTags(null);
    const bioTags = generateCourseTags('biology');
    expect(tags).toEqual(bioTags);
  });

  it('존재하지 않는 과목 ID면 빈 배열 반환', () => {
    expect(generateCourseTags('chemistry')).toEqual([]);
  });

  it('모든 태그의 label은 "#" + value 형식이다', () => {
    for (const courseId of ['biology', 'pathophysiology', 'microbiology']) {
      const tags = generateCourseTags(courseId);
      tags.forEach((tag) => {
        expect(tag.label).toBe(`#${tag.value}`);
      });
    }
  });

  it('태그 value에 챕터 번호와 shortName이 포함된다', () => {
    const tags = generateCourseTags('biology');
    tags.forEach((tag) => {
      // "번호_이름" 패턴 확인
      expect(tag.value).toMatch(/^\d+_.+$/);
    });
  });
});

// ─── getChapterIdFromTag ───

describe('getChapterIdFromTag', () => {
  it('생물학 태그에서 챕터 ID 역추적', () => {
    expect(getChapterIdFromTag('biology', '1_생명현상의 특성')).toBe('bio_1');
    expect(getChapterIdFromTag('biology', '12_신경계')).toBe('bio_12');
  });

  it('병태생리학 태그에서 챕터 ID 역추적', () => {
    expect(getChapterIdFromTag('pathophysiology', '3_세포손상')).toBe('patho_3');
    expect(getChapterIdFromTag('pathophysiology', '16_신경계')).toBe('patho_16');
  });

  it('미생물학 태그에서 챕터 ID 역추적', () => {
    expect(getChapterIdFromTag('microbiology', '1_미생물과 미생물학')).toBe('micro_1');
    expect(getChapterIdFromTag('microbiology', '11_감염병의 예방과 대책')).toBe('micro_11');
  });

  it('잘못된 과목 ID면 null 반환', () => {
    expect(getChapterIdFromTag('invalid', '1_생명현상의 특성')).toBeNull();
  });

  it('번호 패턴이 없는 태그면 null 반환', () => {
    expect(getChapterIdFromTag('biology', '생명현상의 특성')).toBeNull();
    expect(getChapterIdFromTag('biology', '_생명현상의 특성')).toBeNull();
    expect(getChapterIdFromTag('biology', 'abc_test')).toBeNull();
  });

  it('존재하지 않는 챕터 번호면 null 반환', () => {
    expect(getChapterIdFromTag('biology', '99_없는챕터')).toBeNull();
  });

  it('generateCourseTags와 getChapterIdFromTag 왕복 테스트', () => {
    // 생성된 태그로부터 원래 챕터 ID를 복원할 수 있어야 한다
    for (const courseId of ['biology', 'pathophysiology', 'microbiology']) {
      const index = getCourseIndex(courseId)!;
      const tags = generateCourseTags(courseId);

      tags.forEach((tag, i) => {
        const recoveredId = getChapterIdFromTag(courseId, tag.value);
        expect(recoveredId).toBe(index.chapters[i].id);
      });
    }
  });
});

// ─── 엣지 케이스 & 교차 검증 ───

describe('교차 검증 및 엣지 케이스', () => {
  it('과목 간 챕터 ID가 겹치지 않는다', () => {
    const allIds: string[] = [];
    for (const idx of Object.values(COURSE_INDEXES)) {
      idx.chapters.forEach((ch) => {
        allIds.push(ch.id);
        ch.details.forEach((d) => allIds.push(d.id));
      });
    }
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });

  it('다른 과목의 챕터 ID로 조회하면 null이다', () => {
    // 생물학 ID로 병태생리학 조회
    expect(getChapterById('pathophysiology', 'bio_1')).toBeNull();
    // 미생물학 ID로 생물학 조회
    expect(getChapterById('biology', 'micro_1')).toBeNull();
  });

  it('세부항목이 있는 챕터의 details 길이가 1 이상이다', () => {
    // 생물학 3장은 세부항목 3개
    const bio3 = getChapterById('biology', 'bio_3');
    expect(bio3!.details).toHaveLength(3);

    // 병태생리학 8장 (순환장애)은 세부항목 8개
    const patho8 = getChapterById('pathophysiology', 'patho_8');
    expect(patho8!.details).toHaveLength(8);
  });

  it('세부항목이 없는 챕터의 details는 빈 배열이다', () => {
    // 생물학 1장은 세부항목 없음
    const bio1 = getChapterById('biology', 'bio_1');
    expect(bio1!.details).toEqual([]);
  });

  it('모든 세부항목 ID는 부모 챕터 ID를 접두사로 가진다', () => {
    for (const idx of Object.values(COURSE_INDEXES)) {
      idx.chapters.forEach((ch) => {
        ch.details.forEach((d) => {
          expect(d.id).toMatch(new RegExp(`^${ch.id}_\\d+$`));
        });
      });
    }
  });
});
