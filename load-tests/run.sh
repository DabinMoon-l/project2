#!/bin/bash
# ============================================================
# k6 부하 테스트 실행 스크립트
# ============================================================
#
# 사전 준비:
#   1. k6 설치: https://k6.io/docs/get-started/installation/
#   2. 환경변수 설정 (아래 참고)
#   3. 테스트 사용자 생성: node load-tests/setup-test-users.js
#
# 사용법:
#   chmod +x load-tests/run.sh
#   ./load-tests/run.sh <시나리오>
#
# 시나리오:
#   quiz    - 퀴즈 제출 동시성 테스트 (recordAttempt)
#   board   - 게시판 동시 읽기/쓰기 테스트
#   review  - 복습 목록 대량 조회 테스트
#   mixed   - 300명 혼합 현실적 시나리오
#   sequential - 단일 k6 프로세스로 전체 시나리오 순차 실행 (권장)
#   all     - 전체 시나리오 순차 실행 (개별 k6 프로세스)
# ============================================================

set -e

# 환경변수 확인
if [ -z "$FIREBASE_API_KEY" ]; then
  echo "❌ FIREBASE_API_KEY 환경변수를 설정하세요."
  echo "   export FIREBASE_API_KEY=your-api-key"
  exit 1
fi

SCENARIO=${1:-sequential}
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_DIR="load-tests/results"
mkdir -p "$RESULTS_DIR"

echo "============================================"
echo " k6 부하 테스트 실행"
echo " 시나리오: $SCENARIO"
echo " 시간: $TIMESTAMP"
echo "============================================"
echo ""

run_scenario() {
  local name=$1
  local file=$2

  echo "▶ 시나리오: $name"
  echo "  파일: $file"
  echo ""

  k6 run \
    --env FIREBASE_API_KEY="$FIREBASE_API_KEY" \
    --env FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-project2-7a317}" \
    --env FIREBASE_REGION="${FIREBASE_REGION:-asia-northeast3}" \
    --env TEST_COURSE_ID="${TEST_COURSE_ID:-biology}" \
    --env TEST_QUIZ_ID="${TEST_QUIZ_ID:-}" \
    --summary-export="$RESULTS_DIR/${name}_${TIMESTAMP}.json" \
    "$file"

  echo ""
  echo "✅ $name 완료. 결과: $RESULTS_DIR/${name}_${TIMESTAMP}.json"
  echo ""
}

case $SCENARIO in
  quiz)
    run_scenario "quiz-submit" "load-tests/scenarios/quiz-submit.js"
    ;;
  board)
    run_scenario "board-activity" "load-tests/scenarios/board-activity.js"
    ;;
  review)
    run_scenario "review-load" "load-tests/scenarios/review-load.js"
    ;;
  mixed)
    run_scenario "mixed-realistic" "load-tests/scenarios/mixed-realistic.js"
    ;;
  sequential)
    echo "단일 k6 프로세스로 전체 시나리오 순차 실행 (~16분)..."
    echo "  quiz_submit → board_activity → review_load → mixed_realistic"
    echo ""
    run_scenario "sequential-all" "load-tests/scenarios/sequential-all.js"
    ;;
  all)
    echo "전체 시나리오 순차 실행 (개별 k6 프로세스)..."
    echo ""
    run_scenario "quiz-submit" "load-tests/scenarios/quiz-submit.js"
    sleep 10
    run_scenario "board-activity" "load-tests/scenarios/board-activity.js"
    sleep 10
    run_scenario "review-load" "load-tests/scenarios/review-load.js"
    sleep 10
    run_scenario "mixed-realistic" "load-tests/scenarios/mixed-realistic.js"
    echo "============================================"
    echo " 전체 완료! 결과: $RESULTS_DIR/"
    echo "============================================"
    ;;
  *)
    echo "❌ 알 수 없는 시나리오: $SCENARIO"
    echo "   사용법: ./load-tests/run.sh <quiz|board|review|mixed|sequential|all>"
    exit 1
    ;;
esac
