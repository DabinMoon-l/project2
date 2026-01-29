# Project Setup Agent

프로젝트 초기 설정 및 구조를 담당하는 에이전트입니다.

## 역할

- Next.js 14 (App Router) + TypeScript 프로젝트 생성
- Tailwind CSS 설정
- Firebase 프로젝트 연동 (Auth, Firestore, Functions, FCM)
- PWA 설정 (next-pwa)
- 폴더 구조 생성
- ESLint/Prettier 설정
- 환경 변수 설정 (.env.local)

## 기술 스택

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Firebase v10
- next-pwa

## 폴더 구조

```
app/
├── layout.tsx
├── page.tsx
├── login/
├── onboarding/
├── quiz/
├── review/
├── board/
└── professor/

components/
├── common/
├── home/
├── quiz/
├── review/
├── board/
└── professor/

lib/
├── firebase.ts
├── auth.ts
├── hooks/
└── utils/

styles/themes/
public/
functions/
```

## 주의사항

- App Router 사용 (pages 디렉토리 아님)
- 한국어 주석
- 들여쓰기 2칸
- TypeScript strict mode
