# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

대학 수업 보조 앱 **"RabbiTory"**. 퀴즈 + 게시판 기능에 토끼 컨셉 게이미피케이션을 적용한 PWA.
학생은 퀴즈를 풀고 피드백을 남기며, 교수님은 문제에 대한 피드백을 수집하고 학생 참여도를 모니터링.

## 기술 스택

### 프론트엔드
- **Next.js** 16.1.6 (App Router, Turbopack)
- **React** 19 + **TypeScript** 5
- **Tailwind CSS** 3
- **Framer Motion** 11 (페이지 전환, UI 애니메이션)
- **Lottie React** 2.4 (퀴즈 결과 연출)
- **next-pwa** 5.6 (PWA 서비스 워커)
- **react-window** 2.2.7 (가상 스크롤)
- **react-d3-cloud** 1.0.6 (단어 클라우드)

### 문서/파일 처리
- **Tesseract.js** 5.0.4 (클라이언트 OCR)
- **pdfjs-dist** 4.0.379 (PDF 렌더링)
- **exceljs** 4.4 (Excel 리포트) / **docx** 9.5.3 (Word 리포트)
- **file-saver** 2.0.5 / **jszip** 3.10.1 / **date-fns** 3.0

### Backend (Firebase)
- **Firebase** 10.7 — Auth, Firestore, Realtime Database, Cloud Functions, Cloud Messaging, Storage
- **firebase-functions** 5.0 + **firebase-admin** 12.0 (Node 20)
- **@google-cloud/vision** 4.3.2 (Gemini Vision OCR)
- **jimp** 0.22.12 (서버사이드 이미지 크롭)
- **nodemailer** 6.9.8 / **node-fetch** 2.7 / **google-auth-library** 9.6

### AI
- **Gemini API** (gemini-2.5-flash) — AI 문제 생성, 이미지 분석, 철권퀴즈 문제
- **Claude API** (claude-sonnet-4-20250514) — 월별 리포트 인사이트

### 배포
- **Vercel** — 프론트엔드 (PWA 자동 등록)
- **Firebase** — Cloud Functions, Firestore, RTDB, Storage
- **Cloud Run** — PPTX→PDF 변환 서비스

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
- tsconfig가 프론트보다 엄격: `noUnusedLocals`, `noImplicitReturns`, `strict`
- **테스트 프레임워크 없음**: Jest/Vitest/Playwright 미설정, 수동 테스트 기반

## 아키텍처

### Provider 계층 구조

`app/(main)/layout.tsx`:

```
MainLayout (useRequireAuth → 미인증 시 /login 리다이렉트)
  └── UserProvider (Firestore /users/{uid} 실시간 구독)
      └── CourseProvider (/settings/semester 구독)
          └── ThemeProvider (반별 CSS 변수 적용)
              └── NotificationProvider + ExpToastProvider
                  └── MilestoneWrapper (학생만 — MilestoneProvider)
                      └── HomeOverlayProvider
                          └── SwipeBack + Navigation + children
```

### 상태 관리 패턴

- **전역 상태**: React Context (User, Course, Theme, HomeOverlay, Milestone) — Redux/Zustand 미사용
- **서버 데이터**: Firestore `onSnapshot`으로 실시간 동기화 (커스텀 훅)
- **로컬 상태**: 컴포넌트 `useState`/`useReducer`
- **인증 상태**: Firebase `onAuthStateChanged` → `useAuth()` 훅
- **캐시**: sessionStorage SWR (랭킹 2분/10분 TTL, 레이더 정규화 2분/10분 TTL)

### 주요 대형 파일 (수정 시 주의)

- `app/(main)/review/page.tsx` — 복습 목록 페이지
- `app/(main)/quiz/page.tsx` — 학생 퀴즈 목록
- `app/(main)/review/[type]/[id]/page.tsx` — 복습 상세 페이지
- `components/review/ReviewPractice.tsx` — 복습 연습 모드
- `components/quiz/create/QuestionEditor.tsx` — 문제 편집기 (풀 에디터)
- `app/(main)/professor/quiz/page.tsx` — 교수 퀴즈 관리
- `components/quiz/manage/QuizStatsModal.tsx` — 퀴즈 통계 모달
- `functions/src/styledQuizGenerator.ts` — AI 스타일 문제 생성
- `components/common/ProfileDrawer.tsx` — 프로필 드로어
- `lib/hooks/useReview.ts` — 복습 데이터 훅
- `lib/hooks/useBoard.ts` — 게시판 데이터 훅

## 주요 기능 상세

