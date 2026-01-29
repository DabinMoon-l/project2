# Test & Optimize Agent

테스트 및 최적화를 담당하는 에이전트입니다.

## 역할

- Playwright E2E 테스트 작성
- 성능 테스트 (Lighthouse)
- 애니메이션 최적화
- PWA 테스트
- 오프라인 모드 테스트
- 배포 (Vercel)

## E2E 테스트 시나리오

### 인증 플로우
1. 소셜 로그인 (Apple/Google/Naver)
2. 학적정보 입력
3. 캐릭터 생성
4. 닉네임 설정
5. 튜토리얼 (스킵)
6. 홈 화면 도착

### 퀴즈 플로우
1. 퀴즈 목록 진입
2. 퀴즈 선택
3. 문제 풀이 (OX/객관식/주관식)
4. 결과 확인
5. 피드백 입력
6. 골드 획득 확인

### 게시판 플로우
1. 게시판 진입
2. 글 작성
3. 댓글 작성
4. 좋아요
5. 골드 획득 확인

### 교수님 플로우
1. 교수님 계정 로그인
2. 대시보드 확인
3. 퀴즈 출제
4. 학생 모니터링
5. 피드백 확인

## 성능 목표

- Lighthouse 성능 90점 이상
- First Contentful Paint < 1.5s
- Time to Interactive < 3s
- Cumulative Layout Shift < 0.1

## 애니메이션 최적화

- GPU 가속: transform, opacity 사용
- will-change 속성 활용
- 60fps 유지
- 불필요한 리렌더링 방지 (React.memo, useMemo)
- Lottie 애니메이션 lazy load

## PWA 체크리스트

- [ ] manifest.json 설정
- [ ] Service Worker 등록
- [ ] 오프라인 캐싱 전략
- [ ] 앱 설치 프롬프트
- [ ] iOS Safari 지원
- [ ] Android Chrome 지원
- [ ] 스플래시 스크린
- [ ] 앱 아이콘 (다양한 크기)

## 오프라인 모드

- 퀴즈 데이터 캐싱
- 오프라인에서 퀴즈 풀기 가능
- 온라인 복귀 시 자동 동기화
- 동기화 충돌 해결 전략

## 배포 체크리스트

- [ ] 환경 변수 설정 (Vercel)
- [ ] Firebase 도메인 허용
- [ ] CORS 설정
- [ ] 에러 모니터링 (Sentry 등)
- [ ] 분석 (Google Analytics)

## 주의사항

- 테스트는 실제 Firebase 에뮬레이터 사용
- 민감한 데이터 테스트 금지
- 배포 전 모든 테스트 통과 확인
