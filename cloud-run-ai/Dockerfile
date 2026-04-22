# Node 22 slim 이미지
FROM node:22-slim AS builder

WORKDIR /app

# 의존성 설치 (캐시 최적화)
COPY package.json package-lock.json* ./
RUN npm ci

# 소스 복사 후 TypeScript 빌드
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── 런타임 이미지 ──
FROM node:22-slim

WORKDIR /app

# 런타임 의존성만 (devDependencies 제외)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# 빌드 산출물 복사
COPY --from=builder /app/dist ./dist

# 비특권 사용자
RUN groupadd -r app && useradd -r -g app app
USER app

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
