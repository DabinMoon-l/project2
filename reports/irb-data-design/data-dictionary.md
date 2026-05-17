# 데이터 사전 (data-dictionary.md)

> **용도**: IRB 계획서 "수집 데이터 항목표"에 그대로 삽입하는 심사용 표.
> **상태**: ⛔ IRB 승인 전 설계. 추출은 승인+종강+동의 수집 후.
> **연구 성격**: 후향적 2차 분석 + (근)전수. 모집단 = 2026-1학기 G지역 일개 간호대학 미생물학 수강생(이 강좌·이 학기 한정, 일반화 안 함).
> **분석 단위**: 학생 1명(=1행). 최종 데이터셋은 `research_id`(R001~R148)로만 식별 — 학번·실명·자유텍스트·랭킹점수·정답률 미포함.
> **설계**: 확증 핵심가설 없음 — **기술형 군집 프로파일**. 연구문제: 성적 군집(상/중/하)에 따라 앱 전 기능 사용 패턴이 어떻게 다른가. 사전 확정 변수군을 **위계 없이 동등 기술**. 게이미피케이션(토끼)은 *활동량 결정함수(≈floor(totalEXP/50))*라 독립 차원·동기 아님 → 활동량 대리로만 기술 + EXP-결정성 자체를 방법론적 발견으로 보고, `gacha_choice_ratio`는 고찰 후속연구 훅(동기 측정·주장 안 함). (Primary·Confirmatory·주가설·사전등록 표현 미사용)
> **분석**: **비모수 Jonckheere–Terpstra 순서대립 사전 주분석**(영과잉·유계 다수), 순위변환 ANCOVA + 2-df 옴니버스 보조. 군집 선형코딩(상=+1·중=0·하=−1), 공변량 exposure_days·class_id. 추세검정=양측 비방향. 실데이터≠사전가정이어도 주분석(J–T) 불변·민감도만 보조 추가.
> **다중비교·p**: 확증 주가설 없는 기술형 → 단일 α 미의존. **본문은 효과크기+95%CI만**, 변수별 p 미보고. p는 부록 표 *"k검정·무보정·비추론·확증 아님"* 라벨로만 일괄 제시.
> **표본 근거(정밀도)**: N≈148, 군집 셀 ≈49/50/49. 이 규모에서 효과크기 **f≈0.23 미만의 군집 차이는 95% CI로 안정적으로 구분되지 않음**(정밀도 한계). 참조 산출 G*Power Sensitivity(ANCOVA, 3군집, 공변량=노출1+분반더미3, α=0.05, 1-β=.80, 1-df) → f≈0.23 — IRB 표본근거 칸용, 검정력 주장 아닌 *구분 가능 최소차이*로 해석. 폐기된 옴니버스(α=0.0167) 미사용.
> **민감도 등급**: 상=학업/식별 관련, 중=생활·행동 추정 가능, 하=단순 사용 카운트.

