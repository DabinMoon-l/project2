# Phase 3 Wave 3 — Firestore 트리거 → PostgreSQL 재작성 매핑

> Phase 3 Wave 3 의 설계 문서. 현재 Firebase Firestore 의 onDocument* 트리거를 Supabase PostgreSQL 트리거 + Database Webhook + Edge Function 으로 재작성한다.
> 작성일: 2026-04-22
> 전제: Supabase 단일소스 전환 완료 (현재 Phase 2 에서 듀얼 라이트 중, 단일소스는 Wave 3 직전에 전환).

---

## 1. 대상 트리거 총 정리

현재 Firestore 트리거 **총 20개** 중 **Wave 3 재작성 대상 16개**, 나머지는 Firebase 유지 또는 Cloud Run HTTP 엔드포인트로 변환.

| 카테고리 | 함수 수 | Wave 3 처리 | 이유 |
|----------|--------|------------|------|
| 퀴즈 도메인 | 5 | **재작성** (Webhook) | 핵심 EXP/집계 로직 |
| 게시판 도메인 | 6 | **재작성** (Webhook) | 콩콩이 AI + 집계 |
| 피드백 도메인 | 2 | **재작성** (Webhook) | EXP 지급 |
| 복습 생성 | 1 | **재작성** (Webhook) | quiz_results 파생 |
| 온보딩 토끼 | 1 | **재작성** (Webhook) | users UPDATE 감지 |
| 교수 분석 | 1 | **재작성** (Webhook) | AI 호출 트리거 |
| FCM 알림 | 4 | **Firebase 유지** | Admin SDK 필요 |
| 백그라운드 잡 | 3 | **HTTP 전환** | Cloud Run 엔드포인트 직접 호출 |

---

## 2. 구현 패턴 선택

### 2.1 Supabase Database Webhook (권장, 15개)

> **이유**: Supabase 공식 기능(pg_net extension). 설정이 단순, 재시도 자동, 로깅 대시보드 제공.
> **한계**: HTTP 타임아웃 5초. 무거운 작업은 webhook 이 jobs 테이블에 enqueue → pg_cron consumer 패턴 병행.

```
Supabase Table INSERT/UPDATE/DELETE
  └─ Database Webhook
      └─ HTTP POST to Edge Function (default, stateless)
          └─ (무거운 작업) Cloud Run HTTPS 호출
```

### 2.2 pg_trigger + pg_notify + Realtime (2개 — 클라이언트 브로드캐스트 전용)

> 현재 `board.onPostCreate` 내부의 "해당 반 학생 전원에게 콩콩이 답글" 같은 fan-out 은 Webhook 이 더 적합.
> pg_notify 는 "집계 카운터 변경을 클라이언트에게 즉시 알림"처럼 단순 push 만 할 때 사용 (Realtime 이 대신 처리).

### 2.3 HTTP 엔드포인트 직접 호출 (3개 — workerProcessJob / onPptxJobCreated / tekkenPoolWorker)

> `jobs` 테이블 INSERT 자체를 트리거로 쓰지 말고, **enqueue Edge Function 이 직접 Cloud Run POST** 하도록 변경.
> 이유: Firestore 트리거처럼 "문서 생성 시 자동 실행" 의존을 끊고 흐름을 명시적으로 만든다.

---

## 3. 도메인별 매핑

### 3.1 퀴즈 (5개 — Wave 3-A)

#### ① `onQuizComplete` (quiz.ts:49)

**현재**:
```
트리거: onDocumentCreated("quizResults/{resultId}")
로직:
  - EXP 계산 (calculateQuizExp)
  - users.totalExp + users.quizCount 업데이트 (트랜잭션)
  - Supabase dual-write (addExpInTransaction + flushExpSupabase)
  - quizCreatorId 있으면 생성자에게도 +5 EXP
```

