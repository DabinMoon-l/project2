# RabbiTory SaaS 아키텍처 설계

> 단일 대학 PWA → 멀티 대학 SaaS 전환을 위한 기술 설계 문서
> 작성일: 2026-03-15

---

## 1. 목표 스택

| 레이어 | 현재 (Firebase) | 목표 (SaaS) | 이유 |
|--------|----------------|-------------|------|
| **Auth** | Firebase Auth (학번@rabbitory.internal) | **Better Auth** (Organization 플러그인, SSO, 셀프호스트) | 멀티테넌시 네이티브 지원, 대학별 SSO 연동 |
| **DB** | Firestore (NoSQL) | **Supabase PostgreSQL** (RLS 테넌트 격리) | 관계형 쿼리, JOIN, 트랜잭션, RLS로 자동 격리 |
| **실시간** | Firestore onSnapshot + RTDB | Supabase Realtime (일반) + **Firebase RTDB 유지** (배틀) | 배틀은 50ms 지연 필요, RTDB가 유일한 선택 |
| **Storage** | Firebase Storage | **Supabase Storage** (테넌트별 버킷) | RLS 정책 + 버킷 격리 |
| **푸시** | Firebase FCM | **FCM 유지** | 대체재 없음 (APNs 직접 구현은 비효율) |
| **AI** | Gemini 2.5 Flash + Claude Sonnet-4 | **유지** | 모델 교체 불필요 |
| **서버** | Cloud Functions (Node 20) | **Supabase Edge Functions** + Cloud Run (AI) | Edge Functions로 일반 로직, Cloud Run은 AI 워크로드 |
| **배포** | Vercel + Firebase | **Vercel** + Supabase + Cloud Run | Vercel 프론트 유지 |

---

## 2. PostgreSQL 스키마

### 2.1 테넌트 & 인증 (4 테이블)

```sql
-- ── 조직 (대학) ──
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,                    -- "한국대학교"
  slug        TEXT UNIQUE NOT NULL,             -- "hankook-univ" (서브도메인/URL용)
  plan        TEXT NOT NULL DEFAULT 'free',     -- free | pro | enterprise
  logo_url    TEXT,
  theme       JSONB DEFAULT '{}',              -- 커스텀 테마 (accent 색상 등)
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 조직 멤버십 ──
CREATE TABLE org_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,                   -- Better Auth user ID
  role        TEXT NOT NULL CHECK (role IN ('admin', 'professor', 'student')),
  student_id  TEXT,                             -- 학번 (학생만)
  class_id    TEXT,                             -- 반 (A/B/C/D)
  joined_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, user_id),
  UNIQUE (org_id, student_id)                  -- 같은 대학 내 학번 유일
);

-- ── 학기 설정 ──
CREATE TABLE semester_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year        INT NOT NULL,
  semester    INT NOT NULL CHECK (semester IN (1, 2)),
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  is_active   BOOLEAN DEFAULT true,
  UNIQUE (org_id, year, semester)
);

-- ── 교수 허용 목록 ──
CREATE TABLE allowed_professors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  assigned_courses UUID[] DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, email)
);
```

### 2.2 과목 & 학생 (3 테이블)

```sql
-- ── 과목 ──
CREATE TABLE courses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,                    -- "biology", "microbiology"
  name        TEXT NOT NULL,                    -- "생물학"
  grade       INT,                              -- 학년
  semester    INT,                              -- 학기
  chapter_prefix TEXT,                          -- "bio_"
  chapters    JSONB DEFAULT '[]',              -- 챕터 인덱스 (shared/courseChapters.json 대체)
  theme_color TEXT,                             -- "#2E7D32"
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, code)
);

-- ── 학번 사전등록 ──
CREATE TABLE enrolled_students (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL,                    -- 학번
  name        TEXT NOT NULL,
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (course_id, student_id)
);

-- ── 사용자 프로필 ──
CREATE TABLE user_profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,                    -- Better Auth user ID
  nickname    TEXT NOT NULL,
  name        TEXT,
  role        TEXT NOT NULL CHECK (role IN ('professor', 'student')),
  total_exp   INT DEFAULT 0,
  level       INT DEFAULT 1,
  rank        INT,
  badges      TEXT[] DEFAULT '{}',
  equipped_rabbits JSONB DEFAULT '[]',         -- [{slotIndex, rabbitId, courseId}]
  quiz_stats  JSONB DEFAULT '{}',              -- {totalCorrect, totalAttempted, professorQuizzesCompleted}
  last_gacha_exp INT DEFAULT 0,
  spin_lock   BOOLEAN DEFAULT false,
  recovery_email TEXT,
  assigned_courses UUID[] DEFAULT '{}',        -- 교수용
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, user_id)
);
```

### 2.3 퀴즈 (5 테이블)

