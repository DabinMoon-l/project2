# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**RabbiTory** — 대학 수업 보조 PWA. AI 기반 퀴즈 생성 + 게시판 + 토끼 컨셉 게이미피케이션 + 실시간 1v1 배틀.
학생은 AI로 문제를 생성하고 퀴즈를 풀며, 교수는 출제 스타일 분석과 학생 참여도를 모니터링한다.

### 코드베이스 규모

| 항목 | 수치 |
|------|------|
| 프론트엔드 (TSX+TS) | 131,640줄, 442파일 (app+components+lib) |
| Cloud Functions (TS) | 31,014줄, 80파일 |
| **총 코드** | **162,654줄** |
| 컴포넌트 (TSX) | 216개 |
| App 라우트 (page.tsx) | 35개 |
| lib 모듈 | 129개 |
| Cloud Functions (export) | 47개 export 라인 (실 함수 ~55개) |
| Firestore 보안 규칙 | 881줄 |
| Storage 규칙 / RTDB 규칙 | 93줄 / 95줄 |
| 커밋 수 | 820+ |

## 기술 스택

- **Next.js 16.1** (App Router, Turbopack) + **React 19** + **TypeScript 5** + **Tailwind CSS 3**
- **Framer Motion 11** (애니메이션), **react-window 2** (가상 스크롤), **next-pwa 5** (서비스 워커), **zustand 5** (전역 상태)
- **Firebase 10** — Auth, Firestore, RTDB(배틀 전용), Cloud Functions(Node 22), Storage, FCM
- **Supabase 2.103** — Phase 1 완료 (rankings/radar 단독), Phase 2 진행 중 (reviews/posts/rabbits/enrollment 듀얼 라이트 + Feature Flag)
- **AI**: Gemini 2.5 Flash + thinking 모드 (문제 생성/이미지 분석/콩콩이/배틀/교수분석), Claude Sonnet-4 (월별 리포트만)
- **배포**: Vercel (프론트) + Firebase (CF/Firestore/RTDB) + Cloud Run (PPTX→PDF, `cloud-run-pptx/main.py`)
- **문서**: pdfjs-dist, exceljs, docx, file-saver, jszip

### 데이터 추상화 레이어

- `lib/api/` — CF 타입 안전 래퍼 (`callFunction<K>()`, `CloudFunctionMap` 약 50개 함수)
- `lib/repositories/` — 12 Firebase repo + 5 Supabase repo + 1 IndexedDB(pdfStore)
- `lib/repositories/index.ts` — Feature flag 기반 DI (`NEXT_PUBLIC_USE_SUPABASE_*`)
- `lib/subscriptions/` — `SubscriptionManager` 참조 카운팅 (같은 key → 1개 실제 구독, N개 리스너)
- `firebase/firestore` 직접 import는 `firestoreBase.ts`, `firebase.ts` 2개 파일에만 존재
- **SaaS 마이그레이션 설계**: `docs/saas-architecture.md`

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
npm run build        # prebuild(shared 동기화) → tsc
npm run lint         # @typescript-eslint
npm run serve        # 에뮬레이터로 로컬 테스트
npm run deploy       # Firebase 배포
```

- **Node 22 필수** (`engines.node: "22"`)
- **리전**: 모든 CF `asia-northeast3` (서울)
- tsconfig가 프론트보다 엄격: `noUnusedLocals`, `noImplicitReturns`, `strict`

### 테스트

```bash
npm run test                  # Vitest (프론트 유닛)
npm run test:e2e              # E2E (Playwright)
npm run test:e2e:ui           # UI 모드
cd functions && npm test      # CF 유닛 (Vitest)
k6 run tests/load/mixed-scenario.k6.js   # 부하 (학생 300 + 교수 5)
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
- `shared/courseChapters.json` — 과목별 챕터 인덱스 + 세부단원

**동기화**: `functions/package.json` prebuild → `shared/*.json` → `functions/src/shared/` 자동 복사
**⚠️ 상수 수정 시 반드시 `shared/*.json`을 편집** (`functions/src/shared/`는 빌드 산출물)

## 학생 탭 구조 (4탭)

### 홈 탭 (`/`)

`HomeOverlay` 전체화면 오버레이.
- **프로필**: 닉네임 + 프로필 토끼 + 설정(알림/비밀번호/반 변경/로그아웃)
- **공지**: `AnnouncementChannel` (`components/announcement/`) — 교수 공지 채널 (투표/이미지/파일/리액션, 객관식+주관식 투표)
- **의견게시판**: `OpinionChannel` — 학생↔교수 실시간 의견
- **캐릭터**: `CharacterBox` — 장착 토끼 표시, 꾹 누르기 → 배틀 진입
- **XP 바**: 현재 EXP / 다음 마일스톤 (50XP 단위)
- **도감**: `RabbitDogam` — 80마리 토끼 컬렉션 + 상세(스탯/장착/이름)
- **랭킹**: `RankingSection` → `RankingBottomSheet` — 개인/팀/일간/주간/전체

