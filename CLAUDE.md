# CLAUDE.md

## 프로젝트 개요

**RabbiTory** — 대학 수업 보조 PWA. AI 기반 퀴즈 생성 + 게시판 + 토끼 컨셉 게이미피케이션.
학생은 AI로 문제를 생성하고 퀴즈를 풀며, 교수는 출제 스타일 분석과 학생 참여도를 모니터링.

### 앱 규모

| 항목 | 수치 |
|------|------|
| TypeScript/TSX 파일 | ~940개 |
| 총 코드 라인 | 85,000+ 줄 |
| 페이지/라우트 | 42개 |
| React 컴포넌트 | ~210개 |
| 커스텀 훅 | 36개 |
| Cloud Functions | 150+ (47개 모듈) |
| Firestore 컬렉션 | 25+ |
| 관리 스크립트 | 9개 (`scripts/`) |

## 기술 스택

### 프론트엔드
- **Next.js** 16.1.6 (App Router, Turbopack)
- **React** 19 + **TypeScript** 5
- **Tailwind CSS** 3
- **Framer Motion** 11 (페이지 전환, UI 애니메이션, 제스처)
- **Lottie React** 2.4 (퀴즈 결과 연출)
- **next-pwa** 5.6 (PWA 서비스 워커, FCM 통합)
- **react-window** 2.2.7 (가상 스크롤)
- **react-d3-cloud** 1.0.6 (단어 클라우드)

### 문서/파일 처리
- **pdfjs-dist** 4.0.379 (PDF 렌더링 + 페이지 선택)
- **exceljs** 4.4 (Excel 리포트) / **docx** 9.5.3 (Word 리포트)
- **file-saver** 2.0.5 / **jszip** 3.10.1 / **date-fns** 3.0

### Backend (Firebase)
- **Firebase** 10.7 — Auth, Firestore, Realtime Database, Cloud Functions, Cloud Messaging, Storage
- **firebase-functions** 5.0 + **firebase-admin** 12.0 (Node 20)
- **jimp** 0.22.12 (서버사이드 이미지 크롭)
- **nodemailer** 6.9.8 / **google-auth-library** 9.6

### AI
- **Gemini 2.5 Flash** — AI 문제 생성, 이미지 영역 분석, 철권퀴즈 문제, 콩콩이 자동답변, 챕터 추론
- **Claude Sonnet-4** — 교수 월별 리포트 인사이트 (generateMonthlyReport CF에서만 사용)

### 배포
- **Vercel** — 프론트엔드 (PWA, git push 자동 배포, CDN 캐시)
- **Firebase** — Cloud Functions, Firestore, RTDB, Storage
- **Cloud Run** — PPTX→PDF 변환 + 철권퀴즈 문제 풀 워커

### 데이터 추상화 레이어 (SaaS 마이그레이션 대비)
- `lib/api/` — Cloud Functions 타입 안전 래퍼 (`callFunction<K>()`, `CloudFunctionMap`)
- `lib/repositories/` — Firestore/RTDB/Storage 추상화 (11개 도메인 repo + firestoreBase)
- `lib/subscriptions/` — 구독 참조 카운팅 매니저 (`SubscriptionManager`, `useSubscription`)
- `firebase/firestore` 직접 import는 인프라 2개 파일에만 존재 (`firestoreBase.ts`, `firebase.ts`)

### SaaS 확장 목표 스택
- **Auth**: Better Auth (오픈소스, 셀프호스트, 멀티테넌시, SSO)
- **DB**: Supabase PostgreSQL (SQL, RLS로 테넌트 격리)
- **실시간**: Supabase Realtime (일반) + Firebase RTDB 유지 (배틀, 50ms 지연 필요)
- **Storage**: Supabase Storage (테넌트별 버킷)
- **서버**: Supabase Edge Functions (일반) + Cloud Run (AI 워크로드)
- **푸시알림**: Firebase FCM 유지
- **설계 문서**: `docs/saas-architecture.md` — PostgreSQL 28테이블 스키마, Better Auth 통합, 마이그레이션 6단계 로드맵

## 개발 명령어

```bash
npm install          # 의존성 설치
npm run dev          # 개발 서버 (Turbopack)
npm run build        # 프로덕션 빌드
npm run lint         # ESLint (next/core-web-vitals)
npm run analyze      # 번들 분석 (ANALYZE=true)
```

### Cloud Functions

```bash
cd functions
npm install          # CF 의존성 설치
npm run build        # TypeScript 컴파일
npm run lint         # @typescript-eslint 린트
npm run serve        # 에뮬레이터로 로컬 테스트
npm run deploy       # Firebase 배포
npm run logs         # 로그 확인
```

- **Node 20 필수** (`engines.node: "20"`)
- **리전**: 모든 CF `asia-northeast3` (서울)
- tsconfig가 프론트보다 엄격: `noUnusedLocals`, `noImplicitReturns`, `strict`
- **빌드 검증**: `npx next build` 통과를 커밋 전 필수 검증으로 사용

### 테스트

```bash
npm run test:e2e              # E2E (Playwright, 8개 스펙)
npm run test:e2e:ui           # UI 모드
cd functions && npm test      # CF 유닛 (Vitest, 3개 스펙)
k6 run tests/load/mixed-scenario.k6.js  # 부하 (학생 300 + 교수 5)
```

### 부하 테스트 상세 (`tests/load/mixed-scenario.k6.js`)

