# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

대학 수업 보조 앱 "RabbiTory". 퀴즈 + 게시판 기능에 토끼 컨셉 게이미피케이션을 적용한 PWA.
학생은 퀴즈를 풀고 피드백을 남기며, 교수님은 문제에 대한 피드백을 수집하고 학생 참여도를 모니터링.

## 기술 스택

- **Frontend**: Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 3
- **애니메이션**: Framer Motion (페이지 전환, UI), Lottie (캐릭터)
- **Backend**: Firebase (Auth, Firestore, Cloud Functions, Cloud Messaging, Storage)
- **OCR**: Tesseract.js, pdfjs-dist
- **AI**: Gemini API (문제 생성, 이미지 분석), Claude API (월별 리포트 인사이트)
- **리포트 출력**: exceljs (Excel), docx (Word), file-saver
- **배포**: Vercel (PWA, next-pwa)

## 개발 명령어

```bash
npm install          # 의존성 설치
npm run dev          # 개발 서버 (Turbopack)
npm run build        # 프로덕션 빌드
npm run lint         # ESLint
npm run analyze      # 번들 분석 (ANALYZE=true)
```

### Cloud Functions

```bash
cd functions
npm run build        # TypeScript 컴파일
npm run serve        # 에뮬레이터로 로컬 테스트
npm run deploy       # Firebase 배포
npm run logs         # 로그 확인
```

- **Node 20 필수** (`engines.node: "20"`)
- tsconfig가 프론트보다 엄격: `noUnusedLocals`, `noImplicitReturns` 활성화

### 환경 변수

프론트엔드: `.env.local` 파일 (`.env.local.example` 참고)
- `NEXT_PUBLIC_FIREBASE_*` — Firebase 프로젝트 설정 (API_KEY, AUTH_DOMAIN, PROJECT_ID, STORAGE_BUCKET, MESSAGING_SENDER_ID, APP_ID, MEASUREMENT_ID)
- `NEXT_PUBLIC_FIREBASE_VAPID_KEY` — FCM 웹 푸시 인증서 키
- `NEXT_PUBLIC_NAVER_CLIENT_ID` / `NEXT_PUBLIC_NAVER_CALLBACK_URL` — 네이버 OAuth (선택)
- `NEXT_PUBLIC_PPTX_CLOUD_RUN_URL` — PPT→PDF 변환 Cloud Run 서비스 URL

Cloud Functions 시크릿:
```bash
firebase functions:secrets:set ANTHROPIC_API_KEY   # 서술형 AI 채점
firebase functions:secrets:set GEMINI_API_KEY       # AI 문제 생성
```

## 아키텍처

### 라우트 구조

```
app/
├── login/              # 소셜 로그인 (Google, Apple, Naver, 이메일)
├── signup/             # 이메일 회원가입
├── verify-email/       # 이메일 인증
├── onboarding/         # 온보딩 플로우
│   ├── student-info/   #   학적정보 입력
│   ├── character/      #   캐릭터 커스터마이징
│   ├── nickname/       #   닉네임 설정
│   └── tutorial/       #   튜토리얼
└── (main)/             # 인증 필요 라우트 그룹
    ├── page.tsx        #   홈
    ├── quiz/           #   퀴즈 목록/풀이/결과/피드백
    ├── review/         #   복습 (오답/찜/푼 문제)
    ├── board/          #   게시판 (To 교수님 / 우리들끼리)
    ├── profile/        #   프로필
    ├── settings/       #   설정
    └── professor/      #   교수님 전용 (대시보드, 학생 모니터링, 분석)
```

### Provider 계층 구조 (핵심)

`app/(main)/layout.tsx`에서 인증 + 온보딩 완료 여부를 체크한 뒤, 다음 Provider들이 중첩:

```
MainLayout (useRequireAuth → 미인증 시 /login 리다이렉트)
  └── UserProvider (Firestore /users/{uid} 실시간 구독)
      └── CourseProvider (/settings/semester 구독, 과목/반 정보)
          └── MainLayoutContent
              └── ThemeProvider (반별 CSS 변수 적용)
                  └── NotificationProvider + ExpToastProvider
                      ├── Navigation (특정 경로에서 숨김)
                      ├── AIQuizContainer (학생 전용, 퀴즈 페이지)
                      └── children
```

- **UserProvider** (`lib/contexts/UserContext.tsx`): 프로필, 캐릭터, 장비, 통계를 `onSnapshot`으로 실시간 구독. `useUser()` 훅으로 접근
- **CourseProvider** (`lib/contexts/CourseContext.tsx`): 학기 설정, 과목/반 정보. `useCourse()` 훅으로 접근
- **ThemeProvider** (`components/common/ThemeProvider.tsx`): 반별 테마 CSS 변수(`--theme-*`)를 `<html>`에 적용. `useTheme()` 훅으로 접근

### 상태 관리 패턴

- **전역 상태**: React Context (User, Course, Theme) — Redux/Zustand 미사용
- **서버 데이터**: Firestore `onSnapshot`으로 실시간 동기화 (커스텀 훅에서 구독)
- **로컬 상태**: 컴포넌트 내 `useState`/`useReducer`
- **인증 상태**: Firebase `onAuthStateChanged` → `useAuth()` 훅

### 주요 데이터 흐름

