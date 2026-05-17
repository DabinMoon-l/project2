# 추출 스크립트 설계 (extraction-design.md)

> ⛔ **실행 금지**. IRB 승인 + 종강(6월 셋째 주) + 동의 수집 완료 전까지 **어떤 쿼리도 실행하지 않는다.**
> 본 문서의 코드는 **인터페이스·타입·의사코드**만 정의. 실제 DB 호출부는 전부 주석 처리 + dry-run 가드.

---

## 0. 동의 모달 구현 제약 (COI 방어 — 잊으면 안 됨)

본문 9.2/9.3은 "동의 응답은 개발자 통제 밖 외부 독립 보관자에 저장, 개발자(공동연구자) 무접근"으로 봉인됨. 따라서 IRB 승인 후 동의 안내 모달을 구현할 때 다음을 **반드시** 지킨다 (이 제약이 깨지면 개발자–연구자 COI 방어선 붕괴):

1. **응답을 앱 DB(Firestore/Supabase 등 개발자 관리 저장소)에 저장 금지.** 모달은 *안내 + 외부 독립 동의 폼 링크*만 제공. 응답 수집·집계 코드를 앱에 넣지 않는다.
2. **외부 독립 보관자 폼만 사용**(기관 IRB 표준 전자동의 경로 또는 PI·개발자 아닌 독립 교직원 소유 폼).
3. **모달 UX**: 비차단(앱 기능 게이팅 금지)·닫기 가능·1회성(반복 노출 금지)·거부/무시 시 불이익 없음.
4. **IRB 승인 전 구현·배포 금지.** 승인 후에도 응답-수집 로직을 앱 코드에 절대 추가하지 않는다(전달 전용).

> 이 절은 추출이 아니라 *모집 모달* 제약이지만, 코드 작업 시 같은 저장소를 보게 되므로 여기 박아 둔다(메모리 소실 대비).

---

## 1. 실행 차단 가드 (모든 추출 함수 진입부)

```typescript
// scripts/research/_guard.ts  (설계 전용 — 실행 금지)
export const IRB_APPROVED = false;            // IRB 승인 후 수동 true
export const SEMESTER_ENDED = false;          // 종강 후 수동 true
export const CONSENT_COLLECTED = false;       // 동의 수집 완료 후 수동 true

export function assertExtractable(): void {
  if (!(IRB_APPROVED && SEMESTER_ENDED && CONSENT_COLLECTED)) {
    throw new Error('[BLOCKED] IRB 승인·종강·동의 수집 완료 전 추출 금지');
  }
}
// 설계 단계에서는 위 플래그가 모두 false → 모든 실행 경로가 throw.
```

---

## 2. 입력 인터페이스

```typescript
/** 시험 일정 — 로그에 없음. 교수 제공(2026-05-17 수령, 기말만 확정 대기).
 *  ⚠️ 쪽지시험은 분반별로 날짜가 다름 → 분반별 윈도 분기 필수. */
interface ExamSchedule {
  /** 쪽지시험: 분반별 일자. exam_focus 윈도를 학생 class_id로 분기 */
  quizExamDatesByClass: Record<'A'|'B'|'C'|'D', Date[]>;
  midtermDate: Date;       // 중간고사 (분반 공통 가정 — 교수 확인 필요)
  finalDate: Date | null;  // 기말고사: 6/16~19 중 1일, 미확정. 추출 시점(종강 후) 확정값 입력
  weekBeforeExam: number;  // "시험 1주 전" 정의 (기본 7일)
}

/** 교수 제공 실제값 (2026-05-17). finalDate는 확정 후 교체. */
const MICRO_EXAM_SCHEDULE: ExamSchedule = {
  quizExamDatesByClass: {
    A: [new Date('2026-03-30')],
    C: [new Date('2026-03-30')],
    D: [new Date('2026-03-30')],
    B: [new Date('2026-03-31')],
  },
  midtermDate: new Date('2026-04-17'),
  finalDate: null,                       // 6/16~19 중 1일 — 종강 후 확정값으로 교체
  weekBeforeExam: 7,
};

/** 추출 구성 */
interface ExtractionConfig {
  courseId: 'microbiology';
  semesterStart: Date;                  // 2026-1 학기 시작
  semesterEnd: Date;                    // 종강(6월 셋째 주)
  exam: ExamSchedule;
  /** 연구자 본인 학번 — **공동연구자 1인 확정**(단수). 기본 제외. IRB 통과 후 입력.
   *  배열 타입은 테스트계정 동시처리용일 뿐, 실제 PI는 정확히 1명. */
  principalInvestigatorStudentIds: string[];   // 길이 1 고정. 예: ['__PI_STUDENT_ID__']
  /** 추가 제외 학번 (테스트 계정 등) */
  excludeStudentIds: string[];                 // 기본 [] + PI 자동 합산
  /** 동의 거부/미동의 학번 — IRB 통과 후 동의 수집 결과로 채움 */
  consentDeniedStudentIds: string[];           // 예: []  (자리만)
  nightHours: [number, number];          // [22, 6] KST
  weekendDays: number[];                 // [토=5, 일=6]  (dayOfWeek 정의에 맞춤)
  maxDurationMs: number;                 // 30*60*1000 (이상치 절단)
}

const DEFAULT_CONFIG: Partial<ExtractionConfig> = {
  courseId: 'microbiology',
  semesterStart: new Date('2026-03-03'),   // 교수 확인 2026-05-17 (화 개강)
  exam: MICRO_EXAM_SCHEDULE,               // 교수 제공값. finalDate는 종강 후 확정 교체
  principalInvestigatorStudentIds: ['__PI_STUDENT_ID__'],  // ← IRB 후 실제 학번 1개(공동연구자 1인 확정)
  excludeStudentIds: [],
  consentDeniedStudentIds: [],
  nightHours: [22, 6],
  weekendDays: [5, 6],
  maxDurationMs: 30 * 60 * 1000,
};
```

