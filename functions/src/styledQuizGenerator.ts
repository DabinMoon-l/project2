/**
 * 스타일 기반 AI 문제 생성기
 *
 * 교수 퀴즈 분석 결과(styleProfile, keywords)를 활용하여
 * 교수 출제 스타일에 맞는 문제를 생성합니다.
 *
 * 난이도별 다른 프롬프트 파라미터 적용:
 * - EASY: 기억/이해 중심, 정의 매칭
 * - MEDIUM: 적용/분석, 기전 문제
 * - HARD: 분석/평가, 함정 패턴, 임상 케이스
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";
import type { StyleProfile, KeywordStore } from "./professorQuizAnalysis";
import { loadScopeForAI, inferChaptersFromText } from "./courseScope";
import { analyzeImageRegions } from "./imageRegionAnalysis";
import { processImagesForQuiz, type CroppedImage } from "./imageCropping";

// Gemini API 키
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// ============================================================
// 타입 정의
// ============================================================

export type Difficulty = "easy" | "medium" | "hard";

export interface GeneratedQuestion {
  text: string;
  type?: 'multiple' | 'ox';  // 문제 형식 (기본: multiple)
  choices?: string[];        // 객관식 선지 (ox는 불필요)
  answer: number | number[] | string;   // 객관식: 0-based index 또는 배열(복수정답), OX: 'O' 또는 'X'
  explanation: string;
  choiceExplanations?: string[]; // 각 선지별 해설 (왜 정답/오답인지, 객관식만)
  questionType?: string;    // 문제 유형
  trapPattern?: string;     // 사용된 함정 패턴
  chapterId?: string;       // 챕터 ID (예: "bio_5", "patho_4")
  chapterDetailId?: string; // 세부 챕터 ID (예: "bio_5_1", "patho_4_3")
  // 제시문 (MEDIUM/HARD)
  passage?: string;         // 제시문 텍스트
  // 보기 (HARD)
  bogi?: {
    questionText: string;   // 발문 ("옳은 것만을 <보기>에서 있는 대로 고른 것은?")
    items: Array<{ label: string; content: string }>; // ㄱ, ㄴ, ㄷ 항목
  };
  // 이미지 (HARD - 자동 크롭)
  imageUrl?: string;        // 학습 자료에서 크롭된 이미지 URL
  imageDescription?: string; // 이미지 설명 (그래프, 표, 그림 등)
}

// ============================================================
// 과목별 챕터 인덱스 (프론트엔드 courseIndex.ts와 동기화)
// ============================================================

interface ChapterDetail {
  id: string;
  name: string;
}

interface Chapter {
  id: string;
  name: string;
  shortName: string;
  details: ChapterDetail[];
}

interface CourseIndex {
  courseId: string;
  courseName: string;
  chapters: Chapter[];
}

const BIOLOGY_INDEX: CourseIndex = {
  courseId: "biology",
  courseName: "생물학",
  chapters: [
    { id: "bio_1", name: "1. 생명현상의 특성", shortName: "생명현상의 특성", details: [] },
    { id: "bio_2", name: "2. 세포의 특성", shortName: "세포의 특성", details: [] },
    { id: "bio_3", name: "3. 생명체의 화학적 이해", shortName: "생명체의 화학적 이해", details: [
      { id: "bio_3_1", name: "물질의 구성 단위" },
      { id: "bio_3_2", name: "생명을 유지하는 기본 물질" },
      { id: "bio_3_3", name: "생체의 구성 물질" },
    ]},
    { id: "bio_4", name: "4. 영양과 물질대사", shortName: "영양과 물질대사", details: [
      { id: "bio_4_1", name: "영양의 섭취 - 소화" },
      { id: "bio_4_2", name: "물질대사" },
      { id: "bio_4_3", name: "효소" },
      { id: "bio_4_4", name: "에너지대사" },
    ]},
    { id: "bio_5", name: "5. 유전과 분자생물학", shortName: "유전과 분자생물학", details: [
      { id: "bio_5_1", name: "유전 현상 - 멘델 법칙" },
      { id: "bio_5_2", name: "유전 물질의 탐구 - DNA" },
      { id: "bio_5_3", name: "유전체와 염색체" },
      { id: "bio_5_4", name: "DNA의 복제" },
    ]},
    { id: "bio_6", name: "6. 유전자의 발현과 조절", shortName: "유전자의 발현과 조절", details: [
      { id: "bio_6_1", name: "유전 정보의 발현" },
      { id: "bio_6_2", name: "복구와 재조합" },
      { id: "bio_6_3", name: "돌연변이" },
    ]},
    { id: "bio_7", name: "7. 세포의 주기와 죽음", shortName: "세포의 주기와 죽음", details: [
      { id: "bio_7_1", name: "세포 주기와 그 조절" },
      { id: "bio_7_2", name: "체세포 분열" },
      { id: "bio_7_3", name: "감수 분열" },
      { id: "bio_7_4", name: "세포의 죽음" },
    ]},
    { id: "bio_8", name: "8. 생식·발생·분화", shortName: "생식·발생·분화", details: [
      { id: "bio_8_1", name: "생물의 증식 양상" },
      { id: "bio_8_2", name: "동물의 발생" },
      { id: "bio_8_3", name: "분화 및 재생" },
    ]},
    { id: "bio_9", name: "9. 동물의 조직", shortName: "동물의 조직", details: [
      { id: "bio_9_1", name: "동물의 조직" },
      { id: "bio_9_2", name: "혈액" },
    ]},
    { id: "bio_10", name: "10. 동물의 기관", shortName: "동물의 기관", details: [
      { id: "bio_10_1", name: "소화계" },
      { id: "bio_10_2", name: "호흡계" },
      { id: "bio_10_3", name: "비뇨계" },
      { id: "bio_10_4", name: "순환계" },
    ]},
    { id: "bio_11", name: "11. 내분비계", shortName: "내분비계", details: [
      { id: "bio_11_1", name: "생체 조절과 호르몬" },
      { id: "bio_11_2", name: "내분비기관에서 분비되는 호르몬" },
      { id: "bio_11_3", name: "호르몬의 분비 조절" },
      { id: "bio_11_4", name: "호르몬에 의한 항상성 유지" },
    ]},
    { id: "bio_12", name: "12. 신경계", shortName: "신경계", details: [
      { id: "bio_12_1", name: "신경계의 구성" },
      { id: "bio_12_2", name: "말초 신경계와 신경 전달 경로" },
      { id: "bio_12_3", name: "뉴런에서의 신경 흥분 경로" },
      { id: "bio_12_4", name: "신경 간 전달과 신경 전달 물질" },
    ]},
  ],
};

const PATHOPHYSIOLOGY_INDEX: CourseIndex = {
  courseId: "pathophysiology",
  courseName: "병태생리학",
  chapters: [
    { id: "patho_3", name: "3. 세포손상", shortName: "세포손상", details: [
      { id: "patho_3_1", name: "세포 적응" },
      { id: "patho_3_2", name: "가역적 세포 손상과 석회화" },
      { id: "patho_3_3", name: "비가역적 세포 손상" },
    ]},
    { id: "patho_4", name: "4. 염증", shortName: "염증", details: [
      { id: "patho_4_1", name: "혈액과 혈구" },
      { id: "patho_4_2", name: "염증의 기본 증후" },
      { id: "patho_4_3", name: "급성 염증" },
      { id: "patho_4_4", name: "만성 염증" },
      { id: "patho_4_5", name: "염증의 화학 매개 물질과 염증 세포" },
    ]},
    { id: "patho_5", name: "5. 치유", shortName: "치유", details: [
      { id: "patho_5_1", name: "세포 환경과 증식" },
      { id: "patho_5_2", name: "재생과 재생 능력에 따른 세포 분류" },
      { id: "patho_5_3", name: "피부의 상처 치유와 섬유화" },
    ]},
    { id: "patho_7", name: "7. 면역", shortName: "면역", details: [
      { id: "patho_7_1", name: "생물학적 면역체계" },
      { id: "patho_7_2", name: "면역체계의 분류" },
      { id: "patho_7_3", name: "과민반응" },
      { id: "patho_7_4", name: "자가면역질환과 AIDS" },
      { id: "patho_7_5", name: "이식면역" },
    ]},
    { id: "patho_8", name: "8. 순환장애", shortName: "순환장애", details: [
      { id: "patho_8_1", name: "충혈과 울혈" },
      { id: "patho_8_2", name: "허혈" },
      { id: "patho_8_3", name: "출혈과 지혈" },
      { id: "patho_8_4", name: "혈전" },
      { id: "patho_8_5", name: "색전" },
      { id: "patho_8_6", name: "경색" },
      { id: "patho_8_7", name: "쇼크" },
      { id: "patho_8_8", name: "부종" },
    ]},
    { id: "patho_9", name: "9. 종양", shortName: "종양", details: [
      { id: "patho_9_1", name: "종양의 용어와 분류" },
      { id: "patho_9_2", name: "양성 종양과 악성 종양" },
      { id: "patho_9_3", name: "암의 등급과 병기" },
      { id: "patho_9_4", name: "종양 발생론" },
      { id: "patho_9_5", name: "종양의 진단" },
    ]},
    { id: "patho_10", name: "10. 호흡기계", shortName: "호흡기계", details: [
      { id: "patho_10_1", name: "상부 호흡기 질환" },
      { id: "patho_10_2", name: "하부 호흡기 질환" },
      { id: "patho_10_3", name: "폐질환" },
    ]},
    { id: "patho_11", name: "11. 소화기계", shortName: "소화기계", details: [
      { id: "patho_11_1", name: "식도와 위장 질환" },
      { id: "patho_11_2", name: "장 질환" },
      { id: "patho_11_3", name: "간담췌 질환" },
    ]},
    { id: "patho_12", name: "12. 신장계", shortName: "신장계", details: [
      { id: "patho_12_1", name: "사구체 질환" },
      { id: "patho_12_2", name: "세뇨관 및 간질 질환" },
      { id: "patho_12_3", name: "신부전" },
    ]},
    { id: "patho_13", name: "13. 심혈관계", shortName: "심혈관계", details: [
      { id: "patho_13_1", name: "심장 질환" },
      { id: "patho_13_2", name: "혈관 질환" },
      { id: "patho_13_3", name: "고혈압" },
    ]},
    { id: "patho_14", name: "14. 내분비계", shortName: "내분비계", details: [
      { id: "patho_14_1", name: "뇌하수체 질환" },
      { id: "patho_14_2", name: "갑상선 질환" },
      { id: "patho_14_3", name: "부신 질환" },
      { id: "patho_14_4", name: "당뇨병" },
    ]},
    { id: "patho_15", name: "15. 근골격계", shortName: "근골격계", details: [
      { id: "patho_15_1", name: "근육 질환" },
      { id: "patho_15_2", name: "골격 질환" },
      { id: "patho_15_3", name: "관절 질환" },
    ]},
    { id: "patho_16", name: "16. 신경계", shortName: "신경계", details: [
      { id: "patho_16_1", name: "중추신경계 질환" },
      { id: "patho_16_2", name: "말초신경계 질환" },
      { id: "patho_16_3", name: "퇴행성 질환" },
    ]},
  ],
};

const MICROBIOLOGY_INDEX: CourseIndex = {
  courseId: "microbiology",
  courseName: "미생물학",
  chapters: [
    { id: "micro_1", name: "1. 미생물학 개론", shortName: "미생물학 개론", details: [] },
    { id: "micro_2", name: "2. 세균학", shortName: "세균학", details: [] },
    { id: "micro_3", name: "3. 바이러스학", shortName: "바이러스학", details: [] },
    { id: "micro_4", name: "4. 진균학", shortName: "진균학", details: [] },
    { id: "micro_5", name: "5. 기생충학", shortName: "기생충학", details: [] },
  ],
};

// ============================================================
// 과목별 Focus Guide (핵심 출제 포인트)
// ============================================================

const BIOLOGY_FOCUS_GUIDE = `## 생물학 퀴즈 출제 포커스

### 2장. 세포의 특성
- **비교 문제**: 주사전자현미경(SEM) vs 투과전자현미경(TEM)
- **비교 문제**: 원핵세포 vs 진핵세포
- **기능 매칭**: 세포소기관별 역할 (미토콘드리아, 리보솜, 골지체, 소포체)
- **비교 문제**: 수동수송 vs 능동수송

### 3장. 생명체의 화학적 이해
- **물의 특성**: 극성, 응집력, 높은 비열
- **결합 유형**: 공유결합 vs 이온결합 vs 수소결합
- **삼투압**: 저장액 vs 고장액에서 세포 변화
- **당질 분류**: 단당류 → 이당류 → 다당류
- **단백질**: 삼차구조, 단백질 변성
- **(고빈도) 핵산 비교**: DNA vs RNA (당, 염기, 구조, 위치), ATP 구조, 뉴클레오타이드 구조

### 4장. 영양과 대사
- **소화 효소 매칭**: 단백질(펩신), 당질(아밀레이스), 지질(라이페이스)
- **킬로미크론**: 림프관 흡수 경로
- **ATP 구조**: 고에너지 결합 위치
- **효소 조절**: 음성피드백, 알로스테릭, 한정분해
- **(고빈도) 에너지대사 장소**: 해당경로(세포질), TCA회로(미토콘드리아 기질), 산화적 인산화(미토콘드리아 내막)

### 5장. 유전과 DNA
- **용어 구분**: 상동염색체 vs 염색분체
- **멘델 법칙**: 우열, 분리, 독립의 법칙
- **DNA 복제**: helicase, DNA polymerase, DNA ligase 역할
- **(고빈도) 염기 개수 추론**: A=T, G=C 상보적 염기쌍
- **(고빈도) 염색체 용어**: 염색질 → 염색사 → 염색체 → 염색분체

### 6장. 유전자의 발현
- **센트럴 도그마**: DNA → RNA(전사) → 단백질(번역)
- **전사**: RNA 중합효소, 주형가닥 vs 비주형가닥
- **RNA 종류**: mRNA, rRNA, tRNA 역할
- **(고빈도) 유전암호**: 시작코돈(AUG→메티오닌), 종결코돈(UAA, UAG, UGA)
- **(필수 출제) 코돈-아미노산-안티코돈 도출 문제**

### 7장. 세포의 주기와 죽음
- **세포주기**: G₁기, S기(DNA 복제), G₂기, M기
- **핵분열 단계**: 전기 → 중기 → 후기 → 말기
- **(고빈도) 감수분열 비교**: 감수분열 I vs II, 전기I(2가 염색체, 교차), 후기I(상동염색체 분리), 후기II(염색분체 분리)

### 8장. 생식·발생·분화
- **비교 문제**: 유성생식 vs 무성생식
- **발생 순서**: 수정란 → 상실배 → 포배
- **(고빈도) 배엽별 분화**: 외배엽(표피, 신경), 내배엽(내장), 중배엽(결합조직, 근육)
- **정자 구조**: 첨체, 편모, 미토콘드리아 기능
- **(고빈도) 수정 장소**: 팽대부

### 9장. 동물의 조직
- **상피조직**: 내분비샘 vs 외분비샘
- **지지조직**: 뼈조직(조골세포 vs 파골세포), 연골조직(혈관 없음)
- **(고빈도) 근육조직 분류**: 뼈대근육/심장근육/민무늬근육, 수의근 vs 불수의근
- **근육 수축 기전**: Ca²⁺ → 트로포닌 → 트로포미오신 → 액틴-미오신
- **(고빈도) 혈액 구성**: 55% 혈장 + 45% 혈구, 혈장 vs 혈청
- **(고빈도) ABO 혈액형, Rh 부적합**

### 10장. 동물의 기관
- **문맥 개념**: 간문맥
- **(고빈도) 영양소 흡수 경로**: 지용성(림프관), 수용성(간문맥)
- **(고빈도) 가스교환**: 허파(O₂ 결합), 조직(CO₂ → 중탄산이온)
- **심장 자극전달계**: 동방결절 → 방실결절 → 히스다발 → 푸르킨예섬유
- **(고빈도) 네프론**: 토리 여과 → 재흡수 → 분비, 원뇨→소변 변화

### 11장. 내분비계
- **항상성**: 음성 피드백 vs 양성 피드백
- **호르몬 종류**: 펩티드, 스테로이드(지용성), 아민
- **(고빈도) 호르몬 분비 기관 매칭**: 시상하부, 뇌하수체, 갑상샘, 이자, 콩팥위샘
- **항상성 시나리오**: 염분/수분, 혈당량, 체온, 칼슘이온 조절

### 12장. 신경계
- **신호 전달**: 세포체→축삭(전기적), 시냅스(화학적)
- **(고빈도) 도약 전도**: 랑비에결절, 말이집
- **(고빈도) 뇌 구성**: 대뇌, 소뇌, 사이뇌(시상하부-항상성), 중간뇌, 숨뇌
- **(고빈도) 자율신경계**: 교감(노르에피네프린) vs 부교감(아세틸콜린)
- **(고빈도) 활동전위**: 분극(-60mV) → 탈분극(+50mV) → 재분극
- **(고빈도) 신경전달물질**: 아세틸콜린, 노르아드레날린, 세로토닌, 도파민`;

const PATHOPHYSIOLOGY_FOCUS_GUIDE = `## 병태생리학 퀴즈 출제 포커스

(추후 pathophysiologyFocusGuide.md 추가 예정)`;

const MICROBIOLOGY_FOCUS_GUIDE = `## 미생물학 퀴즈 출제 포커스

(추후 microFocusGuide.md 추가 예정)`;

/**
 * 과목 ID로 Focus Guide 가져오기
 */
