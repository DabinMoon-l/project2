# rabbitory-cloud-run-ai

Supabase Phase 3 의 **AI 워크로드 전담 Cloud Run 서비스** 스켈레톤.

- Firebase Cloud Functions 에서 CPU/시간 제약으로 실행하기 부담스러운 작업을 넘겨받음
- Edge Functions 의 CPU 2초 / 150초 idle 제한을 초과하는 함수들이 이쪽으로 이전
- 전체 분류는 `docs/phase3-cf-classification.md` 참고

## 엔드포인트 (Wave 2 완료 기준 목표)

| 경로 | 대체 대상 CF | 상태 |
|------|-------------|------|
| `POST /ai/generate-styled-quiz` | styledQuizGenerator.generateStyledQuiz + workerProcessJob.workerProcessJob | **Wave 0 스텁** |
| `POST /ai/generate-quiz-with-gemini` | gemini.generateQuizWithGemini | 예정 |
| `POST /ai/analyze-image-regions` | imageRegionAnalysis.analyzeImageRegionsCall | 예정 |
| `POST /ai/generate-explanations` | explanationGenerator.generateCustomExplanations | 예정 |
| `POST /ai/monthly-report` | monthlyReport.generateMonthlyReport | 예정 |
| `POST /ai/gemini-queue/process` | geminiQueue.processGeminiQueue | 예정 |
| `POST /battle/pool-refill` | tekkenQuestionPool.tekkenPoolRefillScheduled | 예정 |
| `POST /battle/pool-worker` | tekkenQuestionPool.tekkenPoolWorker | 예정 |
| `POST /ocr/vision` | visionOcr.runVisionOcr | 예정 |
| `POST /admin/bulk-enroll` | studentAuth.bulkEnrollStudents | 예정 |
| `POST /admin/semester-transition` | semesterTransition.februaryTransition + augustTransition | 예정 |
| `POST /stats/weekly-collect` | weeklyStats.collectWeeklyStatsScheduled | 예정 |

## 로컬 실행

```bash
cd cloud-run-ai
npm install
cp .env.example .env   # 로컬 테스트용 값 채우기
npm run dev            # tsx watch 로 hot reload
```

헬스체크:
```bash
curl http://localhost:8080/health
```

HMAC 서명 테스트 (bash):
```bash
SECRET="change-me-to-random-64-chars"
TS=$(date +%s)000
BODY='{"jobId":"test","courseId":"biology","difficulty":"medium"}'
SIG=$(printf "%s.%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST http://localhost:8080/ai/generate-styled-quiz \
  -H "Content-Type: application/json" \
  -H "X-RB-Timestamp: $TS" \
  -H "X-RB-Signature: $SIG" \
  -d "$BODY"
```

## 배포 (Wave 0 검증용)

```bash
# 1. GCP 프로젝트 설정 (기존 firebase 프로젝트와 동일)
gcloud config set project rabbitory-prod

# 2. Cloud Run 배포 (asia-northeast3 / Seoul)
gcloud run deploy rabbitory-cloud-run-ai \
  --source . \
  --region asia-northeast3 \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 5 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 900 \
  --set-env-vars NODE_ENV=production \
  --set-secrets CLOUD_RUN_HMAC_SECRET=cloud-run-hmac:latest
```

> `--allow-unauthenticated` 는 HMAC 서명으로 인증하기 때문에 허용.
> 운영 시 IAM 인증 + 서비스계정 호출로 전환 가능.

## 아키텍처 노트

- **인증**: HMAC SHA-256 + 5분 타임스탬프 window. pg_cron / Edge Function 호출측도 같은 시크릿 사용
- **상태**: stateless. 결과는 Supabase `generation_jobs` / `material_cache` 테이블에 저장하고, 프론트는 Realtime 구독
- **Firebase 접근**: 필요 시 Secret Manager 로 service account JSON 주입 후 `firebase-admin` 초기화 (RTDB / FCM 필요한 엔드포인트만)
- **로깅**: Cloud Logging 자동 수집. 구조적 로그는 `console.log(JSON.stringify(...))`
- **cold start 완화**: 사용자 대기가 있는 엔드포인트는 `--min-instances 1` 로 전환 검토 (월 ~$5)