**가로모드 3패널**: 1쪽(사이드바) + 2쪽(홈 오버레이) + 3쪽(상세 창)
- 프로필/공지/의견/도감/랭킹 → 가로모드에서 `openDetail()`로 3쪽에 표시
- 1쪽 `home-bg-1.jpg`, 2쪽 `home-bg.jpg`, 3쪽 `home-bg-3.jpg` 배경

### 퀴즈 탭 (`/quiz`)

- **교수 캐러셀**: midterm/final/past/independent 카드 스와이프 (최신 퀴즈 디폴트)
- **반 필터**: 전체/A/B/C/D
- **퀴즈 그리드**: `QuizGrid` — Start(미풀이)/Review(풀이완료) 상태 구분
- **퀴즈 관리**: 학생 자작 퀴즈 편집/삭제/공개 전환
- **퀴즈 만들기**: `/quiz/create` — 6종 문제 타입 편집기 + OCR + 이미지 크롭
- **AI 문제 생성**: 플로팅 버튼 → `AIQuizContainer` → 업로드 → 태그+난이도 → 생성

**퀴즈 풀이 플로우**: `/quiz/[id]` → `/quiz/[id]/result` → `/quiz/[id]/feedback` → `/quiz/[id]/exp`
- 가로모드: `QuizPanelContainer`가 4단계를 내부 state로 관리 (3쪽 잠금)
- `QuizNavigation`: 3단계 버튼 (제출→채점→다음/결과보기)
- 바로 채점 + 인라인 피드백 + 선지별 해설 아코디언

### 복습 탭 (`/review`)

UI 필터 4탭 (`components/review/types.ts`의 `FILTER_OPTIONS`):
1. **서재** (`LibraryTab`) — AI 생성 + 공개 퀴즈
2. **오답** (`WrongTab`) — 오답만 모아 복습
3. **찜** (`BookmarkTab`) — 퀴즈 북마크
4. **커스텀** (`CustomTab`) — 학생 자작 폴더

(타입에는 `'solved'`도 있으나 내부용)

**수정 문제 다시 풀기**: 서재탭에서 교수가 수정한 문제에 골든 뱃지(!) 표시, 클릭 시 `practiceOnly` 모드로 점수 변동 없이 복습 (`updatePracticeAnsweredAt` CF로 뱃지 제거)

**복습 연습 플로우**: `FolderDetailPage` (`review/[type]/[id]/page.tsx`) → `ReviewPractice` → 3 stages
- `PracticeStage` → `ResultStage` → `FeedbackStage` (오답 폴더 저장 + EXP)
- 가로모드(복습 탭): `openDetail(<FolderDetailPage isPanelMode />)`, 연습 시작 시 `lockDetail()` → 3쪽 잠금
- 가로모드(서재 바로가기): 2쪽=`FolderDetailPage`(페이지) + 3쪽=`WidePagePractice`(autoStart)

### 게시판 탭 (`/board`)

- **태그**: 학사, 학술, 기타
- **이미지 첨부**: Storage 업로드, 인라인 표시
- **좋아요**: 게시글 좋아요 토글
- **댓글**: 루트 댓글 + 대댓글 (`parentId`), 댓글 채택(30 EXP)
- **콩콩이 AI**: 학술 태그 → `onPostCreate` CF → Gemini 자동 댓글 (`authorId: 'gemini-ai'`), 친절한 반말체, 이모지 금지
- **교수 핀/공지**: 교수가 게시글 핀 고정
- **공유**: `/share/board/[id]` — 공유 링크 전용 페이지

**가로모드**: 게시글 클릭 → 3쪽에 `PostDetailPage` 표시 (2쪽 목록 유지)

## 교수 탭 구조 (5탭)

### 홈 (`/professor`)
- 교수 전용 `ProfessorHomeOverlay` + `ProfessorCharacterBox` + `ProfessorRankingSection`

### 통계 (`/professor/stats`)
- **5축 레이더** (10분 사전 계산, `computeRadarNormScheduled`): 퀴즈/활동량/배틀/소통/출제력
- **4군집 분류**: passionate/hardworking/efficient/atRisk (median 기반 동적 분류)
- **위험 학생 감지**: Z-score < -1.5 주의, < -2 위험
- **변별도**: 상위 27% - 하위 27% 정답률 (참여 ≥4명)
- **월별 리포트**: `generateMonthlyReport` — Claude Sonnet-4 인사이트 → Excel/Word 내보내기 (매월 1일 03:00 자동 생성)
- **가로모드 3패널**: 2쪽(요약카드+반비교+피드백) + 3쪽(챕터분석 RadarChart 자동 표시)