**동시접속**: 학생 300명 (biology 150 + microbiology 150) + 교수 5명

**학생 시나리오 분배**:

| VU 수 | 시나리오 | CF |
|--------|---------|-----|
| 100명 | 퀴즈 풀기 | `recordAttempt` |
| 70명 | 배틀 퀴즈 | `joinMatchmaking` → `submitAnswer` |
| 50명 | AI 문제 생성 | `enqueueGenerationJob` |
| 50명 | 복습 연습 | `recordReviewPractice` |
| 10명 | 토끼 뽑기 | `spinRabbitGacha` → `claimGachaRabbit` |
| 5명 | 토끼 레벨업 | `levelUpRabbit` |
| 10명 | 게시판 학술글 | `onPostCreate` (콩콩이 AI 트리거) |
| 5명 | 랭킹/레이더 | Firestore read |

**교수 시나리오** (5명, 120초): 대시보드 통계 + 학생 목록 + 퀴즈 관리 + 피드백 조회

**램프업**: 0→100→200→300 VU (15초씩) → 300 VU 1분 유지 → 쿨다운 15초

**합격 기준 (thresholds)**:

| 메트릭 | 기준 |
|--------|------|
| 퀴즈 제출 성공률 | > 85% |
| 배틀 매칭 성공률 | > 70% |
| 토끼 뽑기 성공률 | > 70% |
| 복습 연습 성공률 | > 85% |
| 게시판 학술글 성공률 | > 85% |
| 퀴즈 제출 p95 지연 | < 30초 |
| 교수 통계 성공률 | > 90% |
| 교수 통계 p95 지연 | < 10초 |

**실행 방법** (에뮬레이터):
```bash
firebase emulators:start
node tests/load/seed-production.js    # 테스트 데이터 시드
node tests/load/generate-tokens.js    # 인증 토큰 생성
k6 run tests/load/mixed-scenario.k6.js
```

**프로덕션**: `PROD=1 k6 run tests/load/mixed-scenario.k6.js`

### 공유 상수 (`shared/`)

프론트엔드와 Cloud Functions 간 **단일 소스**:
- `shared/expRewards.json` — EXP 보상 값
- `shared/courseChapters.json` — 과목별 챕터 인덱스 (3과목, 각 6~12챕터, 세부항목 포함)

**동기화**: `functions/package.json` prebuild → `shared/*.json` → `functions/src/shared/` 자동 복사
**⚠️ 상수 수정 시 반드시 `shared/*.json`을 편집** (개별 파일 수정 금지)

## 학습 플로우

### 학생 플로우

```
1. 로그인 (학번+비밀번호)
   ↓
2. 홈 — 토끼 캐릭터 + EXP바 + 랭킹 + 공지
   ↓
3. 퀴즈 학습 (3가지 경로)
   ├── [A] 교수 퀴즈 풀기: /quiz → /quiz/[id] → result → feedback → exp
   ├── [B] AI 문제 생성: 플로팅 버튼 → PDF/PPTX/이미지 업로드 → 태그+난이도 선택 → 생성 → 연습
   └── [C] 커스텀 퀴즈 만들기: /quiz/create → 6종 문제타입 편집기 → 공개/비공개
   ↓
4. 복습: /review → 5가지 필터 (서재/풀었던것/오답/찜/폴더) → 연습모드 3단계
   ↓
5. 게이미피케이션
   ├── EXP 축적 → 50XP마다 마일스톤 → 토끼 뽑기 or 레벨업 선택
   ├── 철권퀴즈: 실시간 1v1 토끼 배틀 (10라운드, 연타, 크리티컬)
   └── 랭킹: 개인 + 팀(반별) 경쟁
   ↓
6. 커뮤니티: /board → 학술 질문(콩콩이 AI 자동답변) + 잡담 + 댓글 채택
```

### 교수 플로우

```
1. 로그인 (이메일)
   ↓
2. 교수 홈 — 과목 선택 + 공지 작성 + 학생 활동 모니터링
   ↓
3. 퀴즈 관리
   ├── 직접 출제: /professor/quiz/create → 6종 문제타입 + 이미지
   ├── AI 문제 생성: 학생과 통합된 파이프라인 (플로팅 버튼) → 서재에서 편집/공개 전환
   └── 미리보기: 문제별 정답률/변별도 통계 + 재채점
   ↓
4. 학생 분석
   ├── 5축 레이더 차트 (퀴즈/활동량/배틀/소통/출제력)
   ├── 4군집 분류 (열정/노력/효율/이탈위험)
   ├── 위험 학생 감지 (Z-score < -1.5)
   └── 월별 리포트 (Claude 인사이트 → Excel/Word 내보내기)
   ↓
5. 학생 관리: 일괄 등록, 비밀번호 초기화, 계정 삭제
```

## AI 문제 생성 파이프라인

RabbiTory의 핵심 기능. 학생과 교수 모두 사용하는 4단계 비동기 파이프라인.

### 입력 방식 (AIQuizModal)

| 입력 | 처리 |
|------|------|
| **이미지 직접 업로드** | 카메라/갤러리 → Base64 (최대 10장) |
| **PDF 업로드** | pdfjs-dist → 페이지 썸네일 → 선택 → 고해상도 렌더링 (4장씩 배치) |
| **PPTX 업로드** | Cloud Run `convertPptxToPdf` (3분 타임아웃) → PDF 처리 |
| **텍스트만** | 과목 맞춤형 + 챕터 태그 선택 시 학습 자료 없이도 생성 가능 |

