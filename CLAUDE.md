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
- **Framer Motion** 11 (페이지 전환, UI 애니메이션, 제스처)
- **Lottie React** 2.4 (퀴즈 결과 연출)
- **next-pwa** 5.6 (PWA 서비스 워커, FCM 통합)
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
- **Gemini API** (gemini-2.5-flash) — AI 문제 생성, 이미지 분석, 철권퀴즈 문제, 콩콩이 자동답변
- **Claude API** (claude-sonnet-4-20250514) — 월별 리포트 인사이트

### 배포
- **Vercel** — 프론트엔드 (PWA, git push시 자동 배포)
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
                          └── DetailPanelProvider (가로모드 우측 패널)
                              └── SwipeBack + Navigation + children
```

### 상태 관리 패턴

- **전역 상태**: React Context 6개 (User, Course, Theme, HomeOverlay, Milestone, DetailPanel) — Redux/Zustand 미사용
- **서버 데이터**: Firestore `onSnapshot`으로 실시간 동기화 (커스텀 훅)
- **로컬 상태**: 컴포넌트 `useState`/`useReducer`
- **인증 상태**: Firebase `onAuthStateChanged` → `useAuth()` 훅
- **캐시**: sessionStorage SWR (랭킹 2분/10분, 레이더 2분/10분), 모듈 Map (교수 통계 5분)
- **오프라인**: Firestore `persistentLocalCache` + `persistentMultipleTabManager`

### 주요 대형 파일 (수정 시 주의)

| 파일 | 역할 | 비고 |
|------|------|------|
| `components/review/ReviewPractice.tsx` | 복습 연습 모드 | 40K+ 토큰, 3단계 플로우 |
| `components/quiz/create/QuestionEditor.tsx` | 문제 편집기 | 34K+ 토큰, 6종 보기 타입 |
| `lib/hooks/useReview.ts` | 복습 데이터 훅 | 1700줄+, 5종 리뷰 타입 |
| `lib/hooks/useBoard.ts` | 게시판 데이터 훅 | CRUD + AI 댓글 |
| `components/home/CharacterBox.tsx` | 토끼 캐러셀 + 배틀진입 | 664줄 |
| `app/(main)/quiz/page.tsx` | 학생 퀴즈 목록 | 뉴스캐러셀 |
| `app/(main)/review/page.tsx` | 복습 목록 | 필터 5종 |
| `functions/src/styledQuizGenerator.ts` | AI 스타일 문제 생성 | 교수 스타일 반영 |
| `functions/src/recordAttempt.ts` | 퀴즈 제출 서버 채점 | 분산 쓰기 |
| `functions/src/board.ts` | 게시판 트리거 | AI 자동답변 |

### Firestore 컬렉션 구조

| 컬렉션 | 용도 | 쓰기 |
|--------|------|------|
| `users/{uid}` | 프로필, EXP, 토끼 | 일부 CF 전용 |
| `users/{uid}/expHistory` | EXP 지급 기록 | CF 전용 |
| `users/{uid}/rabbitHoldings` | 토끼 보유 | CF 전용 |
| `quizzes/{id}` | 퀴즈 데이터 + 문제 | 클라이언트+CF |
| `quizResults/{id}` | 제출 결과 (append-only) | CF 전용 |
| `quiz_completions/{quizId}_{userId}` | 완료 여부 | CF 전용 |
| `quiz_agg/{quizId}/shards/{N}` | 분산 카운터 (참여자/점수) | CF 전용 |
| `quiz_submit_locks/{userId}_{quizId}` | 제출 락 (60초 TTL) | CF 전용 |
| `reviews/{id}` | 오답/찜/복습 | 클라이언트+CF |
| `posts/{id}` | 게시글 | 클라이언트 |
| `comments/{id}` | 댓글 | 클라이언트+CF |
| `feedbacks/{id}` | 퀴즈 피드백 | 클라이언트 |
| `rabbits/{courseId}_{rabbitId}` | 토끼 도감 | CF 전용 |
| `rankings/{courseId}` | 랭킹 (사전계산) | CF 전용 |
| `radarNorm/{courseId}` | 레이더 (사전계산) | CF 전용 |
| `jobs/{jobId}` | AI 문제 생성 작업 | CF 전용 |
| `tekkenQuestionPool/{courseId}/questions` | 배틀 문제 풀 | CF 전용 |
| `tekkenQuestionPool/{courseId}/seenQuestions` | 배틀 기록 | CF 전용 |
| `settings/semester` | 학기 설정 | 교수 |
| `settings/tekken/courses/{courseId}` | 배틀 챕터 범위 | 교수 |
| `enrolledStudents/{courseId}/students` | 학번 사전 등록 | 교수 |
| `notifications/{id}` | 알림 | CF 전용 |
| `announcements/{id}` | 공지사항 | CF 전용 |
| `courseScopes/{courseId}` | 과목 키워드/범위 | CF 전용 |
| `professorQuizAnalysis/{courseId}` | 교수 스타일 분석 | CF 전용 |

### RTDB 경로 (철권퀴즈 전용)

| 경로 | 용도 |
|------|------|
| `tekken/matchmaking/{courseId}` | 매칭 큐 |
| `tekken/battles/{battleId}` | 배틀 진행 상태 |
| `tekken/battleAnswers/{battleId}/{round}` | 정답 (보안 분리) |
| `tekken/streaks/{userId}` | 연승 기록 |
| `tekken/pregenQuestions/{courseId}_{userId}` | 사전 생성 문제 캐시 |

## Cloud Functions 맵

### onCall (클라이언트 직접 호출)

| CF | 목적 | 보안 |
|----|------|------|
| `recordAttempt` | 퀴즈 서버 채점 + 분산 쓰기 | 제출 락 + rate limit + idempotency |
| `recordReviewPractice` | 복습 연습 완료 기록 + EXP | 제출 락 + 중복 보상 방지 |
| `acceptComment` | 댓글 채택 + 30 EXP | 글당 1회, 본인/AI 불가 |
| `deletePost` | 게시글 + 댓글 배치 삭제 | 작성자/교수만 |
| `enqueueGenerationJob` | AI 문제 생성 Job 등록 | rate limit (일 15회) |
| `workerProcessJob` | Job 비동기 처리 (Gemini) | 동시 최대 20 |
| `spinRabbitGacha` | 토끼 뽑기 Roll | spinLock + pendingSpin |
| `claimGachaRabbit` | 토끼 뽑기 Claim | pendingSpin 검증 |
| `equipRabbit` / `unequipRabbit` | 토끼 장착/해제 | 보유 확인 |
| `levelUpRabbit` | 토끼 레벨업 | 마일스톤 차감 |
| `joinMatchmaking` | 배틀 매칭 + 방 생성 | 봇 폴백 |
| `submitAnswer` | 배틀 답변 제출 + 채점 | scored 트랜잭션 |
| `registerStudent` | 회원가입 | enrolledStudents 확인 |
| `generateMonthlyReport` | 월별 리포트 (Claude API) | 교수만 |

### onDocumentCreated (Firestore 트리거)

| CF | 트리거 | 동작 |
|----|--------|------|
| `onQuizComplete` | `quizResults` 생성 | 점수별 EXP 지급 |
| `onQuizCreate` | `quizzes` 생성 | 커스텀 50 / AI 25 EXP |
| `onPostCreate` | `posts` 생성 | 15 EXP + 학술태그→콩콩이 |
| `onCommentCreate` | `comments` 생성 | 15 EXP + AI 대댓글 |
| `onFeedbackSubmit` | `feedbacks` 생성 | 15 EXP |
| `generateReviewsOnResult` | `quizResults` 생성 | 오답 reviews 자동 생성 |

### onSchedule (스케줄)

| CF | 주기 | 목적 |
|----|------|------|
| `tekkenPoolRefillScheduled` | 매일 03:00 KST | 과목당 300문제 생성 |
| `computeRankingsScheduled` | 5분마다 | 개인/팀 랭킹 |
| `computeRadarNormScheduled` | 10분마다 | 6축 레이더 정규화 |
| `collectWeeklyStatsScheduled` | 매주 월 00:00 | 주별 통계 |
| `cleanupRateLimitsScheduled` | 매시간 | rate limit 기록 정리 |
| `februaryTransition` | 2월 22일 | 학기 전환 (1→2학기) |
| `augustTransition` | 8월 22일 | 학기 전환 (2→1학기) |

## 퀴즈 시스템

**문제 유형** (`QuestionType`): `'ox' | 'multiple' | 'short_answer' | 'essay' | 'combined'`

| 유형 | 답안 형식 | 비고 |
|------|----------|------|
| OX | 0\|1 | |
| 객관식 | number (0-indexed), 복수정답: number[] | 2~8개 선지 |
| 단답형 | string, 복수정답: `\|\|\|` 구분 | case-insensitive |
| 서술형 | 수동 루브릭 채점 (EssayGrading.tsx) | 교수 전용 |
| 결합형 | 공통 지문/이미지 + 하위 N문제 (OX/객관식/단답) | N문제 = N점 |

**answer 인덱싱**: **모두 0-indexed** (통일됨)

**퀴즈 풀이 → 결과 플로우**:
1. `/quiz/[id]` 풀이 (로컬 state에 답안 저장)
2. 제출 → CF `recordAttempt` (서버 채점 + 분산 쓰기)
3. `/quiz/[id]/result` 결과 → `/quiz/[id]/feedback` 피드백 → `/quiz/[id]/exp` EXP

**recordAttempt 보안 3중 방어**:
1. 클라이언트 `useRef` guard (React StrictMode 중복 호출 방지)
2. 서버 `quiz_submit_locks` 트랜잭션 (60초 TTL, 동시 제출 차단)
3. `rateLimitV2` (분당 3회)
4. `quiz_completions` 체크 (이미 완료된 퀴즈 재진입 방지)

**채점**: `functions/src/utils/gradeQuestion.ts` (OX/객관식/단답 서버 채점, 서술형 제외)

**분산 쓰기** (recordAttempt):
- `quizResults` (append-only log)
- `quiz_completions/{quizId}_{userId}` (merge)
- `quiz_agg/{quizId}/shards/{N}` (10개 분산 카운터)
- `users/{uid}.quizStats` (증분 갱신)

## EXP 보상 체계

**서버 상수**: `functions/src/utils/gold.ts` → `EXP_REWARDS`
**클라이언트 상수**: `lib/utils/expRewards.ts` (UI 표시용, 서버와 동기화 필요)

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
| 배틀 승리 | 30 (+연승×5, 최대 50) | endBattle |
| 배틀 패배/무승부 | 10 | endBattle |

**EXP 지급 패턴**: `readUserForExp()` → `addExpInTransaction()` → `users/{uid}/expHistory` 자동 기록
**마일스톤**: 50XP마다 1 마일스톤 → `MilestoneChoiceModal` 자동 표시 (600ms 지연) → 뽑기 or 레벨업

## 게시판 시스템

### AI 자동답변 (콩콩이)
학술 태그(`tag === '학술'`) 게시글 작성 시 콩콩이(Gemini 2.5 Flash)가 자동 댓글 생성.
- `onPostCreate` CF → 학술 태그 확인 → 이미지 base64 변환 → courseScopes 키워드 로드 → Gemini 호출
- `authorId: 'gemini-ai'`, `authorNickname: '콩콩이'`, `isAIReply: true`
- 대댓글 자동 응답: 사용자가 콩콩이 댓글에 대댓글 → AI 자동 대댓글 (스팸 방지: 2분 내 1회)
- 말투: 20대 한국 여자 반말, 이모지 절대 금지, `maxOutputTokens: 2048`

### 댓글 채택
글 작성자가 루트 댓글 1개 채택. 본인/AI 불가, 글당 1회만.
`acceptComment` CF → 트랜잭션 → 채택자에게 30 EXP + 알림.

## AI 문제 생성 시스템

**교수 서재 플로우** (ProfessorLibraryTab → workerProcessJob):
1. 프롬프트 입력 + 난이도 슬라이더 + **챕터 태그 필수 선택**
2. `enqueueGenerationJob` CF → `jobs/{jobId}` (status: QUEUED)
3. `workerProcessJob` 자동 트리거 (동시 최대 20)
4. styleProfile + scope + focusGuide 병렬 로드 → Gemini API 호출
5. HARD 난이도: Gemini Vision 영역 분석 + 이미지 자동 크롭
6. 완료 → `LibraryJobToast` 표시 (다른 페이지에서도)

**학생 AI 퀴즈**: AIQuizContainer 플로팅 버튼 → 태그 선택 → 같은 CF 호출

**서재 퀴즈 수정 모드**:
- `convertToQuestionDataList` → `flattenQuestionsForSave` 라운드트립 (0-indexed 통일)
- `...(originalQ || {})` spread로 `choiceExplanations` 등 미편집 필드 보존

## 토끼 시스템

**2단계 뽑기**:
1. `spinRabbitGacha` (Roll): 50XP 마일스톤 → 랜덤 토끼(0~79) 선택, pendingSpin 저장
2. `claimGachaRabbit` (Claim): 발견 (이름 짓기, 영구 소유)

**장착**: 최대 2마리 (`equipRabbit` slotIndex 0|1), 뽑기 시 빈 슬롯 자동 장착
**기본 토끼 (#0)**: 온보딩 완료 시 자동 지급 (`onOnboardingComplete`)
**레벨업**: `levelUpRabbit` CF → level+1, HP/ATK/DEF 각 1~3 랜덤 증가
**도감**: 최초 발견자(금색) 표시, `rabbits/{courseId}_{rabbitId}` 문서
**스탯**: 80마리 고유 기본값 룩업 테이블 (`utils/rabbitStats.ts`)

**rabbitId ↔ 파일명**: rabbitId 0~79 (0-indexed), 파일명 001~080 (1-indexed)
- `getRabbitImageSrc(rabbitId)` → `/rabbit/rabbit-{id+1}.png`
- `getRabbitProfileUrl(rabbitId)` → `/rabbit_profile/rabbit-{id+1}-pf.png`

## 철권퀴즈 (배틀 퀴즈)

실시간 1v1 토끼 배틀. **Firebase Realtime Database** 사용.

**플로우**: 매칭(30초, 봇 폴백) → countdown(3-2-1) → question(20초) → 양쪽정답시 mash(연타) → roundResult → ... → finished(KO or 문제 소진)

**데미지 공식**: `baseDamage = max(ceil(ATK²/(ATK+DEF)×1.5), 2)`
- 크리티컬(5초 이내 정답): baseDamage × 1.5
- 양쪽 모두 오답: MUTUAL_DAMAGE = 10 (양쪽 동시 피해)

**봇**: 40% 정답률, 1~8초 응답 시간, 10개 닉네임 풀, 레벨 3~7

**난이도 배분**: 10문제 = easy 5 + medium 5 (hard 제거)

**문제 풀**: 매일 새벽 3시 → 현재 학기 과목만 과목당 300문제 (easy 150 + medium 150)
- 1학기: biology + microbiology, 2학기: pathophysiology만
- 해설 필수 (explanation + choiceExplanations 없는 문제 필터링)
- seenQuestions 24시간 중복 방지, 5문제 미만 시 기록 초기화
- 챕터1 예산: 4문제만 (과목별 역사/개론 비중 축소)

**chapterId 매핑**: 풀 저장은 순수 번호("2"), 클라이언트는 접두사 형식("bio_2", "micro_2")
- `drawQuestionsFromPool`에서 자동 변환: biology→`bio_`, microbiology→`micro_`, pathophysiology→`patho_`

**챕터 범위 설정**: `settings/tekken/courses/{courseId}` → `{ chapters: string[] }`
- 기본값: biology `1~6`, microbiology `1~11`, pathophysiology `3~11`(6 제외)

**배틀 오답 저장**: `reviews` 컬렉션 (`reviewType: "wrong"`) + `chapterId` + `choiceExplanations` + `explanation`

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

### 랭킹 — `computeRankings.ts` (5분마다 사전 계산)

**개인**: `profCorrectCount × 4 + totalExp × 0.6`
**팀**: `normalizedAvgExp × 0.4 + avgCorrectRate × 0.4 + avgCompletionRate × 0.2`
동점 처리: 같은 순위 부여 (1위, 1위, 3위)
**테스트 계정 배제**: biology 닉네임 "빠샤" / microbiology 닉네임 "test"

### 교수 통계 대시보드 — `professor/stats/page.tsx`

**위험 학생**: Z-score < -1.5 → 주의, < -2 → 위험
**학생 군집** (medianExp 기준, 정답률 50% 기준):
- passionate (EXP↑ 정답률↑), hardworking (EXP↑ 정답률↓), efficient (EXP↓ 정답률↑), atRisk (EXP↓ 정답률↓)
**변별도**: 참여자 ≥ 4명, 상위 27% 정답률 - 하위 27% 정답률

### 캐시 전략

| 캐시 | 위치 | TTL | 패턴 |
|------|------|-----|------|
| 랭킹 | sessionStorage | 2분 fresh / 10분 max | SWR |
| 레이더 정규화 | sessionStorage | 2분 fresh / 10분 max | SWR |
| 교수 통계 | 모듈 Map | 5분 | stale-while-revalidate |
| Firestore 오프라인 | IndexedDB | persistentLocalCache | 멀티탭 |

## UI 테마 시스템

### 빈티지 신문 스타일 (공통)
- 배경 #F5F0E8(크림), 보조 #EBE5D9, 카드 #FDFBF7
- 텍스트 #1A1A1A, 음소거 #5C5C5C
- 테두리 #D4CFC4(밝은) / #1A1A1A(진한)
- 그림자 `box-shadow: 4px 4px 0px #1A1A1A`

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
- **Playfair Display** — 빈티지 헤더 (`.font-serif-display`)
- **Cormorant Garamond** — 우아한 세리프 (`.font-serif-elegant`)