### 퀴즈 관리 (`/professor/quiz`)
- 직접 출제 / AI 생성 / 미리보기 / 공개 설정
- 학생 `custom` 퀴즈 수정 시 `type` 덮어쓰기 방지 (originalType 체크)

### 학생 관리 (`/professor/students`)
- 일괄 등록 (`bulkEnrollStudents`), 비밀번호 초기화 (`resetStudentPassword`), 계정 삭제 (`deleteStudentAccount` / `removeEnrolledStudent`)
- 학생 상세 모달 (레이더 + 퀴즈 이력)

### 게시판 (`/professor/board`)
- 학생 게시판과 동일 + 공지 관리

(기존 `/professor/analysis`도 라우트 존재 — 정밀 분석용)

## AI 문제 생성 파이프라인

### 4단계 비동기 파이프라인

```
1. enqueueGenerationJob — Rate limit, sha256 dedup, Storage 임시 저장
2. workerProcessJob (onDocumentCreated, jobs/{jobId}) — 동시성 제한 (MAX_CONCURRENT_JOBS=40)
3. generateStyledQuiz — buildFullPrompt(컨텍스트 다중 레이어), Gemini 호출, JSON 복구
4. 후처리 — 문제 수 부족 시 자동 보충, 챕터 ID 검증, Material Cache 저장
```

- 재시도/타임아웃: `retryQueuedJobs` (5분), `cleanupExpiredJobs` (1시간)
- Gemini 큐: `geminiQueue.ts` (5분/6시간 스케줄)

### `buildFullPrompt` 컨텍스트 레이어 (`functions/src/styledQuizGenerator.ts:816`)

| 레이어 | 함수 | 역할 |
|--------|------|------|
| **Style Context** | `buildStyleContextPrompt` | 교수 스타일 프로필 + 추출 키워드 + 문제 뱅크 샘플 |
| **Difficulty** | `buildDifficultyPrompt` | 난이도별 인지 수준/문제 유형/발문 스타일 |
| **Scope Context** | `buildScopeContextPrompt` | 과목 전체 범위 교과서 (오답 검증·함정 구성용) |
| **Chapter Index** | `buildChapterIndexPrompt` | 챕터 분류 체계 (자동 태깅용) |
| **Focus Guide** | `getFocusGuide` | 과목별 필수/고빈도 출제 포인트 (`(필수 출제)`, `(고빈도)`) — 1회차만 |
| **Course Overview** | `buildCourseOverviewPrompt` | 과목 특성 + 선택 챕터 커리큘럼 상세 |
| **Selected Details** | (인라인) | 사용자 선택 세부단원 집중 출제 (전체의 70% 강제) |
| **Professor Prompt** | (인라인) | 교수가 직접 입력한 출제 지시사항 |
| **Uploaded Text** | (인라인) | OCR/PDF/PPTX에서 추출한 학습 자료 |
| **Image Section** | (인라인) | 사용 가능한 이미지 URL 목록 (HARD에서 크롭본) |

### Focus Guide 시스템

과목별 필수/고빈도 출제 포인트. `getFocusGuide(courseId, chapters)` → 해당 챕터만 필터링.
1회차 생성에만 사용 (focus 50% + scope 50%), 2회차부터 scope 단독.

```typescript
// 예시: 미생물학 챕터 3
- **(필수 출제) 감염 성립 3요소**: 감염원, 감염경로, 감수성 숙주
- **(고빈도) 기회감염**: 정의, 내인감염, 균교대감염 비교
```

AI 문제 생성 + 배틀 문제 풀 양쪽에서 동일한 Focus Guide 사용.

### 입력 형식

이미지(최대 10장) / PDF(페이지 선택) / PPTX(Cloud Run 변환, `convertPptxToPdf`) / 텍스트

### HARD 특수 처리

`analyzeImageRegions` (Gemini Vision) → jimp 이미지 크롭 → 크롭본만 전송, 복수정답 `[0, 2]`, 교차 챕터 함정

### 선지 품질 규칙 (AI 프롬프트 내장)

- **길이 균일**: 정답/오답 선지 길이를 비슷하게
- **정보량 제한**: 각 선지에 팩트 최대 2개, "A이고 B이며 C이다" 식 3개 이상 나열 금지
- **극단어 분산**: "반드시/유일한/항상" 같은 한정어를 오답에만 집중 배치 금지
- **구조 균일**: 정답이 양면 비교면 오답도 양면 비교 구조
- **포괄성 금지**: "N가지 모두 서술한 선지=정답" 패턴 금지

### 교수 스타일 학습

`professorQuizAnalysis/{courseId}` — 발문패턴/오답전략/주제비중. `onProfessorQuizCreated` (`onDocumentWritten` + `isPublished === true` 트리거).
`extractKeywordsFromQuestions` maxOutputTokens 8192.

## 게이미피케이션 시스템

### EXP 보상 (단일 소스: `shared/expRewards.json`)

