# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

대학 수업 보조 앱 **"RabbiTory"**. 퀴즈 + 게시판 기능에 토끼 컨셉 게이미피케이션을 적용한 PWA.
학생은 퀴즈를 풀고 피드백을 남기며, 교수님은 문제에 대한 피드백을 수집하고 학생 참여도를 모니터링.

**프로젝트 규모**: TypeScript/TSX 135,000줄+, 컴포넌트 160개+, Cloud Functions 43개, 페이지 34개, 커밋 161개

## 기술 스택

### 프론트엔드
- **Next.js** 16.1.6 (App Router, Turbopack)
- **React** 19 + **TypeScript** 5
- **Tailwind CSS** 3
- **Framer Motion** 11 (페이지 전환, UI 애니메이션)
- **Lottie React** 2.4 (퀴즈 결과 연출)
- **next-pwa** 5.6 (PWA 서비스 워커)
- **next-view-transitions** 0.3.5 (View Transitions API)
- **react-window** 2.2.7 (가상 스크롤)
- **react-d3-cloud** 1.0.6 (단어 클라우드)

### 문서/파일 처리
- **Tesseract.js** 5.0.4 (클라이언트 OCR)
- **pdfjs-dist** 4.0.379 (PDF 렌더링)
- **exceljs** 4.4 (Excel 리포트 내보내기)
- **docx** 9.5.3 (Word 리포트 내보내기)
- **file-saver** 2.0.5 (파일 다운로드)
- **jszip** 3.10.1 (압축)
- **date-fns** 3.0 (날짜 처리)

### Backend (Firebase)
- **Firebase** 10.7 — Auth, Firestore, Realtime Database, Cloud Functions, Cloud Messaging, Storage
- **firebase-functions** 5.0 + **firebase-admin** 12.0 (Node 20)
- **@google-cloud/vision** 4.3.2 (Gemini Vision OCR)
- **jimp** 0.22.12 (서버사이드 이미지 크롭)
- **nodemailer** 6.9.8 (이메일 발송)
- **node-fetch** 2.7 (API 호출)
- **google-auth-library** 9.6 (Cloud Run 인증)

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
- `firebase.json` predeploy 훅: `npm run build` 자동 실행
- **테스트 프레임워크 없음**: Jest/Vitest/Playwright 미설정, 수동 테스트 기반

### 환경 변수

**프론트엔드** (`.env.local`):
- `NEXT_PUBLIC_FIREBASE_*` — API_KEY, AUTH_DOMAIN, PROJECT_ID, STORAGE_BUCKET, MESSAGING_SENDER_ID, APP_ID, MEASUREMENT_ID
- `NEXT_PUBLIC_FIREBASE_DATABASE_URL` — Realtime Database URL (철권퀴즈)
- `NEXT_PUBLIC_FIREBASE_VAPID_KEY` — FCM 웹 푸시 인증서 키
- `NEXT_PUBLIC_NAVER_CLIENT_ID` / `NEXT_PUBLIC_NAVER_CALLBACK_URL` — 네이버 OAuth (선택)
- `NEXT_PUBLIC_PPTX_CLOUD_RUN_URL` — PPT→PDF Cloud Run URL

**Cloud Functions 시크릿**:
```bash
firebase functions:secrets:set GEMINI_API_KEY     # AI 문제 생성
firebase functions:secrets:set ANTHROPIC_API_KEY   # 월별 리포트
```

## 아키텍처

### 라우트 구조

```
app/
├── layout.tsx                  # 루트 레이아웃 (글꼴, PWA 메타)
├── (auth)/                     # 비인증 라우트 그룹
│   ├── layout.tsx              #   인증 페이지 공통 레이아웃
│   ├── login/                  #   학번+비밀번호 로그인
│   ├── signup/                 #   회원가입 (학번, 이름, 학년→과목 자동 결정)
│   └── forgot-password/        #   비밀번호 찾기 (학번→복구 이메일 or 문의)
├── (main)/                     # 인증 필요 라우트 그룹
│   ├── layout.tsx              #   메인 레이아웃 (5계층 Provider + Navigation)
│   ├── page.tsx                #   홈 (캐릭터, EXP 바, 공지, 랭킹)
│   ├── quiz/                   #   퀴즈
│   │   ├── page.tsx            #     목록 (필터: 중간/기말/기출/커스텀)
│   │   ├── create/             #     학생 퀴즈 생성
│   │   └── [id]/
│   │       ├── page.tsx        #     풀이
│   │       ├── result/         #     결과
│   │       ├── feedback/       #     피드백 제출
│   │       ├── exp/            #     마일스톤 보상
│   │       └── edit/           #     수정 (본인 퀴즈)
│   ├── review/                 #   복습
│   │   ├── page.tsx            #     목록 (오답/찜/푼 문제 탭)
│   │   ├── random/             #     랜덤 복습
│   │   └── [type]/[id]/        #     복습 상세 (wrong|bookmark|solved)
│   ├── board/                  #   게시판
│   │   ├── page.tsx            #     통합 피드 (신문 Masonry 레이아웃)
│   │   ├── write/              #     글 작성
│   │   ├── manage/             #     게시판 관리 (교수 전용)
│   │   └── [id]/               #     글 상세 + 댓글 + 수정
│   ├── ranking/                #   랭킹
│   ├── profile/                #   프로필 / 캐릭터 커스터마이징
│   ├── settings/               #   설정 (알림, 닉네임, 계정 삭제)
│   └── professor/              #   교수 전용
│       ├── page.tsx            #     홈 (대시보드)
│       ├── quiz/               #     퀴즈 관리 (3D 캐러셀 + 자작/AI 그리드)
│       │   ├── create/         #     퀴즈 생성 (수동/파일 업로드)
│       │   └── [id]/           #     상세 / 미리보기 / 수정
│       ├── stats/              #     통계 (레이더, 주별 추세, 월별 리포트)
│       ├── students/           #     학생 모니터링 (6축 레이더)
│       └── analysis/           #     분석 (폐기됨 → stats로 통합)
├── onboarding/                 # 온보딩 (폐기됨 → 회원가입에 통합, 홈으로 리다이렉트)
├── verify-email/               # 이메일 인증 (폐기됨)
└── firebase-messaging-sw.js/   # FCM 서비스 워커 (API Route)
```

### Provider 계층 구조

`app/(main)/layout.tsx`에서 인증 + 온보딩 완료 체크 후 Provider 중첩:

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

### 상태 관리 패턴

- **전역 상태**: React Context (User, Course, Theme, HomeOverlay, Milestone) — Redux/Zustand 미사용
- **서버 데이터**: Firestore `onSnapshot`으로 실시간 동기화 (커스텀 훅)
- **로컬 상태**: 컴포넌트 `useState`/`useReducer`
- **인증 상태**: Firebase `onAuthStateChanged` → `useAuth()` 훅
- **캐시**: sessionStorage SWR (랭킹 2분/10분 TTL, 레이더 정규화 5분 TTL)