### 생성 옵션

- **난이도**: easy (기억/이해) / medium (적용/분석) / hard (분석/평가+함정+복수정답)
- **문제 수**: 5~20개
- **챕터 태그**: 과목별 동적 태그 필수 선택
- **프롬프트**: 추가 출제 지시사항 (선택)

### 파이프라인 단계

```
1. enqueueGenerationJob (CF)
   ├── Rate limit: 분당 3회, 일 15회
   ├── Dedup: sha256 기반 10분 내 동일 요청 → 기존 Job 반환
   ├── 이미지 → Firebase Storage 임시 저장 (Firestore 1MB 제한 우회)
   └── → jobs/{jobId} 문서 생성 (status: QUEUED)

2. workerProcessJob (onDocumentCreated 트리거)
   ├── 동시성: MAX_CONCURRENT_JOBS = 40, 초과 시 QUEUED 유지
   ├── Material Cache 조회 (fingerprint 기반, 24시간 TTL)
   ├── 5개 병렬 로드:
   │   ├── [1] styleProfile (교수 출제 패턴 분석)
   │   ├── [2] keywords (과목별 핵심 용어)
   │   ├── [3] questionBank (기존 문제 샘플 8개, Fisher-Yates)
   │   ├── [4] scope (챕터별 범위 + 인접 챕터 오답 참고)
   │   └── [5] chapterRepetitionMap (같은 챕터 생성 횟수 추적)
   ├── HARD 난이도: Gemini Vision 영역 분석 → 자동 이미지 크롭 → 크롭본만 전송
   └── → Gemini 2.5 Flash 호출

3. styledQuizGenerator (프롬프트 엔지니어링, 1812줄)
   ├── 10개 컨텍스트 레이어 조합:
   │   [1] 추가 프롬프트 (사용자 입력, 선택)
   │   [2] 과목 개요
   │   [3] 학습 자료 (텍스트/이미지)
   │   [4] Focus Guide (챕터별 고빈도/필수출제 항목 — 생물학 12챕터 완성)
   │   [5] 난이도별 프롬프트 (인지수준/함정/선지전략/형식)
   │   [6] 교수 스타일 컨텍스트 (발문패턴/오답전략/주제비중)
   │   [7] 챕터 반복 횟수 가이드 (0회 핵심 → 1회 보충 → 2회 다른관점 → 3+ 확장)
   │   [8] 챕터 인덱스 (shared/courseChapters.json)
   │   [9] Scope (HARD: 인접 챕터 별도 섹션 — 오답 선지 검증용)
   │   [10] 이미지 섹션 (크롭본 figureId 매핑 + 페이지 이미지 inlineData)
   ├── 토큰 관리: easy 3000 / medium 5000 / hard 7000
   ├── JSON 모드 강제 (responseMimeType: "application/json")
   └── Truncated JSON 복구 (MAX_TOKENS 시 부분 파싱)

4. 후처리
   ├── 문제 수 부족 시 자동 보충 (최대 2회, 매 시도 chapterRepetition 증가)
   ├── 챕터 ID 유효성 검증 (courseIndex 기반)
   ├── Material Cache 저장 (비동기)
   └── 사용 로그 기록 (styledQuizUsage/{userId}/daily/{날짜})
```

### 교수 스타일 프로필 (professorQuizAnalysis)

교수의 기존 퀴즈를 Gemini로 분석하여 출제 패턴을 학습:

```
professorQuizAnalysis/{courseId}/data/
  ├─ styleProfile: { questionPatterns, distractorStrategies, topicEmphasis, difficultyTypeMap }
  ├─ keywords: { coreTerms, examTopics }
  └─ questionBank: { questions[8] } (발문+선지+정답 샘플)
```

### HARD 난이도 특수 처리

- **이미지 크롭**: Gemini Vision으로 문제 영역 분석 → jimp로 자동 크롭 → 크롭본만 전송 (토큰 절약)
- **복수정답**: `answer: [0, 2]` 배열
- **부정형**: "옳지 않은 것" 30% 비율
- **교차 챕터 함정**: 인접 챕터 유사 개념으로 오답 선지 구성

### AI 퀴즈 생성 플로우 (학생/교수 통합)

```
AIQuizContainer 플로팅 버튼 → AIQuizModal (PDF/PPTX/이미지 업로드)
  → 태그+난이도+문제수+프롬프트(선택) 설정 → enqueueGenerationJob
  → 실시간 진행률 (onSnapshot) → 완료
  → 서재에서 Details/Preview/편집/공개전환/삭제
  → 공개 전환 시 participantCount: 0, reviews batch 쓰기
  → ReviewPractice 연습 모드 진입 → 결과 저장
  → 백그라운드 생성: 다른 페이지 이동해도 계속 (LibraryJobManager)
```

### 학생 커스텀 퀴즈 생성

```
/quiz/create → QuestionEditor (2437줄, 6종 보기타입)
  → 문제 편집: OX/객관식(2~8선지)/단답/서술/결합형
  → 이미지 첨부 (Firebase Storage)
  → 공개/비공개 선택 → Firestore 저장
  → 공개 퀴즈: 다른 학생도 풀기 가능
```

## 복습 시스템

### 5가지 필터 탭 (/review)

