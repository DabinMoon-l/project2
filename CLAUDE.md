# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

대학 수업 보조 앱 "용사 퀴즈". 퀴즈 + 게시판 기능에 용사 컨셉 게이미피케이션을 적용한 PWA.
학생은 퀴즈를 풀고 피드백을 남기며, 교수님은 문제에 대한 피드백을 수집하고 학생 참여도를 모니터링.

## 기술 스택

- **Frontend**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS
- **애니메이션**: Framer Motion (페이지 전환, UI), Lottie (캐릭터)
- **Backend**: Firebase (Auth, Firestore, Cloud Functions, Cloud Messaging)
- **OCR**: Tesseract.js
- **PDF**: pdfjs-dist
- **배포**: Vercel (PWA, next-pwa)

## UI 테마 (빈티지 신문 스타일)

- **배경색**: #F5F0E8 (크림)
- **주요 텍스트/테두리**: #1A1A1A (검정)
- **보조 배경**: #EDEAE4
- **음소거 텍스트**: #5C5C5C
- **성공**: #1A6B1A (녹색)
- **오류**: #8B1A1A (빨강)
- **둥근 모서리 없음** (rounded-none)

## 개발 명령어

```bash
# 의존성 설치
npm install

# 개발 서버
npm run dev

# 빌드
npm run build

# 프로덕션 실행
npm start

# 린트
npm run lint

# 번들 분석
npm run analyze
```

### Cloud Functions

```bash
cd functions

# 빌드
npm run build

# 에뮬레이터로 로컬 테스트
npm run serve

# 배포
npm run deploy

# 로그 확인
npm run logs
```

## 아키텍처

### 폴더 구조
```
app/                    # Next.js App Router 페이지
├── login/             # 소셜 로그인
├── onboarding/        # 학적정보 입력, 캐릭터 생성, 튜토리얼
├── quiz/              # 퀴즈 목록, 풀이, 결과, 피드백
├── review/            # 복습 (오답노트, 찜한 문제)
├── board/             # 게시판 (To 교수님, 우리들끼리)
└── professor/         # 교수님 전용 (대시보드, 학생 모니터링, 문제 분석)

components/
├── common/            # 버튼, 인풋, 카드, 모달, 바텀시트, Navigation
├── home/              # 홈 화면 컴포넌트
├── quiz/              # 퀴즈 관련 컴포넌트
├── review/            # 복습 관련 컴포넌트
├── board/             # 게시판 컴포넌트
└── professor/         # 교수님 전용 컴포넌트

lib/
├── firebase.ts        # Firebase 설정
├── auth.ts            # 인증 로직
├── hooks/             # 커스텀 훅
└── utils/             # 유틸리티 함수

styles/themes/         # 반별 테마 (A빨강/B노랑/C초록/D파랑)

public/
├── rabbit/            # 토끼 캐릭터 에셋
└── animations/        # Lottie 애니메이션

functions/             # Firebase Cloud Functions
```

### 사용자 유형
- **학생**: 소셜 로그인 → 학적정보 입력 → 캐릭터 생성 → 퀴즈/게시판 사용
- **교수님**: 특정 이메일로 로그인 시 관리자 모드 자동 전환

### 반별 테마 시스템
| 반 | 메인 배경 | 강조색 |
|---|----------|--------|
| A | #4A0E0E (버건디) | #D4AF37 (골드) |
| B | #F5E6C8 (크림) | #3D2B1F (브라운) |
| C | #0D3D2E (에메랄드) | #C0C0C0 (실버) |
| D | #1A2744 (네이비) | #CD7F32 (브론즈) |

### 온보딩 반 선택 아이콘 색상 (원색)
| 반 | 색상 |
|---|------|
| A | #EF4444 (빨강) |
| B | #EAB308 (노랑) |
| C | #22C55E (초록) |
| D | #3B82F6 (파랑) |

### 경험치 처리
- 클라이언트에서 직접 수정 불가
- Cloud Functions에서 검증 후 지급

## 코딩 컨벤션

- 응답 및 코드 주석: 한국어
- 변수명/함수명: 영어
- 들여쓰기: 2칸
- 컴포넌트: React 함수형 컴포넌트 + TypeScript

## 주요 기능 구현 시 참고

### 퀴즈 시스템
- 문제 유형: OX, 객관식, 단답형, 서술형, 결합형 (총 5가지)
  - **OX**: 참/거짓 문제
  - **객관식**: 2~8개 선지 지원 (기존 4지선다에서 확장)
  - **단답형**: 짧은 텍스트 답변 (기존 주관식)
  - **서술형**: 긴 답변 + 루브릭 채점 (평가요소 * 배점 비율)
  - **결합형**: 공통 지문/이미지 + 여러 하위 문제
