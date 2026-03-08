# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

대학 수업 보조 앱 **"RabbiTory"**. 퀴즈 + 게시판 기능에 토끼 컨셉 게이미피케이션을 적용한 PWA.
학생은 퀴즈를 풀고 피드백을 남기며, 교수님은 문제에 대한 피드백을 수집하고 학생 참여도를 모니터링.

## 코드베이스 규모

**총 136,000+ 줄** / **390개 파일** (TypeScript + TSX)

| 영역 | 파일 수 | 코드 줄 수 | 설명 |
|------|---------|-----------|------|
| `app/` | 43 | 33,300 | Next.js App Router 페이지 |
| `components/` | 191 | 59,100 | React 컴포넌트 |
| `lib/` | 75 | 21,400 | 훅, 유틸, 컨텍스트, 타입 |
| `functions/src/` | 63 | 22,300 | Firebase Cloud Functions |

### 주요 대형 파일

| 파일 | 줄 수 | 역할 |
|------|-------|------|
| `app/(main)/review/[type]/[id]/page.tsx` | 3,815 | 복습 상세 페이지 |
| `app/(main)/review/page.tsx` | 3,491 | 복습 목록 페이지 |
| `app/(main)/quiz/page.tsx` | 2,758 | 학생 퀴즈 목록 |
| `app/(main)/professor/quiz/page.tsx` | 2,354 | 교수 퀴즈 관리 |
| `app/(main)/quiz/create/page.tsx` | 2,100 | 퀴즈 생성 페이지 |
| `app/(main)/professor/quiz/[id]/preview/page.tsx` | 1,962 | 교수 퀴즈 미리보기 |
| `components/quiz/create/QuestionEditor.tsx` | 2,521 | 문제 편집기 (풀 에디터) |
| `components/review/ReviewPractice.tsx` | 2,513 | 복습 연습 모드 |
| `components/quiz/manage/QuizStatsModal.tsx` | 2,223 | 퀴즈 통계 모달 |
| `components/professor/library/ProfessorLibraryTab.tsx` | 2,045 | 교수 서재 탭 |
| `components/common/ProfileDrawer.tsx` | 1,819 | 프로필 드로어 |
| `lib/hooks/useReview.ts` | 2,005 | 복습 데이터 훅 |
| `lib/hooks/useBoard.ts` | 1,800 | 게시판 데이터 훅 |
| `functions/src/styledQuizGenerator.ts` | 1,781 | AI 스타일 문제 생성 |
| `functions/src/studentAuth.ts` | 1,210 | 학생 인증/가입 |

### 컴포넌트 디렉토리별 규모

| 디렉토리 | 줄 수 | 주요 컴포넌트 |
|---------|-------|-------------|
| `components/quiz/` | 18,230 | QuestionEditor, QuizStatsModal, UpdateQuizModal, EditQuizSheet, OCRProcessor |
| `components/professor/` | 11,825 | ProfessorLibraryTab, PreviewQuestionCard, StudentManagement, 통계 대시보드 |
| `components/home/` | 8,151 | CharacterBox, HomeCharacter, RankingBottomSheet, AnnouncementChannel, RabbitDogam |
| `components/common/` | 6,167 | ProfileDrawer, Navigation, SwipeBack, BottomSheet, MobileBottomSheet |
| `components/review/` | 5,777 | ReviewPractice, 복습 카드 UI |
| `components/ai-quiz/` | 2,892 | AIQuizModal, AI 퀴즈 생성 UI |
| `components/board/` | 2,080 | 게시판 목록/상세/댓글 |
| `components/tekken/` | 1,560 | 철권퀴즈 배틀 UI |

### lib 디렉토리 상세