## 컴포넌트 구조

### `components/common/` — 공통 UI (21개)
| 컴포넌트 | 역할 |
|----------|------|
| `Navigation.tsx` | 바텀탭(세로)/사이드바(가로) (학생 4탭, 교수 5탭) |
| `MobileBottomSheet.tsx` | Framer Motion 드래그 바텀시트 (스와이프 닫기) |
| `Modal.tsx` / `BottomSheet.tsx` | 기본 모달/시트 |
| `ExpToast.tsx` | EXP 획득 토스트 (RealtimeExpContext onSnapshot 구독) |
| `ThemeProvider.tsx` | 반별 CSS 변수(`--theme-*`) 적용 |
| `NotificationProvider.tsx` | FCM 푸시 알림 초기화 + 포그라운드 핸들링 |
| `SwipeBack.tsx` | 좌측 25px 가장자리 스와이프 → router.back() |
| `ProfileDrawer.tsx` | 프로필 좌측 슬라이드 드로어 |
| `ImageViewer.tsx` | 이미지 전체화면 뷰어 |
| `CourseSwitcher.tsx` | 교수 과목 전환 캐러셀 |
| `RabbitImage.tsx` | 토끼 이미지 렌더링 (rabbitId → 파일 매핑) |
| `VirtualRabbitGrid.tsx` | 가상 스크롤 토끼 그리드 (react-window) |
| `Header.tsx` / `Button.tsx` / `Input.tsx` / `Card.tsx` | 기본 UI |
| `ErrorBoundary.tsx` / `Skeleton.tsx` / `SplashScreen.tsx` | 보조 |
| `OfflineBanner.tsx` | 오프라인 상태 배너 |
| `FolderSelectModal.tsx` / `FolderSlider.tsx` / `ExpandModal.tsx` | 폴더/확장 |
| `TabSwipeNav.tsx` / `ScrollToTopButton.tsx` | 탭 스와이프, 맨 위 FAB |
| `RibbonBanner.tsx` | 과목별 리본 이미지 |
| `WebVitalsReporter.tsx` | Core Web Vitals 수집 |

### `components/home/` — 홈 화면 (19개)
| 컴포넌트 | 역할 |
|----------|------|
| `CharacterBox.tsx` | 캐릭터 히어로 + 2마리 궤도 캐러셀(타원 공전) + EXP 바 + 도감 버튼 |
| `HomeCharacter.tsx` | 캐릭터 렌더링 (머리 0-16, 피부 0-14, 수염 0-3) |
| `HomeOverlay.tsx` | 학생 홈 바텀시트 (프로필, 공지, 랭킹) |
| `ProfessorHomeOverlay.tsx` | 교수 홈 바텀시트 |
| `ProfessorCharacterBox.tsx` | 교수용 캐릭터 박스 |
| `AnnouncementChannel.tsx` | 공지 채널 (9-slice 말풍선, 다중 이미지/파일/투표 캐러셀, 이모지 리액션, 검색, 캘린더) |
| `RabbitDogam.tsx` / `ProfessorRabbitDogam.tsx` | 토끼 도감 (발견자 목록, 데려오기) |
| `GachaResultModal.tsx` | 뽑기 결과 모달 |
| `LevelUpBottomSheet.tsx` | 토끼 레벨업 바텀시트 (글래스모피즘 UI) |
| `MilestoneChoiceModal.tsx` | 마일스톤 보상 선택 (뽑기 or 레벨업) |
| `RankingBottomSheet.tsx` / `RankingSection.tsx` | 개인/팀 랭킹 |
| `ProfessorRankingSection.tsx` | 교수 랭킹 |
| `TodayQuiz.tsx` / `QuickMenu.tsx` / `RandomReviewBanner.tsx` / `StatsCard.tsx` | 보조 섹션 |