- 오답은 자동으로 복습창에 저장
- 자체제작 퀴즈: Tesseract OCR로 사진/PDF → 텍스트 추출
- OCR 처리 중 취소 기능 지원
- **피드백**: 퀴즈 완료 후 피드백 페이지에서 4가지 타입 선택 (문제 이해 안됨/정답 오류/오타/기타)
- **EXP 토스트**: 피드백 완료 후 표시 (결과 페이지에서 이동)
- **완료된 퀴즈**: 목록에서 50% 검정 오버레이 + "완료" 뱃지로 표시 (클릭 비활성화)

### 캐릭터 시스템
- 기본: 귀여운 토끼 캐릭터
- 커스터마이징: 머리스타일, 피부색, 수염
- 계급: 견습생 → 용사 → 기사 → 장군 → 대원수 → 전설의 용사
- 갑옷은 계급으로만 획득

### 시즌 시스템
- 중간 → 기말 전환 시: 계급, 갑옷/무기 초기화
- 캐릭터 외형, 뱃지는 유지

### 복습 시스템
- 복습 유형: `wrong` (오답), `bookmark` (찜), `solved` (푼 문제)
- 퀴즈 완료 시 모든 문제가 `reviews` 컬렉션에 `reviewType: 'solved'`로 저장
- 틀린 문제는 추가로 `reviewType: 'wrong'`으로 저장
- 퀴즈 문서의 `completedUsers` 배열로 완료 여부 추적
- 완료된 퀴즈는 퀴즈 목록에서 필터링됨
- 폴더 삭제 시 `completedUsers`에서 제거되어 퀴즈 목록에 다시 표시
- 커스텀 폴더에 다른 탭(푼 문제/오답/찜)에서 문제 추가 가능

### 보안
- Firestore Security Rules로 데이터 접근 제어
- 도배 방지: 글 1분 3개, 댓글 30초 1개 제한
- **중요**: `totalExp`, `rank`, `role`, `badges` 필드는 클라이언트에서 수정 불가 (Cloud Functions 전용)

## 라우트 구조

```
app/
├── login/               # 로그인 페이지
├── signup/              # 회원가입 페이지
├── verify-email/        # 이메일 인증 페이지
├── onboarding/          # 온보딩 플로우
│   ├── student-info/    # 학적정보 입력
│   ├── character/       # 캐릭터 커스터마이징
│   ├── nickname/        # 닉네임 설정
│   └── tutorial/        # 튜토리얼
└── (main)/              # 인증 필요 라우트 그룹
    ├── page.tsx         # 홈
    ├── quiz/            # 퀴즈 목록 및 풀이
    │   ├── [id]/        # 퀴즈 상세
    │   │   ├── result/  # 결과 화면
    │   │   └── feedback/ # 피드백 화면 (스와이프 기반)
    │   └── create/      # 퀴즈 생성
    ├── review/          # 복습 (오답노트, 찜한 문제, 푼 문제)
    │   └── [type]/[id]/ # 폴더 상세 (문제 목록, 연습 모드)
    ├── board/           # 게시판
    ├── profile/         # 프로필
    ├── settings/        # 설정
    └── professor/       # 교수님 전용
```

`(main)` 라우트 그룹은 `layout.tsx`에서 인증 상태와 온보딩 완료 여부를 체크하며, `UserProvider`로 프로필을 전역 관리함

### 네비게이션 숨김 규칙
- `/quiz/[id]/*` 경로: 퀴즈 풀이, 결과, 피드백 페이지
- `/edit` 포함 경로: 퀴즈 수정 페이지

## 알려진 이슈 및 해결책

### Firestore Security Rules 관련
클라이언트에서 사용자 문서 업데이트 시 다음 필드는 포함하면 안 됨:
```javascript
// ❌ 이렇게 하면 Security Rules에서 거부됨
await setDoc(doc(db, 'users', uid), {
  totalExp: 0,
  rank: '견습생',
  // ...
}, { merge: true });

// ✅ 허용된 필드만 사용
await setDoc(doc(db, 'users', uid), {
  onboardingCompleted: true,
  updatedAt: serverTimestamp(),
}, { merge: true });
```

### 온보딩 완료 후 리다이렉트
`onboarding_just_completed` localStorage 플래그를 사용하여 온보딩 직후 홈 화면 진입 시 다시 온보딩으로 리다이렉트되는 것을 방지함

## 퀴즈 생성 시스템

### 역할별 문제 유형
| 역할 | 선택 가능한 유형 |
|------|-----------------|
| **학생** | OX, 객관식, 주관식, 결합형 (4개) |
| **교수** | OX, 객관식, 단답형, 서술형, 결합형 (5개) |

