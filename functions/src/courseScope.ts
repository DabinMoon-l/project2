/**
 * 과목 범위(Scope) 관리 시스템
 *
 * 각 과목의 전체 학습 범위를 Firestore에 저장하고
 * AI 문제 생성 시 활용합니다.
 *
 * 구조:
 * - courseScopes/{courseId}
 *   - courseName, totalChapters, updatedAt
 *   - chapters/{chapterId}
 *     - chapterNumber, chapterName, content, keywords
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ============================================================
// 타입 정의
// ============================================================

export interface ChapterScope {
  chapterId: string;
  chapterNumber: string;
  chapterName: string;
  content: string;           // 챕터 전체 내용
  keywords: string[];        // 주요 키워드
  wordCount: number;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface CourseScope {
  courseId: string;
  courseName: string;
  totalChapters: number;
  totalWordCount: number;
  availableChapters: string[];  // 챕터 번호 목록
  updatedAt: FirebaseFirestore.Timestamp;
}

// ============================================================
// 과목 범위 업로드 (교수 전용)
// ============================================================

/**
 * 과목 범위 업로드 (Callable Function)
 *
 * scope.md 파일 내용을 챕터별로 파싱하여 Firestore에 저장
 *
 * @param data.courseId - 과목 ID
 * @param data.courseName - 과목명
 * @param data.scopeContent - scope.md 전체 내용
 */
