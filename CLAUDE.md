# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**RabbiTory** — 대학 수업 보조 PWA (148,000줄+, 532커밋). AI 기반 퀴즈 생성 + 게시판 + 토끼 컨셉 게이미피케이션.
학생은 AI로 문제를 생성하고 퀴즈를 풀며, 교수는 출제 스타일 분석과 학생 참여도를 모니터링.

### 코드베이스 규모

| 항목 | 수치 |
|------|------|
| 프론트엔드 (TSX+TS) | 120,076줄, 380파일 |
| Cloud Functions (TS) | 25,176줄, 70파일 |
| **총 코드** | **148,045줄** |
| 컴포넌트 (TSX) | 205개 |
| App 라우트 (page.tsx) | 35개 |
| lib 모듈 | 116개 |
| Cloud Functions (export) | 45개 |
| Firestore 보안 규칙 | 843줄 |
| 커밋 수 | 532+ |

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

## 테스트 현황 및 결과

### CF 유닛 테스트 (4파일, 164 tests, 전체 통과)

| 파일 | 테스트 수 | 내용 |
|------|----------|------|
| `gradeQuestion.test.ts` (391줄) | 52 | OX/객관식/단답형/복수정답 채점, 엣지케이스 |
| `rankingFormulas.test.ts` (278줄) | 54 | 개인/팀 랭킹 공식, 동점 처리, 경계값 |
| `tekkenDamage.test.ts` (196줄) | 31 | 배틀 데미지 계산, 크리티컬, 양쪽 오답 |
| `radarAndCluster.test.ts` (256줄) | 27 | 5축 레이더 정규화, 4군집 분류, Z-score |

### E2E 테스트 (Playwright, 8 시나리오)

| 파일 | 시나리오 |
|------|---------|
| `login.spec.ts` | 학생/교수 로그인 플로우 |
| `quiz-flow.spec.ts` | 퀴즈 풀이 → 결과 → 피드백 → EXP |
| `review.spec.ts` | 복습 5탭 → 연습 → 결과 |
| `ai-generation.spec.ts` | AI 문제 생성 파이프라인 |
| `battle-quiz.spec.ts` | 철권퀴즈 매칭 → 배틀 → 결과 |
| `board-kongi.spec.ts` | 게시판 글쓰기 + 콩콩이 AI 자동답변 |
| `professor-flow.spec.ts` | 교수 퀴즈 출제 + 통계 확인 |
| `milestone.spec.ts` | 마일스톤 → 뽑기/레벨업 |

### 부하 테스트 (k6)

```bash
firebase emulators:start
node tests/load/seed-production.js && node tests/load/generate-tokens.js
k6 run tests/load/mixed-scenario.k6.js   # 프로덕션: PROD=1 추가
```
- 학생 300명 + 교수 5명 동시접속 시나리오
- `seed-production.js` — 프로덕션 유사 데이터 생성
- `generate-tokens.js` — Firebase Auth 토큰 사전 발급

## 학생 탭 구조 (4탭)

### 홈 탭 (`/`)

HomeOverlay(z-45) — 전체화면 오버레이, 네비 위에 표시.
- **프로필**: 닉네임 + 프로필 토끼 + 설정(알림/비밀번호/반 변경/로그아웃)
- **공지**: `AnnouncementChannel` — 교수 공지 채널 (투표/이미지/파일/리액션)
- **의견게시판**: `OpinionChannel` — 학생↔교수 실시간 의견 채널
- **캐릭터**: `CharacterBox` — 장착 토끼 표시, 꾹 누르기 → 배틀 진입
- **XP 바**: 현재 EXP / 다음 마일스톤 (50XP 단위)
- **도감**: `RabbitDogam` — 80마리 토끼 컬렉션 + 상세(스탯/장착/이름)
- **랭킹**: `RankingSection` → `RankingBottomSheet` — 개인/팀/일간/주간/전체

**가로모드 3패널**: 1쪽(사이드바) + 2쪽(홈 오버레이) + 3쪽(상세 창)
- 프로필/공지/의견/도감/랭킹 → 가로모드에서 `openDetail()`로 3쪽 창에 표시
- 스와이프/휠로 홈 닫기 비활성화 (가로모드), 요술지니 애니메이션 제거
- 1쪽 `home-bg-1.jpg`, 2쪽 `home-bg.jpg`, 3쪽 `home-bg-3.jpg` 배경

### 퀴즈 탭 (`/quiz`)

