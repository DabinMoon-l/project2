# 변수 명세서 (variables.md)

> **연구 개요**: 미생물학 수강생 159명 중 앱 사용자 ≈148명(공동연구자 1인 제외)을 학기 성적 기준 **상/중/하 3군집**으로 나눠 앱 사용 패턴 차이를 *기술·탐색적으로* 분석.
> **상태**: ⛔ IRB 승인 전 — 설계 문서. 실제 추출은 **IRB 승인 + 종강(6월 셋째 주) + 동의 수집 완료** 후.
> **연구 성격**: 후향적 2차 분석 + (근)전수. 모집단 = **2026-1학기 G지역 일개 간호대학 미생물학 수강생**(이 강좌·이 학기로 한정, 일반화 안 함).
> **종속변수**: 미생물학 학기 성적(앱 외부, 교수 보유). **독립/패턴 변수**: 아래 앱 사용 변수.

---

## 연구문제 및 사전지정 변수군 (확증가설 없음 — 기술형 군집 프로파일)

본 연구는 단일 핵심가설을 두지 않는다. **연구문제**: *2026-1학기 미생물학 수강생의 학기 성적 군집(상/중/하)에 따라 학습 보조 앱의 전 기능 사용 패턴이 어떻게 다르게 나타나는가*. 아래 변수군 전체를 **동등하게(위계 없이)** 사전 확정하고, 군집별로 기술 프로파일링한다(확증·검정 주장 아님 — 후속 가설 정련용 기술).

| 변수 영역(구 가설번호) | 대표 변수 | 비고 |
|---|---|---|
| 학습 분산도 (구 H1) | 접속 규칙성(간격 SD·CV), 시험 직전 집중도, 야간·주말 비율 | 영과잉 적음·문헌 탄탄(Dunlosky 2013) |
| 메타인지·복습 (구 H2) | 복습 상세/해설 진입, 오답/정답 복습 비중(근사) | 라우트 근사 |
| AI 학습도움 (구 H3) | 콩콩이 학술 질문 수, 후속질문율 | |
| 교수 큐레이션 (구 H4) | 교수 픽(핀) 글 진입 | |
| 피드백 사이클 (구 H5) | 문제 피드백 제출 빈도(`feedback_count`) | 사이클 보조지표는 시간근사·영과잉 → 기술만 |
| 사회비교 (구 H7) | 앱 활동 대비 랭킹 상세 열람 강도(`ranking_open`) | 가로모드 차등결측 한계 |
| 기본 사용량 | 카테고리별 사용 비중, 퀴즈 시도·재시도 행동량, 배틀 참여 | |
| **게이미피케이션 상호작용** | 토끼·뽑기·장착·레벨, **마일스톤 선택(뽑기 vs 레벨업) 비율** | ⚠️ **활동량 결정함수**(≈floor(totalEXP/50)) — 독립 행동 차원·동기 아님. *활동량 대리로만 기술*하고, EXP-결정성 자체를 **방법론적 발견**으로 보고. 마일스톤 선택 비율은 *고찰의 후속연구 훅*(검증된 동기척도 필요)으로만 — 동기 측정·주장 안 함 |

> 결과변수(앱 내 랭킹 점수·누적 EXP·퀴즈 정답률)는 *사용 행동이 아닌 수행·집계 산출물*이라 프로파일에서 제외(아래 제외 원칙).

### 분석 설계 요지 (전 변수 영역 공통·동등)

