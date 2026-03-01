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
- **exceljs** 4.4 (Excel 리포트 내보내기)
- **docx** 9.5.3 (Word 리포트 내보내기)
- **file-saver** 2.0.5 / **jszip** 3.10.1 / **date-fns** 3.0

### Backend (Firebase)
- **Firebase** 10.7 — Auth, Firestore, Realtime Database, Cloud Functions, Cloud Messaging, Storage
- **firebase-functions** 5.0 + **firebase-admin** 12.0 (Node 20)
- **@google-cloud/vision** 4.3.2 (Gemini Vision OCR)
- **jimp** 0.22.12 (서버사이드 이미지 크롭)
- **nodemailer** 6.9.8 / **node-fetch** 2.7 / **google-auth-library** 9.6

### AI
- **Gemini API** (gemini-2.0-flash) — AI 문제 생성, 이미지 분석, 철권퀴즈 문제
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
npm run lint         # ESLint 9
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
- **캐시**: sessionStorage SWR (랭킹 2분/10분 TTL, 레이더 정규화 5분 TTL)

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
| 복습 연습 완료 | 25 | — (클라이언트) |
| 배틀 승리 | 30 (+연승 ×5, 최대 50) | submitAnswer |
| 배틀 패배 | 10 | submitAnswer |

**피드백 점수**: praise(+2), wantmore(+1), other(0), typo(-1), unclear(-1), wrong(-2)

**마일스톤**: 50XP마다 1 마일스톤 → `MilestoneChoiceModal` 자동 표시 → 뽑기 or 레벨업 선택

### AI 문제 생성 시스템

**교수 서재 플로우** (ProfessorLibraryTab → workerProcessJob):
1. 프롬프트 입력 + 슬라이더 조정 + **챕터 태그 필수 선택**
2. `enqueueGenerationJob` CF → `jobs/{jobId}` (status: QUEUED)
3. `workerProcessJob` 자동 트리거 (동시 최대 20)
4. styleProfile + scope + focusGuide 병렬 로드 → Gemini API 호출
5. HARD 난이도: Gemini Vision 영역 분석 + 이미지 자동 크롭
6. 완료 → LibraryJobToast 표시 (다른 페이지에서도)

**학생 AI 퀴즈**: AIQuizContainer 플로팅 버튼 → 태그 선택 → 같은 CF 호출

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

**봇**: 60% 정답률, 1~8초 응답 시간, 10개 닉네임 풀, 레벨 3~7

**문제 풀**: 매일 새벽 3시 → 과목당 60문제 보충, seenQuestions로 24시간 중복 방지

## 교수 통계 시스템 (상세)

### 6축 레이더 차트 — `computeRadarNorm.ts` (5분마다 사전 계산)

| 축 | 이름 | 계산 방식 | 스케일 |
|----|------|----------|--------|
| 1 | 가중 석차 | 교수 퀴즈 석차 기반 가중 평균 (아래 상세) | 절대값 0~100 |
| 2 | 성장세 | 재시도 개선율 평균 → 0~100 변환 | 절대값 0~100 |
| 3 | 출제력 | 학생이 만든 커스텀 퀴즈 수 | 백분위 |
| 4 | 소통 | (게시글 수 × 3) + 피드백 수 | 백분위 |
| 5 | 복습력 | reviews의 reviewCount 합계 (markAsReviewed 횟수) | 백분위 |
| 6 | 활동량 | users.totalExp (누적 EXP) | 백분위 |

#### 가중 석차 상세

```
1. 퀴즈별 석차 계산 (첫 시도만 사용, isUpdate !== true)
2. 참여자 < 5명: 실제 점수 사용 (소수 참여 시 석차 부풀림 방지)
   참여자 ≥ 5명: rankScore = ((참여자수 - 석차 + 1) / 참여자수) × 100
3. 가중치: 교수 퀴즈(midterm/final/past/professor/professor-ai) = 6, 학생 커스텀 = 4
4. 최종: sum(rankScore × weight) / sum(weight) → 소수점 2자리
```

#### 성장세 상세

```
1. 각 퀴즈: (최고 재시도 점수 - 첫 시도 점수) 수집
2. 평균 개선율 계산
3. 스케일 변환: growth = max(0, min(100, 50 + avgImprovement / 2))
   - 50 = 변화 없음 기준선
   - 재시도 없는 학생 = 0
```

#### 백분위 계산

```
rankPercentile(value, sortedArray) = (value보다 작은 개수) / (배열.length - 1) × 100
- 모든 값 동일 + value > 0 → 50%
- 모든 값 동일 + value = 0 → 0%
```

### 랭킹 — `computeRankings.ts` (5분마다 사전 계산)

**개인**: `profCorrectCount × 4 + totalExp × 0.6`
**팀**: `normalizedAvgExp × 0.4 + avgCorrectRate × 0.4 + avgCompletionRate × 0.2`

