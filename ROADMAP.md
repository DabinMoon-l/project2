# 🗺️ 용사 퀴즈 - ROADMAP

## 1. 기술 스택

### 1.1 Frontend
| 기술 | 용도 |
|------|------|
| Next.js 14 | 프레임워크 (App Router) |
| TypeScript | 타입 안정성 |
| Tailwind CSS | 스타일링 |
| Framer Motion | 페이지 전환, UI 애니메이션 |
| Lottie | 캐릭터/레이스 애니메이션 |
| React Query | 데이터 캐싱, 상태 관리 |

### 1.2 Backend
| 기술 | 용도 |
|------|------|
| Firebase Auth | 소셜 로그인 (Apple/Google/Naver) |
| Firebase Firestore | 데이터베이스 |
| Firebase Cloud Functions | 서버 로직 (골드/경험치 처리) |
| Firebase Cloud Messaging | 푸시 알림 |

### 1.3 기타
| 기술 | 용도 |
|------|------|
| Tesseract.js | OCR (사진/PDF → 텍스트) |
| jsPDF | 퀴즈 PDF 다운로드 |
| next-pwa | PWA 설정 |
| Vercel | 배포 |

---

## 2. MCP 설정

### 2.1 Playwright MCP
**브라우저 자동화/테스트**

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@anthropic/mcp-playwright"]
    }
  }
}
```

용도:
- 앱 자동 테스트
- 로그인 → 퀴즈 풀기 → 결과 확인 자동화
- 버그 탐지

### 2.2 Context7 MCP
**최신 문서 실시간 검색**

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["@anthropic/mcp-context7"]
    }
  }
}
```

용도:
- Next.js 14 최신 문법
- Firebase v10 최신 API
- Framer Motion / Tailwind 최신 사용법
- deprecated 코드 방지