export const uploadCourseScope = onCall(
  {
    region: "asia-northeast3",
    memory: "1GiB",
    timeoutSeconds: 300,
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const db = getFirestore();
    const userId = request.auth.uid;

    // 교수 권한 확인
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 범위를 업로드할 수 있습니다.");
    }

    const { courseId, courseName, scopeContent } = request.data as {
      courseId: string;
      courseName: string;
      scopeContent: string;
    };

    if (!courseId || !courseName || !scopeContent) {
      throw new HttpsError("invalid-argument", "courseId, courseName, scopeContent가 필요합니다.");
    }

    try {
      // 챕터별로 파싱
      const chapters = parseChapters(scopeContent);

      if (chapters.length === 0) {
        throw new HttpsError("invalid-argument", "파싱된 챕터가 없습니다.");
      }

      const batch = db.batch();
      const scopeRef = db.collection("courseScopes").doc(courseId);

      // 메인 문서 저장
      const scopeData: Omit<CourseScope, "updatedAt"> & { updatedAt: FieldValue } = {
        courseId,
        courseName,
        totalChapters: chapters.length,
        totalWordCount: chapters.reduce((sum, c) => sum + c.wordCount, 0),
        availableChapters: chapters.map(c => c.chapterNumber),
        updatedAt: FieldValue.serverTimestamp(),
      };
      batch.set(scopeRef, scopeData);

      // 챕터별 저장
      for (const chapter of chapters) {
        const chapterRef = scopeRef.collection("chapters").doc(chapter.chapterId);
        batch.set(chapterRef, {
          ...chapter,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      await batch.commit();

      console.log(`[Scope 업로드] ${courseName}: ${chapters.length}개 챕터, ${scopeData.totalWordCount}자`);

      return {
        success: true,
        courseId,
        chaptersCount: chapters.length,
        totalWordCount: scopeData.totalWordCount,
        chapters: chapters.map(c => ({
          chapterNumber: c.chapterNumber,
          chapterName: c.chapterName,
          wordCount: c.wordCount,
        })),
      };
    } catch (error) {
      console.error("Scope 업로드 오류:", error);
      throw new HttpsError(
        "internal",
        error instanceof Error ? error.message : "범위 업로드 중 오류가 발생했습니다."
      );
    }
  }
);

/**
 * Markdown 내용을 챕터별로 파싱
 */
function parseChapters(content: string): Omit<ChapterScope, "updatedAt">[] {
  const chapters: Omit<ChapterScope, "updatedAt">[] = [];

  // ## 숫자. 또는 ## 숫자장. 패턴으로 챕터 구분
  // 예: ## 3. 세포손상, ## 8장. 순환장애
  const chapterRegex = /^##\s*(\d+)(?:장)?[.\s]+(.+?)$/gm;
  const matches = [...content.matchAll(chapterRegex)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const chapterNumber = match[1];
    const chapterName = match[2].trim();
    const startIndex = match.index!;
    const endIndex = i < matches.length - 1 ? matches[i + 1].index! : content.length;

    const chapterContent = content.slice(startIndex, endIndex).trim();
    const wordCount = chapterContent.length;

    // 키워드 추출 (⭐ 표시된 항목, 굵은 글씨 등)
    const keywords = extractKeywordsFromContent(chapterContent);

    chapters.push({
      chapterId: `ch_${chapterNumber}`,
      chapterNumber,
      chapterName,
      content: chapterContent,
      keywords,
      wordCount,
    });
  }

  return chapters;
}

/**
 * 챕터 내용에서 키워드 추출
 */
function extractKeywordsFromContent(content: string): string[] {
  const keywords = new Set<string>();

  // **굵은 글씨** 추출
  const boldMatches = content.matchAll(/\*\*([^*]+)\*\*/g);
  for (const match of boldMatches) {
    const term = match[1].trim();
    if (term.length >= 2 && term.length <= 30 && !/^\d+$/.test(term)) {
      keywords.add(term);
    }
  }

  // ⭐ 표시된 섹션 제목 추출
  const starMatches = content.matchAll(/⭐+\s*(?:\(\d+\))?\s*(.+?)(?:\n|$)/g);
  for (const match of starMatches) {
    const term = match[1].trim().replace(/[()]/g, "");
    if (term.length >= 2 && term.length <= 50) {
      keywords.add(term);
    }
  }

  return Array.from(keywords).slice(0, 100);  // 최대 100개
}

// ============================================================
// 과목 범위 조회
// ============================================================

/**
 * 과목 범위 조회 (Callable Function)
 *
 * 특정 과목의 전체 또는 특정 챕터 범위 조회
 */
export const getCourseScope = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { courseId, chapterNumbers } = request.data as {
      courseId: string;
      chapterNumbers?: string[];  // 특정 챕터만 조회 시
    };

    if (!courseId) {
      throw new HttpsError("invalid-argument", "courseId가 필요합니다.");
    }

    const db = getFirestore();
    const scopeRef = db.collection("courseScopes").doc(courseId);
    const scopeDoc = await scopeRef.get();

    if (!scopeDoc.exists) {
      return {
        exists: false,
        courseId,
      };
    }

    const scopeData = scopeDoc.data() as CourseScope;

    // 특정 챕터만 조회
    if (chapterNumbers && chapterNumbers.length > 0) {
      const chaptersData: ChapterScope[] = [];

      for (const chapterNum of chapterNumbers) {
        const chapterDoc = await scopeRef
          .collection("chapters")
          .doc(`ch_${chapterNum}`)
          .get();

        if (chapterDoc.exists) {
          chaptersData.push(chapterDoc.data() as ChapterScope);
        }
      }

      return {
        exists: true,
        courseId,
        courseName: scopeData.courseName,
        totalChapters: scopeData.totalChapters,
        requestedChapters: chaptersData,
      };
    }

    // 전체 챕터 목록 (내용 제외)
    const chaptersSnapshot = await scopeRef.collection("chapters").get();
    const chaptersList = chaptersSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        chapterId: data.chapterId,
        chapterNumber: data.chapterNumber,
        chapterName: data.chapterName,
        wordCount: data.wordCount,
        keywordsCount: data.keywords?.length || 0,
      };
    });

    return {
      exists: true,
      courseId,
      courseName: scopeData.courseName,
      totalChapters: scopeData.totalChapters,
      totalWordCount: scopeData.totalWordCount,
      availableChapters: scopeData.availableChapters,
      chapters: chaptersList,
    };
  }
);

// ============================================================
// 내부 함수: AI 문제 생성용 Scope 로드
// ============================================================

/**
 * AI 문제 생성 시 사용할 Scope 컨텐츠 로드
 *
 * @param courseId - 과목 ID
 * @param targetChapters - 대상 챕터 번호 목록 (없으면 전체)
 * @param maxLength - 최대 문자 수 (기본 15000)
 */
