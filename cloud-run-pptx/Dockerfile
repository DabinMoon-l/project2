# Python 3.11 slim 이미지 사용
FROM python:3.11-slim

# 작업 디렉토리 설정
WORKDIR /app

# 시스템 의존성 설치 (python-pptx에 필요)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Python 의존성 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

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