function getFocusGuide(courseId: string): string | null {
  switch (courseId) {
    case "biology":
      return BIOLOGY_FOCUS_GUIDE;
    case "pathophysiology":
      return PATHOPHYSIOLOGY_FOCUS_GUIDE;
    case "microbiology":
      return MICROBIOLOGY_FOCUS_GUIDE;
    default:
      return null;
  }
}

/**
 * 과목 ID로 챕터 인덱스 가져오기
 */
function getCourseIndex(courseId: string): CourseIndex | null {
  switch (courseId) {
    case "biology":
      return BIOLOGY_INDEX;
    case "pathophysiology":
      return PATHOPHYSIOLOGY_INDEX;
    case "microbiology":
      return MICROBIOLOGY_INDEX;
    default:
      return null;
  }
}

/**
 * 챕터 인덱스를 프롬프트용 텍스트로 변환
 */
function buildChapterIndexPrompt(courseId: string): string {
  const index = getCourseIndex(courseId);
  if (!index) return "";

  let text = `## 챕터 분류 체계 (각 문제에 반드시 할당)\n\n`;
  text += `과목: ${index.courseName}\n\n`;

  for (const chapter of index.chapters) {
    text += `- **${chapter.id}**: ${chapter.name}\n`;
    for (const detail of chapter.details) {
      text += `  - **${detail.id}**: ${detail.name}\n`;
    }
  }

  return text;
}

