# 연구도구 — 데이터 사전 (Data Dictionary)

## 1. 문서 성격 및 분석 단위

본 문서는 연구계획서의 수집 데이터 항목 명세이며 연구도구로 제출한다.

- 분석 단위는 학생 1명(1행)이다. 최종 데이터셋은 연구ID(R001~R148)로만 식별하며, 학번·실명·자유 텍스트·랭킹 점수·누적 경험치·퀴즈 정답률은 포함하지 않는다.
- 자료 추출은 IRB 승인·종강·동의 수집이 모두 끝난 뒤 1회 수행한다(연구계획서 4.1).
- 변수 산출식·사전 분포 가정·분석 절차는 연구계획서 4.3·4.6에 따른다. 본 문서는 항목·단위·원천·결측·민감도만 명세한다.

## 2. 표 읽기 규칙

- 변수 영역: 같은 학습 행동 묶음이다. 영역 간 우선순위는 없다(연구계획서 4.3).
- 균형 점검 변수: 정식 보정 대상이 아니라, 군집 간 분포를 기술해 균형을 확인하는 용도다(class_id, exposure_days).
- 보조 지표: 운영 로그의 시간순서만 추적되는 시간근사 변수다. 영역 대표 변수의 보조로만 기술한다.
- 결측 표기: "0=0"은 기록이 없으면 사용량 0으로 처리한다는 뜻이다. "NA"는 값이 정의되지 않아 해당 변수 분석에서 제외(행 전체 제외 아님)한다는 뜻이다.
- 민감도 등급: 상(학업·식별 관련), 중(생활·행동 추정 가능), 하(단순 사용 카운트).

## 3. 수집 데이터 항목

각 표의 컬럼은 변수명 / 정의 / 단위 / 원천 데이터 / 결측 처리 / 민감도이다.

### 3.1 식별 · 군집 · 균형 점검

| 변수명 | 정의 | 단위 | 원천 데이터 | 결측 처리 | 민감도 |
|---|---|---|---|---|---|
| research_id | 연구용 익명 ID(학번 치환값) | ID | 교수 보관 매핑표 | 해당없음 | 하 |
| grade_cluster | 학기 성적 상/중/하 군집. 독립(군집)변수, 선형코딩 +1/0/−1 | 범주/순서 | 교수 성적표(앱 외부) | 성적 결측 시 분석 제외 | 상 |
| class_id | 분반(A·B·C·D). 균형 점검용 | 범주 | users.classId | 별도 표기 | 중 |
| exposure_days | 앱 노출 기간. 균형 점검용 | 일 | pageViews.timestamp | 미가입자 제외 | 하 |
| attendance_days_total | 총 접속일수. 비율 변수 분모로 사용 | 일 | dailyAttendance.attendedUids | 0이면 사용량 0 | 하 |

### 3.2 피드백 사이클

| 변수명 | 정의 | 단위 | 원천 데이터 | 결측 처리 | 민감도 |
|---|---|---|---|---|---|
| feedback_count | 문제 피드백 제출 수. 영역 대표(전원 정의) | 건 | questionFeedbacks.userId | 0=0 | 중 |
| feedback_edited_count | 본인 피드백 문항 중 이후 수정 건수(시간근사 보조) | 건 | questions.questionUpdatedAt 결합 | feedback=0이면 NA | 중 |
| feedback_redo_count | 그 수정 문항 재풀이 건수(보조) | 건 | questionScores.answeredAt 결합 | 0=0 | 중 |
| feedback_loop_completion | 피드백 루프 완주율(근사 합성, NA 다발, 보조) | 비율 | 위 세 변수 | feedback=0이면 NA | 중 |
| feedback_edit_rate | 제출→수정 전환율(보조) | 비율 | 위 변수 | 분모0이면 NA | 중 |
| feedback_redo_rate | 수정→재풀이 전환율(보조) | 비율 | 위 변수 | 분모0이면 NA | 중 |

### 3.3 학습 분산도

| 변수명 | 정의 | 단위 | 원천 데이터 | 결측 처리 | 민감도 |
|---|---|---|---|---|---|
| attendance_interval_sd | 접속 간격 표준편차(규칙성) | 일 | dailyAttendance 날짜배열 | 접속≤1일이면 NA | 중 |
| attendance_interval_cv | 접속 간격 변동계수 | 무차원 | dailyAttendance | 평균0이면 NA | 중 |
| exam_focus_ratio | 시험 1주 전 사용량 ÷ 평시 비율 | 배수 | pageViews.timestamp + 교수 시험일정 | 일정 미입력 시 보류 | 중 |
| night_use_ratio | 야간(22~06시) 사용 비율 | 비율 | pageViews.timestamp | 분모0이면 NA | 중 |
| weekend_use_ratio | 주말 사용 비율 | 비율 | pageViews.timestamp | 분모0이면 NA | 중 |

### 3.4 사회비교

