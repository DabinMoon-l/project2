# Supabase Phase 3 — Cloud Functions 분류 및 이전 계획

> Firebase Cloud Functions → Supabase Edge Functions + Cloud Run + Firebase 잔류
> 작성일: 2026-04-22
> 전체 대상: **47개 export CF** (실제 ~55개 함수, scheduled/triggered 포함)

---

## 1. 목표

Phase 2 완료 시점(rankings/radar/reviews/posts/rabbits/enrollment/users/quizzes 전부 Supabase 단일소스화) 이후, 서버 코드 자체를 Firebase 환경 밖으로 이동한다.

- **비용**: Cloud Functions 컴퓨트(₩45K/월) → Edge Functions(사실상 무료 한도 내) + Cloud Run(AI 워크로드만 on-demand)
- **테넌트 격리**: Supabase RLS + Edge Functions JWT 검증으로 `org_id` 자동 주입
- **지연 최소화**: 학생 4탭 내 자주 쓰이는 onCall(recordAttempt, equipRabbit 등)은 Edge로 내려 cold start ms 단위 유지
- **Firebase 잔류**: 배틀(RTDB 50ms), FCM, 그리고 Firestore 트리거군(PostgreSQL trigger로 재작성 전까지)

---

## 2. 런타임 제약 비교

| 항목 | Cloud Functions v2 (현재) | Supabase Edge Functions | Cloud Run (새로 도입) |
|------|---------------------------|-------------------------|------------------------|
| 런타임 | Node 22 | **Deno** + npm 호환 | Node 22 (컨테이너) |
| CPU 시간 | 제한 없음 | **2초** (async I/O 제외) | 제한 없음 |
| Idle timeout | 540s(max) | **150s** | 3600s |
| Wall clock | 540s | 400s | 3600s |
| 메모리 | 128MB~16GB | 150MB (공식), 실측 ~256MB | 128MB~32GB |
| 번들 크기 | 수백 MB OK | **20MB 한도** (번들 후) | 이미지 무제한 |
| Cold start | 수백 ms~수초 | **ms 단위** (ESZip 사전번들) | 수초(최초) |
| Native addon | 허용 (jimp 등) | ⚠️ 위험 (sharp/canvas 실패 사례 다수) | 허용 |
| 동시 실행 | maxInstances 설정 | 자동 스케일 | min/max 인스턴스 설정 |
| 지역 | asia-northeast3 | 리전 선택 (Tokyo 있음) | asia-northeast3 |
| 비용 모델 | 호출 + CPU-ms + 메모리-ms | 호출 500K 무료 → $2/100만 호출 | vCPU-s + 메모리-s (idle 시 0) |

**핵심 병목**: Edge Functions의 **CPU 2초 제한**. async I/O(HTTP, DB)는 제외되므로 "외부 API 호출 후 응답 기다리기"는 Edge가 충분히 감당. 하지만 다음 작업은 Edge에서 실패한다.

- jimp 이미지 크롭 (CPU 수초)
- Gemini thinking 응답(10KB+) JSON 파싱
- exceljs/docx 리포트 렌더링
- PDF 파싱 (pdfjs-dist)
- 대량 배치 Firestore 쿼리 결과 집계

→ **이런 함수는 전부 Cloud Run.**

---

## 3. 분류 결과 요약

| 대상 | 함수 수 | 이전 시점 |
|------|--------|----------|
| 🔵 Edge Functions 이전 | **24개** | Phase 3 Wave 1 |
| 🟠 Cloud Run 이전 | **13개** | Phase 3 Wave 2 |
| 🔴 Firebase 잔류 | **13개** | 유지 (배틀·FCM) 또는 Phase 3 Wave 3에서 pg_trigger로 재작성 |

---

## 4. Edge Functions 이전 (24개) 🔵

**기준**: stateless, 외부 API 응답 대기는 있어도 CPU 작업은 < 2s, 번들 < 20MB.