| 탭 | 내용 | 데이터 |
|----|------|--------|
| 서재 | 공개 퀴즈 목록 (다른 학생 것 포함) | quizzes |
| 풀었던 것 | 내가 푼 모든 문제 | reviews (solved) |
| 오답 | 틀린 문제만 | reviews (wrong) |
| 찜 | 북마크한 문제 | reviews (bookmarked) |
| 폴더 | 사용자 정의 폴더 | customFolders |

### ReviewPractice 3단계 플로우 (2572줄)

1. **문제 풀이** — 선택지 클릭 → 즉시 정답/오답 표시 + 선지별 해설
2. **자동 채점** — gradeQuestion 유틸리티
3. **결과 저장** — 첫 복습 점수 기록 + EXP (recordReviewPractice CF)

### 폴더 시스템

- 생성/삭제/이름변경
- 문제 추가 (드래그앤드롭)
- 카테고리 분류 + 순서 설정
- **PDF 내보내기**: 폴더 선택 → 전체 문제 PDF 합본 (`questionPdfExport`)

## 퀴즈 시스템

### 퀴즈 카테고리

| 카테고리 | 생성자 | 설명 |
|---------|--------|------|
| midterm / final | 교수 | 시험 기출 |
| past | 교수 | 기출문제 (년도/학기별) |
| independent | 교수 | 독립 퀴즈 |
| custom | 학생 | 학생 자작 |
| ai-generated | 학생/교수 | AI 서재 (비공개→공개 전환 가능) |

### 문제 유형 (`QuestionType`)

| 유형 | 답안 형식 | 비고 |
|------|----------|------|
| OX | 'O' \| 'X' | |
| 객관식 | number (0-indexed), 복수정답: number[] | 2~8개 선지 |
| 단답형 | string, 복수정답: `\|\|\|` 구분 | case-insensitive |
| 서술형 | 수동 채점 (교수 전용) | 문제 타입만 존재, AI 채점 기능 제거됨 |
| 결합형 | 공통 지문/이미지 + 하위 N문제 | N문제 = N점 |

**answer 인덱싱**: **모두 0-indexed** (통일됨)

### 퀴즈 풀이 → 결과 플로우

```
/quiz/[id] 풀이 (로컬 state에 답안 저장)
  → 제출 → recordAttempt CF (서버 채점 + 분산 쓰기)
  → /quiz/[id]/result (점수 + 문제별 정답/오답)
  → /quiz/[id]/feedback (피드백 작성)
  → /quiz/[id]/exp (EXP 보상 연출)
```

### recordAttempt 보안 4중 방어

1. 클라이언트 `useRef` guard (React StrictMode 중복 호출 방지)
2. 서버 `quiz_submit_locks` 트랜잭션 (60초 TTL, 동시 제출 차단)
3. `rateLimitV2` (분당 3회)
4. `quiz_completions` 체크 (이미 완료된 퀴즈 재진입 방지)
5. `attemptKey` idempotency (동일 제출 → 캐시된 결과 반환)

### 분산 쓰기 (recordAttempt)

- `quizResults` (append-only log)
- `quiz_completions/{quizId}_{userId}` (merge)
- `quiz_agg/{quizId}/shards/{N}` (10개 분산 카운터)
- `users/{uid}.quizStats` (증분 갱신, 트랜잭션)
- 비동기: `quizzes/{quizId}` participantCount/averageScore 갱신

## 게시판 시스템

### 게시글/댓글

- 태그: 학사, 학술, 기타
- 이미지 첨부 (Firebase Storage, 복수)
- 좋아요 / 댓글 수 카운트
- 루트 댓글 + 대댓글 (parentId 기반)

### AI 자동답변 (콩콩이)

학술 태그 게시글 작성 시 **Gemini 2.5 Flash** 기반 자동 댓글:
- `onPostCreate` CF → 학술 태그 확인 → 이미지 base64 변환 → courseScopes 키워드 로드 → Gemini 호출
- `authorId: 'gemini-ai'`, `authorNickname: '콩콩이'`, `isAIReply: true`
- 대댓글 자동 응답 (콩콩이에게 대댓글 → AI 자동 대댓글, 스팸 방지 2분 내 1회)
- 말투: 친절한 반말체, 이모지 절대 금지

### 댓글 채택

글 작성자가 루트 댓글 1개 채택 → 채택자에게 30 EXP + 알림.
본인/AI 불가, 글당 1회만.

## 공지사항 시스템

교수 전용 공지 채널 (`AnnouncementChannel`):
- 텍스트/이미지/투표(poll) 첨부 공지 작성
- 학생 리액션 (이모지)
- 읽음 처리 (`markAnnouncementsRead`)
- 실시간 구독 (onSnapshot)

## 게이미피케이션

### EXP 보상 체계

**단일 소스**: `shared/expRewards.json`

| 활동 | EXP | CF |
|------|-----|-----|
| 퀴즈 만점 (100%) | 50 | onQuizComplete |
| 퀴즈 90%+ | 40 | onQuizComplete |
| 퀴즈 70%+ | 35 | onQuizComplete |
| 퀴즈 50%+ | 30 | onQuizComplete |
| 퀴즈 50% 미만 | 25 | onQuizComplete |
| 커스텀 퀴즈 생성 | 50 | onQuizCreate |
| AI 퀴즈 저장 | 25 | onQuizCreate |
| 퀴즈 공개 전환 | 15 | onQuizMakePublic |
| 피드백 제출 | 15 | onFeedbackSubmit |
| 게시글 작성 | 15 | onPostCreate |
| 댓글 작성 | 15 | onCommentCreate |
| 댓글 채택됨 | 30 | acceptComment |
| 복습 연습 완료 | 25 | recordReviewPractice |
| 배틀 승리 | 30 (+연승×5, 최대 50) | endBattle |
| 배틀 패배/무승부 | 10 | endBattle |