```sql
-- ── 퀴즈 ──
CREATE TABLE quizzes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id       UUID NOT NULL REFERENCES courses(id),
  creator_id      UUID NOT NULL,
  title           TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('midterm', 'final', 'past', 'independent', 'custom', 'ai-generated')),
  difficulty      TEXT,
  tags            TEXT[] DEFAULT '{}',
  questions       JSONB NOT NULL DEFAULT '[]',
  is_public       BOOLEAN DEFAULT false,
  participant_count INT DEFAULT 0,
  average_score   REAL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 퀴즈 결과 (append-only) ──
CREATE TABLE quiz_results (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quiz_id     UUID NOT NULL REFERENCES quizzes(id),
  user_id     UUID NOT NULL,
  score       REAL NOT NULL,
  correct_count INT NOT NULL,
  total_count INT NOT NULL,
  answers     JSONB NOT NULL,
  attempt_no  INT DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 퀴즈 완료 여부 ──
CREATE TABLE quiz_completions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quiz_id     UUID NOT NULL REFERENCES quizzes(id),
  user_id     UUID NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (quiz_id, user_id)
);

-- ── 분산 카운터 → PostgreSQL에서 불필요 (단일 row 갱신으로 충분) ──
-- quiz_agg/shards 패턴 제거: quizzes 테이블의 participant_count/average_score를 직접 갱신

-- ── 제출 락 (Firestore TTL 대체 → pg_cron 정리) ──
CREATE TABLE quiz_submit_locks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  quiz_id     UUID NOT NULL REFERENCES quizzes(id),
  locked_at   TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ DEFAULT now() + INTERVAL '60 seconds',
  UNIQUE (user_id, quiz_id)
);

-- ── 퀴즈 피드백 ──
CREATE TABLE feedbacks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quiz_id     UUID NOT NULL REFERENCES quizzes(id),
  user_id     UUID NOT NULL,
  content     TEXT NOT NULL,
  rating      INT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 2.4 복습 (2 테이블)

```sql
-- ── 복습 기록 ──
CREATE TABLE reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  quiz_id         UUID REFERENCES quizzes(id),
  question_id     TEXT NOT NULL,
  question_data   JSONB NOT NULL,
  is_correct      BOOLEAN,
  is_bookmarked   BOOLEAN DEFAULT false,
  review_count    INT DEFAULT 0,
  last_score      REAL,
  folder_id       UUID,
  source          TEXT,                          -- 'solved' | 'wrong' | 'ai'
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 커스텀 폴더 ──
CREATE TABLE custom_folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 2.5 게시판 (2 테이블)

```sql
-- ── 게시글 ──
CREATE TABLE posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id),
  author_id   UUID NOT NULL,
  title       TEXT,
  content     TEXT NOT NULL,
  tag         TEXT CHECK (tag IN ('academic', 'chat', 'question', 'class', 'etc')),
  image_urls  TEXT[] DEFAULT '{}',
  like_count  INT DEFAULT 0,
  comment_count INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 댓글 ──
CREATE TABLE comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL,
  content     TEXT NOT NULL,
  parent_id   UUID REFERENCES comments(id),    -- 대댓글
  is_accepted BOOLEAN DEFAULT false,
  is_ai_reply BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 2.6 게이미피케이션 (3 테이블)

```sql
-- ── EXP 히스토리 ──
CREATE TABLE exp_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  amount      INT NOT NULL,
  reason      TEXT NOT NULL,                    -- 'quiz_complete', 'post_create', etc.
  reference_id TEXT,                            -- 관련 문서 ID
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 토끼 도감 ──
CREATE TABLE rabbits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id),
  rabbit_id   INT NOT NULL,                     -- 0~79
  discoverer_id UUID,                           -- 최초 발견자
  discovery_order INT,
  discovered_at TIMESTAMPTZ,
  UNIQUE (org_id, course_id, rabbit_id)
);

-- ── 토끼 보유 ──
CREATE TABLE rabbit_holdings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  course_id   UUID NOT NULL REFERENCES courses(id),
  rabbit_id   INT NOT NULL,
  name        TEXT,
  level       INT DEFAULT 1,
  hp          INT NOT NULL,
  atk         INT NOT NULL,
  def         INT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, user_id, course_id, rabbit_id)
);
```

### 2.7 통계 & 랭킹 (2 테이블)

```sql
-- ── 랭킹 (사전계산, 10분 주기) ──
CREATE TABLE rankings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id),
  data        JSONB NOT NULL,                   -- {individual: [...], team: [...]}
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, course_id)
);

-- ── 레이더 정규화 (사전계산, 10분 주기) ──
CREATE TABLE radar_norms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id),
  data        JSONB NOT NULL,                   -- {norms: {...}, students: [...]}
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, course_id)
);
```

### 2.8 AI 생성 (4 테이블)

```sql
-- ── AI 생성 작업 ──
CREATE TABLE generation_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  course_id   UUID NOT NULL REFERENCES courses(id),
  status      TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  difficulty  TEXT NOT NULL,
  question_count INT NOT NULL,
  tags        TEXT[] DEFAULT '{}',
  text_input  TEXT,
  image_paths TEXT[] DEFAULT '{}',             -- Storage 경로
  result      JSONB,                            -- 생성 결과
  error       TEXT,
  fingerprint TEXT,                             -- dedup용 sha256
  created_at  TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ── Material 캐시 (24시간 TTL) ──
CREATE TABLE material_cache (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ DEFAULT now() + INTERVAL '24 hours',
  UNIQUE (org_id, fingerprint)
);

-- ── AI 사용량 로그 ──
CREATE TABLE ai_usage_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  count       INT DEFAULT 1,
  UNIQUE (org_id, user_id, date)
);

-- ── 교수 스타일 분석 ──
CREATE TABLE professor_quiz_analysis (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id),
  style_profile JSONB,                          -- {questionPatterns, distractorStrategies, ...}
  keywords    JSONB,                             -- {coreTerms, examTopics}
  question_bank JSONB,                           -- {questions[8]}
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, course_id)
);
```

### 2.9 배틀 & 알림 (4 테이블)

```sql
-- ── 배틀 문제 풀 ──
CREATE TABLE tekken_question_pool (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id),
  questions   JSONB NOT NULL DEFAULT '[]',
  pool_version TEXT NOT NULL,                    -- 교체 식별자
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 과목별 키워드/범위 ──
CREATE TABLE course_scopes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id),
  keywords    JSONB,
  scope       JSONB,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, course_id)
);

