# RabbiTory 개발 진행 상황

## 현재 상태
- **마지막 업데이트**: 2026-02-24
- **프로젝트 단계**: 프로덕션 운영 중 (Vercel 배포 완료)
- **다음 단계**: 반응형 UI (패드 가로/PC), PWA 오프라인 캐시

## 최근 작업 (2026-02-24)

### 교수 퀴즈탭 3D 캐러셀 전면 개편
- 3D perspective 순환 캐러셀 (클론 카드 방식 무한 루프)
- 난이도별 MP4 비디오 카드 (easy/normal/hard, ffmpeg 압축 ~400KB)
- PAST EXAM 헤더: 장식선 + 년도/시험 드롭다운
- 캐러셀 peek 효과 (82% 카드 너비, 양쪽 9% 사이드 피크)
- PC 드래그 지원, 3D rotateY/scale/opacity 전환

### 비밀번호 찾기 + 문의하기
- 학번 입력 → requestPasswordReset CF → 복구 이메일 확인
- 미등록 시 인라인 "문의하기" 폼 → submitInquiry CF
- 교수님 설정에서 문의 확인 가능

### 철권퀴즈 (배틀 퀴즈)
- 실시간 1v1 토끼 배틀 (Firebase Realtime Database)
- 매칭/라운드/결과/봇 AI 구현
- 교수 설정에서 배틀 키워드 범위 지정
- 데미지 계산, 연타 미니게임

### 기타
- 퀴즈 미리보기 페이지 (/professor/quiz/[id]/preview)
- 과목별 리본 이미지 스와이프 전환
- 복습 셔플 기능
- 피드백/결과/게시판/가챠/마일스톤 UI 다수 개선

## 완료된 기능

### 핵심 기능 (100%)
- [x] 소셜 로그인 (Google, Apple, Naver, 이메일)
- [x] 온보딩 플로우 (학적정보, 캐릭터, 닉네임, 튜토리얼)
- [x] 홈 화면 (토끼 궤도 캐러셀, 마일스톤, EXP 바, 공지 채널, 랭킹)
- [x] 퀴즈 (목록/풀이/결과/피드백/생성/수정)
- [x] 복습 (오답/찜/푼 문제/서재/랜덤/셔플)
- [x] 게시판 (To 교수님 / 우리들끼리, 고정글, Masonry)
- [x] 알림 시스템 (FCM 푸시)
- [x] 비밀번호 찾기 + 문의하기

### 토끼 시스템 (100%)
- [x] 80종 토끼 발견/장착
- [x] 2단계 뽑기 (Roll → Claim)
- [x] 토끼 레벨업 (HP/ATK/DEF 스탯)
- [x] 50XP 마일스톤 보상 선택
- [x] 토끼 도감 (보유 집사 목록)

### 교수님 기능 (100%)
- [x] 대시보드 (현황, 참여율, 군집 시각화)
- [x] 퀴즈 관리 (3D 캐러셀, 통계, BEST Q)
- [x] 학생 모니터링 (검색/필터/상세)
- [x] 문제 분석 (정답률, 오답 패턴)
- [x] 시즌 리셋 + 학기 전환
- [x] 주별 자동 수집 + 월별 Claude 리포트
- [x] 교수 설정 (학기/시즌/배틀 키워드)

### AI 기능 (100%)
- [x] AI 퀴즈 생성 (Gemini, 교수 스타일 학습)
- [x] OCR 퀴즈 업로드 (Tesseract, Gemini Vision)
- [x] PPTX → 문제 파싱 (Cloud Run)
- [x] 월별 리포트 인사이트 (Claude Sonnet)

### 철권퀴즈 (90%)
- [x] 실시간 매칭 + 봇 매칭
- [x] 라운드 진행 + 데미지 계산
- [x] 연타 미니게임
- [x] 배틀 결과 + XP 지급
- [x] 교수 키워드 범위 설정
- [ ] 최종 밸런스 조정

### 인프라 (100%)
- [x] Vercel 배포 (PWA)
- [x] Firebase 보안 규칙
- [x] Cloud Functions 배포
- [x] Cloud Run PPTX 서비스
- [x] 성능 최적화 (번들, 애니메이션)

## 향후 계획
- [ ] 반응형 UI (패드 가로/PC — Tailwind lg: 브레이크포인트)
- [ ] PWA 오프라인 캐시 전략
- [ ] 에빙하우스 간격 반복 (복습)
- [ ] 실시간 랭킹 애니메이션
- [ ] E2E 테스트 (Playwright)

## 주요 파일 구조

```
app/
├── (main)/           # 인증 필요 라우트 그룹
│   ├── page.tsx      # 홈 화면
│   ├── quiz/         # 퀴즈 (목록/풀이/결과/피드백/생성)
│   ├── review/       # 복습 (오답/찜/푼/서재/랜덤)
│   ├── board/        # 게시판
│   ├── ranking/      # 랭킹
│   ├── profile/      # 프로필
│   ├── settings/     # 설정
│   └── professor/    # 교수님 전용
│       ├── quiz/     # 퀴즈 관리 (3D 캐러셀, BEST Q, 미리보기)
│       ├── students/ # 학생 모니터링
│       ├── analysis/ # 문제 분석
│       ├── stats/    # 통계 + 월별 리포트
│       └── settings/ # 교수 설정 (시즌, 배틀 키워드)
├── login/            # 소셜 로그인
├── signup/           # 이메일 회원가입
├── forgot-password/  # 비밀번호 찾기 + 문의
├── onboarding/       # 온보딩 플로우
└── verify-email/     # 이메일 인증

components/
├── common/           # 공통 UI
├── home/             # 홈 (CharacterBox, 가챠, 도감, 마일스톤)
├── quiz/             # 퀴즈 관련
├── review/           # 복습 관련
├── board/            # 게시판 관련
├── professor/        # 교수님 전용
├── tekken/           # 철권퀴즈 배틀 UI
├── ai-quiz/          # AI 퀴즈 생성
├── onboarding/       # 온보딩 관련
└── auth/             # 인증 관련

functions/src/        # Cloud Functions
├── tekkenBattle.ts   # 철권퀴즈 배틀
├── tekkenCleanup.ts  # 배틀 정리
├── inquiry.ts        # 문의하기
└── ...               # 기존 CF 모듈들
```