### 퀴즈 시스템

**문제 유형** (`QuestionType`): `'ox' | 'multiple' | 'short_answer' | 'essay' | 'combined'`

| 유형 | 답안 형식 | 비고 |
|------|----------|------|
| OX | 0\|1 | |
| 객관식 | number (0-indexed), 복수정답: number[] | 2~8개 선지 |
| 단답형 | string, 복수정답: `\|\|\|` 구분 | |
| 서술형 | 수동 루브릭 채점 (EssayGrading.tsx) | 교수 전용 |
| 결합형 | 공통 지문/이미지 + 하위 N문제 (OX/객관식/단답) | N문제 = N점 |

**answer 인덱싱**: **모두 0-indexed** (통일됨)

**퀴즈 풀이 → 결과 플로우**:
1. `/quiz/[id]` 풀이 (로컬 state에 답안 저장)
2. 제출 → CF `recordAttempt` (서버사이드 채점 + 분산 쓰기)
3. `/quiz/[id]/result` 결과 → `/quiz/[id]/feedback` 피드백 → EXP 지급

**서버 EXP 보상** (Cloud Functions 기준):

| 활동 | EXP | CF |
|------|-----|-----|
| 퀴즈 만점 (100%) | 50 | onQuizComplete |
| 퀴즈 90%+ | 40 | onQuizComplete |
| 퀴즈 70%+ | 35 | onQuizComplete |
| 퀴즈 50%+ | 30 | onQuizComplete |
| 퀴즈 50% 미만 | 25 | onQuizComplete |
| 커스텀 퀴즈 생성 | 50 | onQuizCreate |
| AI 퀴즈 저장 (비공개) | 25 | onQuizCreate |
| 퀴즈 공개 전환 | 15 | onQuizMakePublic |
| 피드백 제출 | 15 | onFeedbackSubmit |
| 게시글 작성 | 15 | onPostCreate |
| 댓글 작성 | 15 | onCommentCreate |
| 댓글 채택됨 | 30 | acceptComment |
| 복습 연습 완료 | 25 | recordReviewPractice |
| 배틀 승리 | 30 (+연승 ×5, 보너스 최대 20, 총합 최대 50) | submitAnswer |
| 배틀 패배 | 10 | submitAnswer |

**피드백 점수**: praise(+2), wantmore(+1), other(0), typo(-1), unclear(-1), wrong(-2)

**마일스톤**: 50XP마다 1 마일스톤 → `MilestoneChoiceModal` 자동 표시 → 뽑기 or 레벨업 선택

### 게시판 AI 자동답변 (콩콩이)

학술 태그(`tag === '학술'`) 게시글 작성 시 콩콩이(Gemini 2.5 Flash)가 자동으로 댓글을 생성.

**플로우**: `onPostCreate` CF → 학술 태그 확인 → 이미지 있으면 base64 변환 → 과목 키워드(`courseScopes`) 로드 → Gemini API 호출 → `comments` 컬렉션에 저장 + `commentCount` 증가

**대댓글 자동 응답**: 사용자가 콩콩이 댓글에 대댓글 → `onCommentCreate` CF가 감지 → 원본 글 + 이전 대화 맥락 포함 Gemini 호출 → 대댓글 자동 응답 (스팸 방지: 같은 부모에 2분 내 AI 대댓글 제한)

**콩콩이 말투**: 20대 한국 여자 반말, 이모지/이모티콘 절대 금지, `maxOutputTokens: 2048`

**AI 댓글 데이터**:
- `authorId: 'gemini-ai'`, `authorNickname: '콩콩이'`, `isAIReply: true`
- `onCommentCreate`에서 `authorId === 'gemini-ai'`이면 EXP 지급 + 알림 스킵

### 게시판 댓글 채택

글 작성자가 댓글 중 하나를 채택. 루트 댓글만 가능, 본인/AI 댓글 불가, 글당 1회만.
`acceptComment` onCall CF → 트랜잭션 → 채택자에게 30 EXP + 알림.
UI: 상세 페이지 댓글 상단에 `border-[3px] #1A1A1A` 박스로 표시.

### 게시글 삭제

`deletePost` onCall CF로 처리 (Admin SDK). 서버에서 글 + 모든 댓글을 배치 삭제.

### AI 문제 생성 시스템