export interface StyleContext {
  profile: StyleProfile | null;
  keywords: KeywordStore | null;
  scope: {
    content: string;
    keywords: string[];
    chaptersLoaded: string[];
  } | null;
}

// ============================================================
// Scope 로드 헬퍼 (병렬 처리용)
// ============================================================

/**
 * 퀴즈 생성을 위한 Scope 로드 (최적화 버전)
 * 챕터 추론 + 난이도별 확장을 한번에 처리
 */
export async function loadScopeForQuiz(
  courseId: string,
  text: string,
  difficulty: Difficulty
): Promise<{ content: string; keywords: string[]; chaptersLoaded: string[] } | null> {
  try {
    // 텍스트에서 관련 챕터 추론
    const inferredChapters = await inferChaptersFromText(courseId, text);

    let chaptersToLoad = inferredChapters;
    let maxScopeLength = 12000;  // 기본값 줄여서 속도 향상

    // HARD 난이도: 인접 챕터 확장
    if (difficulty === "hard" && inferredChapters.length > 0) {
      const expandedChapters = new Set<string>();
      for (const ch of inferredChapters) {
        const num = parseInt(ch);
        if (!isNaN(num)) {
          expandedChapters.add(String(num - 1));
          expandedChapters.add(String(num));
          expandedChapters.add(String(num + 1));
        } else {
          expandedChapters.add(ch);
        }
      }
      chaptersToLoad = Array.from(expandedChapters).filter(ch => parseInt(ch) > 0);
      maxScopeLength = 18000;  // HARD는 좀 더 많이
    }

    // Scope 로드
    const scopeData = await loadScopeForAI(
      courseId,
      chaptersToLoad.length > 0 ? chaptersToLoad : undefined,
      maxScopeLength
    );

    return scopeData;
  } catch (error) {
    console.warn("[Scope 로드 실패]", error);
    return null;
  }
}

// ============================================================
// 난이도별 프롬프트 빌더
// ============================================================

/**
 * 난이도별 문제 생성 파라미터
 */
