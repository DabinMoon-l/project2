/**
 * OCR 텍스트 전처리 (Gemini 사용)
 *
 * 역할:
 * 1. 띄어쓰기 교정
 * 2. 문제 구조화 (문제번호, stem, 선지, 보기 분리)
 * 3. OCR 노이즈 정리 (①→1 등)
 */

import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// ============================================================
// 타입 정의
// ============================================================

/**
 * Gemini가 반환할 구조화된 문제 형식
 */
export interface StructuredQuestion {
  questionNumber: number;
  stem: string;  // 문제 본문 (띄어쓰기 교정됨)
  choices: Array<{
    label: string;  // ①②③④⑤ 또는 ㄱㄴㄷ
    text: string;
  }>;
  passage?: string;  // 제시문 (박스 안 자료 텍스트)
  passageType?: "text" | "labeled" | "bullet";  // 제시문 형식 (text: 일반, labeled: (가)(나)(다), bullet: ◦ 항목)
  labeledPassages?: Record<string, string>;  // (가)(나)(다) 형식 제시문
  bulletItems?: string[];  // ◦ 항목 형식 제시문
  passagePrompt?: string;  // 제시문 발문 (제시문 박스 아래의 일반 발문)
  boxItems?: Array<{  // <보기> 내용 (ㄱㄴㄷ 항목)
    label: string;
    text: string;
  }>;
  bogiPrompt?: string;  // 보기 발문 ("<보기>에서 고른 것은?" 등)
  needsImage?: boolean;  // 이미지/표/그래프 필요 여부
}

export interface PreprocessResult {
  success: boolean;
  questions: StructuredQuestion[];
  correctedText?: string;  // 띄어쓰기 교정된 전체 텍스트
  error?: string;
}

// ============================================================
// Gemini 전처리 프롬프트
// ============================================================