**교수 서재 플로우** (ProfessorLibraryTab → workerProcessJob):
1. 프롬프트 입력 + 슬라이더 조정 + **챕터 태그 필수 선택**
2. `enqueueGenerationJob` CF → `jobs/{jobId}` (status: QUEUED)
3. `workerProcessJob` 자동 트리거 (동시 최대 20)
4. styleProfile + scope + focusGuide 병렬 로드 → Gemini API 호출
5. HARD 난이도: Gemini Vision 영역 분석 + 이미지 자동 크롭
6. 완료 → LibraryJobToast 표시 (다른 페이지에서도)

**학생 AI 퀴즈**: AIQuizContainer 플로팅 버튼 → 태그 선택 → 같은 CF 호출

**서재 퀴즈 수정 모드** (ProfessorLibraryTab):
- `convertToQuestionDataList` → `flattenQuestionsForSave` 라운드트립 (0-indexed 통일)
- `...(originalQ || {})` spread로 `choiceExplanations` 등 미편집 필드 보존
- Firestore `undefined` 값 strip 처리 (저장 직전)

**교수 퀴즈 페이지 디폴트 탭**: `'library'`(서재) — sessionStorage로 탭 상태 유지

### 토끼 시스템

**2단계 뽑기**:
1. `spinRabbitGacha` (Roll): 50XP 마일스톤 → 랜덤 토끼(0~79) 선택, pendingSpin 저장
2. `claimGachaRabbit` (Claim): 발견(이름 짓기, 영구 소유)

