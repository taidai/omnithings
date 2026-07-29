"""
OmniThings IoT Platform - FastAPI Application Entry Point
Phase 1 S0-S5: 集成 F0 数据管道到应用生命周期
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

import sys

# 配置 loguru
logger.remove()
logger.add(
    sys.stderr,
    level="INFO",
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
           "<level>{level:<7}</level> | "
           "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
           "<level>{message}</level>",
)

# Pipeline 实例引用 (供 Health API 使用)
_pipeline = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan — 启停 F0 数据管道。"""
    global _pipeline

    # ---- Startup ----
    logger.info("OmniThings IoT Platform starting up...")

    # Phase 1 S2+: 启动 F0 数据管道 (MQTT → Parse → Normalize → Store)
    try:
        from app.services.pipeline import DataPipeline

        _pipeline = DataPipeline()
        await _pipeline.start()

        # 注入给 Health API
        from app.api.health import set_pipeline
        set_pipeline(_pipeline)

        logger.success("[Main] F0 data pipeline started ✅")
    except Exception as e:
        logger.error("[Main] F0 pipeline CRITICAL failure: {}", e)
        logger.error("[Main] Shutting down — no MQTT ingestion without pipeline")
        raise  # fail-fast: 管道是核心组件，死了就不该假装活着

    yield

    # ---- Shutdown ----
    logger.info("OmniThings IoT Platform shutting down...")
    if _pipeline:
        await _pipeline.stop()
        logger.info("[Main] F0 data pipeline stopped")


def create_app() -> FastAPI:
    """Application factory."""
    app = FastAPI(
        title="OmniThings API",
        description="OmniThings IoT Platform - 替代 ThingsBoard 的工业 IoT 开发平台",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )

    # CORS middleware
    from app.core.config import settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ---- Register routers ----
    # Phase 1 S1: Health
    from app.api.health import router as health_router
    app.include_router(health_router, prefix="/api/v1", tags=["Health"])

    # F0 可视化: Nodes + Tags + Telemetry WS
    from app.api.nodes import router as nodes_router
    app.include_router(nodes_router, prefix="/api/v1", tags=["Nodes"])

    from app.api.tags import router as tags_router
    app.include_router(tags_router, prefix="/api/v1", tags=["Tags"])

    from app.api.websocket import router as ws_router
    app.include_router(ws_router, prefix="/api/v1", tags=["Telemetry WS"])

    from app.api.telemetry import router as telemetry_router
    app.include_router(telemetry_router, prefix="/api/v1", tags=["Telemetry"])

    from app.api.admin import router as admin_router
    app.include_router(admin_router, prefix="/api/v1", tags=["Admin"])

    from app.api.snapshots import router as snapshots_router
    app.include_router(snapshots_router, prefix="/api/v1", tags=["Snapshots"])

    from app.api.neuron import router as neuron_router
    app.include_router(neuron_router, prefix="/api/v1", tags=["Neuron"])

    from app.api.categories import router as categories_router
    app.include_router(categories_router, prefix="/api/v1", tags=["Categories"])

    # ---- Static Frontend (F0 可视化 V1) ----
    # 后端直接托管前端 dist，无需独立 nginx 容器
    import os
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse
    from starlette.exceptions import HTTPException as StarletteHTTPException

    FRONTEND_DIST = os.environ.get("FRONTEND_DIST", "/app/frontend/dist")

    if os.path.isdir(FRONTEND_DIST):
        _assets = os.path.join(FRONTEND_DIST, "assets")
        if os.path.isdir(_assets):
            app.mount("/assets", StaticFiles(directory=_assets), name="assets")
            logger.info("[Main] Frontend assets mounted at /assets")

        # SPA catch-all — 非 API 路由回退到 index.html
        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str):
            # 绝不拦截 API / 文档路由
            if full_path.startswith(("api/", "docs", "redoc", "openapi")):
                raise StarletteHTTPException(status_code=404)
            # 尝试静态文件 (favicon, robots.txt 等)
            candidate = os.path.join(FRONTEND_DIST, full_path)
            if os.path.isfile(candidate):
                return FileResponse(candidate)
            # SPA 回退 → index.html
            index = os.path.join(FRONTEND_DIST, "index.html")
            if os.path.isfile(index):
                return FileResponse(index)
            raise StarletteHTTPException(status_code=404)

        logger.info("[Main] Frontend SPA served from {}", FRONTEND_DIST)
    else:
        # 无前端 dist 时保留 API 文档重定向
        from fastapi.responses import RedirectResponse

        @app.get("/", include_in_schema=False)
        async def root() -> RedirectResponse:
            return RedirectResponse(url="/api/docs")

    # TODO Phase 1 S4: app.include_router(telemetry_router, prefix="/api/v1")
    # TODO Phase 2:     app.include_router(virtual_points_router, prefix="/api/v1")
    # TODO Phase 3:     app.include_router(rpc_router, prefix="/api/v1")
    # TODO Phase 3:     app.include_router(rules_router, prefix="/api/v1")
    # TODO Phase 3:     app.include_router(alarms_router, prefix="/api/v1")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
