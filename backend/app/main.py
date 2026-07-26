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

    # 根路径 → 重定向到 API 文档 (浏览器友好)
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