| 변수명 | 한국어 정의 | 변수 영역 | 측정 단위 | 원천 데이터 | 결측치 처리 | 민감도 |
|---|---|---|---|---|---|---|
| research_id | 연구용 익명 ID(학번 치환) | — | ID | (교수 보관 매핑표) | 해당없음 | 하 |
| grade_cluster | 학기 성적 상/중/하 군집(독립변수, 선형코딩 +1/0/−1) | 종속 | 범주/순서 | 교수 성적표(앱 외부) | 성적 결측 시 분석 제외 | 상 |
| class_id | 분반(공변량) | 공변량 | 범주 | users.classId | 별도 표기 | 중 |
| exposure_days | 앱 노출 기간(공변량) | 공변량 | 일 | pageViews.timestamp | 미가입자 제외 | 하 |
| attendance_days_total | 총 접속일수 | 분모 | 일 | dailyAttendance.attendedUids | 0이면 사용량 0 | 하 |
| **feedback_count** | **① 문제 피드백 제출 수(영역 대표, 148명 전원 정의)** | 피드백 사이클 | 건 | questionFeedbacks.userId | 0=0(전원 정의) | 중 |
| feedback_edited_count | ② 본인 피드백 문항 중 이후 수정 건수(시간근사) | 피드백 사이클(보조) | 건 | ⋈ questions[i].questionUpdatedAt | feedback=0 NA | 중 |
| feedback_redo_count | ③ 그 수정문항 재풀이 건수 | 피드백 사이클(보조) | 건 | ⋈ questionScores[qid].answeredAt | 0=0 | 중 |
| feedback_loop_completion | 피드백 루프 완주율(근사 합성·NA 다발, H5 보조) | 피드백 사이클(보조) | 비율 | 위 셋 | feedback=0 NA(제외) | 중 |
| feedback_edit_rate | 전환율 ①→② | 피드백 사이클(보조) | 비율 | 위 | 분모0 NA | 중 |
| feedback_redo_rate | 전환율 ②→③ | 피드백 사이클(보조) | 비율 | 위 | 분모0 NA | 중 |
| attendance_interval_sd | 접속 간격 표준편차(규칙성) | 학습 분산도 | 일 | dailyAttendance 날짜배열 | 접속≤1일 NA | 중 |
| attendance_interval_cv | 접속 간격 변동계수 | 학습 분산도 | 무차원 | dailyAttendance | mean=0 NA | 중 |
| exam_focus_ratio | 시험 1주 전 사용량÷평시 비율 | 학습 분산도 | 배수 | pageViews.timestamp + 교수 시험일정 | 일정 미입력 시 보류 | 중 |
| night_use_ratio | 야간(22–06시) 사용 비율 | 학습 분산도 | 비율 | pageViews.timestamp | 분모0 NA | 중 |
| weekend_use_ratio | 주말 사용 비율 | 학습 분산도 | 비율 | pageViews.timestamp | 분모0 NA | 중 |
| ranking_access_intensity | 앱 활동 대비 랭킹 상세 열람 강도(영역 대표) | 사회비교 | 비율 | pageViews.category=ranking_open ÷ 전체 | 분모0 NA | 하 |
| ranking_entries | 랭킹 상세 명시적 열람 횟수(자동노출 아님, 가로모드 일부 미기록) | 사회비교 | 회 | pageViews.category=ranking_open | 0=0 | 하 |
| ranking_dwell_ms | 랭킹 체류시간(근사, 보조) | 사회비교(보조) | ms | pageViews.durationMs | 결측 행 제외 | 하 |
| review_detail_entries | 복습 해설 진입 총횟수 | 메타인지 | 회 | pageViews.category=review_detail | 0=0 | 하 |
| review_entries_wrong | 오답 복습 진입(근사) | 메타인지 | 회 | pageViews.path~/review/wrong | 0=0 | 하 |
| review_entries_correct | 정답/서재 복습 진입(근사) | 메타인지 | 회 | pageViews.path~/review/library | 0=0 | 하 |
| wrong_review_ratio | 오답 복습 집중도 | 메타인지 | 비율 | 위 둘 | 분모0 NA | 하 |
| same_detail_revisit | 동일 복습 상세 재진입(근사) | 메타인지 | 회 | pageViews.path 그룹 | 0=0 | 하 |
| kongi_academic_q | 콩콩이 학술 질문 수(공개) | AI 학습도움 | 건 | posts(authorId,tag=학술,isPrivate=false) | 0=0 | 중 |
| kongi_followup_ratio | 콩콩이 답변 후속질문율 | AI 학습도움 | 비율 | comments.parentId/authorId=gemini-ai | 분모0 NA | 중 |
| prof_pick_entries | 교수 픽 글 진입 총횟수 | 교수픽 | 회 | pageViews.path ⋈ posts.isPinned | 0=0 | 하 |
| prof_pick_unique | 진입한 교수 픽 글 종수 | 교수픽 | 개 | 동상 | 0=0 | 하 |
| rabbit_species_owned | 보유 토끼 종 수 — *활동량 대리·기술만*(≈floor(totalEXP/50), r≈0.98; 동기/선호 아님) | 게이미피케이션(활동량 대리) | 종 | users/{uid}/rabbitHoldings | 없으면 0 | 중 |
| gacha_count | 누적 뽑기 — *활동량 대리·기술만* | 게이미피케이션(활동량 대리) | 회 | rabbitHoldings.discoveredAt | 0=0 | 중 |
| gacha_choice_ratio | 마일스톤 선택 중 뽑기 비율(수집 vs 투자 선호) — *고찰 후속연구 훅, 동기 측정·주장 안 함* | 게이미피케이션(고찰 훅) | 비율 | lastGachaExp·levelUp 이력 | 마일스톤 0이면 NA | 중 |
| battle_count | 배틀 참여 횟수(기본 사용량 탐색 기술) | 게이미피케이션/기본사용량(기술) | 회 | tekken/results player 등장 | 0=0 | 하 |
| battle_used | 배틀 1회+ 사용 여부(천장 85–95%, 기술용) | 게이미피케이션/기본사용량(기술) | 0/1 | tekken/results | 없으면 0 | 하 |
| entry_share_quiz/review/board/battle | 카테고리별 진입 비중 | 기본 사용량 | 비율 | pageViews.category | 분모0 NA | 하 |
| time_share_quiz/review/board/battle | 카테고리별 체류 비중(근사) | 기본 사용량 | 비율 | pageViews.durationMs | 결측 행 제외 | 하 |
| quiz_attempts | 퀴즈 시도 횟수(정답률 제외) | 기본 사용량 | 회 | quizResults.userId | 0=0 | 하 |
| quiz_retry_count | 재시도/복습풀이 횟수 | 기본 사용량 | 회 | quizResults.isReviewPractice/isUpdate | 0=0 | 하 |
| ~~quiz_accuracy_AUX~~ | 정답률 — **미추출**(수행 지표·행동 아님, 종속변수 동일도메인 상관물). 보조 파일도 미생성 | 폐기 | - | - | - | - |

---

## 폐기(미수집) 변수 — 심사 참고

| 변수 | 사유 |
|---|---|
| kongi_private_ratio | 비공개("나만의 콩콩이") 실사용자 희소 + 사생활 → 미수집 |
| dogam_entries | 도감 진입 로그 부재(후향 복원 불가) |
| equip_change_count | 토끼 장착 변경 이력 미저장 |
| ranking_tab_ratio | 랭킹 day/week/all 탭 전환 로그 부재 |
| rank / totalExp / 퀴즈 정답률 | 사용 행동이 아닌 수행·집계 지표, 종속변수와 동일 도메인 강상관 → 독립변수 부적합·미추출(정답률 별도 파일도 미생성) |

> **피드백 사이클 영역의 대표 변수는 `feedback_count`**(완전·148명 전원 정의; 다른 영역도 각자 대표 변수를 둠 — 위계 아님). `feedback_loop_completion`은 ②가 시간근사 + 분모 0이면 NA(실분석 N 축소)라 *영역 내 보조 기술 지표*로만(검정 엔드포인트 개념 없음 — 기술형 설계).
> 정답률(`quizResults.score`)은 **분석 데이터셋·보조 파일 어디에도 추출하지 않는다**(개인 단위 정답률 일절 미보관). 제외 사유: 사용 행동이 아닌 수행 지표 + 종속변수와 동일한 미생물학 숙련도의 상관물(정답률 ≠ 학기 성적이나 동일 도메인 측정치). `quizResults`에서는 시도·재시도 행동량만.