**마일스톤**: 50XP마다 1 마일스톤 → `MilestoneChoiceModal` (600ms 지연) → 뽑기 or 레벨업 선택

### 토끼 시스템

**2단계 뽑기**:
1. `spinRabbitGacha` (Roll): 마일스톤 소비 → 랜덤 토끼(0~79) 선택. 이미 보유 시 마일스톤 미소비 → 바로 레벨업
2. `claimGachaRabbit` (Claim): 이름 짓기 → 영구 소유, 빈 슬롯 자동 장착

**스탯**: 80마리 고유 기본값 룩업 (`rabbitStats.ts`), HP/ATK/DEF
**장착**: 최대 2마리 (slotIndex 0|1)
**레벨업**: level+1, HP/ATK/DEF 각 1~3 랜덤 증가
**도감**: `rabbits/{courseId}_{rabbitId}`, 최초 발견자 금색 표시
**이미지**: rabbitId 0~79 → 파일명 001~080 (1-indexed)

### 철권퀴즈 (배틀 퀴즈)

실시간 1v1 토끼 배틀. **Firebase RTDB** 사용.

**플로우**: 매칭(10초, 봇 폴백) → countdown → question(30초) → 양쪽정답시 mash(연타) → roundResult → ... → finished(KO or 소진)

**매칭 아키텍처** (경합 제거):
- Per-User Write: 각 유저가 자신의 RTDB 경로에만 쓰기 → contention 0
- 매칭 락: 1명만 매처 역할 (10초 TTL 트랜잭션)
- FIFO 페어링: joinedAt 순 정렬 → 2명씩 짝

**데미지 공식**: `baseDamage = max(ceil(ATK²/(ATK+DEF)×1.5), 2)`
- 크리티컬(5초 이내): ×1.5
- 양쪽 오답: MUTUAL_DAMAGE = 10

**봇**: 40% 정답률, 1~8초 응답, 10개 닉네임 풀, 레벨은 유저 토끼 레벨 기반 동적 산정 (+3 오프셋)

**문제 풀**: Cloud Run 워커가 매일 03:00 KST 과목당 300문제 생성 (easy 150 + medium 150)
- 무중단 교체: 새 풀 100% 완료 후 기존 풀 삭제
- 해설 필수 필터링 + seenQuestions 24시간 중복 방지

### 랭킹 시스템

**개인 점수**: `profCorrectCount × 4 + totalExp × 0.6` (10분마다 사전 계산)
**팀 점수**: `normalizedAvgExp × 0.4 + avgCorrectRate × 0.4 + avgCompletionRate × 0.2`
동점 처리: 같은 순위 (1위, 1위, 3위)

## 교수 통계 대시보드

### 5축 레이더 차트 (10분마다 사전 계산, `computeRadarNormScheduled`)

| 축 | 이름 | 계산 | 스케일 |
|----|------|------|--------|
| 1 | 퀴즈 | 교수 퀴즈 평균 점수 (첫 시도만, PROF_TYPES 필터) | 원점수 0~100 |
| 2 | 활동량 | totalExp | 백분위 |
| 3 | 배틀 | 배틀 참여수 `tekkenTotal` (봇 포함) | 백분위 |
| 4 | 소통 | 게시글×3 + 댓글×2 + 피드백 | 백분위 |
| 5 | 출제력 | 학생이 만든 퀴즈 수 (AI 생성 + 커스텀) | 백분위 |

### 교수 통계 페이지 UI

- **필터**: 교수님 퀴즈 고정 (SourceFilter 삭제됨)
- **반별 비교**: "성적 비교" (평균 ± SD 막대) / "참여도 비교" (EXP 박스플롯) 토글
- **반별 종합 역량**: 삭제됨 (ClassProfileRadar)
- **안정성 지표**: 삭제됨 (StabilityIndex)
- **챕터 분석**: 레이더 차트 + 드롭다운 (전체/챕터별)

### 학생 분석

- **위험 학생**: Z-score < -1.5 → 주의, < -2 → 위험 (교수 퀴즈 평균 점수 기반)
- **4군집**: `quizStats.averageScore` + `totalExp` 기반, 동적 medianRate/medianExp
  - passionate (EXP↑성적↑), hardworking (EXP↑성적↓), efficient (EXP↓성적↑), atRisk (EXP↓성적↓)
  - `highExp`: totalExp >= medianExp **&& > 0**, `highRate`: correctRate >= medianRate **&& > 0**
  - EXP=0 또는 성적=0인 학생은 자동으로 이탈 위험군
- **변별도**: 상위 27% - 하위 27% 정답률 (참여 ≥4명)

### 월별 리포트 (generateMonthlyReport)

- **Claude Sonnet-4**로 주별 통계 기반 인사이트 생성
- **Excel 내보내기**: 요약/퀴즈/학생/게시판/인사이트 시트
- **Word 내보내기**: 타이틀 + 통계 요약 + Claude 마크다운 변환

## 아키텍처

### 라우트 구조 (42개 페이지)

