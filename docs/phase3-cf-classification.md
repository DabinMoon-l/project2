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

## 3. 분류 결과 요약 (2026-04-22 재검증 반영)

Wave 0 초기 분류 후 프론트엔드 전수 조사 결과, 47개 export 중 **프론트 실제 호출은 onCall 중 38개뿐**. 나머지는 dead code 지만 SaaS 확장 관점에서 재분류.

| 대상 | 함수 수 | 이전 시점 | 비고 |
|------|--------|----------|------|
| 🔵 Edge Functions 이전 (실사용) | **35개** | Phase 3 Wave 1 | 6개 묶음 + 스케줄 5개 + 마이그레이션 완료분 |
| 🟠 Cloud Run 이전 | **9개** | Phase 3 Wave 2 | dead 인 AI onCall 3개 제외 |
| 🔴 Firebase 잔류 | **13개** | 영구 또는 Phase 3 Wave 3 | 배틀 11 + FCM 6 (겹침 포함) + Firestore 트리거 9개 |
| 🌱 Rebirth (SaaS 대기) | **9개** | Phase 5~7 활성화 시 Edge 이전 | 지금은 CF 그대로 보관 |
| ☠️ Obsolete (삭제 대상) | **13개** | Wave 4 정리 | 대체 파이프라인이 이미 동작 |
| 🧹 OneShot (일회성 마이그레이션) | **5개** | 검증 후 즉시 삭제 | 더는 실행 불필요 |

---

## 4. Edge Functions 이전 — 실사용 35개 🔵

**기준**: stateless, 외부 API 응답 대기는 있어도 CPU 작업은 < 2s, 번들 < 20MB, **프론트에서 실제 호출됨**.

dead code 였던 `voteOnPoll` / `submitPollTextResponse` / `unequipRabbit` / `extractKeywords` / `getStyleProfile` / `getCourseScope` / `getOcrUsage` / `getVisionOcrUsage` / `uploadCourseScope` / `backfillChapterTags` / `grantDefaultRabbit` / `checkRateLimitCall` / `getUserStats` / `getLeaderboard` / `refreshRadarNorm` 은 이번 목록에서 제외 (section 5.5 참고).

### 4.1 Wave 1-A: 게시판 onCall (3개)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| acceptComment | board.ts | <1s | EXP 지급 트랜잭션 |
| deletePost | board.ts | <2s | 자식 댓글 cascade 는 PostgreSQL FK |
| deleteThread | board.ts | <1s | |

### 4.2 Wave 1-B: 공지 onCall (5개)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| markAnnouncementsRead | announcementActions.ts | <1s | |
| reactToAnnouncement | announcementActions.ts | <1s | 이모지 6종 |
| submitPollSurvey | announcementActions.ts | <1s | `voteOnPoll` / `submitPollTextResponse` 통합 구현 |
| getPollResponses | announcementActions.ts | <1s | 교수 권한 체크 필요 |
| getPollResponsesBatch | announcementActions.ts | <2s | 병렬 read |

### 4.3 Wave 1-C: 게이미피케이션 (4개)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| spinRabbitGacha | rabbitGacha.ts | <1s | idempotency (pendingSpin) |
| claimGachaRabbit | rabbitGacha.ts | <1s | 이름 확정 |
| equipRabbit | rabbitEquip.ts | <1s | 자동 unequip 로직 포함 (unequipRabbit dead) |
| levelUpRabbit | rabbitLevelUp.ts | <1s | 랜덤 스탯 분배 |

### 4.4 Wave 1-D: AI 파이프라인 컨트롤 (5개 + getGeminiUsage 완료)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| enqueueGenerationJob | enqueueGenerationJob.ts | <2s | Storage 업로드 경로 생성 |
| checkJobStatus | enqueueGenerationJob.ts | <1s | |
| addToGeminiQueue | geminiQueue.ts | <1s | |
| checkGeminiQueueStatus | geminiQueue.ts | <1s | |
| claimGeminiQueueResult | geminiQueue.ts | <1s | |
| ~~getGeminiUsage~~ | gemini.ts | <1s | **Wave 0 완료** |