- **교수 캐러셀**: midterm/final/past/independent 카드 스와이프 (최신 퀴즈 캐러셀 디폴트)
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

5개 필터 탭:
1. **서재** (`LibraryTab`) — AI 생성 + 공개 퀴즈
2. **오답** (`SolvedQuizLayout`) — 오답만 모아 복습
3. **찜** (`BookmarkTab`) — 퀴즈 북마크 (Start/Review 상태 구분)
4. **커스텀** (`CustomTab`) — 학생 자작 폴더

**복습 연습 플로우**: `FolderDetailPage` → `ReviewPractice` → 3단계(Practice → Result → Feedback)
- `PracticeStage`: 문제 풀이 (채점 즉시), `ResultStage`: 결과 + 피드백 바텀시트, `FeedbackStage`: 오답 폴더 저장 + EXP 획득
- 가로모드(복습 탭): `openDetail(<FolderDetailPage isPanelMode />)`, 연습 시작 시 `lockDetail()` → 3쪽 잠금
- 가로모드(서재 바로가기): 2쪽=`FolderDetailPage`(페이지) + 3쪽=`WidePagePractice`(autoStart)
- **서재 바로가기**: 1쪽 사이드바 복습 하위 문제지 클릭 → `/review/library/{id}?autoStart=all` → 2쪽 상세 + 3쪽 즉시 복습

### 게시판 탭 (`/board`)

- **태그**: 학사, 학술, 기타
- **이미지 첨부**: Storage 업로드, 인라인 표시
- **좋아요**: 게시글 좋아요 토글
- **댓글**: 루트 댓글 + 대댓글 (`parentId`), 댓글 채택(30 EXP)
- **콩콩이 AI**: 학술 태그 → `onPostCreate` CF → Gemini 자동 댓글 (`authorId: 'gemini-ai'`), 친절한 반말체, 이모지 금지
- **교수 핀/공지**: 교수가 게시글 핀 고정

**가로모드**: 게시글 클릭 → 3쪽에 `PostDetailPage` 표시 (2쪽 목록 유지)

## 교수 탭 구조 (5탭)

### 홈 (`/professor`)
- 교수 전용 HomeOverlay (`ProfessorHomeOverlay`)

### 통계 (`/professor/stats`)
- **5축 레이더** (10분 사전 계산, `computeRadarNormScheduled`): 퀴즈/활동량/배틀/소통/출제력
- **4군집 분류**: passionate/hardworking/efficient/atRisk (median 기반 동적 분류)
- **위험 학생 감지**: Z-score < -1.5 주의, < -2 위험
- **변별도**: 상위 27% - 하위 27% 정답률 (참여 ≥4명)
- **월별 리포트**: Claude Sonnet-4 인사이트 → Excel/Word 내보내기
- **가로모드 3패널**: 2쪽(요약카드+반비교+피드백) + 3쪽(챕터분석 RadarChart 자동 표시)
  - 통계 탭 진입 시 `openDetail(<RadarChart />)` 자동 호출, 과목 변경 시 3쪽 갱신
  - ClassComparison `fillHeight` prop: ResizeObserver로 컨테이너 높이 측정 → 동적 viewBox
  - 페이지 언마운트/가로모드 해제 시 3쪽 자동 닫기

### 퀴즈 관리 (`/professor/quiz`)
- 직접 출제 / AI 생성 / 미리보기 / 공개 설정
- 학생 `custom` 퀴즈 수정 시 `type` 덮어쓰기 방지 (originalType 체크)

### 학생 관리 (`/professor/students`)
- 일괄 등록, 비밀번호 초기화, 계정 삭제
- 학생 상세 모달 (레이더 + 퀴즈 이력)

### 게시판 (`/professor/board`)
- 학생 게시판과 동일 + 공지 관리

## AI 문제 생성 파이프라인

### 4단계 비동기 파이프라인

```
1. enqueueGenerationJob — Rate limit 분당3/일15, sha256 dedup 10분, Storage 임시 저장
2. workerProcessJob (onDocumentCreated) — 동시성 40, 5개 병렬 로드
3. styledQuizGenerator — 10개 컨텍스트 레이어, 토큰 관리, Truncated JSON 복구
4. 후처리 — 문제 수 부족 시 자동 보충(최대 2회), 챕터 ID 검증, Material Cache 저장
```

### 10개 컨텍스트 레이어 (`buildFullPrompt`)