- **1-df 선형추세 = 비모수 Jonckheere–Terpstra(순서대립) 사전 주분석** (핵심 변수 다수가 영과잉·유계·우편향 → 정규 ANCOVA 잔차가정 위배가 기본값). 공변량 보정 순위변환 ANCOVA + 2-df 옴니버스는 보조. 근거: `distribution-priors.md`.
- **군집 코딩**: 상=+1, 중=0, 하=−1. 추세검정은 **양측(비방향) 단조추세**.
- 공변량: `exposure_days`, `class_id`.
- **다중비교·p 처리**: 확증 주가설이 없는 *기술형* 설계이므로 단일 α 검정에 의존하지 않는다. **본문 결과에는 변수별 p를 보고하지 않고 효과크기 + 95% 신뢰구간만 제시**한다. p값은 부록 표에 *"k개 검정·무보정·비추론·확증 아님"* 라벨을 달아 일괄 제시만 한다(다중성은 보정이 아니라 *비추론·기술·가설생성* 위치로 통제). NHST·"확증"·"주가설/사전등록" 표현 미사용.
- 검정력은 표본수 정당화가 아니라 **민감도(MDE) 참고치**로만: G*Power Sensitivity(ANCOVA, 3군집, 공변량=노출1+분반더미3, α=0.05, 1-df 추세, 1-β=0.80, N≈148) → 약 **f≈0.23**(모수 ANCOVA 근사, 비모수 J–T 실제 검정력은 분포 의존). 폐기된 3가설 보정(α=0.0167 옴니버스) 값 미사용.
- 실데이터≠사전가정이어도 주분석(J–T) 불변, 민감도 분석만 보조 추가(`distribution-priors.md` 사전 고정).

---

## ⚠️ 분석 변수 제외 원칙 (필독)

1. **랭킹 점수(`rank`)·누적 EXP(`totalExp`)·퀴즈 정답률은 독립변수 사용 금지** — 이들은 *사용 행동*이 아니라 **수행·집계 산출 지표**이며, 종속변수(교수의 공식 학기 성적)와 동일한 미생물학 숙련도를 반영하는 강한 상관물이라 사용패턴 분석의 독립변수로 부적합(능력 교란·역인과 비판 재유입 방지). ※ 정답률 ≠ 학기 성적이지만(서로 다른 측정치), *같은 숙련도의 동일 도메인 측정치*라는 점이 제외 사유임. H7은 *랭킹 조회 행동*만 다룸(점수 아님).
2. **퀴즈 정답률은 분석 데이터셋에 일절 추출하지 않는다** — 별도 보조 파일도 만들지 않으며 개인 단위 정답률을 어떤 산출물에도 보관하지 않는다. `quizResults`에서는 시도·재시도 *행동량*만 사용.
3. **콩콩이 비공개 글("나만의 콩콩이")은 실사용자 희소 → 변수 제외**.

---

## 0. 식별·통제 변수 (분석 단위 = 학생 1명)

| 변수명 | 영역/역할 | 정의 | 계산 공식 | 원천 컬렉션·필드 | 단위 | 결측치 처리 | 집계 단위 |
|---|---|---|---|---|---|---|---|
| `research_id` | — | 연구용 익명 ID | 학번 → R001~R148 치환(매핑표 교수 보관) | (치환 hook) | - | - | 학기전체 |
| `grade_cluster` | 종속 | 성적 군집(선형코딩 상+1/중0/하−1) | 학기 성적 백분위 → 상33/중34/하33 | 교수 성적표(앱 외부) | 범주/순서 | 성적 없으면 제외·기록 | 학기전체 |
| `class_id` | 공변량 | 분반 | 그대로 | `users.classId`/`classType` | 범주 | 별도 표기 | 학기전체 |
| `exposure_days` | 공변량 | 노출기간 보정 | (마지막활동일−최초활동일)+1 | `pageViews.timestamp` | 일 | 미가입자 모집단 제외 | 학기전체 |
| `attendance_days_total` | 분모 | 총 접속일수 | distinct(접속일) | `dailyAttendance.attendedUids` | 일 | 0이면 사용량 0 | 둘다 |

---

## 피드백 사이클 (구 H5) — 사전지정 변수 영역 (위계 없음)

3단계 연쇄: ① 학생 피드백 제출 → ② 교수가 그 문항 수정(시간근사) → ③ 학생이 수정문항 재풀이.