---

## 3. 대상 학생 필터 (제외 로직)

```typescript
function buildEligibleStudentSet(
  allStudentIds: string[],
  cfg: ExtractionConfig
): Set<string> {
  const exclude = new Set<string>([
    ...cfg.principalInvestigatorStudentIds,  // 연구자 본인
    ...cfg.excludeStudentIds,                // 테스트/관리 계정
    ...cfg.consentDeniedStudentIds,          // 미동의자
  ]);
  return new Set(allStudentIds.filter(id => !exclude.has(id)));
  // 미가입 10명은 애초에 pageViews/users에 없어 자연 제외
  // → 최종 대상 ≈ 동의자 ∩ 앱사용자
}
```

---

## 4. 비식별 치환 hook (자리만)

```typescript
/**
 * 학번 → 연구ID 치환. 실제 매핑은 IRB 후 교수가 보안 환경에서 보유.
 * 연구자(개발자)는 매핑표에 접근하지 않음.
 */
interface PseudonymMap { toResearchId(studentId: string): string; }

function loadPseudonymMap(/* path: string */): PseudonymMap {
  // ── 설계 단계: 미구현 ──────────────────────────────
  // IRB 후, 교수가 생성한 mapping.csv(학번→R001..R148)를
  // 보안 환경에서 로드. 연구자 데이터셋엔 research_id만 잔류.
  throw new Error('[BLOCKED] 매핑표는 IRB 후 교수 보관본만 사용');
}
```

---

## 5. 변수 추출 함수 (시그니처 + 의사코드, 실행부 주석)