| 활동 | EXP |
|------|-----|
| 퀴즈 만점 (PERFECT) | 50 |
| 퀴즈 90%+ (EXCELLENT) | 40 |
| 퀴즈 70%+ (GOOD) | 35 |
| 퀴즈 50%+ (PASS) | 30 |
| 퀴즈 50% 미만 (FAIL) | 25 |
| 커스텀 퀴즈 생성 | 50 |
| AI 퀴즈 저장 | 25 |
| 퀴즈 공개 전환 | 15 |
| 피드백 제출 | 15 |
| 복습 완료 (`recordReviewPractice`) | 25 |
| 게시글 작성 | 15 |
| 댓글 작성 | 15 |
| 댓글 채택 | 30 |

배틀 EXP는 별도 (`functions/src/utils/tekkenDamage.ts:BATTLE_XP`):
- 승리 30 + 연승×5 (보너스 최대 +20) → **최대 50**
- 패배 10

**마일스톤**: 50XP마다 → 뽑기 or 레벨업 선택

### 토끼 시스템

- **80마리** 고유 토끼 — 베이스 스탯 분류: 방어형/공격형/체력형/균형형
- **뽑기 2단계**: `spinRabbitGacha`(마일스톤 소비 → 랜덤 0~79, pendingSpin idempotency) → `claimGachaRabbit`(이름 짓기 → 영구 소유)
- 이미 보유 시 마일스톤 미소비 → 바로 레벨업
- **레벨업**: `levelUpRabbit` CF — 랜덤 분배 스탯 증가 (HP/ATK/DEF 합 고정)
- **장착**: 최대 2마리 (배틀 2vs2), `equipRabbit`/`unequipRabbit` CF
- **이미지**: rabbitId 0~79 → 파일명 001~080 (1-indexed)
- **프로필**: 토끼를 프로필 사진으로 설정 가능

### 철권퀴즈 (배틀 시스템)

실시간 1v1 토끼 배틀 (각 2마리 로테이션 = 2vs2), **Firebase RTDB** 사용.

**배틀 플로우**:
```
매칭(20초, 봇 폴백) → countdown → question(30초) → 양쪽정답시 mash(연타, 30초) → roundResult → finished(10라운드)
```

**매칭 시스템**:
- Per-User Write(contention 0), 매칭 락(20초 TTL — `MATCH_TIMEOUT`), FIFO 페어링
- 챕터 교집합이 없으면 봇 매칭
- `BattleInviteContext` — 친구 초대(도전장) 푸시 알림

**문제 풀 (사전 생성)**:
- `tekkenPoolRefillScheduled` — `0 3 1 * *` (매월 1일 03:00 KST, 비용 절감)
- 과목당 전 챕터 × 정해진 수의 medium 문제 (easy 제거 — 선지 소거가 너무 쉬움)
- `generateBattleQuestions()` — Scope + FocusGuide + 교수 스타일 병렬 로드
- 배틀 특성: 30초 제한 → 문제 1-2문장, 선지 최대 30자, 4지선다만 (OX 금지), 단순 정의 문제 금지
- `drawQuestionsFromPool()` — 학생 선택 챕터 기반 추출 (24시간 seen 중복 방지)

**데미지 계산** (`utils/tekkenDamage.ts`):
```
baseDamage  = max(ceil(ATK² / (ATK + DEF × 1.5)), 5)        // 2v2 로테이션 기준
critical    = ceil(baseDamage × 1.5)                         // 10초 이내 응답
mashBonus   = max(ceil(loserMaxHp × 0.35), 10)               // 연타 승리 보너스
mutualWrong = 10                                             // 양쪽 오답 시 상호 데미지
```

**봇**:
- 약 40% 정답률, 6초 고정 응답
- 레벨 = 유저 토끼 레벨 + 3 (±1 랜덤)
- 연타(mash) 단계: 플레이어 탭의 60~90%

**XP 이중 지급 방지**: `tekkenRound.finalizeBattle` → `result/xpGranted` RTDB 트랜잭션 (`committed=false`면 abort)

### 랭킹

| 종류 | 공식 |
|------|------|
| **개인** | `profCorrectCount × 4 + totalExp × 0.6` |
| **팀** | `normalizedAvgExp × 0.4 + avgCorrectRate × 0.4 + avgCompletionRate × 0.2` |

- **10분 사전 계산** (`computeRankingsScheduled`, Supabase Phase 1 완료로 비용 부담 해제 → 2시간 → 10분 복원)
- 동점 시 같은 순위 (1위, 1위, 3위)
- 일간/주간/전체 필터
- **순위 변동**: `prevDayRanks` 일간 스냅샷 — 00:00 KST 기준 전일 랭킹 저장
- **교수 실명/닉네임 토글**: 교수만 표시, 반별 드롭다운 좌측 위치

## 퀴즈 시스템

### 카테고리