## 반응형 레이아웃

### 3패널 가로모드 (landscape + 1024px 이상)

```
┌──────────┬─────────────────┬──────────────────┐
│ 사이드바  │   메인 콘텐츠    │   디테일 패널     │
│ (프로필   │  (세로모드와     │  (라우트 사이드바  │
│  + 네비)  │   동일 배치)     │   또는 Context)  │
│  블랙    │                 │                  │
│  글래스   │                 │                  │
└──────────┴─────────────────┴──────────────────┘
```

- `useWideMode()` — 가로모드 감지 (100ms 디바운스)
- Tailwind: `wide: { raw: '(orientation: landscape) and (min-width: 1024px)' }`
- CSS 변수: `--modal-left`, `--detail-panel-left`, `--home-sheet-left`

### 라우트 기반 사이드바 (자동 분할)
- `/quiz/[id]/*` → QuizListSidebar (좌) + 퀴즈 페이지 (우)
- `/board/[id]/*` → BoardListSidebar (좌) + 게시판 페이지 (우)
- `/review/[type]/[id]`, `/review/random` → ReviewListSidebar (좌) + 복습 페이지 (우)
- `/professor/quiz/[id]/preview` → QuizListSidebar (좌) + 미리보기 (우)

### 네비게이션
**학생** (4탭): `/`(홈), `/quiz`, `/review`, `/board`
**교수** (5탭): `/professor`, `/professor/stats`, `/professor/quiz`, `/professor/students`, `/board`
**숨김**: 퀴즈 풀이, 상세 페이지, 편집 등에서 자동 숨김 (useHideNav + MutationObserver + 5초 health check)