export async function loadScopeForAI(
  courseId: string,
  targetChapters?: string[],
  maxLength: number = 15000
): Promise<{ content: string; keywords: string[]; chaptersLoaded: string[] } | null> {
  const db = getFirestore();
  const scopeRef = db.collection("courseScopes").doc(courseId);
  const scopeDoc = await scopeRef.get();

  if (!scopeDoc.exists) {
    return null;
  }

  const chaptersSnapshot = await scopeRef.collection("chapters").get();

  if (chaptersSnapshot.empty) {
    return null;
  }

  let allContent = "";
  const allKeywords: string[] = [];
  const chaptersLoaded: string[] = [];

  // 챕터 번호 순 정렬
  const sortedChapters = chaptersSnapshot.docs
    .map(doc => doc.data() as ChapterScope)
    .sort((a, b) => parseInt(a.chapterNumber) - parseInt(b.chapterNumber));

  // 대상 챕터 필터링
  const filteredChapters = targetChapters && targetChapters.length > 0
    ? sortedChapters.filter(c => targetChapters.includes(c.chapterNumber))
    : sortedChapters;

  for (const chapter of filteredChapters) {
    // 최대 길이 체크
    if (allContent.length + chapter.content.length > maxLength) {
      // 남은 공간만큼만 추가
      const remaining = maxLength - allContent.length;
      if (remaining > 500) {
        allContent += `\n\n--- ${chapter.chapterNumber}장. ${chapter.chapterName} (일부) ---\n`;
        allContent += chapter.content.slice(0, remaining - 100);
        chaptersLoaded.push(chapter.chapterNumber);
      }
      break;
    }

    allContent += `\n\n--- ${chapter.chapterNumber}장. ${chapter.chapterName} ---\n`;
    allContent += chapter.content;
    allKeywords.push(...chapter.keywords);
    chaptersLoaded.push(chapter.chapterNumber);
  }

  return {
    content: allContent.trim(),
    keywords: [...new Set(allKeywords)],
    chaptersLoaded,
  };
}

/**
 * 업로드된 텍스트에서 관련 챕터 추론
 *
 * 텍스트 내용을 분석하여 어떤 챕터와 관련있는지 추론
 * 1차: Firestore scope 키워드 매칭
 * 2차 (폴백): 짧은 텍스트일 경우 챕터명/shortName 직접 매칭
 */
export async function inferChaptersFromText(
  courseId: string,
  text: string
): Promise<string[]> {
  const db = getFirestore();
  const scopeRef = db.collection("courseScopes").doc(courseId);
  const chaptersSnapshot = await scopeRef.collection("chapters").get();

  const textLower = text.toLowerCase();
  const matchedChapters: { chapterNumber: string; score: number }[] = [];

  // 1차: Firestore scope 챕터 키워드 매칭
  if (!chaptersSnapshot.empty) {
    for (const doc of chaptersSnapshot.docs) {
      const chapter = doc.data() as ChapterScope;
      let score = 0;

      // 챕터명 매칭
      if (textLower.includes(chapter.chapterName.toLowerCase())) {
        score += 10;
      }

      // 키워드 매칭
      for (const keyword of chapter.keywords) {
        if (textLower.includes(keyword.toLowerCase())) {
          score += 1;
        }
      }

      if (score > 0) {
        matchedChapters.push({ chapterNumber: chapter.chapterNumber, score });
      }
    }
  }

  // 점수 높은 순 정렬
  matchedChapters.sort((a, b) => b.score - a.score);

  const topScore = matchedChapters.length > 0 ? matchedChapters[0].score : 0;

  // 최소 점수 기준 (3점 미만은 약한 매칭 → 제외)
  // + 1위 대비 30% 미만 점수는 무관 챕터로 판단하여 제외
  const MIN_SCORE = 3;
  const RATIO_THRESHOLD = 0.3;

  const filtered = matchedChapters.filter(
    c => c.score >= MIN_SCORE && c.score >= topScore * RATIO_THRESHOLD
  );

  // 2차 폴백: scope 매칭 실패 시 코스 인덱스의 챕터명/shortName으로 직접 매칭
  // (짧은 프롬프트 "신경계", "내분비계" 등이 scope 키워드에 없어도 챕터 추론 가능)
  if (filtered.length === 0 && text.trim().length > 0) {
    const indexMatched = inferChaptersFromCourseIndex(courseId, text);
    if (indexMatched.length > 0) {
      console.log(
        `[inferChapters] scope 매칭 실패 → 코스 인덱스 폴백: ${indexMatched.join(",")}`
      );
      return indexMatched;
    }
  }

  console.log(
    `[inferChapters] courseId=${courseId}, ` +
    `전체=${matchedChapters.map(c => `${c.chapterNumber}(${c.score})`).join(",")} → ` +
    `필터=${filtered.map(c => `${c.chapterNumber}(${c.score})`).join(",")}`
  );

  return filtered
    .slice(0, 3)
    .map(c => c.chapterNumber);
}

/**
 * 코스 인덱스(하드코딩)에서 챕터명/shortName/details로 챕터 추론 (폴백용)
 *
 * Firestore scope가 없거나 키워드 매칭이 안 될 때 사용
 */