midterm/final(교수 시험), past(기출), independent(교수 독립), custom(학생 자작), ai-generated(AI 서재), professor(교수 비공개)

### 문제 유형

| 유형 | 답안 형식 | 비고 |
|------|----------|------|
| OX | 'O' \| 'X' | |
| 객관식 | number (0-indexed), 복수정답: number[] | 2~8개 선지 |
| 단답형 | string, 복수정답: `\|\|\|` 구분 | case-insensitive |
| 서술형 | 수동 채점 (교수 전용) | |
| 결합형 | 공통 지문/이미지 + 하위 N문제 | N문제 = N점 |
| 보기형(bogi) | 생물학 특화 | |

**answer 인덱싱**: **모두 0-indexed** (`migrateQuizAnswersTo0Indexed` 마이그레이션 완료)

### 인라인 서식 (`renderInlineMarkdown`)

- `*이탤릭*` → *이탤릭* (학명 등)
- `{아래첨자}` → 아래첨자 (CO{2} → CO₂)
- `^위첨자^` → 위첨자 (m^2^ → m²)

### `recordAttempt` 보안 5중 방어

1. 클라이언트 `useRef` guard (React StrictMode 중복 호출 방지)
2. 서버 `quiz_submit_locks` 트랜잭션 (60초 TTL)
3. `rateLimitV2` (분당 3회)
4. `quiz_completions` 체크 (완료된 퀴즈 재진입 방지)
5. `attemptKey` idempotency (동일 제출 → 캐시 반환)

분산 카운터: `quiz_agg/{quizId}/shards/{N}` (hotspot 제거)

## 가로모드 3패널 시스템

### 레이아웃 (`app/(main)/layout.tsx`)

```
┌─────────────┬──────────────────┬──────────────────┐
│  1쪽 (240px) │  2쪽 (50%)       │  3쪽 (50%)       │
│  Navigation  │  Main Content    │  Detail Panel    │
│  사이드바     │  (페이지)         │  (상세/잠금)      │
└─────────────┴──────────────────┴──────────────────┘
```

- `useWideMode()` (`lib/hooks/useViewportScale.ts`): `useSyncExternalStore` 기반, paint 전 동기 평가 → 깜빡임 제거
- Tailwind `wide:` 커스텀 스크린: `{ raw: '(orientation: landscape) and (min-width: 1024px)' }`

### `DetailPanelContext` (잠금 + 대기 시스템)

```typescript
interface DetailPanelContextType {
  content: ReactNode | null;                    // 3쪽 현재 콘텐츠
  queuedContent: ReactNode | null;              // 잠금 중 2쪽 대기
  isDetailOpen: boolean;
  isQueuedOpen: boolean;
  isLocked: boolean;                            // 퀴즈/복습/만들기/배틀 진행 중
  contentKey: number;                           // 강제 remount 카운터
  openDetail(content, trackingPath?): void;
  replaceDetail(content, trackingPath?): void;
  closeDetail(): void;
  clearQueue(): void;
  lockDetail(): void;
  unlockDetail(andClose?: boolean): void;       // 대기 → 3쪽 자동 승격
}
```

**잠금 대상**: 퀴즈(`QuizPanelContainer`), 복습(`ReviewPracticePanel`/`WidePagePractice`), 퀴즈만들기(`QuizCreatePage`), AI문제풀기(`AIQuizPracticePanel`), 배틀(포탈 독립)

**관련 훅**:
- `usePanelLock(enabled)` — 3쪽에서만 lock, 2쪽 cleanup이 3쪽 잠금 해제 방지
- `useClosePanel()` — 3쪽=`unlockDetail(true)`, 2쪽=`closeDetail()` 자동 분기
- `usePanelStatePreservation(type, getState, restoreState)` — `panelStateStore` (zustand) 기반 2쪽→3쪽 승격 시 상태 보존 (24시간 만료)

### CSS 변수 (body에 동적 설정)

| 변수 | 모바일 | 가로(기본) | 가로(잠금) |
|------|--------|----------|----------|
| `--detail-panel-left` | `0` | `calc(50% + 120px)` | `240px` |
| `--modal-left` | `0px` | `240px` | `240px` |
| `--modal-right` | `0px` | `calc(50% - 120px)` | `calc(50% - 120px)` |
| `--home-sheet-left` | `0px` | `calc(50% + 120px)` | — |
| `--kb-offset` | 키보드 높이 | — | — |

### 패널 모드 CSS 패턴

- 전체 페이지: `fixed bottom-0 right-0` + `left: var(--detail-panel-left)`
- 패널 모드: `sticky bottom-0` (aside 내 스크롤 컨텍스트에서 동작)
- 모달: 패널 모드에서 `absolute inset-0` (포탈 대신 3쪽 안에 렌더)

### 서재 바로가기 (1쪽 사이드바)

`SidebarLibraryItems` (`Navigation.tsx`) — 가로모드 복습 탭 활성화 시 문제지 목록 인라인 표시.

