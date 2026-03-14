#!/bin/bash
# 철권퀴즈 문제 풀 워커 Cloud Run 배포
#
# 사전 조건:
#   1. gcloud CLI 설치 및 인증
#   2. GEMINI_API_KEY Secret Manager 등록
#      gcloud secrets create GEMINI_API_KEY --data-file=-
#   3. 서비스 계정에 Firestore/Secret Manager 권한
#
# 사용법: ./deploy.sh

PROJECT_ID="project2-7a317"
REGION="asia-northeast3"
SERVICE_NAME="tekken-pool-worker"

echo "=== ${SERVICE_NAME} Cloud Run 배포 ==="

# 빌드 + 배포
gcloud run deploy ${SERVICE_NAME} \
  --source . \
  --project ${PROJECT_ID} \
  --region ${REGION} \
  --platform managed \
  --memory 2Gi \
  --timeout 900 \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 1 \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest" \
  --no-allow-unauthenticated

echo ""
echo "=== Cloud Scheduler 설정 ==="
echo "매일 03:00 KST에 POST /refill 호출:"
echo ""
echo "  gcloud scheduler jobs create http tekken-pool-refill \\"
echo "    --schedule='0 3 * * *' \\"
echo "    --time-zone='Asia/Seoul' \\"
echo "    --uri=\$(gcloud run services describe ${SERVICE_NAME} --region ${REGION} --format 'value(status.url)')/refill \\"
echo "    --http-method=POST \\"
echo "    --oidc-service-account-email=\$(gcloud iam service-accounts list --format='value(email)' --filter='displayName:Default compute') \\"
echo "    --project ${PROJECT_ID}"
echo ""
echo "배포 완료!"