## Safe Area / SwipeBack / PWA

**Safe Area**: `env(safe-area-inset-top/bottom)` 처리, `html { background-color: #F5F0E8 }`
**SwipeBack**: 왼쪽 25px 가장자리 스와이프 → `router.back()`, 화면 35% 초과 or velocity > 500
**PWA**: viewport-fit: cover, standalone, orientation: any, skipWaiting: true, FCM customWorkerDir: `worker`

## 과목 시스템

| 과목 ID | 이름 | 학년/학기 | 챕터 접두사 |
|---------|------|----------|-----------|
| `biology` | 생물학 | 1학년 1학기 | `bio_` |
| `pathophysiology` | 병태생리학 | 1학년 2학기 | `patho_` |
| `microbiology` | 미생물학 | 2학년 1학기 | `micro_` |

- 학기 자동 판별: 02-22~08-21 → 1학기, 08-22~02-21 → 2학기
- 챕터 인덱스: `lib/courseIndex.ts` (클라이언트), `functions/src/styledQuizGenerator.ts` (서버, 별도 복사)
- 태그 형식: `"12_신경계"` (value) → `"#12_신경계"` (표시)

## 인증 시스템

**학번+비밀번호**: 학번 `20230001` → `20230001@rabbitory.internal` (Firebase Auth)
- `registerStudent` CF가 enrolledStudents 확인 후 계정 생성
- 학번당 1개 계정만 (isRegistered 플래그)
- 교수: `@ccn.ac.kr` 도메인 → 자동 교수 경로
- Middleware 없음 — `useRequireAuth()` 훅으로 클라이언트 리다이렉트

