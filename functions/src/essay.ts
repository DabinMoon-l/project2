/**
 * 서술형 문제 AI 보조 채점 Cloud Function
 *
 * Claude API를 사용하여 서술형 답안을 루브릭 기반으로 채점합니다.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ============================================================
// 타입 정의
// ============================================================

/**
 * 루브릭 항목
 */
interface RubricItem {
  criteria: string;
  percentage: number;
  description?: string;
}

/**
 * 루브릭별 채점 결과
 */
interface RubricScore {
  criteriaIndex: number;
  criteria: string;
  maxPercentage: number;
  achievedPercentage: number;
  feedback?: string;
}

/**
 * 채점 요청 데이터
 */
interface GradeEssayRequest {
  /** 문제 ID */
  questionId: string;
  /** 문제 텍스트 */
  questionText: string;
  /** 모범답안 */
  modelAnswer: string;
  /** 학생 답안 */
  studentAnswer: string;
  /** 루브릭 (평가요소 목록) */
  rubric: RubricItem[];
  /** 퀴즈 ID (통계용) */
  quizId?: string;
  /** 학생 ID (통계용) */
  studentId?: string;
}

/**
 * 채점 결과
 */
interface GradeEssayResponse {
  /** 성공 여부 */
  success: boolean;
  /** 최종 점수 (0-100) */
  totalScore: number;
  /** 각 루브릭별 점수 */
  rubricScores: RubricScore[];
  /** 전체 피드백 */
  overallFeedback: string;
  /** 에러 메시지 (실패 시) */
  error?: string;
}

// ============================================================
// Claude API 호출
// ============================================================

/**
 * Claude API를 호출하여 채점 수행
 */
async function callClaudeAPI(
  questionText: string,
  modelAnswer: string,
  studentAnswer: string,
  rubric: RubricItem[]
): Promise<{
  rubricScores: RubricScore[];
  overallFeedback: string;
}> {
  // 환경 변수에서 API 키 가져오기
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다.");
  }

  // 루브릭을 텍스트로 변환
  const rubricText = rubric
    .map((item, index) => {
      let text = `${index + 1}. ${item.criteria} (배점: ${item.percentage}%)`;
      if (item.description) {
        text += `\n   - 평가 기준: ${item.description}`;
      }
      return text;
    })
    .join("\n");

  // 프롬프트 구성
  const prompt = `당신은 대학 교수님의 채점을 보조하는 AI입니다.
다음 서술형 문제에 대한 학생의 답안을 루브릭에 따라 채점해주세요.

## 문제
${questionText}

## 모범답안
${modelAnswer}

## 학생 답안
${studentAnswer}

## 평가 루브릭
${rubricText}

## 채점 지침
1. 각 루브릭 항목별로 학생의 달성도를 평가해주세요.
2. 획득 점수는 해당 항목의 최대 배점을 초과할 수 없습니다.
3. 모범답안과 정확히 일치하지 않더라도, 핵심 개념을 올바르게 이해했다면 점수를 부여해주세요.
4. 각 항목별로 간단한 피드백을 제공해주세요.
5. 전체적인 종합 피드백도 작성해주세요.

다음 JSON 형식으로만 응답해주세요:
{
  "rubricScores": [
    {
      "criteriaIndex": 0,
      "criteria": "항목명",
      "maxPercentage": 최대배점,
      "achievedPercentage": 획득점수,
      "feedback": "해당 항목에 대한 피드백"
    }
  ],
  "overallFeedback": "전체적인 종합 피드백"
}`;

  // Claude API 호출
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Claude API 에러:", errorText);
    throw new Error(`Claude API 호출 실패: ${response.status}`);
  }

  const data = await response.json();

  // 응답에서 JSON 추출
  const content = data.content?.[0]?.text;
  if (!content) {
    throw new Error("Claude API 응답이 비어있습니다.");
  }

  // JSON 파싱 시도
  try {
    // JSON 블록 추출 (```json ... ``` 또는 순수 JSON)
    let jsonStr = content;
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    } else {
      // { } 블록 추출
      const braceMatch = content.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        jsonStr = braceMatch[0];
      }
    }

    const result = JSON.parse(jsonStr);

    // 결과 검증 및 정규화
    const rubricScores: RubricScore[] = rubric.map((item, index) => {
      const score = result.rubricScores?.find(
        (s: RubricScore) => s.criteriaIndex === index
      ) || result.rubricScores?.[index];

      return {
        criteriaIndex: index,
        criteria: item.criteria,
        maxPercentage: item.percentage,
        achievedPercentage: Math.min(
          item.percentage,
          Math.max(0, score?.achievedPercentage || 0)
        ),
        feedback: score?.feedback || "",
      };
    });

    return {
      rubricScores,
      overallFeedback: result.overallFeedback || "채점이 완료되었습니다.",
    };
  } catch (parseError) {
    console.error("JSON 파싱 에러:", parseError, "원본:", content);
    throw new Error("채점 결과 파싱에 실패했습니다.");
  }
}

// ============================================================
// Cloud Function
// ============================================================

/**
 * AI 보조 채점 (Callable Function)
 *
 * 서술형 문제의 학생 답안을 Claude API를 사용하여 채점합니다.
 * 교수님만 호출할 수 있습니다.
 *
 * @param data - 채점 요청 데이터
 * @returns 채점 결과
 */