| 순서 | 레이어 | 역할 |
|------|--------|------|
| 1 | **Professor Prompt** | 교수가 직접 입력한 출제 지시사항 (최우선) |
| 2 | **Course Overview** | 과목 특성 + 선택 챕터 커리큘럼 상세 |
| 3 | **Uploaded Text** | OCR/PDF/PPTX에서 추출한 학습 자료 |
| 4 | **Focus Guide** | 과목별 필수 출제 포인트 (`(필수 출제)`, `(고빈도)` 태그) |
| 5 | **Difficulty** | 난이도별 출제 지침 (easy 3K/med 5K/hard 7K 토큰) |
| 6 | **Style Context** | 교수 스타일 프로필 + 추출 키워드 + 문제 뱅크 샘플 |
| 7 | **Hard Mode Extra** | 어려움 전용: 교차 챕터 함정, 복수정답, 이미지 크롭 |
| 8 | **Chapter Index** | 챕터 분류 체계 (자동 태깅용) |
| 9 | **Image Section** | 사용 가능한 이미지 URL 목록 |
| 10 | **Scope** | 과목 전체 범위 교과서 내용 (`courseScope.ts`) |

### Focus Guide 시스템

과목별 필수/고빈도 출제 포인트. `getFocusGuide(courseId, chapters)` → 해당 챕터만 필터링.

```typescript
// 예시: 미생물학 챕터 3
- **(필수 출제) 감염 성립 3요소**: 감염원, 감염경로, 감수성 숙주
- **(필수 출제) 공기전파 병원성 미생물 분류표**
- **(필수 출제) 감염회로(6단계)**
- **(고빈도) 기회감염**: 정의, 내인감염, 균교대감염 비교
```

AI 문제 생성 + 배틀 문제 풀 양쪽에서 동일한 Focus Guide 사용.

### 입력 형식

이미지(최대 10장) / PDF(페이지 선택) / PPTX(Cloud Run 변환) / 텍스트

### HARD 특수 처리

Gemini Vision → jimp 이미지 크롭 → 크롭본만 전송, 복수정답 `[0, 2]`, 교차 챕터 함정

### 교수 스타일 학습

`professorQuizAnalysis/{courseId}` — 발문패턴/오답전략/주제비중. `onDocumentWritten` + `isPublished === true` 트리거.

## 게이미피케이션 시스템

### EXP 보상 (단일 소스: `shared/expRewards.json`)

| 활동 | EXP |
|------|-----|
| 퀴즈 만점 | 50 |
| 퀴즈 90%+ | 40 |
| 퀴즈 70%+ | 35 |
| 퀴즈 50%+ | 30 |
| 퀴즈 50% 미만 | 25 |
| 커스텀 퀴즈 생성 | 50 |
| AI 퀴즈 저장 | 25 |
| 퀴즈 공개 전환 | 15 |
| 피드백 제출 | 15 |
| 복습 완료 | 25 |
| 게시글 작성 | 15 |
| 댓글 작성 | 15 |
| 댓글 채택 | 30 |
| 배틀 승리 | 30 (+연승×5, 최대 50) |
| 배틀 패배 | 10 |

**마일스톤**: 50XP마다 → 뽑기 or 레벨업 선택

### 토끼 시스템

- **80마리** 고유 토끼 (`rabbitStats.ts` 221줄) — 각각 HP/ATK/DEF 기본 스탯
- **뽑기 2단계**: `spinRabbitGacha`(마일스톤 소비 → 랜덤 0~79) → `claimGachaRabbit`(이름 짓기 → 영구 소유)
- 이미 보유 시 마일스톤 미소비 → 바로 레벨업
- **레벨업**: `levelUpRabbit` CF — 스탯 증가 `base + floor((lv-1) × 1.5)`
- **장착**: 최대 2마리, `equipRabbit`/`unequipRabbit` CF
- **이미지**: rabbitId 0~79 → 파일명 001~080 (1-indexed)
- **프로필**: 토끼를 프로필 사진으로 설정 가능

### 철권퀴즈 (배틀 시스템)

실시간 1v1 토끼 배틀, **Firebase RTDB** 사용.

**배틀 플로우**:
```
매칭(10초, 봇 폴백) → countdown → question(30초) → 양쪽정답시 mash(연타) → roundResult → finished
```

**매칭 시스템**:
- Per-User Write(contention 0), 매칭 락(10초 TTL), FIFO 페어링
- 챕터 교집합이 없으면 봇 매칭

