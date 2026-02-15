# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

대학 수업 보조 앱 "RabbiTory". 퀴즈 + 게시판 기능에 토끼 컨셉 게이미피케이션을 적용한 PWA.
학생은 퀴즈를 풀고 피드백을 남기며, 교수님은 문제에 대한 피드백을 수집하고 학생 참여도를 모니터링.

## 기술 스택

- **Frontend**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS
- **애니메이션**: Framer Motion (페이지 전환, UI), Lottie (캐릭터)
- **Backend**: Firebase (Auth, Firestore, Cloud Functions, Cloud Messaging, Storage)
- **OCR**: Tesseract.js, pdfjs-dist
- **AI**: Gemini API (문제 생성, 이미지 분석), Claude API (서술형 채점)
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

### 환경 변수

프론트엔드: `.env.local` 파일 (`.env.local.example` 참고)
- `NEXT_PUBLIC_FIREBASE_*` — Firebase 프로젝트 설정
- `NEXT_PUBLIC_NAVER_CLIENT_ID` — 네이버 OAuth (선택)

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
          └── ThemeProvider (반별 CSS 변수 적용)
              └── NotificationProvider + ExpToastProvider
                  └── MainLayoutContent
                      ├── Navigation (퀴즈 풀이/수정 페이지에서 숨김)
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

### Cloud Functions 모듈 (`functions/src/`)

| 모듈 | 역할 |
|------|------|
| `recordAttempt.ts` | 퀴즈 제출 + 서버사이드 채점 + 분산 쓰기 |
| `quiz.ts` | 퀴즈 완료 시 EXP 지급, 통계 업데이트 |
| `feedback.ts` | 피드백 저장 + EXP 지급 |
| `board.ts` | 게시판 글/댓글/좋아요 + EXP 지급 |
| `notification.ts` | FCM 푸시 알림 |
| `essay.ts` | AI 보조 채점 (Claude API 연동) |
| `styledQuizGenerator.ts` | 교수 출제 스타일 학습 → AI 문제 생성 (Gemini) |
| `imageRegionAnalysis.ts` | Gemini Vision 이미지 영역 감지 |
| `imageCropping.ts` | 이미지 크롭 → Firebase Storage 업로드 |
| `pptx.ts` | PPTX 업로드 → Cloud Run 트리거 |
| `rabbitGacha.ts` | 토끼 뽑기 2단계 (spinRabbitGacha → claimGachaRabbit) |
| `rabbitButler.ts` | 토끼 집사 시스템 (이름짓기, 졸업, 놓아주기, 장착) |
| `migrateCharacters.ts` | 레거시 캐릭터 → 토끼 시스템 마이그레이션 |

## UI 테마 시스템

### 빈티지 신문 스타일 (기본)

- **배경**: #F5F0E8 (크림), **보조 배경**: #EDEAE4
- **텍스트**: #1A1A1A (검정), **음소거**: #5C5C5C
- **성공**: #1A6B1A, **오류**: #8B1A1A
- **둥근 모서리 없음** (`rounded-none`)

### CSS 변수 기반 테마

ThemeProvider가 반(A/B/C/D)에 따라 `<html>`에 CSS 변수 설정:
```css
--theme-background, --theme-background-secondary
--theme-accent, --theme-accent-light
--theme-text, --theme-text-secondary, --theme-border
```

Tailwind에서 `bg-theme-background`, `text-theme-accent` 등으로 사용 (`tailwind.config.ts`에 정의)

### 반별 테마 색상

| 반 | 메인 배경 | 강조색 | 온보딩 아이콘 |
|---|----------|--------|-------------|
| A | #4A0E0E (버건디) | #D4AF37 (골드) | #EF4444 (빨강) |
| B | #F5E6C8 (크림) | #3D2B1F (브라운) | #EAB308 (노랑) |
| C | #0D3D2E (에메랄드) | #C0C0C0 (실버) | #22C55E (초록) |
| D | #1A2744 (네이비) | #CD7F32 (브론즈) | #3B82F6 (파랑) |

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

### 토끼 뽑기/집사 시스템

**2단계 뽑기 (Roll → Claim):**
1. `spinRabbitGacha` (Roll): 50XP 마일스톤마다 랜덤 토끼(0~99) 선택, `lastGachaExp` 갱신만 수행
2. `claimGachaRabbit` (Claim): 사용자 선택에 따라 입양/놓아주기
   - 미발견 토끼 → 집사되기 (이름 짓기)
   - 발견된 토끼 → n세대로 데려오기
   - 보유 3마리 초과 시 → 교체 모달 (replaceKey)

