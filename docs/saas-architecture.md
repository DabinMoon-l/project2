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

### Phase 5: 셀프서비스 온보딩 + 빌링 (2주, LOW 리스크)

**작업:**
- 랜딩 페이지 (`/pricing`, `/signup`)
- Stripe 연동
  - Free: 1 과목, 50 학생
  - Pro: 무제한 과목, 500 학생, AI 생성 무제한
  - Enterprise: SSO, 커스텀 도메인, SLA
- 대학 관리자 대시보드 (`/admin`)
  - 과목 관리, 교수 초대, 사용량 모니터링
- 커스텀 도메인 지원 (Vercel wildcard domain)

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

### 단일 대학 (현재, ~300 학생)

| 서비스 | 월 비용 |
|--------|---------|
| Firebase (Blaze) | ~$30 |
| Vercel (Pro) | $20 |
| Gemini API | ~$15 |
| Claude API | ~$5 |
| **합계** | **~$70** |

### SaaS (10개 대학, ~3,000 학생)

| 서비스 | 월 비용 |
|--------|---------|
| Supabase (Pro) | $25 |
| Firebase (RTDB + FCM) | ~$20 |
| Cloud Run | ~$30 |
| Vercel (Pro) | $20 |
| Gemini API | ~$100 |
| Claude API | ~$30 |
| Better Auth (셀프호스트) | $0 |
| **합계** | **~$225** |

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