| 변수명 | 정의 | 단위 | 원천 데이터 | 결측 처리 | 민감도 |
|---|---|---|---|---|---|
| ranking_access_intensity | 앱 활동 대비 랭킹 상세 열람 강도. 영역 대표 | 비율 | 랭킹 열람 pageView ÷ 전체 pageView | 분모0이면 NA | 하 |
| ranking_entries | 랭킹 상세 명시적 열람 횟수(자동노출 제외, 가로모드 일부 미기록) | 회 | pageViews 카테고리=ranking_open | 0=0 | 하 |
| ranking_dwell_ms | 랭킹 체류시간(근사, 보조) | ms | pageViews.durationMs | 결측 행 제외 | 하 |

### 3.5 메타인지 · 복습

| 변수명 | 정의 | 단위 | 원천 데이터 | 결측 처리 | 민감도 |
|---|---|---|---|---|---|
| review_detail_entries | 복습 해설 진입 총횟수 | 회 | pageViews 카테고리=review_detail | 0=0 | 하 |
| review_entries_wrong | 오답 복습 진입(근사) | 회 | pageViews 경로 /review/wrong | 0=0 | 하 |
| review_entries_correct | 정답·서재 복습 진입(근사) | 회 | pageViews 경로 /review/library | 0=0 | 하 |
| wrong_review_ratio | 오답 복습 집중도 | 비율 | 위 두 변수 | 분모0이면 NA | 하 |
| same_detail_revisit | 동일 복습 상세 재진입(근사) | 회 | pageViews 경로 그룹 | 0=0 | 하 |

### 3.6 AI 학습도움 · 교수 큐레이션

| 변수명 | 정의 | 단위 | 원천 데이터 | 결측 처리 | 민감도 |
|---|---|---|---|---|---|
| kongi_academic_q | 콩콩이(앱 내 AI 학습도움 기능) 학술 질문 수(공개 글) | 건 | posts(작성자·태그=학술·비공개 아님) | 0=0 | 중 |
| kongi_followup_ratio | 콩콩이 답변 후 후속질문 비율 | 비율 | comments(상위글·AI 응답 연결) | 분모0이면 NA | 중 |
| prof_pick_entries | 교수 픽(핀 고정) 글 진입 총횟수 | 회 | pageViews × posts.isPinned | 0=0 | 하 |
| prof_pick_unique | 진입한 교수 픽 글 종수 | 개 | 위와 동일 | 0=0 | 하 |

### 3.7 게이미피케이션 — 보상 소비 행동 (연구계획서 4.3)

| 변수명 | 정의 | 단위 | 원천 데이터 | 결측 처리 | 민감도 |
|---|---|---|---|---|---|
| rabbit_species_owned | 보유 토끼 종 수(마일스톤 소비로 증가하는 보상 소비 행동) | 종 | rabbitHoldings | 없으면 0 | 중 |
| gacha_count | 누적 뽑기 횟수(보상 소비 행동) | 회 | rabbitHoldings.discoveredAt | 0=0 | 중 |
| gacha_choice_ratio | 마일스톤 선택 중 뽑기 비율(보상 소비 성향, 후속 연구 제언용·본 분석 비검정) | 비율 | lastGachaExp·levelUp 이력 | 마일스톤0이면 NA | 중 |

이 변수들은 적립된 보상의 소비 행동이며, 활동량 대리나 동기 지표로 해석하지 않는다.

### 3.8 기본 사용량 (배틀 포함)

| 변수명 | 정의 | 단위 | 원천 데이터 | 결측 처리 | 민감도 |
|---|---|---|---|---|---|
| battle_count | 배틀(tekken) 참여 횟수 | 회 | tekken 결과 등장 | 0=0 | 하 |
| battle_used | 배틀 1회 이상 사용 여부(천장 85~95%, 기술용) | 0/1 | tekken 결과 | 없으면 0 | 하 |
| entry_share_quiz / review / board / battle | 카테고리별 진입 비중 | 비율 | pageViews 카테고리 | 분모0이면 NA | 하 |
| time_share_quiz / review / board / battle | 카테고리별 체류 비중(근사) | 비율 | pageViews.durationMs | 결측 행 제외 | 하 |
| quiz_attempts | 퀴즈 시도 횟수(정답률 제외) | 회 | quizResults.userId | 0=0 | 하 |
| quiz_retry_count | 재시도·복습풀이 횟수 | 회 | quizResults 재풀이·수정 플래그 | 0=0 | 하 |

## 4. 미수집(폐기) 변수

| 변수 | 사유 |
|---|---|
| kongi_private_ratio | 비공개("나만의 콩콩이") 실사용자가 드물고 사생활 측면이 있어 미수집 |
| dogam_entries | 도감 진입 로그가 없어 후향 복원 불가 |
| equip_change_count | 토끼 장착 변경 이력 미저장 |
| ranking_tab_ratio | 랭킹 일간·주간·전체 탭 전환 로그 없음 |
| rank / totalExp / 퀴즈 정답률 | 사용 행동이 아닌 수행·집계 지표이며 종속변수와 같은 도메인에서 강하게 상관해 독립변수로 부적합, 미추출 |

## 5. 퀴즈 정답률 비추출 명시

퀴즈 정답률은 분석 데이터셋과 어떤 보조 파일에도 추출·보관하지 않는다. 사용 행동이 아닌 수행 지표이며, 종속변수와 같은 미생물학 숙련도를 재는 상관물이기 때문이다. quizResults에서는 시도·재시도 행동량만 사용한다(연구계획서 7.1과 동일).
