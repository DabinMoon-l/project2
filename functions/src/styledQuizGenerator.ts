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
import type { StyleProfile, KeywordStore, QuestionBank, SampleQuestion } from "./professorQuizAnalysis";
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
  // 보기 (HARD)
  bogi?: {
    questionText: string;   // 발문 ("옳은 것만을 <보기>에서 있는 대로 고른 것은?")
    items: Array<{ label: string; content: string }>; // ㄱ, ㄴ, ㄷ 항목
  };
  // 제시문 (HARD) — QuestionCard가 읽는 형식
  passagePrompt?: string;   // 제시문 발문 ("다음은 감염 경로에 대한 설명이다.")
  mixedExamples?: Array<{
    id: string;
    type: string;           // 'text' | 'gana' | 'bullet'
    content?: string;       // text 타입
    items?: Array<{ label: string; content: string }>; // gana, bullet 타입
  }>;
  // 이미지 (HARD - 자동 크롭)
  imageUrl?: string;        // 학습 자료에서 크롭된 이미지 URL
  imageDescription?: string; // 이미지 설명 (그래프, 표, 그림 등)
}

// ============================================================
// 과목별 챕터 인덱스 — shared/courseChapters.json 단일 소스
// ============================================================

import courseChaptersData from "./shared/courseChapters.json";

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

function buildCourseIndex(courseId: string): CourseIndex | null {
  const data = (courseChaptersData as Record<string, { courseName: string; chapters: Chapter[] }>)[courseId];
  if (!data) return null;
  return { courseId, courseName: data.courseName, chapters: data.chapters };
}

const BIOLOGY_INDEX: CourseIndex = buildCourseIndex("biology")!;
const PATHOPHYSIOLOGY_INDEX: CourseIndex = buildCourseIndex("pathophysiology")!;
const MICROBIOLOGY_INDEX: CourseIndex = buildCourseIndex("microbiology")!;

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

// 병태생리학/미생물학 Focus Guide: 아직 미작성 → null 처리
// 작성 완료 시 BIOLOGY_FOCUS_GUIDE와 같은 형식으로 추가
const PATHOPHYSIOLOGY_FOCUS_GUIDE: string | null = null;
const MICROBIOLOGY_FOCUS_GUIDE = `## 미생물학 퀴즈 출제 포커스

### 2장. 면역
- **(필수 출제) 면역의 정의**: 자기(self) vs 비자기(non-self) 인식, 면역반응의 기본 개념
- **(필수 출제) 선천면역 vs 후천면역(적응면역) 비교**:
  - 비특이적(non-specific) vs 항원 특이적(antigen-specific)
  - 빠른 반응 vs 느린 반응(수일 소요)
  - 면역기억 없음 vs 면역기억 있음(2차 반응 강화)
  - 구성요소: 선천(피부장벽, 탐식세포, NK세포, 보체) vs 후천(B세포/항체, T세포)
- **(필수 출제) MHC 항원제시 경로 비교**:
  - MHC 클래스 I: 거의 모든 유핵세포 발현, 프로테아좀 분해 → 세포질그물 → 표면 제시 → CD8⁺ CTL 인식
  - MHC 클래스 II: 항원제시세포(가지세포, B세포, 큰포식세포)에서 발현, 엔도솜 분해 → 표면 제시 → CD4⁺ Th세포 인식
  - 교차제시(cross-presentation): 가지세포 특유 — 외래항원을 MHC 클래스 I에도 제시 가능
- **(필수 출제) CD4 T세포 vs CD8 T세포 기능 비교**:
  - CD4⁺ 보조T세포(Th): MHC 클래스 II 인식, 사이토카인으로 면역반응 조절
  - CD8⁺ 세포독성T세포(CTL): MHC 클래스 I 인식, 퍼포린·그랜자임으로 감염세포 직접 살해
- **(필수 출제) 보조T세포 아형 비교 (Th1/Th2/Th17/TFH)**:
  - Th1: IFN-γ 생산 → 큰포식세포 활성화, CTL 활성화 (세포 내 기생세균/원충)
  - Th2: IL-4/5/13 → B세포 항체생산 촉진, IgE → 호산구·비만세포 동원 (기생충)
  - Th17: IL-17 → 호중구 동원, 과도 시 자가면역 관여
  - TFH: 림프소포에서 B세포와 상호작용 → 항체생산 촉진
- **(필수 출제) 체액성면역 vs 세포매개면역**:
  - 체액성(humoral): B세포 → 항체 → 중화, 옵소닌화, ADCC, 보체 활성화
  - 세포매개(cellular): T세포(CTL, Th1) → 감염세포 직접 살해, 큰포식세포 활성화
- **(필수 출제) 보체 시스템**: 활성화 경로(고전경로, 대체경로, 렉틴경로), C3a/C4a/C5a 기능, MAC(막공격복합체)
- **(필수 출제) 항체(면역글로불린) 구조와 종류**: IgG, IgM, IgA, IgE, IgD — 각각의 특징과 기능
- **(고빈도) 항체가 관여하는 과민반응 (I~III형)**:
  - I형(즉시형): **IgE** → 비만세포 탈과립 → 아나필락시스, 알레르기
  - II형(세포독성): **IgG/IgM** → 보체 활성화 → 세포용해 (용혈빈혈)
  - III형(면역복합체): **IgG/IgM** → 면역복합체 침착 → 혈관염 (SLE, 류마티스)
  - cf. IV형(지연형): 항체 무관, T세포(Th1/CTL) 매개 → 육아종 (결핵, GVHD)
- **(고빈도) 선천→후천면역 전환 기전**: 가지세포가 감염부위에서 항원 포식 → 림프절 이동 → MHC에 항원 제시 → 후천면역 활성화
- **(고빈도) B세포/T세포 수용체와 항체 관계**: BCR(B세포 수용체)=막결합 항체, TCR(T세포 수용체)의 항원 인식
- **(고빈도) 후천면역 그래프 문제**: 1차 면역반응 vs 2차 면역반응 — 그래프에서 3가지 인사이트 활용:
  - ① 면역기억(memory): 2차 반응이 빠르고 강한 이유
  - ② 항체 농도 차이: 2차 반응에서 항체 양이 훨씬 많음
  - ③ 주된 항체 종류 변화: 1차=IgM 우세, 2차=IgG 우세
- 후천면역의 감염반응: 병원체 유형별 면역전략 — 세포 내 기생세균(CTL), 엔도솜 내 세균(Th1→큰포식세포), 바이러스(CTL+ADCC+IFN-α/β)

### 3장. 감염과 발병
- **(필수 출제) 감염 성립 3요소**: 감염원, 감염경로, 감수성 숙주 — 각각의 정의와 관계
- **(필수 출제) 공기전파 병원성 미생물 분류표**:
  - 공기감염으로**만** 전파: 결핵균
  - 공기감염 주 경로 + 다른 경로 가능: 홍역바이러스, 수두대상포진바이러스
  - 특수 환경에서만 공기감염: 인플루엔자바이러스
- **(필수 출제) 혈액 매개 전파 병원성 미생물**: B형 간염바이러스(HBV), C형 간염바이러스(HCV), 사람면역결핍바이러스(HIV)
- **(필수 출제) 수평감염 4종류 표 (표 3-1)**: 접촉감염, 비말감염, 공기감염, 매개체감염 — 각각의 특징, 대표 미생물, 질환
- **(필수 출제) 수직감염 3종류 표 (표 3-2)**: 태반경유감염, 산도감염, 모유감염 — 각각의 특징, 대표 미생물, 질환
- **(필수 출제) 감염회로(감염성 질환의 생성 6단계)**: ①병원체 → ②병원소 → ③병원소로부터 탈출 → ④전파 → ⑤신숙주에 침입 → ⑥신숙주의 감수성과 면역
- **(고빈도) 기회감염**: 정의, 면역저하숙주에서의 감염, 내인감염, 균교대감염과의 비교
- **감염 유형 비교**: 무증상감염(불현성) vs 지속감염 vs 잠복감염 vs 증상감염(현성)
- **감염 경과 4단계**: 잠복기 → 전구기 → 발병기(극기) → 회복기
- **정상균무리(정상세균총)**: 공생 관계, 불균형(dysbiosis)의 의미
- **비말 vs 비말핵**: 5μm 기준, 비말감염 vs 공기감염 구분
`;


/**
 * 과목 ID로 Focus Guide 가져오기
 * @param chapterNumbers - 추론된 챕터 번호 목록 (있으면 해당 챕터만 필터링)
 */
export function getFocusGuide(courseId: string, chapterNumbers?: string[]): string | null {
  let fullGuide: string | null = null;
  switch (courseId) {
    case "biology":
      fullGuide = BIOLOGY_FOCUS_GUIDE;
      break;
    case "pathophysiology":
      fullGuide = PATHOPHYSIOLOGY_FOCUS_GUIDE;
      break;
    case "microbiology":
      fullGuide = MICROBIOLOGY_FOCUS_GUIDE;
      break;
    default:
      return null;
  }

  if (!fullGuide || !chapterNumbers || chapterNumbers.length === 0) {
    return fullGuide;
  }

  // 챕터 번호로 해당 섹션만 필터링
  // Focus Guide는 "### N장." 패턴으로 챕터 구분
  return filterFocusGuideByChapters(fullGuide, chapterNumbers);
}