| 변수명 | 영역/역할 | 정의 | 계산 공식 | 원천 컬렉션·필드 | 단위 | 결측치 처리 | 집계 단위 |
|---|---|---|---|---|---|---|---|
| **`feedback_count`** | **H5 주변수** | ① 피드백 제출 수 (148명 전원 정의됨, 완전 추적) | count(`questionFeedbacks` userId=학생) | `questionFeedbacks.userId/.createdAt/.quizId/.questionId` | 건 | 0=0 (전원 정의) | 둘다 |
| `feedback_edited_count` | H5 보조 | ② 본인 피드백 문항 중 이후 수정 건수(시간근사) | count(피드백 문항 중 `questionUpdatedAt > feedback.createdAt`) | ⋈ `quizzes.questions[i].questionUpdatedAt` | 건 | feedback=0이면 NA | 학기전체 |
| `feedback_redo_count` | H5 보조 | ③ 그 수정문항을 본인이 재풀이한 건수 | count(② 중 `answeredAt > questionUpdatedAt`) | ⋈ `quizResults.questionScores[qid].answeredAt`, `isReviewPractice` | 건 | 0=0 | 학기전체 |
| `feedback_loop_completion` | H5 보조 | 피드백 루프 완주율(근사 합성·NA 다발) | `feedback_redo_count` ÷ `feedback_count` | 위 셋 | 비율 | feedback=0이면 NA(분석 제외) | 학기전체 |
| `feedback_edit_rate` | H5 보조 | 전환율 ①→② | `feedback_edited_count` ÷ `feedback_count` | 위 | 비율 | 분모 0이면 NA | 학기전체 |
| `feedback_redo_rate` | H5 보조 | 전환율 ②→③ | `feedback_redo_count` ÷ `feedback_edited_count` | 위 | 비율 | 분모 0이면 NA | 학기전체 |

> ⚠️ **주변수는 `feedback_count`(완전·전원 정의)**. `feedback_loop_completion`은 ②가 시간근사 + 분모(feedback_count)=0이면 NA라 **실제 분석 N이 148 미만으로 줄어드는 취약 지표** → **H5 내부 보조**로만 사용, 주 검정 엔드포인트로 쓰지 않음. 보고 시 효과크기+95%CI 주력.

---

## H1 · 분산학습 — 사전지정 변수 영역 (위계 없음)

| 변수명 | 영역/역할 | 정의 | 계산 공식 | 원천 컬렉션·필드 | 단위 | 결측치 처리 | 집계 단위 |
|---|---|---|---|---|---|---|---|
| `attendance_interval_sd` | H1 | 접속 간격 표준편차(작을수록 규칙=분산) | SD(연속 접속일 간격[일]) | `dailyAttendance` 날짜 배열 | 일 | 접속 ≤1일이면 NA | 학기전체 |
| `attendance_interval_cv` | H1 | 접속 간격 변동계수 | SD ÷ mean(간격) | 동일 | 무차원 | mean=0이면 NA | 학기전체 |
| `exam_focus_ratio` | H1 | 시험 1주 전 사용 집중도 | (시험전 7일 일평균 pageViews) ÷ (평시 일평균) | `pageViews.timestamp` + **교수 제공 시험일정** | 배수 | 시험일정 없으면 산출 보류 | 학기전체 |
| `night_use_ratio` | H1 | 야간(22–06시 KST) 사용 비율 | count(야간) ÷ count(전체) | `pageViews.timestamp` | 비율 | 분모 0이면 NA | 둘다 |
| `weekend_use_ratio` | H1 | 주말(토·일) 사용 비율 | count(주말) ÷ count(전체) | `pageViews.timestamp`(dayOfWeek) | 비율 | 분모 0이면 NA | 둘다 |