function inferChaptersFromCourseIndex(
  courseId: string,
  text: string
): string[] {
  // 코스 인덱스 정의 (styledQuizGenerator.ts와 동기화)
  const COURSE_CHAPTERS: Record<string, Array<{ num: string; names: string[] }>> = {
    biology: [
      { num: "1", names: ["생명현상의 특성", "생명현상"] },
      { num: "2", names: ["세포의 특성", "원핵세포", "진핵세포", "세포소기관"] },
      { num: "3", names: ["생명체의 화학적 이해", "화학적 이해", "핵산", "단백질", "탄수화물", "지질"] },
      { num: "4", names: ["영양과 물질대사", "물질대사", "소화", "효소", "에너지대사", "ATP"] },
      { num: "5", names: ["유전과 분자생물학", "유전", "DNA", "멘델", "염색체", "DNA 복제"] },
      { num: "6", names: ["유전자의 발현과 조절", "유전자 발현", "전사", "번역", "코돈", "돌연변이"] },
      { num: "7", names: ["세포의 주기와 죽음", "세포주기", "세포분열", "감수분열", "체세포분열"] },
      { num: "8", names: ["생식", "발생", "분화", "수정", "배엽"] },
      { num: "9", names: ["동물의 조직", "상피조직", "근육조직", "결합조직", "혈액", "혈액형"] },
      { num: "10", names: ["동물의 기관", "소화계", "호흡계", "비뇨계", "순환계", "네프론", "심장"] },
      { num: "11", names: ["내분비계", "호르몬", "항상성", "갑상샘", "뇌하수체"] },
      { num: "12", names: ["신경계", "뉴런", "시냅스", "활동전위", "자율신경", "교감신경", "부교감신경", "신경전달물질"] },
    ],
    pathophysiology: [
      { num: "3", names: ["세포손상", "세포적응", "석회화", "괴사"] },
      { num: "4", names: ["염증", "급성 염증", "만성 염증"] },
      { num: "5", names: ["치유", "재생", "섬유화", "상처 치유"] },
      { num: "7", names: ["면역", "과민반응", "자가면역", "AIDS"] },
      { num: "8", names: ["순환장애", "혈전", "색전", "경색", "쇼크", "부종"] },
      { num: "9", names: ["종양", "암", "양성 종양", "악성 종양"] },
      { num: "10", names: ["호흡기계", "폐질환", "호흡기 질환"] },
      { num: "11", names: ["소화기계", "위장 질환", "간담췌"] },
      { num: "12", names: ["신장계", "사구체", "신부전"] },
      { num: "13", names: ["심혈관계", "심장 질환", "고혈압"] },
      { num: "14", names: ["내분비계", "갑상선", "당뇨병", "부신"] },
      { num: "15", names: ["근골격계", "근육 질환", "골격 질환", "관절"] },
      { num: "16", names: ["신경계", "중추신경", "말초신경", "퇴행성 질환"] },
    ],
    microbiology: [
      { num: "1", names: ["미생물학 개론", "미생물"] },
      { num: "2", names: ["세균학", "세균"] },
      { num: "3", names: ["바이러스학", "바이러스"] },
      { num: "4", names: ["진균학", "진균", "곰팡이"] },
      { num: "5", names: ["기생충학", "기생충"] },
    ],
  };

  const chapters = COURSE_CHAPTERS[courseId];
  if (!chapters) return [];

  const textLower = text.toLowerCase();
  const matched: { num: string; score: number }[] = [];

  for (const ch of chapters) {
    let score = 0;
    for (const name of ch.names) {
      if (textLower.includes(name.toLowerCase())) {
        // 챕터 대표명(첫번째)은 높은 점수, 나머지 키워드는 낮은 점수
        score += name === ch.names[0] ? 10 : 5;
      }
    }
    if (score > 0) {
      matched.push({ num: ch.num, score });
    }
  }

  matched.sort((a, b) => b.score - a.score);
  return matched.slice(0, 3).map(c => c.num);
}

/**
 * 태그 배열에서 챕터 번호 추출
 *
 * 태그 형식: "12_신경계", "11_내분비계" 등
 * 챕터 번호만 추출하여 반환: ["12", "11"]
 *
 * "중간", "기말", "기타" 등 챕터 태그가 아닌 것은 제외
 */
export function extractChapterNumbersFromTags(tags: string[]): string[] {
  const EXCLUDED = new Set(["중간", "기말", "기타"]);
  const chapters: string[] = [];

  for (const tag of tags) {
    if (EXCLUDED.has(tag)) continue;
    // "12_신경계" → "12"
    const match = tag.match(/^(\d+)_/);
    if (match) {
      chapters.push(match[1]);
    }
  }

  return [...new Set(chapters)]; // 중복 제거
}