```
/(auth)                          — 로그인/회원가입/비밀번호찾기
/(main)
  ├── /                          — 홈 (캐릭터+EXP+랭킹+공지)
  ├── /quiz                      — 퀴즈 목록 (midterm/final/past/custom)
  │   ├── /create                — 커스텀 퀴즈 생성 (6종 문제 편집기)
  │   └── /[id]                  — 풀기 → /result → /feedback → /exp → /edit
  ├── /review                    — 복습 (5필터 + 폴더)
  │   ├── /random                — 랜덤 복습
  │   └── /[type]/[id]           — 복습 상세/편집
  ├── /board                     — 게시판 (학사/학술/기타)
  │   ├── /write                 — 글쓰기
  │   ├── /[id]                  — 상세 → /edit
  │   └── /manage                — 관리
  ├── /professor                 — 교수 홈
  │   ├── /stats                 — 통계 대시보드 (레이더+군집+리포트)
  │   ├── /students              — 학생 관리 (등록/초기화/삭제)
  │   └── /quiz                  — 퀴즈 관리
  │       ├── /create            — 출제
  │       └── /[id]/preview      — 미리보기 (정답률/변별도/재채점)
  ├── /ranking                   — 전체 랭킹
  ├── /settings                  — 설정 (비밀번호/복구이메일/알림)
  └── /profile                   — 프로필
/api/cache/rankings              — CDN 캐시 (s-maxage=300)
/api/cache/radar                 — CDN 캐시 (s-maxage=300)
```

### Provider 계층

```
MainLayout (useRequireAuth → 미인증 시 /login)
  └── UserProvider (users/{uid} 실시간 구독 via userRepo)
      └── CourseProvider (settings/semester + courses 구독 via settingsRepo)
          └── ThemeProvider (반별 CSS 변수)
              └── NotificationProvider + ExpToastProvider
                  └── MilestoneWrapper (학생만)
                      └── HomeOverlayProvider
                          └── DetailPanelProvider (가로모드 우측 패널)
                              └── SwipeBack + Navigation + children
```

### 데이터 추상화 레이어

```
소비자 (hooks/components/pages)
  ↓
lib/api/callFunction()          ← Cloud Functions 타입 안전 래퍼
lib/repositories/               ← Firestore/RTDB/Storage 추상화
  ├── firebase/firestoreBase.ts ← 유일한 firebase/firestore import
  ├── firebase/userRepo.ts      ← 도메인별 Repository (11개)
  ├── firebase/quizRepo.ts
  ├── firebase/battleRepo.ts    ← RTDB 추상화
  └── ...
lib/subscriptions/              ← 구독 참조 카운팅
  ├── SubscriptionManager.ts    ← 같은 key → 실제 onSnapshot 1개만
  └── useSubscription.ts        ← React 훅 어댑터
```

### 상태 관리

- **전역**: React Context 6개 (User, Course, Theme, HomeOverlay, Milestone, DetailPanel)
- **서버 데이터**: onSnapshot 실시간 동기화 (커스텀 훅)
- **인증**: Firebase `onAuthStateChanged` → `useAuth()`
- **캐시**: sessionStorage SWR (랭킹/레이더 5분), 모듈 Map (교수 통계 5분)
- **오프라인**: Firestore `persistentLocalCache` + `persistentMultipleTabManager`

### Firestore 컬렉션 구조

| 컬렉션 | 용도 | 쓰기 |
|--------|------|------|
| `users/{uid}` | 프로필, EXP, 토끼 | 클라이언트(일부)+CF |
| `users/{uid}/expHistory` | EXP 지급 기록 | CF 전용 |
| `users/{uid}/rabbitHoldings` | 토끼 보유 | CF 전용 |
| `quizzes/{id}` | 퀴즈 데이터 + 문제 | 클라이언트+CF |
| `quizResults/{id}` | 제출 결과 (append-only) | CF 전용 |
| `quiz_completions/{quizId}_{userId}` | 완료 여부 | CF 전용 |
| `quiz_agg/{quizId}/shards/{N}` | 분산 카운터 | CF 전용 |
| `quiz_submit_locks/{userId}_{quizId}` | 제출 락 (60초 TTL) | CF 전용 |
| `reviews/{id}` | 오답/찜/복습 | 클라이언트+CF |
| `customFolders/{id}` | 사용자 폴더 | 클라이언트 |
| `posts/{id}` | 게시글 | 클라이언트 |
| `comments/{id}` | 댓글 | 클라이언트+CF |
| `feedbacks/{id}` | 퀴즈 피드백 | 클라이언트 |
| `jobs/{jobId}` | AI 생성 작업 | CF 전용 |
| `materials/{fingerprint}` | AI 생성 Material 캐시 (24h TTL) | CF 전용 |
| `styledQuizUsage/{uid}/daily/{날짜}` | AI 생성 사용 로그 | CF 전용 |
| `professorQuizAnalysis/{courseId}` | 교수 스타일 분석 | CF 전용 |
| `courseScopes/{courseId}` | 과목 키워드/범위 (Scope) | CF 전용 |
| `rabbits/{courseId}_{rabbitId}` | 토끼 도감 | CF 전용 |
| `rankings/{courseId}` | 랭킹 (사전계산) | CF 전용 |
| `radarNorm/{courseId}` | 레이더 (사전계산) | CF 전용 |
| `tekkenQuestionPool/{courseId}/questions` | 배틀 문제 풀 | CF 전용 |
| `settings/semester` | 학기 설정 | 교수 |
| `settings/tekken/courses/{courseId}` | 배틀 챕터 범위 | 교수 |
| `enrolledStudents/{courseId}/students` | 학번 사전 등록 | 교수 |
| `announcements/{id}` | 공지사항 | 교수 |
| `notifications/{id}` | 알림 | CF 전용 |
| `allowedProfessors/{email}` | 교수 허용 + 담당 과목 | Admin SDK 전용 |
| `courses/{courseId}` | 과목 레지스트리 | Admin SDK 전용 |