### 4.1 게시판·공지 (onCall 10개)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| acceptComment | board.ts | <1s | EXP 지급 트랜잭션만 |
| deletePost | board.ts | <2s | 자식 댓글 cascade는 PostgreSQL FK에 위임 |
| deleteThread | board.ts | <1s | |
| voteOnPoll | announcementActions.ts | <1s | |
| submitPollTextResponse | announcementActions.ts | <1s | |
| submitPollSurvey | announcementActions.ts | <1s | |
| getPollResponses | announcementActions.ts | <1s | |
| getPollResponsesBatch | announcementActions.ts | <2s | 병렬 read |
| reactToAnnouncement | announcementActions.ts | <1s | |
| markAnnouncementsRead | announcementActions.ts | <1s | |

### 4.2 퀴즈·복습 (onCall 6개)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| recordAttempt | recordAttempt.ts | <2s | 현재 maxInstances 200 — Edge 자동 스케일로 대체 |
| updatePracticeAnsweredAt | index.ts | <1s | |
| recordReviewPractice | reviewPractice.ts | <1s | |
| regradeQuestions | regradeQuestions.ts | 수 초 | 문항 수에 따라. 100개 초과 시 Cloud Run 후보 |
| initCreatorStats | initCreatorStats.ts | <1s | |
| getStyleProfile | styledQuizGenerator.ts | <1s | 읽기만 |

### 4.3 게이미피케이션 (onCall 5개)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| equipRabbit | rabbitEquip.ts | <1s | |
| unequipRabbit | rabbitEquip.ts | <1s | |
| spinRabbitGacha | rabbitGacha.ts | <1s | idempotency 처리도 Edge로 가능 |
| claimGachaRabbit | rabbitGacha.ts | <1s | |
| levelUpRabbit | rabbitLevelUp.ts | <1s | |

### 4.4 AI 가벼운 호출 (onCall 5개)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| extractKeywords | gemini.ts | <30s | thinking 4KB, 응답 파싱도 5KB 이하 |
| getGeminiUsage | gemini.ts | <1s | 사용량 조회만 |
| runClovaOcr | ocr.ts | <10s | REST 호출, base64 전달 |
| getOcrUsage | ocr.ts | <1s | |
| getVisionOcrUsage | visionOcr.ts | <1s | |

### 4.5 AI 파이프라인 컨트롤 플레인 (onCall 5개)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| enqueueGenerationJob | enqueueGenerationJob.ts | <2s | Storage 업로드 경로만 만들고 리턴 |
| checkJobStatus | enqueueGenerationJob.ts | <1s | 상태 조회만 |
| addToGeminiQueue | geminiQueue.ts | <1s | 큐 인큐 |
| checkGeminiQueueStatus | geminiQueue.ts | <1s | |
| claimGeminiQueueResult | geminiQueue.ts | <1s | 결과 소비 |

### 4.6 인증·학생관리 가벼운 것 (onCall 7개)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| registerStudent | studentAuth.ts | <2s | 단일 계정 생성 |
| resetStudentPassword | studentAuth.ts | <1s | |
| requestPasswordReset | studentAuth.ts | <3s | Gmail SMTP 호출 (Edge에서 `nodemailer` 불안정 → **Resend/Supabase Email로 교체 고려**) |
| updateRecoveryEmail | studentAuth.ts | <1s | |
| updateStudentClass | studentAuth.ts | <1s | |
| grantDefaultRabbit | studentAuth.ts | <1s | |
| initProfessorAccount | professorAuth.ts | <1s | allowedProfessors 확인 |

### 4.7 공통·관리 (onCall 5개)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| checkRateLimitCall | index.ts | <1s | Supabase `rate_limits` 테이블로 교체 |
| getUserStats | index.ts | <1s | |
| getLeaderboard | index.ts | <1s | ranking 테이블 직접 조회 |
| submitInquiry | inquiry.ts | <2s | |
| uploadCourseScope | courseScope.ts | <2s | |
| getCourseScope | courseScope.ts | <1s | |
| backfillChapterTags | courseScope.ts | 수 초 | |
| refreshRadarNorm | computeRadarNorm.ts | <5s | 단일 org 계산 |
| refreshRankings | computeRankings.ts | <5s | |

### 4.8 스케줄 → pg_cron 전환 (5개)

모두 10초 이내 작업, pg_cron + Supabase function 으로 이전.