> `exam_focus_ratio` (교수 제공 일정 2026-05-17 반영): **주 지표 = 중간(4/17)·기말 평균**. 쪽지시험(저부담)은 신호가 약해 *별도/민감도*로만. **쪽지시험은 분반별 날짜 상이**(A·C·D=3/30, B=3/31) → "전 7일" 윈도를 학생 `class_id`로 분기 산출. 기말은 6/16~19 중 미정 → 추출 시점(종강 후) 확정값 사용. 평시(baseline)=학기 활동일 중 어떤 시험 전 7일 윈도·시험일에 속하지 않는 날. 시험일정 = 외부 입력(`ExamSchedule`, → `extraction-design.md`).

---

## H7 · 사회비교(랭킹 조회) — 사전지정 변수 영역 (위계 없음)

| 변수명 | 영역/역할 | 정의 | 계산 공식 | 원천 컬렉션·필드 | 단위 | 결측치 처리 | 집계 단위 |
|---|---|---|---|---|---|---|---|
| `ranking_access_intensity` | H7 주변수 | 앱 활동 대비 랭킹 조회 강도 | `ranking_entries` ÷ 전체 pageViews(또는 세션 수) | `pageViews.category=ranking_open` ÷ 전체 | 비율 | 분모 0이면 NA | 둘다 |
| `ranking_entries` | H7 | 랭킹 상세 **명시적 열람** 횟수 | count(`pageViews` category=`ranking_open`) | `pageViews.category`(`/@overlay/ranking_open`) | 회 | 0=0 | 둘다 |
| `ranking_dwell_ms` | H7 보조 | 랭킹 체류시간(근사) | Σ `pageViews.durationMs`(category=ranking_open) | `pageViews.durationMs` | ms | 결측 행 제외 | 학기전체 |
| ~~`ranking_tab_ratio`~~ | — | day/week/all 탭별 비율 | **추적 불가**(탭=내부 state) | (로그 없음) | - | **변수 폐기** | - |

> `ranking_open`은 홈 자동노출이 아니라 **랭킹 상세를 여는 명시적 클릭**에서만 로깅(`RankingSection.tsx:167`) → 능동적 사회비교 신호로 타당.
> ⚠️ **가로모드(3패널) 분기(`RankingSection.tsx:165`)는 로깅 누락** → 가로모드 주 사용 학생의 랭킹 조회 *체계적 미기록*(차등 결측). 대응: `ranking_access_intensity`(정규화) 유지 + 가로모드 사용 비율을 한계/공변량으로 명시. (D 결정: 사전지정 유지)

---

## H2 · 메타인지(복습·해설 활용) — 사전지정 변수 영역 (위계 없음)

| 변수명 | 영역/역할 | 정의 | 계산 공식 | 원천 컬렉션·필드 | 단위 | 결측치 처리 | 집계 단위 |
|---|---|---|---|---|---|---|---|
| `review_detail_entries` | H2 | 복습 상세/해설 진입 총횟수 | count(`pageViews` category=`review_detail`) | `pageViews.category` | 회 | 0=0 | 둘다 |
| `review_entries_wrong` | H2 | 오답 복습 진입(근사) | count(path ~ `/review/wrong*`) | `pageViews.path` | 회 | 0=0 | 둘다 |
| `review_entries_correct` | H2 | 정답/서재 복습 진입(근사) | count(path ~ `/review/library*`) | `pageViews.path` | 회 | 0=0 | 둘다 |
| `wrong_review_ratio` | H2 | 오답 복습 집중도 | `review_entries_wrong` ÷ `review_detail_entries` | 위 | 비율 | 분모 0이면 NA | 학기전체 |
| `same_detail_revisit` | H2 | 동일 복습 상세 재진입(근사) | Σ(같은 path 2회차+ 진입) | `pageViews.path` 그룹 | 회 | 0=0 | 학기전체 |

> ⚠️ "동일 문항" 재진입 불가 → 동일 퀴즈/폴더 재진입 근사. 정답/오답도 라우트 proxy(→ `feasibility.md`).

---

