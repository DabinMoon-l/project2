# 아키텍처 리뷰 + 리팩토링 + 테스트 계획

## 1. 발견된 취약점 (우선순위순)

### 즉시 수정 가능 (이번 세션)

| # | 취약점 | 위험도 | 수정 방법 | 상태 |
|---|--------|--------|----------|------|
| 1 | onQuizComplete EXP 이중 지급 (퀴즈 완료 + 복습) | 높음 | 트랜잭션 내 `rewarded` 재확인 | ✅ 완료 |
| 2 | reviews 클라이언트 직접 쓰기 (reviewCount 조작) | 중간 | Firestore Rules에서 +1씩만 허용 | ✅ 완료 |
| 3 | EXP 상수 서버/클라이언트 이중 정의 | 중간 | `shared/expRewards.json` 단일 소스 + 프론트 하드코딩 제거 | ✅ 완료 |
| 4 | onQuizCreate EXP 이중 지급 | 중간 | 트랜잭션 내 `rewarded` 재확인 | ✅ 완료 |
| 5 | onQuizMakePublic EXP 이중 지급 | 중간 | 트랜잭션 내 `publicRewarded` 재확인 | ✅ 완료 |
| 6 | onPostCreate/onCommentCreate EXP 이중 지급 | 중간 | 트랜잭션 내 `rewarded` 재확인 | ✅ 완료 |
| 7 | onFeedbackSubmit EXP 이중 지급 | 중간 | 트랜잭션 내 `rewarded` 재확인 | ✅ 완료 |
| 8 | 챕터 인덱스 서버/클라이언트 이중 관리 | 낮음 | `shared/courseChapters.json` 단일 소스 + prebuild 복사 | ✅ 완료 |

### 수정 불가 또는 장기 과제

| # | 취약점 | 이유 |
|---|--------|------|
| 8 | onSnapshot 구독 과다 (8~10개) | 아키텍처 전면 재설계 필요. 현재 Context 기반 실시간 동기화가 핵심 UX. React Query/SWR 마이그레이션은 대규모 리팩토링 |
| 9 | drawQuestionsFromPool 풀 전체 로드 | 현재 300개라 실용적. 풀 크기 증가 시 Firestore 쿼리 리팩토링 필요하지만 지금은 불필요 |
| 10 | 거대 파일 분리 (ReviewPractice 40K+) | 기능적으로 단일 플로우라 분리 시 복잡도 증가. 장기적 리팩토링 대상 |
| 11 | recordAttempt 분산 쓰기 (비트랜잭션) | Firestore 트랜잭션은 500개 문서 제한 + 분산 카운터와 호환 안 됨. 현재 제출 락으로 충분히 보호 |
| 12 | 교수 통계 N+1 쿼리 | useProfessorStudents에서 학생별 개별 조회. 배치 조회로 개선 가능하지만 현재 사용량에서 문제 없음 |

## 2. 리팩토링 계획

### Phase 1: 보안 강화 (즉시) — ✅ 완료 (2026-03-10)
- [x] 모든 Firestore 트리거 CF의 EXP 중복 지급 방지 (트랜잭션 내부 체크) — 7개 CF 수정
- [x] reviews 컬렉션 reviewCount 보호 (Security Rules) — +1씩만 허용

### Phase 2: 코드 품질 (1~2주)
- [x] EXP 상수 단일 소스화 — `shared/expRewards.json` + 프론트 6개 파일 하드코딩 제거
- [x] 챕터 인덱스 공유 모듈 — `shared/courseChapters.json` + 프론트/서버 인라인 데이터 제거
- [ ] useReview.ts 분리 (wrong/bookmark/solved 각각의 훅)

### Phase 3: 테스트 (2~4주)
- [ ] Vitest 설정 + 핵심 유닛 테스트
- [ ] CF 통합 테스트 (Firebase Emulator)

### Phase 4: 성능 최적화 (장기)
- [ ] onSnapshot 구독 최적화 (lazy subscription)
- [ ] drawQuestionsFromPool 쿼리 최적화 (풀 확장 시)
- [ ] 대형 컴포넌트 분리

## 3. 테스트 프레임워크 계획

### 설정
- **프레임워크**: Vitest (Next.js + TypeScript 네이티브 지원)
- **CF 테스트**: Firebase Emulator Suite (Firestore + Auth + RTDB)
- **E2E**: Playwright (PWA + 모바일 뷰포트)

### 우선 테스트 대상

#### 채점 로직 (functions/src/utils/gradeQuestion.ts)
- OX 채점 (0/1, "O"/"X" 양형식)
- 객관식 단일정답 (0-indexed)
- 객관식 복수정답 (sorted 비교)
- 단답형 복수정답 ("|||" 구분, case-insensitive)
- 엣지: 빈 답안, null, undefined

#### EXP 계산 (functions/src/utils/gold.ts)
- 점수별 EXP 정확성
- addExpInTransaction 트랜잭션 정합성
- 중복 보상 방지

#### 배틀 데미지 (functions/src/utils/tekkenDamage.ts)
- baseDamage 공식 정확성
- 크리티컬 배수
- MUTUAL_DAMAGE 상수
- calcBattleXp 연승 보너스

#### 랭킹/레이더 (computeRankings.ts, computeRadarNorm.ts)
- 개인 랭킹 스코어 공식
- 팀 랭킹 스코어 공식
- 동점 처리
- 백분위 계산
- 성장세 계산

#### recordAttempt 통합 테스트
- 정상 제출 → quizResults + quiz_completions 생성
- 중복 제출 → 락 반환
- rate limit 초과 → 거부
- 동시 제출 → 1건만 성공

### 테스트 파일 구조 (예정)
```
tests/
  unit/
    gradeQuestion.test.ts
    gold.test.ts
    tekkenDamage.test.ts
    ranking.test.ts
    radarNorm.test.ts
    milestone.test.ts
  integration/
    recordAttempt.test.ts
    onQuizComplete.test.ts
    tekkenBattle.test.ts
    rabbitGacha.test.ts
  e2e/
    quiz-flow.spec.ts
    battle-flow.spec.ts
```