| 함수 | 스케줄 | 이전 방식 |
|------|--------|---------|
| cleanupRateLimitsScheduled | every 1h | `CREATE FUNCTION`으로 SQL만 |
| retryQueuedJobs | every 5m | Edge Function + pg_cron.schedule |
| cleanupExpiredJobs | every 1h | SQL DELETE |
| cleanupGeminiQueue | every 6h | SQL DELETE |
| cleanupOldQuizJobs (pptx) | daily 03:00 | SQL DELETE |

### 4.9 마이그레이션 군 (일회성, 6개)

`fillDogam`, `cleanupExtraRabbits`, `migrateRabbitStats`, `migrateFeedbackCount`, `migrateQuizAnswersTo0Indexed`, `migrateExistingAccounts` → **전부 일회성**. Phase 3에서는 **이전하지 않고 Firebase에 남겨둔 뒤 완료 후 삭제**.

---

## 5. Cloud Run 이전 (13개) 🟠

**기준**: AI thinking 파싱(CPU), 장시간 실행(>150s), native module(jimp), 대량 배치.

배포 형태: `cloud-run-ai/` 단일 Express 앱 + 여러 엔드포인트. 현재 `cloud-run-pptx/`와 동일 구조 재사용.

| 함수 | 파일 | 이유 | 현재 옵션 |
|------|------|------|----------|
| **generateStyledQuiz** | styledQuizGenerator.ts | Gemini thinking 8~10KB + JSON 파싱 CPU | 1GiB, 180s |
| **generateQuizWithGemini** | gemini.ts | 이미지 10장 + thinking 10KB | 60s |
| **generateCustomExplanations** | explanationGenerator.ts | Gemini 호출 다수 | — |
| **workerProcessJob** | workerProcessJob.ts | Firestore 트리거 → HTTP trigger로 변환. jimp 크롭 + AI 호출 | 1GiB, 300s, maxConcurrent 40 |
| **analyzeImageRegionsCall** | imageRegionAnalysis.ts | Gemini Vision + jimp | — |
| **tekkenPoolRefillScheduled** | tekkenQuestionPool.ts | 챕터당 90s, 전 과목 × 전 챕터 직렬 | scheduled |
| **tekkenPoolWorker** | tekkenQuestionPool.ts | 배치 15문제 × 3초 대기 | 1GiB, 540s, max 5 |
| **tekkenPoolRefill** | tekkenQuestionPool.ts | 수동 트리거 대응 | — |
| **processGeminiQueue** | geminiQueue.ts | 큐 소비자, 2초 rate-limit sleep | scheduled 5m |
| **generateMonthlyReport** | monthlyReport.ts | Claude + exceljs/docx 후처리 | — |
| **generateMonthlyReportScheduled** | monthlyReport.ts | 전 반 순회 | 03:00 매월 1일 |
| **collectWeeklyStatsScheduled** | weeklyStats.ts / stats/collector.ts | 540s, 1GiB 필요 | 월요일 00:00 |
| **backfillWeeklyStats** | weeklyStats.ts | 수동 재집계 | — |
| **convertPptxToPdf / onPptxJobCreated / cleanupOldQuizJobs** | pptx.ts | **이미 Cloud Run(`cloud-run-pptx/main.py`)** 연동 중 — 그대로 유지 | — |
| **runVisionOcr** | visionOcr.ts | @google-cloud/vision 이미지 처리 heavy | — |
| **februaryTransition / augustTransition** | semesterTransition.ts | 대규모 배치 삭제·승급 | scheduled |
| **bulkEnrollStudents** | studentAuth.ts | 수백 계정 한 번에 생성 | — |
| **deleteStudentAccount / removeEnrolledStudent** | studentAuth.ts | Auth 삭제 + Firestore cascade | — |

> 분류 숫자 "13개"는 대표 함수 기준. 실제 엔드포인트는 ~18개. `cloud-run-ai` 서비스 1개에 라우트로 분리.

### Cloud Run 엔드포인트 그룹 설계

```
cloud-run-ai/
├── POST /ai/generate-styled-quiz     (workerProcessJob, generateStyledQuiz, generateQuizWithGemini 통합)
├── POST /ai/analyze-image-regions
├── POST /ai/generate-explanations
├── POST /ai/monthly-report           (수동 트리거 + pg_cron 호출)
├── POST /ai/gemini-queue/process
├── POST /battle/pool-refill          (scheduled)
├── POST /battle/pool-worker          (큐 소비자)
├── POST /ocr/vision
├── POST /admin/bulk-enroll
├── POST /admin/semester-transition
└── POST /stats/weekly-collect
```

