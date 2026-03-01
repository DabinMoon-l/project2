/**
 * 이미지 영역 분석 (Gemini Vision 사용)
 *
 * OCR 이미지에서 문제별 이미지/표/그래프 영역의 좌표를 분석합니다.
 * 문제 번호와 해당 영역의 바운딩 박스를 반환합니다.
 */

import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// ============================================================
// 타입 정의
// ============================================================

/**
 * 이미지 영역 바운딩 박스 (0-1 정규화 좌표)
 */
export interface BoundingBox {
  x: number;      // 좌상단 x (0-1)
  y: number;      // 좌상단 y (0-1)
  width: number;  // 너비 (0-1)
  height: number; // 높이 (0-1)
}

/**
 * 문제별 이미지 영역
 */
export interface QuestionImageRegion {
  questionNumber: number;
  boundingBox: BoundingBox;
  description?: string;  // 영역 설명 (표, 그래프, 그림 등)
}

/**
 * 분석 결과
 */
export interface ImageRegionAnalysisResult {
  success: boolean;
  regions: QuestionImageRegion[];
  error?: string;
}

// ============================================================
// Gemini Vision 프롬프트
// ============================================================

const VISION_ANALYSIS_PROMPT = `이 이미지는 시험 문제지입니다. 각 문제에 포함된 **순수한 시각 자료(그림, 표, 그래프)의 영역만** 정확하게 찾아주세요.

## ⚠️ 최우선 규칙: 텍스트가 보이면 좌표를 조정해서 제외하세요!

## 올바른 크롭 대상 (시각 콘텐츠만)
✅ 그래프 본문 (막대, 선, 점, 축선만 - 축 레이블/숫자 제외)
✅ 표의 데이터 셀만 (표 제목, 캡션 제외)
✅ 다이어그램, 도형, 화살표
✅ 사진, 지도, 삽화 (캡션 제외)
✅ 화학 구조식, 회로도, 세포 그림

## ❌ 바운딩 박스에서 반드시 제외할 것
❌ 문제 텍스트: "다음은", "위 그림은", "~자료이다", "~나타낸 것이다"
❌ 문제 번호: "1.", "2.", "3." 또는 숫자
❌ 선지: ①②③④⑤
❌ 보기: ㄱ. ㄴ. ㄷ.
❌ 발문: "~고른 것은?", "~옳은 것은?", "~설명으로"
❌ 표/그래프 제목: "< ... >" 형태의 캡션
❌ 축 레이블 텍스트: "시간(s)", "거리(m)" 등

## ★★★ 좌표 설정 핵심 전략 ★★★

**시작점(y)**: 텍스트가 끝나고 순수 그림이 시작되는 지점 + 0.02 여백
**끝점(y+height)**: 그림이 끝나고 텍스트/발문이 시작되는 지점 - 0.02 여백

예시:
- 문제 "다음은 A에 대한 자료이다."가 y=0.15~0.20에 있음
- 그래프가 y=0.21~0.45에 있음
- 발문 "위 자료에 대한 설명으로..."가 y=0.46~0.50에 있음
→ boundingBox: { x: 0.1, y: 0.23, width: 0.5, height: 0.20 }
  (0.21 + 0.02 = 0.23 시작, 0.45 - 0.02 = 0.43 끝, height = 0.20)

## 출력 형식
{
  "regions": [
    {
      "questionNumber": 1,
      "boundingBox": {
        "x": 0.12,
        "y": 0.25,
        "width": 0.35,
        "height": 0.18
      },
      "description": "막대그래프"
    }
  ]
}

## 좌표 규칙 (0-1 정규화)
- x, y: 좌상단 시작점 (0=왼쪽/위, 1=오른쪽/아래)
- width, height: 크롭할 영역 크기
- **height는 최소화**: 텍스트가 포함되지 않도록 작게!

## 검증 (반환 전 확인)
1. y 좌표가 문제 텍스트 아래인가? ✓
2. y+height가 발문 텍스트 위인가? ✓
3. 박스 안에 한글/영어 문장이 없는가? ✓
`;

// ============================================================
// 메인 함수
// ============================================================

/**
 * 이미지에서 문제별 시각 자료 영역 분석
 */
export async function analyzeImageRegions(
  imageBase64: string,
  apiKey: string
): Promise<ImageRegionAnalysisResult> {
  // base64 데이터에서 헤더 제거
  let base64Data = imageBase64;
  let mimeType = "image/jpeg";

  if (imageBase64.startsWith("data:")) {
    const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      base64Data = match[2];
    }
  }

  const requestBody = {
    contents: [
      {
        parts: [
          { text: VISION_ANALYSIS_PROMPT },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topK: 32,
      topP: 0.95,
      maxOutputTokens: 4096,
    },
  };

  try {
    // 60초 타임아웃
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
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
        return { success: false, regions: [], error: "이미지 분석 시간 초과 (60초)" };
      }
      throw err;
    }
    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ImageRegion] Gemini API 오류:", response.status, errorText);
      return {
        success: false,
        regions: [],
        error: `Gemini API 오류: ${response.status}`,
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
        regions: [],
        error: "Gemini 응답 없음",
      };
    }

    const textContent = result.candidates[0].content.parts
      .filter((p: any) => p.text)
      .map((p: any) => p.text)
      .join("");

    console.log("[ImageRegion] Gemini 응답:", textContent.substring(0, 500));

    // JSON 추출
    let jsonText = textContent;
    const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const objectMatch = jsonText.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      jsonText = objectMatch[0];
    }

    const parsed = JSON.parse(jsonText);

    if (!parsed.regions || !Array.isArray(parsed.regions)) {
      return {
        success: true,
        regions: [],
      };
    }

    // 유효성 검사 및 정규화
    const regions: QuestionImageRegion[] = [];
    for (const r of parsed.regions) {
      if (
        typeof r.questionNumber !== "number" ||
        !r.boundingBox ||
        typeof r.boundingBox.x !== "number" ||
        typeof r.boundingBox.y !== "number" ||
        typeof r.boundingBox.width !== "number" ||
        typeof r.boundingBox.height !== "number"
      ) {
        continue;
      }

      // 좌표 범위 검증 (0-1)
      const box = r.boundingBox;
      if (
        box.x < 0 || box.x > 1 ||
        box.y < 0 || box.y > 1 ||
        box.width <= 0 || box.width > 1 ||
        box.height <= 0 || box.height > 1
      ) {
        continue;
      }

      regions.push({
        questionNumber: r.questionNumber,
        boundingBox: {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        },
        description: r.description,
      });
    }

    console.log(`[ImageRegion] 분석 완료: ${regions.length}개 영역`);

    return {
      success: true,
      regions,
    };
  } catch (error) {
    console.error("[ImageRegion] 오류:", error);
    return {
      success: false,
      regions: [],
      error: error instanceof Error ? error.message : "알 수 없는 오류",
    };
  }
}

// ============================================================
// Export
// ============================================================

export { GEMINI_API_KEY };