## 코딩 컨벤션

- 응답/주석/커밋/문서: 한국어
- 변수명/함수명: 영어
- 들여쓰기: 2칸
- 컴포넌트: React 함수형 + TypeScript
- 경로 별칭: `@/*` → 프로젝트 루트
- 패널/박스/태그: `bg-[#F5F0E8]` + `border-2 border-[#1A1A1A]` 통일

## Firestore Security Rules 보호 필드

`totalExp`, `rank`, `role`, `badges`, `equippedRabbits`, `totalCorrect`, `totalAttemptedQuestions`, `professorQuizzesCompleted`, `lastGachaExp`, `spinLock` — Cloud Functions에서만 수정 가능

## Firebase 배포

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
firebase deploy --only database   # RTDB rules
firebase deploy --only storage    # Storage rules
```

## 디버깅 가이드

| 증상 | 원인 | 해결 |
|------|------|------|
| 퀴즈 제출 후 결과 안 뜸 | `recordAttempt` CF 실패 | CF 로그 + quiz_submit_locks 확인 |
| EXP가 안 올라감 | `onQuizComplete` 트리거 미발동 | `quizResults` 문서 생성 여부 확인 |
| 퀴즈 중복 제출 | quiz_submit_locks 락 만료 | 60초 TTL 확인, rate limit 로그 |
| 토끼 뽑기 안 됨 | `lastGachaExp` 값 불일치 | users.totalExp vs lastGachaExp |
| 배틀 매칭 안 됨 | RTDB 매칭 큐 잔류 | RTDB Console → tekken/matchmaking |
| 배틀 오답 미분류 | chapterId 접두사 누락 | drawQuestionsFromPool 접두사 로직 확인 |
| AI 문제 생성 멈춤 | Job PROCESSING 멈춤 | jobs 문서 status → FAILED로 변경 |
| 네비게이션 사라짐 | useHideNav Set 불일치 | 새로고침 (5초 health check 복구) |
| 알림 안 옴 | FCM 토큰 만료 | fcmTokens/{uid} 확인 |
| 로그인 실패 | enrolledStudents 미등록 | enrolledStudents/{courseId}/students 확인 |
| 해설 없는 배틀 문제 | 문제 풀 필터링 실패 | tekkenQuestionPool saveQuestions 로그 확인 |