**장착**: 최대 2마리 (`equipRabbit` slotIndex 0|1), 뽑기 시 빈 슬롯 자동 장착
**기본 토끼 (#0)**: 온보딩 완료 시 자동 지급
**레벨업**: `levelUpRabbit` CF → level+1, HP/ATK/DEF 각 1~3 랜덤 증가
**도감**: 최초 발견자(부모, 금색) 표시

**rabbitId ↔ 파일명**: rabbitId 0~79 (0-indexed), 파일명 001~080 (1-indexed)
- `getRabbitImageSrc(rabbitId)` → `/rabbit/rabbit-{id+1}.png`
- `getRabbitProfileUrl(rabbitId)` → `/rabbit_profile/rabbit-{id+1}-pf.png`

### 철권퀴즈 (배틀 퀴즈)

실시간 1v1 토끼 배틀. **Firebase Realtime Database** 사용.

**플로우**: 매칭(30초, 봇 폴백) → countdown(3-2-1) → question(20초) → mash(연타 게이지) → roundResult → ... → finished(KO or 문제 소진)

**데미지 공식**: `baseDamage = max(ceil(ATK²/(ATK+DEF)×1.5), 2)`
- 크리티컬(5초 이내 정답): baseDamage × 1.5
- 양쪽 모두 오답: MUTUAL_DAMAGE = 10 (양쪽 동시 피해)

**봇**: 40% 정답률, 1~8초 응답 시간, 10개 닉네임 풀, 레벨 3~7

**난이도 배분**: 10문제 = easy 5 + medium 5 (hard 제거)
- easy: 4지선다, medium: 5지선다

**문제 풀**: 매일 새벽 3시 → 현재 학기 과목만 과목당 300문제 보충 (easy 150 + medium 150)
- 1학기: biology + microbiology, 2학기: biology + pathophysiology
- seenQuestions로 24시간 중복 방지

**챕터 범위 설정**: Firestore `settings/tekken/courses/{courseId}` → `{ chapters: string[] }`
- 기본값: biology `1~6`, microbiology `1~11`, pathophysiology `3~11`(6 제외)

**교수 스타일 반영**: `professorQuizAnalysis/{courseId}/data/`의 styleProfile + keywords를 프롬프트에 주입

## 교수 통계 시스템

### 6축 레이더 차트 — `computeRadarNorm.ts` (10분마다 사전 계산)

| 축 | 이름 | 계산 방식 | 스케일 |
|----|------|----------|--------|
| 1 | 가중 석차 | 교수 퀴즈 석차 기반 가중 평균 | 절대값 0~100 |
| 2 | 성장세 | 재시도 개선율 평균 → 0~100 변환 | 절대값 0~100 |
| 3 | 출제력 | 학생이 만든 커스텀 퀴즈 수 | 백분위 |
| 4 | 소통 | (게시글 수 × 3) + 피드백 수 | 백분위 |
| 5 | 복습력 | reviews의 reviewCount 합계 | 백분위 |
| 6 | 활동량 | users.totalExp (누적 EXP) | 백분위 |

**가중 석차**: 참여자 < 5명 → 실제 점수, ≥ 5명 → `((참여자수 - 석차 + 1) / 참여자수) × 100`. 가중치: 교수 퀴즈 = 6, 학생 커스텀 = 4.

**성장세**: (최고 재시도 점수 - 첫 시도 점수) 평균. 첫 시도 90%+ & 미재시도 → 0, 첫 시도 < 90% & 미재시도 → 스킵. `growth = max(0, min(100, 50 + avgImprovement / 2))`.

**백분위**: `(value보다 작은 개수) / (배열.length - 1) × 100`. 모든 값 동일 + value > 0 → 50%, value = 0 → 0%.

### 랭킹 — `computeRankings.ts` (10분마다 사전 계산)

**개인**: `profCorrectCount × 4 + totalExp × 0.6`
**팀**: `normalizedAvgExp × 0.4 + avgCorrectRate × 0.4 + avgCompletionRate × 0.2`
동점 처리: 같은 순위 부여 (1위, 1위, 3위)

**테스트 계정 배제**: 랭킹 계산에서만 제외
- biology: 닉네임 "빠샤" / microbiology: 닉네임 "test"

### 교수 통계 대시보드 — `professor/stats/page.tsx`

**위험 학생**: Z-score < -1.5 → 주의, < -2 → 위험

**학생 군집** (medianExp 기준, 정답률 50% 기준):
- passionate (EXP↑ 정답률↑), hardworking (EXP↑ 정답률↓), efficient (EXP↓ 정답률↑), atRisk (EXP↓ 정답률↓)

**변별도**: 참여자 ≥ 4명, 상위 27% 정답률 - 하위 27% 정답률

### 주별/월별 수집

- **주별** (`weeklyStats.ts`): 매주 월요일 00:00 KST, 퀴즈/피드백/학생/게시판 통계
- **월별 리포트**: 교수 수동 트리거 → Claude Sonnet → 인사이트 마크다운 → Excel/Word 다운로드

### 캐시 전략

| 캐시 | 위치 | TTL | 패턴 |
|------|------|-----|------|
| 랭킹 | sessionStorage | 2분 fresh / 10분 max | SWR |
| 레이더 정규화 | sessionStorage | 2분 fresh / 10분 max | SWR |
| 교수 통계 | 모듈 Map | 5분 | stale-while-revalidate |

## UI 테마 시스템

### 빈티지 신문 스타일 (공통)
- 배경 #F5F0E8(크림), 보조 #EBE5D9, 카드 #FDFBF7
- 텍스트 #1A1A1A, 음소거 #5C5C5C
- 테두리 #D4CFC4(밝은) / #1A1A1A(진한)

### 반별 강조색 (CSS 변수 `--theme-accent`)
| 반 | accent | accentLight |
|---|--------|-------------|
| A | #8B1A1A (버건디) | #D4A5A5 |
| B | #B8860B (다크 골드) | #E8D5A3 |
| C | #1D5D4A (에메랄드) | #A8D4C5 |
| D | #1E3A5F (네이비) | #A8C4E0 |

**생물학**: `courseId === 'biology'`이면 `accent: #2E7D32` (자연 녹색) 단일 테마

### 글꼴
- **Noto Sans KR** — 본문 (한글)
- **Playfair Display** — 빈티지 헤더 (`.font-serif-display`, `.btn-vintage`)
- **Cormorant Garamond** — 우아한 세리프 (`.font-serif-elegant`)

## 반응형 레이아웃

### 3패널 가로모드 레이아웃 (landscape + 1024px 이상)

```
┌──────────┬─────────────────┬──────────────────┐
│ 사이드바  │   메인 콘텐츠    │   디테일 패널     │
│ (프로필   │  (iPhone SE     │  (모달/바텀시트   │
│  + 네비)  │   동일 배치)     │   가 여기 표시)   │
│  블랙    │                 │                  │
│  글래스   │                 │                  │
└──────────┴─────────────────┴──────────────────┘
```

- `useWideMode()` — 가로모드 감지 (100ms 디바운스)
- Tailwind: `wide: { raw: '(orientation: landscape) and (min-width: 1024px)' }`

### 네비게이션

**학생** (4탭): `/`(홈), `/quiz`, `/review`, `/board`
**교수** (5탭): `/professor`, `/professor/stats`, `/professor/quiz`, `/professor/students`, `/board`

**숨김 구현**: `useHideNav` (Set 기반), MutationObserver + 5초 주기 health check

## Safe Area 처리

- `html { background-color: #F5F0E8 }` — 아이폰 둥근 모서리 뒤 배경
- **상단**: `data-main-content`에 `paddingTop: env(safe-area-inset-top)`
- 각 페이지 헤더: `marginTop: -env(safe-area-inset-top)` + `paddingTop: env(safe-area-inset-top)` 패턴
- **하단**: Navigation `<nav>`에 `paddingBottom: env(safe-area-inset-bottom)`
- 콘텐츠: `paddingBottom: calc(4.25rem + env(safe-area-inset-bottom))`

## SwipeBack (뒤로가기 스와이프)

- `SwipeBack.tsx` — 왼쪽 25px 가장자리 오른쪽 스와이프 → `router.replace(getParentPath())`
- 트리거: 화면 폭 35% 초과 또는 velocity > 500
- 홈/교수홈/가로모드에서 비활성화

## 과목 시스템

| 과목 ID | 이름 | 학년/학기 |
|---------|------|----------|
| `biology` | 생물학 | 1학년 1학기 |
| `pathophysiology` | 병태생리학 | 1학년 2학기 |
| `microbiology` | 미생물학 | 2학년 1학기 |

- 학기 자동 판별: 02-22~08-21 → 1학기, 08-22~02-21 → 2학기

## 인증 시스템

**학번+비밀번호**: 학번 `20230001` → `20230001@rabbitory.internal` (Firebase Auth)
- 교수 사전 등록(`enrolledStudents`)된 학번만 가입 가능
- 학번당 1개 계정만 (isRegistered 플래그)

## 코딩 컨벤션

- 응답/주석/커밋/문서: 한국어
- 변수명/함수명: 영어
- 들여쓰기: 2칸
- 컴포넌트: React 함수형 + TypeScript
- 경로 별칭: `@/*` → 프로젝트 루트
- 패널/박스/태그: `bg-[#F5F0E8]` + `border-2 border-[#1A1A1A]` 통일

## 알려진 제약

### Firestore Security Rules 보호 필드
`totalExp`, `rank`, `role`, `badges`, `equippedRabbits`, `totalCorrect`, `totalAttemptedQuestions`, `professorQuizzesCompleted`, `lastGachaExp`, `spinLock` — Cloud Functions에서만 수정 가능

### Firebase 배포 (규칙 변경 시)
```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
```

### PWA 설정
- `viewport-fit: cover` + `apple-mobile-web-app-capable: yes` + `status-bar-style: black-translucent`
- manifest `orientation: any`, `display: standalone`, `background_color: #F5F0E8`
- 프로덕션 `console.log` 자동 제거 (`compiler.removeConsole`)

### 주요 설정 파일

| 파일 | 역할 |
|------|------|
| `next.config.mjs` | Turbopack, PWA, 이미지 최적화, 번들 분석 |
| `tailwind.config.ts` | `wide:` 커스텀 스크린, 빈티지 테마 색상, 폰트 |
| `tsconfig.json` | `@/*` 경로 별칭, strict 모드 |
| `firebase.json` | Firestore/RTDB/Functions/Storage 배포 설정 |
| `functions/tsconfig.json` | CF 전용 (noUnusedLocals, noImplicitReturns 추가) |

### 환경 변수 (.env.local)

```
NEXT_PUBLIC_FIREBASE_API_KEY, AUTH_DOMAIN, PROJECT_ID, STORAGE_BUCKET,
MESSAGING_SENDER_ID, APP_ID, MEASUREMENT_ID, VAPID_KEY, DATABASE_URL
NEXT_PUBLIC_CLOUD_RUN_PPTX_URL  # Cloud Run PPTX 변환 서비스
```

## 디버깅 가이드

| 증상 | 원인 | 해결 |
|------|------|------|
| 퀴즈 제출 후 결과 안 뜸 | `recordAttempt` CF 실패 | CF 로그 확인 |
| EXP가 안 올라감 | `onQuizComplete` 트리거 미발동 | `quizResults` 문서 생성 여부 확인 |
| 토끼 뽑기 안 됨 | `lastGachaExp` 값 불일치 | users 문서의 totalExp vs lastGachaExp |
| 배틀 매칭 안 됨 | RTDB 매칭 큐 잔류 | RTDB Console → tekken/matchmaking |
| AI 문제 생성 멈춤 | Job PROCESSING 멈춤 | jobs 문서 status → FAILED로 변경 |
| 네비게이션 사라짐 | useHideNav Set 불일치 | 새로고침 (5초 health check 복구) |
| 알림 안 옴 | FCM 토큰 만료 | fcmTokens/{uid} 확인 |
| 로그인 실패 | enrolledStudents 미등록 | enrolledStudents/{courseId}/students 확인 |
