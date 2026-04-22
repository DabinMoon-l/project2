import { Request, Response } from "express";

/**
 * POST /ai/generate-styled-quiz
 *
 * Wave 0 스켈레톤: 요청 바디 echo + 지연 시뮬레이션만. Wave 2 에서 실제 로직 이식:
 *   - functions/src/styledQuizGenerator.ts 의 buildFullPrompt + Gemini 호출
 *   - functions/src/workerProcessJob.ts 의 jimp 크롭 + Storage 업로드
 *   - 결과를 Supabase `generation_jobs.result` 에 기록하고 Realtime 으로 프론트 통지
 */
export async function generateStyledQuizHandler(req: Request, res: Response): Promise<void> {
  const { jobId, courseId, difficulty, questionCount } = req.body ?? {};

  if (!jobId || !courseId || !difficulty) {
    res.status(400).json({ ok: false, error: "jobId, courseId, difficulty required" });
    return;
  }

  // Wave 0: 실제 Gemini 호출 대신 즉시 응답
  res.json({
    ok: true,
    stub: true,
    jobId,
    courseId,
    difficulty,
    questionCount: questionCount ?? 10,
    note: "Wave 2 에서 Gemini thinking 호출로 교체 예정",
  });
}