const DIFFICULTY_PARAMS = {
  easy: {
    preferredTypes: ["OX", "DEFINITION_MATCH", "CLASSIFICATION"],
    cognitiveLevel: "기억/이해",
    trapStyle: "없음 (명확한 정오 구분)",
    choiceStyle: "명확하게 구분되는 선지",
    stemLength: "짧은 발문 (1-2문장)",
    typeRatio: "OX 30%, 정의 매칭 40%, 분류 20%, 기타 10%",
    allowedFormats: ["multiple", "ox"],  // OX 허용
    allowPassage: false,
    allowBogi: false,
  },
  medium: {
    preferredTypes: ["MECHANISM", "CLASSIFICATION", "COMPARISON"],
    cognitiveLevel: "적용/분석",
    trapStyle: "유사 용어 혼동, 시간 순서 교란",
    choiceStyle: "유사한 개념이 섞인 선지",
    stemLength: "중간 길이 발문 (2-3문장)",
    typeRatio: "기전 40%, 분류 30%, 비교 20%, 기타 10%",
    allowedFormats: ["multiple"],
    allowPassage: true,   // 제시문 허용
    allowBogi: false,
  },
  hard: {
    preferredTypes: ["NEGATIVE", "MULTI_SELECT", "CLINICAL_CASE", "MECHANISM", "BOGI_SELECT"],
    cognitiveLevel: "분석/평가",
    trapStyle: "정상비정상 뒤집기, 수치방향 뒤집기, 부분전체 혼동",
    choiceStyle: "미묘한 차이가 있는 선지, 복수 정답 가능성",
    stemLength: "긴 발문 또는 케이스 시나리오",
    typeRatio: "부정형 25%, 보기문제 20%, 임상케이스 20%, 다중선택 20%, 기전 15%",
    allowedFormats: ["multiple"],
    allowPassage: true,   // 제시문 허용
    allowBogi: true,      // 보기 허용
    allowMultipleAnswers: true, // 복수정답 허용
  },
};

/**
 * 스타일 프로필 기반 프롬프트 조각 생성
 */
function buildStyleContextPrompt(context: StyleContext): string {
  if (!context.profile) {
    return "";
  }

  const { profile, keywords } = context;

  let styleSection = `
## 교수님 출제 스타일 (분석된 ${profile.analyzedQuestionCount}개 문제 기반)

### 자주 출제하는 문제 유형
`;

  // 유형 분포 (상위 5개)
  const sortedTypes = Object.entries(profile.typeDistribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  for (const [type, count] of sortedTypes) {
    const percentage = Math.round((count / profile.analyzedQuestionCount) * 100);
    styleSection += `- ${type}: ${percentage}%\n`;
  }

  // 톤 특성
  styleSection += `
### 출제 특성
- "옳지 않은 것" 유형: ${profile.toneCharacteristics.usesNegative ? "자주 사용" : "드물게 사용"}
- "모두 고르기" 유형: ${profile.toneCharacteristics.usesMultiSelect ? "자주 사용" : "드물게 사용"}
- 임상 케이스: ${profile.toneCharacteristics.hasClinicalCases ? "포함" : "거의 없음"}
- 발문 길이: ${profile.toneCharacteristics.preferredStemLength === "short" ? "짧음" : profile.toneCharacteristics.preferredStemLength === "long" ? "긴 편" : "중간"}
`;

  // 함정 패턴 (상위 3개)
  if (profile.trapPatterns.length > 0) {
    styleSection += `
### 자주 사용하는 함정 패턴
`;
    const topTraps = profile.trapPatterns
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 3);

    for (const trap of topTraps) {
      styleSection += `- ${trap.pattern} (${trap.frequency}회): 예) "${trap.examples[0]}..."\n`;
    }
  }

  // 교수 문제에서 추출된 키워드
  if (keywords && keywords.mainConcepts.length > 0) {
    const topConcepts = keywords.mainConcepts
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10)
      .map((k) => k.term);

    styleSection += `
### 시험에 자주 나오는 핵심 개념
${topConcepts.join(", ")}
`;

    // 임상 단서도 추가
    if (keywords.caseTriggers && keywords.caseTriggers.length > 0) {
      const topCaseTriggers = keywords.caseTriggers
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 8)
        .map((k) => k.term);

      styleSection += `
### 케이스 문제에 자주 등장하는 임상 단서
${topCaseTriggers.join(", ")}
`;
    }
  }

  return styleSection;
}

/**
 * 난이도별 프롬프트 생성
 */
function buildDifficultyPrompt(
  difficulty: Difficulty,
  context: StyleContext
): string {
  const params = DIFFICULTY_PARAMS[difficulty];
  const profile = context.profile;

  // 해당 난이도에서 교수가 선호하는 유형 (있으면)
  let preferredTypes = params.preferredTypes;
  if (profile && profile.difficultyTypeMap[difficulty.toUpperCase() as "EASY" | "MEDIUM" | "HARD"]) {
    const profTypes = profile.difficultyTypeMap[difficulty.toUpperCase() as "EASY" | "MEDIUM" | "HARD"];
    if (profTypes.length > 0) {
      preferredTypes = profTypes;
    }
  }

  // 난이도별 특수 형식 안내
  let formatInstructions = "";

  if (difficulty === "easy") {
    formatInstructions = `
### OX 문제 형식 (쉬움 난이도 전용)
- 일부 문제를 OX 형식으로 출제할 수 있습니다.
- OX 문제는 "type": "ox", "answer": "O" 또는 "X"로 설정
- choices와 choiceExplanations는 생략
- 명확한 참/거짓 판단이 가능한 진술로 구성`;
  }

  if (params.allowPassage) {
    formatInstructions += `
### 제시문 사용 (선택적)
- 일부 문제에 제시문(passage)을 추가할 수 있습니다.
- 제시문은 문제를 풀기 위한 배경 정보나 자료를 제공합니다.
- "passage": "제시문 내용"으로 추가`;
  }

  if (params.allowBogi) {
    formatInstructions += `
### 보기 문제 형식 (어려움 난이도 전용)
- 보기(ㄱ,ㄴ,ㄷ) 형식 문제를 출제할 수 있습니다.
- "bogi": { "questionText": "옳은 것만을 <보기>에서 있는 대로 고른 것은?", "items": [{"label": "ㄱ", "content": "내용1"}, {"label": "ㄴ", "content": "내용2"}, {"label": "ㄷ", "content": "내용3"}] }
- 선지는 "ㄱ", "ㄴ", "ㄱ,ㄴ", "ㄴ,ㄷ", "ㄱ,ㄴ,ㄷ" 등의 조합으로 구성

### 복수정답 문제 형식 (어려움 난이도 전용)
- 정답이 2개 이상인 문제를 출제할 수 있습니다.
- "answer": [0, 2] 형식으로 여러 정답 인덱스를 배열로 지정
- 발문에 "옳은 것을 모두 고르시오" 또는 "(복수정답)" 표시를 포함하세요
- 모든 문제를 복수정답으로 만들지 말고, 적절한 경우에만 사용하세요 (약 20% 이하)`;
  }

  return `
## 난이도 설정: ${difficulty.toUpperCase()}

### 인지 수준
${params.cognitiveLevel}

### 문제 유형 (우선순위)
${preferredTypes.map((t, i) => `${i + 1}. ${t}`).join("\n")}

### 문제 유형 비율 가이드
${params.typeRatio}

### 발문 스타일
${params.stemLength}

### 선지 스타일
${params.choiceStyle}

### 함정 패턴 사용
${params.trapStyle}
${formatInstructions}
`;
}

/**
 * Scope 컨텍스트 프롬프트 생성
 */
