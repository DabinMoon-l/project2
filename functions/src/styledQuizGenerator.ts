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
    { id: "micro_1", name: "1. 미생물과 미생물학", shortName: "미생물과 미생물학", details: [
      { id: "micro_1_1", name: "미생물의 개요" },
      { id: "micro_1_2", name: "미생물학의 역사" },
    ]},
    { id: "micro_2", name: "2. 숙주면역반응", shortName: "숙주면역반응", details: [
      { id: "micro_2_1", name: "면역계통의 개요" },
      { id: "micro_2_2", name: "선천면역" },
      { id: "micro_2_3", name: "후천면역" },
      { id: "micro_2_4", name: "면역계통의 병리와 응용" },
    ]},
    { id: "micro_3", name: "3. 감염과 발병", shortName: "감염과 발병", details: [
      { id: "micro_3_1", name: "감염의 성립" },
      { id: "micro_3_2", name: "감염과 발병" },
      { id: "micro_3_3", name: "감염의 경과" },
    ]},
    { id: "micro_4", name: "4. 세균의 일반적인 성질", shortName: "세균의 일반적인 성질", details: [
      { id: "micro_4_1", name: "세균의 분류" },
      { id: "micro_4_2", name: "세균의 형태와 구조" },
      { id: "micro_4_3", name: "세균의 증식" },
      { id: "micro_4_4", name: "세균의 대사" },
      { id: "micro_4_5", name: "세균의 유전" },
      { id: "micro_4_6", name: "세균의 병원성" },
      { id: "micro_4_7", name: "세균 감염병의 진단" },
      { id: "micro_4_8", name: "항균제" },
    ]},
    { id: "micro_5", name: "5. 병원성 세균", shortName: "병원성 세균", details: [
      { id: "micro_5_1", name: "그람양성 조건무산소성 및 산소성 알균" },
      { id: "micro_5_2", name: "그람음성 조건무산소성 막대균" },
      { id: "micro_5_3", name: "나선균군" },
      { id: "micro_5_4", name: "그람음성 산소성 막대균 및 알균" },
      { id: "micro_5_5", name: "그람양성 조건무산소성 및 산소성 막대균" },
      { id: "micro_5_6", name: "절대무산소성균" },
      { id: "micro_5_7", name: "미코박테륨속" },
      { id: "micro_5_8", name: "바퀴살균" },
      { id: "micro_5_9", name: "스피로헤타" },
      { id: "micro_5_10", name: "미코플라스마, 리케차, 클라미디아" },
    ]},
    { id: "micro_6", name: "6. 바이러스의 일반적 성질", shortName: "바이러스의 일반적 성질", details: [
      { id: "micro_6_1", name: "바이러스의 특징" },
      { id: "micro_6_2", name: "바이러스의 분류" },
      { id: "micro_6_3", name: "바이러스의 형태와 구조" },
      { id: "micro_6_4", name: "바이러스의 증식" },
      { id: "micro_6_5", name: "바이러스의 유전" },
      { id: "micro_6_6", name: "바이러스의 병원성" },
      { id: "micro_6_7", name: "바이러스 감염병의 진단" },
      { id: "micro_6_8", name: "항바이러스제" },
    ]},
    { id: "micro_7", name: "7. 병원성 바이러스", shortName: "병원성 바이러스", details: [
      { id: "micro_7_1", name: "DNA 바이러스" },
      { id: "micro_7_2", name: "RNA 바이러스" },
      { id: "micro_7_3", name: "간염바이러스" },
      { id: "micro_7_4", name: "종양바이러스" },
      { id: "micro_7_5", name: "프리온" },
    ]},
    { id: "micro_8", name: "8. 진균의 일반적 성질", shortName: "진균의 일반적 성질", details: [
      { id: "micro_8_1", name: "진균의 형태와 구조" },
      { id: "micro_8_2", name: "진균의 증식" },
      { id: "micro_8_3", name: "진균의 분류" },
      { id: "micro_8_4", name: "진균의 영양과 배양" },
      { id: "micro_8_5", name: "진균의 병원성" },
      { id: "micro_8_6", name: "진균 감염병의 진단" },
      { id: "micro_8_7", name: "항진균제" },
    ]},
    { id: "micro_9", name: "9. 병원성 진균", shortName: "병원성 진균", details: [
      { id: "micro_9_1", name: "심재성 진균증을 일으키는 진균" },
      { id: "micro_9_2", name: "표재성 피부진균증을 일으키는 진균" },
      { id: "micro_9_3", name: "심재성 피부진균증을 일으키는 진균" },
    ]},
    { id: "micro_10", name: "10. 원충의 일반적 성질과 병원성 원충", shortName: "원충", details: [
      { id: "micro_10_1", name: "원충의 특징" },
      { id: "micro_10_2", name: "원충의 형태와 구조" },
      { id: "micro_10_3", name: "원충의 분류" },
      { id: "micro_10_4", name: "원충의 발육과 증식" },
      { id: "micro_10_5", name: "원충 감염병의 진단" },
      { id: "micro_10_6", name: "항원충제" },
      { id: "micro_10_7", name: "병원성 원충" },
    ]},
    { id: "micro_11", name: "11. 감염병의 예방과 대책", shortName: "감염병의 예방과 대책", details: [
      { id: "micro_11_1", name: "감염병 현황" },
      { id: "micro_11_2", name: "감염병 예방" },
      { id: "micro_11_3", name: "감염병 대책" },
    ]},
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