- 학생의 "주관식" = 내부적으로 `short_answer` (단답형)
- `QuestionEditor`에 `userRole?: 'student' | 'professor'` prop 전달

### 문제 유형별 기능

#### 객관식
- 선지 2~8개 동적 추가/삭제
- **복수정답 모드**: ON/OFF 토글 (녹색 스타일)

#### 서술형 (교수 전용)
- **채점 방식 선택**: AI 보조 / 수동
- **AI 보조**: 루브릭 필수, 예상 비용 안내 (160명 기준 약 3,000원)
- **수동**: 루브릭 선택사항, 토글로 추가/삭제
- 모범답안 입력 필드 제공

#### 결합형
- **공통 지문**: 텍스트 박스 / ㄱ.ㄴ.ㄷ. 형식 중 선택
- **공통 이미지**: 별도 업로드
- **필수 조건**: 공통 지문 OR 공통 이미지 중 하나 이상
- **하위 문제**: OX, 객관식, 단답형 (서술형 제외)
  - 각 하위 문제에 보기 (텍스트/ㄱㄴㄷ) + 이미지 추가 가능
  - 객관식은 복수정답 지원
- **문제 수 계산**: 하위 문제 N개 = N문제로 계산 (`calculateTotalQuestionCount()`)

### 타입 정의

#### `lib/ocr.ts`
```typescript
type QuestionType = 'ox' | 'multiple' | 'short_answer' | 'essay' | 'combined';

interface RubricItem {
  criteria: string;      // 평가요소 이름
  percentage: number;    // 배점 비율 (0-100)
  description?: string;  // 평가 기준 상세 설명
}
```

#### `lib/scoring.ts` (부분점수 채점)
```typescript
// 주요 함수
calculateEssayScore(rubricScores)      // 루브릭 점수 합산
createEmptyEssayScore(questionId, rubric)  // 빈 채점 결과 생성
validateEssayScore(result)             // 유효성 검사
updateRubricScore(result, index, score, feedback)  // 점수 업데이트
generateScoreSummary(result)           // 채점 결과 텍스트 요약
```

### 한글 라벨 상수
```typescript
// components/quiz/create/QuestionEditor.tsx
export const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
```

## 진행 중인 작업

### 퀴즈 시스템 개선 (완료)
- [x] 퀴즈 풀이 중 즉시 피드백 버튼 제거
- [x] 피드백 페이지 UI 개선 (4가지 피드백 타입 선택 버튼)
- [x] EXP 토스트 결과 페이지 → 피드백 완료 후로 이동
- [x] 피드백 페이지 Firebase 오류 수정 (마운트 상태 체크)
- [x] 결합형 문제 라벨에서 이모지 제거 (📋, 📷)
- [x] 복습 페이지 문제 순서 정렬 (questionId 기준)
- [x] 주관식 복수정답 ||| 구분자 표시 수정
- [x] 정답 미표시 문제 수정 (null 체크 강화)
- [x] 완료된 퀴즈 목록 표시 변경 (50% 오버레이 + 완료 뱃지)
- [x] 퀴즈 수정 페이지 네비게이션 숨김 및 저장 버튼 위치 수정

### 온보딩 UI 개선 (완료)
- [x] 학적정보/닉네임 페이지 UI 중앙 정렬
- [x] 반 선택 아이콘 원색으로 변경 (빨강/노랑/초록/파랑)

### 퀴즈 생성 시스템 개편 (완료)
- [x] OCR 진행률 컴포넌트 앱 스타일 적용
- [x] OCR 처리 취소 기능 추가
- [x] 역할별 문제 유형 필터링 (학생/교수)
- [x] 서술형 채점 방식 선택 (AI 보조/수동)
- [x] 결합형 공통 지문 형식 선택 (텍스트/ㄱㄴㄷ)
- [x] 하위 문제 보기 형식 선택 + 이미지 지원
- [x] 하위 문제 객관식 복수정답 기능
- [x] 문제 수 계산 로직 (`calculateTotalQuestionCount`)
- [x] 부분점수 채점 로직 (`lib/scoring.ts`)
- [x] AI 보조 채점 Cloud Function 구현 (Claude API 연동) - `functions/src/essay.ts`
- [x] 퀴즈 생성 페이지에서 `userRole` prop 전달 (현재 사용자 역할 기반)
- [x] 서술형 채점 UI 구현 (교수용) - `components/professor/EssayGrading.tsx`

### 배포 전 필요 사항
- [ ] Firebase Functions에 `ANTHROPIC_API_KEY` 환경 변수 설정
  ```bash
  firebase functions:secrets:set ANTHROPIC_API_KEY
  ```