/**
 * Focus Guide에서 특정 챕터 섹션만 추출
 */
function filterFocusGuideByChapters(guide: string, chapterNumbers: string[]): string | null {
  const lines = guide.split("\n");
  const filteredLines: string[] = [];
  let currentChapter: string | null = null;
  let includeCurrentChapter = false;
  let headerAdded = false;

  for (const line of lines) {
    // 메인 헤더 (## 로 시작) — 항상 포함
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      if (!headerAdded) {
        filteredLines.push(line);
        headerAdded = true;
      }
      continue;
    }

    // 챕터 섹션 감지: "### N장." 또는 "### N. " 패턴
    const chapterMatch = line.match(/^###\s+(\d+)(?:장)?[.\s]/);
    if (chapterMatch) {
      currentChapter = chapterMatch[1];
      includeCurrentChapter = chapterNumbers.includes(currentChapter);
    }

    if (includeCurrentChapter) {
      filteredLines.push(line);
    }
  }

  const result = filteredLines.join("\n").trim();
  return result.length > 20 ? result : null; // 너무 짧으면 null
}

/**
 * 과목 ID로 챕터 인덱스 가져오기
 */
export function getCourseIndex(courseId: string): CourseIndex | null {
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
export function buildChapterIndexPrompt(courseId: string, filterChapters?: string[]): string {
  const index = getCourseIndex(courseId);
  if (!index) return "";

  // filterChapters가 있으면 해당 챕터만 포함 (프롬프트 효율화)
  const chapters = filterChapters && filterChapters.length > 0
    ? index.chapters.filter(ch => {
        const num = ch.id.split("_")[1];
        return filterChapters.includes(num);
      })
    : index.chapters;

  if (chapters.length === 0) return "";

  let text = `## 챕터 분류 체계 (각 문제에 반드시 할당)\n\n`;
  text += `과목: ${index.courseName}\n\n`;

  for (const chapter of chapters) {
    text += `- **${chapter.id}**: ${chapter.name}\n`;
    for (const detail of chapter.details) {
      text += `  - **${detail.id}**: ${detail.name}\n`;
    }
  }

  return text;
}

/**
 * 과목 개요 + 선택된 챕터의 상세 커리큘럼 프롬프트 생성
 * Gemini가 과목 특성과 출제 방향을 이해하도록 인덱스 기반 가이드 제공
 */
export function buildCourseOverviewPrompt(courseId: string, filterChapters?: string[]): string {
  const index = getCourseIndex(courseId);
  if (!index) return "";

  // 과목별 특성 설명
  const courseCharacteristics: Record<string, string> = {
    biology: `생물학은 생명현상의 기본 원리를 다루는 기초 과목입니다.
세포 구조, 분자생물학, 유전학, 생리학 등 폭넓은 범위를 포함합니다.
**출제 방향**: 개념 정의, 구조-기능 매칭, 비교 문제(vs), 과정/순서 문제, 조절 기전이 핵심입니다.
특히 비교 문제(예: DNA vs RNA, 체세포분열 vs 감수분열, 교감 vs 부교감)가 자주 출제됩니다.`,

    pathophysiology: `병태생리학은 질병의 발생 기전과 병리학적 변화를 다루는 과목입니다.
정상 → 비정상 변화의 기전, 세포 수준의 병리, 면역/염증 반응, 종양학을 포함합니다.
**출제 방향**: 기전(mechanism) 이해, 원인-결과 관계, 분류/비교 문제, 임상 적용이 핵심입니다.
특히 분류 체계(예: 괴사 유형, 과민반응 I~IV형, 종양 분류)와 기전 연결이 중요합니다.`,

    microbiology: `미생물학은 세균, 바이러스, 진균, 원충 등 병원성 미생물을 다루는 과목입니다.
미생물의 구조/분류/증식, 숙주 면역반응, 감염 기전, 항미생물제를 포함합니다.
**대상 학생**: 간호학과 학생 — 임상에서 실제로 접하는 미생물 위주로 출제하되, 기초 미생물학 범위도 폭넓게 다루세요.
**출제 방향**: 임상에서 중요한 병원성 미생물(MRSA, VRE, 결핵균, HIV, HBV, 칸디다 등)의 특성, 감염 경로, 예방법을 우선 다루세요.
미생물 분류/특성 비교, 그람양성 vs 그람음성, 독소/병원성 인자, 면역 기전, 항균제 작용기전도 핵심입니다.
특히 세균/바이러스/진균 간 비교, 특정 균종의 특성(형태, 독소, 감염경로), 면역 반응 단계가 중요합니다.
**⚠️ 미생물학 역사 출제 규칙**: 미생물학의 역사(1장)에서 문제를 출제할 경우, 코흐(Robert Koch)만 중심적으로 다루세요. 다른 과학자(파스퇴르 등)는 오답 선지로 활용할 수 있지만, 정답은 반드시 코흐와 관련된 내용이거나 코흐만 알면 풀 수 있는 문제여야 합니다.`,
  };

  const overview = courseCharacteristics[courseId];
  if (!overview) return "";

  // 선택된 챕터의 상세 내용 표시
  const chapters = filterChapters && filterChapters.length > 0
    ? index.chapters.filter(ch => {
        const num = ch.id.split("_")[1];
        return filterChapters.includes(num);
      })
    : [];

  let text = `## 과목 개요 및 출제 가이드\n\n${overview}\n`;

  if (chapters.length > 0) {
    text += `\n### 선택된 챕터 상세 커리큘럼\n`;
    text += `아래는 출제 범위로 지정된 챕터의 세부 주제입니다. 이 주제들을 기반으로 문제를 구성하세요.\n\n`;
    for (const chapter of chapters) {
      text += `**${chapter.name}**\n`;
      for (const detail of chapter.details) {
        text += `  - ${detail.name}\n`;
      }
      text += `\n`;
    }
  }

  return text;
}

export interface StyleContext {
  profile: StyleProfile | null;
  keywords: KeywordStore | null;
  questionBank: SampleQuestion[];
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
 *
 * 핵심 원칙:
 * - 추론된 챕터의 Scope만 메인 컨텐츠로 로드 (발문 근거)
 * - HARD 난이도: 인접 챕터는 별도 섹션으로 분리 (오답 선지 참고용)
 */
export async function loadScopeForQuiz(
  courseId: string,
  text: string,
  difficulty: Difficulty,
  forcedChapters?: string[]  // 태그에서 추출한 챕터 번호 (있으면 추론 우회)
): Promise<{ content: string; keywords: string[]; chaptersLoaded: string[] } | null> {
  try {
    // forcedChapters가 있으면 추론 우회 (태그 기반 확정)
    const inferredChapters = forcedChapters && forcedChapters.length > 0
      ? forcedChapters
      : await inferChaptersFromText(courseId, text);

    if (forcedChapters && forcedChapters.length > 0) {
      console.log(`[loadScopeForQuiz] 태그 기반 챕터 확정: ${forcedChapters.join(",")}`);
    }

    const maxScopeLength = 12000;

    // 추론된 챕터만 Scope 로드 (발문 근거)
    const scopeData = await loadScopeForAI(
      courseId,
      inferredChapters.length > 0 ? inferredChapters : undefined,
      maxScopeLength
    );

    if (!scopeData) return null;

    // HARD 난이도: 인접 챕터 내용을 별도로 로드 (오답 선지 참고용)
    if (difficulty === "hard" && inferredChapters.length > 0) {
      const adjacentChapters = new Set<string>();
      for (const ch of inferredChapters) {
        const num = parseInt(ch);
        if (!isNaN(num)) {
          adjacentChapters.add(String(num - 1));
          adjacentChapters.add(String(num + 1));
        }
      }
      // 이미 로드된 챕터 제외
      const extraChapters = Array.from(adjacentChapters)
        .filter(ch => parseInt(ch) > 0 && !inferredChapters.includes(ch));

      if (extraChapters.length > 0) {
        const adjacentScope = await loadScopeForAI(courseId, extraChapters, 6000);
        if (adjacentScope && adjacentScope.content) {
          // 메인 컨텐츠와 분리하여 오답 선지 참고용으로 표시
          scopeData.content += `\n\n--- [오답 선지 참고용 인접 챕터] ---\n` +
            `⚠️ 아래 내용은 발문(질문) 출제에 사용하지 마세요. 오답 선지 구성에만 참고하세요.\n` +
            adjacentScope.content.slice(0, 4000);
          scopeData.keywords.push(...adjacentScope.keywords);
        }
      }
    }

    console.log(
      `[loadScopeForQuiz] courseId=${courseId}, difficulty=${difficulty}, ` +
      `추론 챕터=${inferredChapters.join(",")}, 로드 챕터=${scopeData.chaptersLoaded.join(",")}`
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
export const DIFFICULTY_PARAMS = {
  easy: {
    preferredTypes: ["DEFINITION_MATCH", "CLASSIFICATION", "COMPARISON"],
    cognitiveLevel: "기억/이해 — 개념 정의, 특징, 분류를 직접적으로 확인",
    trapStyle: "없음 (명확한 정오 구분, 선지 간 차이가 분명)",
    choiceStyle: "핵심 개념 중심의 명확한 선지 — 선지 간 차이가 분명하고, 수업을 들은 학생이라면 쉽게 소거 가능. 명백히 다른 개념을 선지로 배치.",
    stemLength: "짧은 발문 (1-2문장)",
    typeRatio: "정의 매칭 40%, 분류 30%, 비교 20%, 기타 10%",
    allowedFormats: ["multiple"],
    allowPassage: false,
    allowBogi: false,
  },
  medium: {
    preferredTypes: ["MECHANISM", "CLASSIFICATION", "COMPARISON", "MULTI_SELECT"],
    cognitiveLevel: "적용/분석 — 개념 간 비교, 기전 이해, 적용 능력 확인",
    trapStyle: "유사 용어 혼동, 시간 순서 교란",
    choiceStyle: "유사 개념이 섞인 선지 — 비슷하지만 다른 용어, 과정 순서, 기전 연결을 섞어 출제. 소거에 약간의 사고가 필요한 수준.",
    stemLength: "중간 길이 발문 (1-2문장)",
    typeRatio: "기전 30%, 비교 30%, 분류 20%, 복수정답 20%",
    allowedFormats: ["multiple"],
    allowPassage: false,
    allowBogi: false,
  },
  hard: {
    preferredTypes: ["MECHANISM", "COMPARISON", "NEGATIVE", "MULTI_SELECT", "CLINICAL_CASE"],
    cognitiveLevel: "분석/평가 — 심층 이해 확인. 문제 자체는 보통 난이도처럼 보이지만 선지 소거가 극도로 어려움",
    trapStyle: "정상비정상 뒤집기, 유사 용어 혼동, 부분적으로 맞는 선지, 미묘한 차이",
    choiceStyle: `**핵심 전략: 매력적인 오답 선지** — 문제(발문)는 보통 난이도와 비슷하게 간결하게 내되, 5개 선지 모두 그럴듯하게 구성.
   - 오답이 "부분적으로 맞지만 핵심이 틀린" 선지여야 함 (명백히 틀린 선지 금지)
   - 2~3개 선지가 정답처럼 보여서 소거법이 통하지 않아야 함
   - 정확한 개념 이해 없이는 풀 수 없지만, 지엽적이거나 암기형은 아닌 수준
   - 복수정답 문제에서도 "이것도 맞는 것 같은데?" 하는 선지를 배치`,
    stemLength: "간결한 발문 (1-2문장) — 문제는 짧지만 선지에서 깊이를 요구",
    typeRatio: "비교/기전 30%, 부정형 25%, 복수정답 25%, 임상케이스 20%",
    allowedFormats: ["multiple"],
    allowPassage: true,
    allowBogi: true,
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
`;

  // 스타일 요약 (v2: 자연어 서술)
  if (profile.styleDescription) {
    styleSection += `
### 출제 스타일 요약
${profile.styleDescription}
`;
  }

  // 발문 패턴 (v2: 구체적 문장 구조)
  if (profile.questionPatterns && profile.questionPatterns.length > 0) {
    styleSection += `
### 자주 사용하는 발문 패턴
`;
    const topPatterns = profile.questionPatterns
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 6);

    for (const p of topPatterns) {
      styleSection += `- "${p.pattern}"`;
      if (p.examples && p.examples.length > 0) {
        styleSection += ` — 예: "${p.examples[0]}"`;
      }
      styleSection += `\n`;
    }
    styleSection += `위 패턴을 참고하여 비슷한 구조로 발문을 작성하세요.\n`;
  }

  // 오답 구성 전략 (v2: 구체적 방법)
  if (profile.distractorStrategies && profile.distractorStrategies.length > 0) {
    styleSection += `
### 오답 선지 구성 방식
`;
    for (const s of profile.distractorStrategies.slice(0, 4)) {
      styleSection += `- ${s}\n`;
    }
  }

  // ★ 원본 문제 few-shot 예시 (QuestionBank에서 랜덤 추출)
  if (context.questionBank && context.questionBank.length > 0) {
    styleSection += `
### 교수님이 실제로 낸 문제 (이 스타일을 따라하세요)
`;
    for (const q of context.questionBank) {
      styleSection += `Q. ${q.stem}\n`;
      q.choices.forEach((c: string, i: number) => {
        const marker = q.correctAnswer === i ? "✓" : " ";
        styleSection += `  ${marker}${i + 1}. ${c}\n`;
      });
      styleSection += `\n`;
    }
    styleSection += `위 문제들의 발문 구조, 선지 길이, 용어 수준, 오답 구성 방식을 그대로 따라하세요.\n`;
  }

  // 주제별 비중 (v2)
  if (profile.topicEmphasis && profile.topicEmphasis.length > 0) {
    styleSection += `
### 주요 출제 주제
`;
    const topTopics = profile.topicEmphasis
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5);
    for (const t of topTopics) {
      styleSection += `- ${t.topic} (비중: ${t.weight}/10)\n`;
    }
  }

  // 핵심 학술 용어 (v2: coreTerms)
  if (keywords && keywords.coreTerms && keywords.coreTerms.length > 0) {
    const topTerms = keywords.coreTerms
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 12);
    const termsList = topTerms
      .map((t) => t.english ? `${t.korean}(${t.english})` : t.korean)
      .join(", ");

    styleSection += `
### 시험에 자주 나오는 핵심 용어
${termsList}
`;
  }

  // 출제 토픽 (v2: examTopics)
  if (keywords && keywords.examTopics && keywords.examTopics.length > 0) {
    styleSection += `
### 주요 출제 토픽 (세부 개념)
`;
    for (const t of keywords.examTopics.slice(0, 6)) {
      styleSection += `- ${t.topic}: ${t.subtopics.slice(0, 6).join(", ")}\n`;
    }
  }

  // v1 하위 호환: 기존 데이터에 typeDistribution이 있으면 사용
  const profileRecord = profile as unknown as Record<string, unknown>;
  if (!profile.questionPatterns && profileRecord.typeDistribution) {
    styleSection += `
### 문제 유형 분포 (레거시)
`;
    const sortedTypes = Object.entries(profileRecord.typeDistribution as Record<string, number>)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    for (const [type, count] of sortedTypes) {
      const percentage = Math.round((count / profile.analyzedQuestionCount) * 100);
      styleSection += `- ${type}: ${percentage}%\n`;
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
  // v1 하위 호환: difficultyTypeMap이 있으면 사용
  const profileV1 = profile as unknown as Record<string, unknown> | null;
  const difficultyTypeMap = profileV1?.difficultyTypeMap as Record<string, string[]> | undefined;
  if (difficultyTypeMap?.[difficulty.toUpperCase()]) {
    const profTypes = difficultyTypeMap[difficulty.toUpperCase()];
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

  if (params.allowPassage) {
    formatInstructions += `
### 제시문 형식 (어려움 난이도 전용)
- 문제 앞에 제시문(지문)을 붙일 수 있습니다. 제시문은 "passageBlocks" 배열로 표현합니다.
- **3가지 블록 유형**을 조합하여 사용하세요:
  1. **text** (텍스트박스): 단락형 지문. 예: 임상 사례, 실험 결과 설명
  2. **gana** ((가)(나)(다)): 라벨링된 항목. 예: 조건 나열, 단계별 설명
  3. **bullet** (◦ 불렛): 항목 나열. 예: 특징 목록, 증상 목록
- "passagePrompt"에 제시문 발문을 작성하세요 (예: "다음은 감염 경로에 대한 설명이다.")
- 제시문 예시:
  "passagePrompt": "다음은 감염병 경과 단계에 대한 설명이다.",
  "passageBlocks": [
    {"type": "gana", "items": [{"label": "(가)", "content": "병원체 침입 후 증상이 나타나기 전 단계"}, {"label": "(나)", "content": "전신 증상이 나타나는 단계"}, {"label": "(다)", "content": "특이적 증상이 최고조에 달하는 단계"}]}
  ]
- **제시문이 필요 없는 문제에서는 passageBlocks와 passagePrompt를 생략하세요.**
- 10문제 중 2~3개만 제시문을 사용하세요. 모든 문제에 붙이지 마세요.`;
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
function buildScopeContextPrompt(context: StyleContext, hasProfessorPrompt: boolean): string {
  if (!context.scope || !context.scope.content) {
    return "";
  }

  const { content, chaptersLoaded } = context.scope;

  // professorPrompt가 있으면 scope를 8000자로 축소 (프롬프트 주제에 집중하도록)
  const maxLen = hasProfessorPrompt ? 8000 : 12000;

  return `
## 참고 자료 (⛔ 발문 출제 금지 — 선지 검증 전용)
> 🚫 **절대 금지**: 이 섹션의 내용으로 문제의 발문(질문 주제)을 만드는 것.
> ✅ **허용 용도만**: (1) 오답 선지에 쓸 유사 용어 확인 (2) 정답의 학술 정확성 검증 (3) 어려움 난이도에서 함정 오답 구성
> **발문(질문)은 반드시 위의 '학습 자료' + '최우선 지시사항' + '포커스 가이드'에서만 출제하세요.**
> 이 참고 자료에만 있고 위 출제 원천에 없는 내용으로 문제를 만들면 탈락입니다.
> 로드된 챕터: ${chaptersLoaded.join(", ")}장

${content.slice(0, maxLen)}
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
  availableImages: CroppedImage[] = [],
  courseCustomized: boolean = true,
  professorPrompt?: string,
  hasPageImages: boolean = false,
  tags?: string[],  // 챕터 태그 (예: ["12_신경계"])
  chapterRepetition: number = 0,  // 챕터별 평균 반복 횟수
  chapterRepetitionMap?: Record<string, number>,  // 챕터별 개별 반복 횟수
  isProfessor: boolean = false  // 교수 여부 (교수는 기존 임계값 유지)
): string {
  // Scope에서 로드된 챕터 번호 (여러 곳에서 사용)
  const scopeChapters = context.scope?.chaptersLoaded;

  // 태그에서 사람이 읽을 수 있는 챕터 라벨 생성 (예: "12장(신경계), 11장(내분비계)")
  const tagChapterLabels = tags && tags.length > 0
    ? tags
        .filter(t => /^\d+_/.test(t))
        .map(t => {
          const [num, ...rest] = t.split("_");
          return `${num}장(${rest.join("_")})`;
        })
    : [];

  // 태그에서 챕터 번호 추출 (과목 개요에 사용)
  const tagChapterNumbers = tags && tags.length > 0
    ? tags.filter(t => /^\d+_/.test(t)).map(t => t.split("_")[0])
    : [];

  const styleContext = courseCustomized ? buildStyleContextPrompt(context) : "";
  const difficultyPrompt = buildDifficultyPrompt(difficulty, context);
  const scopeContext = courseCustomized ? buildScopeContextPrompt(context, !!professorPrompt) : "";
  // 챕터 인덱스: 태그 선택 챕터 우선, 없으면 scope 챕터
  const chapterFilterForIndex = tagChapterNumbers.length > 0 ? tagChapterNumbers : scopeChapters;
  const chapterIndexPrompt = (courseCustomized || tagChapterNumbers.length > 0)
    ? buildChapterIndexPrompt(courseId, chapterFilterForIndex)
    : "";
  const focusGuide = courseCustomized ? getFocusGuide(courseId, tagChapterNumbers.length > 0 ? tagChapterNumbers : scopeChapters) : null;
  // 과목 개요 (과목 특성 + 선택 챕터 상세 커리큘럼)
  // courseCustomized=false라도 챕터 태그가 선택되면 커리큘럼 개요는 포함
  const courseOverviewPrompt = (courseCustomized || tagChapterNumbers.length > 0)
    ? buildCourseOverviewPrompt(courseId, tagChapterNumbers.length > 0 ? tagChapterNumbers : scopeChapters)
    : "";

  // focusGuide vs scope 문제 수 균등 분배
  const focusQuestionCount = Math.round(questionCount / 2);
  const scopeQuestionCount = questionCount - focusQuestionCount;

  // Scope가 있으면 "출제 범위"로, 없으면 "학습 자료"로 표현
  const hasScope = !!context.scope?.content;
  const isHard = difficulty === "hard";
  const hasFocusGuide = !!focusGuide;

  // 난이도별 컨텐츠 규칙 설정
  // 핵심 원칙:
  // 1. 학습 자료를 보고 해당 챕터를 파악
  // 2. 해당 챕터의 포커스 가이드 내용을 적극 활용 (문제 주제/출제 포인트)
  // 3. 학습 자료 내용 + 포커스 가이드 내용이 1:1로 모두 반영
  // 4. 학습 자료와 무관한 챕터의 문제는 절대 금지
  // 5. Scope(과목 범위)는 어려움 난이도에서 오답 선지/함정 구성용
  let contentRule: string;
  let uploadedTextLabel: string;

  // 1. 매우 짧은 텍스트 (50자 미만) + FocusGuide 있음: FocusGuide 기반 출제
  if (isVeryShortText && hasFocusGuide) {
    uploadedTextLabel = "키워드/힌트";
    if (professorPrompt || ocrText.trim().length > 0) {
      // 키워드가 있으면 해당 주제 챕터의 포커스 가이드에서만 출제
      contentRule = `**포커스 가이드 + 키워드 연계 출제 규칙**:
   - **필수**: 위 '키워드/힌트'("${(professorPrompt || ocrText).trim().slice(0, 30)}")와 직접 관련된 챕터의 포커스 가이드 내용에서만 문제를 출제하세요
   - **금지**: 키워드와 무관한 다른 챕터의 포커스 가이드 내용으로 문제를 만들면 탈락입니다
   - **${questionCount}문제 전부** 키워드 주제에 관한 문제여야 합니다
   - '과목 전체 범위'는 정확한 개념과 용어 확인 참고용입니다`;
    } else {
      // 키워드 없이 빈 텍스트: 포커스 가이드 + 챕터 커리큘럼에서 골고루 출제
      contentRule = `**포커스 가이드 + 커리큘럼 기반 출제 규칙**:
   - 포커스 가이드의 **(고빈도)**, **(필수 출제)** 항목을 우선 출제하세요
   - '과목 개요 및 출제 가이드'의 챕터 상세 커리큘럼에서 세부 주제를 골고루 다루세요
   - '과목 전체 범위'에서 정확한 개념과 용어를 확인하세요`;
    }
  }
  // 2. 매우 짧은 텍스트 + FocusGuide 없음: 챕터 커리큘럼/키워드 기반 출제
  else if (isVeryShortText && !hasFocusGuide) {
    const hasText = (professorPrompt || ocrText).trim().length > 0;
    const hasTagsSelected = tagChapterLabels.length > 0;
    if (hasText) {
      uploadedTextLabel = "키워드/주제";
      contentRule = `**일반 주제 출제 규칙**:
   - 제공된 '키워드/주제'("${(professorPrompt || ocrText).trim().slice(0, 30)}")와 관련된 내용으로만 문제를 출제하세요
   - **금지**: 이 키워드와 무관한 주제의 문제를 만들면 탈락입니다
   - **중요**: 확실하지 않거나 추측성 내용은 절대 포함하지 마세요
   - 널리 알려진 기본 개념, 정의, 특징만 문제로 만드세요`;
    } else if (hasTagsSelected) {
      // 학습 자료 없이 챕터 태그만 선택 → 과목 개요 + 커리큘럼 기반 출제
      uploadedTextLabel = "출제 지시";
      contentRule = `**챕터 커리큘럼 기반 출제 규칙**:
   - 위 '과목 개요 및 출제 가이드'와 '챕터 상세 커리큘럼'을 참고하여 해당 챕터의 핵심 개념을 문제로 출제하세요
   - '과목 전체 범위'가 있으면 정확한 개념과 용어를 반드시 확인하세요
   - 각 세부 주제에서 골고루 출제하되, 핵심 개념/정의/비교/분류/기전 문제를 우선 출제하세요
   - **금지**: 불확실하거나 추측에 기반한 내용을 문제로 만들지 마세요
   - **${questionCount}문제**를 지정된 챕터 범위 내에서 다양하게 구성하세요`;
    } else {
      // 텍스트 없이 이미지만 제공된 경우
      uploadedTextLabel = "이미지 학습 자료";
      contentRule = `**이미지 기반 출제 규칙**:
   - 첨부된 이미지를 면밀히 분석하여 핵심 개념, 구조, 프로세스를 파악하세요
   - 이미지에 포함된 해부도, 다이어그램, 표, 그래프, 순서도 등의 시각 정보를 바탕으로 문제를 출제하세요
   - 이미지에서 파악한 용어, 구조명, 관계, 수치를 정확하게 활용하세요
   - **금지**: 이미지에 없는 내용을 추측하여 문제를 만들지 마세요`;
    }
  }
  // 3. 짧은 텍스트 (50-200자) + FocusGuide 있음: 학습 자료로 챕터 파악 → 포커스 가이드 활용
  else if (isShortText && hasFocusGuide) {
    uploadedTextLabel = "학습 자료 (짧은 텍스트)";
    contentRule = `**학습 자료 + 포커스 가이드 연계 출제 규칙**:
   - 먼저 '학습 자료'를 분석하여 어떤 챕터에 해당하는지 파악하세요
   - 파악된 챕터의 '출제 포커스 가이드' 내용을 적극 활용하여 문제를 출제하세요
   - 학습 자료에 언급된 개념 + 해당 챕터의 포커스 가이드 내용이 모두 반영되어야 합니다
   - **금지**: 학습 자료와 무관한 챕터의 포커스 가이드로 문제를 만들지 마세요`;
  }
  // 4. 짧은 텍스트 + FocusGuide 없음: 키워드 기반
  else if (isShortText && !hasFocusGuide) {
    uploadedTextLabel = "학습 자료 (짧은 텍스트)";
    contentRule = `**학습 자료 기반 출제 규칙**:
   - 제공된 '학습 자료'에서 핵심 개념을 파악하세요
   - 해당 내용과 관련된 기본적이고 정확한 지식을 바탕으로 문제를 출제하세요
   - **중요**: 확실하지 않은 내용은 절대 지어내지 마세요`;
  }
  // 5. 충분한 텍스트 + HARD + Scope: 학습 자료 + 포커스 가이드 + Scope(오답 선지)
  else if (hasScope && isHard) {
    uploadedTextLabel = "학습 자료";
    contentRule = `**어려움 난이도 출제 규칙 (학습 자료 + 포커스 가이드 + Scope)**:
   - **Step 1**: '학습 자료'를 분석하여 어떤 챕터에 해당하는지 파악
   - **Step 2**: 학습 자료 내용 + 해당 챕터의 포커스 가이드 내용으로 발문(질문) 구성
   - **Step 3**: '과목 전체 범위'에서 유사하지만 다른 개념을 가져와 함정 오답 선지로 활용
   - **금지**: 학습 자료와 무관한 챕터의 내용을 발문으로 삼지 마세요
   - 학생이 학습 자료를 정확히 이해해야 풀 수 있는 문제를 만드세요`;
  } else if (hasFocusGuide) {
    // EASY/MEDIUM + FocusGuide: 학습 자료 + 포커스 가이드 연계
    uploadedTextLabel = "학습 자료";
    contentRule = `**학습 자료 + 포커스 가이드 연계 출제**:
   - 먼저 '학습 자료'를 분석하여 어떤 챕터에 해당하는지 파악하세요
   - 학습 자료 내용 + 해당 챕터의 포커스 가이드 내용을 모두 반영하여 문제를 출제하세요
   - **금지**: 학습 자료와 무관한 챕터의 포커스 가이드/과목 범위로 문제를 만들지 마세요
   - '과목 전체 범위'는 정확한 용어와 개념 확인 참고용입니다`;
  } else if (hasScope) {
    // Scope만 있고 FocusGuide 없음
    uploadedTextLabel = "학습 자료";
    contentRule = `**학습 자료 기반 출제**: 반드시 '학습 자료'에 있는 내용에서 문제를 만드세요.
   - '과목 전체 범위'는 정확한 개념과 용어 확인 참고용입니다.
   - **금지**: 학습 자료와 무관한 챕터의 내용으로 문제를 만들지 마세요.`;
  } else {
    // Scope 없음
    uploadedTextLabel = "학습 자료";
    contentRule = "**내용 기반**: 위 학습 자료에 있는 내용으로만 문제를 만드세요. 학습 자료에 없는 내용을 지어내지 마세요.";
  }

  // professorPrompt가 있으면 모든 contentRule에 최우선 규칙 추가
  if (professorPrompt) {
    contentRule = `**🔴 최우선**: 위 '최우선 출제 지시사항'의 키워드/주제("${professorPrompt.slice(0, 50)}")와 직접 관련된 내용에서만 문제를 출제하세요. ` +
      `이 키워드와 무관한 챕터나 주제의 문제는 절대 포함하지 마세요. ` + contentRule;
  }

  // 태그 기반 챕터 확정 (최우선) 또는 추론된 챕터 제한
  if (tagChapterLabels.length > 0) {
    // 사용자가 직접 선택한 챕터 태그 → 가장 확실한 범위 제한
    const tagList = tagChapterLabels.join(", ");
    contentRule = `🔒 **출제 범위 확정 (사용자 지정)**: ${tagList} 범위에서만 출제하세요. ` +
      `이 챕터 외의 내용으로 문제를 만들면 탈락입니다. ` +
      `${questionCount}문제 전부 위 챕터 범위 내에서 출제해야 합니다.\n   ` +
      contentRule;
  } else if (scopeChapters && scopeChapters.length > 0) {
    const chapterList = scopeChapters.join(", ");
    contentRule = `🔒 **챕터 제한**: ${chapterList}장 범위에서만 출제하세요. ` +
      `다른 챕터의 내용으로 문제를 만들면 탈락입니다.\n   ` +
      contentRule;
  }

  // HARD 난이도 추가 지침
  const hardModeExtra = isHard ? `
## 어려움 난이도 추가 지침

### 형식 비율 (${questionCount}문제 기준 — 반드시 지켜주세요)
- 부정형 ("옳지 않은 것"): **${Math.max(1, Math.round(questionCount * 0.3))}문제**
- 복수정답 (answer를 배열로): **${Math.max(1, Math.round(questionCount * 0.2))}문제**
- 나머지: 기전/임상케이스/일반 객관식

### 오답 선지 구성 전략
⚠️ 아래 전략은 **오답 선지 구성에만** 적용됩니다.
🚫 **절대 금지**: 발문(질문 주제) 자체를 학습 자료/지시사항과 다른 챕터에서 가져오는 것.

1. **유사 용어 혼동**: 학습 자료의 개념과 비슷한 이름의 다른 개념을 오답으로 활용
2. **교차 챕터 함정**: 다른 챕터의 유사 개념을 오답 선지에 배치
3. **기전 연결 오류**: 원인-결과 관계를 다른 기전과 섞어서 오답 구성
4. **복수 정답 가능성**: 부분적으로 맞는 선지로 "가장 적절한 것" 판단 요구
` : "";

  // 사용 가능한 이미지 정보
  let imageSection = "";
  let imageRule = "9. **이미지 참조 금지**: 그림, 도표, 그래프를 참조하는 문제는 생성하지 마세요. 학습자료에 이미지가 있어도 텍스트 기반 문제만 출제하세요";

  // 페이지 이미지가 inlineData로 첨부된 경우 (모든 난이도) — HARD 크롭 이미지보다 우선
  if (hasPageImages) {
    imageRule = `9. **첨부 이미지 참고**: 이 요청에는 학습 자료의 페이지 이미지가 함께 첨부되어 있습니다.
   - 이미지에 포함된 도표, 그래프, 해부도, 그림 등의 시각 자료를 적극 참고하여 문제를 출제하세요.
   - 텍스트에 누락된 내용이 이미지에 있을 수 있으니, 텍스트와 이미지를 함께 분석하세요.
   - 단, 문제 자체에 "다음 그림을 보고"와 같은 이미지 참조 문구는 사용하지 마세요 (학생에게는 이미지가 표시되지 않습니다).`;
  } else if (isHard && availableImages.length > 0) {
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
  // 핵심 집중 조건: 쉬움/보통 난이도 + 10문제 이하 (10문제 이하에서는 핵심 개념 우선)
  const isLowQuestionCount = !allowDetailedQuestions && questionCount <= 10;

  // Focus Guide 섹션 (난이도, 문제 수, 반복 횟수에 따라 핵심 강조도 조절)
  // chapterRepetition이 높을수록 포커스 가이드 의존도 ↓, 다양성 ↑
  let focusGuideSection = "";
  if (hasFocusGuide) {
    let focusInstruction: string;

    // 반복 횟수별 다양성 지시
    // 학생: 0-1회 핵심집중, 2회 다른관점, 3회 보충확대, 4+ 다양성확장
    // 교수: 0회 핵심집중, 1+ 다른관점, 3+ 다양성확장 (기존 유지)
    let repNote: string;
    if (isProfessor) {
      // 교수: 기존 임계값 유지
      repNote = chapterRepetition >= 3
        ? `\n> - ⚠️ **${chapterRepetition + 1}회차 생성**: 이전에 같은 챕터로 여러 번 생성했습니다. (고빈도) 개념은 최소한만 포함하고, 포커스 가이드의 덜 출제된 항목, 세부 개념, 응용 문제 위주로 출제하세요. 기존 문제와 최대한 다른 각도에서 출제하세요.`
        : chapterRepetition >= 1
          ? `\n> - ⚠️ **${chapterRepetition + 1}회차 생성**: 같은 챕터로 이전에 생성한 적 있습니다. 이전과 다른 개념, 다른 관점에서 출제하세요. 포커스 가이드의 아직 다루지 않은 항목을 우선 선택하세요.`
          : "";
    } else {
      // 학생: 핵심집중 2라운드 (0-1회) → 다른관점(2회) → 보충확대(3회) → 다양성확장(4+)
      repNote = chapterRepetition >= 4
        ? `\n> - ⚠️ **${chapterRepetition + 1}회차 생성 (다양성 확장)**: 이 챕터로 ${chapterRepetition}번 이상 생성했습니다. (고빈도) 개념은 최소한만 포함하고, 포커스 가이드의 덜 출제된 항목, 세부 개념, 응용 문제 위주로 출제하세요. 기존 문제와 최대한 다른 각도에서 출제하세요.`
        : chapterRepetition === 3
          ? `\n> - ⚠️ **${chapterRepetition + 1}회차 생성 (보충 확대)**: 핵심 개념은 이미 충분히 다뤘습니다. 포커스 가이드의 보조 항목, 학습 자료의 세부 내용, 응용·비교 문제 위주로 확대하세요.`
          : chapterRepetition === 2
            ? `\n> - ⚠️ **${chapterRepetition + 1}회차 생성 (다른 관점)**: 같은 챕터로 이전에 생성한 적 있습니다. 이전과 다른 개념, 다른 관점에서 출제하세요. 포커스 가이드의 아직 다루지 않은 항목을 우선 선택하세요.`
            : "";
    }

    if (allowDetailedQuestions) {
      // 어려움 난이도 또는 12문제 이상: 세부적인 내용도 출제 가능
      const modeLabel = isHard ? "어려움 난이도" : `${questionCount}문제`;
      const minCore = Math.max(1, Math.round(questionCount * Math.max(0.1, 0.3 - chapterRepetition * 0.05)));
      focusInstruction = `> **세부 출제 허용 (${modeLabel})**:
> - 포커스 가이드의 핵심 개념 + 학습 자료의 세부 내용 모두 출제 가능합니다
> - **(고빈도)**, **(필수 출제)** 개념을 최소 ${minCore}개 포함하세요
> - 나머지는 학습 자료에 명시된 세부 사항, 예외 케이스, 부가 설명에서도 출제 가능
> - 지엽적인 내용도 학습 자료에 근거가 있으면 출제하세요${repNote}`;
    } else if (isLowQuestionCount) {
      // 5-8문제 (쉬움/보통)
      const minCore = Math.max(1, Math.min(questionCount, 5) - chapterRepetition);
      // 학생: 0-1 핵심집중, 2 다른관점, 3 보충확대, 4+ 다양성확장
      // 교수: 0 핵심집중, 1+ 다른관점, 3+ 다양성확장
      const isDiversity = isProfessor ? chapterRepetition >= 3 : chapterRepetition >= 4;
      const isSupplement = !isProfessor && chapterRepetition === 3;
      const isDifferent = isProfessor ? chapterRepetition >= 1 : chapterRepetition === 2;

      if (isDiversity) {
        focusInstruction = `> **다양성 확장 모드 (${questionCount}문제, ${chapterRepetition + 1}회차)**:
> - **(고빈도)** 개념은 ${minCore}개만 포함하고, 나머지는 포커스 가이드의 보조 항목이나 학습 자료의 세부 내용에서 출제하세요
> - 이전에 출제되었을 가능성이 높은 핵심 개념 대신 새로운 관점의 문제를 만드세요
> - 응용, 비교, 사례 적용 등 다양한 문제 유형을 활용하세요`;
      } else if (isSupplement) {
        focusInstruction = `> **보충 확대 모드 (${questionCount}문제, ${chapterRepetition + 1}회차)**:
> - 핵심 개념은 이미 충분히 다뤘습니다. **(고빈도)** 개념은 ${minCore}개만 포함하세요
> - 포커스 가이드의 보조 항목, 학습 자료의 세부 내용에서 나머지를 출제하세요
> - 응용, 비교, 사례 적용 등 다양한 문제 유형을 활용하세요${repNote}`;
      } else if (isDifferent) {
        focusInstruction = `> **핵심+보충 모드 (${questionCount}문제, ${chapterRepetition + 1}회차)**:
> - **(고빈도)**, **(필수 출제)** 개념에서 ${minCore}개 이상 출제하세요
> - 나머지는 포커스 가이드의 다른 항목이나 학습 자료의 세부 내용에서 출제하세요
> - 이전과 다른 관점, 다른 문제 유형으로 출제하세요${repNote}`;
      } else {
        focusInstruction = `> **핵심 집중 모드 (${questionCount}문제)**:
> - 반드시 **(고빈도)**, **(필수 출제)** 표시된 개념에서 ${Math.min(questionCount, 5)}개 이상 출제하세요
> - **비교 문제** (vs), **기능 매칭** 등 핵심 유형을 우선 출제하세요
> - 문제의 주제 자체가 해당 챕터의 핵심 내용이어야 합니다
> - 지엽적인 세부사항, 예외 케이스, 부가 설명 등은 출제하지 마세요
> - 선지 구성도 핵심 개념 간의 구분에 초점을 맞추세요`;
      }
    } else {
      // 9-11문제 (쉬움/보통)
      const corePercent = Math.max(20, 60 - chapterRepetition * 15);
      // 학생: 0-1 핵심집중, 2 다른관점, 3 보충확대, 4+ 다양성확장
      // 교수: 0 핵심집중, 1+ 다른관점, 3+ 다양성확장
      const isDiversity = isProfessor ? chapterRepetition >= 3 : chapterRepetition >= 4;
      const isSupplement = !isProfessor && chapterRepetition === 3;
      const isDifferent = isProfessor ? chapterRepetition >= 1 : chapterRepetition === 2;

      if (isDiversity) {
        focusInstruction = `> **다양성 확장 모드 (${questionCount}문제, ${chapterRepetition + 1}회차)**:
> - **(고빈도)** 개념은 ${corePercent}% 이하로 제한하고, 나머지는 다양한 세부 개념에서 출제하세요
> - 포커스 가이드의 보조 항목, 학습 자료의 세부 사항, 응용 문제를 적극 활용하세요
> - 기존에 반복 출제되었을 핵심 주제는 피하고 새로운 각도에서 접근하세요`;
      } else if (isSupplement) {
        focusInstruction = `> **보충 확대 모드 (${questionCount}문제, ${chapterRepetition + 1}회차)**:
> - 핵심 개념은 충분히 다뤘습니다. **(고빈도)** 개념은 ${corePercent}% 이하로 제한하세요
> - 포커스 가이드의 보조 항목, 학습 자료의 세부 내용에서 나머지를 출제하세요
> - 응용, 비교, 사례 적용 등 다양한 문제 유형을 활용하세요${repNote}`;
      } else if (isDifferent) {
        focusInstruction = `> **핵심 우선 모드 (${questionCount}문제, ${chapterRepetition + 1}회차)**:
> - **(고빈도)**, **(필수 출제)** 개념에서 최소 ${corePercent}% 이상 출제하세요
> - 나머지는 포커스 가이드의 다른 항목에서 출제하세요
> - 이전과 다른 관점에서 출제하세요${repNote}`;
      } else {
        focusInstruction = `> **핵심 우선 모드 (${questionCount}문제)**:
> - **(고빈도)**, **(필수 출제)** 표시된 개념에서 최소 60% 이상 출제하세요
> - 나머지는 포커스 가이드의 다른 핵심 개념에서 출제하세요
> - 학습 자료에만 있고 포커스 가이드에 없는 지엽적 내용은 가급적 피하세요`;
      }
    }

    // 챕터별 반복 횟수 상세 정보 (Gemini에게 어떤 챕터를 다양화해야 하는지 알려줌)
    let chapterRepDetail = "";
    if (chapterRepetitionMap) {
      const entries = Object.entries(chapterRepetitionMap).filter(([, v]) => v > 0);
      if (entries.length > 0) {
        chapterRepDetail = `\n\n> **챕터별 이전 생성 횟수** (높을수록 새로운 관점 필요):\n` +
          entries.map(([tag, count]) => {
            if (isProfessor) {
              // 교수: 기존 임계값
              return `> - ${tag}: ${count}회 생성됨${count >= 3 ? " → 세부/응용 위주로" : count >= 1 ? " → 다른 관점으로" : ""}`;
            }
            // 학생: 0-1 핵심, 2 다른관점, 3 보충확대, 4+ 다양성확장
            const hint = count >= 4 ? " → 다양성 확장 (새로운 각도)" : count === 3 ? " → 보충 확대 (세부/응용)" : count === 2 ? " → 다른 관점으로" : "";
            return `> - ${tag}: ${count}회 생성됨${hint}`;
          }).join("\n");
      }
    }

    focusGuideSection = `
## 출제 포커스 가이드
${focusGuide}

${focusInstruction}${chapterRepDetail}
`;
  }

  // 교수 프롬프트 섹션 — 최상위 우선순위 (최대 1000자)
  const trimmedProfessorPrompt = professorPrompt?.slice(0, 1000);
  const professorPromptSection = trimmedProfessorPrompt ? `
## 🔴 최우선 출제 지시사항 (반드시 준수)
> **경고: 이 지시사항은 모든 다른 규칙보다 우선합니다.**
> 아래 키워드/주제와 **직접 관련된 내용에서만** 문제를 출제하세요.
> 포커스 가이드나 과목 범위에 여러 챕터가 있더라도, **아래 키워드에 해당하는 챕터의 내용만** 사용하세요.
> 이 지시사항과 무관한 챕터/주제의 문제가 하나라도 포함되면 탈락입니다.
> **${questionCount}문제 전부** 아래 키워드/주제에 관한 문제여야 합니다.

${trimmedProfessorPrompt}
` : "";

  // professorPrompt가 있으면 scope는 순수 참고용 — 비율 할당 금지
  const scopeRatioPrefix = !professorPrompt
    ? `(${questionCount}문제 중 약 ${scopeQuestionCount}문제는 이 넓은 범위에서 출제하세요.)`
    : "";
  const focusRatioPrefix = !professorPrompt
    ? `(${questionCount}문제 중 약 ${focusQuestionCount}문제는 아래 핵심 포인트에서 출제하세요.)`
    : "";

  const styledScopeContext = scopeContext && scopeRatioPrefix ? `${scopeRatioPrefix}\n${scopeContext}` : scopeContext;
  const styledFocusGuide = focusGuideSection && focusRatioPrefix ? `${focusRatioPrefix}\n${focusGuideSection}` : focusGuideSection;

  return `당신은 ${courseName} 과목의 대학 교수입니다.
학생들의 시험을 준비시키기 위한 객관식 문제 ${questionCount}개를 만들어주세요.
${professorPromptSection}
${courseOverviewPrompt}
## ${uploadedTextLabel}
${ocrText.slice(0, 6000)}
${styledFocusGuide}
${difficultyPrompt}
${styleContext}
${hardModeExtra}
${chapterIndexPrompt}
${imageSection}
${styledScopeContext}
## Step 1: 문제 생성 규칙

1. ${contentRule}
2. **문제 수**: 정확히 ${questionCount}개
3. **선지 수**: 객관식은 반드시 **5개** 선지 (OX 문제 제외). **선지에 "가.", "나.", "다." 등의 접두사를 붙이지 마세요** — UI가 자동으로 ①②③④⑤ 번호를 표시합니다.
4. **난이도 일관성**: 모든 문제가 ${difficulty.toUpperCase()} 난이도에 맞아야 합니다
5. **다양성**: 같은 개념을 반복하지 말고 다양한 주제를 다루세요
6. **한국어**: 모든 내용을 한국어로 작성하세요
7. **정확성**: 과목 전체 범위의 개념과 용어를 정확히 사용하세요
8. **챕터 분류 필수**: 각 문제는 위 "챕터 분류 체계"에서 가장 적합한 chapterId와 chapterDetailId를 반드시 할당하세요
${imageRule}
10. **핵심 집중도**: ${allowDetailedQuestions ? "세부 출제 허용 - 핵심 개념 + 학습 자료의 세부 사항 모두 출제 가능합니다." : isLowQuestionCount ? "핵심 집중 - 문제 수가 적으므로 가장 핵심적인 내용만 출제하세요. 지엽적인 내용, 예외 케이스, 세부 사항은 제외합니다." : "핵심 우선 - 핵심 개념 위주로 출제하되, 일부 세부 내용도 포함할 수 있습니다."}

## Step 2: 내부 검증 규칙 (JSON 출력 전 반드시 적용)
각 문제를 JSON에 포함하기 **전에** 아래 기준을 통과하는지 내부적으로 확인하세요.
통과하지 못하는 문제는 **JSON에 포함하지 말고 새로운 문제로 교체**하세요.

❌ **탈락 기준** (하나라도 해당되면 해당 문제를 JSON에 포함하지 마세요):
- 정답 근거가 학습자료에 없는 문제
- 발문 방향("옳은 것"/"틀린 것")과 answer가 불일치하는 문제
- 학술적으로 부정확한 선지가 정답으로 설정된 문제
- answer 인덱스가 choices 배열 범위를 벗어나는 문제
- 학습 자료와 무관한 챕터(chapterId)의 문제
- 불확실하거나 추측에 기반한 문제
- 최우선 지시사항이 있는데 해당 주제와 무관한 문제

✅ **포함 기준** (모두 충족해야 함):
- 정답의 근거가 학습자료에 명확히 존재
- 모든 오답 선지가 왜 틀린지 학습자료 기반으로 설명 가능
- choiceExplanations이 각 선지별로 정확한 근거 포함
- chapterId가 학습 자료의 실제 챕터와 일치
- 최우선 지시사항의 키워드가 문제에 반영됨 (지시사항이 있는 경우)

## Step 3: 출력 형식
반드시 아래 JSON 형식으로만 응답하세요:
{
  "title": "핵심 키워드 한 단어 (예: 세포분열, 염증, DNA복제 — 이 문제들의 주제를 대표하는 한국어 키워드)",
  "questions": [
    {
      "text": "문제 내용",
      "choices": ["선지1", "선지2", "선지3", "선지4", "선지5"],
      "answer": 0,
      "explanation": "정답 해설 (왜 이것이 정답인지)",
      "choiceExplanations": [
        "선지1 해설: 정답인 이유 또는 오답인 이유",
        "선지2 해설: 오답인 이유 (구체적으로)",
        "선지3 해설: 오답인 이유 (구체적으로)",
        "선지4 해설: 오답인 이유 (구체적으로)",
        "선지5 해설: 오답인 이유 (구체적으로)"
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
- figureId는 이미지를 참조할 때만 포함하세요 (예: "figure_1"). 이미지가 없으면 생략.
- bogi는 어려움 난이도에서 ㄱ,ㄴ,ㄷ 보기 문제일 때만 포함. 예: {"questionText": "옳은 것만을 <보기>에서 있는 대로 고른 것은?", "items": [{"label": "ㄱ", "content": "내용1"}, {"label": "ㄴ", "content": "내용2"}, {"label": "ㄷ", "content": "내용3"}]}. 보기 문제가 아니면 생략.
- passagePrompt는 제시문 발문입니다 (예: "다음은 감염 경로에 대한 설명이다."). 제시문이 없으면 생략.
- passageBlocks는 제시문 블록 배열입니다. 3가지 타입: text(텍스트박스), gana((가)(나)(다)), bullet(◦불렛). 예: [{"type": "gana", "items": [{"label": "(가)", "content": "내용1"}, {"label": "(나)", "content": "내용2"}]}] 또는 [{"type": "text", "content": "임상 사례 텍스트..."}] 또는 [{"type": "bullet", "items": [{"label": "◦", "content": "항목1"}, {"label": "◦", "content": "항목2"}]}]. 제시문이 없으면 생략.`;
}

// ============================================================
// Gemini API 호출
// ============================================================

/**
 * Truncated JSON에서 유효한 문제들을 복구
 * maxOutputTokens 도달로 JSON이 중간에 잘렸을 때 사용
 */
function recoverTruncatedQuestions(jsonText: string): GeneratedQuestion[] {
  // questions 배열 시작 지점 찾기
  const questionsStart = jsonText.indexOf('"questions"');
  if (questionsStart === -1) return [];

  const arrayStart = jsonText.indexOf("[", questionsStart);
  if (arrayStart === -1) return [];

  // 개별 문제 객체를 하나씩 추출 시도
  const questions: GeneratedQuestion[] = [];
  let depth = 0;
  let objStart = -1;

  for (let i = arrayStart + 1; i < jsonText.length; i++) {
    const ch = jsonText[i];

    // 문자열 내부 스킵
    if (ch === '"') {
      i++;
      while (i < jsonText.length && jsonText[i] !== '"') {
        if (jsonText[i] === "\\") i++; // 이스케이프 문자 스킵
        i++;
      }
      continue;
    }

    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const objStr = jsonText.slice(objStart, i + 1);
        try {
          const q = JSON.parse(objStr);
          if (q.text && (q.answer !== undefined)) {
            questions.push({
              text: q.text,
              type: q.type || "multiple",
              choices: q.choices,
              answer: q.answer,
              explanation: q.explanation || "",
              choiceExplanations: q.choiceExplanations,
              questionType: q.questionType,
              chapterId: q.chapterId,
              chapterDetailId: q.chapterDetailId,
              bogi: q.bogi || undefined,
            });
          }
        } catch {
          // 개별 객체 파싱 실패 → 스킵
        }
        objStart = -1;
      }
    }
  }

  return questions;
}

export interface GeminiResult {
  questions: GeneratedQuestion[];
  title?: string; // Gemini가 생성한 키워드 제목
}

export async function generateWithGemini(
  prompt: string,
  apiKey: string,
  questionCount: number = 5,
  availableImages: CroppedImage[] = [],
  pageImages: string[] = []
): Promise<GeminiResult> {
  // 문제 수에 따라 토큰 수 조절
  // hard 난이도: 복수정답/부정형/상세해설로 문제당 토큰 증가
  const estimatedTokensPerQuestion = 1000;
  // thinking 예산 + 응답 토큰 (thinking 토큰이 maxOutputTokens에 합산되므로 여유 확보)
  const thinkingBudget = 10240;
  const maxTokens = thinkingBudget + Math.max(questionCount * estimatedTokensPerQuestion + 2000, 8192);

  // 페이지 이미지를 inlineData parts로 변환 (최대 10장)
  const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  for (const img of pageImages.slice(0, 10)) {
    // data:image/jpeg;base64,... 형식에서 base64 데이터 추출
    const match = img.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (match) {
      imageParts.push({
        inlineData: { mimeType: match[1], data: match[2] },
      });
    }
  }

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    ...imageParts,
    { text: prompt },
  ];

  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.7,  // 다양성 확보 (0.5→0.7)
      topK: 32,
      topP: 0.9,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json", // JSON 모드 강제 — 파싱 실패 방지
      thinkingConfig: {
        thinkingBudget,  // thinking 품질 유지 + maxOutputTokens에 합산되므로 예산 제어
      },
    },
  };

  if (imageParts.length > 0) {
    console.log(`[Gemini API] 페이지 이미지 ${imageParts.length}장 inlineData로 전송`);
  }

  const startTime = Date.now();

  // 120초 타임아웃 (CF 300초 내에서 다른 처리 여유 확보)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal as unknown as import("node-fetch").RequestInit["signal"],
      }
    );
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Gemini API 요청 시간 초과 (120초)");
    }
    throw err;
  }
  clearTimeout(timeout);

  console.log(`[Gemini API] 응답 시간: ${Date.now() - startTime}ms`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API 오류:", response.status, errorText);

    if (response.status === 429) {
      throw new Error("API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.");
    }
    throw new Error(`Gemini API 오류: ${response.status}`);
  }

  interface GeminiResponse {
    candidates?: Array<{
      content?: {
        parts: Array<{ text?: string }>;
      };
      finishReason?: string;
    }>;
  }

  const result = (await response.json()) as GeminiResponse;

  if (!result.candidates?.[0]?.content) {
    throw new Error("AI 응답을 받지 못했습니다.");
  }

  // finishReason 확인
  const finishReason = result.candidates[0].finishReason;
  if (finishReason === "MAX_TOKENS") {
    console.warn(`[Gemini] ⚠️ maxOutputTokens(${maxTokens}) 도달 — 응답이 잘렸을 수 있음`);
  } else if (finishReason === "SAFETY") {
    throw new Error("AI가 안전 정책에 의해 응답을 거부했습니다. 다른 학습 자료로 다시 시도해주세요.");
  } else if (finishReason === "RECITATION") {
    throw new Error("AI가 저작권 정책에 의해 응답을 거부했습니다. 다른 학습 자료로 다시 시도해주세요.");
  }

  const textContent = result.candidates[0].content.parts
    .filter((p) => p.text)
    .map((p) => p.text)
    .join("");

  // JSON 추출 (여러 전략 시도)
  let jsonText = textContent.trim();

  // 전략 1: 코드 블록에서 추출 (greedy — 가장 큰 블록 매칭)
  const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }
  // 전략 2: 코드 블록이 없으면 첫 번째 { 부터 마지막 } 까지 추출
  else {
    const firstBrace = textContent.indexOf("{");
    const lastBrace = textContent.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonText = textContent.slice(firstBrace, lastBrace + 1);
    }
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
      // OX 문제 감지 (type이 "ox"이거나 answer가 "O"/"X" 문자열)
      const isOxQuestion = q.type === "ox" ||
        (typeof q.answer === "string" && (q.answer === "O" || q.answer === "X"));

      // 정답 유효성 검사 (단일 정답, 복수 정답, OX)
      let isValidAnswer = false;
      if (isOxQuestion) {
        // OX 문제: "O" 또는 "X" 문자열
        isValidAnswer = q.answer === "O" || q.answer === "X";
      } else if (typeof q.answer === "number") {
        // 단일 정답: 0-indexed
        isValidAnswer = q.choices && q.answer >= 0 && q.answer < q.choices.length;
      } else if (Array.isArray(q.answer)) {
        // 복수 정답: 모든 인덱스가 유효해야 함
        isValidAnswer = q.choices && q.answer.length > 0 &&
          q.answer.every((a: number) =>
            typeof a === "number" && a >= 0 && a < q.choices.length
          );
      }

      // OX 문제는 choices 없어도 유효
      const hasValidChoices = isOxQuestion || (Array.isArray(q.choices) && q.choices.length >= 2);

      if (
        q.text &&
        hasValidChoices &&
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

        // passageBlocks → mixedExamples 변환 (QuestionCard 렌더링 호환)
        let mixedExamples: Array<{ id: string; type: string; content?: string; items?: Array<{ label: string; content: string }> }> | undefined;
        let passagePrompt: string | undefined;
        if (Array.isArray(q.passageBlocks) && q.passageBlocks.length > 0) {
          mixedExamples = q.passageBlocks.map((block: { type: string; content?: string; items?: Array<{ label: string; content: string }> }, i: number) => ({
            id: `ai_passage_${i}`,
            type: block.type || "text",
            content: block.content,
            items: block.items,
          }));
          passagePrompt = q.passagePrompt || undefined;
        }

        validQuestions.push({
          text: q.text,
          type: isOxQuestion ? "ox" : (q.type || "multiple"),
          choices: isOxQuestion ? undefined : q.choices,
          answer: q.answer,
          explanation: q.explanation || "",
          choiceExplanations: isOxQuestion ? undefined : (
            Array.isArray(q.choiceExplanations) && Array.isArray(q.choices) && q.choiceExplanations.length === q.choices.length
              ? q.choiceExplanations
              : undefined
          ),
          questionType: q.questionType,
          trapPattern: q.trapPattern,
          chapterId: q.chapterId,           // 챕터 ID (Gemini 할당)
          chapterDetailId: q.chapterDetailId, // 세부 챕터 ID (Gemini 할당)
          bogi: q.bogi || undefined,         // 보기 (ㄱㄴㄷ)
          ...(mixedExamples && { mixedExamples }), // 제시문 (text/gana/bullet)
          ...(passagePrompt && { passagePrompt }), // 제시문 발문
          imageUrl,                          // 크롭된 이미지 URL
          imageDescription,                  // 이미지 설명
        });
      }
    }

    if (validQuestions.length === 0) {
      throw new Error("유효한 문제가 없습니다.");
    }

    // Gemini가 생성한 키워드 제목 추출
    const generatedTitle = typeof parsed.title === "string" ? parsed.title.trim() : undefined;

    return { questions: validQuestions, title: generatedTitle };
  } catch (parseError) {
    // Truncated JSON 복구 시도: maxOutputTokens 도달로 잘린 경우
    console.warn("JSON 파싱 실패, truncated JSON 복구 시도...");
    console.error("원본 응답 (앞 500자):", textContent.slice(0, 500));

    try {
      const recovered = recoverTruncatedQuestions(jsonText);
      if (recovered.length > 0) {
        console.log(`[Gemini] Truncated JSON에서 ${recovered.length}개 문제 복구 성공`);
        return { questions: recovered };
      }
    } catch (recoveryError) {
      console.error("Truncated JSON 복구 실패:", recoveryError);
    }

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
      let styleContext: StyleContext = { profile: null, keywords: null, questionBank: [], scope: null };

      const analysisRef = db.collection("professorQuizAnalysis").doc(courseId);

      // 병렬로 모든 데이터 로드
      // 짧은 텍스트일 경우 항상 scope 로드 (focusGuide + scope로 보충)
      const shouldLoadScope = isShortText || validDifficulty !== "easy";

      const [profileDoc, keywordsDoc, bankDoc, scopeResult] = await Promise.all([
        // 1. 스타일 프로필
        analysisRef.collection("data").doc("styleProfile").get(),
        // 2. 키워드
        analysisRef.collection("data").doc("keywords").get(),
        // 3. 문제 뱅크 (원본 문제 few-shot용)
        analysisRef.collection("data").doc("questionBank").get(),
        // 4. Scope (짧은 텍스트이거나 MEDIUM/HARD 난이도일 때 로드)
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
      // 문제 뱅크에서 랜덤 10개 추출 (Fisher-Yates 셔플)
      if (bankDoc.exists) {
        const bank = bankDoc.data() as QuestionBank;
        if (bank.questions && bank.questions.length > 0) {
          const shuffled = [...bank.questions];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          styleContext.questionBank = shuffled.slice(0, 10);
        }
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
      let { questions } = await generateWithGemini(
        prompt,
        apiKey,
        validQuestionCount,
        croppedImages  // 이미지 매핑용
      );

      // 문제 수 부족 시 보충 생성 (최대 2회)
      if (questions.length < validQuestionCount) {
        console.log(`[보충] ${questions.length}/${validQuestionCount} — 부족분 보충 시작`);
        for (let retry = 0; retry < 2 && questions.length < validQuestionCount; retry++) {
          const remaining = validQuestionCount - questions.length;
          try {
            const suppPrompt = buildFullPrompt(
              trimmedText, validDifficulty, remaining,
              styleContext, courseName, courseId,
              isShortText, isVeryShortText, croppedImages
            );
            const supp = await generateWithGemini(suppPrompt, apiKey, remaining, croppedImages);
            questions = [...questions, ...supp.questions];
            console.log(`[보충] ${retry + 1}차: +${supp.questions.length}개 → 총 ${questions.length}개`);
          } catch (err) {
            console.warn(`[보충] ${retry + 1}차 실패:`, err);
            break;
          }
        }
      }

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
      // v2: coreTerms + examTopics
      if (keywords.coreTerms) {
        keywordsSummary = {
          coreTermsCount: keywords.coreTerms.length,
          examTopicsCount: keywords.examTopics?.length || 0,
          topTerms: keywords.coreTerms.slice(0, 5).map((t) => t.korean),
          topTopics: keywords.examTopics?.slice(0, 5).map((t) => t.topic) || [],
        };
      } else {
        // v1 하위 호환
        const v1 = keywords as unknown as Record<string, unknown>;
        const v1Concepts = Array.isArray(v1.mainConcepts) ? v1.mainConcepts as Array<Record<string, unknown>> : [];
        keywordsSummary = {
          coreTermsCount: v1Concepts.length,
          examTopicsCount: 0,
          topTerms: v1Concepts.slice(0, 5).map((k) => (k.term as string) || ""),
          topTopics: [] as string[],
        };
      }
    }

    // v2 형식 요약
    const summary: Record<string, unknown> = {
      analyzedQuizCount: profile.analyzedQuizCount,
      analyzedQuestionCount: profile.analyzedQuestionCount,
    };

    // v2 필드
    if (profile.questionPatterns) {
      summary.topPatterns = profile.questionPatterns.slice(0, 3).map((p) => p.pattern);
      summary.hasStyleDescription = !!profile.styleDescription;
    }
    // v1 하위 호환
    const profileAsRecord = profile as unknown as Record<string, unknown>;
    if (profileAsRecord.typeDistribution) {
      summary.topTypes = Object.entries(profileAsRecord.typeDistribution as Record<string, number>)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([type]) => type);
    }

    return {
      exists: true,
      courseId,
      summary,
      keywordsSummary,
    };
  }
);