const PREPROCESS_PROMPT = `당신은 OCR 텍스트 교정 및 문제 구조화 전문가입니다.

## ⚠️ 핵심 규칙: 원문 그대로 사용! 절대 지어내지 마세요!

## 작업
1. **띄어쓰기 교정**: OCR로 인해 붙어버린 텍스트만 교정
2. **문제 구조화**: stem(문제), 제시문(자료), 보기, 발문, 선지를 **완전히** 분리
3. **원문 유지**: 모든 텍스트는 OCR 원문을 그대로 사용 (지어내기 금지!)

## ★★★ 가장 중요: 문제 구조 분리 ★★★

### 일반적인 문제 구조:
\`\`\`
1. 다음은 A에 대한 자료이다.     ← stem (문제 도입부)
┌─────────────────────┐
│ 자료 내용...         │        ← passage/bulletItems/labeledPassages (제시문)
│ ◦ 항목1             │
│ ◦ 항목2             │
└─────────────────────┘
위 자료에 대한 설명으로 옳은 것은? ← passagePrompt (제시문 발문)
① 선지1  ② 선지2  ③ 선지3        ← choices (선지)
\`\`\`

### stem에는 무엇을 넣나요?
- stem은 **짧은 문제 도입부만** 넣습니다 (보통 한 문장)
- 예: "다음은 A에 대한 자료이다." / "그림은 B를 나타낸 것이다."
- **절대 넣으면 안 되는 것:**
  - 제시문 내용 (◦ 항목들, (가)(나)(다) 내용)
  - 발문 ("~옳은 것은?", "~고른 것은?")
  - 보기 내용 (ㄱ.ㄴ.ㄷ. 항목)

### ★ 제시문 인식 (매우 중요!) ★

**제시문으로 분리해야 하는 것:**
1. **박스/테두리 안 텍스트** → passage (줄글) 또는 bulletItems (기호 항목)
2. **◦, ○, -, •, ▪ 등 기호로 시작하는 여러 줄** → bulletItems 배열
3. **(가), (나), (다) 또는 가., 나., 다. 형식** → labeledPassages 객체

**제시문 발문 (passagePrompt) - ★매우 중요★:**
- 제시문(박스/◦항목/가나다) 바로 **다음에** 오는 질문 문장
- **반드시 passagePrompt로 분리해야 하는 패턴:**
  - "위 자료에 대한 설명으로 옳은 것은?"
  - "이에 대한 설명으로 옳은 것은?"
  - "이에 대한 설명으로 옳지 않은 것은?"
  - "위 (가)~(다)에 대한 설명으로 옳은 것은?"
- **⚠️ 주의: "보기"와 "고른"이 함께 있으면 passagePrompt가 아니라 bogiPrompt!**
- **절대로 stem이나 passage에 넣지 마세요!**
- 이 문장은 제시문 내용이 아니라 **질문**입니다!

### ★ 보기 인식 ★

**보기 항목 (boxItems):**
- ㄱ. ㄴ. ㄷ. 형식의 항목들
- 주로 선지가 "ㄱ", "ㄱ,ㄴ", "ㄱ,ㄴ,ㄷ" 형태일 때 나타남

**보기 발문 (bogiPrompt) - ★★★ 핵심 규칙 ★★★:**
- **"보기" 또는 "<보기>"와 "고른"이 함께 있는 문장은 무조건 bogiPrompt!**
- 예시 패턴:
  - "~에 대한 설명으로 옳은 것만을 <보기>에서 있는 대로 고른 것은?"
  - "다음 <보기>에서 옳은 것만을 고른 것은?"
  - "<보기>에서 옳은 것을 모두 고른 것은?"
  - "~것만을 <보기>에서 고른 것은?"
- stem이나 passagePrompt에서 분리해서 bogiPrompt로 이동
- 보기 항목(boxItems: ㄱㄴㄷ)이 있든 없든, "보기"+"고른" 조합이면 bogiPrompt!

## 예시 1: 기호 항목 제시문
원문:
"1. 다음은 세포막에 대한 자료이다. ◦ 세포막은 인지질 이중층으로 구성된다. ◦ 단백질이 막에 박혀 있다. ◦ 유동성이 있다. 위 자료에 대한 설명으로 옳은 것은? ① A ② B"

분리 결과:
{
  "questionNumber": 1,
  "stem": "다음은 세포막에 대한 자료이다.",
  "bulletItems": [
    "세포막은 인지질 이중층으로 구성된다.",
    "단백질이 막에 박혀 있다.",
    "유동성이 있다."
  ],
  "passagePrompt": "위 자료에 대한 설명으로 옳은 것은?",
  "choices": [{"label": "①", "text": "A"}, {"label": "②", "text": "B"}]
}

## 예시 2: (가)(나)(다) 형식 제시문
원문:
"2. 다음은 효소에 대한 자료이다. (가) 효소 A는 기질 특이성을 가진다. (나) 효소는 반응 전후에 변하지 않는다. (다) 효소는 활성화 에너지를 낮춘다. 위 (가)~(다)에 대한 설명으로 옳은 것은? ① X ② Y"

분리 결과:
{
  "questionNumber": 2,
  "stem": "다음은 효소에 대한 자료이다.",
  "labeledPassages": {
    "(가)": "효소 A는 기질 특이성을 가진다.",
    "(나)": "효소는 반응 전후에 변하지 않는다.",
    "(다)": "효소는 활성화 에너지를 낮춘다."
  },
  "passagePrompt": "위 (가)~(다)에 대한 설명으로 옳은 것은?",
  "choices": [{"label": "①", "text": "X"}, {"label": "②", "text": "Y"}]
}

## 예시 3: 줄글 형식 제시문
원문:
"3. 다음은 광합성에 대한 설명이다. 광합성은 빛 에너지를 이용하여 이산화탄소와 물로부터 포도당을 합성하는 과정이다. 이 과정은 엽록체에서 일어난다. 위 설명에 대한 내용으로 옳은 것은? ① P ② Q"

분리 결과:
{
  "questionNumber": 3,
  "stem": "다음은 광합성에 대한 설명이다.",
  "passage": "광합성은 빛 에너지를 이용하여 이산화탄소와 물로부터 포도당을 합성하는 과정이다. 이 과정은 엽록체에서 일어난다.",
  "passagePrompt": "위 설명에 대한 내용으로 옳은 것은?",
  "choices": [{"label": "①", "text": "P"}, {"label": "②", "text": "Q"}]
}

## 예시 4: 보기(ㄱㄴㄷ)가 있는 문제
원문:
"4. 과산화 수소에 KI를 첨가하면 분해 속도가 빨라진다. ㄱ. 평형 상수(K) ㄴ. 반응 엔탈피 ㄷ. 활성화 에너지 이때, KI에 의해 변화되는 것만을 <보기>에서 모두 고른 것은? ① ㄱ ② ㄷ ③ ㄱ,ㄴ"

분리 결과:
{
  "questionNumber": 4,
  "stem": "과산화 수소에 KI를 첨가하면 분해 속도가 빨라진다.",
  "boxItems": [
    {"label": "ㄱ", "text": "평형 상수(K)"},
    {"label": "ㄴ", "text": "반응 엔탈피"},
    {"label": "ㄷ", "text": "활성화 에너지"}
  ],
  "bogiPrompt": "이때, KI에 의해 변화되는 것만을 <보기>에서 모두 고른 것은?",
  "choices": [{"label": "①", "text": "ㄱ"}, {"label": "②", "text": "ㄷ"}, {"label": "③", "text": "ㄱ,ㄴ"}]
}

## 예시 5: 그림/표가 있는 문제
원문:
"5. 그림은 DNA 복제 과정을 나타낸 것이다. 이에 대한 설명으로 옳은 것은? ① A ② B"

분리 결과:
{
  "questionNumber": 5,
  "stem": "그림은 DNA 복제 과정을 나타낸 것이다.",
  "needsImage": true,
  "passagePrompt": "이에 대한 설명으로 옳은 것은?",
  "choices": [{"label": "①", "text": "A"}, {"label": "②", "text": "B"}]
}

## 예시 6: ★★ "보기"+"고른" 조합 → bogiPrompt (매우 중요!) ★★
원문:
"6. 다음은 세포 소기관에 대한 자료이다. ◦ 미토콘드리아는 ATP를 생성한다. ◦ 리보솜은 단백질을 합성한다. ㄱ. 미토콘드리아에는 DNA가 있다. ㄴ. 리보솜은 막으로 둘러싸여 있다. ㄷ. 두 소기관 모두 세포질에 존재한다. 위 자료에 대한 설명으로 옳은 것만을 <보기>에서 있는 대로 고른 것은? ① ㄱ ② ㄴ ③ ㄱ,ㄷ"

분리 결과:
{
  "questionNumber": 6,
  "stem": "다음은 세포 소기관에 대한 자료이다.",
  "bulletItems": [
    "미토콘드리아는 ATP를 생성한다.",
    "리보솜은 단백질을 합성한다."
  ],
  "boxItems": [
    {"label": "ㄱ", "text": "미토콘드리아에는 DNA가 있다."},
    {"label": "ㄴ", "text": "리보솜은 막으로 둘러싸여 있다."},
    {"label": "ㄷ", "text": "두 소기관 모두 세포질에 존재한다."}
  ],
  "bogiPrompt": "위 자료에 대한 설명으로 옳은 것만을 <보기>에서 있는 대로 고른 것은?",
  "choices": [{"label": "①", "text": "ㄱ"}, {"label": "②", "text": "ㄴ"}, {"label": "③", "text": "ㄱ,ㄷ"}]
}
※ 주의: "보기"와 "고른"이 함께 있으므로 passagePrompt가 아니라 bogiPrompt!

## 이미지 필요 여부 (needsImage)
"그림", "표", "자료이다", "그래프", "나타낸 것이다" 등이 있으면 true

## 주의사항
- ◦, ○, -, • 등 기호로 시작하는 항목들은 반드시 bulletItems로 분리!
- (가)(나)(다) 또는 가.나.다. 형식은 labeledPassages로 분리!
- "위 자료에 대한", "이에 대한" 등의 발문 중 "보기"+"고른" 없으면 → passagePrompt
- ★★★ "보기" 또는 "<보기>"와 "고른"이 함께 있으면 무조건 → bogiPrompt ★★★
- stem에는 제시문 내용이나 발문을 넣지 마세요!
- ㄱ.ㄴ.ㄷ. → boxItems (보기)

## ★★★ 출력 형식 (매우 중요!) ★★★
**반드시 모든 문제를 찾아서 JSON 배열로 반환하세요!**

\`\`\`json
{
  "questions": [
    { "questionNumber": 1, "stem": "...", "choices": [...] },
    { "questionNumber": 2, "stem": "...", "choices": [...] },
    { "questionNumber": 3, "stem": "...", "choices": [...] }
  ]
}
\`\`\`

- 문제 번호(1., 2., 3. 등)를 기준으로 모든 문제를 분리하세요
- 하나의 문제만 반환하지 말고, 텍스트에 있는 **모든 문제**를 배열에 포함하세요
- 문제가 3개면 배열에 3개, 5개면 5개를 반환하세요

---
OCR 텍스트:
`;