**Wave 3 재작성**:
```sql
CREATE OR REPLACE FUNCTION on_quiz_result_inserted()
RETURNS TRIGGER AS $$
BEGIN
  -- Webhook 으로 핸드오프 (실제 EXP 계산은 Edge Function 에서)
  PERFORM net.http_post(
    url := current_setting('app.edge_webhook_url') || '/on-quiz-complete',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Supabase-Signature', current_setting('app.webhook_secret')
    ),
    body := jsonb_build_object(
      'event', 'quiz_result_inserted',
      'result_id', NEW.id,
      'user_id', NEW.user_id,
      'quiz_id', NEW.quiz_id,
      'score', NEW.score,
      'org_id', NEW.org_id
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_on_quiz_result_inserted
  AFTER INSERT ON quiz_results
  FOR EACH ROW EXECUTE FUNCTION on_quiz_result_inserted();
```

**Edge Function**: `supabase/functions/on-quiz-complete/index.ts`
- EXP 계산 로직 이식 (`functions/src/quiz.ts` 의 로직 + `utils/gold.ts`)
- user_profiles.total_exp 트랜잭션 업데이트 (RPC 함수로 래핑)
- creator 보상은 같은 Edge 내에서 처리

#### ② `updateQuizStatistics` (quiz.ts)

**현재**: quiz_results 생성 시 quizzes.participantCount / averageScore 업데이트

**Wave 3**: 같은 webhook 에 통합 (`/on-quiz-complete` 에서 두 작업 동시 처리). 분산 카운터 (`quiz_agg/{quizId}/shards`) 는 PostgreSQL 에서 불필요 — `UPDATE quizzes SET participant_count = participant_count + 1` 원자 연산으로 충분.

#### ③ `onQuizCreate` (quiz.ts)

**현재**: quizzes INSERT 시 생성자에게 EXP +25 (AI 저장) 또는 +50 (custom)

**Wave 3**:
```sql
CREATE TRIGGER trg_on_quiz_created
  AFTER INSERT ON quizzes
  FOR EACH ROW EXECUTE FUNCTION on_quiz_created_webhook();
```
→ Edge Function `/on-quiz-create` 에서 category 기준 EXP 분기

#### ④ `onQuizMakePublic` (quiz.ts)

**현재**: quizzes UPDATE 시 `isPublished` false→true 전환이면 +15 EXP

**Wave 3**:
```sql
CREATE TRIGGER trg_on_quiz_make_public
  AFTER UPDATE OF is_public ON quizzes
  FOR EACH ROW
  WHEN (OLD.is_public = false AND NEW.is_public = true)
  EXECUTE FUNCTION on_quiz_make_public_webhook();
```
→ WHEN 절로 불필요 호출 차단. Edge `/on-quiz-make-public`.

#### ⑤ `onQuizSync` (quiz.ts)

**현재**: quizzes UPDATE 시 questions 변경 감지 → 기존 푼 학생의 quizResults에 `quizVersion` 증가

**Wave 3**: 같은 패턴, but `questions` JSONB 변경 감지는 WHEN 절에서:
```sql
WHEN (OLD.questions IS DISTINCT FROM NEW.questions)
```

---

### 3.2 게시판 (6개 — Wave 3-B)

| 함수 | 현재 트리거 | Wave 3 대응 | 비고 |
|------|-----------|-----------|------|
| `onPostCreate` | INSERT posts | Webhook `/on-post-create` | 콩콩이 AI 호출 (Gemini). 무거우면 job enqueue |
| `onPostUpdate` | UPDATE posts | Webhook `/on-post-update` | WHEN (OLD.content IS DISTINCT FROM NEW.content) |
| `onCommentCreate` | INSERT comments | Webhook `/on-comment-create` | EXP +15, 콩콩이 대댓글, post.comment_count 증가 |
| `onCommentDeleted` | DELETE comments | Webhook `/on-comment-deleted` | comment_count 감소, like 카운터 정리 |
| `onLikeReceived` | INSERT likes (현재는 subcoll) | **구조 변경**: posts.likes_by_user 배열로 통합 → UPDATE posts 트리거 | like 도메인 테이블 분리 여부 결정 필요 |
| `onLikeRemoved` | UPDATE likes | 위와 동일 | |

