# 추출 가능성 검증 (feasibility.md)

> ⛔ IRB 승인 전 — 코드 정적 분석에 근거한 *판정*이며 실제 쿼리 미실행.
> 등급: **완전**(직접 키로 정확 산출) · **근사**(proxy/시간추정) · **불가**(로그 부재).

---

## 0. 설계·MDE 정합 메모 (확정)

- **확증 핵심가설 없음 — 기술형 군집 프로파일.** 연구문제: 성적 군집(상/중/하)에 따라 앱 전 기능 사용 패턴이 어떻게 다른가. 사전 확정 변수군(구 H1·H2·H3·H4·H5·H7 + 기본사용량 + 게이미피케이션)을 **위계 없이 동등 기술**. Primary·Confirmatory·주가설·사전등록 표현 미사용(후향 2차분석).
- **게이미피케이션(구 H6)**: 토끼·뽑기·장착·레벨은 EXP 마일스톤 결정함수 → totalEXP(성적중복 제외) 대리. *폐기가 아니라 "활동량 대리·기술만"으로 포함* + EXP-결정성 자체를 방법론적 발견으로 보고. `gacha_choice_ratio`(마일스톤 선택비율)는 고찰 후속연구 훅(동기 측정·주장 안 함). 배틀은 기본사용량 기술.
- **피드백 사이클 영역 대표 변수 = `feedback_count`**(완전·148명 전원 정의; 각 영역이 대표 변수를 둠 — 위계 아님). `feedback_loop_completion`은 ②시간근사 + 분모0→NA라 *영역 내 보조 기술*로만(검정 엔드포인트 개념 없음 — 기술형).
- 분석(단순·표준): 변수별 **비모수 Jonckheere–Terpstra 순서대립 추세**(양측) + **효과크기(Cliff's δ)·95%CI**, **R 패키지**(DescTools·effsize·boot). 정식 ANCOVA·다자유도 옴니버스·교란해석 규칙 없음. 공변량(`exposure_days`,`class_id`) 불균형은 기술·한계로만. 0편중 변수=**2부 기술**(제출비율/제출자 중앙값).
- **다중비교·p 처리**: 확증 주가설 없는 기술형이라 단일 α 검정 미의존. **본문은 효과크기+95%CI만**, 변수별 p 미보고. p는 부록 표 *"k검정·무보정·비추론·확증 아님"* 라벨로만 일괄 제시(다중성=비추론·기술 위치로 통제, 보정 아님).
- 표본 근거 = **정밀도**(검정력 아님): N≈148, 군집 셀 ≈49/50/49 → 효과크기 **f≈0.23 미만 군집차이는 95%CI로 안정 구분 불가**. 참조 G*Power Sensitivity(α=0.05·1-df·공변량 노출1+분반더미3) f≈0.23 = IRB 칸용 *구분 가능 최소차이*. 옛 0.0167 옴니버스 미사용.
- 실데이터가 사전 가정과 달라도 **표준 절차(J–T+효과크기·CI) 불변**, 단순 민감도 기술만 추가 → 9.3 사전고정과 정합.
- ⚠️ `feedback_count` 분포는 IRB 전 조회 불가 → 0건 학생 비율 미상. **0 다발(영과잉) 가능성** 있어 비모수/영과잉 고려 + 효과크기 중심 해석(→ 5절).

---

## 1. 변수별 추출 등급

| 변수 | 가설 | 등급 | 근거(파일) | 대안/비고 |
|---|---|---|---|---|
| `attendance_interval_sd/cv` | H1 | **완전** | `dailyAttendance.attendedUids` 날짜 배열 | - |
| `night_use_ratio`,`weekend_use_ratio` | H1 | **완전** | `pageViews.timestamp`(KST hour/dayOfWeek) | dayOfWeek 정의(월=0..일=6) 확인 후 weekendDays 매핑 |
| `exam_focus_ratio` | H1 | **완전(외부입력 의존)** | `pageViews.timestamp` | 시험일정 로그 부재 → `ExamSchedule` 교수 입력 필수. 미입력 시 산출 보류 |
| `review_detail_entries` | H2 | **완전** | `usePageViewLogger` category=`review_detail` | - |
| `review_entries_wrong/correct`,`wrong_review_ratio` | H2 | **근사** | `pageViews.path` 라우트 패턴 | 정답/오답은 라우트(`/review/wrong*` vs `/review/library*`)로 proxy. 문항 단위 정오 아님 |
| `same_detail_revisit` | H2 | **근사** | `pageViews.path` 그룹 | 동일 **문항** 재진입 불가 → 동일 퀴즈/폴더 재진입으로 대체 |
| `kongi_academic_q` | H3 | **완전** | `posts.authorId/.tag/.isPrivate` | - |
| `kongi_followup_ratio` | H3 | **근사** | `comments.parentId`,`authorId='gemini-ai'` | 대댓글 체인 추적 가능하나 "후속질문 의도"는 구조적 proxy |
| `prof_pick_entries/unique` | H4 | **근사** | `pageViews.path`(postId) ⋈ `posts.isPinned` | 진입 *당시* 핀 여부 미기록 → 추출 시점 isPinned 기준(보수적) |
| `feedback_count` | H5 | **완전** | `questionFeedbacks` userId/quizId/questionId/createdAt | 스키마 확인됨(`functions/src/feedback.ts`) |
| `feedback_edited_count` | H5 | **근사(시간)** | `quizzes.questions[i].questionUpdatedAt` | ↓ 2절 상세 |
| `feedback_redo_count` | H5 | **완전** | `quizResults` isReviewPractice + `questionScores[qid].answeredAt` | 직접 키 |
| `feedback_loop_completion` | H5 | **근사(합성)** | 위 셋 결합 | ② 단계가 시간근사라 합성도 근사 |
| `rabbit_species_owned`,`gacha_count` | 게이미피케이션(활동량 대리) | **완전** | `users/{uid}/rabbitHoldings` | EXP 결정함수(r≈0.98) → totalEXP 대리. *검정 아님, 활동량 대리로 기술만* + EXP-결정성 방법론적 발견으로 보고 |
| `gacha_choice_ratio` | 게이미피케이션(고찰 훅) | **근사** | `lastGachaExp`·levelUp 이력 | 마일스톤 선택 비율(수집 vs 투자). 고찰 후속연구 훅, 동기 측정·주장 안 함 |
| `battle_count`,`battle_used` | 기본사용량(기술) | **완전** | RTDB `tekken/results` player1Id/player2Id | battle_used 천장 85–95%(퇴화)→기술용, battle_count만 보고 |
| ~~`dogam_entries`,`equip_change_count`~~ | — | **불가** | 로깅/이력 없음 | 폐기(추적 불가 — 게이미피케이션 기술에 미포함) |
| `ranking_entries` | H7 | **완전** | `logOverlay('ranking_open')`(`RankingSection.tsx:167`, **명시적 클릭**) → `pageViews` category=ranking_open | ⚠️ 가로모드 분기(`:165`)는 미로깅 → 차등 결측 한계 |
| `ranking_dwell_ms` | H7 | **근사** | `pageViews.durationMs` | 다른 페이지 이동 시에만 duration 주입. 마지막/이탈 시 결측 |
| `ranking_tab_ratio` | H7 | **불가** | day/week/all = 컴포넌트 내부 state, 로그 없음 | 후향 복원 불가 → **변수 폐기**. `ranking_access_intensity`로 사회비교 대리 |
| `entry_share_*` | 탐색 | **완전** | `pageViews.category` 카운트 | 권장 주지표 |
| `time_share_*` | 탐색 | **근사** | `pageViews.durationMs` | duration 결측 다수 → 보조/민감도용 |
| `quiz_attempts`,`quiz_retry_count` | 탐색 | **완전** | `quizResults` userId/isUpdate/isReviewPractice | - |

---

## 2. 【H5 전용】 피드백 사이클 완주율 추적 가능성 (핵심 검토)

요청: ① 피드백 제출 ② 교수 수정 여부 ③ 학생 재풀이 — 3단계가 현 로그로 추적되는가.

### ① 학생 피드백 제출 — ✅ **완전**
- `questionFeedbacks` 문서: `userId`, `quizId`, `questionId`, `type`, `createdAt`, `status`(pending/reviewed/resolved), `content?`(자유텍스트, **추출 안 함**) — `functions/src/feedback.ts:20-29`.
- (학생ID, 문항ID, 제출일시) **모두 존재** → 어느 학생이 어느 문항에 언제 피드백했는지 정확.

### ② 교수가 그 문항을 수정했는가 — ⚠️ **시간근사 (직접 인과 키 없음)**
- 교수 수정 시 `quizzes/{quizId}.questions[i].questionUpdatedAt`가 갱신됨(`lib/hooks/useQuizUpdate.ts:159-217`).
- **그러나 "이 피드백 때문에 수정했다"는 외래키/참조가 없음.** 연결은 오직 시간 비교:
  `feedback.createdAt < questionUpdatedAt` → "피드백 이후 그 문항이 수정됨"(상관, **인과 아님**).
- 보강 신호: `questionFeedbacks.status`가 `reviewed`/`resolved`로 바뀌면 교수가 처리했다는 정황 → **단, 누가/언제 status를 바꾸는지(자동 vs 수동) 미검증** → 보조 정황으로만, 1차 판정은 timestamp.
- **판정: 근사 가능. 단 "피드백이 수정을 유발했다"고 단정 불가 → 논문엔 "피드백 제출 후 해당 문항이 수정된 비율"로 기술.**

### ③ 학생이 수정문항을 재풀이했는가 — ✅ **완전**
- 복습 재풀이 시 `quizResults`에 `isReviewPractice=true` + `questionScores[questionId].answeredAt` 갱신(`functions/src/reviewPractice.ts:109-116`).
- `answeredAt > questionUpdatedAt`이면 "수정 후 재풀이" 정확 판정.
- 한계: `answeredAt`은 **덮어쓰기**라 *몇 회* 재풀이했는지는 불가 → **여부/건수**까지만(이미 변수 설계 반영).

### 종합 판정
| 단계 | 등급 | 연결 키 |
|---|---|---|
| ① 제출 | 완전 | `questionFeedbacks.userId+quizId+questionId+createdAt` |
| ② 수정 | **시간근사** | `feedback.createdAt < questions[i].questionUpdatedAt` (참조 없음) |
| ③ 재풀이 | 완전 | `questionScores[qid].answeredAt > questionUpdatedAt` |

➡️ **확정**: H5 **주 검정 엔드포인트 = `feedback_count`**(완전·전원 정의). `feedback_loop_completion`은 ②시간근사 + 분모0→NA로 실분석 N 축소 → **H5 내부 보조**(주 엔드포인트 금지).
➡️ 보고:
- 주변수 `feedback_count` — "피드백 능동성"(1-df 추세 + 효과크기·95%CI 주력).
- 보조 `feedback_loop_completion`/`feedback_edit_rate`/`feedback_redo_rate`는 *시간근사·NA 다발* 명시 후 행동 시퀀스 기술용으로만.
- 인과 주장 금지, "피드백 제출자 중 해당 문항이 이후 수정·재풀이된 비율"이라는 *행동 시퀀스 기술*로 한정.

### 5. `feedback_count` 분포 리스크 (통계 현실)

`feedback_count`는 노력 드는 선택적 행동 → **0건 학생 다발(영과잉·우편향) 가능성 큼**. IRB 전이라 실분포 미상이나 설계상 단순·정직하게 대비:
- 모형(허들·음이항·영과잉 회귀) 대신 **2부 기술 보고**: ① 군집별 *1건 이상 제출자 비율*(비율+95%CI) ② *제출자 중 중앙값(IQR)*. 0과잉을 모형으로 흡수하지 않고 *기술로 분리*해 해석·방어를 단순화.
- 추세 신호는 다른 변수와 동일하게 J-T(R) + 효과크기·95%CI로 보고.
- **효과크기(Cliff's δ 등)+95%CI만 본문 보고**, p는 부록 라벨표로만.

---

## 3. 불가 변수 요약 & 대안

| 불가 변수 | 사유 | 대안 |
|---|---|---|
| 게이미피케이션(토끼) — *독립 차원으로* | 토끼/뽑기/장착/레벨 전 변수가 EXP 마일스톤 결정함수(r≈0.70–1.0) | totalEXP(성적중복 제외)의 대리 → 독립 행동·동기로 분리 측정 불가. 단 *활동량 대리로는 기술 포함*, EXP-결정성을 방법론적 발견으로 보고, `gacha_choice_ratio`는 고찰 훅. 배틀은 기본사용량 기술 |
| `ranking_tab_ratio`(H7) | 탭 내부 state, 로그 없음 | `ranking_access_intensity`(`ranking_open`)로 사회비교 대리. 탭별 선호는 범위 외 |
| 재풀이 *횟수*(H5) | `answeredAt` 덮어쓰기 | 여부/건수로 강등(설계 반영 완료) |
| 정확 체류시간(전반) | duration 다음 이동 시에만 주입 | 진입 횟수(`entry_*`) 주지표, 체류는 보조·민감도 |

> 이 한계들은 **앱이 연구 목적이 아닌 운영 목적으로 로깅**돼 있고 **후향 데이터**라서 발생. IRB 계획서 "연구의 제한점"에 그대로 기술 권장.
