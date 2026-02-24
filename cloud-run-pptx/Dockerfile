# Python 3.11 slim 이미지 사용
FROM python:3.11-slim

# 작업 디렉토리 설정
WORKDIR /app

# 시스템 의존성 설치 (LibreOffice + Chromium 런타임 의존성)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libreoffice-impress \
    libreoffice-writer \
    fonts-noto-cjk \
    # Chromium 런타임 의존성 (Playwright --with-deps 대체)
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

# Python 의존성 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Playwright Chromium 설치 (시스템 의존성은 위에서 이미 설치)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install chromium \
    && chmod -R 777 /ms-playwright

# 애플리케이션 코드 복사
COPY main.py .

# 비특권 사용자로 실행 (보안)
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

# 포트 설정 (Cloud Run은 PORT 환경변수 사용)
ENV PORT=8080
EXPOSE 8080

# Gunicorn으로 서버 실행
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 0 main:app