### 2.3 전체 MCP 설정 파일
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@anthropic/mcp-playwright"]
    },
    "context7": {
      "command": "npx",
      "args": ["@anthropic/mcp-context7"]
    }
  }
}
```

---

## 3. Agent 활용 가이드

### 3.1 명확한 지시
```
❌ "퀴즈 만들어줘"
✅ "퀴즈 풀이 화면 만들어줘. 객관식 4지선다, 이전/다음 버튼, 상단에 진행도 표시, Framer Motion으로 페이지 전환"
```

### 3.2 단계별 작업
```
1단계: "프로젝트 세팅해줘"
2단계: "공통 컴포넌트 만들어줘"
3단계: "홈 화면 만들어줘"
...
```

### 3.3 컨텍스트 제공
- CLAUDE.md: 프로젝트 규칙
- PRD.md: 기획서
- ROADMAP.md: 개발 계획

### 3.4 피드백
- "버튼 왼쪽으로"
- "색상 더 진하게"
- "애니메이션 더 부드럽게"

---

## 4. 성능 최적화

### 4.1 애니메이션 (60fps 유지)
- Framer Motion: 페이지 전환, 모달, 버튼
- Lottie: 캐릭터, 레이스, 이펙트
- GPU 가속: transform, opacity 사용
- will-change 속성 활용

### 4.2 로딩 최적화
- Next.js Image 최적화
- 코드 스플리팅 (dynamic import)
- Skeleton UI (로딩 중 표시)
- React Query 캐싱

### 4.3 PWA 최적화
- Service Worker 캐싱 전략
- 오프라인 모드 지원
- 앱 설치 프롬프트

---

## 5. 보안

### 5.1 인증
- Firebase Auth (소셜 로그인)
- 교수님: 특정 이메일로 자동 관리자 전환

### 5.2 데이터 접근 제어
```javascript
// Firestore Security Rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // 본인 데이터만 접근
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
    }
    
    // 퀴즈는 로그인한 사람만
    match /quizzes/{quizId} {
      allow read: if request.auth != null;
    }
    
    // 교수님만 퀴즈 생성/삭제
    match /quizzes/{quizId} {
      allow create, delete: if get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'professor';
    }
  }
}
```

### 5.3 골드/경험치 조작 방지
- 클라이언트에서 직접 수정 ❌
- Cloud Functions에서 검증 후 지급

### 5.4 도배 방지
- 글 작성: 1분에 3개 제한
- 댓글: 30초에 1개 제한

---

## 6. 개발 단계

### Phase 1: 프로젝트 골격 (1주)
- [ ] Next.js 14 + TypeScript + Tailwind 세팅
- [ ] Firebase 프로젝트 생성 및 연동
- [ ] PWA 설정 (next-pwa)
- [ ] 폴더 구조 잡기
- [ ] MCP 설정 (Playwright, Context7)
- [ ] CLAUDE.md 작성

### Phase 2: 공통 컴포넌트 (1주)
- [ ] 버튼, 인풋, 카드, 모달, 바텀시트
- [ ] 네비게이션 바 (학생용 4탭, 교수님용 5탭)
- [ ] 헤더 (인사말, 공지, 프로필)
- [ ] 반별 테마 시스템 (A빨강/B노랑/C초록/D파랑)
- [ ] Skeleton UI

### Phase 3: 인증 + 온보딩 (1주)
- [ ] 소셜 로그인 (Apple/Google/Naver)
- [ ] 학적정보 입력 화면
- [ ] 캐릭터 생성 화면 (귀여운 토끼 / 머리/피부/수염)
- [ ] 닉네임 설정
- [ ] 튜토리얼 (4장 슬라이드)
- [ ] 교수님 계정 자동 전환

### Phase 4: 홈 화면 (1주)
- [ ] 토끼 캐릭터 표시 (크게, 표정 변화)
- [ ] 반 등수별 배경 (1등 번영 ~ 4등 불바다)
- [ ] 진급 게이지 + 계급 + 뱃지
- [ ] 골드 표시
- [ ] Shop 화면
- [ ] 공지 (최근 1개 + 목록)
- [ ] 내 전적 (퀴즈 수/정답률/기여도)
- [ ] 프로필 바텀시트 (설정)

### Phase 5: 퀴즈 기능 (2주)
- [ ] 퀴즈 목록 (카드 2열)
- [ ] 필터 탭 (전체/중간/기말/족보/자체제작)
- [ ] TOP3 레이스 애니메이션
- [ ] 반 참여도 순위
- [ ] 퀴즈 풀이 화면 (객관식/OX/주관식)
- [ ] 즉시 피드백 버튼 (❗)
- [ ] 결과 줌아웃 화면
- [ ] 피드백 입력 화면
- [ ] 해설 표시
- [ ] 자체제작 퀴즈 (Tesseract OCR)
- [ ] 좋아요 기능
- [ ] PDF 다운로드
- [ ] 골드/경험치 지급 (Cloud Functions)

### Phase 6: 복습 기능 (1주)
- [ ] 탭 (전체/오답노트/찜한 문제)
- [ ] 주차별 문제 아이콘 배치
- [ ] 랜덤 풀기 버튼
- [ ] 문제 상세 (다시 풀기/삭제)
- [ ] 오답 자동 저장
- [ ] 찜 기능

### Phase 7: 게시판 (1주)
- [ ] To 교수님 탭 (닉네임 고정)
- [ ] 우리들끼리 탭 (닉네임/익명 선택)
- [ ] 글쓰기 (사진 첨부)
- [ ] 댓글 (닉네임/익명 선택)
- [ ] 좋아요
- [ ] 공지 전환 (교수님)
- [ ] 골드 지급

### Phase 8: 교수님 기능 (1주)
- [ ] 홈 대시보드 (현황, 주의 필요)
- [ ] 퀴즈 출제 (Tesseract OCR)
- [ ] 퀴즈 수정/삭제
- [ ] 학생 모니터링 (검색, 필터)
- [ ] 학생 상세 (성취도, 기록, 피드백, 글)
- [ ] 문제 분석 (오답률, 응답 분포, 피드백)
- [ ] 시즌 설정 (중간/기말 날짜)
- [ ] 공지 작성
- [ ] 글/퀴즈 삭제 권한

### Phase 9: 시스템 기능 (0.5주)
- [ ] 알림 시스템 (FCM)
- [ ] 시즌 리셋 로직
- [ ] 학기/과목 자동 전환
- [ ] 데이터 보관 (졸업생)

### Phase 10: 최적화 + 배포 (0.5주)
- [ ] 성능 테스트 (Lighthouse)
- [ ] 애니메이션 최적화
- [ ] 오프라인 모드 테스트
- [ ] Playwright 자동 테스트
- [ ] Vercel 배포
- [ ] PWA 테스트 (iOS/Android)

---

## 7. 폴더 구조 (예상)

```
yongsa-quiz/
├── CLAUDE.md
├── PRD.md
├── ROADMAP.md
├── app/
│   ├── layout.tsx
│   ├── page.tsx (홈)
│   ├── login/
│   ├── onboarding/
│   ├── quiz/
│   ├── review/
│   ├── board/
│   └── professor/
├── components/
│   ├── common/
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   ├── BottomSheet.tsx
│   │   ├── Skeleton.tsx
│   │   └── Navigation.tsx
│   ├── home/
│   ├── quiz/
│   ├── review/
│   ├── board/
│   └── professor/
├── lib/
│   ├── firebase.ts
│   ├── auth.ts
│   ├── hooks/
│   └── utils/
├── styles/
│   └── themes/ (반별 테마)
├── public/
│   ├── rabbit/          (토끼 캐릭터 에셋)
│   ├── items/
│   └── animations/
└── functions/ (Cloud Functions)
```

---

## 8. UI 테마 가이드

### 8.1 반별 색감 (호그와트 참고, 표절 방지)

| 반 | 메인 배경 | 강조색 | 분위기 |
|----|----------|--------|--------|
| A반 | 짙은 버건디/다크레드 (#4A0E0E) | 골드 (#D4AF37) | 따뜻하고 용맹한 느낌 |
| B반 | 따뜻한 옐로/크림 (#F5E6C8) | 브라운/블랙 (#3D2B1F) | 아늑하고 포근한 느낌 |
| C반 | 짙은 에메랄드 그린 (#0D3D2E) | 실버/골드 (#C0C0C0) | 고급스럽고 차분한 느낌 |
| D반 | 딥 네이비/다크블루 (#1A2744) | 브론즈/골드 (#CD7F32) | 지적이고 우아한 느낌 |

### 8.2 적용 범위
- 배경: 메인 배경색 그라데이션
- 헤더: 메인 배경색 + 강조색 텍스트
- 버튼: 강조색 테두리/배경
- 카드: 메인 배경 연한 버전 + 강조색 악센트
- 프로그레스 바: 강조색
- 토끼 캐릭터 갑옷: 반별 색상 반영

### 8.3 표절 방지
- 호그와트 동물/문양 직접 사용 ❌ (사자, 뱀, 독수리, 오소리)
- 색감 + 분위기만 참고
- 우리만의 토끼 캐릭터 + 퀴즈 앱 UI로 차별화

### 8.4 세련된 UI
- 그라데이션 활용 (배경 상단→하단 자연스럽게)
- 미묘한 그림자 (카드, 버튼)
- 부드러운 라운드 (8px~16px)
- 골드/실버 악센트로 고급스러움

---

## 9. 예상 일정 (클로드 코드 사용)

| 단계 | 시간 | 누적 |
|------|------|------|
| Phase 1: 프로젝트 골격 | 2시간 | 2시간 |
| Phase 2: 공통 컴포넌트 | 3시간 | 5시간 |
| Phase 3: 인증 + 온보딩 | 3시간 | 8시간 |
| Phase 4: 홈 화면 | 3시간 | 11시간 |
| Phase 5: 퀴즈 기능 | 5시간 | 16시간 |
| Phase 6: 복습 기능 | 2시간 | 18시간 |
| Phase 7: 게시판 | 2시간 | 20시간 |
| Phase 8: 교수님 기능 | 3시간 | 23시간 |
| Phase 9-10: 시스템 + 배포 | 2시간 | 25시간 |

**총 예상: 약 25시간 (2~3일)**

---

## 10. 체크리스트

### 개발 시작 전
- [ ] Firebase 프로젝트 생성
- [ ] Vercel 계정 준비
- [ ] MCP 설정 완료
- [ ] CLAUDE.md 작성

### MVP 기준
- [ ] 로그인 가능
- [ ] 퀴즈 풀기 가능
- [ ] 피드백 남기기 가능
- [ ] 게시판 글쓰기 가능
- [ ] 교수님 피드백 확인 가능

### 배포 전
- [ ] Lighthouse 성능 90점 이상
- [ ] 오프라인 모드 동작
- [ ] iOS/Android PWA 설치 테스트
- [ ] 주요 플로우 Playwright 테스트