**like 도메인 결정**: 현재 Firestore 에서는 `posts/{postId}/likes/{userId}` 서브컬렉션. PostgreSQL 에서는:
- **옵션 A**: `post_likes(post_id, user_id)` 별도 테이블 + INSERT/DELETE 트리거로 posts.like_count 갱신
- **옵션 B**: `posts.liked_by UUID[]` 배열 컬럼 + 단일 UPDATE 트리거
→ **옵션 A 권장** (트랜잭션 단순, 인덱스 효율). 스키마 설계는 `docs/saas-architecture.md` 에서 `posts` 테이블에 like_count 만 있으므로 추가 필요.

```sql
CREATE TABLE post_likes (
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  org_id  UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TRIGGER trg_on_like_inserted
  AFTER INSERT ON post_likes
  FOR EACH ROW EXECUTE FUNCTION on_like_received_webhook();

CREATE TRIGGER trg_on_like_deleted
  AFTER DELETE ON post_likes
  FOR EACH ROW EXECUTE FUNCTION on_like_removed_webhook();
```

---

### 3.3 피드백 (2개 — Wave 3-C)

| 함수 | 트리거 | Wave 3 |
|------|-------|-------|
| `onFeedbackSubmit` | INSERT feedbacks | Webhook `/on-feedback-submit` — EXP +15, 교수에게 FCM 알림 (FCM 부분만 Firebase 유지 → Edge 에서 FCM Admin REST API 호출) |
| `onFeedbackStatusChange` | INSERT/UPDATE feedbackStatus | Webhook `/on-feedback-status-change` — 상태 변경 알림 |

**FCM 호출 방식**: Edge Function 에서 `firebase-admin` npm import 는 Deno 호환성 불안정.
→ 대안: **FCM HTTP v1 REST API** 를 직접 호출 (Google OAuth2 토큰 + JSON POST). Deno `jose` + `google-auth-library` 조합으로 가능.
→ 복잡도 높으면 Cloud Run 쪽에 `/notify/fcm-send` 엔드포인트 두고 Edge → Cloud Run 위임.

---

### 3.4 복습 생성 (1개 — Wave 3-D)

#### `generateReviewsOnResult` (reviewsGenerator.ts)

**현재**: INSERT quiz_results 시 오답 문제를 `reviews` 컬렉션에 비동기 생성 (wrong/solved source 태깅)

**Wave 3**: `on_quiz_result_inserted` 트리거를 공유. webhook body 는 동일, Edge Function 내에서 `/on-quiz-complete` 와 `/generate-reviews` 두 엔드포인트로 분기.

**또는** 하나의 Edge Function 에서 둘 다 처리:
```ts
// supabase/functions/on-quiz-complete/index.ts
async function handle(payload) {
  await Promise.all([
    grantExp(payload),
    generateReviewsFromWrong(payload),
  ]);
}
```
→ 장점: DB 왕복 1회. 단점: 한쪽 실패가 다른쪽에도 영향 → 재시도 세분화 어려움.

**권장**: 분리. webhook 2개 설정 (같은 이벤트 발동).

---

### 3.5 온보딩 토끼 (1개)

#### `onOnboardingComplete` (onboardingRabbit.ts)

**현재**: users UPDATE 시 `onboarding.completed` false→true 전환 감지 → 기본 토끼 1마리 지급

**Wave 3**:
```sql
CREATE TRIGGER trg_on_onboarding_complete
  AFTER UPDATE ON user_profiles
  FOR EACH ROW
  WHEN (
    (OLD.onboarding_completed IS DISTINCT FROM NEW.onboarding_completed)
    AND NEW.onboarding_completed = true
  )
  EXECUTE FUNCTION on_onboarding_complete_webhook();
```

Edge Function `/on-onboarding-complete`:
- `rabbit_holdings` INSERT (기본 토끼 1마리)
- `user_profiles.equipped_rabbits` 배열에 추가
- 환영 콩콩이 환영 알림 (FCM — Cloud Run 위임)