```typescript
// 모든 함수: 진입 시 assertExtractable() → 설계 단계에선 throw
import * as admin from 'firebase-admin';

interface VariableRow {
  research_id: string;
  // H1
  attendance_interval_sd: number | null;
  attendance_interval_cv: number | null;
  exam_focus_ratio: number | null;
  night_use_ratio: number | null;
  weekend_use_ratio: number | null;
  // H2
  review_detail_entries: number;
  review_entries_wrong: number;
  review_entries_correct: number;
  wrong_review_ratio: number | null;
  same_detail_revisit: number;
  // H3
  kongi_academic_q: number;
  kongi_followup_ratio: number | null;
  // H4
  prof_pick_entries: number;
  prof_pick_unique: number;
  // H5
  feedback_count: number;
  feedback_edited_count: number;
  feedback_redo_count: number;
  feedback_loop_completion: number | null;
  feedback_edit_rate: number | null;
  feedback_redo_rate: number | null;
  // 게이미피케이션(활동량 대리·기술만, 독립차원/동기 아님 — EXP 결정함수):
  rabbit_species_owned: number;          // 활동량 대리. 차이는 활동량 산물로만 해석
  gacha_count: number;                   // 활동량 대리
  gacha_choice_ratio: number | null;     // 마일스톤 선택비율 — 고찰 후속연구 훅(동기 측정·주장 안 함)
  battle_count: number;                  // 기본사용량 기술
  battle_used: 0 | 1;                    // 기본사용량 기술(천장 85–95%)
  // H7 (사회비교) — 명시적 클릭 신호 ranking_open
  ranking_entries: number;        // category == 'ranking_open' 카운트
  ranking_entry_rate: number | null;
  ranking_dwell_ms: number | null;
  // 기본 사용량
  entry_share_quiz: number | null;
  entry_share_review: number | null;
  entry_share_board: number | null;
  entry_share_battle: number | null;
  quiz_attempts: number;
  quiz_retry_count: number;
  // 통제
  class_id: string;
  exposure_days: number;
  attendance_days_total: number;
  // 퀴즈 정답률: 추출하지 않음(수행 지표·행동 아님, 종속변수 동일도메인 상관물). 보조 파일도 미생성.
}

/** H1: dailyAttendance 기반 규칙성 */
function extractH1(/* db, uid, cfg */): Partial<VariableRow> {
  // assertExtractable();
  /* ── 실행 금지 (IRB 후) ────────────────────────────
  // const days = await db.collection('dailyAttendance')
  //   .where(... courseId, 날짜범위 ...).get()
  //   → attendedUids에 uid 포함된 날짜 배열 D[] 구성
  // intervals = 연속 D 간격(일); sd = std(intervals); cv = sd/mean
  // night/weekend: pageViews.timestamp(KST) 분류 비율
  // exam_focus: cfg.exam 기준 (전 7일 일평균) / (평시 일평균)
  ──────────────────────────────────────────────── */
  throw new Error('[BLOCKED]');
}

/** H5: 피드백 사이클 3단계 (시간근사 ②) */
function extractH5(/* db, uid */): Partial<VariableRow> {
  // assertExtractable();
  /* ── 실행 금지 (IRB 후) ────────────────────────────
  // fb = questionFeedbacks where userId==uid  → (quizId,questionId,createdAt)[]
  // for each fb: q = quizzes/{quizId}.questions[?id==questionId]
  //   edited = q.questionUpdatedAt && q.questionUpdatedAt > fb.createdAt   // ② 시간근사
  //   redone = edited && quizResults(userId,quizId).questionScores[qid]
  //              .answeredAt > q.questionUpdatedAt                         // ③ 직접키
  // feedback_count=|fb|; feedback_edited_count=Σedited; feedback_redo_count=Σredone
  // feedback_loop_completion = redo/count (count==0 → null)
  ──────────────────────────────────────────────── */
  throw new Error('[BLOCKED]');
}

// extractH2/H3/H4/H7/extractBasicUsage: 동일 패턴
//  - H4: pageViews(board_detail) postId ⋈ posts.isPinned==true
//  - 배틀(기본사용량 기술): RTDB tekken/results player 등장 → battle_count/battle_used
//  - 게이미피케이션(활동량 대리·기술만): rabbitHoldings 수→rabbit_species_owned/gacha_count,
//    마일스톤 선택 이력→gacha_choice_ratio(고찰 훅). 동기/독립차원 주장 안 함
//  - H7: pageViews category=='ranking_open' (명시적 클릭만; 탭별·정확체류 불가 → 산출 안 함)
//  모두 throw('[BLOCKED]') 로 마감.
```

---

## 6. 파이프라인 (의사코드, 실행 금지)

```text
assertExtractable()                       // false → 즉시 throw (현재 상태)
cfg = DEFAULT_CONFIG + 교수 입력(ExamSchedule, PI 학번, 미동의자)
allIds = users(courseId=microbiology, role=student)  학번 목록
eligible = buildEligibleStudentSet(allIds, cfg)      // PI·미동의·테스트 제외
pseudo = loadPseudonymMap()                          // 교수 보관본
rows = []
for sid in eligible:
    uid = lookupUid(sid)
    row = { research_id: pseudo.toResearchId(sid),
            ...extractH1, H2, H3, H4, H5, H7, Gamification, Battle, BasicUsage(uid) }  // 게이미피케이션=활동량 대리·기술만(동기 아님)
    drop(raw uid/postId/quizId/free-text)            // 비식별
    rows.push(row)
writeCsv(rows)            // 약 148행 × 약 40열 wide (정답률 등 수행 지표 없음, 보조 파일 미생성)
```

---

## 7. 출력 포맷