**클릭 플로우**:
```
1. unlockDetail(false) — 3쪽 잠금만 해제 (콘텐츠 유지)
2. router.push('/review/library/{id}?autoStart=all') — 2쪽 FolderDetailPage
3. FolderDetailPage autoStart effect — unlockDetail(true) + openDetail(WidePagePractice)
4. WidePagePractice mount → usePanelLock() → 3쪽 잠금
```

### 홈 배경 시스템

- 1쪽: `home-bg-1.jpg` (사이드바 뒤, opacity 전환)
- 2쪽: `home-bg.jpg` (HomeOverlay)
- 3쪽: `home-bg-3.jpg` (`backgroundSize: '102% 102%'` 틈 방지)

## 과목 시스템

| 과목 ID | 이름 | 챕터 접두사 | 챕터 수 | 비고 |
|---------|------|-----------|---------|------|
| `biology` | 생물학 | `bio_` | 12 | 1~12 |
| `pathophysiology` | 병태생리학 | `patho_` | 13 | 3~16 (1, 2, 6 제외) |
| `microbiology` | 미생물학 | `micro_` | 11 | 1~11 |

- 세부단원: `chapter.details[]` (예: `bio_3_1`) — `selectedDetails`로 AI 출제 집중 가능
- **동적 과목**: `courses/{courseId}` → `CourseContext.courseRegistry` 실시간 구독
- **CourseId 타입**: `'biology' | 'pathophysiology' | 'microbiology' | (string & {})` — 자동완성 + 확장
- **학기 전환**: `februaryTransition` (2/22 0:00 KST), `augustTransition` (8/22 0:00 KST)
  - 병태생리 → 미생물 진급 / 미생물 → 졸업(삭제) / 생물 → 병태생리 진급
  - reviews/quizResults/customFolders/quizBookmarks/quizProgress 삭제, 캐릭터/뱃지 유지

## 인증 시스템

- **학생**: 학번 `20230001` → `20230001@rabbitory.internal` (Firebase Auth). `registerStudent` CF가 enrolledStudents 확인
- **교수**: 이메일 → `initProfessorAccount` CF → `allowedProfessors/{email}` 확인
- **교수 권한**: `users/{uid}.assignedCourses` + CF `verifyProfessorAccess()`. 비어있으면 모든 과목 허용
- **복구 이메일**: `requestPasswordReset` (Gmail SMTP, 6자리 코드 5분 유효), `updateRecoveryEmail`
- **비로그인 문의**: `submitInquiry`
- Middleware 없음 — `useRequireAuth()` 훅으로 클라이언트 리다이렉트

## 스케줄 함수 주기 (현재 상태)

| 함수 | 주기 | 용도 |
|------|------|------|
| `computeRankingsScheduled` | every 10 minutes | 개인/팀 랭킹 사전 계산 (Supabase Phase 1 후 복원) |
| `computeRadarNormScheduled` | every 10 minutes | 5축 레이더 정규화 |
| `tekkenPoolRefillScheduled` | `0 3 1 * *` (매월 1일 03시) | 배틀 문제 풀 리필 |
| `cleanupRateLimitsScheduled` | every 1 hours | Rate limit 기록 정리 |
| `tekkenCleanup` | every 15 minutes | 좀비 배틀 정리 |
| `retryQueuedJobs` | every 5 minutes | AI 생성 실패 재시도 |
| `cleanupExpiredJobs` | every 1 hours | AI Job 만료 정리 |
| `processGeminiQueue` | every 5 minutes | Gemini 큐 처리 |
| `cleanupGeminiQueue` | every 6 hours | Gemini 큐 정리 |
| `pptxJob cleanup` | `0 3 * * *` (매일 03시) | PPTX 작업 정리 |
| `collectWeeklyStatsScheduled` | every monday 00:00 | 주별 통계 수집 |
| `generateMonthlyReportScheduled` | `0 3 1 * *` (매월 1일 03시) | Claude Sonnet-4 월별 리포트 |
| `februaryTransition` / `augustTransition` | `0 0 22 2/8 *` | 학기 전환 |

## Supabase 마이그레이션 현재 상태

### Phase 1 — ✅ 완료 (2026-04-19)

- `rankings`, `radar_norms` Supabase 단독 (Firestore 백필 중단)
- 환경변수: `NEXT_PUBLIC_USE_SUPABASE_RANKINGS=true`, `NEXT_PUBLIC_USE_SUPABASE_RADAR=true`
- 효과: Firestore 읽기 0 → 비용 절감 + 10분 사전 계산 복원

### Phase 2 — 진행 중

CF에서 듀얼 라이트 (Firestore + Supabase), 프론트는 Feature Flag로 읽기 소스 전환.

