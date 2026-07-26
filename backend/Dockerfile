# ============================================================
# OmniThings Backend - Docker Build (F0 精简版)
#
# 跨平台构建 (本地 Windows → e606 ARM64):
#   docker buildx build --platform linux/arm64 -t omnithings:0.1.0 ./backend --load
#   docker save omnithings:0.1.0 | gzip > omnithings-0.1.0-arm.tar.gz
#   scp → 服务器: docker load < omnithings-0.1.0-arm.tar.gz
#
# 说明:
#   - 基础镜像走 DaoCloud 加速 (docker.io 直连国内 EOF)
#   - pip 走清华源 (pypi.org 直连慢)
#   - F0 精简依赖: zen-engine/pandas/sympy/sqlalchemy 等 F1/F2 组件后置
# ============================================================

FROM docker.m.daocloud.io/library/python:3.12-slim

LABEL maintainer="OmniThings Team"
LABEL description="OmniThings IoT Platform Backend - F0 Data Pipeline"
LABEL version="0.1.0"

WORKDIR /app

# 系统依赖 (psycopg2 需要 libpq 运行时)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        curl \
    && rm -rf /var/lib/apt/lists/*

# F0 核心依赖 (清华镜像加速)
# zen-engine/pandas/sympy/sqlmodel/asyncpg/alembic 等 F1/F2 阶段再加
RUN pip install --no-cache-dir \
        -i https://pypi.tuna.tsinghua.edu.cn/simple \
        fastapi \
        "uvicorn[standard]" \
        psycopg2-binary \
        paho-mqtt \
        loguru \
        pydantic \
        pydantic-settings \
        pint

# 复制应用代码
COPY app ./app

# 非 root 运行
RUN groupadd -r omnithings && useradd -r -g omnithings omnithings && \
    chown -R omnithings:omnithings /app
USER omnithings

EXPOSE 9000

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9000/api/v1/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9000", "--log-level", "info"]