동점 처리: 동점자는 같은 순위 (A 100점, B 100점, C 90점 → 1위, 1위, 3위)

### 교수 통계 대시보드 — `professor/stats/page.tsx`

#### 위험 학생 감지

```
Z-score 기반: Z < -1.5 → 주의(caution), Z < -2 → 위험(danger)
평균과 표준편차는 전체 학생 평균 점수에서 계산
```

#### 학생 군집 분류 (4 타입)

```
중위값 기반 분류:
- medianExp = 학생들의 EXP 중위값
- RATE_THRESHOLD = 50% (정답률 기준)

| EXP ≥ median | 정답률 ≥ 50% | 타입 |
|---|---|---|
| O | O | passionate (열정적) |
| O | X | hardworking (노력형) |
| X | O | efficient (효율형) |
| X | X | atRisk (이탈위험) |
```

#### 변별도

```
표시 조건: 해당 퀴즈 참여자 ≥ 4명
공식: 상위 27% 정답률 - 하위 27% 정답률
```

### 주별 수집 — `weeklyStats.ts` (매주 월요일 00:00 KST)

수집 항목: 퀴즈(신규/유형/정답률/완료율), 피드백(유형별/평균점수), 학생(활성/군집), 게시판(글/댓글/키워드-Haiku AI 추출)

### 월별 리포트

교수 수동 트리거 → Claude Sonnet (`claude-sonnet-4-20250514`) → 인사이트 마크다운
다운로드: Excel (exceljs, 5시트) + Word (docx, 연구용 형식)

### 캐시 전략