| 도메인 | 듀얼 라이트 함수 | 프론트 Flag | 상태 |
|--------|----------------|-------------|------|
| reviews | `supabaseDualBatchUpsertReviews` | `NEXT_PUBLIC_USE_SUPABASE_REVIEWS` | 코드 완료, Realtime SQL+CF 배포+플래그 on 대기 |
| posts/comments | `supabaseDualUpsertPost/Comment` | `NEXT_PUBLIC_USE_SUPABASE_POSTS` | 코드 완료 |
| rabbits/holdings | `supabaseDualWriteRabbit*` | `NEXT_PUBLIC_USE_SUPABASE_RABBITS` | 진행 중 |
| enrollments | `supabaseDualWriteEnrollment` | `NEXT_PUBLIC_USE_SUPABASE_ENROLLMENT` | 진행 중 |

**Kill Switch**: CF 환경변수 `SUPABASE_DUAL_WRITE=false`로 듀얼 라이트 즉시 차단 가능
**기본 org**: `NEXT_PUBLIC_DEFAULT_ORG_ID` — `organizations` 테이블의 `rabbitory-pilot` slug

### 추후 Phase (요약)

- **Phase 3**: CF → Supabase Edge Functions + Cloud Run (AI)
- **Phase 4**: Storage 마이그레이션 (배틀 RTDB는 Firebase 유지)
- **Phase 5**: 동적 Scope/FocusGuide (교수가 PDF/PPTX 업로드 → AI 자동 추출)
- **Phase 6**: 셀프 온보딩 + 빌링 (Stripe/Paddle)
- **Phase 7**: App Store 출시 + i18n

상세: `docs/saas-architecture.md`

## Firestore Security Rules 보호 필드

`totalExp`, `rank`, `role`, `badges`, `equippedRabbits`, `totalCorrect`, `totalAttemptedQuestions`, `professorQuizzesCompleted`, `lastGachaExp`, `spinLock` — Cloud Functions에서만 수정 가능

## 공지 시스템 (announcementActions.ts)

- 객관식 투표(`voteOnPoll`) / 주관식(`submitPollTextResponse`) / 복합(`submitPollSurvey`)
- 투표자 프라이버시: `pollVotes/{pollIdx}_{uid}`, `pollResponses/{pollIdx}_{uid}` (교수만 read), 공개 집계는 `polls[i].voteCounts`
- 교수 조회: `getPollResponses`, `getPollResponsesBatch`
- 리액션: `reactToAnnouncement` (허용 이모지 6종)
- 읽음: `markAnnouncementsRead`

## UI/UX

### 빈티지 신문 테마

- 배경 #F5F0E8(크림), 카드 #FDFBF7, 텍스트 #1A1A1A
- 테두리 #D4CFC4(밝은) / #1A1A1A(진한), 그림자 `4px 4px 0px #1A1A1A`
- 글꼴: Noto Sans KR (본문), Playfair Display (빈티지 헤더), Cormorant Garamond (세리프)

### 반별 강조색 (`--theme-accent`)

A: #8B1A1A (버건디) / B: #B8860B (다크골드) / C: #1D5D4A (에메랄드) / D: #1E3A5F (네이비)
생물학: #2E7D32 (자연 녹색) 단일 테마

### 네비게이션 / PWA

- 학생 4탭(홈/퀴즈/복습/게시판), 교수 5탭(홈/통계/퀴즈/학생/게시판)
- `SwipeBack` (`components/common/SwipeBack.tsx`) — 좌측 25px 가장자리 스와이프로 뒤로가기 (가로모드/탭 루트 비활성)
- PullToHome **제거됨** (Navigation 홈 탭 사용)
- PWA: viewport-fit cover, standalone, skipWaiting, FCM (`worker/index.js`), manifest orientation `any`

## 코딩 컨벤션

- 응답/주석/커밋/문서: 한국어
- 변수명/함수명: 영어
- 들여쓰기: 2칸
- 컴포넌트: React 함수형 + TypeScript
- 경로 별칭: `@/*` → 프로젝트 루트

## 주요 컨텍스트 / Store / 훅

**Contexts (`lib/contexts/`)** — 7개:
`UserContext`, `CourseContext`, `DetailPanelContext`, `HomeOverlayContext`, `BattleInviteContext`, `BattleSessionContext`, `MilestoneContext`

**Zustand stores (`lib/stores/`)** — 3개:
`battleSessionStore`, `panelStateStore` (localStorage persist), `pdfViewerStore`

**Hooks (`lib/hooks/`)** — 약 46개. 주요:
`useAuth`, `useProfile`, `useRabbit`, `useReview`, `useReviewItems`, `useLearningQuizzes`, `useCompletedQuizzes`, `useQuizBookmark`, `useBoard*`, `useTekkenBattle`, `useBattlePlacement`, `useProfessorStats`, `useEnrolledStudents`, `useViewportScale`(`useWideMode`), `useKeyboardAware`, `useOnlineStatus`, `useSessionSnapshot`, `useDailyAttendance`, `usePageViewLogger`, `useActivityTracker`