export const gradeEssay = onCall(
  {
    region: "asia-northeast3",
    // API 호출에 시간이 걸릴 수 있으므로 타임아웃 연장
    timeoutSeconds: 60,
    // 메모리 설정
    memory: "256MiB",
  },
  async (request): Promise<GradeEssayResponse> => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const db = getFirestore();

    // 교수님 권한 확인
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError(
        "permission-denied",
        "교수님만 AI 채점 기능을 사용할 수 있습니다."
      );
    }

    // 요청 데이터 검증
    const data = request.data as GradeEssayRequest;

    if (!data.questionText?.trim()) {
      throw new HttpsError("invalid-argument", "문제 텍스트가 필요합니다.");
    }

    if (!data.modelAnswer?.trim()) {
      throw new HttpsError("invalid-argument", "모범답안이 필요합니다.");
    }

    if (!data.studentAnswer?.trim()) {
      throw new HttpsError("invalid-argument", "학생 답안이 필요합니다.");
    }

    if (!data.rubric || data.rubric.length === 0) {
      throw new HttpsError("invalid-argument", "루브릭이 필요합니다.");
    }

    // 루브릭 배점 합계 확인
    const totalPercentage = data.rubric.reduce(
      (sum, item) => sum + item.percentage,
      0
    );
    if (Math.abs(totalPercentage - 100) > 0.01) {
      throw new HttpsError(
        "invalid-argument",
        `루브릭 배점 합계가 100%가 아닙니다. (현재: ${totalPercentage}%)`
      );
    }

    try {
      // Claude API 호출
      const { rubricScores, overallFeedback } = await callClaudeAPI(
        data.questionText,
        data.modelAnswer,
        data.studentAnswer,
        data.rubric
      );

      // 총점 계산
      const totalScore = rubricScores.reduce(
        (sum, score) => sum + score.achievedPercentage,
        0
      );

      // 채점 기록 저장 (통계용)
      if (data.quizId && data.studentId && data.questionId) {
        await db
          .collection("quizzes")
          .doc(data.quizId)
          .collection("essayGrades")
          .add({
            questionId: data.questionId,
            studentId: data.studentId,
            gradedBy: userId,
            gradingMethod: "ai_assisted",
            totalScore,
            rubricScores,
            overallFeedback,
            createdAt: FieldValue.serverTimestamp(),
          });
      }

      console.log("AI 채점 완료:", {
        questionId: data.questionId,
        totalScore,
        gradedBy: userId,
      });

      return {
        success: true,
        totalScore,
        rubricScores,
        overallFeedback,
      };
    } catch (error) {
      console.error("AI 채점 에러:", error);

      // 에러 유형에 따른 처리
      if (error instanceof Error) {
        if (error.message.includes("ANTHROPIC_API_KEY")) {
          throw new HttpsError(
            "failed-precondition",
            "AI 채점 서비스가 설정되지 않았습니다. 관리자에게 문의하세요."
          );
        }
        throw new HttpsError("internal", `채점 중 오류가 발생했습니다: ${error.message}`);
      }

      throw new HttpsError("internal", "알 수 없는 오류가 발생했습니다.");
    }
  }
);

/**
 * 일괄 채점 (Callable Function)
 *
 * 여러 학생의 답안을 한 번에 채점합니다.
 * 비용 절감을 위해 순차적으로 처리합니다.
 */
export const gradeEssayBatch = onCall(
  {
    region: "asia-northeast3",
    // 일괄 처리에는 더 긴 타임아웃 필요
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const db = getFirestore();

    // 교수님 권한 확인
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError(
        "permission-denied",
        "교수님만 AI 채점 기능을 사용할 수 있습니다."
      );
    }

    const { submissions, questionText, modelAnswer, rubric, quizId, questionId } =
      request.data as {
        submissions: Array<{
          studentId: string;
          studentAnswer: string;
        }>;
        questionText: string;
        modelAnswer: string;
        rubric: RubricItem[];
        quizId: string;
        questionId: string;
      };

    if (!submissions || submissions.length === 0) {
      throw new HttpsError("invalid-argument", "채점할 답안이 없습니다.");
    }

    // 최대 50개 제한 (비용 및 시간 고려)
    if (submissions.length > 50) {
      throw new HttpsError(
        "invalid-argument",
        "한 번에 최대 50개까지 채점할 수 있습니다."
      );
    }

    const results: Array<{
      studentId: string;
      success: boolean;
      totalScore?: number;
      error?: string;
    }> = [];

    // 순차 처리 (API rate limit 고려)
    for (const submission of submissions) {
      try {
        const { rubricScores, overallFeedback } = await callClaudeAPI(
          questionText,
          modelAnswer,
          submission.studentAnswer,
          rubric
        );

        const totalScore = rubricScores.reduce(
          (sum, score) => sum + score.achievedPercentage,
          0
        );

        // 결과 저장
        await db
          .collection("quizzes")
          .doc(quizId)
          .collection("essayGrades")
          .add({
            questionId,
            studentId: submission.studentId,
            gradedBy: userId,
            gradingMethod: "ai_assisted_batch",
            totalScore,
            rubricScores,
            overallFeedback,
            createdAt: FieldValue.serverTimestamp(),
          });

        results.push({
          studentId: submission.studentId,
          success: true,
          totalScore,
        });

        // API rate limit 방지를 위한 딜레이
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`학생 ${submission.studentId} 채점 실패:`, error);
        results.push({
          studentId: submission.studentId,
          success: false,
          error: error instanceof Error ? error.message : "채점 실패",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    console.log(`일괄 채점 완료: ${successCount}/${submissions.length}명`);

    return {
      success: true,
      totalCount: submissions.length,
      successCount,
      failCount: submissions.length - successCount,
      results,
    };
  }
);
