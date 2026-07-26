"""
OmniThings 全局配置管理

基于 pydantic-settings，从环境变量 / .env 文件加载。
所有可配置项集中在此，避免散落各处的 hardcode。
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """全局配置 — 单例，通过 settings() 函数获取。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- 应用基础 ----
    app_name: str = "OmniThings"
    debug: bool = False
    log_level: str = "INFO"

    # ---- 数据库 (TimescaleDB / PostgreSQL) ----
    db_host: str = "timescaledb"
    db_port: int = 5432
    db_name: str = "omnithings"
    db_user: str = "omnithings"
    db_password: str = "omnithings_dev"
    db_pool_min: int = 2
    db_pool_max: int = 10

    @property
    def database_url(self) -> str:
        """同步连接串 (psycopg2 批量写入用)。"""
        return (
            f"postgresql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @property
    def database_url_async(self) -> str:
        """异步连接串 (asyncpg / FastAPI 用)。"""
        return (
            f"postgresql+asyncpg://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    # ---- MQTT (nanoMQ) ----
    mqtt_host: str = "nanomq"
    mqtt_port: int = 1883
    mqtt_username: str | None = None
    mqtt_password: str | None = None
    mqtt_client_id: str = "omnithings-backend"
    mqtt_qos: int = 1
    # 订阅的 topic 模式 — Neuron 上报 telemetry 使用此前缀
    mqtt_telemetry_topic: str = "telemetry/#"
    # MQTT 连接保活
    mqtt_keepalive: int = 60
    # 断线重连间隔 (秒)
    mqtt_reconnect_delay: float = 5.0

    # ---- Neuron (设备接入网关) ----
    neuron_api_url: str = "http://neuron:7000"
    neuron_api_version: str = "/api/v2"

    # ---- CORS ----
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    # ---- JWT (M7 RPC 控制) ----
    jwt_secret: str = "omnithings-dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24h

    # ---- 管道性能参数 ----
    # 批量写入 TSDB 的条数阈值 (攒够 N 条或 T 秒就 flush)
    pipeline_batch_size: int = 50
    pipeline_flush_interval_sec: float = 1.0
    # CE Path C 跨节点聚合调度间隔
    ce_aggregation_interval_sec: float = 10.0


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """获取配置单例。"""
    return Settings()


settings = get_settings()