### RTDB 경로 (철권퀴즈)

| 경로 | 용도 |
|------|------|
| `tekken/matchmaking/{courseId}` | 매칭 큐 (Per-User Write) |
| `tekken/matchmaking_data/{courseId}/{userId}` | 매칭 프로필 |
| `tekken/matchResults/{userId}` | 매칭 결과 알림 |
| `tekken/battles/{battleId}` | 배틀 진행 상태 |
| `tekken/battleAnswers/{battleId}/{round}` | 정답 (보안 분리) |
| `tekken/streaks/{userId}` | 연승 기록 |

## Cloud Functions 맵

### onCall (62+)

**퀴즈**: recordAttempt, recordReviewPractice, regradeQuestions
**AI 생성**: enqueueGenerationJob, workerProcessJob, checkJobStatus, getGeminiUsage, addToGeminiQueue, checkGeminiQueueStatus, claimGeminiQueueResult, getStyleProfile, convertPptxToPdf
**OCR**: runVisionOcr, getVisionOcrUsage, runClovaOcr, getOcrUsage, analyzeImageRegionsCall
**배틀**: joinMatchmaking, matchWithBot, cancelMatchmaking, startBattleRound, submitAnswer, swapRabbit, submitMashResult, submitTimeout, tekkenPoolRefill
**토끼**: spinRabbitGacha, claimGachaRabbit, equipRabbit, unequipRabbit, levelUpRabbit
**게시판**: acceptComment, deletePost
**공지**: markAnnouncementsRead, reactToAnnouncement, voteOnPoll
**인증/계정**: registerStudent, initProfessorAccount, resetStudentPassword, deleteStudentAccount, bulkEnrollStudents, removeEnrolledStudent, requestPasswordReset, updateRecoveryEmail, submitInquiry
**리포트**: generateMonthlyReport
**기타**: refreshRankings, resetSeason

### onDocumentCreated (16)

onQuizComplete, onQuizCreate, onPostCreate, onCommentCreate, onFeedbackSubmit, generateReviewsOnResult 등

### onSchedule (13)

| CF | 주기 | 목적 |
|----|------|------|
| tekkenPoolRefillScheduled | 매일 03:00 | 과목당 300문제 |
| computeRankingsScheduled | 10분 | 개인/팀 랭킹 |
| computeRadarNormScheduled | 10분 | 5축 레이더 (퀴즈 원점수/배틀 참여수/소통/출제력/활동량) |
| collectWeeklyStatsScheduled | 매주 월 00:00 | 주별 통계 |
| retryQueuedJobs | 매 1분 | AI Job 큐 드레인 + 타임아웃 처리 |
| cleanupExpiredJobs | 매시간 | 만료 Job + Material 캐시 정리 |
| cleanupRateLimitsScheduled | 매시간 | rate limit 정리 |
| februaryTransition / augustTransition | 연 2회 | 학기 전환 |

## 과목 시스템

| 과목 ID | 이름 | 학년/학기 | 챕터 접두사 | 챕터 수 |
|---------|------|----------|-----------|---------|
| `biology` | 생물학 | 1학년 1학기 | `bio_` | 12 |
| `pathophysiology` | 병태생리학 | 1학년 2학기 | `patho_` | 11 |
| `microbiology` | 미생물학 | 2학년 1학기 | `micro_` | 11 |

- **동적 과목**: `courses/{courseId}` Firestore 컬렉션 → `CourseContext.courseRegistry` 실시간 구독
- **CourseId 타입**: `'biology' | 'pathophysiology' | 'microbiology' | (string & {})` — 자동완성 + 확장
- 학기 자동 판별: 02-22~08-21 → 1학기, 08-22~02-21 → 2학기
- 태그 형식: `"12_신경계"` (value) → `"#12_신경계"` (표시)

## 인증 시스템

**학번+비밀번호**: 학번 `20230001` → `20230001@rabbitory.internal` (Firebase Auth)
- `registerStudent` CF가 enrolledStudents 확인 후 계정 생성
- 교수: 이메일 → `initProfessorAccount` CF → `allowedProfessors/{email}` 확인
- **복구 이메일**: 학생이 설정 → 비밀번호 찾기 시 인증코드 발송
- Middleware 없음 — `useRequireAuth()` 훅으로 클라이언트 리다이렉트

### 교수 권한

- `allowedProfessors/{email}` 컬렉션 (Admin SDK 전용)
- `users/{uid}.assignedCourses` 배열 (로그인 시 동기화)
- CF에서 `verifyProfessorAccess(uid, courseId)` 검증
- 하위호환: assignedCourses 비어있으면 모든 과목 허용

## UI/UX

### 빈티지 신문 테마

- 배경 #F5F0E8(크림), 카드 #FDFBF7, 텍스트 #1A1A1A
- 테두리 #D4CFC4(밝은) / #1A1A1A(진한)
- 그림자 `box-shadow: 4px 4px 0px #1A1A1A`
- 글꼴: Noto Sans KR (본문), Playfair Display (빈티지 헤더), Cormorant Garamond (세리프)

### 반별 강조색 (`--theme-accent`)