---

### 3.6 교수 분석 (1개)

#### `onProfessorQuizCreated` (professorQuizAnalysis.ts)

**현재**: quizzes UPDATE 시 `isPublished==true` 이고 `category in (midterm, final, past, independent)` 인 경우 → Gemini 호출 → `professorQuizAnalysis/{courseId}` 업데이트 (스타일 학습)

**Wave 3**: 무거운 AI 호출이므로 **Cloud Run 위임**.
```sql
CREATE TRIGGER trg_on_professor_quiz_published
  AFTER UPDATE ON quizzes
  FOR EACH ROW
  WHEN (
    NEW.is_public = true
    AND OLD.is_public = false
    AND NEW.category IN ('midterm', 'final', 'past', 'independent')
  )
  EXECUTE FUNCTION on_professor_quiz_published_webhook();
```

webhook → Edge Function `/on-professor-quiz-published` → 즉시 Cloud Run `/ai/analyze-professor-style` 호출 (fire-and-forget, 결과는 `professor_quiz_analysis` 테이블 업데이트).

---

## 4. Firebase 유지 (FCM 4개)

**Wave 3 재작성 하지 않음.** Firebase Admin SDK 의 FCM 메시징 API 가 가장 안정적이고, 프론트 이미 구독 구조가 Firebase 기반.

| 함수 | 이유 |
|------|------|
| `onNewQuizCreated` (INSERT quizzes) | FCM 토픽 전송 |
| `onBoardCommentCreated` (INSERT comments) | 글 작성자 개별 알림 |
| `onBoardReplyCreated` (INSERT comments + parentId) | 댓글 작성자 알림 |
| `onAnnouncementCreated` (INSERT announcements) | 반 전체 알림 |

**전환 조건**: Phase 6 (Better Auth + SaaS 다중테넌시) 에서 FCM 토큰을 Supabase 로 옮기면 Cloud Run 또는 Edge + FCM REST API 로 이전.

**현재 동작**: Firestore dual-write 로 Firestore 에 계속 쓰기 때문에 기존 트리거 그대로 동작. Wave 3 완료 후에도 dual-write 중단 전까지는 유지.

---

## 5. HTTP 엔드포인트 전환 (3개)

Firestore 트리거를 Supabase 트리거로 재작성하는 대신, **enqueue 단계에서 직접 HTTP 호출** 하는 방식으로 변경.

### ① `workerProcessJob` (workerProcessJob.ts)

**현재**: `jobs/{jobId}` INSERT 시 자동 실행 → Gemini 호출 → 결과 저장

**Wave 3 이후**:
```
Client
  ↓ POST /enqueue-generation-job (Edge Function)
  ↓ INSERT generation_jobs (Supabase)
  ↓ POST /ai/generate-styled-quiz (Cloud Run) ← Edge 에서 fire-and-forget
Cloud Run
  ↓ UPDATE generation_jobs.status='COMPLETED' + result
Client
  ↓ Realtime 구독으로 결과 수신
```

→ 트리거 없음. enqueue Edge Function 이 Cloud Run 직접 호출.

### ② `onPptxJobCreated` (pptx.ts)

동일 패턴. `pptx_jobs` INSERT 시 Cloud Run `cloud-run-pptx` 직접 호출. 현재도 Cloud Run 쓰므로 enqueue Edge 가 POST 만 하면 됨.

### ③ `tekkenPoolWorker` (tekkenQuestionPool.ts)

**현재**: `tekkenPoolJobs/{jobId}` INSERT 시 실행 (배틀 문제 풀 배치 생성)

**Wave 3 이후**: `tekkenPoolRefillScheduled` pg_cron 이 직접 Cloud Run `/battle/pool-refill` 호출. 중간 테이블 불필요.

---

## 6. 구현 체크리스트 (Wave 3 진입 시)