function buildScopeContextPrompt(context: StyleContext): string {
  if (!context.scope || !context.scope.content) {
    return "";
  }

  const { content, chaptersLoaded } = context.scope;

  return `
## 과목 전체 범위 (배경 지식)
> 아래는 이 과목의 전체 학습 범위입니다. 문제 출제 시 이 내용을 기반으로 정확한 개념과 용어를 사용하세요.
> 로드된 챕터: ${chaptersLoaded.join(", ")}장

${content.slice(0, 12000)}
`;
}

/**
 * 최종 문제 생성 프롬프트 조합
 */
export function buildFullPrompt(
  ocrText: string,
  difficulty: Difficulty,
  questionCount: number,
  context: StyleContext,
  courseName: string,
  courseId: string,
  isShortText: boolean = false,
  isVeryShortText: boolean = false,
  availableImages: CroppedImage[] = []
): string {
  const styleContext = buildStyleContextPrompt(context);
  const difficultyPrompt = buildDifficultyPrompt(difficulty, context);
  const scopeContext = buildScopeContextPrompt(context);
  const chapterIndexPrompt = buildChapterIndexPrompt(courseId);
  const focusGuide = getFocusGuide(courseId);

  // Scope가 있으면 "출제 범위"로, 없으면 "학습 자료"로 표현
  const hasScope = !!context.scope?.content;
  const isHard = difficulty === "hard";
  const hasFocusGuide = !!focusGuide;

  // 난이도별 컨텐츠 규칙 설정
  let contentRule: string;
  let uploadedTextLabel: string;

  // 1. 매우 짧은 텍스트 (50자 미만) + FocusGuide 있음: FocusGuide 기반 출제
  if (isVeryShortText && hasFocusGuide) {
    uploadedTextLabel = "키워드/힌트 (선택적)";
    contentRule = `**포커스 가이드 기반 출제 규칙**:
   - '출제 포커스 가이드'에 명시된 핵심 개념 위주로 문제를 출제하세요
   - '키워드/힌트'가 있다면 해당 키워드와 관련된 포커스 가이드 내용을 우선 출제
   - '키워드/힌트'가 비어있거나 짧다면 포커스 가이드 전체에서 골고루 출제
   - '과목 전체 범위'에서 정확한 개념과 용어를 확인하세요`;
  }
  // 2. 매우 짧은 텍스트 + FocusGuide 없음 (과목과 무관): 텍스트 기반 일반 지식 문제
  else if (isVeryShortText && !hasFocusGuide) {
    uploadedTextLabel = "키워드/주제";
    contentRule = `**일반 주제 출제 규칙**:
   - 제공된 '키워드/주제'와 관련된 일반적인 사실을 바탕으로 문제를 출제하세요
   - **중요**: 확실하지 않거나 추측성 내용은 절대 포함하지 마세요
   - 널리 알려진 기본 개념, 정의, 특징만 문제로 만드세요
   - 주제가 불명확하면 제공된 텍스트 그대로 해석해서 출제하세요`;
  }
  // 3. 짧은 텍스트 (50-200자) + Scope 있음: Scope를 주요 출제 자료로 사용
  else if (isShortText && hasScope) {
    uploadedTextLabel = "키워드/힌트 (짧은 학습 자료)";
    contentRule = `**짧은 텍스트 보충 출제 규칙**:
   - 제공된 '키워드/힌트'에서 핵심 개념을 파악하세요
   - '출제 포커스 가이드' > '과목 전체 범위' 순으로 관련 내용을 찾아 문제를 출제하세요
   - 힌트에 언급된 개념을 중심으로 정확한 내용만 문제로 만드세요`;
  }
  // 4. 짧은 텍스트 + Scope 없음: 키워드 기반으로 일반 지식 문제
  else if (isShortText && !hasScope) {
    uploadedTextLabel = "키워드/힌트 (짧은 학습 자료)";
    contentRule = `**키워드 기반 출제 규칙**:
   - 제공된 '키워드/힌트'에서 핵심 개념을 파악하세요
   - 해당 키워드와 관련된 기본적이고 정확한 지식을 바탕으로 문제를 출제하세요
   - **중요**: 확실하지 않은 내용은 절대 지어내지 마세요
   - 기본 개념, 정의, 특징 등 명확한 사실만 문제로 만드세요`;
  }
  // 5. HARD + Scope: 발문은 출제 범위, 선지/보기/제시문은 Scope에서도 활용
  else if (hasScope && isHard) {
    // HARD + Scope: 발문은 출제 범위, 선지/보기/제시문은 Scope에서도 활용
    uploadedTextLabel = "출제 범위 (발문의 핵심 내용)";
    contentRule = `**어려움 난이도 출제 규칙**:
   - **발문(질문)**: 반드시 '출제 범위'에 있는 개념에서 출제
   - **선지/보기/제시문 구성**: '과목 전체 범위'의 관련 챕터에서 유사 개념, 헷갈리는 용어, 연관 내용을 가져와 함정 선지로 활용
   - 예시: 출제 범위가 "염증"이면, 과목 전체 범위의 "면역", "치유" 챕터에서 유사한 개념을 오답 선지로 활용
   - 학생이 관련 챕터 전체를 이해해야 풀 수 있는 통합적 문제 출제`;
  } else if (hasScope) {
    // EASY/MEDIUM + Scope: 출제 범위 내에서만
    uploadedTextLabel = "출제 범위 (이 내용에서만 문제 출제)";
    contentRule = "**출제 범위 내용 기반**: 반드시 '출제 범위'에 있는 내용에서만 문제를 만드세요. '과목 전체 범위'는 정확한 개념과 용어 참고용입니다.";
  } else {
    // Scope 없음
    uploadedTextLabel = "학습 자료";
    contentRule = "**내용 기반**: 위 학습 자료에 있는 내용으로만 문제를 만드세요";
  }

  // HARD 난이도 추가 지침
  const hardModeExtra = isHard && hasScope ? `
## 어려움 난이도 선지 구성 전략

1. **교차 챕터 함정**: 출제 범위와 비슷하지만 다른 챕터의 개념을 오답으로 배치
   - 예: "급성 염증의 특징"을 물을 때, "만성 염증" 또는 "면역 반응"의 특징을 오답으로
2. **유사 용어 혼동**: 과목 전체 범위에서 비슷한 이름의 다른 개념 활용
   - 예: "호중구"를 물을 때, "호산구", "호염기구", "대식세포" 등을 선지로
3. **기전 연결 오류**: 원인-결과 관계를 다른 챕터의 기전과 섞어서 출제
4. **복수 정답 가능성**: 부분적으로 맞는 선지를 배치하여 "가장 적절한 것" 판단 요구
5. **임상 케이스 통합**: 여러 챕터의 지식을 종합해야 풀 수 있는 시나리오 제시
6. **지엽적 내용 허용**: 학습 자료의 세부 내용에서도 문제 출제 가능
` : "";

  // 사용 가능한 이미지 정보 (HARD 난이도 전용)
  let imageSection = "";
  let imageRule = "9. **이미지 참조 금지**: 그림, 도표, 그래프를 참조하는 문제는 생성하지 마세요. 학습자료에 이미지가 있어도 텍스트 기반 문제만 출제하세요";

  if (isHard && availableImages.length > 0) {
    imageSection = `
## 사용 가능한 이미지 (HARD 난이도 전용)
학습 자료에서 추출된 그림/표/그래프입니다. 일부 문제에 이미지를 활용할 수 있습니다.

${availableImages.map((img, idx) => `### 이미지 ${idx + 1}
- URL: ${img.imageUrl}
- 유형: ${img.description || "그림/표"}
- 참조 ID: figure_${idx + 1}
`).join("\n")}
`;
    imageRule = `9. **이미지 활용**: 위 "사용 가능한 이미지" 섹션의 이미지를 일부 문제에 활용할 수 있습니다.
   - 이미지를 참조하는 문제는 "figureId": "figure_N" 형식으로 참조 ID를 지정하세요.
   - 문제의 text에 "다음 그림/표를 보고" 또는 "<그림>"과 같은 참조 문구를 포함하세요.
   - 모든 문제에 이미지를 사용할 필요는 없습니다. 적절한 경우에만 사용하세요.`;
  }

  // 세부 출제 허용 조건: 어려움 난이도 또는 12문제 이상
  const allowDetailedQuestions = isHard || questionCount >= 12;
  // 핵심 집중 조건: 쉬움/보통 난이도 + 8문제 이하
  const isLowQuestionCount = !allowDetailedQuestions && questionCount <= 8;

  // Focus Guide 섹션 (난이도와 문제 수에 따라 핵심 강조도 조절)
  let focusGuideSection = "";
  if (hasFocusGuide) {
    let focusInstruction: string;

    if (allowDetailedQuestions) {
      // 어려움 난이도 또는 12문제 이상: 세부적인 내용도 출제 가능
      const modeLabel = isHard ? "어려움 난이도" : `${questionCount}문제`;
      focusInstruction = `> **세부 출제 허용 (${modeLabel})**:
> - 포커스 가이드의 핵심 개념 + 학습 자료의 세부 내용 모두 출제 가능합니다
> - **(고빈도)**, **(필수 출제)** 개념을 최소 ${Math.round(questionCount * 0.3)}개 포함하세요
> - 나머지는 학습 자료에 명시된 세부 사항, 예외 케이스, 부가 설명에서도 출제 가능
> - 지엽적인 내용도 학습 자료에 근거가 있으면 출제하세요`;
    } else if (isLowQuestionCount) {
      // 5-8문제 (쉬움/보통): 핵심만 출제
      focusInstruction = `> **핵심 집중 모드 (${questionCount}문제)**:
> - 반드시 **(고빈도)**, **(필수 출제)** 표시된 개념에서 ${Math.min(questionCount, 5)}개 이상 출제하세요
> - **비교 문제** (vs), **기능 매칭** 등 핵심 유형을 우선 출제하세요
> - 문제의 주제 자체가 해당 챕터의 핵심 내용이어야 합니다
> - 지엽적인 세부사항, 예외 케이스, 부가 설명 등은 출제하지 마세요
> - 선지 구성도 핵심 개념 간의 구분에 초점을 맞추세요`;
    } else {
      // 9-11문제 (쉬움/보통): 핵심 위주 + 일부 보충
      focusInstruction = `> **핵심 우선 모드 (${questionCount}문제)**:
> - **(고빈도)**, **(필수 출제)** 표시된 개념에서 최소 60% 이상 출제하세요
> - 나머지는 포커스 가이드의 다른 핵심 개념에서 출제하세요
> - 학습 자료에만 있고 포커스 가이드에 없는 지엽적 내용은 가급적 피하세요`;
    }

    focusGuideSection = `
## 출제 포커스 가이드
${focusGuide}

${focusInstruction}
`;
  }

  return `당신은 ${courseName} 과목의 대학 교수입니다.
학생들의 시험을 준비시키기 위한 객관식 문제 ${questionCount}개를 만들어주세요.

${styleContext}
${difficultyPrompt}
${focusGuideSection}
${scopeContext}
${chapterIndexPrompt}
${imageSection}
## ${uploadedTextLabel}
${ocrText.slice(0, 6000)}
${hardModeExtra}
## Step 1: 문제 생성 규칙

1. ${contentRule}
2. **문제 수**: 정확히 ${questionCount}개
3. **선지 수**: 각 문제당 4~5개 (OX 문제 제외)
4. **난이도 일관성**: 모든 문제가 ${difficulty.toUpperCase()} 난이도에 맞아야 합니다
5. **다양성**: 같은 개념을 반복하지 말고 다양한 주제를 다루세요
6. **한국어**: 모든 내용을 한국어로 작성하세요
7. **정확성**: 과목 전체 범위의 개념과 용어를 정확히 사용하세요
8. **챕터 분류 필수**: 각 문제는 위 "챕터 분류 체계"에서 가장 적합한 chapterId와 chapterDetailId를 반드시 할당하세요
${imageRule}
10. **핵심 집중도**: ${allowDetailedQuestions ? "세부 출제 허용 - 핵심 개념 + 학습 자료의 세부 사항 모두 출제 가능합니다." : isLowQuestionCount ? "핵심 집중 - 문제 수가 적으므로 가장 핵심적인 내용만 출제하세요. 지엽적인 내용, 예외 케이스, 세부 사항은 제외합니다." : "핵심 우선 - 핵심 개념 위주로 출제하되, 일부 세부 내용도 포함할 수 있습니다."}

## Step 2: 자기 검증 (필수 - 매우 중요!)
생성한 각 문제에 대해 다음 체크리스트를 **철저히** 수행하세요:

1. **정답 근거 확인**: 정답으로 선택한 보기가 학습자료의 어느 부분에 근거하는지 확인. 학습자료에 명시되지 않은 내용은 정답이 될 수 없음
2. **오답 소거법**: 각 오답 보기가 왜 틀린지 학습자료 기반으로 명확한 근거 확인
3. **함정 검증**: 문제가 "옳은 것"을 묻는지 "틀린 것"을 묻는지, "해당하는 것"인지 "해당하지 않는 것"인지 재확인하고, 정답이 문제의 방향과 일치하는지 점검
4. **사실 정확성**: 모든 선지의 내용이 학술적으로 정확한지 재확인. 틀린 정보를 포함한 선지는 반드시 오답이어야 함
5. **정답 번호 확인**: answer 인덱스가 실제 정답 선지의 위치와 일치하는지 최종 확인
6. **선지별 해설 검증**: 각 선지가 왜 정답/오답인지 설명이 학습자료에 근거하는지 확인

⚠️ **경고**: 틀린 정보를 정답으로 제시하거나, 맞는 정보를 오답으로 제시하면 안 됩니다. 불확실하면 해당 문제를 생성하지 마세요.

검증에서 오류 발견 시 반드시 수정 후 출력하세요.

## Step 3: 출력 형식
반드시 아래 JSON 형식으로만 응답하세요:
{
  "questions": [
    {
      "text": "문제 내용",
      "choices": ["선지1", "선지2", "선지3", "선지4"],
      "answer": 0,
      "explanation": "정답 해설 (왜 이것이 정답인지)",
      "choiceExplanations": [
        "선지1 해설: 정답인 이유 또는 오답인 이유",
        "선지2 해설: 오답인 이유 (구체적으로)",
        "선지3 해설: 오답인 이유 (구체적으로)",
        "선지4 해설: 오답인 이유 (구체적으로)"
      ],
      "questionType": "DEFINITION_MATCH",
      "trapPattern": "유사용어_혼동",
      "chapterId": "bio_5",
      "chapterDetailId": "bio_5_2",
      "figureId": "figure_1"
    },
    {
      "text": "다음 중 옳은 것을 모두 고르시오. (복수정답)",
      "choices": ["선지1", "선지2", "선지3", "선지4", "선지5"],
      "answer": [0, 2],
      "explanation": "정답은 선지1과 선지3입니다. (복수정답 해설)",
      "choiceExplanations": ["정답인 이유", "오답인 이유", "정답인 이유", "오답인 이유", "오답인 이유"],
      "questionType": "MULTI_SELECT",
      "chapterId": "bio_5"
    }
  ]
}

- answer는 0부터 시작하는 인덱스입니다. 복수정답인 경우 배열로 지정 (예: [0, 2]).
- explanation은 정답에 대한 전체 해설입니다.
- choiceExplanations는 각 선지별로 왜 정답/오답인지 설명하는 배열입니다 (선지 순서대로, 필수).
- questionType은 실제 사용한 문제 유형입니다.
- trapPattern은 사용한 함정 패턴이며, 없으면 생략하세요.
- chapterId는 문제가 속하는 챕터 ID입니다 (필수).
- chapterDetailId는 세부 주제 ID입니다 (세부 주제가 있으면 필수, 없으면 생략).
- figureId는 이미지를 참조할 때만 포함하세요 (예: "figure_1"). 이미지가 없으면 생략.`;
}