A: #8B1A1A (버건디) / B: #B8860B (다크골드) / C: #1D5D4A (에메랄드) / D: #1E3A5F (네이비)
생물학: #2E7D32 (자연 녹색) 단일 테마

### 반응형 3패널 가로모드

```
┌──────────┬──────────────┬──────────────┐
│ 사이드바  │  메인 콘텐츠  │  디테일 패널  │
│ 240px    │              │ (라우트 기반) │
│ 블랙글래스 │              │              │
└──────────┴──────────────┴──────────────┘
```

- `useWideMode()`: landscape + 1024px 이상
- 라우트 사이드바: `/quiz/[id]/*`, `/board/[id]/*`, `/review/[type]/[id]` 자동 분할

### 네비게이션

**학생** (4탭): 홈, 퀴즈, 복습, 게시판
**교수** (5탭): 홈, 통계, 퀴즈, 학생, 게시판

### PWA / Safe Area / SwipeBack

- PWA: viewport-fit cover, standalone, skipWaiting, FCM (`worker/index.js`)
- Safe Area: `env(safe-area-inset-*)` 처리, `html { background: #F5F0E8 }`
- SwipeBack: 왼쪽 25px → `router.back()`, 35% 초과 or velocity > 500

## 캐시 전략

| 캐시 | 위치 | TTL | 용도 |
|------|------|-----|------|
| 정적 에셋 | Vercel CDN | 1년 immutable | 이미지/폰트/토끼/로티 |
| 랭킹/레이더 | Vercel Edge | 5분 s-maxage | /api/cache/* |
| 랭킹/레이더 | sessionStorage | 5분/15분 | SWR |
| 교수 통계 | 모듈 Map | 5분 | stale-while-revalidate |
| Material 캐시 | Firestore | 24시간 | AI 생성 Scope/크롭 재사용 |
| Firestore | IndexedDB | persistent | 오프라인 + 멀티탭 |

## 코딩 컨벤션

- 응답/주석/커밋/문서: 한국어
- 변수명/함수명: 영어
- 들여쓰기: 2칸
- 컴포넌트: React 함수형 + TypeScript
- 경로 별칭: `@/*` → 프로젝트 루트
- 패널/박스: `bg-[#F5F0E8]` + `border-2 border-[#1A1A1A]`

## Firestore Security Rules 보호 필드

`totalExp`, `rank`, `role`, `badges`, `equippedRabbits`, `totalCorrect`, `totalAttemptedQuestions`, `professorQuizzesCompleted`, `lastGachaExp`, `spinLock` — Cloud Functions에서만 수정 가능

## 배포

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
firebase deploy --only database       # RTDB rules
firebase deploy --only storage        # Storage rules
```

## 리팩토링 기록 (2026-03-15)

### 사문 코드 삭제
서술형 AI 채점 (`EssayGrading`, `essay.ts`, `scoring.ts`), 시즌/학기 관리 UI (`SeasonResetCard/Modal/HistoryList`, `SemesterSettingsCard`), 미사용 훅 (`useOcr`, `useClovaOcr`, `useVisionOcr`, `useScrollLock`, `useSeasonReset`), 미사용 유틸 (`offlineReviewCache`, `questionDocExport`, `koreanStopwords`), Tesseract OCR 엔진 (340줄) 삭제.
OCR 기능은 `OCRProcessor.tsx`에서 `callFunction()` 직접 호출로 동작.

### 대형 파일 분리

| 원본 파일 | 추출 대상 | 줄 감소 |
|-----------|-----------|---------|
| `professor/quiz/page.tsx` | `profQuizSubComponents.tsx` (7개 서브 컴포넌트) | 2316→1397 |
| `board/manage/page.tsx` | `boardManageSections.tsx` (AcademicArchive+Activity) | 1635→458 |
| `quiz/feedback/page.tsx` | `feedbackQuestionCards.tsx` (문제 카드 2개) | 1574→728 |
| `review/page.tsx` | `useFolderCategories`, `useCompletedQuizzes` 훅 | 3271→3008 |
| `useReview.ts` | `useReviewUpdateCheck` 훅 | 1507→1341 |
| `useBoard.ts` | `useBoardLike` (좋아요 3개 훅) | 1403→1195 |
| `lib/ocr.ts` | Tesseract 사문코드 삭제 | 2027→1692 |
| `quiz/create/page.tsx` | `quizImageUpload.ts` 유틸 (교수 생성도 공유) | 2099→1946 |

### Firebase SDK 누출 수정
`ProfileDrawer.tsx` (firebase/auth → `lib/auth.ts` 래퍼), `quiz/create` 2개 (firebase/storage → `storageRepo.upload`). 잔여 2파일(`useTekkenBattle` RTDB, `useStorage` Storage)은 정당한 추상화 레이어.

### 성능 최적화

| 병목 | 해결 | 파일 |
|------|------|------|
| 순차 deleteDoc 루프 (50-100회 왕복) | `writeBatch` 일괄 삭제 (1회) | `useReview.ts` |
| 순차 addDoc 루프 (복원) | `writeBatch` 일괄 추가 | `useReview.ts` |
| 배치 간 순차 대기 (댓글 제목 로드) | 전체 `Promise.all` 병렬 | `useBoard.ts` |
| `deleteSolvedQuiz` 쿼리 순차 | `Promise.all` 병렬 조회 | `useReview.ts` |
| `layout.tsx` 불필요한 useState | `profile.classType` 직접 파생 | `layout.tsx` |

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