-- ── 공지사항 ──
CREATE TABLE announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id),
  author_id   UUID NOT NULL,
  content     TEXT NOT NULL,
  image_urls  TEXT[] DEFAULT '{}',
  poll        JSONB,                             -- {question, options: [{text, votes}]}
  reactions   JSONB DEFAULT '{}',               -- {emoji: [userId, ...]}
  read_by     UUID[] DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 알림 ──
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  data        JSONB DEFAULT '{}',
  is_read     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 2.10 보안 (1 테이블)

```sql
-- ── Rate Limit ──
CREATE TABLE rate_limits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  action      TEXT NOT NULL,
  count       INT DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, user_id, action)
);
```

### 2.11 RLS 정책 (전체 테이블 공통)

```sql
-- 모든 테이블에 적용되는 기본 RLS 정책
-- Better Auth JWT → auth.org_id() 함수로 현재 테넌트 추출

CREATE OR REPLACE FUNCTION auth.org_id() RETURNS UUID AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.user_id() RETURNS UUID AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.org_role() RETURNS TEXT AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'org_role';
$$ LANGUAGE sql STABLE;

-- 테넌트 격리 정책 (모든 테이블)
-- 예: quizzes
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON quizzes
  FOR ALL
  USING (org_id = auth.org_id());

-- 교수 전용 쓰기 (예: quizzes category != 'custom')
CREATE POLICY "professor_write" ON quizzes
  FOR INSERT
  WITH CHECK (
    auth.org_role() IN ('admin', 'professor')
    OR category IN ('custom', 'ai-generated')
  );

-- 학생은 본인 데이터만 수정
CREATE POLICY "own_data" ON user_profiles
  FOR UPDATE
  USING (user_id = auth.user_id())
  WITH CHECK (user_id = auth.user_id());
```

### 2.12 인덱스

```sql
-- 고빈도 쿼리 인덱스
CREATE INDEX idx_quizzes_org_course ON quizzes(org_id, course_id);
CREATE INDEX idx_quizzes_creator ON quizzes(org_id, creator_id);
CREATE INDEX idx_quiz_results_user ON quiz_results(org_id, user_id, quiz_id);
CREATE INDEX idx_reviews_user ON reviews(org_id, user_id);
CREATE INDEX idx_reviews_folder ON reviews(org_id, folder_id);
CREATE INDEX idx_posts_org_course ON posts(org_id, course_id, created_at DESC);
CREATE INDEX idx_comments_post ON comments(post_id, created_at);
CREATE INDEX idx_exp_history_user ON exp_history(org_id, user_id, created_at DESC);
CREATE INDEX idx_rabbit_holdings_user ON rabbit_holdings(org_id, user_id, course_id);
CREATE INDEX idx_notifications_user ON notifications(org_id, user_id, is_read, created_at DESC);
CREATE INDEX idx_generation_jobs_user ON generation_jobs(org_id, user_id, status);
CREATE INDEX idx_material_cache_expires ON material_cache(expires_at);
CREATE INDEX idx_submit_locks_expires ON quiz_submit_locks(expires_at);
```

---

## 3. Better Auth 통합

### 3.1 구성

```
Better Auth (셀프호스트)
  ├── Organization 플러그인 → 멀티테넌시
  ├── JWT claims: { sub, org_id, org_role }
  ├── Credential Provider (학번+비밀번호)
  └── Email+Password Provider (교수)
```

### 3.2 JWT Claims → Supabase RLS

```typescript
// Better Auth에서 JWT 발급 시 커스텀 claims 주입
const auth = betterAuth({
  plugins: [
    organization({
      // JWT에 org_id, org_role 자동 포함
      async onTokenCreate({ user, organization, role }) {
        return {
          org_id: organization.id,
          org_role: role,  // 'admin' | 'professor' | 'student'
        };
      },
    }),
  ],
  // 학번 로그인 (Custom Credential)
  credentialProviders: [
    {
      id: 'student-id',
      async authenticate({ studentId, password, orgSlug }) {
        const org = await db.organizations.findBySlug(orgSlug);
        const member = await db.org_members.find({ org_id: org.id, student_id: studentId });
        // 비밀번호 검증 → JWT 발급
      },
    },
  ],
});
```

### 3.3 온보딩 플로우

```
1. 대학 관리자 가입
   → organizations 생성 (slug: "hankook-univ")
   → org_members (role: 'admin')

2. 관리자가 교수 초대
   → allowed_professors에 이메일 추가
   → 초대 이메일 발송

3. 교수 가입
   → allowed_professors 확인
   → org_members (role: 'professor')
   → assigned_courses 설정

4. 학생 일괄 등록
   → enrolled_students에 학번 사전등록
   → 학생이 학번+비밀번호로 가입
   → org_members (role: 'student')
```

### 3.4 현재 Firebase Auth → Better Auth 매핑

| Firebase Auth | Better Auth |
|---------------|-------------|
| `uid` | `user.id` (UUID) |
| `email` (학번@rabbitory.internal) | Credential Provider (학번 직접) |
| `onAuthStateChanged` | `useSession()` 훅 |
| `useRequireAuth()` | `useSession({ required: true })` |
| Custom Claims 없음 | JWT claims: `org_id`, `org_role` |

---

## 4. 마이그레이션 6단계

### Phase 0: orgId 주입 (2주, LOW 리스크)

Firebase에 "default" orgId를 추가하여 코드를 멀티테넌시 준비 상태로 변경.

