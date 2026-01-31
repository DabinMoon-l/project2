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
├── items/             # Shop 아이템 에셋
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

### 골드/경험치 처리
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
- 퀴즈 풀이 중 즉시 피드백 버튼 (❗)
- 오답은 자동으로 복습창에 저장
- 자체제작 퀴즈: Tesseract OCR로 사진/PDF → 텍스트 추출
- OCR 처리 중 취소 기능 지원

### 캐릭터 시스템
- 기본: 귀여운 토끼 캐릭터
- 커스터마이징: 머리스타일, 피부색, 수염
- 계급: 견습생 → 용사 → 기사 → 장군 → 대원수 → 전설의 용사
- 갑옷은 계급으로만 획득 (Shop 구매 불가)

### 시즌 시스템
- 중간 → 기말 전환 시: 계급, 갑옷/무기, Shop 아이템 초기화
- 골드, 캐릭터 외형, 뱃지는 유지

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
- **중요**: `gold`, `totalExp`, `rank`, `role`, `badges` 필드는 클라이언트에서 수정 불가 (Cloud Functions 전용)

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
    ├── shop/            # 상점
    ├── profile/         # 프로필
    ├── settings/        # 설정
    └── professor/       # 교수님 전용
```

`(main)` 라우트 그룹은 `layout.tsx`에서 인증 상태와 온보딩 완료 여부를 체크하며, `UserProvider`로 프로필을 전역 관리함

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

## 진행 중인 작업

### 퀴즈 생성 시스템 개편 (진행 중)
- [x] OCR 진행률 컴포넌트 앱 스타일 적용 (`OcrProgress.tsx`, `OCRProcessor.tsx`)
- [x] OCR 처리 취소 기능 추가
- [x] 퀴즈 생성 페이지 레이아웃 수정 (sticky 버튼, flex 레이아웃)
- [x] OCR 뒤로가기 시 재시작 버그 수정
- [x] `lib/ocr.ts` 타입 정의 확장 (QuestionType 5종, RubricItem, SubQuestion)
- [ ] `QuestionEditor.tsx` 리팩토링 (5가지 문제 유형 지원)
  - 객관식 선지 수 조절 (2~8개)
  - 서술형 루브릭 편집기
  - 결합형 문제 지원 (공통 지문/이미지 + 하위 문제)

### 타입 정의 (`lib/ocr.ts`)
```typescript
// 문제 유형
type QuestionType = 'ox' | 'multiple' | 'short_answer' | 'essay' | 'combined';

// 서술형 루브릭 항목
interface RubricItem {
  criteria: string;      // 평가요소 이름
  percentage: number;    // 배점 비율 (0-100)
  description?: string;  // 평가 기준 상세 설명
}
```