- **메인(유일)**: `microbiology_usage_wide.csv` — `research_id` + 약 40개 행동 변수, **1학생 1행**, 식별자·자유텍스트·rank·totalExp·퀴즈 정답률 없음.
- 보조 정답률 파일(`aux_accuracy.csv`) **미생성** — 개인 단위 정답률을 어떤 산출물에도 보관하지 않음.
- 인코딩 UTF-8(BOM), 수치 NA는 빈칸.

> 폐기 변수(`dogam_entries`, `equip_change_count`, `ranking_tab_ratio`)는 컬럼 자체를 만들지 않는다.

---

## 8. 분석 설계 (문서 정합용 — 종강 후 실행)

**설계: 확증 핵심가설 없는 기술형 군집 프로파일** (Primary·Confirmatory·주가설·사전등록 표현 미사용):
- 연구문제: 성적 군집(상/중/하)에 따라 앱 전 기능 사용 패턴이 어떻게 다른가.
- 사전 확정 변수군(구 H1·H2·H3·H4·H5·H7 + 기본사용량 + 게이미피케이션)을 **위계 없이 동등 기술**.
- 피드백 사이클 영역 대표 변수=`feedback_count`(완전·전원 정의; 각 영역이 대표 변수를 둠 — 위계 아님); `feedback_loop_completion`은 시간근사+NA로 보조 기술만.
- 게이미피케이션은 *활동량 대리·기술만*(독립차원/동기 아님), EXP-결정성은 방법론적 발견, `gacha_choice_ratio`는 고찰 훅.

**검정**:
- **비모수 Jonckheere–Terpstra 순서대립 사전 주분석**(영과잉·유계 다수). 순위변환 ANCOVA + 2-df 옴니버스 보조.
- **추세검정은 양측(비방향) 단조추세**. 주분석=무보정 분포무관 연관성; 노출기간·분반 교란 보정은 보조 순위 ANCOVA, 일치여부로 추론.
- 군집 코딩 `grade_cluster`: **상=+1, 중=0, 하=−1** (선형 contrast).
- 다중비교·p: 확증 주가설 없는 기술형 → 단일 α 미의존. **본문 효과크기·95%CI만**, 변수별 p 미보고. p는 부록 표 "k검정·무보정·비추론·확증 아님" 라벨로만.
- `feedback_count` 영과잉 가능 → 허들·음이항 보조 민감도, 효과크기(Cliff's δ 등) 중심.

**보고 기조**: **본문은 효과크기 + 95% CI만**, 변수별 p 미보고(p는 부록 라벨표). 표본 근거는 검정력이 아니라 **정밀도(추정의 한계)**로 제시:
- N≈148, 군집 셀 ≈49/50/49. 이 규모에서 군집 간 *효과크기 f≈0.23 미만의 차이는 95% CI로 안정적으로 구분되지 않을* 수준(정밀도 한계). 참조 산출: G*Power Sensitivity(ANCOVA, 3군집, 공변량=노출1+분반더미3, α=0.05, 1-β=.80, 1-df) → f≈0.23 — IRB 표본근거 칸용 수치이며, 검정력 주장이 아니라 *구분 가능 최소차이*로 해석. 폐기된 3가설 보정 옴니버스(α=0.0167) 값 미사용.

**`exam_focus_ratio` 산출 규칙 (교수 일정 2026-05-17)**:
- 정의: 시험별 (전 7일 일평균 pageviews) ÷ (평시 일평균 pageviews). 평시 = 학기 활동일 중 어떤 시험의 전 7일 윈도·시험일에 속하지 않는 날.
- **주 지표 = 중간(2026-04-17)·기말 평균.** 쪽지시험은 저부담이라 1주-전 신호가 약함 → 별도 보고/민감도용, 주 지표 미포함(평균 희석 방지).
- **쪽지시험 분반 분기 필수**: A·C·D = 2026-03-30, B = 2026-03-31 → 학생 `class_id`로 윈도 산정.
- 기말: 2026-06-16~19 중 1일 미확정 → 추출이 종강 후이므로 그때 확정값 입력(운영상 문제 없음, 코드에 `finalDate=null` 가드).
- 확인 완료(2026-05-17): **중간·기말은 분반 공통**(쪽지만 분반별). **개강 = 2026-03-03(화)** → `semesterStart`로 평시 분모 경계 확정.

**모집단 한정**: 2026-1학기 G지역 일개 간호대학 미생물학 수강생. 본 강좌·본 학기로 한정, 일반화 안 함.