모든 엔드포인트는 **Supabase service role key + HMAC 서명** 으로 인증. pg_cron → Supabase secrets → Cloud Run HTTPS 호출.

---

## 6. Firebase 잔류 (13개) 🔴

### 6.1 배틀 (RTDB) — 영구 잔류 (11개)

RTDB가 제공하는 50ms 양방향 지연을 Supabase Realtime이 만족 못 함. **Phase 3 대상 외.**

| 함수 | 파일 |
|------|------|
| joinMatchmaking, cancelMatchmaking, matchWithBot | tekken/tekkenMatchmaking.ts |
| submitAnswer, submitTimeout | tekken/tekkenScoring.ts |
| swapRabbit, submitMashResult | tekken/tekkenActions.ts |
| startBattleRound | tekken/tekkenRound.ts |
| sendBattleInvite, respondBattleInvite | tekken/battleInvite.ts |
| tekkenCleanup (scheduled) | tekkenCleanup.ts |

**변경점**: 호출부(클라이언트 `callFunction`)에서 Firebase Functions region 지정 유지. Supabase 인증 토큰 → Firebase 커스텀 토큰 교환 레이어 필요 (Phase 3 말미).

### 6.2 FCM 푸시 (6개)

Firebase Admin SDK `getMessaging()` 그대로 사용. Cloud Run 컨테이너로 이동 가능하지만 **현재 규모에서는 Firebase 유지가 저렴**.

| 함수 | 파일 |
|------|------|
| sendNotificationToUser | notification.ts |
| sendNotificationToClass | notification.ts |
| onNewQuizCreated | notification.ts |
| onBoardCommentCreated | notification.ts |
| onBoardReplyCreated | notification.ts |
| onAnnouncementCreated | notification.ts |

### 6.3 Firestore 트리거 군 (Phase 3 Wave 3에서 재작성)

이 함수들은 Firestore 문서 변경 이벤트 기반이므로 "Supabase 단일소스 전환"이 끝나야 PostgreSQL trigger + pg_notify + Edge Function webhook 패턴으로 재작성 가능.

| 함수 | 트리거 | 재작성 패턴 |
|------|-------|------------|
| onQuizComplete / updateQuizStatistics / onQuizCreate | INSERT quiz_results / quizzes | AFTER INSERT trigger → NOTIFY → Edge Function `onQuizComplete` |
| onQuizMakePublic / onQuizSync | UPDATE quizzes | AFTER UPDATE trigger |
| onPostCreate / onPostUpdate / onLikeReceived / onLikeRemoved / onCommentCreate / onCommentDeleted | posts / comments | 각각 AFTER INSERT/UPDATE/DELETE |
| onFeedbackSubmit / onFeedbackStatusChange | feedbacks | AFTER INSERT/UPDATE |
| generateReviewsOnResult | INSERT quiz_results | 위 `onQuizComplete` 와 한 webhook에 통합 |
| onOnboardingComplete | UPDATE user_profiles | AFTER UPDATE trigger |
| onProfessorQuizCreated | UPDATE quizzes (isPublished==true) | AFTER UPDATE trigger, 조건부 NOTIFY |

→ **Wave 3 착수 전까지는 Firebase 유지**. Supabase dual-write(Phase 2 완료)로 Firestore에도 계속 쓰기 때문에 기존 트리거 그대로 동작.

---

## 7. AI 호출 경로 분리

### 7.1 현재 (Phase 2)

```
Client → onCall CF → Gemini/Claude/Clova → Firestore write → 응답
```

### 7.2 Phase 3 목표

```
Client
  ├─ (가벼움) → Edge Function → Gemini/Clova → Supabase write
  └─ (무거움) → Edge Function (enqueue만) → jobs 테이블 insert
                                              ↓ NOTIFY
                                    Cloud Run worker 소비
                                              ↓
                                    Gemini thinking → Supabase write
                                              ↓ Realtime
                                    Client 폴링/구독으로 결과 수신
```