// 병태생리학/미생물학 Focus Guide: 아직 미작성 → null 처리
// 작성 완료 시 BIOLOGY_FOCUS_GUIDE와 같은 형식으로 추가
const PATHOPHYSIOLOGY_FOCUS_GUIDE: string | null = null;
const MICROBIOLOGY_FOCUS_GUIDE: string | null = null;

/**
 * 과목 ID로 Focus Guide 가져오기
 * @param chapterNumbers - 추론된 챕터 번호 목록 (있으면 해당 챕터만 필터링)
 */
function getFocusGuide(courseId: string, chapterNumbers?: string[]): string | null {
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
function buildChapterIndexPrompt(courseId: string, filterChapters?: string[]): string {
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
const DIFFICULTY_PARAMS = {
  easy: {
    preferredTypes: ["OX", "DEFINITION_MATCH", "CLASSIFICATION"],
    cognitiveLevel: "기억/이해",
    trapStyle: "없음 (명확한 정오 구분)",
    choiceStyle: "핵심 개념 중심의 명확한 선지 — 개념 정의, 특징, 분류를 직접적으로 물어보세요. 선지 간 차이가 분명해야 합니다.",
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
    choiceStyle: "유사 개념이 섞인 복잡한 선지 — 세부 특징 비교, 과정 순서, 기전 연결 등을 물어보세요.",
    stemLength: "중간 길이 발문 (2-3문장)",
    typeRatio: "기전 40%, 분류 30%, 비교 20%, 기타 10%",
    allowedFormats: ["multiple"],
    allowPassage: false,
    allowBogi: false,
  },
  hard: {
    preferredTypes: ["NEGATIVE", "MULTI_SELECT", "CLINICAL_CASE", "MECHANISM", "BOGI_SELECT"],
    cognitiveLevel: "분석/평가",
    trapStyle: "정상비정상 뒤집기, 수치방향 뒤집기, 부분전체 혼동",
    choiceStyle: "미묘한 차이가 있는 선지, 복수 정답 가능 — 단, 문제 주제는 반드시 학습 자료/지시사항 범위 내에서만. 다른 챕터 주제로 문제를 내면 안 됩니다.",
    stemLength: "긴 발문 또는 케이스 시나리오",
    typeRatio: "부정형 25%, 보기문제 20%, 임상케이스 20%, 다중선택 20%, 기전 15%",
    allowedFormats: ["multiple"],
    allowPassage: false,
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
  sliderWeights?: { style: number; scope: number; focusGuide: number },
  professorPrompt?: string,
  hasPageImages: boolean = false,
  tags?: string[]  // 챕터 태그 (예: ["12_신경계"])
): string {
  // 슬라이더 가중치에 따른 조건부 포함
  const skipStyle = sliderWeights && sliderWeights.style < 10;
  const skipScope = sliderWeights && sliderWeights.scope < 10;
  const skipFocusGuide = sliderWeights && sliderWeights.focusGuide < 10;

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

  const styleContext = courseCustomized && !skipStyle ? buildStyleContextPrompt(context) : "";
  const difficultyPrompt = buildDifficultyPrompt(difficulty, context);
  const scopeContext = courseCustomized && !skipScope ? buildScopeContextPrompt(context, !!professorPrompt) : "";
  const chapterIndexPrompt = courseCustomized ? buildChapterIndexPrompt(courseId, scopeChapters) : "";
  const focusGuide = courseCustomized && !skipFocusGuide ? getFocusGuide(courseId, scopeChapters) : null;

  // 슬라이더 가중치 → 문제 수 비율로 변환
  // scope와 focusGuide의 비율을 문제 수로 분배
  const scopeWeight = sliderWeights ? sliderWeights.scope : 50;
  const focusWeight = sliderWeights ? sliderWeights.focusGuide : 50;

  // focusGuide vs scope 문제 수 분배 (둘 다 10 이상일 때)
  const totalWeight = (skipScope ? 0 : scopeWeight) + (skipFocusGuide ? 0 : focusWeight);
  const focusQuestionCount = totalWeight > 0 && !skipFocusGuide
    ? Math.round(questionCount * (focusWeight / totalWeight))
    : 0;
  const scopeQuestionCount = questionCount - focusQuestionCount;

  // 스타일 반영 강도 (문제 수 비율은 아니지만 명확한 지시로 변환)
  const getStylePrefix = (value: number): string => {
    if (value < 10) return "";
    const ratio = Math.round((value / 100) * questionCount);
    return `(${questionCount}문제 중 약 ${ratio}문제는 아래 출제 스타일을 따르세요. 나머지는 자유롭게 출제하세요.)`;
  };

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
      // 키워드 없이 빈 텍스트: 포커스 가이드 전체에서 골고루 출제
      contentRule = `**포커스 가이드 기반 출제 규칙**:
   - 포커스 가이드 전체에서 골고루 출제하세요
   - '과목 전체 범위'에서 정확한 개념과 용어를 확인하세요`;
    }
  }
  // 2. 매우 짧은 텍스트 + FocusGuide 없음: 텍스트 기반 일반 지식 문제
  else if (isVeryShortText && !hasFocusGuide) {
    uploadedTextLabel = "키워드/주제";
    contentRule = `**일반 주제 출제 규칙**:
   - 제공된 '키워드/주제'("${(professorPrompt || ocrText).trim().slice(0, 30)}")와 관련된 내용으로만 문제를 출제하세요
   - **금지**: 이 키워드와 무관한 주제의 문제를 만들면 탈락입니다
   - **중요**: 확실하지 않거나 추측성 내용은 절대 포함하지 마세요
   - 널리 알려진 기본 개념, 정의, 특징만 문제로 만드세요`;
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
- 부정형 ("옳지 않은 것"): **${Math.max(1, Math.round(questionCount * 0.25))}문제**
- 보기 문제 (ㄱ,ㄴ,ㄷ + bogi 필드 포함): **${Math.max(1, Math.round(questionCount * 0.2))}문제**
- 복수정답 (answer를 배열로): **${Math.max(1, Math.round(questionCount * 0.15))}문제**
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

  // 슬라이더 가중치 → 문제 수 비율 접두사
  const stylePrefix = sliderWeights ? getStylePrefix(sliderWeights.style) : "";

  // professorPrompt가 있으면 scope는 순수 참고용 — 비율 할당 금지 (발문 출제 금지와 모순 방지)
  const scopeRatioPrefix = !skipScope && !skipFocusGuide && totalWeight > 0 && !professorPrompt
    ? `(${questionCount}문제 중 약 ${scopeQuestionCount}문제는 이 넓은 범위에서 출제하세요.)`
    : "";
  const focusRatioPrefix = !skipFocusGuide && !skipScope && totalWeight > 0 && !professorPrompt
    ? `(${questionCount}문제 중 약 ${focusQuestionCount}문제는 아래 핵심 포인트에서 출제하세요.)`
    : "";

  const styledStyleContext = styleContext && stylePrefix ? `${stylePrefix}\n${styleContext}` : styleContext;
  const styledScopeContext = scopeContext && scopeRatioPrefix ? `${scopeRatioPrefix}\n${scopeContext}` : scopeContext;
  const styledFocusGuide = focusGuideSection && focusRatioPrefix ? `${focusRatioPrefix}\n${focusGuideSection}` : focusGuideSection;

  return `당신은 ${courseName} 과목의 대학 교수입니다.
학생들의 시험을 준비시키기 위한 객관식 문제 ${questionCount}개를 만들어주세요.
${professorPromptSection}
## ${uploadedTextLabel}
${ocrText.slice(0, 6000)}
${styledFocusGuide}
${difficultyPrompt}
${styledStyleContext}
${hardModeExtra}
${chapterIndexPrompt}
${imageSection}
${styledScopeContext}
## Step 1: 문제 생성 규칙

1. ${contentRule}
2. **문제 수**: 정확히 ${questionCount}개
3. **선지 수**: 객관식은 반드시 **5개** 선지 (OX 문제 제외)
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
- bogi는 어려움 난이도에서 ㄱ,ㄴ,ㄷ 보기 문제일 때만 포함. 예: {"questionText": "옳은 것만을 <보기>에서 있는 대로 고른 것은?", "items": [{"label": "ㄱ", "content": "내용1"}, {"label": "ㄴ", "content": "내용2"}, {"label": "ㄷ", "content": "내용3"}]}. 보기 문제가 아니면 생략.`;
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
  // 각 문제당 ~500토큰 필요 (선지별 해설 포함)
  const estimatedTokensPerQuestion = 500;
  const baseMaxTokens = Math.min(questionCount * estimatedTokensPerQuestion + 500, 8192);
  // 최소 8192 보장 (truncation 방지)
  const maxTokens = Math.max(baseMaxTokens, 8192);

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
      temperature: 0.5,  // 낮은 temperature = 더 빠른 생성
      topK: 32,
      topP: 0.9,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json", // JSON 모드 강제 — 파싱 실패 방지
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal as any,
      }
    );
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
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

  const result = (await response.json()) as any;

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
    .filter((p: any) => p.text)
    .map((p: any) => p.text)
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
      const { questions } = await generateWithGemini(
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