**작업:**
- `UserProfile` 타입에 `orgId: string` 추가 (기본값 `"default"`)
- `CourseContext`에서 orgId 기반 쿼리 필터 추가
- 구독 키에 orgId 프리픽스: `quiz_${orgId}_${courseId}`
- 모든 Repository 함수에 orgId 파라미터 추가 (기본값 "default")
- Cloud Functions에서 orgId 검증 로직 추가
- 기존 Firestore 문서에 `orgId: "default"` 마이그레이션 스크립트

**검증:** 기존 기능 100% 동작 확인 (orgId="default")

### Phase 1: Better Auth + PostgreSQL 스키마 (4주, MEDIUM 리스크)

**작업:**
- Better Auth 서버 설정 (Organization 플러그인)
- PostgreSQL 스키마 생성 (위 28개 테이블)
- RLS 정책 적용
- Supabase 클라이언트 초기화 (`lib/supabase.ts`)
- 새로운 Repository 구현 (Supabase 기반)
  - `lib/repositories/supabase/` 디렉토리
  - 기존 `lib/repositories/firebase/` 인터페이스와 동일한 API
- 프론트엔드 인증 플로우 전환 (Firebase Auth → Better Auth)

**리스크:**
- 인증 전환 중 기존 사용자 세션 무효화
- 대응: Firebase Auth에서 사용자 목록 export → Better Auth로 bulk import

### Phase 2: Firestore → PostgreSQL 마이그레이션 (6주, HIGH 리스크)

**작업:**
- 마이그레이션 스크립트 작성 (컬렉션별)
  ```
  users → user_profiles + org_members
  quizzes → quizzes (questions JSONB 변환)
  quizResults → quiz_results
  reviews → reviews
  posts/comments → posts/comments
  rabbits/rabbitHoldings → rabbits/rabbit_holdings
  jobs → generation_jobs
  ```
- Dual-write 기간: Firestore + PostgreSQL 동시 쓰기 (2주)
- 데이터 정합성 검증 스크립트
- 프론트엔드 Repository 스위칭 (`NEXT_PUBLIC_DATA_SOURCE=supabase`)
- 21개 hooks의 raw Firestore 쿼리 → 도메인 repo 함수 전환

**리스크:**
- 데이터 불일치 (특히 EXP, 토끼 보유, 퀴즈 결과)
- 대응: Shadow read (Supabase 읽기 → Firestore와 diff 비교 → 불일치 로깅)

**가장 큰 작업: hooks 마이그레이션 (21개)**

| 훅 | 현재 상태 | 작업 |
|----|----------|------|
| useAuth | Firebase Auth 직접 | Better Auth `useSession()` |
| useBoard | raw Firestore query | boardRepo 함수 호출 |
| useBoardUtils | raw Firestore query | boardRepo 함수 호출 |
| useProfessorQuiz | raw Firestore query | quizRepo 함수 호출 |
| useProfessorStats | raw Firestore query | statsRepo 함수 호출 |
| useProfessorStudents | raw Firestore query | userRepo 함수 호출 |
| useProfessorAiQuizzes | raw Firestore query | quizRepo 함수 호출 |
| useProfessorAnalysis | raw Firestore query | analysisRepo 함수 호출 |
| useEnrolledStudents | raw Firestore query | enrollmentRepo 함수 호출 |
| useLearningQuizzes | raw Firestore query | quizRepo 함수 호출 |
| useReview | raw Firestore query | reviewRepo 함수 호출 |
| useReviewTypes | raw Firestore query | reviewRepo 함수 호출 |
| useQuizBookmark | raw Firestore query | reviewRepo 함수 호출 |
| useQuizUpdate | raw Firestore write | quizRepo 함수 호출 |
| useCustomFolders | raw Firestore query | folderRepo 함수 호출 |
| useRabbit | raw Firestore query | rabbitRepo 함수 호출 |
| useSettings | raw Firestore query | settingsRepo 함수 호출 |
| useNotification | raw Firestore query | notificationRepo 함수 호출 |
| useProfile | raw Firestore query | userRepo 함수 호출 |
| useSeasonReset | raw Firestore query | settingsRepo 함수 호출 |
| useTekkenBattle | RTDB 직접 | RTDB 유지 (Phase 4) |

### Phase 3: Cloud Functions → Edge Functions (4주, MEDIUM 리스크)

**작업:**
- onCall 함수 → Supabase Edge Functions (Deno)
  - 62개 중 AI 관련 제외한 ~50개 전환
  - Edge Functions는 Supabase JWT 자동 검증 → RLS 연동
- onDocumentCreated → PostgreSQL Triggers + pg_notify
  - `onQuizComplete` → INSERT trigger on quiz_results
  - `onPostCreate` → INSERT trigger on posts
  - AI 자동답변 (콩콩이) → Edge Function webhook
- onSchedule → pg_cron
  - `computeRankingsScheduled` → pg_cron 10분
  - `tekkenPoolRefillScheduled` → pg_cron 매일 03:00
  - `cleanupExpiredJobs` → pg_cron 매시간

**AI 워크로드 (Cloud Run 유지):**
- `workerProcessJob` → Cloud Run (Gemini API 호출, 장시간 실행)
- `tekkenPoolRefill` → Cloud Run (300문제 생성)
- `convertPptxToPdf` → Cloud Run (LibreOffice)
- `generateMonthlyReport` → Cloud Run (Claude API 호출)

### Phase 4: RTDB + Storage 마이그레이션 (3주, MEDIUM 리스크)

**작업:**
- Firebase Storage → Supabase Storage
  - 테넌트별 버킷: `{org_slug}/quiz-images/`, `{org_slug}/post-images/`
  - URL 리라이트 스크립트 (Firestore Storage URL → Supabase URL)
- RTDB 배틀: **유지** (Supabase Realtime 지연 검증 후 결정)
  - `battleRepo.ts`는 그대로 RTDB 사용
  - 단, 매칭 큐에 orgId 필터 추가