// ============================================================
// Gemini API 호출
// ============================================================

export async function generateWithGemini(
  prompt: string,
  apiKey: string,
  questionCount: number = 5,
  availableImages: CroppedImage[] = []
): Promise<GeneratedQuestion[]> {
  // 문제 수에 따라 토큰 수 조절 (속도 최적화)
  const estimatedTokensPerQuestion = 350;
  const maxTokens = Math.min(questionCount * estimatedTokensPerQuestion + 500, 4096);

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.5,  // 낮은 temperature = 더 빠른 생성
      topK: 32,
      topP: 0.9,
      maxOutputTokens: maxTokens,
    },
  };

  const startTime = Date.now();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    }
  );

  console.log(`[Gemini API] 응답 시간: ${Date.now() - startTime}ms`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API 오류:", response.status, errorText);

    if (response.status === 429) {
      throw new Error("API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.");
    }
    throw new Error(`Gemini API 오류: ${response.status}`);
  }

  const result = (await response.json()) as any;

  if (!result.candidates?.[0]?.content) {
    throw new Error("AI 응답을 받지 못했습니다.");
  }

  const textContent = result.candidates[0].content.parts
    .filter((p: any) => p.text)
    .map((p: any) => p.text)
    .join("");

  // JSON 추출
  let jsonText = textContent;
  const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonText);

    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error("questions 배열이 없습니다.");
    }

    // 이미지 매핑 (figureId -> imageUrl)
    const imageMap = new Map<string, { url: string; description?: string }>();
    availableImages.forEach((img, idx) => {
      imageMap.set(`figure_${idx + 1}`, {
        url: img.imageUrl,
        description: img.description,
      });
    });

    // 문제 유효성 검사
    const validQuestions: GeneratedQuestion[] = [];
    for (const q of parsed.questions) {
      // 정답 유효성 검사 (단일 정답 또는 복수 정답)
      let isValidAnswer = false;
      if (typeof q.answer === "number") {
        // 단일 정답: 0-indexed
        isValidAnswer = q.answer >= 0 && q.answer < q.choices.length;
      } else if (Array.isArray(q.answer)) {
        // 복수 정답: 모든 인덱스가 유효해야 함
        isValidAnswer = q.answer.length > 0 &&
          q.answer.every((a: number) =>
            typeof a === "number" && a >= 0 && a < q.choices.length
          );
      }

      if (
        q.text &&
        Array.isArray(q.choices) &&
        q.choices.length >= 2 &&
        isValidAnswer
      ) {
        // figureId가 있으면 imageUrl로 매핑
        let imageUrl: string | undefined;
        let imageDescription: string | undefined;
        if (q.figureId && imageMap.has(q.figureId)) {
          const imageInfo = imageMap.get(q.figureId)!;
          imageUrl = imageInfo.url;
          imageDescription = imageInfo.description;
        }

        validQuestions.push({
          text: q.text,
          choices: q.choices,
          answer: q.answer,
          explanation: q.explanation || "",
          choiceExplanations: Array.isArray(q.choiceExplanations) ? q.choiceExplanations : undefined,
          questionType: q.questionType,
          trapPattern: q.trapPattern,
          chapterId: q.chapterId,           // 챕터 ID (Gemini 할당)
          chapterDetailId: q.chapterDetailId, // 세부 챕터 ID (Gemini 할당)
          imageUrl,                          // 크롭된 이미지 URL
          imageDescription,                  // 이미지 설명
        });
      }
    }

    if (validQuestions.length === 0) {
      throw new Error("유효한 문제가 없습니다.");
    }

    return validQuestions;
  } catch (parseError) {
    console.error("JSON 파싱 오류:", parseError);
    throw new Error("AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.");
  }
}