### 4.5 Wave 1-E: 퀴즈·복습 (5개)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| recordAttempt | recordAttempt.ts | <2s | **로드테스트 선행 필수** — maxInstances 200 → Edge 자동 스케일 |
| updatePracticeAnsweredAt | index.ts | <1s | |
| recordReviewPractice | reviewPractice.ts | <1s | EXP +25 |
| initCreatorStats | initCreatorStats.ts | <1s | |
| regradeQuestions | regradeQuestions.ts | 수 초 | 100문항 초과 시 Cloud Run 재검토 |

### 4.6 Wave 1-F: 인증·학생관리 (8개, bulk는 Cloud Run)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| registerStudent | studentAuth.ts | <2s | 내부에서 `grantDefaultRabbit` import — 함께 묶어 이전 |
| resetStudentPassword | studentAuth.ts | <1s | |
| requestPasswordReset | studentAuth.ts | <3s | Gmail SMTP → **Resend / Supabase Email 로 교체 고려** |
| updateRecoveryEmail | studentAuth.ts | <1s | |
| updateStudentClass | studentAuth.ts | <1s | |
| deleteStudentAccount | studentAuth.ts | <5s | Auth 삭제 + Firestore cascade — **Cloud Run 재분류 가능** |
| removeEnrolledStudent | studentAuth.ts | <2s | |
| initProfessorAccount | professorAuth.ts | <1s | allowedProfessors 확인 |

> `bulkEnrollStudents` 는 Wave 2 Cloud Run.
> `deleteStudentAccount` 는 인증 cascade 때문에 실행 시간 길어지면 Cloud Run 으로 이동.

### 4.7 Wave 1-G: OCR·공통·관리 (5개)

| 함수 | 파일 | 예상 실행 | 비고 |
|------|------|----------|------|
| runClovaOcr | ocr.ts | <10s | REST 호출 (base64) |
| submitInquiry | inquiry.ts | <2s | |
| refreshRankings | computeRankings.ts | <5s | 단일 org 수동 트리거 |
| migrateQuizAnswersTo0Indexed | migrateQuizAnswers.ts | 수 초 | `ProfileDrawer.tsx:1197` 관리자 툴로 호출 중 |
| analyzeImageRegionsCall | index.ts (imageRegionAnalysis) | 수 초 | Gemini Vision — **CPU 파싱 무거우면 Cloud Run 재분류** |

### 4.8 Wave 1-H: 스케줄 → pg_cron 전환 (5개)

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

## 5. Cloud Run 이전 — 실사용 9개 🟠

**기준**: AI thinking 파싱(CPU), 장시간 실행(>150s), native module(jimp), 대량 배치.

배포 형태: `cloud-run-ai/` 단일 Express 앱 + 여러 엔드포인트. 현재 `cloud-run-pptx/` 와 동일 구조 재사용.

dead 인 `generateStyledQuiz` / `generateQuizWithGemini` / `extractKeywords` / `runVisionOcr` / `tekkenPoolRefill` / `backfillWeeklyStats` 는 이전 불필요. `workerProcessJob` 내부에서 쓰는 **유틸 함수** (buildFullPrompt, generateWithGemini, loadScopeForQuiz, getCourseIndex 등) 는 Cloud Run 으로 이식하되 onCall export 는 삭제.

| 함수 | 파일 | 이유 | 현재 옵션 |
|------|------|------|----------|
| **workerProcessJob** | workerProcessJob.ts | Firestore 트리거 → HTTP 엔드포인트로 변환. jimp 크롭 + Gemini thinking 10KB | 1GiB, 300s, maxConcurrent 40 |
| **generateCustomExplanations** | explanationGenerator.ts | Gemini 호출 다수 | — |
| **tekkenPoolRefillScheduled** | tekkenQuestionPool.ts | 챕터당 90s, 전 과목 × 전 챕터 직렬 | scheduled |
| **tekkenPoolWorker** | tekkenQuestionPool.ts | 배치 15문제 × 3초 대기 | 1GiB, 540s, max 5 |
| **processGeminiQueue** | geminiQueue.ts | 큐 소비자, 2초 rate-limit sleep | scheduled 5m |
| **generateMonthlyReport / generateMonthlyReportScheduled** | monthlyReport.ts | Claude + exceljs/docx 후처리 | 03:00 매월 1일 |
| **collectWeeklyStatsScheduled** | stats/collector.ts | 540s, 1GiB | 월요일 00:00 |
| **bulkEnrollStudents** | studentAuth.ts | 수백 계정 일괄 생성 | — |
| **februaryTransition / augustTransition** | semesterTransition.ts | 대규모 배치 삭제·승급 | scheduled |