**Supabase Realtime 지연 검증:**
- 배틀 라운드 (20초 타이머) 중 양방향 지연 측정
- 목표: p95 < 100ms → Supabase Realtime으로 전환 가능
- p95 > 200ms → RTDB 유지

### Phase 5: 동적 Scope/FocusGuide 시스템 (3주, MEDIUM 리스크)

현재 하드코딩된 과목 데이터를 교수가 직접 관리할 수 있도록 전환.

**현재 (하드코딩) → SaaS (동적):**

| 현재 | 파일 | SaaS 전환 |
|------|------|----------|
| `courseScope.ts` (과목별 교과서 내용) | 코드에 직접 | `course_scopes` 테이블, 교수 업로드 |
| `focusGuide` (챕터별 필수/고빈도) | `styledQuizGenerator.ts` 내 | `course_focus_guides` 테이블, 교수 편집 |
| `courseChapters.json` (챕터 구조) | shared/ 파일 | `courses.chapters` JSONB 컬럼 |
| `COURSE_NAMES` (과목명) | 코드 상수 | `courses.name` 컬럼 |

**추가 테이블:**

```sql
-- ── 과목 학습 범위 (교과서 내용) ──
CREATE TABLE course_scopes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id  TEXT NOT NULL,                    -- "bio_3", "micro_5"
  content     TEXT NOT NULL,                    -- 교과서 텍스트 (Scope)
  source_type TEXT DEFAULT 'manual',            -- 'manual' | 'pdf_extract' | 'ai_extract'
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, course_id, chapter_id)
);

-- ── 출제 포커스 가이드 ──
CREATE TABLE course_focus_guides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id  TEXT NOT NULL,
  items       JSONB NOT NULL DEFAULT '[]',      -- [{text, priority: "필수출제"|"고빈도"|"보통"}]
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, course_id, chapter_id)
);
```

**교수 온보딩 시 과목 설정 플로우:**

```
1. 과목 생성 (이름, 학기, 반 구조)
2. 교재 업로드 (PDF/PPTX) → AI 자동 추출
   → Gemini가 챕터 구조 + Scope + FocusGuide 초안 생성
   → 교수가 검토/수정
3. 또는 수동 입력 (챕터별 텍스트 + 포커스 항목 편집)
4. 과목 설정 완료 → AI 문제 생성/배틀 풀 즉시 사용 가능
```

**교수 과목 관리 UI (`/professor/course-settings`):**
- 챕터 트리 편집기 (드래그앤드롭 순서 변경)
- 챕터별 Scope 텍스트 에디터 (마크다운)
- FocusGuide 편집: 항목 추가/삭제, 우선순위(필수출제/고빈도/보통) 태그
- PDF 업로드 → AI 자동 추출 버튼 (기존 OCR 파이프라인 활용)

### Phase 6: 셀프서비스 온보딩 + 빌링 (3주, LOW 리스크)

**로그인/회원가입 재설계:**

```
┌─ 랜딩 페이지 (/landing) ────────────┐
│                                      │
│  "AI로 수업을 더 똑똑하게"            │
│  [교수로 시작하기]  → 회원가입 플로우  │
│  [학생 참여하기]    → 초대 코드 입력   │
│  [로그인]          → 기존 사용자       │
│                                      │
└──────────────────────────────────────┘
```

**교수 가입 플로우 (셀프서비스):**
```
1. 이메일 + 비밀번호 회원가입
2. 대학 검색 또는 신규 생성
   → 기존 대학: 관리자 승인 요청 OR 초대 코드
   → 신규 대학: 자동 생성 (본인이 admin)
3. 과목 생성 → 교재 업로드 → Scope/FocusGuide AI 추출
4. 학생 초대 코드 발급 (예: "HANKOOK-BIO-2026")
5. 바로 사용 시작
```

**학생 가입 플로우 (초대 코드):**
```
1. 초대 코드 입력 → 대학/과목 자동 연결
2. 학번 + 비밀번호 설정
3. 닉네임 설정 → 바로 참여
```

**`allowed_professors` 테이블 제거** → 셀프 가입으로 대체. 대학 관리자가 교수 승인/거부 가능.

**추가 테이블:**

```sql
-- ── 초대 코드 ──
CREATE TABLE invite_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id   UUID REFERENCES courses(id),       -- NULL이면 대학 전체 초대
  code        TEXT UNIQUE NOT NULL,               -- "HANKOOK-BIO-2026"
  role        TEXT NOT NULL DEFAULT 'student',    -- 'student' | 'professor'
  max_uses    INT,                                -- NULL = 무제한
  use_count   INT DEFAULT 0,
  expires_at  TIMESTAMPTZ,
  created_by  UUID NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

**작업:**
- 랜딩 페이지 (`/landing`, `/pricing`)
- Stripe 연동
  - Free: 1 과목, 30 학생, AI 생성 일 5회
  - Pro ($25/월): 무제한 과목, 500 학생, AI 생성 무제한
  - Enterprise: SSO, 커스텀 도메인, SLA, 전담 지원
- 교수 대시보드 (`/professor/dashboard`)
  - 과목 관리, 학생 초대, 사용량 모니터링
- 대학 관리자 대시보드 (`/admin`)
  - 교수 승인, 전체 통계, 빌링 관리
- 커스텀 도메인 지원 (Vercel wildcard domain)

### Phase 7: 앱스토어 출시 (2주, LOW 리스크)

**작업:**
- PWA → TWA (Trusted Web Activity) 래핑 (Android)
- PWA → WKWebView 래핑 (iOS, Capacitor 또는 PWABuilder)
- 앱스토어 메타데이터 (스크린샷, 설명, 키워드)
- 심사 대응 (Apple 가이드라인 4.2 — 단순 웹뷰 리젝 방지: 네이티브 푸시 + 오프라인 지원 강조)

**네이티브 기능 활용:**
- 푸시 알림: FCM 그대로 (이미 구현)
- 오프라인: Service Worker 캐싱 (이미 구현)
- 카메라: OCR 촬영 (이미 구현)
- 햅틱: 배틀 히트/크리티컬 피드백 (추가)

---

## 5. Firebase 잔류 서비스

### RTDB (배틀 실시간)

**유지 이유:** 50ms 이내 양방향 동기화 필요. Supabase Realtime은 WebSocket 기반이지만 Presence/Broadcast 지연이 RTDB보다 큼.

**구조 변경:**
```
tekken/
  matchmaking/{orgId}/{courseId}/    ← orgId 추가
  battles/{battleId}/               ← battleId에 orgId 인코딩
  battleAnswers/{battleId}/
  streaks/{orgId}/{userId}/         ← orgId 추가