**핵심 데이터 모델:**
- `users/{uid}` 필드: `ownedRabbitKeys: string[]` (max 3, `"courseId_rabbitId"` 형식), `equippedRabbitId`, `equippedRabbitCourseId`, `lastGachaExp`
- `rabbits/{courseId_rabbitId}`: 토끼 문서 (집사 역사, 보유자 수, 승계 큐)
- `users/{uid}/rabbitHoldings/{courseId_rabbitId}`: 보유 정보 (세대, 집사 여부)
- `rabbit_successors/{courseId_rabbitId}`: 집사 승계 큐

**관련 파일:**
- CF: `functions/src/rabbitGacha.ts`, `functions/src/rabbitButler.ts`
- 훅: `lib/hooks/useRabbit.ts` (useRabbitHoldings, useRabbitDoc, useRabbitsForCourse)
- UI: `components/home/CharacterBox.tsx` (홈 히어로), `GachaResultModal.tsx`, `RabbitReplaceModal.tsx`, `RabbitDogam.tsx`, `MyRabbitsDrawer.tsx`
- 유틸: `lib/utils/rabbitDisplayName.ts`

### 캐릭터/게이미피케이션

- 토끼 캐릭터 커스터마이징: 머리스타일, 피부색, 수염
- 시즌 전환(중간→기말): 토끼 보유 초기화, 외형/뱃지는 유지

### AI 문제 생성 (`generateStyledQuiz`)

교수 출제 스타일을 학습하여 난이도별 문제 생성:
- **쉬움**: OX/객관식
- **보통**: 객관식 + 제시문
- **어려움**: 객관식 + 제시문 + ㄱㄴㄷ 보기 + 이미지 자동 크롭 (Gemini Vision)

관련: `functions/src/styledQuizGenerator.ts`, `functions/src/imageRegionAnalysis.ts`, `components/ai-quiz/AIQuizContainer.tsx`

## 알려진 제약 및 주의사항

### Firestore Security Rules

클라이언트에서 사용자 문서 업데이트 시 보호 필드 포함 금지:
```javascript
// ❌ Security Rules에서 거부됨
await setDoc(doc(db, 'users', uid), { totalExp: 0, rank: '견습생' }, { merge: true });

// ✅ 허용된 필드만 사용
await setDoc(doc(db, 'users', uid), { onboardingCompleted: true, updatedAt: serverTimestamp() }, { merge: true });
```

보호 필드: `totalExp`, `rank`, `role`, `badges`, `ownedRabbitKeys`, `equippedRabbitId`, `equippedRabbitCourseId` — Cloud Functions에서만 수정 가능

### Firestore Rules — users 읽기 규칙

- `get`: 본인 또는 교수님만 (개별 문서 읽기)
- `list`: 로그인 사용자 모두 (랭킹 등 컬렉션 쿼리)

### 도배 방지

글 1분 3개, 댓글 30초 1개 제한 (Cloud Functions `checkRateLimitCall`에서 검증)

### 온보딩 리다이렉트

`onboarding_just_completed` localStorage 플래그로 온보딩 직후 홈 → 온보딩 재리다이렉트 방지

### 네비게이션 숨김 규칙

- `/quiz/[id]/*` 경로: 퀴즈 풀이, 결과, 피드백 페이지
- `/edit` 포함 경로: 퀴즈 수정 페이지

### 홈 화면 구조

- `CharacterBox`: 캐릭터 히어로 (60vh), 배경 이미지, XP 배지, 도감 버튼, EXP 바 (게임 HUD 스타일 `bg-black/40 rounded-full backdrop-blur-sm`)
- 바텀시트: 프로필 닉네임, 공지 채널, 랭킹 섹션
- 홈은 `h-screen overflow-hidden` 컨테이너로 스크롤 방지 (body style 직접 조작 금지)

### Firebase 배포 (규칙 변경 시)

Firestore 규칙/인덱스는 git push만으로 배포되지 않음. 별도 배포 필요:
```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
```

## 배포

### 프론트엔드 (Vercel)

`npm run build` → Vercel 자동 배포. PWA 서비스 워커 자동 등록.

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
