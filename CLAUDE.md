# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**RabbiTory** — 대학 수업 보조 PWA. AI 기반 퀴즈 생성 + 게시판 + 토끼 컨셉 게이미피케이션.
학생은 AI로 문제를 생성하고 퀴즈를 풀며, 교수는 출제 스타일 분석과 학생 참여도를 모니터링.

## 기술 스택

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript 5** + **Tailwind CSS 3**
- **Framer Motion** (애니메이션), **react-window** (가상 스크롤), **next-pwa** (서비스 워커)
- **Firebase** — Auth, Firestore, RTDB(배틀 전용), Cloud Functions(Node 20), Storage, FCM
- **AI**: Gemini 2.5 Flash (문제 생성/이미지 분석/콩콩이), Claude Sonnet-4 (월별 리포트만)
- **배포**: Vercel (프론트) + Firebase (CF/Firestore/RTDB) + Cloud Run (PPTX→PDF, 배틀 문제 풀)
- **문서**: pdfjs-dist, exceljs, docx, file-saver, jszip

### 데이터 추상화 레이어

- `lib/api/` — CF 타입 안전 래퍼 (`callFunction<K>()`, `CloudFunctionMap`)
- `lib/repositories/` — Firestore/RTDB/Storage 추상화 (11개 도메인 repo)
- `lib/subscriptions/` — 구독 참조 카운팅 (`SubscriptionManager`, `useSubscription`)
- `firebase/firestore` 직접 import는 `firestoreBase.ts`, `firebase.ts` 2개 파일에만 존재
- **SaaS 마이그레이션 설계**: `docs/saas-architecture.md` 참조

## 개발 명령어

```bash
npm run dev          # 개발 서버 (Turbopack)
npm run build        # 프로덕션 빌드 — 커밋 전 필수 검증
npm run lint         # ESLint (next/core-web-vitals)
npm run analyze      # 번들 분석 (ANALYZE=true)
```

### Cloud Functions

```bash
cd functions
npm run build        # TypeScript 컴파일
npm run lint         # @typescript-eslint 린트
npm run serve        # 에뮬레이터로 로컬 테스트
npm run deploy       # Firebase 배포
```

- **Node 20 필수** (`engines.node: "20"`)
- **리전**: 모든 CF `asia-northeast3` (서울)
- tsconfig가 프론트보다 엄격: `noUnusedLocals`, `noImplicitReturns`, `strict`

### 테스트

```bash
npm run test:e2e              # E2E (Playwright)
npm run test:e2e:ui           # UI 모드
cd functions && npm test      # CF 유닛 (Vitest, 4개 파일 164 tests)
k6 run tests/load/mixed-scenario.k6.js  # 부하 (학생 300 + 교수 5)
```

부하 테스트 실행:
```bash
firebase emulators:start
node tests/load/seed-production.js && node tests/load/generate-tokens.js
k6 run tests/load/mixed-scenario.k6.js   # 프로덕션: PROD=1 추가
```