```

**격리:** RTDB Security Rules에서 orgId 기반 접근 제어:
```json
{
  "tekken": {
    "matchmaking": {
      "$orgId": {
        ".read": "auth.token.org_id === $orgId",
        ".write": "auth.token.org_id === $orgId"
      }
    }
  }
}
```

### FCM (푸시알림)

**유지 이유:** 웹/iOS/Android 통합 푸시 서비스 대체재 없음.

**변경:**
- FCM 토큰을 Supabase `user_profiles.fcm_token` 컬럼에 저장
- Edge Function에서 Firebase Admin SDK로 FCM 발송
- 토픽 구독: `{orgId}_{courseId}` 형식

---

## 6. 현재 코드 변경점 (Phase 0 상세)

### 6.1 타입 변경

```typescript
// lib/types.ts
interface UserProfile {
  orgId: string;          // NEW — "default" (Firebase) → UUID (Supabase)
  // ... 기존 필드
}
```

### 6.2 CourseContext 변경

```typescript
// lib/contexts/CourseContext.tsx
// 현재: settings/semester 글로벌 1개
// 변경: settings/semester → org별 쿼리
const semesterQuery = query(
  collection(db, 'semester_settings'),
  where('orgId', '==', currentOrgId)
);
```

### 6.3 구독 키 변경

```typescript
// lib/subscriptions/SubscriptionManager.ts
// 현재: `quiz_${courseId}`
// 변경: `quiz_${orgId}_${courseId}`
```

### 6.4 Repository 변경

```typescript
// lib/repositories/firebase/quizRepo.ts
// 현재: 모든 함수가 courseId만 받음
// 변경: orgId 파라미터 추가 (기본값 "default")
export function subscribeQuizzes(
  orgId: string = 'default',
  courseId: string,
  callback: (quizzes: Quiz[]) => void
) {
  return onSnapshot(
    query(
      collection(db, 'quizzes'),
      where('orgId', '==', orgId),
      where('courseId', '==', courseId)
    ),
    callback
  );
}
```

### 6.5 Firestore 인덱스 추가

모든 복합 쿼리에 `orgId` 필드 추가:
```
quizzes: orgId + courseId + category
reviews: orgId + userId + source
posts: orgId + courseId + createdAt
```

---

## 7. 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────┐
│                         클라이언트 (Next.js)                      │
│                                                                 │
│  useSession() ──→ Better Auth ──→ JWT {org_id, org_role, sub}   │
│       │                                                         │
│  lib/repositories/ ──→ Supabase Client (RLS 자동 적용)            │
│  lib/api/callFunction() ──→ Edge Functions / Cloud Run          │
│  lib/subscriptions/ ──→ Supabase Realtime / RTDB                │
└────────────────────────┬────────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Supabase    │ │  Cloud Run   │ │  Firebase    │
│              │ │              │ │              │
│ PostgreSQL   │ │ AI 워크로드   │ │ RTDB (배틀)  │
│ (RLS 격리)   │ │ - Gemini     │ │ FCM (푸시)   │
│ Auth(BA연동) │ │ - Claude     │ │              │
│ Storage      │ │ - PPTX변환   │ │              │
│ Realtime     │ │              │ │              │
│ Edge Funcs   │ │              │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
```

---

## 8. 비용 예측

### 단일 대학 (현재, ~300 학생, 2026년 3월 실측)

| 서비스 | 월 비용 | 비고 |
|--------|---------|------|
| Cloud Firestore | ₩81,521 | 읽기 과금이 주요 원인 |
| Cloud Functions | ₩44,968 | 컴퓨트 |
| Gemini API | ₩112,631 (표시) | **무료 크레딧 전액 절감 → 실제 ₩0** |
| Non-Firebase | ₩46,589 | Cloud Run 등 |
| Vercel (Pro) | $20 (~₩27,000) | |
| Claude API | ~₩7,000 | 월별 리포트만 |
| **합계 (표시)** | **₩285,745** | |
| **실제 청구** | **~₩207,000** | Gemini 크레딧 적용 후 |

### SaaS (10개 대학, ~3,000 학생)

| 서비스 | 월 비용 | 비고 |
|--------|---------|------|
| Supabase (Pro) | $25 (~₩34K) | 읽기 무제한, RLS 격리 |
| Firebase (RTDB + FCM) | ~$10 (~₩14K) | 배틀 + 푸시만 잔류 |
| Cloud Run | ~$30 (~₩41K) | AI 워크로드 |
| Vercel (Pro) | $20 (~₩27K) | |
| Gemini API | ~$80 (~₩108K) | 무료 크레딧 한도 초과 가능 |
| Claude API | ~$30 (~₩41K) | 대학별 월별 리포트 |
| Better Auth (셀프호스트) | $0 | |
| **합계** | **~$195 (~₩265K)** | |