### 7.3 API 분류

| API | 경로 | 이유 |
|-----|------|-----|
| Gemini 문제생성 (thinking 10KB) | **Cloud Run** | CPU 파싱, 60s+ |
| Gemini 키워드/영역분석 | **Edge** | thinking 4KB 이하, <30s |
| Gemini 콩콩이 답변 | **Edge** (기본) / Cloud Run (scope 12KB 넘을 때) | 대부분 stateless |
| Claude 월별 리포트 | **Cloud Run** | Claude 자체는 가볍지만 exceljs/docx 후처리 |
| Clova OCR | **Edge** | REST 단일 호출 |
| Vision OCR | **Cloud Run** | 이미지 전처리 heavy |
| PPTX → PDF | **Cloud Run** (이미 있음) | LibreOffice |

### 7.4 Streaming 도입 여지 (Phase 3 선택)

현재 모든 AI 호출이 완성 응답 대기 → 콩콩이 답변, 문제 해설 등 UX 체감 개선 여지.

- **Edge Functions**: `ReadableStream` 응답 지원. Gemini `streamGenerateContent` + `TransformStream`으로 바로 SSE 전달 가능
- **도입 대상 후보**:
  1. 콩콩이 AI 답변 (board) — 사용자 체감 큼
  2. 퀴즈 해설 생성 (explanationGenerator) — 교수가 확인하는 순간 스트리밍

- **도입하지 말 것**: 문제 생성 (JSON 구조 검증 필요, 부분 파싱 어려움)

Streaming은 Phase 3 **Wave 4 선택 작업**으로 분류. 기본 마이그레이션은 non-streaming 유지.

---

## 8. 이전 순서 (Wave 계획)

### Wave 0 — 스켈레톤 검증 (1주)

- `cloud-run-ai/` Dockerfile + Express 기본 앱 + `/health` + `/ai/generate-styled-quiz` 스텁
- `supabase/functions/get-gemini-usage/` Edge Function 1개 (가장 가벼움)
- 배포 파이프라인 확인: `firebase deploy` vs `supabase functions deploy` vs `gcloud run deploy`
- HMAC 서명 / Supabase JWT 검증 공통 라이브러리

### Wave 1 — Edge 이전 24개 (3주)

순서:
1. **읽기 전용·통계** (getUserStats, getLeaderboard, getGeminiUsage, getOcrUsage, getVisionOcrUsage, getStyleProfile, getCourseScope, getPollResponses, getPollResponsesBatch)
2. **게이미피케이션 쓰기** (equip/unequip/spin/claim/levelUp) — 실패 시 재시도 가능
3. **게시판 write** (acceptComment, deletePost, deleteThread, vote*, react*, mark*)
4. **퀴즈·복습 write** (recordAttempt ← 가장 중요, 충분히 로드테스트 후), updatePracticeAnsweredAt, recordReviewPractice
5. **인증·공통** (initProfessorAccount, register/reset/update*, submitInquiry, checkRateLimit)
6. **AI 가벼움** (extractKeywords, runClovaOcr)
7. **컨트롤 플레인** (enqueueGenerationJob, checkJobStatus, geminiQueue onCall 3개)
8. **스케줄 → pg_cron** (cleanup 5개, retryQueuedJobs)
9. **refresh 계산** (refreshRankings, refreshRadarNorm, computeRankingsScheduled, computeRadarNormScheduled) — Supabase materialized view + pg_cron 로 교체

각 함수는 **dual-deploy 기간 2일**:
- Day 0: Edge Function 배포하되 flag `USE_EDGE_{FUNCTION}=false`
- Day 1: 비교 로그 확인 (Firebase CF + Edge 병렬 호출, 결과 diff)
- Day 2: flag on

### Wave 2 — Cloud Run 이전 13개 (3주)

순서:
1. `cloud-run-ai/` 실제 스켈레톤 → `/ai/extract-keywords`(이미 Edge로 갔으니 skip) → `/ai/generate-styled-quiz` 먼저
2. `workerProcessJob` → Firestore 트리거 제거 → pg_notify → Cloud Run 소비 (이때 Wave 3의 PostgreSQL trigger 설계와 맞물림)
3. `tekkenPoolRefill/Worker` (배틀 문제 풀은 Firestore → Supabase 테이블로 이전 필요, Phase 2 후반 작업)
4. `generateMonthlyReport`
5. `collectWeeklyStatsScheduled`
6. `februaryTransition / augustTransition` (학기 전환 전까지는 Firebase 유지해도 무방)
7. `bulkEnrollStudents / deleteStudentAccount / removeEnrolledStudent`
8. `runVisionOcr`

