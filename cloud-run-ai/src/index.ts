import express, { Request, Response, NextFunction } from "express";
import { verifyHmac } from "./middleware/auth";
import { generateStyledQuizHandler } from "./routes/generateStyledQuiz";

const app = express();

app.use(express.json({ limit: "10mb" }));

// ── 헬스체크 (Cloud Run 프로브 + 배포 검증용) ──
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "rabbitory-cloud-run-ai",
    version: process.env.K_REVISION || "local",
    time: new Date().toISOString(),
  });
});

// ── AI 엔드포인트 (Wave 0: 스텁만, Wave 2 에서 실제 Gemini 호출로 교체) ──
app.post("/ai/generate-styled-quiz", verifyHmac, generateStyledQuizHandler);

// ── 에러 핸들러 ──
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err.message, err.stack);
  res.status(500).json({ ok: false, error: err.message });
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`[rabbitory-cloud-run-ai] listening on :${port}`);
});