> `deleteStudentAccount` / `removeEnrolledStudent` 는 Wave 1-F 로 넘기고, 실행 시간 초과 시 Cloud Run 재분류.
> `convertPptxToPdf` / `onPptxJobCreated` / `cleanupOldQuizJobs` 는 이미 `cloud-run-pptx/main.py` 사용 중 — 그대로 유지.
> `analyzeImageRegionsCall` 은 Wave 1-G 에서 Edge 시도 후 CPU 초과 시 Cloud Run 재분류.

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

## 5.5 Dead code 재분류 — 29개 🌱 ☠️ 🧹

2026-04-22 프론트 전수 조사 결과, 프론트에서 호출되지 않는 onCall 29개 발견. SaaS 확장(`docs/saas-architecture.md` Phase 5~7) 관점에서 3범주로 재분류.

### 🌱 Rebirth — 9개 (CF 그대로 유지, Phase 5~7 에서 Edge 로 활성화)

지금은 호출 UI 가 없지만 SaaS 전환 후 명백히 필요한 기반 코드. **삭제 금지, Wave 1 이전 대상에서도 제외.** Phase 5~7 에서 해당 UI 가 추가될 때 Edge Function 으로 이전.

| 함수 | SaaS 활성화 시점 | 용도 |
|------|---------------|------|
| `uploadCourseScope` | Phase 5 | 교수가 교재(PDF/텍스트) 업로드 → 챕터별 scope 자동 파싱 |
| `getCourseScope` | Phase 5 | 업로드된 scope 조회 (현재 하드코딩 대체) |
| `getStyleProfile` | Phase 6 | 교수 대시보드 "내 출제 스타일 분석" 화면 |
| `getOcrUsage` | Phase 6 | SaaS 플랜별 OCR 한도 표시 (Free 100/월 등) |
| `getVisionOcrUsage` | Phase 6 | Vision OCR 한도 |
| `runVisionOcr` | Phase 7 | i18n 다국어 (Vision 이 Clova 보다 영어·비한국어 강점) |
| `tekkenPoolRefill` | Phase 5 | 관리자 "새 과목 추가 → 배틀 풀 즉시 생성" |
| `sendNotificationToUser` | Phase 6 | 교수 대시보드에서 학생 개별 푸시 |
| `sendNotificationToClass` | Phase 6 | 교수 → 반 전체 직접 푸시 |

### ☠️ Obsolete — 13개 (Wave 4 에서 Firebase CF 삭제)

새 파이프라인이나 통합 함수로 대체되어 영구 미사용. Wave 4 정리 시 `functions/src/` 에서 제거.

| 함수 | 대체된 방식 |
|------|------------|
| `generateQuizWithGemini` | `enqueueGenerationJob` → `workerProcessJob` 비동기 파이프라인 |
| `generateStyledQuiz` (onCall) | 위와 동일 (내부 유틸은 Cloud Run 으로 이식) |
| `extractKeywords` | `workerProcessJob` 이 inline 에서 키워드 추출 |
| `unequipRabbit` | `equipRabbit` 내부 자동 해제 로직 (rabbitEquip.ts:107) |
| `voteOnPoll` | `submitPollSurvey` 통합형 |
| `submitPollTextResponse` | `submitPollSurvey` 통합형 |
| `getUserStats` | `useProfile` 훅이 userRepo 직접 구독 |
| `getLeaderboard` | 사전계산 `rankings` 테이블 직접 구독 |
| `refreshRadarNorm` | `computeRadarNormScheduled` 10분 주기 충분 |
| `nameButlerRabbit` | rabbitButler.ts 레거시 (구 버틀러 기능) |
| `graduateButlerRabbit` | 위와 동일 |
| `releaseRabbit` | 위와 동일 |
| `checkRateLimitCall` | 서버 인라인 체크로 충분 |
| `backfillChapterTags` | Phase 5 동적 태깅으로 대체 예정 |

