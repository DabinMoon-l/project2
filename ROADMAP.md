# RabbiTory - ROADMAP

## 1. 기술 스택

### 1.1 Frontend
| 기술 | 용도 |
|------|------|
| Next.js 16 | 프레임워크 (App Router, Turbopack) |
| React 19 | UI 라이브러리 |
| TypeScript | 타입 안정성 |
| Tailwind CSS 3 | 스타일링 |
| Framer Motion | 페이지 전환, UI 애니메이션 |
| Lottie | 캐릭터 애니메이션 |

### 1.2 Backend
| 기술 | 용도 |
|------|------|
| Firebase Auth | 소셜 로그인 (Apple/Google/Naver/Email) |
| Firebase Firestore | 메인 데이터베이스 |
| Firebase Realtime DB | 철권퀴즈 실시간 배틀 |
| Firebase Cloud Functions | 서버 로직 (채점, EXP, 매칭 등) |
| Firebase Cloud Messaging | 푸시 알림 |
| Firebase Storage | 이미지/파일 업로드 |

### 1.3 AI / OCR
| 기술 | 용도 |
|------|------|
| Gemini API | AI 문제 생성, 이미지 분석, 스타일 학습 |
| Claude API | 월별 리포트 인사이트 |
| Tesseract.js | OCR (사진/PDF → 텍스트) |
| pdfjs-dist | PDF 파싱 |

### 1.4 기타
| 기술 | 용도 |
|------|------|
| Cloud Run | PPTX → PDF 변환 (LibreOffice) |
| exceljs / docx | 리포트 Excel/Word 출력 |
| next-pwa | PWA 설정 |
| Vercel | 프론트엔드 배포 |

---

## 2. 개발 완료 현황

### Phase 1~2: 프로젝트 골격 + 공통 컴포넌트 ✅
- Next.js + TypeScript + Tailwind 세팅
- Firebase 연동
- PWA 설정
- 공통 UI (Button, Input, Card, Modal, BottomSheet, Skeleton)
- 네비게이션, 헤더, 반별 테마 시스템

### Phase 3: 인증 + 온보딩 ✅
- 소셜 로그인 (Apple/Google/Naver/Email)
- 온보딩 (학적정보, 캐릭터, 닉네임, 튜토리얼)
- 비밀번호 찾기 + 문의하기

### Phase 4: 홈 화면 ✅
- 토끼 2마리 궤도 캐러셀 (CharacterBox)
- EXP 바 + 마일스톤 시스템
- 공지 채널 (9-slice 말풍선, 다중 투표, 이모지)
- 랭킹 섹션 + PullToHome 스와이프

### Phase 5: 퀴즈 기능 ✅
- 퀴즈 목록 (탭 필터, 카드, 완료 오버레이)
- 퀴즈 풀이/결과/피드백
- 퀴즈 생성 (OCR, PPTX, AI, 직접 입력)
- 결합형 문제 (공통 지문 + 하위 문제)
- 서술형 채점 (루브릭)
- 퀴즈 관리 (통계/수정/삭제)

### Phase 6: 복습 기능 ✅
- 4개 탭 (오답/찜/푼 문제/서재)
- 폴더 관리 + 연습 모드
- 랜덤 풀기 + 셔플 기능
- AI 문제 선지별 해설

### Phase 7: 게시판 ✅
- To 교수님 / 우리들끼리
- 고정글 캐러셀 + Masonry 2열
- 댓글/대댓글 + 도배 방지

### Phase 8: 교수님 기능 ✅
- 대시보드 (현황, 참여율, 군집 시각화)
- 퀴즈 관리 (3D 캐러셀, BEST Q, 미리보기, 과목 리본)
- 학생 모니터링 + 문제 분석
- 주별 수집 + 월별 Claude 리포트
- 시즌 리셋 + 학기 전환
- 교수 설정 (학기/시즌/배틀 키워드)

### Phase 9: 토끼 시스템 ✅
- 80종 토끼 발견/장착 (2단계 뽑기)
- 토끼 레벨업 (HP/ATK/DEF)
- 50XP 마일스톤 보상 선택
- 토끼 도감 (보유 집사 목록)

### Phase 10: 철권퀴즈 (배틀) ✅
- 실시간 1v1 매칭 (Realtime Database)
- 라운드 진행 + 데미지 계산 + 봇 AI
- 연타 미니게임 + 결과 + XP 지급

### Phase 11: 시스템 + 배포 ✅
- 알림 (FCM)
- 랭킹 사전 계산 (5분 스케줄)
- Vercel 배포 (PWA)
- Firebase Security Rules
- Cloud Run PPTX 서비스

---

## 3. 향후 계획

### 반응형 UI (예정)
- 현재: 모바일/패드(세로) UI
- 추가: Tailwind `lg:` 브레이크포인트로 패드(가로)/PC UI
- 한 링크로 자동 감지

### PWA 오프라인 (예정)
- Service Worker 캐싱 전략
- 오프라인 퀴즈 풀이
- iOS/Android PWA 테스트

### 추가 개선 (검토 중)
- 에빙하우스 간격 반복 (복습)
- 실시간 랭킹 애니메이션
- E2E 테스트 (Playwright)
- 번들 크기 추가 최적화

---

## 4. 성능 최적화 (적용 완료)

- 프로덕션 `console.log` 자동 제거
- `optimizePackageImports` (framer-motion, firebase)
- 이미지: AVIF/WebP 포맷
- 코드 스플리팅 (dynamic import)
- 비디오: ffmpeg crf 28 압축 (~400KB)
- 스크롤바 숨김 + overflow-x hidden (모바일 PWA)

---

## 5. 보안 (적용 완료)

- Firestore Security Rules (역할 기반 접근 제어)
- 보호 필드 (totalExp, rank, role, badges, equippedRabbits) — CF 전용
- 도배 방지 (글 1분 3개, 댓글 30초 1개)
- Realtime Database Rules (철권퀴즈)