| 캐시 | 위치 | TTL | 패턴 |
|------|------|-----|------|
| 랭킹 | sessionStorage | 2분 fresh / 10분 max | SWR |
| 레이더 정규화 | sessionStorage | 2분 fresh / 10분 max | SWR |
| 교수 통계 raw | 모듈 Map | 5분 | stale-while-revalidate |
| 교수 통계 계산 | 모듈 Map | 5분 | stale-while-revalidate |

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
│          │                 │                  │
│  블랙    │                 │                  │
│  글래스   │                 │                  │
└──────────┴─────────────────┴──────────────────┘
```

- `useWideMode()` — 가로모드 감지 (100ms 디바운스)
- Tailwind: `wide: { raw: '(orientation: landscape) and (min-width: 1024px)' }`
- 좌측 사이드바: 블랙 글래스 스타일 (프로필 + 네비게이션)
- 중앙: iPhone SE 배치 그대로 (max-w-640px)
- 우측: 퀴즈 풀이, 퀴즈 만들기, 모달 등 디테일 표시

### 세로모드 (< 1024px 또는 portrait)

네이티브 모바일 반응형. 모든 기종에서 iPhone SE 배치와 동일하게 표시.

### 네비게이션

**학생** (4탭): `/`(홈), `/quiz`, `/review`, `/board`
**교수** (5탭): `/professor`, `/professor/stats`, `/professor/quiz`, `/professor/students`, `/board`

**숨김 규칙**: 퀴즈 풀이/생성/수정, 게시판 상세, 랭킹, 복습 상세 등에서 숨김
**숨김 구현**: `useHideNav` (Set 기반 — 레이스컨디션 면역), MutationObserver + 5초 주기 health check

## Safe Area 처리

- `html { background-color: #F5F0E8 }` — 아이폰 둥근 모서리 뒤
- 각 페이지 **Header/헤더**에서 `top: 0` + `marginTop: env(safe-area-inset-top)` 패턴
  → 배경은 노치/다이내믹 아일랜드 뒤까지 확장, 콘텐츠만 노치 아래
- Navigation 하단: `bottom: max(1rem, calc(env(safe-area-inset-bottom) + 0.5rem))`

## SwipeBack (뒤로가기 스와이프)

- `SwipeBack.tsx` — 왼쪽 25px 가장자리 오른쪽 스와이프
- **부모 경로로 이동**: `router.replace(getParentPath())` (예: `/quiz/123/result` → `/quiz/123`)
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

## 서버 비용 예측

### 대상 규모: 생물학 130명 + 미생물학 170명 ≈ 300명 활성 사용자

| 서비스 | 무료 등급 | 예상 사용량 (월) | 월 비용 (USD) |
|--------|----------|-----------------|--------------|
| Firebase Auth | 10K MAU | 300 MAU | $0 |
| Firestore 읽기 | 50K/일 (1.5M/월) | 1.5~5M | $0~2 |
| Firestore 쓰기 | 20K/일 (600K/월) | 300~600K | $0~0.50 |
| Cloud Functions | 2M 호출, 400K GB-s | 500K~1.2M 호출 | $0~1 |
| Realtime Database | 10GB 전송 | <2GB (철권퀴즈) | $0 |
| Cloud Storage | 5GB | 3~5GB (이미지/OCR) | $0~0.50 |
| FCM 푸시 알림 | 무제한 | — | $0 |
| Gemini API (Flash) | 15 RPM, 1M tok/일 | 1~3K 호출 | $0~1 |
| Claude API (Sonnet) | 종량제 | 3~6 호출 (월별 리포트) | $1~3 |
| Vercel Hobby | 100GB BW | ~5~15GB (PWA 캐싱) | $0 |
| Cloud Run (PPTX) | 2M req | <100 호출 | $0 |

**월 합계 예상**:
- 최소 (무료 등급 내): **$1~2**
- 보통 (일부 초과): **$2~5**
- 최대 (시험기간 피크): **$5~8**

> 유일한 고정 비용은 Claude API (월별 리포트 3~6회, $1~3). 나머지는 대부분 무료 등급 내. Vercel Pro ($20/월) 불필요.

### Firestore 읽기 상세 추정 (학습 플로우 기반)

**학생 1명 행동별 읽기**:
| 행동 | 읽기 수 | 비고 |
|------|---------|------|
| 앱 접속 (홈) | 15~30 | UserContext + Course + 랭킹 + 토끼 + 공지 |
| 퀴즈 목록 조회 | 30~60 | 퀴즈 리스트 + 완료여부 체크 |
| 퀴즈 풀이 1회 | 7~15 | 문서 로드 + CF 내부 읽기 |
| 결과 + 피드백 | 2~10 | 결과 + 문제별 피드백 |
| 복습 1회 | 15~30 | 복습 목록 + 퀴즈 참조 |
| 게시판 | 25~35 | 글 목록 + 댓글 |
| 철권퀴즈 1판 | 5~10 | seenQuestions + XP (RTDB는 별도) |

**300명 월간 총 읽기**:
| 시나리오 | 클라이언트 | 서버 (스케줄 CF) | 합계 | 비용 |
|---------|-----------|-----------------|------|------|
| 보수적 (60% 활성) | 400K | 200K | 600K | $0 |
| 보통 (80% 활성) | 1.5M | 200K | 1.7M | $0.12 |
| 활발 (90% 활성) | 3M | 250K | 3.25M | $1.05 |
| 시험기간 피크 | 4~5M | 250K | ~5M | $2.10 |

## 개발 로드맵

### Phase 1: 반응형 디자인 완성

사용자가 직접 체감하는 UI/UX 작업이므로 최우선.

#### 세로모드 (모바일 우선)

| 화면 크기 | 기기 | 검증 포인트 |
|----------|------|------------|
| 320px | iPhone SE | 최소 너비 레이아웃 깨짐 없음 |
| 375px | iPhone 13 mini | 기본 타겟 |
| 393px | iPhone 14 Pro | 주력 타겟 |
| 430px | iPhone 14 Pro Max | 넓은 모바일 |
| 768px | iPad | 태블릿 세로 |

#### 가로모드 (3패널)

| 화면 크기 | 기기 | 검증 포인트 |
|----------|------|------------|
| 1024×768 | iPad 가로 | 최소 가로모드 진입점 |
| 1366×768 | 노트북 | 일반적 PC |
| 1920×1080 | 모니터 | 풀HD |

#### 검증 체크리스트
- [ ] 모든 페이지 세로↔가로 전환 시 레이아웃 깨짐 없음
- [ ] safe-area-inset 적용 (노치, 다이내믹 아일랜드, 홈바)
- [ ] 바텀시트/모달 가로모드에서 정상 렌더링
- [ ] 키보드 오픈 시 입력 필드 가림 없음
- [ ] 캐러셀/스와이프 터치 + 마우스 모두 동작
- [ ] 이미지/비디오 종횡비 유지
- [ ] 교수 페이지 전체 가로모드 대응
- [ ] 철권퀴즈 배틀 화면 가로모드 레이아웃

### Phase 2: 아키텍처 리뷰 + 리팩토링

#### 1-1. 거대 파일 분할

| 파일 | 현재 크기 | 분할 전략 |
|------|----------|----------|
| `app/(main)/review/page.tsx` | 6,146줄 | 탭별 컴포넌트 분리, 훅 추출 |
| `components/quiz/create/QuestionEditor.tsx` | 4,074줄 | 유형별 에디터 분리, 공통 로직 훅 추출 |
| `components/home/AnnouncementChannel.tsx` | 3,500줄+ | 메시지 렌더러, 입력 폼, 검색, 캘린더 분리 |
| `app/(main)/board/page.tsx` | 2,800줄+ | PostList, WriteSection, CommentThread 분리 |
| `functions/src/tekkenBattle.ts` | 1,800줄+ | matchmaking, round, scoring 모듈 분리 |

#### 1-2. Dynamic Import 도입

```typescript
const QuestionEditor = dynamic(() => import('@/components/quiz/create/QuestionEditor'));
const TekkenBattleOverlay = dynamic(() => import('@/components/tekken/TekkenBattleOverlay'));
const AnnouncementChannel = dynamic(() => import('@/components/home/AnnouncementChannel'));
const RabbitDogam = dynamic(() => import('@/components/home/RabbitDogam'));
const ProfessorLibraryTab = dynamic(() => import('@/components/professor/library/ProfessorLibraryTab'));
```

#### 1-3. onSnapshot 구독 최적화

- **유지**: UserContext, 퀴즈 풀이 중 상태, 배틀 RTDB 리스너
- **폴링 전환**: 랭킹 (이미 SWR 캐시), 교수 통계, 게시판 목록
- **언마운트 시 해제 확인**: 모든 useEffect cleanup에서 unsubscribe 호출 검증

### Phase 3: 성능 최적화 (목표: 동시접속 500명)

#### 프론트엔드

| 항목 | 현재 상태 | 최적화 |
|------|----------|--------|
| 번들 크기 | dynamic import 미사용 | 라우트별 코드 스플리팅 + lazy 로드 |
| 이미지 | 일부 `<img>` 사용 | 전체 `next/image` 전환 |
| Framer Motion | 전체 래핑 | `LazyMotion` + `domAnimation` 서브셋 |
| React re-render | Context 변경 시 전체 리렌더 | `useMemo`/`memo`, Context 분할 |

#### Cloud Functions

| 항목 | 현재 | 최적화 |
|------|------|--------|
| 콜드 스타트 | 기본 설정 | `minInstances: 1` (핵심 CF만) |
| 메모리 | 대부분 기본 256MiB | CF별 적정 할당 |
| 리전 | asia-northeast3 (서울) | 유지 |

### Phase 4: 테스트 프레임워크 구축

**우선 테스트 대상**: 채점 로직, 데미지 계산, 랭킹 공식, 마일스톤, 통계 유틸
**E2E**: 회원가입→로그인, 퀴즈 풀이, 교수 퀴즈 생성, 복습, 게시판

### Phase 5: 코드 품질 + 버그 헌팅

#### 레이스 컨디션 점검

| 위험 영역 | 시나리오 | 점검 방법 |
|----------|---------|----------|
| 퀴즈 이중 제출 | 빠른 더블탭 | CF idempotency key, 클라이언트 debounce |
| EXP 동시 지급 | 퀴즈 완료 + 피드백 동시 트리거 | Firestore 트랜잭션 |
| 철권 매칭 충돌 | 3명 동시 매칭 | RTDB 트랜잭션 원자성 |
| 토끼 뽑기 동시 Claim | 같은 pendingSpin 2회 | spinLock 필드 |

## 코드 품질 기준 (비개발자 유지보수 대응)

### 핵심 원칙

1. **자기 설명적 코드**: 변수명/함수명만으로 의도를 파악 가능
2. **한국어 주석**: 복잡한 비즈니스 로직에 반드시 한국어 주석
3. **파일당 300줄 이하**: 300줄 초과 시 분리 필수 (현재 거대 파일 리팩토링 필요)
4. **단일 책임**: 한 파일/함수는 하나의 역할

### 디버깅 가이드

| 증상 | 원인 | 해결 |
|------|------|------|
| 퀴즈 제출 후 결과 안 뜸 | `recordAttempt` CF 실패 | CF 로그 확인 |
| EXP가 안 올라감 | `onQuizComplete` 트리거 미발동 | `quizResults` 문서 생성 여부 확인 |
| 토끼 뽑기 안 됨 | `lastGachaExp` 값 불일치 | users 문서의 totalExp vs lastGachaExp |
| 배틀 매칭 안 됨 | RTDB 매칭 큐 잔류 | RTDB Console → tekken/matchmaking |
| AI 문제 생성 멈춤 | Job PROCESSING 멈춤 | jobs 문서 status → FAILED로 변경 |
| 네비게이션 사라짐 | useHideNav Set 불일치 | 새로고침 (5초 주기 health check이 복구) |
| 알림 안 옴 | FCM 토큰 만료 | fcmTokens/{uid} 확인 |
| 로그인 실패 | enrolledStudents 미등록 | enrolledStudents/{courseId}/students 확인 |

### 환경별 확인

| 환경 | 확인 방법 |
|------|----------|
| 개발 | `npm run dev` → `localhost:3000` |
| Firebase Console | Firestore/Auth/Functions/RTDB 직접 확인 |
| 프로덕션 | Vercel 자동 배포 (main push) |
| CF 로그 | `firebase functions:log --only [함수명]` |
