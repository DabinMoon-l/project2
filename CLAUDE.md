# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

대학 수업 보조 앱 "용사 퀴즈". 퀴즈 + 게시판 기능에 용사 컨셉 게이미피케이션을 적용한 PWA.
학생은 퀴즈를 풀고 피드백을 남기며, 교수님은 문제에 대한 피드백을 수집하고 학생 참여도를 모니터링.

## 기술 스택

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **애니메이션**: Framer Motion (페이지 전환, UI), Lottie (캐릭터, 레이스)
- **상태 관리**: React Query
- **Backend**: Firebase (Auth, Firestore, Cloud Functions, Cloud Messaging)
- **OCR**: Tesseract.js
- **PDF**: jsPDF
- **배포**: Vercel (PWA)

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

# Cloud Functions 배포
cd functions && npm run deploy
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
- 문제 유형: OX, 객관식 (4지선다), 주관식
- 퀴즈 풀이 중 즉시 피드백 버튼 (❗)
- 오답은 자동으로 복습창에 저장
- 자체제작 퀴즈: Tesseract OCR로 사진/PDF → 텍스트 추출

### 캐릭터 시스템
- 기본: 귀여운 토끼 캐릭터
- 커스터마이징: 머리스타일, 피부색, 수염
- 계급: 견습생 → 용사 → 기사 → 장군 → 대원수 → 전설의 용사
- 갑옷은 계급으로만 획득 (Shop 구매 불가)

### 시즌 시스템
- 중간 → 기말 전환 시: 계급, 갑옷/무기, Shop 아이템 초기화
- 골드, 캐릭터 외형, 뱃지는 유지

### 보안
- Firestore Security Rules로 데이터 접근 제어
- 도배 방지: 글 1분 3개, 댓글 30초 1개 제한