// ============================================================
// Cloud Function
// ============================================================

/**
 * 스타일 기반 AI 문제 생성 (Callable Function)
 *
 * 교수 퀴즈 분석 결과(styleProfile, keywords)를 활용하여
 * 교수 스타일에 맞는 문제 생성
 *
 * @param data.text - OCR 추출된 텍스트 또는 학습 자료
 * @param data.courseId - 과목 ID
 * @param data.difficulty - 난이도 (easy, medium, hard)
 * @param data.questionCount - 생성할 문제 수 (기본값: 5)
 * @param data.images - Base64 이미지 배열 (HARD 난이도 전용, 이미지 크롭에 사용)
 */
export const generateStyledQuiz = onCall(
  {
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
    memory: "1GiB",  // 이미지 처리를 위해 메모리 증가
    timeoutSeconds: 180,  // 이미지 처리 시간 고려하여 증가
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const {
      text,
      courseId = "general",
      courseName = "일반",
      difficulty = "medium",
      questionCount = 5,
      images = [],  // Base64 이미지 배열 (HARD 난이도 전용)
    } = request.data as {
      text: string;
      courseId?: string;
      courseName?: string;
      difficulty?: Difficulty;
      questionCount?: number;
      images?: string[];  // Base64 이미지 배열
    };

    // 텍스트 정리 (빈 문자열도 허용 - focusGuide/scope로 보충)
    const trimmedText = (text || "").trim();

    // 짧은 텍스트 플래그 (200자 미만이면 focusGuide/scope 보충 필요)
    const isShortText = trimmedText.length < 200;

    // 매우 짧은 텍스트 플래그 (50자 미만이면 focusGuide 기반 출제)
    const isVeryShortText = trimmedText.length < 50;

    // API 키 확인
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        "AI 서비스가 설정되지 않았습니다."
      );
    }

    const db = getFirestore();
    const userId = request.auth.uid;

    try {
      // 난이도 유효성 검사 (먼저 수행)
      const validDifficulty: Difficulty = ["easy", "medium", "hard"].includes(difficulty)
        ? difficulty
        : "medium";

      // ========================================
      // 병렬 로드: 스타일 프로필, 키워드, Scope 동시 조회
      // ========================================
      const startTime = Date.now();
      let styleContext: StyleContext = { profile: null, keywords: null, scope: null };

      const analysisRef = db.collection("professorQuizAnalysis").doc(courseId);

      // 병렬로 모든 데이터 로드
      // 짧은 텍스트일 경우 항상 scope 로드 (focusGuide + scope로 보충)
      const shouldLoadScope = isShortText || validDifficulty !== "easy";

      const [profileDoc, keywordsDoc, scopeResult] = await Promise.all([
        // 1. 스타일 프로필
        analysisRef.collection("data").doc("styleProfile").get(),
        // 2. 키워드
        analysisRef.collection("data").doc("keywords").get(),
        // 3. Scope (짧은 텍스트이거나 MEDIUM/HARD 난이도일 때 로드)
        shouldLoadScope
          ? loadScopeForQuiz(courseId, trimmedText || "general", validDifficulty)
          : Promise.resolve(null),
      ]);

      // 결과 적용
      if (profileDoc.exists) {
        styleContext.profile = profileDoc.data() as StyleProfile;
      }
      if (keywordsDoc.exists) {
        styleContext.keywords = keywordsDoc.data() as KeywordStore;
      }
      if (scopeResult) {
        styleContext.scope = scopeResult;
      }

      const loadTime = Date.now() - startTime;
      console.log(`[병렬 로드 완료] ${loadTime}ms - profile=${!!styleContext.profile}, keywords=${!!styleContext.keywords}, scope=${!!styleContext.scope}`);

      // ========================================
      // HARD 난이도: 이미지 영역 분석 및 크롭
      // ========================================
      let croppedImages: CroppedImage[] = [];

      if (validDifficulty === "hard" && images && images.length > 0) {
        console.log(`[이미지 처리] HARD 난이도 - ${images.length}개 이미지 분석 시작`);

        try {
          croppedImages = await processImagesForQuiz(
            images,
            analyzeImageRegions,
            apiKey,
            userId
          );
          console.log(`[이미지 처리 완료] ${croppedImages.length}개 이미지 크롭됨`);
        } catch (imageError) {
          // 이미지 처리 실패해도 문제 생성은 계속 진행
          console.error("[이미지 처리 오류]", imageError);
          console.log("[이미지 처리] 이미지 없이 문제 생성 진행");
        }
      }

      // 유효한 문제 수 (5-20)
      const validQuestionCount = Math.min(Math.max(questionCount, 5), 20);

      // 프롬프트 생성
      const prompt = buildFullPrompt(
        trimmedText,
        validDifficulty,
        validQuestionCount,
        styleContext,
        courseName,
        courseId,
        isShortText,
        isVeryShortText,
        croppedImages  // 크롭된 이미지 전달
      );

      console.log(`[문제 생성 시작] 과목: ${courseName}, 난이도: ${validDifficulty}, 개수: ${validQuestionCount}, 이미지: ${croppedImages.length}개`);

      // Gemini 호출 (문제 수와 이미지 전달)
      const questions = await generateWithGemini(
        prompt,
        apiKey,
        validQuestionCount,
        croppedImages  // 이미지 매핑용
      );

      // 이미지가 포함된 문제 수 계산
      const questionsWithImages = questions.filter(q => q.imageUrl).length;
      if (questionsWithImages > 0) {
        console.log(`[이미지 문제] ${questionsWithImages}개 문제에 이미지 포함됨`);
      }

      // 사용 로그 기록 (비동기 - 응답 블로킹 안함)
      const today = new Date().toISOString().split("T")[0];
      db.collection("styledQuizUsage")
        .doc(userId)
        .collection("daily")
        .doc(today)
        .set(
          {
            count: FieldValue.increment(1),
            lastUsedAt: FieldValue.serverTimestamp(),
            lastCourseId: courseId,
            lastDifficulty: validDifficulty,
            hasImages: croppedImages.length > 0,
          },
          { merge: true }
        )
        .catch((err) => console.warn("사용 로그 기록 실패:", err));

      console.log(`[문제 생성 완료] ${questions.length}개 생성됨`);

      return {
        success: true,
        questions,
        meta: {
          courseId,
          difficulty: validDifficulty,
          hasStyleProfile: !!styleContext.profile,
          hasKeywords: !!styleContext.keywords,
          hasScope: !!styleContext.scope,
          scopeChaptersLoaded: styleContext.scope?.chaptersLoaded || [],
          analyzedQuestionCount: styleContext.profile?.analyzedQuestionCount || 0,
          croppedImagesCount: croppedImages.length,  // 크롭된 이미지 수
          questionsWithImages,  // 이미지 포함 문제 수
        },
      };
    } catch (error) {
      console.error("스타일 기반 문제 생성 오류:", error);
      throw new HttpsError(
        "internal",
        error instanceof Error
          ? error.message
          : "문제 생성 중 오류가 발생했습니다."
      );
    }
  }
);