**퀴즈 풀이 흐름:**
1. `/quiz` 목록 → `/quiz/[id]` 풀이 (로컬 state에 답안 저장)
2. 제출 → Cloud Function `recordAttempt` 호출 (서버사이드 채점)
3. 채점 완료 → `/quiz/[id]/result` 결과 화면
4. → `/quiz/[id]/feedback` 피드백 제출 → EXP 지급 (Cloud Function)

**경험치 흐름:**
- 클라이언트에서 `totalExp`, `rank`, `role`, `badges` 직접 수정 불가
- Cloud Functions에서만 검증 후 지급 (Firestore Security Rules로 강제)
- EXP 토스트 (`ExpToast.tsx`): Firestore `onSnapshot`으로 실시간 `totalExp` 구독 → `RealtimeExpContext`로 공유. 토스트 아이템이 항상 최신 값 사용 (race condition 방지)

**복습 네비게이션:**
- 퀴즈탭 복습 버튼 → `/review/library/[id]?from=quiz` (퀴즈 풀이 `/quiz/[id]`가 아님)
- 오답만 복습 → `/review/wrong/[id]?from=quiz`

### Cloud Functions 모듈 (`functions/src/`)

| 모듈 | 역할 |
|------|------|
| `recordAttempt.ts` | 퀴즈 제출 + 서버사이드 채점 + 분산 쓰기 |
| `quiz.ts` | 퀴즈 완료 시 EXP 지급, 통계 업데이트 |
| `feedback.ts` | 피드백 저장 + EXP 지급 |
| `board.ts` | 게시판 글/댓글/좋아요 + EXP 지급 |
| `notification.ts` | FCM 푸시 알림 |
| `essay.ts` | AI 보조 채점 (deprecated — Claude는 monthlyReport로 이전) |
| `weeklyStats.ts` | 매주 월요일 퀴즈/피드백/학생/게시판 데이터 자동 수집 (Scheduled) |
| `monthlyReport.ts` | Claude Sonnet 월별 리포트 생성 (Callable, 교수 전용) |
| `styledQuizGenerator.ts` | 교수 출제 스타일 학습 → AI 문제 생성 (Gemini, sliderWeights/professorPrompt 지원) |
| `enqueueGenerationJob.ts` | AI 문제 생성 Job 큐 등록 (Callable) |
| `workerProcessJob.ts` | AI 문제 생성 백그라운드 워커 (Firestore trigger) |
| `imageRegionAnalysis.ts` | Gemini Vision 이미지 영역 감지 |
| `imageCropping.ts` | 이미지 크롭 → Firebase Storage 업로드 |
| `pptx.ts` | PPTX 업로드 → Cloud Run 트리거 |
| `rabbitGacha.ts` | 토끼 뽑기 2단계 (spinRabbitGacha → claimGachaRabbit) |
| `rabbitLevelUp.ts` | 토끼 레벨업 (levelUpRabbit) — 스탯 랜덤 증가 |
| `rabbitEquip.ts` | 토끼 장착/해제 (equipRabbit, unequipRabbit) |
| `onboardingRabbit.ts` | 온보딩 완료 시 기본 토끼(#0) 자동 지급 (Firestore trigger) |
| `migrateDefaultRabbit.ts` | 기존 유저 기본 토끼 일괄 지급 (1회성, 교수님 전용) |
| `migrateRabbitSystem.ts` | 집사→발견 모델 마이그레이션 (1회성) |
| `migrateCharacters.ts` | 레거시 캐릭터 → 토끼 시스템 마이그레이션 |
| `gemini.ts` / `geminiQueue.ts` | Gemini API 래퍼 + 큐 관리 |
| `questionParser*.ts` (v1~v4) | OCR 결과 → 문제 파싱 (다중 버전) |
| `semesterTransition.ts` | 시즌(중간→기말) 전환 로직 |
| `professorQuizAnalysis.ts` | 교수 대시보드 분석 데이터 |
| `courseScope.ts` | 과목/반 범위 쿼리 유틸 |
| `utils/shardedCounter.ts` | 분산 카운터 (동시쓰기 대응) |
| `utils/rabbitStats.ts` | 토끼 기본 스탯·레벨업 스탯 증가 계산 |
| `computeRankings.ts` | 랭킹 사전 계산 (5분 스케줄 + Callable) |
| `reviewsGenerator.ts` | 퀴즈 완료 시 복습 데이터 자동 생성 |
| `rateLimit.ts` | 도배 방지 레이트 리밋 |
| `ocr.ts` / `visionOcr.ts` | OCR 처리 (Clova, Gemini Vision) |
| `inquiry.ts` | 비로그인 문의 저장 (비밀번호 찾기 페이지) |
| `tekkenBattle.ts` | 철권퀴즈 실시간 1v1 배틀 (매칭, 라운드, 결과) |
| `tekkenCleanup.ts` | 철권퀴즈 매치 정리 (타임아웃, 비활성) |
| `utils/tekkenBot.ts` | 철권퀴즈 봇 AI 로직 |
| `utils/tekkenDamage.ts` | 철권퀴즈 데미지 계산 |

## UI 테마 시스템

### 빈티지 신문 스타일 (기본)

- **배경**: #F5F0E8 (크림), **보조 배경**: #EBE5D9, **카드**: #FDFBF7
- **텍스트**: #1A1A1A (검정), **음소거**: #5C5C5C
- **테두리**: #D4CFC4 (밝은), #1A1A1A (진한)
- **둥근 모서리 없음** (`rounded-none`)

### CSS 변수 기반 테마

ThemeProvider가 반(A/B/C/D)에 따라 `<html>`에 CSS 변수 설정:
```css
--theme-background, --theme-background-secondary
--theme-accent, --theme-accent-light
--theme-text, --theme-text-secondary, --theme-border
```

Tailwind에서 `bg-theme-background`, `text-theme-accent` 등으로 사용 (`tailwind.config.ts`에 정의)

### 반별 테마 색상 (`styles/themes/index.ts`)

모든 반은 동일한 빈티지 크림 배경(#F5F0E8)을 공유하며, 강조색만 다름:

| 반 | 강조색 (accent) | 강조색 밝은 (accentLight) | 분위기 |
|---|----------------|--------------------------|--------|
| A | #8B1A1A (버건디/레드) | #D4A5A5 | 열정적이고 용맹함 |
| B | #B8860B (다크 골드) | #E8D5A3 | 따뜻하고 밝음 |
| C | #1D5D4A (에메랄드 그린) | #A8D4C5 | 차분하고 안정적 |
| D | #1E3A5F (네이비 블루) | #A8C4E0 | 지적이고 신뢰감 |

**생물학 단일 테마**: `courseId === 'biology'`이면 반별 테마 대신 `accent: #2E7D32` (자연 녹색) 단일 테마 적용

### 글꼴

- **Noto Sans KR** — 본문 (한글)
- **Playfair Display** — 빈티지 헤더 (`.font-serif-display`, `.btn-vintage`)
- **Cormorant Garamond** — 우아한 세리프 (`.font-serif-elegant`)

### 유틸리티 클래스 (`globals.css`)

- `.card-vintage` — 테두리 + 그림자 + hover 효과
- `.btn-vintage` / `.btn-vintage-outline` — 빈티지 스타일 버튼
- `.decorative-corner` — 신문 스타일 코너 장식
- `.pb-navigation` — 네비게이션 바 + safe area 패딩
- 전역 스크롤바 숨김 (`* { scrollbar-width: none }`, `*::-webkit-scrollbar { display: none }`)
- `html, body { overflow-x: hidden }` — 모바일 PWA 가로 스크롤 방지

### 과목 시스템 (`lib/types/course.ts`)

학년/학기 기반 자동 과목 결정:

| 과목 ID | 이름 | 학년/학기 |
|---------|------|----------|
| `biology` | 생물학 | 1학년 1학기 |
| `pathophysiology` | 병태생리학 | 1학년 2학기 |
| `microbiology` | 미생물학 | 2학년 1학기 |

- `CourseId = 'biology' | 'pathophysiology' | 'microbiology'`
- 학기 자동 판별: 02-22~08-21 → 1학기, 08-22~02-21 → 2학기
- 퀴즈 필터 탭 (`QuizFilterTab`): `midterm | final | past | custom`, 날짜 기반 기본 탭 자동 선택

### 네비게이션 탭

**학생 탭** (홈은 스와이프로 접근, nav에 없음):
- `/quiz` — 퀴즈
- `/review` — 복습
- `/board` — 게시판

**교수 탭**:
- `/professor` — 홈 (exact match)
- `/professor/quiz` — 퀴즈
- `/professor/students` — 학생
- `/professor/analysis` — 분석

### PullToHome (`components/common/PullToHome.tsx`)

학생 전용, `/quiz` `/review` `/board` 페이지에서만 활성화 (`app/(main)/layout.tsx`의 `enablePullToHome`).

- **세로 스와이프**: 페이지 상단에서 아래로 당기면 홈으로 이동 (배경에 home-bg.jpg 미리보기)
- **가로 스와이프**: 퀴즈 ↔ 복습 ↔ 게시판 탭 전환 (`TAB_PATHS = ['/quiz', '/review', '/board']`)
- 방향 잠금: 10px 이상 이동 시 가로/세로 판별 후 잠금
- `sessionStorage` 키: `tab_swipe_enter` (입장 방향), `home_return_path` (홈에서 돌아갈 경로)
- PullToHome 활성화 시 Navigation도 PullToHome 안에 배치되어 같이 슬라이드됨

### 공지 채널 (`components/home/AnnouncementChannel.tsx`)

홈 바텀시트에 표시되는 교수님 공지 시스템:
- Firestore `announcements` 컬렉션 실시간 구독
- 텍스트/이미지/파일 첨부, **다중 투표(polls)**, 이모지 리액션
- **다중 이미지/파일 업로드**: `imageUrls: string[]`, `files: Array<{url,name,type,size}>` (하위 호환: 기존 `imageUrl`/`fileUrl` 단일 필드도 읽기 지원)
- **다중 투표**: `polls: Poll[]` 배열 (하위 호환: 기존 `poll` 단일 필드도 `getPolls()` 유틸로 배열 변환). 복수 선택 투표 지원 (`allowMultiple`, `maxSelections`)
- **투표 생성 캐러셀**: `editingPolls: EditingPoll[]` + `editingPollIdx`로 여러 투표를 캐러셀 UI에서 생성/편집
- **이미지/파일/투표 캐러셀**: 2개 이상일 때 좌우 화살표 + 스냅 스크롤(`snap-start`) + 점 인디케이터 + `gap-0.5` (인접 아이템 테두리 겹침 방지)

**9-slice 말풍선 (Bubble 컴포넌트):**
- CSS Grid가 아닌 **absolute positioning + padding** 방식으로 구현 (Grid 방식은 오른쪽 잘림 버그 발생)
- `BUBBLE_C = 14` (기본 패딩), `BUBBLE_SIDE_MULTI = 26` (다중 아이템 캐러셀 좌우 패딩)
- 9개 배경 이미지(`/notice/bubble_professor_*.png`)를 absolute로 배치, 콘텐츠는 `relative`로 위에 올림
- `sidePadding` prop으로 단일/다중 아이템 패딩 분기
- 텍스트 전용: `w-fit` (내용 크기 맞춤), 미디어 포함: `w-full` (래퍼 채움)

**캐러셀 화살표 배치:**
- `-mx-[30px]`로 flex를 버블 패딩 영역까지 확장, 화살표 `w-[30px]`으로 패딩 중앙 배치
- `ARROW_ZONE = 30` (BUBBLE_SIDE_MULTI + content px-1 = 26 + 4)
- 단일 아이템은 캐러셀 없이 렌더링, 버블 기본 패딩(14px) 유지

**투표 Firestore 주의사항:**
- `polls.0.votes` 같은 dot notation으로 업데이트하면 Firestore가 배열을 객체로 변환 → 반드시 전체 `polls` 배열로 업데이트: `{ polls: newPolls }`
- `getPolls()` 유틸: `polls` 우선, 없으면 `poll` 단일값 래핑, 객체→배열 복구, 유효성 필터
- 투표 참여자 수: `new Set(Object.values(votes).flat()).size` (중복 제거)

**교수/학생 정렬:**
- 교수님 본인 메시지: 우측 정렬 (`flex-row-reverse`), 미디어 위 본문 `text-right`
- 학생 화면: 좌측 정렬, 본문 `text-left`
- 읽음/시각: `{readCount}명 읽음 · {시각}` 순서
- 이모지 피커: 교수님은 `right-0`, 학생은 `left-0`

- **검색 기능**: 상단 검색 아이콘 → 키워드 입력 → 매칭 메시지 하이라이트 + 좌측 하단 상/하 화살표 FAB로 탐색
- **캘린더**: 년도(교수님만)/월 선택, 메시지 있는 날 표시, 클릭 시 해당 날짜로 스크롤
- **입력창 인라인 확장**: 2줄 이상 입력 시 확장 버튼 표시 → 클릭 시 max-height 해제하여 전체 내용 표시
- **스크롤 FAB**: 최신 메시지가 안 보이면 좌측 하단에 스크롤 초기화 버튼 (검색 중에는 숨김)
- `createPortal(... , document.body)`로 렌더링 (z-index 우회)
- 미디어 드로어: 좌측 슬라이드, 이미지 전체화면 뷰어, 과목 체인지 헤더
- 학생 홈 미리보기: 첫 글자/나머지 2줄 분리, 이미지→"사진을/보냈습니다", 파일→"파일을/보냈습니다"

### 게시판 (`app/(main)/board/page.tsx`)

신문 스타일 레이아웃의 게시판:
- 교수님: 타이틀 영역에 과목 체인지 캐러셀 (BIOLOGY/PATHOPHYSIOLOGY/MICROBIOLOGY, 좌우 화살표 + 스와이프)
- 학생: "JIBDAN JISUNG" 타이틀 고정
- 게시글 고정/해제: 교수님 전용 (Firestore rules에 `isPinned/pinnedAt/pinnedBy` 허용)
- 고정글 캐러셀 + Masonry 2열 레이아웃

### 교수 퀴즈 시스템

**시험 유형** (`QuizType`): 교수 퀴즈 생성 시 필수 선택
- `midterm` (중간), `final` (기말), `past` (기출)
- Firestore `quizzes` 문서의 `type` 필드에 저장 (기존 `'professor'` → 시험 유형으로 변경)
- `useProfessorQuiz.fetchQuizzes()`: `type in ['midterm', 'final', 'past', 'professor']`로 쿼리

**교수 퀴즈탭** (`app/(main)/professor/quiz/page.tsx`):
- 3D perspective 순환 캐러셀 (MIDTERM / PAST EXAM / FINAL 3장, 클론 카드 방식 무한 루프)
- 캐러셀 peek 효과: 82% 너비 카드 + 양쪽 9% 사이드 피크, PC 드래그 지원
- 3D 전환: rotateY ±8°, scale 0.92, opacity 0.9 (비활성 카드)
- 난이도별 MP4 비디오 카드 (`/videos/difficulty-easy|normal|hard.mp4`)
- 기출 카드: PAST EXAM 헤더에 장식선 + 년도/시험 드롭다운
- 퀴즈 관리 페이지 (`/professor/quiz/best-q`): 3탭 (피드백 / 서재 / 커스텀)
- 퀴즈 미리보기 페이지 (`/professor/quiz/[id]/preview`)
- 자작 퀴즈: 신문 스타일 카드 그리드 + 태그 검색
- 자작 Details 모달: 미리보기 버튼 없음 (캐러셀 Details에만 표시)
- 과목별 리본 이미지 스와이프 전환 (CourseRibbonHeader)

**교수 서재 (AI 문제 생성)** (`components/professor/library/ProfessorLibraryTab.tsx`):
- 프롬프트 입력 + 파일 업로드(이미지/PDF/PPT) + 슬라이더(스타일/범위/포커스가이드/난이도/문제수)
- `enqueueGenerationJob` CF 호출 → 백그라운드 폴링 (`lib/utils/libraryJobManager.ts`)
- 생성 중 다른 페이지 이동 가능, 완료 시 상단 토스트 (`LibraryJobToast.tsx`, layout.tsx에 마운트)
- 생성된 퀴즈는 `type: 'professor-ai'`로 저장, `useProfessorAiQuizzes` 훅으로 실시간 구독
- 슬라이더 가중치: 0-9% OFF, 10-49% 낮음, 50-74% 보통, 75-94% 높음, 95-100% 강력

**퀴즈 통계 모달** (`components/quiz/manage/QuizStatsModal.tsx`):
- 반별 필터링, 문제별 스와이프 분석, 변별도 (4명 이상 응답 시 표시)
- 선지별 해설 표시 (수정된 문제는 choiceExplanations 제외), 해설 섹션 (없으면 "해설 없음")
- 우측 하단 피드백 아이콘 → questionFeedbacks 조회 모달

### 교수 설정 (`app/(main)/professor/settings/page.tsx`)

- 학기 설정 (SemesterSettingsCard)
- 시즌 리셋 (SeasonResetCard + SeasonResetModal)
- 배틀 퀴즈 키워드 범위 (TekkenKeywordsCard)
- 시즌 히스토리 (SeasonHistoryList)
- 기타 설정 (프로필, 알림, 앱 버전)

### 피드백 점수 시스템 (`lib/utils/feedbackScore.ts`)

피드백 타입별 점수: praise(+2), wantmore(+1), other(0), typo(-1), unclear(-1), wrong(-2)
- `calcFeedbackScore(feedbacks)`: 평균 점수 (-2 ~ +2)
- `getFeedbackLabel(score)`: 좋음(초록) / 보통(회색) / 나쁨(빨강)

### 주별 수집 + 월별 리포트

**주별 자동 수집** (`functions/src/weeklyStats.ts`):
- Scheduled CF: 매주 월요일 00:00 KST
- 저장: `weeklyStats/{courseId}/weeks/{year-Wxx}`
- 수집: 퀴즈, 피드백, 학생(군집 포함), 게시판 데이터

**월별 리포트** (`functions/src/monthlyReport.ts`):
- Callable CF: 교수님 수동 트리거
- Claude Sonnet (`claude-sonnet-4-20250514`) 호출 → 인사이트 생성
- 저장: `monthlyReports/{courseId}/months/{year-MM}`
- `ANTHROPIC_API_KEY` 시크릿 사용

**리포트 다운로드** (`lib/utils/reportExport.ts`):
- Excel (exceljs): 요약/퀴즈/학생/게시판/인사이트 시트
- Word (docx): 마크다운 → Word 변환, 연구용 보고서 형식
- 교수 통계 탭 하단 "MONTHLY REPORT" 섹션에서 생성/다운로드

### 랭킹 시스템 (`lib/utils/ranking.ts`)

- **개인**: `profCorrectCount × 4 + totalExp × 0.6`
- **팀**: `normalizedAvgExp × 0.4 + avgCorrectRate × 0.4 + avgCompletionRate × 0.2`
- 사전 계산: CF `computeRankingsScheduled` (5분마다) → `rankings/{courseId}` 문서 1개로 캐싱
- 클라이언트: sessionStorage SWR 캐시 (TTL 2분/10분)

## 코딩 컨벤션

- 응답 및 코드 주석: 한국어
- 변수명/함수명: 영어
- 들여쓰기: 2칸
- 컴포넌트: React 함수형 컴포넌트 + TypeScript
- 경로 별칭: `@/*` → 프로젝트 루트 (`tsconfig.json`)

## 주요 기능 상세

### 퀴즈 시스템

**문제 유형** (`QuestionType`): `'ox' | 'multiple' | 'short_answer' | 'essay' | 'combined'`

| 유형 | 설명 | 비고 |
|------|------|------|
| OX | 참/거짓 | |
| 객관식 | 2~8개 선지, 복수정답 지원 | |
| 단답형 | 짧은 텍스트, 복수정답(`\|\|\|` 구분) | 학생 UI에서는 "주관식" |
| 서술형 | 루브릭 채점 (AI/수동) | 교수 전용 |
| 결합형 | 공통 지문/이미지 + 하위 문제들 | 하위 문제 N개 = N문제로 계산 |

**역할별 차이:**
- 학생: OX, 객관식, 주관식(=단답형), 결합형
- 교수: OX, 객관식, 단답형, 서술형, 결합형

### 결합형 문제 구조

- **공통 지문**: 텍스트 박스 / ㄱ.ㄴ.ㄷ. 형식 중 선택
- **공통 이미지**: 별도 업로드 (공통 지문 OR 이미지 중 하나 필수)
- **하위 문제**: OX, 객관식, 단답형만 가능 (서술형 제외)
- **한글 라벨**: `KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', ...]` (`components/quiz/create/QuestionEditor.tsx`)

### 서술형 채점 (`lib/scoring.ts`)

```typescript
calculateEssayScore(rubricScores)           // 루브릭 점수 합산
createEmptyEssayScore(questionId, rubric)   // 빈 채점 결과 생성
updateRubricScore(result, index, score, feedback)  // 점수 업데이트
generateScoreSummary(result)                // 텍스트 요약
```

### 복습 시스템

- 유형: `wrong`(오답), `bookmark`(찜), `solved`(푼 문제)
- 퀴즈 완료 → 모든 문제 `solved`로, 틀린 문제 추가로 `wrong`으로 `reviews` 컬렉션에 저장
- `completedUsers` 배열로 퀴즈 완료 여부 추적
- 폴더 삭제 시 `completedUsers`에서 제거 → 퀴즈 목록에 다시 표시

### 토끼 발견/장착 시스템

**2단계 뽑기 (Roll → Claim):**
1. `spinRabbitGacha` (Roll): 50XP 마일스톤마다 랜덤 토끼(0~79) 선택, `lastGachaExp` 갱신만 수행
2. `claimGachaRabbit` (Claim): 사용자 선택에 따라 발견/놓아주기
   - 미발견 토끼 → 최초 발견 (이름 짓기, 영구)
   - 발견된 토끼 → 후속 발견 (N세)
   - 이미 발견한 토끼 → 안내만 표시
   - 발견은 무제한, 장착만 최대 2마리

**장착 시스템:**
- `equipRabbit`: 도감에서 "데려오기" (slotIndex 0|1 지정)
- `unequipRabbit`: 슬롯에서 해제
- 뽑기 시 빈 슬롯 자동 장착 (2개 미만), 슬롯 가득 → 인라인 선택 UI

**기본 토끼 (#0):**
- 온보딩 완료 시 `onOnboardingComplete` 트리거로 자동 지급 (rabbitHoldings + rabbits + equippedRabbits)
- 기본 토끼는 이름 없음, 도감에서 "토끼는 언제나 {닉네임} 편!" 메시지 표시
- 보유 집사 섹션 미표시

**토끼 도감 상세:**
- `discoverers` 배열: `{userId, nickname, discoveryOrder}` — 보유 집사 목록 실시간 표시
- 부모(최초 발견자, 금색) → N대 집사(후속 발견자) 2열 레이아웃
- 20명 단위 구분선, 스크롤 가능 (max-h-[200px])

**핵심 데이터 모델:**
- `users/{uid}` 필드: `equippedRabbits: Array<{rabbitId, courseId}>` (max 2), `lastGachaExp`
- `rabbits/{courseId_rabbitId}`: 토끼 문서 (`name` 영구, `firstDiscovererUserId`, `discovererCount`, `discoverers[]`)
- `users/{uid}/rabbitHoldings/{courseId_rabbitId}`: 발견 정보 (`discoveryOrder`, `discoveredAt`, `level`, `stats: {hp, atk, def}`)

**관련 파일:**
- CF: `functions/src/rabbitGacha.ts`, `functions/src/rabbitLevelUp.ts`, `functions/src/rabbitEquip.ts`, `functions/src/onboardingRabbit.ts`
- 훅: `lib/hooks/useRabbit.ts` (useRabbitHoldings, useRabbitDoc, useRabbitsForCourse, getRabbitStats)
- UI: `components/home/CharacterBox.tsx` (홈 히어로, 2마리 궤도 캐러셀), `GachaResultModal.tsx`, `RabbitDogam.tsx` (도감 + 데려오기), `LevelUpBottomSheet.tsx`, `MilestoneChoiceModal.tsx`
- 유틸: `lib/utils/rabbitDisplayName.ts`, `lib/utils/milestone.ts`, `lib/utils/rabbitProfile.ts`
- 마이그레이션: `functions/src/migrateRabbitSystem.ts`, `functions/src/migrateDefaultRabbit.ts`

### 마일스톤 시스템 (50XP 보상 선택)

50XP 달성마다 `MilestoneChoiceModal`이 자동으로 표시되어 보상을 선택:
- **토끼 뽑기**: `spinRabbitGacha` → `claimGachaRabbit` (2단계)
- **토끼 레벨업**: `LevelUpBottomSheet` → `levelUpRabbit` CF 호출

**마일스톤 계산** (`lib/utils/milestone.ts`):
- `getPendingMilestones(totalExp, lastGachaExp)`: 미수령 마일스톤 횟수
- `getExpBarDisplay(totalExp, lastGachaExp)`: EXP 바 표시용 (current/max, 오버플로우 여부)
- 마일스톤 자동 표시: `CharacterBox`에서 `pendingCount`가 0→>0이 되면 600ms 후 자동 오픈

**레벨업 바텀시트** (`components/home/LevelUpBottomSheet.tsx`):
- 글래스모피즘 UI (home-bg.jpg + backdrop-blur-2xl)
- 토끼 선택: 그리드 레이아웃 (최대 4줄 × 20마리), 각 줄마다 좌우 화살표 스크롤
- 레벨업 전: Lv.N 스탯 → Lv.N+1 ? 비교 표시
- 레벨업 후: 확정 스탯 + 증가량 표시 (흰색 텍스트 유지, 골드 변경 없음)

**토끼 레벨/스탯** (`lib/hooks/useRabbit.ts`):
- `getRabbitStats(holding)`: holding의 `level`, `stats` 읽기 (기본 Lv.1, HP/ATK/DEF 10)
- CF `levelUpRabbit`: level +1, HP/ATK/DEF 각각 1~3 랜덤 증가 (`utils/rabbitStats.ts`)
- 홀딩 데이터: `rabbitHoldings/{id}` 문서에 `level`, `stats: {hp, atk, def}` 필드

### 캐릭터/게이미피케이션

- 토끼 캐릭터 커스터마이징: 머리스타일, 피부색, 수염
- 시즌 전환(중간→기말): 토끼 장착(equippedRabbits) 초기화, 발견 기록/외형/뱃지는 유지

### AI 문제 생성 (`generateStyledQuiz`)

교수 출제 스타일을 학습하여 난이도별 문제 생성:
- **쉬움**: OX/객관식
- **보통**: 객관식 + 제시문
- **어려움**: 객관식 + 제시문 + ㄱㄴㄷ 보기 + 이미지 자동 크롭 (Gemini Vision)

**학생용**: `components/ai-quiz/AIQuizContainer.tsx` (플로팅 버튼)
**교수용 서재**: `components/professor/library/ProfessorLibraryTab.tsx` (슬라이더 가중치 + 교수 프롬프트)

관련 CF: `styledQuizGenerator.ts`, `enqueueGenerationJob.ts`, `workerProcessJob.ts`, `imageRegionAnalysis.ts`

## 알려진 제약 및 주의사항

### Firestore Security Rules

클라이언트에서 사용자 문서 업데이트 시 보호 필드 포함 금지:
```javascript
// ❌ Security Rules에서 거부됨
await setDoc(doc(db, 'users', uid), { totalExp: 0, rank: '견습생' }, { merge: true });

// ✅ 허용된 필드만 사용
await setDoc(doc(db, 'users', uid), { onboardingCompleted: true, updatedAt: serverTimestamp() }, { merge: true });
```

보호 필드: `totalExp`, `rank`, `role`, `badges`, `equippedRabbits` — Cloud Functions에서만 수정 가능

### Firestore 주요 컬렉션/서브컬렉션

- `users/{uid}` — 프로필, 캐릭터, 통계
- `users/{uid}/quizHistory/{quizId}` — 퀴즈 풀이 기록
- `users/{uid}/expHistory/{historyId}` — EXP 트랜잭션 로그
- `users/{uid}/rabbitHoldings/{holdingId}` — 토끼 발견 정보 (discoveryOrder, discoveredAt)
- `quizzes/{quizId}` — 퀴즈 문서
- `quizzes/{quizId}/submissions/{submissionId}` — 제출 답안 (CF 전용 쓰기)
- `quizzes/{quizId}/feedback/{feedbackId}` — 피드백 (CF 전용 쓰기)
- `rabbits/{courseId_rabbitId}` — 토끼 문서 (name, firstDiscovererUserId, discovererCount)
- `announcements/{id}` — 공지 (content, imageUrls[], files[], polls[], reactions, readBy) (하위 호환: imageUrl, fileUrl, poll 단일 필드도 지원)
- `rankings/{courseId}` — 사전 계산된 랭킹 (rankedUsers[], teamRanks[])
- `quizResults/{id}` — 퀴즈 결과 집계 (CF에서 쓰기)
- `weeklyStats/{courseId}/weeks/{year-Wxx}` — 주별 자동 수집 통계 (CF에서 쓰기)
- `monthlyReports/{courseId}/months/{year-MM}` — 월별 Claude 리포트 (CF에서 쓰기)
- `inquiries/{id}` — 비로그인 문의 (studentId, message, type, isRead)

### Firestore Rules — users 읽기 규칙

- `get`: 본인 또는 교수님만 (개별 문서 읽기)
- `list`: 로그인 사용자 모두 (랭킹 등 컬렉션 쿼리)

### 도배 방지

글 1분 3개, 댓글 30초 1개 제한 (Cloud Functions `checkRateLimitCall`에서 검증)

### 온보딩 리다이렉트

`onboarding_just_completed` localStorage 플래그로 온보딩 직후 홈 → 온보딩 재리다이렉트 방지

### 비밀번호 찾기 (`app/forgot-password/page.tsx`)

- 학번 입력 → `requestPasswordReset` CF 호출
- 복구 이메일 등록된 경우: 재설정 링크 발송 안내
- 미등록: "문의하기" 인라인 폼 펼침 → `submitInquiry` CF로 Firestore `inquiries`에 저장
- 교수님 설정(`/professor/settings`)에서 문의 확인 가능

### 네비게이션 숨김 규칙

경로 기반 (`app/(main)/layout.tsx`의 `hideNavigation`):
- 홈 (`/`) — 항상 숨김
- `/quiz/[id]/*` 경로: 퀴즈 풀이, 결과, 피드백 페이지
- `/edit` 포함 경로: 퀴즈 수정 페이지
- `/ranking` 경로: 랭킹 페이지
- `/review/random` 경로: 랜덤 복습 페이지
- `/review/[type]/[id]` 경로: 복습 상세 페이지

모달 기반 (`data-hide-nav` body 속성):
- 토끼 도감, 뽑기 모달, 공지 채널 모달 열림 시 `document.body.setAttribute('data-hide-nav', '')` → 닫힘 시 제거
- Navigation에서 MutationObserver로 감지하여 숨김 처리

### 홈 화면 구조

- `CharacterBox`: 캐릭터 히어로, 배경 이미지, XP 배지, 도감 버튼, EXP 바 (게임 HUD 스타일 `bg-black/40 rounded-full backdrop-blur-xl`)
  - 2마리 궤도 캐러셀 (타원 공전, Framer Motion `useSpring`/`useTransform`)
  - 빈 슬롯은 "?" 플레이스홀더 표시, 스탯은 "-" 표시
  - 마일스톤 버튼 (EXP 바 좌측, pendingCount > 0일 때 표시)
- 바텀시트: 프로필 닉네임, 공지 채널, 랭킹 섹션
- 홈은 `h-screen overflow-hidden` 컨테이너로 스크롤 방지 (body style 직접 조작 금지)
- **z-index 주의**: 바텀시트 콘텐츠 영역이 `relative z-10` stacking context를 생성. 그 안의 모달(공지 채널 등)은 `createPortal(... , document.body)`로 body에 렌더링해야 CharacterBox의 z-20 EXP 바 위에 표시됨

### 퀴즈 목록 정렬 규칙

- **퀴즈탭**: 미완료 > 완료 > 최신순. 수정된 퀴즈도 "완료" 상태 유지, "!" 뱃지 미표시
- **복습탭**: 수정된 퀴즈 우선 > 최신순. "!" 뱃지 표시 (복습탭에서만)

### Firebase 설정 파일

- `firebase.json` — Firestore rules/indexes, Functions, Storage 배포 설정
- `firestore.rules` — Firestore 보안 규칙
- `firestore.indexes.json` — 복합 인덱스 정의
- `storage.rules` — Cloud Storage 보안 규칙

### Firebase 배포 (규칙 변경 시)

Firestore 규칙/인덱스는 git push만으로 배포되지 않음. 별도 배포 필요:
```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
```

## 철권퀴즈 (배틀 퀴즈)

실시간 1v1 토끼 배틀. Firebase Realtime Database 사용.
- 매치 시간 3분, 문제 타임아웃 20초, 크리티컬 4초 이내 x1.5
- 데미지 = max(ceil(ATK²/(ATK+상대DEF)), 1), 오답 셀프데미지 3
- 연타 미니게임 (눈빛보내기 스타일 게이지 땅따먹기, 3초)
- XP: 승리 30, 패배 10, 연승 +5 (최대 50)
- 봇 매칭: 30초 대기 초과 시
- 교수 설정에서 배틀 키워드 범위 지정 (TekkenKeywordsCard)

**관련 파일:**
- CF: `functions/src/tekkenBattle.ts`, `functions/src/tekkenCleanup.ts`, `functions/src/utils/tekkenBot.ts`, `functions/src/utils/tekkenDamage.ts`
- 훅: `lib/hooks/useTekkenBattle.ts`
- UI: `components/tekken/` (TekkenBattleOverlay, TekkenBattleHUD, TekkenMatchmakingModal, TekkenQuestionCard, TekkenMashMinigame 등)
- 타입: `lib/types/tekken.ts`
- 데미지 유틸: `lib/utils/tekkenDamage.ts`
- DB 규칙: `database.rules.json` (Realtime Database)

## 개선 예정 사항

- **복습 시스템**: 에빙하우스 간격 반복 추가 검토
- **랭킹**: 실시간 변동 애니메이션
- **교수 대시보드**: 위험 학생 인사이트 강화 (참여도 군집 시각화 구현 완료, 추가 강화 가능)
- **오프라인 대응**: PWA 오프라인 캐시 전략 (22일 작업)

## 배포

### 프론트엔드 (Vercel)

`npm run build` → Vercel 자동 배포. PWA 서비스 워커 자동 등록.
- **PWA는 개발 모드에서 비활성화** (`next.config.mjs`에서 `disable: NODE_ENV === "development"`)
- **프로덕션 빌드 시 `console.log` 자동 제거** — `console.error`/`console.warn`만 유지 (`compiler.removeConsole`)

### 토끼 에셋

두 디렉토리에 80개 PNG 파일씩:
- `/public/rabbit/rabbit-001.png` ~ `rabbit-080.png` — 전신 이미지 (종횡비 520:969)
- `/public/rabbit_profile/rabbit-001-pf.png` ~ `rabbit-080-pf.png` — 프로필 이미지

**rabbitId ↔ 파일명 매핑**: rabbitId는 0~79 (0-indexed), 파일명은 001~080 (1-indexed).
- `getRabbitImageSrc(rabbitId)` → `/rabbit/rabbit-{id+1}.png` (`lib/utils/rabbitImage.ts`)
- `getRabbitProfileUrl(rabbitId)` → `/rabbit_profile/rabbit-{id+1}-pf.png` (`lib/utils/rabbitProfile.ts`)

### Cloud Run PPTX 서비스

```bash
cd cloud-run-pptx
gcloud run deploy pptx-quiz-generator --source . --region asia-northeast3 \
  --no-allow-unauthenticated --set-env-vars GEMINI_API_KEY=your-api-key

# Cloud Functions 서비스 계정에 호출 권한 부여
gcloud run services add-iam-policy-binding pptx-quiz-generator \
  --region asia-northeast3 \
  --member="serviceAccount:YOUR_PROJECT_ID@appspot.gserviceaccount.com" \
  --role="roles/run.invoker"

# functions/.env에 PPTX_CLOUD_RUN_URL 설정 후 배포
cd functions && npm run deploy
```