## H3 · 콩콩이(AI 학습도움) — 사전지정 변수 영역 (위계 없음)

| 변수명 | 영역/역할 | 정의 | 계산 공식 | 원천 컬렉션·필드 | 단위 | 결측치 처리 | 집계 단위 |
|---|---|---|---|---|---|---|---|
| `kongi_academic_q` | H3 | 콩콩이 학술 질문 수(공개) | count(`posts` authorId=학생 ∧ tag='학술' ∧ isPrivate=false) | `posts.authorId/.tag/.isPrivate` | 건 | 0=0 | 둘다 |
| `kongi_followup_ratio` | H3 | 콩콩이 답변 후속질문율 | (학생→`gemini-ai` 댓글 대댓글 수) ÷ (콩콩이가 답한 학생 글·댓글 수) | `comments.parentId/.authorId` | 비율 | 분모 0이면 NA | 학기전체 |

> 🔒 `kongi_private_ratio`(비공개) **변수 제외**, 비공개 글 일절 미추출.

---

## H4 · 교수 픽(핀) 게시글 진입 — 사전지정 변수 영역 (위계 없음)

| 변수명 | 영역/역할 | 정의 | 계산 공식 | 원천 컬렉션·필드 | 단위 | 결측치 처리 | 집계 단위 |
|---|---|---|---|---|---|---|---|
| `prof_pick_entries` | H4 | 교수 픽 글 진입 총횟수 | count(`pageViews` board_detail 중 postId∈{posts.isPinned=true}) | `pageViews.path` ⋈ `posts.isPinned` | 회 | 0=0 | 둘다 |
| `prof_pick_unique` | H4 | 진입한 교수 픽 글 종수 | distinct(위 postId) | 동일 | 개 | 0=0 | 학기전체 |

> ⚠️ 핀 on/off 이력이 진입 로그에 없어 추출 시점 `isPinned` 기준 근사.

---

## 게이미피케이션 상호작용 (구 H6) — 활동량 대리·동기 아님 (기술 + 방법론적 발견)

| 변수명 | 영역/역할 | 정의 | 계산 공식 | 원천 컬렉션·필드 | 단위 | 결측치 처리 | 집계 단위 |
|---|---|---|---|---|---|---|---|
| `rabbit_species_owned` | 활동량 대리(기술만) | 보유 토끼 종 수 | count(`rabbitHoldings`) | `users/{uid}/rabbitHoldings` | 종 | 없으면 0 | 학기전체 |
| `gacha_count` | 활동량 대리(기술만) | 누적 뽑기 | acquiredAt 카운트 | `rabbitHoldings.discoveredAt` | 회 | 0=0 | 학기전체 |
| `gacha_choice_ratio` | 행동 선호(고찰 훅) | 마일스톤 선택 중 뽑기 비율 | 뽑기 ÷ (뽑기+레벨업) 선택 | `lastGachaExp`·levelUp 이력 | 비율 | 마일스톤 0이면 NA | 학기전체 |
| `battle_count` | 기본 사용량(기술) | 배틀 참여 횟수 | count(player 등장 battle) | `tekken/results/{courseId}/*` | 회 | 0=0 | 둘다 |
| `battle_used` | 기본 사용량(기술) | 배틀 1회+ 사용 여부(천장 85–95%) | player 등장 ∨ `tekkenTotal`>0 | 동일 | 0/1 | 없으면 0 | 학기전체 |
| ~~`dogam_entries`~~ | — | 도감 진입 횟수 | **추적 불가**(로깅 없음) | (로그 없음) | - | **변수 폐기** | - |
| ~~`equip_change_count`~~ | — | 장착/변경 횟수 | **추적 불가**(변경 이력 없음) | (이력 없음) | - | **변수 폐기** | - |