### SaaS 수익 vs 비용 (목표)

| 규모 | 월 비용 | 월 수익 (Pro $25×교수 수) | 이익 |
|------|---------|--------------------------|------|
| 10개 대학, 교수 20명 | ~$195 | $500 | +$305 |
| 30개 대학, 교수 60명 | ~$350 | $1,500 | +$1,150 |
| 100개 대학, 교수 200명 | ~$800 | $5,000 | +$4,200 |

---

## 9. 리스크 & 대응

| 리스크 | 확률 | 영향 | 대응 |
|--------|------|------|------|
| Firestore → PostgreSQL 데이터 불일치 | HIGH | HIGH | Shadow read + diff 로깅, dual-write 기간 2주 |
| Better Auth 인증 전환 시 세션 무효화 | MEDIUM | HIGH | 유지보수 공지 + 강제 재로그인 |
| Supabase Realtime 지연으로 배틀 불가 | MEDIUM | MEDIUM | RTDB 유지 (fallback) |
| Edge Functions Cold Start | LOW | MEDIUM | 핫 함수 warm-up, Cloud Run fallback |
| RLS 정책 누락으로 데이터 유출 | LOW | CRITICAL | 테스트 스위트 + 정기 감사 |
| 마이그레이션 기간 중 서비스 중단 | MEDIUM | HIGH | Blue-green 배포, feature flag로 점진적 전환 |

---

## 10. 대형 파일 리팩토링 (Phase 2 병행)

SaaS Phase 2 (Firestore → PostgreSQL) 시 hooks의 raw Firestore 쿼리를 Repository로 전환하면서 자연스럽게 분리.

### 대상 파일

| 파일 | 줄 수 | 전략 |
|------|-------|------|
| `review/page.tsx` | 3,008 | `ReviewPageContext` 도입 → 5탭 상태(필터/선택모드/삭제모드) 공유, 탭별 `ReviewLibraryTab`/`ReviewBookmarkTab`/`ReviewFolderTab` 컴포넌트 분리 |
| `ReviewPractice.tsx` | 2,571 | `ReviewPracticeContext` 도입 → 풀이/결과/피드백 3단계를 독립 컴포넌트로 분리. expand 상태 Context로 공유 |
| `QuestionEditor.tsx` | 2,437 | 문제 타입별 서브 에디터 (`OXEditor`, `MultipleEditor`, `ShortAnswerEditor`, `CombinedEditor`) 분리. question state는 부모 유지 |

### 왜 Phase 2에서?

- 현재 이 파일들은 **기능적으로 정상 동작** — 분리하면 버그 리스크만 증가
- Phase 2에서 hooks → Repository 전환 작업이 이 파일들을 건드리게 됨
- 그때 함께 Context 기반 분리를 하면 **한 번만 건드려서** 리스크 최소화
- 테스트 커버리지를 먼저 확보한 후 리팩토링하면 회귀 버그 방지

---

## 11. 경쟁력 분석

### 11.1 시장 내 경쟁 제품

| 제품 | 특징 | 가격 | 약점 |
|------|------|------|------|
| **Kahoot!** | 실시간 퀴즈쇼, 게이미피케이션 | 교사 $6/월~ | AI 문제 생성 없음, 복습 시스템 없음, 일회성 이벤트용 |
| **Quizlet** | 플래시카드 + 학습 모드 | 무료/Pro $8/월 | AI 생성 단순 (정의 수준), 교수 대시보드 없음, 게이미피케이션 약함 |
| **Quizizz** | 비동기 퀴즈 + 보고서 | 교사 $4/월~ | AI 생성 기본, 배틀 없음, 커스텀 제한적 |
| **Socrative** | 실시간 투표/퀴즈 | $10/월 | AI 없음, 복습 없음, 오래된 UI |
| **ClassCard** (클래스카드) | 한국형 단어/문제 학습 | 무료/유료 | 대학 수준 부족, AI 생성 없음 |
| **AI Tutor 류** | ChatGPT 기반 학습 | 다양 | 구조화된 퀴즈 관리 없음, 교수 통제 불가 |

### 11.2 RabbiTory 차별점 (경쟁 우위)

| 차별점 | 설명 | 경쟁사 현황 |
|--------|------|------------|
| **🧠 10레이어 AI 문제 생성** | Scope + FocusGuide + 교수 스타일 + 문제 뱅크 기반 고품질 출제 | 경쟁사는 단순 프롬프트 기반 (정의 수준) |
| **🎮 실시간 1v1 배틀** | 토끼 캐릭터 기반 철권 스타일 배틀, RTDB 50ms 실시간 | Kahoot은 교실 단위, 1v1 대전 없음 |
| **📊 교수 학습 분석** | 5축 레이더, 4군집 분류, 위험 학생 감지, 변별도, 월별 AI 리포트 | 대부분 단순 점수 통계만 제공 |
| **🐰 게이미피케이션 깊이** | 80마리 토끼 도감, 뽑기, 레벨업, 스탯, 배틀, 연승 보너스 | Kahoot/Quizizz는 포인트/리더보드 수준 |
| **📝 5탭 복습 시스템** | 서재/오답/찜/커스텀 + AI 오답 자동 분류 | 대부분 복습 기능 없거나 기본적 |
| **🎯 교수 스타일 학습** | 교수 출제 패턴 자동 분석 → AI가 해당 스타일로 문제 생성 | 경쟁사에 없는 기능 |
| **📱 PWA 가로모드 3패널** | 모바일/데스크탑 완전 반응형, 3패널 레이아웃 | 대부분 모바일만 또는 데스크탑만 |