| 디렉토리 | 줄 수 | 주요 파일 |
|---------|-------|----------|
| `lib/hooks/` (31개) | 12,020 | useReview, useBoard, useProfessorQuiz, useTekkenBattle, useProfessorStats |
| `lib/utils/` | 3,735 | questionHtmlTemplate, questionDocExport, reportExport, libraryJobManager |
| `lib/contexts/` (5개) | 997 | MilestoneContext, UserContext, CourseContext, DetailPanelContext, HomeOverlayContext |

### Cloud Functions 주요 파일

| 파일 | 줄 수 | 역할 |
|------|-------|------|
| `styledQuizGenerator.ts` | 1,781 | 교수 스타일 기반 AI 문제 생성 |
| `studentAuth.ts` | 1,210 | 학번 인증, 회원가입, 교수 등록 |
| `questionParser.ts` | 1,034 | Gemini 응답 파싱 (v1) |
| `board.ts` | 992 | 게시판 CRUD + 콩콩이 자동답변 |
| `questionParserV3.ts` | 857 | Gemini 응답 파싱 (v3) |
| `gemini.ts` | 757 | Gemini API 통합 (문제 생성, 이미지 분석) |
| `workerProcessJob.ts` | 742 | AI 생성 Job 워커 (동시 최대 20) |
| `professorQuizAnalysis.ts` | 686 | 교수 출제 스타일 분석 |
| `geminiQueue.ts` | 597 | Gemini API 큐 관리 |
| `notification.ts` | 552 | FCM 푸시 알림 |
| `recordAttempt.ts` | ~500 | 퀴즈 제출 + 서버 채점 |
| `computeRankings.ts` | ~400 | 랭킹 계산 (5분 주기) |
| `rabbitGacha.ts` | ~350 | 토끼 뽑기/장착/레벨업 |
| `tekkenBattle.ts` | ~350 | 실시간 1v1 배틀 로직 |

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
| 댓글 채택됨 | 30 | acceptComment |
| 복습 연습 완료 | 25 | recordReviewPractice |
| 배틀 승리 | 30 (+연승 ×5, 최대 50) | submitAnswer |
| 배틀 패배 | 10 | submitAnswer |

**피드백 점수**: praise(+2), wantmore(+1), other(0), typo(-1), unclear(-1), wrong(-2)

**마일스톤**: 50XP마다 1 마일스톤 → `MilestoneChoiceModal` 자동 표시 → 뽑기 or 레벨업 선택

### 게시판 AI 자동답변 (콩콩이)

학술 태그(`tag === '학술'`) 게시글 작성 시 콩콩이(Gemini 2.5 Flash)가 자동으로 댓글을 생성.

**플로우**: `onPostCreate` CF → 학술 태그 확인 → 이미지 있으면 base64 변환 → 과목 키워드(`courseScopes`) 로드 → Gemini API 호출 → `comments` 컬렉션에 저장 + `commentCount` 증가

**대댓글 자동 응답**: 사용자가 콩콩이 댓글에 대댓글 → `onCommentCreate` CF가 감지 → 원본 글 + 이전 대화 맥락을 포함해 Gemini API 호출 → 대댓글로 자동 응답 (스팸 방지: 같은 부모에 2분 내 AI 대댓글 제한)

**콩콩이 말투**: 20대 한국 여자 반말, 이모지/이모티콘 절대 금지, `maxOutputTokens: 2048`

**AI 댓글 데이터**:
- `authorId: 'gemini-ai'`, `authorNickname: '콩콩이'`, `isAIReply: true`
- 기존 comment 스키마 준수
- `onCommentCreate`에서 `authorId === 'gemini-ai'`이면 EXP 지급 + 알림 스킵

**이미지 처리**: `post.imageUrls` 존재 시 각 URL → fetch → base64 → Gemini `inlineData`로 통합 전송

### 게시판 댓글 채택

글 작성자가 댓글 중 하나를 채택하는 기능.