**문제 풀 (사전 생성)**:
- Cloud Run `tekkenPoolRefillScheduled` — 매일 03:00 KST
- 과목당 전 챕터 × 150문제 (easy 75 + medium 75)
- `generateBattleQuestions()` — Scope + FocusGuide + 교수 스타일 병렬 로드
- 배틀 특성: 30초 제한 → 문제 1-2문장, 선지 최대 30자, 4지선다만 (OX 금지)
- `drawQuestionsFromPool()` — 학생 선택 챕터 기반 추출 (24시간 seen 중복 방지)

**데미지 계산**:
```
baseDamage = max(ceil(ATK² / (ATK + DEF) × 1.5), 2)
크리티컬(5초 이내) ×1.5
양쪽 오답 → 10 고정 데미지
```

**봇**:
- 40% 정답률, 6초 고정 응답
- 레벨 = 유저 토끼 레벨 + 3 (±1 랜덤)
- 연타(mash) 단계: 플레이어 탭의 60~90%

### 랭킹

| 종류 | 공식 |
|------|------|
| **개인** | `profCorrectCount × 4 + totalExp × 0.6` |
| **팀** | `normalizedAvgExp × 0.4 + avgCorrectRate × 0.4 + avgCompletionRate × 0.2` |

- 10분 사전 계산 (`computeRankingsScheduled`)
- 동점 시 같은 순위 (1위, 1위, 3위)
- 일간/주간/전체 필터
- **교수 실명/닉네임 토글**: `RankingBottomSheet`에서 교수만 표시, 반별 드롭다운 좌측 위치

## 퀴즈 시스템

### 카테고리

midterm/final(교수 시험), past(기출), independent(교수 독립), custom(학생 자작), ai-generated(AI 서재), professor(교수 비공개)

### 문제 유형 (`QuestionType`)

| 유형 | 답안 형식 | 비고 |
|------|----------|------|
| OX | 'O' \| 'X' | |
| 객관식 | number (0-indexed), 복수정답: number[] | 2~8개 선지 |
| 단답형 | string, 복수정답: `\|\|\|` 구분 | case-insensitive |
| 서술형 | 수동 채점 (교수 전용) | |
| 결합형 | 공통 지문/이미지 + 하위 N문제 | N문제 = N점 |

**answer 인덱싱**: **모두 0-indexed** (통일됨)

### 인라인 서식 (`renderInlineMarkdown`)

- `*이탤릭*` → *이탤릭* (학명 등)
- `{아래첨자}` → 아래첨자 (CO{2} → CO₂)
- `^위첨자^` → 위첨자 (m^2^ → m²)

### recordAttempt 보안 5중 방어

1. 클라이언트 `useRef` guard (React StrictMode 중복 호출 방지)
2. 서버 `quiz_submit_locks` 트랜잭션 (60초 TTL)
3. `rateLimitV2` (분당 3회)
4. `quiz_completions` 체크 (완료된 퀴즈 재진입 방지)
5. `attemptKey` idempotency (동일 제출 → 캐시 반환)

## 가로모드 3패널 시스템

### 레이아웃 (`app/(main)/layout.tsx`)

```
┌─────────────┬──────────────────┬──────────────────┐
│  1쪽 (240px) │  2쪽 (50%)       │  3쪽 (50%)       │
│  Navigation  │  Main Content    │  Detail Panel    │
│  사이드바     │  (페이지)         │  (상세/잠금)      │
└─────────────┴──────────────────┴──────────────────┘
```

- `useWideMode()`: landscape + 1024px 이상
- Tailwind `wide:` 커스텀 스크린: `{ raw: '(orientation: landscape) and (min-width: 1024px)' }`

### DetailPanelContext (잠금 + 대기 시스템)

```typescript
interface DetailPanelContextType {
  content: ReactNode | null;           // 3쪽 현재 콘텐츠
  queuedContent: ReactNode | null;     // 2쪽 대기 콘텐츠 (잠금 중)
  openDetail: (content: ReactNode) => void;  // 잠금 시 2쪽 대기
  closeDetail: () => void;             // 잠금 시 대기만 닫기
  isLocked: boolean;                   // 퀴즈/복습/퀴즈만들기 진행 중
  lockDetail: () => void;
  unlockDetail: () => void;            // 대기 콘텐츠 → 3쪽 자동 승격
}
```

**잠금 대상 4가지**: 퀴즈(`QuizPanelContainer`), 복습(`ReviewPractice`/`WidePagePractice`), 퀴즈만들기(`QuizCreatePage`), 배틀(포탈 독립)