### 🧹 OneShot — 5개 (실행 완료, 즉시 삭제 가능)

일회성 마이그레이션/정리. 재실행 필요 없음 확인 후 삭제.

| 함수 | 내용 |
|------|------|
| `migrateRabbitStats` | 옛 베이스스탯 → 새 베이스스탯 전환 (실행 완료) |
| `migrateFeedbackCount` | 피드백 카운트 정합성 복구 |
| `migrateExistingAccounts` | Firebase Auth 기존 사용자 bulk import |
| `fillDogam` | 디버그용 도감 전체 채우기 |
| `cleanupExtraRabbits` | 디버그 토끼 #80~99 정리 |

### 내부 사용 (dead 아님) — 1개

| 함수 | 호출처 |
|------|-------|
| `grantDefaultRabbit` | `registerStudent` CF 내부 import — Wave 1-F 에서 `registerStudent` 와 함께 묶어 이전 |

### 경계 — 1개

| 함수 | 판정 |
|------|------|
| `backfillWeeklyStats` | OneShot 에 가깝지만 데이터 복구용 재실행 가능성 → **Rebirth 로 보관 권장** |

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

### Wave 1 — Edge 이전 실사용 35개 (3주, 7묶음)

dead code 29개는 이 Wave 에서 건드리지 않음. Rebirth 9개는 Phase 5~7 에서 별도, Obsolete 13 + OneShot 5 는 Wave 4 에서 삭제.

| 묶음 | 대상 | 개수 | 순서 이유 |
|------|------|-----|---------|
| **1-A** | 게시판 onCall (acceptComment, deletePost, deleteThread) | 3 | 가장 단순, 의존성 적음 → **먼저** |
| **1-B** | 공지 onCall (markAnnouncementsRead, reactToAnnouncement, submitPollSurvey, getPollResponses, getPollResponsesBatch) | 5 | 교수 권한 체크 패턴 연습 |
| **1-C** | 게이미피케이션 (spinRabbitGacha, claimGachaRabbit, equipRabbit, levelUpRabbit) | 4 | 트랜잭션·idempotency 패턴 |
| **1-D** | AI 컨트롤 (enqueueGenerationJob, checkJobStatus, addToGeminiQueue, checkGeminiQueueStatus, claimGeminiQueueResult) | 5 | Cloud Run 연동 전 필수 컨트롤 플레인 |
| **1-E** | 퀴즈·복습 (recordAttempt ← **로드테스트 선행**, updatePracticeAnsweredAt, recordReviewPractice, initCreatorStats, regradeQuestions) | 5 | recordAttempt 가 가장 위험 — 맨 나중 이전 |
| **1-F** | 인증 (registerStudent + grantDefaultRabbit 묶음, requestPasswordReset ← SMTP 교체, updateRecoveryEmail, updateStudentClass, resetStudentPassword, deleteStudentAccount, removeEnrolledStudent, initProfessorAccount) | 8 | SMTP 이슈 해결 후 진행 |
| **1-G** | OCR·공통 (runClovaOcr, submitInquiry, refreshRankings, migrateQuizAnswersTo0Indexed, analyzeImageRegionsCall ← CPU 검증) | 5 | analyzeImageRegions 는 CPU 측정 후 Cloud Run 재분류 가능 |
| **1-H** | 스케줄 → pg_cron (cleanupRateLimitsScheduled, retryQueuedJobs, cleanupExpiredJobs, cleanupGeminiQueue, cleanupOldQuizJobs) | 5 | pg_cron 문법만 검증되면 일괄 |

**합계**: 40개 (겹침 제외 35개 실함수 + pg_cron 5개 스케줄)