**조건**: 루트 댓글만 (대댓글 불가), 본인 댓글/AI 댓글 채택 불가, 글당 1회만
**플로우**: `acceptComment` onCall CF → 트랜잭션으로 `post.acceptedCommentId` + `comment.isAccepted` 설정 → 채택자에게 30 EXP + 알림
**UI**: 상세 페이지 댓글 상단에 두꺼운 검은색 박스(`border-[3px] #1A1A1A`)로 표시, 목록 미리보기에서도 채택 댓글 최상단

### 게시글 삭제

`deletePost` onCall CF로 처리 (Admin SDK). 클라이언트에서 타인 댓글 삭제 권한이 없으므로 서버에서 글 + 모든 댓글을 배치 삭제.

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
- `QuestionList`(드래그 리오더) + `QuestionEditor`(풀 에디터) 방식 — preview 페이지와 동일
- 메타 편집: 제목, 시험유형(4버튼), 난이도(3버튼), 총평, 태그 (외곽 박스 없음)
- 취소/저장 버튼: 필터 행(`자작/서재/커스텀`) 우측에 배치 (`onEditStateChange` 콜백)
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

**봇**: 60% 정답률, 1~8초 응답 시간, 10개 닉네임 풀, 레벨 3~7

**난이도 배분**: 10문제 = easy 4 + medium 4 + hard 2 (순서대로 점점 어려워짐)
- easy: 4지선다, 명확한 개념 문제
- medium: 5지선다, 유사 개념 포함
- hard: 5지선다, 모든 선지가 매력적인 함정

**문제 풀**: 매일 새벽 3시 → 현재 학기 과목만 과목당 300문제 보충 (easy 120 + medium 120 + hard 60)
- 1학기: biology + microbiology, 2학기: biology + pathophysiology
- seenQuestions로 24시간 중복 방지

**챕터 범위 설정**: 교수가 ProfileDrawer Settings → GlassModal에서 과목별 챕터 선택
- Firestore 경로: `settings/tekken/courses/{courseId}` → `{ chapters: string[] }`
- 저장 시 다음 새벽 문제 생성부터 적용
- 기본값: biology `1~6`, microbiology `1~5`, pathophysiology `3~11`

**교수 스타일 반영**: `professorQuizAnalysis/{courseId}/data/`의 styleProfile(출제 톤, 함정 패턴) + keywords(핵심 개념, 임상 키워드)를 프롬프트에 주입

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
2. 첫 시도 90%+ & 재시도 없음 → 개선 불필요(0)로 카운트 (만점 학생 페널티 방지)
3. 첫 시도 < 90% & 재시도 없음 → 스킵 (아직 성장 활동 없음)
4. 평균 개선율 계산
5. 스케일 변환: growth = max(0, min(100, 50 + avgImprovement / 2))
   - 50 = 변화 없음 기준선
   - 퀴즈 데이터 없거나 전부 저점수+미재시도 = 0
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

- `html { background-color: #F5F0E8 }` — 아이폰 둥근 모서리 뒤 배경
- **상단 (노치/다이내믹 아일랜드)**: `data-main-content`에 `paddingTop: env(safe-area-inset-top)` 적용
- 각 페이지 **Header/헤더**에서 `marginTop: -env(safe-area-inset-top)` + `paddingTop: env(safe-area-inset-top)` 패턴
  → 배경은 노치 뒤까지 확장, 콘텐츠만 노치 아래
- **하단 (홈 인디케이터)**: Navigation `<nav>`에 `paddingBottom: env(safe-area-inset-bottom)` 적용
  → 필(pill)이 safe area 위에 위치, safe area 영역에는 페이지 콘텐츠가 비쳐 보임
- 콘텐츠 영역 paddingBottom: `calc(4.25rem + env(safe-area-inset-bottom))` (네비 + safe area)

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

## 프로젝트 구조

