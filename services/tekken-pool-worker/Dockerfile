# 철권퀴즈 문제 풀 생성 워커 — Cloud Run
# 매일 03:00 KST에 Cloud Scheduler가 트리거
# Gemini API 병렬 호출로 과목당 300문제 생성

FROM node:20-slim

WORKDIR /app

# 의존성 설치
COPY package.json package-lock.json ./
RUN npm ci --production

# 소스 복사
COPY . .

# Cloud Run 포트
ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
