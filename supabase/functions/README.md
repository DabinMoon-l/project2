# Supabase Edge Functions — RabbiTory

Supabase Phase 3 의 **Edge Functions** 디렉토리. 기존 Firebase Cloud Functions 중 가벼운 onCall(< 150s idle, < 2s CPU) 을 이쪽으로 이전한다.

- 전체 분류: `docs/phase3-cf-classification.md`
- 무거운 AI 워크로드는 `cloud-run-ai/` 로 이전

## 구조

```
supabase/
├── config.toml              # CLI 설정 (functions 섹션만)
└── functions/
    ├── deno.json            # import map + lint/fmt
    ├── _shared/             # 공통 유틸 (auth, cors)
    │   ├── auth.ts          # Firebase Auth JWT 검증 (Phase 6 에서 Better Auth 로 교체)
    │   └── cors.ts
    └── get-gemini-usage/    # Wave 0 검증용 — 가장 가벼운 조회
        └── index.ts
```

## 로컬 실행

```bash
# Supabase CLI 설치 (한 번만)
npm install -g supabase

# 로컬 Edge runtime 실행
supabase functions serve get-gemini-usage --env-file .env.local --no-verify-jwt

# 호출 (Firebase ID 토큰 필요)
curl -i http://localhost:54321/functions/v1/get-gemini-usage \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN"
```

## 배포 (Wave 0 검증용)

```bash
# Supabase project-ref 는 dashboard 에서 확인
supabase functions deploy get-gemini-usage --project-ref <project-ref>

# 환경변수 (secrets)
supabase secrets set FIREBASE_PROJECT_ID=rabbitory-prod
supabase secrets set DEFAULT_ORG_ID=13430b1a-0213-403c-9dd4-687bea914ec4
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 자동 주입
```

## 인증 방식

**Wave 1~5**: Firebase Auth ID 토큰을 `Authorization: Bearer <token>` 으로 전달.
`_shared/auth.ts` 의 `verifyFirebaseIdToken()` 가 Google public keys(JWKS) 로 서명 검증.

**Phase 6 이후**: Better Auth JWT 로 교체. `verify_jwt = true` 옵션으로 Supabase 가 자동 검증.

## 이전 예정 함수 (Wave 1)

| 경로 | 이전 대상 CF | 예상 일정 |
|------|-------------|----------|
| `get-gemini-usage` | gemini.getGeminiUsage | **Wave 0** (스켈레톤) |
| `get-user-stats` | index.ts getUserStats | Wave 1-1 |
| `get-leaderboard` | index.ts getLeaderboard | Wave 1-1 |
| `get-style-profile` | styledQuizGenerator.getStyleProfile | Wave 1-1 |
| `get-course-scope` | courseScope.getCourseScope | Wave 1-1 |
| `equip-rabbit` / `unequip-rabbit` | rabbitEquip.ts | Wave 1-2 |
| `spin-rabbit-gacha` / `claim-gacha-rabbit` | rabbitGacha.ts | Wave 1-2 |
| `level-up-rabbit` | rabbitLevelUp.ts | Wave 1-2 |
| `record-attempt` | recordAttempt.ts | Wave 1-4 (로드테스트 후) |
| `record-review-practice` | reviewPractice.ts | Wave 1-4 |
| `accept-comment` / `delete-post` / `delete-thread` | board.ts onCall | Wave 1-3 |
| `vote-on-poll` / `react-to-announcement` 등 | announcementActions.ts (7개) | Wave 1-3 |
| `enqueue-generation-job` / `check-job-status` | enqueueGenerationJob.ts | Wave 1-7 |
| `extract-keywords` | gemini.extractKeywords | Wave 1-6 |
| `run-clova-ocr` | ocr.runClovaOcr | Wave 1-6 |
| ... | 총 24개 | |

## 규약

1. **디렉토리 == 함수 이름 == URL 경로**. kebab-case.
2. 모든 함수는 `handleCorsPreflight` 로 시작. CORS 는 기본 허용.
3. 인증은 `verifyFirebaseIdToken` 공용 유틸. Phase 6 에서 한 곳만 교체.
4. Supabase 접근은 `service_role` + 애플리케이션 레벨에서 `org_id` 검증. RLS 도 백업으로 켜둠.
5. 로그는 `console.log(JSON.stringify({ level, msg, ...ctx }))` 형태로 구조화.
6. 응답은 항상 `{ ok: boolean, ... }` 형태. 에러도 200 + `ok: false` 가 아닌 4xx/5xx + `ok: false`.