### 11.3 시장 기회

**타깃**: 대학/고등교육 교수·강사 (글로벌 영어권 우선 → 아시아 → 한국)

**핵심 포지셔닝: 과목 무관, 교수 특화**
- RabbiTory는 특정 과목 전용이 아님
- **어떤 교수든** 자신의 교재/시험을 올리면 AI가 그 교수의 출제 스타일을 학습
- 생물학이든 경제학이든 역사학이든 — 교수의 발문 패턴, 오답 전략, 주제 비중을 분석하여 맞춤 문제 생성

**왜 국외 우선인가:**

| | 국내 | 글로벌 (영어권) |
|---|---|---|
| **시장 규모** | 대학 ~400개 | US 4,000+, 글로벌 수만 개 |
| **지불 의향** | 낮음 (무료 선호, 기관 결재 느림) | 높음 (교수 개인 카드 결제 문화) |
| **수익 구조** | ₩25,000/월 | $25/월 = ₩34,000 (달러 수익, 원화 비용) |
| **채택 속도** | 느림 (행정 절차) | 빠름 (Product Hunt → 바로 사용) |
| **경쟁 상황** | Kahoot/ClassCard + 행정적 장벽 | AI 교수 맞춤 출제는 공백 |

**왜 지금인가:**
- 대학 교육에서 AI 활용 수요 급증 (2025~2026)
- Kahoot/Quizlet은 "교실 이벤트" or "자습 도구" → **교수 중심 학습 관리** 영역은 공백
- ChatGPT/Gemini를 직접 쓰는 교수들이 늘고 있지만, 구조화된 출제·관리·분석 도구는 없음

**핵심 가치 제안:**
> "Your teaching style, AI-powered quizzes.
> Upload your materials — AI learns how you test, generates exam-quality questions,
> gamification drives student engagement, and real-time analytics spot at-risk students."

### 11.4 GTM (Go-to-Market) 전략 — 국외 우선

**Phase A: 론칭 & 초기 유저 확보 (SaaS 전환 직후)**
```
1. Product Hunt 론칭 — "AI Quiz Generator that learns your teaching style"
2. X(Twitter) / LinkedIn — 교수·EdTech 커뮤니티 타깃 포스팅
3. Reddit — r/professors, r/highereducation, r/edtech
4. YouTube — 2분 데모 영상 (교재 PDF 업로드 → AI 문제 생성 → 학생 배틀)
5. 무료 체험 (Free: 1과목, 30학생, AI 5회/일)
```

**Phase B: 성장 (론칭 후 3~6개월)**
```
1. 교수 입소문 (교수→동료 교수 추천이 가장 강력한 채널)
2. 대학 교수학습센터(CTL) 파트너십 — 기관 단위 도입
3. 교육 컨퍼런스 부스/시연 (EDUCAUSE, ASQ 등)
4. 블로그/케이스스터디 — "Professor X improved exam scores by 15% using RabbiTory"
```

**Phase C: 국내 진출 (글로벌 검증 후)**
```
1. 글로벌 실적으로 국내 대학 어필 — "해외 X개 대학에서 사용 중"
2. 한국어 이미 완성된 상태 → 즉시 출시 가능
3. 대학 행정 채널 공략 (교무처, 교수학습센터)
```

### 11.5 i18n 우선순위

SaaS 전환 시 Phase 5 (Scope/FocusGuide) 이전에 i18n 기반 작업 필요:

```
1. next-intl 또는 next-i18next 도입
2. 영어 번역 (UI 텍스트 ~500개 키)
3. AI 프롬프트 영어 분기 (교수 locale에 따라)
4. 랜딩 페이지 영어 우선
5. 토끼 이름/설명 영어 번역
6. 콩콩이 AI 영어 응답 지원
```

### 11.4 약점 & 보완 필요

| 약점 | 현황 | 보완 방안 |
|------|------|----------|
| **과목 범용성** | 생물학/미생물학/병태생리학 3과목 전용 | Phase 5 동적 Scope/FocusGuide로 해결 |
| **언어** | 한국어 전용 | 국제화(i18n) 추가 필요 |
| **오프라인** | Service Worker 기본 캐싱만 | 오프라인 퀴즈 풀이 → 온라인 시 동기화 |
| **LMS 연동** | 없음 | LTI(Learning Tools Interoperability) 표준 지원 추가 |
| **접근성** | 기본 수준 | WCAG 2.1 AA 준수 필요 (앱스토어 심사 대비) |

### 11.5 전략적 판단

**결론: 경쟁력 있음. 단, 조건부.**

1. **강점이 명확함**: AI 문제 생성 품질(10레이어) + 교수 분석 + 배틀 시스템은 경쟁사 대비 기술적 해자(moat)가 있음
2. **SaaS 전환이 필수**: 현재 단일 교수 맞춤형 → 어떤 과목이든 사용 가능해야 시장 진입 가능
3. **과목 범용화가 핵심 마일스톤**: Scope/FocusGuide 동적 시스템이 SaaS 성패를 결정
4. **초기 GTM(Go-to-Market)**: 글로벌 영어권 우선 → Product Hunt/LinkedIn/Reddit 론칭 → 교수 입소문 → 국내는 글로벌 실적으로 역진출
5. **가격 경쟁력**: Pro $25/월은 Kahoot ($6~)보다 비싸지만, 제공 가치(AI 생성 + 분석)가 훨씬 크므로 정당화 가능. 대학 기관 계약 시 Enterprise 모델이 주 수익원