### `components/quiz/` — 퀴즈 (28개)
| 컴포넌트 | 역할 |
|----------|------|
| `QuizGrid.tsx` / `QuizCard.tsx` / `QuizHeader.tsx` | 퀴즈 목록 |
| `QuizFilterTabs.tsx` | 필터 탭 (중간/기말/기출/커스텀) |
| `QuestionCard.tsx` | 문제 카드 렌더링 (유형별 분기) |
| `OXChoice.tsx` / `MultipleChoice.tsx` / `ShortAnswer.tsx` | 유형별 답안 UI |
| `CombinedQuestionGroup.tsx` | 결합형 (공통 지문 + 하위 문제) |
| `QuizNavigation.tsx` | 이전/다음/제출 |
| `ResultHeader.tsx` / `ScoreCard.tsx` / `QuestionResultList.tsx` | 결과 |
| `FeedbackForm.tsx` / `FeedbackButton.tsx` / `InstantFeedbackButton.tsx` | 피드백 |
| `ExitConfirmModal.tsx` | 나가기 확인 |
| `EditQuizSheet.tsx` / `UpdateQuizModal.tsx` | 퀴즈 수정 |
| `Top3Race.tsx` | 상위 3명 경쟁 미니게임 |
| `ClassRankingBar.tsx` | 반별 랭킹 바 |
| `AutoVideo.tsx` | 난이도 비디오 자동 재생 |
| **create/** (16개) | 퀴즈 생성 폼 |
| `QuestionEditor.tsx` (4,074줄) | 문제 편집기 (OX/객관식/단답/서술/결합형) |
| `FileUpload.tsx` / `OCRProcessor.tsx` / `OcrProgress.tsx` | OCR 파이프라인 |
| `ImageUploader.tsx` / `ImageCropper.tsx` / `ImageRegionSelector.tsx` | 이미지 관리 |
| `ChapterSelector.tsx` | 챕터 태그 선택 |
| **manage/** | `QuizStatsModal.tsx` — 반별 필터, 문제별 분석, 변별도, 피드백 |

### `components/review/` — 복습 (3개)
| 컴포넌트 | 역할 |
|----------|------|
| `ReviewPractice.tsx` | 복습 풀이 (오답 반복, 해설 토글) |
| `ReviewQuestionCard.tsx` | 복습 문제 카드 |
| `ReviewTabs.tsx` | 복습 탭 (오답/찜/푼 문제) |

### `components/board/` — 게시판 (8개)
| 컴포넌트 | 역할 |
|----------|------|
| `PostList.tsx` / `PostCard.tsx` | 신문 Masonry 2열 레이아웃 |
| `CommentSection.tsx` / `CommentItem.tsx` | 댓글/대댓글 |
| `WriteForm.tsx` | 글/댓글 작성 (이미지/파일 첨부) |
| `LikeButton.tsx` | 좋아요 |
| `BoardTabs.tsx` / `NoticeTag.tsx` | 필터/태그 |

### `components/professor/` — 교수 전용 (28개 + 하위)
| 컴포넌트 | 역할 |
|----------|------|
| `QuizEditorForm.tsx` / `QuizList.tsx` / `QuizListItem.tsx` | 퀴즈 CRUD |
| `PreviewQuestionCard.tsx` | 문제 미리보기 |
| `PublishToggle.tsx` / `QuizDeleteModal.tsx` | 공개/삭제 |
| `DashboardStats.tsx` / `ClassParticipation.tsx` | 대시보드 |
| `AnalysisSummary.tsx` / `QuestionAnalysisCard.tsx` | 분석 |
| `DifficultyChart.tsx` / `RecentFeedback.tsx` | 난이도/피드백 |
| `EssayGrading.tsx` | 서술형 채점 |
| `StudentList.tsx` / `StudentListItem.tsx` / `StudentStats.tsx` | 학생 목록 |
| `StudentDetailModal.tsx` / `StudentEnrollment.tsx` | 학생 상세/등록 |
| `SemesterSettingsCard.tsx` / `SeasonResetCard.tsx` / `SeasonResetModal.tsx` | 학기/시즌 |
| `SeasonHistoryList.tsx` | 시즌 히스토리 |
| `TekkenChapterSettings.tsx` | 배틀 퀴즈 챕터 범위 설정 |
| `CourseSelector.tsx` / `TargetClassSelector.tsx` | 과목/반 선택 |
| `StyleProfileModal.tsx` / `QuickActions.tsx` | 스타일 프로필/빠른 동작 |
| `BoardManagementModal.tsx` | 게시판 관리 |
| **stats/** (12개) | 교수 통계 대시보드 |
| `RadarChart.tsx` / `StudentRadar.tsx` | 6축 레이더 차트 |
| `ClassProfileRadar.tsx` / `ClassComparison.tsx` | 반별 비교 |
| `ClassSummaryTable.tsx` / `ChapterTable.tsx` | 표 분석 |
| `WeeklyTrend.tsx` / `WeeklyBoxPlot.tsx` | 주별 추세 |
| `AIDifficultyAnalysis.tsx` | AI 문제 난이도 분석 |
| `StabilityIndex.tsx` / `DispersionToggle.tsx` / `SourceFilter.tsx` / `SubjectFilter.tsx` | 필터 |
| **students/** (4개) | 학생 모니터링 |
| `StudentListView.tsx` / `StudentManagementSheet.tsx` | 학생 목록/관리 시트 |
| `StudentDetailModal.tsx` / `StudentRadar.tsx` | 상세/레이더 |
| **library/** (2개) | AI 서재 |
| `ProfessorLibraryTab.tsx` | AI 문제 생성 (프롬프트, 파일, 슬라이더, 태그 피커) |
| `LibraryJobToast.tsx` | 생성 중 토스트 (layout.tsx에 마운트) |

### `components/ai-quiz/` — AI 퀴즈 (9개)
| 컴포넌트 | 역할 |
|----------|------|
| `AIQuizContainer.tsx` | AI 퀴즈 플로팅 UI (학생 전용, 퀴즈 페이지에 표시) |
| `AIQuizModal.tsx` / `AIQuizPlayer.tsx` | AI 퀴즈 모달/풀이 |
| `AIQuizProgress.tsx` | 진행도 |
| `FloatingAIButton.tsx` | 플로팅 버튼 |
| `KeywordBottomSheet.tsx` | 키워드/챕터 태그 선택 |
| `PageSelectionModal.tsx` / `PptxProgressModal.tsx` | PPTX 관련 |

### `components/tekken/` — 철권퀴즈 (9개)
| 컴포넌트 | 역할 |
|----------|------|
| `TekkenBattleOverlay.tsx` | 배틀 전체 오버레이 (상태 기반 렌더링) |
| `TekkenMatchmakingModal.tsx` | 매칭 중 모달 (30초 대기 → 봇) |
| `TekkenBattleArena.tsx` | 배틀 아레나 (2명 레이아웃 + HP 바) |
| `TekkenQuestionCard.tsx` | 배틀 문제 카드 (20초 타이머) |
| `TekkenCountdown.tsx` | 3-2-1 카운트다운 |
| `TekkenMashMinigame.tsx` | 연타 줄다리기 미니게임 (3초 게이지) |
| `TekkenBattleResult.tsx` | 라운드/배틀 결과 |
| `TekkenBattleConfirmModal.tsx` | 배틀 진입 확인 |
| `TekkenEntryHint.tsx` | 철권퀴즈 소개 팁 |

### `components/profile/` — 프로필 (5개)
`ProfileCard.tsx`, `CharacterEditor.tsx`, `SettingsList.tsx`, `SettingsItem.tsx`, `StatsSummary.tsx`

## lib/ 구조

### `lib/contexts/` — React Context (4개 + index)
| Context | 역할 |
|---------|------|
| `UserContext.tsx` | 사용자 프로필 전역 (onSnapshot 실시간 구독, totalExp/rank/badges 등) |
| `CourseContext.tsx` | 학기/과목 정보 (학년→과목 자동 결정, 현재 학기 설정) |
| `HomeOverlayContext.tsx` | 홈 오버레이 열기/닫기 상태 |
| `MilestoneContext.tsx` | 마일스톤 모달 관리 |

### `lib/hooks/` — 커스텀 훅 (31개)

**인증/사용자**:
- `useAuth.ts` — Firebase Auth (학번+비밀번호 로그인, onAuthStateChanged)
- `useProfile.ts` — 프로필 조회/수정 (닉네임, 캐릭터)
- `useSettings.ts` — 사용자 설정

**퀴즈 관련**:
- `useLearningQuizzes.ts` — 학생 퀴즈 목록 구독 (필터 탭별)
- `useQuizUpdate.ts` — 퀴즈 재시도 상태 추적
- `useQuizBookmark.ts` — 찜 기능
- `useReview.ts` — 복습 데이터 구독 (오답/찜/푼 문제)
- `useCustomFolders.ts` — 커스텀 폴더 관리

**교수 관련**:
- `useProfessorQuiz.ts` — 교수 퀴즈 CRUD + 통계
- `useProfessorAiQuizzes.ts` — AI 생성 퀴즈 실시간 구독
- `useProfessorStudents.ts` — 학생 모니터링 (Progressive Loading Phase 0→1→2 + 6축 레이더 정규화)
- `useProfessorStats.ts` — 교수 통계 (주별 수집, 월별 리포트)
- `useProfessorAnalysis.ts` — 교수 분석 데이터
- `useEnrolledStudents.ts` — 학생 등록 목록 관리
- `useSeasonReset.ts` — 시즌 리셋 상태

**게시판/알림**:
- `useBoard.ts` — 게시판 글/댓글 CRUD (Masonry 레이아웃 데이터)
- `useNotification.ts` — FCM 알림 구독
- `useActivityTracker.ts` — 사용자 활동 추적

**토끼/배틀**:
- `useRabbit.ts` — 토끼 보유, 도감, 스탯 조회 (useRabbitHoldings, useRabbitDoc, getRabbitStats)
- `useTekkenBattle.ts` — 배틀 상태 (매칭, 라운드, 결과, Realtime DB 구독)

**OCR**:
- `useOcr.ts` — Tesseract OCR
- `useClovaOcr.ts` — Naver CLOVA OCR (CF 호출)
- `useVisionOcr.ts` — Google Vision OCR (CF 호출)

**UI/레이아웃**:
- `useViewportScale.ts` — 뷰포트/가로모드 감지 (useWideMode, getZoom→항상1, scaleCoord→identity)
- `useHideNav.ts` — 네비게이션 숨김 규칙
- `useScrollLock.ts` — 스크롤 잠금
- `useKeyboardAware.ts` — 모바일 키보드 높이 감지
- `useReducedMotion.ts` — 동작 축소 설정
- `useOnlineStatus.ts` — 온라인/오프라인 상태
- `useStorage.ts` — localStorage 래퍼
- `useExpandSource.ts` — 소스 확대

### `lib/types/` — 타입 정의 (2개)
- `course.ts` — CourseId, ClassId, 학기, 과목 정보, QuizFilterTab
- `tekken.ts` — 배틀 상태, 매칭, 토끼 스탯, 플레이어, 라운드, 미니게임

### `lib/utils/` — 유틸리티 (27개)

**점수/랭킹**:
- `expRewards.ts` — EXP 보상 테이블
- `feedbackScore.ts` — 피드백 점수 계산 (praise+2, wrong-2 등)
- `ranking.ts` — 랭킹 점수 공식 (개인/팀)
- `rankingCache.ts` — 랭킹 SWR 캐시 (2분/10분 TTL)
- `radarNormCache.ts` — 6축 레이더 정규화 캐시 (5분 TTL)
- `statistics.ts` — 통계 유틸 (백분위, 표준편차)
- `milestone.ts` — 마일스톤 계산 (50XP 간격)

**토끼**:
- `rabbitImage.ts` — 토끼 이미지 경로 (0~79 → /rabbit/rabbit-{id+1}.png)
- `rabbitProfile.ts` — 토끼 프로필 이미지 경로
- `rabbitDisplayName.ts` — 토끼 이름 표시 (기본 토끼 특별 처리)
- `professorRabbit.ts` — 교수 토끼 관련

**데이터 처리**:
- `quizHelpers.ts` — 퀴즈 필터, 정렬, 대역폭 제한
- `questionId.ts` — 문제 ID 생성/파싱
- `firestore.ts` — Firestore 유틸 (쿼리, 배치)
- `asyncHandler.ts` — 비동기 에러 핸들링
- `tekkenDamage.ts` — 클라이언트 데미지 계산 (서버와 동일)

**문서 내보내기**:
- `questionPdfExport.tsx` — 문제 PDF 내보내기
- `questionDocExport.ts` — 문제 Word 내보내기
- `questionHtmlTemplate.ts` — 문제 HTML 템플릿
- `reportExport.ts` — 월별 리포트 내보내기 (Excel/Word)

**기타**:
- `libraryJobManager.ts` — AI 문제 생성 Job 폴링 매니저
- `offlineReviewCache.ts` — 오프라인 복습 캐시
- `koreanStopwords.ts` — 한글 불용어 (검색 제외)
- `cornerImageBase64.ts` — 신문 코너 장식 Base64
- `scrollLock.ts` — 스크롤 잠금 유틸
- `webVitals.ts` — Core Web Vitals 수집

### 기타 lib 파일
- `firebase.ts` — Firebase 초기화 (app, auth, db, functions, storage, RTDB 지연 초기화)
- `auth.ts` — Firebase Auth 래퍼 (signInWithEmail, formatStudentEmail, signOut)
- `fcm.ts` — FCM 초기화, 토큰 요청, 포그라운드 메시지 핸들러
- `scoring.ts` — 채점 로직 (객관식, 주관식, 서술형 루브릭)
- `ocr.ts` — Tesseract 초기화 유틸
- `imageUtils.ts` — 이미지 처리 유틸
- `courseIndex.ts` — 과목 인덱스 데이터 (챕터 목록)

## Cloud Functions 전체 목록 (`functions/src/`)

### 퀴즈 관련
| 함수 | 타입 | 역할 |
|------|------|------|
| `recordAttempt` | onCall | 퀴즈 제출 + 서버사이드 채점 + 분산 쓰기 (quiz_agg 샤드, quiz_completions, reviews) |
| `onQuizComplete` | onDocument(quizResults) | 퀴즈 완료 시 EXP 지급 (만점50, 90%→35, 70%→25, 50%→15, 미만→5) |
| `onQuizCreate` | onDocument(quizzes) | 퀴즈 생성 시 통계 초기화 |
| `onQuizMakePublic` | onDocument(quizzes) | 공개 상태 변경 처리 |
| `updateQuizStatistics` | internal | 퀴즈 통계 업데이트 |
| `generateReviewsOnResult` | onDocument(quizResults) | 퀴즈 완료 시 복습 데이터(reviews) 자동 생성 |

### 피드백
| 함수 | 타입 | 역할 |
|------|------|------|
| `onFeedbackSubmit` | onDocument(questionFeedbacks) | 피드백 제출 시 EXP 지급 (20 XP) |
| `onFeedbackStatusChange` | onDocument(questionFeedbacks) | 피드백 상태 변경 처리 |

### 게시판
| 함수 | 타입 | 역할 |
|------|------|------|
| `onPostCreate` | onDocument(posts) | 글 작성 EXP 지급 (30 XP) |
| `onCommentCreate` | onDocument(comments) | 댓글 작성 EXP 지급 (10 XP) |
| `onCommentDeleted` | onDocument(comments) | 댓글 삭제 시 카운트 감소 |
| `onLikeReceived` | onDocument(likes) | 좋아요 EXP 지급 (5 XP, 첫 좋아요만) |
| `onLikeRemoved` | onDocument(likes) | 좋아요 취소 처리 |

### 알림 (FCM)
| 함수 | 타입 | 역할 |
|------|------|------|
| `sendNotificationToUser` | onCall | 특정 유저에게 FCM 푸시 |
| `sendNotificationToClass` | onCall | 반 전체 FCM 푸시 |
| `onNewQuizCreated` | onDocument(quizzes) | 새 퀴즈 알림 |
| `onBoardCommentCreated` | onDocument(comments) | 댓글 알림 |
| `onBoardReplyCreated` | onDocument(replies) | 대댓글 알림 |
| `onAnnouncementCreated` | onDocument(announcements) | 공지 알림 |

### 인증/학생 관리
| 함수 | 타입 | 역할 |
|------|------|------|
| `registerStudent` | onCall | 학번 회원가입 (enrolledStudents 검증 + Firebase Auth 생성) |
| `bulkEnrollStudents` | onCall | 학생 일괄 등록 (교수, 최대 200명) |
| `resetStudentPassword` | onCall | 비밀번호 초기화 |
| `requestPasswordReset` | onCall | 비밀번호 찾기 (복구 이메일 발송 or 문의 안내) |
| `updateRecoveryEmail` | onCall | 복구 이메일 업데이트 |
| `deleteStudentAccount` | onCall | 계정 삭제 (Auth + Firestore + enrolledStudents 초기화) |
| `removeEnrolledStudent` | onCall | 학생 등록 제거 |
| `grantDefaultRabbit` | onCall | 기본 토끼 수동 지급 |
| `migrateExistingAccounts` | onCall | 기존 계정 마이그레이션 |
| `initProfessorAccount` | onCall | 교수 계정 초기화 |

### AI 문제 생성
| 함수 | 타입 | 역할 |
|------|------|------|
| `enqueueGenerationJob` | onCall | AI 문제 생성 Job 등록 (Rate limit: 분3/일15, dedupeKey) |
| `checkJobStatus` | onCall | Job 상태 조회 |
| `workerProcessJob` | onDocument(jobs) | 백그라운드 워커 (동시 최대 20, Gemini API 호출, 이미지 크롭) |
| `retryQueuedJobs` | onCall | 실패 Job 재시도 |
| `cleanupExpiredJobs` | onSchedule(매일) | 만료 Job 정리 |
| `generateStyledQuiz` | onCall | 스타일 기반 문제 생성 (deprecated) |
| `getStyleProfile` | onCall | 교수 출제 스타일 프로필 조회 |
| `onProfessorQuizCreated` | onDocument(quizzes) | 교수 퀴즈 스타일 학습 |

### 과목 범위 / OCR
| 함수 | 타입 | 역할 |
|------|------|------|
| `uploadCourseScope` | onCall | 과목 범위 업로드 (scope.md 파싱 → 챕터별 저장) |
| `getCourseScope` | onCall | 과목 범위 조회 |
| `runClovaOcr` / `getOcrUsage` | onCall | Naver CLOVA OCR |
| `runVisionOcr` / `getVisionOcrUsage` | onCall | Google Vision OCR |
| `analyzeImageRegionsCall` | onCall | Gemini Vision 이미지 영역 분석 |
| `generateQuizWithGemini` / `getGeminiUsage` / `extractKeywords` | onCall | Gemini 직접 호출 |
| `addToGeminiQueue` / `checkGeminiQueueStatus` / `claimGeminiQueueResult` | onCall | Gemini 큐 |
| `processGeminiQueue` | onSchedule(1분) | Gemini 큐 처리 |
| `cleanupGeminiQueue` | onSchedule(매시간) | Gemini 큐 정리 |

### 토끼 시스템
| 함수 | 타입 | 역할 |
|------|------|------|
| `spinRabbitGacha` | onCall | 뽑기 Roll (50XP 마일스톤, 랜덤 토끼 선택, pendingSpin 저장) |
| `claimGachaRabbit` | onCall | 뽑기 Claim (발견/놓아주기, 이름 짓기, 자동 장착) |
| `equipRabbit` | onCall | 토끼 장착 (slotIndex 0\|1) |
| `unequipRabbit` | onCall | 토끼 해제 |
| `levelUpRabbit` | onCall | 레벨업 (HP/ATK/DEF 각 1~3 랜덤 증가) |
| `onOnboardingComplete` | onDocument(users) | 기본 토끼(#0) 자동 지급 |

### 철권퀴즈 (배틀)
| 함수 | 타입 | 역할 |
|------|------|------|
| `joinMatchmaking` | onCall(RTDB) | 매칭 큐 참가 (트랜잭션 원자 매칭) |
| `cancelMatchmaking` | onCall(RTDB) | 매칭 취소 |
| `matchWithBot` | onCall(RTDB) | 봇 매칭 (30초 초과 시) |
| `submitAnswer` | onCall(RTDB) | 답변 제출 (양쪽 독립, 둘 다 제출 후 채점) |
| `submitTimeout` | onCall(RTDB) | 타임아웃 (미답변 = 오답) |
| `swapRabbit` | onCall(RTDB) | 토끼 교체 |
| `submitMashResult` | onCall(RTDB) | 연타 미니게임 결과 |
| `startBattleRound` | onCall(RTDB) | 라운드 시작 |
| `tekkenCleanup` | onSchedule(5분) | 매칭/배틀/캐시/seenQuestions 정리 |
| `tekkenPoolRefillScheduled` | onSchedule(매일 03:00) | 문제 풀 보충 (과목별 60문제 목표) |
| `tekkenPoolRefill` | onCall | 교수 수동 풀 초기화/재생성 |

### 랭킹/통계
| 함수 | 타입 | 역할 |
|------|------|------|
| `computeRankingsScheduled` | onSchedule(5분) | 랭킹 사전 계산 → rankings/{courseId} |
| `refreshRankings` | onCall | 수동 랭킹 갱신 |
| `computeRadarNormScheduled` | onSchedule(5분) | 6축 레이더 정규화 사전 계산 |
| `refreshRadarNorm` | onCall | 수동 레이더 갱신 |
| `collectWeeklyStatsScheduled` | onSchedule(매주 월요일) | 주별 자동 수집 (퀴즈/피드백/학생/게시판) |
| `generateMonthlyReport` | onCall | 월별 Claude 리포트 (claude-sonnet-4-20250514) |

### 공지 채널
| 함수 | 타입 | 역할 |
|------|------|------|
| `voteOnPoll` | onCall | 투표 (복수 선택 지원) |
| `reactToAnnouncement` | onCall | 이모지 리액션 |
| `markAnnouncementsRead` | onCall | 읽음 표시 |

### 기타
| 함수 | 타입 | 역할 |
|------|------|------|
| `checkRateLimitCall` | onCall | 도배 방지 (글 1분3개, 댓글 30초1개) |
| `cleanupRateLimitsScheduled` | onSchedule(매시간) | Rate limit 기록 정리 |
| `getUserStats` / `getLeaderboard` | onCall | 통계/랭킹 조회 |
| `resetSeason` | onCall | 시즌 리셋 (교수, 중간→기말) |
| `februaryTransition` / `augustTransition` | onSchedule | 학기 자동 전환 |
| `submitInquiry` | onCall | 비로그인 문의 저장 |
| `onPptxJobCreated` / `convertPptxToPdf` / `cleanupOldQuizJobs` | — | PPTX 처리 |
| `fillDogam` / `cleanupExtraRabbits` / `migrateRabbitStats` / `migrateFeedbackCount` / `migrateQuizAnswersTo0Indexed` | onCall | 디버그/마이그레이션 |

### Cloud Functions 유틸 (`functions/src/utils/`)
| 파일 | 역할 |
|------|------|
| `gold.ts` | EXP 계산/트랜잭션 (calculateQuizExp, addExpInTransaction) |
| `shardedCounter.ts` | 분산 카운터 (동시쓰기 대응, quiz_agg 샤드) |
| `rabbitStats.ts` | 토끼 베이스 스탯 (80마리) + 레벨업 랜덤 증가 (HP/ATK/DEF 각 1~3) |
| `tekkenDamage.ts` | 데미지 계산: max(ceil(ATK²/(ATK+DEF)×1.5), 2), 크리티컬 5초 이내 ×1.5, 셀프데미지 3 |
| `tekkenBot.ts` | 봇 AI (30초 초과 자동 생성, 정답률 65%, 응답 3~18초) |
| `rateLimitV2.ts` | 도배 방지 (recordAttempt용) |
| `materialCache.ts` | 교과 범위 캐시 |

## 주요 기능 상세

### 퀴즈 시스템

**문제 유형** (`QuestionType`): `'ox' | 'multiple' | 'short_answer' | 'essay' | 'combined'`

| 유형 | 학생 UI 명칭 | 답안 형식 | 비고 |
|------|------------|----------|------|
| OX | OX | 0\|1 | |
| 객관식 | 객관식 | number (0-indexed), 복수정답: number[] | 2~8개 선지 |
| 단답형 | 주관식 | string, 복수정답: `\|\|\|` 구분 | |
| 서술형 | — (교수 전용) | 루브릭 채점 (AI/수동) | |
| 결합형 | 결합형 | 공통 지문/이미지 + 하위 N문제 (OX/객관식/단답) | N문제 = N점 |

**answer 인덱싱 주의**:
- 수동 퀴즈: **1-indexed** (answer=1 → 첫 번째 선지)
- AI 퀴즈: **0-indexed** (answer=0 → 첫 번째 선지)
- publishQuiz 시 `originalType: 'professor-ai'` 필드로 AI 출처 추적

**퀴즈 풀이 → 결과 플로우**:
1. `/quiz/[id]` 풀이 (로컬 state에 답안 저장)
2. 제출 → CF `recordAttempt` (서버사이드 채점 + 분산 쓰기)
3. `/quiz/[id]/result` 결과 → `/quiz/[id]/feedback` 피드백 → EXP 지급

**피드백 점수**: praise(+2), wantmore(+1), other(0), typo(-1), unclear(-1), wrong(-2)

### AI 문제 생성 시스템

**교수 서재 플로우** (ProfessorLibraryTab → workerProcessJob):
1. 프롬프트 입력 + 파일 업로드(이미지/PDF/PPT) + 슬라이더 조정
2. **챕터 태그 필수 선택** → `extractChapterNumbersFromTags()` → `loadScopeForQuiz(forcedChapters)`
3. `enqueueGenerationJob` CF → `jobs/{jobId}` (status: QUEUED)
4. `workerProcessJob` 자동 트리거 (동시 최대 20)
5. styleProfile + scope + focusGuide 병렬 로드 → Gemini API 호출
6. HARD 난이도: Gemini Vision 영역 분석 + 이미지 자동 크롭 + ㄱㄴㄷ 보기
7. 완료 → LibraryJobToast 표시 (다른 페이지에서도)

**슬라이더 가중치**: 0-9% OFF, 10-49% 낮음, 50-74% 보통, 75-94% 높음, 95-100% 강력

**학생 AI 퀴즈**: AIQuizContainer 플로팅 버튼 → 태그 선택 → 같은 CF 호출

### 복습 시스템

- 유형: `wrong`(오답), `bookmark`(찜), `solved`(푼 문제)
- 퀴즈 완료 → 모든 문제 `solved`, 틀린 문제 추가 `wrong` → `reviews` 컬렉션
- `completedUsers` 배열로 퀴즈 완료 여부 추적
- 폴더 삭제 시 `completedUsers`에서 제거 → 퀴즈 목록에 다시 표시
- 퀴즈탭 복습 → `/review/library/[id]?from=quiz` (퀴즈 풀이 아님)
- 수정된 퀴즈: 복습탭에서만 "!" 뱃지 표시, 퀴즈탭에서는 완료 유지

### 토끼 발견/장착 시스템

**2단계 뽑기**:
1. `spinRabbitGacha` (Roll): 50XP 마일스톤 → 랜덤 토끼(0~79) 선택, pendingSpin 저장
2. `claimGachaRabbit` (Claim): 발견(이름 짓기, 영구) or 놓아주기

**장착**: 최대 2마리 (`equipRabbit` slotIndex 0|1), 뽑기 시 빈 슬롯 자동 장착

**기본 토끼 (#0)**: 온보딩 완료 시 `onOnboardingComplete` 트리거 자동 지급, 이름 없음

**마일스톤** (50XP마다): `MilestoneChoiceModal` 자동 표시 → 뽑기 or 레벨업 선택

**레벨업**: `levelUpRabbit` CF → level+1, HP/ATK/DEF 각 1~3 랜덤 증가

**도감**: 부모(최초 발견자, 금색) → N대 집사(후속) 2열 레이아웃, 20명 구분선

### 철권퀴즈 (배틀 퀴즈)

실시간 1v1 토끼 배틀. **Firebase Realtime Database** 사용 (프로젝트에서 유일한 RTDB 기능).

**플로우**: 매칭(30초, 봇 폴백) → countdown(3-2-1) → question(20초) → mash(연타 게이지) → roundResult → ... → finished(KO or 3분)

**데미지**: `baseDamage = max(ceil(ATK²/(ATK+DEF)×1.5), 2)`, 크리티컬(5초 이내) ×1.5, 오답 셀프데미지 3

**XP**: 승리 30, 패배 10, 연승 +5 (최대 50)

**문제 소스 우선순위**: Firestore 문제 풀(사전 생성, 중복 방지) → RTDB per-user 캐시 → Gemini 실시간 → 비상 문제

**문제 풀 사전 생성** (`tekkenQuestionPool.ts`):
- 매일 새벽 3시 스케줄: 7일 지난 문제 삭제 + 과목당 60문제 보충
- seenQuestions로 24시간 내 중복 방지 (6배틀까지 완전 비중복)
- 교수 챕터 변경 시 풀 전체 초기화 + 재생성

### 공지 채널

홈 바텀시트 교수님 공지 시스템:
- 텍스트/다중 이미지/다중 파일/다중 투표(복수 선택) + 이모지 리액션
- **9-slice 말풍선**: absolute positioning + padding 방식 (BUBBLE_C=14, BUBBLE_SIDE_MULTI=26)
- **캐러셀**: 2개 이상일 때 화살표 + 스냅 스크롤 + 점 인디케이터
- **검색**: 키워드 매칭 하이라이트 + 상/하 화살표 FAB 탐색
- **캘린더**: 년/월 선택, 메시지 있는 날 표시, 클릭 시 스크롤
- Firestore `polls` 업데이트 시 반드시 전체 배열로 (dot notation 금지 → 객체 변환 버그)

### 랭킹 시스템

**개인**: `profCorrectCount × 4 + totalExp × 0.6`
**팀**: `normalizedAvgExp × 0.4 + avgCorrectRate × 0.4 + avgCompletionRate × 0.2`

사전 계산: CF `computeRankingsScheduled` (5분마다) → `rankings/{courseId}` 1개 문서
클라이언트: sessionStorage SWR (TTL 2분/10분)

### 교수 학생 모니터링

**6축 레이더**: 정답률(절대값), 성장세(재시도+오답극복), 출제력/소통/복습력/활동량(백분위)

**Progressive Loading** (Phase 0→1→2):
- Phase 0: 캐시에서 즉시 (0초, growth=50 임시)
- Phase 1: user doc + 6개 쿼리 병렬 → 실제 데이터
- Phase 2: norm 캐시 빌드 후 재계산

**모듈 레벨 캐시** (페이지 이동/과목 전환에도 유지): `_normCacheMap`, `_weightedCacheMap`, `_studentsListCacheMap` (5분 TTL, stale-while-revalidate)

### 주별 수집 + 월별 리포트

**주별**: 매주 월요일 00:00 KST → `weeklyStats/{courseId}/weeks/{year-Wxx}` (퀴즈/피드백/학생 군집/게시판)

**월별**: 교수 수동 트리거 → Claude Sonnet (`claude-sonnet-4-20250514`) → 인사이트 마크다운

**다운로드**: Excel (exceljs, 5시트) + Word (docx, 연구용 형식)

### 인증 시스템

**학번+비밀번호**: 학번 `20230001` → `20230001@rabbitory.internal` (Firebase Auth)
- 교수 사전 등록(`enrolledStudents`)된 학번만 가입 가능
- 학번당 1개 계정만 (isRegistered 플래그 + Auth 이메일 유니크)
- Rate limit: IP당 10분 5회

**교수**: 허용 이메일 목록 기반 자동 권한 설정

### 게시판

- 신문 스타일: 고정글 캐러셀 + Masonry 2열
- 글 EXP 30, 댓글 10, 좋아요 5 (첫 번째만)
- 도배 방지: 글 1분 3개, 댓글 30초 1개

## UI 테마 시스템

### 빈티지 신문 스타일 (공통)
- 배경 #F5F0E8(크림), 보조 #EBE5D9, 카드 #FDFBF7
- 텍스트 #1A1A1A, 음소거 #5C5C5C
- 테두리 #D4CFC4(밝은) / #1A1A1A(진한)

### 반별 강조색 (CSS 변수 `--theme-accent`)
| 반 | accent | accentLight | 분위기 |
|---|--------|-------------|--------|
| A | #8B1A1A (버건디) | #D4A5A5 | 열정적 |
| B | #B8860B (다크 골드) | #E8D5A3 | 따뜻함 |
| C | #1D5D4A (에메랄드) | #A8D4C5 | 안정적 |
| D | #1E3A5F (네이비) | #A8C4E0 | 신뢰감 |

**생물학**: `courseId === 'biology'`이면 반별 대신 `accent: #2E7D32` (자연 녹색) 단일 테마

### 글꼴
- **Noto Sans KR** — 본문 (한글)
- **Playfair Display** — 빈티지 헤더 (`.font-serif-display`, `.btn-vintage`)
- **Cormorant Garamond** — 우아한 세리프 (`.font-serif-elegant`)

### 유틸리티 클래스 (`globals.css`)
- `.card-vintage` — 테두리 + 그림자 + hover
- `.btn-vintage` / `.btn-vintage-outline` — 빈티지 버튼
- `.decorative-corner` — 신문 코너 장식
- `.pb-navigation` — 네비게이션 + safe area 패딩
- 전역 스크롤바 숨김, `overflow-x: hidden`, `overscroll-behavior: none`

### 플로팅 글래스 카드 (입력 영역 공통 패턴)
- 밝은 배경: `fixed left-3 right-3 rounded-2xl bg-[#F5F0E8]/80 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-[#D4CFC4]/60`
- 어두운 배경 (공지채널): `mx-3 mb-3 rounded-2xl bg-white/8 backdrop-blur-xl border border-white/15`

## 반응형 레이아웃

### 2버전 레이아웃
| 모드 | 조건 | 전략 |
|------|------|------|
| 세로모드 | < 1024px 또는 portrait | 네이티브 반응형 (CSS zoom 제거됨) |
| 가로모드 | landscape + 1024px 이상 | 좌측 사이드바(72px) + 중앙(max-w 640px) |

- `useWideMode()` — 가로모드 감지
- `getZoom()` → 항상 1 (하위 호환)
- `scaleCoord()` → identity 함수 (하위 호환)
- Tailwind: `wide: { raw: '(orientation: landscape) and (min-width: 1024px)' }`

### 네비게이션 탭

**학생** (4탭): `/`(홈), `/quiz`, `/review`, `/board`
**교수** (5탭, maxWidth 420px): `/professor`, `/professor/stats`, `/professor/quiz`, `/professor/students`, `/board`

### 네비게이션 숨김 규칙

**경로 기반** (`layout.tsx`의 `hideNavigation`):
- 홈 `/` — 세로모드에서만 (가로모드 사이드바 항상 표시)
- `/quiz/[id]/*`, `/edit`, `/ranking`, `/review/random`, `/review/[type]/[id]`

**모달 기반** (`data-hide-nav` body 속성):
- 도감, 뽑기, 공지 채널 모달 → `document.body.setAttribute('data-hide-nav', '')` → Navigation MutationObserver 감지

### PWA 설정
- `viewport-fit: cover` + `apple-mobile-web-app-capable: yes` + `status-bar-style: black-translucent`
- manifest `orientation: any`, `display: standalone`
- 개발 모드 PWA 비활성화 (`disable: NODE_ENV === "development"`)
- 프로덕션 `console.log` 자동 제거 (`compiler.removeConsole`)
- 비디오 캐싱 제외 (`/videos/` → `NetworkOnly`)
- Next.js Image 원격 패턴: `firebasestorage.googleapis.com`

## 과목 시스템

| 과목 ID | 이름 | 학년/학기 |
|---------|------|----------|
| `biology` | 생물학 | 1학년 1학기 |
| `pathophysiology` | 병태생리학 | 1학년 2학기 |
| `microbiology` | 미생물학 | 2학년 1학기 |

- 학기 자동 판별: 02-22~08-21 → 1학기, 08-22~02-21 → 2학기
- 퀴즈 필터 탭: `midterm | final | past | custom`, 날짜 기반 기본 탭 자동 선택

## Firestore 주요 컬렉션

| 컬렉션 | 읽기 | 쓰기 | 비고 |
|--------|------|------|------|
| `users/{uid}` | 본인/교수(get), 로그인 전체(list) | 본인(제한 필드) | 보호: totalExp, rank, role, badges, equippedRabbits 등 |
| `users/{uid}/quizHistory/{id}` | 본인/교수 | CF 전용 | |
| `users/{uid}/expHistory/{id}` | 본인/교수 | CF 전용 | |
| `users/{uid}/rabbitHoldings/{id}` | 본인/교수 | CF 전용 | |
| `quizzes/{id}` | 로그인 전체 | 교수/본인 자작 | type: midterm\|final\|past\|professor\|professor-ai\|custom\|ai-generated |
| `quizResults/{id}` | 로그인 전체 | 본인 | |
| `reviews/{id}` | 본인/교수 | 본인 | |
| `posts/{id}` | 로그인 전체 | 본인/교수(삭제) | |
| `comments/{id}` | 로그인 전체 | 본인/교수(삭제) | |
| `likes/{id}` | 로그인 전체 | 본인 | |
| `announcements/{id}` | 로그인 전체 | 교수만 | 리액션/투표/읽음은 CF |
| `rabbits/{courseId_rabbitId}` | 로그인 전체 | CF 전용 | |
| `enrolledStudents/{courseId}/students/{id}` | 교수만 | 교수만 | 학번 사전 등록 |
| `rankings/{courseId}` | 로그인 전체 | CF 전용 | 5분 사전 계산 |
| `radarNorm/{courseId}` | 로그인 전체 | CF 전용 | |
| `settings/{id}` + 하위 | 로그인 전체 | 교수만 | tekken/courses/{courseId} 등 |
| `tekkenQuestionPool/{courseId}` + 하위 | CF 전용 | CF 전용 | 문제 풀 + seenQuestions |
| `weeklyStats/{courseId}/weeks/{label}` | 교수만 | CF 전용 | |
| `monthlyReports/{courseId}/months/{label}` | 교수만 | CF 전용 | |
| `jobs/{id}` | 본인 | CF 전용 | AI 생성 Job |
| `questionFeedbacks/{id}` | 본인/교수/퀴즈 제작자 | 본인(생성) | |
| `fcmTokens/{id}` | 본인 | 본인 | |
| `inquiries/{id}` | 교수 | CF(생성) | |

## 토끼 에셋

- `/public/rabbit/rabbit-001.png` ~ `rabbit-080.png` — 전신 (520:969 종횡비)
- `/public/rabbit_profile/rabbit-001-pf.png` ~ `rabbit-080-pf.png` — 프로필

**rabbitId ↔ 파일명**: rabbitId 0~79 (0-indexed), 파일명 001~080 (1-indexed)
- `getRabbitImageSrc(rabbitId)` → `/rabbit/rabbit-{id+1}.png`
- `getRabbitProfileUrl(rabbitId)` → `/rabbit_profile/rabbit-{id+1}-pf.png`

## 홈 화면 구조

- `CharacterBox`: 캐릭터 히어로, 배경, XP 배지, 도감 버튼, EXP 바 (`bg-black/40 rounded-full backdrop-blur-xl`)
  - 2마리 궤도 캐러셀 (타원 공전, Framer Motion `useSpring`/`useTransform`)
  - 빈 슬롯 "?" 플레이스홀더, 스탯 "-"
  - 마일스톤 버튼 (EXP 바 좌측, pendingCount > 0)
- 바텀시트: 프로필, 공지 채널, 랭킹
- `h-screen overflow-hidden` 컨테이너 (body style 직접 조작 금지)
- **z-index**: 바텀시트 `relative z-10` → 모달은 `createPortal(body)` 필수

## 코딩 컨벤션

- 응답/주석/커밋/문서: 한국어
- 변수명/함수명: 영어
- 들여쓰기: 2칸
- 컴포넌트: React 함수형 + TypeScript
- 경로 별칭: `@/*` → 프로젝트 루트
- `font-serif-display` 퀴즈 제목에 사용 금지
- 패널/박스/태그: `bg-[#F5F0E8]` + `border-2 border-[#1A1A1A]` 통일

## 알려진 제약

### Firestore Security Rules 보호 필드
`totalExp`, `rank`, `role`, `badges`, `equippedRabbits`, `totalCorrect`, `totalAttemptedQuestions`, `professorQuizzesCompleted`, `lastGachaExp`, `spinLock` — Cloud Functions에서만 수정 가능

### 온보딩 (폐기됨)
온보딩은 회원가입에 통합됨. `/onboarding/*` → 홈 리다이렉트. `onboarding_just_completed` localStorage 플래그로 재리다이렉트 방지

### 퀴즈 목록 정렬
- 퀴즈탭: 미완료 > 완료 > 최신순 (수정된 퀴즈도 완료 유지, "!" 미표시)
- 복습탭: 수정된 퀴즈 우선 > 최신순 ("!" 뱃지 표시)

### Firebase 배포 (규칙 변경 시)
```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
```

## Safe Area 처리
- `html { background-color: #000 }` — 아이폰 둥근 모서리 뒤 검정
- `body { padding-top: env(safe-area-inset-top) }` — 노치/다이내믹 아일랜드
- Navigation: `bottom: max(1rem, calc(env(safe-area-inset-bottom) + 0.5rem))`
- 홈 배경: `marginTop: -env(safe-area-inset-top)` + `paddingTop`으로 확장

## SwipeBack (뒤로가기 스와이프)
- `SwipeBack.tsx` — 왼쪽 25px 가장자리 오른쪽 스와이프 → router.back()
- 트리거: 화면 폭 35% 초과 또는 velocity > 500
- 홈/교수홈/가로모드에서 비활성화
