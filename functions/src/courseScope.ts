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
import { verifyProfessorAccess } from "./utils/professorAccess";

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

    const { courseId, courseName, scopeContent } = request.data as {
      courseId: string;
      courseName: string;
      scopeContent: string;
    };

    if (!courseId || !courseName || !scopeContent) {
      throw new HttpsError("invalid-argument", "courseId, courseName, scopeContent가 필요합니다.");
    }

    // 교수 권한 + 과목 소유권 확인
    await verifyProfessorAccess(userId, courseId);

    try {
      // 챕터별로 파싱
      const chapters = parseChapters(scopeContent);

      if (chapters.length === 0) {
        throw new HttpsError("invalid-argument", "파싱된 챕터가 없습니다.");
      }

      // 챕터 간 공통 단어 제거 (노이즈 방지)
      removeCommonKeywords(chapters);

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

  // ## 숫자. 또는 ## 숫자장. 또는 ## Chapter 숫자. 패턴으로 챕터 구분
  // 예: ## 3. 세포손상, ## 8장. 순환장애, ## Chapter 01. 미생물과 미생물학
  const chapterRegex = /^##\s*(?:Chapter\s+)?0*(\d+)(?:장)?[.\s]+(.+?)$/gm;
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
 *
 * 1차: 전체 3자+ 한글 단어 추출
 * 2차: 업로드 시 챕터 간 공통 단어(3+챕터 등장)를 제거하여 고유 키워드만 보존
 */
function extractKeywordsFromContent(content: string): string[] {
  const keywords = new Set<string>();

  // 전체 텍스트에서 3자 이상 한글 단어 추출
  const koreanMatches = content.match(/[가-힣]{3,}/g);
  if (koreanMatches) {
    for (const word of koreanMatches) {
      // 조사/어미로 끝나는 형태 제거 (은,는,이,가,을,를,의,에,로,와,과,도,만,까지 등)
      const stem = word.replace(/[은는이가을를의에로와과도만까지서며고]$/, "");
      if (stem.length >= 3) keywords.add(stem);
      if (word.length >= 3) keywords.add(word);
    }
  }

  // 영문+한글 복합 용어 (예: "DNA바이러스", "IgM항체")
  const mixedMatches = content.match(/[A-Za-z]+[가-힣]{2,}/g);
  if (mixedMatches) {
    for (const word of mixedMatches) {
      keywords.add(word);
    }
  }

  return Array.from(keywords);
}

/**
 * 여러 챕터 간 공통 단어 제거 (3개 이상 챕터에 등장하는 범용어 제외)
 */
function removeCommonKeywords(
  chapters: Omit<ChapterScope, "updatedAt">[]
): void {
  // 단어별 등장 챕터 수 카운트
  const wordChapterCount = new Map<string, number>();
  for (const ch of chapters) {
    const uniqueWords = new Set(ch.keywords);
    for (const word of uniqueWords) {
      wordChapterCount.set(word, (wordChapterCount.get(word) || 0) + 1);
    }
  }

  // 3개 이상 챕터에 등장하는 단어 제거
  const threshold = Math.min(3, Math.ceil(chapters.length * 0.3));
  for (const ch of chapters) {
    ch.keywords = ch.keywords.filter(
      (w) => (wordChapterCount.get(w) || 0) < threshold
    );
  }
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
interface LoadScopeOptions {
  /**
   * true 이면 targetChapters 가 비어있을 때 scope 를 반환하지 않음 (null).
   * false/미지정(레거시) 이면 targetChapters 없을 때 전체 챕터를 로드 — 이 경우
   * 1장부터 순차로 채우다가 maxLength 초과 시 1장 일부만 실리는 부작용이 있어
   * 질문과 무관한 챕터로 답변 품질이 떨어짐. 신규 호출은 strict=true 권장.
   */
  strict?: boolean;
}

export async function loadScopeForAI(
  courseId: string,
  targetChapters?: string[],
  maxLength: number = 15000,
  options?: LoadScopeOptions,
): Promise<{ content: string; keywords: string[]; chaptersLoaded: string[] } | null> {
  // strict 모드: targetChapters 가 비어있으면 전체 로드 대신 null 반환.
  // 질문과 무관한 1장만 "(일부)" 로 실리는 부작용 방지.
  if (options?.strict && (!targetChapters || targetChapters.length === 0)) {
    return null;
  }

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
      { num: "1", names: ["미생물과 미생물학", "미생물 개론", "미생물학의 역사"] },
      { num: "2", names: ["숙주면역반응", "면역계통", "선천면역", "후천면역"] },
      { num: "3", names: ["감염과 발병", "감염의 성립", "감염의 경과"] },
      { num: "4", names: ["세균의 일반적인 성질", "세균 분류", "세균 구조", "항균제"] },
      { num: "5", names: ["병원성 세균", "그람양성", "그람음성", "미코박테륨", "스피로헤타"] },
      { num: "6", names: ["바이러스의 일반적 성질", "바이러스 분류", "항바이러스제"] },
      { num: "7", names: ["병원성 바이러스", "DNA 바이러스", "RNA 바이러스", "간염바이러스", "프리온"] },
      { num: "8", names: ["진균의 일반적 성질", "진균", "항진균제"] },
      { num: "9", names: ["병원성 진균", "진균증", "피부진균증"] },
      { num: "10", names: ["원충", "원충 감염병", "항원충제", "병원성 원충"] },
      { num: "11", names: ["감염병의 예방과 대책", "감염병 예방", "감염병 대책"] },
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

// ============================================================
// 기존 게시글 chapterTags 소급 적용
// ============================================================

/** 과목별 챕터 핵심 키워드 (내장) */
const CHAPTER_KEYWORDS: Record<string, Record<string, string[]>> = {
  microbiology: {
    "2": ["면역", "항체", "항원", "igm", "igg", "iga", "ige", "면역글로불린", "b세포", "t세포", "림프구", "대식세포", "보체", "선천면역", "후천면역", "적응면역", "세포면역", "체액면역", "백신", "예방접종", "mhc", "사이토카인", "인터류킨", "인터페론", "nk세포", "수지상세포", "호중구", "과민반응", "자가면역", "면역결핍", "옵소닌", "형질세포", "기억세포", "아나필락시스", "능동면역", "수동면역"],
    "3": ["감염", "발병", "병원체", "독소", "내독소", "외독소", "감염경로", "수직감염", "수평감염", "비말감염", "잠복기", "전파", "병원성", "독력", "침습", "균혈증", "패혈증", "독혈증", "기회감염", "정상세균총", "코흐", "감염원", "감수성숙주", "감염성립", "공기감염", "접촉감염", "매개체감염", "결핵균", "홍역바이러스", "수두대상포진바이러스", "인플루엔자바이러스", "혈액매개전파", "b형간염바이러스", "c형간염바이러스", "hiv", "사람면역결핍바이러스", "태반경유감염", "산도감염", "모유감염", "감염회로", "병원소", "무증상감염", "지속감염", "잠복감염", "증상감염", "내인감염", "균교대감염", "정상균무리", "전구기", "발병기", "회복기", "비말핵"],
    "4": ["세균", "박테리아", "그람양성", "그람음성", "세포벽", "펩티도글리칸", "편모", "섬모", "캡슐", "포자", "내생포자", "플라스미드", "접합", "형질전환", "형질도입", "이분법", "호기성", "혐기성", "항균제", "항생제", "페니실린", "내성", "그람염색"],
    "5": ["포도알균", "사슬알균", "황색포도알균", "mrsa", "대장균", "살모넬라", "이질", "콜레라", "결핵", "나병", "파상풍", "보툴리눔", "헬리코박터", "클로스트리디움", "디프테리아", "백일해", "수막구균", "임균", "폐렴구균", "클라미디아", "리케차", "매독"],
    "6": ["바이러스", "캡시드", "외피", "핵산", "역전사", "레트로바이러스", "용원", "용균", "항바이러스제", "엔벨로프", "프로파지"],
    "7": ["인플루엔자", "독감", "코로나", "hiv", "aids", "간염", "b형간염", "c형간염", "홍역", "풍진", "수두", "대상포진", "노로", "로타", "광견병", "hpv", "헤르페스", "소아마비", "사스", "메르스"],
    "8": ["진균", "곰팡이", "효모", "균사", "분생자", "항진균제"],
    "9": ["칸디다", "아스페르길루스", "크립토코쿠스", "무좀", "백선", "피부사상균", "암포테리신"],
    "10": ["원충", "말라리아", "톡소플라스마", "아메바", "트리코모나스", "기생충", "편모충", "이질아메바"],
    "11": ["감염병", "법정감염병", "격리", "소독", "멸균", "검역", "역학", "유행", "팬데믹", "감염관리", "손위생"],
  },
  biology: {
    "2": ["세포", "세포막", "소포체", "리보솜", "미토콘드리아", "골지체", "핵", "세포골격", "원핵", "진핵"],
    "3": ["탄수화물", "단백질", "지질", "핵산", "아미노산", "ph", "삼투압"],
    "4": ["소화", "영양", "물질대사", "효소", "에너지", "atp", "해당", "tca"],
    "5": ["유전", "멘델", "dna", "염색체", "복제", "유전체", "이중나선"],
    "6": ["전사", "번역", "rna", "단백질합성", "코돈", "돌연변이", "유전자발현"],
    "7": ["세포주기", "유사분열", "감수분열", "세포자멸", "아포토시스"],
    "8": ["생식", "발생", "분화", "줄기세포", "배아", "수정"],
    "9": ["조직", "상피조직", "결합조직", "근육조직", "신경조직", "혈액", "혈구"],
    "10": ["소화계", "호흡계", "비뇨계", "순환계", "심장", "폐", "신장"],
    "11": ["호르몬", "내분비", "갑상선", "부신", "인슐린", "글루카곤", "뇌하수체", "항상성"],
    "12": ["신경", "뉴런", "시냅스", "신경전달물질", "중추신경", "말초신경", "활동전위"],
  },
  pathophysiology: {
    "3": ["세포손상", "괴사", "세포자멸", "비대", "증식", "위축", "화생", "이형성"],
    "4": ["염증", "급성염증", "만성염증", "부종", "삼출"],
    "5": ["혈역학", "혈전", "색전", "경색", "출혈", "쇼크"],
    "7": ["종양", "암", "양성종양", "악성종양", "전이", "발암"],
    "8": ["감염", "세균감염", "바이러스감염"],
    "9": ["면역", "과민반응", "자가면역", "면역결핍"],
    "10": ["유전질환", "염색체이상"],
    "11": ["환경", "영양장애", "비만"],
  },
};

/** 과목별 챕터 shortName 매핑 */
const CHAPTER_NAMES: Record<string, Record<string, string>> = {
  microbiology: {
    "2": "숙주면역반응", "3": "감염과 발병", "4": "세균", "5": "병원성 세균",
    "6": "바이러스", "7": "병원성 바이러스", "8": "진균", "9": "병원성 진균",
    "10": "원충", "11": "감염병",
  },
  biology: {
    "2": "세포의 특성", "3": "생명체의 화학적 이해", "4": "영양과 물질대사",
    "5": "유전과 분자생물학", "6": "유전자의 발현과 조절", "7": "세포의 주기와 죽음",
    "8": "생식·발생·분화", "9": "동물의 조직", "10": "동물의 기관",
    "11": "내분비계", "12": "신경계",
  },
  pathophysiology: {
    "3": "세포손상", "4": "염증", "5": "혈역학장애", "7": "종양",
    "8": "감염", "9": "면역", "10": "유전", "11": "환경",
  },
};

/**
 * 텍스트에서 챕터 자동 추천 (서버 사이드)
 */
function detectChaptersServer(courseId: string, text: string): string[] {
  const courseKw = CHAPTER_KEYWORDS[courseId];
  const courseNames = CHAPTER_NAMES[courseId];
  if (!courseKw || !courseNames) return [];

  const lowerText = text.toLowerCase();
  const scores = new Map<string, number>();

  for (const [chNum, keywords] of Object.entries(courseKw)) {
    let score = 0;
    for (const kw of keywords) {
      if (kw.length >= 2 && lowerText.includes(kw)) {
        score++;
      }
    }
    if (score > 0) scores.set(chNum, score);
  }

  if (scores.size === 0) return [];

  const sorted = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);

  // 1개 이상 매칭이면 태그 생성
  return sorted
    .filter(([, s]) => s >= 1)
    .map(([chNum]) => {
      const name = courseNames[chNum] || chNum;
      return `${chNum}_${name}`;
    });
}

/**
 * 기존 게시글에 chapterTags 소급 적용 (교수 전용)
 *
 * 모든 게시글의 제목+본문을 분석하여 chapterTags를 자동 부여
 */
export const backfillChapterTags = onCall(
  {
    region: "asia-northeast3",
    timeoutSeconds: 300,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { courseId } = request.data as { courseId: string };
    if (!courseId) {
      throw new HttpsError("invalid-argument", "courseId가 필요합니다.");
    }

    await verifyProfessorAccess(request.auth.uid, courseId);

    const db = getFirestore();
    const postsSnap = await db
      .collection("courses").doc(courseId)
      .collection("posts")
      .get();

    let updated = 0;
    let skipped = 0;
    const batch = db.batch();

    for (const doc of postsSnap.docs) {
      const data = doc.data();
      const text = `${data.title || ""} ${data.content || ""}`;
      const detected = detectChaptersServer(courseId, text);

      if (detected.length > 0) {
        batch.update(doc.ref, { chapterTags: detected });
        updated++;
      } else {
        skipped++;
      }
    }

    await batch.commit();

    console.log(`[chapterTags 소급] ${courseId}: ${updated}개 태그 부여, ${skipped}개 스킵 (총 ${postsSnap.size}개)`);

    return { success: true, total: postsSnap.size, updated, skipped };
  }
);