```
├── app/                        # Next.js App Router
│   ├── (auth)/                 # 인증 라우트 (login, signup, forgot-password, verify-email)
│   ├── (main)/                 # 보호된 메인 라우트 (Provider 계층 적용)
│   │   ├── layout.tsx          # Provider 계층 + 3패널 가로모드 레이아웃
│   │   ├── page.tsx            # 홈 (학생)
│   │   ├── quiz/               # 퀴즈 목록/풀이/결과/피드백
│   │   ├── review/             # 복습 모드
│   │   ├── board/              # 게시판
│   │   ├── ranking/            # 랭킹
│   │   ├── professor/          # 교수 대시보드/통계/퀴즈관리/학생관리
│   │   └── profile/, settings/ # 프로필, 설정
│   └── api/                    # API 라우트 (convert-pptx)
├── components/                 # React 컴포넌트 (~209개 파일)
│   ├── ai-quiz/                # AI 퀴즈 생성 UI
│   ├── board/                  # 게시판
│   ├── common/                 # 공통 (SwipeBack, Navigation, BottomSheet 등)
│   ├── home/                   # 홈 (AnnouncementChannel, RabbitDogam 등)
│   ├── professor/              # 교수 대시보드
│   ├── quiz/                   # 퀴즈 풀이/생성
│   ├── review/                 # 복습
│   └── tekken/                 # 철권퀴즈 배틀
├── lib/                        # 유틸리티, 훅, 컨텍스트
│   ├── firebase.ts             # Firebase 초기화
│   ├── auth.ts                 # 인증 유틸
│   ├── contexts/               # React Context (User, Course, Theme, Milestone, HomeOverlay, DetailPanel)
│   ├── hooks/                  # 커스텀 훅 31개 (useAuth, useQuiz*, useProfessor*, useTekkenBattle 등)
│   ├── utils/                  # 유틸 (ranking, scoring, expRewards, tekkenDamage 등)
│   └── types/                  # 타입 정의 (course.ts, tekken.ts)
├── functions/                  # Firebase Cloud Functions (Node 20, 별도 tsconfig)
│   └── src/                    # CF 소스 (~48개 .ts 파일)
│       ├── index.ts            # CF 엔트리 (모든 함수 export)
│       ├── recordAttempt.ts    # 퀴즈 제출 + 채점
│       ├── tekkenBattle.ts     # 실시간 배틀 로직
│       ├── gemini.ts           # Gemini API 통합
│       ├── rabbitGacha.ts      # 토끼 뽑기
│       └── computeRankings.ts  # 랭킹 계산
├── styles/themes/              # 테마 상수 + ThemeProvider
├── public/                     # 정적 에셋 (rabbit/ 80개, icons/, animations/)
├── firestore.rules             # Firestore 보안 규칙
├── firestore.indexes.json      # Firestore 복합 인덱스
├── database.rules.json         # Realtime Database 규칙
└── storage.rules               # Cloud Storage 규칙
```

### 주요 설정 파일

| 파일 | 역할 |
|------|------|
| `next.config.mjs` | Turbopack, PWA, 이미지 최적화, 번들 분석 |
| `tailwind.config.ts` | `wide:` 커스텀 스크린, 빈티지 테마 색상, 폰트 |
| `tsconfig.json` | `@/*` 경로 별칭 → 프로젝트 루트, strict 모드 |
| `.eslintrc.json` | `next/core-web-vitals` 단순 확장 |
| `firebase.json` | Firestore/RTDB/Functions/Storage 배포 설정 |
| `functions/tsconfig.json` | CF 전용 (noUnusedLocals, noImplicitReturns 추가) |

### 환경 변수 (.env.local)

```
NEXT_PUBLIC_FIREBASE_API_KEY, AUTH_DOMAIN, PROJECT_ID, STORAGE_BUCKET,
MESSAGING_SENDER_ID, APP_ID, MEASUREMENT_ID, VAPID_KEY, DATABASE_URL
NEXT_PUBLIC_CLOUD_RUN_PPTX_URL  # Cloud Run PPTX 변환 서비스
```

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