/**
 * 스타일 프로필 조회 (Callable Function)
 *
 * 프론트엔드에서 스타일 프로필 및 키워드 존재 여부 확인용
 */
export const getStyleProfile = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { courseId } = request.data as { courseId: string };

    if (!courseId) {
      throw new HttpsError("invalid-argument", "courseId가 필요합니다.");
    }

    const db = getFirestore();
    const analysisRef = db.collection("professorQuizAnalysis").doc(courseId);
    const analysisDoc = await analysisRef.get();

    if (!analysisDoc.exists) {
      return {
        exists: false,
        courseId,
      };
    }

    // 스타일 프로필 조회
    const profileDoc = await analysisRef.collection("data").doc("styleProfile").get();
    if (!profileDoc.exists) {
      return {
        exists: false,
        courseId,
      };
    }

    const profile = profileDoc.data() as StyleProfile;

    // 키워드 조회
    const keywordsDoc = await analysisRef.collection("data").doc("keywords").get();
    let keywordsSummary = null;
    if (keywordsDoc.exists) {
      const keywords = keywordsDoc.data() as KeywordStore;
      keywordsSummary = {
        mainConceptsCount: keywords.mainConcepts.length,
        caseTriggersCount: keywords.caseTriggers.length,
        topMainConcepts: keywords.mainConcepts.slice(0, 5).map((k) => k.term),
        topCaseTriggers: keywords.caseTriggers.slice(0, 5).map((k) => k.term),
      };
    }

    return {
      exists: true,
      courseId,
      summary: {
        analyzedQuizCount: profile.analyzedQuizCount,
        analyzedQuestionCount: profile.analyzedQuestionCount,
        topTypes: Object.entries(profile.typeDistribution)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 3)
          .map(([type]) => type),
        usesNegative: profile.toneCharacteristics.usesNegative,
        usesMultiSelect: profile.toneCharacteristics.usesMultiSelect,
        hasClinicalCases: profile.toneCharacteristics.hasClinicalCases,
      },
      keywordsSummary,
    };
  }
);