**잠금 중 동작**:
- 탭 전환 → `handleTabClick`에서 `unlockDetail(true)` 강제 해제 → 3쪽 정리
- `openDetail()` → 2쪽에 대기
- 잠금 해제 → 대기 콘텐츠 3쪽 승격, 2쪽을 탭 루트로 복귀
- 잠금 해제 시 `isDetailOpen`이면 탭 루트 복귀 스킵 (서재 바로가기 전환 등)

### 서재 바로가기 (1쪽 사이드바)

가로모드 복습 탭 하위에 문제지 목록 인라인 표시, 클릭 시 즉시 복습 시작.

**UI**: `SidebarLibraryItems` 컴포넌트 (`Navigation.tsx`)
- 복습 탭 활성화 시 자동 표시, 드롭다운 화살표(▸/▾)
- 다른 탭 클릭 시 컴포넌트 언마운트로 자동 숨김
- 선택된 항목: 탭 활성 스타일과 동일 (`rgba(0,0,0,0.07)` + `opacity: 1`)
- 데이터: `useLearningQuizzes` + `useCompletedQuizzes` (서재 탭과 동일)

**클릭 플로우**:
```
1. unlockDetail(false) — 3쪽 잠금만 해제 (콘텐츠 유지 → layout 탭 복귀 방지)
2. router.push('/review/library/{id}?autoStart=all') — 2쪽 FolderDetailPage
3. FolderDetailPage autoStart effect — unlockDetail(true) + openDetail(WidePagePractice)
4. WidePagePractice mount → usePanelLock() → 3쪽 잠금
```

**`WidePagePractice`** (`review/[type]/[id]/page.tsx`): 가로모드 페이지에서 3쪽으로 열리는 복습 래퍼
- `usePanelLock()` + `useClosePanel()` (review/page.tsx의 `ReviewPracticePanel`과 동일 패턴)
- `handlePracticeCompleteRef`: stale closure 방지용 ref

**`autoStartedForRef`**: folderId별 1회 실행 + 데이터 신선도 검증 (`questions[0]?.quizId === folderId`)

### CSS 변수

| 변수 | 모바일 | 가로(기본) | 가로(잠금) |
|------|--------|----------|----------|
| `--detail-panel-left` | `0` | `calc(50% + 120px)` | `240px` |
| `--modal-left` | `0px` | `240px` | `240px` |
| `--modal-right` | `0px` | `calc(50% - 120px)` | `calc(50% - 120px)` |

### 패널 모드 CSS 패턴

- 전체 페이지: `fixed bottom-0 right-0` + `left: var(--detail-panel-left)`
- 패널 모드: `sticky bottom-0` (aside 내 스크롤 컨텍스트에서 동작)
- 모달: 패널 모드에서 `absolute inset-0` (포탈 대신 3쪽 안에 렌더)

### 홈 배경 시스템

- 1쪽: `home-bg-1.jpg` (사이드바 뒤, opacity 전환)
- 2쪽: `home-bg.jpg` (HomeOverlay 포탈)
- 3쪽: `home-bg-3.jpg` (aside `backgroundSize: '102% 102%'` 틈 방지)
- 상세 창: 각 컴포넌트가 자체 `home-bg-3.jpg` 배경 (`102% 102%`)

## 과목 시스템

| 과목 ID | 이름 | 챕터 접두사 | 챕터 수 |
|---------|------|-----------|---------|
| `biology` | 생물학 | `bio_` | 12 |
| `pathophysiology` | 병태생리학 | `patho_` | 11 |
| `microbiology` | 미생물학 | `micro_` | 11 |

- **동적 과목**: `courses/{courseId}` → `CourseContext.courseRegistry` 실시간 구독
- **CourseId 타입**: `'biology' | 'pathophysiology' | 'microbiology' | (string & {})` — 자동완성 + 확장
- 학기 판별: 02-22~08-21 → 1학기, 08-22~02-21 → 2학기

## 인증 시스템

- **학생**: 학번 `20230001` → `20230001@rabbitory.internal` (Firebase Auth). `registerStudent` CF가 enrolledStudents 확인
- **교수**: 이메일 → `initProfessorAccount` CF → `allowedProfessors/{email}` 확인
- **교수 권한**: `users/{uid}.assignedCourses` + CF `verifyProfessorAccess()`. 비어있으면 모든 과목 허용
- **복구 이메일**: 학생 설정 → 비밀번호 찾기 시 인증코드 발송
- Middleware 없음 — `useRequireAuth()` 훅으로 클라이언트 리다이렉트