> ⚠️ **정직성 핵심**: 토끼·뽑기·장착·레벨은 코드상 EXP 마일스톤(50EXP 단위)의 **결정함수**(`rabbit_species_owned`≈floor(totalEXP/50), r≈0.98; 대체후보 equip/pass/maxlv도 r≈0.70–1.0 — B 검증 완료). 따라서 **독립 행동 차원도, 동기 측정치도 아니다.**
> - **기술만**: `rabbit_species_owned`·`gacha_count`는 군집별로 *기술*하되, 차이가 보여도 "게이미피케이션 선호/동기"가 아니라 **활동량 산물**로만 해석(명시).
> - **방법론적 발견(기여)**: "앱 보상이 활동량 결정함수라 게이미피케이션 관여를 활동량/동기와 분리 측정 불가" 자체를 후속 학습도구 설계 시사점으로 보고.
> - **고찰 훅**: `gacha_choice_ratio`(수집 vs 투자 선호)는 *조건부 선택*이라 보유 수보다 EXP 의존이 약함 → **고찰에서만** "동기 지향 차이를 시사할 수 있어 검증된 동기척도(예: SDT 기반 IMI) 포함 후속연구 필요"로 제언. **동기 측정·주장 안 함.**

---

## 기본 사용량 변수 (탐색·기술·통제)

| 변수명 | 영역/역할 | 정의 | 계산 공식 | 원천 컬렉션·필드 | 단위 | 결측치 처리 | 집계 단위 |
|---|---|---|---|---|---|---|---|
| `entry_share_quiz/review/board/battle` | 탐색 | 카테고리별 진입 비중(권장) | count(cat) ÷ count(전체) | `pageViews.category` | 비율 | 분모 0이면 NA | 둘다 |
| `time_share_quiz/review/board/battle` | 탐색 | 카테고리별 체류 비중(근사) | Σduration(cat) ÷ Σduration(전체) | `pageViews.durationMs` | 비율 | 결측 행 제외 | 둘다 |
| `quiz_attempts` | 탐색 | 퀴즈 시도 횟수(**정답률 제외**) | count(`quizResults` userId, isUpdate 포함) | `quizResults.userId` | 회 | 0=0 | 둘다 |
| `quiz_retry_count` | 탐색 | 재시도/복습풀이 횟수 | count(`quizResults` isReviewPractice ∨ isUpdate) | `quizResults.isReviewPractice/.isUpdate` | 회 | 0=0 | 둘다 |
| ~~`quiz_accuracy_AUX`~~ | — | **추출 안 함**(수행 지표·행동 아님, 종속변수 동일도메인 상관물). 보조 파일도 미생성 | — | - | - | - |

> `entry_share_*`(완전)를 주지표, `time_share_*`(근사)는 민감도 보조. 정답률은 어떤 형태로도 추출·보관하지 않음.

---

## 변수 요약

전 변수 영역은 **위계 없이 동등 기술**(확증 주가설 없음). 영역별 변수 수:

| 변수 영역 | 변수 수 | 폐기/주의 |
|---|---|---|
| 식별·통제 | 5 | - |
| 피드백 사이클 (구 H5) | 6 (대표=`feedback_count`, 사이클은 시간근사 보조) | - |
| 학습 분산도 (구 H1) | 5 | - |
| 사회비교 (구 H7) | 3 (대표=`ranking_access_intensity`, 체류 근사) | ranking_tab_ratio |
| 메타인지 (구 H2) | 5 (정답/오답·재진입 근사) | - |
| AI 학습도움 (구 H3) | 2 | kongi_private_ratio |
| 교수픽 (구 H4) | 2 | - |
| 게이미피케이션 (구 H6) | 4 (전부 *활동량 대리·기술만*; `gacha_choice_ratio`는 고찰 훅) | dogam_entries, equip_change_count |
| 기본 사용량 | 약 11 | - |

→ 최종 분석 wide CSV: **약 148행 × 약 40열**. 추출 등급은 `feasibility.md`, 심사 제출 표는 `data-dictionary.md`, 추출·분석 계획은 `extraction-design.md`.