### Wave 3 — Firestore 트리거 재작성 (2주)

전제: **Supabase 단일소스 전환 완료**(dual-write 중단). 그 전에 트리거 재작성하면 이중 동작.

- PostgreSQL `AFTER INSERT/UPDATE/DELETE` trigger + `pg_notify('cf_event', payload)`
- Edge Function 구독 대신 **Cloud Run 또는 Edge Function HTTP webhook** 패턴 (Supabase Database Webhooks 기능 활용)
- 9개 트리거 → **별도 매핑 문서** (`docs/phase3-trigger-mapping.md`, Task #4)

### Wave 4 — 정리 (1주)

- 마이그레이션 함수 6개 Firebase에서 제거
- `notification.ts`는 Firebase 유지 결정 유지 (FCM Admin 복잡성 회피)
- `functions/` 디렉토리를 배틀·FCM·트리거 잔여분만 남기도록 축소
- CLAUDE.md 업데이트

---

## 9. 리스크 & 대응

| 리스크 | 확률 | 영향 | 대응 |
|--------|------|------|------|
| Edge Function CPU 2s 초과 (runtime error) | MEDIUM | MEDIUM | Wave 1 각 함수 배포 후 p95 CPU time 로그 수집 → 초과 시 Cloud Run 재분류 |
| Deno가 특정 npm 패키지 import 실패 | MEDIUM | LOW | Wave 0에서 nodemailer/firebase-admin 번들 테스트 선행 |
| Firebase Auth 토큰 → Supabase RLS 매핑 불일치 | LOW | HIGH | Edge Function에서 Firebase JWT 검증 → Supabase service_role로 쿼리 (Phase 3 전반 유지, Better Auth는 Phase 6) |
| Cloud Run cold start 3~5초 → UX 저하 | HIGH | MEDIUM | `min-instances: 1` 설정 (월 ~$5 추가). 또는 Edge Function에서 "처리 중" 즉시 응답 + 폴링 |
| pg_cron 실행 실패 감지 어려움 | MEDIUM | MEDIUM | Supabase `pg_cron.job_run_details` 모니터링 + Sentry webhook |
| Firestore 트리거 재작성 시 이벤트 누락 | LOW | HIGH | Wave 3 진입 전에 Supabase 단일소스 전환 완료 확인, dual-write 모드 2주간 shadow-trigger 운영 후 전환 |
| 배틀에서 Firestore → Supabase 잔여 읽기로 레이턴시 증가 | MEDIUM | HIGH | 배틀 참여자 user_profile 은 RTDB에 denormalize |

---

## 10. 성공 지표

| 지표 | 현재 | 목표 (Phase 3 종료) |
|------|------|-------------------|
| Cloud Functions 월 비용 | ₩45K | < ₩10K (배틀·FCM·트리거 잔여) |
| Edge Functions 호출 수 | 0 | 월 ~50만 (무료 한도 내) |
| Cloud Run 컴퓨트 | ₩0 | 월 ~$30 (AI 워크로드만) |
| 학생 onCall p95 지연 | ~400ms | < 200ms (Edge cold start ms 단위) |
| AI 문제 생성 실패율 | ~2% (timeout 포함) | < 0.5% (Cloud Run 300s 여유) |
| 서버 코드 Firebase 의존도 | 47 export | 13 export (배틀+FCM만) |

---

## 11. 참고

- Supabase Edge Functions 제약: https://supabase.com/docs/guides/functions/limits
- CPU time 트러블슈팅: https://supabase.com/docs/guides/troubleshooting/edge-function-cpu-limits
- npm 호환성: https://supabase.com/blog/edge-functions-node-npm
- 전체 SaaS 아키텍처: `docs/saas-architecture.md`
- Phase 2 현황: MEMORY의 `project_supabase_phase2_progress.md`