## 대형 파일 (1,500줄+)

| 파일 | 줄 수 | 내용 |
|------|-------|------|
| `app/(main)/review/[type]/[id]/page.tsx` | 2,131 | 폴더 상세 + 복습 플로우 |
| `app/(main)/quiz/create/page.tsx` | 1,998 | 퀴즈 만들기 6종 편집기 |
| `functions/src/styledQuizGenerator.ts` | 1,918 | AI 프롬프트 다중 레이어 |
| `functions/src/board.ts` | 1,854 | 게시판 + 콩콩이 + 듀얼 라이트 |
| `app/(main)/professor/quiz/create/page.tsx` | 1,757 | 교수 퀴즈 출제 |
| `lib/ocr.ts` | 1,692 | Clova OCR 파이프라인 |
| `components/quiz/create/QuestionEditor.tsx` | 1,653 | 문제 편집기 UI |
| `app/(main)/professor/quiz/[id]/preview/page.tsx` | 1,648 | 교수 미리보기 |
| `app/(main)/review/page.tsx` | 1,641 | 복습 4탭 + 연습 |
| `app/(main)/quiz/[id]/result/page.tsx` | 1,566 | 퀴즈 결과 + 해설 |
| `functions/src/studentAuth.ts` | 1,309 | 학생 인증 + 일괄 등록 |
| `functions/src/utils/supabase.ts` | 1,060 | Supabase 듀얼 라이트 헬퍼 |

### 리팩토링 현황 (2026-04-22 기준)

**현재 분할된 파일**: **없음** (Phase 2 에서 repository 레이어만 건드렸고 컴포넌트 내부 구조는 그대로).

**Phase 3 이 자동 분할해주는 것 (3개)**:
- `styledQuizGenerator.ts` 1,918 → Wave 2 Cloud Run 이전 시 `cloud-run-ai/src/routes/*` 로 엔드포인트별 분산 (buildFullPrompt, buildStyleContextPrompt, buildScopeContextPrompt 등 각자 파일)
- `board.ts` 1,854 → Wave 1(onCall 3개 → Edge) + Wave 3(Firestore 트리거 6개 → pg_trigger webhook) 으로 절반 분할
- `studentAuth.ts` 1,309 → Wave 1(단순 7개 → Edge) + Wave 2(bulkEnroll/delete 3개 → Cloud Run) 로 분할
- 덤: `lib/ocr.ts` 1,692 도 Wave 2 `runVisionOcr` Cloud Run 이전 시 서버로 로직 이동으로 절반 축소 예상

**Phase 3 이 건드리지 않는 프론트 8개**: 여전히 숙제 — 여름(SaaS Phase 5 직전)에 별도 트랙으로 처리.

**동시 리팩토링을 추천하지 않는 이유**:
1. Edge/Cloud Run 이전 시 `callFunction` 경로가 바뀌는데 프론트도 동시에 쪼개면 디버깅 지옥
2. Edge Functions(JWT/CORS/Deno) vs React(Context/Reducer) 컨텍스트 전환 비용
3. 대형 컴포넌트 E2E 커버리지 부재 → 리팩토링 전 테스트 확보가 선행 과제

**타임라인**:
- 지금~6월: Phase 3 Wave 1~4 (CF 3개 + ocr 자연 분할)
- 7월(여름): 프론트 대형 8개 리팩토링 + i18n 준비 (SaaS Phase 5 직전)

## 디버깅 가이드

| 증상 | 원인 | 해결 |
|------|------|------|
| 퀴즈 제출 후 결과 안 뜸 | `recordAttempt` CF 실패 | CF 로그 + `quiz_submit_locks` 확인 |
| EXP가 안 올라감 | `onQuizComplete` 미발동 | `quizResults` 문서 생성 여부 확인 |
| AI 문제 생성 멈춤 | Job RUNNING 타임아웃 | `retryQueuedJobs`가 5분 후 FAILED 처리 |
| 배틀 매칭 안 됨 | RTDB 매칭 큐 잔류 | RTDB Console → `tekken/matchmaking` 확인 |
| 배틀 XP 이중 지급 | `xpGranted` 트랜잭션 실패 | `tekken/battles/{id}/result/xpGranted` 값 확인 |
| 토끼 뽑기 안 됨 | `lastGachaExp` 불일치 | `users.totalExp` vs `lastGachaExp` |
| 가로모드 3쪽 잔류 | 잠금 해제 후 detail 안 닫힘 | `unlockDetail` → `closeDetail` 순서 확인 |
| Supabase 데이터 안 뜸 | Feature Flag off | `.env.local`의 `NEXT_PUBLIC_USE_SUPABASE_*` 확인 |
| Gemini API 403 | API 키 노출/만료 | Google AI Studio에서 새 키 발급 |