각 함수 **dual-deploy 2일**:
- Day 0: Edge Function 배포, flag `NEXT_PUBLIC_USE_EDGE_{FUNCTION}=false`
- Day 1: 비교 로그 확인 (Firebase CF + Edge 병렬 호출, 결과 diff)
- Day 2: flag on

### Wave 2 — Cloud Run 이전 실사용 9개 (3주)

dead 인 `generateQuizWithGemini` / `generateStyledQuiz` / `extractKeywords` / `runVisionOcr` / `tekkenPoolRefill` / `backfillWeeklyStats` 는 이전 대상 아님.

순서:
1. `cloud-run-ai/` 실제 빌드 → `/ai/generate-styled-quiz` **실제 로직 이식** (workerProcessJob + styledQuizGenerator 유틸)
2. `workerProcessJob` → Firestore 트리거 제거 → HTTP 엔드포인트 (Wave 3 PostgreSQL trigger 설계와 맞물림)
3. `tekkenPoolRefillScheduled / tekkenPoolWorker` (배틀 풀이 Firestore 에서 Supabase 테이블로 이전 선행)
4. `generateMonthlyReport / generateMonthlyReportScheduled`
5. `collectWeeklyStatsScheduled`
6. `processGeminiQueue` (pg_cron 호출)
7. `generateCustomExplanations`
8. `bulkEnrollStudents`
9. `februaryTransition / augustTransition` (학기 전환 전까지 Firebase 유지해도 무방)

### Wave 3 — Firestore 트리거 재작성 (2주)

전제: **Supabase 단일소스 전환 완료**(dual-write 중단). 그 전에 트리거 재작성하면 이중 동작.

- PostgreSQL `AFTER INSERT/UPDATE/DELETE` trigger + `pg_notify('cf_event', payload)`
- Edge Function 구독 대신 **Cloud Run 또는 Edge Function HTTP webhook** 패턴 (Supabase Database Webhooks 기능 활용)
- 9개 트리거 → **별도 매핑 문서** (`docs/phase3-trigger-mapping.md`, Task #4)

### Wave 4 — 정리 (1주)

**Obsolete 13개 + OneShot 5개 = 18개 Firebase CF 삭제.**

삭제 순서:
1. OneShot 5개 (migrateRabbitStats, migrateFeedbackCount, migrateExistingAccounts, fillDogam, cleanupExtraRabbits) — 실행 완료 재확인 후 즉시 삭제
2. Obsolete onCall 9개 (voteOnPoll, submitPollTextResponse, unequipRabbit, getUserStats, getLeaderboard, refreshRadarNorm, nameButlerRabbit, graduateButlerRabbit, releaseRabbit, checkRateLimitCall, backfillChapterTags)
3. Obsolete AI onCall 3개 (generateQuizWithGemini, generateStyledQuiz onCall, extractKeywords) — **파일 내부 유틸은 Cloud Run 이식 후 유지**
4. `rabbitButler.ts` 파일 전체 삭제 (전부 obsolete)
5. `notification.ts` 는 유지 (FCM Admin, Firebase 잔류 확정)
6. `functions/` 디렉토리 최종 구성: 배틀 11 + FCM 4 트리거 + Firestore 트리거 9 + Rebirth 9 = **33개** 로 축소
7. CLAUDE.md 업데이트 (대형 파일 섹션 + 스케줄 함수 주기 섹션 최신화)

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
| 서버 코드 Firebase 의존도 | 47 export (+dead 29) | 33 export (배틀 11 + FCM 4 + Firestore 트리거 9 + Rebirth 9) |

---

## 11. 참고

- Supabase Edge Functions 제약: https://supabase.com/docs/guides/functions/limits
- CPU time 트러블슈팅: https://supabase.com/docs/guides/troubleshooting/edge-function-cpu-limits
- npm 호환성: https://supabase.com/blog/edge-functions-node-npm
- 전체 SaaS 아키텍처: `docs/saas-architecture.md`
- Phase 2 현황: MEMORY의 `project_supabase_phase2_progress.md`