### 배포

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
firebase deploy --only database       # RTDB rules
firebase deploy --only storage        # Storage rules
```

### 공유 상수 (`shared/`)

프론트엔드와 Cloud Functions 간 **단일 소스**:
- `shared/expRewards.json` — EXP 보상 값
- `shared/courseChapters.json` — 과목별 챕터 인덱스

**동기화**: `functions/package.json` prebuild → `shared/*.json` → `functions/src/shared/` 자동 복사
**⚠️ 상수 수정 시 반드시 `shared/*.json`을 편집** (개별 파일 수정 금지)

## 학습 플로우

### 학생

로그인(학번) → 홈(토끼+EXP+랭킹) → 퀴즈 학습 3경로:
- [A] 교수 퀴즈: `/quiz/[id]` → result → feedback → exp
- [B] AI 문제 생성: 플로팅 버튼 → 업로드 → 태그+난이도 → 생성 → 서재 연습
- [C] 커스텀 퀴즈: `/quiz/create` → 6종 문제타입 편집기

복습: `/review` → 5필터(서재/풀었던것/오답/찜/폴더) → 연습모드 3단계
게이미피케이션: EXP → 50XP마다 마일스톤 → 토끼 뽑기/레벨업, 철권퀴즈 1v1 배틀, 랭킹
커뮤니티: `/board` → 학술 질문(콩콩이 AI 자동답변) + 잡담 + 댓글 채택

### 교수

로그인(이메일) → 과목 선택 → 퀴즈 관리(직접 출제/AI 생성/미리보기)
학생 분석: 5축 레이더 + 4군집 분류 + 위험 학생 감지 + 월별 리포트(Claude)
학생 관리: 일괄 등록, 비밀번호 초기화, 계정 삭제

## AI 문제 생성 파이프라인

핵심 기능. 학생/교수 모두 사용하는 4단계 비동기 파이프라인.

**입력**: 이미지(최대 10장) / PDF(페이지 선택) / PPTX(Cloud Run 변환) / 텍스트만
**옵션**: 난이도(easy/medium/hard), 문제 수(5~20), 챕터 태그(필수), 추가 프롬프트(선택)

```
1. enqueueGenerationJob — Rate limit 분당3/일15, sha256 dedup 10분, Storage 임시 저장
2. workerProcessJob (onDocumentCreated) — 동시성 40, 5개 병렬 로드(styleProfile/keywords/questionBank/scope/repetitionMap)
3. styledQuizGenerator — 10개 컨텍스트 레이어, 토큰 관리(easy3K/med5K/hard7K), Truncated JSON 복구
4. 후처리 — 문제 수 부족 시 자동 보충(최대 2회), 챕터 ID 검증, Material Cache 저장
```

**HARD 특수 처리**: Gemini Vision → jimp 이미지 크롭 → 크롭본만 전송, 복수정답 `[0, 2]`, 교차 챕터 함정
**교수 스타일**: `professorQuizAnalysis/{courseId}` — 발문패턴/오답전략/주제비중 학습
**백그라운드**: `LibraryJobManager`로 페이지 이동해도 생성 계속

## 퀴즈 시스템

### 카테고리

midterm/final(교수 시험), past(기출), independent(교수 독립), custom(학생 자작), ai-generated(AI 서재)

### 문제 유형 (`QuestionType`)

| 유형 | 답안 형식 | 비고 |
|------|----------|------|
| OX | 'O' \| 'X' | |
| 객관식 | number (0-indexed), 복수정답: number[] | 2~8개 선지 |
| 단답형 | string, 복수정답: `\|\|\|` 구분 | case-insensitive |
| 서술형 | 수동 채점 (교수 전용) | AI 채점 기능 제거됨 |
| 결합형 | 공통 지문/이미지 + 하위 N문제 | N문제 = N점 |

**answer 인덱싱**: **모두 0-indexed** (통일됨)

### recordAttempt 보안 5중 방어

1. 클라이언트 `useRef` guard (React StrictMode 중복 호출 방지)
2. 서버 `quiz_submit_locks` 트랜잭션 (60초 TTL)
3. `rateLimitV2` (분당 3회)
4. `quiz_completions` 체크 (완료된 퀴즈 재진입 방지)
5. `attemptKey` idempotency (동일 제출 → 캐시 반환)

**분산 쓰기**: quizResults(append-only) + quiz_completions(merge) + quiz_agg shards(10개) + users.quizStats(트랜잭션)

## 게시판 / 공지

- 태그: 학사, 학술, 기타. 이미지 첨부, 좋아요, 루트 댓글 + 대댓글(parentId)
- **콩콩이 AI**: 학술 태그 → `onPostCreate` → Gemini 자동 댓글 (`authorId: 'gemini-ai'`), 친절한 반말체, 이모지 금지
- **댓글 채택**: 글 작성자가 루트 댓글 1개 채택 → 30 EXP (본인/AI 불가, 글당 1회)
- **공지**: 교수 전용, 텍스트/이미지/투표, 리액션, 읽음 처리

## 게이미피케이션

### EXP 보상 (단일 소스: `shared/expRewards.json`)

퀴즈: 만점 50, 90%+ 40, 70%+ 35, 50%+ 30, 미만 25 | 커스텀 생성 50, AI 저장 25, 공개 전환 15
피드백 15, 게시글 15, 댓글 15, 채택 30, 복습 25 | 배틀 승리 30(+연승×5, 최대 50), 패배 10
**마일스톤**: 50XP마다 → 뽑기 or 레벨업 선택

### 토끼 시스템

- **뽑기 2단계**: `spinRabbitGacha`(마일스톤 소비→랜덤 0~79) → `claimGachaRabbit`(이름 짓기→영구 소유)
- 이미 보유 시 마일스톤 미소비 → 바로 레벨업
- 스탯: 80마리 고유 기본값 (`rabbitStats.ts`), HP/ATK/DEF. 장착 최대 2마리
- **이미지**: rabbitId 0~79 → 파일명 001~080 (1-indexed)

### 철권퀴즈 (배틀)

실시간 1v1 토끼 배틀, **Firebase RTDB** 사용.
매칭(10초, 봇 폴백) → countdown → question(30초) → 양쪽정답시 mash(연타) → roundResult → finished

- **매칭**: Per-User Write(contention 0), 매칭 락(10초 TTL), FIFO 페어링
- **데미지**: `baseDamage = max(ceil(ATK²/(ATK+DEF)×1.5), 2)`, 크리티컬(5초 이내) ×1.5, 양쪽 오답 10
- **봇**: 40% 정답률, 1~8초 응답, 레벨 = 유저 토끼 + 3
- **문제 풀**: Cloud Run 매일 03:00 KST 과목당 300문제 (easy 150 + medium 150)

### 랭킹

**개인**: `profCorrectCount × 4 + totalExp × 0.6` (10분 사전 계산)
**팀**: `normalizedAvgExp × 0.4 + avgCorrectRate × 0.4 + avgCompletionRate × 0.2`
동점 시 같은 순위 (1위, 1위, 3위)

## 교수 통계 대시보드

### 5축 레이더 (10분 사전 계산, `computeRadarNormScheduled`)

| 축 | 계산 | 스케일 |
|----|------|--------|
| 퀴즈 | 교수 퀴즈 평균 (첫 시도, PROF_TYPES) | 원점수 0~100 |
| 활동량 | totalExp | 백분위 |
| 배틀 | tekkenTotal (봇 포함) | 백분위 |
| 소통 | 게시글×3 + 댓글×2 + 피드백 | 백분위 |
| 출제력 | 학생 퀴즈 수 (AI + 커스텀) | 백분위 |

### 학생 분석

- **위험 학생**: Z-score < -1.5 → 주의, < -2 → 위험 (교수 퀴즈 평균 기반)
- **4군집**: `quizStats.averageScore` + `totalExp`, 동적 medianRate/medianExp
  - passionate(EXP↑성적↑), hardworking(EXP↑성적↓), efficient(EXP↓성적↑), atRisk(EXP↓성적↓)
  - `highExp`: totalExp >= medianExp **&& > 0**, `highRate`: correctRate >= medianRate **&& > 0**
  - **EXP=0 또는 성적=0 → 자동 이탈 위험군**
- **변별도**: 상위 27% - 하위 27% 정답률 (참여 ≥4명)
- **월별 리포트**: Claude Sonnet-4 인사이트 → Excel/Word 내보내기

## 과목 시스템

| 과목 ID | 이름 | 챕터 접두사 | 챕터 수 |
|---------|------|-----------|---------|
| `biology` | 생물학 | `bio_` | 12 |
| `pathophysiology` | 병태생리학 | `patho_` | 11 |
| `microbiology` | 미생물학 | `micro_` | 11 |

- **동적 과목**: `courses/{courseId}` → `CourseContext.courseRegistry` 실시간 구독
- **CourseId 타입**: `'biology' | 'pathophysiology' | 'microbiology' | (string & {})` — 자동완성 + 확장
- 학기 판별: 02-22~08-21 → 1학기, 08-22~02-21 → 2학기
- 태그 형식: `"12_신경계"` (value) → `"#12_신경계"` (표시)

## 인증 시스템

- **학생**: 학번 `20230001` → `20230001@rabbitory.internal` (Firebase Auth). `registerStudent` CF가 enrolledStudents 확인
- **교수**: 이메일 → `initProfessorAccount` CF → `allowedProfessors/{email}` 확인
- **교수 권한**: `users/{uid}.assignedCourses` + CF `verifyProfessorAccess()`. 비어있으면 모든 과목 허용
- **복구 이메일**: 학생 설정 → 비밀번호 찾기 시 인증코드 발송
- Middleware 없음 — `useRequireAuth()` 훅으로 클라이언트 리다이렉트

## 아키텍처

### 상태 관리

- **전역**: React Context 6개 (User, Course, Theme, HomeOverlay, Milestone, DetailPanel)
- **서버 데이터**: onSnapshot 실시간 동기화 (커스텀 훅)
- **인증**: `onAuthStateChanged` → `useAuth()`
- **캐시**: sessionStorage SWR (랭킹/레이더 5분), 모듈 Map (교수 통계 5분)
- **오프라인**: Firestore `persistentLocalCache` + `persistentMultipleTabManager`

### 캐시 전략

| 캐시 | 위치 | TTL |
|------|------|-----|
| 정적 에셋 | Vercel CDN | 1년 immutable |
| 랭킹/레이더 | Vercel Edge + sessionStorage | 5분 s-maxage |
| 교수 통계 | 모듈 Map | 5분 stale-while-revalidate |
| Material 캐시 | Firestore | 24시간 |
| Firestore | IndexedDB | persistent (오프라인 + 멀티탭) |

## UI/UX

### 빈티지 신문 테마

- 배경 #F5F0E8(크림), 카드 #FDFBF7, 텍스트 #1A1A1A
- 테두리 #D4CFC4(밝은) / #1A1A1A(진한), 그림자 `4px 4px 0px #1A1A1A`
- 글꼴: Noto Sans KR (본문), Playfair Display (빈티지 헤더), Cormorant Garamond (세리프)
- 패널/박스: `bg-[#F5F0E8]` + `border-2 border-[#1A1A1A]`

### 반별 강조색 (`--theme-accent`)

A: #8B1A1A (버건디) / B: #B8860B (다크골드) / C: #1D5D4A (에메랄드) / D: #1E3A5F (네이비)
생물학: #2E7D32 (자연 녹색) 단일 테마

### 반응형 3패널 가로모드

`useWideMode()`: landscape + 1024px 이상 → 좌측 사이드바(240px) + 중앙 + 우측 디테일
라우트 사이드바: `/quiz/[id]/*`, `/board/[id]/*`, `/review/[type]/[id]` 자동 분할

### 네비게이션

학생 4탭(홈/퀴즈/복습/게시판), 교수 5탭(홈/통계/퀴즈/학생/게시판)
PWA: viewport-fit cover, standalone, skipWaiting, FCM (`worker/index.js`)
SwipeBack: 왼쪽 25px → `router.back()`, 35% 초과 or velocity > 500

## 코딩 컨벤션

- 응답/주석/커밋/문서: 한국어
- 변수명/함수명: 영어
- 들여쓰기: 2칸
- 컴포넌트: React 함수형 + TypeScript
- 경로 별칭: `@/*` → 프로젝트 루트

## Firestore Security Rules 보호 필드

`totalExp`, `rank`, `role`, `badges`, `equippedRabbits`, `totalCorrect`, `totalAttemptedQuestions`, `professorQuizzesCompleted`, `lastGachaExp`, `spinLock` — Cloud Functions에서만 수정 가능

## 테스트 현황

CF 유닛 4개 파일 (164 tests): gradeQuestion(52), rankingFormulas(54), tekkenDamage(31), radarAndCluster(27)
E2E 8개 (페이지 로드 확인) + k6 부하 1개 (학생 300 + 교수 5)

### 테스트 확장 계획

- **1단계 CF**: recordAttempt(중복/락/idempotency), computeRadarNorm, computeRankings, weeklyStats(4군집), 매칭, AI Job
- **2단계 프론트**: ReviewPractice(채점), QuestionEditor(6종 왕복), ClassComparison(박스플롯)
- **3단계 통합**: 퀴즈→EXP 플로우, AI 생성→서재, 배틀→봇 대전, 교수 4군집

## 대형 파일 리팩토링 (SaaS Phase 2에서 처리)

| 파일 | 줄 수 | 전략 |
|------|-------|------|
| `review/page.tsx` | 3,008 | ReviewPageContext → 5탭 분리 |
| `ReviewPractice.tsx` | 2,571 | ReviewPracticeContext → 3단계 분리 |
| `QuestionEditor.tsx` | 2,437 | 문제 타입별 서브 에디터 |

## 디버깅 가이드

| 증상 | 원인 | 해결 |
|------|------|------|
| 퀴즈 제출 후 결과 안 뜸 | recordAttempt CF 실패 | CF 로그 + quiz_submit_locks 확인 |
| EXP가 안 올라감 | onQuizComplete 미발동 | quizResults 문서 생성 여부 확인 |
| AI 문제 생성 멈춤 | Job RUNNING 타임아웃 | retryQueuedJobs가 5분 후 FAILED 처리 |
| AI 문제 수 부족 | maxOutputTokens 도달 | 자동 보충 (최대 2회) + Truncated JSON 복구 |
| 배틀 매칭 안 됨 | RTDB 매칭 큐 잔류 | RTDB Console → tekken/matchmaking 확인 |
| 토끼 뽑기 안 됨 | lastGachaExp 불일치 | users.totalExp vs lastGachaExp |
| 서재 공개 전환 오류 | quiz_completions 클라이언트 쓰기 | CF 전용 (if false) |
| PPTX 변환 실패 | Cloud Run 타임아웃 | .pptx만 지원, 3분 타임아웃 |