## UI/UX

### 빈티지 신문 테마

- 배경 #F5F0E8(크림), 카드 #FDFBF7, 텍스트 #1A1A1A
- 테두리 #D4CFC4(밝은) / #1A1A1A(진한), 그림자 `4px 4px 0px #1A1A1A`
- 글꼴: Noto Sans KR (본문), Playfair Display (빈티지 헤더), Cormorant Garamond (세리프)

### 반별 강조색 (`--theme-accent`)

A: #8B1A1A (버건디) / B: #B8860B (다크골드) / C: #1D5D4A (에메랄드) / D: #1E3A5F (네이비)
생물학: #2E7D32 (자연 녹색) 단일 테마

### 네비게이션

학생 4탭(홈/퀴즈/복습/게시판), 교수 5탭(홈/통계/퀴즈/학생/게시판)
PWA: viewport-fit cover, standalone, skipWaiting, FCM (`worker/index.js`)

## SaaS 마이그레이션 로드맵 (2026 여름)

### Phase 1: 인증 + 멀티테넌시

- Firebase Auth → **Better Auth** (Organization 플러그인, SSO)
- Firestore → **Supabase PostgreSQL** (RLS 테넌트 격리)
- `organizations` 테이블 (대학별 slug/logo/theme)
- `org_members` (role, student_id, class_id)

### Phase 2: 데이터 마이그레이션

- Repository 패턴 활용 (`lib/repositories/` import 교체만으로 전환)
- Firestore onSnapshot → Supabase Realtime
- 배틀은 Firebase RTDB 유지 (50ms 지연 요구)

### Phase 3: AI + 배포

- Cloud Functions → Supabase Edge Functions + Cloud Run (AI)
- Vercel 유지 (프론트)

## Firestore Security Rules 보호 필드

`totalExp`, `rank`, `role`, `badges`, `equippedRabbits`, `totalCorrect`, `totalAttemptedQuestions`, `professorQuizzesCompleted`, `lastGachaExp`, `spinLock` — Cloud Functions에서만 수정 가능

## 코딩 컨벤션

- 응답/주석/커밋/문서: 한국어
- 변수명/함수명: 영어
- 들여쓰기: 2칸
- 컴포넌트: React 함수형 + TypeScript
- 경로 별칭: `@/*` → 프로젝트 루트

## 대형 파일 (1,500줄+)

| 파일 | 줄 수 | 내용 |
|------|-------|------|
| `quiz/create/page.tsx` | 1,977 | 퀴즈 만들기 6종 편집기 |
| `review/[type]/[id]/page.tsx` | 1,959 | 폴더 상세 + 복습 플로우 |
| `announcement/AnnouncementChannel.tsx` | 1,874 | 공지 채널 |
| `styledQuizGenerator.ts` | 1,857 | AI 프롬프트 10레이어 조합 |
| `lib/ocr.ts` | 1,692 | Clova OCR 파이프라인 |
| `professor/quiz/create/page.tsx` | 1,657 | 교수 퀴즈 출제 |
| `professor/quiz/[id]/preview/page.tsx` | 1,628 | 교수 미리보기 |
| `review/page.tsx` | 1,616 | 복습 5탭 + 연습 |
| `quiz/create/QuestionEditor.tsx` | 1,607 | 문제 편집기 UI |
| `quiz/[id]/result/page.tsx` | 1,550 | 퀴즈 결과 + 해설 |

## 디버깅 가이드

| 증상 | 원인 | 해결 |
|------|------|------|
| 퀴즈 제출 후 결과 안 뜸 | recordAttempt CF 실패 | CF 로그 + quiz_submit_locks 확인 |
| EXP가 안 올라감 | onQuizComplete 미발동 | quizResults 문서 생성 여부 확인 |
| AI 문제 생성 멈춤 | Job RUNNING 타임아웃 | retryQueuedJobs가 5분 후 FAILED 처리 |
| 배틀 매칭 안 됨 | RTDB 매칭 큐 잔류 | RTDB Console → tekken/matchmaking 확인 |
| 토끼 뽑기 안 됨 | lastGachaExp 불일치 | users.totalExp vs lastGachaExp |
| 가로모드 3쪽 잔류 | 잠금 해제 후 detail 안 닫힘 | unlockDetail → closeDetail 순서 확인 |
| Gemini API 403 | API 키 노출/만료 | Google AI Studio에서 새 키 발급 |