// ============================================================
// Gemini API 호출
// ============================================================

export async function preprocessOcrText(
  ocrText: string,
  apiKey: string
): Promise<PreprocessResult> {
  console.log("[Preprocess] ========== Gemini 전처리 시작 ==========");
  console.log("[Preprocess] OCR 텍스트 길이:", ocrText.length);
  console.log("[Preprocess] API 키 존재:", !!apiKey);
  console.log("[Preprocess] API 키 앞 15자:", apiKey?.substring(0, 15));

  const prompt = PREPROCESS_PROMPT + ocrText;

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,  // 낮은 온도로 일관성 유지
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

  try {
    console.log("[Preprocess] Gemini API 호출 시작...");
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    console.log("[Preprocess] URL:", geminiUrl.substring(0, 80) + "...");

    const response = await fetch(
      geminiUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );

    console.log("[Preprocess] API 응답 상태:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Preprocess] Gemini API 오류:", response.status);
      console.error("[Preprocess] 오류 내용:", errorText.substring(0, 500));
      return {
        success: false,
        questions: [],
        error: `Gemini API 오류: ${response.status} - ${errorText.substring(0, 100)}`,
      };
    }

    const result = (await response.json()) as any;

    if (
      !result.candidates ||
      result.candidates.length === 0 ||
      !result.candidates[0].content
    ) {
      return {
        success: false,
        questions: [],
        error: "Gemini 응답 없음",
      };
    }

    const textContent = result.candidates[0].content.parts
      .filter((p: any) => p.text)
      .map((p: any) => p.text)
      .join("");

    console.log("[Preprocess] Gemini 응답 길이:", textContent.length);
    console.log("[Preprocess] Gemini 응답 (처음 500자):", textContent.substring(0, 500));

    // JSON 추출 - 여러 방법 시도
    let jsonText = textContent;

    // 1. ```json ... ``` 블록 추출
    const jsonBlockMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      jsonText = jsonBlockMatch[1].trim();
      console.log("[Preprocess] JSON 블록에서 추출됨");
    }

    // 2. { ... } 객체 부분만 추출 (가장 바깥쪽 중괄호)
    const firstBrace = jsonText.indexOf('{');
    const lastBrace = jsonText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonText = jsonText.substring(firstBrace, lastBrace + 1);
      console.log("[Preprocess] 중괄호로 추출됨, 길이:", jsonText.length);
    }

    // 3. JSON 파싱 시도
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseError: any) {
      // 더 자세한 에러 정보 포함
      const errorPos = parseInt(parseError.message.match(/position (\d+)/)?.[1] || "0");
      const contextStart = Math.max(0, errorPos - 50);
      const contextEnd = Math.min(jsonText.length, errorPos + 50);
      const errorContext = jsonText.substring(contextStart, contextEnd);

      console.error("[Preprocess] JSON 파싱 실패:", parseError.message);
      console.error("[Preprocess] 전체 길이:", jsonText.length);
      console.error("[Preprocess] 에러 위치 주변:", errorContext);

      return {
        success: false,
        questions: [],
        error: `JSON 파싱 실패 (길이:${jsonText.length}): 에러 위치(${errorPos}) 주변: ...${errorContext}...`,
      };
    }

    // 여러 형식 처리
    let questionsArray: any[] = [];

    if (parsed.questions && Array.isArray(parsed.questions)) {
      // {"questions": [...]} 형식
      questionsArray = parsed.questions;
      console.log("[Preprocess] questions 배열 형식");
    } else if (Array.isArray(parsed)) {
      // [...] 배열만 반환된 경우
      questionsArray = parsed;
      console.log("[Preprocess] 직접 배열 형식");
    } else if (parsed.data && Array.isArray(parsed.data)) {
      // {"data": [...]} 형식
      questionsArray = parsed.data;
      console.log("[Preprocess] data 배열 형식");
    } else if (parsed.questionNumber !== undefined && parsed.stem) {
      // 단일 문제 객체가 반환된 경우 - 배열로 감싸기
      questionsArray = [parsed];
      console.log("[Preprocess] 단일 객체 형식 - 배열로 변환");
    } else {
      // 알 수 없는 형식 - 디버그 정보 포함
      const keys = Object.keys(parsed);
      return {
        success: false,
        questions: [],
        error: `questions 배열 없음. 받은 키: [${keys.join(', ')}], 타입: ${typeof parsed}`,
      };
    }

    if (questionsArray.length === 0) {
      return {
        success: false,
        questions: [],
        error: "questions 배열이 비어있음",
      };
    }

    // 유효성 검사 및 정규화
    const questions: StructuredQuestion[] = [];
    for (const q of questionsArray) {
      if (typeof q.questionNumber !== "number" || !q.stem) continue;

      const structured: StructuredQuestion = {
        questionNumber: q.questionNumber,
        stem: q.stem.trim(),
        choices: [],
      };

      // 선지 정규화
      if (Array.isArray(q.choices)) {
        for (const c of q.choices) {
          if (c.label && c.text !== undefined) {
            structured.choices.push({
              label: normalizeChoiceLabel(c.label),
              text: String(c.text).trim(),
            });
          }
        }
      }

      // 보기 항목 (ㄱㄴㄷ)
      if (Array.isArray(q.boxItems)) {
        structured.boxItems = q.boxItems
          .filter((b: any) => b.label && b.text)
          .map((b: any) => ({
            label: b.label,
            text: String(b.text).trim(),
          }));
      }

      // 제시문 (passage)
      if (q.passage && typeof q.passage === "string") {
        structured.passage = q.passage.trim();
        structured.passageType = "text";
      }

      // (가)(나)(다) 형식 제시문
      if (q.labeledPassages && typeof q.labeledPassages === "object") {
        structured.labeledPassages = q.labeledPassages;
        structured.passageType = "labeled";
      }

      // ◦ 항목 형식 제시문
      if (Array.isArray(q.bulletItems) && q.bulletItems.length > 0) {
        structured.bulletItems = q.bulletItems.map((item: string) => String(item).trim());
        structured.passageType = "bullet";
      }

      // 제시문 발문
      if (q.passagePrompt && typeof q.passagePrompt === "string") {
        structured.passagePrompt = q.passagePrompt.trim();
      }

      // 보기 발문
      if (q.bogiPrompt && typeof q.bogiPrompt === "string") {
        structured.bogiPrompt = q.bogiPrompt.trim();
      }

      // 이미지 필요 여부
      if (q.needsImage === true) {
        structured.needsImage = true;
      }

      questions.push(structured);
    }

    console.log(`[Preprocess] 구조화 완료: ${questions.length}개 문제`);

    return {
      success: true,
      questions,
    };
  } catch (error) {
    console.error("[Preprocess] 오류:", error);
    return {
      success: false,
      questions: [],
      error: error instanceof Error ? error.message : "알 수 없는 오류",
    };
  }
}

/**
 * 선지 라벨 정규화 (1→①, 2→② 등)
 */
function normalizeChoiceLabel(label: string): string {
  const circleNumbers = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  const koreanLabels = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ"];

  // 이미 원문자면 그대로
  if (circleNumbers.includes(label)) return label;
  if (koreanLabels.includes(label)) return label;

  // 숫자면 원문자로 변환
  const num = parseInt(label, 10);
  if (!isNaN(num) && num >= 1 && num <= 10) {
    return circleNumbers[num - 1];
  }

  return label;
}

// ============================================================
// Export for Cloud Functions
// ============================================================

export { GEMINI_API_KEY };