### 6.1 준비 (Wave 3 직전)
- [ ] Phase 2 듀얼라이트 → Supabase 단일소스 전환 (Firestore 쓰기 중단)
- [ ] `pg_net` extension 활성화 (Supabase Dashboard > Database > Extensions)
- [ ] Webhook secret 을 Supabase Vault 에 저장 (`app.webhook_secret` GUC)
- [ ] Edge Function 호출 URL 을 `app.edge_webhook_url` GUC 에 저장
- [ ] HMAC 검증 공용 미들웨어 추가 (`_shared/verifyWebhook.ts`)

### 6.2 구현 순서 (복잡도 낮은 것부터)
1. `onOnboardingComplete` — 단순 INSERT 1개
2. `onFeedbackSubmit` / `onFeedbackStatusChange` — EXP 지급 패턴
3. `onQuizCreate` / `onQuizMakePublic` — 단순 EXP
4. `onQuizComplete` + `updateQuizStatistics` + `generateReviewsOnResult` — 연관 3개 묶음 (핵심)
5. `onPostCreate` / `onPostUpdate` — 콩콩이 AI 호출 포함
6. `onCommentCreate` / `onCommentDeleted` — 집계 + EXP
7. `post_likes` 테이블 신설 + `onLikeReceived` / `onLikeRemoved`
8. `onProfessorQuizCreated` — Cloud Run 연동 포함
9. `onQuizSync` — questions 비교 트리거

### 6.3 검증
- [ ] 각 webhook 을 dual-trigger 상태로 2주 운영 (Firestore 트리거 + Supabase webhook 동시)
- [ ] 결과 diff 비교 로그 (EXP 지급 금액, 카운터 값)
- [ ] 실패 재시도 메커니즘 확인 (pg_net 자동 재시도 3회)
- [ ] 로드테스트: 퀴즈 완료 초당 10건 이상일 때 지연 < 1초

### 6.4 전환
- [ ] Firestore 트리거 옵션 `disabled: true` 로 내리기 (즉시 롤백 가능)
- [ ] 1주 관찰 후 Firestore 트리거 CF 코드 제거

---

## 7. 리스크 & 주의사항

| 리스크 | 영향 | 대응 |
|--------|------|------|
| pg_net webhook 이 DB 커밋 전 호출되어 race | Webhook 에서 "아직 row 없음" 에러 | `pg_net` 은 커밋 후 실행 보장 (async). 문서 확인 필수 |
| Webhook 실패 시 이벤트 소실 | EXP 지급 누락 | pg_net 자동 재시도 3회 + 실패 로그 테이블 + 주간 reconcile 잡 |
| Supabase Webhook 페이로드 10KB 제한 | 긴 콘텐츠 posts 에서 초과 가능 | id 만 전달하고 Edge Function 에서 재조회 |
| 트랜잭션 내 동기 작업 기대 | EXP 먼저 지급 후 quiz_result 생성 같은 순서 보장 | AFTER INSERT 는 커밋 후 → 이전 Firestore 트리거와 동일한 보장 |
| FCM 호출 비동기화로 지연 | 알림 1~2초 지연 | 허용 가능. 치명적이면 Cloud Run 위임 |
| HMAC 키 회전 | 배포 중 서명 실패 | Secret Manager 이중 키 (old/new) 로 무중단 교체 |

---

## 8. 요약

- **Webhook 이전**: 15개 (퀴즈 5 + 게시판 6 + 피드백 2 + 복습 1 + 온보딩 1)
- **Cloud Run 직접 호출**: 3개 (workerProcessJob + onPptxJobCreated + tekkenPoolWorker)
- **Firebase 유지**: 4개 (FCM 알림 전체)
- **교수 분석 1개**: Webhook + Cloud Run 연계
- **신규 테이블**: `post_likes` (현재 Firestore subcollection 대체)
- **순서**: 단순 EXP → 복합 (quiz_complete 묶음) → AI 호출 (onPostCreate, onProfessorQuizCreated)

→ Wave 3 착수 시점: Phase 2 듀얼라이트 → 단일소스 전환 완료 직후 (**Week 8~9 예상, 2026년 6월 초**).
